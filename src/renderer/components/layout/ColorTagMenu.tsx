/**
 * Shared color-tag popover — right-click a character (graph node or Cast sidebar row) to tag it a color.
 * Single purpose: assign (or clear). Renaming the swatch labels lives in the graph legend, not here.
 * Fixed-positioned at the cursor with a click-away backdrop. Tags are session-scoped (workspace store).
 */
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

import type { JSX } from "react";

// Flat palette for author node-tags (reuses the facet tokens; distinct hues).
export const NODE_PALETTE_VARS = ['--facet-knowledge', '--facet-relationship', '--facet-objective', '--facet-power', '--facet-secret', '--facet-alignment']

/** Resolve the palette tokens to concrete colors (CSS vars → values). */
export const resolveNodePalette = (): string[] =>
  NODE_PALETTE_VARS.map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888')

export function ColorTagMenu({ x, y, id, name, onClose }: { x: number; y: number; id: string; name?: string; onClose: () => void }): JSX.Element {
  const nodeColor = useWorkspace((s) => s.nodeColor)
  const setNodeColor = useWorkspace((s) => s.setNodeColor)
  const palette = resolveNodePalette()
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="fixed z-40 rounded-lg border border-border bg-panel p-1.5 shadow-2xl" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
        {name && <div className="max-w-40 truncate px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{name}</div>}
        <div className="flex items-center gap-1.5 px-1">
          {NODE_PALETTE_VARS.map((_, i) => (
            <button
              key={i}
              onClick={() => { setNodeColor(id, i); onClose() }}
              title={`Group ${i + 1}`}
              className={cn('size-4 rounded-full border', nodeColor[id] === i ? 'border-foreground' : 'border-transparent')}
              style={{ backgroundColor: palette[i] }}
            />
          ))}
        </div>
        <button onClick={() => { setNodeColor(id, null); onClose() }} className="mt-1 w-full rounded px-1 py-0.5 text-left text-[11px] text-faint hover:bg-panel-soft hover:text-foreground">
          Clear tag
        </button>
      </div>
    </>
  )
}
