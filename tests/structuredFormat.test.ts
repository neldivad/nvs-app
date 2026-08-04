/**
 * Tests for structuredFormat — the NVS↔nvs-parser interchange. Locks the beat grammar (5 kinds + cue mood),
 * the parse/render round-trip, and the JSON/CSV serializers so this side can't drift from `serialize.py`.
 */
import { describe, it, expect } from 'vitest'
import {
  parseBeats,
  renderBeats,
  toJson,
  toCsv,
  toSrt,
  type StructuredBeat,
  type StructuredProject
} from '../src/shared/structuredFormat'

describe('parseBeats', () => {
  it('classifies the five kinds', () => {
    const body = ['ALICE', 'Hello there.', '', 'BOB (THINKING)', 'I should run.', '', '> A door slams.', '', '= CUT TO:', '', 'The rain fell.'].join('\n')
    expect(parseBeats(body).map((b) => b.kind)).toEqual(['speech', 'thinking', 'action', 'transition', 'narration'])
  })

  it('carries a non-thinking parenthetical as mood, not the THINKING marker', () => {
    const beats = parseBeats('CAO CAO (angrily)\nWho dares?\n\nLIU BEI (THINKING)\nBest to retreat.')
    expect(beats[0]).toMatchObject({ speaker: 'CAO CAO', kind: 'speech', mood: 'ANGRILY', text: 'Who dares?' })
    expect(beats[1]).toMatchObject({ speaker: 'LIU BEI', kind: 'thinking', text: 'Best to retreat.' })
    expect(beats[1].mood).toBeUndefined() // THINKING is the mode, never a mood
  })

  it('indexes beats in reading order and skips --- separators', () => {
    const beats = parseBeats('ALICE\nOne.\n\n---\n\nBOB\nTwo.')
    expect(beats.map((b) => b.i)).toEqual([0, 1])
    expect(beats.map((b) => b.speaker)).toEqual(['ALICE', 'BOB'])
  })
})

describe('renderBeats ↔ parseBeats round-trip', () => {
  it('re-parses to the same beats (mood preserved)', () => {
    const beats: StructuredBeat[] = [
      { i: 0, speaker: 'CAO CAO', kind: 'speech', mood: 'ANGRILY', text: 'Who dares?' },
      { i: 1, speaker: 'LIU BEI', kind: 'thinking', text: 'Best to retreat.' },
      { i: 2, speaker: '', kind: 'action', text: 'A door slams.' },
      { i: 3, speaker: '', kind: 'transition', text: 'CUT TO:' },
      { i: 4, speaker: '', kind: 'narration', text: 'The rain fell.' }
    ]
    expect(parseBeats(renderBeats(beats))).toEqual(beats)
  })
})

const PROJECT: StructuredProject = {
  meta: { scenes: 1, beats: 2, characters: 1 },
  scenes: [
    {
      scene_id: 's001',
      title: 'Opening',
      chapter: 'ch01',
      characters_present: ['cao-cao'],
      beats: [
        { i: 0, speaker: 'CAO CAO', kind: 'speech', mood: 'ANGRILY', text: 'Who dares?' },
        { i: 1, speaker: '', kind: 'narration', text: 'Silence, then a comma, "quote".' }
      ]
    }
  ],
  characters: [{ id: 'cao-cao', name: 'Cao Cao', aliases: ['Mengde'] }]
}

describe('toJson', () => {
  it('emits the nested shape and drops mood when absent', () => {
    const parsed = JSON.parse(toJson(PROJECT))
    expect(parsed.scenes[0].beats[0].mood).toBe('ANGRILY')
    expect(parsed.scenes[0].beats[1]).not.toHaveProperty('mood')
    expect(parsed.characters[0]).toEqual({ id: 'cao-cao', name: 'Cao Cao', aliases: ['Mengde'] })
  })
})

describe('toCsv', () => {
  it('emits the flat beats table with the parser column order', () => {
    const lines = toCsv(PROJECT).trimEnd().split('\n')
    expect(lines[0]).toBe('scene_id,chapter,beat,speaker,kind,mood,start,end,text') // start,end = subtitle/transcript timing
    expect(lines[1]).toBe('s001,ch01,0,CAO CAO,speech,ANGRILY,,,Who dares?') // no timing → empty start,end
    expect(lines[2]).toBe('s001,ch01,1,,narration,,,,"Silence, then a comma, ""quote""."') // commas/quotes escaped
  })
})

describe('toSrt', () => {
  // An untimed scene has NO cues — the serializer relies on this to fail loudly instead of writing an empty .srt.
  it('is empty (no cues) when no beat carries timing', () => {
    const untimed: StructuredProject = { title: 'X', characters: [], scenes: [
      { scene_id: 's1', chapter: 'ch01', beats: [
        { i: 0, kind: 'speech', speaker: 'ALICE', text: 'Hello.' },
        { i: 1, kind: 'narration', speaker: '', text: 'She left.' }
      ] }
    ] }
    expect(toSrt(untimed).trim()).toBe('')
  })

  it('emits one numbered cue per timed beat, borrowing the next start when end is missing', () => {
    const timed: StructuredProject = { title: 'X', characters: [], scenes: [
      { scene_id: 's1', chapter: 'ch01', beats: [
        { i: 0, kind: 'speech', speaker: 'ALICE', text: 'Hi.', start: '00:00:01' }, // no end → borrows next start
        { i: 1, kind: 'narration', speaker: '', text: 'Beat.', start: '00:00:03', end: '00:00:05' }
      ] }
    ] }
    expect(toSrt(timed)).toBe('1\n00:00:01,000 --> 00:00:03,000\nALICE: Hi.\n\n2\n00:00:03,000 --> 00:00:05,000\nBeat.\n')
  })
})
