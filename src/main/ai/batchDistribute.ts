/**
 * Pure scene-reply → SceneRows mapping + batch distribution. Deliberately ENGINE-FREE (imports only shared
 * types/config, never `@engine/index`) so this — the correctness-critical parse/validate/distribute logic —
 * is unit-testable under vitest, which can't load the engine's native better-sqlite3 binding. The impure
 * readers in sceneReader.ts gather DB context and call these.
 */
import type { AnalysisDepth, SceneRows, ThreadBeatRow, TierWrite } from '@shared/ipc'
import { SKIM_EMPTY, type SceneExtraction, type BatchSceneExtraction } from '@shared/config/extraction'

/** An apply-ready scene tier entry (a TierWrite minus the engine-stamped inputHash). */
export type SceneEntry = Omit<Extract<TierWrite, { kind: 'scene' }>, 'inputHash'>
/** A batch read: one apply-ready entry per scene the model returned, plus the scenes it dropped/omitted. */
export type BatchReadResult = { entries: SceneEntry[]; skipped: { sceneId: string; reason: string }[] }

/**
 * Map the model's reading (names, snake_case) → the app's SceneRows. POV stays null (engine FK-checks it;
 * name→id resolution is a follow-on). An advance/close is kept ONLY if it names a thread that was actually
 * in this scene's as-of-N open list — so the model can't hallucinate a beat onto a thread it never saw
 * (which is what produced "opened late, advanced early").
 */
/**
 * Collapse an accidentally-repeated `thr:<scene>:` prefix. A model that echoed the full id where a bare ref
 * was expected produced "thr:S:thr:S:slug"; this normalizes it back to "thr:S:slug". Idempotent — a
 * well-formed id passes through unchanged. This is the ONE canonical form every thread reference resolves to,
 * so opens and advances always land on the same id (no split threads, no advance dropped as dangling).
 */
export function canonicalThreadId(id: string): string {
  return id.replace(/^(thr:[^:]+:)\1+/, '$1')
}

/**
 * Mint a thread id from a scene + the model's open `ref`. The ref SHOULD be a bare snake_case handle
 * ("dong_zhuo_tyranny"), but models sometimes echo back the FULL id they see in the open-threads context
 * ("thr:sanguo-ch003:dong_zhuo_tyranny") — prepending again produced doubled "thr:...thr:..." ids. If the ref
 * already carries the prefix, trust it as the whole id; else build the canonical form. Always canonicalized.
 */
export function mintThreadId(sceneId: string, ref: string): string {
  return canonicalThreadId(ref.startsWith('thr:') ? ref : `thr:${sceneId}:${ref}`)
}

export function toRows(unitId: string, x: SceneExtraction, validThreadIds: Set<string>, allowedThings: Set<string>): SceneRows {
  const threads: ThreadBeatRow[] = []
  for (const t of x.threads ?? []) {
    if (t.action === 'open') {
      threads.push({
        threadId: mintThreadId(unitId, t.ref),
        subject: null,
        action: 'open',
        sortPos: null,
        evidence: null,
        confidence: null,
        description: t.description ?? null,
        umbrella: { description: t.description || t.ref, title: t.title ?? null, threadType: t.thread_type ?? null, builtBy: 'inferred', resolutionCondition: t.resolves_when ?? null }
      })
    } else if (t.thread_id && validThreadIds.has(canonicalThreadId(t.thread_id))) {
      threads.push({
        threadId: canonicalThreadId(t.thread_id),
        subject: null,
        action: t.action === 'close' ? 'resolve' : 'advance',
        sortPos: null,
        evidence: null,
        confidence: null,
        description: t.description ?? null
      })
    }
  }
  return {
    extracted: {
      summary: x.summary ?? null,
      premise: x.premise ?? null,
      conclusion: x.conclusion ?? null,
      pov: null,
      characters: x.characters ?? [],
      locations: x.locations ?? [],
      plotTimes: x.plot_times ?? [],
      goals: x.goals ?? [],
      conflicts: x.conflicts ?? [],
      enters: x.enters ?? [],
      exits: x.exits ?? [],
      sceneContexts: x.scene_contexts ?? [],
      // Third bucket — keep only things whose category was actually offered (the writer re-guards too).
      things: (x.things ?? [])
        .filter((t) => t && typeof t.name === 'string' && t.name.trim() && allowedThings.has(t.category))
        .map((t) => ({ name: t.name.trim(), category: t.category, significance: t.significance ?? null, evidence: t.evidence ?? null }))
    },
    threads,
    lore: (x.lore_bombs ?? []).map((l) => ({ loreId: l.lore_ref, summary: l.summary, magnitude: l.magnitude ?? null, builtBy: 'inferred' }))
  }
}

