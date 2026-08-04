/**
 * Corkboard agent read-shaping (skim → drill). Locks the three altitudes an agent sees: boardsOverview (map),
 * boardSkeleton (nodes + edges, NO note bodies), cardDetail (one card, full). The skeleton MUST NOT leak note text
 * — that's the whole point (freeform notes are the only unbounded surface). Pure functions, no Electron.
 */
import { describe, it, expect } from 'vitest'
import { boardsOverview, boardSkeleton, cardDetail } from '../src/engine/content/corkboard'
import type { CorkboardFile } from '../src/shared/ipc'

const FILE: CorkboardFile = {
  version: 1,
  activeId: 'b1',
  boards: [
    {
      id: 'b1',
      name: 'Main plan',
      cards: [
        { id: 'c1', x: 0, y: 0, title: 'Childe is a secret Fatui', color: '--facet-secret', notes: [{ id: 'n1', text: 'reveal in Liyue act 3\nseed earlier' }], refs: [{ kind: 'scene', id: '/abs/liyue/rex-lapis.md', label: 'Rex Lapis', pageKind: 'scene' }] },
        { id: 'c2', x: 10, y: 0, notes: [{ id: 'n2', text: 'the aftermath — Childe flees' }] }, // idea-only, no ref → unwritten intent
        { id: 'c3', x: 20, y: 0 } // empty orphan
      ],
      edges: [{ id: 'e1', source: 'c1', target: 'c2' }]
    },
    { id: 'b2', name: 'Scratch', cards: [], edges: [] }
  ]
}

describe('boardsOverview (the map)', () => {
  it('lists every board with counts + activeId, and no card content', () => {
    const o = boardsOverview(FILE) as { activeId?: string; boards: { id: string; name: string; cardCount: number; edgeCount: number }[] }
    expect(o.activeId).toBe('b1')
    expect(o.boards).toEqual([
      { id: 'b1', name: 'Main plan', cardCount: 3, edgeCount: 1 },
      { id: 'b2', name: 'Scratch', cardCount: 0, edgeCount: 0 }
    ])
    expect(JSON.stringify(o)).not.toContain('Fatui') // no titles/notes at the map level
  })
})

describe('boardSkeleton (skim: nodes + edges, no bodies)', () => {
  const sk = boardSkeleton(FILE, 'b1') as { nodes: { id: string; title: string; noteCount: number; degree: number; refs?: unknown[] }[]; edges: { source: string; target: string }[] }
  it('carries identity/degree/refs-as-chips but NEVER a note body', () => {
    const c1 = sk.nodes.find((n) => n.id === 'c1')!
    expect(c1.title).toBe('Childe is a secret Fatui')
    expect(c1.noteCount).toBe(1)
    expect(c1.degree).toBe(1)
    expect(c1.refs).toEqual([{ kind: 'scene', label: 'Rex Lapis' }]) // path dropped at skim
    expect(JSON.stringify(sk)).not.toContain('reveal in Liyue') // the note BODY must not appear
    expect(JSON.stringify(sk)).not.toContain('/abs/liyue') // nor the ref path
  })
  it('titles an untitled card from its first note line, and marks empty orphans', () => {
    expect(sk.nodes.find((n) => n.id === 'c2')!.title).toBe('the aftermath — Childe flees')
    expect(sk.nodes.find((n) => n.id === 'c3')!.title).toBe('(untitled)')
  })
  it('errors clearly on an unknown board id', () => {
    expect(boardSkeleton(FILE, 'nope')).toEqual({ error: expect.stringContaining('listBoards') })
  })
})

describe('cardDetail (drill: one card, full)', () => {
  it('returns every note body, refs WITH ids, and neighbor titles', () => {
    const d = cardDetail(FILE, 'b1', 'c1') as { notes: string[]; refs: { id: string }[]; neighbors: { id: string; title: string }[] }
    expect(d.notes).toEqual(['reveal in Liyue act 3\nseed earlier'])
    expect(d.refs[0].id).toBe('/abs/liyue/rex-lapis.md') // full path returned here so the agent can readScene it
    expect(d.neighbors).toEqual([{ id: 'c2', title: 'the aftermath — Childe flees' }])
  })
  it('errors clearly on an unknown card id', () => {
    expect(cardDetail(FILE, 'b1', 'nope')).toEqual({ error: expect.stringContaining('readBoard') })
  })
})
