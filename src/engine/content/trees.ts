/**
 * trees.ts — the `.nvs/trees.json` sidecar: the story's TREE VARIANTS (`tlgLoadout`), the first-class structure
 * store in the tree-variant model (internal/timeline-model.md ★ CORRECTED 2026-07-15). Each variant is a full
 * branch/merge graph (adjacency); the active one drives all analysis + the chart axis. This replaces frontmatter
 * `leads_to` as the home for connections (N variants can't share one frontmatter without collision).
 *
 * T1 = the model + file I/O only (additive; no readers re-pointed yet — that's T3). Pure JSON, no DB, so it's
 * fully unit-testable without Electron.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TREES_VERSION, MAX_TIMELINE_VARIANTS, type TreesFile, type TreeVariant, type StoryNode, type TimelineNode } from '@shared/ipc'

const EMPTY: TreesFile = { version: TREES_VERSION, activeId: undefined, variants: [] }

export function treesPath(workRoot: string): string {
  return join(workRoot, '.nvs', 'trees.json')
}

/** Forward-migrate any on-disk/legacy shape → the current `TreesFile`. Defensive: unknown/corrupt → EMPTY, and
 *  `activeId` is healed to an existing variant (else the first). Never throws. */
export function migrateTrees(raw: unknown): TreesFile {
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  const r = raw as Partial<TreesFile>
  const variants: TreeVariant[] = Array.isArray(r.variants)
    ? r.variants
        .filter((v): v is TreeVariant => !!v && typeof v.id === 'string')
        .map((v) => ({
          id: v.id,
          name: typeof v.name === 'string' && v.name ? v.name : 'Timeline',
          adjacency: v.adjacency && typeof v.adjacency === 'object' ? sanitizeAdjacency(v.adjacency) : {},
          // Carry through the per-variant chart axes + OWN canvas layout (nodes/collapsed) — dropping them here
          // would silently reset every variant's sequences + canvas on reopen (they persist only via writeTrees).
          ...(Array.isArray(v.sequences) ? { sequences: v.sequences } : {}),
          ...(typeof v.activeSequenceId === 'string' ? { activeSequenceId: v.activeSequenceId } : {}),
          ...(Array.isArray(v.nodes) ? { nodes: v.nodes } : {}),
          ...(Array.isArray(v.collapsed) ? { collapsed: v.collapsed.filter((c) => typeof c === 'string') } : {}),
          ...(v.cellColors && typeof v.cellColors === 'object' ? { cellColors: v.cellColors } : {})
        }))
    : []
  const activeId = r.activeId && variants.some((v) => v.id === r.activeId) ? r.activeId : variants[0]?.id
  return { version: TREES_VERSION, activeId, variants }
}

/** Keep only `sceneId → string[]` entries (drop malformed edges) — a corrupt trees.json can't crash the analysis. */
function sanitizeAdjacency(adj: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [from, tos] of Object.entries(adj)) if (Array.isArray(tos)) out[from] = tos.filter((t) => typeof t === 'string')
  return out
}

/** Read `.nvs/trees.json` (migrated), or EMPTY when absent/unreadable. */
export function readTrees(workRoot: string): TreesFile {
  const p = treesPath(workRoot)
  if (!existsSync(p)) return { ...EMPTY }
  try {
    return migrateTrees(JSON.parse(readFileSync(p, 'utf8')))
  } catch {
    return { ...EMPTY }
  }
}

/** Write `.nvs/trees.json` (creates `.nvs/` if needed), stamping the current version. */
export function writeTrees(workRoot: string, trees: TreesFile): void {
  const p = treesPath(workRoot)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ ...trees, version: TREES_VERSION }, null, 2))
}

/** The active variant (`activeId`, else the first), or undefined when there are none. */
export function activeVariant(trees: TreesFile): TreeVariant | undefined {
  return trees.activeId ? trees.variants.find((v) => v.id === trees.activeId) : trees.variants[0]
}

/** Does `from` reach `to` over this adjacency (BFS)? The cycle guard for a new `from → to` edge. Cycle-safe. */
export function adjacencyReaches(adjacency: Record<string, string[]>, from: string, to: string): boolean {
  const seen = new Set<string>([from])
  const stack = [from]
  while (stack.length) {
    const n = stack.pop()!
    for (const nx of adjacency[n] ?? []) {
      if (nx === to) return true
      if (!seen.has(nx)) { seen.add(nx); stack.push(nx) }
    }
  }
  return false
}

