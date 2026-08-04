/**
 * Pro badge — the header chip beside the version. Opens the ProDialog (status when active; "coming soon + share"
 * while there's no offer). All the Pro logic (entitlement, activation, share) lives in ProDialog; this is just
 * the trigger + the active/inactive chip styling.
 */
import { type JSX, useState } from 'react'
import { useWorkspace } from '@/stores/workspace'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProDialog } from '@/components/layout/ProDialog'

export function ProBadge(): JSX.Element {
  const pro = useWorkspace((s) => s.pro)
  const [open, setOpen] = useState(false)

  return (
    <div className="app-no-drag relative mr-1">
      <button
        onClick={() => setOpen(true)}
        title={pro ? 'NVS Pro — active' : 'NVS Pro'}
        className={cn(
          'flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors',
          pro
            ? 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-400'
            : 'text-muted-foreground hover:bg-panel-soft hover:text-foreground'
        )}
      >
        <Sparkles className="size-3" />
        {pro ? 'PRO' : 'Pro'}
      </button>

      <ProDialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
