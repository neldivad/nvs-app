/**
 * Shared card chrome for the canvas surfaces (corkboard + timeline). Provides the bits every card needs so they
 * don't drift: in/out handles (right = out/source, left = in/target), a selection ring, a hover **quick-delete**
 * X, and OPTIONAL resize (`resizable`) + an OPTIONAL drag-handle header (`header` — needed when the body captures
 * the pointer, e.g. a textarea). Each surface fills the body with its own content.
 *
 * Delete goes through xyflow's `deleteElements`, so it fires each surface's existing onNodesDelete / onNodesChange
 * (which persist) — one affordance, correct on both.
 */
import { JSX, type ReactNode } from 'react'
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CardShellProps {
  id: string
  selected?: boolean
  resizable?: boolean
  minWidth?: number
  minHeight?: number
  /** Grabbable drag-handle bar. Omit to drag from the whole body (fine when the body doesn't capture the pointer). */
  header?: ReactNode
  /** Optional CSS color to tint the header bar (e.g. a card's group color). */
  headerTint?: string
  /** Shown only while selected (e.g. a color row). */
  footer?: ReactNode
  children: ReactNode
  className?: string
  /** Override the default delete (deleteElements). */
  onDelete?: () => void
}

const HANDLE = 'size-3.5! z-20! rounded-full! border-2! border-canvas! bg-faint! transition-colors hover:bg-thread!'

export function CardShell({ id, selected, resizable, minWidth = 160, minHeight = 112, header, headerTint, footer, children, className, onDelete }: CardShellProps): JSX.Element {
  const { deleteElements } = useReactFlow()
  const del = onDelete ?? ((): void => void deleteElements({ nodes: [{ id }] }))
  return (
    <div className="group relative h-full w-full">
      {resizable && (
        <NodeResizer isVisible={!!selected} minWidth={minWidth} minHeight={minHeight} color="var(--thread)" handleClassName="size-2! rounded-sm! border! border-thread! bg-panel!" />
      )}
      <Handle type="target" position={Position.Left} className={cn(HANDLE, '-left-2!')} />
      <Handle type="source" position={Position.Right} className={cn(HANDLE, '-right-2!')} />
      {/* quick-delete — hover-reveal X (nodrag so the click doesn't start a drag) */}
      <button
        onClick={del}
        title="Delete"
        className="nodrag absolute -right-1.5 -top-1.5 z-30 flex size-4 items-center justify-center rounded-full border border-border bg-panel text-faint opacity-0 shadow-sm transition-opacity hover:text-flag group-hover:opacity-100"
      >
        <X className="size-2.5" />
      </button>
      <div className={cn('flex h-full w-full flex-col overflow-hidden rounded-lg border bg-panel text-left shadow-sm', selected ? 'border-thread ring-1 ring-thread/30' : 'border-border', className)}>
        {header !== undefined && (
          <div
            className={cn('flex h-6 shrink-0 cursor-grab items-center gap-1.5 border-b border-border/60 px-2 active:cursor-grabbing', !headerTint && 'bg-panel-soft/50')}
            style={headerTint ? { backgroundColor: headerTint } : undefined}
          >
            {header}
          </div>
        )}
        <div className="min-h-0 flex-1">{children}</div>
        {selected && footer !== undefined && <div className="shrink-0 border-t border-border/60">{footer}</div>}
      </div>
    </div>
  )
}
