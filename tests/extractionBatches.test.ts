import { describe, it, expect } from 'vitest'
import { packBatches, estimateSceneOutTokens, median, type SceneEstimate } from '../src/engine/analysis/extractionBatches'
import { BATCH_CONFIG } from '../src/shared/config/extraction'

// Small target so batch math is legible in the fixtures (real target is 50k tokens).
const OPTS = { targetOutTokens: 1000, chapterBoundarySoftFill: 0.6 }

/** Terse scene-estimate builder: id, pos (defaults to index order), chapter, estOut. */
const s = (sceneId: string, estOutTokens: number, chapterId: string | null = 'c1', pos = 0): SceneEstimate => ({ sceneId, chapterId, pos, estOutTokens })

describe('packBatches — output-bounded bin-packing', () => {
  it('packs sequential scenes until the output target, then closes', () => {
    const scenes = [s('a', 400, 'c1', 1), s('b', 400, 'c1', 2), s('c', 400, 'c1', 3)]
    const out = packBatches(scenes, OPTS)
    // 400+400=800 fits; +400 would be 1200 > 1000 → close after b.
    expect(out.map((b) => b.sceneIds)).toEqual([['a', 'b'], ['c']])
    expect(out[0].estOutTokens).toBe(800)
  })

  it('a lone scene over the cap is its own oversized batch', () => {
    const scenes = [s('a', 300, 'c1', 1), s('huge', 5000, 'c1', 2), s('b', 300, 'c1', 3)]
    const out = packBatches(scenes, OPTS)
    expect(out.map((b) => b.sceneIds)).toEqual([['a'], ['huge'], ['b']])
    expect(out[1].oversized).toBe(true)
    expect(out[0].oversized).toBe(false)
  })

  it('closes at a chapter boundary once the batch is ≥ softFill full', () => {
    // c1 accumulates 700 (≥60% of 1000) → the c2 boundary closes it early even though 700+200 would fit.
    const scenes = [s('a', 400, 'c1', 1), s('b', 300, 'c1', 2), s('c', 200, 'c2', 3)]
    const out = packBatches(scenes, OPTS)
    expect(out.map((b) => b.sceneIds)).toEqual([['a', 'b'], ['c']])
    expect(out[0].chapterIds).toEqual(['c1'])
  })

  it('keeps packing across a chapter boundary while the batch is still near-empty', () => {
    // c1 has only 200 (< 60% of 1000) → do NOT close at the c2 boundary; pack across it.
    const scenes = [s('a', 200, 'c1', 1), s('b', 300, 'c2', 2), s('c', 300, 'c2', 3)]
    const out = packBatches(scenes, OPTS)
    expect(out[0].sceneIds).toEqual(['a', 'b', 'c'])
    expect(out[0].chapterIds).toEqual(['c1', 'c2'])
  })

  it('sorts by linear position before packing (input order is irrelevant)', () => {
    const scenes = [s('c', 400, 'c1', 3), s('a', 400, 'c1', 1), s('b', 400, 'c1', 2)]
    const out = packBatches(scenes, OPTS)
    expect(out[0].sceneIds).toEqual(['a', 'b']) // pos order, not array order
  })

  it('batchId is deterministic from the first scene → a re-plan reproduces the plan', () => {
    const scenes = [s('a', 400, 'c1', 1), s('b', 400, 'c1', 2), s('c', 400, 'c1', 3)]
    expect(packBatches(scenes, OPTS)[0].batchId).toBe('batch:a')
    expect(packBatches(scenes, OPTS)).toEqual(packBatches([...scenes].reverse(), OPTS)) // order-independent
  })

  it('empty frontier → no batches', () => {
    expect(packBatches([], OPTS)).toEqual([])
  })

  it('flat/null-chapter scenes pack by budget alone (no boundary logic)', () => {
    const scenes = [s('a', 600, null, 1), s('b', 600, null, 2)]
    const out = packBatches(scenes, OPTS)
    expect(out.map((b) => b.sceneIds)).toEqual([['a'], ['b']]) // 600+600 > 1000
    expect(out[0].chapterIds).toEqual([]) // no chapters to report
  })
})

describe('estimateSceneOutTokens', () => {
  it('scales dialogue chars by k ÷ charsPerToken', () => {
    const dialogueChars = 3500
    const expected = Math.round((dialogueChars * BATCH_CONFIG.outCharsPerDialogueChar) / BATCH_CONFIG.charsPerToken)
    expect(estimateSceneOutTokens(dialogueChars)).toBe(expected)
  })

  it('never estimates below the floor (a dialogue-less scene still emits summary/threads)', () => {
    expect(estimateSceneOutTokens(0)).toBe(BATCH_CONFIG.minSceneOutTokens)
  })

  it('a learned k (from realized output) sizes scenes to that ratio, not the global constant', () => {
    // The whole point of calibration: once a project's realized k is known, the estimate follows IT.
    const dialogueChars = 3500 // divides cleanly by charsPerToken (3.5) so the 2x is exact, not a rounding artifact
    const learnedK = 6 // e.g. what Three Kingdoms actually realizes
    expect(estimateSceneOutTokens(dialogueChars, learnedK)).toBe(Math.round((dialogueChars * 6) / BATCH_CONFIG.charsPerToken))
    // and it's 2x the global-prior estimate — the under-sizing the packer was doing before calibration.
    expect(estimateSceneOutTokens(dialogueChars, learnedK)).toBe(2 * estimateSceneOutTokens(dialogueChars, 3))
  })
})

describe('median — the learned-k reducer', () => {
  it('odd length → the middle value', () => {
    expect(median([3, 1, 2])).toBe(2)
  })
  it('even length → the average of the two middles (robust to an outlier dense batch)', () => {
    expect(median([1, 2, 3, 100])).toBe(2.5) // the 100 (a dense batch) does NOT drag the estimate up
  })
  it('does not mutate its input', () => {
    const xs = [3, 1, 2]
    median(xs)
    expect(xs).toEqual([3, 1, 2])
  })

  it('the skim k sizes a scene far smaller than the full k → Fast batches pack denser', () => {
    const dialogueChars = 2800
    const full = estimateSceneOutTokens(dialogueChars) // default full k → 2400 tokens
    const skim = estimateSceneOutTokens(dialogueChars, BATCH_CONFIG.skimOutCharsPerDialogueChar) // → 480 tokens
    expect(skim).toBeLessThan(full)
    // With the same 1000-token budget, a 2800-char scene packs 1/batch at full k (est 2400 > 1000, lone)
    // but two fit at skim k (480+480 < 1000) — the whole point of the fix.
    const full1 = packBatches([s('a', full, 'c1', 1), s('b', full, 'c1', 2)], OPTS)
    const skim1 = packBatches([s('a', skim, 'c1', 1), s('b', skim, 'c1', 2)], OPTS)
    expect(full1[0].sceneIds).toEqual(['a']) // full: one per batch
    expect(skim1[0].sceneIds).toEqual(['a', 'b']) // skim: both fit
  })
})
