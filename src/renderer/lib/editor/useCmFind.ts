/**
 * useCmFind — wires the shared <FindBar> to a CodeMirror view (world-page write, Source tab). Owns the bar's
 * open/query/count state and the ⌘F handler; delegates the actual search to cmFind.ts. The host renders <FindBar>
 * from the returned values and spreads `onKeyDown` on the editor container. The host's CM must include `search()`
 * (for the query state + selection-match highlight) but must NOT bind searchKeymap's ⌘F, so only this bar opens.
 */
import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import type { EditorView } from '@codemirror/view'
import { cmSetQuery, cmStep, cmClear, cmFindInfo, cmMarkers, cmGoto } from './cmFind'

export function useCmFind(getView: () => EditorView | null): {
  open: boolean
  query: string
  count: number
  active: number
  markers: { pos: number; active: boolean }[]
  inputRef: React.RefObject<HTMLInputElement | null>
  onQueryChange: (q: string) => void
  step: (dir: 1 | -1) => void
  goto: (index: number) => void
  close: () => void
  onKeyDown: (e: KeyboardEvent) => void
} {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [info, setInfo] = useState({ count: 0, active: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  const onQueryChange = useCallback((q: string) => {
    setQuery(q)
    const v = getView()
    if (!v) return
    cmSetQuery(v, q) // sets query, highlights all, jumps to first
    setInfo(cmFindInfo(v))
  }, [getView])

  const step = useCallback((dir: 1 | -1) => {
    const v = getView()
    if (!v) return
    cmStep(v, dir)
    setInfo(cmFindInfo(v))
  }, [getView])

  const goto = useCallback((index: number) => {
    const v = getView()
    if (!v) return
    cmGoto(v, index)
    setInfo(cmFindInfo(v))
  }, [getView])

  const openFind = useCallback(() => {
    setOpen(true)
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    const v = getView()
    if (v) { cmClear(v); v.focus() }
  }, [getView])

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') { e.preventDefault(); openFind() }
  }, [openFind])

  const v = getView()
  const markers = v ? cmMarkers(v) : [] // recomputed each render (after every info change) — small match sets, cheap

  return { open, query, count: info.count, active: info.active, markers, inputRef, onQueryChange, step, goto, close, onKeyDown }
}
