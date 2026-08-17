/**
 * NVS Settings — global (per-user) preferences, persisted in localStorage (not per-project). The home for
 * feature toggles that are critical to a SUBSET of authors but bloat for the majority — the first is `showMood`
 * (VN-style delivery tags). Toggles here gate VISIBILITY/affordances only; they never touch prose or files.
 *
 * Store-driven open state (`settingsOpen`), like ProjectConfigDialog. Grows over time — the AI master switch and
 * language/i18n land here as their own rows/sections.
 */
import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react'
import { Loader2, Sparkles, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/stores/workspace'
import type { UiLocale } from '@/config/i18n'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import type { StorageRow, UpdateCheck } from '@shared/ipc'

export function SettingsDialog(): JSX.Element {
  const open = useWorkspace((s) => s.settingsOpen)
  const setOpen = useWorkspace((s) => s.setSettingsOpen)
  const showMood = useWorkspace((s) => s.showMood)
  const setShowMood = useWorkspace((s) => s.setShowMood)
  const showTiming = useWorkspace((s) => s.showTiming)
  const setShowTiming = useWorkspace((s) => s.setShowTiming)
  const editableSource = useWorkspace((s) => s.editableSource)
  const setEditableSource = useWorkspace((s) => s.setEditableSource)
  const aiEnabled = useWorkspace((s) => s.aiEnabled)
  const setAiEnabled = useWorkspace((s) => s.setAiEnabled)
  const uiLocale = useWorkspace((s) => s.uiLocale)
  const setUiLocale = useWorkspace((s) => s.setUiLocale)
  const { t } = useTranslation('settings')

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title={t('title')} size="detail">
      <div className="space-y-6">
        <Section title={t('section.language')}>
          <SelectRow
            label={t('language.label')}
            hint={t('language.hint')}
            value={uiLocale}
            onChange={(v) => setUiLocale(v as UiLocale)}
            options={[
              { value: 'system', label: t('language.system') },
              { value: 'en', label: 'English' },
              { value: 'zh', label: '中文' },
              { value: 'ja', label: '日本語' }
            ]}
          />
        </Section>
        <Section title={t('section.editor')}>
          <ToggleRow
            label={t('editor.showMood.label')}
            hint={t('editor.showMood.hint')}
            checked={showMood}
            onChange={setShowMood}
          />
          <ToggleRow
            label={t('editor.showTiming.label')}
            hint={t('editor.showTiming.hint')}
            checked={showTiming}
            onChange={setShowTiming}
          />
        </Section>
        <Section title={t('section.ai')}>
          <ToggleRow
            label={t('ai.features.label')}
            hint={t('ai.features.hint')}
            checked={aiEnabled}
            onChange={setAiEnabled}
          />
        </Section>
        <Section title={t('section.advanced')}>
          <ToggleRow
            label={t('advanced.editSource.label')}
            hint={t('advanced.editSource.hint')}
            checked={editableSource}
            onChange={setEditableSource}
            danger
          />
        </Section>
        <UpdatesRow />
        {open && <StorageClean />}
      </div>
    </Dialog>
  )
}

/** Updates — NVS does not auto-update; this is the manual "am I current?" check + a link to the download page.
 *  On launch the app also runs this once and pushes a dismissible mailbox nudge if a newer release exists. */
