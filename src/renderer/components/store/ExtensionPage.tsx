/**
 * ExtensionPage — the TOOLS half of the Store. Tabs: Browse (all), Installed (granted + on disk), Updates
 * (needs the registry-vs-installed version diff — honest placeholder until that IPC lands). Cards + detail
 * compose the shared StoreCard / StoreDetail (ExtensionCard / ExtensionDetail). Extensions run out-of-process
 * and only get the capabilities their manifest declares.
 */
import { useEffect, useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Check, Download, Power, Puzzle, ShieldCheck, TimerReset, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { StoreCard, StoreDetail } from '@/components/store/StoreCard'
import { PermissionList, PermissionSummary } from '@/components/store/Permissions'
import { applyUiContributions } from '@/lib/uiContributions'
import type { ExtensionInfo } from '@shared/ipc'

type SubTab = 'browse' | 'installed' | 'updates'

export function ExtensionPage({ search }: { search: string }): JSX.Element {
  const { t } = useTranslation('extensions')
  const [sub, setSub] = useState<SubTab>('browse')
  const [exts, setExts] = useState<ExtensionInfo[]>([])
  const [extErr, setExtErr] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void window.nvs.listExtensions?.().then(setExts).catch(() => {})
  }, [])

  // Re-list AND re-apply ambient (ui) contributions — a font extension's effect must track install/enable/remove.
  const refresh = (): void => void window.nvs.listExtensions().then(setExts).finally(() => void applyUiContributions())
  const install = (id: string): void => void window.nvs.installExtension(id).then((r) => {
    if (r.ok) refresh()
    else setExtErr((e) => ({ ...e, [id]: r.reasons.join(' · ') }))
  })
  // The store ACQUIRES + CONFIGURES; it never runs. Running an active extension is a separate surface
  // (the RightRail launcher). Here: install · uninstall · enable/disable.
  const uninstall = (id: string): void => void window.nvs.uninstallExtension(id).then(refresh)
  const setEnabled = (id: string, enabled: boolean): void => void window.nvs.setExtensionEnabled(id, enabled).then(refresh)

  const q = search.trim().toLowerCase()
  const matches = (x: ExtensionInfo): boolean => !q || `${x.name} ${x.kind} ${x.description ?? ''}`.toLowerCase().includes(q)
  const installed = useMemo(() => exts.filter((x) => x.installed), [exts])
  const list = useMemo(() => (sub === 'installed' ? installed : exts).filter(matches), [sub, exts, installed, q])

  const detailActions = (x: ExtensionInfo): JSX.Element =>
    !x.installed ? (
      <Button size="sm" disabled={!x.check.ok} title={x.check.ok ? t('installReady') : x.check.reasons.join(' · ')} onClick={() => install(x.id)}>
        <Download className="size-3.5" /> {t('install')}
      </Button>
    ) : (
      <>
        <EnabledToggle enabled={x.enabled !== false} onChange={(v) => setEnabled(x.id, v)} />
        <Button size="sm" variant="outline" onClick={() => uninstall(x.id)} title={t('uninstallTitle')}><Trash2 className="size-3.5" /> {t('uninstall')}</Button>
      </>
    )

  // ── Detail ──────────────────────────────────────────────────────────────
  const selected = selectedId ? exts.find((x) => x.id === selectedId) ?? null : null
  if (selected) {
    const disabled = selected.installed && selected.enabled === false
    return (
      <StoreDetail
        onBack={() => setSelectedId(null)}
        icon={TimerReset}
        title={selected.name}
        subtitle={`v${selected.version} · ${selected.kind}`}
        meta={<>
          {selected.check.ok ? <span className="flex items-center gap-0.5 text-ok"><ShieldCheck className="size-3" /> {t('status.compatible')}</span> : <span className="text-flag" title={selected.check.reasons.join(' · ')}>{t('status.incompatible')}</span>}
          {selected.installed && (disabled ? <span className="flex items-center gap-0.5 text-faint">{t('status.disabled')}</span> : <span className="flex items-center gap-0.5 text-ok"><Check className="size-3" /> {t('status.installed')}</span>)}
        </>}
        actions={detailActions(selected)}
      >
        {selected.description && <p className="type-body-sm text-muted-foreground">{selected.description}</p>}
        <PermissionList required={selected.capabilities.required} optional={selected.capabilities.optional} />
        {!selected.check.ok && <p className="mt-3 type-caption text-flag">{t('incompatibleReasons', { reasons: selected.check.reasons.join(' · ') })}</p>}
        {extErr[selected.id] && <p className="mt-2 type-caption text-flag">{extErr[selected.id]}</p>}
      </StoreDetail>
    )
  }

  // ── Grid ────────────────────────────────────────────────────────────────
  return (
    <div>
      <SubTabs sub={sub} setSub={setSub} installedCount={installed.length} />
      {sub !== 'updates' && (!q || 'claude desktop plugin'.includes(q)) && <ClaudePluginCard />}
      {sub === 'updates' ? (
        <Empty text={t('empty.updates')} />
      ) : list.length === 0 ? (
        <Empty text={q ? t('empty.search') : sub === 'installed' ? t('empty.installed') : t('empty.browse')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((x) => (
            // Pure listing — install/permissions live in the detail (click the card). The store shows install
            // STATE, not run controls; running an extension belongs to a separate surface, not the browse grid.
            <StoreCard
              key={x.id}
              icon={TimerReset}
              title={x.name}
              subtitle={`v${x.version} · ${x.kind}`}
              badge={x.installed ? <span className="flex items-center gap-0.5 text-[10px] text-ok" title={t('status.installedTitle')}><Check className="size-3.5 shrink-0" /></span> : x.check.ok ? <span title={t('status.compatibleTitle')}><ShieldCheck className="size-3.5 shrink-0 text-ok" /></span> : <span className="text-[9px] text-flag" title={x.check.reasons.join(' · ')}>{t('status.incompatible')}</span>}
              meta={<><PermissionSummary required={x.capabilities.required} optional={x.capabilities.optional} />{x.installed && (x.enabled === false ? <span className="text-faint">{t('status.disabled')}</span> : <span className="flex items-center gap-0.5 text-ok"><Check className="size-3" /> {t('status.installed')}</span>)}</>}
              onOpen={() => setSelectedId(x.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The one extension NVS ships FOR another app. It's pinned above the grid rather than listed as an
 * ExtensionInfo because it's the inverse of everything else here: it doesn't run inside NVS or hold
 * capabilities — it teaches Claude to drive NVS. Its action is Download, not Install; Claude installs it.
 */
function ClaudePluginCard(): JSX.Element {
  const { t } = useTranslation('extensions')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [err, setErr] = useState('')
  const get = async (): Promise<void> => {
    setState('busy')
    try {
      if (!window.nvs.generateClaudePlugin) throw new Error(t('claudePlugin.restart'))
      const r = await window.nvs.generateClaudePlugin()
      if (r.ok) setState('done')
      else if (r.error === 'cancelled') setState('idle')
      else { setErr(r.error ?? t('claudePlugin.buildError')); setState('error') }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); setState('error')
    }
  }
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-lore/30 bg-lore/5 p-4 sm:flex-row sm:items-center">
      <Bot className="size-5 shrink-0 text-lore" />
      <div className="min-w-0 flex-1">
        <div className="type-card-title flex flex-wrap items-center gap-2">
          {t('claudePlugin.title')}
          <span className="rounded-full bg-lore/15 px-1.5 py-0.5 text-[10px] font-medium text-lore">{t('claudePlugin.builtIn')}</span>
        </div>
        <p className="type-caption mt-0.5 text-muted-foreground">
          {t('claudePlugin.desc')} <code>/nvs</code>.
        </p>
        {state === 'error' && <p className="type-caption mt-1 text-flag">{err}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {state === 'done' && <span className="type-caption flex items-center gap-1 text-ok"><Check className="size-3.5" /> {t('claudePlugin.saved')}</span>}
        <Button size="sm" disabled={state === 'busy'} onClick={() => void get()}>
          <Download className="size-3.5" /> {state === 'busy' ? t('claudePlugin.saving') : t('claudePlugin.download')}
        </Button>
      </div>
    </div>
  )
}

/** Enable/disable pill — the ambient (ui) extension's on/off; also gates an active one's availability. Toggling
 *  persists via setExtensionEnabled; no uninstall, no run. */
function EnabledToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }): JSX.Element {
  const { t } = useTranslation('extensions')
  return (
    <button
      onClick={() => onChange(!enabled)}
      title={enabled ? t('toggle.enabledTitle') : t('toggle.disabledTitle')}
      className={cn('flex items-center gap-1.5 rounded-md type-caption border px-2 py-1 transition-colors', enabled ? 'border-ok/40 text-ok hover:bg-ok/10' : 'border-border text-muted-foreground hover:text-foreground')}
    >
      <Power className="size-3.5" /> {enabled ? t('toggle.enabled') : t('toggle.disabled')}
    </button>
  )
}

function SubTabs({ sub, setSub, installedCount }: { sub: SubTab; setSub: (t: SubTab) => void; installedCount: number }): JSX.Element {
  const { t } = useTranslation('extensions')
  const btn = (tab: SubTab, label: string): JSX.Element => (
    <button onClick={() => setSub(tab)} className={cn('type-caption rounded-md px-2.5 py-1 transition-colors', sub === tab ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
  )
  return (
    <div className="mb-4 flex items-center gap-1">
      {btn('browse', t('subtabs.browse'))}
      {btn('installed', installedCount ? t('subtabs.installedCount', { n: installedCount }) : t('subtabs.installed'))}
      {btn('updates', t('subtabs.updates'))}
    </div>
  )
}
const Empty = ({ text }: { text: string }): JSX.Element => <p className="rounded-lg border border-dashed border-border type-body-sm p-10 text-center text-muted-foreground"><Puzzle className="mx-auto mb-2 size-6 text-faint" />{text}</p>
