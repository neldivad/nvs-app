/**
 * FreshnessOutline — the collapsible book>part>chapter>scene outline of what an analysis run will touch
 * (internal/batched-extraction.md §7d, build-order #1). It is a JOIN over things that already exist, not new
 * plumbing (§7d "Reuse contract"): the STORY TREE (`storyTree`/`StoryNode`) is the hierarchy, a per-scene STATE
 * feed (`lib/freshnessOutline`) colors it, and `useCanvasSubset` (the active variant's scene set) gives
 * off-variant. Each folder shows an aggregate STATE BAR so the author reads the run's shape at a glance.
 *
 * The RENDER (`<OutlineTree>`) is feed-agnostic — it takes a built root + a state order/palette — so the
 * AnalysisHistoryDialog reuses it with the HISTORY feed. `<FreshnessOutline>` is the PREVIEW wrapper that
 * self-fetches the store and builds the live feed.
 *
 * Scale is handled the way §7d ruled: deep/large folders collapse by default (the aggregate bar IS the
 * level-of-detail), plus a hard per-folder render cap so a 1000-scene book never paints 1000 nodes.
 */
import { useMemo, useState, type JSX } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AnalysisDepth } from '@shared/ipc'
import { useWorkspace } from '@/stores/workspace'
import { useFreshness } from '@/components/ui/FreshnessBadge'
import { useCanvasSubset } from '@/lib/timeline/sceneAxis'
import { build, previewStateOf, PREVIEW_ORDER, type Counts, type OutlineNode, type SceneState } from '@/lib/analysis/freshnessOutline'
import { cn } from '@/lib/utils'

export const STATE_COLOR: Record<SceneState, string> = {
  willRead: 'var(--thread)', // the frontier — this run will read it
  fresh: 'var(--ok)', // up to date at this depth
  draft: 'var(--faint)', // phase ≠ canon — outside the analyzed set
  offVariant: 'var(--warn)', // not on the active timeline's path
  read: 'var(--ok)', // history: this run read it
  notRun: 'var(--faint)' // history: this run did not touch it
}
export const STATE_LABEL: Record<SceneState, string> = {
  willRead: 'will read', fresh: 'up to date', draft: 'draft', offVariant: 'off timeline', read: 'read', notRun: 'not run'
}

const COLLAPSE_OVER = 30 // a folder with more descendant scenes than this starts collapsed (drill to open)
const SCENE_CAP = 60 // max scene rows painted under one folder — the backstop against a giant flat chapter

function StateBar({ counts, order }: { counts: Counts; order: SceneState[] }): JSX.Element | null {
  if (!counts.total) return null
  return (
    <div className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-panel-soft" title={order.filter((k) => counts[k]).map((k) => `${counts[k]} ${STATE_LABEL[k]}`).join(' · ')}>
      {order.map((k) => (counts[k] > 0 ? <div key={k} style={{ flex: counts[k], backgroundColor: STATE_COLOR[k] }} /> : null))}
    </div>
  )
}

/** The primary state a folder's bar leads with (the first non-zero in `order`) → its count chip. */
function lead(counts: Counts, order: SceneState[]): SceneState | null {
  return order.find((k) => counts[k] > 0) ?? null
}

function Row({ n, depth, order, open, toggle }: { n: OutlineNode; depth: number; order: SceneState[]; open: Record<string, boolean>; toggle: (rel: string) => void }): JSX.Element {
  const isOpen = open[n.node.relPath] ?? n.counts.total <= COLLAPSE_OVER // big folders collapse by default
  const primary = lead(n.counts, order)
  return (
    <div>
      <button onClick={() => toggle(n.node.relPath)} className="flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-left hover:bg-panel-soft/60" style={{ paddingLeft: depth * 12 }}>
        {isOpen ? <ChevronDown className="size-3 shrink-0 text-faint" /> : <ChevronRight className="size-3 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">{n.node.name}</span>
        {n.node.containerType && <span className="shrink-0 rounded bg-panel-soft px-1 text-[9px] uppercase tracking-wide text-faint">{n.node.containerType}</span>}
        {primary && (
          <span className="shrink-0 text-[10px] tabular-nums" style={{ color: STATE_COLOR[primary] }}>
            {n.counts[primary]} {STATE_LABEL[primary]}
          </span>
        )}
        <StateBar counts={n.counts} order={order} />
      </button>
      {isOpen && (
        <div>
          {n.folders.map((f) => (
            <Row key={f.node.relPath} n={f} depth={depth + 1} order={order} open={open} toggle={toggle} />
          ))}
          {n.scenes.slice(0, SCENE_CAP).map(({ node, state }) => (
            <div key={node.relPath} className="flex items-center gap-1.5 py-0.5 text-[11px]" style={{ paddingLeft: (depth + 1) * 12 + 16 }}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: STATE_COLOR[state] }} title={STATE_LABEL[state]} />
              <span className={cn('min-w-0 flex-1 truncate', order[0] === state ? 'text-foreground/90' : 'text-faint')}>{node.title || node.name}</span>
            </div>
          ))}
          {n.scenes.length > SCENE_CAP && <div className="py-0.5 text-[10px] text-faint" style={{ paddingLeft: (depth + 1) * 12 + 16 }}>+{n.scenes.length - SCENE_CAP} more scenes</div>}
        </div>
      )}
    </div>
  )
}

/** The feed-agnostic render: a built roll-up + the state order/palette to show. Reused by the history dialog. */
export function OutlineTree({ root, order, empty = 'No scenes to preview yet.' }: { root: OutlineNode; order: SceneState[]; empty?: string }): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const toggle = (rel: string): void => setOpen((o) => ({ ...o, [rel]: !(o[rel] ?? true) }))
  if (root.counts.total === 0) return <div className="px-1 py-3 text-[11px] text-muted-foreground">{empty}</div>
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-faint">
        {order.filter((k) => root.counts[k]).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: STATE_COLOR[k] }} />
            {root.counts[k]} {STATE_LABEL[k]}
          </span>
        ))}
      </div>
      <div className="max-h-64 overflow-auto">
        {root.folders.map((f) => (
          <Row key={f.node.relPath} n={f} depth={0} order={order} open={open} toggle={toggle} />
        ))}
        {root.scenes.slice(0, SCENE_CAP).map(({ node, state }) => (
          <div key={node.relPath} className="flex items-center gap-1.5 py-0.5 pl-4 text-[11px]">
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: STATE_COLOR[state] }} title={STATE_LABEL[state]} />
            <span className={cn('min-w-0 flex-1 truncate', order[0] === state ? 'text-foreground/90' : 'text-faint')}>{node.title || node.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** PREVIEW outline for a run at `mode` (skim/full). Self-fetches the tree + freshness + active-variant subset. */
export function FreshnessOutline({ mode }: { mode: AnalysisDepth }): JSX.Element {
  const storyTree = useWorkspace((s) => s.storyTree)
  const rows = useFreshness()
  const onVariant = useCanvasSubset()
  // Derive once, memoized on the store refs (the useCastRanking pattern §7d cites) — O(scenes), no DB.
  const root = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.unitId, r]))
    return build({ type: 'folder', name: '', relPath: '', path: '', children: storyTree }, previewStateOf(byId, onVariant, mode))
  }, [storyTree, rows, onVariant, mode])
  return <OutlineTree root={root} order={PREVIEW_ORDER} />
}
