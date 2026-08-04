/**
 * continuity.ts — the inputs the CONTINUITY coherence pass diffs (internal/continuity-coherence.md).
 *
 * The SECOND kind of coherence. Where coherence.ts (Fidelity) diffs one page's DECLARED profile against that
 * entity's OBSERVED arc — "does X behave like its page says" — Continuity diffs the story against ITSELF: facts and
 * world-rules contradicting each other. No page is required, and a finding is cross-entity (an item + a scene, a
 * fact vs a later fact), so it may carry no entity_id at all. Its three kinds are the categories the plot-hole craft
 * literature logs — continuity-error / logic-gap / rule-break — deliberately not duplicating "out-of-character"
 * (Fidelity's job) or "unresolved thread" (the quest-verdict pass's job).
 *
 * Two sides, both assembled here from data that already exists:
 *   DECLARED  the world's RULES — every lore page (cosmology, history, magic/physics rules) + item/faction pages
 *             (an object's properties, a faction's allegiance). Opaque text, handed over as the author wrote it.
 *   OBSERVED  the story's own FACT TIMELINE — per-scene extracted facts (summary, exits, plot-times, conflicts)
 *             in reading order, plus each thread's beats (open → resolve + outcome). Anchored `[title · scene_id]`
 *             / `[thread · thread_id]` so a finding can cite where the break is.
 *
 * The reader (main/ai/continuityReader.ts) chunks this + turns it into ONE whole-story AI call; writeTier persists
 * the findings with the CONTINUITY kinds. Freshness is whole-story: any scene fact / thread / rule / premise change
 * re-stales the pass (continuityInputHash), unlike Fidelity's per-entity scoped rebuild.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import matter from 'gray-matter'
import { openReadonly } from '@engine/data/db'
import { coherenceCheckpoint } from '@engine/analysis/coherence'
import { runIdFor } from '@engine/data/writeTier'
import { entityNameVariants, normName } from '@shared/entityNames'
import { CONTINUITY_LOGIC_VERSION, analysisPromptVersion } from '@shared/config/extraction'
import { loadProjectInfo } from '@engine/content/projectInfo'
import type DatabaseType from 'better-sqlite3'

function dbPathFor(workRoot: string): string {
  return join(workRoot, '.nvs', 'nvs.db')
}

/** One scene's fact line on the observed timeline, anchored by its scene id (so a finding can cite it). */
export interface FactLine {
  sceneId: string
  title: string
  chapter: string | null
  pos: number
  text: string
}
/** One thread's beat line (open → resolve, with outcomes) — the material for thread↔thread contradictions. */
export interface ThreadLine {
  threadId: string
  title: string
  text: string
}
/** The whole continuity pass's inputs at the checkpoint. `null` from continuityInputs when there's nothing to diff. */
export interface ContinuityInputs {
  checkpoint: string
  declared: string
  facts: FactLine[]
  threads: ThreadLine[]
  /** The KIND-adjusted prompt version (analysisPromptVersion) captured at build time, so the hash re-stales on a
   *  fiction↔non-fiction switch. Stamped here (not read in the hash) to keep continuityInputHash's signature — its
   *  three callers all pass only `inputs`. */
  promptVersion: string
}

