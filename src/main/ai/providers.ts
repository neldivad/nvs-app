/**
 * Provider loops — two adapters over the ONE capability contract. Same catalog tools (as JSON
 * Schema), same dispatch, same AgentEvent transcript; only the wire format differs:
 *   • anthropic — Messages API (tool_use / tool_result blocks), via the SDK
 *   • openai    — Chat Completions (tool_calls / role:'tool'), via fetch — OpenRouter & OpenAI both
 *
 * The model only proposes content; writeTier (in dispatch) stamps provenance and the engine validates.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, Tool, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { z } from 'zod'
import { SYSTEM_PROMPT, toolsForProfile, wireDesc } from '@shared/config/aiTools'
import { clampMiddleOut } from '@shared/config/toolResult'
import type { AgentEvent, AgentRunResult, ChatMessage } from '@shared/ipc'
import { callTool } from './dispatch'

/** Each agent event is pushed to the renderer as it happens (streaming). */
export type Emit = (event: AgentEvent) => void

const MAX_TOKENS = 4096
const MAX_TURNS = 8
const MAX_RESULT_CHARS = 6000 // cap a single tool result fed back to the model (context bloat)

/** Serialize a tool result for the model, clipped MIDDLE-OUT so one big read can't bloat every later turn.
 *  Head+tail both survive (the tail is where an error/total/summary usually lives — the old head-only slice
 *  threw away exactly the part the model needed next). See internal/tool-surface.md. */
function clampResult(out: unknown): string {
  return clampMiddleOut(JSON.stringify(out ?? null), MAX_RESULT_CHARS)
}

/** Run a tool with a crash guard: a THROW from the engine (bad path → ENOENT, invalid input) becomes a
 *  model-visible teaching result instead of killing the whole run — Codex's RespondToModel-vs-Fatal split.
 *  It counts as no-progress (has `error`), so the stall-breaker still bounds a spree of crashing calls. */
function safeCall(name: string, args: Record<string, unknown>, model: string): unknown {
  try {
    return callTool(name, args, model)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `${name} failed: ${msg}. Fix the arguments and retry, or reach the target another way (find refs with search).` }
  }
}

/**
 * Anti-loop guard. Weak models burn the whole turn budget re-issuing the SAME tool call without using the result
 * they already have (the listStoryTree×7 loop). If an identical (name,args) already ran this run, short-circuit
 * with a nudge INSTEAD of re-running — breaks the loop and saves turns. `seen` lives across the tool-loop
 * iterations of one runAgent call, so a repeat on any later turn is caught.
 */
function repeatGuard(seen: Set<string>, name: string, args: unknown): { note: string } | null {
  const sig = `${name}:${JSON.stringify(args ?? {})}`
  if (seen.has(sig)) return { note: `You already called ${name} with these exact arguments earlier this turn — its result is above in the conversation. Do NOT call it again; use that result to act (e.g. queuePageEdit with a \`folder\` to edit every scene at once).` }
  seen.add(sig)
  return null
}

/**
 * Stall breaker. `repeatGuard` catches EXACT repeats, but a model can loop indefinitely by VARYING args — e.g. a
 * new failing `queryDb` SQL each turn (guessing columns that don't exist), which never dedups.
 *
 * We count CUMULATIVE no-progress results (a tool `error` or a repeat-guard `note`) across the turn — NOT
 * consecutive. Consecutive was gameable: the model interleaves one successful-but-useless read (a `listScenes`,
 * or a `queryDb` that happens to return rows) between the errors, which reset the counter, so 3-in-a-row never
 * hit and the breaker never fired. Cumulative can't be gamed that way. The ONLY thing that resets the count is a
 * real ACTION succeeding (a write returning `ok:true`) — genuine progress toward the goal, not another read.
 * At NUDGE we staple a hard directive onto the result; past STOP we END the run with a plain-text fallback so the
 * user never just watches a silent loop of red tool calls.
 */
const STALL_NUDGE_AT = 3 // cumulative no-progress results → inject the "stop gathering, act now" directive
const STALL_STOP_AT = 6 // → break the loop with a fallback reply
function noProgress(out: unknown): boolean {
  return !!(out && typeof out === 'object' && (('error' in out && (out as { error?: unknown }).error) || ('note' in out && (out as { note?: unknown }).note)))
}
/** A real action succeeded (a write tool returns `ok:true`) — genuine progress, so the stall count resets. A
 *  successful READ returns raw rows/arrays (no `ok`) and deliberately does NOT reset: reads don't excuse a spree. */
