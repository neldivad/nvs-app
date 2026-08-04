/**
 * Locks evidence canonicalization (Phase B of the "canonical references" work, decisions.md D2): on write,
 * `writeTier` resolves every evidence ref to a real `narrative_units` unit-id and drops the unresolvable —
 * so `evidence_json` (the one ref the schema doesn't FK-enforce) can never persist garbage. This is the pure
 * core of that, extracted to `unitRefs.ts` so it's testable without the Electron-native DB.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { canonicalizeUnitRefs } from '../src/engine/content/unitRefs'

// A Hamlet-style unit set: scene unit-ids + chapter unit-ids (the prefixed/path form).
const units = [
  'hamlet-a1-s1',
  'hamlet-a1-s2',
  'hamlet-a5-s1',
  'c:chapters/001-act-i',
  'c:chapters/005-act-v',
  'c:act-i' // a different scheme's chapter id, to prove tail/colon matching
]

describe('canonicalizeUnitRefs — normalize evidence to canonical unit-ids, drop the rest', () => {
  it('keeps refs that are already real unit-ids', () => {
    expect(canonicalizeUnitRefs(units, ['hamlet-a1-s1', 'c:chapters/005-act-v'])).toEqual([
      'hamlet-a1-s1',
      'c:chapters/005-act-v'
    ])
  })

  it('resolves a BARE chapter name → the prefixed unit-id (the Hamlet evidence shape)', () => {
    expect(canonicalizeUnitRefs(units, ['005-act-v'])).toEqual(['c:chapters/005-act-v'])
    expect(canonicalizeUnitRefs(units, ['act-i'])).toEqual(['c:act-i'])
  })

  it('strips a "c:"/"s:" prefix when the bare form IS a unit-id', () => {
    // "s:hamlet-a1-s1" → bare "hamlet-a1-s1" exists
    expect(canonicalizeUnitRefs(units, ['s:hamlet-a1-s1'])).toEqual(['hamlet-a1-s1'])
  })

  it('DROPS unresolvable refs (no orphan evidence persisted)', () => {
    expect(canonicalizeUnitRefs(units, ['who-knows', 'hamlet-a1-s2', 'nope'])).toEqual(['hamlet-a1-s2'])
  })

  it('de-dupes and preserves order', () => {
    expect(canonicalizeUnitRefs(units, ['hamlet-a1-s1', '001-act-i', 'hamlet-a1-s1'])).toEqual([
      'hamlet-a1-s1',
      'c:chapters/001-act-i'
    ])
  })

  it('returns [] for empty / null / undefined', () => {
    expect(canonicalizeUnitRefs(units, [])).toEqual([])
    expect(canonicalizeUnitRefs(units, null)).toEqual([])
    expect(canonicalizeUnitRefs(units, undefined)).toEqual([])
  })

  it('stable-id world: a bare chapter NAME resolves via the unit TITLE (id carries no path anymore)', () => {
    // post folder-identity: chapter units are keyed c:<slug>-<hex>; the human name lives in `title`.
    const stable = [
      { id: 'hamlet-a1-s1' },
      { id: 'c:005-act-v-3fa2b1', title: '005-act-v' },
      { id: 'c:act-i-99cc00', title: 'Act I' }
    ]
    expect(canonicalizeUnitRefs(stable, ['005-act-v'])).toEqual(['c:005-act-v-3fa2b1'])
    expect(canonicalizeUnitRefs(stable, ['act i'])).toEqual(['c:act-i-99cc00']) // title match is case-insensitive
    expect(canonicalizeUnitRefs(stable, ['c:005-act-v'])).toEqual(['c:005-act-v-3fa2b1']) // prefixed producer ref
  })
})
