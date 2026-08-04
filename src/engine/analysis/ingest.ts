/**
 * ingest.ts — T1 ingest: reads NVS project files into the co-located SQLite DB.
 *
 * The app's ingest algorithm:
 *   1. Ensure .nvs/ dir + DB exist (openDb auto-migrates).
 *   2. Load entities from content/world/characters/*.md → name→id map.
 *   3. Walk content/story/chapters/**\/*.md:
 *      - Hash each file; skip if unchanged (incremental via source_files table).
 *      - Parse frontmatter (narrative_unit tree) + body (dialog_nodes + chorus detection).
 *      - Scope-replace dialog_nodes for changed scenes only.
 *   4. Prune rows for deleted files.
 *
 * This is T1 — deterministic, no LLM. Safe to call after every save.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import matter from 'gray-matter'
import { openDb } from '@engine/data/db'
import { ensureStructure } from '@engine/analysis/structure'
import { listStoryTree, uniqueId, existingSceneIds } from '@engine/content/storyTree'

/** "A Room in the Castle" → "a-room-in-the-castle". Delegates to the ONE slug rule (@shared/contentId,
 *  internal/content-id.md) so scene ids match every other content id (NFKC + combining marks preserved). */
const slug = (s: string): string => slugId(s)
import { parseCue, isAction, isTransition, stripTiming } from '@shared/config/fountain'
import { slugId } from '@shared/contentId'
import { stampId } from '@engine/content/contentId'
import type DatabaseType from 'better-sqlite3'
import type { StoryNode } from '@shared/ipc'

// ── Dialogue parsing ──────────────────────────────────────────────────────────
// NVS Fountain dialect (scene-format.md). Cue grammar is shared with the block editor via
// @shared/config/fountain so the writer and this reader stay in lockstep. Bump PARSER_VERSION on any
// grammar change → every scene's stored hash changes → a full re-parse on the next ingest.
export const PARSER_VERSION = 'fountain-2'

const CHORUS_KEYWORDS = new Set([
  'all', 'both', 'everyone', 'omnes', 'chorus', 'they', 'crowd',
  'voices', 'ensemble', 'citizens',
])

function isChorus(speaker: string): boolean {
  const s = speaker.trim()
  if (CHORUS_KEYWORDS.has(s.toLowerCase())) return true
  // "Name and Name" — whole-word 'and'; "Ferdinand" is not a match
  if (/\s+and\s+/i.test(s)) return true
  // Comma-separated name list: "Zhongli, Childe" — each segment ≤ 2 words
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim())
    if (
      parts.length >= 2 &&
      parts.every(
        (p) =>
          p.length >= 2 &&
          /^[A-Z]/.test(p) &&
          !p.endsWith('.') &&
          p.split(/\s+/).length <= 2
      )
    )
      return true
  }
  return false
}

type DialogueType = 'speech' | 'monologue' | 'narration' | 'chorus'

interface DialogueLine {
  speaker: string
  text: string
  type: DialogueType
}

/**
 * Parse a scene body (NVS Fountain) into dialogue lines. A character cue (ALL-CAPS, optional `(MODIFIER)`)
 * captures the following non-blank line(s) until a blank line; `(THINKING)`-family cues are monologue and
 * group cues ("ALL", "A and B") are chorus. Action (`>`) and transition (`=`) carry no speaker, so they're
 * skipped here; every other plain paragraph is narration. Mirrors the editor's parseFountain state machine.
 */
