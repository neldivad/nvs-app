/**
 * The pure derivation behind <FreshnessOutline> (internal/batched-extraction.md §7d) — kept JSX-free so it's
 * unit-testable and reusable by the AnalysisHistoryDialog (§7d build-order #3) without pulling in React.
 *
 * It joins the STORY TREE (StoryNode) with a per-scene STATE into a per-container roll-up: one bottom-up
 * O(scenes) pass, no DB. The state feed is PLUGGABLE (`build` takes a `stateOf` callback) — that's the "one
 * component, three feeds" architecture §7d called for:
 *   • PREVIEW  (`previewStateOf`) — will-read / fresh / draft / off-variant for a run at a given depth.
 *   • HISTORY  (`historyStateOf`) — read / not-run for a PAST run, from its frozen target set.
 * The running feed reuses PREVIEW with live tierStatus.
 */
import type { AnalysisDepth, StoryNode, TierStatusRow } from '@shared/ipc'

// The union across all feeds; each feed uses a subset (see the *_ORDER lists the UI renders by).
export type SceneState = 'willRead' | 'fresh' | 'draft' | 'offVariant' | 'read' | 'notRun'
const ALL_STATES: SceneState[] = ['willRead', 'fresh', 'draft', 'offVariant', 'read', 'notRun']
export const PREVIEW_ORDER: SceneState[] = ['willRead', 'fresh', 'draft', 'offVariant']
export const HISTORY_ORDER: SceneState[] = ['read', 'notRun']

export type Counts = Record<SceneState, number> & { total: number }
export const zeroCounts = (): Counts => ({ willRead: 0, fresh: 0, draft: 0, offVariant: 0, read: 0, notRun: 0, total: 0 })

export interface OutlineNode {
  node: StoryNode
  counts: Counts // aggregate over ALL descendant scenes (the roll-up)
  folders: OutlineNode[]
  scenes: { node: StoryNode; state: SceneState }[] // direct scene children
}

/** A per-scene state feed: what state is this scene in, for this outline's purpose. */
export type StateOf = (scene: StoryNode) => SceneState

/**
 * PREVIEW feed — which state a scene is in for a run at `mode`. Priority: a non-canon scene is `draft` and an
 * off-timeline scene is `offVariant` before freshness applies (neither gets read). Otherwise `willRead` when on
 * the frontier — stale/pending, OR a fresh SKIM scene under an EXPERT run (the skim→full upgrade) — else `fresh`.
 */
export function classify(row: TierStatusRow | undefined, offVariant: boolean, mode: AnalysisDepth): SceneState {
  if (!row || (row.phase && row.phase !== 'canon')) return 'draft'
  if (offVariant) return 'offVariant'
  const willRead = row.status === 'stale' || row.status === 'pending' || (mode === 'full' && row.status === 'fresh' && row.depth === 'skim')
  return willRead ? 'willRead' : 'fresh'
}

/** Build the PREVIEW/running state feed from live tierStatus + the active variant's scene set. */
export function previewStateOf(byId: Map<string, TierStatusRow>, onVariant: Set<string>, mode: AnalysisDepth): StateOf {
  const hasVariant = onVariant.size > 0 // no timeline subset → single-timeline, nothing is off-variant
  return (scene) => {
    const off = hasVariant && !!scene.sceneId && !onVariant.has(scene.sceneId)
    return classify(scene.sceneId ? byId.get(scene.sceneId) : undefined, off, mode)
  }
}

/** Build the HISTORY state feed from a past run's touched-scene set (its frozen `targets`). */
export function historyStateOf(readSet: Set<string>): StateOf {
  return (scene) => (scene.sceneId && readSet.has(scene.sceneId) ? 'read' : 'notRun')
}

/** One bottom-up pass: fold each scene's state (from `stateOf`) into its ancestor folders. O(scenes), no DB. */
export function build(node: StoryNode, stateOf: StateOf): OutlineNode {
  const counts = zeroCounts()
  const folders: OutlineNode[] = []
  const scenes: { node: StoryNode; state: SceneState }[] = []
  for (const c of node.children ?? []) {
    if (c.type === 'scene') {
      const state = stateOf(c)
      scenes.push({ node: c, state })
      counts[state]++
      counts.total++
    } else {
      const sub = build(c, stateOf)
      folders.push(sub)
      for (const k of ALL_STATES) counts[k] += sub.counts[k]
      counts.total += sub.counts.total
    }
  }
  return { node, counts, folders, scenes }
}
