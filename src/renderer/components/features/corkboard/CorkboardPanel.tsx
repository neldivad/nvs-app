/**
 * Corkboard — a FREEFORM card canvas (internal/corkboard.md). Domain-agnostic: the author drops cards (a note
 * and/or an attached scene/page/thread), drags/resizes/colors them, and draws free connections (AUTHORED links,
 * NOT the leads_to graph). Persisted to `.nvs/corkboard.json` via the isolated corkboard store.
 *
 * Uses the SHARED canvas primitives (components/canvas): `useCardCanvas` (brush-select + quick-connect),
 * `CardShell` (handles + drag-handle + resize + quick-delete), `CanvasWarning`, so its UX matches the timeline.
 * Group ops (Connect-all-to / Set-group-color / Delete) live in a top-right float when ≥2 cards are selected —
 * corkboard connections are many-to-one, not a reading-order sequence like the timeline's.
 */
import { JSX, memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodesData,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { GripVertical, HelpCircle, Link2, Unlink, Trash2, X, Send, PanelRight, PanelRightClose, Paperclip, MessageSquare, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { regionAttrs } from '@/config/regions'
import { useCorkboard } from '@/stores/corkboard'
import { useWorkspace } from '@/stores/workspace'
import { useUndoTarget } from '@/lib/editor/saveTarget'
import { CardShell } from '@/components/canvas/CardShell'
import { useCardCanvas } from '@/components/canvas/useCardCanvas'
import { CanvasWarning } from '@/components/canvas/CanvasWarning'
import { CanvasMiniMap } from '@/components/canvas/CanvasMiniMap'
import { NODE_PALETTE_VARS } from '@/components/layout/ColorTagMenu'
import { Fab } from '@/components/ui/Fab'
import { Dialog } from '@/components/ui/dialog'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { HelpSection, HelpTable } from '@/components/ui/help'
import { MAX_CORKBOARD_CARDS, MAX_CORK_CARD_REFS, MAX_CORK_TITLE, type CorkBoard, type CorkCard, type CorkNote, type CorkRef } from '@shared/ipc'

// Card color = a facet-palette CSS var (the same palette + swatch style as the Cast label / ColorTagMenu),
// rendered via `var(--facet-…)`; a subtle mix of it tints the card header so the color reads at a glance.
const PALETTE = NODE_PALETTE_VARS
const swatch = (v: string): string => `var(${v})`
const headerTintOf = (v: string | undefined): string | undefined => (v ? `color-mix(in oklab, var(${v}) 16%, var(--panel))` : undefined)

/** Relative timestamp for a note ("just now" / "5 min ago" …) — adapted from the comments-component reference. */
function timeAgo(ts?: number): string {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `${mo} mo ago` : `${Math.floor(mo / 12)} yr ago`
}

interface CardData extends Record<string, unknown> {
  title?: string
  notes?: CorkNote[]
  color?: string
  refs?: CorkRef[]
}

// A link chip is colored by the page TYPE it points at (scene vs character vs location …), so a card's links read at
// a glance. We hash the finer kind (ref.pageKind, else scene/page/thread) into the facet palette — stable per kind,
// distinct across kinds — the same palette the cards use, kept intentionally low-key (dot + tint, not a loud fill).
const chipKindOf = (r: CorkRef): string => r.pageKind || (r.kind === 'scene' ? 'scene' : r.kind === 'thread' ? 'thread' : 'page')
const chipColorVar = (r: CorkRef): string => {
  const k = chipKindOf(r)
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** One attached-link chip, tinted by page type. Read-only on the card; the post passes onOpen/onRemove/onPromote. */
function RefChip({ r, onOpen, onRemove, onPromote, priority }: { r: CorkRef; onOpen?: () => void; onRemove?: () => void; onPromote?: () => void; priority?: boolean }): JSX.Element {
  const v = chipColorVar(r)
  return (
    <span
      className={cn('flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-1.5 pr-1 text-[10px]', priority && 'ring-1 ring-thread/40')}
      style={{ borderColor: `color-mix(in oklab, var(${v}) 45%, var(--border))`, backgroundColor: `color-mix(in oklab, var(${v}) 12%, var(--panel))` }}
      title={`${chipKindOf(r)} · ${r.label ?? r.id}`}
    >
      {priority ? <Star className="size-2.5 shrink-0 fill-thread text-thread" /> : <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: `var(${v})` }} />}
      {onOpen ? (
        <button onClick={onOpen} className="max-w-32 truncate text-foreground hover:text-thread">
          {r.label ?? 'page'}
        </button>
      ) : (
        <span className="max-w-28 truncate text-muted-foreground">{r.label ?? 'page'}</span>
      )}
      {onPromote && !priority && (
        <button onClick={onPromote} title="Make priority (show first)" className="text-faint hover:text-thread">
          <Star className="size-2.5" />
        </button>
      )}
      {onRemove && (
        <button onClick={onRemove} title="Remove" className="text-faint hover:text-flag">
          <X className="size-2.5" />
        </button>
      )}
    </span>
  )
}

// ── the card CONTENT (CardShell provides the shared chrome: handles/drag-handle/resize/quick-delete) ────────────
const CorkCardNode = memo(function CorkCardNode({ id, data, selected }: NodeProps): JSX.Element {
  const d = data as CardData
  const { updateNodeData } = useReactFlow()
  const notes = d.notes ?? []
  const refs = d.refs ?? []
  const latest = notes[notes.length - 1]?.text ?? '' // compact preview — the full thread lives in the dock
  const CHIPS_ON_CARD = 3 // the card shows the first few links (priority first); the rest live in the post
  return (
    <CardShell
      id={id}
      selected={selected}
      resizable
      headerTint={headerTintOf(d.color)}
      header={
        <>
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: d.color ? swatch(d.color) : 'var(--border)' }} />
          {/* the card's headline — READ-ONLY here (rename in the feed post; the header stays a clean drag surface) */}
          <span className={cn('min-w-0 flex-1 truncate text-[11px] font-medium', d.title ? 'text-foreground' : 'text-faint')}>{d.title || 'Untitled card'}</span>
          <GripVertical className="size-3 shrink-0 text-faint" />
        </>
      }
      footer={
        <div className="flex items-center gap-1.5 px-2 py-1">
          {PALETTE.map((v) => (
            <button
              key={v}
              onClick={(e) => {
                e.stopPropagation()
                updateNodeData(id, { color: d.color === v ? undefined : v })
              }}
              className={cn('nodrag size-4 shrink-0 rounded-full border', d.color === v ? 'border-foreground' : 'border-transparent hover:border-border')}
              style={{ backgroundColor: swatch(v) }}
            />
          ))}
        </div>
      }
    >
      {/* body: link chips (kind-colored) + latest-note preview + count badges. Double-click opens the full post. */}
      <div className="relative flex h-full w-full flex-col gap-1.5 overflow-hidden px-2.5 py-2">
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {refs.slice(0, CHIPS_ON_CARD).map((r, i) => (
              <RefChip key={r.id} r={r} priority={i === 0 && refs.length > 1} />
            ))}
            {refs.length > CHIPS_ON_CARD && <span className="self-center text-[10px] text-faint">+{refs.length - CHIPS_ON_CARD}</span>}
          </div>
        )}
        <div className="min-h-0 flex-1 text-[12.5px] leading-snug text-foreground">
          {latest ? <span className="line-clamp-3 whitespace-pre-wrap wrap-break-word">{latest}</span> : <span className="text-faint">Double-click to open…</span>}
        </div>
        {/* count badges — timeline presence-badge style (icon + count), so notes/links read without opening the card */}
        {(notes.length > 0 || refs.length > 0) && (
          <div className="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1">
            {notes.length > 0 && (
              <span className="flex items-center gap-0.5 rounded-full bg-panel-soft px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-faint">
                <MessageSquare className="size-2.5" /> {notes.length}
              </span>
            )}
            {refs.length > 0 && (
              <span className="flex items-center gap-0.5 rounded-full bg-panel-soft px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-faint">
                <Link2 className="size-2.5" /> {refs.length}
              </span>
            )}
          </div>
        )}
      </div>
    </CardShell>
  )
})

