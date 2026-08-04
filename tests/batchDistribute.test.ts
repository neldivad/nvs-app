import { describe, it, expect } from 'vitest'
import { parseJsonArray, distributeBatch, mintThreadId, canonicalThreadId } from '../src/main/ai/batchDistribute'
import type { BatchSceneExtraction } from '../src/shared/config/extraction'

// A minimal batch-scene object; only the fields a test cares about need to be set.
const obj = (scene_id: string, over: Partial<BatchSceneExtraction> = {}): BatchSceneExtraction => ({
  scene_id,
  summary: `s-${scene_id}`,
  characters: [],
  locations: [],
  plot_times: [],
  goals: [],
  conflicts: [],
  enters: [],
  exits: [],
  things: [],
  threads: [],
  lore_bombs: [],
  scene_contexts: [],
  ...over
})

const OPTS = { model: 'test', depth: 'full' as const, allowedThings: new Set<string>(), entryThreadIds: new Set<string>() }

describe('parseJsonArray', () => {
  it('extracts a bare array', () => {
    expect(parseJsonArray('[{"scene_id":"a"}]')).toEqual([{ scene_id: 'a' }])
  })
  it('tolerates a code fence and surrounding prose', () => {
    expect(parseJsonArray('here you go:\n```json\n[{"x":1}]\n```\ndone')).toEqual([{ x: 1 }])
  })
  it('coerces a bare single object into a 1-element array (single-scene batch drops the [] wrapper)', () => {
    expect(parseJsonArray('{"scene_id":"a","summary":"x"}')).toEqual([{ scene_id: 'a', summary: 'x' }])
    expect(parseJsonArray('```json\n{"scene_id":"a"}\n```')).toEqual([{ scene_id: 'a' }])
  })
  it('prefers a real array over the object fallback', () => {
    expect(parseJsonArray('[{"scene_id":"a"},{"scene_id":"b"}]')).toEqual([{ scene_id: 'a' }, { scene_id: 'b' }])
  })
  it('returns null only on genuinely unparseable output', () => {
    expect(parseJsonArray('total garbage')).toBeNull()
    expect(parseJsonArray('{"truncated": ')).toBeNull() // no closing brace → real truncation, not recoverable
  })
})

describe('canonicalThreadId', () => {
  it('collapses a doubled prefix', () => {
    expect(canonicalThreadId('thr:sanguo-ch003:thr:sanguo-ch003:dong_zhuo_tyranny')).toBe('thr:sanguo-ch003:dong_zhuo_tyranny')
  })
  it('collapses a tripled prefix', () => {
    expect(canonicalThreadId('thr:c1:thr:c1:thr:c1:x')).toBe('thr:c1:x')
  })
  it('leaves a well-formed id unchanged (idempotent)', () => {
    expect(canonicalThreadId('thr:sanguo-ch003:dong_zhuo_tyranny')).toBe('thr:sanguo-ch003:dong_zhuo_tyranny')
    expect(canonicalThreadId(canonicalThreadId('thr:c1:thr:c1:x'))).toBe('thr:c1:x')
  })
})

describe('mintThreadId', () => {
  it('builds the canonical id from a bare ref', () => {
    expect(mintThreadId('sanguo-ch003', 'dong_zhuo_tyranny')).toBe('thr:sanguo-ch003:dong_zhuo_tyranny')
  })
  it('does NOT double-prefix a ref the model already returned as a full id', () => {
    expect(mintThreadId('sanguo-ch003', 'thr:sanguo-ch003:dong_zhuo_tyranny')).toBe('thr:sanguo-ch003:dong_zhuo_tyranny')
  })
  it('collapses an already-doubled ref back to canonical', () => {
    expect(mintThreadId('sanguo-ch003', 'thr:sanguo-ch003:thr:sanguo-ch003:x')).toBe('thr:sanguo-ch003:x')
  })
})

