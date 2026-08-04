/**
 * Structural integrity check — the DETERMINISTIC "second reader" beside the LLM coherence pass. PURE (shared
 * types in, findings out), so BOTH the renderer (live, reactive, in the Coherence rail) and the engine (on
 * ingest, headless) run the SAME algorithm with the SAME inputs — no drift, one place to change.
 *
 * Catches structural breakage the analysis silently swallows: a `leads_to` that doesn't resolve (dropped by
 * `renderer/lib/leadsTo.ts` analyzeLeadsTo), a duplicate `scene_id` (the one genuinely destructive edit), a
 * scene left loose in a wired timeline, and a character page nobody ever appears in. No LLM, no false-positive
 * on filename-anchored scenes (targets resolve exactly as the timeline does, `sceneId ?? name`). See
 * internal/renpy-crossref.md (borrow #2 "static second reader" / anti-pattern #1).
 */
import type { StoryNode, TimelineGraph, WorldPage } from './ipc'

export type IntegritySeverity = 'error' | 'warn' | 'info'
export interface IntegrityIssue {
  kind: 'duplicate-id' | 'dangling-leads-to' | 'self-leads-to' | 'missing-id' | 'orphan-scene' | 'orphan-page'
  severity: IntegritySeverity
  message: string
  path: string // the scene/page to open to fix it
  title: string
  pageKind?: string // world-page kind for orphan-page issues (e.g. 'character'); absent = it's a scene
}

/** Optional extra inputs for the checks that need more than the story tree. */
export interface IntegrityContext {
  graph?: TimelineGraph // scene cast → the orphan-page check (a character page nobody appears in)
  worldPages?: WorldPage[] // the pages to test for orphans
}

interface SceneRef {
  sceneId?: string
  name: string
  title: string
  path: string
  leadsTo: string[]
}

const RANK: Record<IntegritySeverity, number> = { error: 0, warn: 1, info: 2 }

/** Walk the story tree (+ optional graph/world pages) → every structural problem, errors first. Empty = clean. */
export function checkIntegrity(tree: StoryNode[], ctx: IntegrityContext = {}): IntegrityIssue[] {
  const scenes: SceneRef[] = []
  const walk = (nodes: StoryNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'scene') scenes.push({ sceneId: n.sceneId, name: n.name, title: n.title ?? n.name, path: n.path, leadsTo: n.leadsTo ?? [] })
      else if (n.children) walk(n.children)
    }
  }
  walk(tree)

  // Resolution set — EXACTLY how the timeline resolves an edge target (leadsTo.ts sceneIndex: `sceneId ?? name`).
  const resolvable = new Set(scenes.map((s) => s.sceneId ?? s.name))
  const selfId = (s: SceneRef): string => s.sceneId ?? s.name
  const byId = new Map<string, SceneRef[]>()
  for (const s of scenes) if (s.sceneId) byId.set(s.sceneId, [...(byId.get(s.sceneId) ?? []), s])

  const issues: IntegrityIssue[] = []

  for (const s of scenes) {
    if (!s.sceneId) {
      issues.push({
        kind: 'missing-id',
        severity: 'info',
        message: `"${s.title}" has no scene_id — it's anchored to its filename, so renaming or moving the file will orphan its analysis.`,
        path: s.path,
        title: s.title
      })
    }
  }

  for (const [id, refs] of byId) {
    if (refs.length > 1) {
      for (const s of refs) {
        issues.push({
          kind: 'duplicate-id',
          severity: 'error',
          message: `scene_id "${id}" is shared by ${refs.length} scenes — their analysis (threads, custody, coherence) collides. Give each a unique scene_id.`,
          path: s.path,
          title: s.title
        })
      }
    }
  }

  // dangling / self leads_to, and in/out degree for the orphan-scene check
  const outDeg = new Map<string, number>()
  const inDeg = new Map<string, number>()
  for (const s of scenes) {
    outDeg.set(selfId(s), 0)
    inDeg.set(selfId(s), 0)
  }
  for (const s of scenes) {
    for (const to of s.leadsTo) {
      if (to === selfId(s)) {
        issues.push({ kind: 'self-leads-to', severity: 'warn', message: `"${s.title}" has a leads_to pointing at itself ("${to}").`, path: s.path, title: s.title })
      } else if (!resolvable.has(to)) {
        issues.push({
          kind: 'dangling-leads-to',
          severity: 'error',
          message: `"${s.title}" leads_to "${to}", which is not a scene in this work — the timeline edge dangles and is silently ignored.`,
          path: s.path,
          title: s.title
        })
      } else {
        outDeg.set(selfId(s), (outDeg.get(selfId(s)) ?? 0) + 1)
        inDeg.set(to, (inDeg.get(to) ?? 0) + 1)
      }
    }
  }

  // orphan-scene: only meaningful when the work actually USES leads_to — else every scene in a purely linear
  // (reading-order) work would read as "isolated". When the timeline IS wired, a scene with no edge in or out
  // is loose (it tails on reading order rather than sitting on the route).
  const hasEdges = [...outDeg.values()].some((n) => n > 0)
  if (hasEdges) {
    for (const s of scenes) {
      const id = selfId(s)
      if ((outDeg.get(id) ?? 0) === 0 && (inDeg.get(id) ?? 0) === 0) {
        issues.push({
          kind: 'orphan-scene',
          severity: 'info',
          message: `"${s.title}" has no leads_to in or out — it's loose in a wired timeline (it tails on reading order). Connect it, or it may sit off the route.`,
          path: s.path,
          title: s.title
        })
      }
    }
  }

  // orphan-page: a non-archived CHARACTER page whose entity never appears in any scene's cast — an unused page.
  if (ctx.graph && ctx.worldPages) {
    const appeared = new Set<string>()
    for (const sc of Object.values(ctx.graph.scenes)) for (const c of sc.cast) appeared.add(c.entityId)
    for (const p of ctx.worldPages) {
      if (p.kind !== 'character' || p.phase === 'archived') continue
      if (!appeared.has(p.id)) {
        issues.push({
          kind: 'orphan-page',
          severity: 'info',
          message: `Character "${p.name}" never appears in any scene (no dialogue or presence) — an unused character page.`,
          path: p.path,
          title: p.name,
          pageKind: p.kind
        })
      }
    }
  }

  return issues.sort((a, b) => RANK[a.severity] - RANK[b.severity])
}
