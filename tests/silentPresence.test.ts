/**
 * Locks the silent-presence merge (the prose-read room beyond speakers): names resolved to entity ids, minus
 * those already present, de-duped, source order kept; unresolved names dropped. Display-only enrichment.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { silentPresenceIds } from '../src/engine/analysis/silentPresence'

// A toy resolver: lowercased name/alias → id (mirrors the engine's entities-table nameToEid).
const resolve = (m: Record<string, string>) => (nm: string): string | undefined => m[nm.toLowerCase()]

describe('silentPresenceIds — present-but-silent additions', () => {
  const map = { king: 'king', queen: 'queen', gertrude: 'queen', hamlet: 'hamlet' }

  it('adds prose-cast members who are not already speakers', () => {
    expect(silentPresenceIds(['hamlet'], ['Hamlet', 'King', 'Queen'], resolve(map))).toEqual(['king', 'queen'])
  })

  it('drops names that resolve to no entity (no world page)', () => {
    expect(silentPresenceIds([], ['King', 'Ghost'], resolve(map))).toEqual(['king'])
  })

  it('resolves via aliases (Gertrude → queen)', () => {
    expect(silentPresenceIds([], ['Gertrude'], resolve(map))).toEqual(['queen'])
  })

  it('de-dupes when two names map to the same entity', () => {
    expect(silentPresenceIds([], ['Queen', 'Gertrude'], resolve(map))).toEqual(['queen'])
  })

  it('skips someone already present under an alias (no double-count)', () => {
    expect(silentPresenceIds(['queen'], ['Gertrude'], resolve(map))).toEqual([])
  })

  it('preserves source order of the prose cast', () => {
    expect(silentPresenceIds([], ['Queen', 'King', 'Hamlet'], resolve(map))).toEqual(['queen', 'king', 'hamlet'])
  })

  it('returns nothing for an empty cast list', () => {
    expect(silentPresenceIds(['hamlet'], [], resolve(map))).toEqual([])
  })
})