function parseDialog(body: string): DialogueLine[] {
  const lines: DialogueLine[] = []
  let pending: { speaker: string; type: DialogueType } | null = null
  let buf: string[] = []

  const flush = (): void => {
    if (pending) {
      const text = buf.join('\n').trim()
      if (text) lines.push({ speaker: pending.speaker, text, type: pending.type })
    }
    pending = null
    buf = []
  }

  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    if (pending) {
      buf.push(line.trim())
      continue
    }
    // A beat may carry a leading timing tag (`[00:01:23 → 00:01:27]`) — strip it before classifying. Timing is
    // metadata (the WHEN), not an analysis input, so T1 discards it; it only mustn't derail cue/action detection.
    const cls = stripTiming(line.trim()).rest
    // Action (`>`) and transition (`=`) carry no speaker — record their text as narration (reader-facing
    // context: physical beats, time-jump markers) rather than dropping it. The file keeps `>`/`=`.
    if (isAction(cls) || isTransition(cls)) {
      const text = cls.replace(/^\s*[>=]\s*/, '').trim()
      if (text) lines.push({ speaker: 'Narration', text, type: 'narration' })
      continue
    }
    const cue = parseCue(cls)
    if (cue) {
      const type: DialogueType = cue.thinking ? 'monologue' : isChorus(cue.speaker) ? 'chorus' : 'speech'
      pending = { speaker: cue.speaker, type }
      continue
    }
    lines.push({ speaker: 'Narration', text: cls, type: 'narration' })
  }
  flush()
  return lines
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface IngestResult {
  chapters: number
  scenes: number
  dialogNodes: number
  changed: number
  skipped: number
}

/**
 * Run a full incremental T1 ingest on the open work.
 * Creates the .nvs/ dir and DB if absent; auto-migrates the schema.
 */
/**
 * Rename legacy path-keyed chapter units (`c:<relPath>`) to their stable-id form (`c:<folderId>`), carrying every
 * referencing row along. The (table, column) pairs come from SQLite's own FK metadata (same discovery as the
 * prune) plus the two unit-id columns that exist WITHOUT a declared FK (ALTER-added / typed loose). Idempotent:
 * a pair is skipped unless the old id exists and the new one doesn't, so it runs once per folder ever.
 */
function reKeyUnits(db: ReturnType<typeof openDb>, pairs: Array<{ from: string; to: string }>): void {
  const exists = db.prepare('SELECT 1 FROM narrative_units WHERE unit_id = ?')
  const todo = pairs.filter((p) => p.from !== p.to && exists.get(p.from) && !exists.get(p.to))
  if (todo.length === 0) return
  const refs: Array<{ table: string; column: string }> = [
    { table: 'entity_arc_events', column: 'chapter_id' }, // ALTER-added (003) — no declared FK
    { table: 'coherence_findings', column: 'as_of_unit_id' } // declared without REFERENCES (006)
  ]
  for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>) {
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${name})`).all() as Array<{ table: string; from: string }>) {
      if (fk.table === 'narrative_units') refs.push({ table: name, column: fk.from })
    }
  }
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON') // rename order within the txn is irrelevant; FKs validate at commit
    const renameUnit = db.prepare('UPDATE narrative_units SET unit_id = ? WHERE unit_id = ?')
    for (const p of todo) {
      renameUnit.run(p.to, p.from)
      for (const r of refs) db.prepare(`UPDATE ${r.table} SET ${r.column} = ? WHERE ${r.column} = ?`).run(p.to, p.from)
    }
  })()
}

/**
 * The pure two-rule decision (content-id.md): which entities to evict. `seen` = ids whose page exists this pass;
 * `referenced` = ids used by analysis. A page-backed entity dies when its page is gone; a minted/legacy one dies
 * only when nothing references it. Split out for unit-testability (the cascade needs a live DB).
 */
export function deadEntityIds(
  ents: ReadonlyArray<{ id: string; source: string | null }>,
  seen: Set<string>,
  referenced: Set<string>
): string[] {
  return ents.filter((e) => (e.source === 'page' ? !seen.has(e.id) : !seen.has(e.id) && !referenced.has(e.id))).map((e) => e.id)
}

/**
 * Evict entities whose source is gone (internal/content-id.md). Two rules by ORIGIN:
 *   • source='page'  → evict when its authored page is absent this pass (`seen`). It IS a cache of that file.
 *   • else (minted/legacy) → evict only when NO analysis references it. It's a cache of prose references.
 * Cascade (RESTRICT FKs, like the scene prune): a NOT NULL ref is the entity's OWN analysis → DELETE it; a
 * NULLABLE ref (e.g. dialog_nodes.speaker_id — the DIALOGUE outlives the character) → SET NULL, never delete the
 * prose. Refs are discovered from FK metadata so a new table can't silently break it. Returns the evicted ids.
 */
export function pruneEntities(db: DatabaseType.Database, workId: string, seen: Set<string>): string[] {
  const notnull: Array<{ table: string; column: string }> = []
  const nullable: Array<{ table: string; column: string }> = []
  for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>) {
    const nn = new Map((db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string; notnull: number }>).map((c) => [c.name, c.notnull === 1]))
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${name})`).all() as Array<{ table: string; from: string }>)
      if (fk.table === 'entities') (nn.get(fk.from) ? notnull : nullable).push({ table: name, column: fk.from })
  }
  // "referenced" = has a row in any NOT NULL ref table (the entity is genuinely used by analysis).
  const referenced = new Set<string>()
  for (const r of notnull)
    for (const row of db.prepare(`SELECT DISTINCT ${r.column} AS id FROM ${r.table} WHERE ${r.column} IS NOT NULL`).all() as Array<{ id: string }>) referenced.add(row.id)
  const ents = db.prepare(`SELECT entity_id AS id, source FROM entities WHERE work_id = ?`).all(workId) as Array<{ id: string; source: string | null }>
  const dead = deadEntityIds(ents, seen, referenced)
  if (dead.length === 0) return []
  const qs = dead.map(() => '?').join(',')
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON')
    for (const r of nullable) db.prepare(`UPDATE ${r.table} SET ${r.column}=NULL WHERE ${r.column} IN (${qs})`).run(...dead)
    for (const r of notnull) db.prepare(`DELETE FROM ${r.table} WHERE ${r.column} IN (${qs})`).run(...dead)
    db.prepare(`DELETE FROM entities WHERE entity_id IN (${qs})`).run(...dead)
  })()
  return dead
}

