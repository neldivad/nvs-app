/**
 * Warm Plan session — a single persistent Agent-SDK `query` in STREAMING-INPUT mode, kept alive across
 * background page-edit tasks so each task skips the `claude` subprocess cold-start (the dominant latency).
 *
 * Why one session (no multiplexing): the tasks queue runs SERIALIZED (cap 1), so there's only ever one
 * in-flight turn. We push one user message per task and read the generator until that turn's `result`.
 *
 * Safety: this is strictly an OPTIMIZATION behind the one-shot path. A failure (init timeout, dead
 * subprocess, a turn that errors) tears the session down and recreates it fresh on the NEXT task; only after
 * WARM_FAIL_LIMIT failures IN A ROW do we give up and fall back to one-shot for the rest of the app session.
 * A lone transient error must not doom a long batch — disabling on the FIRST error regressed 57-read jobs to
 * a cold one-shot (subprocess boot) PER read, which is the slow path this session exists to avoid.
 */
import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { pageAgentBaseSystem } from '@shared/config/agentCommands'
import { logIngestEvent } from './ingestTelemetry'

const INIT_TIMEOUT = 15_000 // health-check the subprocess on creation; if it doesn't init, disable warm
// Recycle budget — page edits are INDEPENDENT (each carries its full page), so prior turns are just dead
// weight in the conversation: more tokens re-processed every turn + context-limit risk. We keep the warm
// PROCESS but recreate it (one ~1s cold start) once context has accumulated past either bound, so cost
// stays flat no matter how many tasks run. The SDK can't clear a conversation without exiting the process.
// Env-tunable so a batch job can experiment with the boot-vs-history tradeoff without a rebuild: a bigger
// budget amortizes the subprocess boot over more reads (cheaper if boot dominates), a smaller one caps the
// history each turn re-processes (cheaper if re-processing dominates). Defaults suit interactive page edits.
const MAX_TURNS = Number(process.env.NVS_PLAN_MAX_TURNS) || 5 // recycle after this many edits on one session
const MAX_CHARS = Number(process.env.NVS_PLAN_MAX_CHARS) || 50_000 // …or once this much page text has piled into the conversation
const WARM_FAIL_LIMIT = 3 // consecutive warm-path failures before giving up on it (was: give up on the FIRST)

/** A hand-rolled async-iterable queue: the streaming-input channel we push task prompts into. */
function makeInput(): { iterable: AsyncIterable<SDKUserMessage>; push: (m: SDKUserMessage) => void; end: () => void } {
  const items: SDKUserMessage[] = []
  let waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  let ended = false
  return {
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<SDKUserMessage>> => {
          if (items.length) return Promise.resolve({ value: items.shift()!, done: false })
          if (ended) return Promise.resolve({ value: undefined as never, done: true })
          return new Promise((res) => (waiting = res))
        }
      })
    },
    push: (m) => {
      if (waiting) {
        const w = waiting
        waiting = null
        w({ value: m, done: false })
      } else items.push(m)
    },
    end: () => {
      ended = true
      if (waiting) {
        const w = waiting
        waiting = null
        w({ value: undefined as never, done: true })
      }
    }
  }
}

interface Pending {
  resolve: (text: string) => void
  reject: (err: Error) => void
  buffer: string
}

let session: { q: Query; input: ReturnType<typeof makeInput>; cwd: string; model: string; system: string; turns: number; chars: number } | null = null
let pending: Pending | null = null
let disabled = false // set once WARM_FAIL_LIMIT failures pile up in a row → caller falls back to one-shot
let consecutiveFailures = 0 // reset on any clean read; a lone transient error recycles the process, not the batch

function teardown(err?: Error): void {
  if (pending) {
    pending.reject(err ?? new Error('warm plan session closed'))
    pending = null
  }
  try {
    session?.input.end()
    void session?.q.return(undefined)
  } catch {
    /* best-effort */
  }
  session = null
}

/** A warm-path failure: drop the (possibly wedged) process so the NEXT read recreates it fresh. We only give
 *  up on the warm path entirely after WARM_FAIL_LIMIT in a row — one transient error must not send a whole
 *  batch to the slow cold one-shot path (that regression made 57-read jobs pay a subprocess boot per read).
 *  Returns null so THIS read falls back to one-shot while the batch stays warm. */
function markWarmFailure(): null {
  teardown()
  if (++consecutiveFailures >= WARM_FAIL_LIMIT) disabled = true
  return null
}

/** Drain the persistent generator, routing assistant text + the turn's `result` to the pending task. */
async function readLoop(q: Query): Promise<void> {
  try {
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        if (pending) for (const b of msg.message.content) if (b.type === 'text') pending.buffer += b.text
      } else if (msg.type === 'result') {
        const p = pending
        pending = null
        if (!p) continue
        if (msg.subtype === 'success') p.resolve(p.buffer || msg.result || '')
        else p.reject(new Error(`agent stopped: ${msg.subtype}`))
      }
    }
    teardown() // generator ended unexpectedly
  } catch (err) {
    teardown(err instanceof Error ? err : new Error(String(err)))
  }
}

async function ensureSession(cwd: string, model: string, system: string): Promise<void> {
  // Recreate if the project (cwd), model, OR system prompt changed — the session pins all three.
  if (session && (session.cwd !== cwd || session.model !== model || session.system !== system)) teardown()
  if (session) return
  const input = makeInput()
  const q = query({
    prompt: input.iterable,
    options: {
      ...(model ? { model } : {}),
      systemPrompt: system,
      tools: [], // pure text in / out — no tools
      permissionMode: 'bypassPermissions',
      settingSources: [],
      cwd
    }
  })
  void readLoop(q)
  // Confirm the subprocess actually came up before we trust it with a task. Time the boot — it's the cost the
  // whole warm path exists to amortize, so surfacing it is how we tune the boot-vs-history budget above.
  const t0 = Date.now()
  await Promise.race([
    q.initializationResult(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('warm plan init timed out')), INIT_TIMEOUT))
  ])
  logIngestEvent({ kind: 'boot', ms: Date.now() - t0, model, backend: 'plan' })
  session = { q, input, cwd, model, system, turns: 0, chars: 0 }
}

