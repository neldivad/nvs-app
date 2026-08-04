/**
 * The works library — the app's opinionated home for projects (decisions L12).
 *
 * One library root (default ~/Documents/Novel Visual Studio); each subfolder that
 * contains a `content/` dir is a work. The welcome page lists them.
 *
 * Why the root is INJECTED via setLibraryRoot() instead of imported: only the
 * main process knows OS paths (app.getPath('documents')), and we want this engine
 * module to stay free of Electron so it's unit-testable. Main calls
 * setLibraryRoot() once at startup; everything here reads that value.
 */
import { existsSync, readdirSync, statSync, mkdirSync, cpSync, renameSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { openReadonly } from '@engine/data/db'
import { loadProjectInfo } from '@engine/content/projectInfo'
import type { WorkCard, WorkId } from '@shared/ipc'

let LIBRARY_ROOT = ''

/** Called once by main at startup with ~/Documents/Novel Visual Studio. */
export function setLibraryRoot(p: string): void {
  LIBRARY_ROOT = p
  if (p && !existsSync(p)) mkdirSync(p, { recursive: true })
}

export function libraryRoot(): string {
  return LIBRARY_ROOT
}

/** A folder is a "work" if it has a content/ dir (the NVS project shape). */
export function isWork(dir: string): boolean {
  return existsSync(join(dir, 'content'))
}

/** Fallback work id when no analysis DB exists yet — a stable hash of the path. */
export function deriveWorkId(root: string): WorkId {
  return createHash('sha1').update(root).digest('hex').slice(0, 12)
}

/**
 * The work's canonical id. Once an analysis DB exists, its `works.work_id` is the
 * source of truth — set by whichever engine ingested (the earlier Python engine
 * uses a slug like 'office', not a path hash). Every analysis row FKs to that id, so a
 * writer MUST stamp it; deriving a path hash instead makes `writeTier` fail the
 * `work_id → works` FK. Only when there is no DB yet do we fall back to a derived id
 * (ingest then writes that id into `works`, so later opens read it back). Reading from
 * the DB also keeps the id stable if the project folder moves.
 */
export function resolveWorkId(root: string): WorkId {
  const dbPath = join(root, '.nvs', 'nvs.db')
  if (existsSync(dbPath)) {
    try {
      const db = openReadonly(dbPath)
      try {
        const row = db.prepare('SELECT work_id FROM works LIMIT 1').get() as { work_id?: string } | undefined
        if (row?.work_id) return row.work_id
      } finally {
        db.close()
      }
    } catch {
      /* unreadable / no works row yet — fall back to a derived id */
    }
  }
  return deriveWorkId(root)
}

/** Count `.md` under a dir (skipping READMEs) — the scene/world corpus size. */
export function countMarkdown(dir: string): number {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    try {
      if (statSync(p).isDirectory()) n += countMarkdown(p)
      else if (entry.endsWith('.md') && !/^readme\.md$/i.test(entry)) n += 1
    } catch {
      /* dangling symlink / permission hole — count what's readable, never throw out of a scan */
    }
  }
  return n
}

function describe(path: string): WorkCard {
  const content = join(path, 'content')
  // Authored metadata for the welcome grid (title/cover) — best-effort; the card still works without it.
  let title: string | undefined
  let author: string | undefined
  let cover: string | undefined
  let forkedFrom: string | undefined
  let medium: string | undefined
  let status: string | undefined
  let genre: string[] | undefined
  // loadProjectInfo reads `.nvs/project.json` (root project.json as fallback) and normalizes drifted shapes
  // (e.g. a scalar `genre`) so the card fields are contract-clean; empty metadata → folder-name fallback below.
  const info = loadProjectInfo(path)
  title = info.title?.trim() || undefined
  author = info.author?.trim() || undefined
  cover = info.cover?.trim() || undefined
  forkedFrom = info.forkedFrom?.trim() || undefined
  medium = info.medium?.trim() || undefined
  status = info.status?.trim() || undefined
  genre = info.genre?.length ? info.genre : undefined
  return {
    name: basename(path),
    path,
    scenes: countMarkdown(join(content, 'story')),
    worldPages: countMarkdown(join(content, 'world')),
    custodyPages: countMarkdown(join(content, 'custody')),
    lastEdited: statSync(path).mtimeMs,
    title,
    author,
    cover,
    forkedFrom,
    medium,
    status,
    genre
  }
}

/** Every work in the library root, newest first → the welcome grid. */
export function listWorks(): WorkCard[] {
  const root = LIBRARY_ROOT
  if (!root || !existsSync(root)) return []
  const works: WorkCard[] = []
  for (const entry of readdirSync(root)) {
    const p = join(root, entry)
    // Rack's rule (gh/NOTES.md): one bad entry is skipped with a warning — it never bricks the grid.
    try {
      if (statSync(p).isDirectory() && isWork(p)) works.push(describe(p))
    } catch (e) {
      console.warn('[library] skipping unreadable entry:', p, e instanceof Error ? e.message : e)
    }
  }
  return works.sort((a, b) => b.lastEdited - a.lastEdited)
}

/** A filesystem-safe folder name from a title (keeps spaces + caps; strips illegal chars). Empty → ''. */
function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Rename a work's FOLDER on disk (e.g. to match its authored title). Deduped against the library. Safe because
 * `work_id` lives in the DB, so the analysis survives a move. The CALLER must ensure the work isn't open (the
 * open-state plumbing — tabs, watcher, current.root — points at the old path); the IPC handler guards that.
 */
export function renameWorkFolder(path: string, newName: string): WorkCard | null {
  if (!LIBRARY_ROOT || !existsSync(path)) return null
  const clean = sanitizeFolderName(newName)
  if (!clean) return null
  if (clean === basename(path)) return describe(path) // already matches — no-op
  let dest = join(LIBRARY_ROOT, clean)
  for (let n = 2; existsSync(dest); n++) dest = join(LIBRARY_ROOT, `${clean} (${n})`)
  try {
    renameSync(path, dest)
    return describe(dest)
  } catch {
    return null
  }
}

/**
 * Copy an externally-opened work INTO the library (the DAW "Collect and Save" move — see
 * internal/community-registry.md). Full folder copy (content + .nvs analysis; it's the user's own data),
 * name deduped against the library. The caller reopens from the returned card's path.
 */
export function saveExternalWork(srcRoot: string): WorkCard | null {
  if (!LIBRARY_ROOT || !existsSync(srcRoot) || !isWork(srcRoot)) return null
  const clean = sanitizeFolderName(basename(srcRoot)) || 'Imported Work'
  let dest = join(LIBRARY_ROOT, clean)
  for (let n = 2; existsSync(dest); n++) dest = join(LIBRARY_ROOT, `${clean} (${n})`)
  try {
    cpSync(srcRoot, dest, { recursive: true })
    return describe(dest)
  } catch {
    return null
  }
}

/** Create a new work by cloning the bundled sample project into the library. */
export function createWork(name: string, sampleDir: string): WorkCard | null {
  if (!LIBRARY_ROOT || !existsSync(sampleDir)) return null
  const dest = join(LIBRARY_ROOT, name)
  if (existsSync(dest)) return null // don't clobber an existing work
  cpSync(sampleDir, dest, { recursive: true })
  return describe(dest)
}
