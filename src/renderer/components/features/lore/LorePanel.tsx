/**
 * Lore pivot — the REVELATION TIMELINE. Every analysis run banks world-truth disclosures (`lore_updates`)
 * and in-story time markers (`plot_times`); this surfaces them as the *shape of what the reader learns*.
 * Rows = topics (sorted by first reveal → a diagonal staircase), columns = scenes. Each disclosure is a marker
 * SHAPED by its role so a row reads as revelation PACING left-to-right: DEBUT (soft shade, first reveal),
 * SUPPORT (solid dot, later reveal), PARADOX (red diamond, contradiction), joined by a faint connector whose
 * length = the fact's span (long = woven across acts, short = dumped). Rows drop to a click-through progression
 * dialog; the governance decision layer surfaces facts that recur with no authored `world/lore` page.
 * The prose ledger drops to a click-through dialog. Governance is the decision layer: a topic with no
 * authored `world/lore` page is "canon by accident" — the dialog offers to FORMALIZE it into a page,
 * seeded with what the story already committed to.
 */
import { useMemo, useState, type JSX, type ReactNode } from 'react'
import { AlertTriangle, BookMarked, ExternalLink, FilePlus2, Loader2, Sparkles, Rows3, Users } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { buildChapterIndex } from '@/lib/analysis/chapterIndex'
import { DetailSplitView, type FeedEvent, type FeedChapter, type DetailEndpoint } from '@/components/layout/DetailSplitView'
import { AppearanceHeatStrip, type HeatCell } from '@/components/layout/AppearanceHeatStrip'
import { EmptyRailState, SidebarEmpty } from '@/components/ui/EmptyRailState'
import { cn, sidebarRow } from '@/lib/utils'
import { useSceneAxis } from '@/lib/timeline/sceneAxis'
import { useGanttWindow, scopeRows } from '@/lib/timeline/ganttWindow'
import { RailScaleBar } from '@/components/layout/RailScaleBar'
import { RosterSection } from '@/components/layout/SidebarKit'
import { LifecycleGantt, deriveWrapLevels, sceneVolumes, GANTT_ROW_TITLE, type GanttRow } from '@/components/features/custody/LifecycleGantt'
import { RailChrome } from '@/components/layout/RailChrome'
import { FloatWindow, type Box } from '@/components/layout/FloatWindow'
import { RailHeader } from '@/components/ui/RailHeader'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm'
import { HelpSection, HelpTable, HelpList } from '@/components/ui/help'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { regionAttrs } from '@/config/regions'
import { defaultFrontmatter, slugify } from '@/config/worldSchema'
import { loreTopicPrompt, loreDraftPageInstruction } from '@shared/config/chatPrompts'
import { AiGate } from '@/config/aiFeatures'
import type { LoreTopic } from '@shared/ipc'

const nn = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
type Gate = 'all' | 'retcon' | 'unauthored' | 'governed'

