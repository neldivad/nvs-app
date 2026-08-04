/**
 * rollups.ts — story-so-far digests on the ladder (internal/working-set.md, mechanism M2).
 *
 * Every prompt input becomes: full detail for the near past + DIGESTS of the far past. This module builds
 * the digest side, uniformly over the unit tree:
 *   - a unit's digest INPUT = its direct scene children's extracted summaries (reading order)
 *                             + its direct folder children's digests
 *   - a LEAF chapter (no folder children) digests FREE — the capped concat of its scene summaries; never
 *     stored, always derived (a pure function of extracted_scenes).
 *   - a unit WITH folder children needs one cheap LLM reduce → stored in `rollups` (011) with the same
 *     staleness recipe as every tier: input_hash over its children's current digests + the prompt version,
 *     so a scene edit re-stales exactly its ancestor chain.
 *
 * The runner plans one 'digest' step per stale reducible unit, DEEPEST FIRST (parents consume fresh
 * children within a single run). Consumers (the scene pass's story-so-far, M1/M4) read `digestFor`.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, openReadonly } from '@engine/data/db'
import { analysisPromptVersion } from '@shared/config/extraction'
import { loadProjectInfo } from '@engine/content/projectInfo'
import { hasEdges, graphAncestors, graphVersion, detectCycle, leadsToEdges, adjacencyToEdges, type Edges } from '@engine/analysis/timelineGraph'
import { readTrees, writeTrees, activeVariant } from '@engine/content/trees'
import type { TimelineStatus } from '@shared/ipc'
import type DatabaseType from 'better-sqlite3'

const CHAPTER_DIGEST_CAP = 1500 // chars — a leaf chapter's free digest (concat of scene summaries)

function dbPathFor(workRoot: string): string {
  return join(workRoot, '.nvs', 'nvs.db')
}

/** The ACTIVE tree variant's edges (`.nvs/trees.json`) as the `Edges` map — the ONE structure source the analysis
 *  walks (tree-variant model, internal/timeline-model.md ★). `adjacencyToEdges` self-heals over the current scenes
 *  (drops edges to deleted ids). Falls back to the frontmatter `leads_to` seed ONLY when there's no variant yet
 *  (a headless fixture opened without `openWork`, or a pre-mirror project); post-T9 the frontmatter is gone. */
export function activeTreeEdges(workRoot: string, scenes: ReadonlyArray<{ id: string; metadata_json: string | null }>): Edges {
  const variant = activeVariant(readTrees(workRoot))
  if (variant) return adjacencyToEdges(variant.adjacency, new Set(scenes.map((s) => s.id)))
  return leadsToEdges(scenes) // no variant → frontmatter seed (unwired/headless fixtures)
}

/** Hash a scene's ancestor-set in a graph — the per-variant thread partition key (per-variant-analysis.md). */
function hashAncestors(edges: Edges, sceneId: string): string {
  return createHash('sha256').update(graphAncestors(edges, sceneId).join(',')).digest('hex')
}
/** One scene's ancestry hash under the ACTIVE variant (for stamping a thread_events write). */
export function sceneAncestryHash(workRoot: string, scenes: ReadonlyArray<{ id: string; metadata_json: string | null }>, sceneId: string): string {
  return hashAncestors(activeTreeEdges(workRoot, scenes), sceneId)
}
/** Every scene's ancestry hash under the ACTIVE variant (for filtering reads / backfilling) — one graph, one pass. */
export function activeAncestryHashes(workRoot: string, scenes: ReadonlyArray<{ id: string; metadata_json: string | null }>): Map<string, string> {
  const edges = activeTreeEdges(workRoot, scenes)
  const out = new Map<string, string>()
  for (const s of scenes) out.set(s.id, hashAncestors(edges, s.id))
  return out
}

/** One-time on-open backfill: stamp legacy (pre-per-variant) thread_events — `ancestry_hash IS NULL` — with the
 *  ACTIVE variant's per-scene ancestry, so old universal analysis is attributed to the current variant instead of
 *  matching every variant. Idempotent (only NULL rows); a no-op once done. Returns rows stamped. */
export function backfillThreadAncestry(workRoot: string): number {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return 0
  const db = openDb(dbPath)
  try {
    const nulls = (db.prepare(`SELECT COUNT(*) AS n FROM thread_events WHERE ancestry_hash IS NULL`).get() as { n: number }).n
    if (!nulls) return 0
    const scenes = db.prepare(`SELECT unit_id AS id, metadata_json FROM narrative_units WHERE type = 'scene'`).all() as Array<{ id: string; metadata_json: string | null }>
    const hashes = activeAncestryHashes(workRoot, scenes)
    const upd = db.prepare('UPDATE thread_events SET ancestry_hash = ? WHERE scene_id = ? AND ancestry_hash IS NULL')
    db.transaction(() => { for (const [id, h] of hashes) upd.run(h, id) })()
    return nulls
  } finally {
    db.close()
  }
}