export function ingest(workRoot: string, workId: string, title: string): IngestResult {
  const nsDir = join(workRoot, '.nvs')
  if (!existsSync(nsDir)) mkdirSync(nsDir, { recursive: true })
  const db = openDb(join(nsDir, 'nvs.db'))
  try {
    return _run(db, workRoot, workId, title)
  } finally {
    db.close()
  }
}

// ── Implementation ────────────────────────────────────────────────────────────

function _run(
  db: DatabaseType.Database,
  nvsRoot: string,
  workId: string,
  title: string
): IngestResult {
  const now = new Date().toISOString()

  // 1. Work record
  db.prepare(
    `INSERT INTO works (work_id, title, type, lang, imported_at)
     VALUES (?, ?, 'novel', 'EN', ?)
     ON CONFLICT(work_id) DO UPDATE SET title=excluded.title, imported_at=excluded.imported_at`
  ).run(workId, title, now)

  // 2. Entities from the project STRUCTURE — every tracked category (characters · locations · items · factions · …),
  //    not just characters (fixes the "authored locations/items are 0 entities" gap; see internal/open-taxonomy.md).
  //    Only `character` feeds the speaker map (nameToEid) so a place/item name can't mis-resolve a dialogue speaker.
  const structure = ensureStructure(nvsRoot) // materializes .nvs/structure.json (default = master vocabulary)
  const nameToEid = new Map<string, string>()
  const seenEntityIds = new Set<string>() // entity ids whose world page exists this pass (prune liveness)

  // source='page': this entity is backed by an authored world page. Set on every ingest, so a legacy or once-
  // minted entity that now HAS a page is (re)marked page-backed — the signal prune uses (content-id.md).
  const upsert = db.prepare(
    `INSERT INTO entities (entity_id, work_id, type, name, aliases_json, phase, source)
     VALUES (?, ?, ?, ?, ?, ?, 'page')
     ON CONFLICT(entity_id) DO UPDATE SET type=excluded.type, name=excluded.name, aliases_json=excluded.aliases_json, phase=excluded.phase, source='page'`
  )
  db.transaction(() => {
    for (const cat of structure.world) {
      if (!cat.tracked) continue // reference kinds (lore) aren't entities
      const dir = join(nvsRoot, 'content', 'world', cat.folder)
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md') || /^readme/i.test(file)) continue
        const filePath = join(dir, file)
        const { data } = matter(readFileSync(filePath, 'utf8'))
        const eid = data.id != null ? String(data.id) : file.replace(/\.md$/, '')
        // Stamp-back the id so a later FILE rename can't mint a NEW entity (mirrors scene_id; best-effort,
        // read-only tolerant). Only when unstamped — never rewrites a page that already declares its id.
        // The stamped id preserves current identity (filename stem), so no references break. content-id.md.
        if (data.id == null) stampId('entity', filePath, eid)
        // Display name: `name`, else `title` (AI-generated pages set title only), else the filename slug.
        const name = String(data.name ?? data.title ?? file.replace(/\.md$/, ''))
        const aliases: string[] = Array.isArray(data.aliases)
          ? data.aliases.map(String)
          : typeof data.aliases === 'string'
          ? [data.aliases]
          : []
        const phase = data.phase != null ? String(data.phase) : null // content-phase → drives archived-gating in viz
        upsert.run(eid, workId, cat.key, name, aliases.length ? JSON.stringify(aliases) : null, phase)
        seenEntityIds.add(eid) // live page-backed entities this pass — the prune's liveness signal
        if (cat.key === 'character') {
          nameToEid.set(name.toLowerCase(), eid)
          nameToEid.set(eid.toLowerCase(), eid)
          for (const a of aliases) nameToEid.set(a.toLowerCase(), eid)
        }
      }
    }
  })()

  // 3. Walk the free-form story tree (content/story), ordered by each folder's .order.
  const tree = listStoryTree(nvsRoot)
  if (tree.length === 0) return { chapters: 0, scenes: 0, dialogNodes: 0, changed: 0, skipped: 0 }

  const storedHashes = new Map<string, string>(
    (
      db
        .prepare('SELECT path, sha256 FROM source_files WHERE work_id = ?')
        .all(workId) as Array<{ path: string; sha256: string }>
    ).map((r) => [r.path, r.sha256])
  )

  interface UnitRow {
    unit_id: string; work_id: string; parent_id: string | null
    type: string; title: string; sort_order: number; metadata_json: string | null
  }
  interface NodeRow {
    node_id: string; unit_id: string; speaker_id: string | null; speaker_name: string
    text: string; sequence: number; dialogue_type: string
  }
  interface PresRow { entity_id: string; unit_id: string }
  interface FileRow { path: string; sha256: string; unit_id: string }

  const units: UnitRow[] = []
  const orderRows: Array<{ unit_id: string; linear_pos: number }> = []
  const changedUids: string[] = []
  const allNodes: NodeRow[] = []
  const allPresences: PresRow[] = []
  const fileRows: FileRow[] = []
  const diskPaths = new Set<string>()
  const seenPres = new Set<string>()
  const chapters = new Map<string, number>()
  let sceneSeq = 0
  let totalDialog = 0
  let skipped = 0
  // Seeded with every existing scene_id (real + filename-fallbacks) so a stamped id can't collide work-wide;
  // grows as we assign. Backs the scene_id GUARANTEE — see D2 (enforce the contract, not the cosmetics).
  const assignedIds = existingSceneIds(nvsRoot)

  const processScene = (node: StoryNode, parentUid: string | null): void => {
    const scPath = node.path
    const rel = relative(nvsRoot, scPath)
    diskPaths.add(rel)

    const rawBytes = readFileSync(scPath)
    const { data, content: body } = matter(rawBytes.toString('utf8'))
    // scene_id GUARANTEE: a scene with no `scene_id` (typically imported content) gets a unique one STAMPED
    // into its frontmatter, once. Today's filename-fallback id breaks on rename (the FK-orphan bug) and can't
    // travel for the share/fork model; a real id is the stable anchor links + analysis + lineage rely on (D2).
    let sceneId = data.scene_id != null ? String(data.scene_id) : ''
    let finalBytes = rawBytes
    if (!sceneId) {
      sceneId = uniqueId(slug(String(data.title ?? node.name)) || 'scene', assignedIds)
      data.scene_id = sceneId
      const stamped = Buffer.from(matter.stringify(body.replace(/^\n+/, ''), data), 'utf8')
      try {
        writeFileSync(scPath, stamped)
        finalBytes = stamped // persisted → hash the stamped content
      } catch {
        // read-only / locked file: use the id in-memory this session, leave the file + hash as-is (no crash,
        // no perpetual restale). The scene just gets re-stamped next ingest until it's writable.
      }
    }
    assignedIds.add(sceneId)
    // Hash the FINAL bytes (post-stamp) so a stamped scene isn't seen as "changed" on the next ingest.
    const sha = createHash('sha256').update(PARSER_VERSION).update(finalBytes).digest('hex')
    const sTitle = String(data.title ?? node.name)

    const metaFields: Record<string, unknown> = {}
    for (const k of ['quest_type', 'mode', 'status', 'phase', 'goal', 'conflict', 'outcome', 'pov', 'leads_to']) {
      if (data[k] != null) metaFields[k] = data[k]
    }

    units.push({
      unit_id: sceneId, work_id: workId, parent_id: parentUid,
      type: 'scene', title: sTitle, sort_order: sceneSeq++,
      metadata_json: Object.keys(metaFields).length ? JSON.stringify(metaFields) : null,
    })
    orderRows.push({ unit_id: sceneId, linear_pos: sceneSeq - 1 })

    if (storedHashes.get(rel) === sha) { skipped++; return }

    changedUids.push(sceneId)
    fileRows.push({ path: rel, sha256: sha, unit_id: sceneId })

    const dialogLines = parseDialog(body)
    totalDialog += dialogLines.length

    for (let seq = 0; seq < dialogLines.length; seq++) {
      const { speaker, text, type: dtype } = dialogLines[seq]
      const entityId = dtype === 'chorus' ? null : (nameToEid.get(speaker.toLowerCase()) ?? null)
      allNodes.push({
        node_id: `${sceneId}:${seq}`, unit_id: sceneId,
        speaker_id: entityId, speaker_name: speaker,
        text, sequence: seq, dialogue_type: dtype,
      })
      if (entityId) {
        const k = `${entityId}|${sceneId}`
        if (!seenPres.has(k)) {
          seenPres.add(k)
          allPresences.push({ entity_id: entityId, unit_id: sceneId })
        }
      }
    }
  }

  // Folders → container units, kind from the folder's `.type` (act/part/chapter/…); default 'chapter' when untyped.
  // Keyed by the folder's STABLE id (`c:<folderId>`, the folder analogue of scene_id) so windows/coherence/timeline
  // survive rename & move; path-keyed only as a fallback when the id couldn't be stamped (read-only fs).
  // Parent chain follows nesting; scenes are leaves. linear_pos increments in flattened .order traversal, so
  // drag-reorder drives the sequence of events.
  const reKeys: Array<{ from: string; to: string }> = [] // legacy `c:<path>` rows → `c:<folderId>` (one-shot, below)
  const walk = (nodes: StoryNode[], parentUid: string | null): void => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        const uid = `c:${node.folderId ?? node.relPath}`
        if (node.folderId) reKeys.push({ from: `c:${node.relPath}`, to: uid })
        chapters.set(node.relPath, 1)
        units.push({
          unit_id: uid, work_id: workId, parent_id: parentUid,
          type: node.containerType || 'chapter', title: node.name, sort_order: sceneSeq++, metadata_json: null,
        })
        orderRows.push({ unit_id: uid, linear_pos: sceneSeq - 1 })
        walk(node.children ?? [], uid)
      } else {
        processScene(node, parentUid)
      }
    }
  }
  walk(tree, null)

  // 3.5 One-shot re-key: chapter units written by older builds were keyed by PATH (`c:<relPath>`). Now that
  // folders carry a stable id, rename each legacy row — and every row referencing it (windows, coherence,
  // thread anchors) — to `c:<folderId>`, so the analysis rides the identity change instead of orphaning.
  reKeyUnits(db, reKeys)

  // 4. Flush to DB
  const upsertUnit = db.prepare(
    `INSERT INTO narrative_units (unit_id, work_id, parent_id, type, title, sort_order, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(unit_id) DO UPDATE SET
       parent_id=excluded.parent_id, type=excluded.type,
       title=excluded.title, sort_order=excluded.sort_order, metadata_json=excluded.metadata_json`
  )
  const upsertOrder = db.prepare(
    `INSERT INTO unit_order (unit_id, linear_pos) VALUES (?, ?)
     ON CONFLICT(unit_id) DO UPDATE SET linear_pos=excluded.linear_pos`
  )
  db.transaction(() => {
    for (const u of units) upsertUnit.run(u.unit_id, u.work_id, u.parent_id, u.type, u.title, u.sort_order, u.metadata_json)
    for (const o of orderRows) upsertOrder.run(o.unit_id, o.linear_pos)
  })()

  if (changedUids.length > 0) {
    const qs = changedUids.map(() => '?').join(',')
    db.prepare(`DELETE FROM dialog_nodes    WHERE unit_id IN (${qs})`).run(...changedUids)
    db.prepare(`DELETE FROM entity_presence WHERE unit_id IN (${qs})`).run(...changedUids)

    const insNode = db.prepare(
      `INSERT OR REPLACE INTO dialog_nodes
         (node_id, unit_id, speaker_id, speaker_name, text, sequence, dialogue_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const insPres = db.prepare(
      `INSERT OR IGNORE INTO entity_presence (entity_id, unit_id, role) VALUES (?, ?, 'speaker')`
    )
    const insFile = db.prepare(
      `INSERT INTO source_files (work_id, path, sha256, unit_id, ingested_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(work_id, path) DO UPDATE SET
         sha256=excluded.sha256, unit_id=excluded.unit_id, ingested_at=excluded.ingested_at`
    )
    db.transaction(() => {
      for (const n of allNodes) insNode.run(n.node_id, n.unit_id, n.speaker_id, n.speaker_name, n.text, n.sequence, n.dialogue_type)
      for (const p of allPresences) insPres.run(p.entity_id, p.unit_id)
      for (const f of fileRows) insFile.run(workId, f.path, f.sha256, f.unit_id, now)
    })()
  }

  // 4.5 Re-attribution (roster-driven). speaker_id is resolved at PARSE time (step 2's nameToEid), but a scene
  // skipped by the hash-guard (line ~370) keeps its OLD speaker_id — so creating a character page or adding an
  // alias would NOT re-attribute existing dialogue: its volume/presence stays stale until that scene's own bytes
  // change (or PARSER_VERSION bumps and forces a full re-parse). Attribution depends on the ENTITY ROSTER, not
  // just scene bytes. So re-resolve speaker_id for EVERY non-chorus dialog_node from its stored speaker_name
  // against the CURRENT nameToEid, then rebuild the role='speaker' presence rows. One pass over dialog_nodes via
  // a temp-table join; the T2-owned 'present'/'mentioned' rows are left untouched. Resolution mirrors the
  // parse-time path exactly (nameToEid keyed by toLowerCase). Only needed when scenes were skipped — a full pass
  // (nothing skipped) already attributed every scene against this same roster.
  if (skipped > 0) {
    const scoped = `unit_id IN (SELECT unit_id FROM narrative_units WHERE work_id = ?)`
    const cues = db
      .prepare(`SELECT DISTINCT speaker_name FROM dialog_nodes WHERE ${scoped} AND dialogue_type != 'chorus'`)
      .all(workId) as Array<{ speaker_name: string }>
    db.transaction(() => {
      db.prepare(`DROP TABLE IF EXISTS _reattr`).run()
      db.prepare(`CREATE TEMP TABLE _reattr (name TEXT PRIMARY KEY, eid TEXT)`).run()
      const insAttr = db.prepare(`INSERT OR IGNORE INTO _reattr (name, eid) VALUES (?, ?)`)
      for (const { speaker_name } of cues) insAttr.run(speaker_name, nameToEid.get(speaker_name.toLowerCase()) ?? null)
      // Exact speaker_name match (no SQL lower(), so Unicode casing matches the JS resolution above).
      db.prepare(
        `UPDATE dialog_nodes SET speaker_id = (SELECT eid FROM _reattr WHERE _reattr.name = dialog_nodes.speaker_name)
          WHERE ${scoped} AND dialogue_type != 'chorus'`
      ).run(workId)
      // Rebuild ONLY the speaker presence rows; T2's 'present'/'mentioned' rows (silentPresence/writeTier) stay.
      db.prepare(`DELETE FROM entity_presence WHERE role = 'speaker' AND ${scoped}`).run(workId)
      db.prepare(
        `INSERT OR IGNORE INTO entity_presence (entity_id, unit_id, role)
           SELECT DISTINCT speaker_id, unit_id, 'speaker' FROM dialog_nodes
            WHERE speaker_id IS NOT NULL AND ${scoped}`
      ).run(workId)
      db.prepare(`DROP TABLE _reattr`).run()
    })()
  }

  // 5. Prune deleted files
  const stored = [...storedHashes.keys()]
  const pruned = stored.filter((p) => !diskPaths.has(p))
  if (pruned.length > 0) {
    const qs = pruned.map(() => '?').join(',')
    const deadRows = db
      .prepare(`SELECT unit_id FROM source_files WHERE work_id=? AND path IN (${qs}) AND unit_id IS NOT NULL`)
      .all(workId, ...pruned) as Array<{ unit_id: string }>
    // CRUCIAL: a renamed folder/file changes a scene's PATH but not its stable `scene_id`, so the same
    // unit_id is re-ingested under a new path. Never prune a unit that's still live in this pass — deleting
    // it would orphan (or FK-block, via T2/T3 rows that REFERENCE narrative_units) a unit that still exists.
    const liveUnitIds = new Set(units.map((u) => u.unit_id))
    const dead = deadRows.map((r) => r.unit_id).filter((uid) => !liveUnitIds.has(uid))
    if (dead.length > 0) {
      const dqs = dead.map(() => '?').join(',')
      // A truly-deleted scene's analysis (T2/T3) still REFERENCES narrative_units, and those FKs are
      // RESTRICT — so we must clear every referencing row before removing the unit, or the delete FK-fails.
      // Discover the (table, column) pairs that point at narrative_units from SQLite's own metadata, so a
      // new analysis table can never silently re-introduce this crash. defer_foreign_keys makes the
      // delete order within the transaction irrelevant (FKs are validated once, at commit).
      const refs: Array<{ table: string; column: string }> = []
      for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>) {
        for (const fk of db.prepare(`PRAGMA foreign_key_list(${name})`).all() as Array<{ table: string; from: string }>) {
          if (fk.table === 'narrative_units') refs.push({ table: name, column: fk.from })
        }
      }
      db.transaction(() => {
        db.pragma('defer_foreign_keys = ON')
        for (const r of refs) db.prepare(`DELETE FROM ${r.table} WHERE ${r.column} IN (${dqs})`).run(...dead)
        db.prepare(`DELETE FROM narrative_units WHERE unit_id IN (${dqs})`).run(...dead)
      })()
    }
    db.prepare(`DELETE FROM source_files WHERE work_id=? AND path IN (${qs})`).run(workId, ...pruned)
  }

  // 6. Prune deleted/orphaned entities (content-id.md) — same cache-eviction discipline as scenes above.
  pruneEntities(db, workId, seenEntityIds)

  return {
    chapters: chapters.size,
    scenes: units.filter((u) => u.type === 'scene').length,
    dialogNodes: totalDialog,
    changed: changedUids.length,
    skipped,
  }
}
