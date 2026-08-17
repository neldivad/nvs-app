/**
 * Character pivot — the windowed-arc lens (T2). Same uniform axis as the Thread map (scene columns),
 * but with a **wrap-layer** banding the columns by window (folder/"chapter") and **coarse cells**: a
 * character's arc renders as a band spanning its window's scenes, because a trait is accumulated over a
 * stretch, not per scene (see decisions.md L16). Click a row → the arc Sheet. Data: `characterArc()`.
 */
import { JSX, useMemo, useState, type ReactNode } from 'react'
import { regionAttrs } from '@/config/regions'
import { ExternalLink, Loader2, Rows3 } from 'lucide-react'
import { EmptyRailState } from '@/components/ui/EmptyRailState'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { entityNameVariants, normName } from '@shared/entityNames'
import { LifecycleGantt, deriveWrapLevels, sceneVolumes, GANTT_ROW_TITLE, type GanttRow } from '@/components/features/custody/LifecycleGantt'
import { useSceneAxis } from '@/lib/timeline/sceneAxis'
import { useGanttWindow, scopeRows } from '@/lib/timeline/ganttWindow'
import { RailScaleBar } from '@/components/layout/RailScaleBar'
import { buildChapterIndex } from '@/lib/analysis/chapterIndex'
import { RailChrome } from '@/components/layout/RailChrome'
import { RailHeader } from '@/components/ui/RailHeader'
import { Dialog } from '@/components/ui/dialog'
import { HelpSection, HelpTable, HelpList } from '@/components/ui/help'
import { useTranslation } from 'react-i18next'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { DetailSplitView, type FeedEvent, type FeedChapter } from '@/components/layout/DetailSplitView'
import { AppearanceHeatStrip, type HeatCell } from '@/components/layout/AppearanceHeatStrip'
import { FACETS, FACET_BLURB, catLabel, facetVisual, changeVisual, changeDot } from '@/config/arcVisual'
import type { CharacterArc, ArcEvent, ArcWindow } from '@shared/ipc'

