/**
 * relationship.ts — the evidence behind one EDGE of the cast graph (the range-aware relationship dialog).
 *
 * The app's answer to "what IS the relationship between A and B?" is NEVER a stored row — a static
 * `A —rival→ B` is true only at one point of the story. Same pattern as threads/arcs/coherence:
 * scene-anchored EVENTS, reduced on demand. This module GATHERS (it does not reduce): every signal the DB
 * already holds about the pair, each anchored to a scene position — the renderer filters by the graph's
 * current scene range, so scrubbing the range re-reduces instantly with no further IPC.
 *
 * Two layers (the declared/observed split, again):
 *   declared — the STATIC bond each page's `## Relationships` section states about the other (kinship,
 *              role: "uncle", "beloved"). Authored truth; range-independent.
 *   observed — the MOVING part: shared scenes (co-presence), conflicts naming both, and either party's
 *              arc events that name the other (trust gained, faith lost…). Range-dependent.
 *
 * v1 derives everything from existing tables (no relationship_events, no new extraction). If this proves
 * too coarse, a dedicated T2 relationship pass writes richer events into the SAME shape (see
 * internal/relationship-graph.md) and only `events` gains a source — the dialog survives unchanged.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { openReadonly } from '@engine/data/db'
import type { RelationshipEvidence, RelEvidenceEvent } from '@shared/ipc'
import { entityNameVariants, mentionsEntity } from '@shared/entityNames'

function dbPathFor(workRoot: string): string {
  return join(workRoot, '.nvs', 'nvs.db')
}

/** Every matchable name VARIANT an entity answers to (name + aliases + id, split per script) — the prose/JSON
 *  matchers. Uses the shared resolver so a bilingual "劉備 Liu Bei" also matches prose that says just "Liu Bei"
 *  (the warmth/events break); no per-file name logic. */
function namesOf(db: ReturnType<typeof openReadonly>, id: string): { display: string; variants: string[] } {
  const r = db.prepare('SELECT name, aliases_json FROM entities WHERE entity_id = ?').get(id) as
    | { name: string; aliases_json: string | null }
    | undefined
  let aliases: string[] = []
  try {
    aliases = r?.aliases_json ? (JSON.parse(r.aliases_json) as string[]).map(String) : []
  } catch {
    /* unparseable aliases — name/id still match */
  }
  return { display: r?.name ?? id, variants: entityNameVariants({ id, name: r?.name, aliases }) }
}

