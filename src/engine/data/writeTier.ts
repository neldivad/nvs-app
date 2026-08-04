/**
 * writeTier.ts — the T2/T3 producer writer (see internal/write-tier.md).
 *
 * The ONE engine writer through which any producer (the agentMCP first, an in-app
 * trigger today) persists inferred tiers into the co-located DB. T1 stays `ingest`;
 * T4 (Query/inference) is never stored. This handles the canonical tiers only —
 * the tables the app's schema defines and the built-in panels read (003/005/006):
 *
 *   kind 'scene'     (T2) → extracted_scenes + this scene's thread_events + lore_updates
 *                            (+ upsert any newly-opened narrative_threads umbrella)
 *   kind 'character' (T2) → character_windows + entity_arc_events (the six lists flattened)
 *   kind 'diff'      (T3) → coherence_findings
 *
 * Producer discipline (invariant 3): the engine STAMPS work_id / created_at / model /
 * input_hash and VALIDATES shape + refs + enums + capability; it stays silent on meaning
 * (whether a thread is "real" is the producer's claim, recorded by `model`). One call =
 * one transaction: scoped-delete → insert → recompute touched thread umbrellas →
 * upsert inference_runs (the staleness ledger goes live here — nothing else writes it).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import matter from 'gray-matter'
import { openDb, openReadonly } from '@engine/data/db'
import { canonicalizeUnitRefs } from '@engine/content/unitRefs'
import { readStructure } from '@engine/analysis/structure'
import { allowedArcChanges } from '@shared/config/entityArc'
import { analysisPromptVersion, COHERENCE_LOGIC_VERSION, FIDELITY_KINDS, CONTINUITY_KINDS } from '@shared/config/extraction'
import { loadProjectInfo } from '@engine/content/projectInfo'
import { entityNameVariants, normName as nameKey } from '@shared/entityNames'
import { nameToId } from '@shared/entityId'
import { digestPlan, digestInputs, profilePlan, profileInputs, activeTreeEdges, sceneAncestryHash } from '@engine/analysis/rollups'
import { graphAncestors } from '@engine/analysis/timelineGraph'
import { significantEntityIds } from '@engine/data/queries'
import type DatabaseType from 'better-sqlite3'
import type { IngestSession, IngestStep, TierKind, TierWrite, TierWriteResult, TierStatusRow } from '@shared/ipc'

const THREAD_ACTIONS = new Set(['open', 'advance', 'resolve', 'reopen', 'supersede'])
// The two coherence kind families (single source of truth in extraction.ts). Validation is family-STRICT (a
// coherence write must emit FIDELITY_KINDS, a continuity write CONTINUITY_KINDS), and the delete-on-rewrite is
// partitioned by family: a Fidelity re-run deletes only FIDELITY_KINDS (so Continuity findings survive) and a
// Continuity re-run only CONTINUITY_KINDS. The two families are disjoint (tests/continuityCoherence.test.ts).
const FIDELITY_SET = new Set<string>(FIDELITY_KINDS)
const CONTINUITY_SET = new Set<string>(CONTINUITY_KINDS)
const FIDELITY_DELETE = FIDELITY_KINDS.map((k) => `'${k}'`).join(',') // the per-entity Fidelity replace
const CONTINUITY_DELETE = CONTINUITY_KINDS.map((k) => `'${k}'`).join(',') // the whole-story Continuity replace
const SEVERITIES = new Set(['low', 'medium', 'high'])

/** Read the target entity's category and check every arc-event change against that category's vocab (item/faction
 *  have their own verbs; character + unknown categories fall back to gain/loss/expose). Facets are advisory — an
 *  off-vocab facet is kept (the taxonomy is open), only the change axis is enforced. Returns an error or null. */
function validateWindowVocab(db: DatabaseType.Database, p: Extract<TierWrite, { kind: 'window' }>): string | null {
  const row = db.prepare('SELECT type FROM entities WHERE entity_id = ?').get(p.targetId) as { type: string } | undefined
  const changes = allowedArcChanges(row?.type ?? 'character')
  for (const e of p.rows.arcEvents) {
    if (!changes.has(e.change)) return `bad arc change "${e.change}" for ${row?.type ?? 'entity'} (allowed: ${[...changes].join(', ')})`
  }
  return null
}

function dbPathFor(workRoot: string): string {
  return join(workRoot, '.nvs', 'nvs.db')
}

/** Deterministic run id — the format inference_runs (002) specifies. */
export function runIdFor(tier: string, kind: string, targetId: string, asOf: string | null): string {
  return asOf ? `${tier}:${kind}:${targetId}:${asOf}` : `${tier}:${kind}:${targetId}`
}

// ── tierInputHash: the ONE engine-owned hash recipe ────────────────────────────
// Shared by the writer (records it) and the Ingest dock's staleness detector
// (recomputes + compares). Never computed independently by a producer — that would
// let producer and detector drift. sha256 of exactly the inputs a run consumes.

/** Ordered, normalized dialogue digest for the rows a SQL predicate selects. */
function dialogueDigest(
  db: DatabaseType.Database,
  whereSql: string,
  params: unknown[]
): string {
  const rows = db
    .prepare(
      `SELECT d.speaker_name AS s, d.dialogue_type AS t, d.text AS x
         FROM dialog_nodes d
         JOIN unit_order o ON o.unit_id = d.unit_id
        WHERE ${whereSql}
        ORDER BY o.linear_pos, d.sequence`
    )
    .all(...params) as Array<{ s: string; t: string; x: string }>
  const h = createHash('sha256')
  for (const r of rows) h.update(`${r.s}${r.t}${r.x}`)
  return h.digest('hex')
}

/**
 * The OBSERVED side coherence actually diffs = this character's ARC REDUCTION (window summaries + arc-event
 * deltas) through the checkpoint — NOT raw dialogue, which the pass never reads (coherence.ts observedText:
 * "a reduction, never raw dialogue"). Keying staleness on THIS instead of dialogueDigest is Slice 3 of
 * internal/analysis-components.md: a cosmetic reformat of a character's lines that leaves the extracted arc
 * unchanged no longer re-stales their coherence. SOUND because the verdict is a function of the arc, not the
 * prose — and the profile rollup is itself a pure function of these windows+events, so it's covered too.
 */
function observedArcDigest(db: DatabaseType.Database, entityId: string, cutoff: number): string {
  const windows = db
    .prepare(
      `SELECT cw.chapter_id AS c, cw.summary AS s
         FROM character_windows cw
        WHERE cw.entity_id = ?
          AND EXISTS (SELECT 1 FROM narrative_units u JOIN unit_order o ON o.unit_id = u.unit_id
                       WHERE u.parent_id = cw.chapter_id AND u.type = 'scene' AND o.linear_pos <= ?)
        ORDER BY cw.chapter_id`
    )
    .all(entityId, cutoff)
  const events = db
    .prepare(
      `SELECT eae.event_type AS t, eae.category AS cat, eae.change AS ch, eae.value AS v, eae.description AS d
         FROM entity_arc_events eae JOIN unit_order o ON o.unit_id = eae.unit_id
        WHERE eae.entity_id = ? AND o.linear_pos <= ?
        ORDER BY o.linear_pos, eae.event_id`
    )
    .all(entityId, cutoff)
  return createHash('sha256').update(JSON.stringify({ windows, events })).digest('hex')
}

/** The entity's authored page bytes (the "declared" truth a diff is measured against) — ANY world category
 *  folder (characters/items/factions/…), since entity coherence diffs paged things too. */
