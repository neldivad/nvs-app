/**
 * Ingestion telemetry — one structured JSONL event per AI step, appended beside the work at
 * `.nvs/ingest-telemetry.jsonl`. This exists because diagnosing a slow/expensive run was pure guesswork:
 * a 120-chapter run looked like a "usage limit wall" when it was really a 40k-char prompt carrying 84%
 * context for a 3k-char scene. Ad-hoc console.logs found that in one run — so we make them official.
 *
 * What it answers, per step, without re-instrumenting: where did the time go (boot vs read), how big was
 * the prompt and WHICH PART owned it (the working-set audit), was the plan session warm or rebooted, and
 * what did the step cost. That's enough to tell a usage wall from a prompt-bloat problem from a slow model.
 *
 * Design notes:
 *   • JSONL, one event per line — appendable, greppable, and safe to truncate; never read back by the app.
 *   • LOCAL artifact (see nvsArtifacts): machine-specific performance data. Survives Reset (it's a
 *     diagnostic history, not derived from prose), never exported — a shared project shouldn't carry the
 *     author's machine timings.
 *   • Best-effort and non-fatal: telemetry must NEVER break an analysis run, so every write is try/caught.
 *   • Bounded: rotates at MAX_BYTES so a long-running project can't grow an unbounded log.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as engine from '@engine/index'

const MAX_BYTES = 5_000_000 // rotate past this (one .1 backup) — a diagnostic log must not grow forever

/** One ingestion step's telemetry. All fields optional but `kind` — different step kinds report different facts. */
export interface IngestTelemetryEvent {
  /** What happened. Step kinds (`scene`…`coherence`) report the WORK; `boot`/`plan-turn` report the plan
   *  TRANSPORT beneath it. Both matter: a slow scene is a different bug depending on whether its plan-turn
   *  was warm or paid a reboot, and that distinction is what a run's diagnosis turns on. */
  kind: 'scene' | 'window' | 'entity-window' | 'profile' | 'digest' | 'coherence' | 'continuity' | 'critique' | 'boot' | 'plan-turn'
  /** the unit/entity this step targeted (absent for `boot`) */
  targetId?: string
  /** wall time for the step (read ms, or boot ms for `kind: 'boot'`) */
  ms?: number
  model?: string
  /** which backend served it — plan (keyless subprocess) vs a keyed API changes the whole cost model */
  backend?: string
  /** plan host only: did this step reuse a warm subprocess, or pay a (re)boot? */
  warm?: boolean
  /** total prompt chars sent */
  promptChars?: number
  /** THE working-set audit: prompt chars attributed per part (dialogue/storySoFar/lore/threads/…). The
   *  ratio of `dialogue` to the rest is the health metric — context should not dwarf the scene. */
  parts?: Record<string, number>
  /** raw response chars (output size is what dominates latency on a small model) */
  responseChars?: number
  status?: 'ok' | 'failed' | 'skipped'
  note?: string
  /** On a `failed` step: the full error message + JS stack. This is the "not a black box" field — an
   *  unexpected crash (a bind overflow, a bad cast) is written here, in the auditable log, so a failure is
   *  diagnosable from the file alone without attaching a terminal to the main process. */
  error?: string
}

function logPath(): string | null {
  const root = engine.currentProject()?.root
  return root ? join(root, '.nvs', 'ingest-telemetry.jsonl') : null
}

// ── Per-run cost accumulator ─────────────────────────────────────────────────────────────────────────────
// A rough running total the Jobs dashboard reads (est tokens from chars — real usage-from-response is a
// follow-up). Fed by WORK events (a scene/window/profile read), NOT 'plan-turn' (the transport, which would
// double-count) or 'boot'. Reset at run start.
let totals = { calls: 0, inChars: 0, outChars: 0 }
export function resetIngestTotals(): void {
  totals = { calls: 0, inChars: 0, outChars: 0 }
}
const CHARS_PER_TOKEN = 3.5 // rough mixed English-JSON + CJK estimate; refine with real response usage later
export function ingestCost(): { inTokens: number; outTokens: number; calls: number } {
  return { inTokens: Math.round(totals.inChars / CHARS_PER_TOKEN), outTokens: Math.round(totals.outChars / CHARS_PER_TOKEN), calls: totals.calls }
}

/** Tail the last `limit` telemetry events for a work (Logs tab). Read-only, best-effort — returns [] if none. */
export function readTelemetry(workRoot: string, limit = 200): Record<string, unknown>[] {
  const p = join(workRoot, '.nvs', 'ingest-telemetry.jsonl')
  if (!existsSync(p)) return []
  try {
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>
      } catch {
        return { raw: l }
      }
    })
  } catch {
    return []
  }
}

/** Append one event. Best-effort: a telemetry failure must never surface as an analysis failure. */
export function logIngestEvent(evt: IngestTelemetryEvent): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...evt })
  // Accumulate cost from the WORK reads only (skip 'plan-turn' transport — it mirrors the scene read's chars —
  // and 'boot'), so a scene + its plan-turn don't double-count.
  if (evt.kind !== 'boot' && evt.kind !== 'plan-turn') {
    totals.calls += 1
    totals.inChars += evt.promptChars ?? 0
    totals.outChars += evt.responseChars ?? 0
  }
  // Always echo — headless runs are watched from a terminal, and this is what makes a long job legible.
  console.log(`[ingest] ${line}`)
  const p = logPath()
  if (!p) return // no project open (unit tests, early boot) — the console line is still useful
  try {
    mkdirSync(dirname(p), { recursive: true })
    if (existsSync(p) && statSync(p).size > MAX_BYTES) renameSync(p, `${p}.1`)
    appendFileSync(p, `${line}\n`, 'utf8')
  } catch {
    /* telemetry is never fatal */
  }
}
