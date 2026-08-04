/**
 * Typed scene containers — a folder created with a container kind persists a `.type` dotfile, and the story tree
 * reads it back as `containerType` (which ingest maps to narrative_units.type). Untyped folders stay undefined.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFolder, listStoryTree, writeFolderType } from '../src/engine/content/storyTree'

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'nvs-story-'))
  mkdirSync(join(root, 'content', 'story'), { recursive: true })
  return root
}

describe('typed scene containers', () => {
  it('createFolder with a type persists it; listStoryTree reads it back', () => {
    const root = project()
    try {
      expect(createFolder(root, '', 'Act One', 'act')).toBe('Act One')
      expect(createFolder(root, '', 'Loose', undefined)).toBe('Loose') // untyped

      const tree = listStoryTree(root)
      const act = tree.find((n) => n.name === 'Act One')
      const loose = tree.find((n) => n.name === 'Loose')
      expect(act?.containerType).toBe('act')
      expect(loose?.containerType).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('writeFolderType can set and clear a folder kind', () => {
    const root = project()
    try {
      createFolder(root, '', 'Ch', undefined)
      const dir = join(root, 'content', 'story', 'Ch')
      writeFolderType(dir, 'chapter')
      expect(listStoryTree(root).find((n) => n.name === 'Ch')?.containerType).toBe('chapter')
      writeFolderType(dir, null) // clear
      expect(listStoryTree(root).find((n) => n.name === 'Ch')?.containerType).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
