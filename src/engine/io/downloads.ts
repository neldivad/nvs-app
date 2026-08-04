/**
 * Download history — the "reading list": every community work you've ever installed, kept even after the
 * local copy is deleted.
 *
 * The v1 store is a FROZEN file-sharing model (download = your copy, yours to edit, no in-place merge), so
 * "downloaded" is not live state — the on-disk work can diverge or be deleted. This log is the honest,
 * immutable record of what you *acquired* from the registry, independent of whatever the local copy became.
 * That's the reading-list the user asked for (Google Books "your library" shelf, distinct from files on disk).
 *
 * Same Electron-free injection pattern as recents.ts / library.ts: main calls setDownloadsPath() once at
 * startup (userData/downloads.json) so this module stays unit-testable. Deliberately NOT pruned by existence —
 * a deleted local copy stays in history (that's the whole point); we cap by count, newest first.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { DownloadEntry } from '@shared/ipc'

let DOWNLOADS_PATH = ''
const MAX_DOWNLOADS = 200

/** Called once by main at startup with <userData>/downloads.json. */
export function setDownloadsPath(p: string): void {
  DOWNLOADS_PATH = p
}

function load(): DownloadEntry[] {
  if (!DOWNLOADS_PATH || !existsSync(DOWNLOADS_PATH)) return []
  try {
    const raw = JSON.parse(readFileSync(DOWNLOADS_PATH, 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (e): e is DownloadEntry =>
        !!e && typeof (e as DownloadEntry).registryId === 'string' && typeof (e as DownloadEntry).at === 'number'
    )
  } catch {
    return [] // unreadable/corrupt log — start fresh; it's only history
  }
}

function save(entries: DownloadEntry[]): void {
  if (!DOWNLOADS_PATH) return
  try {
    writeFileSync(DOWNLOADS_PATH, JSON.stringify(entries, null, 2))
  } catch {
    /* read-only userData — history just won't persist; non-fatal */
  }
}

/**
 * Record a successful install. Upsert by registryId (re-downloading the same work refreshes the timestamp +
 * version rather than adding a duplicate row), newest first, capped.
 */
export function recordDownload(entry: DownloadEntry): void {
  const entries = load().filter((e) => e.registryId !== entry.registryId)
  entries.unshift(entry)
  save(entries.slice(0, MAX_DOWNLOADS))
}

/** The reading list, newest first. Never pruned by disk state — history outlives the local copy. */
export function listDownloads(): DownloadEntry[] {
  return load()
}
