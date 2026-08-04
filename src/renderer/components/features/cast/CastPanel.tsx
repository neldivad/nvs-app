/**
 * Cast workspace — ways to read the character objects:
 *  • Presence    — two tiers: per-scene dialog-volume bars (by chapter) over a character × scene
 *                  heatmap shaded by char volume; hover any cell/bar for the value
 *  • Co-presence — lower-triangle heatmap of shared scenes between characters
 *  • Relationships — co-presence as a force-directed graph (ECharts), over a chosen scene range
 * The sidebar roster picks which characters appear (the lever against O(chars × scenes) blow-up);
 * a min/max volume window trims by char-volume (rarely-speaking at the low end, most talkative leads at
 * the high end). Clicking a row (character) or column (scene)
 * opens the standard PageReadDialog. All T1 (presence) — never depends on analysis.
 */
import { memo, useCallback, useMemo, useState, type JSX } from 'react';
import { ArrowDownWideNarrow, Clock } from 'lucide-react'
import { regionAttrs } from '@/config/regions'
import { useWorkspace } from '@/stores/workspace'
import { EmptyHint, EmptyRailState } from '@/components/ui/EmptyRailState'
import { cn, charsLabel } from '@/lib/utils'
import { useSceneAxis } from '@/lib/timeline/sceneAxis'
import { useGanttWindow, paginate } from '@/lib/timeline/ganttWindow'
import { SequenceSelect } from '@/components/layout/SequenceSelect'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { CharacterGraph } from '@/components/features/arc/CharacterGraph'
import { RelationshipPreviewFloat } from '@/components/features/relationships/RelationshipPreviewFloat'
import { CHAPTER_BARS, cleanChapterName, GANTT_ROW_TITLE, sceneChainMap, bandBg, type ChainSeg } from '@/components/features/custody/LifecycleGantt'
import { RailChrome } from '@/components/layout/RailChrome'
import { RailScaleBar } from '@/components/layout/RailScaleBar'
import { RailHeader, RailTabs } from '@/components/ui/RailHeader'
import { Dialog } from '@/components/ui/dialog'
import { HelpSection, HelpList } from '@/components/ui/help'
import type { PageRef, SceneFile } from '@shared/ipc'

type Tab = 'presence' | 'copresence' | 'graph'
interface Preview {
  kind: PageRef['kind']
  path: string
  title: string
}
const MAX_CELLS = 6000 // DOM-cell ceiling; rows are capped to fit (the roster sidebar + threshold trim further)


