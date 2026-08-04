import { useMemo } from 'react'
import { useWorkspace } from '@/stores/workspace'
import { sceneIndex, analyzeLeadsTo } from '@/lib/timeline/leadsTo'
import { activeVariant, activeSequencePath } from '@/lib/timeline/treeVariant'
import { canvasSceneIds } from '@/lib/timeline/canvasScenes'
import type { TimelineGraph } from '@shared/ipc'

/**
 * sceneAxis — the ONE ordered scene list every Gantt rail reads along (its X-axis). Extracted from the
 * comparator that was copy-pasted across the rails (Threads/Lore/Cast/Coherence/Relationship/Entity/Custody).
 *
 * TODAY it returns READING ORDER (`unit_order.linear_pos`) — unchanged behavior. It exists as the SEAM for a
 * branching story: the X-axis is always ONE linear path, and later an authored "chart-sequence" (a saved,
 * scene_id-anchored ordering — see internal/chart-sequence.md) supplies a different list here and every chart
 * re-axes with NO rail changes. Missing positions sink to the end; scene_id-anchored so renames/reorders hold.
 */
/** Resolve a saved chart-sequence path to the CURRENT scenes, dropping scene_ids that drifted (renamed/moved/
 *  deleted since the sequence was saved), preserving the saved order. An EMPTY result means the whole route is
 *  stale (an old project) — the caller should fall back to the auto axis, not render an empty gantt. Pure. */
export function routeScenes<T extends { sceneId: string }>(scenes: readonly T[], path: readonly string[]): T[] {
  const byId = new Map(scenes.map((s) => [s.sceneId, s]))
  return path.map((id) => byId.get(id)).filter((s): s is T => !!s)
}

export function sceneAxis<T extends { sceneId: string }>(
  scenes: readonly T[],
  graph: TimelineGraph,
  order?: readonly string[] // an authored chart-sequence (scene_id list); absent → reading order
): T[] {
  // Authored order: scenes named in `order` come first, in that order; any not listed (e.g. a scene added
  // after the sequence was authored) sink to the end in reading order — never silently dropped.
  if (order && order.length) {
    const rank = new Map(order.map((id, i) => [id, i]))
    return [...scenes].sort((a, b) => {
      const ra = rank.get(a.sceneId) ?? Infinity
      const rb = rank.get(b.sceneId) ?? Infinity
      if (ra !== rb) return ra - rb
      return (graph.scenes[a.sceneId]?.linearPos ?? 1e9) - (graph.scenes[b.sceneId]?.linearPos ?? 1e9)
    })
  }
  return [...scenes].sort(
    (a, b) => (graph.scenes[a.sceneId]?.linearPos ?? 1e9) - (graph.scenes[b.sceneId]?.linearPos ?? 1e9)
  )
}

/**
 * The rails' one-liner: the ordered X-axis for `scenes`, reading the graph + the authored chart-sequence from
 * the store with correct reactivity (recomputes when scenes, the graph, OR the sequence change). Every Gantt
 * rail uses this so a re-ordered chart-sequence re-axes them all at once.
 */
/** The ACTIVE VARIANT's active custom-sequence path (the authored linear axis), or undefined = the AUTO chain. */
export function useActiveChartPath(): string[] | undefined {
  const trees = useWorkspace((s) => s.trees)
  return useMemo(() => activeSequencePath(trees), [trees])
}

/** The ACTIVE VARIANT's canvas subset (placed scenes + placed-folder scenes). Empty set = no subset placed →
 *  callers treat that as "every scene". The shared per-variant scoping key for the cast roster + relationships,
 *  matching how useSceneAxis already scopes the gantt X-axis. */
export function useCanvasSubset(): Set<string> {
  const trees = useWorkspace((s) => s.trees)
  const storyTree = useWorkspace((s) => s.storyTree)
  return useMemo(() => canvasSceneIds(activeVariant(trees)?.nodes ?? [], storyTree), [trees, storyTree])
}

export function useSceneAxis<T extends { sceneId: string }>(scenes: readonly T[]): T[] {
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const trees = useWorkspace((s) => s.trees)
  const saved = useActiveChartPath()
  return useMemo(() => {
    // A saved sequence is an EXCLUSIVE route: the columns are ONLY its scenes, in its order (a 2-scene route →
    // a 2-column gantt), not a reordering of all scenes.
    if (saved && saved.length) {
      const routed = routeScenes(scenes, saved)
      if (routed.length) return routed // the active route still resolves to real scenes → use it
      // else: the saved route drifted to nothing (an old project's stale sequence) → SELF-HEAL by falling
      // through to the AUTO axis below, so the gantt shows the real scenes instead of a frozen/empty axis.
    }
    // AUTO axis: the clean chain of the ACTIVE TREE VARIANT (T3b-2), else the frontmatter seed when there's no
    // variant. A fork/merge makes it ambiguous → analyzeLeadsTo returns null → reading-order fallback (never
    // silently linearize, chart-sequence.md).
    // SCOPED to the canvas subset (the region placed on the active variant's canvas) — so Auto and a saved
    // sequence axe over the SAME column set (switching between them re-orders, never balloons to the whole
    // universe). Empty canvas → no subset → every scene.
    const variant = activeVariant(trees)
    const canvas = canvasSceneIds(variant?.nodes ?? [], storyTree)
    const scoped = canvas.size ? scenes.filter((s) => canvas.has(s.sceneId)) : scenes
    const ids = scoped.map((s) => s.sceneId)
    let chain: string[] | undefined
    if (variant) {
      chain = analyzeLeadsTo(ids, (id) => variant.adjacency[id]).order ?? undefined
    } else {
      const idx = sceneIndex(storyTree)
      chain = analyzeLeadsTo(ids, (id) => idx.get(id)?.leadsTo).order ?? undefined
    }
    return sceneAxis(scoped, graph, chain)
  }, [saved, scenes, graph, storyTree, trees])
}
