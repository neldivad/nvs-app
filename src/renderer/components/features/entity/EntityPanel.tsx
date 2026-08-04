/**
 * Entity pivot — the windowed-journey lens for tracked non-character things (items · factions · … ), matching
 * the Character pivot's grammar: the SAME uniform axis as the Thread map (scene columns), the SAME chapter
 * wrap-layer, and coarse per-window bands with change dots. Rows come from `entityArcs` (the entity window
 * pass); clicking a row/band selects the entity → the EntityDetailFloat (journey + presence sheet). The facet
 * Highlight row is DYNAMIC — entity facets are guided-open per category (custody/state/power/…), so the chips
 * are whatever the data actually used, colored by a stable palette assignment.
 */
import { useMemo, useState, type JSX, type ReactNode } from 'react'
import { ExternalLink, Loader2, Rows3 } from 'lucide-react'
import { regionAttrs } from '@/config/regions'
import { EmptyRailState } from '@/components/ui/EmptyRailState'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { entityVisual } from '@/config/entityVisual'
import { entityChangeVisual, entityChangeDot } from '@/config/entityArcVisual'
import { facetVisual, type FacetVisual } from '@/config/arcVisual'
import { LifecycleGantt, deriveWrapLevels, sceneVolumes, GANTT_ROW_TITLE, type GanttRow } from '@/components/features/custody/LifecycleGantt'
import { buildChapterIndex } from '@/lib/analysis/chapterIndex'
import { useSceneAxis } from '@/lib/timeline/sceneAxis'
import { useGanttWindow, scopeRows } from '@/lib/timeline/ganttWindow'
import { RailScaleBar } from '@/components/layout/RailScaleBar'
import { RailChrome } from '@/components/layout/RailChrome'
import { RailHeader } from '@/components/ui/RailHeader'
import { Dialog } from '@/components/ui/dialog'
import { HelpSection, HelpTable, HelpList } from '@/components/ui/help'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { DetailSplitView, type FeedEvent, type FeedChapter, type DetailEndpoint } from '@/components/layout/DetailSplitView'
import { AppearanceHeatStrip, type HeatCell } from '@/components/layout/AppearanceHeatStrip'
import type { CharacterArc, ArcWindow, EntityTrack } from '@shared/ipc'

/** Stable palette assignment for OPEN facets: sorted facet names cycle through the six facet color slots. */
const PALETTE_SLOTS = ['alignment', 'knowledge', 'power', 'relationship', 'objective', 'secret']
function facetPalette(facets: string[]): Map<string, FacetVisual> {
  return new Map([...facets].sort().map((f, i) => [f, facetVisual(PALETTE_SLOTS[i % PALETTE_SLOTS.length])]))
}

