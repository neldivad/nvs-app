/**
 * timelineGraph.ts — the `leads_to` DAG the ANALYSIS walks (internal/timeline-model.md, slice 1).
 *
 * Engine-side counterpart to the renderer's `lib/leadsTo.ts` (same DAG semantics; the renderer can't be imported
 * across the process boundary). The old analysis defined "the story so far" for a scene as *everything with a
 * lower `linear_pos`* (folder reading order) — which for a branching/merging story is wrong: it pulls parallel
 * branches into a scene's context (false adjacency) and can't express Baccano-style POVs converging to a main
 * line. Here, a scene's context is its graph **ANCESTORS**, and a **merge scene's ancestors = the UNION of its
 * incoming branches**. Pure (edges in, no DB/IPC) so the cycle guard + ordering are unit-testable.
 */
import { createHash } from 'node:crypto'

/** sceneId → its `leads_to` targets (out-edges). Every scene is a key (isolated scenes map to []). */
export type Edges = Map<string, string[]>

/** Build the out-edge map from scene units' `metadata_json.leads_to` (string | string[]). Edges to unknown
 *  scenes (deleted/renamed) are dropped — self-healing, same discipline as scene_id anchoring elsewhere. */
export function leadsToEdges(scenes: ReadonlyArray<{ id: string; metadata_json: string | null }>): Edges {
  const ids = new Set(scenes.map((s) => s.id))
  const out: Edges = new Map(scenes.map((s) => [s.id, []]))
  for (const s of scenes) {
    if (!s.metadata_json) continue
    let lt: unknown
    try {
      lt = (JSON.parse(s.metadata_json) as { leads_to?: unknown }).leads_to
    } catch {
      continue
    }
    const targets = Array.isArray(lt) ? lt.map(String) : lt != null ? [String(lt)] : []
    for (const t of targets) if (ids.has(t) && t !== s.id) out.get(s.id)!.push(t)
  }
  return out
}

/** Any `leads_to` at all? False → the work is unwired; callers fall back to folder reading order. */
export function hasEdges(out: Edges): boolean {
  for (const a of out.values()) if (a.length) return true
  return false
}

/**
 * A tree variant's adjacency (`sceneId → out-edges`) → the `Edges` map the graph algorithms consume — the bridge
 * from the `.nvs/trees.json` shape to `graphAncestors`/`topoOrder`/etc (tree-variant model, timeline-model.md ★).
 * When `known` (every current scene_id) is supplied, every known scene becomes a key (isolated → `[]`, like
 * `leadsToEdges`) and any edge touching an unknown scene is DROPPED — self-healing across deletes/renames. Pure.
 */
export function adjacencyToEdges(adjacency: Record<string, string[]>, known?: ReadonlySet<string>): Edges {
  const out: Edges = new Map()
  // Every scene is a key (isolated → []), like leadsToEdges. Without `known`, seed from the adjacency itself (keys
  // AND targets, so a target-only scene is still a node); with `known`, seed from it so unknown scenes drop.
  const seed = known ?? new Set<string>([...Object.keys(adjacency), ...Object.values(adjacency).flat()])
  for (const id of seed) out.set(id, [])
  for (const [from, tos] of Object.entries(adjacency)) {
    if (!out.has(from)) continue // edge FROM a scene that no longer exists → drop
    const list = out.get(from)!
    for (const to of tos) if (out.has(to) && to !== from && !list.includes(to)) list.push(to) // drop edge to unknown; dedup; no self-loop
  }
  return out
}

/** A route's graph inputs (the seed+routes subset of ChartSequence): its OWN branch/merge edges + scene scope. */
export interface RouteGraphSpec {
  edges?: ReadonlyArray<readonly [string, string]> // [from, to] scene_id edges this route owns
  scope?: readonly string[] // scene_ids this route includes/analyzes
}

/**
 * The `Edges` map + scene scope for the ACTIVE route (seed+routes model, internal/timeline-model.md):
 *   • `route.edges` present → the route OWNS its graph — build edges from them; frontmatter `leads_to` is NOT read
 *     (this is how `variantB` gets a D→B merge that `variantC` doesn't, without touching the `.md`).
 *   • `route.edges` absent  → the SEED — derive the graph from each scene's frontmatter `leads_to` (`leadsToEdges`).
 * `route.scope` (absent = every seed scene) restricts the universe; any edge touching an out-of-scope scene drops
 * (same self-healing discipline as `leadsToEdges`). The returned `scope` is the analysis frontier. Pure over its
 * inputs → headless-testable; `route` undefined ⇒ pure seed (byte-identical to `leadsToEdges(seedScenes)`).
 */
