/**
 * Coherence workspace — triage surface for where the story drifts/contradicts/leaves a hole vs what a
 * page or thread declares (T2/T3). The sidebar (CoherenceSidebar) is the roster; this main area is the
 * **page review**: pick a finding → it fills the main editor area (declared vs observed, evidence scenes,
 * suggestion, links to the entity page / the thread). Rendered inline (not a floating pane) so it never
 * collides with the Thread floating when you "Inspect thread". Scene-preview dialog lives at the panel root.
 */
import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { regionAttrs } from '@/config/regions'
import { Check, Lightbulb, Link2, Pencil, Rows3 } from 'lucide-react'
import { EmptyRailState } from '@/components/ui/EmptyRailState'
import { useWorkspace } from '@/stores/workspace'
import { severityVisual, kindGloss, displayKind, declaredSilent } from '@/config/coherenceVisual'
import { threadVisual } from '@/config/threadVisual'
import { cn } from '@/lib/utils'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { Annotated, type NameRef } from '@/components/ui/Annotated'
import { RailHeader } from '@/components/ui/RailHeader'
import { DetailLabel, DETAIL_PROSE } from '@/components/ui/detail'
import { DetailSplitView, type FeedEvent, type FeedChapter, type FeedTone } from '@/components/layout/DetailSplitView'
import { LifecycleGantt, deriveWrapLevels, sceneVolumes, GANTT_ROW_TITLE, type GanttRow } from '@/components/features/custody/LifecycleGantt'
import { buildChapterIndex } from '@/lib/analysis/chapterIndex'
import { entityVisual } from '@/config/entityVisual'
import { useSceneAxis } from '@/lib/timeline/sceneAxis'
import { useGanttWindow, scopeRows } from '@/lib/timeline/ganttWindow'
import { RailScaleBar } from '@/components/layout/RailScaleBar'
import { RailChrome } from '@/components/layout/RailChrome'
import { StructuralChecks } from '@/components/features/coherence/StructuralChecks'
import { Dialog } from '@/components/ui/dialog'
import { HelpSection, HelpTable, HelpList } from '@/components/ui/help'
import { useTranslation } from 'react-i18next'
import { CONTINUITY_KINDS, CRITIQUE_KINDS } from '@shared/config/extraction'
import type { CoherenceFinding, SceneFile } from '@shared/ipc'

const CONTINUITY = new Set<string>(CONTINUITY_KINDS) // plot holes — declared is an EARLIER FACT, not a page
const CRITIQUE = new Set<string>(CRITIQUE_KINDS) // tough questions — declared is what the beat SETS UP

type ScenePreview = { path: string; title: string }

/** Finding prose with `[title · id]` anchors (the linters cite scene/thread anchors verbatim) rendered as LINKS —
 *  a scene anchor opens the scene peek, a thread anchor opens the thread float; plain segments keep the
 *  name/thread annotation. Without this the citations render as intimidating plaintext brackets. */
function AnchoredProse({
  text,
  names,
  onName,
  threads,
  onThread,
  sceneById,
  onScene
}: {
  text: string
  names: NameRef[]
  onName: (id: string) => void
  threads: { id: string; slug: string }[]
  onThread: (id: string) => void
  sceneById: Map<string, SceneFile>
  onScene: (s: ScenePreview) => void
}): JSX.Element {
  const parts: ReactNode[] = []
  const re = /\[([^\][]*?) · ([\w:-]+)\]/g
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  const plain = (seg: string): ReactNode => <Annotated key={k++} text={seg} names={names} onName={onName} threads={threads} onThread={onThread} />
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(plain(text.slice(last, m.index)))
    const [raw, title, id] = m
    const sc = sceneById.get(id)
    if (sc) parts.push(<button key={k++} onClick={() => onScene({ path: sc.path, title: sc.title })} className="text-thread hover:underline" title={sc.title}>{title || sc.title}</button>)
    else if (threads.some((th) => th.id === id)) parts.push(<button key={k++} onClick={() => onThread(id)} className="font-mono text-thread hover:underline">{title || id.split(':').pop()}</button>)
    else parts.push(<span key={k++}>{raw}</span>)
    last = m.index + raw.length
  }
  if (last < text.length) parts.push(plain(text.slice(last)))
  return <>{parts}</>
}