const NODE_TYPES: NodeTypes = { cork: CorkCardNode }

// ── board ⇄ flow mappers ─────────────────────────────────────────────────────────
function boardToFlow(board: CorkBoard): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = board.cards.map((c) => ({
    id: c.id,
    type: 'cork',
    position: { x: c.x, y: c.y },
    ...(c.w && c.h ? { width: c.w, height: c.h, style: { width: c.w, height: c.h } } : { style: { width: 210, height: 140 } }),
    data: { title: c.title, notes: c.notes, color: c.color, refs: c.refs } as CardData
  }))
  const edges: Edge[] = board.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
  return { nodes, edges }
}

function flowToBoard(board: CorkBoard, nodes: Node[], edges: Edge[]): CorkBoard {
  const cards: CorkCard[] = nodes.map((n) => {
    const dd = n.data as CardData
    const w = n.width ?? (typeof n.style?.width === 'number' ? n.style.width : undefined)
    const h = n.height ?? (typeof n.style?.height === 'number' ? n.style.height : undefined)
    return {
      id: n.id,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      ...(w ? { w: Math.round(w) } : {}),
      ...(h ? { h: Math.round(h) } : {}),
      ...(dd.title ? { title: dd.title } : {}),
      ...(dd.color ? { color: dd.color } : {}),
      ...(dd.notes && dd.notes.length ? { notes: dd.notes } : {}),
      ...(dd.refs && dd.refs.length ? { refs: dd.refs } : {})
    }
  })
  return { ...board, cards, edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) }
}