/**
 * T5 delete GC: after a scene (or a folder of scenes) is deleted, drop the dead scene_ids from EVERY tree variant's
 * adjacency AND garbage-collect their analysis rows — so orphaned scene_ids never accumulate. `live` = the scene_ids
 * still on disk (an ARCHIVED scene is still on disk → kept, so it keeps bridging). Idempotent; best-effort per table.
 */
export function pruneOrphans(workRoot: string, live: ReadonlySet<string>): void {
  // 1. Prune trees.json adjacency — drop dead from-keys + dead targets across every variant.
  const trees = readTrees(workRoot)
  let changed = false
  const variants = trees.variants.map((v) => {
    const adj: Record<string, string[]> = {}
    for (const [from, tos] of Object.entries(v.adjacency)) {
      if (!live.has(from)) { changed = true; continue } // edge FROM a deleted scene → drop the whole entry
      const kept = tos.filter((t) => live.has(t)) // edges TO deleted scenes → drop those targets
      if (kept.length !== tos.length) changed = true
      if (kept.length) adj[from] = kept
    }
    return { ...v, adjacency: adj }
  })
  if (changed) writeTrees(workRoot, { ...trees, variants })

  // 2. GC analysis rows for DB scenes no longer on disk (best-effort — a table may be absent in this DB).
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return
  const db = openDb(dbPath)
  try {
    const dead = (db.prepare(`SELECT unit_id AS id FROM narrative_units WHERE type = 'scene'`).all() as Array<{ id: string }>)
      .map((r) => r.id)
      .filter((id) => !live.has(id))
    if (!dead.length) return
    const del = (sql: string, id: string): void => { try { db.prepare(sql).run(id) } catch { /* table absent in this db */ } }
    for (const id of dead) {
      del(`DELETE FROM thread_events WHERE scene_id = ?`, id)
      del(`DELETE FROM entity_arc_events WHERE unit_id = ?`, id)
      del(`DELETE FROM dialog_nodes WHERE unit_id = ?`, id)
      del(`DELETE FROM entity_presence WHERE unit_id = ?`, id)
      del(`DELETE FROM extracted_scenes WHERE scene_id = ?`, id)
      del(`DELETE FROM coherence_findings WHERE as_of_unit_id = ?`, id)
      del(`DELETE FROM rollups WHERE unit_id = ?`, id)
      del(`DELETE FROM unit_order WHERE unit_id = ?`, id)
      del(`DELETE FROM narrative_units WHERE unit_id = ?`, id)
    }
  } finally {
    db.close()
  }
}

interface UnitRow {
  id: string
  parent: string | null
  type: string
  title: string
  pos: number
}

/** Stamp the whole analysis with the CURRENT `leads_to` graph version + record that version. Called at the end
 *  of an analysis run (one run = one graph version — the traversal it walked). So switching the graph later
 *  shows these rows as "for version X" and offers a re-run. Returns the version id (or '' if no DB). */
export function stampTimelineVersion(workRoot: string): string {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return ''
  const db = openDb(dbPath)
  try {
    const scenes = db
      .prepare(`SELECT unit_id AS id, metadata_json FROM narrative_units WHERE type = 'scene'`)
      .all() as Array<{ id: string; metadata_json: string | null }>
    const edges = activeTreeEdges(workRoot, scenes)
    const version = graphVersion(edges)
    db.prepare(`INSERT OR IGNORE INTO timeline_versions (version_id, name, graph_json, created_at) VALUES (?,?,?,?)`)
      .run(version, null, JSON.stringify(Object.fromEntries(edges)), new Date().toISOString())
    for (const t of ['narrative_threads', 'thread_events', 'entity_arc_events', 'coherence_findings', 'character_windows'])
      db.prepare(`UPDATE ${t} SET timeline_version = ?`).run(version)
    return version
  } finally {
    db.close()
  }
}

/** Is the on-disk analysis for the CURRENT `leads_to` graph, or stale (graph edited since it ran)? + a cycle
 *  flag. The mechanism behind "no run for this version — run it" and the loadout picker. Read-only. */