export function CoherencePanel(): JSX.Element {
  const { t } = useTranslation('coherence')
  const findings = useWorkspace((s) => s.coherence)
  const select = useWorkspace((s) => s.setSelectedFinding)

  // The selected finding's detail opens in the app-level CoherenceDetailFloat (like the thread/arc floats),
  // so this panel is ALWAYS the map — selecting a cell pops the float, no inline page.
  return (
    <div {...regionAttrs('coherencePanel')} className="relative flex min-h-0 flex-1 flex-col">
      {/* Deterministic structural pass — instant, no-LLM, runs regardless of coherence-analysis state. */}
      <StructuralChecks />
      {findings == null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8"><p className="text-sm text-muted-foreground">{t('loading')}</p></div>
      ) : findings.length === 0 ? (
        <EmptyRailState rail="coherence" />
      ) : (
        <CoherenceMap findings={findings} onSelect={select} />
      )}

      <RailChrome
        region="coherencePanel"
        name={t('rail.name')}
        layers={['chapters']}
        export={{ file: 'coherence-rail', caption: () => t('rail.caption') }}
        help={CoherenceHelp}
      />
    </div>
  )
}

// ── Browse: three ways to feel the same findings (you pick which reads best) ──────────────────────
type MapProps = { findings: CoherenceFinding[]; onSelect: (id: string) => void }

/** The one Coherence view: a cast × scene LifecycleGantt (the shared skeleton) with chaptered severity bands.
 *  "By type" / "by character" aren't separate views — they're shading filters over this single map. */
