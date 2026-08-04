/**
 * threadMerge.ts — fold duplicate threads into one (the action half of thread-dedup; the detector is
 * `lib/threadDups`). The scene pass can re-open one promise under a second id (same slug, new opening scene),
 * splitting its events; this stitches them back. Deterministic + atomic: the CANONICAL thread is the earliest
 * opener (lexicographic id breaks ties), the rest are repointed and removed in a single transaction, and the
 * umbrella's status is refolded across the merged events. Reversible at the call site via the snapshot/version
 * system (the engine op itself is all-or-nothing). DB-only — threads are inferred, never in frontmatter.
 *
 * What a merge touches (every reference to a folded thread id):
 *   • thread_events.thread_id            → canonical   (the event log; event_ids stay unique per scene-write)
 *   • narrative_threads.succeeds         → canonical   (a recast successor that pointed at the dupe)
 *   • revelation_events.target_thread_id → canonical   (guarded — column absent in older DBs)
 *   • coherence_findings (quest verdicts) → DELETED     (re-derivable; their thread id is embedded in finding_id)
 *   • narrative_threads (the dupe row)    → DELETED
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { openDb } from '@engine/data/db'
import { refoldThread } from '@engine/data/writeTier'
import type { MergeResult } from '@shared/ipc'

/** Pick the canonical thread: earliest opener (smallest linear_pos); lexicographically-smallest id breaks ties. */
export function pickCanonical(entries: { id: string; pos: number }[]): string | null {
  let best: { id: string; pos: number } | null = null
  for (const e of entries) {
    if (!best || e.pos < best.pos || (e.pos === best.pos && e.id < best.id)) best = e
  }
  return best?.id ?? null
}

export function mergeThreads(workRoot: string, threadIds: string[]): MergeResult {
  const ids = [...new Set(threadIds)].filter(Boolean)
  if (ids.length < 2) return { ok: false, error: 'need at least two threads to merge' }
  const dbPath = join(workRoot, '.nvs', 'nvs.db')
  if (!existsSync(dbPath)) return { ok: false, error: 'no analysis DB yet' }
  const db = openDb(dbPath)
  try {
    const ph = ids.map(() => '?').join(',')
    // Earliest opener per thread → canonical. Position comes from `opened_unit_id` (the umbrella's own record of
    // where it opened), NOT an 'open' thread_event — a thread can legitimately lack an open beat (its open was
    // recorded under another id, or the data is partial), and requiring one made such a thread sort LAST and lose
    // canonical to a later dupe. Fall back to its earliest beat's position if opened_unit_id isn't placed.
    const rows = db
      .prepare(
        `SELECT t.thread_id AS id,
                COALESCE(
                  (SELECT uo.linear_pos FROM unit_order uo WHERE uo.unit_id = t.opened_unit_id),
                  (SELECT MIN(o.linear_pos) FROM thread_events te JOIN unit_order o ON o.unit_id = te.scene_id WHERE te.thread_id = t.thread_id)
                ) AS pos
           FROM narrative_threads t
          WHERE t.thread_id IN (${ph})`
      )
      .all(...ids) as Array<{ id: string; pos: number | null }>
    const posById = new Map(rows.map((r) => [r.id, r.pos ?? Number.MAX_SAFE_INTEGER]))
    const canonicalId = pickCanonical(ids.map((id) => ({ id, pos: posById.get(id) ?? Number.MAX_SAFE_INTEGER })))
    if (!canonicalId) return { ok: false, error: 'could not resolve a canonical thread' }
    const mergeIds = ids.filter((id) => id !== canonicalId)
    if (!db.prepare('SELECT 1 FROM narrative_threads WHERE thread_id = ?').get(canonicalId)) return { ok: false, error: `canonical thread ${canonicalId} not found` }

    const mph = mergeIds.map(() => '?').join(',')
    const repointed: Record<string, number> = {}
    db.transaction(() => {
      repointed.thread_events = db.prepare(`UPDATE thread_events SET thread_id = ? WHERE thread_id IN (${mph})`).run(canonicalId, ...mergeIds).changes
      repointed.succeeds = db.prepare(`UPDATE narrative_threads SET succeeds = ? WHERE succeeds IN (${mph})`).run(canonicalId, ...mergeIds).changes
      try {
        repointed.revelations = db.prepare(`UPDATE revelation_events SET target_thread_id = ? WHERE target_thread_id IN (${mph})`).run(canonicalId, ...mergeIds).changes
      } catch {
        /* revelation_events / target_thread_id absent in this DB — nothing to repoint */
      }
      // Quest-verdict findings embed the thread id in finding_id (e.g. "quest:c:C4:thr:…:layoff"). Substring
      // match (instr, no LIKE wildcards) drops the ones naming a folded thread — they regenerate on next diff.
      const delFinding = db.prepare(`DELETE FROM coherence_findings WHERE instr(finding_id, ?) > 0`)
      repointed.coherence_findings = mergeIds.reduce((n, m) => n + delFinding.run(m).changes, 0)
      db.prepare(`DELETE FROM narrative_threads WHERE thread_id IN (${mph})`).run(...mergeIds)
      refoldThread(db, canonicalId)
    })()
    return { ok: true, canonicalId, merged: mergeIds, repointed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    db.close()
  }
}
