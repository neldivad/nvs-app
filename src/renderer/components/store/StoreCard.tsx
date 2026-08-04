/**
 * Store primitives — the shared base views the Community + Extension pages compose (React "inheritance" =
 * composition). `StoreCard` is the BasicView (a grid card: icon · title · meta · badges · actions, click →
 * detail). `StoreDetail` is the DetailView (back · big header · meta · actions · body). NovelCard/ExtensionCard
 * and NovelDetail/ExtensionDetail wrap these so both content types share one look + one place to evolve it.
 */
import { ArrowLeft, type LucideIcon } from 'lucide-react'
import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** BasicView — one item as a card in the browse grid. */
export function StoreCard({
  icon: Icon,
  iconClass = 'text-faint',
  title,
  subtitle,
  badge,
  meta,
  actions,
  onOpen
}: {
  icon: LucideIcon
  iconClass?: string
  title: string
  subtitle?: string
  badge?: ReactNode // top-right chip (verified / compatible / …)
  meta?: ReactNode // a small meta line (scenes · beats, capabilities, …)
  actions?: ReactNode // footer buttons (install / update / remove / details)
  onOpen?: () => void // clicking the card body opens the detail
}): JSX.Element {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-panel/40 p-3">
      <button onClick={onOpen} disabled={!onOpen} className="flex items-start gap-2 text-left disabled:cursor-default">
        <Icon className={cn('mt-0.5 size-4 shrink-0', iconClass)} />
        <div className="min-w-0 flex-1">
          <div className="type-card-title truncate">{title}</div>
          {subtitle && <div className="type-caption truncate text-faint">{subtitle}</div>}
        </div>
        {badge}
      </button>
      {meta && <div className="type-micro mt-2 flex flex-wrap items-center gap-1.5 text-muted-foreground">{meta}</div>}
      {actions && <div className="mt-3 flex items-center justify-end gap-2">{actions}</div>}
    </div>
  )
}

/** DetailView — one item expanded to fill the page (back to the grid, big header, actions, body). */
export function StoreDetail({
  onBack,
  icon: Icon,
  iconClass = 'text-faint',
  title,
  subtitle,
  meta,
  actions,
  children
}: {
  onBack: () => void
  icon: LucideIcon
  iconClass?: string
  title: string
  subtitle?: string
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="type-caption mb-4 flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground">
        <ArrowLeft className="size-4" /> Back
      </button>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-1 size-6 shrink-0', iconClass)} />
        <div className="min-w-0 flex-1">
          <h2 className="type-app-title truncate">{title}</h2>
          {subtitle && <div className="type-caption truncate text-faint">{subtitle}</div>}
          {meta && <div className="type-caption mt-1.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}

/** A neutral meta chip used across cards/details. */
export function Chip({ children, tone }: { children: ReactNode; tone?: string }): JSX.Element {
  return <span className={cn('rounded border border-border px-1', tone ?? 'text-faint')}>{children}</span>
}
