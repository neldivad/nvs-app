import { describe, it, expect } from 'vitest'
import { slugId, uniqueId, isCanonicalId } from '../src/shared/contentId'

describe('slugId — the one canonical rule', () => {
  it('keeps combining marks (Devanagari stays whole, not shattered)', () => {
    expect(slugId('नरेंद्र मोदी')).toBe('नरेंद्र-मोदी')
  })
  it('bilingual keeps both scripts; punctuation collapses; latin lowercases', () => {
    expect(slugId('劉備 Liu Bei')).toBe('劉備-liu-bei')
    expect(slugId('  The   Ring! (of Power) ')).toBe('the-ring-of-power')
  })
  it('is idempotent (safe to re-run on an existing id)', () => {
    for (const n of ['劉備 Liu Bei', 'Émile Zola', 'नरेंद्र मोदी']) expect(slugId(slugId(n))).toBe(slugId(n))
    expect(isCanonicalId(slugId('劉備 Liu Bei'))).toBe(true)
  })
})

describe('uniqueId — collision disambiguation', () => {
  it('returns base when free, else base-2, base-3…', () => {
    const taken = new Set(['liu-bei'])
    expect(uniqueId('cao-cao', taken)).toBe('cao-cao')
    expect(uniqueId('liu-bei', taken)).toBe('liu-bei-2')
    expect(uniqueId('liu-bei', new Set(['liu-bei', 'liu-bei-2']))).toBe('liu-bei-3')
  })
})
