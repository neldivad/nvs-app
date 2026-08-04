/**
 * exportImport.ts — share a project as a portable `.nvsproj`, and open one back (see internal/export-gallery.md).
 * The prose (`content/`) and the analysis (`.nvs/nvs.db`) are ONE inseparable unit, so the bundle carries both;
 * import lights the analysis up with NO re-run (`resolveWorkId` reads the DB's stored id).
 *
 * The bundle is a SINGLE SQLite FILE (not a zip) — the consolidated analysis DB with two extra tables packed in:
 *   bundle_files (path → bytes)   the prose tree + curated sidecar (timeline.json, ingest-runs.json)
 *   bundle_meta  (manifest JSON)  title · workId · schemaVersion · lineage
 * So the OS sees a database, not an archive — no "extract here" prompt, can't fragment (the .flp/.svp property).
 * `chat/` (private sessions + absolute paths), `ui-state.json` (local), and `snapshots/` (local history) are excluded.
 *
 * Live projects keep loose `.md` (hand-editable); the bundle is the frozen transport, unpacked on import.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, rmSync, statSync } from 'node:fs'
import { join, dirname, relative, basename, isAbsolute } from 'node:path'
import AdmZip from 'adm-zip'
import type DatabaseType from 'better-sqlite3'
import { openDb } from '@engine/data/db'
import { libraryRoot, deriveWorkId } from '@engine/io/library'
import { NVS_DIR, EXPORT_SIDECARS, LOCAL_ONLY } from '@engine/io/nvsArtifacts'
import type { BundleManifest, ExportResult, ImportResult } from '@shared/ipc'

const NS = NVS_DIR
const DB = 'nvs.db'
const SIDECAR_INCLUDE = EXPORT_SIDECARS // authored sidecars that travel — declared once in nvsArtifacts.ts

/** A raw connection in DELETE-journal mode — keeps the bundle a single file (no persistent -wal/-shm sidecar). */
function rawDb(path: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType
  const db = new Database(path)
  db.pragma('journal_mode = DELETE')
  return db
}

/** The migration-ledger head — the bundle's schema marker (the import gate reads it). */
function schemaHead(db: DatabaseType.Database): string {
  try {
    return ((db.prepare('SELECT filename FROM _migrations ORDER BY filename DESC LIMIT 1').get() as { filename?: string } | undefined)?.filename) ?? ''
  } catch {
    return ''
  }
}

/** Pure: assemble the manifest stored in a bundle. Lineage fields are null in v1 (export+import only). */
export function buildManifest(p: { workId: string; title: string; author?: string | null; schemaVersion: string; appVersion: string; exportedAt: string }): BundleManifest {
  return { nvsproj: 1, workId: p.workId, title: p.title, author: p.author ?? null, schemaVersion: p.schemaVersion, appVersion: p.appVersion, exportedAt: p.exportedAt, forkedFrom: null, coverOf: null, promptSource: null }
}

/** The authored title/author from `.nvs/project.json` (for the manifest); empty when there's no metadata yet. */
function readInfo(workRoot: string): { title?: string; author?: string } {
  try {
    const i = JSON.parse(readFileSync(join(workRoot, NS, 'project.json'), 'utf8')) as { title?: string; author?: string }
    return { title: i.title?.trim() || undefined, author: i.author?.trim() || undefined }
  } catch {
    return {}
  }
}

/** Pure: a unique work-folder name within the library — appends " (n)" like the welcome grid expects. */
export function uniqueWorkName(title: string, existing: string[]): string {
  const base = (title || 'Imported Project').replace(/[/\\]/g, '-').trim() || 'Imported Project'
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const cand = `${base} (${n})`
    if (!taken.has(cand)) return cand
  }
}

/** Pure: reject bundle paths that could escape the project dir (absolute, drive-letter, or any `..` segment). */
export function isSafeRel(p: string): boolean {
  if (!p || p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) return false
  return !p.split(/[/\\]/).some((seg) => seg === '..' || seg === '')
}

/** Every file under `dir`, as paths relative to `base` (POSIX separators). */
function walkRel(base: string, dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) walkRel(base, abs, out)
    else out.push(relative(base, abs).split('\\').join('/'))
  }
  return out
}