function UpdatesRow(): JSX.Element {
  const { t } = useTranslation('settings')
  const runUpdateCheck = useWorkspace((s) => s.runUpdateCheck)
  const [current, setCurrent] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<UpdateCheck | null>(null)

  useEffect(() => { void window.nvs.ping().then((r) => setCurrent(r.version)).catch(() => {}) }, [])

  const check = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await runUpdateCheck({ force: true })
      setRes(r)
      if (r?.current) setCurrent(r.current)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t('section.updates')}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-foreground">
            {t('updates.current')}
            <span className="ml-1.5 tabular-nums text-muted-foreground">{current || '—'}</span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t('updates.hint')}</p>
          {!busy && res && (
            <div className="mt-1 flex items-center gap-2 text-[10px]">
              {res.isNewer && res.latest ? (
                <>
                  <span className="text-thread">{t('updates.available', { version: res.latest })}</span>
                  <button type="button" onClick={() => void window.nvs.openUrl?.(res.url)} className="text-thread underline-offset-2 hover:underline">{t('updates.download')}</button>
                </>
              ) : res.latest ? (
                <span className="text-ok">{t('updates.upToDate')}</span>
              ) : (
                <span className="text-faint">{t('updates.failed')}</span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void check()}
          className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-thread px-3 py-1.5 text-[12px] font-medium text-thread-foreground transition-colors hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          {busy ? t('updates.checking') : t('updates.check')}
        </button>
      </div>
    </Section>
  )
}

/** bytes → compact human string (1.2 GB, 340 MB, 512 KB). NaN/0 → "0 B". */
function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/**
 * Storage — the one-button "my project is bloating, just make it smaller (safely)" for the CURRENT project. The
 * detailed per-project / per-category console lives in Jobs → Storage; this is the low-effort quick win. It only
 * ever clears things you can't miss — reset backups + diagnostic logs — and COMPACTS version history (gzip, every
 * revert point kept). Never deletes chat, unapplied tasks, the analysis DB, or a single word of prose.
 */
function StorageClean(): JSX.Element {
  const { t } = useTranslation('settings')
  const project = useWorkspace((s) => s.project)
  const [row, setRow] = useState<StorageRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [freed, setFreed] = useState<number | null>(null)

  const scan = useCallback(async (): Promise<void> => {
    if (!project) return setRow(null)
    try {
      const all = await window.nvs.storageUsage()
      setRow(all.find((r) => r.root === project.root) ?? null)
    } catch {
      setRow(null)
    }
  }, [project])
  useEffect(() => {
    void scan()
  }, [scan])

  // Safe-to-reclaim right now = full reset backups + diagnostic logs (deleting loses nothing). History is reclaimed
  // by a NON-destructive compact, so it counts toward "can be freed" without a data-loss warning.
  const safeNow = row ? row.backupsBytes + row.logsBytes : 0
  const canClean = !!row && (safeNow > 0 || row.historyBytes > 0)

  const clean = async (): Promise<void> => {
    if (!project || !row) return
    setBusy(true)
    setFreed(null)
    const before = row.totalBytes
    try {
      if (row.backupsBytes) await window.nvs.clearStorage(project.root, 'backups')
      if (row.logsBytes) await window.nvs.clearStorage(project.root, 'logs')
      if (row.historyBytes) await window.nvs.compactSnapshots(project.root)
      await scan()
      const all = await window.nvs.storageUsage()
      const next = all.find((r) => r.root === project.root)
      setFreed(next ? Math.max(0, before - next.totalBytes) : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t('section.storage')}>
      {/* Mirrors ToggleRow: description on the left, the ACTION flush-right — so the Clean up button lines up
          with the toggle switches above instead of floating on the left. */}
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {!project ? (
            <p className="text-[12px] text-muted-foreground">{t('storage.openToManage')}</p>
          ) : (
            <>
              <div className="text-[13px] text-foreground">
                {t('storage.onDisk')}
                <span className="ml-1.5 tabular-nums text-muted-foreground">{fmtBytes(row?.totalBytes ?? 0)}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {canClean
                  ? t('storage.canClean', { bytes: fmtBytes(safeNow) })
                  : t('storage.tidy')}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[10px]">
                {freed !== null && !busy && (
                  <span className="text-ok">{freed > 0 ? t('storage.freed', { bytes: fmtBytes(freed) }) : t('storage.alreadyClean')}</span>
                )}
                <span className="text-faint">{t('storage.moreOptions')}</span>
              </div>
            </>
          )}
        </div>
        {project && (
          <button
            type="button"
            disabled={!canClean || busy}
            onClick={() => void clean()}
            className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-thread px-3 py-1.5 text-[12px] font-medium text-thread-foreground transition-colors hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            {busy ? t('storage.cleaning') : t('storage.clean')}
          </button>
        )}
      </div>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <div className="divide-y divide-border/60 rounded-lg border border-border">{children}</div>
    </section>
  )
}

/** A preference row with a dropdown instead of a switch — for enum prefs (e.g. UI language). Mirrors ToggleRow's
 *  layout: label + hint on the left, the control flush-right. */
function SelectRow({ label, hint, value, options, onChange }: { label: string; hint?: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }): JSX.Element {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <Select value={value} onChange={onChange} options={options} className="mt-0.5 w-40 shrink-0" />
    </div>
  )
}

/** One preference row: label + hint on the left, a switch on the right. `danger` tints the ON state (an
 *  advanced/consequential toggle, e.g. direct source editing) so it reads distinctly from the benign ones. */
function ToggleRow({ label, hint, checked, onChange, danger }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; danger?: boolean }): JSX.Element {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors', checked ? (danger ? 'bg-flag' : 'bg-thread') : 'bg-border')}
      >
        <span className={cn('absolute top-0.5 size-3 rounded-full bg-panel shadow-sm transition-all', checked ? 'left-3.5' : 'left-0.5')} />
      </button>
    </div>
  )
}
