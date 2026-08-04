/**
 * Locks the small CONTRACT functions behind recent decisions, so a refactor can't silently flip them:
 *   • defaultPhase  — the "missing phase = canon for scenes, draft for world" rule (the canon-status drift fix)
 *   • slugify       — scene/world id generation (handles the dupe/special-char/spacing cases)
 *   • uniqueId      — work-wide id disambiguation (backs the scene_id guarantee, D2)
 *   • provenanceNote — the AI-authorship stamp folded into generation edits
 * See decisions.md (D2) + internal/pending.md.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { defaultPhase, slugify, defaultFrontmatter, groupFields, SCENE_SCHEMA } from '../src/renderer/config/worldSchema'
import { provenanceNote } from '../src/shared/config/agentCommands'
import { uniqueId } from '../src/engine/content/storyTree'

describe('defaultPhase — the implicit phase when frontmatter omits it', () => {
  it('a SCENE with no phase is CANON (the analysis gate reads it)', () => {
    expect(defaultPhase('scene')).toBe('canon')
  })
  it('a WORLD page with no phase is DRAFT (not canon-gated)', () => {
    for (const k of ['character', 'location', 'item', 'lore']) expect(defaultPhase(k)).toBe('draft')
  })
})

describe('slugify — id generation from a title', () => {
  it('lowercases + hyphenates words', () => {
    expect(slugify('A Room in the Castle')).toBe('a-room-in-the-castle')
  })
  it('collapses special chars + spacing, trims edges', () => {
    expect(slugify("  The Platform!! (cold) ")).toBe('the-platform-cold')
    expect(slugify('Elsinore — A platform')).toBe('elsinore-a-platform')
  })
})

describe('uniqueId — work-wide disambiguation (the scene_id guarantee)', () => {
  it('returns the base when free', () => {
    expect(uniqueId('the-platform', new Set())).toBe('the-platform')
  })
  it('appends -2, -3, … on collision', () => {
    expect(uniqueId('the-platform', new Set(['the-platform']))).toBe('the-platform-2')
    expect(uniqueId('the-platform', new Set(['the-platform', 'the-platform-2']))).toBe('the-platform-3')
  })
})

describe('defaultFrontmatter — a new world page seeds as draft', () => {
  it('carries id + name + phase:draft', () => {
    expect(defaultFrontmatter('see-yi-oh', 'See Yi Oh')).toEqual({ id: 'see-yi-oh', name: 'See Yi Oh', phase: 'draft' })
  })
})

describe('scene schema grouping — relation tags demoted to "Cross-refs", POV stays a Scene field', () => {
  const groups = groupFields(SCENE_SCHEMA.fields)
  it('the relation tags are grouped LAST under "Cross-refs" (not analysis inputs)', () => {
    const last = groups[groups.length - 1]
    expect(last.group).toBe('Cross-refs')
    expect(last.fields.map((f) => f.key)).toEqual(['characters_present', 'location', 'items'])
  })
  it('POV is a prominent Scene field (it IS an analysis input)', () => {
    const scene = groups.find((g) => g.group === 'Scene')
    expect(scene?.fields.map((f) => f.key)).toContain('pov')
  })
})

describe('provenanceNote — the AI-authorship stamp (generation edits only)', () => {
  const at = new Date('2026-06-29T12:00:00')
  it('append → a blockquote noting an AI-DRAFTED section', () => {
    const n = provenanceNote('append', at)
    expect(n.startsWith('> 🤖')).toBe(true)
    expect(n).toContain('AI-drafted this section')
    expect(n).toContain('Review')
  })
  it('replace → a blockquote noting an AI-REWRITTEN page', () => {
    const n = provenanceNote('replace', at)
    expect(n.startsWith('> 🤖')).toBe(true)
    expect(n).toContain('AI-rewrote this page')
  })
})
