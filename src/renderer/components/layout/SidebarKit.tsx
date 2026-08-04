/**
 * The Sidebar KIT — the one place a rail roster's row + section-label look lives, so new rails COMPOSE
 * these instead of re-rolling a `<button className="…">` (which is how the rails drifted: border-accent vs
 * panel-soft selection, px-3 vs px-2, text-[13px] vs text-xs). CustodySidebar is the visual reference; the
 * class itself is `sidebarRow()` in lib/utils. See DESIGN.md → "Sidebar row".
 *
 * A rail row is: [leading icon/dot/avatar] · [truncating label] · [trailing marker(s)] · [faint mono meta].
 * Anything a row genuinely needs that this doesn't cover (merge checkbox, heat tint) goes through `leading`
 * /`trailing`/`className` — but the geometry + selection state stay owned here.
 */
import { useState, type ButtonHTMLAttributes, type JSX, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn, sidebarRow } from '@/lib/utils'
import { SearchPopover, type SearchPopoverProps } from '@/components/ui/SearchPopover'
import { PHASE_META } from '@/config/worldSchema'

export interface SidebarRowProps {
  /** Selected → panel-soft + foreground (the shared selection look; never a colored border accent). */
  selected?: boolean
  /** Dim the row when it's a de-emphasised/closed/excluded item (only applies when not selected). */
  dim?: boolean
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  title?: string
  /** Leading slot — a color dot, a kind icon, or an avatar. Keep it `shrink-0`. */
  leading?: ReactNode
  label: ReactNode
  /** Extra classes on the label span (e.g. `font-mono` for a slug fallback, `capitalize`). */
  labelClassName?: string
  /** Optional second line under the label (e.g. Library's "N scenes · N world"), faint. */
  sub?: ReactNode
  /** Marker(s) between the label and the meta — e.g. an "inferred" ⓘ or a link glyph. */
  trailing?: ReactNode
  /** Trailing count/metric — rendered faint + mono. Pass `false`/`null` to omit. */
  meta?: ReactNode
  className?: string
}

/** One roster row. The geometry, selection colours and meta typography are fixed here. */
export function SidebarRow({
  selected = false,
  dim = false,
  onClick,
  onContextMenu,
  title,
  leading,
  label,
  labelClassName,
  sub,
  trailing,
  meta,
  className
}: SidebarRowProps): JSX.Element {
  return (
    <button
      type="button"
      data-comp="SidebarRow"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className={cn(sidebarRow(selected), dim && !selected && 'opacity-50', className)}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('block truncate', labelClassName)}>{label}</span>
        {sub != null && sub !== false && <span className="block truncate text-[10px] text-faint">{sub}</span>}
      </span>
      {trailing}
      {meta != null && meta !== false && <span className="shrink-0 font-mono text-[10px] text-faint">{meta}</span>}
    </button>
  )
}

/** The sidebar TOP bar — `Title · N` in the semantic `type-label` token, with an optional right-edge action.
 *  Every folder/roster sidebar uses this so the title bar is one height + one type treatment.
 *
 *  `search` opts a rail into the STANDARDIZED search: a 🔍 pinned at the far-right (after the action, a constant
 *  position on every rail) that opens the shared `SearchPopover` — a floating search box + results list, picking
 *  a result jumps to it. So search never costs a rail a row, and every rail's search looks + behaves the same. */
export function SidebarHeader({
  title,
  count,
  action,
  className,
  search
}: {
  title: ReactNode
  count?: number
  action?: ReactNode
  className?: string
  search?: SearchPopoverProps
}): JSX.Element {
  return (
    <div data-comp="SidebarHeader" className={cn('flex h-9 shrink-0 items-center gap-1.5 px-3', className)}>
      <span className="type-label min-w-0 flex-1 truncate text-muted-foreground">
        {title}
        {count != null && <> · {count}</>}
      </span>
      {action}
      {search && <SearchPopover {...search} />}
    </div>
  )
}

