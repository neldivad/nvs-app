/**
 * Layer toggles for the Gantt overlays (Character arc · Cast presence · …) — the ArcGIS-style table-of-contents
 * pattern the Timeline uses. `chapters` bands the scene columns by folder; `pov` glows each character's POV
 * scenes. To add a layer: add a key to `ganttLayers` in the store + an entry in LAYER_DEFS, then read it where
 * it renders. `show` filters which layers a given rail offers (e.g. Threads has no POV).
 */
import { useState, type JSX } from 'react'
import { Layers, ChevronUp, ChevronDown } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

export type GanttLayerKey = 'chapters' | 'pov' | 'silent' | 'presence' | 'warmth' | 'events' | 'observed' | 'irony' | 'empty' | 'mutual'

const LAYER_DEFS: { key: GanttLayerKey; label: string; hint: string }[] = [
  { key: 'presence', label: 'Presence', hint: 'Back-to-back dialogue bars per scene (A ◀ cell ▶ B)' },
  { key: 'mutual', label: 'Mutual scenes', hint: 'Only scenes where BOTH of the pair appear — hides solo scenes too' },
  { key: 'empty', label: 'Empty nodes', hint: 'Show the time-gap ghosts (scenes where neither of the pair appears); off hides them' },
  { key: 'chapters', label: 'Chapters', hint: 'Band/shell the scenes by chapter (folder)' },
  { key: 'warmth', label: 'Warmth', hint: 'Replace the spine with the warmth trajectory (Warm↔Cold axis)' },
  { key: 'events', label: 'Events', hint: 'Shift markers flanking each scene; click for the detail' },
  { key: 'pov', label: 'POV', hint: "Glow each character's POV scenes (authored, else the dominant speaker)" },
  { key: 'silent', label: 'Silent presence', hint: "Also show present-but-silent cast (the prose-read room), not just speakers" },
  { key: 'observed', label: 'Observed', hint: 'Ghost marks where ANALYSIS saw this topic move/reveal with no declared checkpoint — the unplanned-reveal diff' },
  { key: 'irony', label: 'Irony', hint: "Dramatic-irony bands from custody topics — the reader knows what this fighter doesn't (band on the unknowing side)" }
]

export function GanttLayerControl({ show = ['chapters', 'pov'] }: { show?: GanttLayerKey[] }): JSX.Element {
  const layers = useWorkspace((s) => s.ganttLayers)
  const setLayer = useWorkspace((s) => s.setGanttLayer)
  const [open, setOpen] = useState(false)
  const defs = LAYER_DEFS.filter((l) => show.includes(l.key))
  const activeCount = defs.filter((l) => layers[l.key]).length
  return (
    <div className="w-36 rounded-lg border border-border bg-panel/95 p-1 text-[11px] shadow-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-panel-soft"
      >
        <Layers className="size-3" />
        <span className="flex-1 text-left font-semibold uppercase tracking-wide">Layers</span>
        {!open && activeCount > 0 && <span className="text-[9px] text-faint">{activeCount}</span>}
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {open &&
        defs.map((l) => {
          const on = layers[l.key]
          return (
            <button
              key={l.key}
              title={l.hint}
              onClick={() => setLayer(l.key, !on)}
              className={cn('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-panel-soft', on ? 'text-foreground' : 'text-muted-foreground')}
            >
              <span className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-full border', on ? 'border-character bg-character/20' : 'border-border')}>
                {on && <span className="size-1.5 rounded-full bg-character" />}
              </span>
              {l.label}
            </button>
          )
        })}
    </div>
  )
}