// bounded canvas — not infinite; caps panning + placement.
const EXTENT: [[number, number], [number, number]] = [[-3000, -3000], [3000, 3000]]
const MAX_OPEN_FEEDS = 20 // posts open in the feed at once — newest wins, the oldest drops off the bottom

// ── the canvas (remounted per board via key, so no stale state) ────────────────────
function Canvas({ board, epoch, onChange }: { board: CorkBoard; epoch: number; onChange: (b: CorkBoard) => void }): JSX.Element {
  const seed = useMemo(() => boardToFlow(board), [board])
  const [nodes, setNodes, onNodesChange] = useNodesState(seed.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(seed.edges)

  // undo/redo re-seeds nodes/edges IN PLACE (no remount) so the dock + viewport survive — `epoch` bumps only then.
  const seededEpoch = useRef(epoch)
  useEffect(() => {
    if (epoch === seededEpoch.current) return
    seededEpoch.current = epoch
    const next = boardToFlow(board)
    setNodes(next.nodes)
    setEdges(next.edges)
  }, [epoch, board, setNodes, setEdges])
  const { screenToFlowPosition, deleteElements } = useReactFlow()
  const addBoard = useCorkboard((s) => s.addBoard)
  const setNotice = useWorkspace((s) => s.setNotice)

  // Help open-state lives in the STORE (paneHelpOpen), so the global pane-help key (F8) opens it — not just the
  // Fab. One flag app-wide; only one rail mounts at a time, so it maps 1:1 to "this pane's help" (see RailChrome).
  const help = useWorkspace((s) => s.paneHelpOpen)
  const setHelp = useWorkspace((s) => s.setPaneHelpOpen)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [connectPick, setConnectPick] = useState(false)
  const [openIds, setOpenIds] = useState<string[]>([]) // the feed — cards opened as "posts" in the dock (newest first)
  const [dockCollapsed, setDockCollapsed] = useState(false)
  const [dockWidth, setDockWidth] = useState(340)

  // the surface's own edge-create (dedupe) → the shared quick-connect hook wires onConnect + onConnectEnd
  const connect = useCallback(
    (source: string | null | undefined, target: string | null | undefined) => {
      if (!source || !target || source === target) return
      setEdges((es) => (es.some((e) => e.source === source && e.target === target) ? es : [...es, { id: crypto.randomUUID(), source, target }]))
    },
    [setEdges]
  )
  const canvasProps = useCardCanvas(connect)

  // debounced persist of the canvas back to the board
  const save = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (save.current) clearTimeout(save.current)
    save.current = setTimeout(() => onChange(flowToBoard(board, nodes, edges)), 400)
    return () => {
      if (save.current) clearTimeout(save.current)
    }
  }, [nodes, edges, board, onChange])

  const addCard = useCallback(
    (clientX: number, clientY: number) => {
      if (nodes.length >= MAX_CORKBOARD_CARDS) {
        setNotice(`This board is full — ${MAX_CORKBOARD_CARDS} cards. Open another board.`)
        return
      }
      const nid = crypto.randomUUID()
      const position = screenToFlowPosition({ x: clientX, y: clientY })
      // Default title "untitled-N" (first free index — collision-safe even after deletes) so a board of blank
      // cards stays distinguishable instead of a wall of identical "Untitled card"s.
      const used = new Set(nodes.map((n) => (n.data as CardData).title).filter(Boolean))
      let n = 1
      while (used.has(`untitled-${n}`)) n++
      setNodes((ns) => [...ns, { id: nid, type: 'cork', position, style: { width: 210, height: 140 }, data: { title: `untitled-${n}` } as CardData }])
      // Queue the new card in the feed, but DON'T pop the dock open — creating is low-friction; the new post lands
      // as a notification on the collapsed counter (the author opens the feed when they want to write it up).
      setOpenIds((ids) => [nid, ...ids].slice(0, MAX_OPEN_FEEDS))
      setDockCollapsed(true)
    },
    [nodes, screenToFlowPosition, setNodes, setNotice]
  )

  // group ops (the top-right float, when ≥2 cards selected)
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => setSelectedIds(sel.map((n) => n.id)), [])
  // single click = SELECT only (+ finish a connect-all pick). Double-click opens the card as a post in the feed.
  const onNodeClick = useCallback(
    (_e: unknown, node: Node) => {
      if (connectPick) {
        selectedIds.forEach((s) => connect(s, node.id)) // many-to-one: every selected → the clicked target
        setConnectPick(false)
      }
    },
    [connectPick, selectedIds, connect]
  )
  const onNodeDoubleClick = useCallback((_e: unknown, node: Node) => {
    setOpenIds((ids) => (ids.includes(node.id) ? ids : [node.id, ...ids].slice(0, MAX_OPEN_FEEDS)))
    setDockCollapsed(false)
  }, [])
  // Deleting a card drops its post from the feed (and its selection) — no "Card removed." tombstone. Fires for
  // every INTERACTIVE delete (keyboard, quick-delete, group). Undo/redo re-seeds nodes directly (the epoch effect),
  // NOT through this, so the feed is left out of the undo history: an undone card returns to the canvas but not
  // auto-reopened — double-click to reopen. (The "Card removed." fallback stays for the rare lingering-id case.)
  const onNodesDelete = useCallback((deleted: Node[]) => {
    const gone = new Set(deleted.map((n) => n.id))
    setOpenIds((ids) => ids.filter((id) => !gone.has(id)))
    setSelectedIds((ids) => ids.filter((id) => !gone.has(id)))
  }, [])
  const setGroupColor = useCallback(
    (color: string | undefined) => setNodes((ns) => ns.map((n) => (selectedIds.includes(n.id) ? { ...n, data: { ...(n.data as CardData), color } } : n))),
    [selectedIds, setNodes]
  )
  const disconnectGroup = useCallback(
    () => setEdges((es) => es.filter((e) => !selectedIds.includes(e.source) && !selectedIds.includes(e.target))),
    [selectedIds, setEdges]
  )
  // group hotkeys (mirrors the timeline): C = connect-all-to (then click a target), X = disconnect-all. Ignored
  // while typing (inputs/dialogs) and when nothing is selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || !selectedIds.length) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        setConnectPick(true)
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        disconnectGroup()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, disconnectGroup])
  const deleteGroup = useCallback(() => {
    void deleteElements({ nodes: selectedIds.map((id) => ({ id })) })
    setSelectedIds([])
  }, [deleteElements, selectedIds])

  const full = nodes.length >= MAX_CORKBOARD_CARDS

  return (
    <div className="flex h-full w-full">
      <div className="relative min-w-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodesDelete={onNodesDelete}
        {...canvasProps}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          addCard(e.clientX, e.clientY)
        }}
        translateExtent={EXTENT}
        nodeExtent={EXTENT}
        minZoom={0.2}
        maxZoom={2}
        fitView
      >
        <Background gap={20} color="var(--border)" />
        {/* zoom bottom-left; minimap bottom-right — sits INSIDE the canvas (the feed Sheet is a flex sibling, so
            the canvas shrinks beside it, no overlap) and collapses out of the way. Tinted by each card's group color. */}
        <Controls position="bottom-left" showInteractive={false} />
        <CanvasMiniMap nodeColor={(n) => { const c = (n.data as CardData)?.color; return c ? swatch(c) : 'var(--faint)' }} />
        {/* top-left Fab — HELP (cards are added by right-click; the empty cue teaches it) */}
        <Panel position="top-left">
          <Fab direction="down" actions={[{ icon: <HelpCircle className="size-4" />, title: 'How the corkboard works', onClick: () => setHelp(true) }]} />
        </Panel>
        {/* top-right controls — the collapsed-feed toggle (symmetric to the top-left Fab) + the group-ops float */}
        {((openIds.length > 0 && dockCollapsed) || selectedIds.length >= 2) && (
          <Panel position="top-right">
            <div className="flex flex-col items-end gap-2">
              {openIds.length > 0 && dockCollapsed && (
                <button
                  onClick={() => setDockCollapsed(false)}
                  title={`Show feed (${openIds.length})`}
                  className="relative flex size-8 items-center justify-center rounded-full border border-border bg-panel/95 text-muted-foreground shadow-md transition-colors hover:bg-panel-soft hover:text-foreground"
                >
                  <PanelRight className="size-4" />
                  <span className="absolute -right-1 -top-1 flex min-w-3.5 items-center justify-center rounded-full bg-thread px-0.5 text-[8px] font-medium text-white">{openIds.length}</span>
                </button>
              )}
              {selectedIds.length >= 2 && (
                <div className="flex w-48 flex-col gap-0.5 rounded-lg border border-border bg-panel/95 p-1.5 text-[11px] shadow-xl">
                  <div className="px-1.5 py-0.5 text-faint">{selectedIds.length} selected</div>
                  <button onClick={() => setConnectPick(true)} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-foreground transition-colors hover:bg-panel-soft">
                    <Link2 className="size-3.5 text-faint" /> Connect all to… <span className="ml-auto text-faint">C</span>
                  </button>
                  <button onClick={disconnectGroup} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-foreground transition-colors hover:bg-panel-soft">
                    <Unlink className="size-3.5 text-faint" /> Disconnect all <span className="ml-auto text-faint">X</span>
                  </button>
                  {/* Set group — the sidebar's "Label as" palette treatment, distinct from the action rows above */}
                  <div className="mt-0.5 border-t border-border/60 pt-1">
                    <div className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Set group</div>
                    <div className="flex flex-wrap items-center gap-1.5 px-1.5 py-1">
                      {PALETTE.map((v) => (
                        <button key={v} onClick={() => setGroupColor(v)} className="size-4 rounded-full border-2 border-transparent transition-colors hover:border-border" style={{ backgroundColor: swatch(v) }} />
                      ))}
                      <button onClick={() => setGroupColor(undefined)} className="ml-0.5 text-[10px] text-faint hover:text-foreground">clear</button>
                    </div>
                  </div>
                  <div className="mt-0.5 border-t border-border/60 pt-1">
                    <button onClick={deleteGroup} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-muted-foreground transition-colors hover:bg-flag/10 hover:text-flag">
                      <Trash2 className="size-3.5" /> Delete <span className="ml-auto text-faint">⌫</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        )}
        {/* connect-pick hint */}
        {connectPick && (
          <Panel position="top-center">
            <CanvasWarning
              message={`Click a card to connect all ${selectedIds.length} selected to it`}
              actions={[{ label: 'Cancel', onClick: () => setConnectPick(false) }]}
            />
          </Panel>
        )}
        {/* card-limit warning — the standardized CanvasWarning, shared with the timeline */}
        {full && !connectPick && (
          <Panel position="top-center">
            <CanvasWarning
              message={`This board is full — ${MAX_CORKBOARD_CARDS} cards`}
              actions={[{ label: 'New board', primary: true, onClick: () => addBoard(), title: 'Move your next notes to a fresh board' }]}
            />
          </Panel>
        )}
      </ReactFlow>
      {/* empty-board cue (pointer-events-none so right-click still reaches the pane) */}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-lg border border-dashed border-border bg-panel/70 px-4 py-2 text-sm text-faint">Right-click the board to add your first note</span>
        </div>
      )}
      </div>
      {openIds.length > 0 && !dockCollapsed && (
        <CorkboardFeed
          cardIds={openIds}
          selectedIds={selectedIds}
          width={dockWidth}
          onResize={setDockWidth}
          onClosePost={(cid) => setOpenIds((ids) => ids.filter((x) => x !== cid))}
          onCloseAll={() => setOpenIds([])}
          onCollapse={() => setDockCollapsed(true)}
        />
      )}
      <CorkboardHelpDialog open={help} onClose={() => setHelp(false)} />
    </div>
  )
}

