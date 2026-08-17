import { JSX, memo, useCallback, useEffect, useMemo, useState } from 'react'
import { regionAttrs, regionSelector } from '@/config/regions'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Panel,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  getViewportForBounds,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCardCanvas } from '@/components/canvas/useCardCanvas'
import { toPng } from 'html-to-image'
import { ChartExportDialog } from '@/components/features/timeline/ChartExportDialog'
import {
  FileText,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  X,
  Users,
  Activity,
  Layers,
  HelpCircle,
  Eraser,
  Zap,
  Trash2,
  Download,
  Loader2,
  Link2,
  Unlink,
  Sparkles,
  KeyRound
} from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { useUndoTarget } from '@/lib/editor/saveTarget'
import { cn } from '@/lib/utils'
import { activeVariant, adjacencyPairs, type EdgePair } from '@/lib/timeline/treeVariant'
import { defaultPhase, PHASE_META } from '@/config/worldSchema'
import { depthOf, levelByKey } from '@/config/sceneLadder'
import { BenchCanvas } from '@/components/features/timeline/TimelineBench'
import { ChartConfig } from '@/components/features/timeline/ChartConfig'
import { CellView } from '@/components/features/timeline/CellView'
import { CanvasWarning } from '@/components/canvas/CanvasWarning'
import { CanvasMiniMap } from '@/components/canvas/CanvasMiniMap'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { Fab } from '@/components/ui/Fab'
import { EmptyRailState } from '@/components/ui/EmptyRailState'
import { RailHeader, RailTabs } from '@/components/ui/RailHeader'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { HelpSection, HelpTable, HelpMd } from '@/components/ui/help'
import { useTranslation } from 'react-i18next'
import { DEFAULT_TIMELINE_VIEW } from '@shared/ipc'
import type { StoryNode, TimelineNode, TimelineGraph, TimelineLayers } from '@shared/ipc'

// Stable empty ref so `variant?.nodes ?? EMPTY_NODES` doesn't churn memo deps when a variant has no canvas yet.
const EMPTY_NODES: TimelineNode[] = []

// ── custom node (memoized, module-level per React Flow perf guide) ──────────────

export interface SceneData extends Record<string, unknown> {
  title: string
  subPath: string
  phase?: string
  cover?: string // relative asset path (frontmatter images[0]/avatar)
  missing?: boolean
  // ── overlay-layer bits (set only when that layer is on; all NON-reflowing) ──
  phaseTint?: boolean // phase layer → a colored left rail
  presenceCount?: number // presence layer → cast count badge
  threadCount?: number // threads layer → thread-beat badge
  revealPublic?: number // revelations layer → count of secrets going PUBLIC here (★)
  revealSetup?: number // revelations layer → count of secrets first PLANTED here (○)
  revealTip?: string // revelations layer → hover tooltip listing the secrets
}