export function CastPanel(): JSX.Element {
  const characters = useWorkspace((s) => s.characters)
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const excluded = useWorkspace((s) => s.castExcluded)
  const storyTree = useWorkspace((s) => s.storyTree) // the folder tree → the multi-level presence bands
  const chapterWrap = useWorkspace((s) => s.ganttLayers.chapters) // shared with the Thread/Arc/Coherence rails
  const povOn = useWorkspace((s) => s.ganttLayers.pov)
  const silentOn = useWorkspace((s) => s.ganttLayers.silent) // include present-but-silent cast (role 'present')
  const [tab, setTab] = useState<Tab>('presence')
  const [appWin, setAppWin] = useState<[number, number] | null>(null) // min/max appearances, as ladder indices (null = whole ladder = everyone)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [edgePair, setEdgePair] = useState<{ a: string; b: string } | null>(null) // clicked graph edge → relationship dialog
  const [hover, setHover] = useState<string | null>(null) // live cell readout (instant; no native-tooltip delay)
  const [page, setPage] = useState(0) // roster pagination (cell-budget page size — see below)

  // sceneId → (entityId → dialogue char-volume). Speakers have >0; present-but-silent cast (role 'present')
  // map to 0 — and are dropped entirely unless the Silent-presence layer is on, so every presence view
  // (heatmap · co-presence · graph · appearance counts) reflects the same "room vs speakers" choice.
  const sceneCast = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const [sid, sc] of Object.entries(graph.scenes)) {
      const members = silentOn ? sc.cast : sc.cast.filter((c) => c.role !== 'present')
      m.set(sid, new Map(members.map((c) => [c.entityId, c.volume ?? 0])))
    }
    return m
  }, [graph, silentOn])
  // sceneId → its POV entity (authored else dominant speaker, from the graph) → ring that character's cell when
  // the POV layer is on.
  const povOf = useMemo(() => {
    if (!povOn) return undefined
    const m = new Map<string, string>()
    for (const [sid, sc] of Object.entries(graph.scenes)) if (sc.pov) m.set(sid, sc.pov)
    return m
  }, [graph, povOn])
  // Magnitude = VOLUME in characters (not scene count) — a character's weight is how much they SAY, so a talkative
  // lead outranks someone merely present in many scenes. Silent-presence contributes 0 (it has no dialogue).
  const appearances = useMemo(() => {
    const m = new Map<string, number>()
    for (const inner of sceneCast.values()) for (const [id, n] of inner) m.set(id, (m.get(id) ?? 0) + n)
    return m
  }, [sceneCast])
  // Roster RANK is by SPEAKING presence only (never gated by the Silent layer), so toggling silent never
  // reshuffles the speaking cast — it only adds hollow cells + appends silent-only characters at the bottom.
  const speakerAppearances = useMemo(() => {
    const m = new Map<string, number>()
    for (const sc of Object.values(graph.scenes))
      for (const c of sc.cast) if ((c.volume ?? 0) > 0) m.set(c.entityId, (m.get(c.entityId) ?? 0) + (c.volume ?? 0))
    return m
  }, [graph])
  // First-appearance position — the earliest scene each character is present in (any role), by reading order.
  // Read from the graph directly (not sceneCast) so it's stable regardless of the Silent layer. Drives the
  // debut-order roster sort (the Thread map's staircase, applied to cast).
  const firstAppearance = useMemo(() => {
    const m = new Map<string, number>()
    for (const sc of Object.values(graph.scenes)) {
      const pos = sc.linearPos ?? Infinity
      for (const c of sc.cast) { const cur = m.get(c.entityId); if (cur == null || pos < cur) m.set(c.entityId, pos) }
    }
    return m
  }, [graph])
  const [sortByDebut, setSortByDebut] = useState(false) // false = by lines spoken (default); true = by first appearance
  const maxApp = useMemo(() => Math.max(1, ...characters.map((c) => appearances.get(c.id) ?? 0)), [characters, appearances])
  // Threshold LADDER — quasi-log integer steps (primes low, ~×1.5 up). A linear 1→max slider is
  // hostage to the protagonist's count: on a 1000-scene work one notch jumps 40 appearances. The
  // ladder keeps the low end fine-grained (where the cast collapses) and the top coarse.
  const ladder = useMemo(() => {
    const top = Math.max(1, maxApp)
    const out = [1, 2, 3, 5, 7, 11, 17]
    let v = 17
    while (v < top) {
      v = Math.max(v + 1, Math.round(v * 1.5))
      out.push(Math.min(v, top)) // final rung is exactly maxApp, so the MAX thumb can still include the protagonist
    }
    return [...new Set(out.filter((x) => x <= top))].sort((a, b) => a - b)
  }, [maxApp])
  // min/max appearances is the SAME windowed RangeSlider as the scene range — the two thumbs set the
  // low/high thresholds, the center band slides the whole window. Both thumbs index the ladder (quasi-log),
  // so the low end stays fine-grained. Default (null) = the full ladder = every character.
  const lastRung = Math.max(0, ladder.length - 1)
  const appLoIdx = appWin ? Math.min(Math.max(0, appWin[0]), lastRung) : 0
  const appHiIdx = appWin ? Math.min(Math.max(appLoIdx, appWin[1]), lastRung) : lastRung
  const minApp = ladder[appLoIdx] ?? 1
  const maxAppSel = ladder[appHiIdx] ?? Math.max(1, maxApp)
  const appAll = appLoIdx === 0 && appHiIdx === lastRung

  const sceneCols = useSceneAxis(scenes)
  const sceneChains = useMemo(() => sceneChainMap(storyTree), [storyTree])
  const ex = useMemo(() => new Set(excluded), [excluded])
  const eligible = useMemo(
    () =>
      [...characters]
        .filter((c) => {
          const a = appearances.get(c.id) ?? 0
          return !ex.has(c.id) && a >= minApp && a <= maxAppSel
        })
        .sort((a, b) =>
          sortByDebut
            ? (firstAppearance.get(a.id) ?? Infinity) - (firstAppearance.get(b.id) ?? Infinity) || a.name.localeCompare(b.name)
            : (speakerAppearances.get(b.id) ?? 0) - (speakerAppearances.get(a.id) ?? 0) || a.name.localeCompare(b.name)
        ),
    [characters, appearances, speakerAppearances, firstAppearance, sortByDebut, minApp, maxAppSel, ex]
  )
  // The scene WINDOW applies to EVERY tab: a big work defaults to a sliding 200-scene window (gantt-scale.md).
  const win = useGanttWindow(sceneCols)
  const winCols = win.cols
  const lo = win.lo
  const hi = win.hi
  const autoWindowed = win.auto

  // Cell-count ceiling as the PAGE SIZE: rows × windowed-scenes stays ≤ MAX_CELLS, and instead of a dead-end cap
  // ("narrow to see the rest") we PAGINATE — a 200-scene window pages 30 characters at a time, a 50-scene one 120.
  const pageSize = Math.max(1, Math.floor(MAX_CELLS / Math.max(1, winCols.length)))
  const scoped = useMemo(() => paginate(eligible, page, pageSize), [eligible, page, pageSize])
  const rows = scoped.shown
  const rangedCast = useMemo(() => {
    const slice = sceneCols.slice(lo, hi + 1)
    return new Map(slice.map((s) => [s.sceneId, sceneCast.get(s.sceneId) ?? new Map<string, number>()]))
  }, [sceneCols, lo, hi, sceneCast])
  const graphChars = useMemo(() => {
    const inRange = new Map<string, number>() // LINES in the visible range → the graph node size
    for (const inner of rangedCast.values()) for (const [id, n] of inner) inRange.set(id, (inRange.get(id) ?? 0) + n)
    return eligible.flatMap((c) => (inRange.has(c.id) ? [{ id: c.id, name: c.name, appearances: inRange.get(c.id) ?? 0 }] : []))
  }, [eligible, rangedCast])

  const openChar = (id: string): void => {
    const c = characters.find((x) => x.id === id)
    if (c) setPreview({ kind: c.kind, path: c.path, title: c.name })
  }

  // Scene range · roster pagination · line window all live in the shared bottom RailScaleBar now, so the top
  // header holds nothing but tabs — the Layers TOC floats top-right at its default spot with nothing to overlap.
  const paged = tab !== 'graph' // the roster paginates on the grid tabs; the graph shows every eligible node

  return (
    <div {...regionAttrs('castPanel')} className="relative flex min-h-0 flex-1 flex-col">
      <RailHeader data-export-hide="1" className="relative">
        <h2 className="mr-1 text-sm font-medium text-foreground">Cast</h2>
        <RailTabs
          tabs={['presence', 'copresence', 'graph'] as const}
          value={tab}
          onChange={setTab}
          renderLabel={(t) => (t === 'copresence' ? 'Co-presence' : t === 'graph' ? 'Relationships' : t)}
        />
        {/* live hover readout — centered across the FULL header (absolute, not the flex remainder after the tabs);
            pointer-events-none so it never blocks the tabs it overlays. */}
        <div className="pointer-events-none absolute inset-x-0 truncate px-3 text-center text-[11px] text-muted-foreground">{hover}</div>
      </RailHeader>

      <div className={cn('min-h-0 flex-1', tab === 'graph' ? 'overflow-hidden' : 'overflow-auto p-4')}>
        {characters.length === 0 ? (
          <EmptyRailState rail="cast" />
        ) : characters.length - ex.size === 0 ? (
          // The common footgun — everyone toggled off in the roster (easy with a 2-person cast). Distinct from
          // "no data": say WHY it's empty and point at the fix, instead of the misleading "run analysis" hint.
          <EmptyHint rail="cast" title="All cast hidden">
            Every name is hidden from the matrices. Click the eye at the top of the roster (left) to show them — or click a name to toggle it back.
          </EmptyHint>
        ) : tab === 'presence' ? (
          <PresenceView
            rows={rows}
            cols={winCols}
            chains={sceneChains}
            sceneCast={sceneCast}
            povOf={povOf}
            showBands={chapterWrap}
            sortByDebut={sortByDebut}
            onToggleSort={() => setSortByDebut((v) => !v)}
            onChar={openChar}
            onScene={(s) => setPreview({ kind: 'scene', path: s.path, title: s.title })}
            onHover={setHover}
          />
        ) : tab === 'copresence' ? (
          <CoPresence rows={rows} sceneCast={rangedCast} onChar={openChar} onHover={setHover} onEdge={(a, b) => setEdgePair({ a, b })} />
        ) : (
          <CharacterGraph chars={graphChars} sceneCast={rangedCast} onChar={openChar} onEdge={(a, b) => setEdgePair({ a, b })} />
        )}
      </div>

      <RailScaleBar
        scene={{
          lo,
          hi,
          full: sceneCols.length,
          auto: autoWindowed,
          onChange: win.setRange,
          onReset: win.range ? () => win.setRange(null) : undefined,
          title: `${sceneCols[lo]?.title ?? '?'} → ${sceneCols[hi]?.title ?? '?'}`
        }}
        page={paged ? { from: scoped.from, to: scoped.to, total: scoped.total, noun: 'characters', page: scoped.page, pageCount: scoped.pageCount, onPage: setPage } : undefined}
        metric={{
          label: 'Volume',
          min: 0,
          max: lastRung,
          value: [appLoIdx, appHiIdx],
          onChange: setAppWin,
          readout: appAll ? 'all' : `${minApp}–${maxAppSel}`,
          onReset: appAll ? undefined : () => setAppWin(null),
          title: "Quasi-log steps — fine at the low end (where the cast collapses), coarse at the top. Edges set the min/max; drag the band's center to slide."
        }}
      />

      {/* Silent presence gates the shared sceneCast so it's offered on every tab; chapter bands + POV rings
          are presence-grid-only (hence the per-tab `layers`). */}
      <RailChrome
        region="castPanel"
        name="Cast"
        layers={tab === 'presence' ? ['chapters', 'pov', 'silent'] : ['silent']}
        export={{
          // HONEST caption — the PNG must say what it filtered out (window + min-appearance), not pose as the full story.
          file: 'cast-rail',
          caption: () =>
            `Cast — ${tab === 'copresence' ? 'co-presence' : tab === 'graph' ? 'relationships' : 'presence'}` +
            (hi - lo + 1 < sceneCols.length ? ` · scenes ${lo + 1}–${hi + 1} of ${sceneCols.length}` : '') +
            (appAll ? '' : ` · lines ${minApp}–${maxAppSel}`)
        }}
        help={CastHelp}
      />

      {preview && <PageReadDialog path={preview.path} kind={preview.kind} title={preview.title} onClose={() => setPreview(null)} />}
      {edgePair && (
        <RelationshipPreviewFloat aId={edgePair.a} bId={edgePair.b} onClose={() => setEdgePair(null)} />
      )}
    </div>
  )
}

