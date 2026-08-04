import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

import type { JSX } from "react";

/** A small yes/no confirmation over the shared Dialog. `danger` tints the confirm button. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  className,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  message: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  /** One-off size nudge, forwarded to Dialog's escape hatch (e.g. a content-heavy confirm that needs more room). */
  className?: string
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <Dialog
      region="confirmDialog"
      size="confirm"
      className={className}
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          {/* autoFocus → the confirm button owns the keyboard the moment the dialog opens, so Enter confirms
              and Esc cancels (Dialog's own handler) without reaching for the mouse. */}
          <Button autoFocus size="sm" variant={danger ? 'destructive' : 'default'} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      }
    >
      {/* whitespace-pre-line: `\n\n` in a message string renders as a paragraph break, so notices read as short
          lines instead of one dense run-on. leading-relaxed gives the lines air. */}
      <div className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{message}</div>
    </Dialog>
  )
}
