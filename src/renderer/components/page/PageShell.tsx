/**
 * The shared page chrome — title · kind chip · badges · TAB STRIP · hint · actions, over a body slot.
 * Step 2 of the BasePage plan (internal/pending.md): custody runs on it now as the reference
 * implementation; scene/world (SceneEditor) fold in as step 3, at which point the tab lists become a
 * per-kind registry (scene/world: write·preview·source — custody: chart·records·preview·source) and
 * extension-contributed page modes are just more entries.
 */
import type { JSX, ReactNode } from 'react'
import { regionAttrs, type RegionId } from '@/config/regions'
import { RailTabs } from '@/components/ui/RailHeader'
import { useTabTarget } from '@/lib/editor/saveTarget'

export function PageShell<T extends string>({
  title,
  kind,
  badges,
  tabs,
  tab,
  onTab,
  hint,
  actions,
  region,
  children
}: {
  title: string
  kind?: string
  badges?: ReactNode // e.g. an error count chip, phase dot…
  tabs: readonly T[]
  tab: T
  onTab: (t: T) => void
  hint?: ReactNode // right-aligned helper text (styled by the caller)
  actions?: ReactNode // right-edge buttons (Save, …)
  region?: RegionId
  children: ReactNode
}): JSX.Element {
  // F1–F9 → the Nth tab (write/preview/source · custody chart/records/…). Registered while this page chrome is
  // mounted; AppShell dispatches the key (see lib/saveTarget useTabTarget). Only one PageShell mounts at a time.
  useTabTarget(true, tabs.length, (i) => onTab(tabs[i]))
  return (
    <div {...(region ? regionAttrs(region) : {})} className="relative flex min-h-0 flex-1 flex-col">
      {/* the STANDARD page header: tabs LEFT · title in a FIXED 35%–65% center band (flex-centering
          drifted with the asymmetric tab/action widths — the band keeps it put) · actions RIGHT */}
      <div className="relative flex h-9 shrink-0 items-center gap-3 border-b border-border px-3 text-[11px] text-muted-foreground">
        <RailTabs tabs={tabs} value={tab} onChange={onTab} />
        <div className="pointer-events-none absolute inset-y-0 left-[35%] right-[35%] flex items-center justify-center gap-2">
          <span className="pointer-events-auto min-w-0 truncate font-medium text-foreground" title={title}>
            {title}
          </span>
          {kind && <span className="pointer-events-auto shrink-0 rounded border border-border px-1 text-[10px] text-faint">{kind}</span>}
          {badges && <span className="pointer-events-auto flex shrink-0 items-center gap-2">{badges}</span>}
        </div>
        <div className="flex-1" />
        <span className="shrink-0">{hint}</span>
        {actions}
      </div>
      {children}
    </div>
  )
}
