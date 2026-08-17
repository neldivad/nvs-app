/**
 * RelationshipPanel — the Relationships rail (internal/relationship-rail.md). A fighting-game matchup:
 * two rosters (pick A in the left sidebar, B in this pane) frame a DUO HEADER (the two portraits — click either
 * to open its character page — with the ⚔ + the oldest/latest sort toggle stacked between them) over the
 * unified layer-driven scene spine (RelationshipSpine). The spine shares THIS pane's scroll (no inner overflow).
 * Layers ride the shared GanttLayer float (RailChrome), standardized with the Cast rail.
 *
 * Rosters are RANKED, not alphabetical: the left by total appearances (leads float up); the right by
 * co-occurrence with the picked left fighter (their most-shared partners rise, tinted + counted).
 */
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { Loader2, Swords, ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react'
import { regionAttrs } from '@/config/regions'
import { useWorkspace } from '@/stores/workspace'
import { EmptyHint, EmptyRailState } from '@/components/ui/EmptyRailState'
import { cn, compactNumber } from '@/lib/utils'
import { SidebarHeader } from '@/components/layout/SidebarKit'
import type { SearchResult } from '@/components/ui/SearchPopover'
import { useSceneAxis as useOrderedScenes, useCanvasSubset } from '@/lib/timeline/sceneAxis'
import { castRanking } from '@/lib/analysis/castRanking'
import { ironyTracks } from '@/lib/analysis/custodyIrony'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { Dialog } from '@/components/ui/dialog'
import { HelpSection, HelpList } from '@/components/ui/help'
import { RailChrome } from '@/components/layout/RailChrome'
import { RailScaleBar } from '@/components/layout/RailScaleBar'
import { SequenceSelect } from '@/components/layout/SequenceSelect'
import { RelationshipSpine, type IronySceneSides, type SceneAxisCol } from '@/components/features/relationships/RelationshipSpine'
import { useTranslation, Trans } from 'react-i18next'
import type { CustodyTopic, RelationshipEvidence, WorldPage } from '@shared/ipc'

/**
 * Roster ranking from the timeline graph — shared by the pane (right roster) and the sidebar (left roster).
 *  • appearances: id → # LINES spoken → the "importance" sort.
 *  • coWith(id):  id → # LINES spoken together with `id` → the partner sort + gradient for the opposite roster.
 *
 * The base derivation (castByScene + appearances) is O(scenes × cast) and both the panel AND the sidebar need
 * it, so it's memoized ONCE on the graph reference (module `WeakMap`) — the two consumers share one computed
 * object instead of each building (and holding) their own copy every render.
 */
// Magnitude everywhere here is LINES spoken (not scene count): `appearances` sums each character's lines,
// and `coWith` sums the lines a pair speak TOGETHER — so the roster + partner ranking weight talk, not presence.
// The pure ranking (subset-scoped) lives in lib/castRanking; this hook just wires it to the store + active variant.
export function useCastRanking(): { appearances: Map<string, number>; coWith: (id: string | null) => Map<string, number> } {
  const graph = useWorkspace((s) => s.timelineGraph)
  const subset = useCanvasSubset()
  const { castByScene, appearances } = useMemo(() => castRanking(graph.scenes, subset), [graph, subset])
  const coWith = useCallback(
    (id: string | null): Map<string, number> => {
      const m = new Map<string, number>()
      if (!id) return m
      for (const cast of castByScene) {
        const self = cast.find((c) => c.id === id)
        if (!self) continue
        for (const o of cast) if (o.id !== id) m.set(o.id, (m.get(o.id) ?? 0) + self.volume + o.volume)
      }
      return m
    },
    [castByScene]
  )
  return { appearances, coWith }
}

/** Sort a roster by a metric map (desc), name as tiebreak. */
export function rankChars(chars: WorldPage[], metric: Map<string, number>): WorldPage[] {
  return [...chars].sort((a, b) => (metric.get(b.id) ?? 0) - (metric.get(a.id) ?? 0) || a.name.localeCompare(b.name))
}

/** Every scene in reading order carrying the pair's per-character dialogue volume + path — the rail spine's
 *  input. Shared by the pane AND the castRail float (which slices a preview of the same spine). */
export function useSceneAxis(aId: string | null | undefined, bId: string | null | undefined): SceneAxisCol[] {
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  // Reuse the shared axis — subset-scoped to the active variant's canvas AND ordered by its graph/saved route —
  // so the relationship spine spans the SAME scenes as every other rail (not the whole universe).
  const axis = useOrderedScenes(scenes)
  return useMemo(() => {
    if (!aId || !bId) return []
    return axis.map((s) => {
      const cast = graph.scenes[s.sceneId]?.cast ?? []
      const la = cast.find((c) => c.entityId === aId)?.volume ?? 0
      const lb = cast.find((c) => c.entityId === bId)?.volume ?? 0
      return { sceneId: s.sceneId, title: s.title, chapter: s.chapter, path: s.path, la, lb }
    })
  }, [axis, graph, aId, bId])
}

export function RelationshipPanel(): JSX.Element {
  const { t } = useTranslation('relationships')
  const characters = useWorkspace((s) => s.characters)
  const aId = useWorkspace((s) => s.relA)
  const bId = useWorkspace((s) => s.relB)
  const setRelA = useWorkspace((s) => s.setRelA)
  const setRelB = useWorkspace((s) => s.setRelB)
  const [ev, setEv] = useState<RelationshipEvidence | null>(null)
  const [loading, setLoading] = useState(false)
  const [latest, setLatest] = useState(false) // oldest→newest by default; the ⚔-aligned toggle flips it
  const [range, setRange] = useState<[number, number] | null>(null) // scene-range window over the pair's shared axis (pinned bottom bar)
  const [charPreview, setCharPreview] = useState<WorldPage | null>(null)
  const { appearances, coWith } = useCastRanking()

  const openChar = useCallback((id: string | null) => setCharPreview(characters.find((c) => c.id === id) ?? null), [characters])

  useEffect(() => {
    if (aId || !characters.length) return
    const ranked = rankChars(characters, appearances)
    const first = ranked[0]
    if (!first) return
    setRelA(first.id)
    const partner = rankChars(characters.filter((c) => c.id !== first.id), coWith(first.id))[0]
    if (partner) setRelB(partner.id)
  }, [characters, appearances, coWith, aId, setRelA, setRelB])

  const aChar = useMemo(() => characters.find((c) => c.id === aId), [characters, aId])
  const bChar = useMemo(() => characters.find((c) => c.id === bId), [characters, bId])

  // Both ids must RESOLVE to live character pages — a stale saved id would otherwise render a "?" header
  // and a nameless "X and  never share a scene" message.
  const valid = !!aChar && !!bChar && aId !== bId
  useEffect(() => {
    if (!valid) {
      setEv(null)
      return
    }
    let dead = false
    setLoading(true)
    void window.nvs.relationshipEvidence(aId!, bId!).then((r) => {
      if (!dead) {
        setEv(r)
        setLoading(false)
      }
    })
    return () => {
      dead = true
    }
  }, [aId, bId, valid])

  const rightMetric = useMemo(() => (aId ? coWith(aId) : appearances), [aId, coWith, appearances])
  const rightChars = useMemo(() => rankChars(characters, rightMetric), [characters, rightMetric])
  // Full right roster always shown; search jumps to a "Target" (picks it as relB, same as clicking the row).
  const targetResults = (query: string): SearchResult[] => {
    const s = query.trim().toLowerCase()
    if (!s) return []
    return rightChars.filter((c) => c.name.toLowerCase().includes(s)).map((c) => ({ id: c.id, label: c.name, meta: compactNumber(rightMetric.get(c.id) ?? 0) }))
  }

  const sceneAxis = useSceneAxis(valid ? aId : null, valid ? bId : null)

  // Lens D — the irony layer's data (relationship-rail.md §D): authored custody topics projected onto
  // this pair. Off by default; computed only while the layer is on (the rail is crowded — summoned, not ambient).
  const ironyOn = useWorkspace((s) => s.ganttLayers.irony)
  const custodyTick = useWorkspace((s) => s.custodyTick)
  const worldPages = useWorkspace((s) => s.worldPages)
  const [topics, setTopics] = useState<CustodyTopic[]>([])
  useEffect(() => {
    if (!ironyOn) return
    void (window.nvs.listCustodyTopics?.() ?? Promise.resolve([])).then(setTopics)
  }, [ironyOn, custodyTick])
  const irony = useMemo(() => {
    if (!ironyOn || !valid || !sceneAxis.length || !topics.length) return undefined
    const byId = new Map(worldPages.map((p) => [p.id.toLowerCase(), p.name.toLowerCase()]))
    const matches = (w: string, id: string): boolean => {
      const lc = w.toLowerCase()
      return lc === id.toLowerCase() || lc === byId.get(id.toLowerCase())
    }
    const colOf = new Map(sceneAxis.map((c, i) => [c.sceneId, i]))
    const tracks = ironyTracks(topics, colOf, sceneAxis.length - 1, aId!, bId!, matches)
    const m = new Map<string, IronySceneSides>()
    const paint = (win: { from: number; to: number } | null, side: 'a' | 'b', tone: 'irony' | 'arb', t: { name: string; path: string }): void => {
      if (!win) return
      for (let i = win.from; i <= win.to && i < sceneAxis.length; i++) {
        const id = sceneAxis[i].sceneId
        const e = m.get(id) ?? { a: { irony: [], arb: [] }, b: { irony: [], arb: [] } }
        e[side][tone].push({ label: t.name, path: t.path })
        m.set(id, e)
      }
    }
    for (const t of tracks) {
      paint(t.ironyA, 'a', 'irony', t)
      paint(t.ironyB, 'b', 'irony', t)
      paint(t.arbA, 'a', 'arb', t)
      paint(t.arbB, 'b', 'arb', t)
    }
    return m.size ? m : undefined
  }, [ironyOn, valid, sceneAxis, topics, worldPages, aId, bId])

  return (
    <div className="flex min-h-0 flex-1">
      {/* The region is the PANE column only (not the roster) — the export util captures the region's tallest
          scroll container, and a wrapper spanning the roster would make it shoot the roster instead. */}
      <div {...regionAttrs('relationshipsPanel')} className="relative flex min-h-0 flex-1 flex-col">
        <DuoHeader aChar={aChar} bChar={bChar} openChar={openChar} latest={latest} setLatest={setLatest} />

        <div className="min-h-0 flex-1 select-text overflow-auto p-5">
          {characters.length < 2 ? (
            <EmptyRailState rail="relationships" action={<p className="text-[11px] text-faint"><Trans t={t} i18nKey="panel.addTwo" components={{ path: <span className="font-mono" /> }} /></p>} />
          ) : !valid ? (
            <EmptyRailState rail="relationships" />
          ) : !ev || loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
          ) : ev.events.length === 0 && ev.coScenes.length === 0 ? (
            <EmptyHint rail="relationships" title={t('panel.noSharedScenes.title')}>
              {t('panel.noSharedScenes.body', { a: aChar?.name, b: bChar?.name })}
            </EmptyHint>
          ) : (
            <RelationshipSpine ev={ev} sceneAxis={sceneAxis} latest={latest} range={range} irony={irony} />
          )}
        </div>

        {/* Pinned bottom bar (outside the scroll, always visible): the route picker + the scene-range zoom over the
            pair's shared axis. Only the Scene zone applies — one pair, so no pagination / per-row metric. */}
        {valid && ev && !loading && (
          <RailScaleBar
            left={
              <>
                <SequenceSelect variant="inline" />
                <span className="h-4 w-px shrink-0 bg-border" />
              </>
            }
            scene={{
              lo: range ? Math.min(range[0], Math.max(0, sceneAxis.length - 1)) : 0,
              hi: range ? Math.min(range[1], Math.max(0, sceneAxis.length - 1)) : Math.max(0, sceneAxis.length - 1),
              full: sceneAxis.length,
              onChange: setRange,
              onReset: range ? () => setRange(null) : undefined,
              title: `${sceneAxis[range ? Math.min(range[0], sceneAxis.length - 1) : 0]?.title ?? '?'} → ${sceneAxis[range ? Math.min(range[1], sceneAxis.length - 1) : sceneAxis.length - 1]?.title ?? '?'}`
            }}
          />
        )}

        {/* Shared rail chrome — the standardized Layers float (Presence · Chapters · Warmth · Events · Irony) + export. */}
        <RailChrome
          region="relationshipsPanel"
          name="Relationships"
          layers={['presence', 'mutual', 'empty', 'chapters', 'warmth', 'events', 'irony']}
          layersClassName="right-3 top-28"
          export={{ file: 'relationship-rail', caption: () => `${aChar?.name ?? '?'} ↔ ${bChar?.name ?? '?'}` }}
          help={RelationshipHelp}
        />
      </div>

      {/* Right roster ("Target"). Width = 28.2% of the pane so it matches the left sidebar's 22%-of-group
          default (22/78) — the two rosters read as a symmetric pair framing the arena. */}
      <div className="flex w-[28.2%] shrink-0 flex-col border-l border-border bg-panel">
        <SidebarHeader title={t('panel.target')} search={{ results: targetResults, onSelect: setRelB, placeholder: t('panel.searchCharacters') }} />
        <div className="min-h-0 flex-1">
          <Roster chars={rightChars} selected={bId} disabled={aId} onPick={setRelB} metric={rightMetric} />
        </div>
      </div>

      {charPreview && <PageReadDialog path={charPreview.path} kind={charPreview.kind} title={charPreview.name} onClose={() => setCharPreview(null)} />}
    </div>
  )
}