// ── Help ────────────────────────────────────────────────────────────────────────
function CastHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Cast — how it works" size="detail">
      <div className="space-y-5">
        <HelpSection title="Tabs">
          <HelpList
            items={[
              <><b className="text-foreground/80">Presence</b> — dialog-volume bars per scene over a character × scene heatmap (shaded by lines spoken).</>,
              <><b className="text-foreground/80">Co-presence</b> — how often two characters share a scene (lower-triangle heatmap).</>,
              <><b className="text-foreground/80">Relationships</b> — the co-presence as a force-directed graph: nodes = characters (sized by appearances), edges = shared scenes. Drag nodes, scroll to zoom; the <b className="text-foreground/80">scene range</b> limits it to a stretch (e.g. one act).</>
            ]}
          />
        </HelpSection>
        <HelpSection title="Reading it">
          <HelpList
            items={[
              <>The <b className="text-foreground/80">wrap bands</b> across the top group the scene columns by the story hierarchy — one row per folder level (book · act · chapter …), read straight from your folder tree. A level only appears when it actually subdivides what you're viewing, so nesting deeper folders (e.g. region → chapter) adds bands automatically. The <b className="text-foreground/80">dialogue-volume bars</b> hanging below are colored by chapter, so you can see each chapter's weight at a glance.</>,
              <>Hover any cell or bar for its value.</>,
              <>Click a <b className="text-foreground/80">row</b> (character) or <b className="text-foreground/80">column</b> (scene) to read it in place.</>,
              <>The <b className="text-foreground/80">lines</b> window trims the cast by how many lines each character speaks — the low thumb hides bit-part / rarely-speaking characters, the high thumb hides the most talkative leads (to focus on the mid-tier), and dragging the band's center slides the whole range. It's the same windowed slider as the scene range.</>,
              <>The <b className="text-foreground/80">sidebar</b> roster picks which characters appear in the matrices — deselect to cut the grid down at scale.</>
            ]}
          />
        </HelpSection>
      </div>
    </Dialog>
  )
}

