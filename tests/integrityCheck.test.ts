import { describe, it, expect } from 'vitest'
import { checkIntegrity } from '../src/shared/integrity'
import type { StoryNode } from '../src/shared/ipc'

const scene = (p: Partial<StoryNode> & { name: string }): StoryNode => ({
  type: 'scene',
  relPath: `chapters/${p.name}`,
  path: `/w/content/story/chapters/${p.name}.md`,
  ...p
})
const folder = (name: string, children: StoryNode[]): StoryNode => ({ type: 'folder', name, relPath: name, path: `/w/${name}`, children })

describe('checkIntegrity', () => {
  it('passes a clean linear work', () => {
    const tree = [folder('c1', [scene({ name: 's1', sceneId: 'a', leadsTo: ['b'] }), scene({ name: 's2', sceneId: 'b', leadsTo: [] })])]
    expect(checkIntegrity(tree)).toEqual([])
  })

  it('flags a duplicate scene_id on BOTH offending scenes as errors', () => {
    const tree = [scene({ name: 's1', sceneId: 'dup' }), scene({ name: 's2', sceneId: 'dup' })]
    const dups = checkIntegrity(tree).filter((i) => i.kind === 'duplicate-id')
    expect(dups).toHaveLength(2)
    expect(dups.every((i) => i.severity === 'error')).toBe(true)
  })

  it('flags a dangling leads_to (target is not a scene)', () => {
    const tree = [scene({ name: 's1', sceneId: 'a', leadsTo: ['ghost'] }), scene({ name: 's2', sceneId: 'b' })]
    const iss = checkIntegrity(tree)
    expect(iss.some((i) => i.kind === 'dangling-leads-to' && i.severity === 'error')).toBe(true)
  })

  it('does NOT false-positive when leads_to resolves to a filename-anchored scene (sceneId ?? name)', () => {
    // s2 has no scene_id → the timeline resolves it by `name` ('s2'); an edge to 's2' must be considered valid.
    const tree = [scene({ name: 's1', sceneId: 'a', leadsTo: ['s2'] }), scene({ name: 's2' })]
    expect(checkIntegrity(tree).some((i) => i.kind === 'dangling-leads-to')).toBe(false)
  })

  it('flags a self-referential leads_to as a warning', () => {
    const tree = [scene({ name: 's1', sceneId: 'a', leadsTo: ['a'] })]
    const iss = checkIntegrity(tree)
    expect(iss.some((i) => i.kind === 'self-leads-to' && i.severity === 'warn')).toBe(true)
  })

  it('notes a missing scene_id as info (filename-anchored fragility)', () => {
    const tree = [scene({ name: 's1' })]
    const iss = checkIntegrity(tree)
    expect(iss).toHaveLength(1)
    expect(iss[0]).toMatchObject({ kind: 'missing-id', severity: 'info' })
  })

  it('sorts errors before warnings before info', () => {
    const tree = [
      scene({ name: 's0' }), // missing-id (info)
      scene({ name: 's1', sceneId: 'a', leadsTo: ['a', 'ghost'] }), // self (warn) + dangling (error)
    ]
    const sev = checkIntegrity(tree).map((i) => i.severity)
    expect(sev).toEqual([...sev].sort((a, b) => ({ error: 0, warn: 1, info: 2 })[a] - ({ error: 0, warn: 1, info: 2 })[b]))
    expect(sev[0]).toBe('error')
  })

  // ── v2: orphan checks ──────────────────────────────────────────────────────
  it('flags an orphan scene ONLY when the timeline is wired (never in a purely-linear work)', () => {
    // purely linear (no leads_to at all) → nothing is "isolated"
    const linear = [scene({ name: 's1', sceneId: 'a' }), scene({ name: 's2', sceneId: 'b' })]
    expect(checkIntegrity(linear).some((i) => i.kind === 'orphan-scene')).toBe(false)
    // wired (a→b) with a loose 'c' → c is the orphan
    const wired = [scene({ name: 's1', sceneId: 'a', leadsTo: ['b'] }), scene({ name: 's2', sceneId: 'b' }), scene({ name: 's3', sceneId: 'c' })]
    const orphans = checkIntegrity(wired).filter((i) => i.kind === 'orphan-scene')
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ severity: 'info', title: 's3' })
  })

  it('flags a character page that never appears in any scene (needs graph + worldPages)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph: any = { scenes: { a: { sceneId: 'a', cast: [{ entityId: 'hero' }] } }, edges: [] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages: any = [
      { id: 'hero', name: 'Hero', path: '/w/world/characters/hero.md', kind: 'character' },
      { id: 'ghost', name: 'Ghost', path: '/w/world/characters/ghost.md', kind: 'character' },
      { id: 'ghost2', name: 'Archived', path: '/w/world/characters/a.md', kind: 'character', phase: 'archived' } // archived → skipped
    ]
    const orphans = checkIntegrity([scene({ name: 's1', sceneId: 'a' })], { graph, worldPages: pages }).filter((i) => i.kind === 'orphan-page')
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ title: 'Ghost', pageKind: 'character', severity: 'info' })
  })

  it('does not run orphan-page without graph/worldPages (backward-compatible)', () => {
    expect(checkIntegrity([scene({ name: 's1', sceneId: 'a' })]).some((i) => i.kind === 'orphan-page')).toBe(false)
  })
})
