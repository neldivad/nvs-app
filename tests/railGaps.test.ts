/**
 * Locks the rail-gap helper (ghost-node chapters): the chapters strictly between two events on a timeline,
 * in story order, symmetric, and empty when adjacent / same / unknown — so gaps only appear INSIDE a span.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { chaptersBetween, buildStations } from '../src/renderer/lib/timeline/railGaps'

const KEYS = ['c1', 'c2', 'c3', 'c4', 'c5']

describe('chaptersBetween — empty chapters between two rail events', () => {
  it('returns the interior chapters in story order', () => {
    expect(chaptersBetween(KEYS, 'c1', 'c4')).toEqual(['c2', 'c3'])
  })

  it('is symmetric (display order does not matter)', () => {
    expect(chaptersBetween(KEYS, 'c4', 'c1')).toEqual(['c2', 'c3'])
  })

  it('returns [] for adjacent chapters (no gap)', () => {
    expect(chaptersBetween(KEYS, 'c2', 'c3')).toEqual([])
  })

  it('returns [] for the same chapter (two events in one chapter)', () => {
    expect(chaptersBetween(KEYS, 'c3', 'c3')).toEqual([])
  })

  it('returns [] when either key is unknown or missing', () => {
    expect(chaptersBetween(KEYS, 'c1', 'cX')).toEqual([])
    expect(chaptersBetween(KEYS, undefined, 'c3')).toEqual([])
  })
})

describe('buildStations — chapter stations with quiet fills', () => {
  type Ev = { ch: string; action: string }
  const ch = (e: Ev): string => e.ch
  const term = (e: Ev): boolean => e.action === 'resolve'

  it('groups consecutive same-chapter items into one station', () => {
    const evs: Ev[] = [{ ch: 'c1', action: 'open' }, { ch: 'c1', action: 'advance' }]
    const st = buildStations(evs, ch, KEYS, new Set(['c1']), false, term)
    expect(st).toHaveLength(1)
    expect(st[0]).toMatchObject({ key: 'c1', quiet: false, items: evs })
  })

  it('inserts hollow quiet stations for the chapters between events', () => {
    const evs: Ev[] = [{ ch: 'c1', action: 'open' }, { ch: 'c4', action: 'advance' }]
    const st = buildStations(evs, ch, KEYS, new Set(['c1', 'c4']), false, term)
    expect(st.map((s) => [s.key, s.quiet])).toEqual([['c1', false], ['c2', true], ['c3', true], ['c4', false]])
  })

  it('does NOT ghost a chapter that the timeline touches elsewhere (occupied)', () => {
    const evs: Ev[] = [{ ch: 'c1', action: 'open' }, { ch: 'c3', action: 'advance' }]
    const st = buildStations(evs, ch, KEYS, new Set(['c1', 'c2', 'c3']), false, term) // c2 occupied (filtered out)
    expect(st.map((s) => s.key)).toEqual(['c1', 'c3']) // no quiet c2
  })

  it('marks the closing station terminal', () => {
    const evs: Ev[] = [{ ch: 'c1', action: 'open' }, { ch: 'c2', action: 'resolve' }]
    const st = buildStations(evs, ch, KEYS, new Set(['c1', 'c2']), false, term)
    expect(st.find((s) => s.key === 'c2')?.terminal).toBe(true)
    expect(st.find((s) => s.key === 'c1')?.terminal).toBe(false)
  })

  it('reverses quiet fills when descending (latest-first)', () => {
    const evs: Ev[] = [{ ch: 'c4', action: 'advance' }, { ch: 'c1', action: 'open' }]
    const st = buildStations(evs, ch, KEYS, new Set(['c1', 'c4']), true, term)
    expect(st.map((s) => s.key)).toEqual(['c4', 'c3', 'c2', 'c1'])
  })
})
