/**
 * Stable folder identity — the scene_id of folders. A folder gets a `.id` stamped once (at creation or first
 * tree read); the id SURVIVES rename/move (the dotfile travels), and a duplicated folder (copy-paste carries a
 * cloned `.id`) gets re-stamped so two folders never share an identity. Ingest keys chapter units `c:<folderId>`.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFolder, listStoryTree, renamePath } from '../src/engine/content/storyTree'

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'nvs-fid-'))
  mkdirSync(join(root, 'content', 'story'), { recursive: true })
  return root
}

const folder = (root: string, name: string) => listStoryTree(root).find((n) => n.type === 'folder' && n.name === name)

describe('stable folder identity (.id)', () => {
  it('createFolder stamps an id; legacy folders get stamped on first tree read', () => {
    const root = project()
    try {
      createFolder(root, '', 'Act One')
      expect(existsSync(join(root, 'content', 'story', 'Act One', '.id'))).toBe(true)

      // a legacy folder made outside the app (no .id) gets stamped by listStoryTree
      mkdirSync(join(root, 'content', 'story', 'Legacy'))
      const legacy = folder(root, 'Legacy')
      expect(legacy?.folderId).toBeTruthy()
      expect(readFileSync(join(root, 'content', 'story', 'Legacy', '.id'), 'utf8').trim()).toBe(legacy!.folderId)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('the id survives a rename (identity ≠ path)', () => {
    const root = project()
    try {
      createFolder(root, '', 'Chapter 1')
      const before = folder(root, 'Chapter 1')!.folderId
      expect(renamePath(root, 'Chapter 1', 'Chapter One')).toBe(true)
      expect(folder(root, 'Chapter One')!.folderId).toBe(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a duplicated folder (cloned .id) is re-stamped — no shared identity', () => {
    const root = project()
    try {
      createFolder(root, '', 'Orig')
      cpSync(join(root, 'content', 'story', 'Orig'), join(root, 'content', 'story', 'Copy'), { recursive: true })
      const tree = listStoryTree(root)
      const ids = tree.filter((n) => n.type === 'folder').map((n) => n.folderId)
      expect(ids).toHaveLength(2)
      expect(new Set(ids).size).toBe(2) // distinct
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