export function timelineStatus(workRoot: string): TimelineStatus {
  const empty: TimelineStatus = { currentVersion: '', ranVersion: null, stale: false, hasAnalysis: false, cycle: null }
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return empty
  const db = openReadonly(dbPath)
  try {
    const scenes = db
      .prepare(`SELECT unit_id AS id, metadata_json FROM narrative_units WHERE type = 'scene'`)
      .all() as Array<{ id: string; metadata_json: string | null }>
    const edges = activeTreeEdges(workRoot, scenes)
    const currentVersion = graphVersion(edges)
    const cycle = detectCycle(edges)
    // ran version = whatever the current analysis rows are stamped with (one run stamps them all uniformly).
    const ranRow = (db.prepare(`SELECT timeline_version AS v FROM thread_events WHERE timeline_version IS NOT NULL LIMIT 1`).get() ??
      db.prepare(`SELECT timeline_version AS v FROM character_windows WHERE timeline_version IS NOT NULL LIMIT 1`).get() ??
      db.prepare(`SELECT timeline_version AS v FROM coherence_findings WHERE timeline_version IS NOT NULL LIMIT 1`).get()) as { v?: string } | undefined
    const ranVersion = ranRow?.v ?? null
    const n = (db.prepare(`SELECT (SELECT COUNT(*) FROM thread_events) + (SELECT COUNT(*) FROM character_windows) + (SELECT COUNT(*) FROM coherence_findings) AS n`).get() as { n: number }).n
    const hasAnalysis = n > 0
    const stale = hasAnalysis && ranVersion !== currentVersion // includes legacy unstamped analysis (ran=null)
    return { currentVersion, ranVersion, stale, hasAnalysis, cycle }
  } finally {
    db.close()
  }
}

/** The unit tree, once per call: rows + children index (scenes ordered by linear_pos). */
function loadTree(db: DatabaseType.Database): { byId: Map<string, UnitRow>; childrenOf: Map<string | null, UnitRow[]> } {
  const rows = db
    .prepare(
      `SELECT u.unit_id AS id, u.parent_id AS parent, u.type AS type, COALESCE(u.title, u.unit_id) AS title,
              COALESCE(o.linear_pos, u.sort_order, 1e9) AS pos
         FROM narrative_units u LEFT JOIN unit_order o ON o.unit_id = u.unit_id`
    )
    .all() as UnitRow[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const childrenOf = new Map<string | null, UnitRow[]>()
  for (const r of rows) {
    const arr = childrenOf.get(r.parent) ?? []
    arr.push(r)
    childrenOf.set(r.parent, arr)
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.pos - b.pos)
  return { byId, childrenOf }
}

/** Every scene_id under a unit's subtree (leaves). Used to test whether a container is a graph-ancestor. */
function sceneIdsUnder(childrenOf: Map<string | null, UnitRow[]>, unitId: string): string[] {
  const out: string[] = []
  const walk = (id: string): void => {
    for (const c of childrenOf.get(id) ?? []) {
      if (c.type === 'scene') out.push(c.id)
      else walk(c.id)
    }
  }
  walk(unitId)
  return out
}

/** Does this unit's subtree contain any scene? (units outside the story — empty test folders — never digest.) */
function hasScenes(childrenOf: Map<string | null, UnitRow[]>, id: string): boolean {
  for (const c of childrenOf.get(id) ?? []) {
    if (c.type === 'scene') return true
    if (hasScenes(childrenOf, c.id)) return true
  }
  return false
}

/** A LEAF chapter's free digest: its scenes' extracted summaries, in order, capped. '' when nothing extracted. */
function leafDigest(db: DatabaseType.Database, childrenOf: Map<string | null, UnitRow[]>, unitId: string): string {
  const get = db.prepare('SELECT summary FROM extracted_scenes WHERE scene_id = ?')
  const parts: string[] = []
  for (const c of childrenOf.get(unitId) ?? []) {
    if (c.type !== 'scene') continue
    const s = (get.get(c.id) as { summary?: string | null } | undefined)?.summary
    if (s) parts.push(`${c.title}: ${s}`)
  }
  const joined = parts.join('\n')
  return joined.length > CHAPTER_DIGEST_CAP ? joined.slice(0, CHAPTER_DIGEST_CAP - 1) + '…' : joined
}

const storedDigest = (db: DatabaseType.Database, unitId: string): { body: string; input_hash: string } | undefined =>
  db.prepare(`SELECT body, input_hash FROM rollups WHERE unit_id = ? AND kind = 'digest' AND entity_id = ''`).get(unitId) as
    | { body: string; input_hash: string }
    | undefined

/** The digest INPUT parts for one unit: scene summaries (leaf side) + child folder digests (stored, or leaf-derived). */
function digestParts(db: DatabaseType.Database, childrenOf: Map<string | null, UnitRow[]>, unitId: string): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = []
  const get = db.prepare('SELECT summary FROM extracted_scenes WHERE scene_id = ?')
  for (const c of childrenOf.get(unitId) ?? []) {
    if (c.type === 'scene') {
      const s = (get.get(c.id) as { summary?: string | null } | undefined)?.summary
      if (s) out.push({ title: c.title, text: s })
    } else if (hasScenes(childrenOf, c.id)) {
      const folderKids = (childrenOf.get(c.id) ?? []).some((k) => k.type !== 'scene')
      const text = folderKids ? (storedDigest(db, c.id)?.body ?? '') : leafDigest(db, childrenOf, c.id)
      out.push({ title: c.title, text })
    }
  }
  return out
}

