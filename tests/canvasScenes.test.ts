import { describe, it, expect } from 'vitest'
import { canvasSceneIds } from '../src/renderer/lib/timeline/canvasScenes'
import type { StoryNode, TimelineNode } from '../src/shared/ipc'

const tree = [
  {
    type: 'folder', name: 'liyue', relPath: 'liyue',
    children: [
      { type: 'scene', name: 'a', sceneId: 'lq1', relPath: 'liyue/a.md' },
      { type: 'folder', name: 'sub', relPath: 'liyue/sub', children: [{ type: 'scene', name: 'b', sceneId: 'lq2', relPath: 'liyue/sub/b.md' }] }
    ]
  },
  { type: 'folder', name: 'mond', relPath: 'mond', children: [{ type: 'scene', name: 'c', sceneId: 'mq1', relPath: 'mond/c.md' }] }
] as unknown as StoryNode[]

describe('canvasScenes — canvasSceneIds', () => {
  it('empty canvas → empty set (callers fall back to all)', () => {
    expect(canvasSceneIds([], tree).size).toBe(0)
  })
  it('a placed FOLDER contributes its whole subtree (recursive)', () => {
    const nodes = [{ kind: 'folder', folderRel: 'liyue', x: 0, y: 0 }] as unknown as TimelineNode[]
    expect([...canvasSceneIds(nodes, tree)].sort()).toEqual(['lq1', 'lq2']) // liyue + its sub-folder, NOT mond
  })
  it('a placed SCENE contributes just itself', () => {
    const nodes = [{ kind: 'scene', sceneId: 'mq1', x: 0, y: 0 }] as unknown as TimelineNode[]
    expect([...canvasSceneIds(nodes, tree)]).toEqual(['mq1'])
  })
  it('mix of folder + scene nodes', () => {
    const nodes = [{ kind: 'folder', folderRel: 'liyue', x: 0, y: 0 }, { kind: 'scene', sceneId: 'mq1', x: 0, y: 0 }] as unknown as TimelineNode[]
    expect([...canvasSceneIds(nodes, tree)].sort()).toEqual(['lq1', 'lq2', 'mq1'])
  })
})
