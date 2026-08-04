/**
 * Locks the merge's canonical-pick (thread dedup, merge phase): the kept thread is the EARLIEST opener
 * (smallest linear_pos); a lexicographically-smaller id breaks ties so the choice is deterministic. The DB
 * repointing itself runs in the engine (better-sqlite3, not vitest-able) — verified separately on real data.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { pickCanonical } from '../src/engine/analysis/threadMerge'

describe('pickCanonical — the kept thread when folding duplicates', () => {
  it('picks the earliest opener (smallest position)', () => {
    expect(pickCanonical([{ id: 'thr:a4:ghost', pos: 40 }, { id: 'thr:a1:ghost', pos: 5 }])).toBe('thr:a1:ghost')
  })

  it('breaks a tie by lexicographically-smaller id (deterministic)', () => {
    expect(pickCanonical([{ id: 'thr:b:x', pos: 10 }, { id: 'thr:a:x', pos: 10 }])).toBe('thr:a:x')
  })

  it('a thread with no open beat (MAX position) never wins over a real opener', () => {
    expect(pickCanonical([{ id: 'thr:none', pos: Number.MAX_SAFE_INTEGER }, { id: 'thr:a1', pos: 3 }])).toBe('thr:a1')
  })

  it('returns null for an empty set', () => {
    expect(pickCanonical([])).toBeNull()
  })
})
