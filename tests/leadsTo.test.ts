/**
 * Locks the timeline `leads_to` cycle guard — the store calls `reaches` to REFUSE a connection that would
 * loop (scenes are a DAG). A regression here either lets a cycle in (timeline/analysis walks could spin) or
 * blocks valid links. Includes a cyclic-data case to prove the visited-set prevents an infinite loop.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { sceneIndex, reaches } from '../src/renderer/lib/timeline/leadsTo'
import type { StoryNode } from '../src/shared/ipc'

const scene = (sceneId: string, leadsTo: string[] = []): StoryNode => ({
  type: 'scene',
  name: sceneId,
  relPath: sceneId,
  path: '/' + sceneId,
  sceneId,
  leadsTo
})

// s1 → s2 → s3 (a simple chain, nested in a folder to exercise the walk).
const tree: StoryNode[] = [
  { type: 'folder', name: 'ch', relPath: 'ch', path: '/ch', children: [scene('s1', ['s2']), scene('s2', ['s3']), scene('s3')] }
]
const ix = sceneIndex(tree)

describe('sceneIndex — flatten scenes (incl. nested) by sceneId', () => {
  it('maps every scene and keeps its leads_to', () => {
    expect(ix.size).toBe(3)
    expect(ix.get('s2')?.leadsTo).toEqual(['s3'])
  })
})

describe('reaches — can `target` reach `from` via leads_to?', () => {
  it('finds a transitive path (s1 → s2 → s3)', () => {
    expect(reaches(ix, 's1', 's3')).toBe(true)
    expect(reaches(ix, 's2', 's3')).toBe(true)
  })

  it('returns false when there is no path (s3 has no outgoing edge)', () => {
    expect(reaches(ix, 's3', 's1')).toBe(false)
  })

  it('target === from is reachable (would be a self-loop)', () => {
    expect(reaches(ix, 's1', 's1')).toBe(true)
  })

  it('the cycle-guard verdict: linking s3 → s1 would loop (s1 already reaches s3)', () => {
    // store guard: before adding `from → target`, refuse if reaches(index, target, from).
    expect(reaches(ix, /* target */ 's1', /* from */ 's3')).toBe(true)
  })

  it('terminates on already-cyclic data (visited-set guard, no infinite loop)', () => {
    const cyclic = sceneIndex([scene('a', ['b']), scene('b', ['a'])])
    expect(reaches(cyclic, 'a', 'missing')).toBe(false)
  })
})