export function EntityPanel(): JSX.Element {
  const arcs = useWorkspace((s) => s.entityArcs)
  const tracks = useWorkspace((s) => s.entityTracks)
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const selectedId = useWorkspace((s) => s.selectedEntityId)
  const select = useWorkspace((s) => s.setSelectedEntity)
  const chapterWrap = useWorkspace((s) => s.ganttLayers.chapters)
  // Two-layer filter: CATEGORY scopes the rows (an item facet is meaningless on a faction row), then that
  // category's FACETS highlight within it. Picking a category resets the facet. The facet lives in the STORE
  // (like arcFacet) so the entity float truncates to the same facet.
  const [cat, setCat] = useState<string | null>(null)
  const facet = useWorkspace((s) => s.entityFacet)
  const setFacet = useWorkspace((s) => s.setEntityFacet)
  const [preview, setPreview] = useState<{ path: string; title: string } | null>(null)

  const typeById = useMemo(() => new Map((tracks ?? []).map((t) => [t.id, t.type])), [tracks])

  const [page, setPage] = useState(0)
  const [chWin, setChWin] = useState<[number, number] | null>(null) // trim rows by change count (focus the busiest journeys)
  const sceneCols = useSceneAxis(scenes)
  const win = useGanttWindow(sceneCols) // gantt scale: window the axis + paginate rows (see gantt-scale.md)
  const cols = win.cols
  const colOf = win.colOf
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])
  const wraps = useMemo(() => (chapterWrap ? deriveWrapLevels(storyTree, colOf) : undefined), [chapterWrap, storyTree, colOf])
  const counts = useMemo(() => sceneVolumes(graph), [graph])

  const sorted = useMemo(
    () => [...(arcs ?? [])].sort((a, b) => b.windows.reduce((n, w) => n + w.events.length, 0) - a.windows.reduce((n, w) => n + w.events.length, 0) || a.name.localeCompare(b.name)),
    [arcs]
  )
  // Window-relevance (= window ∩ variant-subset): only entities with a window in the visible colOf — an item/
  // faction confined to un-placed or off-window chapters drops out.
  const relevant = useMemo(() => sorted.filter((a) => a.windows.some((w) => w.sceneIds.some((id) => colOf.has(id)))), [sorted, colOf])

  // Layer 1 — the categories present among arc'd entities. A single-category project skips this layer.
  const catsUsed = useMemo(
    () => [...new Set(relevant.map((a) => typeById.get(a.entityId)).filter((t): t is string => !!t))].sort(),
    [relevant, typeById]
  )
  const effectiveCat = cat ?? (catsUsed.length === 1 ? catsUsed[0] : null)
  // Category scope FILTERS the rows (not a dim — cross-category rows carry nothing comparable).
  const visible = useMemo(
    () => (effectiveCat ? relevant.filter((a) => typeById.get(a.entityId) === effectiveCat) : relevant),
    [relevant, effectiveCat, typeById]
  )
  // Change-count WINDOW — trim rows by how many changes an entity logs (drag the low thumb up to hide barely-
  // tracked items and focus the busiest journeys; the same windowed slider the Cast/Thread/Coherence rails use).
  const chCount = (a: (typeof visible)[number]): number => a.windows.reduce((n, w) => n + w.events.length, 0)
  const maxCh = useMemo(() => Math.max(1, ...visible.map(chCount)), [visible])
  const loCh = chWin ? Math.min(Math.max(1, chWin[0]), maxCh) : 1
  const hiCh = chWin ? Math.min(Math.max(loCh, chWin[1]), maxCh) : maxCh
  const chAll = loCh === 1 && hiCh === maxCh
  const windowed = useMemo(() => visible.filter((a) => { const n = chCount(a); return n >= loCh && n <= hiCh }), [visible, loCh, hiCh])
  // Paginate the (window + category + change-count) rows — one page in the DOM.
  const scoped = useMemo(() => scopeRows(windowed, (a) => a.windows.flatMap((w) => w.sceneIds), colOf, page), [windowed, colOf, page])

  // Layer 2 — dynamic facet chips: the facets the SCOPED data actually used (guided-open), stable colors.
  const facetsUsed = useMemo(
    () => (effectiveCat ? [...new Set(visible.flatMap((a) => a.windows.flatMap((w) => w.events.map((e) => e.category))))].filter(Boolean).sort() : []),
    [visible, effectiveCat]
  )
  const palette = useMemo(() => facetPalette(facetsUsed), [facetsUsed])

  const ganttRows = useMemo<GanttRow[]>(
    () =>
      scoped.shown.map((a) => {
        const type = typeById.get(a.entityId) ?? 'item'
        const { Icon, text } = entityVisual(type)
        // With a facet highlighted, an entity with NO event of that facet is dimmed + non-clickable.
        const disabled = facet != null && !a.windows.some((w) => w.events.some((e) => e.category === facet))
        return {
          key: a.entityId,
          highlighted: selectedId === a.entityId,
          gutter: (
            <button
              disabled={disabled}
              onClick={() => select(selectedId === a.entityId ? null : a.entityId)}
              className={cn('flex h-full w-full items-center gap-1.5 border-l-2 border-transparent pr-2 pl-1.5 text-left', disabled && 'opacity-30')}
              title={disabled ? `${a.name} — no ${facet}` : `${a.name} — open journey`}
            >
              <Icon className={cn('size-3 shrink-0', text)} />
              <span className={GANTT_ROW_TITLE}>{a.name}</span>
            </button>
          ),
          renderLane: ({ colW, colOf: co }) =>
            a.windows.map((w, i) => {
              const idxs = w.sceneIds.map((id) => co.get(id)).filter((x): x is number => x != null)
              if (idxs.length === 0) return null
              const min = Math.min(...idxs)
              const max = Math.max(...idxs)
              const width = (max - min + 1) * colW - 2
              return (
                <button
                  key={i}
                  disabled={disabled}
                  onClick={() => select(selectedId === a.entityId ? null : a.entityId)}
                  title={`${a.name} · ${w.title}: ${w.events.length} change${w.events.length === 1 ? '' : 's'}`}
                  className={cn('absolute top-1/2 flex h-4 -translate-y-1/2 items-center gap-0.5 overflow-hidden rounded-sm border border-border bg-panel-soft px-1', disabled && 'opacity-30')}
                  style={{ left: min * colW + 1, width }}
                >
                  <ChangeDots events={w.events} width={width} facet={facet} />
                </button>
              )
            })
        }
      }),
    [scoped, selectedId, select, facet, typeById]
  )

  if (arcs == null || tracks == null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return (
    <div {...regionAttrs('entityPanel')} className="relative flex min-h-0 flex-1 flex-col">
      {/* Two-layer filter: pick a CATEGORY (scopes the rows), then highlight by that category's FACETS (dims
          non-matching dots). One category → layer 1 collapses away. */}
      <RailHeader data-export-hide="1" className="overflow-x-auto">
        {catsUsed.length > 1 && (
          <>
            <span className="shrink-0 text-faint">Category</span>
            {catsUsed.map((c) => {
              const { Icon, text } = entityVisual(c)
              const on = cat === c
              return (
                <button
                  key={c}
                  onClick={() => {
                    setCat(on ? null : c)
                    setFacet(null) // facets belong to the category — a new scope resets the highlight
                  }}
                  className={cn('flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 capitalize', on ? cn('border-current', text) : 'border-border text-muted-foreground hover:text-foreground')}
                >
                  <Icon className="size-3" /> {c}
                </button>
              )
            })}
          </>
        )}
        {effectiveCat && facetsUsed.length > 0 && (
          <>
            <span className={cn('shrink-0 text-faint', catsUsed.length > 1 && 'ml-2 border-l border-border pl-3')}>Highlight</span>
            {facetsUsed.map((f) => {
              const v = palette.get(f)!
              return (
                <button
                  key={f}
                  onClick={() => setFacet(facet === f ? null : f)}
                  className={cn('flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 capitalize', facet === f ? cn('border-current', v.text) : 'border-border text-muted-foreground hover:text-foreground')}
                >
                  <span className={cn('size-1.5 rounded-[2px]', v.sw)} /> {f}
                </button>
              )
            })}
          </>
        )}
        {catsUsed.length === 0 && <span className="text-faint">— no journeys recorded yet</span>}
        {(facet || cat) && (
          <button onClick={() => { setFacet(null); setCat(null) }} className="ml-1 shrink-0 text-faint hover:text-foreground">clear</button>
        )}
      </RailHeader>
      <LifecycleGantt
        cols={cols.map((s) => ({ id: s.sceneId, title: s.title }))}
        wraps={wraps}
        counts={counts}
        rows={ganttRows}
        onColClick={(c) => {
          const sc = sceneById.get(c.id)
          if (sc) setPreview({ path: sc.path, title: sc.title })
        }}
        empty={<EmptyRailState rail="entities" />}
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
        page={{ from: scoped.from, to: scoped.to, total: scoped.total, noun: 'entities', page: scoped.page, pageCount: scoped.pageCount, onPage: setPage }}
        metric={{
          label: 'Range',
          min: 1,
          max: maxCh,
          value: [loCh, hiCh],
          onChange: setChWin,
          readout: chAll ? 'all' : `${loCh}${loCh !== hiCh ? `–${hiCh}` : ''}`,
          onReset: chAll ? undefined : () => setChWin(null),
          title: 'Trim entities by change count — drag the low thumb up to hide barely-tracked items and focus the busiest journeys.'
        }}
      />
      <RailChrome
        region="entityPanel"
        name="Entity journey"
        layers={['chapters']}
        export={{ file: 'entity-rail', caption: () => 'Entity journey' }}
        help={EntityHelp}
      />
      {preview && <PageReadDialog path={preview.path} kind="scene" title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  )
}

/** Change dots that never overflow the band — same cap logic as the character ArcDots; colored by change TONE. */
function ChangeDots({ events, width, facet }: { events: ArcWindow['events']; width: number; facet?: string | null }): JSX.Element {
  const cap = Math.max(1, Math.floor((width - 6) / 8))
  const dim = (e: ArcWindow['events'][number]): boolean => facet != null && e.category !== facet
  const shown = events.length <= cap ? events : events.slice(0, Math.max(0, cap - 1))
  return (
    <>
      {shown.map((e, k) => (
        <span key={k} className={cn('size-1.5 shrink-0 rounded-full', entityChangeDot(e.change), dim(e) && 'opacity-20')} />
      ))}
      {events.length > shown.length && (
        <span className="shrink-0 text-[9px] leading-none text-faint">{shown.length ? `+${events.length - shown.length}` : events.length}</span>
      )}
    </>
  )
}

// ── Help ────────────────────────────────────────────────────────────────────────
function EntityHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Entity journeys — how to read them" size="detail">
      <div className="space-y-5">
        <HelpSection title="The grid">
          <HelpList
            items={[
              <>Each <b className="text-foreground/80">row</b> is a tracked thing (item · faction · …); <b className="text-foreground/80">columns</b> are scenes in reading order.</>,
              <>The <b className="text-foreground/80">bands</b> group scenes into chapters — a thing's changes are accumulated per chapter, like a character's.</>,
              <>A band's <b className="text-foreground/80">dots</b> are the changes in that chapter, colored by direction; click a row to read the journey.</>
            ]}
          />
        </HelpSection>
        <HelpSection title="How it moved (every change is one of four)">
          <HelpTable
            rows={[
              ['● gain', 'it strengthens / is acquired / rises'],
              ['● loss', 'it weakens / is destroyed / falls'],
              ['● shift', 'a lateral move — changes hands, is altered, realigns'],
              ['● reveal', 'it becomes known — exposed or discovered']
            ]}
          />
        </HelpSection>
        <HelpSection title="What changed (the facet)">
          <HelpList
            items={[
              <>Facets are <b className="text-foreground/80">per category</b>: an item moves along custody · state · location · function; a faction along power · standing · allegiance · territory.</>,
              <>Only <b className="text-foreground/80">arc-worthy</b> things get journeys: it has a world page, recurs across scenes, or the analysis flagged it major.</>
            ]}
          />
        </HelpSection>
        <HelpSection title="Provenance">
          <HelpList items={[<>The journey is the analysis agent's reading of the scenes — its understanding, not authored truth. Re-running analysis refreshes it.</>]} />
        </HelpSection>
      </div>
    </Dialog>
  )
}

// ── The journey Sheet (rendered in the EntityDetailFloat) ───────────────────────

/** The selected entity's sheet — ArcDetail's grammar for things: identity header (name links to its world page
 *  when authored), facet-filter chips shared with the panel (store `entityFacet`), the chapter-railway journey
 *  with character names linked, and the presence trail as clickable scene previews. */
export function EntityDetail({ track, arc, onClose, focus }: { track: EntityTrack; arc: CharacterArc | null; onClose: () => void; focus?: string | null }): JSX.Element {
  const storyTree = useWorkspace((s) => s.storyTree)
  const worldPages = useWorkspace((s) => s.worldPages)
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const openPage = useWorkspace((s) => s.openPage)
  const [preview, setPreview] = useState<{ path: string; title: string; kind: 'scene' | 'character' } | null>(null)
  const { Icon, text } = entityVisual(track.type)
  const chapterIndex = useMemo(() => buildChapterIndex(storyTree), [storyTree])
  const orderedKeys = useMemo(() => [...chapterIndex.chapters.keys()], [chapterIndex])

  // The entity's own WORLD PAGE (authored) — header name links to it, like the character sheet.
  const page = useMemo(() => {
    const nn = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    return worldPages.find((p) => p.id === track.id) ?? worldPages.find((p) => nn(p.name) === nn(track.name)) ?? null
  }, [worldPages, track])
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])

  // Presence strip cells — every scene in reading order (axis ∪ this entity's off-axis presence scenes), weight =
  // its own dialogue lines there (≥1 when present-but-silent). The shared AppearanceHeatStrip buckets to folders.
  const axisScenes = useSceneAxis(scenes)
  // The strip is "the whole story as one row", but the axis is scoped to the active-variant CANVAS SUBSET — so an
  // appearance on a scene that isn't placed on the current canvas fell off it and the strip read all-empty while
  // the header said "appears in N". Union THIS entity's off-axis presence scenes back in, positioned by reading
  // order, so every appearance the header counts actually lights.
  const orderedScenes = useMemo(() => {
    const on = new Set(axisScenes.map((s) => s.sceneId))
    const off = track.scenes.filter((s) => !on.has(s.sceneId))
    const base = axisScenes.map((s) => ({ sceneId: s.sceneId, title: s.title }))
    if (!off.length) return base
    return [...base, ...off.map((s) => ({ sceneId: s.sceneId, title: s.title }))].sort(
      (a, b) => (graph.scenes[a.sceneId]?.linearPos ?? 1e9) - (graph.scenes[b.sceneId]?.linearPos ?? 1e9)
    )
  }, [axisScenes, track, graph])
  const weightOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of track.scenes) {
      const mine = graph.scenes[s.sceneId]?.cast.find((c) => c.entityId === track.id)?.volume ?? 0
      m.set(s.sceneId, Math.max(1, mine)) // present-but-silent (a mentioned item/faction) still shows as a tick
    }
    return m
  }, [track, graph])
  const heatCells: HeatCell[] = useMemo(
    () =>
      orderedScenes.map((s) => {
        const w = weightOf.get(s.sceneId) ?? 0
        const chKey = chapterIndex.sceneChapter.get(s.sceneId)
        const sc = sceneById.get(s.sceneId)
        return {
          key: s.sceneId,
          label: `${s.title}${w > 0 ? ` — ${w} ln` : ''}`,
          weight: w,
          onClick: w > 0 && sc ? () => setPreview({ path: sc.path, title: sc.title, kind: 'scene' }) : undefined,
          group: chKey ? { key: chKey, title: chapterIndex.chapters.get(chKey)?.title ?? chKey } : undefined
        }
      }),
    [orderedScenes, weightOf, chapterIndex, sceneById]
  )

  // Span endpoints — first & last scene THIS entity appears in, reading order (the shared SPAN⇄APPEARS slot).
  const presence = useMemo(
    () => [...track.scenes].sort((a, b) => (graph.scenes[a.sceneId]?.linearPos ?? 1e9) - (graph.scenes[b.sceneId]?.linearPos ?? 1e9)),
    [track, graph]
  )
  const firstApp = presence[0]
  const lastApp = presence[presence.length - 1]
  const sceneRef = (s: { sceneId: string; title: string } | undefined): ReactNode => {
    if (!s) return <span className="text-faint">—</span>
    const sc = sceneById.get(s.sceneId)
    return (
      <button onClick={() => sc && setPreview({ path: sc.path, title: sc.title, kind: 'scene' })} title={s.title} className={cn('block max-w-full truncate text-left hover:underline', text)}>
        {s.title}
      </button>
    )
  }
  const endpoints: DetailEndpoint[] = [
    { k: 'First appears', v: sceneRef(firstApp) },
    { k: 'Last appears', v: sceneRef(lastApp) },
    { k: 'Appears in', v: `${track.scenes.length} scene${track.scenes.length === 1 ? '' : 's'}` }
  ]

  // Journey feed — one event per chapter WINDOW: its synthesis + the facet/change table (the old EntityWindowCard).
  const allWindows = useMemo(() => (arc?.windows ?? []).filter((w) => w.events.length > 0), [arc])
  const total = allWindows.reduce((n, w) => n + w.events.length, 0)
  // Deep-link focus (from the inspector's Entities/Custody rows): `sceneIdvalue` pins an EXACT event; a bare
  // scene id just pre-opens its window. Split → open the window + (value case) highlight the one matching event.
  const [focusScene, focusValue] = (focus ?? '').split('\u0001')
  const focusWindowId = focusScene ? allWindows.find((w) => w.sceneIds.includes(focusScene) || w.windowId === focusScene)?.windowId ?? null : null
  const windowDetail = (w: ArcWindow): ReactNode => (
    <div className="space-y-3.5">
      {w.summary && <p className="text-[12px] leading-relaxed text-foreground/85">{w.summary}</p>}
      {w.events.length > 0 && (
        <div>
          <div className="mb-1 text-[9.5px] font-medium uppercase tracking-wide text-faint">Changes</div>
          <div className="grid grid-cols-[auto_auto_1fr] items-start gap-x-3 gap-y-1.5 rounded-md border border-border/60 px-3 py-2 text-[11.5px]">
            {w.events.map((e, k) => {
              const v = entityChangeVisual(e.change)
              const hit = !!focusValue && e.sceneId === focusScene && e.value === focusValue
              return (
                <div key={k} className={cn('contents', hit && '*:bg-thread/10 [&>span:first-child]:rounded-l [&>span:last-child]:rounded-r')}>
                  <span className="inline-flex shrink-0 items-center gap-1 self-start rounded bg-panel-soft px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-faint">
                    <span className={cn('size-1.5 shrink-0 rounded-full', v.dot)} />{e.category}
                  </span>
                  <span className={cn('shrink-0 self-start py-0.5 text-[9px] font-medium uppercase tracking-wide', v.text)}>{e.change}</span>
                  <span className="min-w-0">
                    <span className="text-foreground/85">{e.value}</span>
                    {e.description && e.description !== e.value && <span className="mt-0.5 block text-[11px] text-faint">{e.description}</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
  const posOf = useMemo(() => new Map(orderedKeys.map((k, i) => [k, i])), [orderedKeys])
  const events: FeedEvent[] = allWindows.map((w) => {
    const chKey = chapterIndex.sceneChapter.get(w.sceneIds[0]) ?? ''
    const sc = sceneById.get(w.sceneIds[0])
    return {
      id: w.windowId,
      chapterKey: chKey,
      pos: posOf.get(chKey) ?? 1e9,
      title: chapterIndex.chapters.get(chKey)?.title ?? w.title,
      summary: w.summary || `${w.events.length} change${w.events.length === 1 ? '' : 's'} this chapter`,
      detail: windowDetail(w),
      kind: `${w.events.length} change${w.events.length === 1 ? '' : 's'}`,
      onOpen: sc ? () => setPreview({ path: sc.path, title: sc.title, kind: 'scene' }) : undefined
    }
  })
  const chapters: FeedChapter[] = orderedKeys.map((k, i) => ({ key: k, title: chapterIndex.chapters.get(k)?.title ?? k, pos: i }))

  return (
    <>
      <DetailSplitView
        onClose={onClose}
        icon={<Icon className={cn('size-4 shrink-0', text)} />}
        title={
          page ? (
            <button onClick={() => void openPage({ path: page.path, title: page.name, kind: page.kind })} className={cn('inline-flex items-center gap-1 hover:underline', text)} title={`Open ${track.type} page`}>
              {track.name} <ExternalLink className="size-3 shrink-0" />
            </button>
          ) : (
            track.name
          )
        }
        chips={
          <>
            <span className={cn('shrink-0 text-[10px] uppercase tracking-wide', text)}>{track.type}</span>
            {track.significance && (
              <span className={cn('shrink-0 rounded-full border px-1.5 text-[9px] uppercase tracking-wide', track.significance === 'major' ? 'border-thread/50 text-thread' : 'border-border text-faint')}>{track.significance}</span>
            )}
          </>
        }
        meta={`${total} change${total === 1 ? '' : 's'} · ${track.scenes.length} scene${track.scenes.length === 1 ? '' : 's'}`}
        endpoints={endpoints}
        heatmap={<AppearanceHeatStrip cells={heatCells} accentClass={text} />}
        tabs={[{ id: 'feed', label: 'Journey', icon: <Rows3 className="size-3.5" />, count: allWindows.length }]}
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
