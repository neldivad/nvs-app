/**
 * Unit Ledger fold — RUNNER + persistence (fractal-consolidation.md, Slices 1–2 · Tier-1).
 *
 * Folds EVERY foldable unit of the story tree bottom-up into a content-addressed `rollups` row (`kind='ledger'`),
 * the same node store the digest fold uses — so ledger nodes inherit hierarchical staleness / Merkle re-fold:
 *   - a LEAF chapter (direct scene children) folds its scenes' thread_events (Slice 1),
 *   - a PARENT unit (act/book/part/…) folds its children's LEDGERS via `entriesToBeats` — the SAME
 *     `foldChapterLedger`, one level up (Slice 2). Recursion is level-agnostic: we walk the actual unit tree to
 *     whatever depth it has (no fixed level names), so a thread opened in one child and resolved in a later one
 *     closes at the parent — the long-arc payoff, recognized where both are visible.
 *
 * Deterministic (no AI): `refoldStaleChapterLedgers` re-folds every stale unit DEEPEST-FIRST in one call, free —
 * a leaf change re-folds the leaf, which changes the parent's flattened beats, which re-folds the parent, up the
 * path (Merkle cascade). Variant-scoping is deferred; single-variant projects are exact.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, openReadonly } from '@engine/data/db'
import { analysisPromptVersion } from '@shared/config/extraction'
import { loadProjectInfo } from '@engine/content/projectInfo'
import { foldChapterLedger, entriesToBeats, type ChapterFoldInput, type ThreadBeat, type ChapterLedger } from '@engine/analysis/chapterFold'

const LEDGER_KIND = 'ledger'
const dbPath = (workRoot: string): string => join(workRoot, '.nvs', 'nvs.db')
type Db = ReturnType<typeof openReadonly>
type UnitRow = { id: string; type: string; title: string | null; parent: string | null }

/** The unit tree + each unit's ordering position (earliest descendant scene's linear_pos), children pos-sorted. */
function loadTree(db: Db): { byId: Map<string, UnitRow>; childrenOf: Map<string, UnitRow[]>; posOf: Map<string, number> } {
  const rows = db.prepare(`SELECT unit_id AS id, type, title, parent_id AS parent FROM narrative_units`).all() as UnitRow[]
  const scenePos = new Map<string, number>()
  for (const r of db.prepare(`SELECT unit_id AS id, linear_pos AS pos FROM unit_order`).all() as { id: string; pos: number }[]) scenePos.set(r.id, r.pos)
  const byId = new Map<string, UnitRow>()
  for (const r of rows) byId.set(r.id, r)
  const childrenOf = new Map<string, UnitRow[]>()
  for (const r of rows) if (r.parent) (childrenOf.get(r.parent) ?? childrenOf.set(r.parent, []).get(r.parent)!).push(r)
  const posOf = new Map<string, number>()
  const compute = (id: string): number => {
    const cached = posOf.get(id)
    if (cached != null) return cached
    const u = byId.get(id)
    const p = u?.type === 'scene' ? scenePos.get(id) ?? Infinity : Math.min(Infinity, ...(childrenOf.get(id) ?? []).map((k) => compute(k.id)))
    posOf.set(id, p)
    return p
  }
  for (const r of rows) compute(r.id)
  for (const arr of childrenOf.values()) arr.sort((a, b) => (posOf.get(a.id) ?? Infinity) - (posOf.get(b.id) ?? Infinity))
  return { byId, childrenOf, posOf }
}

/** thread_events for the DIRECT scene children of a unit (leaf-chapter side of the fold). */
function directSceneBeats(db: Db, unitId: string): ThreadBeat[] {
  return db
    .prepare(
      `SELECT te.thread_id AS threadId, te.action AS action, o.linear_pos AS pos,
              COALESCE(te.description, '') AS description, te.subject AS subject, te.confidence AS confidence
         FROM thread_events te JOIN narrative_units s ON s.unit_id = te.scene_id JOIN unit_order o ON o.unit_id = te.scene_id
        WHERE s.parent_id = ? AND s.type = 'scene'
        ORDER BY o.linear_pos, te.rowid`
    )
    .all(unitId) as ThreadBeat[]
}

