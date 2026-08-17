/**
 * Threads workspace — the narrative promises/questions, in three coupled surfaces:
 *  • Sidebar (ThreadSidebar) — the roster; pick a thread → it's selected everywhere.
 *  • Map   — a Gantt of lifecycles: lanes × scene columns, color = archetype, marker = action,
 *            opacity = open/closed. The temporal lens.
 *  • Table — one row per thread: archetype · status · events · opened→closed · close-gate · provenance.
 *  • Sheet — the selected thread's full development as a CHAPTER RAILWAY: chapters are stations (filled =
 *            has events · hollow = quiet · ◆ terminus = resolves), events are cards under their station,
 *            enriched on expand with evidence, scene context, cast + per-event confidence (the transparency).
 *
 * Threads are the analysis agent's *reading* of the dialogue (built_by = inferred), not authored
 * truth — so provenance + per-beat confidence are surfaced throughout, never hidden.
 */
import { JSX, useEffect, useMemo, useState, type ReactNode } from 'react'
import { regionAttrs } from '@/config/regions'
import { Info, Loader2, MapPin, Users, Rows3 } from 'lucide-react'
import { EmptyRailState } from '@/components/ui/EmptyRailState'
import { useWorkspace } from '@/stores/workspace'
import { threadVisual } from '@/config/threadVisual'
import { cn } from '@/lib/utils'
import { entityNameVariants, normName } from '@shared/entityNames'
import { buildChapterIndex } from '@/lib/analysis/chapterIndex'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { RailHeader, RailTabs } from '@/components/ui/RailHeader'
import { Annotated, type NameRef } from '@/components/ui/Annotated'
import { DetailSplitView, type FeedEvent, type FeedChapter, type FeedTone, type DetailEndpoint } from '@/components/layout/DetailSplitView'
import { DetailLabel, DETAIL_PROSE } from '@/components/ui/detail'
import { AppearanceHeatStrip, type HeatCell } from '@/components/layout/AppearanceHeatStrip'
import { CharacterArcPanel } from '@/components/features/arc/CharacterArcPanel'
import { EntityPanel } from '@/components/features/entity/EntityPanel'
import { LorePanel } from '@/components/features/lore/LorePanel'
import { LifecycleGantt, deriveWrapLevels, sceneVolumes, GANTT_ROW_TITLE, type GanttRow } from '@/components/features/custody/LifecycleGantt'
import { useSceneAxis } from '@/lib/timeline/sceneAxis'
import { useGanttWindow, scopeRows } from '@/lib/timeline/ganttWindow'
import { RailScaleBar } from '@/components/layout/RailScaleBar'
import { RailChrome } from '@/components/layout/RailChrome'
import { Dialog } from '@/components/ui/dialog'
import { HelpSection, HelpTable, HelpList } from '@/components/ui/help'
import { useTranslation } from 'react-i18next'
import type { Thread, ThreadBeat, ThreadDetail } from '@shared/ipc'

type ScenePreview = { path: string; title: string }

/** Humanize a thread slug for the header — "see_eff_oh_board_ranking" → "See Eff Oh Board Ranking". */
const humanizeSlug = (s: string): string => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
/** Drop a leading honorific so a beat's cast name ("Mr See Yi Oh") can match a world page ("See Yi Oh"). */
const normalizeName = (s: string): string => normName(s.replace(/^(mr|mrs|ms|dr|sir|lord|lady)\.?\s+/i, ''))