/** Export the open project to `outFile` — a single-file `.nvsproj` (a SQLite DB with the prose packed in). */
export function exportProject(workRoot: string, outFile: string, appVersion: string): ExportResult {
  const dbPath = join(workRoot, NS, DB)
  const contentDir = join(workRoot, 'content')
  if (!existsSync(contentDir)) return { ok: false, error: 'not a project (no content/)' }
  if (!existsSync(dbPath)) return { ok: false, error: 'no analysis DB to export — run analysis first' }

  // 1) Consolidate the analysis DB straight into the bundle file (WAL folded → one self-contained DB).
  let schemaVersion = ''
  let workId = ''
  const src = openDb(dbPath)
  try {
    if (existsSync(outFile)) rmSync(outFile, { force: true })
    src.exec(`VACUUM INTO '${outFile.replace(/'/g, "''")}'`)
    schemaVersion = schemaHead(src)
    workId = ((src.prepare('SELECT work_id FROM works LIMIT 1').get() as { work_id?: string } | undefined)?.work_id) ?? ''
  } catch (err) {
    return { ok: false, error: `could not read the analysis DB: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    src.close()
  }

  // 2) Pack the prose + curated sidecar + manifest INTO the bundle (it's a SQLite file now).
  try {
    const b = rawDb(outFile)
    try {
      b.exec('CREATE TABLE bundle_files (path TEXT PRIMARY KEY, bytes BLOB NOT NULL); CREATE TABLE bundle_meta (manifest TEXT NOT NULL);')
      const ins = b.prepare('INSERT OR REPLACE INTO bundle_files (path, bytes) VALUES (?, ?)')
      b.transaction(() => {
        for (const rel of walkRel(workRoot, contentDir)) ins.run(rel, readFileSync(join(workRoot, rel)))
        for (const s of SIDECAR_INCLUDE) {
          const p = join(workRoot, NS, s)
          if (existsSync(p)) ins.run(`${NS}/${s}`, readFileSync(p))
        }
        const info = readInfo(workRoot)
        b.prepare('INSERT INTO bundle_meta (manifest) VALUES (?)').run(JSON.stringify(buildManifest({ workId, title: info.title ?? basename(workRoot), author: info.author, schemaVersion, appVersion, exportedAt: new Date().toISOString() })))
      })()
    } finally {
      b.close()
    }
    return { ok: true, file: outFile, title: basename(workRoot) }
  } catch (err) {
    rmSync(outFile, { force: true })
    return { ok: false, error: `could not write the bundle: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Pure: a filesystem-safe single top folder for a manuscript zip (so extracting doesn't strew loose files). */
export function zipFolderName(title: string): string {
  return (title || 'Manuscript').replace(/[/\\]/g, '-').trim() || 'Manuscript'
}

/**
 * Export JUST the manuscript — the `content/` tree (prose `.md` + assets) as a plain `.zip`, no analysis DB.
 * Unlike `.nvsproj` (a self-contained SQLite bundle meant to be reopened in NVS), this is an ordinary archive
 * anyone can extract and read. Files nest under one title-named folder.
 */
export function exportManuscriptZip(workRoot: string, outFile: string): ExportResult {
  const contentDir = join(workRoot, 'content')
  if (!existsSync(contentDir)) return { ok: false, error: 'not a project (no content/)' }
  try {
    const folder = zipFolderName(readInfo(workRoot).title ?? basename(workRoot))
    const zip = new AdmZip()
    zip.addLocalFolder(contentDir, folder)
    if (existsSync(outFile)) rmSync(outFile, { force: true })
    zip.writeZip(outFile)
    return { ok: true, file: outFile, title: folder }
  } catch (err) {
    return { ok: false, error: `could not write the zip: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Pure: is `scenePath` actually inside `workRoot`? (guards the single-scene export against path escapes). */
export function isInsideWork(workRoot: string, scenePath: string): boolean {
  const rel = relative(workRoot, scenePath)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Export ONE scene's `.md` to a chosen location — the in-context "Export .md" on a scene. The scene is already
 * a hand-editable `.md` on disk (the source of truth), so this is a guarded copy, not a re-serialize.
 */
export function exportSceneFile(workRoot: string, scenePath: string, outFile: string): ExportResult {
  if (!isInsideWork(workRoot, scenePath)) return { ok: false, error: 'scene is outside the project' }
  if (!existsSync(scenePath)) return { ok: false, error: 'scene file not found' }
  try {
    copyFileSync(scenePath, outFile)
    return { ok: true, file: outFile, title: basename(outFile) }
  } catch (err) {
    return { ok: false, error: `could not write the file: ${err instanceof Error ? err.message : String(err)}` }
  }
}

const LOCAL_STATE = LOCAL_ONLY // private/local — a fork/import starts these fresh (declared once in nvsArtifacts.ts)

/**
 * Give a project DB a new identity — reassign `work_id` from its current value to `newId` across EVERY table that
 * carries the column (works + all children). Done with FKs off in one txn, then re-checked. This is what makes a
 * fork an independent work (its own id) while keeping every internal reference (which points at the OLD id) intact.
 */
function reassignWorkId(dbPath: string, newId: string): void {
  const db = rawDb(dbPath)
  try {
    const old = (db.prepare('SELECT work_id FROM works LIMIT 1').get() as { work_id?: string } | undefined)?.work_id
    if (!old || old === newId) return
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
      .filter((t) => (db.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{ name: string }>).some((c) => c.name === 'work_id'))
    db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      for (const t of tables) db.prepare(`UPDATE "${t.name}" SET work_id = ? WHERE work_id = ?`).run(newId, old)
    })()
    const fk = db.pragma('foreign_key_check') as unknown[]
    if (Array.isArray(fk) && fk.length > 0) throw new Error(`${fk.length} foreign-key violations after reassign`)
  } finally {
    db.close()
  }
}

/**
 * Fork a (closed) project — an independent copy in the library that records its parent in `forkedFrom`. Copies the
 * prose + analysis verbatim (so the fork opens with its ledgers intact and NO re-run), drops private/local state,
 * and reassigns `work_id` so the two works are distinct. `scene_id`s stay stable → a later parent↔fork diff is
 * possible. Lineage is authored-metadata only (project.json), no engine coupling.
 */
export function forkProject(sourceRoot: string): ImportResult {
  const root = libraryRoot()
  if (!root || !existsSync(root)) return { ok: false, error: 'no library to fork into' }
  if (!existsSync(join(sourceRoot, 'content'))) return { ok: false, error: 'not a project (no content/)' }

  const info = readInfo(sourceRoot)
  const parentTitle = info.title ?? basename(sourceRoot)
  const name = uniqueWorkName(`${parentTitle} (fork)`, readdirSync(root))
  const dest = join(root, name)
  try {
    cpSync(sourceRoot, dest, { recursive: true })
    for (const s of LOCAL_STATE) rmSync(join(dest, NS, s), { recursive: true, force: true })

    const dbPath = join(dest, NS, DB)
    if (existsSync(dbPath)) reassignWorkId(dbPath, deriveWorkId(dest))

    // Record lineage + stamp (title carries over — the user renames the fork if they want).
    const metaPath = join(dest, NS, 'project.json')
    let meta: Record<string, unknown> = {}
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>
    } catch {
      /* no metadata yet — start one */
    }
    meta.forkedFrom = parentTitle
    meta.updatedAt = new Date().toISOString()
    mkdirSync(dirname(metaPath), { recursive: true })
    writeFileSync(metaPath, JSON.stringify(meta, null, 2))

    return { ok: true, name, path: dest, title: info.title ?? name }
  } catch (err) {
    rmSync(dest, { recursive: true, force: true })
    return { ok: false, error: `could not fork: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Open a `.nvsproj` as a NEW project in the library (deduped name). Validates; rolls back the dir on failure. */
export function importProject(bundleFile: string): ImportResult {
  const root = libraryRoot()
  if (!root || !existsSync(root)) return { ok: false, error: 'no library to import into' }

  // Read the manifest + packed files out of the bundle (a SQLite DB).
  let manifest: BundleManifest
  let files: Array<{ path: string; bytes: Buffer }>
  try {
    const b = rawDb(bundleFile)
    try {
      const hasMeta = b.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bundle_meta'").get()
      const hasFiles = b.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bundle_files'").get()
      if (!hasMeta || !hasFiles) return { ok: false, error: 'not an NVS bundle (.nvsproj)' }
      manifest = JSON.parse((b.prepare('SELECT manifest FROM bundle_meta LIMIT 1').get() as { manifest: string }).manifest)
      files = b.prepare('SELECT path, bytes FROM bundle_files').all() as Array<{ path: string; bytes: Buffer }>
    } finally {
      b.close()
    }
  } catch (err) {
    return { ok: false, error: `unreadable bundle: ${err instanceof Error ? err.message : String(err)}` }
  }

  const name = uniqueWorkName(manifest.title, readdirSync(root))
  const dest = join(root, name)
  try {
    mkdirSync(join(dest, NS), { recursive: true })
    // Write the prose + sidecar back out (reject any path that tries to escape the project dir).
    for (const f of files) {
      if (!isSafeRel(f.path)) throw new Error(`unsafe path in bundle: ${f.path}`)
      const out = join(dest, f.path)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, f.bytes)
    }
    // The analysis DB = the bundle minus the bundle_* tables → copy it in, then strip + reclaim space.
    copyFileSync(bundleFile, join(dest, NS, DB))
    const live = rawDb(join(dest, NS, DB))
    try {
      live.exec('DROP TABLE IF EXISTS bundle_files; DROP TABLE IF EXISTS bundle_meta; VACUUM;')
    } finally {
      live.close()
    }
    // Validate (opens → migrates an older schema forward, work_id present, FK-intact).
    const db = openDb(join(dest, NS, DB))
    try {
      const wid = (db.prepare('SELECT work_id FROM works LIMIT 1').get() as { work_id?: string } | undefined)?.work_id
      if (!wid) throw new Error('no work_id in the analysis DB')
      const fk = db.pragma('foreign_key_check') as unknown[]
      if (Array.isArray(fk) && fk.length > 0) throw new Error(`${fk.length} foreign-key violations`)
    } finally {
      db.close()
    }
  } catch (err) {
    rmSync(dest, { recursive: true, force: true })
    return { ok: false, error: `invalid bundle: ${err instanceof Error ? err.message : String(err)}` }
  }

  return { ok: true, name, path: dest, title: manifest.title }
}