function realProgress(out: unknown): boolean {
  return !!(out && typeof out === 'object' && (out as { ok?: unknown }).ok === true)
}
// De-overfitted (tool-surface.md step 5): generic intent classes + the two audits — no named tools, no
// scripted edge cases. The correction mechanism for SPECIFIC failures is the teaching error on each result
// (`valid`/`next`); this directive only redirects the overall behavior.
const STALL_DIRECTIVE =
  'STOP — repeated tool calls are failing with no new progress; you are looping. Do not call another discover/read tool. Choose by INTENT: ' +
  'QUESTION or AUDIT → answer now in plain text from what you already have, citing what you actually read — a partial, cited answer beats looping. ' +
  'ACTION → make ONE act-tool call using only refs already present in the results above (copy them exactly; if an error offered `valid`/`next`, use that correction verbatim). ' +
  'Otherwise, if the SAME blocker has now failed repeatedly, say plainly what is blocking you.'
const STALL_FALLBACK =
  'I stopped rather than keep looping on failing tool calls. Point me at the specific scene, folder, or character to focus on and I’ll answer from what I have — or name the exact change you want and I’ll run it directly.'
/** Staple the directive onto a no-progress result once we're stalling, so the model can't miss it. */
function withDirective(out: unknown, stall: number): unknown {
  return stall >= STALL_NUDGE_AT && out && typeof out === 'object' ? { ...out, _directive: STALL_DIRECTIVE } : out
}

// zod 4's native JSON Schema (replaces zod-to-json-schema, which emits an empty schema on zod 4).
// CHAT profile (tool-surface.md): the in-app agent advertises the tight D/R/A/V core — no SQL escape
// hatch, no analysis internals, no restructuring. The MCP server (skill lane) keeps the full surface.
const SCHEMAS = toolsForProfile('chat').map((t) => ({ name: t.name, description: wireDesc(t), schema: z.toJSONSchema(z.object(t.input)) as Record<string, unknown> }))

const ANTHROPIC_TOOLS: Tool[] = SCHEMAS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Tool['input_schema'] }))
const OPENAI_TOOLS = SCHEMAS.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.schema } }))