/**
 * Run one turn through the warm session under a given system prompt (page-edit OR scene-read). Returns the
 * raw model text, or `null` if the warm path is unavailable (disabled / failed) — the caller then does a
 * one-shot `query`. Each prompt is self-contained; switching system prompt recycles the session.
 */
// A stuck subprocess turn must FAIL, not hang a step forever: past this bound the session is torn down
// (rejecting the turn), the warm path recycles, and the caller falls back to a one-shot. 10min (author's
// ruling 2026-07-17): real plan turns run right up to ~3min, so 180s was killing LEGITIMATE reads — the
// watchdog exists to catch wedged subprocesses, not slow-but-working ones.
const TURN_TIMEOUT = Number(process.env.NVS_PLAN_TURN_TIMEOUT ?? 600_000)

// The plan host is ONE subprocess — turns are strictly serial. Concurrent readers (the runner fires a chapter's
// character + entity window reads TOGETHER) used to race the module singletons: both booted a session (double-boot),
// the second overwrote `pending`, and the first read's await was orphaned FOREVER (the hung "arcs · c1" step).
// This chain makes concurrent calls wait their turn instead.
let turnChain: Promise<unknown> = Promise.resolve()
export function runPlanComplete(system: string, prompt: string, model: string, cwd: string, signal: AbortSignal): Promise<string | null> {
  const run = turnChain.then(() => runPlanTurn(system, prompt, model, cwd, signal))
  turnChain = run.catch(() => {}) // the queue never breaks on a failed turn
  return run
}

async function runPlanTurn(system: string, prompt: string, model: string, cwd: string, signal: AbortSignal): Promise<string | null> {
  // Cancelled BEFORE booting anything: a stopped batch must not pay a subprocess boot per queued read (the
  // observed storm: Stop with 334 scenes queued → one ~1s boot/teardown per second until the queue drained).
  if (signal.aborted) throw new Error('cancelled')
  if (disabled) return null
  if (pending) return null // shouldn't happen (serialized) — be safe, let the caller one-shot it
  // Recycle before this turn if the session has accumulated too much context (bounds cost + limit risk).
  if (session && (session.turns >= MAX_TURNS || session.chars >= MAX_CHARS)) teardown()
  const rebooted = !session // this read pays a (re)boot vs reuses a warm process — surfaced in the timing log
  try {
    await ensureSession(cwd, model, system)
  } catch {
    return markWarmFailure()
  }
  const s = session
  if (!s) return markWarmFailure()

  const onAbort = (): void => {
    // Interrupt is best-effort — do NOT wait for the SDK to acknowledge. teardown() rejects the pending turn
    // IMMEDIATELY (an interrupted turn may never emit a `result` message, which left this await hanging forever —
    // the "Stop does nothing" bug) and recycles the session (an interrupted stream's state is unknown).
    void s.q.interrupt().catch(() => {})
    teardown(new Error('cancelled'))
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort)
  // Watchdog: a turn that outlives the bound is torn down (rejecting it) instead of hanging the step — the
  // caller sees a warm failure and falls back to the one-shot path.
  const watchdog = setTimeout(() => teardown(new Error(`plan turn timed out after ${Math.round(TURN_TIMEOUT / 1000)}s`)), TURN_TIMEOUT)
  try {
    if (signal.aborted) throw new Error('cancelled') // aborted before the turn started — don't send it
    s.turns += 1 // count the turn's context toward the recycle budget (even if it errors — it was sent)
    s.chars += prompt.length
    const t0 = Date.now()
    const text = await new Promise<string>((resolve, reject) => {
      pending = { resolve, reject, buffer: '' }
      s.input.push({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null })
    })
    consecutiveFailures = 0 // a clean read clears the transient-failure streak
    // Transport-layer telemetry: the step's own event (kind: 'scene' etc) records the work; this records what
    // the plan host cost to deliver it — warm reuse vs a reboot is the difference between two different bugs.
    logIngestEvent({ kind: 'plan-turn', ms: Date.now() - t0, model, backend: 'plan', warm: !rebooted, promptChars: prompt.length, responseChars: text.length, status: 'ok', note: `turn ${s.turns}/${MAX_TURNS}` })
    return text
  } catch (err) {
    // A turn-level failure (interrupt aside) recycles the warm path but does NOT disable it on the first error
    // (that sent whole batches to the slow one-shot path). markWarmFailure recreates fresh next read, and only
    // gives up after WARM_FAIL_LIMIT in a row.
    if (!signal.aborted) return markWarmFailure()
    throw err // user cancellation — propagate so the task is marked cancelled
  } finally {
    clearTimeout(watchdog)
    signal.removeEventListener('abort', onAbort)
  }
}

/** Page-edit convenience: the warm session under the page-agent's (mode-agnostic) system prompt. */
export function runPlanEdit(prompt: string, model: string, cwd: string, signal: AbortSignal): Promise<string | null> {
  return runPlanComplete(pageAgentBaseSystem(), prompt, model, cwd, signal)
}

/** Drop the warm session (e.g. on project close). Next task lazily recreates it. */
export function closePlanSession(): void {
  teardown()
}
