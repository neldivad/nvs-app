import { describe, it, expect } from 'vitest'
import { contractFolders, folderCellId, isFolderCell } from '../src/renderer/lib/timeline/cellGraph'
import type { StoryNode } from '../src/shared/ipc'

// A two-act book: act1 = {s1, s2}, act2 = {s3}; s1→s2 (intra), s2→s3 (crosses the act boundary).
const tree: StoryNode[] = [
  { type: 'folder', name: 'Act One', relPath: 'act1', children: [
    { type: 'scene', name: 'S1', sceneId: 's1' },
    { type: 'scene', name: 'S2', sceneId: 's2' }
  ] },
  { type: 'folder', name: 'Act Two', relPath: 'act2', children: [
    { type: 'scene', name: 'S3', sceneId: 's3' }
  ] }
] as StoryNode[]
const adj = { s1: ['s2'], s2: ['s3'] }
const subset = ['s1', 's2', 's3']

describe('contractFolders', () => {
  it('no collapsed folders → the graph is the scenes untouched', () => {
    const g = contractFolders(subset, adj, [{ folderRel: 'act1', collapsed: false }], tree)
    expect(g.ids).toEqual(['s1', 's2', 's3'])
    expect(g.adjacency).toEqual({ s1: ['s2'], s2: ['s3'] })
    expect(g.meta.get('s1')?.kind).toBe('scene')
  })

  it('a collapsed folder contracts its scenes into one folder cell', () => {
    const g = contractFolders(subset, adj, [{ folderRel: 'act1', collapsed: true }], tree)
    expect(g.ids).toEqual([folderCellId('act1'), 's3'])
    expect(isFolderCell(g.ids[0])).toBe(true)
    // s2→s3 crosses the boundary → becomes folder:act1 → s3
    expect(g.adjacency[folderCellId('act1')]).toEqual(['s3'])
  })

  it('intra-folder edges vanish (s1→s2 is inside act1)', () => {
    const g = contractFolders(subset, adj, [{ folderRel: 'act1', collapsed: true }], tree)
    // the folder cell has no self-loop
    expect(g.adjacency[folderCellId('act1')] ?? []).not.toContain(folderCellId('act1'))
  })

  it('the folder cell reports its name + on-canvas scene count', () => {
    const g = contractFolders(subset, adj, [{ folderRel: 'act1', collapsed: true }], tree)
    const m = g.meta.get(folderCellId('act1'))
    expect(m).toMatchObject({ kind: 'folder', folderRel: 'act1', title: 'Act One', count: 2 })
  })

  it('both folders collapsed → a folder→folder edge', () => {
    const g = contractFolders(subset, adj, [
      { folderRel: 'act1', collapsed: true },
      { folderRel: 'act2', collapsed: true }
    ], tree)
    expect(g.ids).toEqual([folderCellId('act1'), folderCellId('act2')])
    expect(g.adjacency[folderCellId('act1')]).toEqual([folderCellId('act2')])
  })

  it('repOf maps a scene to its folder cell, else itself', () => {
    const g = contractFolders(subset, adj, [{ folderRel: 'act1', collapsed: true }], tree)
    expect(g.repOf('s1')).toBe(folderCellId('act1'))
    expect(g.repOf('s2')).toBe(folderCellId('act1'))
    expect(g.repOf('s3')).toBe('s3')
  })

  it('nested collapsed folders group under the OUTERMOST (shortest relPath)', () => {
    const nested: StoryNode[] = [
      { type: 'folder', name: 'Book', relPath: 'book', children: [
        { type: 'folder', name: 'Ch1', relPath: 'book/ch1', children: [{ type: 'scene', name: 'A', sceneId: 'a' }] }
      ] }
    ] as StoryNode[]
    const g = contractFolders(['a'], {}, [
      { folderRel: 'book/ch1', collapsed: true },
      { folderRel: 'book', collapsed: true }
    ], nested)
    expect(g.repOf('a')).toBe(folderCellId('book')) // outermost wins
  })
})
