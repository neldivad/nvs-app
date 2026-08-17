/**
 * critique.ts — the inputs the CRITIQUE ("Tough questions") pass judges (internal/story-critique.md, Slice 1).
 *
 * The FOURTH family. The three linter families check CONSISTENCY (page↔arc, fact↔fact, thread↔verdict); critique
 * judges CONSTRUCTION — does a beat EARN its place? Slice 1 ships one kind, `inert` (Cuttable?), as a two-step:
 *
 *   1. DETERMINISTIC CANDIDATES (here, free) — the thread/scene graph's cut-suspects:
 *        dangling       a thread still open at story end (a setup with no payoff on record),
 *        episode        a closed thread whose whole life fits within adjacent scenes (self-contained),
 *        silent-scene   a scene where no thread moves at all.
 *      The RoTK probe (story-critique.md §6) showed these conflate SELF-CONTAINED with DISPENSABLE — the early
 *      episodic spine and consequence-absorbing finales are false positives, and real dependencies live in prose
 *      ("gives Liu Bei actionable warning…") that the graph can't see. So:
 *   2. REFUTE-BIASED CONFIRM (main/ai/critiqueReader.ts) — the model reads each candidate against the full
 *      thread/fact context and emits a finding ONLY where nothing downstream depends on the beat.
 *
 * Freshness is whole-story like continuity: any thread/fact movement re-stales the pass (critiqueInputHash,
 * CRITIQUE_LOGIC_VERSION its own knob). Reuses continuityInputs for the shared facts/threads context so the two
 * whole-story passes read the same timeline rendering.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { openReadonly } from '@engine/data/db'
import { runIdFor } from '@engine/data/writeTier'
import { continuityInputs, type ContinuityInputs } from '@engine/analysis/continuity'
import { CRITIQUE_LOGIC_VERSION, type CritiqueCandidate } from '@shared/config/extraction'

const dbPathFor = (workRoot: string): string => join(workRoot, '.nvs', 'nvs.db')

/** Everything the critique pass reads: the graph's candidates + the shared whole-story context. */
export interface CritiqueInputs {
  checkpoint: string
  candidates: CritiqueCandidate[]
  threads: ContinuityInputs['threads']
  facts: ContinuityInputs['facts']
  promptVersion: string
}

/** A closed thread counts as an EPISODE when its whole life spans at most this many reading positions. */
const EPISODE_SPAN = 1
/** Dangling threads with MORE beats than this are major unresolved arcs — the thread rail's business, not critique's. */
const DANGLING_MAX_BEATS = 8
/** A close whose description reads as a NON-EVENT — the self-denying-close fingerprint (RoTK sweep 2026-08-14:
 *  "No decisive change… the thread is not actually paid off" / "No longer active in this scene"). */
const SELF_DENYING =
  /\b(not (actually |yet )?(resolved|paid|settled|closed|decided)|no decisive change|remains? (open|unresolved|unsettled)|no longer active|does not (resolve|settle|close)|not in this scene|nothing (is )?(resolved|settled)|not paid off)\b/i

