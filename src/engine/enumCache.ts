/**
 * In-memory memo for the CHEAP-TO-REBUILD disk enumerations the engine re-derives on every call — listScenes /
 * listStoryTree / listWorldPages (which read+parse every file's frontmatter) and timelineGraph (which re-queries
 * every analysis table). The read-heavy MCP/agent path hammers these per tool call, so re-parsing the whole
 * project each time dominated latency (see host-api perf notes).
 *
 * Design (deliberate): this lives in the PROCESS HEAP ONLY — never persisted. The value is a re-glob away, so it
 * adds NOTHING to the `.nvs` storage/cleanup surface (unlike the analysis DB or the LLM build-cache, which are
 * expensive-to-rebuild + reused across sessions and therefore on-disk + registered with housekeeping).
 *
 * SELF-INVALIDATING: each slot is keyed by a cheap FINGERPRINT of its source (file paths + mtimes, or the DB +
 * its WAL sidecars). Any write — the engine's own OR an external edit — moves an mtime/size, so the key changes
 * and the value rebuilds. No manual invalidation calls to keep in sync with every mutator (there are ~30); the
 * only cost on a hit is a metadata walk (stat, no file bodies read) instead of the full parse.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Per-slot counters, surfaced by cacheStats() (the mcpStats tool) so the memo is verifiable in one call — a HIT
 *  reuses the value; a MISS rebuilt it (fingerprint changed), lastBuildMs = how long that rebuild took. */
export type SlotStat = { hits: number; misses: number; lastBuildMs: number | null; primed: boolean }
const registry = new Map<string, SlotStat>()

/** A single-slot memo keyed by a fingerprint string: rebuilds only when the key changes. `name` labels its stats. */
export function memoSlot<T>(name: string): (key: string, build: () => T) => T {
  const stat: SlotStat = { hits: 0, misses: 0, lastBuildMs: null, primed: false }
  registry.set(name, stat)
  let cachedKey: string | undefined
  let cachedVal!: T
  return (key, build) => {
    if (key !== cachedKey) {
      const t0 = Date.now()
      cachedVal = build()
      stat.lastBuildMs = Date.now() - t0
      stat.misses++
      stat.primed = true
      cachedKey = key
    } else {
      stat.hits++
    }
    return cachedVal
  }
}

/** Snapshot of every memo slot's counters — the mcpStats tool payload. */
export function cacheStats(): Record<string, SlotStat> {
  return Object.fromEntries([...registry].map(([k, v]) => [k, { ...v }]))
}

/** Recursive fingerprint of a directory tree: every entry's path + mtime (metadata only — no file bodies read).
 *  Adds/removes/renames move a parent dir's mtime; edits move the file's — so any change misses the memo. */
export function fingerprintDir(dir: string): string {
  const parts: string[] = []
  const walk = (d: string): void => {
    let names: string[]
    try {
      names = readdirSync(d)
    } catch {
      return // missing/unreadable dir → its absence is part of the fingerprint (empty contribution)
    }
    for (const name of names) {
      const p = join(d, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(p)
      } catch {
        parts.push(`${p}:-`)
        continue
      }
      parts.push(`${p}:${st.mtimeMs}`)
      if (st.isDirectory()) walk(p)
    }
  }
  walk(dir)
  return parts.join('|')
}

/** Fingerprint a SQLite DB INCLUDING its WAL/shm sidecars — WAL writes land in `-wal` before checkpoint, so the
 *  main file's mtime alone would miss recent writes. Any analysis write moves the wal mtime/size → memo rebuilds. */
export function fingerprintDb(dbPath: string): string {
  let fp = ''
  for (const ext of ['', '-wal', '-shm']) {
    try {
      const s = statSync(dbPath + ext)
      fp += `${ext}:${s.mtimeMs}:${s.size}|`
    } catch {
      fp += `${ext}:-|`
    }
  }
  return fp
}
