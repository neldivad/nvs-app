/**
 * Read-only Query-stage views over a work's co-located DB.
 *
 * These are the app's Query objects (QuestLog first). They open the db
 * read-only, run one SQL reduction, map rows to the shared contract types, and
 * close. No migration, no mutation — safe over a Python-written database.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openReadonly } from '@engine/data/db'
import { activeAncestryHashes } from '@engine/analysis/rollups'
import { silentPresenceIds } from '@engine/analysis/silentPresence'
import { isSurfacedTable } from '@shared/config/dbTables'
import { nearestStrings } from '@shared/config/toolResult'
import { entityNameVariants, normName as nameKey } from '@shared/entityNames'
import { memoSlot, fingerprintDb } from '@engine/enumCache'
import { collectDeclaredSecrets } from '@engine/io/secrets'
import type { Thread, TimelineGraph, TimelineSceneData, TimelineOverlayEdge, RevealBeat, CoherenceFinding, ThreadBeat, ThreadDetail, CharacterArc, ArcWindow, SceneDialogueLine, EntityTrack, DbTable, DbRows, LoreView, LoreTopic } from '@shared/ipc'

// Timetravel: when set to a resolved DB path, the READ queries below run against a past version's snapshot
// (already brought to the current schema head by the engine — see snapshotViewPath) instead of the live DB,
// so the rails/map render that version read-only. Writes (writeTier/ingest use their own path) are never
// affected, and Update is disabled while viewing — so a run can't fire against a snapshot.
let viewDbPath: string | null = null
export function setViewSnapshot(dbPath: string | null): void {
  viewDbPath = dbPath
}

/** Path to a work's analysis DB — the live DB, or the viewed version's (head-migrated) snapshot in timetravel mode. */
function dbPathFor(workRoot: string): string {
  if (viewDbPath && existsSync(viewDbPath)) return viewDbPath
  return join(workRoot, '.nvs', 'nvs.db')
}

/**
 * Scope thread_events to the ACTIVE tree variant's ancestry on THIS read connection (per-variant-analysis.md slice 3).
 * Creates a TEMP VIEW named `thread_events` that SHADOWS the real table (`main.thread_events`), filtered to rows whose
 * ancestry_hash matches the active variant's per-scene ancestor-set (legacy NULL rows pass). Because the temp view
 * shadows the table, every existing thread query filters automatically — no read SQL changes. Writes use a separate
 * (write) connection with no shadow, so they still hit the real table. Skipped in timetravel (snapshot shown as-is).
 * Cost: one graph traversal per read connection.
 */
function scopeThreads(db: ReturnType<typeof openReadonly>, workRoot: string): void {
  if (viewDbPath) return // timetravel: the snapshot's rows are shown as written (live trees would mismatch)
  db.exec(
    `CREATE TEMP TABLE IF NOT EXISTS active_ancestry (scene_id TEXT PRIMARY KEY, ancestry_hash TEXT);
     DELETE FROM active_ancestry;
     CREATE TEMP VIEW IF NOT EXISTS thread_events AS
       SELECT te.rowid AS rowid, te.* FROM main.thread_events te
       WHERE te.ancestry_hash IS NULL
          OR EXISTS (SELECT 1 FROM active_ancestry aa WHERE aa.scene_id = te.scene_id AND aa.ancestry_hash = te.ancestry_hash)`
  )
  const scenes = db.prepare(`SELECT unit_id AS id, metadata_json FROM narrative_units WHERE type = 'scene'`).all() as Array<{ id: string; metadata_json: string | null }>
  const ins = db.prepare('INSERT INTO active_ancestry (scene_id, ancestry_hash) VALUES (?, ?)')
  for (const [id, h] of activeAncestryHashes(workRoot, scenes)) ins.run(id, h)
}

/**
 * Agent read-only SQL over the analysis DB — the general escape hatch for tallies/joins no fixed tool covers
 * (the author's ask: the agent couldn't answer "top 10 characters" without reading scenes by hand). Guarded three
 * ways: SELECT/WITH only (regex), a READONLY connection (SQLite rejects any write that slips past), and
 * better-sqlite3's single-statement prepare (no `SELECT 1; DROP …`). Rows are capped. `scopeThreads` is applied,
 * so even raw SQL sees thread_events filtered to the ACTIVE timeline.
 */