/** "How it works" — the rail's help dialog, injected into RailChrome (same shell + primitives as every other
 *  rail's help). Content mirrors the matchup model in this file's header. */
function RelationshipHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('relationships')
  return (
    <Dialog open={open} onClose={onClose} title={t('help.title')} size="detail">
      <div className="space-y-5">
        <HelpSection title={t('help.matchup.title')}>
          <HelpList items={t('help.matchup.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.layers.title')}>
          <HelpList items={t('help.layers.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.reading.title')}>
          <HelpList items={t('help.reading.items', { returnObjects: true }) as string[]} />
        </HelpSection>
      </div>
    </Dialog>
  )
}

/** The duo header: the two portraits (click → open the character page) with ⚔ + the sort toggle stacked
 *  between them for symmetry. The declared bond isn't shown inline — it lives on the character page. */
function DuoHeader({
  aChar,
  bChar,
  openChar,
  latest,
  setLatest
}: {
  aChar: WorldPage | undefined
  bChar: WorldPage | undefined
  openChar: (id: string | null) => void
  latest: boolean
  setLatest: (v: boolean) => void
}): JSX.Element {
  const { t } = useTranslation('relationships')
  // Equal flex-1 sides keep the ⚔ cluster dead-CENTER regardless of name length; each name grows OUTWARD from the
  // center and truncates within its half — so the icons never shift when the pair changes.
  return (
    <div data-part="rel-header" className="flex h-24 shrink-0 items-center gap-6 border-b border-border px-4">
      <div className="flex min-w-0 flex-1 justify-end"><Portrait char={aChar} align="right" onOpen={() => openChar(aChar?.id ?? null)} /></div>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <Swords className="size-5 text-character" />
        <button
          onClick={() => setLatest(!latest)}
          title={latest ? t('panel.newestFirst') : t('panel.oldestFirst')}
          className="text-muted-foreground hover:text-foreground"
        >
          {latest ? <ArrowUpWideNarrow className="size-4" /> : <ArrowDownWideNarrow className="size-4" />}
        </button>
      </div>
      <div className="flex min-w-0 flex-1 justify-start"><Portrait char={bChar} align="left" onOpen={() => openChar(bChar?.id ?? null)} /></div>
    </div>
  )
}

