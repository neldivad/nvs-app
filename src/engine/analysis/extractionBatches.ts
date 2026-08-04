/**
 * The extraction PACKER (internal/batched-extraction.md · stage ① Plan).
 *
 * Turns a scene frontier into an ordered list of BATCHES — each a group of scenes small enough to extract in
 * one LLM turn under the per-turn OUTPUT cap (the binding constraint; input fits in 1M with room). The packer
 * is deterministic and content-free: it reads only each scene's dialogue VOLUME (to estimate output), its
 * linear position (to keep reading order), and its chapter (a preferred, not required, batch boundary).
 *
 * A batch is a RUN-TIME scheduling unit, never a storage unit — results still write per `scene_id`, so a
 * single-scene edit is simply a batch of one and incremental re-reads keep their granularity.
 *
 * `packBatches` is the pure algorithm (fixture-testable, no DB); `planExtractionBatches` gathers the scene
 * facts from the DB and calls it.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type DatabaseType from 'better-sqlite3'
import { openDb, openReadonly } from '@engine/data/db'
import { BATCH_CONFIG } from '@shared/config/extraction'

// ── Per-project output calibration ────────────────────────────────────────────────────────────────────────
// The packer sizes batches on an ESTIMATE of output volume (k = out-chars per dialogue-char). One global k can't
// fit every book — a narration-heavy classic emits ~2x the structured output of a dialogue-dense screenplay from
// the same dialogue volume. So after each batch the reader records the REALIZED (dialogueChars, outChars), and
// the packer reads back THIS project's median k. The BATCH_CONFIG constant is only the cold-start prior.
// Stored in a LOCAL table (not the vendored migration schema — an NVS analysis aid, not shared wire state),
// created on first write; the packer reads it read-only and falls back to the prior when it's absent/thin.
const CALIBRATION_WINDOW = 40 // realized samples kept per depth (a book's k can drift as it grows — favor recent)
const CALIBRATION_MIN = 3 // need at least this many before the learned k is trusted over the prior
const CALIBRATION_DDL = `CREATE TABLE IF NOT EXISTS extraction_calibration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  depth TEXT NOT NULL,
  dialogue_chars INTEGER NOT NULL,
  out_chars INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

/** Record one batch's realized output vs its dialogue volume — the raw sample the learned k is computed from. */
export function recordExtractionSample(workRoot: string, depth: 'skim' | 'full', dialogueChars: number, outChars: number): void {
  if (dialogueChars <= 0 || outChars <= 0) return
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return
  const db = openDb(dbPath)
  try {
    db.exec(CALIBRATION_DDL)
    db.prepare('INSERT INTO extraction_calibration (depth, dialogue_chars, out_chars) VALUES (?, ?, ?)').run(depth, Math.round(dialogueChars), Math.round(outChars))
    // Keep only the most recent window per depth so old passes (or a since-edited book) don't anchor the estimate.
    // NAMED params (@depth/@limit), NOT numbered `?1`/`?2`: better-sqlite3 mis-binds `?NNN` syntax (it counted the
    // reused `?1` + `?2` as 3 slots and rejected the 2-value array as "Too many parameter values were provided").
    // This threw on EVERY successful batch, on every backend — the calibration write silently failing the whole
    // batch after the read succeeded. Named params bind by name, reuse cleanly, and count correctly.
    db.prepare(
      `DELETE FROM extraction_calibration WHERE depth = @depth AND id NOT IN
         (SELECT id FROM extraction_calibration WHERE depth = @depth ORDER BY id DESC LIMIT @limit)`
    ).run({ depth, limit: CALIBRATION_WINDOW })
  } finally {
    db.close()
  }
}

/** This project's learned k for a depth = median(out_chars / dialogue_chars) over recent batches, or null when
 *  there isn't enough history yet (the packer then uses the cold-start prior). Median is robust to the odd dense
 *  batch; the target's headroom absorbs the remaining variance. Takes an already-open readonly db (the packer's). */
function learnedKFromDb(db: DatabaseType.Database, depth: 'skim' | 'full'): number | null {
  try {
    const rows = db
      .prepare('SELECT dialogue_chars AS d, out_chars AS o FROM extraction_calibration WHERE depth = ? ORDER BY id DESC LIMIT ?')
      .all(depth, CALIBRATION_WINDOW) as Array<{ d: number; o: number }>
    if (rows.length < CALIBRATION_MIN) return null
    return median(rows.map((r) => r.o / r.d))
  } catch {
    return null // table absent (never calibrated) → prior
  }
}