export function queryDb(workRoot: string, sql: string): { rows?: unknown[]; truncated?: boolean; error?: string; valid?: string[]; next?: string } {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return { error: 'no analysis DB yet — run T1 ingest first' }
  const cleaned = sql.trim()
  if (!/^(select|with)\b/i.test(cleaned)) return { error: 'read-only: only a single SELECT/WITH query is allowed' }
  const db = openReadonly(dbPath)
  try {
    scopeThreads(db, workRoot)
    const rows = db.prepare(cleaned).all()
    const CAP = 200
    return rows.length > CAP ? { rows: rows.slice(0, CAP), truncated: true } : { rows }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // TEACHING error (tool-surface.md contract): a wrong column/table is the #1 agent dead-end (it guesses
    // e.g. a `name` column that doesn't exist and loops on new guesses). Echo stays in `msg`; `valid` ranks
    // the nearest REAL `table.column`s to the guess; `next` says what to do with them — the model copies
    // instead of re-guessing. The full schema rides along for context. Note: scenes carry no `path` in the
    // DB — the on-disk path lives in listScenes; steer there.
    const miss = /no such (column|table): ([\w."]+)/i.exec(msg)
    if (miss) {
      const guess = miss[2].replace(/"/g, '').split('.').pop() ?? miss[2] // strip any alias/table prefix
      const valid = nearestStrings(guess, miss[1].toLowerCase() === 'table' ? surfacedTables(db) : surfacedColumns(db))
      return {
        error: `${msg}. DB schema — ${dbSchemaHint(db)}. (For a scene's on-disk path/relPath, use listScenes, not SQL.)`,
        ...(valid.length ? { valid, next: `re-run the query using ${valid[0]} instead of ${miss[2]}` } : {})
      }
    }
    return { error: msg }
  } finally {
    db.close()
  }
}

/** The surfaced table names (the same set dbSchemaHint prints). */
function surfacedTables(db: ReturnType<typeof openReadonly>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((r) => r.name)
    .filter(isSurfacedTable)
}

/** Every surfaced column as `table.column` — the candidate pool a bad column guess is ranked against. */
function surfacedColumns(db: ReturnType<typeof openReadonly>): string[] {
  return surfacedTables(db).flatMap((t) =>
    (db.prepare(`PRAGMA table_info("${t.replace(/"/g, '""')}")`).all() as { name: string }[]).map((c) => `${t}.${c.name}`)
  )
}

/** A compact one-line schema of the surfaced tables — `table(col,col,…); …` — appended to a column/table error so
 *  the agent can fix its query without guessing. Only built on failure, so it costs nothing on the happy path. */
function dbSchemaHint(db: ReturnType<typeof openReadonly>): string {
  return surfacedTables(db)
    .map((t) => {
      const cols = (db.prepare(`PRAGMA table_info("${t.replace(/"/g, '""')}")`).all() as { name: string }[]).map((c) => c.name)
      return `${t}(${cols.join(',')})`
    })
    .join('; ')
}

/** Console DB inspector — the user tables (excludes sqlite internals) + live row counts. Read-only. */
export function inspectTables(workRoot: string): DbTable[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
      .map((r) => r.name)
      .filter(isSurfacedTable) // hide machinery (ledger, caches, snapshots) — see shared/config/dbTables.ts
    return names.map((name) => ({
      name,
      count: (db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number }).n
    }))
  } finally {
    db.close()
  }
}

/** Console DB inspector — a bounded page of raw rows from one table. The table name can't be parameterized,
 *  so it's whitelist-checked against sqlite_master before interpolation (no injection). Values are coerced to
 *  string|number|null so the matrix crosses the process wall. */
export function inspectRows(workRoot: string, table: string, limit: number, offset: number): DbRows {
  const empty: DbRows = { columns: [], rows: [] }
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return empty
  const db = openReadonly(dbPath)
  try {
    if (!isSurfacedTable(table)) return empty // machinery is not inspectable (matches inspectTables)
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table)) return empty
    const stmt = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ? OFFSET ?`)
    const cap = Math.max(0, Math.min(limit, 500))
    const raw = stmt.all(cap, Math.max(0, offset)) as Record<string, unknown>[]
    const columns = stmt.columns().map((c) => c.name)
    const rows = raw.map((r) => columns.map((c): string | number | null => {
      const v = r[c]
      if (v == null) return null
      if (typeof v === 'number') return v
      if (v instanceof Buffer) return `‹blob ${v.length}b›`
      return String(v)
    }))
    return { columns, rows }
  } finally {
    db.close()
  }
}

/**
 * The "significant" cast — entity ids ranked by speaking presence (distinct scenes), kept up to a cumulative
 * appearance threshold AND a hard cap. A scale guard so arcs/coherence don't run over an enormous paged cast;
 * for a normal cast (≤ cap) it returns everyone. Note arcs/coherence are ALREADY page-gated upstream, so this
 * only ever trims among real (paged) characters — the rare-but-paged tail can be cut above the cap (a known
 * tradeoff; that character's dropped-clue still surfaces as a thread, which isn't cast-gated).
 */
/**
 * The Entity pivot: every tracked non-character entity (item · faction · … — open vocabulary) with its presence
 * trail in reading order. Signal-composed (open-taxonomy.md): presence is the v1 track; journey/stakes lenses
 * layer on later. Ordered most-present first, then significance, then name — the plot-bearing things float up.
 */
export function listEntityTracks(workRoot: string): EntityTrack[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    const rows = db
      .prepare(
        `SELECT e.entity_id AS id, e.type AS type, e.name AS name, e.significance AS significance,
                p.unit_id AS sceneId, u.title AS sceneTitle, COALESCE(o.linear_pos, 1e9) AS pos
           FROM entities e
           LEFT JOIN entity_presence p ON p.entity_id = e.entity_id
           LEFT JOIN narrative_units u ON u.unit_id = p.unit_id AND u.type = 'scene'
           LEFT JOIN unit_order o ON o.unit_id = p.unit_id
          WHERE e.type NOT IN ('character')
            AND COALESCE(e.phase, '') <> 'archived'
          ORDER BY e.entity_id, pos`
      )
      .all() as Array<{ id: string; type: string; name: string; significance: string | null; sceneId: string | null; sceneTitle: string | null; pos: number }>
    const byId = new Map<string, EntityTrack>()
    for (const r of rows) {
      let t = byId.get(r.id)
      if (!t) {
        t = { id: r.id, type: r.type, name: r.name, significance: r.significance, scenes: [] }
        byId.set(r.id, t)
      }
      if (r.sceneId && r.sceneTitle != null) t.scenes.push({ sceneId: r.sceneId, title: r.sceneTitle })
    }
    const rank = (s: string | null): number => (s === 'major' ? 0 : s === 'supporting' ? 1 : s === 'minor' ? 2 : 3)
    return [...byId.values()].sort(
      (a, b) => b.scenes.length - a.scenes.length || rank(a.significance) - rank(b.significance) || a.name.localeCompare(b.name)
    )
  } finally {
    db.close()
  }
}

/**
 * The CAST by occurrence — every character with how many scenes they appear in (speaking rows in entity_presence
 * UNION the prose cast in extracted_scenes.characters_json, so silent-but-present characters count too), most-present
 * first. This is the T1 signal the AGENT lacked (it was reading scenes by hand to tally); `listEntityTracks` covers
 * non-character things, this covers characters. Read-only.
 */
export function listCast(workRoot: string): Array<{ entityId: string; name: string; significance: string | null; sceneCount: number; speaks: boolean }> {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    const chars = db.prepare(`SELECT entity_id AS id, name, significance, aliases_json AS aliases FROM entities WHERE type = 'character' AND COALESCE(phase, '') <> 'archived'`).all() as Array<{ id: string; name: string | null; significance: string | null; aliases: string | null }>
    // Variant-aware (@shared/entityNames): a bilingual "劉備 Liu Bei" also resolves from characters_json that
    // says just "劉備" or "Liu Bei". Keys are normalized variants; resolve with the same nameKey.
    const nameToEid = new Map<string, string>()
    for (const e of chars) for (const v of entityNameVariants({ id: e.id, name: e.name, aliases: parseStrArray(e.aliases) })) if (!nameToEid.has(v)) nameToEid.set(v, e.id)
    const scenesOf = new Map<string, Set<string>>()
    const add = (eid: string, sid: string): void => { (scenesOf.get(eid) ?? scenesOf.set(eid, new Set()).get(eid)!).add(sid) }
    const speakers = new Set<string>()
    for (const r of db.prepare(`SELECT p.entity_id AS e, p.unit_id AS s FROM entity_presence p JOIN narrative_units u ON u.unit_id = p.unit_id AND u.type = 'scene'`).all() as Array<{ e: string; s: string }>) {
      add(r.e, r.s)
      speakers.add(r.e)
    }
    for (const r of db.prepare(`SELECT scene_id AS s, characters_json AS cj FROM extracted_scenes WHERE characters_json IS NOT NULL`).all() as Array<{ s: string; cj: string | null }>) {
      for (const nm of parseStrArray(r.cj)) { const id = nameToEid.get(nameKey(nm)); if (id) add(id, r.s) }
    }
    return chars
      .map((c) => ({ entityId: c.id, name: c.name ?? c.id, significance: c.significance, sceneCount: scenesOf.get(c.id)?.size ?? 0, speaks: speakers.has(c.id) }))
      .filter((c) => c.sceneCount > 0)
      .sort((a, b) => b.sceneCount - a.sceneCount || a.name.localeCompare(b.name))
  } finally {
    db.close()
  }
}

/** Non-character/location tracked entities (items · factions · …) — the scene pass feeds these back as "known
 *  things" so later scenes reuse canonical names instead of coining synonyms (the anti-dupe grounding).
 *  WORKING-SET CAPPED (M4) when `cutoffPos` is given: things present since the cutoff ∪ the top-N most-present
 *  overall — bounded at any corpus size. The WRITER's name-resolve stays corpus-wide (invariant #1); this only
 *  bounds what the prompt carries. */
export function listTrackedThings(workRoot: string, cutoffPos?: number, maxTotal = 40): Array<{ name: string; type: string }> {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    if (cutoffPos == null || cutoffPos <= 0) {
      return db
        .prepare(`SELECT name, type FROM entities WHERE type NOT IN ('character','location') AND COALESCE(phase,'') <> 'archived' ORDER BY name`)
        .all() as Array<{ name: string; type: string }>
    }
    // Bound the UNION, not one arm. The old shape was `EXISTS(present since cutoff) OR IN (top-N by count)`,
    // whose `recent` arm had no LIMIT — so passing a cutoff LOOSENED the cap to "every thing seen in the
    // window" (things measured 3k of a 40k prompt and climbing). Rank recent-first (a later scene most likely
    // features a recently-present thing), then by total presence, and HARD-cap at maxTotal so the prompt stays
    // flat at any corpus size. The writer's name-resolve stays corpus-wide (invariant #1) — this only bounds
    // what the PROMPT carries.
    return db
      .prepare(
        `SELECT name, type FROM (
           SELECT e.name AS name, e.type AS type,
                  MAX(CASE WHEN o.linear_pos >= @cut THEN 1 ELSE 0 END) AS recent,
                  COUNT(*) AS n
             FROM entities e
             JOIN entity_presence p ON p.entity_id = e.entity_id
             JOIN unit_order o ON o.unit_id = p.unit_id
            WHERE e.type NOT IN ('character','location') AND COALESCE(e.phase,'') <> 'archived'
            GROUP BY e.entity_id
         )
          ORDER BY recent DESC, n DESC, name
          LIMIT @max`
      )
      .all({ cut: cutoffPos, max: maxTotal }) as Array<{ name: string; type: string }>
  } finally {
    db.close()
  }
}

/** The Lore pivot: lore_updates grouped into per-topic disclosure ledgers + the story clock from
 *  plot_times — the two signals every scene pass banks that (until 2026-07-05) nothing read. */
export function listLoreView(workRoot: string): LoreView {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return { topics: [], clock: [] }
  const db = openReadonly(dbPath)
  try {
    const posOf = new Map<string, { pos: number; title: string }>()
    for (const r of db
      .prepare(`SELECT u.unit_id AS id, COALESCE(u.title, u.unit_id) AS title, COALESCE(o.linear_pos, 1e9) AS pos FROM narrative_units u LEFT JOIN unit_order o ON o.unit_id = u.unit_id WHERE u.type = 'scene'`)
      .all() as Array<{ id: string; title: string; pos: number }>)
      posOf.set(r.id, { pos: r.pos, title: r.title })

    const byTopic = new Map<string, LoreTopic>()
    for (const r of db
      .prepare(`SELECT lore_id AS id, scene_id AS sid, summary, magnitude FROM lore_updates`)
      .all() as Array<{ id: string; sid: string; summary: string; magnitude: string | null }>) {
      let t = byTopic.get(r.id)
      if (!t) {
        t = { loreId: r.id, label: r.id.replace(/_/g, ' '), hasRetcon: false, disclosures: [] }
        byTopic.set(r.id, t)
      }
      const at = posOf.get(r.sid)
      t.disclosures.push({ sceneId: r.sid, title: at?.title ?? r.sid, pos: at?.pos ?? 1e9, summary: r.summary, magnitude: r.magnitude })
      if (r.magnitude === 'retcon') t.hasRetcon = true
    }
    const topics = [...byTopic.values()].map((t) => ({ ...t, disclosures: t.disclosures.sort((a, b) => a.pos - b.pos) }))
    // Retcons first (they're pre-flagged contradictions), then most-disclosed.
    topics.sort((a, b) => Number(b.hasRetcon) - Number(a.hasRetcon) || b.disclosures.length - a.disclosures.length || a.loreId.localeCompare(b.loreId))

    const clock: LoreView['clock'] = []
    for (const r of db
      .prepare(`SELECT scene_id AS sid, plot_times_json AS pt FROM extracted_scenes WHERE plot_times_json IS NOT NULL AND plot_times_json != '[]'`)
      .all() as Array<{ sid: string; pt: string }>) {
      try {
        const times = JSON.parse(r.pt) as string[]
        if (!Array.isArray(times) || times.length === 0) continue
        const at = posOf.get(r.sid)
        clock.push({ sceneId: r.sid, title: at?.title ?? r.sid, pos: at?.pos ?? 1e9, times: times.map(String) })
      } catch {
        /* unparseable — skip the scene */
      }
    }
    clock.sort((a, b) => a.pos - b.pos)
    return { topics, clock }
  } finally {
    db.close()
  }
}

/** Existing lore topics (id + a short establishing summary), working-set capped — the ANTI-DUPE grounding fed
 *  into the scene reader so the model REUSES an existing `lore_ref` instead of coining a synonym (the wire
 *  threads have via `scenePriorThreads`/openThreads and entities via `listTrackedThings`, that lore lacked).
 *  Keeps recent topics (active since `cutoffPos`) ∪ the top-N most-disclosed; empty on a fresh DB. */
export function listKnownLore(workRoot: string, cutoffPos?: number, topN = 30, maxTotal = 50): Array<{ loreId: string; summary: string }> {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    const posOf = new Map<string, number>()
    for (const r of db.prepare(`SELECT unit_id AS id, linear_pos AS pos FROM unit_order`).all() as Array<{ id: string; pos: number }>) posOf.set(r.id, r.pos)
    const byId = new Map<string, { loreId: string; summary: string; firstPos: number; lastPos: number; n: number }>()
    for (const r of db.prepare(`SELECT lore_id AS id, scene_id AS sid, summary FROM lore_updates`).all() as Array<{ id: string; sid: string; summary: string }>) {
      const pos = posOf.get(r.sid) ?? 1e9
      const e = byId.get(r.id)
      if (!e) byId.set(r.id, { loreId: r.id, summary: r.summary, firstPos: pos, lastPos: pos, n: 1 })
      else {
        e.n++
        if (pos < e.firstPos) { e.firstPos = pos; e.summary = r.summary } // keep the ESTABLISHING summary
        if (pos > e.lastPos) e.lastPos = pos
      }
    }
    let list = [...byId.values()]
    if (cutoffPos != null && cutoffPos > 0) {
      // Bound the UNION, not one arm. The old code capped only the top-N arm and left `recent` UNBOUNDED, so
      // passing a cutoff LOOSENED the cap to "every topic touched since the window" — the lore that measured at
      // 43% of a 40k prompt. Take recent topics first (relevance — a later scene most likely advances these),
      // then fill with the most-disclosed durable anchors, HARD-capped at maxTotal so the prompt stays flat at
      // any corpus size. (Safe now that lore is durable subjects, not one-off events — see extraction.ts.)
      const recent = list.filter((e) => e.lastPos >= cutoffPos).sort((a, b) => b.lastPos - a.lastPos)
      const byDisclosure = [...list].sort((a, b) => b.n - a.n)
      const keep = new Set<string>()
      for (const e of [...recent, ...byDisclosure]) {
        if (keep.size >= maxTotal) break
        keep.add(e.loreId)
      }
      list = list.filter((e) => keep.has(e.loreId))
    } else {
      list = list.sort((a, b) => b.n - a.n).slice(0, topN)
    }
    return list.sort((a, b) => a.firstPos - b.firstPos).map((e) => ({ loreId: e.loreId, summary: e.summary.slice(0, 100) }))
  } finally {
    db.close()
  }
}

/** How many entities exist per `type` — for the Project Config view (shows each category's tracked count). */
export function entityCountsByType(workRoot: string): Map<string, number> {
  const dbPath = dbPathFor(workRoot)
  const out = new Map<string, number>()
  if (!existsSync(dbPath)) return out
  const db = openReadonly(dbPath)
  try {
    for (const r of db.prepare('SELECT type, COUNT(*) AS n FROM entities GROUP BY type').all() as Array<{ type: string; n: number }>) {
      out.set(r.type, r.n)
    }
  } finally {
    db.close()
  }
  return out
}

export function significantEntityIds(workRoot: string, cap = 20, threshold = 0.85): Set<string> {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return new Set()
  const db = openReadonly(dbPath)
  try {
    const rows = db
      .prepare(
        `SELECT speaker_id AS id, COUNT(DISTINCT unit_id) AS n
           FROM dialog_nodes WHERE speaker_id IS NOT NULL AND speaker_id != ''
          GROUP BY speaker_id ORDER BY n DESC`
      )
      .all() as Array<{ id: string; n: number }>
    const total = rows.reduce((a, r) => a + r.n, 0)
    if (!total) return new Set(rows.map((r) => r.id)) // no presence signal → don't gate
    const out = new Set<string>()
    let cum = 0
    for (const r of rows) {
      out.add(r.id)
      cum += r.n
      if (out.size >= cap || cum / total >= threshold) break
    }
    return out
  } catch {
    return new Set()
  } finally {
    db.close()
  }
}

/**
 * Threads open *entering* a scene — opened by an earlier scene and not yet resolved before it. This is the
 * temporally-correct "story so far" the reader needs: a scene can only advance/close a thread already open,
 * and it must not see threads opened by LATER scenes. Ordered by where they opened.
 */
export function openThreadsAsOf(workRoot: string, unitId: string): { id: string; description: string; title: string | null; resolutionCondition: string | null; lastPos: number }[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  scopeThreads(db, workRoot)
  try {
    return db
      .prepare(
        `SELECT t.thread_id AS id, t.description AS description, t.title AS title, t.resolution_condition AS resolutionCondition,
                COALESCE((SELECT MAX(o2.linear_pos) FROM thread_events e2 JOIN unit_order o2 ON o2.unit_id = e2.scene_id
                           WHERE e2.thread_id = t.thread_id
                             AND o2.linear_pos < (SELECT linear_pos FROM unit_order WHERE unit_id = @n)), 0) AS lastPos
           FROM narrative_threads t
          WHERE EXISTS (SELECT 1 FROM thread_events e JOIN unit_order o ON o.unit_id = e.scene_id
                         WHERE e.thread_id = t.thread_id AND e.action = 'open'
                           AND o.linear_pos < (SELECT linear_pos FROM unit_order WHERE unit_id = @n))
            AND NOT EXISTS (SELECT 1 FROM thread_events e JOIN unit_order o ON o.unit_id = e.scene_id
                             WHERE e.thread_id = t.thread_id AND e.action IN ('resolve','supersede')
                               AND o.linear_pos < (SELECT linear_pos FROM unit_order WHERE unit_id = @n))
          ORDER BY (SELECT MIN(o.linear_pos) FROM thread_events e JOIN unit_order o ON o.unit_id = e.scene_id
                     WHERE e.thread_id = t.thread_id AND e.action = 'open')`
      )
      .all({ n: unitId }) as { id: string; description: string; title: string | null; resolutionCondition: string | null; lastPos: number }[]
  } finally {
    db.close()
  }
}

/**
 * A signature of a scene's thread *lifecycle* — only the beats that change the open-thread set a later
 * scene inherits (open / resolve / reopen / supersede). It deliberately EXCLUDES `advance`: advancing a
 * thread doesn't change what's open downstream, and the LLM varies advances/phrasing run-to-run — so
 * including them would fire the cascade on pure model noise. Used to decide whether a re-read must ripple.
 */
/**
 * A scene's DOWNSTREAM-RELEVANT output signature (working-set M5) — the parts of its extraction that feed
 * LATER scenes' context: its summary (→ chapter/act digests → story-so-far) and its thread OPEN/CLOSE ops
 * (→ the open-threads-as-of set). If this is unchanged across a re-read, no downstream scene's assembled
 * context changed, so the edit must NOT cascade (a typo fix that doesn't move the summary is free). Compared,
 * never stored — a plain string is enough.
 */
export function sceneContextKey(workRoot: string, unitId: string): string {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return ''
  const db = openReadonly(dbPath)
  scopeThreads(db, workRoot)
  try {
    const sum = (db.prepare('SELECT summary FROM extracted_scenes WHERE scene_id = ?').get(unitId) as { summary?: string | null } | undefined)?.summary ?? ''
    const threads = (db.prepare(`SELECT thread_id AS t, action AS a FROM thread_events WHERE scene_id = ? AND action != 'advance' ORDER BY thread_id, action`).all(unitId) as { t: string; a: string }[])
      .map((r) => `${r.t}:${r.a}`).join('|')
    return `${sum}\u0001${threads}`
  } finally {
    db.close()
  }
}

export function sceneThreadKey(workRoot: string, unitId: string): string {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return ''
  const db = openReadonly(dbPath)
  scopeThreads(db, workRoot)
  try {
    const rows = db
      .prepare(`SELECT thread_id AS t, action AS a FROM thread_events WHERE scene_id = ? AND action != 'advance' ORDER BY thread_id, action`)
      .all(unitId) as { t: string; a: string }[]
    return rows.map((r) => `${r.t}:${r.a}`).join('|')
  } finally {
    db.close()
  }
}

/** One scene's extracted evidence (a T2 reduction) — what the window/arc pass rolls up per chapter. */
export interface SceneEvidence {
  sceneId: string
  title: string
  summary: string | null
  characters: string[]
  goals: unknown[]
  conflicts: unknown[]
  enters: unknown[]
  exits: unknown[]
}

/** One scene's dramatic PURPOSE — the goals in play and the conflicts they collide in (T2 extraction). Powers
 *  the Scene Inspector's Purpose section: what people want here + what clashes = the scene's value shift. */
export interface SceneGoal { actor: string; goal: string; status?: string | null }
export interface SceneConflict { between: string[]; over: string; kind?: string | null }
export interface SceneAnalysis { premise: string | null; conclusion: string | null; summary: string | null; goals: SceneGoal[]; conflicts: SceneConflict[] }

export function sceneAnalysis(workRoot: string, unitId: string): SceneAnalysis | null {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return null
  const db = openReadonly(dbPath)
  const parse = <T>(s: string | null): T[] => { try { return s ? (JSON.parse(s) as T[]) : [] } catch { return [] } }
  try {
    const r = db
      .prepare(`SELECT premise, conclusion, summary, goals_json AS goals, conflicts_json AS conflicts FROM extracted_scenes WHERE scene_id = ?`)
      .get(unitId) as { premise: string | null; conclusion: string | null; summary: string | null; goals: string | null; conflicts: string | null } | undefined
    if (!r) return null // scene not extracted yet
    return { premise: r.premise, conclusion: r.conclusion, summary: r.summary, goals: parse<SceneGoal>(r.goals), conflicts: parse<SceneConflict>(r.conflicts) }
  } finally {
    db.close()
  }
}

/** A chapter's scenes + their extracted evidence, in story order — the window pass's compact input
 *  (reads T2 `extracted_scenes`, NOT raw dialogue). Empty `summary` = that scene isn't extracted yet. */
export function chapterEvidence(workRoot: string, chapterId: string): SceneEvidence[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  const parse = <T>(s: string | null): T[] => {
    try {
      return s ? (JSON.parse(s) as T[]) : []
    } catch {
      return []
    }
  }
  try {
    const rows = db
      .prepare(
        `SELECT u.unit_id AS sceneId, u.title AS title,
                es.summary AS summary, es.characters_json AS characters,
                es.goals_json AS goals, es.conflicts_json AS conflicts,
                es.enters_json AS enters, es.exits_json AS exits
           FROM narrative_units u
           JOIN unit_order o ON o.unit_id = u.unit_id
           LEFT JOIN extracted_scenes es ON es.scene_id = u.unit_id
          WHERE u.parent_id = ? AND u.type = 'scene'
          ORDER BY o.linear_pos`
      )
      .all(chapterId) as Array<Record<string, string | null>>
    return rows.map((r) => ({
      sceneId: r.sceneId as string,
      title: (r.title as string) ?? '',
      summary: r.summary,
      characters: parse<string>(r.characters),
      goals: parse(r.goals),
      conflicts: parse(r.conflicts),
      enters: parse(r.enters),
      exits: parse(r.exits)
    }))
  } finally {
    db.close()
  }
}

/**
 * The tracked non-character entities WORTH an arc — the gate for the entity window pass (its analog of
 * `significantEntityIds` for characters). A thing earns an arc if the author SIGNALED it (has an authored page →
 * significance IS NULL, since discovery stamps a significance and authored pages don't) OR the analysis found it
 * SIGNIFICANT (flagged `major`, or recurs across ≥2 scenes). This drops one-scene discovered trivia at scale
 * without a page-gate (which would zero out factions — they're rarely paged). Page-gating is reserved for the
 * future entity-COHERENCE pass (declared page vs observed arc), not the arc itself.
 */
export function arcWorthyEntityIds(workRoot: string): Set<string> {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return new Set()
  const db = openReadonly(dbPath)
  try {
    const rows = db
      .prepare(
        `SELECT e.entity_id AS id
           FROM entities e
          WHERE e.type NOT IN ('character', 'location')
            AND ( e.significance IS NULL                                   -- authored page (author signal)
               OR e.significance = 'major'                                 -- analysis flagged it major
               OR (SELECT COUNT(*) FROM entity_presence p WHERE p.entity_id = e.entity_id) >= 2 )  -- recurs`
      )
      .all() as Array<{ id: string }>
    return new Set(rows.map((r) => r.id))
  } finally {
    db.close()
  }
}

/** The tracked NON-character things (items/factions/…) present anywhere in a chapter's scenes — the cast list
 *  for the entity window pass (its analog of `chapterEvidence`'s character cast). Deduped, name+type. */
export function chapterEntities(workRoot: string, chapterId: string): Array<{ id: string; name: string; type: string }> {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    return db
      .prepare(
        `SELECT DISTINCT e.entity_id AS id, e.name AS name, e.type AS type
           FROM entity_presence p
           JOIN entities e ON e.entity_id = p.entity_id
           JOIN narrative_units u ON u.unit_id = p.unit_id
          WHERE u.parent_id = ? AND u.type = 'scene' AND e.type NOT IN ('character', 'location')
          ORDER BY e.type, e.name`
      )
      .all(chapterId) as Array<{ id: string; name: string; type: string }>
  } finally {
    db.close()
  }
}

/** A scene's CURRENT thread beats — fed back into a re-read so the model reuses the same handles/ids for
 *  the same threads (stops the rename-on-re-read drift). Empty on the first read. */
export function scenePriorThreads(workRoot: string, unitId: string): { threadId: string; action: string; description: string | null }[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  scopeThreads(db, workRoot)
  try {
    return db
      .prepare(
        `SELECT te.thread_id AS threadId, te.action AS action, COALESCE(te.description, nt.description) AS description
           FROM thread_events te LEFT JOIN narrative_threads nt ON nt.thread_id = te.thread_id
          WHERE te.scene_id = ? ORDER BY te.rowid`
      )
      .all(unitId) as { threadId: string; action: string; description: string | null }[]
  } finally {
    db.close()
  }
}

/** A scene's ordered dialogue — the input the scene-read pass feeds the model (Phase 3 producer). */
export function sceneDialogue(workRoot: string, unitId: string): SceneDialogueLine[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    return db
      .prepare(
        `SELECT d.speaker_name AS speaker, d.dialogue_type AS type, d.text AS text
           FROM dialog_nodes d
           JOIN unit_order o ON o.unit_id = d.unit_id
          WHERE d.unit_id = ?
          ORDER BY o.linear_pos, d.sequence`
      )
      .all(unitId) as SceneDialogueLine[]
  } finally {
    db.close()
  }
}

/** "hamlet-a1-s1" → "A1·S1"; falls back to the raw id if it doesn't parse. */
function formatScene(unitId: string | null): string | null {
  if (!unitId) return null
  const m = unitId.match(/a(\d+)-s(\d+)/i)
  return m ? `A${m[1]}·S${m[2]}` : unitId
}

/** Normalize a character name for matching across sources ("Mr Mae Nij Er" ↔ goal actor "Mae Nij Er").
 *  Unicode-safe: NFKC + \p{L}\p{N} keeps non-Latin names (钟离, Алиса) instead of erasing them — script
 *  handling stays universal (independent of the per-project language pack; see internal/multilang.md).
 *  The English honorific strip is best-effort; per-language honorifics belong in a language pack. */
function normName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^(mr|mrs|ms|dr|sir|lord|lady)\.?\s+/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Last segment of a thread id is its human handle: "…:ghost_apparition". */
function slugOf(threadId: string): string {
  const parts = threadId.split(':')
  return parts[parts.length - 1] || threadId
}

/**
 * QuestLog: every thread for the work, open ones first, then by beat count.
 * `beats` = number of ThreadEvents (the scene-by-scene logbook of the promise).
 * Returns [] if the work has no analysis yet (no db) — a clean empty state.
 */
export function listThreads(workRoot: string): Thread[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  scopeThreads(db, workRoot)
  try {
    const rows = db
      .prepare(
        `SELECT t.thread_id            AS id,
                t.title                AS title,
                t.description          AS description,
                t.thread_type          AS type,
                t.status               AS status,
                t.opened_unit_id       AS openedUnit,
                t.closed_unit_id       AS closedUnit,
                t.built_by             AS builtBy,
                t.resolution_condition AS resolutionCondition,
                t.succeeds             AS succeeds,
                (SELECT COUNT(*) FROM thread_events e WHERE e.thread_id = t.thread_id) AS beats
         FROM narrative_threads t
         ORDER BY (t.status = 'open') DESC, beats DESC`
      )
      .all() as Array<{
      id: string
      title: string | null
      description: string | null
      type: string | null
      status: string | null
      openedUnit: string | null
      closedUnit: string | null
      builtBy: string | null
      resolutionCondition: string | null
      succeeds: string | null
      beats: number
    }>

    return rows.map((r) => ({
      id: r.id,
      slug: slugOf(r.id),
      title: r.title ?? null,
      description: r.description ?? '',
      type: r.type ?? 'thread',
      status: r.status ?? 'open',
      openedAt: formatScene(r.openedUnit),
      closedAt: formatScene(r.closedUnit),
      beats: r.beats,
      builtBy: r.builtBy,
      resolutionCondition: r.resolutionCondition,
      succeeds: r.succeeds
    }))
  } finally {
    db.close()
  }
}

/** A safe parse of a JSON-text array column → string[] (the producer writes display names). */
function parseStrArray(json: string | null): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Strand status = ordered fold over its beats, latest terminal wins (resolve closes, reopen re-opens). */
function foldStatus(actions: string[]): string {
  let status = 'open'
  for (const a of actions) {
    if (a === 'resolve' || a === 'supersede') status = 'closed'
    else if (a === 'reopen') status = 'open'
  }
  return status
}

/** A stub umbrella for a thread we can't find a row for (keeps the contract non-null). */
function stubThread(threadId: string): Thread {
  return {
    id: threadId, slug: slugOf(threadId), title: null, description: '', type: 'thread', status: 'open',
    openedAt: null, closedAt: null, beats: 0, builtBy: null, resolutionCondition: null, succeeds: null
  }
}

/**
 * One thread's full development for the ThreadSheet: the umbrella, its strands (per-subject
 * status fold), and the beat log enriched with each scene's extracted context (summary, cast,
 * location) plus the agent's evidence + confidence — the transparency that this is the model's reading.
 */
export function threadDetail(workRoot: string, threadId: string): ThreadDetail {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return { thread: stubThread(threadId), strands: [], beats: [] }
  const db = openReadonly(dbPath)
  scopeThreads(db, workRoot)
  try {
    const t = db
      .prepare(
        `SELECT thread_id AS id, title, description, thread_type AS type, status,
                opened_unit_id AS openedUnit, closed_unit_id AS closedUnit,
                built_by AS builtBy, resolution_condition AS resolutionCondition, succeeds
         FROM narrative_threads WHERE thread_id = ?`
      )
      .get(threadId) as
      | { id: string; title: string | null; description: string | null; type: string | null; status: string | null; openedUnit: string | null; closedUnit: string | null; builtBy: string | null; resolutionCondition: string | null; succeeds: string | null }
      | undefined

    const rows = db
      .prepare(
        `SELECT e.action, e.subject, e.scene_id AS sceneId, e.sort_pos AS pos,
                e.evidence, e.description, e.confidence,
                u.title AS sceneTitle, x.summary AS sceneSummary,
                x.characters_json AS castJson, x.locations_json AS locJson
         FROM thread_events e
         LEFT JOIN narrative_units u ON u.unit_id = e.scene_id
         LEFT JOIN extracted_scenes x ON x.scene_id = e.scene_id
         WHERE e.thread_id = ? ORDER BY e.sort_pos`
      )
      .all(threadId) as Array<{
      action: string; subject: string | null; sceneId: string; pos: number | null
      evidence: string | null; description: string | null; confidence: number | null
      sceneTitle: string | null; sceneSummary: string | null; castJson: string | null; locJson: string | null
    }>

    const beats: ThreadBeat[] = rows.map((r) => ({
      action: r.action,
      subject: r.subject,
      sceneId: r.sceneId,
      sceneCode: formatScene(r.sceneId),
      sceneTitle: r.sceneTitle,
      sceneSummary: r.sceneSummary,
      location: parseStrArray(r.locJson)[0] ?? null,
      cast: parseStrArray(r.castJson),
      evidence: r.evidence ?? '',
      description: r.description ?? '',
      confidence: r.confidence
    }))

    // Strands: group beats by subject, fold each to a status (in beat order).
    const bySubject = new Map<string | null, string[]>()
    for (const b of beats) {
      const k = b.subject ?? null
      const arr = bySubject.get(k) ?? []
      arr.push(b.action)
      bySubject.set(k, arr)
    }
    const strands = [...bySubject.entries()].map(([subject, actions]) => ({
      subject,
      status: foldStatus(actions),
      beats: actions.length
    }))

    const thread: Thread = t
      ? {
          id: t.id, slug: slugOf(t.id), title: t.title ?? null, description: t.description ?? '', type: t.type ?? 'thread',
          status: t.status ?? 'open', openedAt: formatScene(t.openedUnit), closedAt: formatScene(t.closedUnit),
          beats: beats.length, builtBy: t.builtBy, resolutionCondition: t.resolutionCondition, succeeds: t.succeeds
        }
      : { ...stubThread(threadId), beats: beats.length }

    return { thread, strands, beats }
  } catch {
    return { thread: stubThread(threadId), strands: [], beats: [] }
  } finally {
    db.close()
  }
}

/**
 * Every character's windowed arc — entity_arc_events grouped by entity, then by window (the folder
 * the arc was accumulated over). Each window resolves to its scenes (descendants by parent chain, in
 * reading order) so the renderer can band the arc across scene columns. Windowed by design (a trait is
 * longitudinal, not per-scene); the author's foldering sets the grain. Empty if no analysis.
 */
/** The Character pivot — windowed arcs for CHARACTER entities only (+ orphans with no entities row). */
export function listCharacterArcs(workRoot: string): CharacterArc[] {
  return arcList(workRoot, "(e.type = 'character' OR e.type IS NULL)")
}

/** The Entity pivot's arc lens — windowed arcs for tracked NON-character things (items/factions/…). Same shape
 *  as a character arc (windows × facet/change events); the facets/verbs are the category's own (config/entityArc). */
export function listEntityArcs(workRoot: string): CharacterArc[] {
  return arcList(workRoot, "e.type NOT IN ('character')")
}

/** Shared arc assembler — entity_arc_events grouped into per-entity windows, gated by a type WHERE clause. */
function arcList(workRoot: string, typeWhere: string): CharacterArc[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    // window unit → its scenes in reading order (descendants by parent chain). MAX_DEPTH-bounded nesting.
    const units = db
      .prepare(
        `SELECT u.unit_id AS id, u.parent_id AS parent, u.type AS type, COALESCE(o.linear_pos, u.sort_order) AS pos
         FROM narrative_units u LEFT JOIN unit_order o ON o.unit_id = u.unit_id`
      )
      .all() as Array<{ id: string; parent: string | null; type: string; pos: number | null }>
    const childrenOf = new Map<string | null, typeof units>()
    for (const u of units) {
      const arr = childrenOf.get(u.parent) ?? []
      arr.push(u)
      childrenOf.set(u.parent, arr)
    }
    const scenesUnder = (windowId: string): string[] => {
      const out: { id: string; pos: number }[] = []
      const walk = (id: string): void => {
        for (const c of childrenOf.get(id) ?? []) {
          if (c.type === 'scene') out.push({ id: c.id, pos: c.pos ?? 0 })
          else walk(c.id)
        }
      }
      walk(windowId)
      return out.sort((a, b) => a.pos - b.pos).map((s) => s.id)
    }
    const sceneCache = new Map<string, string[]>()

    // character_windows.summary — the narrative synthesis, keyed (entity, chapter/window).
    const winSummary = new Map<string, string>()
    for (const r of db.prepare(`SELECT entity_id AS e, chapter_id AS c, summary FROM character_windows`).all() as Array<{ e: string; c: string; summary: string | null }>)
      if (r.summary) winSummary.set(`${r.e}::${r.c}`, r.summary)

    // extracted_scenes goals/conflicts — actor intent + tensions, per scene (matched to a character by name).
    const parseArr = (json: string | null): Array<Record<string, unknown>> => {
      if (!json) return []
      try {
        const v = JSON.parse(json)
        return Array.isArray(v) ? v : []
      } catch {
        return []
      }
    }
    const sceneMeta = new Map<string, { goals: Array<Record<string, unknown>>; conflicts: Array<Record<string, unknown>> }>()
    for (const r of db.prepare(`SELECT scene_id AS s, goals_json AS g, conflicts_json AS c FROM extracted_scenes`).all() as Array<{ s: string; g: string | null; c: string | null }>)
      sceneMeta.set(r.s, { goals: parseArr(r.g), conflicts: parseArr(r.c) })

    /** Collect a character's goals + conflicts across a window's scenes (deduped). */
    const windowIntent = (norm: string, sceneIds: string[]): Pick<ArcWindow, 'goals' | 'conflicts'> => {
      const goals = new Map<string, string>()
      const conflicts: ArcWindow['conflicts'] = []
      const seen = new Set<string>()
      for (const sid of sceneIds) {
        const meta = sceneMeta.get(sid)
        if (!meta) continue
        for (const g of meta.goals) if (normName(String(g.actor ?? '')) === norm) goals.set(String(g.goal ?? ''), String(g.status ?? ''))
        for (const cf of meta.conflicts) {
          const between = Array.isArray(cf.between) ? (cf.between as unknown[]).map(String) : []
          if (!between.some((n) => normName(n) === norm)) continue
          const key = `${String(cf.over ?? '')}|${String(cf.kind ?? '')}`
          if (seen.has(key)) continue
          seen.add(key)
          conflicts.push({ over: String(cf.over ?? ''), with: between.filter((n) => normName(n) !== norm), kind: String(cf.kind ?? '') })
        }
      }
      return { goals: [...goals].map(([goal, status]) => ({ goal, status })), conflicts }
    }

    const rows = db
      .prepare(
        // Window = the CHAPTER the change belongs to (its scenes form the band). The window pass writes
        // unit_id = the scene where it happened + chapter_id = the window; older rows only set unit_id (= the
        // chapter), so COALESCE keys correctly for both. Keying by unit_id (a scene) gave empty bands — a
        // scene has no scene-children, so scenesUnder() returned [] and the arc markers vanished.
        // eventScene = a.unit_id: on NEW rows this is the SCENE the change happened in (chapter_id carries the
        // window) — feeds the SceneInspector→arc deep-link's per-event highlight. On legacy rows unit_id = the
        // chapter, so it just won't match a real scene id (no highlight) — graceful.
        `SELECT a.entity_id AS entityId, COALESCE(e.name, a.entity_id) AS name,
                COALESCE(a.chapter_id, a.unit_id) AS windowId, a.unit_id AS eventScene, a.category, a.change, a.value, a.description
         FROM entity_arc_events a LEFT JOIN entities e ON e.entity_id = a.entity_id
         WHERE ${typeWhere} AND COALESCE(e.phase, '') <> 'archived'
         ORDER BY name`
      )
      .all() as Array<{
      entityId: string; name: string; windowId: string; eventScene: string | null
      category: string | null; change: string | null; value: string | null; description: string | null
    }>

    // group: entity → window → events
    const byEntity = new Map<string, { name: string; windows: Map<string, ArcWindow> }>()
    for (const r of rows) {
      const ent = byEntity.get(r.entityId) ?? { name: r.name, windows: new Map<string, ArcWindow>() }
      let w = ent.windows.get(r.windowId)
      if (!w) {
        const sceneIds = sceneCache.get(r.windowId) ?? scenesUnder(r.windowId)
        sceneCache.set(r.windowId, sceneIds)
        const intent = windowIntent(normName(r.name), sceneIds)
        w = { windowId: r.windowId, title: r.windowId, sceneIds, summary: winSummary.get(`${r.entityId}::${r.windowId}`) ?? null, ...intent, events: [] }
        ent.windows.set(r.windowId, w)
      }
      w.events.push({ category: r.category ?? '', change: r.change ?? '', value: r.value ?? '', description: r.description ?? '', ...(r.eventScene ? { sceneId: r.eventScene } : {}) })
      byEntity.set(r.entityId, ent)
    }

    // window title: use narrative_units.title
    const unitTitle = new Map(
      (db.prepare(`SELECT unit_id AS id, title FROM narrative_units`).all() as Array<{ id: string; title: string | null }>).map((u) => [u.id, u.title])
    )
    // scene → numeric reading position (linear_pos, else sort_order). Windows must sort by READING ORDER, not by
    // a lexicographic compare of the first scene id (which put "…s10" before "…s2", so Chapter II surfaced above
    // Chapter I). sceneIds[0] is already the earliest-pos scene in the window (scenesUnder sorts by pos), so its
    // pos is the window's reading position.
    const posOf = new Map(units.map((u) => [u.id, u.pos ?? 0]))

    return [...byEntity.entries()].map(([entityId, ent]) => ({
      entityId,
      name: ent.name,
      windows: [...ent.windows.values()]
        .map((w) => ({ ...w, title: unitTitle.get(w.windowId) ?? w.windowId }))
        .sort((a, b) => (posOf.get(a.sceneIds[0] ?? '') ?? 1e9) - (posOf.get(b.sceneIds[0] ?? '') ?? 1e9))
    }))
  } catch {
    return []
  } finally {
    db.close()
  }
}

/** Coherence findings, highest-severity first. Empty (or no db) → clean empty state. */
/** Arc events of one category with knowledge fields (014) — ordered by reading position for the folds. */
export function listPossessionEvents(workRoot: string, category: 'secret' | 'custody'): Array<{ entityId: string; sceneId: string; change: string; value: string; target: string | null; secret: string | null; description: string }> {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    const hasTarget = !!db.prepare(`SELECT 1 FROM pragma_table_info('entity_arc_events') WHERE name = 'target'`).get()
    return db
      .prepare(
        `SELECT a.entity_id AS entityId, a.unit_id AS sceneId, a.change, a.value,
                ${hasTarget ? 'a.target' : 'NULL'} AS target, ${hasTarget ? 'a.secret_id' : 'NULL'} AS secret,
                a.description
         FROM entity_arc_events a
         LEFT JOIN unit_order u ON u.unit_id = a.unit_id
         WHERE a.category = ?
         ORDER BY COALESCE(u.linear_pos, 999999), a.rowid`
      )
      .all(category) as Array<{ entityId: string; sceneId: string; change: string; value: string; target: string | null; secret: string | null; description: string }>
  } finally {
    db.close()
  }
}

/** Per-scene ARC-CHANGE events (entity_arc_events) EXCEPT secret/custody — those already fold into the who-knows /
 *  holder views (listPossessionEvents). Carries the facet `category` (alignment|knowledge|power|… for characters;
 *  state|function|standing|… for entities); the SceneInspector splits character vs entity by the entity's kind.
 *  Ordered by reading position so a scene's changes read top-to-bottom. */
export function listArcEvents(workRoot: string): Array<{ entityId: string; sceneId: string; category: string; change: string; value: string; description: string }> {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    return db
      .prepare(
        `SELECT a.entity_id AS entityId, a.unit_id AS sceneId, a.category, a.change, a.value, a.description
         FROM entity_arc_events a
         LEFT JOIN unit_order u ON u.unit_id = a.unit_id
         WHERE a.category NOT IN ('secret', 'custody')
         ORDER BY COALESCE(u.linear_pos, 999999), a.rowid`
      )
      .all() as Array<{ entityId: string; sceneId: string; category: string; change: string; value: string; description: string }>
  } finally {
    db.close()
  }
}

/** Secret-category arc events with knowledge fields (014) — ordered by reading position for the fold. */
export function listSecretEvents(workRoot: string): Array<{ entityId: string; sceneId: string; change: string; value: string; target: string | null; secret: string | null; description: string }> {
  return listPossessionEvents(workRoot, 'secret')
}

export function listCoherenceFindings(workRoot: string): CoherenceFinding[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    // `why` is an ideal-shape column the producer doesn't emit yet — select it only if present.
    const hasWhy = !!db.prepare(`SELECT 1 FROM pragma_table_info('coherence_findings') WHERE name = 'why'`).get()
    const hasSecret = !!db.prepare(`SELECT 1 FROM pragma_table_info('coherence_findings') WHERE name = 'secret_id'`).get()
    const rows = db
      .prepare(
        `SELECT finding_id AS id, entity_id AS entityId, as_of_unit_id AS asOf, trait, declared,
                observed, kind, severity, suggestion, evidence_json AS evidenceJson,
                ${hasWhy ? 'why' : 'NULL'} AS why,
                ${hasSecret ? 'secret_id' : 'NULL'} AS secret
         FROM coherence_findings
         ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, kind`
      )
      .all() as Array<{
      id: string
      entityId: string | null
      asOf: string | null
      trait: string | null
      declared: string | null
      observed: string | null
      kind: string | null
      severity: string | null
      suggestion: string | null
      evidenceJson: string | null
      why: string | null
      secret: string | null
    }>
    return rows.map((r) => {
      // `quest:` findings embed the thread id (e.g. "quest:c:C4:thr:od-c1-s1:layoff") — extract it to link.
      const ti = r.id.indexOf('thr:')
      const threadId = r.id.startsWith('quest:') && ti >= 0 ? r.id.slice(ti) : null
      return {
        id: r.id,
        entityId: r.entityId,
        threadId,
        asOf: formatScene(r.asOf),
        trait: r.trait ?? '',
        declared: r.declared ?? '',
        observed: r.observed ?? '',
        why: r.why,
        secret: r.secret,
        kind: r.kind ?? 'drift',
        severity: r.severity ?? 'low',
        suggestion: r.suggestion ?? '',
        evidence: parseStrArray(r.evidenceJson)
      }
    })
  } catch {
    return []
  } finally {
    db.close()
  }
}

/**
 * The DERIVED enrichment for the Timeline's overlay layers — presence, threads,
 * revelations, summaries — read from the work's DB (HOME 3 in the schema doc). Each
 * sub-query is wrapped so a missing/empty table just yields nothing, never throws
 * (DBs vary: T1 fills entity_presence; threads/revelations ship pre-built or come from T2).
 */
const timelineGraphMemo = memoSlot<TimelineGraph>('timelineGraph')
export function timelineGraph(workRoot: string): TimelineGraph {
  const empty: TimelineGraph = { scenes: {}, edges: [] }
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return empty
  // Memoized by the DB + WAL/shm fingerprint — a hit reuses the built graph instead of re-querying every analysis
  // table; any writeTier/ingest/connect moves the WAL and rebuilds. Timetravel changes dbPath → its own key.
  return timelineGraphMemo(fingerprintDb(dbPath), () => {
  const db = openReadonly(dbPath)
  scopeThreads(db, workRoot)
  const safe = (fn: () => void): void => {
    try {
      fn()
    } catch {
      /* table absent in this db — skip that layer */
    }
  }
  try {
    const scenes: Record<string, TimelineSceneData> = {}
    const ensure = (id: string): TimelineSceneData =>
      (scenes[id] ??= { sceneId: id, cast: [], threads: [] })

    safe(() => {
      const rows = db
        .prepare(
          `SELECT u.unit_id AS id, o.linear_pos AS pos, e.summary AS summary,
                  json_extract(u.metadata_json,'$.pov') AS pov
           FROM narrative_units u
           LEFT JOIN unit_order o ON o.unit_id = u.unit_id
           LEFT JOIN extracted_scenes e ON e.scene_id = u.unit_id
           WHERE u.type = 'scene'`
        )
        .all() as Array<{ id: string; pos: number | null; summary: string | null; pov: string | null }>
      for (const r of rows) {
        const s = ensure(r.id)
        if (r.pos != null) s.linearPos = r.pos
        if (r.summary) s.summary = r.summary
        if (r.pov) s.pov = String(r.pov) // authored POV (frontmatter); else defaulted from cast below
      }
    })
    // Dialogue VOLUME per (scene, speaker) — cumulative CHARACTERS spoken, not turn/line COUNT. A speaker who
    // gives one long answer outweighs one who asks many short questions (line-count made them look equal). Drives
    // the presence heatmap intensity + dialog-volume bars, the Gantt scene-weight counter, and relation strength.
    const volume = new Map<string, number>()
    safe(() => {
      const rows = db
        .prepare(
          `SELECT unit_id AS unit, speaker_id AS entity, SUM(LENGTH(text)) AS n
           FROM dialog_nodes WHERE speaker_id IS NOT NULL GROUP BY unit_id, speaker_id`
        )
        .all() as Array<{ unit: string; entity: string; n: number }>
      for (const r of rows) volume.set(`${r.unit}|${r.entity}`, r.n)
    })
    safe(() => {
      const rows = db
        .prepare(`SELECT entity_id AS entityId, unit_id AS unit, role FROM entity_presence`)
        .all() as Array<{ entityId: string; unit: string; role: string | null }>
      for (const r of rows)
        ensure(r.unit).cast.push({
          entityId: r.entityId,
          role: r.role ?? undefined,
          volume: volume.get(`${r.unit}|${r.entityId}`) ?? 0
        })
    })
    // Silent presence: the T2 extraction reads the WHOLE room from the prose (characters_json), including
    // characters who never speak — who therefore never landed an entity_presence 'speaker' row. Add them as
    // role 'present' / 0 lines so the Cast grid can show "who was there" (a togglable layer), distinct from
    // speakers. Name→id via the entities registry (mirrors ingest's nameToEid). DISPLAY ONLY — significantCast
    // and the POV default below stay speaker-based (they read lines > 0), so analysis is untouched. Consistent
    // with the demotion: presence reads the prose-cast, not the author's `characters_present` tag.
    const nameToEid = new Map<string, string>()
    safe(() => {
      const ents = db
        .prepare(`SELECT entity_id AS id, name, aliases_json AS aliases FROM entities`)
        .all() as Array<{ id: string; name: string | null; aliases: string | null }>
      for (const e of ents) for (const v of entityNameVariants({ id: e.id, name: e.name, aliases: parseStrArray(e.aliases) })) if (!nameToEid.has(v)) nameToEid.set(v, e.id)
    })
    safe(() => {
      const resolve = (nm: string): string | undefined => nameToEid.get(nameKey(nm))
      const rows = db
        .prepare(`SELECT scene_id AS unit, characters_json AS cj FROM extracted_scenes WHERE characters_json IS NOT NULL`)
        .all() as Array<{ unit: string; cj: string | null }>
      for (const r of rows) {
        const s = scenes[r.unit]
        if (!s) continue
        for (const id of silentPresenceIds(s.cast.map((c) => c.entityId), parseStrArray(r.cj), resolve))
          s.cast.push({ entityId: id, role: 'present', volume: 0 })
      }
    })
    // Default POV (when not authored) = the scene's dominant speaker (most VOLUME). Mirrors lib/pov.ts so the
    // arc Gantt can glow each character's POV columns; an authored `pov` (read above) always wins.
    for (const s of Object.values(scenes)) {
      if (s.pov) continue
      let top: { entityId: string; volume: number } | null = null
      for (const c of s.cast) {
        const n = c.volume ?? 0
        if (n > 0 && (!top || n > top.volume)) top = { entityId: c.entityId, volume: n }
      }
      if (top) s.pov = top.entityId
    }
    safe(() => {
      const rows = db
        .prepare(`SELECT thread_id AS threadId, scene_id AS scene, action FROM thread_events`)
        .all() as Array<{ threadId: string; scene: string; action: string }>
      for (const r of rows) ensure(r.scene).threads.push({ threadId: r.threadId, action: r.action })
    })
    safe(() => {
      const rows = db
        .prepare(`SELECT unit_id AS unit, event_type AS type FROM entity_arc_events`)
        .all() as Array<{ unit: string; type: string }>
      for (const r of rows) (ensure(r.unit).arcBeats ??= []).push(r.type)
    })

    // Reveal beats (Revelations layer) — sourced from the SECRET LIFECYCLE (entity_arc_events, category 'secret'),
    // not the old revelation_events callback graph (its recontextualizes_unit_id was never populated). Per secret we
    // mark two beats on the spine: ○ SETUP = the first scene it's planted (earliest `gain`), ★ PUBLIC = a scene
    // where it goes public (`expose` → target 'public'). Labels come from the declared `## Secrets` roster.
    safe(() => {
      const hasTarget = !!db.prepare(`SELECT 1 FROM pragma_table_info('entity_arc_events') WHERE name = 'target'`).get()
      const rows = db
        .prepare(
          `SELECT a.entity_id AS entity, a.unit_id AS unit, a.change AS change, a.value AS value, a.description AS description,
                  ${hasTarget ? 'a.target' : 'NULL'} AS target, ${hasTarget ? 'a.secret_id' : 'NULL'} AS secret
           FROM entity_arc_events a
           LEFT JOIN unit_order u ON u.unit_id = a.unit_id
           WHERE a.category = 'secret'
           ORDER BY COALESCE(u.linear_pos, 999999), a.rowid`
        )
        .all() as Array<{ entity: string; unit: string; change: string; value: string | null; description: string | null; target: string | null; secret: string | null }>
      // declared-secret text → nicer marker labels (id fallback when uncited); best-effort, never throws
      const labelOf = new Map<string, string>()
      try {
        for (const s of collectDeclaredSecrets(workRoot)) labelOf.set(s.id, s.text)
      } catch {
        /* pages unreadable — fall back to ids/values below */
      }
      const keyOf = (r: { secret: string | null; entity: string; value: string | null }): string => r.secret || `${r.entity}|${r.value ?? ''}`
      const labelFor = (r: { secret: string | null; value: string | null; description: string | null }): string =>
        (r.secret && labelOf.get(r.secret)) || r.value || r.description || r.secret || 'secret'
      const setupSeen = new Set<string>() // rows are reading-ordered → the FIRST gain per secret is its plant
      for (const r of rows) {
        const isPublic = r.change === 'public' || (r.change === 'expose' && r.target === 'public')
        const isSetup = r.change === 'gain'
        if (!isPublic && !isSetup) continue
        const key = keyOf(r)
        if (isSetup) {
          if (setupSeen.has(key)) continue
          setupSeen.add(key)
        }
        const beat: RevealBeat = { kind: isPublic ? 'public' : 'setup', label: labelFor(r), ...(r.secret ? { secretId: r.secret } : {}) }
        ;(ensure(r.unit).reveals ??= []).push(beat)
      }
    })

    // edges: kept in the contract for future overlay-edge kinds (co-presence/lifelines); no kind populated today.
    const edges: TimelineOverlayEdge[] = []
    return { scenes, edges }
  } finally {
    db.close()
  }
  })
}
