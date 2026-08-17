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
import { DetailSplitView, type FeedEvent, type FeedChapter } from '@/components/layout/DetailSplitView'
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
import { HelpSection, HelpTable, HelpList, HelpMd } from '@/components/ui/help'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { useTranslation } from 'react-i18next'
import { regionAttrs } from '@/config/regions'
import { defaultFrontmatter, slugify } from '@/config/worldSchema'
import { loreTopicPrompt, loreDraftPageInstruction } from '@shared/config/chatPrompts'
import { AiGate } from '@/config/aiFeatures'
import type { LoreTopic } from '@shared/ipc'

const nn = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
type Gate = 'all' | 'retcon' | 'unauthored' | 'governed'

export function LorePanel(): JSX.Element {
  const { t } = useTranslation('lore')
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
    return scoped.shown.map((topic) => {
      const governed = !!pageOf(topic)
      return {
        key: topic.loreId,
        highlighted: selectedId === topic.loreId,
        gutter: (
          <button
            onClick={() => select(selectedId === topic.loreId ? null : topic.loreId)}
            className="flex h-full w-full items-center gap-1.5 border-l-2 border-transparent pr-2 pl-1.5 text-left"
            title={governed ? t('row.hasPageTitle', { label: topic.label }) : t('row.byAccidentTitle', { label: topic.label })}
          >
            {topic.hasRetcon && <AlertTriangle className="size-3 shrink-0 text-flag" />}
            <span className={cn(GANTT_ROW_TITLE, 'min-w-0 flex-1 capitalize')}>{topic.label}</span>
            {!governed && <span className="size-1.5 shrink-0 rounded-full border border-lore/60" title={t('row.unauthored')} />}
          </button>
        ),
        renderLane: ({ colW, colOf: co }) => {
          // Marker shape = the fact's revelation ROLE, so a row reads as pacing at a glance: DEBUT (soft
          // shaded, its first reveal), SUPPORT (a solid dot, a later reveal), PARADOX (a red diamond,
          // a contradiction). A faint connector spans first→last reveal — long = woven, short = dumped.
          const xs = topic.disclosures.map((d) => co.get(d.sceneId)).filter((c): c is number => c != null)
          const nodes: (JSX.Element | null)[] = []
          if (xs.length > 1) {
            const lo = Math.min(...xs)
            const hi = Math.max(...xs)
            nodes.push(<span key="span" className="absolute top-1/2 h-px -translate-y-1/2 bg-lore/25" style={{ left: lo * colW + colW / 2, width: (hi - lo) * colW }} />)
          }
          topic.disclosures.forEach((d, i) => {
            const ci = co.get(d.sceneId)
            if (ci == null) return
            const paradox = d.magnitude === 'retcon'
            const debut = i === 0
            const role = paradox ? 'paradox' : debut ? 'debut' : 'support'
            nodes.push(
              <button
                key={i}
                onClick={() => select(topic.loreId)}
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
        <GateChip on={gate === 'all'} onClick={() => setGate('all')}>{t('filters.all')} · {view.topics.length}</GateChip>
        {counts3.retcon > 0 && (
          <GateChip on={gate === 'retcon'} onClick={() => setGate('retcon')} tone="text-flag">
            <AlertTriangle className="size-3" /> {t('filters.paradox')} · {counts3.retcon}
          </GateChip>
        )}
        <GateChip on={gate === 'unauthored'} onClick={() => setGate('unauthored')} tone="text-lore" title={t('filters.noPageTitle')}>{t('filters.noPage')} · {counts3.unauthored}</GateChip>
        <GateChip on={gate === 'governed'} onClick={() => setGate('governed')} title={t('filters.hasPageTitle')}>{t('filters.hasPage')} · {counts3.governed}</GateChip>
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
        empty={gate === 'all' ? <EmptyRailState rail="lore" /> : t('rail.noTopicsInFilter')}
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
        page={{ from: scoped.from, to: scoped.to, total: scoped.total, noun: t('rail.topicsNoun'), page: scoped.page, pageCount: scoped.pageCount, onPage: setPage }}
        metric={{
          label: t('rail.rangeLabel'),
          min: 1,
          max: maxDis,
          value: [loDis, hiDis],
          onChange: setDisWin,
          readout: disAll ? t('rail.rangeAll') : `${loDis}${loDis !== hiDis ? `–${hiDis}` : ''}`,
          onReset: disAll ? undefined : () => setDisWin(null),
          title: t('rail.rangeTitle')
        }}
      />
      <RailChrome region="lorePanel" name={t('rail.name')} layers={['chapters']} export={{ file: 'lore-rail', caption: () => t('rail.caption') }} help={LoreHelp} />

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
  const { t } = useTranslation('lore')
  return (
    <Dialog open={open} onClose={onClose} title={t('help.title')} size="detail">
      <div className="space-y-5">
        <HelpSection title={t('help.whatItShows.title')}>
          <HelpList items={t('help.whatItShows.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.markers.title')}>
          <HelpTable rows={Object.entries(t('help.markers.rows', { returnObjects: true }) as Record<string, string>)} />
        </HelpSection>
        <HelpSection title={t('help.filters.title')}>
          <HelpTable rows={Object.entries(t('help.filters.rows', { returnObjects: true }) as Record<string, string>)} />
        </HelpSection>
        <HelpSection title={t('help.decisions.title')}>
          <HelpList items={t('help.decisions.items', { returnObjects: true }) as string[]} />
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
  const { t } = useTranslation('lore')
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
      notify({ id: 'lore-page', kind: 'warning', title: t('detail.createFailTitle'), body: t('detail.createFailBody', { id }) })
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
          label: n ? t('detail.heatLabel', { title: s.title, count: n }) : s.title,
          weight: n,
          onClick: n ? () => peek(s.sceneId) : undefined,
          group: chKey ? { key: chKey, title: chapterIndex.chapters.get(chKey)?.title ?? chKey } : undefined
        }
      })
  }, [topic.disclosures, scenes, graph, chapterIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // A lore topic is FACT-LIKE: its reveal span is already visible in the appearance strip, so no endpoints
  // grid — the strip is the one pinned main view (no RESOLVES⇄APPEARS toggle; threads keep theirs).

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
            <div className="mb-1 text-[9.5px] font-medium uppercase tracking-wide text-faint">{t('detail.sceneSummary')}</div>
            <p className="text-[11.5px] leading-relaxed text-faint">{sceneSummary}</p>
          </div>
        )}
        {cast.length > 0 && (
          <div>
            <div className="mb-1 text-[9.5px] font-medium uppercase tracking-wide text-faint">{t('detail.cast')}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {cast.slice(0, CAST_CAP).map((c, j) => {
                const ref = castRef.get(c.entityId)
                if (!ref) return null // skip raw ids we can't humanize rather than showing a slug
                return ref.page ? (
                  <button key={j} onClick={() => void openPage({ path: ref.page!.path, title: ref.page!.name, kind: ref.page!.kind as 'lore' })} title={t('detail.openPage', { name: ref.name })} className="flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-character hover:bg-panel-soft"><Users className="size-2.5" /> {ref.name}</button>
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
    const role: 'paradox' | 'debut' | 'support' = d.magnitude === 'retcon' ? 'paradox' : i === 0 ? 'debut' : 'support' // reading-order first = the DEBUT
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
          <button onClick={() => void openPage({ path: page.path, title: page.name, kind: page.kind as 'lore' })} className="flex min-w-0 items-center gap-1 capitalize text-lore hover:underline" title={t('detail.openLorePage')}>
            <span className="truncate">{topic.label}</span> <ExternalLink className="size-3 shrink-0" />
          </button>
        ) : (
          <span className="capitalize">{topic.label}</span>
        )}
        chips={topic.hasRetcon ? <span className="shrink-0 rounded-full border border-flag/50 px-1.5 py-0 text-[9px] uppercase tracking-wide text-flag">{t('detail.paradox')}</span> : undefined}
        meta={t('detail.reveals', { count: topic.disclosures.length })}
        headerActions={
          <>
            <AiGate><button onClick={learnMore} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"><Sparkles className="size-3" /> {t('detail.learnMore')}</button></AiGate>
            {!page && <AiGate><button onClick={() => setConfirmCreate(true)} className="flex items-center gap-1 rounded-full border border-lore/40 px-2 py-0.5 text-[10px] text-lore hover:bg-lore/10"><FilePlus2 className="size-3" /> {t('detail.suggestPage')}</button></AiGate>}
          </>
        }
        heatmap={<AppearanceHeatStrip cells={heatCells} accentClass="text-lore" />}
        tabs={[{ id: 'feed', label: t('detail.revealsTab'), icon: <Rows3 className="size-3.5" />, count: topic.disclosures.length }]}
        tab="feed"
        onTab={() => {}}
        chapters={chapters}
        events={events}
        isFeed
      />
    </FloatWindow>
    <ConfirmDialog
      open={confirmCreate}
      title={t('detail.createTitle')}
      message={<HelpMd>{t('detail.createMessage', { label: topic.label })}</HelpMd>}
      confirmLabel={t('detail.createConfirm')}
      onConfirm={() => void doCreate()}
      onCancel={() => setConfirmCreate(false)}
    />
    </>
  )
}

/** Sidebar roster — grouped by SEVERITY (Paradox → No page → Has page), each by reveal count. Rows use the shared
 *  `sidebarRow` look (matches CustodySidebar & the Thread/Coherence rails); severity shows in the leading dot. */
export function LoreRoster(): JSX.Element {
  const { t } = useTranslation('lore')
  const view = useWorkspace((s) => s.loreView)
  const worldPages = useWorkspace((s) => s.worldPages)
  const selected = useWorkspace((s) => s.selectedLoreId)
  const select = useWorkspace((s) => s.setSelectedLore)
  const governed = useMemo(() => {
    const lore = worldPages.filter((p) => p.kind === 'lore')
    const ids = new Set(lore.map((p) => p.id))
    const names = new Set(lore.map((p) => nn(p.name)))
    return (topic: LoreTopic) => ids.has(topic.loreId) || names.has(nn(topic.label))
  }, [worldPages])
  const sections = useMemo(() => {
    const topics = view?.topics ?? []
    const byCount = (a: LoreTopic, b: LoreTopic): number => b.disclosures.length - a.disclosures.length
    const paradox = topics.filter((topic) => topic.hasRetcon).sort(byCount)
    const rest = topics.filter((topic) => !topic.hasRetcon)
    return [
      { key: 'paradox', label: t('roster.paradox'), topics: paradox },
      { key: 'nopage', label: t('roster.noPage'), topics: rest.filter((topic) => !governed(topic)).sort(byCount) },
      { key: 'haspage', label: t('roster.hasPage'), topics: rest.filter((topic) => governed(topic)).sort(byCount) }
    ].filter((s) => s.topics.length > 0)
  }, [view, governed, t])

  if (view == null) return <p className="px-3 py-2 text-xs text-muted-foreground">{t('roster.reading')}</p>
  if (view.topics.length === 0) return <SidebarEmpty>{t('roster.empty')}</SidebarEmpty>
  return (
    <>
      {sections.map((sec) => (
        <RosterSection key={sec.key} label={sec.label} count={sec.topics.length}>
          {sec.topics.map((topic) => {
            const on = selected === topic.loreId
            return (
              <button
                key={topic.loreId}
                onClick={() => select(on ? null : topic.loreId)}
                className={cn(sidebarRow(on), 'capitalize')}
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', topic.hasRetcon ? 'bg-flag' : 'bg-lore/60')} />
                <span className="min-w-0 flex-1 truncate">{topic.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-faint">{topic.disclosures.length}</span>
              </button>
            )
          })}
        </RosterSection>
      ))}
    </>
  )
}
