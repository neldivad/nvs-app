/**
 * FloatWindow — the reusable non-modal floating window (draggable top grip + resizable BR grip),
 * extracted from the old ChatFloat so every right-side surface (chat, threads, …) shares one behavior.
 * Vanilla pointer events (no framer-motion). Overlays the editor at z-30; modal dialogs (z-50) dim it.
 *
 * Content owns its own chrome; pass `title`/`onClose` only when the content has no header of its own
 * (chat brings its own header; threads doesn't) — then the drag grip becomes a titled bar with a close.
 */
import { useEffect, useRef, useState, type ReactNode, type JSX } from 'react';
import { GripHorizontal, X } from 'lucide-react'
import { useFloat, useFrontFloat, bringFloatToFront } from '@/lib/editor/escapeStack'
import { regionAttrs, type RegionId } from '@/config/regions'

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Remembers each float's box across close→reopen (keyed by persistKey; session-lifetime, in-memory). */
const boxCache = new Map<string, Box>()

export function FloatWindow({
  initial,
  title,
  onClose,
  onEscape,
  persistKey,
  accent,
  region,
  minWidth = 300,
  maxWidth = 720,
  maxHeight,
  children
}: {
  initial: () => Box
  title?: string
  onClose?: () => void
  onEscape?: () => void // dismissed by Esc (recency-ordered across floats)
  persistKey?: string // remember move/resize across reopen
  accent?: string // a CSS color — tints the title bar + border so each float reads as distinct
  region?: RegionId // debug-boundary + wizard tag (falls back to Float:<persistKey>)
  minWidth?: number
  maxWidth?: number
  maxHeight?: number // cap the resize height (px); default = viewport-bounded only
  children: ReactNode
}): JSX.Element {
  const [box, setBox] = useState<Box>(() => (persistKey ? boxCache.get(persistKey) : undefined) ?? initial())
  useEffect(() => {
    if (persistKey) boxCache.set(persistKey, box)
  }, [box, persistKey])
  // One stack for focus + Esc: registering puts this float front-most (open-to-front) and makes it the
  // Esc target; clicking re-fronts it. Front-most renders at z-40 (others z-30), below modals (z-50).
  useFloat(persistKey, onEscape)
  const drag = useRef<{ mx: number; my: number; left: number; top: number } | null>(null)

  const front = useFrontFloat()
  const onTop = !!persistKey && front === persistKey
  const toFront = (): void => {
    if (persistKey) bringFloatToFront(persistKey)
  }

  const startDrag = (e: React.PointerEvent): void => {
    drag.current = { mx: e.clientX, my: e.clientY, left: box.left, top: box.top }
    const move = (ev: PointerEvent): void => {
      const d = drag.current
      if (!d) return
      // Compute outside the updater — the updater must stay pure (StrictMode re-invokes it).
      const left = clamp(d.left + (ev.clientX - d.mx), 0, window.innerWidth - 80)
      const top = clamp(d.top + (ev.clientY - d.my), 0, window.innerHeight - 40)
      setBox((b) => ({ ...b, left, top }))
    }
    const up = (): void => {
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Resize from any of the free edges/corners (`dir`): 'e'/'w' change width (w also moves the left edge, keeping the
  // RIGHT edge fixed), 's' changes height; corners combine. Top is the drag bar, so no 'n'.
  const startResize = (e: React.PointerEvent, dir: 'e' | 'w' | 's' | 'se' | 'sw'): void => {
    e.stopPropagation()
    toFront() // grips stop propagation, so bring to front explicitly
    const start = { mx: e.clientX, my: e.clientY, box: { ...box } }
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - start.mx
      const dy = ev.clientY - start.my
      setBox(() => {
        const s = start.box
        let { left, width } = s
        const height = dir.includes('s') ? clamp(s.height + dy, 240, Math.min(maxHeight ?? Infinity, window.innerHeight - s.top - 8)) : s.height
        if (dir.includes('e')) width = clamp(s.width + dx, minWidth, Math.min(maxWidth, window.innerWidth - s.left - 8))
        if (dir.includes('w')) {
          const right = s.left + s.width // dragging the left edge keeps the right edge put
          left = clamp(s.left + dx, 0, right - minWidth)
          width = right - left
          if (width > maxWidth) { width = maxWidth; left = right - maxWidth }
        }
        return { left, top: s.top, width, height }
      })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      onPointerDown={toFront}
      {...(region ? regionAttrs(region) : { 'data-region': persistKey ? `Float:${persistKey}` : 'Float' })}
      className="fixed flex flex-col overflow-hidden rounded-lg border border-border bg-canvas shadow-2xl"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        zIndex: onTop ? 40 : 30,
        ...(accent ? { borderColor: `color-mix(in oklab, ${accent} 35%, var(--border))` } : {})
      }}
    >
      <div
        onPointerDown={startDrag}
        className="flex h-5 shrink-0 cursor-grab items-center gap-1 border-b border-border bg-panel px-1.5 active:cursor-grabbing"
        style={accent ? { background: `color-mix(in oklab, ${accent} 14%, var(--panel))`, borderBottomColor: `color-mix(in oklab, ${accent} 45%, var(--border))` } : undefined}
        title="Drag to move"
      >
        {title ? (
          <>
            <GripHorizontal className="size-3 shrink-0 text-faint" />
            <span className="truncate text-[11px] font-medium text-muted-foreground">{title}</span>
            {onClose && (
              <button
                onClick={onClose}
                onPointerDown={(e) => e.stopPropagation()}
                title="Close"
                className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-panel-soft"
              >
                <X className="size-3" />
              </button>
            )}
          </>
        ) : (
          <GripHorizontal className="mx-auto size-3 text-faint" />
        )}
      </div>
      {/* flex-col so a flex-1 child (e.g. CoherenceReview) gets bounded height and scrolls instead of overflowing.
          select-text: the app sets user-select:none for chrome (globals.css); float CONTENT is readable copy. */}
      <div className="flex min-h-0 flex-1 select-text flex-col">{children}</div>
      {/* Resize handles — left / right / bottom edges + the two bottom corners (top is the drag bar). The edge
          strips are thin invisible hit-targets; the bottom-right keeps the visible corner grip. */}
      <div onPointerDown={(e) => startResize(e, 'e')} className="absolute right-0 top-5 bottom-2 z-10 w-1.5 cursor-ew-resize" title="Drag to resize" />
      <div onPointerDown={(e) => startResize(e, 'w')} className="absolute left-0 top-5 bottom-2 z-10 w-1.5 cursor-ew-resize" title="Drag to resize" />
      <div onPointerDown={(e) => startResize(e, 's')} className="absolute bottom-0 left-2 right-2 z-10 h-1.5 cursor-ns-resize" title="Drag to resize" />
      <div onPointerDown={(e) => startResize(e, 'sw')} className="absolute bottom-0 left-0 z-10 size-3 cursor-nesw-resize" title="Drag to resize" />
      <div
        onPointerDown={(e) => startResize(e, 'se')}
        className="absolute bottom-0 right-0 z-10 size-3.5 cursor-nwse-resize"
        title="Drag to resize"
        style={{ background: 'linear-gradient(135deg, transparent 50%, var(--faint) 50%)' }}
      />
    </div>
  )
}
