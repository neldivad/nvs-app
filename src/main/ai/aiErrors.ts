/**
 * Classifying AI-call failures so the runner can tell three things apart instead of churning 20 scenes that
 * all fail identically on a dead key:
 *   transient (rate / overloaded / network) → retry with backoff;
 *   fatal     (credits / auth / session limit) → STOP the whole run with a clear message;
 *   unknown   (e.g. unparseable JSON, an odd 4xx) → fail just that step, the run continues.
 * The classifier reads an HTTP status when present, else sniffs the message — covering the Anthropic SDK
 * (errors carry `.status`), the OpenAI-compatible fetch path ("429: …" messages), and Claude Code sessions.
 */
export type AiFailureKind = 'rate' | 'overloaded' | 'network' | 'credits' | 'auth' | 'session' | 'unknown'

export class AiError extends Error {
  kind: AiFailureKind
  fatal: boolean // stop the whole run
  transient: boolean // safe to retry with backoff
  userMessage: string // the friendly line shown to the author
  constructor(kind: AiFailureKind, userMessage: string, opts: { fatal?: boolean; transient?: boolean } = {}) {
    super(userMessage)
    this.name = 'AiError'
    this.kind = kind
    this.userMessage = userMessage
    this.fatal = opts.fatal ?? false
    this.transient = opts.transient ?? false
  }
}

function msgOf(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message ?? '')
  return String(e)
}

function statusOf(e: unknown): number | null {
  if (e && typeof e === 'object' && 'status' in e) {
    const s = (e as { status: unknown }).status
    if (typeof s === 'number') return s
  }
  const m = msgOf(e).match(/\b(4\d\d|5\d\d)\b/) // openaiText throws "<status>: <body>"
  return m ? Number(m[1]) : null
}

/** Map any thrown AI error to a classified AiError (already-classified ones pass through unchanged). */
export function classifyAi(e: unknown): AiError {
  if (e instanceof AiError) return e
  const low = msgOf(e).toLowerCase()
  const status = statusOf(e)

  // Fatal — billing / quota
  if (status === 402 || /credit balance|insufficient.*(credit|quota|fund)|\bquota\b|billing|payment required/.test(low))
    return new AiError('credits', 'Out of credits or quota — add credits, or switch to another connection.', { fatal: true })
  // Fatal — auth / bad key
  if (status === 401 || status === 403 || /unauthorized|invalid.*api.?key|authentication|forbidden/.test(low))
    return new AiError('auth', 'Authentication failed — check this connection’s API key.', { fatal: true })
  // Fatal — Claude Code session / usage limit
  if (/usage limit|session limit|reached your .*limit|limit reached/.test(low))
    return new AiError('session', 'Claude Code usage/session limit reached — wait, or switch to an API key.', { fatal: true })
  // Transient — rate limited
  if (status === 429 || /rate.?limit|too many requests/.test(low))
    return new AiError('rate', 'Rate limited — pausing briefly, then retrying.', { transient: true })
  // Transient — overloaded / unavailable
  if (status === 529 || status === 503 || /overloaded|service unavailable|temporarily unavailable/.test(low))
    return new AiError('overloaded', 'The model is overloaded — retrying.', { transient: true })
  // Transient — network blip
  if (/fetch failed|econnreset|etimedout|socket hang up|enotfound|network error/.test(low))
    return new AiError('network', 'Network error — retrying.', { transient: true })
  // Unknown — fail just this step (parse error, odd 4xx); the run keeps going.
  // An 'unknown' here is very often NOT an AI failure at all but a local crash (a better-sqlite3 binding
  // error, a bad cast) surfacing through the same catch. Callers keep only `.message`, which for SQLite
  // errors names no table or statement ("Too many parameter values were provided") and is unlocatable.
  // Log the STACK once, here, so the next occurrence points at a file and line.
  if (!(e instanceof AiError) && e instanceof Error && e.stack) {
    console.error('[nvs] unclassified step failure — full stack:\n', e.stack)
  }
  return new AiError('unknown', msgOf(e) || 'AI call failed', {})
}
