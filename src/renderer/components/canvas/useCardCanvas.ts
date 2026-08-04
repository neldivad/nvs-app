/**
 * Shared canvas interaction preset for the card surfaces (corkboard + timeline). Returns the ReactFlow props both
 * spread, so their interaction UX stays identical:
 *  - brush-select (SelectionMode.Partial + shift-drag box),
 *  - a generous edge hit target,
 *  - QUICK-CONNECT: releasing a connector ANYWHERE over a card connects to it — no need to hit the handle.
 * `connect(source, target)` is the surface's OWN edge-create (it dedupes / cycle-checks): corkboard adds to its
 * store, timeline calls `link`.
 *
 * CONNECTION DIRECTION — the ONE definition both surfaces share, so timeline and corkboard can't drift. We never
 * pass xyflow's `onConnect` (it would fire a SECOND, reversed edge in the same gesture — a 2-way cycle that slips
 * past a per-edge cycle-check). Creation goes through `onConnectEnd` only, and the single edge is normalized
 * OUT→IN by the STARTING handle's role:
 *   - start on a SOURCE (out / right) handle → edge runs fromNode → toNode   (the drag direction)
 *   - start on a TARGET (in / left) handle   → edge runs toNode → fromNode   (reversed)
 * i.e. always "out-handle → in-handle", regardless of which end you grab, and regardless of whether you release on
 * the far handle or anywhere over the card (quick-connect — only `fromHandle` is guaranteed known). One handler =
 * one edge = correct. `connect(source, target)` is the surface's OWN edge-create (dedupe / cycle-check): corkboard
 * adds to its store, timeline calls `link`.
 */
import { useCallback } from 'react'
import { SelectionMode, type DefaultEdgeOptions, type FinalConnectionState } from '@xyflow/react'

/**
 * The ONE connection-direction rule, shared by every card surface — normalize a completed gesture to OUT→IN:
 * start on a SOURCE (out/right) handle → fromNode→toNode; start on a TARGET (in/left) handle → toNode→fromNode.
 *
 * `fallbackToId` is the card the pointer RELEASED OVER when xyflow snapped to no handle (a body-drop beyond
 * `connectionRadius` — the card's handles sit at its far edges, so a release near the center is out of range).
 * Preferring xyflow's `toNode` but falling back to it keeps "release anywhere over a card connects to it" true
 * for wide cards. Returns null when neither resolves a target, or it's a self-connect. Pure → unit-testable.
 */
export function connectionDirection(
  conn: {
    fromNode?: { id: string } | null
    toNode?: { id: string } | null
    fromHandle?: { type?: string } | null
  },
  fallbackToId?: string | null
): { source: string; target: string } | null {
  const from = conn.fromNode?.id
  const to = conn.toNode?.id ?? fallbackToId ?? undefined
  if (!from || !to || from === to) return null
  return conn.fromHandle?.type === 'target' ? { source: to, target: from } : { source: from, target: to }
}

/** The id of the card the pointer released over — approximates a body-drop that snapped to no handle. */
function nodeIdAtPointer(e: MouseEvent | TouchEvent): string | undefined {
  const pt = 'changedTouches' in e ? e.changedTouches[0] : e
  if (!pt || typeof document === 'undefined') return undefined
  const node = document.elementFromPoint(pt.clientX, pt.clientY)?.closest<HTMLElement>('.react-flow__node')
  return node?.dataset.id ?? undefined
}

export interface CardCanvasProps {
  selectionMode: SelectionMode
  deleteKeyCode: string[]
  connectionRadius: number
  defaultEdgeOptions: DefaultEdgeOptions
  onlyRenderVisibleElements: boolean
  proOptions: { hideAttribution: boolean }
  onConnectEnd: (e: MouseEvent | TouchEvent, conn: FinalConnectionState) => void
}

export function useCardCanvas(connect: (source: string | null | undefined, target: string | null | undefined) => void): CardCanvasProps {
  const onConnectEnd = useCallback(
    (e: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
      const dir = connectionDirection(conn, nodeIdAtPointer(e)) // xyflow's snapped node, else the card under the pointer
      if (dir) connect(dir.source, dir.target)
    },
    [connect]
  )
  return {
    selectionMode: SelectionMode.Partial,
    deleteKeyCode: ['Backspace', 'Delete'],
    connectionRadius: 44, // release near a card's in-handle snaps to it
    defaultEdgeOptions: { interactionWidth: 18 }, // generous click target so stray edges are selectable
    onlyRenderVisibleElements: true,
    proOptions: { hideAttribution: true },
    onConnectEnd
  }
}