export function LorePanel(): JSX.Element {
  const view = useWorkspace((s) => s.loreView)
  const worldPages = useWorkspace((s) => s.worldPages)
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const chapterWrap = useWorkspace((s) => s.ganttLayers.chapters)
  const selectedId = useWorkspace((s) => s.selectedLoreId)
  const select = useWorkspace((s) => s.setSelectedLore)
  const [gate, setGate] = useState<Gate>('all')
  const [preview, setPreview] = useState<{ path: string; title: string } | null>(null)

  // topic → authored lore page (id, else normalized-name) — the governance resolution.
  const pageOf = useMemo(() => {
    const lore = worldPages.filter((p) => p.kind === 'lore')
    const byId = new Map(lore.map((p) => [p.id, p]))
    const byName = new Map(lore.map((p) => [nn(p.name), p]))
    return (t: LoreTopic) => byId.get(t.loreId) ?? byName.get(nn(t.label)) ?? null
  }, [worldPages])

  const [page, setPage] = useState(0)
  const [disWin, setDisWin] = useState<[number, number] | null>(null) // trim rows by disclosure count (focus the woven facts)
  const sceneCols = useSceneAxis(scenes)
  const win = useGanttWindow(sceneCols) // gantt scale: window the axis + paginate rows (see gantt-scale.md)
  const cols = win.cols
  const colOf = win.colOf
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])
  const wraps = useMemo(() => (chapterWrap ? deriveWrapLevels(storyTree, colOf) : undefined), [chapterWrap, storyTree, colOf])
  const counts = useMemo(() => sceneVolumes(graph), [graph])

  const counts3 = useMemo(() => {
    const topics = view?.topics ?? []
    return {
      retcon: topics.filter((t) => t.hasRetcon).length,
      unauthored: topics.filter((t) => !pageOf(t)).length,
      governed: topics.filter((t) => pageOf(t)).length
    }
  }, [view, pageOf])

  // Topics after the GATE filter, sorted by first-plant position (reading order → the pacing staircase).
  const sortedTopics = useMemo(
    () =>
      (view?.topics ?? [])
        .filter((t) => {
          if (gate === 'retcon') return t.hasRetcon
          if (gate === 'unauthored') return !pageOf(t)
          if (gate === 'governed') return !!pageOf(t)
          return true
        })
        .slice()
        .sort((a, b) => (a.disclosures[0]?.pos ?? 1e9) - (b.disclosures[0]?.pos ?? 1e9)),
    [view, gate, pageOf]
  )
  // Disclosure-count WINDOW — trim rows by how many times a fact is revealed (drag the low thumb up to hide
  // one-off mentions and focus the woven facts; the same windowed slider the Cast/Thread/Coherence rails use).
  const maxDis = useMemo(() => Math.max(1, ...sortedTopics.map((t) => t.disclosures.length)), [sortedTopics])
  const loDis = disWin ? Math.min(Math.max(1, disWin[0]), maxDis) : 1
  const hiDis = disWin ? Math.min(Math.max(loDis, disWin[1]), maxDis) : maxDis
  const disAll = loDis === 1 && hiDis === maxDis
  const windowed = useMemo(() => sortedTopics.filter((t) => t.disclosures.length >= loDis && t.disclosures.length <= hiDis), [sortedTopics, loDis, hiDis])
  // Gantt scale: window-relevance (a fact revealed only off-window/un-placed drops off) + pagination in one call.
  const scoped = useMemo(() => scopeRows(windowed, (t) => t.disclosures.map((d) => d.sceneId), colOf, page), [windowed, colOf, page])

  const rows = useMemo<GanttRow[]>(() => {
    return scoped.shown.map((t) => {
      const governed = !!pageOf(t)
      return {
        key: t.loreId,
        highlighted: selectedId === t.loreId,
        gutter: (
          <button
            onClick={() => select(selectedId === t.loreId ? null : t.loreId)}
            className="flex h-full w-full items-center gap-1.5 border-l-2 border-transparent pr-2 pl-1.5 text-left"
            title={governed ? `${t.label} — has a lore page` : `${t.label} — canon by accident (no page)`}
          >
            {t.hasRetcon && <AlertTriangle className="size-3 shrink-0 text-flag" />}
            <span className={cn(GANTT_ROW_TITLE, 'min-w-0 flex-1 capitalize')}>{t.label}</span>
            {!governed && <span className="size-1.5 shrink-0 rounded-full border border-lore/60" title="unauthored" />}
          </button>
        ),
        renderLane: ({ colW, colOf: co }) => {
          // Marker shape = the fact's revelation ROLE, so a row reads as pacing at a glance: DEBUT (soft
          // shaded, its first reveal), SUPPORT (a solid dot, a later reveal), PARADOX (a red diamond,
          // a contradiction). A faint connector spans first→last reveal — long = woven, short = dumped.
          const xs = t.disclosures.map((d) => co.get(d.sceneId)).filter((c): c is number => c != null)
          const nodes: (JSX.Element | null)[] = []
          if (xs.length > 1) {
            const lo = Math.min(...xs)
            const hi = Math.max(...xs)
            nodes.push(<span key="span" className="absolute top-1/2 h-px -translate-y-1/2 bg-lore/25" style={{ left: lo * colW + colW / 2, width: (hi - lo) * colW }} />)
          }
          t.disclosures.forEach((d, i) => {
            const ci = co.get(d.sceneId)
            if (ci == null) return
            const paradox = d.magnitude === 'retcon'
            const debut = i === 0
            const role = paradox ? 'paradox' : debut ? 'debut' : 'support'
            nodes.push(
              <button
                key={i}
                onClick={() => select(t.loreId)}
                title={`${role} · ${d.title}: ${d.summary.slice(0, 80)}`}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: ci * colW + colW / 2 }}
              >
                {paradox ? (
                  <span className="block size-2 rotate-45 rounded-[1px] bg-flag ring-1 ring-flag/50" />
                ) : debut ? (
                  <span className="block size-2.5 rounded-full bg-lore/35 ring-1 ring-lore/60" />
                ) : (
                  <span className="block size-1.5 rounded-full bg-lore" />
                )}
              </button>
            )
          })
          return nodes
        }
      }
    })
  }, [scoped, selectedId, select, pageOf])

  if (view == null)
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )


  return (
    <div {...regionAttrs('lorePanel')} className="relative flex min-h-0 flex-1 flex-col">
      {/* Filters — narrow to the decision at hand (contradictions, facts with/without a written page). */}
      <RailHeader className="overflow-x-auto">
        <GateChip on={gate === 'all'} onClick={() => setGate('all')}>All · {view.topics.length}</GateChip>
        {counts3.retcon > 0 && (
          <GateChip on={gate === 'retcon'} onClick={() => setGate('retcon')} tone="text-flag">
            <AlertTriangle className="size-3" /> Paradox · {counts3.retcon}
          </GateChip>
        )}
        <GateChip on={gate === 'unauthored'} onClick={() => setGate('unauthored')} tone="text-lore" title="Facts with no written lore page yet — canon by accident">No page · {counts3.unauthored}</GateChip>
        <GateChip on={gate === 'governed'} onClick={() => setGate('governed')} title="Facts you’ve written a lore page for">Has page · {counts3.governed}</GateChip>
        <div className="flex-1" />
      </RailHeader>

      <LifecycleGantt
        cols={cols.map((s) => ({ id: s.sceneId, title: s.title }))}
        wraps={wraps}
        counts={counts}
        rows={rows}
        onColClick={(c) => {
          const sc = sceneById.get(c.id)
          if (sc) setPreview({ path: sc.path, title: sc.title })
        }}
        empty={gate === 'all' ? <EmptyRailState rail="lore" /> : 'No topics in this filter.'}
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
        page={{ from: scoped.from, to: scoped.to, total: scoped.total, noun: 'topics', page: scoped.page, pageCount: scoped.pageCount, onPage: setPage }}
        metric={{
          label: 'Range',
          min: 1,
          max: maxDis,
          value: [loDis, hiDis],
          onChange: setDisWin,
          readout: disAll ? 'all' : `${loDis}${loDis !== hiDis ? `–${hiDis}` : ''}`,
          onReset: disAll ? undefined : () => setDisWin(null),
          title: 'Trim facts by disclosure count — drag the low thumb up to hide one-off mentions and focus the woven facts.'
        }}
      />
      <RailChrome region="lorePanel" name="Lore" layers={['chapters']} export={{ file: 'lore-rail', caption: () => 'Lore — revelation pacing' }} help={LoreHelp} />

      {/* The lore-topic reveal float is now app-level (DetailFloats → LoreDetailFloat), driven by selectedLoreId, so it
          opens from the Lore rail AND the scene inspector. This panel only keeps the gantt's scene-preview dialog. */}
      {preview && <PageReadDialog path={preview.path} kind="scene" title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  )
}

