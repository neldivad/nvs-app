/**
 * treeVariant — the renderer-side helpers for the active TREE VARIANT (`.nvs/trees.json`, loaded into the store).
 * After T3 the canvas draws + edits the active variant's adjacency (not frontmatter); the analysis (engine) reads
 * the same trees.json, so a canvas edit reaches the analysis. Pure (no store/DOM) so the adjacency math + cycle
 * guard are unit-testable. Mirrors engine/trees.ts `activeVariant`, but for the renderer (no node:fs). ★ timeline-model.md.
 */
import type { TreesFile, TreeVariant, ChartSequence, StoryNode } from '@shared/ipc'

export type Adjacency = Record<string, string[]>

/** One `from → to` connection, flattened out of an Adjacency — what the canvas draws an edge from. */
export type EdgePair = [string, string]

/** A copy of the story tree with each scene's `leadsTo` OVERRIDDEN from `adjacency` (connections live in the tree
 *  variant now, not frontmatter). Lets frontmatter-reading helpers (e.g. checkIntegrity) run over the variant. Pure. */
export function withVariantEdges(nodes: StoryNode[], adjacency: Adjacency): StoryNode[] {
  return nodes.map((n) =>
    n.type === 'scene'
      ? { ...n, leadsTo: n.sceneId ? adjacency[n.sceneId] ?? [] : n.leadsTo }
      : { ...n, children: n.children ? withVariantEdges(n.children, adjacency) : n.children }
  )
}

/** The active variant (`activeId`, else the first), or undefined when there are none. */
export function activeVariant(trees: TreesFile): TreeVariant | undefined {
  return trees.activeId ? trees.variants.find((v) => v.id === trees.activeId) : trees.variants[0]
}

/** The active variant's ACTIVE custom sequence path (its authored linear axis), or undefined = use the AUTO chain. */
export function activeSequencePath(trees: TreesFile): string[] | undefined {
  const v = activeVariant(trees)
  return v?.activeSequenceId ? v.sequences?.find((s) => s.id === v.activeSequenceId)?.path : undefined
}

/** The active variant's custom sequences + its active-sequence id — for the sequence picker/sidebar. */
export function variantSequences(trees: TreesFile): { sequences: ChartSequence[]; activeId: string | undefined } {
  const v = activeVariant(trees)
  return { sequences: v?.sequences ?? [], activeId: v?.activeSequenceId }
}

/** Adjacency → flat `[from, to]` pairs (for the canvas edge draw). */
export function adjacencyPairs(adjacency: Adjacency): EdgePair[] {
  const out: EdgePair[] = []
  for (const [from, tos] of Object.entries(adjacency)) for (const to of tos) out.push([from, to])
  return out
}

/** Does `from → to` already exist? */
export function adjacencyHas(adjacency: Adjacency, from: string, to: string): boolean {
  return (adjacency[from] ?? []).includes(to)
}

/** Add `from → to` (dedup) — returns the same ref when it's a no-op. */
export function addAdjacency(adjacency: Adjacency, from: string, to: string): Adjacency {
  if (adjacencyHas(adjacency, from, to)) return adjacency
  return { ...adjacency, [from]: [...(adjacency[from] ?? []), to] }
}

/** Remove `from → to` (prunes the key when it empties). */
export function removeAdjacency(adjacency: Adjacency, from: string, to: string): Adjacency {
  const cur = adjacency[from] ?? []
  if (!cur.includes(to)) return adjacency
  const next = cur.filter((t) => t !== to)
  const copy = { ...adjacency }
  if (next.length) copy[from] = next
  else delete copy[from]
  return copy
}

/** Does `from` already reach `to` over this adjacency (BFS)? The cycle guard: a new `to → from` link is refused
 *  when `from` can already reach `to`. Cycle-safe (visited guard). */
export function adjacencyReaches(adjacency: Adjacency, from: string, to: string): boolean {
  const seen = new Set<string>([from])
  const stack = [from]
  while (stack.length) {
    const n = stack.pop()!
    for (const nx of adjacency[n] ?? []) {
      if (nx === to) return true
      if (!seen.has(nx)) {
        seen.add(nx)
        stack.push(nx)
      }
    }
  }
  return false
}