/** The staleness recipe for a reducible unit's digest — its children's CURRENT digest text + prompt version
 *  (KIND-adjusted: a fiction↔non-fiction switch re-stales, since the digest prompt is domain-shared but the
 *  upstream extraction it reduces is not). */
function digestHash(db: DatabaseType.Database, childrenOf: Map<string | null, UnitRow[]>, unitId: string, promptV: string): string {
  const h = createHash('sha256').update(promptV)
  for (const p of digestParts(db, childrenOf, unitId)) h.update(p.title).update(p.text)
  return h.digest('hex')
}

export interface DigestPlanRow {
  unitId: string
  title: string
  depth: number // deeper = reduced first (parents consume fresh children)
  status: 'pending' | 'stale' | 'fresh'
}

/** Reducible units (folder children present, scenes in subtree) with staleness — deepest first. */
export function digestPlan(workRoot: string): DigestPlanRow[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  const promptV = analysisPromptVersion(loadProjectInfo(workRoot).domain)
  try {
    const { byId, childrenOf } = loadTree(db)
    const depthOf = (id: string): number => {
      let d = 0
      let cur = byId.get(id)
      while (cur?.parent) {
        d++
        cur = byId.get(cur.parent)
      }
      return d
    }
    const out: DigestPlanRow[] = []
    for (const [id, u] of byId) {
      if (u.type === 'scene') continue
      const kids = childrenOf.get(id) ?? []
      if (!kids.some((k) => k.type !== 'scene')) continue // leaf chapter → free digest, never planned
      if (!hasScenes(childrenOf, id)) continue // outside the story (empty folders)
      const cur = digestHash(db, childrenOf, id, promptV)
      const stored = storedDigest(db, id)
      out.push({ unitId: id, title: u.title, depth: depthOf(id), status: !stored ? 'pending' : stored.input_hash === cur ? 'fresh' : 'stale' })
    }
    return out.sort((a, b) => b.depth - a.depth || a.unitId.localeCompare(b.unitId))
  } finally {
    db.close()
  }
}

/** The reduce inputs for one unit (the reader's payload) + the hash the write must record. */
export function digestInputs(workRoot: string, unitId: string): { title: string; parts: { title: string; text: string }[]; inputHash: string } {
  const db = openReadonly(dbPathFor(workRoot))
  const promptV = analysisPromptVersion(loadProjectInfo(workRoot).domain)
  try {
    const { byId, childrenOf } = loadTree(db)
    return {
      title: byId.get(unitId)?.title ?? unitId,
      parts: digestParts(db, childrenOf, unitId).filter((p) => p.text),
      inputHash: digestHash(db, childrenOf, unitId, promptV)
    }
  } finally {
    db.close()
  }
}

/** Persist one reduced digest (the small dedicated writer — digests are T2.5 reductions, not canonical
 *  tiers). Stamps `span` — the scene range covered AT GENERATION TIME (the tree moves; this doesn't). */
export function writeDigest(workRoot: string, unitId: string, body: string, model: string | null, inputHash: string): void {
  const db = openDb(dbPathFor(workRoot))
  try {
    const { childrenOf } = loadTree(db)
    const scenes: UnitRow[] = []
    const collect = (id: string): void => {
      for (const c of childrenOf.get(id) ?? []) {
        if (c.type === 'scene') scenes.push(c)
        else collect(c.id)
      }
    }
    collect(unitId)
    scenes.sort((a, b) => a.pos - b.pos)
    const span = scenes.length ? `${scenes[0].id}..${scenes[scenes.length - 1].id} · ${scenes.length} scenes` : null
    db.prepare(
      `INSERT INTO rollups (unit_id, kind, entity_id, body, input_hash, model, created_at, span)
       VALUES (?, 'digest', '', ?, ?, ?, ?, ?)
       ON CONFLICT(unit_id, kind, entity_id) DO UPDATE SET body=excluded.body, input_hash=excluded.input_hash, model=excluded.model, created_at=excluded.created_at, span=excluded.span`
    ).run(unitId, body, inputHash, model, new Date().toISOString(), span)
  } finally {
    db.close()
  }
}

const FAR_BLOCK_CAP = 400 // chars — non-adjacent siblings shrink to this (the zoom-out)
const NEAR_FULL = 2 // the N nearest earlier siblings at each level keep their full digest