function GateChip({ on, onClick, tone, title, children }: { on: boolean; onClick: () => void; tone?: string; title?: string; children: React.ReactNode }): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn('flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5', on ? cn('border-current', tone ?? 'text-foreground') : 'border-border text-muted-foreground hover:text-foreground')}
    >
      {children}
    </button>
  )
}

/** How to read the Lore rail — the visualization, the filters, and the decisions it guides. */
function LoreHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Lore — how it works" size="detail">
      <div className="space-y-5">
        <HelpSection title="What it shows">
          <HelpList
            items={[
              <>Each <b className="text-foreground/80">row</b> is a world-fact the story keeps talking about (a rule, a piece of backstory, an object's history) — found by the analysis, not authored.</>,
              <>Read a row <b className="text-foreground/80">left-to-right</b>: it's that fact's <b className="text-foreground/80">revelation pacing</b> — when it enters the story and how it's fed to the reader over the scenes.</>
            ]}
          />
        </HelpSection>
        <HelpSection title="Reading the markers">
          <HelpTable
            rows={[
              ['Debut — soft shade', 'the fact’s FIRST reveal — where it enters the story'],
              ['Support — solid dot', 'a later reveal that adds to / repeats the fact'],
              ['Paradox — red ◆', 'a reveal that contradicts earlier canon'],
              ['a line across a row', 'the fact’s span, first→last reveal: long = WOVEN, short = DUMPED'],
              ['debut far right', 'the fact is introduced LATE — check it’s set up before it matters'],
              ['columns', 'scenes in reading order; the bands group them by act/chapter']
            ]}
          />
        </HelpSection>
        <HelpSection title="The filters">
          <HelpTable
            rows={[
              ['Paradox', 'facts that contradict themselves — fix these first'],
              ['No page', 'the fact recurs but you never wrote a lore page for it — "canon by accident"'],
              ['Has page', 'facts you’ve written an authored lore page for']
            ]}
          />
        </HelpSection>
        <HelpSection title="Decisions it guides">
          <HelpList
            items={[
              <><b className="text-foreground/80">Fix contradictions</b> — a Paradox marker means two reveals disagree; open the topic to see them (the deeper cross-scene check lives in Coherence).</>,
              <><b className="text-foreground/80">Seed earlier</b> — if a fact debuts late but is leaned on early, plant it sooner.</>,
              <><b className="text-foreground/80">Write it down</b> — a recurring "No page" fact is canon by accident; open it and formalize it into a lore page.</>
            ]}
          />
        </HelpSection>
      </div>
    </Dialog>
  )
}

