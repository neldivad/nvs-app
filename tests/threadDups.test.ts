/**
 * Locks the duplicate-thread detector (thread dedup, detector-only phase): threads sharing a slug-tail
 * across different opening-scene prefixes are flagged as likely the same promise; intentional `succeeds`
 * recasts are annotated, not hidden. No merge here — this only surfaces candidates.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { duplicateThreadGroups } from '../src/renderer/lib/analysis/threadDups'
import type { Thread } from '../src/shared/ipc'

const T = (id: string, slug: string, over: Partial<Thread> = {}): Thread => ({
  id, slug, title: null, description: '', type: 'thread', status: 'open',
  openedAt: null, closedAt: null, beats: 1, builtBy: null, resolutionCondition: null, succeeds: null, ...over
})

describe('duplicateThreadGroups — exact slug-tail collisions', () => {
  it('flags two umbrellas that share a slug (one promise, re-opened)', () => {
    const groups = duplicateThreadGroups([
      T('thr:a1-s1:ghost', 'ghost'),
      T('thr:a4-s2:ghost', 'ghost'),
      T('thr:a1-s1:layoff', 'layoff')
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].slug).toBe('ghost')
    expect(groups[0].threads.map((t) => t.id)).toEqual(['thr:a1-s1:ghost', 'thr:a4-s2:ghost'])
  })

  it('ignores unique slugs (no false positives on a clean story)', () => {
    expect(
      duplicateThreadGroups([T('thr:a1-s1:ghost', 'ghost'), T('thr:a1-s2:revenge', 'revenge')])
    ).toEqual([])
  })

  it('orders threads earliest-opener first (the natural canonical)', () => {
    const groups = duplicateThreadGroups([
      T('thr:a4-s2:ghost', 'ghost', { openedAt: 'A4·S2' }),
      T('thr:a1-s1:ghost', 'ghost', { openedAt: 'A1·S1' })
    ])
    expect(groups[0].threads.map((t) => t.openedAt)).toEqual(['A1·S1', 'A4·S2'])
  })

  it('annotates a succeeds-linked pair as an intentional recast (superseded=true)', () => {
    const groups = duplicateThreadGroups([
      T('thr:a1-s1:heir', 'heir'),
      T('thr:a4-s2:heir', 'heir', { succeeds: 'thr:a1-s1:heir' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].superseded).toBe(true)
  })

  it('leaves an accidental collision unmarked (superseded=false)', () => {
    const groups = duplicateThreadGroups([T('thr:a1-s1:heir', 'heir'), T('thr:a4-s2:heir', 'heir')])
    expect(groups[0].superseded).toBe(false)
  })

  it('sorts worst splits first (most threads), slug breaking ties', () => {
    const groups = duplicateThreadGroups([
      T('thr:a1:x', 'x'), T('thr:a2:x', 'x'),
      T('thr:a1:y', 'y'), T('thr:a2:y', 'y'), T('thr:a3:y', 'y')
    ])
    expect(groups.map((g) => g.slug)).toEqual(['y', 'x'])
  })

  it('skips threads with an empty slug', () => {
    expect(duplicateThreadGroups([T('thr:a1', ''), T('thr:a2', '')])).toEqual([])
  })
})
