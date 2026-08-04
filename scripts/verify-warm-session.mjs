/**
 * Verifies the warm-Plan-session assumptions (internal/pending.md NEXT #1), without the GUI:
 *   1. Streaming-input mode keeps ONE subprocess warm → later turns skip the cold-start.
 *   2. Exactly one `result` message arrives per pushed user message (the readLoop's core assumption).
 *
 * Compares 3 warm turns (one persistent query) against 2 cold one-shots (a fresh query each — the fallback).
 * Run: node scripts/verify-warm-session.mjs   (uses your `claude` login, same as the app)
 */
import { query } from '@anthropic-ai/claude-agent-sdk'

const SYSTEM = 'You are a terse assistant for a quick latency test.'
const PROMPT = 'Reply with exactly the word OK and nothing else.'
const cwd = process.cwd()
const now = () => Date.now()

// Mirror planSession.makeInput — the streaming-input channel.
function makeInput() {
  const items = []
  let waiting = null
  let ended = false
  return {
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (items.length) return Promise.resolve({ value: items.shift(), done: false })
          if (ended) return Promise.resolve({ value: undefined, done: true })
          return new Promise((res) => (waiting = res))
        }
      })
    },
    push: (m) => { if (waiting) { const w = waiting; waiting = null; w({ value: m, done: false }) } else items.push(m) },
    end: () => { ended = true; if (waiting) { const w = waiting; waiting = null; w({ value: undefined, done: true }) } }
  }
}

async function warmTest() {
  const input = makeInput()
  const q = query({
    prompt: input.iterable,
    options: { systemPrompt: SYSTEM, tools: [], permissionMode: 'bypassPermissions', settingSources: [], cwd }
  })

  let pending = null
  let resultsThisTurn = 0
  ;(async () => {
    try {
      for await (const msg of q) {
        if (msg.type === 'assistant') { if (pending) for (const b of msg.message.content) if (b.type === 'text') pending.buf += b.text }
        else if (msg.type === 'result') { resultsThisTurn++; const p = pending; pending = null; if (p) p.resolve({ text: p.buf, subtype: msg.subtype }) }
      }
    } catch (e) { if (pending) pending.reject(e) }
  })()

  const t0 = now()
  await Promise.race([q.initializationResult(), new Promise((_, r) => setTimeout(() => r(new Error('init timed out')), 20000))])
  const initMs = now() - t0

  const turn = async () => {
    resultsThisTurn = 0
    const t = now()
    const res = await new Promise((resolve, reject) => {
      pending = { resolve, reject, buf: '' }
      input.push({ type: 'user', message: { role: 'user', content: PROMPT }, parent_tool_use_id: null })
    })
    return { ms: now() - t, results: resultsThisTurn, subtype: res.subtype, text: res.text.trim().slice(0, 30) }
  }

  const turns = [await turn(), await turn(), await turn()]
  input.end()
  try { await q.return?.(undefined) } catch { /* */ }
  return { initMs, turns }
}

async function coldOneShot() {
  const t = now()
  let text = ''
  for await (const msg of query({
    prompt: PROMPT,
    options: { systemPrompt: SYSTEM, tools: [], permissionMode: 'bypassPermissions', settingSources: [], cwd, maxTurns: 1 }
  })) {
    if (msg.type === 'assistant') for (const b of msg.message.content) if (b.type === 'text') text += b.text
  }
  return { ms: now() - t, text: text.trim().slice(0, 30) }
}

const hardTimeout = setTimeout(() => { console.error('\n✗ overall timeout (120s) — killing'); process.exit(1) }, 120000)
try {
  console.log('— warm session (one persistent query, 3 turns) —')
  const warm = await warmTest()
  console.log(`init: ${warm.initMs}ms`)
  warm.turns.forEach((t, i) => console.log(`turn ${i + 1}: ${t.ms}ms · results=${t.results} · ${t.subtype} · "${t.text}"`))

  console.log('\n— cold one-shots (fresh query each, the fallback) —')
  const cold1 = await coldOneShot()
  console.log(`cold 1: ${cold1.ms}ms · "${cold1.text}"`)
  const cold2 = await coldOneShot()
  console.log(`cold 2: ${cold2.ms}ms · "${cold2.text}"`)

  const warmAvg = Math.round((warm.turns[1].ms + warm.turns[2].ms) / 2)
  const coldAvg = Math.round((cold1.ms + cold2.ms) / 2)
  const onePerTurn = warm.turns.every((t) => t.results === 1)
  console.log('\n— verdict —')
  console.log(`exactly one result per turn: ${onePerTurn ? 'YES ✓' : 'NO ✗ (readLoop assumption broken)'}`)
  console.log(`warm reuse (turns 2-3 avg ${warmAvg}ms) vs cold (avg ${coldAvg}ms): ${warmAvg < coldAvg ? `${Math.round((1 - warmAvg / coldAvg) * 100)}% faster ✓` : 'NOT faster ✗'}`)
} catch (e) {
  console.error('\n✗ warm path failed:', e?.message || e)
} finally {
  clearTimeout(hardTimeout)
  process.exit(0)
}
