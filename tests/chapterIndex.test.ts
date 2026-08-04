/**
 * Locks the FORMAT-AGNOSTIC chapter resolver — the root cause of the 2026-06-26 coherence-map saga
 * (the old `c<digit>` regex only fit office-drama; Hamlet's evidence was chapter NAMES, etc.). If a future
 * change reintroduces a format assumption, these fail loudly. See decisions.md D2.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { buildChapterIndex, cleanChapterName } from '../src/renderer/lib/analysis/chapterIndex'
import type { StoryNode } from '../src/shared/ipc'

const scene = (sceneId: string, name: string, rel: string): StoryNode => ({
  type: 'scene',
  name,
  relPath: rel,
  path: '/' + rel,
  sceneId
})

// A Hamlet-style tree: a `chapters/` folder holding `001-act-i`, `005-act-v`, each holding scenes.
const tree: StoryNode[] = [
  {
    type: 'folder',
    name: 'chapters',
    relPath: 'chapters',
    path: '/chapters',
    children: [
      {
        type: 'folder',
        name: '001-act-i',
        relPath: 'chapters/001-act-i',
        path: '/chapters/001-act-i',
        children: [
          scene('hamlet-a1-s1', 'Elsinore', 'chapters/001-act-i/hamlet-a1-s1.md'),
          scene('hamlet-a1-s2', 'A room of state', 'chapters/001-act-i/hamlet-a1-s2.md')
        ]
      },
      {
        type: 'folder',
        name: '005-act-v',
        relPath: 'chapters/005-act-v',
        path: '/chapters/005-act-v',
        children: [scene('hamlet-a5-s1', 'A churchyard', 'chapters/005-act-v/hamlet-a5-s1.md')]
      }
    ]
  }
]

describe('buildChapterIndex.resolveKey — every evidence/asOf shape resolves to a chapter key', () => {
  const ix = buildChapterIndex(tree)

  it('a SCENE id → its enclosing chapter folder', () => {
    expect(ix.resolveKey('hamlet-a1-s1')).toBe('chapters/001-act-i')
    expect(ix.resolveKey('hamlet-a5-s1')).toBe('chapters/005-act-v')
  })

  it('a BARE chapter name → the chapter key (folder-name / path tail)', () => {
    expect(ix.resolveKey('001-act-i')).toBe('chapters/001-act-i')
    expect(ix.resolveKey('005-act-v')).toBe('chapters/005-act-v')
  })

  it('a PREFIXED chapter unit-id (c:chapters/005-act-v) → the chapter key', () => {
    expect(ix.resolveKey('c:chapters/005-act-v')).toBe('chapters/005-act-v')
    expect(ix.resolveKey('c:chapters/001-act-i')).toBe('chapters/001-act-i')
  })

  it('an UNRESOLVABLE ref → undefined (so callers can drop it)', () => {
    expect(ix.resolveKey('who-knows')).toBeUndefined()
    expect(ix.resolveKey('')).toBeUndefined()
  })

  it('chapters carry a clean title (ordering prefix stripped) + their scene ids', () => {
    expect(ix.chapters.get('chapters/001-act-i')).toEqual({
      title: 'act-i',
      sceneIds: ['hamlet-a1-s1', 'hamlet-a1-s2']
    })
  })

  it('sceneChapter maps each scene id → its folder', () => {
    expect(ix.sceneChapter.get('hamlet-a1-s2')).toBe('chapters/001-act-i')
    expect(ix.sceneChapter.size).toBe(3)
  })
})

// The office-drama shape (the 2026-07 "dots pile at the right" bug): folders "001-C1".."004-C4", but the
// coherence analysis references a chapter by its `chapter:` LABEL ("C2") and as_of as "c:C4" — the SAME text
// the band header shows, NOT a scene id or the folder relPath. Threads key on scene-id so they never hit this;
// coherence keyed on the label, which had no bridge → every finding collapsed to the as_of checkpoint.
const officeTree: StoryNode[] = [
  {
    type: 'folder',
    name: 'chapters',
    relPath: 'chapters',
    path: '/chapters',
    children: [
      { type: 'folder', name: '001-C1', relPath: 'chapters/001-C1', path: '/chapters/001-C1', children: [scene('od-c1-s1', 'All-hands', 'chapters/001-C1/s1.md')] },
      { type: 'folder', name: '002-C2', relPath: 'chapters/002-C2', path: '/chapters/002-C2', children: [scene('od-c2-s7', 'Draft One', 'chapters/002-C2/s7.md')] },
      { type: 'folder', name: '004-C4', relPath: 'chapters/004-C4', path: '/chapters/004-C4', children: [scene('od-c4-s22', 'The Keystone', 'chapters/004-C4/s22.md')] }
    ]
  }
]

describe('resolveKey — the chapter-LABEL bridge (office-drama "dots pile right" fix)', () => {
  const ix = buildChapterIndex(officeTree)

  it('a bare chapter LABEL ("C2") resolves to its folder', () => {
    expect(ix.resolveKey('C2')).toBe('chapters/002-C2') // was undefined → finding fell back to as_of (far right)
    expect(ix.resolveKey('C1')).toBe('chapters/001-C1')
  })

  it('the as_of checkpoint form "c:C4" resolves to its folder', () => {
    expect(ix.resolveKey('c:C4')).toBe('chapters/004-C4')
  })

  it('is case-insensitive on the label', () => {
    expect(ix.resolveKey('c2')).toBe('chapters/002-C2')
  })

  it('still drops a truly unknown chapter (so callers can annotate it off-route)', () => {
    expect(ix.resolveKey('C9')).toBeUndefined()
  })

  it('a scene id and the folder name still resolve (no regression)', () => {
    expect(ix.resolveKey('od-c4-s22')).toBe('chapters/004-C4')
    expect(ix.resolveKey('002-C2')).toBe('chapters/002-C2')
  })
})

describe('cleanChapterName — strip the disk-ordering prefix', () => {
  it('drops a leading "NN-" / "NN." / "NN " prefix', () => {
    expect(cleanChapterName('001-act-i')).toBe('act-i')
    expect(cleanChapterName('12. Chapter')).toBe('Chapter')
  })
  it('leaves a name that has no numeric prefix', () => {
    expect(cleanChapterName('act-i')).toBe('act-i')
  })
})
