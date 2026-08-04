/**
 * Locks the POV default heuristic (decisions.md POV): an unset `pov` defaults to the scene's DOMINANT
 * SPEAKER — the cast member with the most dialogue lines. Surfaced in the Properties picker.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { dominantSpeaker } from '../src/renderer/lib/analysis/pov'

describe('dominantSpeaker — POV default = most-spoken cast member', () => {
  it('picks the highest line count', () => {
    expect(
      dominantSpeaker([
        { entityId: 'horatio', volume: 4 },
        { entityId: 'hamlet', volume: 9 },
        { entityId: 'marcellus', volume: 2 }
      ])
    ).toBe('hamlet')
  })

  it('first wins on a tie (lines must strictly exceed to replace)', () => {
    expect(dominantSpeaker([{ entityId: 'a', volume: 3 }, { entityId: 'b', volume: 3 }])).toBe('a')
  })

  it('ignores zero / undefined line counts', () => {
    expect(dominantSpeaker([{ entityId: 'a', volume: 0 }, { entityId: 'b' }])).toBeNull()
  })

  it('null when there is no spoken cast (all-narration scene)', () => {
    expect(dominantSpeaker([])).toBeNull()
  })
})
