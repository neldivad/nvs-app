/**
 * DetailSplitView — the ONE scaffold every rail-detail float wears (thread · entity · arc), replacing three
 * hand-rolled bodies. Custody-split-styled inside a draggable FloatWindow: a pinned MAIN VIEW (title · endpoints
 * · appearance heatmap) over a tabbed SPLIT — a reading-ordered event feed on the left, the selected event's
 * detail on the right (click-to-open, not expand/collapse). Ghosted borders throughout.
 *
 * Generic over a normalized `FeedEvent`: each subject maps its own data (thread beats / entity windows / arc
 * windows) into events + the ordered chapter list, and the scaffold owns grouping, the MultiFilter
 * (Category · Latest · Hide-empty), selection, and layout — so the three details stay uniform by construction.
 */
import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronRight, ArrowUpNarrowWide, ArrowDownNarrowWide, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'

export type FeedTone = 'thread' | 'ok' | 'warn' | 'flag' | 'muted'
const TONE: Record<FeedTone, string> = {
  thread: 'text-thread border-thread/40',
  ok: 'text-ok border-ok/40',
  warn: 'text-warn border-warn/40',
  flag: 'text-flag border-flag/40',
  muted: 'text-muted-foreground border-border/60'
}

/** One reading-ordered chapter/act band (the feed groups events under these; quiet ones show hollow). */
export interface FeedChapter {
  key: string
  title: string
  pos: number // reading position (for ordering)
}

/** One normalized feed event — every subject maps its data into this shape. */
export interface FeedEvent {
  id: string
  chapterKey: string
  pos: number // reading position within the story (for ordering)
  title: string
  summary: string // short line for the left list
  detail: ReactNode // full body for the right pane
  detailOwnsHeader?: boolean // the detail renders its OWN chip/title/padding — the right pane adds nothing
  kind?: string // small chip label (action / category)
  tone?: FeedTone
  code?: string // scene code, right-aligned in the row
  category?: string // drives the Category filter (defaults to `kind`)
  onOpen?: () => void // peek the scene — makes the right-pane title a link
}

export interface DetailEndpoint {
  k: string
  v: ReactNode
  open?: boolean // render the value muted+italic (e.g. "still open")
}

export interface DetailTab {
  id: string
  label: string
  icon?: ReactNode // when set, the tab renders the icon (label becomes its tooltip)
  count?: number
}

export interface DetailSplitViewProps {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode // a line under the title (e.g. a thread's promise prose)
  chips?: ReactNode
  meta?: ReactNode // right-aligned count summary ("11 changes · 11 scenes")
  onClose: () => void
  endpoints?: DetailEndpoint[] // Opened by / Resolves when / Resolves by
  heatmap?: ReactNode // the AppearanceHeatmapStrip, pinned under the endpoints
  tabs: DetailTab[]
  tab: string
  onTab: (id: string) => void
  headerActions?: ReactNode // subject-specific actions in the toolbar (e.g. Lore's Learn more / Suggest page)
  /** Feed data (used when the active tab renders the feed). */
  chapters: FeedChapter[]
  events: FeedEvent[]
  /** Content for a non-feed tab; when present it replaces the split body. */
  tabBody?: ReactNode
  /** Whether the active tab is the feed (vs a custom `tabBody`). */
  isFeed: boolean
  /** Opt-in: pre-select this feed event on mount / when it changes (deep-link from another surface). */
  focusId?: string | null
}

