import { describe, it, expect } from 'vitest'
import { foldChapterLedger, entriesToBeats, type ThreadBeat, type ChapterFoldInput } from '../src/engine/analysis/chapterFold'

const beat = (threadId: string, action: ThreadBeat['action'], pos: number, description = '', extra: Partial<ThreadBeat> = {}): ThreadBeat => ({
  threadId,
  action,
  pos,
  description,
  subject: extra.subject ?? null,
  confidence: extra.confidence ?? null
})

const fold = (beats: ThreadBeat[], openBefore: string[] = [], bookends = { premise: 'P', conclusion: 'C' }): ReturnType<typeof foldChapterLedger> =>
  foldChapterLedger({ chapterId: 'ch1', premise: bookends.premise, conclusion: bookends.conclusion, beats, openBefore } as ChapterFoldInput)

describe('chapterFold (Slice 1 · Tier-1 deterministic)', () => {
  it('carries bookends through untouched', () => {
    const r = fold([], [], { premise: 'the errand begins', conclusion: 'she flees' })
    expect(r.premise).toBe('the errand begins')
    expect(r.conclusion).toBe('she flees')
    expect(r.entries).toEqual([])
    expect(r.openAtEnd).toEqual([])
  })

  it('a thread carried-open then resolved here → net resolved, drops out of openAtEnd', () => {
    const r = fold([beat('t1', 'advance', 12, 'finds and takes the items'), beat('t1', 'resolve', 14, 'abandons the errand')], ['t1'])
    const e = r.entries.find((x) => x.threadId === 't1')!
    expect(e.net).toBe('resolved')
    expect(e.description).toBe('abandons the errand') // last beat = state at chapter end
    expect(r.openAtEnd).not.toContain('t1')
  })

  it('opened AND resolved in-chapter → net opened-and-resolved, EVENT flag, not open at end', () => {
    const r = fold([beat('t2', 'open', 5), beat('t2', 'resolve', 6)])
    expect(r.entries.find((x) => x.threadId === 't2')!.net).toBe('opened-and-resolved')
    expect(r.flags.some((f) => f.threadId === 't2' && f.kind === 'in-chapter-event')).toBe(true)
    expect(r.openAtEnd).not.toContain('t2')
  })

  it('opened but not closed → net opened, carried in openAtEnd (forward consequence)', () => {
    const r = fold([beat('t3', 'open', 3, 'let the boy live')])
    expect(r.entries.find((x) => x.threadId === 't3')!.net).toBe('opened')
    expect(r.openAtEnd).toContain('t3')
  })

  it('carried-open thread only advanced → net advanced, stays open', () => {
    const r = fold([beat('t4', 'advance', 9)], ['t4'])
    expect(r.entries.find((x) => x.threadId === 't4')!.net).toBe('advanced')
    expect(r.openAtEnd).toContain('t4')
  })

  it('low-confidence close is flagged', () => {
    const r = fold([beat('t5', 'resolve', 7, '', { confidence: 0.2 })], ['t5'])
    expect(r.flags.some((f) => f.threadId === 't5' && f.kind === 'low-confidence-close')).toBe(true)
  })

  it('a resolve with no open (before or here) → orphan-close flag', () => {
    const r = fold([beat('t6', 'resolve', 8)])
    expect(r.flags.some((f) => f.threadId === 't6' && f.kind === 'orphan-close')).toBe(true)
  })

  it('a carried-open resolve is NOT an orphan close', () => {
    const r = fold([beat('t7', 'resolve', 8)], ['t7'])
    expect(r.flags.some((f) => f.kind === 'orphan-close')).toBe(false)
  })

  it('reopen is flagged and keeps the thread open', () => {
    const r = fold([beat('t8', 'reopen', 4)], [])
    expect(r.flags.some((f) => f.threadId === 't8' && f.kind === 'reopened')).toBe(true)
    expect(r.openAtEnd).toContain('t8')
  })

  it('entries come out in reading order regardless of input order', () => {
    const r = fold([beat('b', 'open', 20), beat('a', 'open', 10)])
    expect(r.entries.map((e) => e.threadId)).toEqual(['a', 'b'])
  })
})

describe('entriesToBeats — the recursion (Slice 2: fold is closed one level up)', () => {
  const parentFold = (beats: ThreadBeat[]): ReturnType<typeof foldChapterLedger> =>
    foldChapterLedger({ chapterId: 'book', premise: 'P', conclusion: 'C', beats, openBefore: [] } as ChapterFoldInput)

  it('a thread opened in one child and resolved in a LATER child closes at the parent (long-arc payoff)', () => {
    const early = fold([beat('mystery', 'open', 1, 'the millennium mystery is posed')]) // stays open in its chapter
    const late = fold([beat('mystery', 'resolve', 40, 'the mystery is solved')], ['mystery']) // resolved in a later chapter
    const parent = parentFold([...entriesToBeats(early.entries), ...entriesToBeats(late.entries)])
    const e = parent.entries.find((x) => x.threadId === 'mystery')!
    expect(e.net).toBe('opened-and-resolved') // both beats now visible → closed
    expect(parent.openAtEnd).not.toContain('mystery') // NOT dangling at the book level
    expect(parent.flags.some((f) => f.threadId === 'mystery' && f.kind === 'in-chapter-event')).toBe(true)
  })

  it('a thread opened in a child and never resolved → carried in the parent openAtEnd', () => {
    const early = fold([beat('arc', 'open', 1)])
    const parent = parentFold(entriesToBeats(early.entries))
    expect(parent.openAtEnd).toContain('arc')
  })

  it('advanced-only child entries stay advances at the parent', () => {
    const child = fold([beat('t', 'advance', 5)], ['t'])
    expect(entriesToBeats(child.entries).map((b) => b.action)).toEqual(['advance'])
  })
})
