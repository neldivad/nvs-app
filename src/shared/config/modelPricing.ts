/**
 * Model pricing reference — USD per 1M tokens, so the run-cost estimate uses REAL per-model prices instead of
 * one generic band (which made haiku and gemini-flash-lite both read "$0.59–7.0"). Two tiers:
 *   • EXACT — prices we're confident of (Anthropic's published rates, cached 2026-06). Update on model launches.
 *   • FAMILY — substring guesses for the long tail of OpenAI/Gemini/OpenRouter models we can't enumerate;
 *     returned with `approx: true` so the UI can mark them (≈). Edit these as you learn real numbers.
 * Plan connections aren't priced here — they bill against the subscription ("plan usage"), not per token.
 */
export interface ModelPrice {
  in: number // $ / 1M input tokens
  out: number // $ / 1M output tokens
}

/** Exact, published prices — keyed by the canonical model id (no provider prefix). */
const EXACT: Record<string, ModelPrice> = {
  // Anthropic (platform.claude.com/pricing, cached 2026-06)
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-fable-5': { in: 10, out: 50 }
}

/** Family fallbacks (substring, most-specific first) — rough, flagged approximate. Order matters: `flash-lite`
 *  before `flash`, `nano` before `mini`, specific before generic. */
const FAMILY: { needle: string; price: ModelPrice }[] = [
  { needle: 'flash-lite', price: { in: 0.1, out: 0.4 } },
  { needle: 'flash', price: { in: 0.15, out: 0.6 } },
  { needle: 'gemini', price: { in: 1.25, out: 5 } }, // pro / unspecified gemini
  { needle: 'nano', price: { in: 0.05, out: 0.4 } },
  { needle: 'mini', price: { in: 0.25, out: 2 } },
  { needle: 'haiku', price: { in: 1, out: 5 } },
  { needle: 'sonnet', price: { in: 3, out: 15 } },
  { needle: 'opus', price: { in: 5, out: 25 } },
  { needle: 'gpt', price: { in: 1.25, out: 10 } }
]

/** Normalize a model id: drop a `provider/` prefix (openrouter), lowercase. */
function canon(model: string): string {
  const slash = model.lastIndexOf('/')
  return (slash >= 0 ? model.slice(slash + 1) : model).trim().toLowerCase()
}

/**
 * Look up a model's price. Three outcomes:
 *   • EXACT match → a published price, `approx: false`.
 *   • FAMILY substring match (grounded in the model name, e.g. `…flash-lite…`) → a guess, `approx: true`.
 *   • No match at all (a model we've never heard of — zai, kimi, a brand-new or fictional id) → `price: null`.
 *     We do NOT fabricate a number for these; the UI shows "check pricing" instead of a made-up range.
 */
export function priceFor(model: string): { price: ModelPrice | null; approx: boolean } {
  const id = canon(model)
  const exact = EXACT[id]
  if (exact) return { price: exact, approx: false }
  const fam = FAMILY.find((f) => id.includes(f.needle))
  return fam ? { price: fam.price, approx: true } : { price: null, approx: false }
}
