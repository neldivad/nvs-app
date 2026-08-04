/**
 * Locks GRAMMAR v2 for custody topic pages (internal/secret-lifecycle.md) — the parse/normalize/serialize
 * contract every AI job and form save rides. Ported from the session driver (2026-07-09, 20 cases green).
 * The load-bearing behaviors: v1 verbs ALIAS (never error), `since` folds into `scene`, wiki-link who
 * tokens collapse to their target id, empty/comments-only fences are VALID empty ledgers, and the
 * canonical rewrite means apply-paths write normalized form (read-side forgiveness = safety net).
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { parseCustodyRecords, parseCustodyMarkdown, serializeCustodyBlock } from '../src/engine/content/custodyPages'

const fence = (body: string): string => '```custody\n' + body + '\n```\n'

describe('grammar v2 — the three verbs', () => {
  it('parses gain/lost/public clean', () => {
    const r = parseCustodyRecords(fence('- scene: s1\n  event: gain\n  who: [hamlet, audience]\n  note: "the ghost"\n- scene: s3\n  event: lost\n  who: [hamlet]\n- scene: s4\n  event: public'))
    expect(r.errors).toEqual([])
    expect(r.records.map((x) => x.event)).toEqual(['gain', 'lost', 'public'])
    expect(r.legacyItem).toBeFalsy()
  })

  it('rejects unknown verbs with the v2 vocabulary', () => {
    const r = parseCustodyRecords(fence('- scene: s1\n  event: reveals\n  who: [x]'))
    expect(r.errors.some((e) => e.includes('gain · lost · public'))).toBe(true)
  })

  it('gain requires who', () => {
    const r = parseCustodyRecords(fence('- scene: s1\n  event: gain'))
    expect(r.errors.some((e) => e.includes('gain needs who'))).toBe(true)
  })
})

describe('legacy v1 — accepted and normalized, never emitted', () => {
  it('aliases held-by/known-by → gain and forgotten-by → lost', () => {
    const r = parseCustodyRecords(fence('- scene: s1\n  event: held-by\n  who: [ceo]\n- scene: s2\n  event: known-by\n  who: [hr]\n- scene: s3\n  event: forgotten-by\n  who: [hr]'))
    expect(r.errors).toEqual([])
    expect(r.records.map((x) => x.event)).toEqual(['gain', 'gain', 'lost'])
    expect(r.legacyItem).toBe(true) // held-by seen → topic-kind inference signal
  })

  it('folds since into scene (the in-world moment wins)', () => {
    const r = parseCustodyRecords(fence('- scene: s5\n  event: known-by\n  who: [claudius]\n  since: start\n- scene: s6\n  event: known-by\n  who: [gertrude]\n  since: s2'))
    expect(r.records[0].scene).toBe('start')
    expect(r.records[1].scene).toBe('s2')
  })
})

describe('model-output forgiveness', () => {
  it('collapses wiki-link who tokens to the target id', () => {
    const r = parseCustodyRecords(fence('- scene: s1\n  event: gain\n  who: ["[Ophelia](ophelia)", audience]\n  note: "kept"'))
    expect(r.errors).toEqual([])
    expect(r.records[0].who).toEqual(['ophelia', 'audience'])
  })

  it('treats empty and comments-only fences as valid empty ledgers (the fresh-page seed)', () => {
    expect(parseCustodyRecords('```custody\n\n```\n').errors).toEqual([])
    expect(parseCustodyRecords('```custody\n# - scene: <scene-id>\n#   event: gain\n```\n').errors).toEqual([])
  })
})

describe('canonical form', () => {
  it('serialize emits v2 with no since; round-trips clean', () => {
    const r = parseCustodyRecords(fence('- scene: s5\n  event: known-by\n  who: [claudius]\n  since: start'))
    const block = serializeCustodyBlock(r.records)
    expect(block).not.toContain('since')
    const round = parseCustodyRecords(block)
    expect(round.errors).toEqual([])
    expect(round.records[0].scene).toBe('start')
  })

  it('parseCustodyMarkdown rewrites the fence canonically and keeps the prose', () => {
    const md = '## Truth\n\nprose stays\n\n' + fence('- scene: s5\n  event: known-by\n  who: ["[Ophelia](ophelia)"]\n  since: start')
    const r = parseCustodyMarkdown(md)
    expect(r.canonical).toContain('event: gain')
    expect(r.canonical).toContain('who: [ophelia]')
    expect(r.canonical).toContain('scene: start')
    expect(r.canonical).not.toContain('since')
    expect(r.canonical).toContain('prose stays')
  })

  it('a broken draft keeps canonical = input (the grammar gate refuses upstream)', () => {
    const r = parseCustodyMarkdown(fence('- scene: s1\n  event: nope\n  who: [x]'))
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.canonical).toContain('event: nope')
  })
})