// ── Presence: dialog-volume bars (1/4) over the character × scene heatmap (3/4) ─
const COL = 'w-5.5 shrink-0'
const GUT = 'sticky left-0 z-10 w-40 shrink-0 bg-canvas' // frozen row-header column
const CORNER = 'sticky left-0 z-30 w-40 shrink-0 bg-canvas' // frozen corner (left + top)

/** shade a cell by value/max on the character accent (transparent when 0). */
const shade = (v: number, max: number): string =>
  v > 0 ? `color-mix(in srgb, var(--character) ${Math.round((v / max) * 80) + 20}%, transparent)` : 'var(--panel-soft)'

/**
 * One character's ROW of heatmap cells — `memo`'d and DELIBERATELY hover-state-free. This is the perf fix: a grid
 * is rows × scenes cells (often 10k+), and the old code re-created every cell on each hover because it read the
 * `hot` crosshair state. Here the cells depend only on stable, memoized props (cast/window), so a hover — which
 * only flips the tiny row/col HEADER emphasis + the readout — never re-renders these cells. The hovered cell's own
 * ring is pure CSS `:hover`; the crosshair readout comes from `onEnter` (a stable callback). Result: hover tracks
 * the cursor with no whole-grid reflow.
 */
const HeatRowCells = memo(function HeatRowCells({
  charId,
  charName,
  cols,
  sceneCast,
  maxLines,
  povOf,
  onEnter
}: {
  charId: string
  charName: string
  cols: SceneFile[]
  sceneCast: Map<string, Map<string, number>>
  maxLines: number
  povOf?: Map<string, string>
  onEnter: (rowId: string, colId: string, text: string) => void
}): JSX.Element {
  return (
    <>
      {cols.map((s) => {
        const inner = sceneCast.get(s.sceneId)
        const present = inner?.has(charId)
        const n = inner?.get(charId) ?? 0
        const silent = present && n === 0 // in the room (prose-read cast) but no dialogue → hollow cell
        return (
          <div
            key={s.sceneId}
            className={cn(COL, 'p-px')}
            // absent cells carry NO hover handler — most of a big grid is empty, and skipping them avoids needless work.
            onMouseEnter={present ? () => onEnter(charId, s.sceneId, silent ? `${charName} · ${s.title} — present, silent` : `${charName} · ${s.title} — ${charsLabel(n)}`) : undefined}
          >
            <div
              className={cn(
                'size-5 rounded-[2px]',
                present && 'hover:ring-1 hover:ring-foreground', // hovered-cell ring: pure CSS, no re-render
                silent && 'ring-1 ring-inset ring-muted-foreground/40'
              )}
              style={{
                backgroundColor: silent ? 'transparent' : shade(present ? Math.max(n, 1) : 0, maxLines),
                ...(povOf?.get(s.sceneId) === charId ? { boxShadow: '0 0 0 1px var(--thread), 0 0 0 2px var(--lore)' } : {})
              }}
            />
          </div>
        )
      })}
    </>
  )
})