// ── panel: the active board's canvas (state lives in the isolated corkboard store) ──
export function CorkboardPanel(): JSX.Element {
  const file = useCorkboard((s) => s.file)
  const load = useCorkboard((s) => s.load)
  const updateActiveBoard = useCorkboard((s) => s.updateActiveBoard)
  const undo = useCorkboard((s) => s.undo)
  const redo = useCorkboard((s) => s.redo)
  const epoch = useCorkboard((s) => s.epoch)

  useEffect(() => {
    if (!file) void load()
  }, [file, load])
  // ⌘Z / ⇧⌘Z on the corkboard (AppShell leaves card textareas to their own native text-undo)
  useUndoTarget(true, { undo, redo })

  const active = file ? file.boards.find((b) => b.id === file.activeId) ?? file.boards[0] : undefined
  if (!active) return <div className="flex h-full items-center justify-center text-sm text-faint">Loading corkboard…</div>

  return (
    <div {...regionAttrs('corkboardPanel')} className="relative h-full w-full">
      <ReactFlowProvider>
        {/* key by board id only (a board switch remounts). Undo/redo re-seeds IN PLACE via the epoch prop — no
            remount — so the dock + viewport aren't reset. */}
        <Canvas key={active.id} board={active} epoch={epoch} onChange={updateActiveBoard} />
      </ReactFlowProvider>
    </div>
  )
}

