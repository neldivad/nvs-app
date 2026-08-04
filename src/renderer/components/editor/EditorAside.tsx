/**
 * EditorAside — the shared shell for the editor's right-hand asides (the world-page Outline and the scene
 * Inspector), so the two share one layout, one resize behaviour, and one place to evolve them. It owns:
 *   • a draggable left edge to resize, width persisted per `widthKey` (clamped MIN..MAX);
 *   • the border / panel background / vertical scroll;
 *   • an optional title header.
 * Children render the actual content. `selectable` opts the content OUT of the app-chrome `user-select: none`
 * so summaries/labels can be highlighted and copied (nav-style asides stay unselectable).
 */
import { useCallback, useRef, useState, type JSX } from 'react'
import { cn } from '@/lib/utils'
import { regionAttrs, type RegionId } from '@/config/regions'

const MIN = 200
const MAX = 520

export function EditorAside({
  title,
  action,
  widthKey,
  defaultWidth = 240,
  selectable = false,
  region,
  children
}: {
  title?: string
  /** Optional control rendered at the right of the title header (e.g. the inspector's declutter toggle). */
  action?: React.ReactNode
  widthKey: string
  defaultWidth?: number
  selectable?: boolean
  /** Tag this aside's root for the Ctrl+Alt+D region overlay (e.g. `sceneInspector`). */
  region?: RegionId
  children: React.ReactNode
}): JSX.Element {
  const [width, setWidth] = useState(() => {
    const v = Number(localStorage.getItem(widthKey))
    return v >= MIN && v <= MAX ? v : defaultWidth
  })
  const drag = useRef<{ startX: number; startW: number } | null>(null)

  const onMove = useCallback((e: MouseEvent): void => {
    if (!drag.current) return
    // Aside is on the RIGHT, so dragging the left edge leftward (negative dx) widens it.
    const next = Math.min(MAX, Math.max(MIN, drag.current.startW - (e.clientX - drag.current.startX)))
    setWidth(next)
  }, [])

  const onUp = useCallback((): void => {
    drag.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    setWidth((w) => { try { localStorage.setItem(widthKey, String(w)) } catch { /* ignore */ } return w })
  }, [onMove, widthKey])

  const startResize = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    drag.current = { startX: e.clientX, startW: width }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none' // don't select text mid-drag
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width, onMove, onUp])

  return (
    <aside
      {...(region ? regionAttrs(region) : {})}
      style={{ width }}
      className={cn('relative flex shrink-0 flex-col border-l border-border bg-panel/40', selectable ? 'select-text' : 'select-none')}
    >
      {/* resize grip: a thin hot-zone straddling the left border */}
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-thread/30"
      />
      {(title || action) && (
        <div className="flex shrink-0 items-center justify-between px-3 py-2">
          {title && <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{title}</span>}
          {action}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </aside>
  )
}
