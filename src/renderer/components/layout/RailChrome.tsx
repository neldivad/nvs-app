/**
 * RailChrome — the shared bottom-right controls every analysis rail wears: the detached Layers TOC, the Fab
 * (Export PNG · page-specific extras · Help), and the help dialog. A panel DECLARES its capabilities rather
 * than re-wiring them, so a rail can't drift out of the standard (forget Export, stuff a layer into the Fab…).
 *
 * The data↔content split it encodes:
 *   • layers  = DATA     → a universal control reading the central LAYER_DEFS; the panel names which apply.
 *   • export  = BEHAVIOR → the shared useRailExport hook; standard action, on by declaring a target.
 *   • help    = CONTENT  → the panel's own <XHelp> component, injected; only the shell is shared.
 *
 * Renders absolutely-positioned children — mount it inside the panel's `relative` root.
 */
import { type ComponentType, type JSX } from 'react'
import { Download, HelpCircle, Loader2 } from 'lucide-react'
import { REGIONS, type RegionId } from '@/config/regions'
import { useRailExport } from '@/lib/timeline/exportRail'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { Fab, type FabAction } from '@/components/ui/Fab'
import { GanttLayerControl, type GanttLayerKey } from '@/components/layout/GanttLayers'

export interface RailExportConfig {
  file: string // saveImage basename, e.g. 'coherence-rail'
  caption?: () => string
}

export function RailChrome({
  region,
  name,
  layers,
  layersClassName = 'right-2 top-1.5', // in the h-9 header (the type/filter row), top-right — NOT one rung below it
  // Sits ABOVE the bottom RailScaleBar (h-8 = 2rem) so the Fab never layers over the Scene/Range sliders —
  // 2rem bar + the original 1rem gap. Panels with a TOP-corner Fab (e.g. CellView) override this.
  fabClassName = 'bottom-12 right-4',
  fabDirection = 'up',
  export: exportCfg,
  help: Help,
  actions = []
}: {
  region: RegionId
  name?: string // human label for the "… help" tooltip (falls back to "Page")
  layers?: GanttLayerKey[] // which layers this rail offers (detached control); omit = none
  layersClassName?: string // position of the layers TOC; default sits IN the type/filter header row (top-right). Override when a rail stacks a SECOND header row (e.g. RelationshipPanel → top-28)
  fabClassName?: string // position of the Fab; override for panels whose bottom-right is busy (default bottom-right)
  fabDirection?: 'up' | 'down' // which way the Fab expands — 'down' for a TOP-corner placement (default 'up')
  export?: RailExportConfig // omit = no export action
  help?: ComponentType<{ open: boolean; onClose: () => void }>
  actions?: FabAction[] // rare page-specific extras, placed between Export and Help
}): JSX.Element {
  // Help open-state lives in the store (not local) so a global key (F8) can open THIS pane's help — only one
  // rail is mounted at a time, so the single shared flag maps 1:1 to "the current pane's help".
  const helpOpen = useWorkspace((s) => s.paneHelpOpen)
  const setHelpOpen = useWorkspace((s) => s.setPaneHelpOpen)
  // The hook must run unconditionally (rules of hooks); only the resulting action is conditional.
  const { exporting, exportPng } = useRailExport(REGIONS[region].label, exportCfg?.file ?? 'rail', { caption: exportCfg?.caption })

  const fabActions: FabAction[] = [
    ...(exportCfg
      ? [{ icon: exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />, title: 'Export page as PNG', onClick: () => void exportPng() }]
      : []),
    ...actions,
    ...(Help ? [{ icon: <HelpCircle className="size-4" />, title: `${name ?? 'Page'} help`, onClick: () => setHelpOpen(true) }] : [])
  ]

  return (
    <>
      {layers && layers.length > 0 && (
        // Layers ALWAYS render as the detached top-right TOC — never a Fab action (the placement rule).
        <div data-export-hide="1" className={cn('absolute z-20', layersClassName)}>
          <GanttLayerControl show={layers} />
        </div>
      )}
      <div className={cn('absolute z-20', fabClassName)}>
        <Fab actions={fabActions} direction={fabDirection} />
      </div>
      {Help && <Help open={helpOpen} onClose={() => setHelpOpen(false)} />}
    </>
  )
}
