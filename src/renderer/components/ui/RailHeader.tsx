/**
 * The rail-content header CHROME — one place the top bar of every rail pane is defined, so panes stop
 * re-rolling their own `border-b` header at slightly different heights (they'd drifted to h-9 / py-1.5 / h-24).
 *
 *  • RailHeader — the fixed-height (h-9) bordered top bar. Drop tabs, a title, filter chips, and right-edge
 *    actions inside it. (Relationship's portrait duo-header is a deliberate exception and keeps its own height.)
 *  • RailTabs — the ONE tab-strip look: a segmented bordered-rounded group (the same one PageShell uses for
 *    scene/world/custody pages), so every rail's tabs read identically.
 * See DESIGN.md → "Rail header".
 */
import type { HTMLAttributes, JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The standard rail top bar: `h-9`, bottom border, `px-3`. Everything a pane puts up top goes in here. */
export function RailHeader({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      {...rest}
      data-comp="RailHeader"
      className={cn('flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] text-muted-foreground', className)}
    >
      {children}
    </div>
  )
}

/** The one tab-strip look — a segmented bordered group. `renderLabel` maps a tab key to display text. */
export function RailTabs<T extends string>({
  tabs,
  value,
  onChange,
  renderLabel,
  className
}: {
  tabs: readonly T[]
  value: T
  onChange: (t: T) => void
  renderLabel?: (t: T) => ReactNode
  className?: string
}): JSX.Element {
  return (
    <div data-comp="RailTabs" className={cn('flex shrink-0 overflow-hidden rounded-md border border-border text-xs', className)}>
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            'px-2 py-1 capitalize transition-colors',
            value === t ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
          )}
        >
          {renderLabel ? renderLabel(t) : t}
        </button>
      ))}
    </div>
  )
}