export function ThreadsPanel(): JSX.Element {
  const threads = useWorkspace((s) => s.threads)
  const threadsTab = useWorkspace((s) => s.threadsTab)
  const setThreadsTab = useWorkspace((s) => s.setThreadsTab)
  const [preview, setPreview] = useState<ScenePreview | null>(null)

  // The selected thread's detail floats at the app level (DetailFloats) so it survives rail switches.

  // The pivot tabs live in the MAIN page now (cast-style), not the sidebar — Thread / Character / Entity
  // swap the body below. Same shared treatment as the Cast panel's main tabs.
  const tabs = (
    <RailHeader data-export-hide="1">
      <RailTabs tabs={['thread', 'character', 'entity', 'lore'] as const} value={threadsTab} onChange={setThreadsTab} />
    </RailHeader>
  )

  if (threadsTab === 'character') return <div {...regionAttrs('threadsPanel')} className="flex min-h-0 flex-1 flex-col">{tabs}<CharacterArcPanel /></div>
  if (threadsTab === 'entity')
    return (
      <div {...regionAttrs('threadsPanel')} className="flex min-h-0 flex-1 flex-col">
        {tabs}
        <EntityPanel />
      </div>
    )
  if (threadsTab === 'lore')
    return (
      <div {...regionAttrs('threadsPanel')} className="flex min-h-0 flex-1 flex-col">
        {tabs}
        <LorePanel />
      </div>
    )

  return (
    <div {...regionAttrs('threadsPanel')} className="flex min-h-0 flex-1 flex-col">
      {tabs}
      {/* RailChrome mounts INSIDE the below-tabs body (as the character/entity/lore sub-panels do), so the Layers TOC's
          top-11 origin is the tab bar's BOTTOM on every thread-rail tab — otherwise it jumps up on this one only. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {threads == null ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
        ) : threads.length === 0 ? (
          <EmptyRailState rail="threads" />
        ) : (
          <ThreadMap threads={threads} onScene={setPreview} />
        )}

        <RailChrome
          region="threadsPanel"
          name="Threads"
          layers={['chapters']}
          export={{ file: 'thread-rail', caption: () => `Threads — ${threadsTab}` }}
          help={ThreadHelp}
        />
      </div>

      {preview && <PageReadDialog path={preview.path} kind="scene" title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  )
}

// ── Map (Gantt of thread lifecycles) — fine per-scene markers over the shared LifecycleGantt ─────
interface Ev {
  col: number
  action: string
  scene: { sceneId: string; title: string; path: string }
}

function ThreadMap({
  threads,
  onScene
}: {
  threads: Thread[]
  onScene: (s: ScenePreview) => void
}): JSX.Element {
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const chapterWrap = useWorkspace((s) => s.ganttLayers.chapters)
  const selectedId = useWorkspace((s) => s.selectedThreadId)
  const select = useWorkspace((s) => s.setSelectedThread)
  const [typeFilter, setTypeFilter] = useState<string | null>(null) // filter the rail by thread_type (mystery · promise · …)
  const [evWin, setEvWin] = useState<[number, number] | null>(null) // trim rows by beat count (hide loose/short threads)
  const [page, setPage] = useState(0) // paginated vertical axis — one page of rows in the DOM at a time
  const { t } = useTranslation('threads')

  // Gantt scale (internal/gantt-scale.md): a long axis windows to the first GANTT_WINDOW scenes (slider scrubs the
  // span); events + rows derive from win.colOf, so off-window beats and their now-empty rows drop reactively.
  const sceneCols = useSceneAxis(scenes)
  const win = useGanttWindow(sceneCols)
  const cols = win.cols
  const wraps = useMemo(
    () => (chapterWrap ? deriveWrapLevels(storyTree, new Map(cols.map((s, i) => [s.sceneId, i]))) : undefined),
    [chapterWrap, storyTree, cols]
  )
  const counts = useMemo(() => sceneVolumes(graph), [graph])
  // threadId → its events (column + action), in column order.
  const events = useMemo(() => {
    const colOf = new Map(cols.map((s, i) => [s.sceneId, i]))
    const byScene = new Map(cols.map((s) => [s.sceneId, s]))
    const m = new Map<string, Ev[]>()
    for (const [sid, sc] of Object.entries(graph.scenes)) {
      const col = colOf.get(sid)
      const scene = byScene.get(sid)
      if (col == null || !scene) continue
      for (const t of sc.threads) {
        const list = m.get(t.threadId) ?? []
        list.push({ col, action: t.action, scene: { sceneId: sid, title: scene.title, path: scene.path } })
        m.set(t.threadId, list)
      }
    }
    for (const list of m.values()) list.sort((a, b) => a.col - b.col)
    return m
  }, [graph, cols])

  const rows = useMemo(
    () =>
      [...threads]
        .map((th) => ({ th, evs: events.get(th.id) ?? [], v: threadVisual(th.type) }))
        .filter((r) => r.evs.length > 0)
        // Rows in reading order — EARLIEST first (each thread by its first beat's column); open-before-closed
        // is only the tiebreak for threads that open on the same scene.
        .sort((a, b) => a.evs[0].col - b.evs[0].col || Number(a.th.status !== 'open') - Number(b.th.status !== 'open')),
    [threads, events]
  )
  // Off-route threads (a branch not on this view) are surfaced in the ThreadSidebar's "Other branches" section,
  // not here — the gantt only charts threads whose beats land on the active axis.
  const types = useMemo(() => [...new Set(rows.map((r) => r.th.type))].sort(), [rows]) // the thread_types actually present
  // Beat-count window — trim rows by how many events a thread has (drag the low thumb up to hide loose/short
  // threads; the same windowed RangeSlider the Cast rail uses for lines). Small integer range → linear, not laddered.
  const maxEv = useMemo(() => Math.max(1, ...rows.map((r) => r.evs.length)), [rows])
  const loEv = evWin ? Math.min(Math.max(1, evWin[0]), maxEv) : 1
  const hiEv = evWin ? Math.min(Math.max(loEv, evWin[1]), maxEv) : maxEv
  const evAll = loEv === 1 && hiEv === maxEv
  const visibleRows = useMemo(
    () => rows.filter((r) => (!typeFilter || r.th.type === typeFilter) && r.evs.length >= loEv && r.evs.length <= hiEv),
    [rows, typeFilter, loEv, hiEv]
  )
  // Paginate the vertical axis: `rows` are already window-relevant (their beats were built from win.colOf);
  // scopeRows preserves the earliest-first order and paints ONE page (never all) — the DOM stays bounded.
  const scoped = useMemo(() => scopeRows(visibleRows, (r) => r.evs.map((e) => e.scene.sceneId), win.colOf, page), [visibleRows, win.colOf, page])

  const sceneById = useMemo(() => new Map(cols.map((s) => [s.sceneId, s])), [cols])
  const ganttRows = useMemo<GanttRow[]>(
    () =>
      scoped.shown.map(({ th, evs, v }) => {
        const on = selectedId === th.id
        const closed = th.status !== 'open'
        // "Loose": opened but never advanced OR closed — a thread that only ever fired `open`. Often extraction
        // noise (a one-off event mis-framed as a thread, or a payoff the reader never got connected to it).
        const loose = !closed && evs.length <= 1
        return {
          key: th.id,
          highlighted: on,
          gutter: (
            <button onClick={() => select(on ? null : th.id)} className={cn('flex h-full w-full items-center gap-2 border-l-2 pr-2 pl-1.5 text-left', on ? 'border-thread' : 'border-transparent')}>
              <span className={cn('size-2 shrink-0 rounded-full', v.bg)} title={v.label} />
              <span className={cn(GANTT_ROW_TITLE, !th.title && 'font-mono', on && 'text-foreground')} title={th.slug}>{th.title || th.slug}</span>
              {loose && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warn/70" title={t('map.looseThread')} />}
            </button>
          ),
          renderLane: ({ colW }) => {
            const first = evs[0].col
            const last = evs[evs.length - 1].col
            return (
              <>
                <div
                  className={cn('absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full', v.bg, closed && 'opacity-40')}
                  style={{ left: first * colW + colW / 2, width: Math.max(2, (last - first) * colW) }}
                />
                {evs.map((e, k) => (
                  <button
                    key={k}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: e.col * colW + colW / 2 }}
                    title={`${th.slug} · ${e.scene.title} — ${e.action}`}
                    onClick={() => select(th.id)}
                  >
                    <Marker action={e.action} v={v} />
                  </button>
                ))}
              </>
            )
          }
        }
      }),
    [scoped, selectedId, select]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Filter row: thread_type chips only (hide non-matching). The beat-count window + scene range live in the
          shared bottom RailScaleBar now. Uses RailHeader so it matches the Coherence rail's header exactly. */}
      {types.length > 1 && (
        <RailHeader data-export-hide="1" className="overflow-x-auto">
          <span className="shrink-0 text-faint">{t('map.type')}</span>
          {types.map((ty) => {
            const v = threadVisual(ty)
            const on = typeFilter === ty
            return (
              <button
                key={ty}
                onClick={() => setTypeFilter(on ? null : ty)}
                className={cn('flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5', on ? cn('border-current', v.text) : 'border-border text-muted-foreground hover:text-foreground')}
              >
                <span className={cn('size-1.5 rounded-[2px]', v.bg)} /> {v.label}
              </button>
            )
          })}
          {typeFilter && <button onClick={() => setTypeFilter(null)} className="shrink-0 text-faint hover:text-foreground">{t('map.clear')}</button>}
        </RailHeader>
      )}
      <LifecycleGantt
        cols={cols.map((s) => ({ id: s.sceneId, title: s.title }))}
        wraps={wraps}
        counts={counts}
        rows={ganttRows}
        onColClick={(c) => {
          const sc = sceneById.get(c.id)
          if (sc) onScene({ path: sc.path, title: sc.title })
        }}
        empty={<EmptyRailState rail="threads" />}
      />
      <RailScaleBar
        scene={{
          lo: win.lo,
          hi: win.hi,
          full: win.full,
          auto: win.auto,
          onChange: win.setRange,
          onReset: win.range ? () => win.setRange(null) : undefined,
          title: `${sceneCols[win.lo]?.title ?? '?'} → ${sceneCols[win.hi]?.title ?? '?'}`
        }}
        page={{ from: scoped.from, to: scoped.to, total: scoped.total, noun: 'threads', page: scoped.page, pageCount: scoped.pageCount, onPage: setPage }}
        metric={{
          label: 'Range',
          min: 1,
          max: maxEv,
          value: [loEv, hiEv],
          onChange: setEvWin,
          readout: evAll ? 'all' : `${loEv}${loEv !== hiEv ? `–${hiEv}` : ''}`,
          onReset: evAll ? undefined : () => setEvWin(null),
          title: 'Trim threads by beat count — drag the low thumb up to hide loose 1–2 beat threads (often extraction noise).'
        }}
      />
    </div>
  )
}