/** The co-located analysis DB (matches the private helper each engine module keeps). */
function dbPathFor(workRoot: string): string {
  return join(workRoot, '.nvs', 'nvs.db')
}

/** One scene's packing facts — the only inputs the algorithm needs. */
export interface SceneEstimate {
  sceneId: string
  chapterId: string | null // parent unit; null = flat/top-level (packs by budget alone)
  pos: number // linear reading position (unit_order.linear_pos)
  estOutTokens: number // expected extraction output, from dialogue volume × k
}

/** A packed batch — the extract pass runs one LLM turn per batch, distributing results back by scene_id. */
export interface ExtractionBatch {
  batchId: string // deterministic: `batch:<first sceneId>` (stable across re-plans → resumable)
  sceneIds: string[]
  chapterIds: string[] // distinct chapters this batch spans (for the chapter-node preview)
  estOutTokens: number
  oversized: boolean // a lone scene whose own estimate exceeds the cap — flagged for the author
}

export interface PackOptions {
  targetOutTokens: number
  chapterBoundarySoftFill: number
}

const DEFAULT_PACK: PackOptions = {
  targetOutTokens: BATCH_CONFIG.targetOutTokens,
  chapterBoundarySoftFill: BATCH_CONFIG.chapterBoundarySoftFill
}

/**
 * Bin-pack scenes (in reading order) into output-bounded batches. Rules, in priority order:
 *   1. A scene whose OWN estimate exceeds the cap is its own batch (oversized:true) — can't be split; flagged.
 *   2. Close the current batch before a scene that would push it over the target.
 *   3. Prefer to close at a CHAPTER boundary once the batch is ≥ softFill of the target (chapter-aligned
 *      batches fold cleanly), but keep packing across the boundary while the batch is still near-empty.
 * Deterministic: same inputs → same batches (batchId derives from the first scene), so a re-plan after a
 * partial run reproduces the plan and resumes.
 */
export function packBatches(scenes: SceneEstimate[], opts: PackOptions = DEFAULT_PACK): ExtractionBatch[] {
  const ordered = [...scenes].sort((a, b) => a.pos - b.pos)
  const batches: ExtractionBatch[] = []
  let cur: SceneEstimate[] = []
  let curTokens = 0

  const flush = (): void => {
    if (cur.length === 0) return
    const chapters = [...new Set(cur.map((s) => s.chapterId).filter((c): c is string => c != null))]
    batches.push({
      batchId: `batch:${cur[0].sceneId}`,
      sceneIds: cur.map((s) => s.sceneId),
      chapterIds: chapters,
      estOutTokens: curTokens,
      oversized: cur.length === 1 && curTokens > opts.targetOutTokens
    })
    cur = []
    curTokens = 0
  }

  for (const s of ordered) {
    // Rule 1: a scene bigger than the whole budget stands alone — flush what's open, emit it solo.
    if (s.estOutTokens > opts.targetOutTokens) {
      flush()
      cur = [s]
      curTokens = s.estOutTokens
      flush()
      continue
    }
    const prev = cur.length ? cur[cur.length - 1] : null
    // Rule 3: at a chapter boundary, close early IF the batch is already respectably full.
    const crossesChapter = prev != null && prev.chapterId !== s.chapterId
    if (crossesChapter && curTokens >= opts.targetOutTokens * opts.chapterBoundarySoftFill) flush()
    // Rule 2: closing before we'd overflow the target.
    else if (cur.length && curTokens + s.estOutTokens > opts.targetOutTokens) flush()
    cur.push(s)
    curTokens += s.estOutTokens
  }
  flush()
  return batches
}

/** Median of a non-empty list (the learned-k reducer — robust to the odd dense batch). Even length averages
 *  the two middle values. Returns NaN for an empty list (callers guard on CALIBRATION_MIN first). */
export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Estimate a scene's extraction output from its dialogue volume (chars) — the packer's sizing input. `k` is
 *  output-chars-per-dialogue-char; it defaults to the full-extraction constant but the SKIM pass passes its
 *  own (~1/5) so Fast batches pack far denser. */
export function estimateSceneOutTokens(dialogueChars: number, k: number = BATCH_CONFIG.outCharsPerDialogueChar): number {
  const outChars = dialogueChars * k
  return Math.max(BATCH_CONFIG.minSceneOutTokens, Math.round(outChars / BATCH_CONFIG.charsPerToken))
}

