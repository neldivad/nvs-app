/**
 * Standardized canvas warning pill — extracted from the Timeline's "N scenes not on the route" banner so the
 * timeline + corkboard show canvas warnings identically. A warn triangle + a message + dot-separated action links.
 * The caller places it inside a ReactFlow `<Panel>` (e.g. position="top-center").
 */
import { Fragment, type JSX, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CanvasWarningAction {
  label: string
  onClick: () => void
  title?: string
  /** The recommended fix — rendered stronger than the rest. */
  primary?: boolean
}

export function CanvasWarning({ message, actions }: { message: ReactNode; actions?: CanvasWarningAction[] }): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-full border border-warn/30 bg-warn/10 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
      <AlertTriangle className="size-3 shrink-0 text-warn" />
      <span>{message}</span>
      {actions?.map((a, i) => (
        <Fragment key={i}>
          <span className="text-faint">·</span>
          <button
            onClick={a.onClick}
            title={a.title}
            className={cn('underline-offset-2 hover:underline', a.primary ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {a.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