// ── Sheet (the selected thread's full development) ──────────────────────────────
export function ThreadDetail({ thread, onScene, onClose, focus }: { thread: Thread; onScene: (s: ScenePreview) => void; onClose: () => void; focus?: string | null }): JSX.Element {
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const characters = useWorkspace((s) => s.characters)
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [namePreview, setNamePreview] = useState<{ path: string; title: string; kind: 'character' } | null>(null)
  const { t } = useTranslation('threads')
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])
  const storyTree = useWorkspace((s) => s.storyTree)
  const chapterIndex = useMemo(() => buildChapterIndex(storyTree), [storyTree])
  const orderedKeys = useMemo(() => [...chapterIndex.chapters.keys()], [chapterIndex])
  // Inline entity-linking: tag character names in the prose, click → read-only page dialog (a peek).
  const names = useMemo<NameRef[]>(() => characters.map((c) => ({ id: c.id, name: c.name })), [characters])
  // Keyed by name VARIANTS (script-split) so a beat's cast "with 曹操" or "with Cao Cao" both resolve to the page.
  const charByNorm = useMemo(() => {
    const m = new Map<string, (typeof characters)[number]>()
    for (const c of characters) for (const v of entityNameVariants({ id: c.id, name: c.name })) if (!m.has(v)) m.set(v, c)
    return m
  }, [characters])
  const onName = (id: string): void => {
    const c = characters.find((x) => x.id === id)
    if (c) setNamePreview({ path: c.path, title: c.name, kind: 'character' })
  }
  const openCast = (nm: string): void => {
    const c = charByNorm.get(normalizeName(nm))
    if (c) setNamePreview({ path: c.path, title: c.name, kind: 'character' })
  }
  const v = threadVisual(thread.type)

  useEffect(() => {
    let live = true
    setDetail(null)
    void window.nvs.threadDetail(thread.id).then((d) => live && setDetail(d)).catch(() => live && setDetail(null))
    return () => { live = false }
  }, [thread.id])

  const openScene = (b: ThreadBeat): void => {
    const sc = sceneById.get(b.sceneId)
    if (sc) onScene({ path: sc.path, title: sc.title })
  }

  // The two endpoints, pulled from the beat log: how it opened (the trigger) and how it resolved.
  const openBeat = detail?.beats.find((b) => b.action === 'open') ?? null
  const resolveBeat = detail ? [...detail.beats].reverse().find((b) => b.action === 'resolve') ?? null : null
  const isResolved = thread.status !== 'open'

  // The rich right-pane detail for one beat (the former EventCard's expanded body).
  const CAST_CAP = 8 // cap the cast pills so a crowd scene can't blow up the pane
  const beatDetail = (b: ThreadBeat): ReactNode => {
    const lead = b.description || b.sceneSummary || ''
    return (
      <div className="space-y-3.5">
        <p className={DETAIL_PROSE}><Annotated text={lead} names={names} onName={onName} /></p>
        {b.evidence && <p className="border-l-2 border-border/60 pl-3 text-[13px] italic leading-relaxed text-muted-foreground">“{b.evidence}”</p>}
        {/* No scene-title repeat — the pane title above is the linked scene. Keep only the scene-wide summary. */}
        {b.description && b.sceneSummary && (
          <div>
            <DetailLabel>{t('detail.sceneSummary')}</DetailLabel>
            <p className="text-[13px] leading-relaxed text-faint"><Annotated text={b.sceneSummary} names={names} onName={onName} /></p>
          </div>
        )}
        {(b.cast.length > 0 || b.location) && (
          <div>
            <DetailLabel>{t('detail.castAndPlace')}</DetailLabel>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {b.location && <span className="flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground"><MapPin className="size-2.5" /> {b.location}</span>}
              {b.cast.slice(0, CAST_CAP).map((nm, j) => {
                const c = charByNorm.get(normalizeName(nm))
                return c ? (
                  <button key={j} onClick={() => openCast(nm)} title={t('detail.openPage', { name: nm })} className="flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-character hover:bg-panel-soft"><Users className="size-2.5" /> {nm}</button>
                ) : (
                  <span key={j} className="flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-faint"><Users className="size-2.5" /> {nm}</span>
                )
              })}
              {b.cast.length > CAST_CAP && <span className="self-center text-faint" title={b.cast.slice(CAST_CAP).join(', ')}>+{b.cast.length - CAST_CAP}</span>}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Beats arrive oldest-first (sort_pos) → the index is the reading position; the scaffold groups them under
  // chapters, and the strand becomes the Category filter.
  const events: FeedEvent[] = (detail?.beats ?? []).map((b, i) => ({
    id: `${b.sceneId}:${i}`,
    chapterKey: chapterIndex.sceneChapter.get(b.sceneId) ?? '',
    pos: i,
    title: b.sceneTitle || b.sceneCode || b.sceneId,
    summary: b.description || b.sceneSummary || '',
    detail: beatDetail(b),
    kind: ACTION_MARK[b.action]?.label ?? b.action,
    tone: THREAD_TONE[b.action] ?? 'muted',
    code: b.sceneCode ?? undefined,
    category: b.subject ?? undefined,
    onOpen: () => openScene(b)
  }))
  const chapters: FeedChapter[] = orderedKeys.map((k, i) => ({ key: k, title: chapterIndex.chapters.get(k)?.title ?? k, pos: i }))
  // Deep-link: opened from a scene inspector's Threads row → pre-select THIS thread's beat in that scene (the feed
  // event id is `${sceneId}:${i}`, so the beat IS the selectable unit — no separate row highlight needed).
  const focusId = focus ? events.find((e) => e.id.startsWith(`${focus}:`))?.id ?? null : null

  // Appearance strip — every scene in reading order, height = how many beats the thread has there (where it's
  // active across the whole story), so the MainView can swap the resolve-conditions for this.
  const heatCells: HeatCell[] = useMemo(() => {
    if (!detail) return []
    const count = new Map<string, number>()
    for (const b of detail.beats) count.set(b.sceneId, (count.get(b.sceneId) ?? 0) + 1)
    return [...scenes]
      .sort((a, b) => (graph.scenes[a.sceneId]?.linearPos ?? 1e9) - (graph.scenes[b.sceneId]?.linearPos ?? 1e9))
      .map((s) => {
        const n = count.get(s.sceneId) ?? 0
        const chKey = chapterIndex.sceneChapter.get(s.sceneId)
        return {
          key: s.sceneId,
          label: n ? t('detail.heatCell', { title: s.title, count: n }) : s.title,
          weight: n,
          onClick: n ? () => onScene({ path: s.path, title: s.title }) : undefined,
          group: chKey ? { key: chKey, title: chapterIndex.chapters.get(chKey)?.title ?? chKey } : undefined
        }
      })
  }, [detail, scenes, graph, chapterIndex, onScene, t])

  const sceneRef = (b: ThreadBeat | null, fallback: string | null): ReactNode =>
    b ? (
      <button onClick={() => openScene(b)} title={b.sceneTitle ?? b.sceneCode ?? undefined} className="block max-w-full truncate text-left text-thread hover:underline">{b.sceneTitle || b.sceneCode || b.sceneId}</button>
    ) : (
      <span className="text-faint">{fallback ?? '—'}</span>
    )
  const endpoints: DetailEndpoint[] = [
    { k: t('detail.openedBy'), v: sceneRef(openBeat, thread.openedAt) },
    { k: t('detail.resolvesWhen'), v: thread.resolutionCondition ?? t('detail.noCloseCondition'), open: !thread.resolutionCondition },
    isResolved ? { k: t('detail.resolvedBy'), v: sceneRef(resolveBeat, thread.closedAt) } : { k: t('detail.resolvesBy'), v: t('detail.stillOpen'), open: true }
  ]

  return (
    <>
      <DetailSplitView
        onClose={onClose}
        icon={<span className={cn('size-2 shrink-0 rounded-full', v.bg)} />}
        title={thread.title || humanizeSlug(thread.slug)}
        subtitle={thread.description ? <Annotated text={thread.description} names={names} onName={onName} /> : undefined}
        chips={
          <>
            <span className={cn('shrink-0 rounded-full border border-border/60 px-1.5 text-[10px]', v.text)}>{v.label}</span>
            <span className={cn('shrink-0 text-[11px]', thread.status === 'open' ? 'text-ok' : 'text-faint')}>{thread.status === 'open' ? t('detail.status.open') : thread.status === 'closed' ? t('detail.status.resolved') : thread.status}</span>
            {thread.builtBy === 'inferred' && (
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-faint" title={t('detail.inferredTitle')}>
                <Info className="size-3" /> {t('detail.inferred')}
              </span>
            )}
          </>
        }
        meta={detail ? t('detail.events', { count: detail.beats.length }) : ''}
        endpoints={endpoints}
        heatmap={<AppearanceHeatStrip cells={heatCells} accentClass="text-thread" />}
        tabs={[{ id: 'feed', label: t('detail.feed'), icon: <Rows3 className="size-3.5" />, count: detail?.beats.length }]}
        tab="feed"
        onTab={() => {}}
        chapters={chapters}
        events={events}
        isFeed={detail != null}
        focusId={focusId}
        tabBody={detail == null ? <div className="flex items-center gap-2 px-6 py-6 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> <span className="text-sm">{t('detail.loading')}</span></div> : undefined}
      />
      {namePreview && <PageReadDialog path={namePreview.path} kind={namePreview.kind} title={namePreview.title} onClose={() => setNamePreview(null)} />}
    </>
  )
}

/**
 * Per-action visual grammar (GitHub-PR-timeline style): the rail badge glyph + its tone/ring, a subtle header
 * WASH tinted by action (open green · advance neutral · resolve/supersede muted-closed · reopen amber), and a
 * `terminal` flag for the events that CLOSE a thread (◆ resolve / ⊘ supersede) — they get a filled badge + a
 * "closed" cap, like GitHub's merged/closed node. Mirrors the ThreadHelp legend.
 */
const ACTION_MARK: Record<string, { glyph: string; label?: string; tone: string; ring: string; head: string; terminal?: boolean }> = {
  open: { glyph: '●', tone: 'text-ok', ring: 'border-ok/40', head: 'bg-ok/[0.07]' },
  advance: { glyph: '•', tone: 'text-thread', ring: 'border-thread/40', head: 'bg-panel-soft/60' },
  resolve: { glyph: '◆', label: 'Resolved', tone: 'text-faint', ring: 'border-border', head: 'bg-foreground/[0.04]', terminal: true },
  reopen: { glyph: '◌', tone: 'text-warn', ring: 'border-warn/40', head: 'bg-warn/[0.07]' },
  supersede: { glyph: '⊘', label: 'Superseded', tone: 'text-faint', ring: 'border-border', head: 'bg-foreground/[0.04]', terminal: true }
}

/** Thread action → the scaffold's feed tone (open green · advance thread · reopen amber · resolve/supersede closed). */
const THREAD_TONE: Record<string, FeedTone> = { open: 'ok', advance: 'thread', reopen: 'warn', resolve: 'muted', supersede: 'muted' }

/** Lifecycle markers: open ● · advance • · resolve ◆ · reopen ◌ · supersede (faded). */
function Marker({ action, v }: { action: string; v: { bg: string; border: string } }): JSX.Element {
  if (action === 'resolve') return <span title={action} className={cn('block size-2 rotate-45', v.bg)} />
  if (action === 'reopen') return <span title={action} className={cn('block size-2.5 rounded-full border-2 bg-canvas', v.border)} />
  if (action === 'advance') return <span title={action} className={cn('block size-1.5 rounded-full', v.bg)} />
  if (action === 'supersede') return <span title={action} className={cn('block size-2 rounded-full opacity-50', v.bg)} />
  return <span title={action} className={cn('block size-2.5 rounded-full border border-canvas', v.bg)} /> // open
}

// ── Help ────────────────────────────────────────────────────────────────────────
function ThreadHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('threads')
  return (
    <Dialog open={open} onClose={onClose} title={t('help.title')} size="detail">
      <div className="space-y-5">
        <HelpSection title={t('help.whatIsAThread.title')}>
          <HelpList items={t('help.whatIsAThread.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.readingMap.title')}>
          <HelpTable rows={Object.entries(t('help.readingMap.rows', { returnObjects: true }) as Record<string, string>)} />
        </HelpSection>
        <HelpSection title={t('help.sheet.title')}>
          <HelpList items={t('help.sheet.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.provenance.title')}>
          <HelpList items={t('help.provenance.items', { returnObjects: true }) as string[]} />
        </HelpSection>
      </div>
    </Dialog>
  )
}