const SceneNodeView = memo(function SceneNodeView({ data, selected }: NodeProps): JSX.Element {
  const { t } = useTranslation('timeline')
  const d = data as SceneData
  // Resolve the implicit phase the same way every other surface does (missing scene phase = canon) so the
  // timeline rail agrees with the sidebar spine / Properties / the analysis gate — no phase-default drift.
  const phase = d.phase ?? defaultPhase('scene')
  const meta = phase !== 'canon' ? PHASE_META[phase] : undefined
  const railColor = meta?.dot ?? (phase === 'canon' ? 'bg-ok' : 'bg-foreground/40')
  return (
    // Wrapper is NOT clipped, so the handles can peek outside; the inner card clips the cover/rail.
    <div className="relative w-56">
      <Handle
        type="target"
        position={Position.Left}
        className="size-3! -left-1.5! z-20! rounded-full! border-2! border-canvas! bg-faint! transition-colors hover:bg-thread!"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="size-3! -right-1.5! z-20! rounded-full! border-2! border-canvas! bg-faint! transition-colors hover:bg-thread!"
      />
      <div
        title={phase === 'archived' ? t('node.archivedTooltip') : undefined}
        className={cn(
          'relative overflow-hidden rounded-lg border bg-panel text-left shadow-sm',
          selected ? 'border-thread' : 'border-border',
          d.missing && 'border-flag/50 opacity-70',
          phase === 'archived' && 'opacity-45' // visible-but-dimmed: an archived scene BRIDGES (edges stay) but isn't analyzed
        )}
      >
        {/* phase layer — left rail (absolute, no layout impact) */}
        {d.phaseTint && <span className={cn('absolute left-0 top-0 bottom-0 z-10 w-1', railColor)} />}
        {/* presence / threads / revelations layers — corner badges (absolute, no layout impact) */}
        {(d.presenceCount || d.threadCount || d.revealPublic || d.revealSetup) && (
          <div className="absolute right-1 top-1 z-10 flex gap-1">
            {d.presenceCount ? (
              <span className="flex items-center gap-0.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-medium text-white">
                <Users className="size-2.5" />
                {d.presenceCount}
              </span>
            ) : null}
            {d.threadCount ? (
              <span className="flex items-center gap-0.5 rounded bg-thread/80 px-1 py-0.5 text-[9px] font-medium text-white">
                <Activity className="size-2.5" />
                {d.threadCount}
              </span>
            ) : null}
            {/* Revelations: ★ a secret goes public here · ○ first planted here. Lore-colored = the reveal layer. */}
            {d.revealPublic || d.revealSetup ? (
              <span title={d.revealTip} className="flex items-center gap-0.5 rounded bg-lore/85 px-1 py-0.5 text-[9px] font-medium text-white">
                {d.revealPublic ? (
                  <>
                    <Sparkles className="size-2.5" />
                    {d.revealPublic > 1 ? d.revealPublic : ''}
                  </>
                ) : null}
                {d.revealSetup ? (
                  <>
                    <KeyRound className={cn('size-2.5', d.revealPublic && 'ml-0.5 opacity-80')} />
                    {d.revealSetup > 1 ? d.revealSetup : ''}
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        )}
        {d.cover && (
          <div className="h-24 w-full bg-panel-soft">
            <img src={`nvs-asset://${d.cover}`} alt="" className="h-full w-full object-cover" draggable={false} />
          </div>
        )}
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <FileText className="size-3 shrink-0 text-faint" />
            <span className="flex-1 truncate text-[13px] text-foreground/90">{d.title}</span>
            {/* phase is cued by the left rail (phase layer) — no redundant status dot on the right */}
          </div>
          {d.subPath && <div className="truncate pl-4.5 text-[10px] text-faint">{d.subPath}</div>}
          {d.missing && <div className="pl-4.5 text-[10px] text-flag">{t('node.missingSceneDeleted')}</div>}
        </div>
      </div>
    </div>
  )
})

// ── folder group node (a collapsible container; children are separate child nodes) ─

interface FolderData extends Record<string, unknown> {
  title: string
  count: number // scene descendants
  collapsed: boolean
  folderRel: string
  root: boolean // a top-level *placed* folder (draggable, collapsible, removable)
  missing?: boolean // the folder was renamed/deleted out from under the layout
}

const FolderGroupView = memo(function FolderGroupView({ data, selected }: NodeProps): JSX.Element {
  const { t } = useTranslation('timeline')
  const d = data as FolderData
  const toggle = useWorkspace((s) => s.toggleFolderCollapse)
  const remove = useWorkspace((s) => s.removeTimelineFolder)
  return (
    <div
      className={cn(
        'h-full w-full rounded-lg border',
        selected ? 'border-thread' : 'border-border',
        d.collapsed ? 'bg-panel shadow-sm' : 'bg-panel-soft/30',
        d.missing && 'border-flag/50'
      )}
    >
      {/* Header = collapse toggle for ANY folder (click), and the drag handle for a root folder
          (drag) — React Flow distinguishes click from drag. ✕ removes a root folder only. */}
      <div
        className="flex cursor-pointer items-center gap-1.5 px-2.5"
        style={{ height: FOLDER_HEADER_H }}
        onClick={() => void toggle(d.folderRel)}
        title={d.collapsed ? t('folder.expand') : t('folder.collapse')}
      >
        <span className="shrink-0 text-muted-foreground">
          {d.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </span>
        <span className="flex-1 truncate text-[12px] font-medium text-foreground/90">{d.title}</span>
        <span className="shrink-0 text-[10px] text-faint">{d.missing ? t('folder.missing') : d.count}</span>
        {d.root && (
          <button
            className="nodrag text-faint hover:text-flag"
            title={t('folder.removeFromTimeline')}
            onClick={(e) => {
              e.stopPropagation()
              void remove(d.folderRel)
            }}
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  )
})

export const NODE_TYPES: NodeTypes = { scene: SceneNodeView, folderGroup: FolderGroupView }

// ── layout geometry (group children are auto-arranged in `.order`, top-down) ────
const CARD_W = 224
const CARD_H = 58 // scene card height, text only
const SCENE_COVER_H = 96 // extra height when a scene has a cover thumbnail (matches the h-24 strip)
const GAP = 14 // vertical gap between stacked scenes
const COL_GAP = 20 // horizontal gap between side-by-side subfolders
const FOLDER_HEADER_H = 40
const PAD = 14
const COLLAPSED_W = 240

// ── index: sceneId → its StoryNode + sub-path; relPath → folder StoryNode ───────

export interface Indexed {
  node: StoryNode
  subPath: string
}
export function buildIndex(tree: StoryNode[]): Map<string, Indexed> {
  const map = new Map<string, Indexed>()
  const walk = (nodes: StoryNode[], prefix: string[]): void => {
    for (const n of nodes) {
      if (n.type === 'scene') map.set(n.sceneId ?? n.name, { node: n, subPath: prefix.join(' · ') })
      else walk(n.children ?? [], [...prefix, n.name])
    }
  }
  walk(tree, [])
  return map
}
function buildFolderIndex(tree: StoryNode[]): Map<string, StoryNode> {
  const map = new Map<string, StoryNode>()
  const walk = (nodes: StoryNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'folder') {
        map.set(n.relPath, n)
        walk(n.children ?? [])
      }
    }
  }
  walk(tree)
  return map
}
function countDescendantScenes(folder: StoryNode): number {
  return (folder.children ?? []).reduce(
    (s, c) => s + (c.type === 'scene' ? 1 : countDescendantScenes(c)),
    0
  )
}
function collectDescendantSceneIds(folder: StoryNode, into: Set<string>): void {
  for (const c of folder.children ?? []) {
    if (c.type === 'scene') into.add(c.sceneId ?? c.name)
    else collectDescendantSceneIds(c, into)
  }
}

// ── graph builder: timeline layout → React Flow nodes (scenes + folder groups) ──

interface BuiltGraph {
  nodes: Node[]
  sceneIds: Set<string> // scene nodes actually rendered (drives which edges draw)
}

function buildGraph(
  timelineNodes: TimelineNode[],
  index: Map<string, Indexed>,
  folderIndex: Map<string, StoryNode>,
  collapsedRels: Set<string>,
  overlay: TimelineGraph,
  layers: TimelineLayers,
  t: (key: string) => string
): BuiltGraph {
  const nodes: Node[] = []
  const sceneIds = new Set<string>()
  const seen = new Set<string>() // guard against duplicate node ids (overlapping placements)
  const push = (n: Node): boolean => {
    if (seen.has(n.id)) return false
    seen.add(n.id)
    nodes.push(n)
    if (n.type === 'scene') sceneIds.add(n.id)
    return true
  }

  // Overlay badge bits for a scene, set only when that layer is on (all non-reflowing in the node).
  const overlayBits = (sid: string): Pick<SceneData, 'phaseTint' | 'presenceCount' | 'threadCount' | 'revealPublic' | 'revealSetup' | 'revealTip'> => {
    const reveals = layers.revelations ? overlay.scenes[sid]?.reveals ?? [] : []
    const revealPublic = reveals.filter((r) => r.kind === 'public').length || undefined
    const revealSetup = reveals.filter((r) => r.kind === 'setup').length || undefined
    return {
      phaseTint: layers.phase || undefined,
      presenceCount: layers.presence ? overlay.scenes[sid]?.cast.length || undefined : undefined,
      threadCount: layers.threads ? overlay.scenes[sid]?.threads.length || undefined : undefined,
      revealPublic,
      revealSetup,
      revealTip: reveals.length
        ? reveals.map((r) => `${r.kind === 'public' ? t('reveal.reveals') : t('reveal.plants')}: ${r.label}`).join('\n') || undefined
        : undefined
    }
  }

  // Scenes already owned by a placed folder shouldn't also render standalone.
  const claimed = new Set<string>()
  const placedFolderRels: string[] = []
  for (const tn of timelineNodes) {
    if (tn.kind === 'folder') {
      placedFolderRels.push(tn.folderRel)
      const folder = folderIndex.get(tn.folderRel)
      if (folder) collectDescendantSceneIds(folder, claimed)
    }
  }
  // A placed folder whose ancestor is ALSO placed renders nested in that ancestor, not standalone.
  const coveredByAncestor = (folderRel: string): boolean =>
    placedFolderRels.some((p) => p !== folderRel && folderRel.startsWith(p + '/'))

  // Columns-by-depth, bounded height: a folder's own scenes stack vertically (a column);
  // its subfolders flow horizontally to the right (each its own column). So height is bounded
  // by the tallest single folder, not the total scene count.
  const layoutChildren = (folder: StoryNode, parentId: string): { width: number; height: number } => {
    const startY = FOLDER_HEADER_H + PAD
    const children = folder.children ?? []

    // 1) direct scenes → a vertical column at the left
    let sceneY = startY
    for (const c of children) {
      if (c.type !== 'scene') continue
      const sid = c.sceneId ?? c.name
      const added = push({
        id: sid,
        type: 'scene',
        position: { x: PAD, y: sceneY },
        parentId,
        extent: 'parent',
        draggable: false,
        data: { title: c.title ?? sid, subPath: '', phase: c.phase, cover: c.cover, missing: false, ...overlayBits(sid) } satisfies SceneData
      })
      if (added) sceneY += (c.cover ? CARD_H + SCENE_COVER_H : CARD_H) + GAP
    }
    const sceneColW = sceneY > startY ? CARD_W : 0
    const sceneColH = sceneY > startY ? sceneY - startY - GAP : 0

    // 2) subfolders → flow horizontally, to the right of the scene column
    let x = PAD + (sceneColW ? sceneColW + COL_GAP : 0)
    let maxSubH = 0
    let placedAny = false
    for (const c of children) {
      if (c.type !== 'folder') continue
      const box = makeFolderBox(c, parentId, { x, y: startY }, false)
      if (box) {
        x += box.width + COL_GAP
        maxSubH = Math.max(maxSubH, box.height)
        placedAny = true
      }
    }
    const rightEdge = placedAny ? x - COL_GAP : PAD + sceneColW
    return { width: rightEdge + PAD, height: startY + Math.max(sceneColH, maxSubH) + PAD }
  }

  // A folder box: header-only when collapsed, else lays out its contents. Returns size, or null if deduped.
  const makeFolderBox = (
    folder: StoryNode,
    parentId: string | undefined,
    pos: { x: number; y: number },
    isRoot: boolean
  ): { width: number; height: number } | null => {
    const collapsed = collapsedRels.has(folder.relPath)
    const node: Node = {
      id: `folder:${folder.relPath}`,
      type: 'folderGroup',
      position: pos,
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      draggable: isRoot, // only the dropped (root) folder moves; nested folders are auto-laid
      data: {
        title: folder.name,
        count: countDescendantScenes(folder),
        collapsed,
        folderRel: folder.relPath,
        root: isRoot
      } satisfies FolderData,
      style: { width: COLLAPSED_W, height: FOLDER_HEADER_H }
    }
    if (!push(node)) return null
    if (collapsed) return { width: COLLAPSED_W, height: FOLDER_HEADER_H }
    const inner = layoutChildren(folder, node.id)
    node.style = { width: inner.width, height: inner.height }
    return inner
  }

  for (const tn of timelineNodes) {
    if (tn.kind === 'scene') {
      if (claimed.has(tn.sceneId)) continue // owned by a placed folder
      const hit = index.get(tn.sceneId)
      push({
        id: tn.sceneId,
        type: 'scene',
        position: { x: tn.x, y: tn.y },
        draggable: true,
        data: {
          title: hit?.node.title ?? tn.sceneId,
          subPath: hit?.subPath ?? '',
          phase: hit?.node.phase,
          cover: hit?.node.cover,
          missing: !hit,
          ...overlayBits(tn.sceneId)
        } satisfies SceneData
      })
    } else {
      if (coveredByAncestor(tn.folderRel)) continue // rendered nested inside a placed ancestor
      const folder = folderIndex.get(tn.folderRel)
      if (!folder) {
        // Folder renamed/deleted — a removable "missing" card (reconcile also prunes these on load).
        push({
          id: `folder:${tn.folderRel}`,
          type: 'folderGroup',
          position: { x: tn.x, y: tn.y },
          draggable: true,
          data: { title: tn.folderRel, count: 0, collapsed: true, folderRel: tn.folderRel, root: true, missing: true } satisfies FolderData,
          style: { width: COLLAPSED_W, height: FOLDER_HEADER_H }
        })
        continue
      }
      makeFolderBox(folder, undefined, { x: tn.x, y: tn.y }, true)
    }
  }

  return { nodes, sceneIds }
}

function buildEdges(
  sceneIds: Set<string>,
  index: Map<string, Indexed>,
  routeEdges: EdgePair[] | null // a NAMED route's own edges (seed+routes); null → the frontmatter SEED
): Edge[] {
  const out: Edge[] = []
  const mk = (sid: string, to: string): Edge => ({ id: `e:${sid}->${to}`, source: sid, target: to, markerEnd: { type: MarkerType.ArrowClosed } })
  // Base edges: the ACTIVE route's own edges when a named route drives the canvas, else the authored frontmatter
  // `leads_to` seed. Only between currently-visible scenes. (Revelations is now a per-node beat layer, not edges.)
  if (routeEdges) {
    for (const [sid, to] of routeEdges) if (sceneIds.has(sid) && sceneIds.has(to)) out.push(mk(sid, to))
  } else {
    for (const sid of sceneIds) for (const to of index.get(sid)?.node.leadsTo ?? []) if (sceneIds.has(to)) out.push(mk(sid, to))
  }
  return out
}

// ── layer control (ArcGIS-style table of contents; toggles persist in view.layers) ──

const LAYER_DEFS: { key: keyof TimelineLayers }[] = [
  { key: 'phase' },
  { key: 'presence' },
  { key: 'threads' },
  { key: 'revelations' }
]

function LayerControl({
  layers,
  onToggle
}: {
  layers: TimelineLayers
  onToggle: (layer: keyof TimelineLayers, on: boolean) => void
}): JSX.Element {
  const { t } = useTranslation('timeline')
  const [open, setOpen] = useState(true)
  const activeCount = Object.values(layers).filter(Boolean).length
  const storyTree = useWorkspace((s) => s.storyTree)
  const collapseToDepth = useWorkspace((s) => s.collapseToDepth)
  // The folder DEPTHS present in the tree, labeled by their ladder level (book/act/chapter) when tagged.
  // "Collapse to <level>" bulk-collapses everything at/below that depth — the render-depth control for a
  // deep hierarchy. Only worth showing when there's real nesting (>1 depth).
  const collapseLevels = useMemo(() => {
    const byDepth = new Map<number, string | undefined>()
    const walk = (nodes: StoryNode[]): void => {
      for (const n of nodes) {
        if (n.type !== 'folder') continue
        const d = depthOf(n.relPath)
        if (!byDepth.get(d) && n.containerType) byDepth.set(d, n.containerType)
        else if (!byDepth.has(d)) byDepth.set(d, n.containerType)
        walk(n.children ?? [])
      }
    }
    walk(storyTree)
    return [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([depth, ct]) => ({ depth, label: (ct && levelByKey(ct)?.label) || `L${depth}` }))
  }, [storyTree])
  return (
    <div className="w-36 rounded-lg border border-border bg-panel/95 p-1 text-[11px] shadow-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-panel-soft"
      >
        <Layers className="size-3" />
        <span className="flex-1 text-left font-semibold uppercase tracking-wide">{t('layers.title')}</span>
        {!open && activeCount > 0 && <span className="text-[9px] text-faint">{activeCount}</span>}
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {open && (
        <>
          {LAYER_DEFS.map((l) => {
            const on = layers[l.key]
            return (
              <button
                key={l.key}
                title={t(`layers.${l.key}.hint`)}
                onClick={() => onToggle(l.key, !on)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-panel-soft',
                  on ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <span
                  className={cn(
                    'flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                    on ? 'border-thread bg-thread' : 'border-border'
                  )}
                >
                  {on && <span className="size-1.5 rounded-full bg-white" />}
                </span>
                {t(`layers.${l.key}.label`)}
              </button>
            )
          })}
          {collapseLevels.length > 1 && (
            <div className="mt-1 border-t border-border/60 pt-1">
              <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wide text-faint">{t('layers.collapseTo')}</div>
              <div className="flex flex-wrap gap-1 px-1 pb-0.5">
                {collapseLevels.map((lv) => (
                  <button
                    key={lv.depth}
                    onClick={() => collapseToDepth(lv.depth)}
                    title={t('layers.collapseToLevel', { level: lv.label })}
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
                  >
                    {lv.label}
                  </button>
                ))}
                <button
                  onClick={() => collapseToDepth(Infinity)}
                  title={t('layers.expandAll')}
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
                >
                  {t('layers.scenes')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── floating dock (expandable) + its dialogs + toast ───────────────────────────

// Tab-aware pane help. The Timeline is ONE rail with three sub-views (Canvas / Cells / Chart Config) sharing the
// single `paneHelpOpen` flag, so — unlike a one-view rail — F8 must show the help for the ACTIVE tab, not always
// the Canvas. Mounted once at the outer TimelinePanel (below), so it's live on every tab. Content per `tab`.
function TimelineHelp({ tab, open, onClose }: { tab: 'canvas' | 'cells' | 'config'; open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('timeline')
  const NAVIGATE = Object.entries(t('help.navigate.rows', { returnObjects: true }) as Record<string, string>)
  const title = tab === 'cells' ? t('help.cells.title') : tab === 'config' ? t('help.config.title') : t('help.canvas.title')
  return (
    <Dialog open={open} onClose={onClose} title={title} size="detail">
      <div className="space-y-5">
        {tab === 'canvas' ? (
          <>
            <HelpSection title={t('help.canvas.build.title')}>
              <HelpTable rows={Object.entries(t('help.canvas.build.rows', { returnObjects: true }) as Record<string, string>)} />
            </HelpSection>
            <HelpSection title={t('help.canvas.selectRoute.title')}>
              <HelpTable rows={Object.entries(t('help.canvas.selectRoute.rows', { returnObjects: true }) as Record<string, string>)} />
            </HelpSection>
            <HelpSection title={t('help.canvas.editDelete.title')}>
              <HelpTable rows={Object.entries(t('help.canvas.editDelete.rows', { returnObjects: true }) as Record<string, string>)} />
            </HelpSection>
            <HelpSection title={t('help.canvas.layers.title')}>
              <HelpTable rows={Object.entries(t('help.canvas.layers.rows', { returnObjects: true }) as Record<string, string>)} />
            </HelpSection>
            <HelpSection title={t('help.canvas.noAutowire.title')}>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                <HelpMd>{t('help.canvas.noAutowire.body')}</HelpMd>
              </p>
            </HelpSection>
          </>
        ) : tab === 'cells' ? (
          <>
            <HelpSection title={t('help.cells.cellFlow.title')}>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                <HelpMd>{t('help.cells.cellFlow.body')}</HelpMd>
              </p>
            </HelpSection>
            <HelpSection title={t('help.navigate.title')}>
              <HelpTable rows={NAVIGATE} />
            </HelpSection>
            <HelpSection title={t('help.cells.readFlow.title')}>
              <HelpTable rows={Object.entries(t('help.cells.readFlow.rows', { returnObjects: true }) as Record<string, string>)} />
            </HelpSection>
          </>
        ) : (
          <>
            <HelpSection title={t('help.config.what.title')}>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                <HelpMd>{t('help.config.what.body')}</HelpMd>
              </p>
            </HelpSection>
            <HelpSection title={t('help.config.buildPath.title')}>
              <HelpTable rows={Object.entries(t('help.config.buildPath.rows', { returnObjects: true }) as Record<string, string>)} />
            </HelpSection>
            <HelpSection title={t('help.config.saveUndo.title')}>
              <HelpTable rows={Object.entries(t('help.config.saveUndo.rows', { returnObjects: true }) as Record<string, string>)} />
            </HelpSection>
            <HelpSection title={t('help.navigate.title')}>
              <HelpTable rows={NAVIGATE} />
            </HelpSection>
          </>
        )}
      </div>
    </Dialog>
  )
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose
}: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation('timeline')
  return (
    <Dialog open={open} onClose={onClose} title={title} size="confirm">
      <p className="text-[13px] text-muted-foreground">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('confirm.cancel')}
        </Button>
        <Button
          autoFocus
          size="sm"
          className="bg-flag text-white hover:bg-flag/90"
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}

// ── canvas ──────────────────────────────────────────────────────────────────

function Canvas(): JSX.Element {
  const { t } = useTranslation('timeline')
  const timeline = useWorkspace((s) => s.timeline) // project-wide layers/view only (nodes/collapsed live per-variant)
  const trees = useWorkspace((s) => s.trees)
  // T3b: the canvas draws + (via link/unlink) edits the ACTIVE TREE VARIANT — it owns BOTH the adjacency (edges) AND
  // the canvas layout (nodes/collapsed), so switching variants switches the whole canvas. Always a variant post-mirror.
  const variant = useMemo(() => activeVariant(trees), [trees])
  const canvasNodes = variant?.nodes ?? EMPTY_NODES
  const storyTree = useWorkspace((s) => s.storyTree)
  const place = useWorkspace((s) => s.placeOnTimeline)
  const placeFolder = useWorkspace((s) => s.placeFolderOnTimeline)
  const moveNodes = useWorkspace((s) => s.moveTimelineNodes)
  const removeNode = useWorkspace((s) => s.removeTimelineNode)
  const removeFolder = useWorkspace((s) => s.removeTimelineFolder)
  const link = useWorkspace((s) => s.linkScenes)
  const unlink = useWorkspace((s) => s.unlinkScenes)
  const overlay = useWorkspace((s) => s.timelineGraph)
  const setLayer = useWorkspace((s) => s.setTimelineLayer)
  const resetConnectors = useWorkspace((s) => s.resetConnectors)
  const quickConnectSorted = useWorkspace((s) => s.quickConnectSorted)
  const connectSelectedScenes = useWorkspace((s) => s.connectSelectedScenes)
  const disconnectSelectedScenes = useWorkspace((s) => s.disconnectSelectedScenes)
  const setTimelineSelection = useWorkspace((s) => s.setTimelineSelection)
  const pushNotification = useWorkspace((s) => s.pushNotification)
  const [inspect, setInspect] = useState<string | null>(null)
  // The Fab's Help button opens the pane help (paneHelpOpen); the DIALOG is rendered tab-aware at the outer
  // TimelinePanel (see <TimelineHelp>), so it's correct on Canvas / Cells / Chart Config — not Canvas-only.
  const setHelp = useWorkspace((s) => s.setPaneHelpOpen)
  // The bulk-op confirm is store-driven so the GLOBAL keydown (AppShell) can open it regardless of canvas focus.
  const confirm = useWorkspace((s) => s.timelineConfirm)
  const setConfirm = useWorkspace((s) => s.setTimelineConfirm)
  const [exporting, setExporting] = useState(false)
  const [exportShot, setExportShot] = useState<string | null>(null) // raw PNG → the photo-mode export dialog
  const { screenToFlowPosition, getNodes, getNodesBounds } = useReactFlow()

  // Render the whole graph (not just the visible viewport) to a PNG: size to the node bounds, then re-frame the
  // React Flow viewport into that box via getViewportForBounds. html-to-image rasterizes the DOM. (React Flow's
  // own recommended image-export recipe.)
  const onExportGraph = useCallback(async () => {
    const ns = getNodes()
    if (ns.length === 0) {
      pushNotification({ id: 'export', kind: 'warning', title: t('export.nothingTitle'), body: t('export.nothingBody') })
      return
    }
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewport) return
    setExporting(true)
    try {
      const bounds = getNodesBounds(ns)
      const ar = bounds.width > 0 ? bounds.height / bounds.width : 0.7
      const imgW = 2000
      const imgH = Math.round(imgW * Math.min(1.6, Math.max(0.4, ar)))
      const { x, y, zoom } = getViewportForBounds(bounds, imgW, imgH, 0.2, 2, 0.1)
      const region = document.querySelector<HTMLElement>(regionSelector('timelinePanel'))
      const bg = region ? getComputedStyle(region).backgroundColor : '#0b0b0b'
      const dataUrl = await toPng(viewport, {
        backgroundColor: bg,
        width: imgW,
        height: imgH,
        style: { width: `${imgW}px`, height: `${imgH}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` }
      })
      setExportShot(dataUrl) // → the photo-mode dialog (preview + Pro frame/badge/byline toggles), which saves
    } catch (e) {
      console.error('[nvs] timeline export failed', e)
      pushNotification({ id: 'export', kind: 'warning', title: t('export.failedTitle'), body: t('export.failedBody') })
    } finally {
      setExporting(false)
    }
  }, [getNodes, getNodesBounds, pushNotification, t])

  const layers = timeline.view?.layers ?? DEFAULT_TIMELINE_VIEW.layers
  const index = useMemo(() => buildIndex(storyTree), [storyTree])
  const folderIndex = useMemo(() => buildFolderIndex(storyTree), [storyTree])

  // Scenes + collapsible folder groups, derived from the active variant's canvas + the story tree + overlay layers.
  const collapsedRels = useMemo(() => new Set(variant?.collapsed ?? []), [variant])
  const graph = useMemo(
    () => buildGraph(canvasNodes, index, folderIndex, collapsedRels, overlay, layers, t),
    [canvasNodes, index, folderIndex, collapsedRels, overlay, layers, t]
  )
  // Derived (not stored): scenes currently owned by a placed folder — the inspector
  // can't individually remove these (remove the folder instead). Enforces "a scene is placed once".
  const claimedScenes = useMemo(() => {
    const s = new Set<string>()
    for (const n of canvasNodes) {
      if (n.kind === 'folder') {
        const f = folderIndex.get(n.folderRel)
        if (f) collectDescendantSceneIds(f, s)
      }
    }
    return s
  }, [canvasNodes, folderIndex])
  const seed = graph.nodes
  const variantEdgePairs = useMemo<EdgePair[] | null>(() => (variant ? adjacencyPairs(variant.adjacency) : null), [variant])
  // Edges from the active variant's adjacency (or the frontmatter seed), only between visible scenes.
  const edgeSeed = useMemo<Edge[]>(
    () => buildEdges(graph.sceneIds, index, variantEdgePairs),
    [graph, index, variantEdgePairs]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(seed)
  const [edges, setEdges, onEdgesChange] = useEdgesState(edgeSeed)
  // Re-seed when the store layout/tree changes (place, remove, load, link/unlink).
  useEffect(() => setNodes(seed), [seed, setNodes])
  useEffect(() => setEdges(edgeSeed), [edgeSeed, setEdges])

  // Header mini-linter: scene cards on the canvas with NO edge in or out — "not on the route" for the active
  // variant (computed from the same edges the canvas draws, so it's route-aware). A neutral count, not per-card
  // badges; the two fixes are one click away (Quick-connect + the how-to help, both in the Fab). Only when there
  // are ≥2 scene cards to relate — a lone scene can't be "off a route".
  const { looseCount, sceneCount } = useMemo(() => {
    const wired = new Set<string>()
    for (const e of edges) {
      wired.add(e.source)
      wired.add(e.target)
    }
    let loose = 0
    let scenes = 0
    for (const n of nodes) {
      if (n.type !== 'scene') continue
      scenes++
      if (!wired.has(n.id)) loose++
    }
    return { looseCount: loose, sceneCount: scenes }
  }, [nodes, edges])

  // Connection behavior (direction + quick-connect + brush-select) comes from the SHARED card-canvas preset, so
  // the timeline and the corkboard can't drift. `link` cycle-checks + persists; the hook normalizes to out→in.
  const cardCanvas = useCardCanvas(useCallback((source: string | null | undefined, target: string | null | undefined) => { if (source && target) void link(source, target) }, [link]))
  // Persist deletions to the store/frontmatter (React Flow only mutates its local copy).
  const onNodesDelete = useCallback(
    (deleted: Node[]) =>
      deleted.forEach((n) => {
        if (n.type === 'folderGroup') void removeFolder((n.data as FolderData).folderRel)
        else void removeNode(n.id)
      }),
    [removeNode, removeFolder]
  )
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => deleted.forEach((e) => void unlink(e.source, e.target)),
    [unlink]
  )

  // Mirror the marquee selection into the store so the GLOBAL keydown (AppShell) can route it — C/X, ⇧C/⇧X now
  // fire no matter what was last clicked, instead of only while the canvas pane holds focus. Scene nodes only.
  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: Node[] }) => setTimelineSelection(sel.filter((n) => n.type === 'scene').map((n) => n.id)),
    [setTimelineSelection]
  )

  // Persist EVERY dragged node (3rd arg = the whole multi-select), not just the primary — so a group move sticks.
  // One batched saveTrees via moveNodes. Scenes key by node id (= sceneId); folder groups by their folderRel.
  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, _node: Node, dragged: Node[]) =>
      void moveNodes(
        dragged.map((n) =>
          n.type === 'folderGroup'
            ? { kind: 'folder' as const, ref: (n.data as FolderData).folderRel, x: n.position.x, y: n.position.y }
            : { kind: 'scene' as const, ref: n.id, x: n.position.x, y: n.position.y }
        )
      ),
    [moveNodes]
  )
  // Only scene nodes open the inspector; folder headers handle their own clicks.
  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    if (node.type === 'scene') setInspect(node.id)
  }, [])
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const folderRel = e.dataTransfer.getData('application/nvs-folder')
      if (folderRel) {
        void placeFolder(folderRel, Math.round(pos.x), Math.round(pos.y))
        return
      }
      const sceneId = e.dataTransfer.getData('application/nvs-scene')
      if (sceneId) void place(sceneId, Math.round(pos.x), Math.round(pos.y))
    },
    [place, placeFolder, screenToFlowPosition]
  )

  return (
    <div className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.2}
        // Shared preset: brush-select (SelectionMode.Partial), delete keys, quick-connect radius, edge hit target,
        // AND the out→in connection direction — one definition, identical to the corkboard.
        {...cardCanvas}
      >
        <Background gap={20} color="var(--border)" />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <Fab
            direction="down"
            actions={[
              {
                icon: exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />,
                title: t('export.title'),
                onClick: () => void onExportGraph()
              },
              { icon: <Link2 className="size-4" />, title: t('fab.connect'), onClick: () => void connectSelectedScenes() },
              { icon: <Unlink className="size-4" />, title: t('fab.disconnect'), onClick: () => void disconnectSelectedScenes() },
              { icon: <Zap className="size-4" />, title: t('fab.quickConnect'), onClick: () => setConfirm('quick') },
              { icon: <Eraser className="size-4" />, title: t('fab.reset'), onClick: () => setConfirm('reset'), danger: true },
              { icon: <HelpCircle className="size-4" />, title: t('fab.help'), onClick: () => setHelp(true) }
            ]}
          />
        </Panel>
        <Panel position="top-right">
          <LayerControl layers={layers} onToggle={setLayer} />
        </Panel>
        {sceneCount >= 2 && looseCount > 0 && (
          <Panel position="top-center">
            <CanvasWarning
              message={<><span className="font-medium text-warn">{looseCount}</span> {t('loose.label', { count: looseCount })}</>}
              actions={[
                { label: t('loose.quickConnect'), primary: true, onClick: () => setConfirm('quick'), title: t('loose.quickConnectTitle') },
                { label: t('loose.howToConnect'), onClick: () => setHelp(true), title: t('loose.howToConnectTitle') }
              ]}
            />
          </Panel>
        )}
        <CanvasMiniMap />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0">
          <EmptyRailState rail="timeline" />
        </div>
      )}

      {inspect && (
        <PageReadDialog
          path={index.get(inspect)?.node.path}
          kind="scene"
          title={index.get(inspect)?.node.title ?? inspect}
          missing={!index.get(inspect)}
          footer={
            claimedScenes.has(inspect) ? (
              <span className="text-[10px] text-faint" title={t('inspector.inFolderTitle')}>
                {t('inspector.inFolder')}
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-flag hover:text-flag"
                onClick={() => {
                  void removeNode(inspect)
                  setInspect(null)
                }}
              >
                <Trash2 className="size-3" />
                {t('inspector.remove')}
              </Button>
            )
          }
          onClose={() => setInspect(null)}
        />
      )}

      {/* Pane help now lives at the outer TimelinePanel (tab-aware) — see <TimelineHelp>. The Fab's Help button
          (setHelp → paneHelpOpen) still opens it; on the Canvas tab that's the Canvas help. */}
      <ConfirmDialog
        open={confirm === 'reset'}
        title={t('reset.title')}
        message={t('reset.message')}
        confirmLabel={t('reset.confirm')}
        onConfirm={() => void resetConnectors()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'quick'}
        title={t('quick.title')}
        message={t('quick.message')}
        confirmLabel={t('quick.confirm')}
        onConfirm={() => void quickConnectSorted()}
        onClose={() => setConfirm(null)}
      />
      <ChartExportDialog dataUrl={exportShot} name="timeline" onClose={() => setExportShot(null)} />
    </div>
  )
}

