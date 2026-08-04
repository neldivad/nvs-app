/**
 * Locks lens D's projection (lib/custodyIrony — internal/relationship-rail.md §D): the pair-scoped
 * irony/arbitrage windows the Relationships rail's `irony` layer draws as tetris pixels. Ported from the
 * session driver (2026-07-09, 8 cases green). Load-bearing: the audience-fallback rule matches the
 * custody chart's, `public` truncates EVERY window, and arbitrage (opponent-ahead) is independent of
 * the reader.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { ironyTracks } from '../src/renderer/lib/analysis/custodyIrony'
import type { CustodyTopic } from '../src/shared/ipc'

const colOf = new Map([['s1', 0], ['s2', 1], ['s3', 2], ['s4', 3], ['s5', 4]])
const matches = (w: string, id: string): boolean => w.toLowerCase() === id

const topic = (records: CustodyTopic['records']): CustodyTopic => ({
  pageId: 'sec',
  name: 'The Secret',
  path: '/x/sec.md',
  topic: 'information',
  subject: null,
  errors: [],
  records
})

// mae learns s1 · reader learns s2 · ann learns s4
const base = [
  { scene: 's1', event: 'gain' as const, who: ['mae'], note: null },
  { scene: 's2', event: 'gain' as const, who: ['audience'], note: null },
  { scene: 's4', event: 'gain' as const, who: ['ann'], note: null }
]

describe('dramatic irony (reader-ahead) windows', () => {
  const [t] = ironyTracks([topic(base)], colOf, 4, 'mae', 'ann', matches)

  it('anchors: established at the first checkpoint, audience at the explicit gain', () => {
    expect(t.established).toBe(0)
    expect(t.audience).toBe(1)
  })

  it('no window for a character who learned BEFORE the reader', () => {
    expect(t.ironyA).toBeNull() // mae (s1) beat the reader (s2)
  })

  it('window spans [reader-learns .. they-learn) for the one behind', () => {
    expect(t.ironyB).toEqual({ from: 1, to: 2 }) // ann in the dark s2..s3
  })

  it('public truncates the window', () => {
    const [t2] = ironyTracks([topic([...base, { scene: 's3', event: 'public', who: [], note: null }])], colOf, 4, 'mae', 'ann', matches)
    expect(t2.ironyB).toEqual({ from: 1, to: 1 })
  })
})

describe('arbitrage (opponent-ahead) windows — independent of the reader', () => {
  const [t] = ironyTracks([topic(base)], colOf, 4, 'mae', 'ann', matches)

  it('the late learner carries the window from the early learner’s gain', () => {
    expect(t.arbB).toEqual({ from: 0, to: 2 }) // mae ahead of ann s1..s3
  })

  it('the early learner carries none', () => {
    expect(t.arbA).toBeNull()
  })

  it('public ends arbitrage too', () => {
    const [t2] = ironyTracks([topic([...base, { scene: 's3', event: 'public', who: [], note: null }])], colOf, 4, 'mae', 'ann', matches)
    expect(t2.arbB).toEqual({ from: 0, to: 1 })
  })
})

describe('scoping', () => {
  it('item topics are excluded — D is the knowledge lens', () => {
    expect(ironyTracks([{ ...topic(base), topic: 'item' }], colOf, 4, 'mae', 'ann', matches)).toEqual([])
  })

  it('topics the pair never touches (and never went public) are skipped', () => {
    const t3 = topic([{ scene: 's1', event: 'gain', who: ['claudius'], note: null }])
    expect(ironyTracks([t3], colOf, 4, 'mae', 'ann', matches)).toEqual([])
  })
})
