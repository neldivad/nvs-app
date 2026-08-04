/**
 * Local storage housekeeping — per-project disk usage + clear actions for the Jobs dashboard's Storage tab.
 * Everything here is MACHINE-LOCAL (telemetry, snapshots, chat); it never touches prose or the live analysis DB.
 *
 * Categories (matching what accumulates):
 *   • logs    — `.nvs/ingest-telemetry.jsonl` (+ rotated .1). Pure diagnostics, safe to clear anytime.
 *   • history — the run ledger `.nvs/ingest-runs.json` sessions + `.nvs/snapshots/` (the revert backups). Clearing
 *               keeps the CURRENT analysis intact but drops past-version records + the ability to revert to them.
 *   • chat    — `.nvs/chat.json`. The author's chat sessions (the one UNBOUNDED store) — explicit clear.
 *   • backups — `.nvs.bak-<ts>/` at the project ROOT: full `.nvs` copies "Reset analysis" leaves behind. Nothing
 *               else GCs them, so they pile up (the After-Effects-cache case); safe to delete — pure recovery.
 */
import { statSync, existsSync, rmSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as library from '@engine/io/library'
import { compactSnapshots as compactSnapshotsImpl } from '@engine/data/writeTier'

/** Non-destructively shrink a project's revert snapshots — gzip any pre-compression legacy `.db` copies. Keeps
 *  every revert point (unlike "clear history", which drops them). Returns bytes freed + files compacted. */
export function compactSnapshots(root: string): { freedBytes: number; compacted: number } {
  return root ? compactSnapshotsImpl(root) : { freedBytes: 0, compacted: 0 }
}

function fileBytes(p: string): number {
  try {
    return existsSync(p) ? statSync(p).size : 0
  } catch {
    return 0
  }
}
function dirBytes(p: string): number {
  try {
    if (!existsSync(p)) return 0
    let n = 0
    for (const f of readdirSync(p, { withFileTypes: true })) n += f.isDirectory() ? dirBytes(join(p, f.name)) : fileBytes(join(p, f.name))
    return n
  } catch {
    return 0
  }
}
const nvs = (root: string, ...seg: string[]): string => join(root, '.nvs', ...seg)

/** `.nvs.bak-<ts>/` reset-backup dirs sitting at the project ROOT (full `.nvs` copies "Reset analysis" leaves;
 *  nothing else ever GCs them, so they're the one unbounded-growth vector besides chat). */
function backupDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\.nvs\.bak-/.test(e.name))
      .map((e) => join(root, e.name))
  } catch {
    return []
  }
}

export function storageUsage(): { root: string; name: string; logsBytes: number; historyBytes: number; chatBytes: number; tasksBytes: number; backupsBytes: number; dbBytes: number; totalBytes: number }[] {
  return library.listWorks().map((w) => {
    const backupsBytes = backupDirs(w.path).reduce((n, d) => n + dirBytes(d), 0)
    // The analysis DB — usually the biggest single artifact (a full novel's analysis). NOT deletable here (only
    // Reset rebuilds it, to the same size); shown so the footprint reads true instead of "where did my GB go?".
    const dbBytes = fileBytes(nvs(w.path, 'nvs.db')) + fileBytes(nvs(w.path, 'nvs.db-wal')) + fileBytes(nvs(w.path, 'nvs.db-shm'))
    return {
      root: w.path,
      name: w.title || w.name,
      logsBytes: fileBytes(nvs(w.path, 'ingest-telemetry.jsonl')) + fileBytes(nvs(w.path, 'ingest-telemetry.jsonl.1')),
      historyBytes: fileBytes(nvs(w.path, 'ingest-runs.json')) + dirBytes(nvs(w.path, 'snapshots')),
      chatBytes: dirBytes(nvs(w.path, 'chat')) + fileBytes(nvs(w.path, 'chat.json')), // new per-session store + any un-migrated legacy file
      tasksBytes: dirBytes(nvs(w.path, 'tasks')),
      backupsBytes,
      dbBytes,
      totalBytes: dirBytes(nvs(w.path)) + backupsBytes // the whole `.nvs/` (db + everything) + root-level reset backups
    }
  })
}

export function clearStorage(root: string, kind: 'logs' | 'history' | 'chat' | 'tasks' | 'backups'): void {
  if (!root) return
  if (kind === 'logs') {
    rmSync(nvs(root, 'ingest-telemetry.jsonl'), { force: true })
    rmSync(nvs(root, 'ingest-telemetry.jsonl.1'), { force: true })
    return
  }
  if (kind === 'chat') {
    rmSync(nvs(root, 'chat'), { recursive: true, force: true }) // the per-session store
    rmSync(nvs(root, 'chat.json'), { force: true }) // + any un-migrated legacy monolith
    return
  }
  if (kind === 'tasks') {
    rmSync(nvs(root, 'tasks'), { recursive: true, force: true })
    return
  }
  if (kind === 'backups') {
    for (const d of backupDirs(root)) rmSync(d, { recursive: true, force: true }) // full copies at root — safe: pure recovery snapshots
    return
  }
  // history: drop past-run records + their snapshots; KEEP the current analysis DB + `current` pointer.
  rmSync(nvs(root, 'snapshots'), { recursive: true, force: true })
  const rp = nvs(root, 'ingest-runs.json')
  try {
    const runs = JSON.parse(readFileSync(rp, 'utf8')) as { current?: string | null }
    writeFileSync(rp, JSON.stringify({ current: runs.current ?? null, sessions: [] }, null, 2))
  } catch {
    /* no ledger to clear */
  }
}