// ── pane ──────────────────────────────────────────────────────────────────────

export function TimelinePanel(): JSX.Element {
  const { t } = useTranslation('timeline')
  const [bench, setBench] = useState(false)
  const tab = useWorkspace((s) => s.timelineTab) // in the store so the Sidebar can swap to the sequence list
  const setTab = useWorkspace((s) => s.setTimelineTab)
  // Pane help (F8) is ONE flag shared by all three tabs — render the dialog here (mounted on every tab) and pick
  // its content by `tab`, so F8 shows the ACTIVE tab's help instead of always the Canvas's.
  const helpOpen = useWorkspace((s) => s.paneHelpOpen)
  const setHelpOpen = useWorkspace((s) => s.setPaneHelpOpen)
  // ⌘Z / ⇧⌘Z on the timeline → undo/redo the trees.json history (graph + canvas), via the page-level history stack.
  const undoTrees = useWorkspace((s) => s.undoTrees)
  const redoTrees = useWorkspace((s) => s.redoTrees)
  useUndoTarget(true, { undo: undoTrees, redo: redoTrees })
  return (
    <div {...regionAttrs('timelinePanel')} className="relative flex h-full flex-col bg-canvas">
      {/* Canvas = free-hand branch topology · Cells = the same flow snapped to a VN-flowchart grid ·
          Chart Config = the linear axis every chart charts along. */}
      <RailHeader>
        <RailTabs
          tabs={['canvas', 'cells', 'config'] as const}
          value={tab}
          onChange={setTab}
          renderLabel={(tabKey) => (tabKey === 'config' ? t('tabs.config') : tabKey === 'cells' ? t('tabs.cells') : t('tabs.canvas'))}
        />
      </RailHeader>
      <div className="relative min-h-0 flex-1">
        {tab === 'canvas' ? (
          <>
            {import.meta.env.DEV && (
              <button
                onClick={() => setBench((b) => !b)}
                className="absolute right-3 bottom-3 z-20 rounded border border-border bg-panel/95 px-2 py-1 text-[11px] text-muted-foreground shadow-md hover:bg-panel-soft"
              >
                {bench ? t('bench.exit') : t('bench.enter')}
              </button>
            )}
            <ReactFlowProvider>{bench ? <BenchCanvas /> : <Canvas />}</ReactFlowProvider>
          </>
        ) : tab === 'cells' ? (
          <CellView />
        ) : (
          <ChartConfig />
        )}
      </div>
      <TimelineHelp tab={tab} open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