/** The sidebar SCROLL region — the `flex-1` body under the header. One place owns `min-h-0 overflow-y-auto`. */
export function SidebarScroll({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div data-comp="SidebarScroll" className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>
}

export interface DetailedRowProps {
  active?: boolean
  /** Scene-tree only: has an open tab but isn't the active one → a faint gradient fill. */
  open?: boolean
  /** Part of a MULTI-selection (shift/ctrl-click) — a thread tint, distinct from `active` (the open page). */
  selected?: boolean
  /** Keyboard-focused (roving tabindex) — a subtle ring, distinct from `active` (the open page). */
  focused?: boolean
  /** Ref for the row's BUTTON — the headless-tree focusable + draggable element (item.registerElement). The
   *  drag props ride on `buttonProps`; they must be on the button (the grabbed surface), not the wrapper div —
   *  HTML5 DnD won't start a draggable ancestor when you grab an interactive child. */
  buttonRef?: React.Ref<HTMLButtonElement>
  /** De-emphasise the whole row (e.g. a Timeline scene already placed on the canvas). */
  dim?: boolean
  /** Resolved phase key → the left phase-spine colour. Omit for no spine (Timeline/flat detail rows). */
  phase?: string
  /** Left padding in px for tree indentation. */
  indent?: number
  /** Leading kind/type icon (Folder · FileText · entity glyph). */
  icon?: ReactNode
  label: ReactNode
  labelClassName?: string
  /** Faint second line under the label — the "detail" (folder path · "6 scenes" · "item · 4 checkpoints"). */
  sub?: ReactNode
  title?: string
  /** Receives the click event so callers can read shift/ctrl/meta for multi-select. */
  onClick?: (e: ReactMouseEvent) => void
  onContextMenu?: (e: ReactMouseEvent) => void
  /** Extra props spread on the button (e.g. drag handlers). */
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>
  /** Rendered before the phase spine (e.g. a drop indicator). */
  leading?: ReactNode
  /** Persistent trailing status inside the row — a ✓, a count, a chevron. */
  trailing?: ReactNode
  /** Trailing hover-reveal actions (archive/delete) after the row. */
  actions?: ReactNode
}

/** The shared NAVIGATOR row — Scene · World · Custody · Timeline. A phase colour-spine (optional) + a leading
 *  icon + [label · faint sub-line] + a trailing status (✓/count), with pixel indentation. Richer than the flat
 *  `SidebarRow`; owns the geometry so the folder-like sidebars can't drift. (Expandable folder rows and Timeline's
 *  non-expandable drop-unit folders stay their own controls — this is the leaf/item row.) */
export function DetailedRow({
  active = false,
  open = false,
  selected = false,
  focused = false,
  buttonRef,
  dim = false,
  phase,
  indent,
  icon,
  label,
  labelClassName,
  sub,
  title,
  onClick,
  onContextMenu,
  buttonProps,
  leading,
  trailing,
  actions
}: DetailedRowProps): JSX.Element {
  return (
    <div
      data-comp="DetailedRow"
      className={cn(
        'group/row relative flex items-center transition-colors hover:bg-panel-soft',
        // Three visible tiers: unopened (none) · open-tab (a legible fill) · active (panel-soft + a bolder label
        // + a thread-coloured outline ring, so the selected row reads distinct from a mere hover).
        active ? 'bg-panel-soft ring-1 ring-inset ring-thread' : open ? 'bg-panel-soft/60' : '',
        selected && !active && 'bg-thread/15 ring-1 ring-inset ring-thread/50', // multi-selection (shift/ctrl)
        focused && !active && !selected && 'ring-1 ring-inset ring-thread/40', // keyboard focus (roving tabindex)
        dim && 'opacity-50'
      )}
    >
      {leading}
      {/* phase spine — a solid left rail (canon green · developing · draft · archived), in a fixed gutter. */}
      {phase != null && (
        <span className={cn('pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-1', PHASE_META[phase]?.dot ?? 'bg-foreground/40')} />
      )}
      <button
        {...buttonProps}
        ref={buttonRef}
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={title}
        style={{ ...buttonProps?.style, ...(indent != null ? { paddingLeft: indent } : {}) }}
        className={cn('flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left text-xs', active ? 'font-medium text-foreground' : open ? 'text-foreground/85' : '', buttonProps?.className)}
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate', labelClassName)}>{label}</span>
          {sub != null && sub !== false && <span className="truncate text-[10px] text-faint">{sub}</span>}
        </span>
        {trailing}
      </button>
      {actions}
    </div>
  )
}

/** A roster section header — `UPPERCASE · count`, aligned to the row gutter (px-2). */
export function SidebarLabel({ children, count }: { children: ReactNode; count?: number }): JSX.Element {
  return (
    <div data-comp="SidebarLabel" className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
      {children}
      {count != null && <> · {count}</>}
    </div>
  )
}

/** A SidebarLabel that TOGGLES its section — chevron + label + count. `open` + `onClick` are caller-owned so a
 *  rail can drive several from one collapsed-set (Threads); `RosterSection` wraps it with its own state. */
export function CollapsibleLabel({ open, count, onClick, children }: { open: boolean; count: number; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-1 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint hover:text-foreground">
      <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
      {children}
      <span className="text-faint/70">· {count}</span>
    </button>
  )
}

/** A self-contained collapsible roster group (owns its open state) — the shared pattern for the Entity/Lore rosters. */
export function RosterSection({ label, count, defaultOpen = true, children }: { label: ReactNode; count: number; defaultOpen?: boolean; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <CollapsibleLabel open={open} count={count} onClick={() => setOpen((o) => !o)}>{label}</CollapsibleLabel>
      {open && children}
    </div>
  )
}