/**
 * One side's character list (fills its container). `disabled` = the id picked on the OTHER side. `metric`
 * (id → count) drives the rank tint + trailing count; the selected row KEEPS its tint and gains a glow.
 * Both sides render identically. Exported so the RelationshipSidebar reuses it.
 */
export function Roster({
  chars,
  selected,
  disabled,
  onPick,
  metric
}: {
  chars: WorldPage[]
  selected: string | null
  disabled: string | null
  onPick: (id: string) => void
  metric?: Map<string, number>
}): JSX.Element {
  const maxMetric = useMemo(() => (metric ? Math.max(1, ...chars.map((c) => metric.get(c.id) ?? 0)) : 1), [metric, chars])
  return (
    <nav data-part="roster" data-comp="Roster" className="flex h-full flex-col overflow-y-auto bg-panel py-1">
      {chars.map((c) => {
        const on = c.id === selected
        const off = c.id === disabled
        const n = metric?.get(c.id) ?? 0
        const heat = metric && n > 0 ? n / maxMetric : 0
        return (
          <button
            key={c.id}
            disabled={off}
            onClick={() => onPick(c.id)}
            style={heat > 0 ? { background: `color-mix(in srgb, var(--character) ${Math.round(heat * 22)}%, transparent)` } : undefined}
            className={cn(
              // matches the CastSidebar row geometry (rounded · px-2 py-1 · text-xs · muted default); the selected
              // state keeps a ring+glow rather than bg-panel-soft because the row already carries a heat tint.
              'relative flex items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors',
              on ? 'text-foreground ring-1 ring-inset ring-character shadow-[0_0_10px_-3px_var(--character)]' : 'text-muted-foreground hover:bg-panel-soft',
              off && 'cursor-default opacity-40 hover:bg-transparent'
            )}
          >
            <Avatar char={c} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            {metric && n > 0 && <span className="shrink-0 tabular-nums text-[10px] text-faint" title={n.toLocaleString()}>{compactNumber(n)}</span>}
          </button>
        )
      })}
    </nav>
  )
}

