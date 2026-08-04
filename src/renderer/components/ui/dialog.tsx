import { type ReactNode, type JSX } from 'react';
import { X } from 'lucide-react'
import { useModalEscape } from '@/lib/editor/escapeStack'
import { cn } from '@/lib/utils'
import { regionAttrs, type RegionId } from '@/config/regions'

/**
 * The dialog SIZE taxonomy — four distinct, non-overlapping tiers so a dialog's footprint signals its category
 * (a user learns "this size = this kind of thing"). Callers pass `size`, NOT ad-hoc widths.
 *   confirm   — a quick yes/no (ConfirmDialog).
 *   panel     — an action + a short form (Run analysis, connection setup). The default.
 *   detail    — reading / help / reference.
 *   workspace — a big interactive pick-and-preview (Custody AI suggest).
 */
export type DialogSize = 'confirm' | 'panel' | 'detail' | 'workspace'
const DIALOG_SIZE: Record<DialogSize, string> = {
  confirm: 'max-w-sm',
  panel: 'max-w-lg',
  detail: 'max-w-2xl',
  workspace: 'h-[85vh] w-[85vw] max-w-6xl'
}

/** A minimal modal (overlay + card, Esc / backdrop to close). Overlays get shadow. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'panel',
  className,
  bodyClassName,
  accent,
  region
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** A pinned action row below the scroll body — pass a `<DialogFooter>`. Omit for dialogs with no actions. */
  footer?: ReactNode
  /** The size TIER — picks a standard x/y range so size reads as category. Default 'panel'. */
  size?: DialogSize
  /** Escape hatch for a genuine one-off; PREFER `size`. Applied after the tier so it can nudge a specific case. */
  className?: string
  /** Override the scrolling body wrapper (e.g. a fixed-size dialog whose own content manages the scroll). */
  bodyClassName?: string
  /** Optional CSS color — renders a dot beside the title for identity cues. */
  accent?: string
  /** Tag this dialog for the debug-boundary overlay + wizard (see config/regions). */
  region?: RegionId
}): JSX.Element | null {
  useModalEscape(open, onClose) // stack-aware: Esc closes only the TOP modal, one layer per press

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        {...(region ? regionAttrs(region) : {})}
        className={cn(
          // select-text: the app chrome disables selection globally (globals.css); a dialog BODY is a reading
          // surface — its text must be selectable/copyable everywhere, not opted in per-dialog.
          'relative z-10 flex max-h-[85vh] w-full select-text flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl',
          DIALOG_SIZE[size],
          className
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-panel px-4 py-2.5">
          <div className="flex items-center gap-2">
            {accent && (
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
            )}
            <h2 className="text-sm font-medium">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-auto p-4', bodyClassName)}>{children}</div>
        {/* A pinned action row — edge-to-edge, below the scroll. Use <DialogFooter> for the standard layout. */}
        {footer}
      </div>
    </div>
  )
}

/**
 * The standard dialog ACTION ROW — a divider, then buttons right-aligned (with an optional `aside` on the left,
 * e.g. a note or a secondary link). Every dialog's footer uses this so Cancel/primary land in the same place and
 * the same shape. Put `<Button>`s inside; a footer belongs in the Dialog's `footer` slot (or a SplitDialog pane).
 */
export function DialogFooter({ children, aside }: { children: ReactNode; aside?: ReactNode }): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2.5">
      {aside}
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
