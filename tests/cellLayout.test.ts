import { describe, it, expect } from 'vitest'
import { cellLayout, routeThrough, pickSpine } from '../src/renderer/lib/timeline/cellLayout'

const edges = (m: Record<string, string[]>) => (id: string) => m[id]

describe('cellLayout', () => {
  it('a linear sequence is a centered vertical spine (col 0)', () => {
    const g = cellLayout(['m1', 'm2', 'm3'], ['m1', 'm2', 'm3'], edges({ m1: ['m2'], m2: ['m3'] }))
    expect(g.pos.get('m1')).toEqual({ row: 0, col: 0 })
    expect(g.pos.get('m2')).toEqual({ row: 1, col: 0 })
    expect(g.pos.get('m3')).toEqual({ row: 2, col: 0 })
    expect(g.minCol).toBe(0)
    expect(g.maxCol).toBe(0)
  })

  it('diamond: C branches off A and merges into D → C sits in a flanking column at the merge-1 row', () => {
    // spine A→B→D; C forks from A, merges into D
    const g = cellLayout(['A', 'B', 'D'], ['A', 'B', 'D', 'C'], edges({ A: ['B', 'C'], B: ['D'], C: ['D'] }))
    expect(g.pos.get('A')).toEqual({ row: 0, col: 0 })
    expect(g.pos.get('B')).toEqual({ row: 1, col: 0 })
    expect(g.pos.get('D')).toEqual({ row: 2, col: 0 })
    // C flows into D (row 2) → bottom-up puts it at row 1, in a side column (not col 0)
    expect(g.pos.get('C')!.row).toBe(1)
    expect(g.pos.get('C')!.col).not.toBe(0)
    expect(g.forks.has('A')).toBe(true)
    expect(g.merges.has('D')).toBe(true)
  })

  it('long merge feeder builds BOTTOM-UP so the feeding node sits directly above the merge', () => {
    // spine A→B→D; side path A→C→E→D. E feeds D (row 2) → E at row 1; C above E at row 0; same column.
    const g = cellLayout(['A', 'B', 'D'], ['A', 'B', 'D', 'C', 'E'], edges({ A: ['B', 'C'], B: ['D'], C: ['E'], E: ['D'] }))
    expect(g.pos.get('E')!.row).toBe(1) // directly above D
    expect(g.pos.get('C')!.row).toBe(0) // above E
    expect(g.pos.get('C')!.col).toBe(g.pos.get('E')!.col) // one vertical column
    expect(g.pos.get('E')!.col).not.toBe(0) // off the spine
  })

  it('Baccano: three POV feeders merge up into main3, flanking the centered spine on both sides', () => {
    // spine m1→m2→m3; pov1,pov2,pov3 each → m3 (so m3 parents = {m2,pov1,pov2,pov3})
    const g = cellLayout(
      ['m1', 'm2', 'm3'],
      ['m1', 'm2', 'm3', 'pov1', 'pov2', 'pov3'],
      edges({ m1: ['m2'], m2: ['m3'], pov1: ['m3'], pov2: ['m3'], pov3: ['m3'] })
    )
    // spine centered
    expect(g.pos.get('m2')).toEqual({ row: 1, col: 0 })
    expect(g.pos.get('m3')).toEqual({ row: 2, col: 0 })
    // every pov feeds m3 (row 2) → merge-up puts them at row 1 (directly above m3)
    for (const p of ['pov1', 'pov2', 'pov3']) expect(g.pos.get(p)!.row).toBe(1)
    // …in three DISTINCT side columns, none on the spine
    const cols = ['pov1', 'pov2', 'pov3'].map((p) => g.pos.get(p)!.col)
    expect(new Set(cols).size).toBe(3)
    expect(cols).not.toContain(0)
    // flank BOTH sides of the centered spine (at least one negative, one positive)
    expect(Math.min(...cols)).toBeLessThan(0)
    expect(Math.max(...cols)).toBeGreaterThan(0)
    expect(g.merges.has('m3')).toBe(true)
  })

  it('an author OVERRIDE pins a node and auto-layout flows around it', () => {
    const g = cellLayout(
      ['A', 'B', 'D'],
      ['A', 'B', 'D', 'C'],
      edges({ A: ['B', 'C'], B: ['D'], C: ['D'] }),
      new Map([['C', { row: 1, col: 2 }]])
    )
    expect(g.pos.get('C')).toEqual({ row: 1, col: 2 }) // pinned exactly where dragged
  })

  it('a fully isolated scene stacks below the diagram (never dropped)', () => {
    const g = cellLayout(['A', 'B'], ['A', 'B', 'X'], edges({ A: ['B'] }))
    expect(g.pos.has('X')).toBe(true)
    expect(g.pos.get('X')!.row).toBeGreaterThanOrEqual(2)
  })
})

describe('routeThrough (Cell view route coloring)', () => {
  const ids = ['A', 'B', 'C', 'D', 'E']
  // A→B→D spine; A→C→E→D side path
  const adj = { A: ['B', 'C'], B: ['D'], C: ['E'], E: ['D'] }
  it('a mid-node returns the full root→leaf route passing through it', () => {
    expect(routeThrough('C', ids, edges(adj))).toEqual(['A', 'C', 'E', 'D'])
  })
  it('the node appears exactly once (fork joins ancestry + descendants)', () => {
    const r = routeThrough('B', ids, edges(adj))
    expect(r.filter((x) => x === 'B')).toHaveLength(1)
    expect(r[0]).toBe('A') // starts at a root
    expect(r[r.length - 1]).toBe('D') // ends at a leaf
  })
  it('a cycle does not hang and still returns a path containing the node', () => {
    const r = routeThrough('a', ['a', 'b'], edges({ a: ['b'], b: ['a'] }))
    expect(r).toContain('a')
  })
})

describe('pickSpine (Cell view spine choice)', () => {
  const all = ['a', 'b', 'c', 'd', 'e']
  const trunk = ['a', 'b', 'c', 'd'] // the auto graph trunk
  it('a tiny curated axis does NOT hijack the spine — the trunk wins', () => {
    // the Genshin bug: a 2-of-5 saved axis must not exile the other scenes to flanking columns
    expect(pickSpine(['a', 'e'], trunk, all)).toEqual(trunk)
  })
  it('a saved backbone that covers the trunk becomes the spine', () => {
    const fullOrder = ['a', 'b', 'c', 'd', 'e']
    expect(pickSpine(fullOrder, trunk, all)).toEqual(fullOrder)
  })
  it('no real trunk (no edges) falls back to all ids in order', () => {
    expect(pickSpine([], [], all)).toEqual(all)
  })
  it('a single-element saved sequence is ignored (not a backbone)', () => {
    expect(pickSpine(['a'], trunk, all)).toEqual(trunk)
  })
})
