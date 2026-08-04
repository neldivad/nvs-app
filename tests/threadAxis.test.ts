import { describe, it, expect } from 'vitest'
import { offAxisThreads } from '../src/renderer/lib/timeline/threadAxis'

const T = (id: string, beats: number): { id: string; beats: number } => ({ id, beats })

describe('threadAxis — offAxisThreads', () => {
  it('surfaces threads with beats but none on the active axis (a branch not on this view)', () => {
    const threads = [T('a', 3), T('b', 2), T('c', 0)]
    const onAxis = new Set(['a']) // only thread a has a beat on the active chart-sequence
    expect(offAxisThreads(threads, onAxis).map((t) => t.id)).toEqual(['b']) // b is off-branch; a is on; c has no beats
  })

  it('nothing off-axis when every thread is on the axis (e.g. the AUTO/all-scenes route)', () => {
    const threads = [T('a', 1), T('b', 2)]
    expect(offAxisThreads(threads, new Set(['a', 'b']))).toEqual([])
  })

  it('a 0-beat thread is never "off-branch" (degenerate, not on any branch)', () => {
    expect(offAxisThreads([T('x', 0)], new Set())).toEqual([])
  })
})
