import { describe, it, expect } from 'vitest'
import { serializeSession, parseSession, parseSessionMeta, normalizeLegacyChat } from '../src/engine/io/chatSerialize'
import type { ChatSession } from '../src/shared/ipc'

// The per-session `.jsonl` format is the on-disk chat store — a bad round-trip silently corrupts the author's
// history. These lock serialize↔parse fidelity and the legacy `chat.json` migration mapping.
const session = (over: Partial<ChatSession> = {}): ChatSession => ({
  id: 's1',
  title: 'A chat',
  createdAt: '2026-07-29T10:00:00.000Z',
  updatedAt: '2026-07-29T10:05:00.000Z',
  history: [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'hi there' }
  ],
  events: [
    { type: 'user', text: 'hello' },
    { type: 'text', text: 'hi there' },
    { type: 'tool', name: 'listScenes', input: { limit: 5 } }
  ] as ChatSession['events'],
  ...over
})

describe('chatSerialize — session round-trip', () => {
  it('serialize → parse reproduces the session exactly', () => {
    const s = session()
    const round = parseSession(serializeSession(s).join('\n') + '\n')
    expect(round).toEqual(s)
  })

  it('preserves an empty session (meta only, no history/events)', () => {
    const s = session({ history: [], events: [] })
    expect(parseSession(serializeSession(s).join('\n'))).toEqual(s)
  })

  it('keeps history and events as SEPARATE arrays (a user event never leaks into history)', () => {
    const round = parseSession(serializeSession(session()).join('\n'))!
    expect(round.history).toHaveLength(2) // user + assistant text pair (model context)
    expect(round.events).toHaveLength(3) // display transcript
  })

  it('tolerates a torn final line without losing prior content', () => {
    const good = serializeSession(session()).join('\n')
    const round = parseSession(good + '\n{"t":"event","e":{"type":"text","text":"trunc') // last line is invalid JSON
    expect(round?.history).toHaveLength(2)
    expect(round?.events).toHaveLength(3) // the corrupt trailing line is skipped, not fatal
  })

  it('returns null when there is no meta line', () => {
    expect(parseSession('{"t":"msg","role":"user","text":"orphan"}\n')).toBeNull()
  })

  it('parseSessionMeta reads only the header (for index rebuild)', () => {
    const meta = parseSessionMeta(serializeSession(session()).join('\n'))
    expect(meta).toEqual({ id: 's1', title: 'A chat', createdAt: '2026-07-29T10:00:00.000Z', updatedAt: '2026-07-29T10:05:00.000Z' })
  })
})

describe('normalizeLegacyChat — chat.json migration mapping', () => {
  const NOW = '2026-07-29T12:00:00.000Z'
  let n = 0
  const newId = (): string => `gen-${++n}`

  it('passes through the { sessions, activeId } shape', () => {
    const d = { sessions: [session({ id: 'a' }), session({ id: 'b' })], activeId: 'b' }
    const out = normalizeLegacyChat(d, newId, NOW)
    expect(out.sessions.map((s) => s.id)).toEqual(['a', 'b'])
    expect(out.activeId).toBe('b')
  })

  it('defaults activeId to the first session when absent/invalid', () => {
    const out = normalizeLegacyChat({ sessions: [session({ id: 'a' }), session({ id: 'b' })] }, newId, NOW)
    expect(out.activeId).toBe('a')
  })

  it('wraps the pre-sessions { history, events } shape into one minted session', () => {
    const out = normalizeLegacyChat({ history: [{ role: 'user', text: 'hey' }], events: [{ type: 'user', text: 'hey' }] }, newId, NOW)
    expect(out.sessions).toHaveLength(1)
    expect(out.sessions[0].id).toBe('gen-1')
    expect(out.sessions[0].createdAt).toBe(NOW)
    expect(out.sessions[0].history).toHaveLength(1)
    expect(out.activeId).toBe('gen-1')
  })

  it('yields an empty store for an unrecognized/empty file', () => {
    expect(normalizeLegacyChat({}, newId, NOW)).toEqual({ sessions: [], activeId: null })
  })
})
