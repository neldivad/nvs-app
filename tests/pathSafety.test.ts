/**
 * Locks the path-safety guards on the story-tree mutations (rename / create / delete / reorder all run a
 * user-supplied relative path through `safeRel`, and typed names through `validName`). These are the fence
 * that keeps a path from escaping content/story — a regression here is a traversal/write-outside bug, so it
 * must fail loudly.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { safeRel, validName } from '../src/engine/content/storyTree'

describe('safeRel — only in-bounds relative paths survive', () => {
  it('normalizes a valid nested path', () => {
    expect(safeRel('chapters/001-act-i')).toBe('chapters/001-act-i')
    expect(safeRel('/chapters/001-act-i/')).toBe('chapters/001-act-i') // trims leading/trailing slashes
    expect(safeRel('chapters\\001-act-i')).toBe('chapters/001-act-i') // backslashes → forward
  })

  it('REJECTS traversal + degenerate segments → null', () => {
    for (const bad of ['..', '../secrets', 'chapters/../../etc', 'chapters/./x', 'a//b', '']) {
      expect(safeRel(bad)).toBeNull()
    }
  })
})

describe('validName — a single typed folder/scene segment', () => {
  it('accepts ordinary names', () => {
    expect(validName('A Room in the Castle')).toBe(true)
    expect(validName('001-act-i')).toBe(true)
  })

  it('rejects empties, dots, and path/forbidden chars', () => {
    for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a<b', 'a>b', 'a|b', 'a?b', 'a*b', 'a"b']) {
      expect(validName(bad)).toBe(false)
    }
  })
})