export function routeEdges(
  route: RouteGraphSpec | undefined,
  seedScenes: ReadonlyArray<{ id: string; metadata_json: string | null }>
): { edges: Edges; scope: Set<string> } {
  const universe = new Set(seedScenes.map((s) => s.id))
  const scope =
    route?.scope && route.scope.length ? new Set(route.scope.filter((id) => universe.has(id))) : new Set(universe)

  if (route?.edges && route.edges.length) {
    const edges: Edges = new Map([...scope].map((id) => [id, []]))
    for (const [from, to] of route.edges) {
      if (from !== to && scope.has(from) && scope.has(to) && !edges.get(from)!.includes(to)) edges.get(from)!.push(to)
    }
    return { edges, scope }
  }
  // Seed: frontmatter `leads_to`, restricted to the scoped scenes — edges to excluded scenes drop automatically.
  const scopedScenes = route?.scope ? seedScenes.filter((s) => scope.has(s.id)) : seedScenes
  return { edges: leadsToEdges(scopedScenes), scope }
}

/** Reverse map: sceneId → predecessors (the scenes that `leads_to` it). */
function inEdges(out: Edges): Edges {
  const inm: Edges = new Map([...out.keys()].map((k) => [k, [] as string[]]))
  for (const [from, tos] of out) for (const to of tos) inm.get(to)?.push(from)
  return inm
}

/** First cycle in the graph, or null. `leads_to` must be acyclic; a cycle is blocked + surfaced, not walked. */
export function detectCycle(out: Edges): string[] | null {
  const WHITE = 0, GREY = 1, BLACK = 2
  const color = new Map<string, number>([...out.keys()].map((k) => [k, WHITE]))
  const stack: string[] = []
  let cycle: string[] | null = null
  const dfs = (u: string): boolean => {
    color.set(u, GREY)
    stack.push(u)
    for (const v of out.get(u) ?? []) {
      if (color.get(v) === GREY) {
        cycle = stack.slice(stack.indexOf(v))
        return true
      }
      if (color.get(v) === WHITE && dfs(v)) return true
    }
    color.set(u, BLACK)
    stack.pop()
    return false
  }
  for (const u of out.keys()) {
    if (color.get(u) === WHITE && dfs(u)) break
  }
  return cycle
}

/** Topologically order a node SET by BFS-rank (Kahn, FIFO queue → distance-from-root; contemporaneous branches
 *  land adjacent). Nodes inside a cycle are dropped — call `detectCycle` first to block. */
function topoOrder(out: Edges, nodes: Set<string>): string[] {
  const indeg = new Map<string, number>([...nodes].map((n) => [n, 0]))
  for (const n of nodes) for (const t of out.get(n) ?? []) if (nodes.has(t)) indeg.set(t, indeg.get(t)! + 1)
  const q = [...nodes].filter((n) => indeg.get(n) === 0)
  const order: string[] = []
  while (q.length) {
    const n = q.shift()! // FIFO = BFS-rank
    order.push(n)
    for (const t of out.get(n) ?? []) {
      if (!nodes.has(t)) continue
      indeg.set(t, indeg.get(t)! - 1)
      if (indeg.get(t) === 0) q.push(t)
    }
  }
  return order
}

/** The graph-ANCESTORS of a scene: every scene that reaches it via `leads_to` (transitive predecessors), in
 *  topological BFS-rank order. A merge scene's set is the UNION of its incoming branches; a scene on branch A
 *  does NOT include branch B's scenes. Cycle-safe (visited guard terminates even if the graph has a cycle). */
export function graphAncestors(out: Edges, sceneId: string): string[] {
  const inm = inEdges(out)
  const anc = new Set<string>()
  const stack = [...(inm.get(sceneId) ?? [])]
  while (stack.length) {
    const n = stack.pop()!
    if (anc.has(n)) continue
    anc.add(n)
    for (const p of inm.get(n) ?? []) stack.push(p)
  }
  return topoOrder(out, anc)
}

/** A stable id for a `leads_to` graph = its `timeline_version`. Same edges → same id; edit an edge → new id
 *  (which is how the analysis knows a run is stale and offers to re-run). */
export function graphVersion(out: Edges): string {
  const canon = [...out.entries()]
    .map(([f, ts]) => `${f}>${[...ts].sort().join(',')}`)
    .sort()
    .join(';')
  return createHash('sha1').update(canon).digest('hex').slice(0, 16)
}
