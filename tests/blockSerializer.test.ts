/**
 * Unit tests for the NVS Fountain dialect parser and serializer.
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest'
import { parseFountain, serializeFountain, extractSpeakers } from '../src/renderer/lib/fountain/blockSerializer'

// ── parseFountain ─────────────────────────────────────────────────────────────

describe('parseFountain', () => {
  it('parses narration', () => {
    const blocks = parseFountain('The boardroom was already cold.')
    expect(blocks).toEqual([{ kind: 'narration', text: 'The boardroom was already cold.' }])
  })

  it('parses a speech block', () => {
    const blocks = parseFountain('SEE YI OH\nCan people see the slide?')
    expect(blocks).toEqual([{ kind: 'speech', speaker: 'SEE YI OH', text: 'Can people see the slide?' }])
  })

  it('parses a thinking block via (THINKING) modifier', () => {
    const blocks = parseFountain('IN TERN (THINKING)\nWhy is there a slide.')
    expect(blocks).toEqual([{ kind: 'thinking', speaker: 'IN TERN', text: 'Why is there a slide.' }])
  })

  it('parses an action block (> prefix)', () => {
    const blocks = parseFountain('> Yi Oh clicks to the next slide.')
    expect(blocks).toEqual([{ kind: 'action', text: 'Yi Oh clicks to the next slide.' }])
  })

  it('parses a transition block (= prefix)', () => {
    const blocks = parseFountain('= Two weeks earlier.')
    expect(blocks).toEqual([{ kind: 'transition', text: 'Two weeks earlier.' }])
  })

  it('parses all 5 block types in sequence', () => {
    const body = [
      'The boardroom was cold.',
      '',
      'SEE YI OH',
      'Can people see the slide?',
      '',
      'IN TERN (THINKING)',
      'Why is there a slide.',
      '',
      '> Yi Oh clicks to the next slide.',
      '',
      '= Two weeks earlier.',
    ].join('\n')

    const blocks = parseFountain(body)
    expect(blocks.map((b) => b.kind)).toEqual([
      'narration', 'speech', 'thinking', 'action', 'transition',
    ])
  })

  it('handles multi-line dialogue', () => {
    const blocks = parseFountain('HUGH ARR\nI can see it.\nYeah, I see it.')
    expect(blocks).toEqual([
      { kind: 'speech', speaker: 'HUGH ARR', text: 'I can see it.\nYeah, I see it.' },
    ])
  })

  it('rejects single-char ALL CAPS lines as cues', () => {
    const blocks = parseFountain('I\nSomething')
    // "I" should not be a cue — treated as narration, "Something" as narration
    expect(blocks.every((b) => b.kind === 'narration')).toBe(true)
  })

  it('rejects mixed-case lines as cues', () => {
    const blocks = parseFountain('Mr See Yi Oh\nHello.')
    expect(blocks.map((b) => b.kind)).toEqual(['narration', 'narration'])
  })

  it('drops orphaned cues (cue with no following text)', () => {
    const blocks = parseFountain('SEE YI OH\n\nIN TERN\nHello.')
    // First cue is orphaned — dropped; second is valid
    expect(blocks).toEqual([{ kind: 'speech', speaker: 'IN TERN', text: 'Hello.' }])
  })

  it('handles @name shorthand', () => {
    const blocks = parseFountain('@see yi oh\nHello.')
    expect(blocks).toEqual([{ kind: 'speech', speaker: 'SEE YI OH', text: 'Hello.' }])
  })

  it('preserves inline bold/italic as raw text', () => {
    const blocks = parseFountain('The numbers looked **fine** then.')
    expect(blocks).toEqual([
      { kind: 'narration', text: 'The numbers looked **fine** then.' },
    ])
  })

  it('returns empty array for empty input', () => {
    expect(parseFountain('')).toEqual([])
    expect(parseFountain('\n\n\n')).toEqual([])
  })
})

// ── serializeFountain ─────────────────────────────────────────────────────────

describe('serializeFountain', () => {
  it('serializes speech', () => {
    expect(serializeFountain([{ kind: 'speech', speaker: 'SEE YI OH', text: 'Hello.' }]))
      .toBe('SEE YI OH\nHello.')
  })

  it('serializes thinking', () => {
    expect(serializeFountain([{ kind: 'thinking', speaker: 'IN TERN', text: 'Why.' }]))
      .toBe('IN TERN (THINKING)\nWhy.')
  })

  it('serializes action', () => {
    expect(serializeFountain([{ kind: 'action', text: 'She closes her laptop.' }]))
      .toBe('> She closes her laptop.')
  })

  it('serializes transition', () => {
    expect(serializeFountain([{ kind: 'transition', text: 'Two weeks earlier.' }]))
      .toBe('= Two weeks earlier.')
  })

  it('separates blocks with blank lines', () => {
    const result = serializeFountain([
      { kind: 'narration', text: 'It was cold.' },
      { kind: 'speech', speaker: 'SEE YI OH', text: 'Hello.' },
    ])
    expect(result).toBe('It was cold.\n\nSEE YI OH\nHello.')
  })

  it('uppercases speaker names on serialize', () => {
    expect(serializeFountain([{ kind: 'speech', speaker: 'see yi oh', text: 'Hi.' }]))
      .toBe('SEE YI OH\nHi.')
  })
})

// ── round-trip ────────────────────────────────────────────────────────────────

describe('round-trip', () => {
  const SCENE = [
    'The boardroom was already cold when Yi Oh arrived.',
    '',
    'SEE YI OH',
    'Can people see the slide? Just drop a yes in the chat.',
    '',
    'HUGH ARR',
    'I can see it. Yeah, I see it.',
    '',
    'IN TERN (THINKING)',
    'Why is there a slide. All-hands never has a slide.',
    '',
    '> Yi Oh clicks to the next slide. Nobody reacts.',
    '',
    '= Two weeks earlier.',
    '',
    'The numbers had looked **fine** then. *Everything* had looked fine.',
  ].join('\n')

  it('parse → serialize produces equivalent output', () => {
    const blocks = parseFountain(SCENE)
    const reserialized = serializeFountain(blocks)
    // Re-parsing the serialized output must yield the same block array
    expect(parseFountain(reserialized)).toEqual(blocks)
  })
})

// ── `## Section` labels (Beat / Scene) ────────────────────────────────────────
// They aren't a block kind — they parse as narration that happens to start with `##` (and render as a
// heading in Preview). The prompt now tells the agent to KEEP them; this guards that a reformat's output,
// once applied, round-trips so the section structure survives.

describe('section-heading labels', () => {
  it('parses a `## Beat` line as narration (verbatim text)', () => {
    expect(parseFountain('## Beat')).toEqual([{ kind: 'narration', text: '## Beat' }])
  })

  it('round-trips a scene with ## Beat / ## Scene labels unchanged', () => {
    const body = ['## Beat', '', 'The boardroom was cold.', '', '## Scene', '', 'SEE YI OH', 'Can people see the slide?'].join('\n')
    expect(serializeFountain(parseFountain(body))).toBe(body)
  })
})

// ── mood (speech cue parenthetical) ───────────────────────────────────────────

describe('mood on a speech cue', () => {
  it('parses a non-thinking parenthetical as the speech mood', () => {
    const [b] = parseFountain('CAO CAO (angry)\nWho dares?')
    expect(b).toMatchObject({ kind: 'speech', speaker: 'CAO CAO', mood: 'ANGRY', text: 'Who dares?' })
  })

  it('serializes the mood back into the cue', () => {
    const out = serializeFountain([{ kind: 'speech', speaker: 'cao cao', text: 'Who dares?', mood: 'ANGRY' }])
    expect(out).toBe('CAO CAO (ANGRY)\nWho dares?')
  })

  it('round-trips mood without loss (the block-editor data-loss bug)', () => {
    const body = 'CAO CAO (ANGRY)\nWho dares?'
    expect(serializeFountain(parseFountain(body))).toBe(body)
  })

  it('neutral speech has no parenthetical; thinking keeps its marker and carries no mood', () => {
    const blocks = parseFountain('LIU BEI\nPeace.\n\nGUAN YU (THINKING)\nRetreat.')
    expect(blocks[0]).toMatchObject({ kind: 'speech', speaker: 'LIU BEI' })
    expect('mood' in blocks[0]).toBe(false)
    expect(blocks[1]).toMatchObject({ kind: 'thinking', speaker: 'GUAN YU' })
    expect('mood' in blocks[1]).toBe(false)
  })
})

// ── extractSpeakers ───────────────────────────────────────────────────────────

describe('extractSpeakers', () => {
  it('returns unique speakers in document order', () => {
    const blocks = parseFountain(
      'SEE YI OH\nHello.\n\nHUGH ARR\nYeah.\n\nSEE YI OH\nThanks.'
    )
    expect(extractSpeakers(blocks)).toEqual(['SEE YI OH', 'HUGH ARR'])
  })

  it('includes thinking-block speakers', () => {
    const blocks = parseFountain('IN TERN (THINKING)\nWhy.')
    expect(extractSpeakers(blocks)).toEqual(['IN TERN'])
  })
})