export function DetailSplitView({
  icon,
  title,
  subtitle,
  chips,
  meta,
  onClose,
  endpoints,
  heatmap,
  tabs,
  tab,
  onTab,
  headerActions,
  chapters,
  events,
  tabBody,
  isFeed,
  focusId
}: DetailSplitViewProps): JSX.Element {
  const { t } = useTranslation('detailSplitView')
  const [selId, setSelId] = useState<string | null>(focusId ?? null)
  // Deep-link: when a caller passes a new focusId (e.g. the scene inspector opening this arc on a specific event's
  // window), pre-select it so its detail pane is already showing.
  useEffect(() => { if (focusId) setSelId(focusId) }, [focusId])
  const [latest, setLatest] = useState(false) // Latest sort (reading-order asc by default)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [cat, setCat] = useState<string>('all')
  const [mainView, setMainView] = useState<'resolves' | 'appears'>('resolves') // MainView swap: endpoints ↔ strip

  // Only genuine categories (a thread's strands) get a filter — NOT the action kinds, which would be a
  // redundant open/advance/resolve dropdown.
  const categories = useMemo(() => {
    const s = new Set<string>()
    for (const e of events) if (e.category) s.add(e.category)
    return [...s].sort()
  }, [events])

  // Group filtered events under their chapter, then order BOTH the chapters and the events within each chapter by
  // reading position — `latest` flips the direction at every level (so Latest sorts down to the scene, not just
  // the folder). Quiet (event-less) chapters interleave as hollow bands unless Hide-empty is on.
  const bands = useMemo(() => {
    const shown = cat === 'all' ? events : events.filter((e) => e.category === cat)
    const byChapter = new Map<string, FeedEvent[]>()
    for (const e of shown) (byChapter.get(e.chapterKey) ?? byChapter.set(e.chapterKey, []).get(e.chapterKey)!).push(e)
    const dir = latest ? -1 : 1
    return chapters
      .filter((c) => !hideEmpty || byChapter.has(c.key))
      .map((c) => ({ ...c, events: (byChapter.get(c.key) ?? []).slice().sort((a, b) => (a.pos - b.pos) * dir) }))
      .sort((a, b) => (a.pos - b.pos) * dir)
  }, [events, chapters, cat, hideEmpty, latest])

  const selected = useMemo(() => events.find((e) => e.id === selId) ?? null, [events, selId])
  const hasEndpoints = !!endpoints && endpoints.length > 0
  const showAppears = !!heatmap && (!hasEndpoints || mainView === 'appears')

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* ── MAIN VIEW (pinned) ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border/60">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          {icon}
          <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{title}</div>
          {chips}
          {meta && <span className="ml-auto shrink-0 text-[11px] tabular-nums text-faint">{meta}</span>}
          <button onClick={onClose} title={t('close')} className="ml-1 shrink-0 rounded p-1 text-faint hover:bg-panel-soft hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>

        {subtitle && <div className="px-4 pb-2 text-[11.5px] leading-relaxed text-foreground/80">{subtitle}</div>}

        {/* ResolveConditions ⇄ AppearanceStrip — ONE container, a swap toggle when both are present. */}
        {(hasEndpoints || heatmap) && (
          <div className="mx-4 mb-3">
            {hasEndpoints && heatmap && (
              <div className="mb-1.5 flex items-center gap-0.5">
                {(['resolves', 'appears'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMainView(m)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide transition-colors',
                      mainView === m ? 'bg-panel-soft text-foreground' : 'text-faint hover:text-foreground'
                    )}
                  >
                    {m === 'resolves' ? t('mainView.resolves') : t('mainView.appears')}
                  </button>
                ))}
              </div>
            )}
            {/* Fixed height so the RESOLVES ⇄ APPEARS swap doesn't jump the layout. */}
            <div className="flex h-16 flex-col justify-center">
              {showAppears ? (
                heatmap
              ) : (
                <div className="grid h-full grid-cols-3 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60">
                  {endpoints!.map((e) => (
                    <div key={e.k} className="flex min-w-0 flex-col bg-panel px-3 py-2">
                      <div className="mb-0.5 text-[9.5px] font-medium uppercase tracking-wide text-faint">{e.k}</div>
                      <div className={cn('min-w-0 line-clamp-2 text-[11.5px]', e.open ? 'italic text-muted-foreground' : 'text-foreground')}>{e.v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── TABS + MULTIFILTER ─────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-3 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            title={t.label}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] transition-colors',
              t.id === tab ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.icon ?? t.label}
            {t.count != null && <span className="text-faint tabular-nums">{t.count}</span>}
          </button>
        ))}
        {headerActions && <div className="flex items-center gap-1.5">{headerActions}</div>}
        {isFeed && (
          <div className="ml-auto flex items-center gap-1">
            {categories.length > 0 && (
              <Select
                value={cat}
                onChange={setCat}
                className="w-36"
                options={[{ value: 'all', label: t('allCategories') }, ...categories.map((c) => ({ value: c, label: c }))]}
              />
            )}
            <button
              onClick={() => setLatest((v) => !v)}
              title={latest ? t('sort.latest') : t('sort.oldest')}
              className="flex size-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:text-foreground"
            >
              {latest ? <ArrowDownNarrowWide className="size-3.5" /> : <ArrowUpNarrowWide className="size-3.5" />}
            </button>
            <button
              onClick={() => setHideEmpty((v) => !v)}
              title={hideEmpty ? t('hideEmpty.on') : t('hideEmpty.off')}
              className={cn(
                'flex size-7 items-center justify-center rounded-md border transition-colors',
                hideEmpty ? 'border-thread/40 bg-thread/10 text-thread' : 'border-border/60 text-muted-foreground hover:text-foreground'
              )}
            >
              {hideEmpty ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        )}
      </div>

      {/* ── BODY: feed split, or a custom tab body ─────────────────────── */}
      {isFeed ? (
        <div className="flex min-h-0 flex-1">
          {/* left — reading-ordered event feed */}
          <div className="flex w-2/5 min-w-56 shrink-0 flex-col border-r border-border/60">
            <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
              <span className="text-[9.5px] font-medium uppercase tracking-wide text-faint">{t('events')}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
              {bands.length === 0 ? (
                <div className="px-2 py-8 text-center text-[12px] text-faint">{t('noEvents')}</div>
              ) : (
                bands.map((b) =>
                  b.events.length === 0 ? (
                    // Quiet chapter — a compressed ghost row on the rail (hollow node + faint label), no annotation.
                    <div key={b.key} className="flex items-center gap-2 px-1 py-0.75 opacity-45">
                      <span className="size-1.5 shrink-0 rounded-full border border-faint" />
                      <span className="truncate text-[9px] uppercase tracking-wide text-faint">{b.title}</span>
                    </div>
                  ) : (
                    <div key={b.key} className="mt-3 first:mt-1">
                      <div className="flex items-center gap-2 px-1 pb-1.5">
                        <span className="size-2 shrink-0 rounded-full bg-thread shadow-[0_0_0_3px_color-mix(in_oklab,var(--thread)_20%,transparent)]" />
                        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{b.title}</span>
                        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-faint">{b.events.length}</span>
                      </div>
                      {b.events.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => setSelId(e.id)}
                          className={cn(
                            'group relative mb-1.5 ml-1 block w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                            e.id === selId
                              ? 'border-thread/55 bg-thread/10'
                              : 'border-border/60 bg-panel hover:border-border hover:bg-panel-soft'
                          )}
                        >
                          <div className="mb-0.5 flex items-center gap-1.5">
                            {e.kind && <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide', TONE[e.tone ?? 'muted'])}>{e.kind}</span>}
                            {e.code && <span className="ml-auto font-mono text-[10px] text-faint">{e.code}</span>}
                          </div>
                          <div className={cn('line-clamp-2 text-[11.5px]', e.id === selId ? 'text-foreground/90' : 'text-muted-foreground')}>{e.summary}</div>
                          <ChevronRight className={cn('absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 text-thread transition-opacity', e.id === selId ? 'opacity-100' : 'opacity-0')} />
                        </button>
                      ))}
                    </div>
                  )
                )
              )}
            </div>
          </div>
          {/* right — the selected event's detail. An event whose detail owns its header (chip + title +
              padding, e.g. the coherence card) renders bare so the card reads identically in every host. */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            {selected?.detailOwnsHeader ? (
              selected.detail
            ) : selected ? (
              <div className="px-5 py-4">
                {selected.kind && (
                  <div className="mb-2">
                    <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide', TONE[selected.tone ?? 'muted'])}>{selected.kind}</span>
                  </div>
                )}
                {/* Title IS the scene link (peek) — the scene id is redundant with this, so it's dropped. */}
                <h2 className="mb-3 text-[12.5px] font-medium text-balance">
                  {selected.onOpen ? (
                    <button onClick={selected.onOpen} className="text-left text-thread hover:underline">{selected.title}</button>
                  ) : (
                    <span className="text-foreground/90">{selected.title}</span>
                  )}
                </h2>
                {selected.detail}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[12.5px] text-faint">
                {t('selectPrompt')}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">{tabBody}</div>
      )}
    </div>
  )
}