/** Pull the JSON object out of the model's reply (tolerate a code fence or surrounding prose). */
export function parseJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(body.slice(start, end + 1))
    return obj && typeof obj === 'object' ? (obj as T) : null
  } catch {
    return null
  }
}

/** Pull the JSON ARRAY out of a batch reply (tolerate a code fence or surrounding prose). */
export function parseJsonArray<T>(text: string): T[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(body.slice(start, end + 1))
      if (Array.isArray(arr)) return arr as T[]
    } catch { /* fall through to the single-object coercion below */ }
  }
  // No usable array — but models routinely drop the array wrapper for a SINGLE item, returning a bare `{…}`
  // (exactly the single-scene batch case). Coerce a lone top-level object into a 1-element array rather than
  // failing the whole batch. distributeBatch keys on scene_id, so a non-scene object is harmlessly dropped.
  const obj = parseJson<T>(body)
  return obj ? [obj] : null
}

/**
 * Distribute a batch reply back to per-scene entries (internal/batched-extraction.md §6). Rules:
 *   • Match each returned object to the batch's known scene ids; DROP objects with an unknown/duplicate id
 *     (never write scene A's rows onto scene B).
 *   • A scene with no returned object is `skipped` (retried next run).
 *   • Within-batch thread continuity: a thread opened in an earlier scene is a valid advance/close target for
 *     later scenes — we grow the valid-id set and map the model's bare `ref` → the full stored thread id.
 */
export function distributeBatch(
  sceneIds: string[],
  objects: BatchSceneExtraction[],
  opts: { model: string; depth: AnalysisDepth; allowedThings: Set<string>; entryThreadIds: Set<string> }
): BatchReadResult {
  const known = new Set(sceneIds)
  const byId = new Map<string, BatchSceneExtraction>()
  for (const o of objects) {
    if (o && typeof o.scene_id === 'string' && known.has(o.scene_id) && !byId.has(o.scene_id)) byId.set(o.scene_id, o)
  }
  const running = new Set(opts.entryThreadIds) // thread ids valid to advance/close, growing as scenes open threads
  const refToId = new Map<string, string>() // a batch-opened thread's bare ref → its full stored id
  const entries: SceneEntry[] = []
  const skipped: { sceneId: string; reason: string }[] = []
  for (const sceneId of sceneIds) {
    const o = byId.get(sceneId)
    if (!o) {
      skipped.push({ sceneId, reason: 'no object returned for this scene_id' })
      continue
    }
    const x: SceneExtraction = opts.depth === 'skim' ? { ...SKIM_EMPTY, ...o } : o
    // Resolve every advance/close thread_id to the CANONICAL open id, whatever form the model used: a bare ref
    // it reused for a thread opened earlier in THIS batch (refToId), or a full/doubled id (canonicalThreadId
    // collapses a repeated prefix). Both forms end on the same id, so the fold never splits a thread or drops
    // an advance as a dangling ref.
    for (const t of x.threads ?? []) {
      if (t.action === 'open' || typeof t.thread_id !== 'string') continue
      t.thread_id = refToId.get(t.thread_id) ?? canonicalThreadId(t.thread_id)
    }
    entries.push({ tier: 't2', kind: 'scene', targetId: sceneId, asOfUnitId: null, model: opts.model, depth: opts.depth, rows: toRows(sceneId, x, running, opts.allowedThings) })
    // Register this scene's opens so later scenes in the batch can advance/close them.
    for (const t of x.threads ?? []) {
      if (t.action === 'open') {
        const id = mintThreadId(sceneId, t.ref)
        running.add(id)
        refToId.set(t.ref, id)
      }
    }
  }
  return { entries, skipped }
}
