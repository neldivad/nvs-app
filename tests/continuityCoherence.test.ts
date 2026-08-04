import { describe, it, expect } from 'vitest'
import { FIDELITY_KINDS, CONTINUITY_KINDS } from '../src/shared/config/extraction'
import { formatFactLine, assembleDeclared, continuityInputHash, type ContinuityInputs } from '../src/engine/analysis/continuity'

/**
 * The load-bearing invariant of the two-kind coherence model (internal/continuity-coherence.md): the Fidelity and
 * Continuity kind families are DISJOINT. writeTier partitions its delete-on-rewrite by family — a Fidelity re-run
 * deletes only FIDELITY_KINDS, so Continuity findings survive (and vice-versa). If the two sets ever overlap, a
 * re-run of one kind would silently wipe the other's findings. This test guards that.
 */
describe('coherence kind families', () => {
  it('Fidelity and Continuity kinds are disjoint', () => {
    const overlap = FIDELITY_KINDS.filter((k) => (CONTINUITY_KINDS as readonly string[]).includes(k))
    expect(overlap).toEqual([])
  })

  it('neither family collides with the quest-verdict kinds owned by the thread pass', () => {
    const quest = ['cliffhanger', 'hole', 'sequel_hook', 'pending']
    const both = [...FIDELITY_KINDS, ...CONTINUITY_KINDS]
    expect(both.filter((k) => quest.includes(k))).toEqual([])
  })
})

describe('continuity fact-line formatting', () => {
  it('surfaces summary + location and the hard facts a plot-hole hinges on (NOT a present-character list)', () => {
    const line = formatFactLine({
      summary: 'Boromir falls at Amon Hen.',
      locations_json: JSON.stringify(['Amon Hen']),
      exits_json: JSON.stringify([{ entity: 'Boromir', kind: 'death', reversible: false }]),
      plot_times_json: JSON.stringify(['day 40']),
      conflicts_json: JSON.stringify([{ over: 'the Ring', between: ['Frodo', 'Boromir'] }])
    })
    expect(line).toContain('Boromir falls at Amon Hen.')
    expect(line).toContain('at: Amon Hen') // scene setting (unambiguous)
    expect(line).not.toContain('present:') // dropped: characters_json conflates present vs merely mentioned
    expect(line).toContain('Boromir exits (death, irreversible)') // the continuity trap: irreversible exit
    expect(line).toContain('time: day 40')
    expect(line).toContain('the Ring (Frodo vs Boromir)')
  })

  it('drops reversible exits (a return is not a plot-hole) and tolerates empty/bad json', () => {
    const line = formatFactLine({
      summary: 'She steps out for air.',
      locations_json: '[]',
      exits_json: JSON.stringify([{ entity: 'Mara', kind: 'leave', reversible: true }]),
      plot_times_json: null,
      conflicts_json: 'not json'
    })
    expect(line).toBe('She steps out for air.')
  })
})

describe('continuity input hash', () => {
  const base: ContinuityInputs = {
    checkpoint: 'A3',
    declared: assembleDeclared([{ id: 'ring', body: 'It corrupts its bearer.' }]),
    facts: [{ sceneId: 's1', title: 'Open', chapter: 'c1', pos: 0, text: 'Frodo takes the ring.' }],
    threads: [{ threadId: 't1', title: 'Quest', text: 'open → resolve' }],
    promptVersion: 'v-fiction'
  }
  it('is stable for identical inputs and moves when any side changes', () => {
    expect(continuityInputHash(base)).toBe(continuityInputHash({ ...base }))
    const factMoved = continuityInputHash({ ...base, facts: [{ ...base.facts[0], text: 'Frodo drops the ring.' }] })
    const ruleMoved = continuityInputHash({ ...base, declared: assembleDeclared([{ id: 'ring', body: 'It is harmless.' }]) })
    const kindMoved = continuityInputHash({ ...base, promptVersion: 'v-nonfiction' }) // a fiction↔non-fiction switch re-stales
    expect(factMoved).not.toBe(continuityInputHash(base))
    expect(ruleMoved).not.toBe(continuityInputHash(base))
    expect(kindMoved).not.toBe(continuityInputHash(base))
  })
})