/**
 * Gather packing facts for the given frontier scenes from the DB, then pack. `sceneIds` is the scene frontier
 * (the run's scene phase); order/chapter/volume come from the DB. Unknown ids are dropped (a deleted scene
 * can't be batched). Returns [] when there's no DB or no scenes.
 */
export function planExtractionBatches(
  workRoot: string,
  sceneIds: string[],
  opts: Partial<PackOptions> = {},
  depth: 'skim' | 'full' = 'full'
): ExtractionBatch[] {
  const packOpts: PackOptions = { ...DEFAULT_PACK, ...opts }
  if (sceneIds.length === 0) return []
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    // Output sizing: use THIS project's learned k once it has run history; else the cold-start prior, INFLATED
    // (we don't yet know if this book realizes ~2x like Three Kingdoms did — smaller safe batches until run 2).
    // Skim emits ~1/5 the output, so its prior is much lower or it would pack one scene per batch like full.
    const prior = depth === 'skim' ? BATCH_CONFIG.skimOutCharsPerDialogueChar : BATCH_CONFIG.outCharsPerDialogueChar
    const k = learnedKFromDb(db, depth) ?? prior * BATCH_CONFIG.coldStartKInflation
    const want = new Set(sceneIds)
    // One pass: each scene's chapter (parent), linear pos, and dialogue volume (0 when unspoken → floor applies).
    const rows = db
      .prepare(
        `SELECT u.unit_id AS sceneId,
                u.parent_id AS chapterId,
                COALESCE(o.linear_pos, 1e9) AS pos,
                COALESCE((SELECT SUM(LENGTH(d.text)) FROM dialog_nodes d WHERE d.unit_id = u.unit_id), 0) AS dialogueChars
           FROM narrative_units u
           LEFT JOIN unit_order o ON o.unit_id = u.unit_id
          WHERE u.type = 'scene'`
      )
      .all() as Array<{ sceneId: string; chapterId: string | null; pos: number; dialogueChars: number }>
    const estimates: SceneEstimate[] = rows
      .filter((r) => want.has(r.sceneId))
      .map((r) => ({ sceneId: r.sceneId, chapterId: r.chapterId, pos: r.pos, estOutTokens: estimateSceneOutTokens(r.dialogueChars, k) }))
    return packBatches(estimates, packOpts)
  } finally {
    db.close()
  }
}

/**
 * The output-token budget per batch for a given backend — the packer's target. Two ceilings, take the min:
 *   • OUTPUT CAP — the model's per-turn output limit (BATCH_CONFIG.targetOutTokens, ~50k). Binds on FAST APIs.
 *   • TIMEOUT — a batch must EMIT within the turn watchdog. On the slow plan host (~20 out-chars/s, serial), a
 *     50k-token batch would need ~2.5h in ONE call and blow the 10-min watchdog, losing all 30 scenes at once
 *     (found the hard way 2026-07-18). So plan's budget = what it can actually emit in a turn, which lands it
 *     back near per-scene — correct: plan is output-bound and serial, big batches can't help it, only hurt.
 * `turnMs` is the plan turn timeout (env NVS_PLAN_TURN_TIMEOUT); `isPlan` picks whether the timeout ceiling
 * applies (keyed APIs stream ~15× faster and parallelize, so the cap is their only bound).
 */
export function batchOutBudget(isPlan: boolean, turnMs: number, apiOutCap?: number): number {
  // API: the HARD ceiling is the call's max_tokens — a batch that would emit more truncates its JSON mid-array.
  // `apiOutCap` is the model's REAL cap (resolved from the Models API, e.g. haiku's 64k vs the 8k default); the
  // budget is min(theoretical target, cap × margin) so it fills bigger models fully but never over-packs.
  if (!isPlan) {
    const cap = apiOutCap && apiOutCap > 0 ? apiOutCap : BATCH_CONFIG.apiMaxOutTokens
    return Math.min(BATCH_CONFIG.targetOutTokens, Math.floor(cap * BATCH_CONFIG.apiBatchFillFraction))
  }
  const emittableChars = (turnMs / 1000) * BATCH_CONFIG.planOutCharsPerSec * BATCH_CONFIG.planTurnFillFraction
  return Math.max(BATCH_CONFIG.minSceneOutTokens, Math.round(emittableChars / BATCH_CONFIG.charsPerToken))
}
