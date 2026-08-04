import { describe, it, expect } from 'vitest'
import { activeVariant, adjacencyPairs, adjacencyHas, addAdjacency, removeAdjacency, adjacencyReaches } from '../src/renderer/lib/timeline/treeVariant'
import type { TreesFile } from '../src/shared/ipc'

const trees: TreesFile = {
  version: 1,
  activeId: 'v2',
  variants: [
    { id: 'v1', name: 'A', adjacency: {} },
    { id: 'v2', name: 'B', adjacency: { a: ['b'], b: ['c'] } }
  ]
}

describe('treeVariant — activeVariant', () => {
  it('activeId picks it; no activeId → first; empty → undefined', () => {
    expect(activeVariant(trees)?.id).toBe('v2')
    expect(activeVariant({ version: 1, variants: trees.variants })?.id).toBe('v1')
    expect(activeVariant({ version: 1, variants: [] })).toBeUndefined()
  })
})

describe('treeVariant — adjacency ops', () => {
  const adj = { a: ['b'], b: ['c'] }

  it('pairs flattens adjacency', () => {
    expect(adjacencyPairs(adj).sort()).toEqual([['a', 'b'], ['b', 'c']])
  })
  it('has / add (dedup, same ref) / remove (prunes empty key)', () => {
    expect(adjacencyHas(adj, 'a', 'b')).toBe(true)
    expect(addAdjacency(adj, 'a', 'b')).toBe(adj) // no-op → same ref
    expect(addAdjacency(adj, 'b', 'd')).toEqual({ a: ['b'], b: ['c', 'd'] })
    expect(removeAdjacency(adj, 'a', 'b')).toEqual({ b: ['c'] }) // 'a' emptied → key pruned
  })
  it('reaches — the cycle guard input', () => {
    expect(adjacencyReaches(adj, 'a', 'c')).toBe(true) // a→b→c
    expect(adjacencyReaches(adj, 'c', 'a')).toBe(false) // no back-path → linking c→a is safe
    expect(adjacencyReaches({ a: ['b'], b: ['a'] }, 'a', 'zzz')).toBe(false) // terminates on an existing cycle
  })
})
