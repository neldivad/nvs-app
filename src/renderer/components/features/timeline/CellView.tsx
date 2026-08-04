/**
 * CellView — a VIEW-ONLY VN-flowchart reading of the active tree variant (internal/cell-canvas.md ★). It does NOT
 * edit the graph (editing lives on the Canvas tab); it visualizes the branch/merge flow, auto-laid-out by
 * `cellLayout` and drawn as absolute-positioned `<div>` cards over an `<svg>` connector overlay (no React Flow).
 * The one interaction is ROUTE COLORING: the longest route is tinted by default, and right-clicking any scene opens
 * a swatch menu that paints the whole route through it (stored per-scene on the variant, so it persists).
 */
import { useCallback, useMemo, useState, type JSX } from 'react'
import { HelpCircle } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { activeVariant, activeSequencePath } from '@/lib/timeline/treeVariant'
import { cellLayout, longestPath, routeThrough, pickSpine } from '@/lib/timeline/cellLayout'
import { canvasSceneIds } from '@/lib/timeline/canvasScenes'
import { contractFolders, isFolderCell } from '@/lib/timeline/cellGraph'
import { buildIndex } from '@/components/features/timeline/TimelinePanel'
import { CellBoard, type CellCard, type CellCardState, type EdgeStyle } from '@/components/features/timeline/CellBoard'
import { RailChrome } from '@/components/layout/RailChrome'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { regionAttrs } from '@/config/regions'
import { defaultPhase, PHASE_META } from '@/config/worldSchema'
import { cn } from '@/lib/utils'

// The route palette — the 10 canonical speaker hues (globals.css --speaker-1..10), theme-aware and DISTINCT
// (the old 6-var list doubled up amber via --lore/--warn). Shared with the right-click route-color picker.
const ROUTE_COLORS = ['var(--speaker-1)', 'var(--speaker-2)', 'var(--speaker-3)', 'var(--speaker-4)', 'var(--speaker-5)', 'var(--speaker-6)', 'var(--speaker-7)', 'var(--speaker-8)', 'var(--speaker-9)', 'var(--speaker-10)']
const DEFAULT_ROUTE_COLOR = 'var(--speaker-6)' // indigo (== --thread) — the main longest route keeps its look

type Menu = { x: number; y: number; route: string[] }

