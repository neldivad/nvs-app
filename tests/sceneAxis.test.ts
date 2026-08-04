import { describe, it, expect } from 'vitest'
import { routeScenes } from '../src/renderer/lib/timeline/sceneAxis'

const S = (id: string): { sceneId: string } => ({ sceneId: id })

describe('sceneAxis — routeScenes (self-heal a saved sequence)', () => {
  it('resolves a route in saved order, dropping drifted scene_ids', () => {
    const scenes = [S('a'), S('b'), S('c')]
    expect(routeScenes(scenes, ['c', 'a', 'gone']).map((s) => s.sceneId)).toEqual(['c', 'a']) // order kept, 'gone' dropped
  })

  it('returns EMPTY when the whole route is stale (old project) → caller falls back to auto', () => {
    expect(routeScenes([S('a'), S('b')], ['x', 'y'])).toEqual([])
  })

  it('empty path → empty (no route active)', () => {
    expect(routeScenes([S('a')], [])).toEqual([])
  })
})
