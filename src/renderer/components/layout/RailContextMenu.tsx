/**
 * Shared right-click menu primitives for the two sidebar rails (Story tree + World bible).
 *
 * The rails differ in STRUCTURE — Story is a free folder hierarchy, World is a fixed kind-schema — but their
 * per-item actions are the same (rename · set phase · delete). These primitives are that common surface, so
 * both menus stay in lock-step: one shell (portal + viewport-clamp + click-away), one Phase picker.
 */
import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { CONTENT_PHASES, PHASE_META } from '@/config/worldSchema'
import { cn } from '@/lib/utils'

/** Menu chrome: portal to body, clamp into the viewport (never off-screen), dismiss on click-away / re-right-click. */
export function ContextMenuShell({
  x,
  y,
  onClose,
  children
}: {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: y, left: x })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8))
    })
  }, [x, y])

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        ref={ref}
        className="fixed z-50 min-w-40 overflow-hidden rounded-md border border-border bg-panel py-1 shadow-lg"
        style={{ top: pos.top, left: pos.left }}
      >
        {children}
      </div>
    </>,
    document.body
  )
}

/** A plain menu row. `onMouseDown` (not click) so it fires before the backdrop's dismiss. */
export function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={cn('block w-full px-3 py-1.5 text-left text-[12px] hover:bg-panel-soft', danger ? 'text-flag' : 'text-foreground')}
    >
      {label}
    </button>
  )
}

export function MenuSeparator(): JSX.Element {
  return <div className="my-1 border-t border-border" />
}

/** The shared Phase picker — Draft / Developing / Canon / Archived, with a check on the current phase.
 *  `label` overrides the header for scoped variants (e.g. a folder's "Phase — every scene inside"). */
export function PhaseSection({ current, onSet, label = 'Phase' }: { current: string; onSet: (phase: string) => void; label?: string }): JSX.Element {
  return (
    <>
      <MenuSeparator />
      <div className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      {CONTENT_PHASES.map((p) => (
        <button
          key={p}
          onMouseDown={(e) => {
            e.preventDefault()
            onSet(p)
          }}
          className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-panel-soft"
        >
          <span className={cn('size-1.5 shrink-0 rounded-full', PHASE_META[p].dot)} />
          <span className="flex-1 text-foreground">{PHASE_META[p].label}</span>
          {current === p && <Check className="size-3 shrink-0 text-foreground/70" />}
        </button>
      ))}
    </>
  )
}