export function CellView(): JSX.Element {
  const trees = useWorkspace((s) => s.trees)
  const storyTree = useWorkspace((s) => s.storyTree)
  const setRouteColor = useWorkspace((s) => s.setRouteColor)
  const setPaneHelpOpen = useWorkspace((s) => s.setPaneHelpOpen) // Fab Help → the tab-aware TimelineHelp (F8 also)

  const [menu, setMenu] = useState<Menu | null>(null)
  const [inspect, setInspect] = useState<string | null>(null)

  const variant = useMemo(() => activeVariant(trees), [trees])
  const index = useMemo(() => buildIndex(storyTree), [storyTree])
  const cellColors = variant?.cellColors ?? {}

  // Contract collapsed placed folders into single "folder cells" (cellGraph). The flow then runs over a MIXED
  // node set — scene_ids + folder:<rel> ids — which every generic helper (layout/route) consumes unchanged.
  const graph = useMemo(() => {
    const collapsed = new Set(variant?.collapsed ?? [])
    const placedFolders = (variant?.nodes ?? [])
      .filter((n): n is Extract<typeof n, { kind: 'folder' }> => n.kind === 'folder')
      .map((n) => ({ folderRel: n.folderRel, collapsed: collapsed.has(n.folderRel) }))
    const rawSubset = [...canvasSceneIds(variant?.nodes ?? [], storyTree)]
    return contractFolders(rawSubset, variant?.adjacency ?? {}, placedFolders, storyTree)
  }, [variant, storyTree])

  const subsetIds = graph.ids
  const adjacency = graph.adjacency
  const edgesOf = useCallback((id: string) => adjacency[id] ?? [], [adjacency]) // never undefined (a leaf has no key)
  const savedPath = useMemo(() => activeSequencePath(trees), [trees])

  const spine = useMemo(() => {
    const inSub = new Set(subsetIds)
    // The saved sequence is scene_ids — map each through its folder cell and drop consecutive dups, so a run of
    // scenes inside one collapsed folder becomes a single spine stop.
    const mapped: string[] = []
    for (const sid of savedPath ?? []) { const r = graph.repOf(sid); if (inSub.has(r) && mapped[mapped.length - 1] !== r) mapped.push(r) }
    return pickSpine(mapped, longestPath(subsetIds, edgesOf), subsetIds)
  }, [savedPath, subsetIds, edgesOf, graph])

  const layout = useMemo(() => cellLayout(spine, subsetIds, edgesOf), [spine, subsetIds, edgesOf])

  // Default tint: the MAIN longest route in the main color, and every BRANCH/MERGE column in its own distinct color
  // (avoiding the main color). Isolated scenes (no connections) stay neutral. A hand-painted color overrides per-scene.
  const defaultColors = useMemo(() => {
    const m = new Map<string, string>()
    const connected = new Set<string>()
    for (const [f, tos] of Object.entries(adjacency)) { if (tos.length) connected.add(f); for (const t of tos) connected.add(t) }
    const main = new Set(longestPath(subsetIds, edgesOf))
    // one palette color per off-spine COLUMN (a column is one branch/merge chain in the layout) — skip index 0 = main.
    const branchCols = [...new Set([...layout.pos].filter(([id, p]) => connected.has(id) && !main.has(id) && p.col !== 0).map(([, p]) => p.col))].sort((a, b) => a - b)
    const colColor = new Map<number, string>()
    branchCols.forEach((c, i) => colColor.set(c, ROUTE_COLORS[1 + (i % (ROUTE_COLORS.length - 1))]))
    for (const [id, p] of layout.pos) {
      if (!connected.has(id)) continue // isolated scene → no route color
      m.set(id, main.has(id) ? DEFAULT_ROUTE_COLOR : colColor.get(p.col) ?? ROUTE_COLORS[1])
    }
    return m
  }, [adjacency, subsetIds, edgesOf, layout])
  const colorOf = useCallback((id: string): string | null => cellColors[id] ?? defaultColors.get(id) ?? null, [cellColors, defaultColors])

  // Geometry (positions, edges, scroll-centering) now lives in the shared <CellBoard>; this view keeps only `layout`
  // (for defaultColors' route-column coloring) and the interaction handlers below.
  const onContext = useCallback((e: React.MouseEvent, id: string): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, route: routeThrough(id, subsetIds, edgesOf) })
  }, [subsetIds, edgesOf])

  // The CellBoard callbacks, memoized — otherwise every fresh identity rebuilds the whole board (P0). All the
  // closed-over values (graph/index/colorOf/edgesOf) are themselves memoized, so a menu/inspect toggle no longer
  // forces a rebuild; the board only refreshes when the flow or its colors actually change.
  const cardOf = useCallback((id: string): CellCard => {
    const folder = isFolderCell(id) ? graph.meta.get(id) : undefined
    if (folder) return { kind: 'folder', title: folder.title ?? id, count: folder.count ?? 0 }
    const hit = index.get(id)
    const phase = hit?.node.phase ?? defaultPhase('scene')
    return { kind: 'scene', title: hit?.node.title ?? id, subPath: hit?.subPath, phaseDot: phase !== 'canon' ? PHASE_META[phase]?.dot : undefined }
  }, [graph, index])
  const stateOf = useCallback((id: string): CellCardState => {
    const hit = isFolderCell(id) ? undefined : index.get(id)
    return { color: colorOf(id), className: cn(!isFolderCell(id) && !hit && 'border-flag/50 opacity-70', (hit?.node.phase ?? 'canon') === 'archived' && 'opacity-45') }
  }, [index, colorOf])
  const edgeStyle = useCallback((from: string): EdgeStyle => { const cf = colorOf(from); return { stroke: cf ?? 'var(--border)', width: cf ? 2 : 1.25, marker: true } }, [colorOf])
  const onCardClick = useCallback((id: string): void => { setMenu(null); if (!isFolderCell(id)) setInspect(id) }, [])
  const onCardContext = useCallback((id: string, e: React.MouseEvent): void => onContext(e, id), [onContext])
  const cardTitle = useCallback(
    (id: string): string =>
      isFolderCell(id) ? `${graph.meta.get(id)?.title} — ${graph.meta.get(id)?.count} scenes (expand on the Canvas tab to see them)` : 'Click to read · right-click to color this route',
    [graph]
  )

  return (
    <div {...regionAttrs('cellView')} className="relative flex h-full w-full flex-col bg-canvas" onClick={() => setMenu(null)}>
      {subsetIds.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="max-w-sm rounded-lg border border-dashed border-border bg-panel/60 px-6 py-5 text-center text-[13px] text-muted-foreground">
            <p>The Cell view draws your wired scenes as a visual-novel flowchart — main route centered, branches flanking, merges colored.</p>
            <p className="mt-2 text-[11px] text-faint">Add and connect scenes on the Canvas tab to see the flow here.</p>
          </div>
        </div>
      ) : (
        // The ONE shared board (also used by Chart Config's axis builder) — Cells variant: route color + read/color.
        <CellBoard
          ids={subsetIds}
          edgesOf={edgesOf}
          spine={spine}
          centerOnSpine
          centerKey={variant?.id}
          cardOf={cardOf}
          stateOf={stateOf}
          edgeStyle={edgeStyle}
          onCardClick={onCardClick}
          onCardContext={onCardContext}
          cardTitle={cardTitle}
        />
      )}

      {subsetIds.length > 0 && (
        <RailChrome
          region="cellView"
          name="Cell flow"
          fabClassName="top-4 left-4"
          fabDirection="down"
          export={{ file: 'cell-flow', caption: () => `Cell flow — ${variant?.name ?? 'timeline'}` }}
          actions={[{ icon: <HelpCircle className="size-4" />, title: 'Cell flow help', onClick: () => setPaneHelpOpen(true) }]}
        />
      )}

      {inspect && (
        <PageReadDialog
          path={index.get(inspect)?.node.path}
          kind="scene"
          title={index.get(inspect)?.node.title ?? inspect}
          missing={!index.get(inspect)}
          onClose={() => setInspect(null)}
        />
      )}

      {/* route-color context menu */}
      {menu && (
        <div
          className="fixed z-50 flex items-center gap-1 rounded-md border border-border bg-panel p-1.5 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {ROUTE_COLORS.map((col) => (
            <button
              key={col}
              onClick={() => { void setRouteColor(menu.route, col); setMenu(null) }}
              title="Color this route"
              className="size-5 rounded-full border border-black/20 transition-transform hover:scale-110"
              style={{ background: col }}
            />
          ))}
          <button
            onClick={() => { void setRouteColor(menu.route, null); setMenu(null) }}
            title="Clear this route's color"
            className="ml-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-panel-soft"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
