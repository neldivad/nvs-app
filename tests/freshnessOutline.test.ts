import { describe, it, expect } from 'vitest'
import { classify, build, previewStateOf, historyStateOf } from '../src/renderer/lib/analysis/freshnessOutline'
import type { StoryNode, TierStatusRow } from '../src/shared/ipc'

const row = (over: Partial<TierStatusRow> = {}): TierStatusRow => ({ unitId: 's', code: null, title: 't', phase: 'canon', status: 'fresh', lastRun: null, depth: 'full', ...over })

describe('classify — a scene\'s state for a run', () => {
  it('non-canon → draft, regardless of freshness', () => {
    expect(classify(row({ phase: 'draft', status: 'stale' }), false, 'full')).toBe('draft')
  })
  it('missing tier row → draft (never analyzed)', () => {
    expect(classify(undefined, false, 'full')).toBe('draft')
  })
  it('off-variant wins over freshness (won\'t be read this run)', () => {
    expect(classify(row({ status: 'stale' }), true, 'full')).toBe('offVariant')
  })
  it('stale / pending → willRead', () => {
    expect(classify(row({ status: 'stale' }), false, 'full')).toBe('willRead')
    expect(classify(row({ status: 'pending' }), false, 'skim')).toBe('willRead')
  })
  it('fresh full → fresh', () => {
    expect(classify(row({ status: 'fresh', depth: 'full' }), false, 'full')).toBe('fresh')
  })
  it('fresh-but-skim is willRead under EXPERT, fresh under FAST (the skim→full upgrade lights up)', () => {
    expect(classify(row({ status: 'fresh', depth: 'skim' }), false, 'full')).toBe('willRead')
    expect(classify(row({ status: 'fresh', depth: 'skim' }), false, 'skim')).toBe('fresh')
  })
})

describe('build — bottom-up roll-up', () => {
  const scene = (id: string): StoryNode => ({ type: 'scene', name: id, relPath: id, path: id, sceneId: id })
  const folder = (name: string, children: StoryNode[]): StoryNode => ({ type: 'folder', name, relPath: name, path: name, children })
  const root = (children: StoryNode[]): StoryNode => ({ type: 'folder', name: '', relPath: '', path: '', children })

  it('aggregates descendant scene states up the folder hierarchy', () => {
    const tree = folder('book', [folder('ch1', [scene('a'), scene('b')]), folder('ch2', [scene('c')])])
    const byId = new Map<string, TierStatusRow>([
      ['a', row({ unitId: 'a', status: 'stale' })],
      ['b', row({ unitId: 'b', status: 'fresh', depth: 'full' })],
      ['c', row({ unitId: 'c', status: 'pending' })]
    ])
    const out = build(root([tree]), previewStateOf(byId, new Set(), 'full'))
    expect(out.counts.total).toBe(3)
    expect(out.counts.willRead).toBe(2) // a (stale) + c (pending)
    expect(out.counts.fresh).toBe(1) // b
    expect(out.folders[0].folders[0].counts.willRead).toBe(1) // ch1 rolls up just a
  })

  it('empty onVariant set → nothing off-variant (single-timeline project)', () => {
    const out = build(root([folder('book', [scene('a')])]), previewStateOf(new Map([['a', row({ unitId: 'a', status: 'fresh', depth: 'full' })]]), new Set(), 'full'))
    expect(out.counts.offVariant).toBe(0)
  })

  it('scene absent from a non-empty onVariant set → offVariant', () => {
    const byId = new Map([['a', row({ unitId: 'a', status: 'stale' })], ['b', row({ unitId: 'b', status: 'stale' })]])
    const out = build(root([folder('book', [scene('a'), scene('b')])]), previewStateOf(byId, new Set(['a']), 'full'))
    expect(out.counts.willRead).toBe(1) // a on-variant + stale
    expect(out.counts.offVariant).toBe(1) // b off the active timeline
  })
})

describe('historyStateOf — a past run\'s frozen coverage', () => {
  const scene = (id: string): StoryNode => ({ type: 'scene', name: id, relPath: id, path: id, sceneId: id })
  const root = (children: StoryNode[]): StoryNode => ({ type: 'folder', name: '', relPath: '', path: '', children })

  it('scenes in the run\'s target set = read, the rest = not run', () => {
    const out = build(root([scene('a'), scene('b'), scene('c')]), historyStateOf(new Set(['a', 'c'])))
    expect(out.counts.read).toBe(2) // a, c were touched by that run
    expect(out.counts.notRun).toBe(1) // b was not
  })
})
