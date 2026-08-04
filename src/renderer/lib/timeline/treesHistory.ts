/**
 * treesHistory — bounded undo/redo for the timeline's `trees.json` state (the graph + canvas of every variant).
 * The store records every `trees` change here (via a subscription — no per-mutation wiring), so ONE helper gives
 * undo/redo for the whole timeline. Memory is kept small three ways:
 *   1. Structural sharing — snapshots are the immutable `TreesFile` objects the ops already build, so unchanged
 *      variants/adjacency/nodes are the SAME references across entries (a 1000-scene project isn't copied per edit).
 *   2. Coalescing — a run of pure position-moves (dragging cards, only x/y changing) collapses into ONE entry, so
 *      nudging never floods the stack.
 *   3. A hard cap on entries.
 */
import type { TreesFile, TimelineNode } from '@shared/ipc'

/** True when b differs from a ONLY in node x/y (a drag) — same variants, adjacency, membership, collapse, colors. */
export function isPurePositionChange(a: TreesFile, b: TreesFile): boolean {
  if (a === b || a.variants.length !== b.variants.length) return false
  let moved = false // at least one node's x/y actually differs
  for (let i = 0; i < a.variants.length; i++) {
    const va = a.variants[i]
    const vb = b.variants[i]
    if (va === vb) continue
    // Any non-node field changing (or a reordered variant) → structural, not a pure move.
    if (
      va.id !== vb.id ||
      va.adjacency !== vb.adjacency ||
      va.collapsed !== vb.collapsed ||
      va.sequences !== vb.sequences ||
      va.cellColors !== vb.cellColors
    ) return false
    const na: TimelineNode[] = va.nodes ?? []
    const nb: TimelineNode[] = vb.nodes ?? []
    if (na.length !== nb.length) return false // add/remove is structural
    for (let j = 0; j < na.length; j++) {
      const x = na[j]
      const y = nb[j]
      if (x.kind !== y.kind) return false
      if (x.kind === 'scene' && y.kind === 'scene' && x.sceneId !== y.sceneId) return false
      if (x.kind === 'folder' && y.kind === 'folder' && x.folderRel !== y.folderRel) return false
      if (x.x !== y.x || x.y !== y.y) moved = true // the move we're coalescing
    }
  }
  return moved
}

export class TreesHistory {
  private undo: TreesFile[] = []
  private redo: TreesFile[] = []
  private lastWasPosition = false
  constructor(private readonly cap = 80) {}

  /** Record a committed change (prev → next). Coalesces consecutive pure-position moves into the prior entry. */
  record(prev: TreesFile, next: TreesFile): void {
    const pos = isPurePositionChange(prev, next)
    if (pos && this.lastWasPosition) {
      // keep the existing undo point (it predates this drag run) — don't grow the stack
    } else {
      this.undo.push(prev)
      if (this.undo.length > this.cap) this.undo.shift()
      this.redo = []
    }
    this.lastWasPosition = pos
  }

  canUndo(): boolean { return this.undo.length > 0 }
  canRedo(): boolean { return this.redo.length > 0 }

  /** Pop an undo state to apply; pushes `current` onto the redo stack. Null when nothing to undo. */
  popUndo(current: TreesFile): TreesFile | null {
    const prev = this.undo.pop()
    if (prev === undefined) return null
    this.redo.push(current)
    this.lastWasPosition = false
    return prev
  }

  /** Pop a redo state to apply; pushes `current` onto the undo stack. Null when nothing to redo. */
  popRedo(current: TreesFile): TreesFile | null {
    const next = this.redo.pop()
    if (next === undefined) return null
    this.undo.push(current)
    this.lastWasPosition = false
    return next
  }

  reset(): void {
    this.undo = []
    this.redo = []
    this.lastWasPosition = false
  }
}
