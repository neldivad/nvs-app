/**
 * A dual-thumb range slider — one track, a min and a max handle (two overlaid native range inputs;
 * the `.dual-range` CSS in globals.css makes only the thumbs interactive), PLUS a draggable CENTER
 * band: the edges expand/contract the window, dragging the middle SLIDES it (width preserved). The
 * shared windowing control for every scene-range surface (Cast · Relationships · spines).
 */
import { useRef } from 'react'
import { cn } from '@/lib/utils'

import type { JSX } from "react";

export function RangeSlider({
  min,
  max,
  value,
  onChange,
  className
}: {
  min: number
  max: number
  value: [number, number]
  onChange: (v: [number, number]) => void
  className?: string
}): JSX.Element {
  const [lo, hi] = value
  const span = Math.max(1, max - min)
  const pl = ((lo - min) / span) * 100
  const pr = ((hi - min) / span) * 100
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; lo: number; hi: number } | null>(null)
  return (
    <div ref={trackRef} className={cn('relative h-4', className)}>
      <div className="pointer-events-none absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-border" />
      <div className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-thread" style={{ left: `${pl}%`, right: `${100 - pr}%` }} />
      <input
        type="range"
        min={min}
        max={max}
        value={lo}
        onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
        className="dual-range absolute inset-0 m-0 size-full"
      />
      <input
        type="range"
        min={min}
        max={max}
        value={hi}
        onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
        className="dual-range absolute inset-0 m-0 size-full"
      />
      {/* the SLIDE zone — the filled band between the thumbs (inset so the thumbs stay grabbable).
          Renders above the inputs' click-through track; the thumbs themselves still win at the edges. */}
      {hi > lo && (
        <div
          className="absolute top-0 z-10 h-full cursor-grab touch-none active:cursor-grabbing"
          style={{ left: `calc(${pl}% + 10px)`, right: `calc(${100 - pr}% + 10px)` }}
          title="Drag to slide the window · edges resize it"
          onPointerDown={(e) => {
            drag.current = { startX: e.clientX, lo, hi }
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const d = drag.current
            const track = trackRef.current
            if (!d || !track) return
            const width = d.hi - d.lo
            const units = Math.round(((e.clientX - d.startX) / Math.max(1, track.getBoundingClientRect().width)) * span)
            const nlo = Math.min(Math.max(min, d.lo + units), max - width)
            if (nlo !== lo) onChange([nlo, nlo + width])
          }}
          onPointerUp={() => {
            drag.current = null
          }}
        />
      )}
    </div>
  )
}
