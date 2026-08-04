import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTrees, writeTrees, migrateTrees, activeVariant, treesPath, adjacencyFromTree, mirrorFrontmatterToTrees } from '../src/engine/content/trees'
import type { TreesFile, StoryNode } from '../src/shared/ipc'

// Pure JSON sidecar → testable without Electron (a real temp dir on the node fs).
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'nvs-trees-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

const sample: TreesFile = {
  version: 1,
  activeId: 'v1',
  variants: [
    { id: 'v1', name: 'Main line', adjacency: { a1: ['a2'], a2: ['merge1'] } },
    { id: 'v2', name: 'Variant B', adjacency: { b1: ['merge1'] } }
  ]
}

describe('trees — read/write round-trip', () => {
  it('absent file → EMPTY', () => {
    expect(readTrees(root)).toEqual({ version: 1, activeId: undefined, variants: [] })
  })
  it('write then read returns the same trees', () => {
    writeTrees(root, sample)
    expect(readTrees(root)).toEqual(sample)
  })
  it('writes to .nvs/trees.json', () => {
    expect(treesPath(root).endsWith('/.nvs/trees.json')).toBe(true)
  })
})

describe('trees — migrateTrees (defensive)', () => {
  it('garbage → EMPTY', () => {
    expect(migrateTrees(null)).toEqual({ version: 1, activeId: undefined, variants: [] })
    expect(migrateTrees('nope')).toEqual({ version: 1, activeId: undefined, variants: [] })
  })
  it('drops malformed variants + non-string edges, defaults the name', () => {
    const migrated = migrateTrees({ variants: [{ id: 'v', adjacency: { a: ['b', 5] } }, { name: 'no id' }] })
    expect(migrated.variants).toEqual([{ id: 'v', name: 'Timeline', adjacency: { a: ['b'] } }])
  })
  it('heals a dangling activeId to the first variant', () => {
    expect(migrateTrees({ activeId: 'gone', variants: [{ id: 'v1', name: 'A', adjacency: {} }] }).activeId).toBe('v1')
  })
})

describe('trees — activeVariant', () => {
  it('picks activeId, else the first, else undefined', () => {
    expect(activeVariant(sample)?.id).toBe('v1')
    expect(activeVariant({ version: 1, variants: sample.variants })?.id).toBe('v1') // no activeId → first
    expect(activeVariant({ version: 1, variants: [] })).toBeUndefined()
  })
})

const storyTree = [
  {
    type: 'folder', name: 'ch', relPath: 'ch', path: '/ch',
    children: [
      { type: 'scene', name: 's1', relPath: 'ch/s1.md', path: '/ch/s1.md', sceneId: 'a1', leadsTo: ['a2'] },
      { type: 'scene', name: 's2', relPath: 'ch/s2.md', path: '/ch/s2.md', sceneId: 'a2' } // no leads_to → omitted
    ]
  }
] as unknown as StoryNode[]

describe('trees — adjacencyFromTree', () => {
  it('collects only scenes that have leads_to', () => {
    expect(adjacencyFromTree(storyTree)).toEqual({ a1: ['a2'] })
  })
})

describe('trees — mirrorFrontmatterToTrees (T2)', () => {
  it('seeds a default variant from frontmatter when empty, and persists it', () => {
    const t = mirrorFrontmatterToTrees(root, storyTree)
    expect(t).toEqual({ version: 1, activeId: 'default', variants: [{ id: 'default', name: 'Timeline 1', adjacency: { a1: ['a2'] } }] })
    expect(readTrees(root)).toEqual(t) // written to disk
  })

  it('is idempotent — never overwrites an existing/authored variant', () => {
    writeTrees(root, { version: 1, activeId: 'v9', variants: [{ id: 'v9', name: 'Authored', adjacency: {} }] })
    const t = mirrorFrontmatterToTrees(root, storyTree)
    expect(t.variants).toEqual([{ id: 'v9', name: 'Authored', adjacency: {} }]) // untouched
  })
})
