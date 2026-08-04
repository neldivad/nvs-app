/**
 * Float focus + Escape coordination — ONE order for both stacking and dismissal (Windows-like).
 *
 * Open floats live in a single recency list (last = front-most). Opening a float or clicking it moves
 * it to the front; the front-most renders on top (z-40 via `useFrontFloat`, vs z-30) AND is the one
 * Escape dismisses first. Modals (Dialog / PageReadDialog / popovers via `useModalOpen`) take priority:
 * while any modal is up it owns Escape, and floats resume once it's gone.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'

interface Entry {
  key: string
  close?: () => void // the float's Esc handler (absent → not Esc-dismissable, but still stacks)
}

let floats: Entry[] = []
let modalCount = 0
let modals: { close: () => void }[] = [] // stack-registered modals (Dialog/PageReadDialog) — top owns Escape
const listeners = new Set<() => void>()
let installed = false

function emit(): void {
  listeners.forEach((l) => l())
}
function frontKey(): string | null {
  return floats.length ? floats[floats.length - 1].key : null
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // Stacked modals close one per press, TOP first — never the whole stack at once.
  if (modals.length > 0) {
    e.preventDefault()
    modals[modals.length - 1].close()
    return
  }
  if (modalCount > 0) return // a self-handling modal (popover/palette) owns Escape while open
  for (let i = floats.length - 1; i >= 0; i--) {
    const close = floats[i].close
    if (close) {
      e.preventDefault()
      close() // dismiss the front-most dismissable float
      return
    }
  }
}
function install(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', onKey)
}

/** A float participates in the front/Esc stack while mounted (front-most on mount); `close` = its Esc handler. */
export function useFloat(key: string | undefined, close?: () => void): void {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!key) return
    const entry: Entry = { key, close: close ? () => ref.current?.() : undefined }
    floats.push(entry)
    install()
    emit()
    return () => {
      const i = floats.indexOf(entry)
      if (i >= 0) floats.splice(i, 1)
      emit()
    }
    // `close` presence is fixed per float; the ref keeps it current without re-registering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** Raise a float to the front (z-order AND Esc priority). Call on click. */
export function bringFloatToFront(key: string): void {
  if (frontKey() === key) return
  const i = floats.findIndex((f) => f.key === key)
  if (i < 0) return
  const [entry] = floats.splice(i, 1)
  floats.push(entry)
  emit()
}

/** The front-most float's key (drives z-order). */
export function useFrontFloat(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    frontKey
  )
}

/**
 * A stacked modal: registers while open, and ESCAPE CLOSES ONLY THE TOP of the stack (one press, one
 * layer). Use this instead of useModalOpen + a local keydown listener — per-modal listeners all fire on
 * the same press, dismissing every stacked modal at once.
 */
export function useModalEscape(open: boolean, close: () => void): void {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!open) return
    const entry = { close: () => ref.current() }
    modals.push(entry)
    modalCount++ // floats keep deferring
    install()
    return () => {
      const i = modals.indexOf(entry)
      if (i >= 0) modals.splice(i, 1)
      modalCount--
    }
  }, [open])
}

/** Mark a modal as open while mounted — floats defer their Escape to it. */
export function useModalOpen(open: boolean): void {
  useEffect(() => {
    if (!open) return
    modalCount++
    return () => {
      modalCount--
    }
  }, [open])
}
