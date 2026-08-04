/**
 * Pre-run estimate model (renderer/config = UI-only) — turns a plan preview + a connection into an HONEST
 * time/cost RANGE for the run dialog. Everything here is calibrated from measured telemetry (Three Kingdoms
 * 2026-07-17: plan+sonnet emits at ~25 tok/s, a full scene extraction is ~5-7.5k chars in / 4-8k chars out,
 * strictly serial) — but chapters vary and providers vary, so we always show a RANGE, never a number.
 *
 * When the project's own telemetry has scene timings for the same transport, the measured average replaces
 * the default midpoint — estimates get sharper the more you run.
 */
import type { AiProviderType } from '@shared/config/aiProviders'
import type { AnalysisDepth, IngestPreview } from '@shared/ipc'
import { priceFor } from '@shared/config/modelPricing'

export interface RunEstimate {
  timeLoMs: number
  timeHiMs: number
  /** USD range for metered APIs; null on plan (subscription usage, not a bill). */
  costLo: number | null
  costHi: number | null
  /** true when the cost used a family/generic price guess (not an exact published rate) — UI marks it ≈. */
  approx: boolean
}

// Per-call seconds by transport (midpoints; the range spread below widens them). Plan is one warm subprocess
// — every step serializes through it; APIs run the runner's pool (3 concurrent) and answer far faster.
const CALL_SEC = {
  plan: { scene: 100, skim: 30, rollup: 35, concurrency: 1 },
  api: { scene: 18, skim: 7, rollup: 10, concurrency: 3 }
}
const SPREAD = { lo: 0.6, hi: 1.6 } // honest uncertainty band around the midpoint

// Token volume per call (measured chars ÷ ~3.5 chars/token). Skim trims BOTH sides: the light contract cuts
// output ~5x and drops the things/lore grounding from the input.
const CALL_TOKENS = {
  scene: { in: 1900, out: 1900 },
  skim: { in: 1200, out: 350 },
  rollup: { in: 1300, out: 700 }
}
/** Split a preview into the two cost classes: serial-ish scene reads vs pooled rollups. */
function shape(preview: IngestPreview): { scenes: number; rollups: number } {
  const scenes = preview.counts.scene ?? 0
  return { scenes, rollups: preview.total - scenes }
}

export function estimateRun(preview: IngestPreview, connType: AiProviderType, model: string, depth: AnalysisDepth, measuredSceneMs?: number | null): RunEstimate {
  const isPlan = connType === 'plan'
  const c = isPlan ? CALL_SEC.plan : CALL_SEC.api
  const { scenes, rollups } = shape(preview)

  // Midpoint seconds — measured telemetry (same transport) beats the default when we have it.
  let sceneSec = depth === 'skim' ? c.skim : c.scene
  if (measuredSceneMs && depth === 'full') sceneSec = measuredSceneMs / 1000
  if (measuredSceneMs && depth === 'skim') sceneSec = (measuredSceneMs / 1000) * 0.3 // skim ≈ 30% of a measured full read
  const midSec = scenes * sceneSec + (rollups * c.rollup) / c.concurrency

  // Cost: plan runs on the subscription — no bill to estimate.
  if (isPlan) return { timeLoMs: midSec * SPREAD.lo * 1000, timeHiMs: midSec * SPREAD.hi * 1000, costLo: null, costHi: null, approx: false }

  const t = depth === 'skim' ? CALL_TOKENS.skim : CALL_TOKENS.scene
  const inTok = scenes * t.in + rollups * CALL_TOKENS.rollup.in
  const outTok = scenes * t.out + rollups * CALL_TOKENS.rollup.out
  // Real per-model price (modelPricing) instead of one generic band; the range is the SAME output-volume
  // uncertainty (SPREAD) applied to a KNOWN price, so haiku ≠ opus ≠ gemini-flash-lite.
  const { price, approx } = priceFor(model)
  const timeLoMs = midSec * SPREAD.lo * 1000
  const timeHiMs = midSec * SPREAD.hi * 1000
  // Unknown model (no exact or family match) → no cost. We do NOT fabricate a number; the UI says "check
  // pricing". Distinguished from plan (also null cost) by the connType at the call site.
  if (!price) return { timeLoMs, timeHiMs, costLo: null, costHi: null, approx: false }
  const base = (inTok * price.in + outTok * price.out) / 1e6
  return { timeLoMs, timeHiMs, costLo: base * SPREAD.lo, costHi: base * SPREAD.hi, approx }
}

/** "2h 15m", "18 min", "45s" — the dialog's duration vocabulary. */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
}

/** "$0.60–2.40" (rounded to keep it readable) or null for plan connections. */
export function fmtCostRange(lo: number | null, hi: number | null): string | null {
  if (lo == null || hi == null) return null
  const f = (v: number): string => (v < 1 ? `$${v.toFixed(2)}` : v < 10 ? `$${v.toFixed(1)}` : `$${Math.round(v)}`)
  return `${f(lo)}–${f(hi).slice(1)}`
}
