import { describe, it, expect } from 'vitest'
import { leadsToEdges, hasEdges, graphAncestors, detectCycle, graphVersion, routeEdges, adjacencyToEdges, type Edges } from '../src/engine/analysis/timelineGraph'

const E = (o: Record<string, string[]>): Edges => new Map(Object.entries(o))

describe('timelineGraph — graphAncestors', () => {
  it('linear A→B→C: ancestors are the earlier scenes, in order', () => {
    const g = E({ A: ['B'], B: ['C'], C: [] })
    expect(graphAncestors(g, 'C')).toEqual(['A', 'B'])
    expect(graphAncestors(g, 'A')).toEqual([])
  })

  it('branch A→B, A→C: parallel branches do NOT see each other', () => {
    const g = E({ A: ['B', 'C'], B: [], C: [] })
    expect(graphAncestors(g, 'B')).toEqual(['A'])
    expect(graphAncestors(g, 'C')).toEqual(['A'])
    expect(graphAncestors(g, 'B')).not.toContain('C') // no false adjacency
  })

  it('MERGE (Baccano): two POVs converge → the merge scene sees the UNION of both', () => {
    const g = E({ POVa: ['M'], POVb: ['M'], M: [] }) // two branches, one join
    const anc = graphAncestors(g, 'M')
    expect(new Set(anc)).toEqual(new Set(['POVa', 'POVb'])) // union of incoming branches
    expect(graphAncestors(g, 'POVa')).toEqual([]) // a branch head has no ancestors
  })

  it('diamond A→B→D, A→C→D: all upstream, D excluded, A ranks first', () => {
    const g = E({ A: ['B', 'C'], B: ['D'], C: ['D'], D: [] })
    const anc = graphAncestors(g, 'D')
    expect(new Set(anc)).toEqual(new Set(['A', 'B', 'C']))
    expect(anc[0]).toBe('A') // BFS-rank: root before its descendants
    expect(anc).not.toContain('D')
  })
})

describe('timelineGraph — cycle guard', () => {
  it('detects a leads_to cycle (A→B→A)', () => {
    expect(detectCycle(E({ A: ['B'], B: ['A'] }))).not.toBeNull()
  })
  it('a clean DAG has no cycle', () => {
    expect(detectCycle(E({ A: ['B', 'C'], B: ['D'], C: ['D'], D: [] }))).toBeNull()
  })
})

describe('timelineGraph — edges + version', () => {
  it('leadsToEdges parses string | array and drops edges to unknown scenes', () => {
    const g = leadsToEdges([
      { id: 'A', metadata_json: JSON.stringify({ leads_to: 'B' }) },
      { id: 'B', metadata_json: JSON.stringify({ leads_to: ['C', 'GONE'] }) }, // GONE not a scene → dropped
      { id: 'C', metadata_json: null },
    ])
    expect(g.get('A')).toEqual(['B'])
    expect(g.get('B')).toEqual(['C'])
    expect(hasEdges(g)).toBe(true)
  })
  it('graphVersion is stable for the same graph and changes when an edge changes', () => {
    const a = graphVersion(E({ A: ['B'], B: [] }))
    expect(graphVersion(E({ A: ['B'], B: [] }))).toBe(a) // stable
    expect(graphVersion(E({ A: ['C'], B: [] }))).not.toBe(a) // edit → new version
  })
})

// The seed+routes resolver (R1): a route owns its edges/scope, else falls back to the frontmatter SEED.
const S = (id: string, leads?: string | string[]): { id: string; metadata_json: string | null } => ({
  id,
  metadata_json: leads == null ? null : JSON.stringify({ leads_to: leads })
})

describe('timelineGraph — routeEdges (seed + routes)', () => {
  it('no route → the SEED: identical to leadsToEdges over the frontmatter', () => {
    const scenes = [S('a1', 'a2'), S('a2'), S('b1')]
    const { edges, scope } = routeEdges(undefined, scenes)
    expect(edges.get('a1')).toEqual(['a2']) // from frontmatter leads_to
    expect([...scope].sort()).toEqual(['a1', 'a2', 'b1']) // frontier = every scene
  })

  it('variantB owns its edges: prologue D MERGES into B (frontmatter ignored)', () => {
    const scenes = [S('a1', 'a2'), S('a2'), S('b1'), S('b2'), S('c1'), S('d1')] // frontmatter irrelevant when edges are given
    const variantB = { edges: [['a1', 'b1'], ['d1', 'b1'], ['b1', 'b2']] as [string, string][], scope: ['a1', 'b1', 'b2', 'd1'] }
    const { edges, scope } = routeEdges(variantB, scenes)
    expect(graphAncestors(edges, 'b2').sort()).toEqual(['a1', 'b1', 'd1']) // the merge scene's story-so-far = UNION incl. D
    expect([...scope].sort()).toEqual(['a1', 'b1', 'b2', 'd1']) // frontier excludes a2, c1
  })

  it('variantC over the SAME scenes does NOT see D (route-specific merge)', () => {
    const scenes = [S('a1', 'a2'), S('a2'), S('b1'), S('b2'), S('c1'), S('d1')]
    const variantC = { edges: [['a1', 'c1']] as [string, string][], scope: ['a1', 'c1'] }
    const { edges } = routeEdges(variantC, scenes)
    expect(graphAncestors(edges, 'c1')).toEqual(['a1']) // no D, no B
    expect(edges.has('d1')).toBe(false) // out of scope → absent
  })

  it('an edge to an out-of-scope scene drops (self-healing)', () => {
    const scenes = [S('a1'), S('b1'), S('d1')]
    const { edges } = routeEdges({ edges: [['a1', 'b1'], ['d1', 'b1']], scope: ['a1', 'b1'] }, scenes)
    expect(edges.has('d1')).toBe(false)
    expect(graphAncestors(edges, 'b1')).toEqual(['a1']) // d1→b1 dropped (d1 excluded)
  })

  it('SEED + scope: excluding a linearly-inserted scene disconnects the chain (the documented gap)', () => {
    const scenes = [S('a1', 'z1'), S('z1', 'a2'), S('a2')] // linear seed a1→z1→a2 in frontmatter
    const { edges } = routeEdges({ scope: ['a1', 'a2'] }, scenes) // drop the side scene z1
    expect(edges.has('z1')).toBe(false)
    expect(edges.get('a1')).toEqual([]) // a1→z1 dropped, no bridge → a1 and a2 disconnected (needs rewire or bridging)
  })
})

describe('timelineGraph — adjacencyToEdges (tree variant → Edges)', () => {
  it('converts adjacency into the Edges map (feeds graphAncestors)', () => {
    const e = adjacencyToEdges({ a: ['b'], b: ['c'] })
    expect(e.get('a')).toEqual(['b'])
    expect(graphAncestors(e, 'c')).toEqual(['a', 'b'])
  })

  it('with a known-set: seeds every scene as a key + DROPS edges to unknown scenes (delete self-heal)', () => {
    const e = adjacencyToEdges({ a: ['b', 'c'], b: ['c'] }, new Set(['a', 'b'])) // c was deleted
    expect(e.get('a')).toEqual(['b']) // edge to deleted c dropped
    expect(e.has('c')).toBe(false)
    expect(e.get('b')).toEqual([]) // b's only edge was to c → isolated, still a key
  })

  it('drops an edge FROM a deleted scene, dedups, no self-loops', () => {
    const e = adjacencyToEdges({ a: ['b', 'b', 'a'], z: ['a'] }, new Set(['a', 'b'])) // z deleted; dup b; self a→a
    expect(e.get('a')).toEqual(['b'])
    expect(e.has('z')).toBe(false)
  })
})