const J = (s: string | null | undefined): unknown[] => {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/**
 * The DECLARED bundle — the world's rule/property pages, as one opaque block (we hand the model the pages as the
 * author wrote them, like Fidelity does). Pure so the reader/tests can assemble from parts.
 */
export function assembleDeclared(pages: { id: string; body: string }[]): string {
  if (!pages.length) return ''
  return (
    'WORLD RULES & PROPERTIES (what the world declares is true — cosmology, history, object properties, allegiances):\n' +
    pages.map((p) => `[${p.id}]\n${p.body.trim()}`).join('\n\n')
  )
}

/** Every rule/property page — the lore, item, and faction folders. Opaque (frontmatter minus housekeeping + body). */
function readRulePages(workRoot: string): { id: string; body: string }[] {
  const out: { id: string; body: string }[] = []
  for (const folder of ['lore', 'items', 'factions']) {
    const dir = join(workRoot, 'content', 'world', folder)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md') || /^readme/i.test(f)) continue
      let raw: string
      try {
        raw = readFileSync(join(dir, f), 'utf8')
      } catch {
        continue
      }
      const { data, content } = matter(raw)
      const id = String(data.id ?? f.replace(/\.md$/, ''))
      const fm = Object.entries(data)
        .filter(([k]) => !['id', 'kind', 'created', 'updated'].includes(k))
        .map(([k, v]) => `${k}: ${v && typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      const body = [fm.join('\n'), content.trim()].filter(Boolean).join('\n\n').trim()
      if (body) out.push({ id, body })
    }
  }
  return out
}

/** Format one scene's fact line: the summary plus the structured facts a plot-hole hinges on. We deliberately do
 *  NOT emit a "present" character list: the extraction's `characters_json` conflates PHYSICALLY-PRESENT with
 *  MENTIONED/DISCUSSED, so feeding it as presence made the model flag "dead character present" whenever the dead
 *  were merely eulogised (Liu Bei discussed in the scene after his death — a false positive, 2026-07-20). The
 *  summary already narrates who actually acts; `at:` (scene locations) is unambiguous and stays. Pure — the string
 *  a finding's evidence points at. */
export function formatFactLine(row: {
  summary: string | null
  locations_json: string | null
  exits_json: string | null
  plot_times_json: string | null
  conflicts_json: string | null
}): string {
  const bits: string[] = []
  if (row.summary?.trim()) bits.push(row.summary.trim())
  const where = (J(row.locations_json) as string[]).filter((t) => typeof t === 'string' && t.trim())
  if (where.length) bits.push(`at: ${where.join(', ')}`) // scene setting (unambiguous, unlike character presence)
  // Irreversible exits are the classic continuity trap (a dead/departed entity must not reappear).
  const exits = (J(row.exits_json) as { entity?: string; kind?: string; reversible?: boolean }[])
    .filter((e) => e.reversible === false && e.entity)
    .map((e) => `${e.entity} exits (${e.kind ?? 'gone'}, irreversible)`)
  if (exits.length) bits.push(`⚑ ${exits.join('; ')}`)
  const times = (J(row.plot_times_json) as string[]).filter((t) => typeof t === 'string' && t.trim())
  if (times.length) bits.push(`time: ${times.join(', ')}`)
  const conflicts = (J(row.conflicts_json) as { over?: string; between?: string[] }[])
    .filter((c) => c.over)
    .map((c) => `${c.over}${c.between?.length ? ` (${c.between.join(' vs ')})` : ''}`)
  if (conflicts.length) bits.push(`conflict: ${conflicts.join('; ')}`)
  return bits.join(' · ')
}

/** The checkpoint's cutoff — the last reading-order position we include facts through (end of story). */
function checkpointCutoff(db: DatabaseType.Database, checkpoint: string): number {
  const r = db
    .prepare(
      `SELECT MAX(o.linear_pos) AS p FROM narrative_units u JOIN unit_order o ON o.unit_id = u.unit_id
        WHERE u.parent_id = ? AND u.type = 'scene'`
    )
    .get(checkpoint) as { p: number | null } | undefined
  if (r?.p != null) return r.p
  const all = db.prepare(`SELECT MAX(linear_pos) AS p FROM unit_order`).get() as { p: number | null } | undefined
  return all?.p ?? Number.MAX_SAFE_INTEGER
}

/** The scene fact timeline in reading order, each line anchored by its scene id. */
function readSceneFacts(db: DatabaseType.Database, cutoff: number): FactLine[] {
  const rows = db
    .prepare(
      `SELECT u.unit_id AS sceneId, u.title AS title, u.parent_id AS chapter, o.linear_pos AS pos,
              e.summary, e.locations_json, e.exits_json, e.plot_times_json, e.conflicts_json
         FROM narrative_units u
         JOIN unit_order o ON o.unit_id = u.unit_id
         LEFT JOIN extracted_scenes e ON e.scene_id = u.unit_id
        WHERE u.type = 'scene' AND o.linear_pos <= ?
        ORDER BY o.linear_pos`
    )
    .all(cutoff) as Array<{
    sceneId: string
    title: string | null
    chapter: string | null
    pos: number
    summary: string | null
    locations_json: string | null
    exits_json: string | null
    plot_times_json: string | null
    conflicts_json: string | null
  }>
  return rows
    .map((r) => ({ sceneId: r.sceneId, title: r.title ?? r.sceneId, chapter: r.chapter, pos: r.pos, text: formatFactLine(r) }))
    .filter((f) => f.text) // a scene with no extracted facts yet contributes nothing to diff
}

/** Each thread's beats as one line (open → advance → resolve, with the outcome) — the thread↔thread material. */
function readThreadBeats(db: DatabaseType.Database, cutoff: number): ThreadLine[] {
  const threads = db
    .prepare(`SELECT thread_id AS id, COALESCE(title, description, thread_id) AS title FROM narrative_threads`)
    .all() as Array<{ id: string; title: string }>
  const out: ThreadLine[] = []
  for (const t of threads) {
    const beats = db
      .prepare(
        `SELECT te.action AS action, te.description AS description
           FROM thread_events te JOIN unit_order o ON o.unit_id = te.scene_id
          WHERE te.thread_id = ? AND o.linear_pos <= ?
          ORDER BY o.linear_pos`
      )
      .all(t.id, cutoff) as Array<{ action: string; description: string | null }>
    if (!beats.length) continue
    const text = beats.map((b) => `${b.action}${b.description ? `: ${b.description}` : ''}`).join(' → ')
    out.push({ threadId: t.id, title: t.title, text })
  }
  return out
}

/**
 * The whole continuity pass's inputs, or `null` when there's nothing to diff (no checkpoint, or no scene facts and
 * no threads yet). Reads a fresh read-only connection.
 */
export function continuityInputs(workRoot: string): ContinuityInputs | null {
  const checkpoint = coherenceCheckpoint(workRoot)
  if (!checkpoint) return null
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return null
  const db = openReadonly(dbPath)
  try {
    const cutoff = checkpointCutoff(db, checkpoint)
    const facts = readSceneFacts(db, cutoff)
    const threads = readThreadBeats(db, cutoff)
    if (!facts.length && !threads.length) return null
    const declared = assembleDeclared(readRulePages(workRoot))
    return { checkpoint, declared, facts, threads, promptVersion: analysisPromptVersion(loadProjectInfo(workRoot).domain) }
  } finally {
    db.close()
  }
}

/**
 * The continuity input hash — the whole-story freshness key. Content-addressed over the declared bundle + every
 * fact line + every thread line + the version knobs, so ANY change to a rule, the premise, a scene's facts, or a
 * thread's beats re-stales the pass. The reader stamps this as the run's input_hash; continuityStatus compares.
 */
export function continuityInputHash(inputs: ContinuityInputs): string {
  const h = createHash('sha256')
  h.update(inputs.promptVersion).update('\0').update(CONTINUITY_LOGIC_VERSION).update('\0')
  h.update(inputs.declared).update('\0')
  for (const f of inputs.facts) h.update(f.sceneId).update('\x01').update(f.text).update('\0')
  for (const t of inputs.threads) h.update(t.threadId).update('\x01').update(t.text).update('\0')
  return h.digest('hex')
}

/**
 * A resolver from the model's free-text entity name → the canonical entity id — the continuity pass's FK-validation.
 * The AI returns entity_id as it reads a name in the facts ("Emperor Ling"), NOT the id ("emperor-ling", whose entity
 * name is bilingual "靈帝 Emperor Ling"). Without this, each finding attaches to a phantom name-keyed row that draws its
 * own cast lane beside the real entity (the "2 Emperor Lings" bug, 2026-07-20). Bilingual-aware via entityNameVariants
 * (the same resolver queries/writeTier use). Returns null for an unresolvable name → the finding stays work-level.
 */
export function entityIdResolver(workRoot: string): (raw: string) => string | null {
  const map = new Map<string, string>() // normalized name variant → entity id
  const ids = new Set<string>() // canonical ids (a model that DID return an id passes straight through)
  const dbPath = dbPathFor(workRoot)
  if (existsSync(dbPath)) {
    const db = openReadonly(dbPath)
    try {
      const ents = db.prepare('SELECT entity_id AS id, name, aliases_json AS aliases FROM entities').all() as Array<{ id: string; name: string; aliases: string | null }>
      for (const e of ents) {
        ids.add(e.id)
        let aliases: string[] = []
        try {
          const a = JSON.parse(e.aliases ?? '[]')
          if (Array.isArray(a)) aliases = a.filter((x): x is string => typeof x === 'string')
        } catch {
          /* bad aliases json — skip */
        }
        for (const v of entityNameVariants({ id: e.id, name: e.name, aliases })) if (!map.has(v)) map.set(v, e.id)
      }
    } finally {
      db.close()
    }
  }
  return (raw: string): string | null => {
    const r = raw?.trim()
    if (!r) return null
    if (ids.has(r)) return r // already a canonical id
    return map.get(normName(r)) ?? null
  }
}

/** Whole-story continuity freshness: pending = never run; stale = inputs moved since; fresh = unchanged. */
export function continuityStatus(workRoot: string): 'pending' | 'stale' | 'fresh' {
  const inputs = continuityInputs(workRoot)
  if (!inputs) return 'fresh' // nothing to check reads as up-to-date (no badge)
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return 'pending'
  const db = openReadonly(dbPath)
  try {
    const runId = runIdFor('t3', 'continuity', 'story', inputs.checkpoint)
    const row = db.prepare('SELECT input_hash AS h FROM inference_runs WHERE run_id = ?').get(runId) as { h?: string } | undefined
    if (!row?.h) return 'pending'
    return row.h === continuityInputHash(inputs) ? 'fresh' : 'stale'
  } finally {
    db.close()
  }
}