function entityPageBytes(workRoot: string, entityId: string): Buffer | null {
  const world = join(workRoot, 'content', 'world')
  if (!existsSync(world)) return null
  for (const folder of readdirSync(world, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue
    const dir = join(world, folder.name)
    // Fast path: file named for the id; else scan for a frontmatter id match (mirrors ingest).
    const direct = join(dir, `${entityId}.md`)
    if (existsSync(direct)) return readFileSync(direct)
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md') || /^readme/i.test(f)) continue
      const raw = readFileSync(join(dir, f))
      try {
        if (String(matter(raw.toString('utf8')).data.id ?? '') === entityId) return raw
      } catch {
        /* skip unparseable */
      }
    }
  }
  return null
}

/** Max linear_pos among a chapter window's direct scene children (the diff cutoff). */
function windowCutoff(db: DatabaseType.Database, chapterUnitId: string): number {
  const r = db
    .prepare(
      `SELECT MAX(o.linear_pos) AS m
         FROM narrative_units u JOIN unit_order o ON o.unit_id = u.unit_id
        WHERE u.parent_id = ? AND u.type = 'scene'`
    )
    .get(chapterUnitId) as { m: number | null }
  return r?.m ?? Number.MAX_SAFE_INTEGER
}

/**
 * Recompute the engine-owned input hash for one tier target. Open DB read-only is fine
 * (no writes); callers that already hold a handle pass it to avoid reopening.
 */
export function tierInputHash(
  workRoot: string,
  kind: TierKind,
  targetId: string,
  asOf: string | null,
  dbIn?: DatabaseType.Database
): string {
  const own = !dbIn
  const db = dbIn ?? openDb(dbPathFor(workRoot))
  // Every recipe is WRAPPED with the prompt version: a prompt upgrade re-stales everything exactly once
  // (deliberate — otherwise improvements only reach targets whose inputs happen to change). The version is
  // KIND-adjusted (analysisPromptVersion) so switching a project fiction↔non-fiction re-stales its analysis
  // (the prompts differ) — fiction keeps the bare version, so existing projects don't re-run.
  const promptV = analysisPromptVersion(loadProjectInfo(workRoot).domain)
  const versioned = (inner: string): string => createHash('sha256').update(promptV).update(inner).digest('hex')
  try {
    if (kind === 'digest') {
      // Digest staleness lives with the rollups module (children digests + version — already versioned there).
      return digestInputs(workRoot, targetId).inputHash
    }
    if (kind === 'profile') {
      // targetId encodes "entityId|chapterId" (a chain link); hash = prev profile + this chapter's evidence.
      const [eid, chapter] = targetId.split('|')
      return profileInputs(workRoot, eid, chapter ?? '').inputHash
    }
    if (kind === 'scene') {
      // The scene's dialogue + its ANCESTOR-SET under the active tree variant (T4, ancestry-scoped staleness):
      // a scene's story-so-far context = its graph-ancestors, so folding them in re-stales a scene EXACTLY when
      // its ancestry changes (a tree edit upstream, or switching to a variant that wires it differently) — not on
      // every graph edit. Ancestor CONTENT changes still flow through the scene's own dialogue hash + re-runs.
      const scenes = db.prepare(`SELECT unit_id AS id, metadata_json FROM narrative_units WHERE type = 'scene'`).all() as Array<{ id: string; metadata_json: string | null }>
      const ancestors = graphAncestors(activeTreeEdges(workRoot, scenes), targetId).join(',')
      return versioned(createHash('sha256').update(dialogueDigest(db, 'd.unit_id = ?', [targetId])).update(ancestors).digest('hex'))
    }
    if (kind === 'window') {
      // This character's dialogue within the window's (chapter's) scenes.
      return versioned(dialogueDigest(
        db,
        `d.speaker_id = ? AND d.unit_id IN
           (SELECT unit_id FROM narrative_units WHERE parent_id = ? AND type='scene')`,
        [targetId, asOf]
      ))
    }
    // coherence: the declared .md bytes + this character's OBSERVED ARC (window summaries + arc-event deltas)
    // through the checkpoint — NOT raw dialogue, which the pass never reads (analysis-components.md Slice 3). So a
    // cosmetic reformat of the character's lines that leaves the extracted arc unchanged no longer re-stales
    // coherence; a real arc change still does. Sound: the verdict is a function of the arc, not the prose.
    const cutoff = asOf ? windowCutoff(db, asOf) : Number.MAX_SAFE_INTEGER
    const page = entityPageBytes(workRoot, targetId)
    return versioned(createHash('sha256')
      .update(page ?? Buffer.alloc(0))
      .update(currentVersion(workRoot) ?? '') // belt-and-suspenders: a FULL re-analysis restales coherence too (arc digest already catches targeted arc changes)
      .update(COHERENCE_LOGIC_VERSION) // coherence-only: a change to the prompt/observed builder / this recipe re-stales coherence (not the whole analysis)
      .update(observedArcDigest(db, targetId, cutoff))
      .digest('hex'))
  } finally {
    if (own) db.close()
  }
}

// ── writeTier ──────────────────────────────────────────────────────────────────

const J = (v: unknown): string | null => (v == null ? null : JSON.stringify(v))

function fail(runId: string, error: string): TierWriteResult {
  return { ok: false, runId, written: {}, rebuilt: [], error }
}

/** Validate the payload shape/enums before any DB work (all-or-nothing, friendly errors). */
function validate(p: TierWrite): string | null {
  if (p.kind === 'scene') {
    for (const b of p.rows.threads) {
      if (!b.threadId) return 'thread beat missing threadId'
      if (!THREAD_ACTIONS.has(b.action)) return `bad thread action "${b.action}"`
    }
  } else if (p.kind === 'window') {
    if (!p.asOfUnitId) return 'window pass requires asOfUnitId (the chapter window)'
    // Shape-only here; the change/facet ENUMS are category-specific (item vs faction vs character) and need the
    // target entity's type, so they're checked in applyWrite where the DB is open (validateWindowVocab).
    for (const e of p.rows.arcEvents) {
      if (!e.category || !e.value) return 'arc event missing category/value'
    }
  } else {
    if (!p.asOfUnitId) return `${p.kind} pass requires asOfUnitId (the checkpoint)`
    const allowed = p.kind === 'continuity' ? CONTINUITY_SET : FIDELITY_SET
    for (const f of p.rows.findings) {
      if (!allowed.has(f.kind)) return `bad ${p.kind} kind "${f.kind}"`
      if (!SEVERITIES.has(f.severity)) return `bad severity "${f.severity}"`
    }
  }
  return null
}

function entityExists(db: DatabaseType.Database, id: string | null): boolean {
  if (!id) return true
  return !!db.prepare('SELECT 1 FROM entities WHERE entity_id = ?').get(id)
}
function unitExists(db: DatabaseType.Database, id: string | null): boolean {
  if (!id) return true
  return !!db.prepare('SELECT 1 FROM narrative_units WHERE unit_id = ?').get(id)
}

/**
 * Build a normalizer that maps evidence refs → canonical unit_ids that EXIST in narrative_units: a scene/
 * chapter unit-id (exact), a "c:"/"s:"-prefixed form, or a bare chapter NAME (matched by path/colon tail,
 * e.g. "005-act-v" → "c:chapters/005-act-v"). Unresolvable refs are DROPPED — so evidence_json, the one
 * reference the schema doesn't FK-enforce, can never persist a non-canonical id for the reader to rescue.
 * Fetches the unit set once; the returned fn is reused across a coherence batch.
 */
function canonicalizeRefs(db: DatabaseType.Database): (refs: string[] | null | undefined) => string[] {
  const units = (db.prepare('SELECT unit_id FROM narrative_units').all() as { unit_id: string }[]).map((r) => r.unit_id)
  return (refs) => canonicalizeUnitRefs(units, refs) // pure resolver (unitRefs.ts) — fetch once, reuse per batch
}