/**
 * The STORY SO FAR for one scene (working-set M1) — a hierarchical zoom-in along the scene's ancestor
 * chain: at each level, the path-node's EARLIER siblings contribute their digest (earlier books → earlier
 * acts in this book → earlier chapters in this act), so detail increases as the story approaches the scene
 * and total size stays bounded at any corpus size. The nearest NEAR_FULL siblings per level keep full
 * digests; older ones truncate to FAR_BLOCK_CAP. Also returns the hot-window cutoff: the linear_pos where
 * "recent" begins (the first scene of the K-th chapter back) — the thread split reads it.
 */
export function storySoFar(workRoot: string, sceneId: string, kChapters = 8): { blocks: { title: string; text: string }[]; hotCutoffPos: number } {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return { blocks: [], hotCutoffPos: 0 }
  const db = openReadonly(dbPath)
  try {
    const { byId, childrenOf } = loadTree(db)
    const scene = byId.get(sceneId)
    if (!scene) return { blocks: [], hotCutoffPos: 0 }
    // ancestor chain root→…→chapter (the scene's containers, outermost first)
    const chain: UnitRow[] = []
    let cur = scene.parent ? byId.get(scene.parent) : undefined
    while (cur) {
      chain.unshift(cur)
      cur = cur.parent ? byId.get(cur.parent) : undefined
    }
    // leads_to graph: when the work is WIRED, "before this scene" = its graph-ANCESTORS (a merge scene = the
    // UNION of its incoming branches), so parallel branches are excluded — no false adjacency. An UNWIRED work
    // falls back to folder reading order (byte-identical to before this change).
    const scenes = db.prepare(`SELECT unit_id AS id, metadata_json FROM narrative_units WHERE type = 'scene'`).all() as Array<{
      id: string
      metadata_json: string | null
    }>
    const edges = activeTreeEdges(workRoot, scenes)
    const graphMode = hasEdges(edges)
    const ancestorScenes = graphMode ? new Set(graphAncestors(edges, sceneId)) : null
    const isBefore = (unitId: string): boolean =>
      !graphMode || sceneIdsUnder(childrenOf, unitId).some((sc) => ancestorScenes!.has(sc))

    const blocks: { title: string; text: string }[] = []
    let parent: string | null = null
    for (const node of chain) {
      const siblings = (childrenOf.get(parent) ?? []).filter((u) => u.type !== 'scene' && hasScenes(childrenOf, u.id))
      const idx = siblings.findIndex((u) => u.id === node.id)
      for (let i = 0; i < idx; i++) {
        const sib = siblings[i]
        if (!isBefore(sib.id)) continue // graph mode: drop parallel-branch containers
        const kids = childrenOf.get(sib.id) ?? []
        const text = kids.some((k) => k.type !== 'scene') ? (storedDigest(db, sib.id)?.body ?? '') : leafDigest(db, childrenOf, sib.id)
        if (!text) continue
        const near = idx - i <= NEAR_FULL
        blocks.push({ title: sib.title, text: near || text.length <= FAR_BLOCK_CAP ? text : text.slice(0, FAR_BLOCK_CAP - 1) + '…' })
      }
      parent = node.id
    }
    // hot cutoff: walk chapters (leaf units w/ scenes) in reading order; find the scene's chapter; back K.
    const chapters: { id: string; firstPos: number }[] = []
    const walk = (pid: string | null): void => {
      for (const u of childrenOf.get(pid) ?? []) {
        if (u.type === 'scene') continue
        const kids = childrenOf.get(u.id) ?? []
        if (kids.some((k) => k.type === 'scene') && (u.id === scene.parent || isBefore(u.id))) {
          const first = Math.min(...kids.filter((k) => k.type === 'scene').map((k) => k.pos))
          chapters.push({ id: u.id, firstPos: first })
        }
        walk(u.id)
      }
    }
    walk(null)
    chapters.sort((a, b) => a.firstPos - b.firstPos)
    const chIdx = chapters.findIndex((c) => c.id === scene.parent)
    const backIdx = Math.max(0, (chIdx < 0 ? chapters.length - 1 : chIdx) - (kChapters - 1))
    return { blocks, hotCutoffPos: chapters[backIdx]?.firstPos ?? 0 }
  } finally {
    db.close()
  }
}

// ── PROFILES (M3) — a character's cumulative state, chained per chapter ─────────────────────────────
// profile(char, chapter N) = reduce( profile(char, chapter N-1) + chapter N's windows ) — the input is
// BOUNDED whatever the corpus size. Coherence then diffs the declared page against profile + the newest
// windows instead of O(all chapters) of raw history. Chapters (window units) are the checkpoint spine.