function Portrait({ char, align, onOpen }: { char: WorldPage | undefined; align: 'left' | 'right'; onOpen: () => void }): JSX.Element {
  const { t } = useTranslation('relationships')
  return (
    <button
      onClick={onOpen}
      disabled={!char}
      className={cn('group flex min-w-0 max-w-full items-center gap-3 rounded-md px-1 py-0.5 hover:bg-panel-soft/60', align === 'right' ? 'flex-row-reverse text-right' : '')}
      title={char ? t('panel.openChar', { name: char.name }) : undefined}
    >
      <Avatar char={char} big />
      <span className="min-w-0 truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">{char?.name ?? '—'}</span>
    </button>
  )
}

/** Portrait/thumb from the character's WorldPage avatar; initials fallback. */
function Avatar({ char, big }: { char: WorldPage | undefined; big?: boolean }): JSX.Element {
  const cls = big ? 'size-14' : 'size-5'
  if (char?.avatar) {
    return <img src={`nvs-asset://${char.avatar}`} alt="" className={cn(cls, 'shrink-0 rounded-md object-cover')} draggable={false} />
  }
  const initials = (char?.name ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return <span className={cn(cls, 'flex shrink-0 items-center justify-center rounded-md bg-panel-soft text-[11px] font-medium text-muted-foreground')}>{initials}</span>
}