function readLedgerRow(db: Db, unitId: string): ChapterLedger | null {
  const row = db.prepare(`SELECT body FROM rollups WHERE unit_id = ? AND kind = '${LEDGER_KIND}' AND entity_id = ''`).get(unitId) as { body: string } | undefined
  return row ? (JSON.parse(row.body) as ChapterLedger) : null
}

/** A unit's beats = its direct scenes' thread_events ∪ its child UNITS' ledgers re-expressed as beats. */
function unitBeats(db: Db, unitId: string, childrenOf: Map<string, UnitRow[]>): ThreadBeat[] {
  const beats = directSceneBeats(db, unitId)
  for (const child of childrenOf.get(unitId) ?? []) {
    if (child.type === 'scene') continue
    const led = readLedgerRow(db, child.id)
    if (led) beats.push(...entriesToBeats(led.entries))
  }
  return beats.sort((a, b) => a.pos - b.pos)
}

/** Bookends = first child's premise + last child's conclusion (scene child → extracted_scenes; unit child → its ledger). */
function bookends(db: Db, unitId: string, childrenOf: Map<string, UnitRow[]>): { premise: string; conclusion: string } {
  const kids = childrenOf.get(unitId) ?? []
  if (kids.length === 0) return { premise: '', conclusion: '' }
  const field = (u: UnitRow, f: 'premise' | 'conclusion'): string =>
    u.type === 'scene'
      ? (db.prepare(`SELECT ${f} AS v FROM extracted_scenes WHERE scene_id = ?`).get(u.id) as { v: string | null } | undefined)?.v ?? ''
      : readLedgerRow(db, u.id)?.[f] ?? ''
  return { premise: field(kids[0], 'premise'), conclusion: field(kids[kids.length - 1], 'conclusion') }
}

/** Thread ids open ENTERING a position (an `open` before it, not yet resolved) — mirrors openThreadsAsOf's gate. */
function openBefore(db: Db, pos: number): string[] {
  if (!Number.isFinite(pos)) return []
  return (
    db
      .prepare(
        `SELECT DISTINCT te.thread_id AS id FROM thread_events te JOIN unit_order o ON o.unit_id = te.scene_id
          WHERE o.linear_pos < @p AND te.action = 'open'
            AND te.thread_id NOT IN (SELECT te2.thread_id FROM thread_events te2 JOIN unit_order o2 ON o2.unit_id = te2.scene_id
                                      WHERE o2.linear_pos < @p AND te2.action IN ('resolve','supersede'))`
      )
      .all({ p: pos }) as { id: string }[]
  )
    .map((r) => r.id)
    .sort()
}

function foldInputs(db: Db, workRoot: string, unitId: string, childrenOf: Map<string, UnitRow[]>, posOf: Map<string, number>): { input: ChapterFoldInput; inputHash: string } {
  const beats = unitBeats(db, unitId, childrenOf)
  const be = bookends(db, unitId, childrenOf)
  const firstPos = beats.length ? beats[0].pos : posOf.get(unitId) ?? 0
  const input: ChapterFoldInput = { chapterId: unitId, premise: be.premise, conclusion: be.conclusion, beats, openBefore: openBefore(db, firstPos) }
  const promptV = analysisPromptVersion(loadProjectInfo(workRoot).domain)
  const h = createHash('sha256').update(promptV).update('ledger-v1 ').update(input.premise).update(' ').update(input.conclusion)
  for (const b of beats) h.update(`${b.threadId}|${b.action}|${b.pos}|${b.description}|${b.subject ?? ''}|${b.confidence ?? ''}`)
  for (const t of input.openBefore) h.update(`|ob:${t}`)
  return { input, inputHash: h.digest('hex') }
}

function storedHash(db: Db, unitId: string): string | undefined {
  return (db.prepare(`SELECT input_hash FROM rollups WHERE unit_id = ? AND kind = '${LEDGER_KIND}' AND entity_id = ''`).get(unitId) as { input_hash: string } | undefined)?.input_hash
}

