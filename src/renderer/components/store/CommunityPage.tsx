/**
 * CommunityPage — the CONTENT half of the Store. Three tabs:
 *   • Browse  — the oracle-gated registry (install a shared work into your library)
 *   • Library — works you already have on disk (open, or remove)
 *   • History — the reading list: every work you've ever downloaded, kept even after the local copy is gone
 *
 * Grid cards compose the shared StoreCard. The DETAIL view reuses `BookCard` — the SAME user-facing render of a
 * project's `ProjectInfo` used by the library's Project Details / Share dialogs. A `RegistryWork` is just a thin
 * projection of that schema, so browse-detail and library-detail show one consistent card; the registry side is
 * sparse until the publish pipeline lifts the rich fields into the index (registryWorkToProjectInfo).
 */
import { useEffect, useMemo, useState, type JSX } from 'react'
import { ArrowLeft, BookOpen, Check, Clock, Download, Loader2, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { StoreCard, Chip } from '@/components/store/StoreCard'
import { BookCard } from '@/components/store/ProjectCard'
import type { DownloadEntry, ProjectInfo, RegistryIndex, RegistryWork, WorkCard } from '@shared/ipc'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

type SubTab = 'browse' | 'library' | 'history'

/** The "Size" line — scene / world / custody page counts. Beats are dropped on purpose: a raw beat count
 *  says nothing to a reader. World/custody are optional on registry entries (thin/older index) → omit what's absent. */
function sizeMeta(t: TFunction, scenes: number, world?: number, custody?: number): string {
  const parts = [t('size.scenes', { count: scenes })]
  if (world != null) parts.push(t('size.world', { n: world }))
  if (custody != null) parts.push(t('size.custody', { n: custody }))
  return parts.join(' · ')
}

type InstallState = { status: 'installing' } | { status: 'done'; path: string } | { status: 'error'; error: string }

/** A RegistryWork is a thin projection of ProjectInfo (schema.org CreativeWork) — lift it back so browse-detail
 *  renders the same BookCard as the library. Sparse fields (thin index) just render as absent; BookCard degrades. */
function registryWorkToProjectInfo(w: RegistryWork): ProjectInfo {
  return {
    title: w.title,
    subtitle: w.subtitle,
    logline: w.logline,
    description: w.description,
    author: w.author ?? undefined,
    medium: w.medium,
    status: w.status,
    inLanguage: w.inLanguage ?? (w.language ? [w.language] : undefined),
    genre: w.genre,
    about: w.about,
    contentRating: w.contentRating,
    keywords: w.keywords,
    contributor: w.contributor,
    version: w.version
    // cover lives inside the bundle (unavailable pre-download); coverUrl is a future field — placeholder for now.
  }
}

/** A scrollable strip of in-app screenshots (RegistryWork.previews) — what the work looks like INSIDE NVS, so a
 *  reader can inspect the writing experience before installing. Click to zoom; renders nothing when there are none. */
function PreviewStrip({ previews }: { previews?: { label: string; url: string }[] }): JSX.Element | null {
  const { t } = useTranslation('community')
  const [zoom, setZoom] = useState<string | null>(null)
  if (!previews?.length) return null
  return (
    <div className="mt-5">
      <div className="mb-2 type-caption font-medium uppercase tracking-wide text-faint">{t('preview.heading')}</div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {previews.map((p) => (
          <button key={p.url} type="button" onClick={() => setZoom(p.url)} title={t('tooltip.enlarge', { label: p.label })} className="group shrink-0 text-left">
            <img src={p.url} alt={p.label} loading="lazy" className="h-40 w-auto rounded-md border border-border object-cover transition-transform group-hover:scale-[1.015]" />
            <div className="mt-1 type-caption text-muted-foreground">{p.label}</div>
          </button>
        ))}
      </div>
      {zoom && (
        <div onClick={() => setZoom(null)} className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 p-8">
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg border border-border shadow-2xl" />
        </div>
      )}
    </div>
  )
}

export function CommunityPage({ search }: { search: string }): JSX.Element {
  const { t } = useTranslation('community')
  const works = useWorkspace((s) => s.works)
  const loadWorks = useWorkspace((s) => s.loadWorks)
  const openWork = useWorkspace((s) => s.openWork)
  const setDiscoverOpen = useWorkspace((s) => s.setDiscoverOpen)

  const [sub, setSub] = useState<SubTab>('browse')
  const [index, setIndex] = useState<RegistryIndex | null | 'loading' | 'unreachable'>('loading')
  const [downloads, setDownloads] = useState<DownloadEntry[]>([])
  const [installs, setInstalls] = useState<Record<string, InstallState>>({})
  const [appVersion, setAppVersion] = useState('')
  const [selected, setSelected] = useState<{ kind: 'registry'; w: RegistryWork } | { kind: 'work'; w: WorkCard } | null>(null)
  const [libInfo, setLibInfo] = useState<ProjectInfo | null>(null)

  const loadDownloads = (): void => void window.nvs.listDownloads?.().then(setDownloads).catch(() => {})
  useEffect(() => {
    const req = window.nvs.fetchRegistry?.()
    if (!req) setIndex('unreachable')
    else void req.then((idx) => setIndex(idx ?? 'unreachable')).catch(() => setIndex('unreachable'))
    void window.nvs.ping().then((r) => setAppVersion(r.version)).catch(() => {})
    loadDownloads()
  }, [])

  // Library detail reads the REAL project.json (full BookCard); registry detail projects the index entry.
  useEffect(() => {
    if (selected?.kind !== 'work') return setLibInfo(null)
    let live = true
    setLibInfo(null)
    void window.nvs.readProjectInfoAt(selected.w.path).then((i) => { if (live) setLibInfo(i) })
    return () => { live = false }
  }, [selected])

  const tooOld = (w: RegistryWork): boolean => {
    if (!w.minAppVersion || !appVersion) return false
    const a = appVersion.split('.').map(Number)
    const b = w.minAppVersion.split('.').map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0)
      if (d !== 0) return d < 0
    }
    return false
  }
  const inLibrary = (w: RegistryWork): boolean => works.some((c) => (c.title ?? c.name) === w.title)

  async function install(w: RegistryWork): Promise<void> {
    setInstalls((s) => ({ ...s, [w.id]: { status: 'installing' } }))
    const res = await window.nvs.installCommunityWork(w)
    if (res.ok && res.path) {
      setInstalls((s) => ({ ...s, [w.id]: { status: 'done', path: res.path! } }))
      await loadWorks()
      loadDownloads() // the reading list just gained a row
    } else {
      setInstalls((s) => ({ ...s, [w.id]: { status: 'error', error: res.error ?? t('error.installFailed') } }))
    }
  }
  const open = (path: string): void => { void openWork(path); setDiscoverOpen(null) }
  async function remove(w: WorkCard): Promise<void> {
    if (!confirm(t('confirm.remove', { title: w.title ?? w.name }))) return
    await window.nvs.deleteWork(w.path)
    await loadWorks()
    setSelected(null)
  }

  const q = search.trim().toLowerCase()
  const registryWorks = useMemo(
    () => (typeof index === 'object' && index ? index.works.filter((w) => !w.deprecated && (!q || `${w.title} ${w.author ?? ''} ${(Array.isArray(w.genre) ? w.genre : []).join(' ')}`.toLowerCase().includes(q))) : []),
    [index, q]
  )
  const libraryWorks = useMemo(() => works.filter((w) => !q || `${w.title ?? w.name} ${w.author ?? ''}`.toLowerCase().includes(q)), [works, q])
  const historyRows = useMemo(() => downloads.filter((d) => !q || `${d.title} ${d.author ?? ''}`.toLowerCase().includes(q)), [downloads, q])

  // ── Detail ──────────────────────────────────────────────────────────────
  if (selected) {
    if (selected.kind === 'registry') {
      const w = selected.w
      const st = installs[w.id]
      const installed = st?.status === 'done' || inLibrary(w)
      return (
        <DetailShell onBack={() => setSelected(null)} actions={
          st?.status === 'done' ? <Button size="sm" onClick={() => open(st.path)}>{t('button.open')}</Button>
            : installed ? <span className="flex items-center gap-1 type-caption text-ok"><Check className="size-3.5" /> {t('status.installed')}</span>
            : st?.status === 'installing' ? <Button size="sm" disabled><Loader2 className="size-3.5 animate-spin" /> {t('button.installing')}</Button>
            : tooOld(w) ? <Button size="sm" variant="outline" disabled>{t('button.needsVersion', { version: w.minAppVersion })}</Button>
            : <Button size="sm" onClick={() => void install(w)}><Download className="size-3.5" /> {t('button.install')}</Button>
        }>
          <BookCard info={registryWorkToProjectInfo(w)} fallbackTitle={w.title} />
          <PreviewStrip previews={w.previews} />
          <div className="mt-4 flex flex-wrap items-center gap-3 type-caption text-muted-foreground">
            <span>{sizeMeta(t, w.scenes, w.worldPages, w.custodyPages)}</span>
            <span>{(w.sizeBytes / 1024).toFixed(0)} KB</span>
            {w.oracleScore >= 1 && <span className="flex items-center gap-0.5 text-ok"><ShieldCheck className="size-3" /> {t('status.verifiedClean')}</span>}
          </div>
          <p className="mt-3 type-caption text-muted-foreground">{t('detail.registryBlurb')}</p>
          {st?.status === 'error' && <p className="mt-2 type-caption text-flag">{st.error}</p>}
        </DetailShell>
      )
    }
    const w = selected.w
    return (
      <DetailShell onBack={() => setSelected(null)} actions={<>
        <Button size="sm" onClick={() => open(w.path)}>{t('button.open')}</Button>
        <Button size="sm" variant="outline" onClick={() => void remove(w)} title={t('tooltip.deleteFromLibrary')}><Trash2 className="size-3.5" /> {t('button.remove')}</Button>
      </>}>
        {libInfo ? <BookCard info={libInfo} fallbackTitle={w.title ?? w.name} basePath={w.path} /> : <div className="flex h-40 items-center justify-center text-faint"><Loader2 className="size-5 animate-spin" /></div>}
        <p className="mt-3 type-caption text-muted-foreground">{t('detail.libraryBlurb')}</p>
      </DetailShell>
    )
  }

  // ── Grid ────────────────────────────────────────────────────────────────
  return (
    <div>
      <SubTabs sub={sub} setSub={setSub} libraryCount={works.length} historyCount={downloads.length} />
      {sub === 'browse' ? (
        index === 'loading' ? <Loading text={t('loading.registry')} />
        : index === 'unreachable' ? <Empty text={t('empty.registryUnreachable')} />
        : registryWorks.length === 0 ? <Empty text={q ? t('empty.noMatch') : t('empty.noWorks')} />
        : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {registryWorks.map((w) => {
              const installed = installs[w.id]?.status === 'done' || inLibrary(w)
              return (
                // Card is a pure LISTING — no one-click install. Clicking opens the detail (synopsis + verified
                // badge), where Install lives. Guards against acquiring without seeing what you're getting.
                <StoreCard
                  key={w.id}
                  icon={BookOpen}
                  title={w.title}
                  subtitle={w.author ?? undefined}
                  badge={w.oracleScore >= 1 ? <span title={t('tooltip.verifiedClean')}><ShieldCheck className="size-3.5 shrink-0 text-ok" /></span> : undefined}
                  meta={<>
                    <span>{sizeMeta(t, w.scenes, w.worldPages, w.custodyPages)}</span>
                    {(Array.isArray(w.genre) ? w.genre : []).slice(0, 2).map((g) => <Chip key={g}>{g}</Chip>)}
                    {installed && <span className="flex items-center gap-0.5 text-ok"><Check className="size-3" /> {t('status.inLibrary')}</span>}
                  </>}
                  onOpen={() => setSelected({ kind: 'registry', w })}
                />
              )
            })}
          </div>
        )
      ) : sub === 'library' ? (
        <>
          {/* The bundled examples ship inside the app forever — deleting one is never permanent. */}
          <div className="mb-3 flex items-center justify-end">
            <RestoreExamples onDone={loadWorks} />
          </div>
          {libraryWorks.length === 0 ? (
            <Empty text={q ? t('empty.noMatch') : t('empty.libraryEmpty')} />
          ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {libraryWorks.map((w) => (
              <StoreCard
                key={w.path}
                icon={BookOpen}
                title={w.title ?? w.name}
                subtitle={w.author ?? undefined}
                meta={<span>{sizeMeta(t, w.scenes, w.worldPages, w.custodyPages)}</span>}
                onOpen={() => setSelected({ kind: 'work', w })}
                actions={<>
                  <Button size="sm" variant="ghost" onClick={() => void remove(w)} title={t('tooltip.removeFromLibrary')}><Trash2 className="size-3.5" /></Button>
                  <Button size="sm" onClick={() => open(w.path)}>{t('button.open')}</Button>
                </>}
              />
            ))}
          </div>
          )}
        </>
      ) : (
        <History rows={historyRows} works={works} registryWorks={registryWorks} q={q} onOpen={open} onGetAgain={install} installs={installs} />
      )}
    </div>
  )
}

