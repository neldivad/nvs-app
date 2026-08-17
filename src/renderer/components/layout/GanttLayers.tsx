/**
 * Layer toggles for the Gantt overlays (Character arc · Cast presence · …) — the ArcGIS-style table-of-contents
 * pattern the Timeline uses. `chapters` bands the scene columns by folder; `pov` glows each character's POV
 * scenes. To add a layer: add a key to `ganttLayers` in the store + an entry in LAYER_DEFS, then read it where
 * it renders. `show` filters which layers a given rail offers (e.g. Threads has no POV).
 */
import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, ChevronUp, ChevronDown } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

export type GanttLayerKey = 'chapters' | 'pov' | 'silent' | 'presence' | 'warmth' | 'events' | 'observed' | 'irony' | 'empty' | 'mutual'

// Display order of the layers; label + hint come from the ganttLayers catalog (keyed by GanttLayerKey).
const LAYER_ORDER: GanttLayerKey[] = ['presence', 'mutual', 'empty', 'chapters', 'warmth', 'events', 'pov', 'silent', 'observed', 'irony']

export function GanttLayerControl({ show = ['chapters', 'pov'] }: { show?: GanttLayerKey[] }): JSX.Element {
  const { t } = useTranslation('ganttLayers')
  const layers = useWorkspace((s) => s.ganttLayers)
  const setLayer = useWorkspace((s) => s.setGanttLayer)
  const [open, setOpen] = useState(false)
  const keys = LAYER_ORDER.filter((k) => show.includes(k))
  const activeCount = keys.filter((k) => layers[k]).length
  return (
    <div className="w-36 rounded-lg border border-border bg-panel/95 p-1 text-[11px] shadow-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-panel-soft"
      >
        <Layers className="size-3" />
        <span className="flex-1 text-left font-semibold uppercase tracking-wide">{t('layers')}</span>
        {!open && activeCount > 0 && <span className="text-[9px] text-faint">{activeCount}</span>}
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {open &&
        keys.map((k) => {
          const on = layers[k]
          return (
            <button
              key={k}
              title={t(`layer.${k}.hint`)}
              onClick={() => setLayer(k, !on)}
              className={cn('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-panel-soft', on ? 'text-foreground' : 'text-muted-foreground')}
            >
              <span className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-full border', on ? 'border-character bg-character/20' : 'border-border')}>
                {on && <span className="size-1.5 rounded-full bg-character" />}
              </span>
              {t(`layer.${k}.label`)}
            </button>
          )
        })}
    </div>
  )
}