const detailBox = (): Box => ({
  left: Math.max(8, window.innerWidth - 620),
  top: 70,
  width: 560,
  height: Math.max(320, Math.min(window.innerHeight - 140, 540))
})

/** One topic's detail — a draggable FloatWindow with the SAME grammar as the Entity/Arc floats: a chapter/act
 *  RAILWAY of the reveals, header actions (ask the assistant, un-merge folded members), and open-page. */
export function LoreDetailFloat({ topic, page, onClose, onScene }: { topic: LoreTopic; page: { path: string; name: string; kind: string } | null; onClose: () => void; onScene: (s: { path: string; title: string }) => void }): JSX.Element {
  const openPage = useWorkspace((s) => s.openPage)
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const worldPages = useWorkspace((s) => s.worldPages)
  const entityTracks = useWorkspace((s) => s.entityTracks)
  const setChatOpen = useWorkspace((s) => s.setChatOpen)
  const setChatDraft = useWorkspace((s) => s.setChatDraft)
  const enqueueTask = useWorkspace((s) => s.enqueueTask)
  const refreshWorldPages = useWorkspace((s) => s.refreshWorldPages)
  const notify = useWorkspace((s) => s.pushNotification)
  const [confirmCreate, setConfirmCreate] = useState(false)
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])
  const chapterIndex = useMemo(() => buildChapterIndex(storyTree), [storyTree])
  const orderedKeys = useMemo(() => [...chapterIndex.chapters.keys()], [chapterIndex])
  const debut = topic.disclosures[0] // reading-order first = the DEBUT
  const lastReveal = topic.disclosures[topic.disclosures.length - 1]

  // Scene-relevant CROSS-LINK roster (world-model.md Decision 4): the concepts present in THIS topic's own scenes,
  // as {name, id} the draft can link with [Name](id). id = the entity_id (page-backed OR pageless-discovered — the
  // WikiLink renderer resolves either). Scoped to the topic's scenes so drafts link precisely, not the whole world.
  const linkRoster = useMemo(() => {
    const nameOf = new Map<string, string>()
    for (const e of entityTracks ?? []) nameOf.set(e.id, e.name)
    for (const p of worldPages) nameOf.set(p.id, p.name) // pages win — the reader's canonical name
    const sceneIds = new Set(topic.disclosures.map((d) => d.sceneId))
    const seen = new Set<string>()
    const out: { name: string; id: string }[] = []
    for (const sid of sceneIds)
      for (const c of graph.scenes[sid]?.cast ?? []) {
        if (seen.has(c.entityId)) continue
        seen.add(c.entityId)
        const name = nameOf.get(c.entityId)
        if (name) out.push({ name, id: c.entityId }) // drop ids we can't humanize — a bare slug is no help to link
      }
    return out.slice(0, 40) // bound the injected tokens
  }, [topic, graph, entityTracks, worldPages])

  // Each reveal tagged with its SHORT, stable scene id — readScene resolves an id (or title), so we no longer
  // carry the full absolute path whose identical project-root prefix bloated every line (~120 chars → ~10).
  // CAPPED: a long-running fact can carry hundreds of disclosures; the tail is summarized and the model pulls
  // more via the read tools it already has, rather than us front-loading them all.
  const DISCLOSURE_CAP = 20
  const context =
    topic.disclosures
      .slice(0, DISCLOSURE_CAP)
      .map((d) => `- ${d.title} [${d.sceneId}]: ${d.summary}`)
      .join('\n') +
    (topic.disclosures.length > DISCLOSURE_CAP ? `\n…and ${topic.disclosures.length - DISCLOSURE_CAP} more reveals (use the read tools to pull them).` : '')
  // Learn more (analysis) → PREFILL the chat composer; the author reviews + sends (never auto-fired).
  const learnMore = (): void => {
    setChatOpen(true)
    setChatDraft(loreTopicPrompt(topic.label, context))
  }
  // Suggest page (write) → confirm the CREATE, then queue the draft as an append TASK the author reviews +
  // applies in the Tasks inbox (the standard /ag path — nothing lands without review).
  const doCreate = async (): Promise<void> => {
    setConfirmCreate(false)
    if (typeof window.nvs.createWorldPage !== 'function') return
    const name = topic.label.replace(/\b\w/g, (c) => c.toUpperCase())
    const id = slugify(topic.label)
    const stub = '## Overview\n\n'
    const created = await window.nvs.createWorldPage('lore', id, defaultFrontmatter(id, name), stub)
    if (!created) {
      notify({ id: 'lore-page', kind: 'warning', title: 'Could not create page', body: `A page id "${id}" may already exist.` })
      return
    }
    await refreshWorldPages()
    await enqueueTask({
      pagePath: created.path,
      pageTitle: created.name,
      pageKind: 'lore',
      instruction: loreDraftPageInstruction(topic.label, context, linkRoster),
      mode: 'append',
      baseText: stub,
      stamp: true
    })
    onClose()
  }

  const peek = (sceneId: string): void => {
    const sc = sceneById.get(sceneId)
    if (sc) onScene({ path: sc.path, title: sc.title })
  }
  // Presence strip — every scene in reading order, height = how many times THIS fact is revealed there.
  const heatCells: HeatCell[] = useMemo(() => {
    const count = new Map<string, number>()
    for (const d of topic.disclosures) count.set(d.sceneId, (count.get(d.sceneId) ?? 0) + 1)
    return [...scenes]
      .sort((a, b) => (graph.scenes[a.sceneId]?.linearPos ?? 1e9) - (graph.scenes[b.sceneId]?.linearPos ?? 1e9))
      .map((s) => {
        const n = count.get(s.sceneId) ?? 0
        const chKey = chapterIndex.sceneChapter.get(s.sceneId)
        return {
          key: s.sceneId,
          label: n ? `${s.title} — ${n} reveal${n === 1 ? '' : 's'}` : s.title,
          weight: n,
          onClick: n ? () => peek(s.sceneId) : undefined,
          group: chKey ? { key: chKey, title: chapterIndex.chapters.get(chKey)?.title ?? chKey } : undefined
        }
      })
  }, [topic.disclosures, scenes, graph, chapterIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const revealRef = (d: LoreTopic['disclosures'][number] | undefined): ReactNode =>
    d ? <button onClick={() => peek(d.sceneId)} title={d.title} className="block max-w-full truncate text-left text-lore hover:underline">{d.title}</button> : <span className="text-faint">—</span>
  const endpoints: DetailEndpoint[] = [
    { k: 'First revealed', v: revealRef(debut) },
    { k: 'Last revealed', v: revealRef(lastReveal) },
    { k: 'Reveals', v: `${topic.disclosures.length}${topic.hasRetcon ? ' · has a paradox' : ''}` }
  ]

  // entityId → display name (+ page to open). worldPages win so a resolved cast member links to its page; an
  // entity known only to analysis still resolves to a name. Reused pattern from the CommandPalette name index.
  const castRef = useMemo(() => {
    const m = new Map<string, { name: string; page?: (typeof worldPages)[number] }>()
    for (const e of entityTracks ?? []) m.set(e.id, { name: e.name })
    for (const p of worldPages) m.set(p.id, { name: p.name, page: p })
    return m
  }, [entityTracks, worldPages])

  // Right-pane detail for one reveal — following the THREAD beat format: the lore statement, then the surrounding
  // scene summary, then the cast that built it (each a link to its page). No "place" — scenes carry no location.
  const CAST_CAP = 8
  const disclosureDetail = (d: LoreTopic['disclosures'][number]): ReactNode => {
    const scene = graph.scenes[d.sceneId]
    const sceneSummary = scene?.summary
    const cast = [...(scene?.cast ?? [])].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    return (
      <div className="space-y-3.5">
        <p className="text-[12px] leading-relaxed text-foreground/85">{d.summary}</p>
        {sceneSummary && sceneSummary !== d.summary && (
          <div>
            <div className="mb-1 text-[9.5px] font-medium uppercase tracking-wide text-faint">Scene summary</div>
            <p className="text-[11.5px] leading-relaxed text-faint">{sceneSummary}</p>
          </div>
        )}
        {cast.length > 0 && (
          <div>
            <div className="mb-1 text-[9.5px] font-medium uppercase tracking-wide text-faint">Cast</div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {cast.slice(0, CAST_CAP).map((c, j) => {
                const ref = castRef.get(c.entityId)
                if (!ref) return null // skip raw ids we can't humanize rather than showing a slug
                return ref.page ? (
                  <button key={j} onClick={() => void openPage({ path: ref.page!.path, title: ref.page!.name, kind: ref.page!.kind as 'lore' })} title={`${ref.name} — open page`} className="flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-character hover:bg-panel-soft"><Users className="size-2.5" /> {ref.name}</button>
                ) : (
                  <span key={j} className="flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-faint"><Users className="size-2.5" /> {ref.name}</span>
                )
              })}
              {cast.length > CAST_CAP && <span className="self-center text-faint" title={cast.slice(CAST_CAP).map((c) => castRef.get(c.entityId)?.name).filter(Boolean).join(', ')}>+{cast.length - CAST_CAP}</span>}
            </div>
          </div>
        )}
      </div>
    )
  }
  const events: FeedEvent[] = topic.disclosures.map((d, i) => {
    const chKey = chapterIndex.sceneChapter.get(d.sceneId) ?? ''
    const role: 'paradox' | 'debut' | 'support' = d.magnitude === 'retcon' ? 'paradox' : d === debut ? 'debut' : 'support'
    return {
      id: `${d.sceneId}:${i}`,
      chapterKey: chKey,
      pos: d.pos,
      title: d.title,
      summary: d.summary,
      detail: disclosureDetail(d),
      kind: role,
      tone: role === 'paradox' ? 'flag' : role === 'debut' ? 'ok' : 'muted',
      onOpen: () => peek(d.sceneId)
    }
  })
  const chapters: FeedChapter[] = orderedKeys.map((k, i) => ({ key: k, title: chapterIndex.chapters.get(k)?.title ?? k, pos: i }))

  return (
    <>
    <FloatWindow region="loreDetailFloat" persistKey="lore-detail" accent="var(--lore)" maxWidth={Math.round(window.innerWidth * 0.92)} maxHeight={Math.round(window.innerHeight * 0.92)} onEscape={onClose} initial={detailBox}>
      <DetailSplitView
        onClose={onClose}
        icon={<BookMarked className="size-4 shrink-0 text-lore" />}
        title={page ? (
          <button onClick={() => void openPage({ path: page.path, title: page.name, kind: page.kind as 'lore' })} className="flex min-w-0 items-center gap-1 capitalize text-lore hover:underline" title="Open lore page">
            <span className="truncate">{topic.label}</span> <ExternalLink className="size-3 shrink-0" />
          </button>
        ) : (
          <span className="capitalize">{topic.label}</span>
        )}
        chips={topic.hasRetcon ? <span className="shrink-0 rounded-full border border-flag/50 px-1.5 py-0 text-[9px] uppercase tracking-wide text-flag">paradox</span> : undefined}
        meta={`${topic.disclosures.length} reveal${topic.disclosures.length === 1 ? '' : 's'}`}
        headerActions={
          <>
            <AiGate><button onClick={learnMore} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"><Sparkles className="size-3" /> Learn more</button></AiGate>
            {!page && <AiGate><button onClick={() => setConfirmCreate(true)} className="flex items-center gap-1 rounded-full border border-lore/40 px-2 py-0.5 text-[10px] text-lore hover:bg-lore/10"><FilePlus2 className="size-3" /> Suggest page</button></AiGate>}
          </>
        }
        endpoints={endpoints}
        heatmap={<AppearanceHeatStrip cells={heatCells} accentClass="text-lore" />}
        tabs={[{ id: 'feed', label: 'Reveals', icon: <Rows3 className="size-3.5" />, count: topic.disclosures.length }]}
        tab="feed"
        onTab={() => {}}
        chapters={chapters}
        events={events}
        isFeed
      />
    </FloatWindow>
    <ConfirmDialog
      open={confirmCreate}
      title="Create lore page?"
      message={<>Create a <b className="text-foreground/80">lore</b> page for “{topic.label}”, then queue an AI draft (from the reveals) for you to review &amp; apply in the Tasks inbox. Nothing is written to the page until you apply it.</>}
      confirmLabel="Create + draft"
      onConfirm={() => void doCreate()}
      onCancel={() => setConfirmCreate(false)}
    />
    </>
  )
}

/** Sidebar roster — grouped by SEVERITY (Paradox → No page → Has page), each by reveal count. Rows use the shared
 *  `sidebarRow` look (matches CustodySidebar & the Thread/Coherence rails); severity shows in the leading dot. */
export function LoreRoster(): JSX.Element {
  const view = useWorkspace((s) => s.loreView)
  const worldPages = useWorkspace((s) => s.worldPages)
  const selected = useWorkspace((s) => s.selectedLoreId)
  const select = useWorkspace((s) => s.setSelectedLore)
  const governed = useMemo(() => {
    const lore = worldPages.filter((p) => p.kind === 'lore')
    const ids = new Set(lore.map((p) => p.id))
    const names = new Set(lore.map((p) => nn(p.name)))
    return (t: LoreTopic) => ids.has(t.loreId) || names.has(nn(t.label))
  }, [worldPages])
  const sections = useMemo(() => {
    const topics = view?.topics ?? []
    const byCount = (a: LoreTopic, b: LoreTopic): number => b.disclosures.length - a.disclosures.length
    const paradox = topics.filter((t) => t.hasRetcon).sort(byCount)
    const rest = topics.filter((t) => !t.hasRetcon)
    return [
      { key: 'paradox', label: 'Paradox', topics: paradox },
      { key: 'nopage', label: 'No page', topics: rest.filter((t) => !governed(t)).sort(byCount) },
      { key: 'haspage', label: 'Has page', topics: rest.filter((t) => governed(t)).sort(byCount) }
    ].filter((s) => s.topics.length > 0)
  }, [view, governed])

  if (view == null) return <p className="px-3 py-2 text-xs text-muted-foreground">Reading…</p>
  if (view.topics.length === 0) return <SidebarEmpty>No disclosures yet — run analysis.</SidebarEmpty>
  return (
    <>
      {sections.map((sec) => (
        <RosterSection key={sec.key} label={sec.label} count={sec.topics.length}>
          {sec.topics.map((t) => {
            const on = selected === t.loreId
            return (
              <button
                key={t.loreId}
                onClick={() => select(on ? null : t.loreId)}
                className={cn(sidebarRow(on), 'capitalize')}
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', t.hasRetcon ? 'bg-flag' : 'bg-lore/60')} />
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-faint">{t.disclosures.length}</span>
              </button>
            )
          })}
        </RosterSection>
      ))}
    </>
  )
}
