/**
 * New folders/scenes land at the TOP of a manually-ordered parent (where the inline "new…" input appears),
 * not the bottom. In a natural-sort folder (no manual .order) the new name keeps its alphanumeric place.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFolder, createSceneInFolder, setOrder, renamePath, listStoryTree } from '../src/engine/content/storyTree'

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'nvs-order-'))
  mkdirSync(join(root, 'content', 'story'), { recursive: true })
  return root
}
const childNames = (root: string, folder: string): string[] =>
  (listStoryTree(root).find((n) => n.name === folder)?.children ?? []).map((c) => c.name)

describe('new items land at the top of a manually-ordered folder', () => {
  it('a new folder is prepended to the parent’s manual order', () => {
    const root = project()
    try {
      createFolder(root, '', 'Book', undefined)
      createFolder(root, 'Book', 'ch-a')
      createFolder(root, 'Book', 'ch-b')
      setOrder(root, 'Book', ['ch-a', 'ch-b']) // freeze a manual order
      createFolder(root, 'Book', 'ch-new')
      expect(childNames(root, 'Book')).toEqual(['ch-new', 'ch-a', 'ch-b'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a new scene is prepended to the parent’s manual order too', () => {
    const root = project()
    try {
      createFolder(root, '', 'Book', undefined)
      createSceneInFolder(root, 'Book', 's-a', {}, 'a')
      createSceneInFolder(root, 'Book', 's-b', {}, 'b')
      setOrder(root, 'Book', ['s-a.md', 's-b.md'])
      createSceneInFolder(root, 'Book', 's-new', {}, 'new')
      expect(childNames(root, 'Book')[0]).toBe('s-new')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a natural-sort folder (no manual order) keeps the new name’s alphanumeric place — NOT forced to top', () => {
    const root = project()
    try {
      createFolder(root, '', 'Nat', undefined)
      createFolder(root, 'Nat', 'a')
      createFolder(root, 'Nat', 'c')
      createFolder(root, 'Nat', 'b') // no setOrder → alphanumeric
      expect(childNames(root, 'Nat')).toEqual(['a', 'b', 'c'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('renaming a folder in a natural-sort parent keeps its position (does NOT re-sort alphanumerically)', () => {
    const root = project()
    try {
      createFolder(root, '', 'Book', undefined)
      createFolder(root, 'Book', 'a-intro')
      createFolder(root, 'Book', 'b-rising')
      createFolder(root, 'Book', 'c-climax') // no manual order → alphanumeric a,b,c
      // Rename the middle one to a name that would sort LAST — it must stay in the middle, not jump to the end.
      renamePath(root, 'Book/b-rising', 'Book/z-rising')
      expect(childNames(root, 'Book')).toEqual(['a-intro', 'z-rising', 'c-climax'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('renaming preserves position in a manually-ordered parent too', () => {
    const root = project()
    try {
      createFolder(root, '', 'Book', undefined)
      createFolder(root, 'Book', 'ch-a')
      createFolder(root, 'Book', 'ch-b')
      createFolder(root, 'Book', 'ch-c')
      setOrder(root, 'Book', ['ch-c', 'ch-a', 'ch-b']) // deliberate non-alphanumeric order
      renamePath(root, 'Book/ch-a', 'Book/ch-z')
      expect(childNames(root, 'Book')).toEqual(['ch-c', 'ch-z', 'ch-b'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rename SANITISES a filesystem-unsafe name (colon → dash) instead of rejecting — and a MOVE keeps the name', () => {
    const root = project()
    try {
      createFolder(root, '', 'Book', undefined)
      createFolder(root, 'Book', 'ch-a')
      createFolder(root, 'Book', 'sub')
      // Colon (Windows-invalid) is rewritten to the FS-safe standard, not blocked — the rename succeeds and the
      // on-disk folder is the sanitised name (a collaborator on Windows can still open it).
      expect(renamePath(root, 'Book/ch-a', 'Book/Act II: Requiem')).toBe(true)
      expect(childNames(root, 'Book')).toContain('Act II- Requiem')
      // A MOVE into another folder keeps the (already-valid) name — sanitising only fires on a name change.
      expect(renamePath(root, 'Book/Act II- Requiem', 'Book/sub/Act II- Requiem')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
