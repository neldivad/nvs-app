/**
 * SplitDialog — the reusable MASTER-DETAIL popup: a list/picker on the left, a preview/detail/editor on the
 * right. Extracted from Custody's "AI suggest" two-pane (which reads well), so other technical popups (the
 * Prompt library, future inspectors) share one layout instead of re-rolling the flex split. `left` and `right`
 * are full panes — each owns its own header + scroll; SplitDialog just frames them (Dialog chrome + the divider).
 * Defaults to the `workspace` size tier (big pick-and-preview); pass `size` to shrink for lighter cases.
 */
import type { ReactNode, JSX } from 'react'
import { Dialog, type DialogSize } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function SplitDialog({
  open,
  onClose,
  title,
  left,
  right,
  footer,
  size = 'workspace',
  leftClassName = 'w-2/5 min-w-64 max-w-sm'
}: {
  open: boolean
  onClose: () => void
  title: string
  left: ReactNode // the master pane — list / picker (owns its own search header + scroll)
  right: ReactNode // the detail pane — preview / inspector / editor (owns its own scroll)
  footer?: ReactNode // a pinned action row spanning BOTH panes (pass a <DialogFooter>); omit for none
  size?: DialogSize
  leftClassName?: string // width of the master pane (default ~40%, bounded)
}): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title={title} size={size} bodyClassName="flex min-h-0 p-0" footer={footer}>
      <div className={cn('flex min-h-0 shrink-0 flex-col border-r border-border', leftClassName)}>{left}</div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{right}</div>
    </Dialog>
  )
}