/** The character's windows text for ONE chapter — the chain's per-link increment. */
function chapterWindowsText(db: DatabaseType.Database, entityId: string, chapterId: string): string {
  const win = db.prepare('SELECT summary FROM character_windows WHERE entity_id = ? AND chapter_id = ?').get(entityId, chapterId) as
    | { summary?: string | null }
    | undefined
  const lines: string[] = []
  if (win?.summary) lines.push(win.summary)
  for (const e of db
    .prepare(`SELECT change, category, value, description FROM entity_arc_events WHERE entity_id = ? AND chapter_id = ?`)
    .all(entityId, chapterId) as Array<{ change: string | null; category: string | null; value: string | null; description: string | null }>)
    lines.push(`• ${e.change ?? ''} ${e.category ?? ''}: ${e.value ?? ''}${e.description ? ` — ${e.description}` : ''}`)
  return lines.join('\n')
}

/** The profile checkpoint spine: chapters WITH SCENES from the unit TREE, in reading order. Tree-derived
 *  (not from character_windows) so the spine exists right after a Reset+ingest — the chain can be planned
 *  in the SAME run that rebuilds the windows (the planner's first-run blindness, found live 2026-07-05). */
function windowChapters(db: DatabaseType.Database): { id: string; title: string; pos: number }[] {
  return db
    .prepare(
      `SELECT u.unit_id AS id, COALESCE(u.title, u.unit_id) AS title, MIN(o.linear_pos) AS pos
         FROM narrative_units u
         JOIN narrative_units su ON su.parent_id = u.unit_id AND su.type = 'scene'
         LEFT JOIN unit_order o ON o.unit_id = su.unit_id
        WHERE u.type != 'scene'
        GROUP BY u.unit_id
        ORDER BY pos`
    )
    .all() as { id: string; title: string; pos: number }[]
}

/** The PROFILE SPINE — the altitude at which character arcs roll up. One checkpoint per TOP-LEVEL CONTAINER
 *  (a direct child of the book): with volumes that's ~12 parts, so a character's chain is ~12 links, not ~100.
 *  A FLAT book (whose children ARE the chapters) degrades to per-chapter — byte-identical to before volumes.
 *  Each checkpoint is KEYED by its part's LAST chapter id (a REAL chapter, so coherence's window-id matching in
 *  observedText keeps working) and carries `members` = the chapters folded into it (the reduce's evidence).
 *  This collapses the profile frontier ~10× (the profile pass was ~1800 of a 2169-target run — reading-strategy.md #3). */
function profileSpine(db: DatabaseType.Database): { id: string; title: string; pos: number; members: string[] }[] {
  const chapters = windowChapters(db) // leaf chapters (units with scene children), in reading order
  if (chapters.length === 0) return []
  const parentOf = new Map(
    (db.prepare('SELECT unit_id AS id, parent_id AS p FROM narrative_units').all() as Array<{ id: string; p: string | null }>).map((r) => [r.id, r.p])
  )
  const titleOf = new Map(
    (db.prepare('SELECT unit_id AS id, COALESCE(title, unit_id) AS t FROM narrative_units').all() as Array<{ id: string; t: string }>).map((r) => [r.id, r.t])
  )
  const rootId = (db.prepare('SELECT unit_id AS id FROM narrative_units WHERE parent_id IS NULL ORDER BY unit_id LIMIT 1').get() as { id?: string } | undefined)?.id ?? null
  // A chapter's top-level container = the ancestor whose parent IS the root book. Flat → the chapter itself.
  const topOf = (chId: string): string => {
    let u = chId
    while (parentOf.get(u) != null && parentOf.get(u) !== rootId) u = parentOf.get(u) as string
    return u
  }
  const groups = new Map<string, { id: string; pos: number }[]>()
  const order: string[] = []
  for (const ch of chapters) {
    const top = topOf(ch.id)
    if (!groups.has(top)) { groups.set(top, []); order.push(top) }
    groups.get(top)!.push({ id: ch.id, pos: ch.pos })
  }
  return order.map((top) => {
    const mem = groups.get(top)!
    return { id: mem[mem.length - 1].id, title: titleOf.get(top) ?? top, pos: mem[0].pos, members: mem.map((m) => m.id) }
  })
}

/** A checkpoint's reduce increment: the character's window evidence across ALL the part's member chapters, in order. */
function spineIncrement(db: DatabaseType.Database, entityId: string, members: string[]): string {
  return members.map((ch) => chapterWindowsText(db, entityId, ch)).filter(Boolean).join('\n')
}

const storedProfile = (db: DatabaseType.Database, entityId: string, chapterId: string): { body: string; input_hash: string } | undefined =>
  db.prepare(`SELECT body, input_hash FROM rollups WHERE unit_id = ? AND kind = 'profile' AND entity_id = ?`).get(chapterId, entityId) as
    | { body: string; input_hash: string }
    | undefined