/** Fold a thread umbrella's cached status from its full beat log (005: status is a reduction). */
export function refoldThread(db: DatabaseType.Database, threadId: string): void {
  const beats = db
    .prepare(
      `SELECT subject, action, scene_id, sort_pos
         FROM thread_events WHERE thread_id = ?
        ORDER BY COALESCE(sort_pos, 0)`
    )
    .all(threadId) as Array<{ subject: string | null; action: string; scene_id: string; sort_pos: number | null }>
  if (beats.length === 0) return
  // Per strand: latest terminal wins (resolve closes, a later reopen re-opens).
  const strands = new Map<string, { open: boolean; closeScene: string | null }>()
  let openScene: string | null = null
  for (const b of beats) {
    const key = b.subject ?? '\u0000' // no-subject sentinel — ESCAPED (a literal NUL byte here made ugrep treat the whole file as binary)
    if (!strands.has(key)) strands.set(key, { open: true, closeScene: null })
    const st = strands.get(key)!
    if (b.action === 'open') openScene ??= b.scene_id
    if (b.action === 'resolve' || b.action === 'supersede') { st.open = false; st.closeScene = b.scene_id }
    if (b.action === 'reopen') { st.open = true; st.closeScene = null }
  }
  const anyOpen = [...strands.values()].some((s) => s.open)
  // Latest close scene across strands, only meaningful when fully closed.
  const closeScene = anyOpen ? null : beats.filter((b) => b.action === 'resolve' || b.action === 'supersede').slice(-1)[0]?.scene_id ?? null
  db.prepare(
    `UPDATE narrative_threads
        SET status = ?, opened_unit_id = COALESCE(opened_unit_id, ?), closed_unit_id = ?
      WHERE thread_id = ?`
  ).run(anyOpen ? 'open' : 'closed', openScene, closeScene, threadId)
}

/**
 * Persist one inferred-tier target. Returns a result (never throws across IPC): ok:false
 * with an error on validation/DB failure, leaving the DB untouched (transactional).
 */