function CoherenceMap({ findings, onSelect }: MapProps): JSX.Element {
  const { t } = useTranslation('coherence')
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const worldPages = useWorkspace((s) => s.worldPages) // all kinds — entity coherence rows items/factions too
  const chapterWrap = useWorkspace((s) => s.ganttLayers.chapters)
  // The Highlight filter lives in the store (not local) so the detail float truncates to the same category.
  const kindFilter = useWorkspace((s) => s.coherenceKind)
  const setKindFilter = useWorkspace((s) => s.setCoherenceKind)
  const [preview, setPreview] = useState<{ path: string; title: string; kind: string } | null>(null)
  // The Highlight chips are DERIVED from the DISPLAY kinds actually present (Fidelity drift/gap/contradiction AND
  // the continuity plot-hole kinds; `gap` forks into its two sides — story-critique.md Slice 0), so the filter
  // always lists every category the findings contain — not a fixed set. Confirmations aren't a triage category.
  const kindsPresent = useMemo(() => {
    const order = ['contradiction', 'drift', 'gap:page-silent', 'gap:never-shown', 'continuity-error', 'logic-gap', 'rule-break', 'inert', 'weak-close'] // Fidelity · plot-holes · critique
    const seen = new Set<string>()
    for (const f of findings) if (!f.intentional && f.kind !== 'confirmation') seen.add(displayKind(f.kind, f.declared))
    return [...seen].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  }, [findings])
  const counts = useMemo(() => sceneVolumes(graph), [graph])
  const nameOf = useMemo(() => new Map(worldPages.map((c) => [c.id, c.name])), [worldPages])
  const pageById = useMemo(() => new Map(worldPages.map((c) => [c.id, c])), [worldPages])

  const [page, setPage] = useState(0)
  const [findWin, setFindWin] = useState<[number, number] | null>(null) // trim rows by finding count (focus the flagged characters)
  const sceneCols = useSceneAxis(scenes)
  const win = useGanttWindow(sceneCols) // gantt scale: window the axis + paginate rows (see gantt-scale.md)
  const cols = win.cols
  const colOf = win.colOf
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])
  const wraps = useMemo(() => (chapterWrap ? deriveWrapLevels(storyTree, colOf) : undefined), [chapterWrap, storyTree, colOf])

  // The shared chapter index (folder-tree-based, format-agnostic). Map-specific bit = the column span per
  // chapter (needs colOf), derived from the index's scene lists.
  const index = useMemo(() => buildChapterIndex(storyTree), [storyTree])
  const chapterMeta = useMemo(() => {
    const meta = new Map<string, { min: number; max: number; title: string }>()
    for (const [key, ch] of index.chapters) {
      const idxs = ch.sceneIds.map((sid) => colOf.get(sid)).filter((i): i is number => i != null)
      if (idxs.length) meta.set(key, { min: Math.min(...idxs), max: Math.max(...idxs), title: ch.title })
    }
    return meta
  }, [index, colOf])

  // entity -> chapter -> findings (character coherence only). A finding lands on the chapter(s) of its
  // evidence (resolveKey handles scene-id / prefixed / bare-name shapes); asOf is a fallback checkpoint.
  const byEntity = useMemo(() => {
    const m = new Map<string, Map<string, CoherenceFinding[]>>()
    for (const f of findings) {
      if (!f.entityId || f.kind === 'confirmation' || f.intentional) continue // ruled intentional → off the triage map
      const chs = new Set<string>()
      for (const ev of f.evidence ?? []) { const ck = index.resolveKey(ev); if (ck && chapterMeta.has(ck)) chs.add(ck) }
      if (chs.size === 0 && f.asOf) { const ck = index.resolveKey(f.asOf); if (ck && chapterMeta.has(ck)) chs.add(ck) }
      if (chs.size === 0) continue
      const em = m.get(f.entityId) ?? new Map<string, CoherenceFinding[]>()
      m.set(f.entityId, em)
      for (const ch of chs) { const arr = em.get(ch) ?? []; arr.push(f); em.set(ch, arr) }
    }
    return m
  }, [findings, index, chapterMeta])

  // Finding-count WINDOW — trim rows by how many findings a character has (drag the low thumb up to hide the
  // lightly-flagged and focus the most-flagged; the same windowed RangeSlider the Cast/Thread rails use).
  const findingsOf = (chMap: Map<string, CoherenceFinding[]>): number => [...chMap.values()].reduce((s, fs) => s + fs.length, 0)
  const maxFind = useMemo(() => Math.max(1, ...[...byEntity.values()].map(findingsOf)), [byEntity])
  const loFind = findWin ? Math.min(Math.max(1, findWin[0]), maxFind) : 1
  const hiFind = findWin ? Math.min(Math.max(loFind, findWin[1]), maxFind) : maxFind
  const findAll = loFind === 1 && hiFind === maxFind

  // Gantt scale: byEntity is already window-relevant (chapterMeta = colOf-derived), so scopeRows just paginates
  // (scenesOf resolves each entity's chapters back to scene ids, all in colOf by construction).
  const scoped = useMemo(
    () =>
      scopeRows(
        [...byEntity.entries()].filter(([, chMap]) => findingsOf(chMap) >= loFind && findingsOf(chMap) <= hiFind),
        ([, chMap]) => [...chMap.keys()].flatMap((ch) => index.chapters.get(ch)?.sceneIds ?? []),
        colOf,
        page
      ),
    [byEntity, index, colOf, page, loFind, hiFind]
  )

  const rows = useMemo<GanttRow[]>(
    () =>
      scoped.shown.map(([eid, chMap]) => {
        // With a Highlight active, a row whose character has NO finding of that kind is DISABLED — dimmed and
        // non-clickable (gutter + bands), so you can't open a drift card while filtering for contradictions.
        const disabled = kindFilter != null && ![...chMap.values()].flat().some((f) => displayKind(f.kind, f.declared) === kindFilter)
        const pg = pageById.get(eid) // the NAME cell → the entity's PAGE (declared profile)
        const { Icon: KindIcon, text: kindColor } = entityVisual(pg?.kind ?? 'character') // tag the row's type: character · item · …
        return {
          key: eid,
          gutter: (
            <button
              disabled={disabled}
              onClick={() => { if (pg) setPreview({ path: pg.path, title: pg.name, kind: pg.kind }) }}
              className={cn('flex h-full w-full items-center gap-2 border-l-2 border-transparent pr-2 pl-1.5 text-left', disabled && 'opacity-30')}
              title={disabled ? t('row.noKind', { name: nameOf.get(eid) ?? eid, kind: kindGloss(kindFilter!).label }) : t('row.openPage', { name: nameOf.get(eid) ?? eid, kind: pg?.kind ?? 'character' })}
            >
              <KindIcon className={cn('size-3 shrink-0', kindColor)} />
              <span className={GANTT_ROW_TITLE}>{nameOf.get(eid) ?? eid}</span>
            </button>
          ),
          // A band per chapter, dots like the arc Gantt — one dot per finding, colored by severity. The kind
          // filter SHADES non-matching dots (count never changes). Clicking the band opens the finding detail.
          renderLane: ({ colW }) =>
            [...chMap.entries()].map(([ch, fs]) => {
              const range = chapterMeta.get(ch)
              if (!range) return null
              const { min, max } = range
              const width = (max - min + 1) * colW - 2
              const cap = Math.max(1, Math.floor((width - 6) / 8))
              const shown = fs.slice(0, cap)
              return (
                <button
                  key={ch}
                  disabled={disabled}
                  onClick={() => onSelect((kindFilter ? fs.find((f) => displayKind(f.kind, f.declared) === kindFilter) : null)?.id ?? fs[0].id)}
                  title={`${nameOf.get(eid) ?? eid} · ${range.title}: ${fs.map((f) => f.trait).join('; ')}`}
                  className={cn('absolute top-1/2 flex h-4 -translate-y-1/2 items-center gap-0.5 overflow-hidden rounded-sm border border-border bg-panel-soft px-1', disabled && 'opacity-30')}
                  style={{ left: min * colW + 1, width }}
                >
                  {shown.map((f, k) => (
                    <span key={k} className={cn('size-1.5 shrink-0 rounded-full', severityVisual(f.severity).dot, kindFilter && displayKind(f.kind, f.declared) !== kindFilter && 'opacity-20')} />
                  ))}
                  {fs.length > shown.length && <span className="shrink-0 text-[8px] leading-none text-faint">+{fs.length - shown.length}</span>}
                </button>
              )
            })
        }
      }),
    [scoped, chapterMeta, nameOf, pageById, kindFilter, onSelect]
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <RailHeader data-export-hide="1">
        <span className="text-faint">{t('filter.highlight')}</span>
        {kindsPresent.map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(kindFilter === k ? null : k)}
            title={kindGloss(k).question || kindGloss(k).blurb}
            className={cn('rounded-full border px-2 py-0.5', kindFilter === k ? 'border-foreground/40 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
          >
            {kindGloss(k).label}
          </button>
        ))}
        {kindFilter && (
          <button onClick={() => setKindFilter(null)} className="text-faint hover:text-foreground">{t('filter.clear')}</button>
        )}
      </RailHeader>
      <LifecycleGantt
        cols={cols.map((s) => ({ id: s.sceneId, title: s.title }))}
        wraps={wraps}
        counts={counts}
        rows={rows}
        onColClick={(c) => { const sc = sceneById.get(c.id); if (sc) setPreview({ path: sc.path, title: sc.title, kind: 'scene' }) }}
        empty={<EmptyRailState rail="coherence" />}
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
        page={{ from: scoped.from, to: scoped.to, total: scoped.total, noun: t('scale.characters'), page: scoped.page, pageCount: scoped.pageCount, onPage: setPage }}
        metric={{
          label: t('scale.rangeLabel'),
          min: 1,
          max: maxFind,
          value: [loFind, hiFind],
          onChange: setFindWin,
          readout: findAll ? t('scale.all') : `${loFind}${loFind !== hiFind ? `–${hiFind}` : ''}`,
          onReset: findAll ? undefined : () => setFindWin(null),
          title: t('scale.rangeTitle')
        }}
      />
      {preview && <PageReadDialog path={preview.path} kind={preview.kind} title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  )
}