function profileHash(prevBody: string, increment: string, promptV: string): string {
  return createHash('sha256').update(promptV).update(prevBody).update(increment).digest('hex')
}

export interface ProfilePlanRow {
  entityId: string
  name: string
  chapterId: string
  chapterTitle: string
  seq: number // chain order within the entity — the runner must respect it
  status: 'pending' | 'stale' | 'fresh'
}

/** The profile chain plan: for each windowed character (gated by `entityIds`), each chapter link's staleness.
 *  A stale link INVALIDATES all links after it (the chain re-reduces from there) — the plan marks them stale. */
export function profilePlan(workRoot: string, entityIds: Set<string>, upcomingChapterIds?: Set<string>): ProfilePlanRow[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath) || entityIds.size === 0) return []
  const db = openReadonly(dbPath)
  const promptV = analysisPromptVersion(loadProjectInfo(workRoot).domain)
  try {
    const spine = profileSpine(db)
    const upcoming = upcomingChapterIds ?? new Set<string>()
    const nameOf = new Map(
      (db.prepare(`SELECT entity_id AS id, name FROM entities WHERE type = 'character'`).all() as Array<{ id: string; name: string }>).map((r) => [r.id, r.name])
    )
    const out: ProfilePlanRow[] = []
    for (const eid of entityIds) {
      let prevBody = ''
      let broken = false // once one link is stale, everything downstream re-reduces
      let seq = 0
      for (const sp of spine) {
        const increment = spineIncrement(db, eid, sp.members)
        // Plan the link when there's evidence now, a chain to carry, OR any of the part's chapter windows are
        // being rebuilt in THIS run (post-reset first pass: evidence lands minutes before the link reduces; a
        // link that stays empty is politely skipped by the runner).
        if (!increment && !prevBody && !sp.members.some((m) => upcoming.has(m))) continue
        const cur = profileHash(prevBody, increment, promptV)
        const stored = storedProfile(db, eid, sp.id)
        const status: ProfilePlanRow['status'] = broken || !stored ? (stored ? 'stale' : 'pending') : stored.input_hash === cur ? 'fresh' : 'stale'
        if (status !== 'fresh') broken = true
        out.push({ entityId: eid, name: nameOf.get(eid) ?? eid, chapterId: sp.id, chapterTitle: sp.title, seq: seq++, status })
        prevBody = stored && status === 'fresh' ? stored.body : '' // downstream hashes only reliable while fresh
      }
    }
    return out
  } finally {
    db.close()
  }
}

/** One chain link's reduce inputs (reader payload) + the hash the write records. */
export function profileInputs(workRoot: string, entityId: string, chapterId: string): { name: string; chapterTitle: string; prevProfile: string; increment: string; inputHash: string } {
  const db = openReadonly(dbPathFor(workRoot))
  const promptV = analysisPromptVersion(loadProjectInfo(workRoot).domain)
  try {
    const spine = profileSpine(db) // `chapterId` here is a spine CHECKPOINT id (a part's boundary chapter)
    const idx = spine.findIndex((s) => s.id === chapterId)
    const prev = idx > 0 ? storedProfile(db, entityId, spine[idx - 1].id)?.body ?? '' : ''
    const increment = idx >= 0 ? spineIncrement(db, entityId, spine[idx].members) : ''
    const name = (db.prepare('SELECT name FROM entities WHERE entity_id = ?').get(entityId) as { name?: string } | undefined)?.name ?? entityId
    return { name, chapterTitle: spine[idx]?.title ?? chapterId, prevProfile: prev, increment, inputHash: profileHash(prev, increment, promptV) }
  } finally {
    db.close()
  }
}

/** Persist one profile link. */
export function writeProfile(workRoot: string, entityId: string, chapterId: string, body: string, model: string | null, inputHash: string): void {
  const db = openDb(dbPathFor(workRoot))
  try {
    db.prepare(
      `INSERT INTO rollups (unit_id, kind, entity_id, body, input_hash, model, created_at)
       VALUES (?, 'profile', ?, ?, ?, ?, ?)
       ON CONFLICT(unit_id, kind, entity_id) DO UPDATE SET body=excluded.body, input_hash=excluded.input_hash, model=excluded.model, created_at=excluded.created_at`
    ).run(chapterId, entityId, body, inputHash, model, new Date().toISOString())
  } finally {
    db.close()
  }
}

/** The coherence assembly's profile: the newest stored profile STRICTLY BEFORE the last window chapter, so the
 *  diff reads profile + the raw windows after it. Null when no usable profile (small works → full windows). */
