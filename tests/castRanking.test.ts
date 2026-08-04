import { describe, it, expect } from 'vitest'
import { castRanking } from '../src/renderer/lib/analysis/castRanking'

// three scenes: s1 {A,B}, s2 {A}, s3 {B,C} — lines vary
const scenes = {
  s1: { cast: [{ entityId: 'A', volume: 3 }, { entityId: 'B', volume: 2 }] },
  s2: { cast: [{ entityId: 'A', volume: 5 }] },
  s3: { cast: [{ entityId: 'B', volume: 1 }, { entityId: 'C', volume: 4 }] }
}

describe('castRanking (per-variant scoping)', () => {
  it('empty subset ranks over EVERY scene', () => {
    const { appearances } = castRanking(scenes, new Set())
    expect(appearances.get('A')).toBe(8) // 3 + 5
    expect(appearances.get('B')).toBe(3) // 2 + 1
    expect(appearances.get('C')).toBe(4)
  })

  it('a subset restricts the tally to its scenes', () => {
    const { appearances } = castRanking(scenes, new Set(['s1'])) // only s1
    expect(appearances.get('A')).toBe(3)
    expect(appearances.get('B')).toBe(2)
    expect(appearances.has('C')).toBe(false) // C only appears in s3, excluded
  })

  it('castByScene only includes subset scenes (drives coWith)', () => {
    const { castByScene } = castRanking(scenes, new Set(['s1', 's3']))
    expect(castByScene).toHaveLength(2) // s2 dropped
    const ids = castByScene.flatMap((c) => c.map((x) => x.id)).sort()
    expect(ids).toEqual(['A', 'B', 'B', 'C'])
  })

  it('missing lines default to 0', () => {
    const { appearances } = castRanking({ x: { cast: [{ entityId: 'Z' }] } }, new Set())
    expect(appearances.get('Z')).toBe(0)
  })
})