// The display kinds the help explains, in chip order (fidelity then plot-holes) — questions come from the
// gloss config, so the F8 sheet and the chip hovers can never drift apart.
const HELP_KINDS = ['contradiction', 'drift', 'gap:page-silent', 'gap:never-shown', 'continuity-error', 'logic-gap', 'rule-break', 'inert', 'weak-close']

function CoherenceHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('coherence')
  return (
    <Dialog open={open} onClose={onClose} title={t('help.title')} size="detail">
      <div className="space-y-5">
        <HelpSection title={t('help.flags.title')}>
          <HelpList items={t('help.flags.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.questions.title')}>
          <HelpTable rows={HELP_KINDS.map((k): [string, string] => [kindGloss(k).label, kindGloss(k).question])} />
        </HelpSection>
        <HelpSection title={t('help.reading.title')}>
          <HelpTable rows={Object.entries(t('help.reading.rows', { returnObjects: true }) as Record<string, string>)} />
        </HelpSection>
        <HelpSection title={t('help.acting.title')}>
          <HelpList items={t('help.acting.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.confirmation.title')}>
          <HelpList items={t('help.confirmation.items', { returnObjects: true }) as string[]} />
        </HelpSection>
      </div>
    </Dialog>
  )
}

/** The ONE coherence card — chip → question headline → trait subtitle → subject → page/scenes → suggestion →
 *  act → related. Owns its full header + padding so it reads IDENTICALLY in every host (the per-character feed's
 *  right pane via `detailOwnsHeader`, the single-finding float's tab body); hosts scroll, the card doesn't. */
