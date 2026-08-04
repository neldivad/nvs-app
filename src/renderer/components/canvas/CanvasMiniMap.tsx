/**
 * CanvasMiniMap — the shared, MINIMIZABLE xyflow minimap every board wears (Timeline Canvas · Cells · Chart
 * Config). A union feature, not a per-canvas re-roll: one collapse behavior + one themed look, so the minimap
 * looks and minimizes the same everywhere. Render it as a child of <ReactFlow> (it mounts its own <Panel>).
 *
 * Owns its open/closed state locally (default open). Any xyflow <MiniMap> prop passes through and overrides the
 * shared defaults — e.g. a board can pass a per-node `nodeColor` function.
 */
import { useState, type ComponentProps, type JSX } from 'react'
import { MiniMap, Panel } from '@xyflow/react'
import { Minus, Map as MapIcon } from 'lucide-react'

type Props = ComponentProps<typeof MiniMap> & { defaultOpen?: boolean }

export function CanvasMiniMap({ defaultOpen = true, ...miniMap }: Props): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Panel position="bottom-right">
      {open ? (
        <div className="relative">
          <button
            onClick={() => setOpen(false)}
            title="Hide minimap"
            className="absolute -left-2 -top-2 z-10 flex size-5 items-center justify-center rounded-full border border-border bg-panel text-muted-foreground shadow hover:text-foreground"
          >
            <Minus className="size-3" />
          </button>
          <MiniMap
            pannable
            zoomable
            bgColor="var(--panel)"
            maskColor="color-mix(in srgb, var(--canvas) 60%, transparent)"
            nodeColor="var(--faint)"
            nodeStrokeColor="var(--border)"
            className="!m-0 rounded-md border border-border"
            {...miniMap}
          />
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Show minimap"
          className="flex size-7 items-center justify-center rounded-md border border-border bg-panel/95 text-muted-foreground shadow-md hover:text-foreground"
        >
          <MapIcon className="size-3.5" />
        </button>
      )}
    </Panel>
  )
}
