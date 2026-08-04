import { useState, type JSX, type ReactNode } from 'react'
import { Package, FileArchive, Users, Image as ImageIcon, Loader2 } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Dialog } from '@/components/ui/dialog'
import { DiscordIcon, XIcon, InstagramIcon } from '@/components/ui/BrandIcons'
import { labelOf, MEDIUMS, STATUSES } from '@shared/config/projectSchema'
import { cn } from '@/lib/utils'

/**
 * Share — an OS-style share sheet: a slim project identity strip, then two docks of icon tiles.
 * EXPORT = a local file (a single `.nvsproj` works today; .zip / Markdown are stubbed). SHARE TO = the NVS
 * community + socials (all stubbed until the publish flow lands). One live action; the rest are dimmed "soon".
 */
export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const info = useWorkspace((s) => s.projectInfo)
  const project = useWorkspace((s) => s.project)
  const exportProject = useWorkspace((s) => s.exportProject)
  const exportManuscript = useWorkspace((s) => s.exportManuscript)
  const [busy, setBusy] = useState<'nvsproj' | 'zip' | null>(null)

  const run = (key: 'nvsproj' | 'zip', fn: () => Promise<boolean>) => async (): Promise<void> => {
    setBusy(key)
    const ok = await fn()
    setBusy(null)
    if (ok) onClose() // a cancelled OS save dialog just leaves this open
  }

  const coverUrl = info?.cover ? `nvs-asset://${info.cover}?t=${encodeURIComponent(info.updatedAt ?? '')}` : null
  const sub = [info?.medium && labelOf(MEDIUMS, info.medium), info?.status && labelOf(STATUSES, info.status)]
    .filter(Boolean)
    .join(' · ')

  return (
    <Dialog region="shareDialog" open={open} onClose={onClose} title="Share" size="panel">
      <div className="space-y-5">
        {/* slim identity — context without the full book card */}
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-panel-soft">
            {coverUrl ? <img src={coverUrl} alt="" className="size-full object-cover" draggable={false} /> : <ImageIcon className="size-4 text-faint" />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{info?.title || project?.name || 'Untitled'}</div>
            {(sub || info?.author) && (
              <div className="truncate text-[11px] text-faint">{[sub, info?.author].filter(Boolean).join('  ·  ')}</div>
            )}
          </div>
        </div>

        <Group title="Export a file">
          <Tile icon={<Package />} label=".nvsproj" iconClass="text-thread" busy={busy === 'nvsproj'} disabled={busy !== null} onClick={() => void run('nvsproj', exportProject)()} />
          <Tile icon={<FileArchive />} label=".zip" iconClass="text-lore" busy={busy === 'zip'} disabled={busy !== null} onClick={() => void run('zip', exportManuscript)()} />
          {/* Structured JSON/CSV/MD export is SCENE-scoped (the scene editor's Export button) — a whole-project
              dump is too large to be a useful interchange unit, so it's not offered here at project level. */}
        </Group>

        <Group title="Share to">
          <Tile icon={<Users />} label="Community" iconClass="text-thread" disabled />
          <Tile icon={<DiscordIcon />} label="Discord" iconClass="text-[#5865F2]" disabled />
          <Tile icon={<XIcon />} label="X" iconClass="text-foreground" disabled />
          <Tile icon={<InstagramIcon />} label="Instagram" iconClass="text-[#E1306C]" disabled />
        </Group>

        <p className="text-[11px] text-faint">
          A <span className="font-mono">.nvsproj</span> carries the prose <i>and</i> the analysis in one self-contained
          file. Community &amp; social sharing are coming soon.
        </p>
      </div>
    </Dialog>
  )
}

/** A labeled dock of tiles (Export · Share to). */
function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{title}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

/** One share-sheet tile: rounded icon badge + caption. Dimmed + inert when `disabled`. */
function Tile({
  icon,
  label,
  iconClass,
  onClick,
  disabled,
  busy
}: {
  icon: ReactNode
  label: string
  iconClass: string
  onClick?: () => void
  disabled?: boolean
  busy?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={disabled ? 'Coming soon' : undefined}
      className={cn(
        'flex w-19 flex-col items-center gap-1.5 rounded-lg p-1 text-center transition-colors',
        disabled ? 'cursor-default opacity-40' : 'hover:bg-panel-soft'
      )}
    >
      <span className={cn('flex size-14 items-center justify-center rounded-2xl border border-border bg-panel-soft [&_svg]:size-6', iconClass)}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : icon}
      </span>
      <span className="text-[11px] leading-tight text-muted-foreground">{label}</span>
    </button>
  )
}

