import { describe, it, expect } from 'vitest'
import { nameToId, isCanonicalId } from '../src/shared/entityId'

// The names we invent per script — including the BILINGUAL forms authors actually type ("劉備 Liu Bei"), which
// is where the matching bug started. The test prints the settled id for each so we can eyeball them.
const CASES: { script: string; name: string }[] = [
  { script: 'Chinese',   name: '曹操' },
  { script: 'Chinese',   name: '劉備 Liu Bei' },      // bilingual — the real-world Three Kingdoms shape
  { script: 'Chinese',   name: '諸葛亮 Zhuge Liang' },
  { script: 'Japanese',  name: '山田太郎' },
  { script: 'Japanese',  name: 'さくら Sakura' },
  { script: 'Korean',    name: '김철수 Kim Cheol-su' },
  { script: 'French',    name: 'Émile Zola' },
  { script: 'French',    name: "Jeanne d'Arc" },
  { script: 'Russian',   name: 'Фёдор Достоевский' },
  { script: 'Arabic',    name: 'محمد بن سلمان' },
  { script: 'Hindi',     name: 'नरेंद्र मोदी' },
  { script: 'Mixed',     name: '  The   Ring! (of Power) ' }
]

describe('nameToId — the settled ids across scripts', () => {
  it('prints name → id for every script (eyeball what we settle on)', () => {
    const rows = CASES.map((c) => ({ ...c, id: nameToId(c.name) }))
    // eslint-disable-next-line no-console
    console.table(rows.map((r) => ({ script: r.script, name: r.name, id: r.id })))
    for (const r of rows) expect(r.id.length).toBeGreaterThan(0)
  })

  it('every id is a canonical alphanumeric-utf8 slug (only letters/numbers/hyphen, no edge hyphens)', () => {
    for (const c of CASES) {
      const id = nameToId(c.name)
      expect(id).toMatch(/^[\p{L}\p{N}\p{M}]+(?:-[\p{L}\p{N}\p{M}]+)*$/u) // letter/number/mark runs joined by single hyphens
      expect(id.startsWith('-') || id.endsWith('-')).toBe(false)
    }
  })

  it('is deterministic and IDEMPOTENT (re-slugging an id returns itself — safe to re-run on existing ids)', () => {
    for (const c of CASES) {
      const id = nameToId(c.name)
      expect(nameToId(id)).toBe(id)
      expect(isCanonicalId(id)).toBe(true)
    }
  })

  it('keeps the script faithful (a Chinese name yields a Chinese id, not a lossy transliteration)', () => {
    expect(nameToId('曹操')).toBe('曹操')
    expect(nameToId('劉備 Liu Bei')).toBe('劉備-liu-bei') // bilingual → BOTH scripts survive in the id
    expect(nameToId('Фёдор Достоевский')).toBe('фёдор-достоевский')
    expect(nameToId('محمد بن سلمان')).toBe('محمد-بن-سلمان')
    expect(nameToId('नरेंद्र मोदी')).toBe('नरेंद्र-मोदी') // Devanagari syllables stay whole (marks kept), not "नर-द-र-म-द"
  })

  it('collapses punctuation/whitespace and lowercases Latin', () => {
    expect(nameToId('  The   Ring! (of Power) ')).toBe('the-ring-of-power')
    expect(nameToId('Émile Zola')).toBe('émile-zola') // accents are letters → kept (utf-8 alphanumeric)
    expect(nameToId("Jeanne d'Arc")).toBe('jeanne-d-arc')
  })
})