export function writeTier(workRoot: string, workId: string, p: TierWrite): TierWriteResult {
  const asOf = p.asOfUnitId ?? null
  const runId = runIdFor(p.tier, p.kind, p.targetId, asOf)
  if (!p.model) return fail(runId, 'missing model (producer id)')
  if (!p.inputHash) return fail(runId, 'missing inputHash')
  const vErr = validate(p)
  if (vErr) return fail(runId, vErr)

  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return fail(runId, 'no analysis DB yet — run T1 ingest first')
  const db = openDb(dbPath)
  const now = new Date().toISOString()
  const written: Record<string, number> = {}
  const rebuilt: string[] = []
  try {
    // THIRD-BUCKET guard: a discovered thing's category must be one of the project structure's enabled tracked
    // categories — the producer classifies into the author's enum, it never invents one (open-taxonomy.md).
    if (p.kind === 'scene') {
      const things = p.rows.extracted.things ?? []
      if (things.length > 0) {
        const allowed = new Set(readStructure(workRoot).world.filter((c) => c.tracked).map((c) => c.key))
        for (const t of things) {
          if (!t.name?.trim()) return fail(runId, 'thing missing name')
          if (!allowed.has(t.category)) return fail(runId, `thing "${t.name}": category "${t.category}" not in the enabled structure (${[...allowed].join(', ')})`)
        }
      }
    }

    // FK pre-checks (friendlier than a raw SQLITE constraint error).
    if (p.kind === 'scene' && !unitExists(db, p.targetId)) return fail(runId, `scene ${p.targetId} not found`)
    if ((p.kind === 'window' || p.kind === 'coherence') && !entityExists(db, p.targetId)) return fail(runId, `entity ${p.targetId} not found`)
    if (asOf && !unitExists(db, asOf)) return fail(runId, `checkpoint unit ${asOf} not found`)
    if (p.kind === 'window') {
      const vocabErr = validateWindowVocab(db, p)
      if (vocabErr) return fail(runId, vocabErr)
    }

    db.transaction(() => {
      if (p.kind === 'scene') {
        const sid = p.targetId
        if (!entityExists(db, p.rows.extracted.pov)) throw new Error(`pov entity ${p.rows.extracted.pov} not found`)
        // Per-variant threads: stamp this scene's thread_events with its ancestor-set hash under the ACTIVE variant,
        // and scope the delete to THAT ancestry (+ legacy NULL) so re-analyzing under variant B doesn't wipe variant
        // A's thread rows for the same scene (per-variant-analysis.md). extracted_scenes/lore are graph-independent.
        const sceneRows = db.prepare(`SELECT unit_id AS id, metadata_json FROM narrative_units WHERE type = 'scene'`).all() as Array<{ id: string; metadata_json: string | null }>
        const ancestryHash = sceneAncestryHash(workRoot, sceneRows, sid)
        db.prepare('DELETE FROM extracted_scenes WHERE scene_id = ?').run(sid)
        db.prepare('DELETE FROM thread_events     WHERE scene_id = ? AND (ancestry_hash = ? OR ancestry_hash IS NULL)').run(sid, ancestryHash)
        db.prepare('DELETE FROM lore_updates      WHERE scene_id = ?').run(sid)

        const e = p.rows.extracted
        db.prepare(
          `INSERT INTO extracted_scenes
             (scene_id, work_id, summary, premise, conclusion, pov, characters_json, locations_json, plot_times_json,
              goals_json, conflicts_json, enters_json, exits_json, scene_contexts_json,
              input_hash, model, created_at)
           VALUES (@scene_id,@work_id,@summary,@premise,@conclusion,@pov,@characters,@locations,@plot_times,
                   @goals,@conflicts,@enters,@exits,@contexts,@input_hash,@model,@created_at)`
        ).run({
          scene_id: sid, work_id: workId, summary: e.summary ?? null, premise: e.premise ?? null, conclusion: e.conclusion ?? null, pov: e.pov ?? null,
          characters: J(e.characters), locations: J(e.locations), plot_times: J(e.plotTimes),
          goals: J(e.goals), conflicts: J(e.conflicts), enters: J(e.enters), exits: J(e.exits),
          contexts: J(e.sceneContexts), input_hash: p.inputHash, model: p.model, created_at: now
        })
        written.extracted_scenes = 1

        const insBeat = db.prepare(
          `INSERT INTO thread_events
             (event_id, work_id, thread_id, subject, action, scene_id, sort_pos, evidence, confidence, description, created_at, ancestry_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        const upUmbrella = db.prepare(
          `INSERT INTO narrative_threads
             (thread_id, work_id, description, thread_type, opened_unit_id, closed_unit_id, status, built_by, resolution_condition, succeeds, title)
           VALUES (?,?,?,?,?,NULL,'open',?,?,?,?)
           ON CONFLICT(thread_id) DO UPDATE SET
             description=COALESCE(excluded.description, narrative_threads.description),
             thread_type=COALESCE(excluded.thread_type, narrative_threads.thread_type),
             built_by=COALESCE(excluded.built_by, narrative_threads.built_by),
             resolution_condition=COALESCE(excluded.resolution_condition, narrative_threads.resolution_condition),
             succeeds=COALESCE(excluded.succeeds, narrative_threads.succeeds),
             title=COALESCE(excluded.title, narrative_threads.title)`
        )
        const touched = new Set<string>()
        let i = 0
        for (const b of p.rows.threads) {
          const u = b.umbrella
          if (u) upUmbrella.run(b.threadId, workId, u.description, u.threadType ?? null, sid, u.builtBy ?? null, u.resolutionCondition ?? null, u.succeeds ?? null, u.title ?? null)
          // Only an OPEN beat (carrying an umbrella) may create a thread. An advance/close that names a
          // thread which was never opened is a dangling reference — drop it rather than stub a phantom
          // umbrella stamped with THIS (wrong) scene as the opener.
          if (!u && !db.prepare('SELECT 1 FROM narrative_threads WHERE thread_id = ?').get(b.threadId)) continue
          // event_id carries the ancestry prefix so the SAME scene's beats under different variants don't collide on PK.
          insBeat.run(`${sid}:${ancestryHash.slice(0, 8)}:${i++}`, workId, b.threadId, b.subject ?? null, b.action, sid, b.sortPos ?? null, b.evidence ?? null, b.confidence ?? null, b.description ?? null, now, ancestryHash)
          touched.add(b.threadId)
        }
        written.thread_events = i

        const insLore = db.prepare(
          `INSERT INTO lore_updates (update_id, work_id, lore_id, scene_id, summary, magnitude, built_by, input_hash, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
        let li = 0
        for (const l of p.rows.lore) insLore.run(`${sid}:lore:${li++}`, workId, l.loreId, sid, l.summary, l.magnitude ?? null, l.builtBy ?? null, p.inputHash, now)
        written.lore_updates = p.rows.lore.length

        // THIRD BUCKET — discovered things (items · factions · …): resolve each by name/alias against the
        // existing entities (authored pages included, so "Elsinore" merges into the authored location, not a
        // dupe); unresolved names CREATE a typed entity. Presence lands as role 'mentioned' (scoped-replace per
        // scene; OR IGNORE keeps a T1 'speaker' row when both exist). Entities accrete — re-runs re-resolve.
        db.prepare(`DELETE FROM entity_presence WHERE unit_id = ? AND role = 'mentioned'`).run(sid)
        const things = e.things ?? []
        if (things.length > 0) {
          // Punctuation/article-insensitive key so "Yorick's skull" merges with the authored `yorick-s-skull`
          // and "the poisoned cup" with "poisoned cup" — the resolve is by MEANINGFUL characters, not spelling.
          // Variant-aware resolution (@shared/entityNames): a bilingual/CJK thing name resolves to the EXISTING
          // entity instead of minting a duplicate. The old ASCII-only normalize dropped all CJK ("劉備" → "") so
          // every Chinese thing collided or duplicated. The id-slug uses the shared nameToId (keeps CJK + marks).
          const byName = new Map<string, string>()
          for (const r of db.prepare('SELECT entity_id, name, aliases_json FROM entities').all() as Array<{ entity_id: string; name: string; aliases_json: string | null }>) {
            let aliases: string[] = []
            try { aliases = r.aliases_json ? (JSON.parse(r.aliases_json) as string[]).map(String) : [] } catch { /* keep name/id */ }
            for (const v of entityNameVariants({ id: r.entity_id, name: r.name, aliases })) if (!byName.has(v)) byName.set(v, r.entity_id)
          }
          const insEntity = db.prepare('INSERT INTO entities (entity_id, work_id, type, name, aliases_json, significance) VALUES (?,?,?,?,NULL,?)')
          const insPres = db.prepare(`INSERT OR IGNORE INTO entity_presence (entity_id, unit_id, role) VALUES (?, ?, 'mentioned')`)
          // Finally populate the name_resolution cache (raw extracted name → entity id) — it was dead schema.
          const insNameRes = db.prepare(`INSERT OR IGNORE INTO name_resolution (work_id, raw_name, kind, entity_id, confidence, method, created_at) VALUES (?,?,?,?,1.0,?,datetime('now'))`)
          let created = 0
          for (const t of things) {
            const name = t.name.trim()
            let eid = byName.get(nameKey(name))
            let method = 'variant'
            if (!eid) {
              const base = nameToId(name) || 'entity'
              eid = base
              for (let n = 2; db.prepare('SELECT 1 FROM entities WHERE entity_id = ?').get(eid); n++) eid = `${base}-${n}`
              insEntity.run(eid, workId, t.category, name, t.significance ?? null)
              for (const v of entityNameVariants({ id: eid, name })) if (!byName.has(v)) byName.set(v, eid)
              created++
              method = 'mint'
            }
            insNameRes.run(workId, name, t.category, eid, method)
            insPres.run(eid, sid)
          }
          written.entities = created
          written.entity_presence = things.length
        }

        for (const tid of touched) { refoldThread(db, tid); rebuilt.push(tid) }
      } else if (p.kind === 'window') {
        const eid = p.targetId, chapter = asOf!
        db.prepare('DELETE FROM character_windows WHERE entity_id = ? AND chapter_id = ?').run(eid, chapter)
        db.prepare('DELETE FROM entity_arc_events WHERE entity_id = ? AND chapter_id = ?').run(eid, chapter)

        db.prepare(
          `INSERT INTO character_windows (entity_id, chapter_id, work_id, summary, input_hash, model, created_at)
           VALUES (?,?,?,?,?,?,?)`
        ).run(eid, chapter, workId, p.rows.window.summary ?? null, p.inputHash, p.model, now)
        written.character_windows = 1

        const hasTarget = (db.prepare("SELECT COUNT(*) c FROM pragma_table_info('entity_arc_events') WHERE name='target'").get() as { c: number }).c > 0
        const insArc = db.prepare(
          `INSERT INTO entity_arc_events
             (event_id, entity_id, unit_id, event_type, description, metadata_json, category, change, value, chapter_id${hasTarget ? ', target, secret_id' : ''})
           VALUES (?,?,?,?,?,NULL,?,?,?,?${hasTarget ? ',?,?' : ''})`
        )
        let ai = 0
        for (const a of p.rows.arcEvents) {
          if (!unitExists(db, a.sceneId)) throw new Error(`arc event scene ${a.sceneId} not found`)
          // Knowledge semantics (014) are secret-category only; expose may say WHO it got out to.
          if (a.secret && a.category !== 'secret') throw new Error(`arc event secret citation only valid on category 'secret' (got '${a.category}')`)
          if (a.target && a.category !== 'secret' && a.category !== 'custody') throw new Error(`arc event target only valid on category 'secret' or 'custody' (got '${a.category}')`)
          if (a.target && a.category === 'secret' && a.change !== 'expose') throw new Error(`arc event target only valid on change 'expose' (gain's learner IS the owner)`)
          if (a.target && a.target !== 'public' && !entityExists(db, a.target)) throw new Error(`arc event target '${a.target}' is not 'public' or a known entity`)
          const base = [`${eid}:${chapter}:${ai++}`, eid, a.sceneId, a.category, a.description, a.category, a.change, a.value, chapter]
          // event_type = category for back-compat (003).
          insArc.run(...(hasTarget ? [...base, a.target ?? null, a.secret ?? null] : base))
        }
        written.entity_arc_events = p.rows.arcEvents.length
      } else if (p.kind === 'coherence') {
        const eid = p.targetId, checkpoint = asOf!
        // App model = ONE whole-story diff per character. Replace ALL of this entity's character-coherence
        // findings (any checkpoint), not just this checkpoint's — so a shifted checkpoint or a prior producer
        // can't leave a parallel copy (the source of the "same contradiction twice" dupes). Only FIDELITY_KINDS —
        // Continuity findings (whole-story) + quest-verdict findings share the table and must never be touched here.
        db.prepare(`DELETE FROM coherence_findings WHERE entity_id = ? AND kind IN (${FIDELITY_DELETE})`).run(eid)
        const hasWhy = (db.prepare("SELECT COUNT(*) c FROM pragma_table_info('coherence_findings') WHERE name='why'").get() as { c: number }).c > 0
        const hasSecret = (db.prepare("SELECT COUNT(*) c FROM pragma_table_info('coherence_findings') WHERE name='secret_id'").get() as { c: number }).c > 0
        const cols = `finding_id, work_id, entity_id, as_of_unit_id, trait, declared, observed, kind, severity, suggestion, evidence_json, input_hash, model, created_at${hasWhy ? ', why' : ''}${hasSecret ? ', secret_id' : ''}`
        const ph = `?,?,?,?,?,?,?,?,?,?,?,?,?,?${hasWhy ? ',?' : ''}${hasSecret ? ',?' : ''}`
        const ins = db.prepare(`INSERT INTO coherence_findings (${cols}) VALUES (${ph})`)
        // evidence_json is the ONE reference the schema doesn't FK-enforce — canonicalize it on write so it
        // can never persist a non-canonical ref (a chapter NAME, a mismatched id) for the reader to rescue.
        const canon = canonicalizeRefs(db)
        let fi = 0
        for (const f of p.rows.findings) {
          const base = [`${eid}:${checkpoint}:${fi++}`, workId, eid, checkpoint, f.trait, f.declared, f.observed, f.kind, f.severity, f.suggestion, J(canon(f.evidence)), p.inputHash, p.model, now]
          if (hasWhy) base.push(f.why ?? null)
          if (hasSecret) base.push(f.secret ?? null)
          ins.run(...base)
        }
        written.coherence_findings = p.rows.findings.length
      } else {
        // CONTINUITY (plot-holes) — WHOLE-STORY replace (internal/continuity-coherence.md). Unlike the per-entity
        // Fidelity diff, one pass covers the whole story, so we replace ALL continuity findings by KIND family (never
        // touching Fidelity or quest findings). entity_id is nullable (a cross-cutting hole owns no entity); the
        // finding_id is prefixed `continuity:<kind>:` so the family is self-evident from the id.
        const checkpoint = asOf!
        db.prepare(`DELETE FROM coherence_findings WHERE work_id = ? AND kind IN (${CONTINUITY_DELETE})`).run(workId)
        const hasWhy = (db.prepare("SELECT COUNT(*) c FROM pragma_table_info('coherence_findings') WHERE name='why'").get() as { c: number }).c > 0
        const hasSecret = (db.prepare("SELECT COUNT(*) c FROM pragma_table_info('coherence_findings') WHERE name='secret_id'").get() as { c: number }).c > 0
        const cols = `finding_id, work_id, entity_id, as_of_unit_id, trait, declared, observed, kind, severity, suggestion, evidence_json, input_hash, model, created_at${hasWhy ? ', why' : ''}${hasSecret ? ', secret_id' : ''}`
        const ph = `?,?,?,?,?,?,?,?,?,?,?,?,?,?${hasWhy ? ',?' : ''}${hasSecret ? ',?' : ''}`
        const ins = db.prepare(`INSERT INTO coherence_findings (${cols}) VALUES (${ph})`)
        const canon = canonicalizeRefs(db)
        let fi = 0
        for (const f of p.rows.findings) {
          const fid = `continuity:${f.kind}:${fi++}`
          const base = [fid, workId, f.entityId ?? null, checkpoint, f.trait, f.declared, f.observed, f.kind, f.severity, f.suggestion, J(canon(f.evidence)), p.inputHash, p.model, now]
          if (hasWhy) base.push(null)
          if (hasSecret) base.push(null)
          ins.run(...base)
        }
        written.coherence_findings = p.rows.findings.length
      }

      // The staleness ledger goes live: one run row per target (REPLACE = idempotent rerun).
      // depth: only scene runs carry it ('skim' fast-mode vs 'full'); an expert plan re-stales skim rows.
      const depth = p.kind === 'scene' ? (p.depth ?? 'full') : null
      db.prepare(
        `INSERT INTO inference_runs (run_id, tier, kind, target_id, as_of_unit_id, input_hash, model, created_at, depth)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(run_id) DO UPDATE SET input_hash=excluded.input_hash, model=excluded.model, created_at=excluded.created_at, depth=excluded.depth`
      ).run(runId, p.tier, p.kind, p.targetId, asOf, p.inputHash, p.model, now, depth)
    })()

    return { ok: true, runId, written, rebuilt }
  } catch (err) {
    // Carry the STACK out (not just `.message`) so the runner can persist it to the auditable telemetry
    // log — "Too many parameter values were provided" names no statement, but its stack names the line.
    return { ok: false, runId, written: {}, rebuilt: [], error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }
  } finally {
    db.close()
  }
}

// ── The tracer: scene-pass fresh/stale/pending (the Ingest dock tab) ────────────

/** "od-c1-s1" → "A1·S1"; null when it doesn't parse. */
function sceneCode(unitId: string): string | null {
  const m = unitId.match(/c(\d+)-s(\d+)/i)
  return m ? `A${m[1]}·S${m[2]}` : null
}

/**
 * Every scene's T2 status, derived from the staleness DAG (NOT input_hash equality — a prior
 * producer may have hashed differently): pending = no run; stale = the file was re-ingested
 * after the run; fresh = otherwise. Canon (`phase`) is reported for the UI to gate on.
 */
export function tierStatus(workRoot: string): TierStatusRow[] {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return []
  const db = openReadonly(dbPath)
  try {
    const rows = db
      .prepare(
        `SELECT u.unit_id AS unitId, u.title AS title,
                json_extract(u.metadata_json,'$.phase') AS phase,
                r.created_at  AS lastRun,
                r.depth       AS depth,
                sf.ingested_at AS ingestedAt,
                o.linear_pos  AS pos
           FROM narrative_units u
           LEFT JOIN inference_runs r ON r.run_id = 't2:scene:' || u.unit_id
           LEFT JOIN source_files   sf ON sf.unit_id = u.unit_id
           LEFT JOIN unit_order     o ON o.unit_id = u.unit_id
          WHERE u.type = 'scene'
          ORDER BY o.linear_pos`
      )
      .all() as Array<{ unitId: string; title: string; phase: string | null; lastRun: string | null; depth: string | null; ingestedAt: string | null; pos: number }>
    return rows.map((r) => ({
      unitId: r.unitId,
      code: sceneCode(r.unitId),
      title: r.title,
      phase: r.phase,
      lastRun: r.lastRun,
      depth: r.lastRun ? ((r.depth ?? 'full') as 'skim' | 'full') : null, // pre-depth rows are full extractions
      status: !r.lastRun ? 'pending' : r.ingestedAt && r.ingestedAt > r.lastRun ? 'stale' : 'fresh'
    }))
  } finally {
    db.close()
  }
}

// ── Bundles: apply an agent's / hand-authored JSON output through writeTier ──────

/** A bundle entry is a TierWrite without inputHash — the engine stamps the hash at apply time. */
type BundleEntry = Omit<Extract<TierWrite, { tier: 't2' | 't3' }>, 'inputHash'>

function ingestDir(workRoot: string): string {
  return join(workRoot, '.nvs', 'ingest')
}

export function listIngestBundles(workRoot: string): string[] {
  const dir = ingestDir(workRoot)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
}

/**
 * Apply one bundle: parse the entries, compute each input hash with the engine recipe, and
 * write each through writeTier. Engine-computed hash = no producer/detector drift. Returns one
 * result per entry (a bad entry fails alone; the rest still apply — each writeTier is its own txn).
 */
function parseBundle(workRoot: string, name: string): BundleEntry[] {
  const file = join(ingestDir(workRoot), `${name}.json`)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

/** Apply ONE bundle entry — the engine stamps the hash, then writes through writeTier. Extracted so the
 *  Phase-2 runner can drive entries one at a time with progress between them. */
export function applyEntry(workRoot: string, workId: string, e: BundleEntry): TierWriteResult {
  // tierInputHash runs OUTSIDE writeTier's try — a crash here (e.g. a bind overflow in the hash query) would
  // escape as an uncaught throw. Catch it so it becomes a normal fail-with-stack the runner can persist.
  let inputHash: string
  try {
    inputHash = tierInputHash(workRoot, e.kind, e.targetId, e.asOfUnitId ?? null)
  } catch (err) {
    return { ok: false, runId: runIdFor(e.tier, e.kind, e.targetId, e.asOfUnitId ?? null), written: {}, rebuilt: [], error: `input-hash failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : undefined }
  }
  return writeTier(workRoot, workId, { ...e, inputHash } as TierWrite)
}

export function runIngestBundle(workRoot: string, workId: string, name: string): TierWriteResult[] {
  if (!existsSync(join(ingestDir(workRoot), `${name}.json`))) return [{ ok: false, runId: '', written: {}, rebuilt: [], error: `bundle ${name}.json not found` }]
  const entries = parseBundle(workRoot, name)
  if (entries.length === 0) return [{ ok: false, runId: '', written: {}, rebuilt: [], error: 'bad or empty bundle JSON' }]
  return entries.map((e) => applyEntry(workRoot, workId, e))
}

// ── Ingest run: plan → per-step apply → snapshot/revert → session log (Phase 2 runner support) ──

/** A planned step plus the entry that fulfils it (null = nothing to apply yet — the in-app reader is Phase 3). */
export interface PlanItem {
  step: IngestStep
  entry: BundleEntry | null
}

/**
 * Plan a run: every staged bundle entry becomes a real step, and every still-outdated canon scene NOT
 * covered by a bundle becomes a `skipped` step (honest — it shows on the queue but has no source to apply
 * until the reader exists). The renderer only ever sees `IngestStep`; the `entry` stays main-side.
 *
 * `forceScenes` re-reads chosen scenes even when they're FRESH — the manual "re-analyze these" path (e.g.
 * after switching to a faster model), so the author doesn't have to fake-edit files to invalidate them.
 */
export function planIngestSteps(workRoot: string, forceScenes: string[] = [], depth: 'skim' | 'full' = 'full'): PlanItem[] {
  const status = tierStatus(workRoot)
  const forced = new Set(forceScenes)
  const labelOf = new Map(status.map((r) => [r.unitId, [r.code, r.title].filter(Boolean).join(' · ') || r.unitId]))
  const items: PlanItem[] = []
  const coveredScenes = new Set<string>()

  for (const name of listIngestBundles(workRoot)) {
    for (const e of parseBundle(workRoot, name)) {
      const id = runIdFor(e.tier, e.kind, e.targetId, e.asOfUnitId ?? null)
      const label = e.kind === 'scene' ? (labelOf.get(e.targetId) ?? e.targetId) : `${e.kind}: ${e.targetId}`
      items.push({ step: { id, kind: e.kind, targetId: e.targetId, label, status: 'pending', note: null, startedAt: null, ms: null }, entry: e })
      if (e.kind === 'scene') coveredScenes.add(e.targetId)
    }
  }

  for (const r of status) {
    // Asymmetric depth freshness: an EXPERT plan re-reads fresh-but-skim scenes (full ⊃ skim); a FAST plan
    // accepts either depth (a full extraction already contains everything a skim would).
    const skimUpgrade = depth === 'full' && r.status === 'fresh' && r.depth === 'skim'
    const want = r.status === 'stale' || r.status === 'pending' || skimUpgrade || forced.has(r.unitId)
    if (want && (!r.phase || r.phase === 'canon') && !coveredScenes.has(r.unitId)) {
      items.push({
        step: { id: runIdFor('t2', 'scene', r.unitId, null), kind: 'scene', targetId: r.unitId, label: labelOf.get(r.unitId) ?? r.unitId, status: 'pending', note: null, startedAt: null, ms: null },
        entry: null
      })
    }
  }

  // Window/arc pass — one step per chapter, AFTER the scene steps (it rolls up the fresh extractions).
  // Targets: chapters whose scenes are being re-read this run, PLUS chapters that have extractions but no
  // arcs yet (first-run backfill, so the Character-arcs rail un-deads). targetId = the chapter unit.
  // FAST mode plans NO windows/profiles: skim extractions lack the evidence (goals/conflicts/enters/exits)
  // arcs are built from — thin-evidence arcs read as noise. The expert run that upgrades the skim scenes
  // brings the rollups with it naturally (re-read scenes → their chapters land here).
  const dbPath = dbPathFor(workRoot)
  if (depth === 'full' && existsSync(dbPath)) {
    const db = openReadonly(dbPath)
    try {
      const reread = new Set(items.filter((p) => p.step.kind === 'scene').map((p) => p.step.targetId))
      const chapterOf = db.prepare('SELECT parent_id AS c FROM narrative_units WHERE unit_id = ?')
      const chapters = new Map<string, string>() // chapterId → title
      const titleOf = db.prepare("SELECT title FROM narrative_units WHERE unit_id = ?")
      const note = (cid: string | null | undefined): void => {
        if (cid && !chapters.has(cid)) chapters.set(cid, (titleOf.get(cid) as { title?: string } | undefined)?.title ?? cid)
      }
      for (const sid of reread) note((chapterOf.get(sid) as { c?: string } | undefined)?.c)
      // backfill: chapters with extracted scenes but no character_windows
      for (const r of db
        .prepare(
          `SELECT DISTINCT u.parent_id AS c FROM narrative_units u
             JOIN extracted_scenes es ON es.scene_id = u.unit_id
            WHERE u.type='scene' AND u.parent_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM character_windows cw WHERE cw.chapter_id = u.parent_id)`
        )
        .all() as Array<{ c: string }>)
        note(r.c)
      for (const [cid, title] of chapters) {
        items.push({
          step: { id: runIdFor('t2', 'window', cid, null), kind: 'window', targetId: cid, label: `arcs · ${title}`, status: 'pending', note: null, startedAt: null, ms: null },
          entry: null
        })
      }
    } finally {
      db.close()
    }
  }
  // Profile chain pass (working-set M3) — per significant windowed character, per chapter link, IN CHAIN
  // ORDER (the runner keeps each character's links sequential; characters run in parallel). Steady state on a
  // long corpus: only the newest chapter's links are stale. targetId encodes "entity|chapter".
  if (depth === 'full') {
    const sig = significantEntityIds(workRoot)
    const upcoming = new Set(items.filter((p) => p.step.kind === 'window').map((p) => p.step.targetId))
    for (const l of profilePlan(workRoot, sig, upcoming)) {
      if (l.status === 'fresh') continue
      items.push({
        step: { id: runIdFor('t2', 'profile', `${l.entityId}|${l.chapterId}`, null), kind: 'profile', targetId: `${l.entityId}|${l.chapterId}`, label: `profile: ${l.name} · ${l.chapterTitle}`, status: 'pending', note: null, startedAt: null, ms: null },
        entry: null
      })
    }
  }

  // Digest reduce pass (working-set M2) — one step per stale REDUCIBLE unit (acts/parts/book: folder
  // children present), DEEPEST FIRST so parents consume children refreshed in this same run. Leaf-chapter
  // digests are free (derived, never planned). Runs after windows; failures don't block anything else.
  for (const d of digestPlan(workRoot)) {
    if (d.status === 'fresh') continue
    items.push({
      step: { id: runIdFor('t2', 'digest', d.unitId, null), kind: 'digest', targetId: d.unitId, label: `digest: ${d.title}`, status: 'pending', note: null, startedAt: null, ms: null },
      entry: null
    })
  }

  return items
}

function snapDir(workRoot: string): string {
  return join(workRoot, '.nvs', 'snapshots')
}
// Save slots: each session keeps a pre-run DB snapshot it can revert to. A naive "10 full DB copies" bloats a
// growing project LINEARLY (10 × a DB that itself grows → a multi-hundred-MB `.nvs/`), so two levers cut it:
//   (a) GZIP every snapshot on disk (`<id>.db.gz` — a VACUUM'd analysis DB packs ~3×), and
//   (b) TIERED retention — keep EVERY snapshot from the last day (dense recent revert), thin older ones to
//       one-per-calendar-day, hard-capped at KEEP_MAX.
// `nvs.db` is the one artifact rebuildable-from-prose, so trading cold-revert depth for disk is cheap. The
// session log holds KEEP_SESSIONS; a pruned snapshot's session survives but its Revert disables (see
// `snapshotAvailable`). Retention keys off the TIMESTAMP ENCODED IN THE ID, not file mtime — so compaction
// (which rewrites a file, resetting mtime) can never make an old snapshot look recent.
export const KEEP_MAX = 12 // hard cap on retained snapshot files
export const RECENT_MS = 24 * 60 * 60 * 1000 // keep EVERY snapshot from the last day; older thin to one-per-day
const KEEP_SESSIONS = 10
const SNAP_GZ = '.db.gz'

/** Parse the capture time out of a snapshot id (`2026-07-21T18-01-56-627Z__label`) → epoch ms, or 0 if malformed. */
export function snapTime(id: string): number {
  const m = id.split('__')[0].match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/)
  if (!m) return 0
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
  return Number.isNaN(t) ? 0 : t
}

/** Every snapshot on disk (new `.db.gz` + legacy raw `.db`) as {id, t}, newest first. */
function listSnaps(dir: string): { id: string; t: number }[] {
  if (!existsSync(dir)) return []
  const ids = new Set<string>()
  for (const f of readdirSync(dir)) {
    if (f.endsWith(SNAP_GZ)) ids.add(f.slice(0, -SNAP_GZ.length))
    else if (f.endsWith('.db')) ids.add(f.slice(0, -'.db'.length))
  }
  return [...ids].map((id) => ({ id, t: snapTime(id) })).sort((a, b) => b.t - a.t)
}

/** Does a snapshot exist for this id (compressed or legacy raw)? */
function snapshotExists(dir: string, id: string): boolean {
  return existsSync(join(dir, `${id}${SNAP_GZ}`)) || existsSync(join(dir, `${id}.db`))
}

/** Remove a snapshot entirely (compressed + legacy raw + any WAL sidecars) by id. */
function rmSnapshot(dir: string, id: string): void {
  for (const p of [`${id}${SNAP_GZ}`, `${id}.db`, `${id}.db-wal`, `${id}.db-shm`]) {
    const full = join(dir, p)
    if (existsSync(full)) rmSync(full)
  }
}

/**
 * A snapshot's complete DB bytes — gunzipping `<id>.db.gz`, or reading a legacy raw `<id>.db` (folding a
 * lingering `-wal` sidecar in first so the bytes are complete). null if the snapshot is gone (pruned).
 */
function readSnapshotBytes(dir: string, id: string): Buffer | null {
  const gz = join(dir, `${id}${SNAP_GZ}`)
  if (existsSync(gz)) return gunzipSync(readFileSync(gz))
  const raw = join(dir, `${id}.db`)
  if (!existsSync(raw)) return null
  if (existsSync(`${raw}-wal`)) {
    const sdb = openDb(raw)
    try {
      sdb.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      sdb.close()
    }
  }
  return readFileSync(raw)
}

/**
 * Content signature of a VACUUM'd DB, IGNORING the two volatile SQLite header fields — the file-change counter
 * (byte 24) and version-valid-for (byte 92) — which differ between two dumps of identical logical content.
 * Zeroing them lets a genuine no-op run be recognised as a duplicate; a REAL change alters content pages → a
 * different digest → a real snapshot. So skip-identical is never wrong the dangerous way.
 */
function snapshotSig(buf: Buffer): string {
  const b = Buffer.from(buf)
  if (b.length >= 96) {
    b.writeUInt32BE(0, 24)
    b.writeUInt32BE(0, 92)
  }
  return createHash('sha256').update(b).digest('hex')
}

/**
 * PURE tiered-retention decision — which snapshot ids to KEEP given the set on disk and the current time.
 * Every snapshot from the last day is kept (dense recent revert), older ones thin to one-per-calendar-day,
 * and the survivor set is hard-capped at KEEP_MAX (newest win). Keying off the id's encoded timestamp (`t`),
 * never file mtime, means compaction (which rewrites a file) can't make an old snapshot look recent.
 */
export function snapshotsToKeep(snaps: { id: string; t: number }[], now: number): Set<string> {
  const keep = new Set<string>()
  const seenDay = new Set<string>()
  for (const s of [...snaps].sort((a, b) => b.t - a.t)) {
    if (keep.size >= KEEP_MAX) break
    if (now - s.t < RECENT_MS) {
      keep.add(s.id) // dense: everything within the last day
      continue
    }
    const day = s.id.slice(0, 10) // YYYY-MM-DD prefix of the id timestamp
    if (!seenDay.has(day)) {
      seenDay.add(day)
      keep.add(s.id) // one per older calendar-day
    }
  }
  return keep
}

/** Tiered prune: keep every snapshot from the last day, one-per-day for older, hard-capped to KEEP_MAX newest. */
function pruneSnaps(dir: string): void {
  const snaps = listSnaps(dir)
  const keep = snapshotsToKeep(snaps, Date.now())
  for (const s of snaps) if (!keep.has(s.id)) rmSnapshot(dir, s.id)
}

/**
 * Compress any legacy raw `<id>.db` snapshots in place (→ `<id>.db.gz`), reclaiming disk left by pre-
 * compression runs. Idempotent: skips ids already compressed. Returns how much was freed. Exposed for a
 * one-click "compact" in the Storage tab; also run opportunistically on each new snapshot.
 */
export function compactSnapshots(workRoot: string): { freedBytes: number; compacted: number } {
  const dir = snapDir(workRoot)
  if (!existsSync(dir)) return { freedBytes: 0, compacted: 0 }
  let freedBytes = 0
  let compacted = 0
  for (const s of listSnaps(dir)) {
    const raw = join(dir, `${s.id}.db`)
    if (!existsSync(raw) || existsSync(join(dir, `${s.id}${SNAP_GZ}`))) continue // already gz, or not a raw file
    const bytes = readSnapshotBytes(dir, s.id) // folds any -wal
    if (!bytes) continue
    const before = statSync(raw).size
    writeFileSync(join(dir, `${s.id}${SNAP_GZ}`), gzipSync(bytes))
    for (const ext of ['.db', '.db-wal', '.db-shm']) {
      const f = join(dir, `${s.id}${ext}`)
      if (existsSync(f)) rmSync(f)
    }
    freedBytes += Math.max(0, before - statSync(join(dir, `${s.id}${SNAP_GZ}`)).size)
    compacted++
  }
  return { freedBytes, compacted }
}

/**
 * Snapshot the co-located DB to a pre-run save slot (path derived ONLY from workRoot — a snapshot can never
 * reach another project). The live DB runs in WAL mode (db.ts), so a raw file copy would miss the pages still
 * in the -wal sidecar; `VACUUM INTO` writes a single complete DB regardless of WAL state, which we then GZIP.
 * A no-op run (byte-identical content to the newest snapshot) reuses that snapshot. Returns the snapshot id,
 * or null if there's no DB yet.
 */
export function snapshotDb(workRoot: string, label: string): string | null {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return null
  const dir = snapDir(workRoot)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}__${label}`
  const tmp = join(dir, `.pending-${label}.tmp`)
  const db = openDb(dbPath)
  try {
    rmSync(tmp, { force: true }) // clear a stale temp left by a crashed prior run
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`) // complete, WAL-folded copy — no -wal/-shm to track
  } finally {
    db.close()
  }
  const bytes = readFileSync(tmp)
  rmSync(tmp, { force: true })
  // Skip-identical: a run that changed nothing yields the same content as the newest snapshot — reuse it.
  // (The runner already guards no-op runs via `ok > 0`; this is a cheap belt-and-braces against a rewrite
  // that touched rows but left content unchanged.)
  const newest = listSnaps(dir)[0]
  if (newest) {
    const prev = readSnapshotBytes(dir, newest.id)
    if (prev && snapshotSig(prev) === snapshotSig(bytes)) {
      compactSnapshots(workRoot)
      return newest.id
    }
  }
  writeFileSync(join(dir, `${id}${SNAP_GZ}`), gzipSync(bytes))
  compactSnapshots(workRoot) // fold any pre-compression legacy snapshots into `.gz`
  pruneSnaps(dir)
  return id
}

/**
 * Restore the live DB to a past version's snapshot and move the current pointer to it. Non-destructive: every
 * version IS its own snapshot, so any version (including the latest) is restorable — restoring is reversible
 * and nothing is lost. False if the version or its snapshot is gone.
 */
export function restoreVersion(workRoot: string, sessionId: string): boolean {
  const runs = loadRuns(workRoot)
  const s = runs.sessions.find((x) => x.id === sessionId)
  if (!s?.snapshotId) return false
  // readSnapshotBytes handles both shapes: gunzips a `.db.gz`, or reads a legacy raw `.db` (folding a WAL
  // sidecar in first). Writing the bytes straight to the live path replaces the DB atomically enough for our
  // single-process use — the live -wal/-shm are dropped just below so no stale frames replay over it.
  const bytes = readSnapshotBytes(snapDir(workRoot), s.snapshotId)
  if (!bytes) return false
  const live = dbPathFor(workRoot)
  writeFileSync(live, bytes)
  // The live -wal/-shm belong to the PRE-restore DB; leaving them lets SQLite replay stale frames over the
  // restored main → the data wouldn't match the version we just restored. Drop them for a clean next open.
  for (const ext of ['-wal', '-shm']) {
    const p = `${live}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  saveRuns(workRoot, { ...runs, current: sessionId })
  return true
}

function sessionsPath(workRoot: string): string {
  return join(workRoot, '.nvs', 'ingest-runs.json')
}

/** The run history as a version timeline: the ordered sessions + which one the live DB currently reflects
 *  (`current` = the "you are here" pointer, like git HEAD). Tolerates the legacy bare-array file. */
interface RunsFile {
  current: string | null
  sessions: IngestSession[]
}

function loadRuns(workRoot: string): RunsFile {
  const p = sessionsPath(workRoot)
  if (!existsSync(p)) return { current: null, sessions: [] }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    if (Array.isArray(raw)) return { current: raw[0]?.id ?? null, sessions: raw as IngestSession[] } // legacy
    return { current: raw.current ?? null, sessions: (raw.sessions ?? []) as IngestSession[] }
  } catch {
    return { current: null, sessions: [] }
  }
}

function saveRuns(workRoot: string, runs: RunsFile): void {
  const dir = join(workRoot, '.nvs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(sessionsPath(workRoot), JSON.stringify({ current: runs.current, sessions: runs.sessions.slice(0, KEEP_SESSIONS) }, null, 2))
}

export function listSessions(workRoot: string): IngestSession[] {
  const dir = snapDir(workRoot)
  // Stamp whether each session's snapshot file is STILL on disk — snapshots are pruned to the newest
  // KEEP_SNAPSHOTS, but the session record keeps its snapshotId forever, so the UI needs the real
  // availability to disable preview/restore on pruned versions instead of offering a dead click.
  return loadRuns(workRoot).sessions.map((s) => ({
    ...s,
    snapshotAvailable: !!s.snapshotId && snapshotExists(dir, s.snapshotId)
  }))
}

/** The version (session id) the live DB currently reflects — drives the "you are here" marker. */
export function currentVersion(workRoot: string): string | null {
  return loadRuns(workRoot).current
}

/**
 * Drop thread umbrellas left with no beats — a prior analysis's thread that a re-read didn't reproduce
 * (its per-scene `thread_events` were scope-deleted as each scene was rewritten, but the `narrative_threads`
 * umbrella row lingered). Safe for incremental runs: a thread whose beats live in a not-re-read scene still
 * has rows, so only genuinely beat-less umbrellas are removed. Run once after a full pass.
 */
export function pruneOrphanThreads(workRoot: string): number {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return 0
  const db = openDb(dbPath)
  try {
    return db
      .prepare('DELETE FROM narrative_threads WHERE thread_id NOT IN (SELECT DISTINCT thread_id FROM thread_events)')
      .run().changes
  } finally {
    db.close()
  }
}

/**
/**
 * Did this scene's CONTENT actually change since it was last analysed? Compares the current dialogue digest
 * to the input_hash recorded on its last run — deterministic, unlike the model's wobbling thread handles. We
 * cascade only when this is true (a real edit), so a pure re-read never ripples (no churn). True if never run.
 */
export function sceneInputChanged(workRoot: string, unitId: string): boolean {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return false
  const db = openReadonly(dbPath)
  try {
    const row = db.prepare('SELECT input_hash AS h FROM inference_runs WHERE run_id = ?').get(runIdFor('t2', 'scene', unitId, null)) as { h?: string } | undefined
    if (!row?.h) return true // never analysed → treat as changed
    return tierInputHash(workRoot, 'scene', unitId, null, db) !== row.h
  } finally {
    db.close()
  }
}

/**
 * Is this scene's CURRENT (pre-apply) extraction a SKIM read? Depth isn't in `input_hash` (so `sceneInputChanged`
 * can't see a skim→full upgrade — same dialogue, same hash), which is why an Expert pass that deepens an early
 * scene wouldn't otherwise cascade. Call this BEFORE applyEntry: a skim→full upgrade IS materially downstream
 * (full adds the things/lore grounding later scenes read as context), so the runner treats it like a real edit.
 */
export function sceneWasSkim(workRoot: string, unitId: string): boolean {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return false
  const db = openReadonly(dbPath)
  try {
    const row = db.prepare('SELECT depth AS d FROM inference_runs WHERE run_id = ?').get(runIdFor('t2', 'scene', unitId, null)) as { d?: string } | undefined
    return row?.d === 'skim'
  } finally {
    db.close()
  }
}

/**
 * Mark every scene after `unitId` Outdated — used when an EDITED scene's re-read could shift the downstream
 * story-so-far, so those readings can no longer be trusted. We bump their `source_files.ingested_at` past
 * their last run so the tracer reports them stale; the prior analysis stays as the (flagged) current value
 * until the author chooses to re-run. Returns how many scenes were flagged.
 */
export function markDownstreamStale(workRoot: string, unitId: string): number {
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath)) return 0
  const db = openDb(dbPath)
  try {
    return db
      .prepare(
        `UPDATE source_files SET ingested_at = ?
          WHERE unit_id IN (
            SELECT u.unit_id FROM narrative_units u JOIN unit_order o ON o.unit_id = u.unit_id
             WHERE u.type = 'scene'
               AND o.linear_pos > (SELECT linear_pos FROM unit_order WHERE unit_id = ?))`
      )
      .run(new Date().toISOString(), unitId).changes
  } finally {
    db.close()
  }
}

/**
 * Append a finished run to the history. An ANALYSIS run becomes the new `current` (the live DB's
 * story-state version). A COHERENCE run is a child of the current analysis version — it's logged, but it
 * does NOT move `current` (the spine stays on analysis; coherence rides on top, re-derivable).
 */
export function recordSession(workRoot: string, s: IngestSession): void {
  const runs = loadRuns(workRoot)
  const current = s.kind === 'coherence' ? runs.current : s.id
  saveRuns(workRoot, { current, sessions: [s, ...runs.sessions] })
}