// ── the card dock: a resizable/collapsible FEED of "posts" (each double-clicked card), each a comment thread ──────
function CorkboardFeed({
  cardIds,
  selectedIds,
  width,
  onResize,
  onClosePost,
  onCloseAll,
  onCollapse
}: {
  cardIds: string[]
  selectedIds: string[]
  width: number
  onResize: (w: number) => void
  onClosePost: (id: string) => void
  onCloseAll: () => void
  onCollapse: () => void
}): JSX.Element {
  const startResize = (e: ReactMouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (ev: MouseEvent): void => onResize(Math.min(Math.max(startW - (ev.clientX - startX), 280), 560))
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return (
    <div className="relative flex h-full shrink-0 flex-col border-l border-border bg-panel" style={{ width }}>
      {/* left-edge resize handle */}
      <div onMouseDown={startResize} title="Drag to resize" className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize" />
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="type-label min-w-0 flex-1 truncate text-muted-foreground">Feed · {cardIds.length}</span>
        {cardIds.length > 1 && (
          <button onClick={onCloseAll} title="Close all posts" className="shrink-0 text-[11px] text-faint transition-colors hover:text-foreground">
            Close all
          </button>
        )}
        <button onClick={onCollapse} title="Collapse" className="shrink-0 text-faint transition-colors hover:text-foreground">
          <PanelRightClose className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {cardIds.map((id) => (
          <CorkboardPost key={id} cardId={id} selected={selectedIds.includes(id)} onClose={() => onClosePost(id)} />
        ))}
      </div>
    </div>
  )
}

// one "post" in the feed — a card's header + its note thread (comments) + reply box.
function CorkboardPost({ cardId, selected, onClose }: { cardId: string; selected: boolean; onClose: () => void }): JSX.Element {
  const { updateNodeData } = useReactFlow()
  const node = useNodesData(cardId)
  const d = (node?.data ?? {}) as CardData
  const notes = d.notes ?? []
  const full = notes.length >= 50
  const refs = d.refs ?? []
  const [reply, setReply] = useState('')
  const [attaching, setAttaching] = useState(false)
  const [query, setQuery] = useState('')
  const [reading, setReading] = useState<CorkRef | null>(null)
  const scenes = useWorkspace((s) => s.scenes)
  const worldPages = useWorkspace((s) => s.worldPages)

  // attach-search candidates over scenes + world pages (already in the store), excluding what's attached. `pageKind`
  // carries the finer type through to the chip color (scene, or the world category: character/location/…).
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const have = new Set(refs.map((r) => r.id))
    const sceneHits = scenes.filter((s) => !have.has(s.path) && s.title.toLowerCase().includes(q)).slice(0, 5).map((s) => ({ kind: 'scene' as const, id: s.path, label: s.title, pageKind: 'scene' }))
    const pageHits = worldPages.filter((p) => !have.has(p.path) && p.name.toLowerCase().includes(q)).slice(0, 5).map((p) => ({ kind: 'page' as const, id: p.path, label: p.name, pageKind: p.kind }))
    return [...sceneHits, ...pageHits].slice(0, 8)
  }, [query, scenes, worldPages, refs])

  const addNote = (): void => {
    const text = reply.trim().slice(0, 280)
    if (!text || full) return
    updateNodeData(cardId, { notes: [...notes, { id: crypto.randomUUID(), text, createdAt: Date.now() }] })
    setReply('')
  }
  const deleteNote = (nid: string): void => updateNodeData(cardId, { notes: notes.filter((n) => n.id !== nid) })
  const clearNotes = (): void => updateNodeData(cardId, { notes: [] })
  const clearRefs = (): void => updateNodeData(cardId, { refs: [] })
  const refsFull = refs.length >= MAX_CORK_CARD_REFS
  const addRef = (ref: CorkRef): void => {
    if (refsFull) return
    updateNodeData(cardId, { refs: [...refs, ref] })
    setQuery('')
    setAttaching(false)
  }
  const removeRef = (rid: string): void => updateNodeData(cardId, { refs: refs.filter((r) => r.id !== rid) })
  // make a link the "priority" (first) — it leads the chip row and, later, gets the expanded preview
  const promoteRef = (rid: string): void => {
    const hit = refs.find((r) => r.id === rid)
    if (hit) updateNodeData(cardId, { refs: [hit, ...refs.filter((r) => r.id !== rid)] })
  }
  // resolve a stored ref to what PageReadDialog needs — the LIVE item (real kind/title), else a "missing" read
  const readTarget = reading
    ? (() => {
        const scene = scenes.find((s) => s.path === reading.id)
        if (scene) return { path: scene.path, kind: 'scene', title: scene.title, missing: false }
        const page = worldPages.find((p) => p.path === reading.id)
        if (page) return { path: page.path, kind: page.kind, title: page.name, missing: false }
        return { path: reading.id, kind: 'scene', title: reading.label ?? 'Page', missing: true }
      })()
    : null

  if (!node)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-faint">
        <span className="flex-1">Card removed.</span>
        <button onClick={onClose} title="Remove from feed" className="hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
    )

  return (
    <div className={cn('rounded-lg border bg-panel-soft/30 transition-colors', selected ? 'border-thread ring-1 ring-thread/40' : 'border-border')}>
      <div className="flex items-center gap-2 rounded-t-lg border-b border-border/60 px-3 py-2" style={{ backgroundColor: headerTintOf(d.color) }}>
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color ? swatch(d.color) : 'var(--border)' }} />
        {/* the card's headline — the fast-scan identity ("Childe is a secret Fatui"), renamable here or on the card */}
        <input
          value={d.title ?? ''}
          onChange={(e) => updateNodeData(cardId, { title: e.target.value.slice(0, MAX_CORK_TITLE) })}
          maxLength={MAX_CORK_TITLE}
          placeholder="Untitled card"
          className="min-w-0 flex-1 truncate bg-transparent text-[13px] font-medium text-foreground outline-none placeholder:font-normal placeholder:text-faint"
        />
        <button onClick={onClose} title="Remove from feed" className="shrink-0 text-faint transition-colors hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      {/* attached refs (scenes/pages) as kind-colored chips + attach search. First chip = priority (⭐, promotable). */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/40 px-2.5 py-1.5">
        {refs.map((r, i) => (
          <RefChip key={r.id} r={r} priority={i === 0 && refs.length > 1} onOpen={() => setReading(r)} onRemove={() => removeRef(r.id)} onPromote={() => promoteRef(r.id)} />
        ))}
        {refs.length > 1 && (
          <button onClick={clearRefs} title="Remove all links" className="text-[10px] text-faint transition-colors hover:text-flag">
            Clear
          </button>
        )}
        {refsFull ? (
          <span className="text-[10px] text-faint">{MAX_CORK_CARD_REFS} links max</span>
        ) : attaching ? (
          <div className="relative">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => window.setTimeout(() => setAttaching(false), 150)}
              placeholder="Search pages…"
              className="w-40 rounded border border-border bg-canvas px-1.5 py-0.5 text-[11px] outline-none"
            />
            {candidates.length > 0 && (
              <div className="absolute left-0 top-full z-20 mt-0.5 max-h-40 w-56 overflow-y-auto rounded-md border border-border bg-panel shadow-xl">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addRef(c)
                    }}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-panel-soft"
                  >
                    <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: `var(${chipColorVar(c)})` }} />
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <span className="shrink-0 text-[9px] uppercase text-faint">{c.pageKind}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button onClick={() => setAttaching(true)} title="Attach a page" className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-faint transition-colors hover:text-foreground">
            <Paperclip className="size-2.5" /> Attach
          </button>
        )}
      </div>
      <div className="space-y-2 p-2.5">
        {notes.length > 1 && (
          <div className="flex items-center justify-end">
            <button onClick={clearNotes} title="Delete all notes" className="text-[10px] text-faint transition-colors hover:text-flag">
              Clear all
            </button>
          </div>
        )}
        {notes.length === 0 ? (
          <div className="text-xs text-faint">No notes yet — add one below.</div>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="group rounded-md border border-border bg-canvas/40 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] text-faint">
                <span>{timeAgo(n.createdAt) || 'note'}</span>
                <button onClick={() => deleteNote(n.id)} title="Delete note" className="ml-auto opacity-0 transition-opacity hover:text-flag group-hover:opacity-100">
                  <Trash2 className="size-3" />
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap wrap-break-word text-[12.5px] leading-snug text-foreground">{n.text}</p>
            </div>
          ))
        )}
        <div className="rounded-md border border-border bg-canvas focus-within:border-thread/50">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value.slice(0, 280))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                addNote()
              }
            }}
            placeholder={full ? 'Note limit reached (50)' : 'Add a note… (⌘↵)'}
            disabled={full}
            maxLength={280}
            rows={2}
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-[12.5px] leading-snug text-foreground outline-none placeholder:text-faint disabled:opacity-50"
          />
          <div className="flex items-center justify-between border-t border-border/60 px-2 py-1">
            <span className="text-[10px] tabular-nums text-faint">{reply.length}/280</span>
            <button onClick={addNote} disabled={!reply.trim() || full} title="Add note (⌘↵)" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-thread transition-colors hover:bg-thread/10 disabled:opacity-40">
              <Send className="size-3.5" /> Add
            </button>
          </div>
        </div>
      </div>
      {readTarget && (
        <PageReadDialog path={readTarget.path} kind={readTarget.kind} title={readTarget.title} missing={readTarget.missing} onClose={() => setReading(null)} />
      )}
    </div>
  )
}

function CorkboardHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Corkboard — how it works" size="detail">
      <div className="space-y-5">
        <HelpSection title="Add & edit">
          <HelpTable
            rows={[
              ['Right-click the board', 'Add a card where you click'],
              ['Type in the card header', 'Name it — a headline like “Childe is a secret Fatui”'],
              ['Double-click a card', 'Open it as a post in the feed — add notes, attach pages'],
              ['Drag the header grip', 'Move a card'],
              ['Drag a corner', 'Resize a card'],
              ['Hover → ×', 'Delete a card']
            ]}
          />
        </HelpSection>
        <HelpSection title="Link pages">
          <HelpTable
            rows={[
              ['Attach (in a post)', 'Search scenes & world pages — chips are colored by type'],
              ['⭐ on a chip', 'Make it the priority link (leads the row)'],
              ['Click a chip', 'Open that scene/page']
            ]}
          />
        </HelpSection>
        <HelpSection title="Connect">
          <HelpTable
            rows={[
              ['Right dot → a card', 'Draw a connection — release anywhere on the target card'],
              ['Select a group → Connect all to', 'Link every selected card to one target (many-to-one)']
            ]}
          />
        </HelpSection>
        <HelpSection title="Select a group">
          <HelpTable
            rows={[
              ['⇧ drag', 'Draw a selection box — any card the box touches is picked up'],
              ['Group float (top-right)', 'Connect all to · Set group color · Delete'],
              ['Backspace / Delete', 'Remove the selection']
            ]}
          />
        </HelpSection>
        <HelpSection title="Boards">
          <HelpTable
            rows={[
              ['Left sidebar', 'Switch, rename, or delete boards'],
              ['100 cards · 100 boards', 'Open another board when one fills up']
            ]}
          />
        </HelpSection>
      </div>
    </Dialog>
  )
}