/** The deterministic cut-suspects from the thread/scene graph (pure read; the confirm pass judges them). */
export function critiqueCandidates(workRoot: string): CritiqueCandidate[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    // Per-thread beat stats in reading order (positions + count + the beat log for the evidence line).
    const stats = db
      .prepare(
        `SELECT t.thread_id AS id, COALESCE(t.title, t.description, t.thread_id) AS title, t.status AS status,
                t.resolution_condition AS gate,
                MIN(o.linear_pos) AS lo, MAX(o.linear_pos) AS hi, COUNT(*) AS beats,
                GROUP_CONCAT(te.action || COALESCE(': ' || te.description, ''), ' → ') AS log
           FROM narrative_threads t
           JOIN thread_events te ON te.thread_id = t.thread_id
           JOIN unit_order o ON o.unit_id = te.scene_id
          GROUP BY t.thread_id`
      )
      .all() as Array<{ id: string; title: string; status: string; gate: string | null; lo: number; hi: number; beats: number; log: string }>
    const lastPos = (db.prepare(`SELECT MAX(linear_pos) AS p FROM unit_order`).get() as { p: number | null }).p ?? 0
    // Ordered beats per thread (pos + rowid order) for the weak-close/post-close checks.
    const beatsOf = db.prepare(
      `SELECT te.action AS action, COALESCE(te.description, '') AS description, te.scene_id AS sceneId
         FROM thread_events te JOIN unit_order o ON o.unit_id = te.scene_id
        WHERE te.thread_id = ? ORDER BY o.linear_pos, te.rowid`
    )

    const out: CritiqueCandidate[] = []
    for (const s of stats) {
      if (s.status !== 'closed' && s.beats <= DANGLING_MAX_BEATS) {
        // A setup still open at story end — the classic dangling payoff (Left Ci). Cap the log for the payload.
        out.push({ id: s.id, sort: 'dangling', label: s.title, text: `open at story end (${s.beats} beats, last at pos ${s.hi}/${lastPos}): ${s.log.slice(0, 300)}` })
      } else if (s.status === 'closed' && s.hi - s.lo <= EPISODE_SPAN) {
        out.push({ id: s.id, sort: 'episode', label: s.title, text: `self-contained (${s.beats} beats within ${s.hi - s.lo + 1} scene${s.hi - s.lo ? 's' : ''}): ${s.log.slice(0, 300)}` })
      }
      if (s.status === 'closed') {
        // WEAK-CLOSE family (story-critique.md, RoTK sweep 2026-08-14): judge the close against the promise.
        const beats = beatsOf.all(s.id) as Array<{ action: string; description: string; sceneId: string }>
        const lastCloseIdx = beats.map((b) => b.action).lastIndexOf('resolve')
        const closeIdx = lastCloseIdx >= 0 ? lastCloseIdx : beats.map((b) => b.action).lastIndexOf('supersede')
        const close = closeIdx >= 0 ? beats[closeIdx] : null
        if (close && SELF_DENYING.test(close.description)) {
          out.push({ id: s.id, sort: 'weak-close', label: s.title, text: `close reads as a NON-EVENT — gate: ${(s.gate ?? '—').slice(0, 160)} · close@${close.sceneId}: ${close.description.slice(0, 200)}` })
        }
        const trailing = closeIdx >= 0 ? beats.slice(closeIdx + 1) : []
        if (trailing.length) {
          out.push({
            id: s.id,
            sort: 'post-close',
            label: s.title,
            text: `beats continue AFTER the close@${close?.sceneId} — trailing: ${trailing.map((b) => `${b.action}@${b.sceneId}: ${b.description.slice(0, 120)}`).join(' → ').slice(0, 300)}`
          })
        }
      }
    }

    // Scenes where NO thread moves (the probe's ch120 case shows these need the confirm step most).
    const silent = db
      .prepare(
        `SELECT u.unit_id AS id, COALESCE(u.title, u.unit_id) AS title
           FROM narrative_units u JOIN unit_order o ON o.unit_id = u.unit_id
          WHERE u.type = 'scene' AND u.unit_id NOT IN (SELECT DISTINCT scene_id FROM thread_events)
          ORDER BY o.linear_pos`
      )
      .all() as Array<{ id: string; title: string }>
    for (const sc of silent) out.push({ id: sc.id, sort: 'silent-scene', label: sc.title, text: 'no thread opens, advances, or resolves in this scene' })
    return out
  } finally {
    db.close()
  }
}

/** The whole critique pass's inputs, or null when there's nothing to judge (no timeline, or zero candidates). */
export function critiqueInputs(workRoot: string): CritiqueInputs | null {
  const base = continuityInputs(workRoot) // shared timeline rendering (facts + threads + checkpoint + promptV)
  if (!base) return null
  const candidates = critiqueCandidates(workRoot)
  if (!candidates.length) return null
  return { checkpoint: base.checkpoint, candidates, threads: base.threads, facts: base.facts, promptVersion: base.promptVersion }
}

/** Whole-story freshness key — any candidate/thread/fact/version movement re-stales the pass. */
export function critiqueInputHash(inputs: CritiqueInputs): string {
  const h = createHash('sha256')
  h.update(inputs.promptVersion).update('\0').update(CRITIQUE_LOGIC_VERSION).update('\0')
  for (const c of inputs.candidates) h.update(c.id).update('\x01').update(c.sort).update('\x01').update(c.text).update('\0')
  for (const t of inputs.threads) h.update(t.threadId).update('\x01').update(t.text).update('\0')
  for (const f of inputs.facts) h.update(f.sceneId).update('\x01').update(f.text).update('\0')
  return h.digest('hex')
}

/** pending = never run · stale = inputs moved since · fresh = unchanged (or nothing to judge). */
export function critiqueStatus(workRoot: string): 'pending' | 'stale' | 'fresh' {
  const inputs = critiqueInputs(workRoot)
  if (!inputs) return 'fresh'
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return 'pending'
  const db = openReadonly(dbPath)
  try {
    const runId = runIdFor('t3', 'critique', 'story', inputs.checkpoint)
    const row = db.prepare('SELECT input_hash AS h FROM inference_runs WHERE run_id = ?').get(runId) as { h?: string } | undefined
    if (!row?.h) return 'pending'
    return row.h === critiqueInputHash(inputs) ? 'fresh' : 'stale'
  } finally {
    db.close()
  }
}