export function profileForCoherence(workRoot: string, entityId: string): { throughChapterId: string; throughTitle: string; body: string } | null {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return null
  const db = openReadonly(dbPath)
  try {
    const spine = profileSpine(db)
    if (spine.length < 2) return null
    // The newest checkpoint stays RAW in the diff; find the latest stored profile at or before spine[len-2].
    for (let i = spine.length - 2; i >= 0; i--) {
      const p = storedProfile(db, entityId, spine[i].id)
      if (!p) continue
      // observedText slices arc.windows on `throughChapterId`, so it must be a chapter the character ACTUALLY
      // appears in (has a window) — the part's boundary chapter may not be one of them. Use the character's
      // LAST window within this checkpoint's member chapters.
      const ph = spine[i].members.map(() => '?').join(',')
      const row = db
        .prepare(
          `SELECT cw.chapter_id AS id FROM character_windows cw JOIN unit_order o ON o.unit_id = cw.chapter_id
            WHERE cw.entity_id = ? AND cw.chapter_id IN (${ph}) ORDER BY o.linear_pos DESC LIMIT 1`
        )
        .get(entityId, ...spine[i].members) as { id?: string } | undefined
      if (row?.id) return { throughChapterId: row.id, throughTitle: spine[i].title, body: p.body }
    }
    return null
  } finally {
    db.close()
  }
}

/** A unit's CURRENT digest, whatever its level: stored reduction (folder-children) or the free leaf concat. */
export function digestFor(workRoot: string, unitId: string): string {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return ''
  const db = openReadonly(dbPath)
  try {
    const { childrenOf } = loadTree(db)
    const kids = childrenOf.get(unitId) ?? []
    if (kids.some((k) => k.type !== 'scene')) return storedDigest(db, unitId)?.body ?? ''
    return leafDigest(db, childrenOf, unitId)
  } finally {
    db.close()
  }
}

// ── window bundle (analysis-components.md Slice 2) ───────────────────────────────
// A structural checkpoint's COMPONENTS, assembled from what's already extracted — the object a book/coherence pass
// consumes INSTEAD of raw dialogue (Slice 3), so its staleness absorbs at the chapter boundary. Scoped to a
// WINDOW/CHAPTER (the unit that directly parents scenes — coherence's `as_of`); called on a higher level it returns
// an empty bundle (its scene subquery is empty), so it "materializes at structural levels only" by construction.
// Read-only assembly: `summary` = the prose digest; the event lists = existing rows scoped to this window's scenes.

export interface WindowBundle {
  unitId: string
  summary: string
  openedThreads: { threadId: string; title: string | null; sceneId: string }[]
  entityEvents: { entityId: string; eventType: string; category: string | null; change: string | null; value: string | null; description: string; sceneId: string }[]
  loreEvents: { loreId: string; summary: string; magnitude: string | null; sceneId: string }[]
}

export function windowBundle(workRoot: string, unitId: string): WindowBundle {
  const empty: WindowBundle = { unitId, summary: '', openedThreads: [], entityEvents: [], loreEvents: [] }
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return empty
  const db = openReadonly(dbPath)
  try {
    const inWindow = `(SELECT unit_id FROM narrative_units WHERE parent_id = ? AND type = 'scene')`
    const openedThreads = db
      .prepare(
        `SELECT te.thread_id AS threadId, nt.title AS title, te.scene_id AS sceneId
           FROM thread_events te LEFT JOIN narrative_threads nt ON nt.thread_id = te.thread_id
          WHERE te.action = 'open' AND te.scene_id IN ${inWindow}
          ORDER BY te.thread_id`
      )
      .all(unitId) as WindowBundle['openedThreads']
    const entityEvents = db
      .prepare(
        `SELECT entity_id AS entityId, event_type AS eventType, category, change, value, description, unit_id AS sceneId
           FROM entity_arc_events WHERE unit_id IN ${inWindow} ORDER BY entity_id, event_id`
      )
      .all(unitId) as WindowBundle['entityEvents']
    const loreEvents = db
      .prepare(
        `SELECT lore_id AS loreId, summary, magnitude, scene_id AS sceneId
           FROM lore_updates WHERE scene_id IN ${inWindow} ORDER BY lore_id, scene_id`
      )
      .all(unitId) as WindowBundle['loreEvents']
    return { unitId, summary: digestFor(workRoot, unitId), openedThreads, entityEvents, loreEvents }
  } finally {
    db.close()
  }
}

/** Content-address of a window's bundle — the ONE hash a book/coherence pass folds into its input_hash so it
 *  rebuilds ONLY when a load-bearing component changes (Slice 3's cascade-absorption). Versioned like every tier. */
export function windowBundleHash(workRoot: string, unitId: string): string {
  const promptV = analysisPromptVersion(loadProjectInfo(workRoot).domain)
  return createHash('sha256').update(promptV).update(JSON.stringify(windowBundle(workRoot, unitId))).digest('hex')
}
