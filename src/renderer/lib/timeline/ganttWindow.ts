/**
 * ganttWindow — the ONE compression mechanism every gantt rail (Threads · Custody · Cast · Arcs · Entities ·
 * Lore · Coherence) shares, so a hundreds-of-rows × hundreds-of-columns board stays legible.
 *
 * The insight: column-windowing and row-relevance are the SAME lever. Rails already build their markers from a
 * `colOf` map and drop scenes not in it. So if `colOf` is the WINDOW's map (not the whole axis), columns window,
 * off-window markers vanish, and filtering rows to "touches a visible column" drops the now-irrelevant rows —
 * REACTIVELY, no rebuild button. Rows are derived from the visible columns, so they can't outlive them.
 *
 *   useGanttWindow(fullCols) → the windowed { cols, colOf } + the scene-range state (auto-windows a long axis).
 *   scopeRows(rows, scenesOf, colOf, cap) → rows relevant to the window, stable order, capped to `cap`.
 *
 * The <RailScaleBar> renders the slider + row-cap control from these. Rail-specific lane building is untouched
 * (it already keys off colOf, so it windows for free).
 */
import { useMemo, useState } from 'react'

/** Scenes shown at once before the range slider appears (matches the Cast rail's window). */
export const GANTT_WINDOW = 200
/** Rows per PAGE. We paginate, never accumulate — the DOM is bounded to one page no matter how many rows exist,
 *  so there's no "show all" rope to render thousands of rows. */
export const GANTT_PAGE = 60

export interface GanttWindow<T> {
  cols: T[] // the WINDOWED columns — pass straight to LifecycleGantt
  colOf: Map<string, number> // sceneId → index within `cols` (the rails' marker positions)
  full: number // fullCols.length — the whole axis
  lo: number
  hi: number
  windowable: boolean // >1 scene → offer the slider (you can narrow ANY multi-scene work, à la the Cast rail)
  auto: boolean // the window is at its default (a long axis auto-showing the first `windowSize`), not user-set
  range: [number, number] | null
  setRange: (r: [number, number] | null) => void
}

export function useGanttWindow<T extends { sceneId: string }>(fullCols: readonly T[], windowSize = GANTT_WINDOW): GanttWindow<T> {
  const [range, setRange] = useState<[number, number] | null>(null)
  return useMemo(() => {
    const lastCol = Math.max(0, fullCols.length - 1)
    const big = fullCols.length > windowSize // a long axis defaults to the first `windowSize` scenes…
    const lo = range ? Math.max(0, Math.min(range[0], lastCol)) : 0
    const hi = range ? Math.min(range[1], lastCol) : Math.min(lastCol, windowSize - 1) // …but a drag can extend past it
    const cols = big || range ? fullCols.slice(lo, hi + 1) : [...fullCols]
    const colOf = new Map(cols.map((s, i) => [s.sceneId, i]))
    return { cols, colOf, full: fullCols.length, lo, hi, windowable: fullCols.length > 1, auto: !range && big, range, setRange }
  }, [fullCols, range, windowSize])
}

export interface ScopedRows<R> {
  shown: R[] // exactly one PAGE of rows to render (≤ size) — the render is bounded no matter the total
  total: number // rows relevant to the window, across all pages — for "N–M of TOTAL"
  page: number // the CLAMPED current page (0-based); may differ from the requested page after a filter shrinks the set
  pageCount: number
  from: number // 1-based index of the first shown row (0 when empty)
  to: number // 1-based index of the last shown row
}

/**
 * Rows relevant to the visible columns, PAGINATED. `scenesOf` yields the scene_ids a row touches; a row survives
 * only if one lands in `colOf` (the window). Input order is preserved (stable), so a caller that pre-sorts keeps
 * its order and rows enter/leave at the edges as the window scrubs — not a reshuffle. Returns ONE page (never the
 * whole set — no "show all"): `page` is clamped to a valid range so a stale page after a filter self-corrects.
 */
export function scopeRows<R>(
  rows: readonly R[],
  scenesOf: (r: R) => Iterable<string>,
  colOf: ReadonlyMap<string, number>,
  page: number,
  size: number = GANTT_PAGE
): ScopedRows<R> {
  const relevant = rows.filter((r) => {
    for (const sid of scenesOf(r)) if (colOf.has(sid)) return true
    return false
  })
  return paginate(relevant, page, size)
}

/** Just the pagination half of scopeRows — for rows already filtered to the window by other means (e.g. Custody
 *  clips its lanes to the visible span itself, so relevance is done and only the page bound remains). */
export function paginate<R>(rows: readonly R[], page: number, size: number = GANTT_PAGE): ScopedRows<R> {
  const pageCount = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(Math.max(0, Math.floor(page)), pageCount - 1)
  const start = p * size
  const shown = rows.slice(start, start + size)
  return { shown: [...shown], total: rows.length, page: p, pageCount, from: rows.length ? start + 1 : 0, to: start + shown.length }
}