function PresenceView({
  rows,
  cols,
  chains,
  sceneCast,
  povOf,
  showBands,
  sortByDebut,
  onToggleSort,
  onChar,
  onScene,
  onHover
}: {
  rows: { id: string; name: string }[]
  cols: SceneFile[]
  chains: Map<string, ChainSeg[]> // sceneId → ancestor-folder chain (drives the stacked bands)
  sceneCast: Map<string, Map<string, number>>
  povOf?: Map<string, string> // sceneId → POV entity; ring that character's cell (POV layer)
  showBands: boolean
  sortByDebut: boolean // roster order: false = most lines, true = first appearance (stacked in the corner cell)
  onToggleSort: () => void
  onChar: (id: string) => void
  onScene: (s: SceneFile) => void
  onHover: (text: string | null) => void
}): JSX.Element {
  const [hot, setHot] = useState<{ row?: string; col?: string }>({})
  const chapterColor = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of cols) if (!m.has(s.chapter)) m.set(s.chapter, CHAPTER_BARS[m.size % CHAPTER_BARS.length])
    return m
  }, [cols])
  // Multi-level wrap bands — ONE row per folder level above the scene, straight from the tree (depth 0 = the
  // top-most folder). A level is shown only when it actually SUBDIVIDES the visible window: a single band
  // spanning everything conveys nothing (e.g. a "chapters" wrapper or a window inside one corpus), so it's
  // dropped. This is the "go above chapter" hierarchy — corpus → region → chapter → … — with no config.
  const levelRows = useMemo(() => {
    const chainOf = cols.map((s) => chains.get(s.sceneId) ?? [])
    const maxDepth = chainOf.reduce((m, c) => Math.max(m, c.length), 0)
    type Band = { name?: string; level?: string; len: number; has: boolean }
    const out: Band[][] = []
    for (let d = 0; d < maxDepth; d++) {
      const row: Band[] = []
      for (let i = 0; i < cols.length; i++) {
        const seg = chainOf[i][d]
        const last = row[row.length - 1]
        if (last && last.name === seg?.name && last.has === !!seg) last.len++
        else row.push({ name: seg?.name, level: seg?.level, len: 1, has: !!seg })
      }
      if (row.length > 1) out.push(row) // >1 band = this level differentiates the window; else a no-op wrapper
    }
    return out
  }, [cols, chains])
  const volume = (sid: string): number => {
    let n = 0
    for (const v of sceneCast.get(sid)?.values() ?? []) n += v
    return n
  }
  // Memoized so a hover re-render doesn't re-scan the whole cast each time (and so HeatRowCells' `maxLines` prop
  // keeps a stable value → its memo holds).
  const maxVolume = useMemo(() => {
    let mx = 1
    for (const s of cols) { let n = 0; for (const v of sceneCast.get(s.sceneId)?.values() ?? []) n += v; if (n > mx) mx = n }
    return mx
  }, [cols, sceneCast])
  const maxLines = useMemo(() => {
    let mx = 1
    for (const inner of sceneCast.values()) for (const v of inner.values()) if (v > mx) mx = v
    return mx
  }, [sceneCast])
  // The one hover write for the cell grid — stable identity so HeatRowCells' memo isn't broken by a new closure.
  const handleEnter = useCallback((rowId: string, colId: string, text: string) => {
    setHot({ row: rowId, col: colId })
    onHover(text)
  }, [onHover])

  if (rows.length === 0) return <Empty />
  return (
    <div
      className="inline-block min-w-full text-[11px]"
      onMouseLeave={() => {
        setHot({})
        onHover(null)
      }}
    >
      {/* Stacked wrap-layers — one labeled band row per folder level above the scene, auto-derived from the
          tree (corpus → region → chapter → …). Empty cells (a scene nested shallower than this level) render blank. */}
      {showBands &&
        levelRows.map((row, ri) => (
          <div key={ri} className="flex">
            <div className={CORNER} />
            {row.map((b, i) =>
              b.has ? (
                <div key={i} style={{ width: b.len * 22 }} className="px-px">
                  <div
                    className="flex h-5 items-center justify-center truncate rounded-sm px-1 text-[10px] text-muted-foreground"
                    style={{ backgroundColor: bandBg(b.level) }}
                    title={b.level ? `${cleanChapterName(b.name ?? '')} · ${b.level}` : b.name}
                  >
                    {cleanChapterName(b.name ?? '')}
                  </div>
                </div>
              ) : (
                <div key={i} style={{ width: b.len * 22 }} className="px-px" />
              )
            )}
          </div>
        ))}

      {/* frozen header — scene labels (sticky to the top on scroll) */}
      <div className="sticky top-0 z-20 flex bg-canvas">
        {/* corner controls, stacked: roster sort toggle above the loadout (Auto) selector. */}
        <div className={cn(CORNER, 'flex flex-col items-start justify-end gap-1 pb-0.5')}>
          <button
            onClick={onToggleSort}
            title={sortByDebut ? 'Sorted by first appearance — click to sort by lines spoken' : 'Sorted by lines spoken — click to sort by first appearance'}
            className="flex items-center gap-1 text-[10px] text-faint transition-colors hover:text-foreground"
          >
            {sortByDebut ? <Clock className="size-3" /> : <ArrowDownWideNarrow className="size-3" />}
            {sortByDebut ? 'First seen' : 'Most lines'}
          </button>
          <SequenceSelect />
        </div>
        {cols.map((s) => (
          <button
            key={s.sceneId}
            onClick={() => onScene(s)}
            className={cn(COL, 'h-24 [writing-mode:vertical-rl] rotate-180 truncate pt-1 text-left hover:text-foreground', hot.col === s.sceneId ? 'text-foreground' : 'text-faint')}
          >
            {s.title}
          </button>
        ))}
      </div>

      {/* heatmap — shaded by lines spoken */}
      {rows.map((c) => (
        <div key={c.id} className="flex items-center">
          <button onClick={() => onChar(c.id)} className={cn(GUT, GANTT_ROW_TITLE, 'pr-2 text-right hover:text-foreground', hot.row === c.id && 'text-foreground')}>
            {c.name}
          </button>
          {/* Speaker cells → filled by char volume; silent (present, 0 volume) → hollow outline; POV → purple→yellow
              ring. Extracted + memoized (HeatRowCells) so the crosshair hover never re-renders the whole grid. */}
          <HeatRowCells charId={c.id} charName={c.name} cols={cols} sceneCast={sceneCast} maxLines={maxLines} povOf={povOf} onEnter={handleEnter} />
        </div>
      ))}

      {/* dialog-volume bars — bottom, inverted (hang down), colored by chapter. h-12 matches LifecycleGantt's
          scene-counter bar so every rail's per-scene histogram is the SAME height. */}
      <div className="flex">
        <div className={cn(GUT, 'h-12')} />
        {cols.map((s) => {
          const vol = volume(s.sceneId)
          return (
            <div
              key={s.sceneId}
              className={cn(COL, 'flex h-12 items-start px-px')}
              onMouseEnter={() => {
                setHot({ col: s.sceneId })
                onHover(`${s.title} — ${charsLabel(vol)}`) // compact ("11.3k chars"), not raw 11304 dialogue lines
              }}
            >
              <div
                className={cn('w-full rounded-b-sm', chapterColor.get(s.chapter) ?? 'bg-thread', hot.col && hot.col !== s.sceneId && 'opacity-60')}
                style={{ height: `${(vol / maxVolume) * 100}%` }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Co-presence heatmap (lower triangle) ──────────────────────────────────────
function CoPresence({
  rows,
  sceneCast,
  onChar,
  onHover,
  onEdge
}: {
  rows: { id: string; name: string }[]
  sceneCast: Map<string, Map<string, number>>
  onChar: (id: string) => void
  onHover: (text: string | null) => void
  /** Click a co-presence cell (row-char × col-char) → the pair's RelationshipDialog (same as a graph edge). */
  onEdge?: (a: string, b: string) => void
}): JSX.Element {
  // Pair weight = combined VOLUME (characters) the two speak in scenes they SHARE (sum of both their per-scene
  // char-volume, accumulated), NOT the raw count of shared scenes and NOT a ratio — an intense back-and-forth
  // outweighs standing silently in the same room.
  const { shared, max } = useMemo(() => {
    const shared = new Map<string, number>()
    let max = 0
    for (const inner of sceneCast.values()) {
      const ids = [...inner.keys()]
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`
          const n = (shared.get(key) ?? 0) + (inner.get(ids[i]) ?? 0) + (inner.get(ids[j]) ?? 0)
          shared.set(key, n)
          if (n > max) max = n
        }
    }
    return { shared, max }
  }, [sceneCast])

  if (rows.length < 2) return <Empty />
  const count = (a: string, b: string): number => shared.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0

  return (
    <div className="inline-block text-[11px]" onMouseLeave={() => onHover(null)}>
      {rows.map((r, i) => (
        <div key={r.id} className="flex items-center">
          <button onClick={() => onChar(r.id)} className={cn(GUT, GANTT_ROW_TITLE, 'pr-2 text-right hover:text-foreground')}>
            {r.name}
          </button>
          {rows.map((cc, j) => {
            if (j >= i) return <div key={cc.id} className={cn(COL, 'p-px')} />
            const n = count(r.id, cc.id)
            const clickable = n > 0 && !!onEdge // a pair that never shares a scene has no relationship to open
            return (
              <div
                key={cc.id}
                className={cn(COL, 'p-px')}
                onMouseEnter={() => onHover(`${r.name} + ${cc.name} — ${charsLabel(n, true)}${clickable ? ' · click for the relationship' : ''}`)}
              >
                <div
                  role={clickable ? 'button' : undefined}
                  onClick={clickable ? () => onEdge!(r.id, cc.id) : undefined}
                  className={cn('size-5 rounded-[2px]', clickable && 'cursor-pointer ring-inset ring-thread/60 hover:ring-2')}
                  style={{ backgroundColor: shade(n, max) }}
                />
              </div>
            )
          })}
        </div>
      ))}
      <div className="flex">
        <div className={GUT} />
        {rows.map((cc) => (
          <button
            key={cc.id}
            onClick={() => onChar(cc.id)}
            title={cc.name}
            className={cn(COL, 'h-24 [writing-mode:vertical-rl] rotate-180 truncate pt-1 text-left text-faint hover:text-foreground')}
          >
            {cc.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function Empty(): JSX.Element {
  return (
    <EmptyHint rail="cast" title="No speaking presence yet">
      Presence is read from scene dialogue — no speaking cast was found in the visible scene range.
    </EmptyHint>
  )
}
