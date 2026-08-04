/**
 * coherence.ts — the inputs the T3 coherence pass diffs (see internal/ingest-model.md).
 *
 * Coherence is the one place the two layers meet: the author's DECLARED intent (a character's world
 * page — an opaque profile we don't parse for fields) vs the model's OBSERVED understanding (that
 * character's arc reduction — the window summaries + arc-event deltas the T2 pass already built).
 * This module gathers those two sides per character and reports staleness; the reader turns them into
 * an AI call, and writeTier(coherence) persists the findings. It reads REDUCTIONS, never raw dialogue —
 * the arc is the signal, so a re-read of the page or the arc is what makes a character's coherence stale.
 *
 * One global checkpoint (the chapter of the last scene = "as of the end of the story"): the whole pass is
 * a single AI call over the cast, and every character's findings hang off that one checkpoint. Per-chapter
 * checkpoints are a scale-up we defer (a small/medium work is one call).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { openReadonly } from '@engine/data/db'
import { listCharacterArcs, listEntityArcs, listEntityTracks, significantEntityIds } from '@engine/data/queries'
import { worldCategoryByKey } from '@shared/config/worldCategories'
import { profileForCoherence } from '@engine/analysis/rollups'
import { tierInputHash, runIdFor } from '@engine/data/writeTier'
import type { CharacterArc, CoherenceStatusRow } from '@shared/ipc'

function dbPathFor(workRoot: string): string {
  return join(workRoot, '.nvs', 'nvs.db')
}

/** One character's two sides, ready for the diff prompt. `declared` is the page profile (opaque); `observed`
 *  is the arc reduction. `entityId` is the diff target (the model copies it back onto each finding). */
import { annotateSecretIds } from '@engine/io/secrets'

export interface CoherenceInput {
  entityId: string
  name: string
  declared: string
  observed: string
}

/**
 * The single checkpoint the whole pass hangs off: the chapter we have an ARC for that reaches furthest in
 * reading order — "as of the end of the story." Keyed off character_windows (the observed side), NOT the
 * last scene's parent: a stray scene parked in an `orphan` bucket would otherwise become the checkpoint
 * (it has no arc to diff). Stable + a real chapter, so re-runs replace cleanly. Null when no arc yet.
 */
export function coherenceCheckpoint(workRoot: string): string | null {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return null
  const db = openReadonly(dbPath)
  try {
    const r = db
      .prepare(
        `SELECT cw.chapter_id AS c, MAX(o.linear_pos) AS p
           FROM character_windows cw
           JOIN narrative_units u ON u.parent_id = cw.chapter_id AND u.type = 'scene'
           JOIN unit_order o ON o.unit_id = u.unit_id
          GROUP BY cw.chapter_id
          ORDER BY p DESC LIMIT 1`
      )
      .get() as { c: string | null } | undefined
    return r?.c ?? null
  } finally {
    db.close()
  }
}

/** The character page's authored profile as text — frontmatter (minus housekeeping) + body. Opaque: we
 *  hand the model the page as the author wrote it, not parsed fields. Null when there's NO page (nothing
 *  to diff against / nothing to suggest editing); '' when the page exists but is empty (every trait a gap). */