// ── Anthropic (Messages API) ───────────────────────────────────────────────────
export async function anthropicRun(history: ChatMessage[], model: string, apiKey: string, emit: Emit, signal: AbortSignal, ctxNote: string): Promise<AgentRunResult> {
  const client = new Anthropic({ apiKey })
  const system = ctxNote ? `${SYSTEM_PROMPT}\n\n${ctxNote}` : SYSTEM_PROMPT
  const messages: MessageParam[] = history.map((m) => ({ role: m.role, content: m.text }))
  let reply = ''
  const seen = new Set<string>() // anti-loop: identical tool calls already run this run
  let stall = 0 // consecutive no-progress tool results (see STALL_* above)
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // Stream the turn: text arrives as deltas (the store merges them into one bubble); finalMessage()
      // gives the settled content (incl. tool_use blocks) for the loop. Don't re-emit text afterward.
      const stream = client.messages.stream({ model, max_tokens: MAX_TOKENS, system, tools: ANTHROPIC_TOOLS, messages }, { signal })
      stream.on('text', (delta) => { emit({ type: 'text_delta', text: delta }); reply += delta })
      const res = await stream.finalMessage()
      messages.push({ role: 'assistant', content: res.content })
      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (res.stop_reason !== 'tool_use' || toolUses.length === 0) break
      const results: ContentBlockParam[] = []
      for (const tu of toolUses) {
        emit({ type: 'tool', name: tu.name, input: tu.input })
        const out = repeatGuard(seen, tu.name, tu.input) ?? safeCall(tu.name, tu.input as Record<string, unknown>, 'session:host')
        emit({ type: 'tool_result', name: tu.name, result: out })
        if (noProgress(out)) stall++
        else if (realProgress(out)) stall = 0
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: clampResult(withDirective(out, stall)) })
      }
      messages.push({ role: 'user', content: results })
      if (stall >= STALL_STOP_AT) { // looping — end the run with a fallback so it's not a silent spin
        if (!reply.trim()) { emit({ type: 'text_delta', text: STALL_FALLBACK }); reply += STALL_FALLBACK }
        break
      }
    }
    return { ok: true, reply }
  } catch (err) {
    if (signal.aborted) return { ok: true, reply } // user stopped — keep what streamed
    return { ok: false, reply, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── OpenAI-compatible (Chat Completions) — OpenRouter / OpenAI ──────────────────
interface OAMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

// ── OpenRouter reasoning-capability cache ────────────────────────────────────
// Whether a model supports `reasoning` (CoT-before-answer) is per-MODEL config, NOT a per-request decision. We
// fetch OpenRouter's model list ONCE and memoize it (24h TTL); the hot path is then an O(1) lookup, no network.
// Sending `reasoning` to a model that lacks it is harmless — OpenRouter drops unsupported params — so a cold or
// stale cache can never break a call; the cache only lets us gate cleanly (and later adapt the prompt).
const CAPS_TTL_MS = 24 * 60 * 60 * 1000
let capsCache: { at: number; caps: Map<string, Set<string>> } | null = null
async function modelSupports(baseUrl: string, apiKey: string, model: string, param: string): Promise<boolean> {
  if (!/openrouter/i.test(baseUrl)) return false // the capability list is OpenRouter's; direct OpenAI/others → skip
  if (!capsCache || Date.now() - capsCache.at >= CAPS_TTL_MS) {
    const caps = new Map<string, Set<string>>()
    try {
      const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
      const json = (await res.json()) as { data?: { id: string; supported_parameters?: string[] }[] }
      for (const m of json.data ?? []) caps.set(m.id, new Set(m.supported_parameters ?? []))
    } catch { /* offline / unexpected shape → empty map; we simply won't send reasoning */ }
    capsCache = { at: Date.now(), caps }
  }
  return capsCache.caps.get(model)?.has(param) ?? false
}

export async function openaiRun(history: ChatMessage[], model: string, apiKey: string, baseUrl: string, emit: Emit, signal: AbortSignal, ctxNote: string): Promise<AgentRunResult> {
  const system = ctxNote ? `${SYSTEM_PROMPT}\n\n${ctxNote}` : SYSTEM_PROMPT
  const messages: OAMessage[] = [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.text }))]
  const seen = new Set<string>() // anti-loop: identical tool calls already run this run
  let stall = 0 // consecutive no-progress tool results (see STALL_* above)
  let reply = ''
  // Turn on CoT for models that support it (plan-then-act instead of speedrun). Resolved once (cached); harmless
  // on models that don't reason (OpenRouter drops the param). The plan-first line in SYSTEM_PROMPT covers the rest.
  const reasoning = (await modelSupports(baseUrl, apiKey, model, 'reasoning')) ? { effort: 'medium' as const } : undefined
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Novel Visual Studio' // OpenRouter attribution (ignored by OpenAI)
        },
        body: JSON.stringify({ model, messages, tools: OPENAI_TOOLS, tool_choice: 'auto', stream: true, ...(reasoning ? { reasoning } : {}) }),
        signal
      })
      if (!res.ok) return { ok: false, reply, error: `${res.status}: ${(await res.text()).slice(0, 300)}` }
      if (!res.body) return { ok: false, reply, error: 'no response body' }

      // Parse the SSE stream: emit text deltas live; assemble streamed tool_call fragments by index.
      let content = ''
      const calls: { id: string; name: string; args: string }[] = []
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let done = false
      while (!done) {
        const { value, done: d } = await reader.read()
        if (d) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') { done = true; break }
          let chunk: { choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] }
          try { chunk = JSON.parse(data) } catch { continue }
          const delta = chunk.choices?.[0]?.delta
          if (delta?.content) { content += delta.content; reply += delta.content; emit({ type: 'text_delta', text: delta.content }) }
          for (const tc of delta?.tool_calls ?? []) {
            const slot = (calls[tc.index ?? 0] ??= { id: '', name: '', args: '' })
            if (tc.id) slot.id = tc.id
            if (tc.function?.name) slot.name += tc.function.name
            if (tc.function?.arguments) slot.args += tc.function.arguments
          }
        }
      }

      const assistant: OAMessage = { role: 'assistant', content: content || null }
      if (calls.length) assistant.tool_calls = calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args } }))
      messages.push(assistant)
      if (calls.length === 0) break
      for (const c of calls) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(c.args || '{}') } catch { /* leave empty */ }
        emit({ type: 'tool', name: c.name, input: args })
        const out = repeatGuard(seen, c.name, args) ?? safeCall(c.name, args, 'session:host')
        emit({ type: 'tool_result', name: c.name, result: out })
        if (noProgress(out)) stall++
        else if (realProgress(out)) stall = 0
        messages.push({ role: 'tool', tool_call_id: c.id, content: clampResult(withDirective(out, stall)) })
      }
      if (stall >= STALL_STOP_AT) { // looping — end the run with a fallback so it's not a silent spin
        if (!reply.trim()) { emit({ type: 'text_delta', text: STALL_FALLBACK }); reply += STALL_FALLBACK }
        break
      }
    }
    return { ok: true, reply }
  } catch (err) {
    if (signal.aborted) return { ok: true, reply } // user stopped — keep what streamed
    return { ok: false, reply, error: err instanceof Error ? err.message : String(err) }
  }
}