function pickVariant(trees: TreesFile, variantId?: string): TreeVariant | undefined {
  return variantId ? trees.variants.find((v) => v.id === variantId) : activeVariant(trees)
}
function writeVariant(workRoot: string, trees: TreesFile, variant: TreeVariant, adjacency: Record<string, string[]>): void {
  writeTrees(workRoot, { ...trees, variants: trees.variants.map((v) => (v.id === variant.id ? { ...v, adjacency } : v)) })
}

/**
 * Connect `from → to` in a variant (the ACTIVE one by default) of `.nvs/trees.json` — the agent's + host's semantic
 * edit of the story graph (this is how you wire connections, NOT by editing frontmatter). Refuses self-links,
 * duplicates, and cycles; persists on success. Returns `{ ok }` or `{ ok:false, error }`.
 */
export function connectScenes(workRoot: string, from: string, to: string, variantId?: string): { ok: boolean; error?: string } {
  if (from === to) return { ok: false, error: 'a scene cannot lead to itself' }
  const trees = readTrees(workRoot)
  const variant = pickVariant(trees, variantId)
  if (!variant) return { ok: false, error: variantId ? `no tree variant "${variantId}"` : 'no tree variant to edit' }
  const adj = variant.adjacency
  if ((adj[from] ?? []).includes(to)) return { ok: false, error: `${from} already leads to ${to}` }
  if (adjacencyReaches(adj, to, from)) return { ok: false, error: `${to} already reaches ${from} — connecting would create a cycle` }
  writeVariant(workRoot, trees, variant, { ...adj, [from]: [...(adj[from] ?? []), to] })
  return { ok: true }
}

/** Every scene_id already ON the variant's canvas: standalone scene nodes + scenes under a placed folder node. */
function placedSceneIds(tree: StoryNode[], nodes: TimelineNode[]): Set<string> {
  const byRel = new Map<string, StoryNode>()
  const index = (ns: StoryNode[]): void => { for (const n of ns) if (n.type === 'folder') { byRel.set(n.relPath, n); index(n.children ?? []) } }
  index(tree)
  const under = (n: StoryNode, into: Set<string>): void => {
    for (const c of n.children ?? []) c.type === 'scene' ? into.add(c.sceneId ?? c.name) : under(c, into)
  }
  const out = new Set<string>()
  for (const n of nodes) {
    if (n.kind === 'scene') out.add(n.sceneId)
    else { const f = byRel.get(n.folderRel); if (f) under(f, out) }
  }
  return out
}

/**
 * Wire MANY edges into a variant in one write — the agent's reliable "build a route" call (vs one connectScenes per
 * edge). Each edge is validated against the ACCUMULATING graph (so a cycle formed within the batch is caught);
 * self-links / duplicates / cycles are skipped with a reason, the rest applied. When `place` is on (default), every
 * scene mentioned by the edges is also added to the variant's canvas if not already placed — so the wired route is
 * VISIBLE (the canvas + Cell view only draw placed scenes). One `writeTrees` for the whole batch.
 */
export function connectScenesBatch(
  workRoot: string,
  edges: ReadonlyArray<{ from: string; to: string }>,
  variantId: string | undefined,
  place: boolean,
  tree: StoryNode[]
): { added: number; skipped: Array<{ from: string; to: string; error: string }>; placed: number } {
  const trees = readTrees(workRoot)
  const variant = pickVariant(trees, variantId)
  if (!variant) return { added: 0, skipped: edges.map((e) => ({ ...e, error: 'no tree variant to edit' })), placed: 0 }

  const adj: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(variant.adjacency)) adj[k] = [...v]
  const skipped: Array<{ from: string; to: string; error: string }> = []
  const touched = new Set<string>()
  let added = 0
  for (const { from, to } of edges) {
    if (from === to) { skipped.push({ from, to, error: 'a scene cannot lead to itself' }); continue }
    touched.add(from); touched.add(to) // place both ends even when the edge already exists, so the route is visible
    if ((adj[from] ?? []).includes(to)) { skipped.push({ from, to, error: 'already connected' }); continue }
    if (adjacencyReaches(adj, to, from)) { skipped.push({ from, to, error: 'would create a cycle' }); continue }
    adj[from] = [...(adj[from] ?? []), to]
    added++
  }

  const patch: Partial<TreeVariant> = { adjacency: adj }
  let placed = 0
  if (place && touched.size) {
    const nodes = [...(variant.nodes ?? [])]
    const already = placedSceneIds(tree, nodes)
    let i = nodes.length
    for (const id of touched) {
      if (already.has(id)) continue
      nodes.push({ kind: 'scene', sceneId: id, x: (i % 8) * 200, y: Math.floor(i / 8) * 130 }) // cascade; Cell view auto-arranges
      already.add(id)
      i++
      placed++
    }
    if (placed) patch.nodes = nodes
  }
  if (added || placed) writeTrees(workRoot, { ...trees, variants: trees.variants.map((v) => (v.id === variant.id ? { ...v, ...patch } : v)) })
  return { added, skipped, placed }
}

