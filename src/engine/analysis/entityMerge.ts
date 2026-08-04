/**
 * entityMerge.ts — fold duplicate ENTITIES into one (the action half of entity-dedup; mirrors threadMerge).
 *
 * The scene pass's normName resolve catches lexical dupes ("Yorick's skull" ↔ yorick-s-skull), but SEMANTIC
 * dupes ("Hamlet's Letters" · "Letters from Hamlet to the King") are the author's call — this is that call.
 * Deterministic + atomic: the CANONICAL entity is the authored one (an ingested page → significance IS NULL),
 * else the most-present, lexicographic id breaking ties. The others are repointed and removed in one
 * transaction. Reversible at the call site via the snapshot/version system.
 *
 * THE KEY MOVE — alias absorption: every folded entity's name + aliases append to the canonical's
 * aliases_json, so future scene passes resolve those names straight to the canonical (writeTier's byName map
 * reads aliases) — a merge can't be undone by the next run. Cross-TYPE merges are allowed on purpose (the
 * discovered "Ghost of the King" item folding into the ghost character); the canonical keeps its own type.
 *
 * What a merge touches:
 *   • entity_presence            → repoint (PK-safe: OR IGNORE, leftovers deleted)
 *   • entity_arc_events          → repoint
 *   • character_windows          → repoint (PK-safe)
 *   • dialog_nodes.speaker_id    → repoint (characters; items never speak)
 *   • coherence_findings (dupes) → DELETED (re-derivable on the next coherence pass)
 *   • entities (dupe rows)       → DELETED, names absorbed as canonical aliases
 * Caveat (surfaced in the result): folding an AUTHORED entity leaves its .md page on disk — the next ingest
 * re-creates its entity. Merge discovered→authored (the common case), or delete the losing page yourself.
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { openDb } from '@engine/data/db'
import type { MergeResult } from '@shared/ipc'

export function mergeEntities(workRoot: string, entityIds: string[]): MergeResult {
  const ids = [...new Set(entityIds)].filter(Boolean)
  if (ids.length < 2) return { ok: false, error: 'need at least two entities to merge' }
  const dbPath = join(workRoot, '.nvs', 'nvs.db')
  if (!existsSync(dbPath)) return { ok: false, error: 'no analysis DB yet' }
  const db = openDb(dbPath)
  try {
    const ph = ids.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT e.entity_id AS id, e.name AS name, e.aliases_json AS aliases, e.significance AS sig,
                (SELECT COUNT(*) FROM entity_presence p WHERE p.entity_id = e.entity_id) AS presence
           FROM entities e WHERE e.entity_id IN (${ph})`
      )
      .all(...ids) as Array<{ id: string; name: string; aliases: string | null; sig: string | null; presence: number }>
    if (rows.length < 2) return { ok: false, error: 'some selected entities no longer exist' }

    // Canonical: authored page first (sig IS NULL = ingested from a page), then most-present, then smallest id.
    const canonical = [...rows].sort((a, b) => {
      const aAuth = a.sig == null ? 0 : 1
      const bAuth = b.sig == null ? 0 : 1
      return aAuth - bAuth || b.presence - a.presence || a.id.localeCompare(b.id)
    })[0]
    const merge = rows.filter((r) => r.id !== canonical.id)
    const mids = merge.map((r) => r.id)
    const mph = mids.map(() => '?').join(',')

    db.transaction(() => {
      // Repoint, PK-safe where a canonical row may already exist (presence per scene, window per chapter).
      db.prepare(`UPDATE OR IGNORE entity_presence SET entity_id = ? WHERE entity_id IN (${mph})`).run(canonical.id, ...mids)
      db.prepare(`DELETE FROM entity_presence WHERE entity_id IN (${mph})`).run(...mids)
      db.prepare(`UPDATE entity_arc_events SET entity_id = ? WHERE entity_id IN (${mph})`).run(canonical.id, ...mids)
      db.prepare(`UPDATE OR IGNORE character_windows SET entity_id = ? WHERE entity_id IN (${mph})`).run(canonical.id, ...mids)
      db.prepare(`DELETE FROM character_windows WHERE entity_id IN (${mph})`).run(...mids)
      db.prepare(`UPDATE dialog_nodes SET speaker_id = ? WHERE speaker_id IN (${mph})`).run(canonical.id, ...mids)
      db.prepare(`DELETE FROM coherence_findings WHERE entity_id IN (${mph})`).run(...mids) // re-derivable

      // Alias absorption — the merged names keep resolving to the canonical on every future run.
      const parse = (j: string | null): string[] => {
        try { const v = j ? JSON.parse(j) : []; return Array.isArray(v) ? v.map(String) : [] } catch { return [] }
      }
      const absorbed = new Set<string>(parse(canonical.aliases))
      for (const m of merge) {
        absorbed.add(m.name)
        for (const a of parse(m.aliases)) absorbed.add(a)
      }
      absorbed.delete(canonical.name)
      db.prepare('UPDATE entities SET aliases_json = ? WHERE entity_id = ?').run(JSON.stringify([...absorbed]), canonical.id)
      db.prepare(`DELETE FROM entities WHERE entity_id IN (${mph})`).run(...mids)
    })()

    const authoredFolded = merge.filter((m) => m.sig == null).map((m) => m.id)
    return {
      ok: true,
      canonicalId: canonical.id,
      merged: mids,
      // Not an error — a heads-up the caller surfaces: those pages will re-create their entities on re-ingest.
      error: authoredFolded.length ? `note: ${authoredFolded.join(', ')} still have pages on disk — delete them or they re-ingest` : undefined
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    db.close()
  }
}
