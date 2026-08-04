/**
 * SQLite access for the engine (main process only).
 *
 * The schema — migration set 001..NNN in ./schema — is owned here (decision D1). We apply them in order
 * against a fresh DB and record each applied file in `_migrations`, so a project's `.nvs/nvs.db` stays
 * wire-compatible with any DB an earlier engine wrote.
 *
 * Native module note: better-sqlite3 is rebuilt against Electron's ABI by the
 * `electron-builder install-app-deps` postinstall step. It is imported lazily so
 * the rest of the app (and the P0 smoke test) never pays for it until a project
 * actually needs analysis storage.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import type DatabaseType from 'better-sqlite3'

/** Resolve the vendored migrations dir (dev: src/engine/schema; packaged: resources/schema). */
function schemaDir(): string {
  // In dev electron-vite runs from source; in production we ship schema as extraResources.
  const packaged = process.resourcesPath ? join(process.resourcesPath, 'schema') : ''
  const fromSource = join(__dirname, '..', '..', 'src', 'engine', 'schema')
  for (const dir of [packaged, fromSource, join(__dirname, 'schema')]) {
    try {
      if (dir && readdirSync(dir).some((f) => f.endsWith('.sql'))) return dir
    } catch {
      /* keep looking */
    }
  }
  throw new Error('Could not locate engine SQL migrations (schema/*.sql)')
}

/** Open (creating if absent) a project DB and bring it up to the latest migration. */
export function openDb(dbPath: string): DatabaseType.Database {
  // Lazy require keeps the native binding out of the hot path until first use.
  const Database = require('better-sqlite3') as typeof DatabaseType
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/**
 * Open an EXISTING db read-only — for the Slice 1 read-path over a DB that may
 * have been written by the Python engine. `readonly` makes accidental mutation
 * impossible; `fileMustExist` turns "no analysis yet" into a clean error we
 * handle by returning empty, rather than silently creating a blank db.
 */
export function openReadonly(dbPath: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType
  return new Database(dbPath, { readonly: true, fileMustExist: true })
}

/**
 * Bring a DB up to the latest migration, sharing the SAME ledger the Python engine uses:
 * `_migrations`, keyed by full `.sql` filename (defined by 001, populated by both engines).
 * This is what makes a `.nvs/nvs.db` wire-compatible — opening a
 * Python-built DB for writing must NOT re-run migrations it already has, or a non-idempotent
 * `ALTER … ADD COLUMN` (e.g. 003's `category`) throws "duplicate column name". We also read a
 * legacy `schema_migrations` ledger (extension-stripped) that earlier NVS builds wrote, so DBs
 * created by either engine are recognized; new applies converge onto `_migrations`.
 */
/** The migration filenames (001..NNN.sql) in apply order. */
function migrationFiles(): string[] {
  return readdirSync(schemaDir())
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/**
 * The set of migrations a DB has already applied, reading BOTH ledgers: `_migrations`
 * (Python + current NVS) and the legacy extension-stripped `schema_migrations`. Missing
 * ledger → empty set (a fresh/pre-ledger DB), which the caller treats as "apply everything".
 */
function appliedMigrations(db: DatabaseType.Database): Set<string> {
  const applied = new Set<string>()
  try {
    for (const r of db.prepare('SELECT filename FROM _migrations').all() as any[]) applied.add(r.filename as string)
  } catch {
    /* no `_migrations` ledger yet — fine */
  }
  try {
    for (const r of db.prepare('SELECT version FROM schema_migrations').all() as any[]) applied.add(`${r.version as string}.sql`)
  } catch {
    /* no legacy ledger — fine */
  }
  return applied
}

function migrate(db: DatabaseType.Database): void {
  // Match 001's definition exactly (filename PK, applied_at NOT NULL) so this is a harmless
  // no-op once 001 has created the table on a fresh DB.
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`
  )
  const applied = appliedMigrations(db)
  const record = db.prepare("INSERT OR IGNORE INTO _migrations (filename, applied_at) VALUES (?, datetime('now'))")
  for (const file of migrationFiles()) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(schemaDir(), file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      record.run(file)
    })()
  }
}

/**
 * Resolve a READABLE path for a version's snapshot, upgrading its schema if needed.
 *
 * Timetravel runs TODAY's read SQL against a FROZEN snapshot, but snapshots are opened
 * read-only and never migrated — so a snapshot captured before a later migration (e.g. 010's
 * `narrative_threads.title`) is missing columns the current queries select, and every read
 * throws `no such column`. Snapshots always carry the `_migrations` ledger (they VACUUM the
 * live DB, which openDb already migrated), so a copy can be brought to head safely and
 * idempotently. We migrate a cached working copy under `.nvs/snapshot-cache/` (kept OUT of
 * `snapshots/` so version pruning never counts it) and read that instead.
 *
 * Returns the snapshot itself when already at head, the migrated copy when behind, or `null`
 * when the snapshot file is gone (pruned) — the caller surfaces "unavailable", NOT a silent
 * fall-through to the live DB.
 */
export function snapshotViewPath(root: string, id: string): string | null {
  const dir = join(root, '.nvs', 'snapshots')
  const rawSnap = join(dir, `${id}.db`)
  const gzSnap = `${rawSnap}.gz`
  const hasRaw = existsSync(rawSnap)
  const hasGz = existsSync(gzSnap)
  if (!hasRaw && !hasGz) return null
  const view = join(root, '.nvs', 'snapshot-cache', `${id}.db`)
  const head = migrationFiles().pop()
  const atHead = (p: string): boolean => {
    const db = openReadonly(p)
    try {
      return appliedMigrations(db).has(head as string)
    } finally {
      db.close()
    }
  }
  // Materialize a working copy in snapshot-cache — decompress a `.db.gz`, or copy a legacy raw `.db` — and
  // (if there are migrations) bring it to head via the idempotent ledger so today's read SQL runs clean.
  const materialize = (): string => {
    mkdirSync(join(root, '.nvs', 'snapshot-cache'), { recursive: true })
    for (const ext of ['', '-wal', '-shm']) rmSync(view + ext, { force: true }) // clear any stale copy + WAL sidecars
    if (hasGz) writeFileSync(view, gunzipSync(readFileSync(gzSnap)))
    else copyFileSync(rawSnap, view)
    if (head) {
      const w = openDb(view) // migrate() brings the copy to head
      try {
        w.pragma('wal_checkpoint(TRUNCATE)') // fold WAL back so the readonly reader sees a single clean file
      } finally {
        w.close()
      }
    }
    return view
  }
  if (!head) return hasRaw ? rawSnap : materialize() // no migrations: any complete copy reads as-is
  if (hasRaw && atHead(rawSnap)) return rawSnap // legacy raw already at head → read in place, no copy
  if (existsSync(view) && atHead(view)) return view // reuse a cached copy already at head
  return materialize()
}