/** The `## Relationships` lines on `id`'s page that mention the OTHER party (or link its id). */
function declaredLines(workRoot: string, id: string, other: string[], otherId: string): string[] {
  const world = join(workRoot, 'content', 'world')
  if (!existsSync(world)) return []
  let raw: string | null = null
  for (const folder of readdirSync(world, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue
    const direct = join(world, folder.name, `${id}.md`)
    if (existsSync(direct)) {
      raw = readFileSync(direct, 'utf8')
      break
    }
  }
  if (raw == null) return []
  const body = (() => {
    try {
      return matter(raw).content
    } catch {
      return raw
    }
  })()
  const m = body.match(/^##\s*Relationships\s*$([\s\S]*?)(?=^##\s|\Z)/im)
  if (!m) return []
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter((l) => l && (mentionsEntity(l, other) || l.toLowerCase().includes(`(${otherId.toLowerCase()})`)))
}

export function relationshipEvidence(workRoot: string, aId: string, bId: string): RelationshipEvidence {
  const empty: RelationshipEvidence = { a: { id: aId, name: aId }, b: { id: bId, name: bId }, declared: { a: [], b: [] }, coScenes: [], events: [] }
  const dbPath = dbPathFor(workRoot)
  if (!existsSync(dbPath) || aId === bId) return empty
  const db = openReadonly(dbPath)
  try {
    const a = namesOf(db, aId)
    const b = namesOf(db, bId)

    // Shared scenes, in reading order — the co-presence baseline.
    const coScenes = db
      .prepare(
        `SELECT p1.unit_id AS sceneId, u.title AS title, COALESCE(o.linear_pos, 1e9) AS pos
           FROM entity_presence p1
           JOIN entity_presence p2 ON p2.unit_id = p1.unit_id AND p2.entity_id = ?
           JOIN narrative_units u ON u.unit_id = p1.unit_id AND u.type = 'scene'
           LEFT JOIN unit_order o ON o.unit_id = p1.unit_id
          WHERE p1.entity_id = ?
          ORDER BY pos`
      )
      .all(bId, aId) as Array<{ sceneId: string; title: string; pos: number }>

    const events: RelEvidenceEvent[] = []
    const posOf = new Map<string, { pos: number; title: string }>()
    for (const r of db
      .prepare(`SELECT u.unit_id AS id, u.title AS title, COALESCE(o.linear_pos, 1e9) AS pos FROM narrative_units u LEFT JOIN unit_order o ON o.unit_id = u.unit_id WHERE u.type = 'scene'`)
      .all() as Array<{ id: string; title: string; pos: number }>)
      posOf.set(r.id, { pos: r.pos, title: r.title })

    // Conflicts naming BOTH parties (extracted per scene; between[] carries names, not ids).
    for (const r of db.prepare(`SELECT scene_id AS sid, conflicts_json AS cj FROM extracted_scenes WHERE cj IS NOT NULL OR conflicts_json IS NOT NULL`).all() as Array<{ sid: string; cj: string | null }>) {
      let list: Array<{ between?: unknown[]; over?: unknown; kind?: unknown }> = []
      try {
        const v = r.cj ? JSON.parse(r.cj) : []
        list = Array.isArray(v) ? v : []
      } catch {
        continue
      }
      for (const c of list) {
        const between = (Array.isArray(c.between) ? c.between : []).map(String).join(' | ')
        if (mentionsEntity(between, a.variants) && mentionsEntity(between, b.variants)) {
          const at = posOf.get(r.sid)
          events.push({ sceneId: r.sid, pos: at?.pos ?? 1e9, title: at?.title ?? r.sid, kind: 'conflict', change: null, owner: null, facet: null, text: `conflict over "${String(c.over ?? '?')}"${c.kind ? ` (${String(c.kind)})` : ''}` })
        }
      }
    }

    // Either party's arc events that NAME the other — any facet (a knowledge gain about B is edge signal too).
    for (const r of db
      .prepare(
        `SELECT a.entity_id AS owner, a.unit_id AS sid, a.category AS cat, a.change AS chg, a.value AS val, a.description AS descr
           FROM entity_arc_events a WHERE a.entity_id IN (?, ?)`
      )
      .all(aId, bId) as Array<{ owner: string; sid: string; cat: string | null; chg: string | null; val: string | null; descr: string | null }>) {
      const otherNames = r.owner === aId ? b.variants : a.variants
      const text = `${r.val ?? ''} ${r.descr ?? ''}`
      if (!mentionsEntity(text, otherNames)) continue
      const at = posOf.get(r.sid)
      events.push({
        sceneId: r.sid,
        pos: at?.pos ?? 1e9,
        title: at?.title ?? r.sid,
        kind: 'arc',
        change: r.chg,
        owner: r.owner === aId ? 'a' : 'b',
        facet: r.cat,
        // Just the description — owner/change/facet are structured fields; the UI composes the label so it
        // never double-prints "Hamlet · gain knowledge: …" alongside a Knowledge·Gains chip.
        text: (r.val ?? r.descr ?? '').trim()
      })
    }
    events.sort((x, y) => x.pos - y.pos)

    return {
      a: { id: aId, name: a.display },
      b: { id: bId, name: b.display },
      declared: { a: declaredLines(workRoot, aId, b.variants, bId), b: declaredLines(workRoot, bId, a.variants, aId) },
      coScenes,
      events
    }
  } finally {
    db.close()
  }
}