describe('distributeBatch', () => {
  it('maps each returned object back to its scene by scene_id', () => {
    const r = distributeBatch(['a', 'b'], [obj('a'), obj('b')], OPTS)
    expect(r.entries.map((e) => e.targetId)).toEqual(['a', 'b'])
    expect(r.skipped).toEqual([])
    expect(r.entries[0].rows.extracted.summary).toBe('s-a')
  })

  it('DROPS an object whose scene_id is not in the batch (never writes onto the wrong scene)', () => {
    const r = distributeBatch(['a', 'b'], [obj('a'), obj('ZZZ'), obj('b')], OPTS)
    expect(r.entries.map((e) => e.targetId)).toEqual(['a', 'b']) // ZZZ dropped, no scene got its rows
  })

  it('a scene with no returned object is skipped (retried next run)', () => {
    const r = distributeBatch(['a', 'b', 'c'], [obj('a'), obj('c')], OPTS)
    expect(r.entries.map((e) => e.targetId)).toEqual(['a', 'c'])
    expect(r.skipped).toEqual([{ sceneId: 'b', reason: 'no object returned for this scene_id' }])
  })

  it('a later-scene advance lands on its open — whether the model uses the bare ref, the full id, or a doubled id', () => {
    const open = obj('a', { threads: [{ action: 'open', ref: 'plot', title: 'The Plot', description: 'opens' }] as never })
    // scene b advances by BARE ref, c by the FULL id, d by a DOUBLED id — all must resolve to thr:a:plot
    const b = obj('b', { threads: [{ action: 'advance', thread_id: 'plot', description: 'via bare' }] as never })
    const c = obj('c', { threads: [{ action: 'advance', thread_id: 'thr:a:plot', description: 'via full' }] as never })
    const d = obj('d', { threads: [{ action: 'advance', thread_id: 'thr:a:thr:a:plot', description: 'via doubled' }] as never })
    const r = distributeBatch(['a', 'b', 'c', 'd'], [open, b, c, d], OPTS)
    const beat = (i: number) => r.entries[i].rows.threads[0]
    expect(beat(0).threadId).toBe('thr:a:plot') // the open
    expect(beat(1).threadId).toBe('thr:a:plot') // bare
    expect(beat(2).threadId).toBe('thr:a:plot') // full
    expect(beat(3).threadId).toBe('thr:a:plot') // doubled — no split, no dangling drop
  })

  it('a duplicate scene_id keeps only the first (never double-writes)', () => {
    const r = distributeBatch(['a'], [obj('a', { summary: 'first' }), obj('a', { summary: 'second' })], OPTS)
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].rows.extracted.summary).toBe('first')
  })

  it('preserves batch order regardless of the array order returned', () => {
    const r = distributeBatch(['a', 'b', 'c'], [obj('c'), obj('a'), obj('b')], OPTS)
    expect(r.entries.map((e) => e.targetId)).toEqual(['a', 'b', 'c'])
  })

  it('within-batch continuity: a thread opened in scene a can be advanced in scene b by its ref', () => {
    const scenes = [
      obj('a', { threads: [{ action: 'open', ref: 'the_letter', title: 'The Letter', description: 'a letter appears' }] }),
      obj('b', { threads: [{ action: 'advance', thread_id: 'the_letter', description: 'the letter is read' }] })
    ]
    const r = distributeBatch(['a', 'b'], scenes, OPTS)
    // scene a opens thr:a:the_letter; scene b's advance (by bare ref) resolves to that full id and is KEPT.
    expect(r.entries[0].rows.threads[0]).toMatchObject({ threadId: 'thr:a:the_letter', action: 'open' })
    expect(r.entries[1].rows.threads).toHaveLength(1)
    expect(r.entries[1].rows.threads[0]).toMatchObject({ threadId: 'thr:a:the_letter', action: 'advance' })
  })

  it('an advance to a thread neither open-entering nor opened in-batch is dropped', () => {
    const r = distributeBatch(['a'], [obj('a', { threads: [{ action: 'advance', thread_id: 'ghost', description: 'x' }] })], OPTS)
    expect(r.entries[0].rows.threads).toEqual([]) // ghost not valid → dropped
  })

  it('an entry-open thread id is a valid advance target', () => {
    const r = distributeBatch(['a'], [obj('a', { threads: [{ action: 'close', thread_id: 'thr:earlier:x', description: 'resolved' }] })], {
      ...OPTS,
      entryThreadIds: new Set(['thr:earlier:x'])
    })
    expect(r.entries[0].rows.threads[0]).toMatchObject({ threadId: 'thr:earlier:x', action: 'resolve' })
  })

  it('skim depth fills the missing full-contract fields (no crash on absent goals/things)', () => {
    const skimObj = { scene_id: 'a', summary: 's', characters: ['X'], threads: [] } as unknown as BatchSceneExtraction
    const r = distributeBatch(['a'], [skimObj], { ...OPTS, depth: 'skim' })
    expect(r.entries[0].rows.extracted.characters).toEqual(['X'])
    expect(r.entries[0].rows.extracted.goals).toEqual([])
  })
})