/** History = the reading list. Each row is an acquisition; the action depends on the local copy's fate:
 *  still on disk → Open · gone but still in the registry → Get again · gone & retired → just a record. */
function History({ rows, works, registryWorks, q, onOpen, onGetAgain, installs }: {
  rows: DownloadEntry[]
  works: WorkCard[]
  registryWorks: RegistryWork[]
  q: string
  onOpen: (path: string) => void
  onGetAgain: (w: RegistryWork) => Promise<void>
  installs: Record<string, InstallState>
}): JSX.Element {
  const { t } = useTranslation('community')
  if (rows.length === 0) return <Empty text={q ? t('empty.noDownloadMatch') : t('empty.historyEmpty')} />
  const byPath = new Map(works.map((w) => [w.path, w]))
  const byRegistryId = new Map(registryWorks.map((w) => [w.id, w]))
  return (
    <div className="space-y-1.5">
      {rows.map((d) => {
        const onDisk = d.path ? byPath.get(d.path) : undefined
        const reget = byRegistryId.get(d.registryId)
        const st = installs[d.registryId]
        return (
          <div key={`${d.registryId}-${d.at}`} className="flex items-center gap-3 rounded-lg border border-border bg-panel/30 px-3 py-2">
            <Clock className="size-4 shrink-0 text-faint" />
            <div className="min-w-0 flex-1">
              <div className="type-card-title truncate">{d.title}</div>
              <div className="type-caption truncate text-faint">{[d.author, `v${d.version}`, ago(t, d.at)].filter(Boolean).join(' · ')}</div>
            </div>
            {onDisk ? (
              <Button size="sm" onClick={() => onOpen(onDisk.path)}>{t('button.open')}</Button>
            ) : st?.status === 'done' ? (
              <Button size="sm" onClick={() => onOpen(st.path)}>{t('button.open')}</Button>
            ) : st?.status === 'installing' ? (
              <Button size="sm" disabled><Loader2 className="size-3.5 animate-spin" /></Button>
            ) : reget ? (
              <Button size="sm" variant="outline" onClick={() => void onGetAgain(reget)} title={t('tooltip.downloadAgain')}><Download className="size-3.5" /> {t('button.getAgain')}</Button>
            ) : (
              <span className="type-caption text-faint">{t('status.notInRegistry')}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** DetailView shell for content — Back + body + a right-aligned actions row. The body is a BookCard, which owns
 *  its own rich header (cover/title/facts), so this shell deliberately has no header of its own (no double title). */
function DetailShell({ onBack, actions, children }: { onBack: () => void; actions: JSX.Element; children: React.ReactNode }): JSX.Element {
  const { t } = useTranslation('community')
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <button onClick={onBack} className="type-caption flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground">
          <ArrowLeft className="size-4" /> {t('button.back')}
        </button>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      {children}
    </div>
  )
}

/** Re-add the bundled examples (Getting Started + demos) the user has deleted — pristine from the app bundle,
 *  skipping any still present. The shipped pre-analysed content is therefore never permanently losable. */
function RestoreExamples({ onDone }: { onDone: () => Promise<void> | void }): JSX.Element {
  const { t } = useTranslation('community')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const run = async (): Promise<void> => {
    setBusy(true)
    setMsg(null)
    const r = await window.nvs.restoreExamples()
    await onDone()
    setBusy(false)
    setMsg(r.restored.length ? t('restore.restored', { n: r.restored.length }) : t('restore.allPresent'))
  }
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="type-caption text-faint">{msg}</span>}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()} title={t('tooltip.restoreExamples')}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} {t('button.restoreExamples')}
      </Button>
    </div>
  )
}

function SubTabs({ sub, setSub, libraryCount, historyCount }: { sub: SubTab; setSub: (t: SubTab) => void; libraryCount: number; historyCount: number }): JSX.Element {
  const { t } = useTranslation('community')
  const btn = (tab: SubTab, label: string): JSX.Element => (
    <button onClick={() => setSub(tab)} className={cn('type-caption rounded-md px-2.5 py-1 transition-colors', sub === tab ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
  )
  return (
    <div className="mb-4 flex items-center gap-1">
      {btn('browse', t('tab.browse'))}
      {btn('library', `${t('tab.library')}${libraryCount ? ` · ${libraryCount}` : ''}`)}
      {btn('history', `${t('tab.history')}${historyCount ? ` · ${historyCount}` : ''}`)}
    </div>
  )
}

/** Coarse relative time — good enough for a reading-list timestamp (no date lib). */
function ago(t: TFunction, at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return t('time.justNow')
  const m = Math.floor(s / 60)
  if (m < 60) return t('time.minutes', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('time.hours', { n: h })
  const d = Math.floor(h / 24)
  if (d < 30) return t('time.days', { n: d })
  const mo = Math.floor(d / 30)
  return mo < 12 ? t('time.months', { n: mo }) : t('time.years', { n: Math.floor(mo / 12) })
}

const Loading = ({ text }: { text: string }): JSX.Element => <div className="type-body-sm flex items-center justify-center gap-2 p-16 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {text}</div>
const Empty = ({ text }: { text: string }): JSX.Element => <p className="type-body-sm rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">{text}</p>