/** Foldable units (non-scene, with a scene descendant) DEEPEST-FIRST — children fold before parents. */
function foldOrder(byId: Map<string, UnitRow>, posOf: Map<string, number>): UnitRow[] {
  const depth = (id: string): number => {
    let d = 0
    let c = byId.get(id)
    while (c?.parent) {
      d++
      c = byId.get(c.parent)
    }
    return d
  }
  return [...byId.values()].filter((u) => u.type !== 'scene' && Number.isFinite(posOf.get(u.id) ?? Infinity)).sort((a, b) => depth(b.id) - depth(a.id) || a.id.localeCompare(b.id))
}

/** The stored Ledger node for any unit (chapter/act/book/…), or null. */
export function readChapterLedger(workRoot: string, unitId: string): ChapterLedger | null {
  const p = dbPath(workRoot)
  if (!existsSync(p)) return null
  const db = openReadonly(p)
  try {
    return readLedgerRow(db, unitId)
  } finally {
    db.close()
  }
}

export interface ChapterLedgerStatusRow {
  chapterId: string
  title: string | null
  depth: number
  status: 'pending' | 'stale' | 'fresh'
}

/** Per-unit fold staleness (pending | stale | fresh), deepest-first. */
export function chapterLedgerStatus(workRoot: string): ChapterLedgerStatusRow[] {
  const p = dbPath(workRoot)
  if (!existsSync(p)) return []
  const db = openReadonly(p)
  try {
    const { byId, childrenOf, posOf } = loadTree(db)
    const depthOf = (id: string): number => {
      let d = 0
      let c = byId.get(id)
      while (c?.parent) {
        d++
        c = byId.get(c.parent)
      }
      return d
    }
    return foldOrder(byId, posOf).map((u) => {
      const cur = foldInputs(db, workRoot, u.id, childrenOf, posOf).inputHash
      const stored = storedHash(db, u.id)
      return { chapterId: u.id, title: u.title, depth: depthOf(u.id), status: !stored ? 'pending' : stored === cur ? 'fresh' : 'stale' }
    })
  } finally {
    db.close()
  }
}

function sceneIdsUnder(childrenOf: Map<string, UnitRow[]>, unitId: string, out: string[] = []): string[] {
  for (const c of childrenOf.get(unitId) ?? []) c.type === 'scene' ? out.push(c.id) : sceneIdsUnder(childrenOf, c.id, out)
  return out
}

/** Re-fold every stale/pending unit DEEPEST-FIRST (deterministic, free). Returns { folded, total }. */
export function refoldStaleChapterLedgers(workRoot: string): { folded: number; total: number } {
  const p = dbPath(workRoot)
  if (!existsSync(p)) return { folded: 0, total: 0 }
  const db = openDb(p)
  try {
    const { byId, childrenOf, posOf } = loadTree(db)
    const order = foldOrder(byId, posOf)
    const upsert = db.prepare(
      `INSERT INTO rollups (unit_id, kind, entity_id, body, input_hash, model, created_at, span)
       VALUES (?, '${LEDGER_KIND}', '', ?, ?, NULL, ?, ?)
       ON CONFLICT(unit_id, kind, entity_id) DO UPDATE SET body=excluded.body, input_hash=excluded.input_hash, created_at=excluded.created_at, span=excluded.span`
    )
    let folded = 0
    for (const u of order) {
      const { input, inputHash } = foldInputs(db, workRoot, u.id, childrenOf, posOf)
      if (storedHash(db, u.id) === inputHash) continue // fresh — skip
      const ledger = foldChapterLedger(input)
      const scenes = sceneIdsUnder(childrenOf, u.id)
      const span = scenes.length ? `${scenes[0]}..${scenes[scenes.length - 1]} · ${scenes.length} scenes` : null
      upsert.run(u.id, JSON.stringify(ledger), inputHash, new Date().toISOString(), span)
      folded++
    }
    return { folded, total: order.length }
  } finally {
    db.close()
  }
}