function declaredProfile(workRoot: string, entityId: string, folders: string[] = ['characters']): string | null {
  let raw: string | null = null
  for (const folder of folders) {
    const dir = join(workRoot, 'content', 'world', folder)
    if (!existsSync(dir)) continue
    const direct = join(dir, `${entityId}.md`)
    if (existsSync(direct)) { raw = readFileSync(direct, 'utf8'); break }
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md') || /^readme/i.test(f)) continue
      const r = readFileSync(join(dir, f), 'utf8')
      try {
        if (String(matter(r).data.id ?? '') === entityId) { raw = r; break }
      } catch {
        /* skip unparseable */
      }
    }
    if (raw != null) break
  }
  if (raw == null) return null
  const { data, content } = matter(raw)
  const fm = Object.entries(data)
    .filter(([k]) => !['id', 'kind', 'created', 'updated'].includes(k))
    .map(([k, v]) => `${k}: ${v && typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  return [fm.join('\n'), content.trim()].filter(Boolean).join('\n\n').trim()
}

/** A character's arc reduction as text — the `observed` side (a reduction, never raw dialogue). Each window
 *  is anchored by its window id so a finding can cite it in `evidence_unit_ids`.
 *  WORKING-SET (M3): when a stored PROFILE exists, the profile paragraph carries the compressed narrative of the
 *  folded-away past + the windows AFTER its checkpoint get FULL detail — bounded at any corpus size.
 *  CITATIONS: the profile paragraph is unanchored, so the folded windows ALSO get a COMPACT anchored index (one
 *  line each) spanning the whole arc. Without it, a profile caught up to the last chapter left the observed side
 *  a single unanchored paragraph → every finding cited nothing and defaulted to the checkpoint (the "only the
 *  last volume surfaces" bug, Three Kingdoms 2026-07-18). Now a finding can cite where a trait FIRST appeared,
 *  not just recent windows. No profile (small works, first run) → all windows in full (unchanged). */
function fullBlock(w: CharacterArc['windows'][number]): string {
  const lines = [`[${w.title} · ${w.windowId}]${w.summary ? ` ${w.summary}` : ''}`]
  for (const e of w.events) lines.push(`  • ${e.change} ${e.category}: ${e.value}${e.description ? ` — ${e.description}` : ''}`)
  for (const g of w.goals) lines.push(`  goal (${g.status}): ${g.goal}`)
  for (const c of w.conflicts) lines.push(`  conflict (${c.kind}) over ${c.over}${c.with.length ? ` with ${c.with.join(', ')}` : ''}`)
  return lines.join('\n')
}

function observedText(arc: CharacterArc, profile?: { throughChapterId: string; throughTitle: string; body: string } | null): string {
  const idx = profile ? arc.windows.findIndex((w) => w.windowId === profile.throughChapterId) : -1
  if (!profile || idx < 0) return arc.windows.map(fullBlock).join('\n\n') // no profile → all windows, full detail

  const past = arc.windows.slice(0, idx + 1) // folded into the profile paragraph — keep a compact anchored index
  const recent = arc.windows.slice(idx + 1) // since the checkpoint — full detail
  const head = `PROFILE (through ${profile.throughTitle}): ${profile.body}`
  // One anchored line per folded window (its key deltas), so the compressed past stays CITABLE across the arc.
  const pastIndex = past.length
    ? 'EARLIER — folded into the profile above; cite these ids for where a trait first appears:\n' +
      past
        .map((w) => {
          const beats = w.events.map((e) => `${e.change} ${e.category}: ${e.value}`).join('; ')
          return `[${w.title} · ${w.windowId}]${w.summary ? ` ${w.summary}` : ''}${beats ? ` — ${beats}` : ''}`
        })
        .join('\n')
    : ''
  return [head, pastIndex, recent.map(fullBlock).join('\n\n')].filter(Boolean).join('\n\n')
}

/** The cast to diff: every character with an arc (observed behaviour) AND a world page (a declared side to
 *  measure it against). A character with no page is skipped — there's nothing to compare or suggest editing. */
export function coherenceInputs(workRoot: string): CoherenceInput[] {
  const out: CoherenceInput[] = []
  const significant = significantEntityIds(workRoot) // scale cap: skip the long tail of a huge paged cast
  for (const a of listCharacterArcs(workRoot)) {
    if (significant.size && !significant.has(a.entityId)) continue
    const declared = declaredProfile(workRoot, a.entityId)
    if (declared == null) continue // no page → nothing to diff
    out.push({
      entityId: a.entityId,
      name: a.name,
      declared: annotateSecretIds(declared) || '(no profile authored yet — every observed trait is a gap)',
      observed: observedText(a, profileForCoherence(workRoot, a.entityId))
    })
  }
  return out
}

/**
 * The THINGS to diff: every paged item/faction with an arc — same declared-vs-observed shape as the cast.
 * PAGE-GATED by design (unlike the arc): coherence measures the story against a declaration, so an unpaged
 * discovery has nothing to diff — and this is what keeps entity coherence from flooding (a work pages only
 * the things it cares about). The item page's `## Secrets` participates exactly like a character's.
 */
export function entityCoherenceInputs(workRoot: string): CoherenceInput[] {
  const out: CoherenceInput[] = []
  const typeOf = new Map(listEntityTracks(workRoot).map((t) => [t.id, t.type]))
  for (const a of listEntityArcs(workRoot)) {
    const type = typeOf.get(a.entityId)
    const folder = type ? worldCategoryByKey(type)?.folder : undefined
    if (!folder) continue
    const declared = declaredProfile(workRoot, a.entityId, [folder])
    if (declared == null) continue // no page → nothing to diff (the gate)
    out.push({
      entityId: a.entityId,
      name: a.name,
      declared: annotateSecretIds(declared) || '(page exists but is empty — every observed change is a gap)',
      observed: observedText(a)
    })
  }
  return out
}

/**
 * Each candidate character's coherence freshness against the current inputs (page bytes + dialogue through
 * the checkpoint, the same recipe writeTier records). pending = never checked; stale = page or dialogue
 * changed since; fresh = unchanged. The count of pending+stale is the "Check coherence (N)" badge.
 */
export function coherenceStatus(workRoot: string): CoherenceStatusRow[] {
  const checkpoint = coherenceCheckpoint(workRoot)
  if (!checkpoint) return []
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    return [...coherenceInputs(workRoot), ...entityCoherenceInputs(workRoot)].map((c) => {
      const runId = runIdFor('t3', 'coherence', c.entityId, checkpoint)
      const row = db.prepare('SELECT input_hash AS h FROM inference_runs WHERE run_id = ?').get(runId) as { h?: string } | undefined
      if (!row?.h) return { entityId: c.entityId, name: c.name, status: 'pending' as const }
      const cur = tierInputHash(workRoot, 'coherence', c.entityId, checkpoint, db)
      return { entityId: c.entityId, name: c.name, status: cur === row.h ? ('fresh' as const) : ('stale' as const) }
    })
  } finally {
    db.close()
  }
}
