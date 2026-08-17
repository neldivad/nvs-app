/**
 * Extension PERMISSIONS — the ONE place capabilities are rendered, so every surface (browse card, detail,
 * install prompt) describes an extension's access the same way: glossed in plain English (via the shared
 * `describeCapability` catalog), tagged read (eye · thread) vs write (pencil · flag). The out-of-process
 * sandbox means the declared list IS the full blast radius — nothing off-list is reachable.
 *
 * Two views, one catalog:
 *   • PermissionSummary — a compact inline row for the browse card (glossed chips, capped, read/write coloured).
 *   • PermissionList    — the full "what can this access?" panel for the detail.
 */
import { Eye, PencilLine, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { describeCapability } from '@shared/config/capabilities'

const scopeIcon = (scope: 'read' | 'write'): LucideIcon => (scope === 'write' ? PencilLine : Eye)
const scopeColor = (scope: 'read' | 'write'): string => (scope === 'write' ? 'text-flag' : 'text-thread')

/** Compact permission row for a CARD — glossed labels, read/write coloured, capped with a "+N" overflow.
 *  Zero capabilities (e.g. a font extension) reads as a calm "no access" instead of an empty gap. */
export function PermissionSummary({ required, optional, cap = 3 }: { required: string[]; optional?: string[]; cap?: number }): JSX.Element {
  const { t } = useTranslation('extensions')
  const all = [...required, ...(optional ?? [])]
  if (all.length === 0) {
    return (
      <span className="flex items-center gap-0.5 text-ok">
        <ShieldCheck className="size-3 shrink-0" /> {t('permissions.noAccessNeeded')}
      </span>
    )
  }
  const shown = all.slice(0, cap)
  return (
    <>
      {shown.map((id) => {
        const g = describeCapability(id)
        const Icon = scopeIcon(g.scope)
        return (
          <span key={id} title={g.detail} className={cn('flex items-center gap-0.5', scopeColor(g.scope))}>
            <Icon className="size-3 shrink-0" /> {g.label}
          </span>
        )
      })}
      {all.length > cap && <span className="text-faint">{t('permissions.moreCount', { n: all.length - cap })}</span>}
    </>
  )
}

/** The full "what can this extension access?" panel for the DETAIL — each capability glossed + scoped, with the
 *  sandbox reassurance. (Was `PermissionPanel`, inlined in ExtensionPage; standardized here so it can't drift.) */
export function PermissionList({ required, optional }: { required: string[]; optional?: string[] }): JSX.Element {
  const { t } = useTranslation('extensions')
  if (required.length === 0 && (optional?.length ?? 0) === 0) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 type-caption text-ok">
        <ShieldCheck className="size-3.5 shrink-0" /> {t('permissions.noAccessDetail')}
      </div>
    )
  }
  const row = (id: string, dim = false): JSX.Element => {
    const g = describeCapability(id)
    const Icon = scopeIcon(g.scope)
    return (
      <div key={id} className={cn('flex items-start gap-2.5 px-3 py-2', dim && 'opacity-60')}>
        <Icon className={cn('mt-0.5 size-4 shrink-0', scopeColor(g.scope))} />
        <div className="min-w-0">
          <div className="type-caption font-medium text-foreground">
            {g.label}
            {dim && <span className="type-micro ml-1 text-faint">{t('permissions.optional')}</span>}
          </div>
          <div className="type-caption text-muted-foreground">{g.detail}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-1 type-label text-faint">
        <ShieldCheck className="size-3" /> {t('permissions.heading')}
      </div>
      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
        {required.map((c) => row(c))}
        {(optional ?? []).map((c) => row(c, true))}
      </div>
      <p className="mt-1.5 type-micro text-faint">{t('permissions.sandboxNote')}</p>
    </div>
  )
}
