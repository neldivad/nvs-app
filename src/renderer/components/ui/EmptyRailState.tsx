/**
 * The ONE empty-state family for rails (author rule: an empty surface teaches, centered — never a corner
 * whisper). Three tiers, one visual language:
 *   `EmptyRailState`  — rail ROOT (nothing at all): full what/how/role teaching copy from config/railEmpty.ts
 *   `EmptyHint`       — TAB / contextual empty (rail has data, this view doesn't): same shell + rail icon,
 *                       a short situational message
 *   `SidebarEmpty`    — the standard small note for sidebar lists (strips too narrow for the shell)
 * Copy for rail roots lives in config/railEmpty.ts (data); icons map here (components own lucide — the
 * jobs.ts convention). Contextual EmptyHint copy stays at the call site (it interpolates local state).
 */
import type { JSX, ReactNode } from 'react'
import { Activity, TrendingUp, Package, BookOpen, ShieldAlert, KeyRound, HeartHandshake, Users, Clock } from 'lucide-react'
import { RAIL_EMPTY, type RailEmptyId } from '@/config/railEmpty'

const ICONS: Record<RailEmptyId, typeof Activity> = {
  threads: Activity,
  cast: Users,
  arcs: TrendingUp,
  entities: Package,
  lore: BookOpen,
  coherence: ShieldAlert,
  custody: KeyRound,
  relationships: HeartHandshake,
  timeline: Clock
}

/** The shared centered shell — every panel/tab empty renders through this so they all match. */
function Shell({ icon: Icon, title, children }: { icon: typeof Activity; title?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex h-full min-h-40 flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <Icon className="mx-auto mb-3 size-7 text-faint" />
        {title && <div className="mb-1.5 text-[13px] font-semibold text-foreground/85">{title}</div>}
        {children}
      </div>
    </div>
  )
}

/** Rail-root empty: the full what/how/role teaching copy from config. */
export function EmptyRailState({ rail, action }: { rail: RailEmptyId; action?: JSX.Element }): JSX.Element {
  const c = RAIL_EMPTY[rail]
  return (
    <Shell icon={ICONS[rail]} title={c.title}>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{c.what}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{c.how}</p>
      <p className="mt-3 text-[11px] text-faint">{c.role}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Shell>
  )
}

/** Tab / contextual empty: rail icon + optional title + a short situational message (children). */
export function EmptyHint({ rail, title, children }: { rail: RailEmptyId; title?: string; children: ReactNode }): JSX.Element {
  return (
    <Shell icon={ICONS[rail]} title={title}>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{children}</p>
    </Shell>
  )
}

/** The standard sidebar-list empty note — one style for every rail's sidebar. */
export function SidebarEmpty({ children }: { children: ReactNode }): JSX.Element {
  return <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">{children}</p>
}
