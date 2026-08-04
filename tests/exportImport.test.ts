/**
 * Locks the pure helpers of the export/import bundle (the zip/DB round-trip is verified in-app — better-sqlite3
 * can't run under vitest). `buildManifest` shapes the .nvsproj manifest; `uniqueWorkName` dedupes the import
 * target folder against the library, like the welcome grid expects.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import { readFileSync, existsSync } from 'node:fs'
import { setLibraryRoot } from '../src/engine/io/library'
import { buildManifest, uniqueWorkName, isSafeRel, zipFolderName, exportManuscriptZip, isInsideWork, exportSceneFile, forkProject } from '../src/engine/io/exportImport'

describe('buildManifest — the .nvsproj manifest shape', () => {
  it('stamps the core fields and nulls the lineage (v1 = export+import only)', () => {
    const m = buildManifest({ workId: 'shakespeare-hamlet', title: 'Hamlet', schemaVersion: '010_thread_title.sql', appVersion: '0.0.0', exportedAt: '2026-07-01T00:00:00Z' })
    expect(m).toMatchObject({ nvsproj: 1, workId: 'shakespeare-hamlet', title: 'Hamlet', schemaVersion: '010_thread_title.sql', appVersion: '0.0.0' })
    expect(m.forkedFrom).toBeNull()
    expect(m.coverOf).toBeNull()
    expect(m.promptSource).toBeNull()
  })
})

describe('uniqueWorkName — dedupe the import target against the library', () => {
  it('keeps the title when free', () => {
    expect(uniqueWorkName('Hamlet', ['Macbeth'])).toBe('Hamlet')
  })

  it('appends " (n)" on a collision, skipping taken numbers', () => {
    expect(uniqueWorkName('Hamlet', ['Hamlet'])).toBe('Hamlet (2)')
    expect(uniqueWorkName('Hamlet', ['Hamlet', 'Hamlet (2)'])).toBe('Hamlet (3)')
  })

  it('sanitizes path separators and falls back when empty', () => {
    expect(uniqueWorkName('a/b\\c', [])).toBe('a-b-c')
    expect(uniqueWorkName('   ', [])).toBe('Imported Project')
  })
})

describe('zipFolderName — the single top folder inside a manuscript .zip', () => {
  it('uses the title, sanitizes separators, and falls back when empty', () => {
    expect(zipFolderName('Hamlet')).toBe('Hamlet')
    expect(zipFolderName('a/b\\c')).toBe('a-b-c')
    expect(zipFolderName('   ')).toBe('Manuscript')
  })
})

describe('exportManuscriptZip — content/ → a plain .zip (no analysis)', () => {
  it('zips the prose + assets under one title folder, omitting the .nvs DB', () => {
    const root = mkdtempSync(join(tmpdir(), 'nvs-zip-'))
    try {
      mkdirSync(join(root, 'content', 'story'), { recursive: true })
      mkdirSync(join(root, 'content', 'assets'), { recursive: true })
      mkdirSync(join(root, '.nvs'), { recursive: true })
      writeFileSync(join(root, 'content', 'story', 's1.md'), '# Scene One')
      writeFileSync(join(root, 'content', 'assets', 'cover.jpg'), 'JPEGBYTES')
      writeFileSync(join(root, '.nvs', 'project.json'), JSON.stringify({ title: 'My Book' }))
      writeFileSync(join(root, '.nvs', 'nvs.db'), 'SHOULD-NOT-BE-IN-ZIP')

      const out = join(root, 'out.zip')
      const res = exportManuscriptZip(root, out)
      expect(res.ok).toBe(true)

      const names = new AdmZip(out).getEntries().map((e) => e.entryName).sort()
      // nested under the title folder; analysis DB excluded
      expect(names).toContain('My Book/story/s1.md')
      expect(names).toContain('My Book/assets/cover.jpg')
      expect(names.some((n) => n.includes('nvs.db'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails cleanly when there is no content/', () => {
    const root = mkdtempSync(join(tmpdir(), 'nvs-zip-'))
    try {
      const res = exportManuscriptZip(root, join(root, 'out.zip'))
      expect(res.ok).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('isInsideWork — the single-scene export containment guard', () => {
  it('accepts a scene under the work root, rejects escapes and the root itself', () => {
    expect(isInsideWork('/lib/Book', '/lib/Book/content/story/s1.md')).toBe(true)
    expect(isInsideWork('/lib/Book', '/lib/Other/s1.md')).toBe(false)
    expect(isInsideWork('/lib/Book', '/lib/Book/../secret.md')).toBe(false)
    expect(isInsideWork('/lib/Book', '/lib/Book')).toBe(false)
  })
})

describe('exportSceneFile — copy one scene .md out', () => {
  it('copies a scene inside the work; refuses one outside', () => {
    const root = mkdtempSync(join(tmpdir(), 'nvs-scene-'))
    try {
      mkdirSync(join(root, 'content', 'story'), { recursive: true })
      const scene = join(root, 'content', 'story', 's1.md')
      writeFileSync(scene, '# Scene One\n\nLine.')
      const out = join(root, 'exported.md')
      expect(exportSceneFile(root, scene, out).ok).toBe(true)
      expect(readFileSync(out, 'utf8')).toContain('Scene One')

      const outside = mkdtempSync(join(tmpdir(), 'nvs-other-'))
      try {
        const stray = join(outside, 'x.md')
        writeFileSync(stray, 'nope')
        expect(exportSceneFile(root, stray, join(root, 'leak.md')).ok).toBe(false)
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('forkProject — an independent library copy that records its parent', () => {
  it('copies the prose, drops local state, and stamps forkedFrom (db-less path)', () => {
    const root = mkdtempSync(join(tmpdir(), 'nvs-lib-'))
    setLibraryRoot(root)
    try {
      const src = join(root, 'My Book')
      mkdirSync(join(src, 'content', 'story'), { recursive: true })
      mkdirSync(join(src, '.nvs', 'snapshots'), { recursive: true })
      writeFileSync(join(src, 'content', 'story', 's1.md'), '# Scene One')
      writeFileSync(join(src, '.nvs', 'project.json'), JSON.stringify({ title: 'My Book', author: 'A. Writer' }))
      writeFileSync(join(src, '.nvs', 'chat.json'), '{}')
      writeFileSync(join(src, '.nvs', 'ui-state.json'), '{}')

      const res = forkProject(src)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.name).toBe('My Book (fork)')

      // prose copied
      expect(existsSync(join(res.path, 'content', 'story', 's1.md'))).toBe(true)
      // private/local state dropped
      expect(existsSync(join(res.path, '.nvs', 'chat.json'))).toBe(false)
      expect(existsSync(join(res.path, '.nvs', 'ui-state.json'))).toBe(false)
      expect(existsSync(join(res.path, '.nvs', 'snapshots'))).toBe(false)
      // lineage recorded, other metadata preserved
      const meta = JSON.parse(readFileSync(join(res.path, '.nvs', 'project.json'), 'utf8'))
      expect(meta.forkedFrom).toBe('My Book')
      expect(meta.author).toBe('A. Writer')
      expect(meta.updatedAt).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('isSafeRel — reject bundle paths that escape the project dir', () => {
  it('accepts normal relative project paths', () => {
    expect(isSafeRel('content/story/chapters/001/s1.md')).toBe(true)
    expect(isSafeRel('.nvs/timeline.json')).toBe(true)
  })

  it('rejects traversal, absolute, and drive-letter paths', () => {
    expect(isSafeRel('../../etc/passwd')).toBe(false)
    expect(isSafeRel('content/../../escape')).toBe(false)
    expect(isSafeRel('/etc/passwd')).toBe(false)
    expect(isSafeRel('C:\\Windows\\system32')).toBe(false)
    expect(isSafeRel('')).toBe(false)
  })
})