export function CoherenceReview({
  finding,
  onScene,
  onInspectThread
}: {
  finding: CoherenceFinding
  onScene: (s: ScenePreview) => void
  onInspectThread: (threadId: string) => void
}): JSX.Element {
  const { t } = useTranslation('coherence')
  const scenes = useWorkspace((s) => s.scenes)
  const characters = useWorkspace((s) => s.characters)
  const worldPages = useWorkspace((s) => s.worldPages) // entity findings (item/faction) resolve pages here
  const threads = useWorkspace((s) => s.threads)
  const storyTree = useWorkspace((s) => s.storyTree)
  const selectArc = useWorkspace((s) => s.setSelectedArc) // open the character's arc float (like the thread rail), not the page
  const setRuling = useWorkspace((s) => s.setCoherenceRuling)
  const [pageDialog, setPageDialog] = useState<{ path: string; title: string; kind: string } | null>(null)

  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])
  const entityPage = finding.entityId ? worldPages.find((c) => c.id === finding.entityId) ?? null : null
  const linkedThread = finding.threadId ? threads?.find((th) => th.id === finding.threadId) ?? null : null
  // slug = thread's human handle, or the last segment of the id if the thread list isn't loaded.
  const threadSlug = linkedThread?.slug ?? (finding.threadId ? finding.threadId.split(':').pop() : null)

  // Subject name — feeds the "…'s page" label; the subject itself lives in the float TITLE (redundancy sweep).
  const subjectName = entityPage?.name ?? finding.entityId ?? threadSlug ?? null

  const names = useMemo<NameRef[]>(() => characters.map((c) => ({ id: c.id, name: c.name })), [characters])
  const index = useMemo(() => buildChapterIndex(storyTree), [storyTree])

  // Split evidence into exact scenes vs chapter-grain hits (deduped, via the shared resolver — works for any
  // id format). `whereKeys` = the chapter(s) the finding actually OCCURS in (the real location, from evidence),
  // distinct from `asOf` which is just the analysis checkpoint (uniform across findings).
  const evScenes: ScenePreview[] = []
  const evChapterKeys: string[] = []
  const whereKeys: string[] = []
  for (const ref of finding.evidence ?? []) {
    const ck = index.resolveKey(ref)
    if (ck && !whereKeys.includes(ck)) whereKeys.push(ck)
    const sc = sceneById.get(ref)
    if (sc) evScenes.push({ path: sc.path, title: sc.title })
    else if (ck && !evChapterKeys.includes(ck)) evChapterKeys.push(ck)
  }
  const whereLabels = whereKeys.map((k) => index.chapters.get(k)?.title ?? k)

  // Naming "the page" + plain-language emptiness, and the one-click fix (open the out-of-sync world page).
  const pageOwner = entityPage ? subjectName : null // any PAGED subject owns its page label (faction/item too)
  const declaredEmpty = declaredSilent(finding.declared) // shared with displayKind's gap fork — one silence test
  // Related → the owner's page opens the read-preview DIALOG (same as the map's row gutter), not a NavJump into
  // the World workspace — so reviewing a finding never loses your place in the coherence float.
  const openEntityPage = (): void => {
    if (!entityPage) return
    setPageDialog({ path: entityPage.path, title: entityPage.name, kind: entityPage.kind })
  }
  // Clicking a name in a finding opens that character's arc SCOPED to this finding's chapter (its Where),
  // so you land on the relevant window instead of their whole arc.
  const openArcScoped = (id: string): void => selectArc(id, whereKeys[0])

  return (
    <div className="flex flex-col">
      <div className="px-6 py-4">
        <div className="mx-auto max-w-3xl space-y-4 text-[13px]">
          {/* One header for every host — the TRAIT title + the Where. NO kind/severity chip and NO subject name:
              the selected feed row beside this card already carries the kind chip (severity-toned), and the float's
              title IS the subject — repeating them here was the redundancy sweep's finding (2026-08-14). */}
          <div className="space-y-1">
            <div className="text-[13.5px] font-medium leading-snug text-foreground text-balance">{finding.trait}</div>
            {whereLabels.length > 0 && <p className="text-[11px] text-faint">{whereLabels.join(', ')}</p>}
          </div>

          {/* The mismatch — page vs scenes (fidelity), earlier fact vs later break (plot holes), or setup vs
              payoff (critique). THIS is the finding; the labels track the family so each card speaks its truth. */}
          <div className="space-y-3">
            <div>
              <DetailLabel>{CRITIQUE.has(finding.kind) ? t('review.setsUp') : CONTINUITY.has(finding.kind) ? t('review.earlier') : pageOwner ? t('review.ownersPage', { owner: pageOwner }) : t('review.pageSays')}</DetailLabel>
              <p className={DETAIL_PROSE}>
                {declaredEmpty ? (
                  <span className="italic text-faint">{t('review.noMention')}</span>
                ) : (
                  <AnchoredProse text={finding.declared} names={names} onName={openArcScoped} threads={threads ?? []} onThread={onInspectThread} sceneById={sceneById} onScene={onScene} />
                )}
              </p>
            </div>
            <div>
              <DetailLabel>{CRITIQUE.has(finding.kind) ? t('review.comesOf') : CONTINUITY.has(finding.kind) ? t('review.later') : t('review.scenesShow')}</DetailLabel>
              <p className={DETAIL_PROSE}><AnchoredProse text={finding.observed || '—'} names={names} onName={openArcScoped} threads={threads ?? []} onThread={onInspectThread} sceneById={sceneById} onScene={onScene} /></p>
            </div>
          </div>

          {/* The NOTE — the assistant's advice, fenced off (amber left-bar) so it never reads as system truth. */}
          {(finding.why || finding.suggestion) && (
            <div className="rounded-md border border-warn/25 border-l-2 border-l-warn/70 bg-warn/6 px-4 py-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-warn/90">
                <Lightbulb className="size-3" /> {t('review.suggestion')}
              </div>
              <div className="space-y-2 text-[13px] italic leading-relaxed text-muted-foreground">
                {finding.why && <p><AnchoredProse text={finding.why} names={names} onName={openArcScoped} threads={threads ?? []} onThread={onInspectThread} sceneById={sceneById} onScene={onScene} /></p>}
                {finding.suggestion && <p className="not-italic text-foreground/80"><AnchoredProse text={finding.suggestion} names={names} onName={openArcScoped} threads={threads ?? []} onThread={onInspectThread} sceneById={sceneById} onScene={onScene} /></p>}
              </div>
            </div>
          )}

          {/* Act — rule the divergence intentional (persists across re-runs). Opening the page is a Related link
              below now, not a competing primary button. */}
          {finding.entityId && (
            <div>
              <button
                onClick={() => void setRuling(finding.entityId as string, finding.trait, !finding.intentional)}
                className={cn('inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium', finding.intentional ? 'border-ok/40 bg-ok/5 text-ok hover:bg-ok/10' : 'border-border text-muted-foreground hover:bg-panel-soft hover:text-foreground')}
                title={finding.intentional ? t('review.intentionalTitleOn') : t('review.intentionalTitleOff')}
              >
                <Check className="size-3.5" /> {finding.intentional ? t('review.intentional') : t('review.markIntentional')}
              </button>
            </div>
          )}

          {/* Related — the page to fix, the scenes that show it, the thread it's on. All as uniform link chips. */}
          <div className="space-y-1.5">
            <DetailLabel>{t('review.related')}</DetailLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {entityPage && (
                <button onClick={openEntityPage} className="inline-flex items-center gap-1 rounded-full border border-character/40 px-2 py-0.5 text-[11px] text-character hover:bg-panel-soft" title={t('review.openOwnersPage', { name: entityPage.name })}>
                  <Pencil className="size-3" /> {t('review.ownersPage', { owner: entityPage.name })}
                </button>
              )}
              {evScenes.map((sc) => (
                <button key={sc.path} onClick={() => onScene(sc)} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-thread hover:bg-panel-soft">
                  {sc.title}
                </button>
              ))}
              {finding.threadId && (
                <button
                  onClick={() => onInspectThread(finding.threadId as string)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] hover:bg-panel-soft"
                  title={t('review.inspectThread')}
                >
                  <Link2 className="size-3 text-thread" />
                  {linkedThread && <span className={cn('size-2 shrink-0 rounded-full', threadVisual(linkedThread.type).bg)} />}
                  <span className="font-mono text-thread">{threadSlug ?? 'thread'}</span>
                </button>
              )}
            </div>

            {/* Chapter-grain evidence: the chapter label + its scenes as chips (analysis read at chapter level). */}
            {evChapterKeys.map((key) => {
              const ch = index.chapters.get(key)
              if (!ch) return null
              const chScenes = ch.sceneIds
                .map((sid) => sceneById.get(sid))
                .filter((s): s is SceneFile => !!s)
                .map((s) => ({ path: s.path, title: s.title }))
              return (
                <div key={key} className="space-y-1">
                  <span className="block text-[10px] uppercase tracking-wide text-faint" title={t('review.chapterEvidenceTitle')}>
                    {ch.title}
                  </span>
                  <div className="flex flex-wrap items-end gap-1.5">
                    {chScenes.length === 0 ? (
                      <span className="text-[11px] text-faint">{t('review.noScenes')}</span>
                    ) : (
                      chScenes.map((sc) => (
                        <button
                          key={sc.path}
                          onClick={() => onScene(sc)}
                          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-thread hover:bg-panel-soft"
                          title={t('review.openScene', { title: sc.title })}
                        >
                          {sc.title}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {pageDialog && <PageReadDialog path={pageDialog.path} kind={pageDialog.kind} title={pageDialog.title} onClose={() => setPageDialog(null)} />}
    </div>
  )
}

/** severity → the shared feed's tone (row chip colour), so coherence rows read like the other detail floats. */
const SEV_TONE: Record<string, FeedTone> = { high: 'flag', medium: 'warn', low: 'muted' }

/** ALL of one SUBJECT's coherence findings on the shared DetailSplitView chrome (same as thread / arc / entity):
 *  a reading-ordered feed of findings on the left, the selected finding's full review on the right. The subject is
 *  a character (entityId) OR — entityId null — the WHOLE STORY: every work-level finding (plot holes, thread
 *  verdicts), so plot holes get the same split-view treatment instead of a bare one-off card. Kind filtering
 *  + oldest/latest sort come from the scaffold's built-in MultiFilter (Category = the finding's kind). */
export function CoherenceDetail({
  entityId,
  focusId,
  onScene,
  onInspectThread,
  onClose
}: {
  entityId: string | null
  focusId?: string | null // the finding that was clicked — pre-select it in the feed
  onScene: (s: ScenePreview) => void
  onInspectThread: (threadId: string) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation('coherence')
  const all = useWorkspace((s) => s.coherence)
  const worldPages = useWorkspace((s) => s.worldPages) // name resolution across all kinds (items/factions too)
  const storyTree = useWorkspace((s) => s.storyTree)
  const index = useMemo(() => buildChapterIndex(storyTree), [storyTree])
  const orderedKeys = useMemo(() => [...index.chapters.keys()], [index])
  const posOf = useMemo(() => new Map(orderedKeys.map((k, i) => [k, i])), [orderedKeys])

  // The subject's real findings (confirmations have nothing to fix), highest-severity first within a chapter.
  // entityId null = the work-level scope: every finding with no entity (plot holes, thread verdicts).
  const list = useMemo(
    () =>
      (all ?? [])
        .filter((f) => (entityId ? f.entityId === entityId : !f.entityId) && f.kind !== 'confirmation')
        .sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity)),
    [all, entityId]
  )
  const name = entityId ? worldPages.find((c) => c.id === entityId)?.name ?? entityId : t('review.wholeStory')

  // Place each finding at its EVIDENCE chapter (where it actually occurs — same rule as the map's byEntity),
  // falling back to the asOf checkpoint only when no evidence resolves. asOf-first banded EVERYTHING under the
  // final volume (the checkpoint is uniform across findings — it's when the run read, not where the issue is).
  const chapterKeyOf = (f: CoherenceFinding): string => {
    for (const ref of f.evidence ?? []) {
      const k = index.resolveKey(ref)
      if (k) return k
    }
    return (f.asOf ? index.resolveKey(f.asOf) : null) ?? ''
  }
  const events: FeedEvent[] = list.map((f) => {
    const chapterKey = chapterKeyOf(f)
    const gloss = kindGloss(displayKind(f.kind, f.declared)) // gap forks → feed chips + Category filter split too
    return {
      id: f.id,
      chapterKey,
      pos: posOf.get(chapterKey) ?? 1e9,
      title: f.trait,
      summary: f.observed || f.declared || gloss.blurb,
      detail: <CoherenceReview finding={f} onScene={onScene} onInspectThread={onInspectThread} />,
      detailOwnsHeader: true, // the card renders its own chip/question/trait — one layout in every host
      kind: gloss.label,
      tone: SEV_TONE[f.severity] ?? 'muted',
      category: gloss.label // drives the scaffold's built-in Category filter (by kind)
    }
  })
  const chapters: FeedChapter[] = orderedKeys.map((k, i) => ({ key: k, title: index.chapters.get(k)?.title ?? k, pos: i }))
  // A tail band so any finding that couldn't be placed in a chapter still shows (never silently dropped).
  if (events.some((e) => e.chapterKey === '')) chapters.push({ key: '', title: t('detail.unplaced'), pos: orderedKeys.length })

  return (
    <DetailSplitView
      onClose={onClose}
      icon={<span className="size-2 shrink-0 rounded-full bg-flag" />}
      title={name}
      tabs={[{ id: 'findings', label: t('detail.tabFindings'), icon: <Rows3 className="size-3.5" />, count: list.length }]}
      tab="findings"
      onTab={() => {}}
      chapters={chapters}
      events={events}
      isFeed
      focusId={focusId ?? list[0]?.id ?? null}
    />
  )
}

const SEV = ['high', 'medium', 'low']