/**
 * Add a NEW tree variant (an alternate timeline). `from: 'active'` clones the active variant's graph + canvas
 * (born-by-copying, then diverges — same as the UI's "New variant"); `from: 'empty'` (default) starts blank so
 * the agent wires a fresh route from scratch. `activate` (default true) makes it the active variant so the next
 * connectScenesBatch (active by default) targets it. Mirrors the store's createVariant so both paths agree.
 */
export function createVariant(
  workRoot: string,
  opts?: { name?: string; from?: 'active' | 'empty'; activate?: boolean }
): { ok: boolean; id?: string; name?: string; activated?: boolean; error?: string } {
  const trees = readTrees(workRoot)
  if (trees.variants.length >= MAX_TIMELINE_VARIANTS)
    return { ok: false, error: `max ${MAX_TIMELINE_VARIANTS} timeline variants — delete one before adding another` }
  const base = opts?.from === 'active' ? pickVariant(trees) : undefined
  const id = randomUUID()
  const name = opts?.name?.trim() || `Timeline ${trees.variants.length + 1}`
  const adjacency = base ? Object.fromEntries(Object.entries(base.adjacency).map(([k, v]) => [k, [...v]])) : {}
  const nodes = base?.nodes ? base.nodes.map((n) => ({ ...n })) : []
  const collapsed = base?.collapsed ? [...base.collapsed] : []
  const variant: TreeVariant = { id, name, adjacency, nodes, collapsed }
  const activate = opts?.activate !== false
  writeTrees(workRoot, { ...trees, variants: [...trees.variants, variant], activeId: activate ? id : trees.activeId })
  return { ok: true, id, name, activated: activate }
}

/** Remove the `from → to` connection in a variant (active by default). Idempotent. */
export function disconnectScenes(workRoot: string, from: string, to: string, variantId?: string): { ok: boolean; error?: string } {
  const trees = readTrees(workRoot)
  const variant = pickVariant(trees, variantId)
  if (!variant) return { ok: false, error: variantId ? `no tree variant "${variantId}"` : 'no tree variant to edit' }
  const kept = (variant.adjacency[from] ?? []).filter((t) => t !== to)
  const adj = { ...variant.adjacency }
  if (kept.length) adj[from] = kept
  else delete adj[from]
  writeVariant(workRoot, trees, variant, adj)
  return { ok: true }
}

/** Adjacency from the story tree's frontmatter `leads_to` (only scenes that HAVE edges; isolated omitted). Pure. */
export function adjacencyFromTree(tree: StoryNode[]): Record<string, string[]> {
  const adj: Record<string, string[]> = {}
  const walk = (nodes: StoryNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'scene') {
        if (n.sceneId && n.leadsTo && n.leadsTo.length) adj[n.sceneId] = [...n.leadsTo]
      } else walk(n.children ?? [])
    }
  }
  walk(tree)
  return adj
}

/**
 * T2 mirror-in: if `.nvs/trees.json` has NO variants yet, seed a default variant ("Timeline 1") from the current
 * frontmatter `leads_to` graph. IDEMPOTENT (only seeds once — never overwrites authored variants) and NON-destructive
 * (frontmatter is untouched; T9 strips it later). Every existing project thus gets a tree variant for T3 to read.
 */
export function mirrorFrontmatterToTrees(workRoot: string, tree: StoryNode[]): TreesFile {
  const trees = readTrees(workRoot)
  if (trees.variants.length) return trees // already seeded / authored → leave it
  const variant: TreeVariant = { id: 'default', name: 'Timeline 1', adjacency: adjacencyFromTree(tree) }
  const next: TreesFile = { version: TREES_VERSION, activeId: variant.id, variants: [variant] }
  writeTrees(workRoot, next)
  return next
}
