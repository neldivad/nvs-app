/**
 * Pure (de)serialization for the per-session chat store — the `.jsonl` body format and the legacy-`chat.json`
 * normalization, kept out of the fs-bound engine so the round-trip fidelity (which silently corrupts chat
 * history if wrong) is unit-testable. The engine owns paths + fs; this owns the byte shape.
 *
 * A session file is line-delimited JSON: a `meta` line, then `msg` lines (history), then `event` lines.
 */
import type { AgentEvent, ChatMessage, ChatSession, ChatSessionMeta } from '@shared/ipc'

/** Serialize a session to `.jsonl` lines. `events` must already be slimmed/count-capped by the caller. */
export function serializeSession(session: ChatSession): string[] {
  return [
    JSON.stringify({ t: 'meta', id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt }),
    ...session.history.map((m) => JSON.stringify({ t: 'msg', role: m.role, text: m.text })),
    ...session.events.map((e) => JSON.stringify({ t: 'event', e }))
  ]
}

/** Parse a session file's text back into a session, or null if it carries no `meta` line. Skips blank/corrupt lines. */
export function parseSession(text: string): ChatSession | null {
  let meta: ChatSessionMeta | null = null
  const history: ChatMessage[] = []
  const events: AgentEvent[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    let o: { t?: string; id?: string; title?: string; createdAt?: string; updatedAt?: string; role?: ChatMessage['role']; text?: string; e?: AgentEvent }
    try {
      o = JSON.parse(line)
    } catch {
      continue // tolerate a torn last line / stray content
    }
    if (o.t === 'meta') meta = { id: o.id!, title: o.title!, createdAt: o.createdAt!, updatedAt: o.updatedAt! }
    else if (o.t === 'msg') history.push({ role: o.role!, text: o.text ?? '' })
    else if (o.t === 'event' && o.e) events.push(o.e)
  }
  return meta ? { ...meta, history, events } : null
}

/** Read just the `meta` (first non-blank line) of a session file — for rebuilding the index without loading bodies. */
export function parseSessionMeta(text: string): ChatSessionMeta | null {
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const o = JSON.parse(line)
      return o?.t === 'meta' ? { id: o.id, title: o.title, createdAt: o.createdAt, updatedAt: o.updatedAt } : null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Normalize a parsed legacy `chat.json` into sessions + activeId. Handles BOTH historical shapes: the
 * `{ sessions, activeId }` store and the pre-sessions `{ history, events }` single conversation. `newId`/`now`
 * are injected (no ambient Date/crypto) so the mapping is pure + testable.
 */
export function normalizeLegacyChat(d: unknown, newId: () => string, now: string): { sessions: ChatSession[]; activeId: string | null } {
  const obj = (d ?? {}) as { sessions?: unknown; activeId?: unknown; history?: unknown; events?: unknown }
  if (Array.isArray(obj.sessions)) {
    const sessions = obj.sessions as ChatSession[]
    return { sessions, activeId: typeof obj.activeId === 'string' ? obj.activeId : (sessions[0]?.id ?? null) }
  }
  if (Array.isArray(obj.history) || Array.isArray(obj.events)) {
    const s: ChatSession = { id: newId(), title: 'Chat', createdAt: now, updatedAt: now, history: (obj.history as ChatMessage[]) ?? [], events: (obj.events as AgentEvent[]) ?? [] }
    return { sessions: [s], activeId: s.id }
  }
  return { sessions: [], activeId: null }
}
