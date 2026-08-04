/**
 * SequenceSelect — the UNIVERSAL chart-sequence toggle: switch which route (or Auto) drives every Gantt/table.
 * Two skins, one behaviour:
 *   • 'corner' — a gradient-triangle dog-ear filling a gantt's top-left corner cell (LifecycleGantt · Cast heatmap).
 *   • 'inline' — a compact pill for a crowded toolbar (RelationPane and other non-gantt views).
 * The dropdown renders in a PORTAL (fixed, positioned under the trigger) so it escapes the gantt's overflow clip
 * and never gets cut off by a scroll container. See internal/chart-sequence.md.
 */
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Route, Check } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { variantSequences } from '@/lib/timeline/treeVariant'
import { cn } from '@/lib/utils'

const MENU_W = 208 // w-52

export function SequenceSelect({ variant = 'corner' }: { variant?: 'corner' | 'inline' }): JSX.Element {
  const trees = useWorkspace((s) => s.trees)
  const { sequences, activeId } = variantSequences(trees)
  const setActive = useWorkspace((s) => s.setActiveChartSequence)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Position the portalled menu under the trigger, clamped to the viewport, and FLIP UP when there isn't room
  // below (these pickers sit at the BOTTOM of a rail's scale-bar, so a downward menu overflows off-screen). Re-place
  // on scroll/resize so it tracks the trigger (the gantt corner can scroll) instead of drifting.
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8))
      // Measured once the menu is mounted (the rAF pass below); an estimate on the first pass.
      const menuH = menuRef.current?.offsetHeight ?? Math.min(window.innerHeight * 0.6, 280)
      const spaceBelow = window.innerHeight - r.bottom - 8
      const openUp = menuH > spaceBelow && r.top - 8 > spaceBelow // flip up only if below overflows AND above has more room
      setPos({ left, top: openUp ? Math.max(8, r.top - menuH - 4) : r.bottom + 4 })
    }
    place()
    const raf = requestAnimationFrame(place) // re-place after mount to measure the real menu height (first pass estimated)
    window.addEventListener('scroll', place, true) // capture — catches inner (gantt) scrolls too
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Close on an outside click — but the portalled menu lives outside the trigger, so allow clicks in either.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const active = activeId ? sequences.find((s) => s.id === activeId) : undefined
  const pick = (id: string | undefined): void => { void setActive(id); setOpen(false) }

  // Shared dropdown: Auto + every saved route. Portalled to <body> so no ancestor overflow can clip it.
  const menu =
    open &&
    pos &&
    createPortal(
      <div
        ref={menuRef}
        style={{ position: 'fixed', left: pos.left, top: pos.top, width: MENU_W }}
        className="z-[60] max-h-[60vh] overflow-y-auto rounded-md border border-border bg-panel shadow-lg"
      >
        <button onClick={() => pick(undefined)} className="type-body-sm flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-panel-soft">
          <span className="flex-1 truncate">Auto — reading order</span>
          {!activeId && <Check className="size-3.5 text-ok" />}
        </button>
        {sequences.map((s) => (
          <button key={s.id} onClick={() => pick(s.id)} className="type-body-sm flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-panel-soft">
            <span className="flex-1 truncate">{s.name}</span>
            <span className="type-micro text-faint">{s.path.length}</span>
            {activeId === s.id && <Check className="size-3.5 text-ok" />}
          </button>
        ))}
        {sequences.length === 0 && <div className="type-caption px-2.5 py-1.5 text-faint">No loadouts — build one in Timeline ▸ Chart Config.</div>}
        {/* Contextual help — a loadout re-scopes the WHOLE table (scenes/rows/analysis), not just columns; say so
            right where it's picked so the switch isn't a surprise (the inline half of the onboarding). */}
        <div className="type-micro border-t border-border px-2.5 py-1.5 leading-snug text-faint">
          A <span className="text-muted-foreground">loadout</span> is one reading of a branching story — it re-scopes which scenes, rows and analysis every chart shows.
        </div>
      </div>,
      document.body
    )

  if (variant === 'inline') {
    return (
      <div ref={triggerRef} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          title="Loadout — pick which reading of the story drives every chart"
          className="type-caption flex items-center gap-1 rounded-md border border-border bg-panel/60 px-2 py-1 text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
        >
          <Route className={cn('size-3.5 shrink-0', active ? 'text-thread' : 'text-faint')} />
          <span className="max-w-28 truncate">{active?.name ?? 'Auto'}</span>
          <ChevronDown className="size-3 shrink-0 text-faint" />
        </button>
        {menu}
      </div>
    )
  }

  // corner (default) — the gradient-triangle dog-ear filling a gantt's corner cell.
  return (
    <div ref={triggerRef} className="relative h-full w-full">
      <span className="pointer-events-none absolute left-0 top-0 size-2.5 bg-gradient-to-br from-thread to-lore [clip-path:polygon(0_0,100%_0,0_100%)]" />
      <button
        onClick={() => setOpen((o) => !o)}
        title="Chart axis — pick a sequence"
        className="flex h-full w-full items-center gap-1 rounded-sm px-2 text-left transition-colors hover:bg-panel-soft"
      >
        <Route className={cn('size-3.5 shrink-0', active ? 'text-thread' : 'text-faint')} />
        <span className="type-caption truncate">{active?.name ?? 'Auto'}</span>
        <ChevronDown className="ml-auto size-3 shrink-0 text-faint" />
      </button>
      {menu}
    </div>
  )
}
