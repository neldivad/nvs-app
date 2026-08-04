/**
 * Unit tests for the page-agent prompt builder — locks in the dynamic context wiring:
 *   • scenes get the work's cast (as ALL-CAPS cues) + locations + the scene Fountain format;
 *   • world pages get their kind's canonical `## sections`, read from the SHARED schema (no mirror).
 * Run with: npm test
 */
import { describe, it, expect } from 'vitest'
import { buildPagePrompt, worldSectionsBlock, canonBlock } from '@shared/config/agentCommands'
import { WORLD_SECTIONS, sectionHeadings } from '@shared/config/worldSections'

describe('buildPagePrompt — scene', () => {
  const out = buildPagePrompt({
    pageText: 'SEE YI OH\nCan people see the slide?',
    instruction: 'tighten the dialogue',
    mode: 'append',
    kind: 'scene',
    characters: [{ name: 'See Yi Oh', id: 'see-yi-oh' }, { name: 'Mr Arr', id: 'mr-arr' }],
    locations: [{ name: 'The Boardroom', id: 'the-boardroom' }]
  })

  it('frames it as a scene + carries the instruction', () => {
    expect(out.system).toContain('SCENE page')
    expect(out.user).toContain('tighten the dialogue')
  })

  it('injects the cast as ALL-CAPS speaker cues + the locations', () => {
    expect(out.user).toContain('SEE YI OH')
    expect(out.user).toContain('MR ARR')
    expect(out.user).toContain('The Boardroom')
  })

  it('does NOT leak world-page sections into a scene', () => {
    expect(out.user).not.toContain('## Profile')
  })
})

describe('buildPagePrompt — world page', () => {
  const out = buildPagePrompt({
    pageText: '## Profile\n\n- Role: assistant',
    instruction: 'scaffold the missing sections',
    mode: 'append',
    kind: 'character',
    characters: [{ name: 'See Yi Oh', id: 'see-yi-oh' }],
    locations: [],
  })

  it('frames it as a world page + lists the kind’s canonical sections', () => {
    expect(out.system).toContain('WORLD-BIBLE page')
    for (const heading of sectionHeadings('character')) {
      expect(out.user).toContain(`## ${heading}`)
    }
  })

  it('does NOT inject scene cast canon into a world page', () => {
    expect(out.user).not.toContain('SEE YI OH')
  })
})

describe('worldSectionsBlock — reads the single shared source', () => {
  it('matches WORLD_SECTIONS for each kind (no drift)', () => {
    for (const kind of Object.keys(WORLD_SECTIONS)) {
      const block = worldSectionsBlock(kind)
      for (const s of WORLD_SECTIONS[kind as keyof typeof WORLD_SECTIONS]) {
        expect(block).toContain(`## ${s.heading}`)
      }
    }
  })

  it('is empty for scenes and unknown kinds', () => {
    expect(worldSectionsBlock('scene')).toBe('')
    expect(worldSectionsBlock('nonsense')).toBe('')
  })
})

describe('canonBlock — scene only', () => {
  it('upper-cases character names into speaker cues', () => {
    expect(canonBlock('scene', ['See Yi Oh'], [])).toContain('SEE YI OH')
  })
  it('returns empty for non-scenes and empty works', () => {
    expect(canonBlock('character', ['See Yi Oh'], [])).toBe('')
    expect(canonBlock('scene', [], [])).toBe('')
  })
})
