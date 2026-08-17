/**
 * CellBoard — the ONE presentational VN-flowchart board. `cellLayout` positions the cells (spine-centered grid);
 * this renders them as a read-only **xyflow** graph — the SAME engine as the Canvas tab and the Corkboard — so
 * pan, scroll/pinch zoom and fit are free and consistent everywhere (no hand-rolled viewport). Nodes are NOT
 * draggable: their positions come from `cellLayout`, xyflow is purely the pan/zoom viewport over that layout.
 *
 * Both the **Cells** tab (CellView) and **Chart Config**'s axis builder render this, so the two trees MATCH by
 * construction — each just supplies its own card DATA, per-card STATE (color / ghost / order badge), edge STYLE,
 * and click handlers. Pure/presentational: no store reads.
 */
import { memo, useMemo, useRef, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { GitBranch, GitMerge, Folder } from 'lucide-react'
import { cellLayout, CELL_W, CELL_H } from '@/lib/timeline/cellLayout'
import { CanvasMiniMap } from '@/components/canvas/CanvasMiniMap'
import { cn } from '@/lib/utils'

const CARD_W = 168
const CARD_H = 56
// Center the card within its grid cell so edges (bottom-center → top-center) read straight down the spine.
const OFF_X = (CELL_W - CARD_W) / 2
const OFF_Y = (CELL_H - CARD_H) / 2

/** Display data for one cell (a scene or a collapsed-folder cell). */
export interface CellCard {
  kind: 'scene' | 'folder'
  title: string
  subPath?: string // scene: its folder path ("Archon Quest · 1-mondstadt · …")
  count?: number // folder: scenes beneath
  phaseDot?: string // scene: a PHASE_META dot class when non-canon (leading marker, unless `badge` overrides)
}
/** Per-card visual STATE a variant applies on top of the universal card. */
export interface CellCardState {
  color?: string | null // border + inset-bar tint (route color)
  className?: string // extra classes — the ghost/lit treatment (opacity, border-thread…)
  badge?: ReactNode // leading element (e.g. an order number) — replaces the phase dot
}
export interface EdgeStyle {
  stroke: string
  width: number
  dash?: string
  opacity?: number
  marker?: boolean // draw the arrowhead
}

export interface CellBoardProps {
  ids: string[]
  edgesOf: (id: string) => string[]
  spine: string[]
  cardOf: (id: string) => CellCard
  stateOf?: (id: string) => CellCardState
  edgeStyle: (from: string, to: string) => EdgeStyle
  onCardClick?: (id: string, e: React.MouseEvent) => void
  onCardDoubleClick?: (id: string) => void
  onCardContext?: (id: string, e: React.MouseEvent) => void
  cardTitle?: (id: string) => string | undefined // native tooltip
  centerOnSpine?: boolean // (kept for API compat — xyflow always frames the graph via fitView)
  centerKey?: string | number // re-frame (remount → fitView) when this changes: a variant switch, etc.
  onBackgroundClick?: () => void
}

/** The data one xyflow node carries — the universal card + the variant's per-card state + graph-shape flags. */
interface CellNodeData extends Record<string, unknown> {
  card: CellCard
  state: CellCardState
  isFork: boolean
  isMerge: boolean
  title?: string
  clickable: boolean
}

/** One cell rendered as an xyflow node. Hidden top/bottom handles anchor the edges (bottom-center → top-center),
 *  so the connectors read straight down the spine exactly like the old SVG board. */
const CellCardNode = memo(function CellCardNode({ data }: NodeProps): JSX.Element {
  const { t } = useTranslation('timeline')
  const d = data as CellNodeData
  const { card, state: st, isFork, isMerge } = d
  const folder = card.kind === 'folder'
  return (
    <div
      title={d.title}
      style={{ width: CARD_W, height: CARD_H, borderColor: st.color ?? undefined, boxShadow: st.color ? `inset 3px 0 0 ${st.color}` : undefined }}
      className={cn(
        'relative flex flex-col justify-center rounded-lg border px-2.5 py-1.5 text-left shadow-sm',
        folder ? 'bg-panel-soft' : 'bg-panel',
        !st.color && 'border-border',
        d.clickable && 'cursor-pointer',
        st.className
      )}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
      {(isFork || isMerge) && (
        <div className="absolute -top-1.5 right-1.5 flex gap-0.5">
          {isMerge && <span title={t('cell.mergePoint')} className="rounded-full bg-panel p-0.5 text-faint shadow-sm"><GitMerge className="size-3" /></span>}
          {isFork && <span title={t('cell.branchPoint')} className="rounded-full bg-panel p-0.5 text-faint shadow-sm"><GitBranch className="size-3" /></span>}
        </div>
      )}
      {folder ? (
        <div className="flex items-center gap-1.5">
          <Folder className="size-3.5 shrink-0 text-faint" />
          <span className="flex-1 truncate text-[12px] font-medium text-foreground/90">{card.title}</span>
          <span className="shrink-0 rounded bg-panel px-1 text-[10px] text-faint">{card.count}</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            {st.badge ?? (card.phaseDot ? <span className={cn('size-1.5 shrink-0 rounded-full', card.phaseDot)} /> : null)}
            <span className="flex-1 truncate text-[12px] text-foreground/90">{card.title}</span>
          </div>
          {card.subPath && <div className="truncate text-[10px] text-faint">{card.subPath}</div>}
        </>
      )}
    </div>
  )
})

const NODE_TYPES: NodeTypes = { cell: CellCardNode }

export function CellBoard({ ids, edgesOf, spine, cardOf, stateOf, edgeStyle, onCardClick, onCardDoubleClick, onCardContext, cardTitle, centerKey, onBackgroundClick }: CellBoardProps): JSX.Element {
  const layout = useMemo(() => cellLayout(spine, ids, edgesOf), [spine, ids, edgesOf])
  // `clickable` is a boolean, so the nodes memo keys on it — not on the handler IDENTITIES (which the consumers
  // recreate every render) — keeping node rebuilds off the hot path. The handlers themselves are wired at the
  // ReactFlow level (handleNode*), where a fresh identity is harmless.
  const clickable = !!(onCardClick || onCardContext)

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = []
    for (const id of ids) {
      const p = layout.pos.get(id)
      if (!p) continue
      out.push({
        id,
        type: 'cell',
        position: { x: (p.col - layout.minCol) * CELL_W + OFF_X, y: p.row * CELL_H + OFF_Y },
        draggable: false,
        selectable: false,
        data: {
          card: cardOf(id),
          state: stateOf?.(id) ?? {},
          isFork: layout.forks.has(id),
          isMerge: layout.merges.has(id),
          title: cardTitle?.(id),
          clickable
        } satisfies CellNodeData,
        width: CARD_W,
        height: CARD_H
      })
    }
    return out
  }, [ids, layout, cardOf, stateOf, cardTitle, clickable])

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    // `edgesOf` can return undefined for a leaf (CellView's `adjacency[id]`) — guard so a leaf never crashes the tab.
    for (const id of ids)
      for (const to of edgesOf(id) ?? [])
        if (layout.pos.has(id) && layout.pos.has(to)) {
          const s = edgeStyle(id, to)
          out.push({
            id: `${id}->${to}`,
            source: id,
            target: to,
            selectable: false,
            focusable: false,
            deletable: false,
            style: { stroke: s.stroke, strokeWidth: s.width, strokeDasharray: s.dash, opacity: s.opacity },
            ...(s.marker ? { markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: s.stroke } } : {})
          })
        }
    return out
  }, [ids, edgesOf, layout, edgeStyle])

  // Click vs double-click: a card's dblclick means "append the run", but the DOM fires click, click, dblclick —
  // so xyflow's onNodeClick fires TWICE per double-click. Undebounced, one double-click would record THREE
  // history steps (two light() + one append), so undo needs three presses to get back. Delay the single-click
  // action and cancel it when a dblclick lands inside the window. Only debounce when a dblclick handler exists.
  const clickTimer = useRef<number | null>(null)
  const CLICK_MS = 220
  const handleNodeClick = onCardClick
    ? (e: React.MouseEvent, n: Node): void => {
        if (!onCardDoubleClick) { onCardClick(n.id, e); return } // no dblclick action → act immediately
        if (clickTimer.current != null) { window.clearTimeout(clickTimer.current); clickTimer.current = null; return } // 2nd click → yield to dblclick
        const id = n.id
        clickTimer.current = window.setTimeout(() => { clickTimer.current = null; onCardClick(id, e) }, CLICK_MS)
      }
    : undefined
  const handleNodeDoubleClick = onCardDoubleClick
    ? (_: React.MouseEvent, n: Node): void => {
        if (clickTimer.current != null) { window.clearTimeout(clickTimer.current); clickTimer.current = null }
        onCardDoubleClick(n.id)
      }
    : undefined

  return (
    <div className="relative min-h-0 w-full flex-1">
      <ReactFlow
        // Remount on a variant switch (centerKey) so the fresh graph re-frames via fitView; within a variant the
        // key is stable, so the user's pan/zoom persists across edits (e.g. lighting a path in Chart Config).
        key={centerKey ?? 'cellboard'}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={onCardContext ? (e, n) => onCardContext(n.id, e) : undefined}
        onPaneClick={onBackgroundClick}
        // A card's double-click means "append the run" — so disable xyflow's native double-click-to-zoom, which
        // would otherwise fire together and zoom a level on every append. Scroll/pinch + the Controls still zoom.
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        // Cull off-screen cards (as the Canvas + Corkboard do) so a large flow only renders what's in view.
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="var(--border)" />
        <Controls position="bottom-left" showInteractive={false} />
        <CanvasMiniMap
          nodeStrokeWidth={0}
          nodeColor={(n) => (((n.data as CellNodeData)?.state?.color as string | undefined) ?? 'var(--muted-foreground)')}
        />
      </ReactFlow>
    </div>
  )
}
