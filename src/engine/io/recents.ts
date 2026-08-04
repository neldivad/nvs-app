/**
 * Recently-opened works — the pointer registry that remembers projects the library scan can't see.
 *
 * L12's library root is the app's opinionated home, but it was also the app's ONLY memory: a work opened
 * via "Open Folder…" (e.g. a conversion living in a dev repo) vanished from the Welcome page on relaunch.
 * Every workspace-shaped app keeps a pointer list in app-private state for exactly this (VS Code recent
 * workspaces, Obsidian's vault registry, DAW recents) — see internal/community-registry.md.
 *
 * Same injection pattern as library.ts: only main knows OS paths, so it calls setRecentsPath() once at
 * startup (userData/recents.json) and this module stays Electron-free and unit-testable.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, sep } from 'node:path'
import { isWork, libraryRoot } from '@engine/io/library'
import type { RecentEntry } from '@shared/ipc'

let RECENTS_PATH = ''
const MAX_RECENTS = 20

/** Called once by main at startup with <userData>/recents.json. */
export function setRecentsPath(p: string): void {
  RECENTS_PATH = p
}

type StoredRecent = { path: string; lastOpened: number }

function load(): StoredRecent[] {
  if (!RECENTS_PATH || !existsSync(RECENTS_PATH)) return []
  try {
    const raw = JSON.parse(readFileSync(RECENTS_PATH, 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (e): e is StoredRecent =>
        !!e && typeof (e as StoredRecent).path === 'string' && typeof (e as StoredRecent).lastOpened === 'number'
    )
  } catch {
    return [] // unreadable/corrupt registry — start fresh; it's only pointers
  }
}

function save(entries: StoredRecent[]): void {
  if (!RECENTS_PATH) return
  try {
    writeFileSync(RECENTS_PATH, JSON.stringify(entries, null, 2))
  } catch {
    /* read-only userData — recents just won't persist; non-fatal */
  }
}

/** Is this path inside the library root (i.e. already on the Welcome grid via the scan)? */
export function isInsideLibrary(root: string): boolean {
  const lib = libraryRoot()
  return !!lib && (root === lib || root.startsWith(lib + sep))
}

/** Upsert a successfully opened work. Newest first, capped. */
export function recordRecent(root: string): void {
  const entries = load().filter((e) => e.path !== root)
  entries.unshift({ path: root, lastOpened: Date.now() })
  save(entries.slice(0, MAX_RECENTS))
}

/** Drop a path (e.g. after its folder was copied into the library or deleted). */
export function removeRecent(root: string): void {
  save(load().filter((e) => e.path !== root))
}

/**
 * The recents list for the Welcome page, newest first. Entries whose folder is gone or no longer
 * work-shaped are pruned (and persisted pruned), so stale pointers self-heal.
 */
export function listRecents(): RecentEntry[] {
  const entries = load()
  const alive = entries.filter((e) => existsSync(e.path) && isWork(e.path))
  if (alive.length !== entries.length) save(alive)
  return alive.map((e) => ({
    path: e.path,
    name: basename(e.path),
    lastOpened: e.lastOpened,
    insideLibrary: isInsideLibrary(e.path)
  }))
}
