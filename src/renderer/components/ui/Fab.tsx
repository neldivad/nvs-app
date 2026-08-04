/**
 * Fab — a floating action-button cluster (NOT a Float window): a fixed wrench that expands into a
 * column of round action buttons (Help, options), pinned to a corner by the caller (a React Flow
 * <Panel> on the Timeline, an absolute corner on Scene/World/Cast pages). It holds *actions*, doesn't
 * move, and isn't in the float/Esc stack — its buttons open Dialogs. Distinct from `FloatWindow`.
 */
import { useState, type ReactNode, type JSX } from 'react';
import { regionAttrs } from '@/config/regions'
import { Wrench, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FabAction {
  icon: ReactNode
  title: string
  onClick: () => void
  danger?: boolean
}

const BTN =
  'flex size-8 items-center justify-center rounded-full border border-border bg-panel/95 text-muted-foreground shadow-md transition-colors hover:bg-panel-soft hover:text-foreground'

/** `direction` = where the actions expand relative to the toggle: 'up' (actions above, toggle at bottom — for a
 *  bottom-corner Fab) or 'down' (toggle at TOP, actions below — for a top-corner Fab). Default 'up'. */
export function Fab({ actions, direction = 'up' }: { actions: FabAction[]; direction?: 'up' | 'down' }): JSX.Element {
  const [open, setOpen] = useState(false)
  const toggle = (
    <button
      onClick={() => setOpen((v) => !v)}
      title={open ? 'Collapse' : 'Tools'}
      className={cn(BTN, open && 'bg-panel-soft text-foreground')}
    >
      {open ? <Minus className="size-4" /> : <Wrench className="size-4" />}
    </button>
  )
  const items =
    open &&
    actions.map((a, i) => (
      <button key={i} onClick={a.onClick} title={a.title} className={cn(BTN, a.danger && 'hover:text-flag')}>
        {a.icon}
      </button>
    ))
  return (
    <div {...regionAttrs('fab')} className="flex flex-col items-center gap-2">
      {direction === 'down' ? (<>{toggle}{items}</>) : (<>{items}{toggle}</>)}
    </div>
  )
}
