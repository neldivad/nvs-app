/**
 * The ⌘S dispatch stack — the escapeStack pattern applied to SAVE. Any editable surface (scene editor,
 * custody Records form, Source tab, …) registers its save handler while mounted; AppShell binds the
 * hotkey once (config/hotkeys.ts `save`) and calls the TOP of the stack. No per-page keydown listeners,
 * so two mounted editors can never double-save one keypress.
 */
import { useEffect, useRef } from 'react'

let stack: { save: () => void; isDirty?: () => boolean }[] = []

/**
 * Register while `active`; the most recently mounted active target wins ⌘S. Pass `isDirty` so the exit guards
 * (return-to-library / quit) can see THIS surface's unsaved state, not just the scene buffer (see anyDirty).
 */
export function useSaveTarget(active: boolean, save: () => void, isDirty?: () => boolean): void {
  const ref = useRef(save)
  ref.current = save
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty
  useEffect(() => {
    if (!active) return
    const entry = { save: () => ref.current(), isDirty: () => dirtyRef.current?.() ?? false }
    stack.push(entry)
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}

/** True if ANY mounted save target reports unsaved edits — broadens the scene-only `sceneDirty` for exit guards. */
export function anyDirty(): boolean {
  return stack.some((t) => t.isDirty?.())
}

/** Fire the save handler of every DIRTY registered target (custody Records, …). Used by the navigation guard's
 *  "Save" so leaving a page flushes non-scene surfaces too. Targets without an isDirty probe (the scene editor,
 *  covered separately by sceneDirty/saveScene) are skipped, so the scene never double-saves. */
export function saveAllDirty(): void {
  stack.forEach((t) => { if (t.isDirty?.()) t.save() })
}

/** Dispatch ⌘S to the top target. Returns false when nothing is registered (let the browser default be). */
export function dispatchSave(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.save()
  return true
}

// ── Undo/redo — the same stack pattern for PAGE-LEVEL history (e.g. custody records rows). ──
// Native text editing keeps the browser/editor's own undo; AppShell only dispatches here when the
// event target is NOT an editable element.
let editStack: { undo: () => void; redo: () => void }[] = []

/** Register a page-level history while `active`; the most recent active target wins ⌘Z / ⇧⌘Z. */
export function useUndoTarget(active: boolean, handlers: { undo: () => void; redo: () => void }): void {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    if (!active) return
    const entry = { undo: () => ref.current.undo(), redo: () => ref.current.redo() }
    editStack.push(entry)
    return () => {
      const i = editStack.indexOf(entry)
      if (i >= 0) editStack.splice(i, 1)
    }
  }, [active])
}

export function dispatchUndo(): boolean {
  const top = editStack[editStack.length - 1]
  if (!top) return false
  top.undo()
  return true
}

export function dispatchRedo(): boolean {
  const top = editStack[editStack.length - 1]
  if (!top) return false
  top.redo()
  return true
}

// ── Page tabs — the same register-while-mounted stack for FUNCTION-KEY tab switching. A paged surface
// (PageShell: scene/world write·preview·source → F1–F3; custody chart·records·write·preview·source → F1–F5)
// registers its tab list + switch handler; AppShell binds F1–F9 once and dispatches to the TOP target. So the
// F-keys "just work" on whatever page is up, with no per-page keydown listener. ──
let tabStack: { count: () => number; select: (i: number) => void }[] = []

/** Register the active page's tab controller while `active`; the most recently mounted page wins the F-keys. */
export function useTabTarget(active: boolean, count: number, select: (i: number) => void): void {
  const selRef = useRef(select)
  selRef.current = select
  const cntRef = useRef(count) // live tab count (custody 5, scene/world 3) — read at dispatch, not capture time
  cntRef.current = count
  useEffect(() => {
    if (!active) return
    const entry = { count: () => cntRef.current, select: (i: number) => selRef.current(i) }
    tabStack.push(entry)
    return () => {
      const i = tabStack.indexOf(entry)
      if (i >= 0) tabStack.splice(i, 1)
    }
  }, [active])
}

/** Dispatch a 0-based tab index (F1→0, F2→1, …) to the top paged surface. False if none is mounted or the
 *  index is past its tab count — the caller then lets the key fall through (e.g. F1 → pane help). */
export function dispatchTab(index: number): boolean {
  const top = tabStack[tabStack.length - 1]
  if (!top || index < 0 || index >= top.count()) return false
  top.select(index)
  return true
}