export function CharacterArcPanel(): JSX.Element {
  const { t } = useTranslation('arc')
  const arcs = useWorkspace((s) => s.characterArc)
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const characters = useWorkspace((s) => s.characters)
  const selectedId = useWorkspace((s) => s.selectedArcId)
  const select = useWorkspace((s) => s.setSelectedArc)
  const chapterWrap = useWorkspace((s) => s.ganttLayers.chapters)
  const povOn = useWorkspace((s) => s.ganttLayers.pov)
  // The Highlight FACET lives in the store (not local) so the arc float truncates to the same facet.
  const facet = useWorkspace((s) => s.arcFacet)
  const setFacet = useWorkspace((s) => s.setArcFacet)
  const [preview, setPreview] = useState<{ path: string; title: string; kind: 'scene' | 'character' } | null>(null)
  const [page, setPage] = useState(0)
  const [evWin, setEvWin] = useState<[number, number] | null>(null) // trim rows by event count (focus the busiest arcs)
  const pageById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters])

  // Gantt scale (internal/gantt-scale.md): window the axis + paginate rows. colOf is the WINDOW ∩ variant-subset,
  // so scopeRows below drops characters with no window in view — subsuming the old per-variant filter.
  const sceneCols = useSceneAxis(scenes)
  const win = useGanttWindow(sceneCols)
  const cols = win.cols
  const colOf = win.colOf
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])
  // entity → the scenes it's POV of (effective pov from the graph) → glow those columns along its arc row.
  const povScenes = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [sid, sc] of Object.entries(graph.scenes)) {
      if (!sc.pov) continue
      const arr = m.get(sc.pov) ?? []
      arr.push(sid)
      m.set(sc.pov, arr)
    }
    return m
  }, [graph])
  // The chaptering wrap-layer comes from the story tree (folders = windows) — shared with the Thread map.
  const wraps = useMemo(() => (chapterWrap ? deriveWrapLevels(storyTree, colOf) : undefined), [chapterWrap, storyTree, colOf])
  const counts = useMemo(() => sceneVolumes(graph), [graph])

  const sorted = useMemo(
    () => [...(arcs ?? [])].sort((a, b) => b.windows.reduce((n, w) => n + w.events.length, 0) - a.windows.reduce((n, w) => n + w.events.length, 0) || a.name.localeCompare(b.name)),
    [arcs]
  )
  // Event-count WINDOW — trim rows by how many arc events a character logs (drag the low thumb up to hide the
  // barely-developed and focus the busiest arcs; the same windowed slider the Cast/Thread/Coherence rails use).
  const evCount = (a: (typeof sorted)[number]): number => a.windows.reduce((n, w) => n + w.events.length, 0)
  const maxEv = useMemo(() => Math.max(1, ...sorted.map(evCount)), [sorted])
  const loEv = evWin ? Math.min(Math.max(1, evWin[0]), maxEv) : 1
  const hiEv = evWin ? Math.min(Math.max(loEv, evWin[1]), maxEv) : maxEv
  const evAll = loEv === 1 && hiEv === maxEv
  const windowed = useMemo(() => sorted.filter((a) => { const n = evCount(a); return n >= loEv && n <= hiEv }), [sorted, loEv, hiEv])
  // Window-relevance + pagination in one call: keep characters with a window in the visible colOf (= window ∩
  // variant-subset — subsumes the old per-variant filter), then paint one page.
  const scoped = useMemo(() => scopeRows(windowed, (a) => a.windows.flatMap((w) => w.sceneIds), colOf, page), [windowed, colOf, page])

  const ganttRows = useMemo<GanttRow[]>(
    () =>
      scoped.shown.map((a) => {
        // With a facet highlighted, a character with NO event of that facet is DISABLED — dimmed and
        // non-clickable (gutter + bands), so you can't open an arc that has nothing of what you're filtering.
        const disabled = facet != null && !a.windows.some((w) => w.events.some((e) => catLabel(e.category) === facet))
        return {
          key: a.entityId,
          highlighted: selectedId === a.entityId,
          gutter: (
            <button
              disabled={disabled}
              onClick={() => {
                const pg = pageById.get(a.entityId) // the NAME cell → the character's PAGE (declared profile)
                if (pg) setPreview({ path: pg.path, title: pg.name, kind: 'character' })
              }}
              className={cn('flex h-full w-full items-center gap-2 border-l-2 border-transparent pr-2 pl-1.5 text-left', disabled && 'opacity-30')}
              title={disabled ? t('row.noFacet', { name: a.name, facet }) : t('row.openPage', { name: a.name })}
            >
              <span className={GANTT_ROW_TITLE}>{a.name}</span>
            </button>
          ),
          renderLane: ({ colW, colOf: co }) => [
            // POV glow (layer) — the scenes this character is POV of light up along its row (under the bands).
            ...(povOn ? povScenes.get(a.entityId) ?? [] : []).map((sid) => {
              const i = co.get(sid)
              return i == null ? null : (
                <span
                  key={`pov-${sid}`}
                  title={t('row.povScene', { name: a.name })}
                  className={cn('pointer-events-none absolute inset-y-0.5 rounded-sm bg-linear-to-t from-thread/55 to-lore/45 ring-1 ring-inset ring-lore/45', disabled && 'opacity-30')}
                  style={{ left: i * colW + 1, width: colW - 2 }}
                />
              )
            }),
            ...a.windows.map((w, i) => {
              const idxs = w.sceneIds.map((id) => co.get(id)).filter((x): x is number => x != null)
              if (idxs.length === 0) return null
              const min = Math.min(...idxs)
              const max = Math.max(...idxs)
              const width = (max - min + 1) * colW - 2
              return (
                <button
                  key={i}
                  disabled={disabled}
                  onClick={() => select(selectedId === a.entityId ? null : a.entityId)} // a BAND → the arc float (observed)
                  title={t('row.band', { name: a.name, title: w.title, count: w.events.length })}
                  className={cn('absolute top-1/2 flex h-4 -translate-y-1/2 items-center gap-0.5 overflow-hidden rounded-sm border border-border bg-panel-soft px-1', disabled && 'opacity-30')}
                  style={{ left: min * colW + 1, width }}
                >
                  <ArcDots events={w.events} width={width} facet={facet} />
                </button>
              )
            })
          ]
        }
      }),
    [scoped, selectedId, select, pageById, facet, povScenes, povOn]
  )

  if (arcs == null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return (
    <div {...regionAttrs('characterArcPanel')} className="relative flex min-h-0 flex-1 flex-col">
      {/* Highlight by FACET — shades non-matching dots + disables rows with none, and (shared via store)
          truncates the arc float to this facet. Mirrors the coherence map's Highlight row. */}
      <RailHeader data-export-hide="1" className="overflow-x-auto">
        <span className="shrink-0 text-faint">{t('highlight')}</span>
        {FACETS.map((f) => (
          <button
            key={f}
            onClick={() => setFacet(facet === f ? null : f)}
            title={FACET_BLURB[f]}
            className={cn('flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 capitalize', facet === f ? cn('border-current', facetVisual(f).text) : 'border-border text-muted-foreground hover:text-foreground')}
          >
            <span className={cn('size-1.5 rounded-[2px]', facetVisual(f).sw)} /> {f}
          </button>
        ))}
        {facet && (
          <button onClick={() => setFacet(null)} className="ml-1 shrink-0 text-faint hover:text-foreground">{t('clear')}</button>
        )}
      </RailHeader>
      <LifecycleGantt
        cols={cols.map((s) => ({ id: s.sceneId, title: s.title }))}
        wraps={wraps}
        counts={counts}
        rows={ganttRows}
        onColClick={(c) => {
          const sc = sceneById.get(c.id)
          if (sc) setPreview({ path: sc.path, title: sc.title, kind: 'scene' })
        }}
        empty={<EmptyRailState rail="arcs" />}
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
        page={{ from: scoped.from, to: scoped.to, total: scoped.total, noun: t('panel.charactersNoun'), page: scoped.page, pageCount: scoped.pageCount, onPage: setPage }}
        metric={{
          label: t('panel.rangeLabel'),
          min: 1,
          max: maxEv,
          value: [loEv, hiEv],
          onChange: setEvWin,
          readout: evAll ? t('all') : `${loEv}${loEv !== hiEv ? `–${hiEv}` : ''}`,
          onReset: evAll ? undefined : () => setEvWin(null),
          title: t('panel.rangeTitle')
        }}
      />
      <RailChrome
        region="characterArcPanel"
        name={t('title')}
        layers={['chapters', 'pov']}
        export={{ file: 'arc-rail', caption: () => t('title') }}
        help={ArcHelp}
      />
      {preview && <PageReadDialog path={preview.path} kind={preview.kind} title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  )
}

// ── Help ────────────────────────────────────────────────────────────────────────
function ArcHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('arc')
  return (
    <Dialog open={open} onClose={onClose} title={t('help.title')} size="detail">
      <div className="space-y-5">
        <HelpSection title={t('help.grid.title')}>
          <HelpList items={t('help.grid.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.facet.title')}>
          <HelpTable rows={FACETS.map((f) => [f, FACET_BLURB[f]])} />
        </HelpSection>
        <HelpSection title={t('help.change.title')}>
          <HelpTable rows={Object.entries(t('help.change.rows', { returnObjects: true }) as Record<string, string>)} />
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

/** Change dots that never overflow the cell — fits as many as the band's width allows, then "+N". The
 *  highlighted facet SHADES non-matching dots (count never changes — like the coherence map). */
function ArcDots({ events, width, facet }: { events: ArcEvent[]; width: number; facet?: string | null }): JSX.Element {
  const cap = Math.max(1, Math.floor((width - 6) / 8)) // ~8px per dot incl. gap, minus padding
  const dim = (e: ArcEvent): boolean => facet != null && catLabel(e.category) !== facet
  const shown = events.length <= cap ? events : events.slice(0, Math.max(0, cap - 1)) // leave a slot for "+N"
  return (
    <>
      {shown.map((e, k) => (
        <span key={k} className={cn('size-1.5 shrink-0 rounded-full', changeDot(e.change), dim(e) && 'opacity-20')} />
      ))}
      {events.length > shown.length && (
        <span className="shrink-0 text-[9px] leading-none text-faint">{shown.length ? `+${events.length - shown.length}` : events.length}</span>
      )}
    </>
  )
}

/** Resolution key: drop a leading honorific ("Mr See Yi Oh" → page "See Yi Oh"), then the shared normName (NFKC/
 *  lowercase/collapse) so it aligns with the entity VARIANT keys (bilingual "劉備 Liu Bei" resolves from "Liu Bei"). */
const normalizeName = (s: string): string => normName(s.replace(/^(mr|mrs|ms|dr|sir|lord|lady)\.?\s+/i, ''))

const statusColor = (s: string): string => (s === 'achieved' ? 'text-ok' : s === 'failed' || s === 'abandoned' ? 'text-flag' : 'text-faint')

/** Floating arc Sheet — the selected character's changes as a chapter RAILWAY (stations = chapters, hollow =
 *  offstage/static), latest chapter first; page link in header. */
export function ArcDetail({ arc, onClose, focus }: { arc: CharacterArc; onClose: () => void; focus?: string | null }): JSX.Element {
  const { t } = useTranslation('arc')
  // Deep-link focus. Two forms: the scene inspector passes `sceneId␁value` (␁ = \u0001) to pin the EXACT event; the
  // coherence panel passes a bare WINDOW id. Split → pre-open the matching window, and (inspector case) highlight the
  // one event whose scene + value match — so clicking the arc row vs the secret row lands on different rows. Both
  // callers previously set `arcChapter` that nothing read.
  const [focusScene, focusValue] = (focus ?? '').split('\u0001')
  const focusWindowId = focusScene ? arc.windows.find((w) => w.sceneIds.includes(focusScene) || w.windowId === focusScene)?.windowId ?? null : null
  const characters = useWorkspace((s) => s.characters)
  const openPage = useWorkspace((s) => s.openPage)
  const storyTree = useWorkspace((s) => s.storyTree)
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const chapterIndex = useMemo(() => buildChapterIndex(storyTree), [storyTree])
  const orderedKeys = useMemo(() => [...chapterIndex.chapters.keys()], [chapterIndex])
  const [preview, setPreview] = useState<{ path: string; title: string; kind: 'character' | 'location' | 'item' | 'lore' | 'scene' } | null>(null)
  // Esc is handled by the host FloatWindow (recency-ordered across floats), not here.
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])

  const page = useMemo(() => {
    const n = normalizeName(arc.name)
    return characters.find((c) => normalizeName(c.name) === n) ?? null
  }, [characters, arc.name])

  // Presence strip — the whole story as one row, weight = this character's dialogue volume where they're cast.
  // Mirrors the Entity strip: axis (active-variant canvas) ∪ any off-axis scenes they appear in, reading order.
  const axisScenes = useSceneAxis(scenes)
  const presenceById = useMemo(() => {
    const m = new Map<string, number>()
    for (const [sid, sc] of Object.entries(graph.scenes)) {
      const mine = sc.cast.find((c) => c.entityId === arc.entityId)
      if (mine) m.set(sid, Math.max(1, mine.volume ?? 0)) // present-but-silent still shows a tick
    }
    return m
  }, [graph, arc.entityId])
  const orderedScenes = useMemo(() => {
    const on = new Set(axisScenes.map((s) => s.sceneId))
    const base = axisScenes.map((s) => ({ sceneId: s.sceneId, title: s.title }))
    const off = [...presenceById.keys()].filter((id) => !on.has(id)).map((id) => ({ sceneId: id, title: sceneById.get(id)?.title ?? id }))
    if (!off.length) return base
    return [...base, ...off].sort((a, b) => (graph.scenes[a.sceneId]?.linearPos ?? 1e9) - (graph.scenes[b.sceneId]?.linearPos ?? 1e9))
  }, [axisScenes, presenceById, sceneById, graph])
  const heatCells: HeatCell[] = useMemo(
    () =>
      orderedScenes.map((s) => {
        const w = presenceById.get(s.sceneId) ?? 0
        const chKey = chapterIndex.sceneChapter.get(s.sceneId)
        const sc = sceneById.get(s.sceneId)
        return {
          key: s.sceneId,
          label: w > 0 ? t('detail.heatCell', { title: s.title, count: w }) : s.title,
          weight: w,
          onClick: w > 0 && sc ? () => setPreview({ path: sc.path, title: sc.title, kind: 'scene' }) : undefined,
          group: chKey ? { key: chKey, title: chapterIndex.chapters.get(chKey)?.title ?? chKey } : undefined
        }
      }),
    [orderedScenes, presenceById, chapterIndex, sceneById]
  )
  // A character is FACT-LIKE: its span (first/last/count) is already visible in the appearance strip, so no
  // endpoints grid — the strip is the one pinned main view (no RESOLVES⇄APPEARS toggle; threads keep theirs).

  const total = arc.windows.reduce((n, w) => n + w.events.length, 0)
  // Resolve a Tension "with" name (often honorific-prefixed, e.g. "Mr See Yi Oh") to a character page.
  // Keyed by name VARIANTS (script-split) so a Tension "with 曹操" or "with Cao Cao" both resolve to the page.
  const charByNorm = useMemo(() => {
    const m = new Map<string, (typeof characters)[number]>()
    for (const c of characters) for (const v of entityNameVariants({ id: c.id, name: c.name })) if (!m.has(v)) m.set(v, c)
    return m
  }, [characters])
  const openName = (nm: string): void => {
    const c = charByNorm.get(normalizeName(nm))
    if (c) setPreview({ path: c.path, title: c.name, kind: 'character' })
  }

  // Right-pane detail for one chapter window — summary + Wants · Tension · Changes (the old WindowCard body).
  const windowDetail = (w: ArcWindow): ReactNode => {
    const goals = w.goals ?? []
    const conflicts = w.conflicts ?? []
    return (
      <div className="space-y-4">
        {w.summary && <p className="text-[12px] leading-relaxed text-foreground/85">{w.summary}</p>}
        {goals.length > 0 && (
          <div>
            <div className="mb-1 text-[9.5px] font-medium uppercase tracking-wide text-faint">{t('detail.wants')}</div>
            <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-2 rounded-md border border-border/60 px-3 py-3 text-[11.5px]">
              <div className="text-[9px] uppercase tracking-wide text-faint">{t('detail.goal')}</div>
              <div className="text-right text-[9px] uppercase tracking-wide text-faint">{t('detail.status')}</div>
              {goals.map((g, k) => (
                <div key={k} className="contents">
                  <span className="text-muted-foreground">{g.goal}</span>
                  <span className={cn('text-right text-[9px] font-medium uppercase tracking-wide', statusColor(g.status))}>{g.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {conflicts.length > 0 && (
          <div>
            <div className="mb-1 text-[9.5px] font-medium uppercase tracking-wide text-faint">{t('detail.tension')}</div>
            <div className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 rounded-md border border-border/60 px-3 py-3 text-[11.5px]">
              <div className="text-[9px] uppercase tracking-wide text-faint">{t('detail.over')}</div>
              <div className="text-right text-[9px] uppercase tracking-wide text-faint">{t('detail.with')}</div>
              {conflicts.map((c, k) => (
                <div key={k} className="contents">
                  <span className="text-muted-foreground">{c.over}</span>
                  <span className="text-right text-faint">
                    {c.with.length > 0
                      ? c.with.map((nm, j) => {
                          const ch = charByNorm.get(normalizeName(nm))
                          return (
                            <span key={j}>
                              {j > 0 && ', '}
                              {ch ? <button onClick={() => openName(nm)} className="text-character hover:underline" title={t('row.openPage', { name: nm })}>{nm}</button> : nm}
                            </span>
                          )
                        })
                      : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {w.events.length > 0 && (
          <div>
            <div className="mb-1 text-[9.5px] font-medium uppercase tracking-wide text-faint">{t('detail.changes')}</div>
            <div className="grid grid-cols-[auto_auto_1fr] items-start gap-x-3 gap-y-1.5 rounded-md border border-border/60 px-3 py-2 text-[11.5px]">
              <div className="text-[9px] uppercase tracking-wide text-faint">{t('detail.type')}</div>
              <div className="text-[9px] uppercase tracking-wide text-faint">{t('detail.change')}</div>
              <div className="text-[9px] uppercase tracking-wide text-faint">{t('detail.summary')}</div>
              {w.events.map((e, k) => (
                <ArcEventRow key={k} e={e} highlight={!!focusValue && e.sceneId === focusScene && e.value === focusValue} />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }
  const posOf = useMemo(() => new Map(orderedKeys.map((k, i) => [k, i])), [orderedKeys])
  const events: FeedEvent[] = arc.windows
    .filter((w) => w.events.length > 0)
    .map((w) => {
      const chKey = chapterIndex.sceneChapter.get(w.sceneIds[0]) ?? ''
      return {
        id: w.windowId,
        chapterKey: chKey,
        pos: posOf.get(chKey) ?? 1e9,
        title: chapterIndex.chapters.get(chKey)?.title ?? w.title,
        summary: w.summary || t('detail.changesThisChapter', { count: w.events.length }),
        detail: windowDetail(w),
        kind: t('detail.changeCount', { count: w.events.length })
      }
    })
  const chapters: FeedChapter[] = orderedKeys.map((k, i) => ({ key: k, title: chapterIndex.chapters.get(k)?.title ?? k, pos: i }))

  return (
    <>
      <DetailSplitView
        onClose={onClose}
        icon={<span className="size-2 shrink-0 rounded-full bg-character" />}
        title={
          page ? (
            <button onClick={() => void openPage({ path: page.path, title: page.name, kind: page.kind })} className="inline-flex items-center gap-1 text-character hover:underline" title={t('detail.openCharPage')}>
              {arc.name} <ExternalLink className="size-3 shrink-0" />
            </button>
          ) : (
            arc.name
          )
        }
        meta={`${t('detail.metaEvents', { count: total })} · ${t('detail.metaWindows', { count: arc.windows.length })}`}
        heatmap={<AppearanceHeatStrip cells={heatCells} accentClass="text-character" />}
        tabs={[{ id: 'feed', label: t('detail.journey'), icon: <Rows3 className="size-3.5" />, count: events.length }]}
        tab="feed"
        onTab={() => {}}
        chapters={chapters}
        events={events}
        isFeed
        focusId={focusWindowId}
      />
      {preview && <PageReadDialog path={preview.path} kind={preview.kind} title={preview.title} onClose={() => setPreview(null)} />}
    </>
  )
}

/** One state-change as a grid row (display:contents) so its cells land in the Events table's columns.
 *  `highlight` rings the row when a deep-link (a scene inspector) opened the arc ON this exact event. */
function ArcEventRow({ e, highlight }: { e: ArcEvent; highlight?: boolean }): JSX.Element {
  const c = changeVisual(e.change)
  const f = facetVisual(e.category)
  return (
    <div className={cn('contents', highlight && '*:bg-thread/10 [&>span:first-child]:rounded-l [&>span:last-child]:rounded-r')}>
      <span className={cn('inline-flex shrink-0 items-center gap-1 self-start rounded bg-panel-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', f.text)}>
        <span className={cn('size-1.5 shrink-0 rounded-[2px]', f.sw)} />
        {catLabel(e.category)}
      </span>
      <span className={cn('shrink-0 self-start py-0.5 text-[9px] font-semibold uppercase tracking-wide', c.text)}>{c.verb}</span>
      <span className="min-w-0">
        <span className="text-foreground/85">{e.value || e.description || ''}</span>
        {e.value && e.description && <span className="mt-0.5 block text-[11px] text-faint">{e.description}</span>}
      </span>
    </div>
  )
}
