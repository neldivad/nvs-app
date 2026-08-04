/**
 * Coherence workspace — triage surface for where the story drifts/contradicts/leaves a hole vs what a
 * page or thread declares (T2/T3). The sidebar (CoherenceSidebar) is the roster; this main area is the
 * **page review**: pick a finding → it fills the main editor area (declared vs observed, evidence scenes,
 * suggestion, links to the entity page / the thread). Rendered inline (not a floating pane) so it never
 * collides with the Thread floating when you "Inspect thread". Scene-preview dialog lives at the panel root.
 */
import { useMemo, useState, type JSX } from 'react';
import { regionAttrs } from '@/config/regions'
import { Check, ChevronRight, Lightbulb, Link2, Pencil, X } from 'lucide-react'
import { EmptyRailState } from '@/components/ui/EmptyRailState'
import { useWorkspace } from '@/stores/workspace'
import { severityVisual, severityWash, kindLabel, kindGloss, severityLabel, chapterNum } from '@/config/coherenceVisual'
import { threadVisual } from '@/config/threadVisual'
import { cn } from '@/lib/utils'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { Annotated, type NameRef } from '@/components/ui/Annotated'
import { RailHeader } from '@/components/ui/RailHeader'
import { DetailLabel, DETAIL_PROSE, DetailSortToggle } from '@/components/ui/detail'
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
import type { CoherenceFinding, SceneFile } from '@shared/ipc'

type ScenePreview = { path: string; title: string }

export function CoherencePanel(): JSX.Element {
  const findings = useWorkspace((s) => s.coherence)
  const select = useWorkspace((s) => s.setSelectedFinding)

  // The selected finding's detail opens in the app-level CoherenceDetailFloat (like the thread/arc floats),
  // so this panel is ALWAYS the map — selecting a cell pops the float, no inline page.
  return (
    <div {...regionAttrs('coherencePanel')} className="relative flex min-h-0 flex-1 flex-col">
      {/* Deterministic structural pass — instant, no-LLM, runs regardless of coherence-analysis state. */}
      <StructuralChecks />
      {findings == null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8"><p className="text-sm text-muted-foreground">Loading…</p></div>
      ) : findings.length === 0 ? (
        <EmptyRailState rail="coherence" />
      ) : (
        <CoherenceMap findings={findings} onSelect={select} />
      )}

      <RailChrome
        region="coherencePanel"
        name="Coherence"
        layers={['chapters']}
        export={{ file: 'coherence-rail', caption: () => 'Coherence — findings' }}
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
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const worldPages = useWorkspace((s) => s.worldPages) // all kinds — entity coherence rows items/factions too
  const chapterWrap = useWorkspace((s) => s.ganttLayers.chapters)
  // The Highlight filter lives in the store (not local) so the detail float truncates to the same category.
  const kindFilter = useWorkspace((s) => s.coherenceKind)
  const setKindFilter = useWorkspace((s) => s.setCoherenceKind)
  const [preview, setPreview] = useState<{ path: string; title: string; kind: string } | null>(null)
  // The Highlight chips are DERIVED from the kinds actually present (Fidelity drift/gap/contradiction AND the
  // continuity plot-hole kinds), so the filter always lists every category the findings contain — not a fixed set.
  // Confirmations (positive "on track" verdicts) aren't a triage category, so they're excluded.
  const kindsPresent = useMemo(() => {
    const order = ['contradiction', 'drift', 'gap', 'continuity-error', 'logic-gap', 'rule-break'] // Fidelity then plot-holes
    const seen = new Set<string>()
    for (const f of findings) if (!f.intentional && f.kind !== 'confirmation') seen.add(f.kind)
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
        const disabled = kindFilter != null && ![...chMap.values()].flat().some((f) => f.kind === kindFilter)
        const pg = pageById.get(eid) // the NAME cell → the entity's PAGE (declared profile)
        const { Icon: KindIcon, text: kindColor } = entityVisual(pg?.kind ?? 'character') // tag the row's type: character · item · …
        return {
          key: eid,
          gutter: (
            <button
              disabled={disabled}
              onClick={() => { if (pg) setPreview({ path: pg.path, title: pg.name, kind: pg.kind }) }}
              className={cn('flex h-full w-full items-center gap-2 border-l-2 border-transparent pr-2 pl-1.5 text-left', disabled && 'opacity-30')}
              title={disabled ? `${nameOf.get(eid) ?? eid} — no ${kindLabel(kindFilter!)}` : `${nameOf.get(eid) ?? eid} — ${pg?.kind ?? 'character'} · open page`}
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
                  onClick={() => onSelect((kindFilter ? fs.find((f) => f.kind === kindFilter) : null)?.id ?? fs[0].id)}
                  title={`${nameOf.get(eid) ?? eid} · ${range.title}: ${fs.map((f) => f.trait).join('; ')}`}
                  className={cn('absolute top-1/2 flex h-4 -translate-y-1/2 items-center gap-0.5 overflow-hidden rounded-sm border border-border bg-panel-soft px-1', disabled && 'opacity-30')}
                  style={{ left: min * colW + 1, width }}
                >
                  {shown.map((f, k) => (
                    <span key={k} className={cn('size-1.5 shrink-0 rounded-full', severityVisual(f.severity).dot, kindFilter && f.kind !== kindFilter && 'opacity-20')} />
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
        <span className="text-faint">Highlight</span>
        {kindsPresent.map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(kindFilter === k ? null : k)}
            className={cn('rounded-full border px-2 py-0.5', kindFilter === k ? 'border-foreground/40 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
          >
            {kindGloss(k).label}
          </button>
        ))}
        {kindFilter && (
          <button onClick={() => setKindFilter(null)} className="text-faint hover:text-foreground">clear</button>
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
        page={{ from: scoped.from, to: scoped.to, total: scoped.total, noun: 'characters', page: scoped.page, pageCount: scoped.pageCount, onPage: setPage }}
        metric={{
          label: 'Range',
          min: 1,
          max: maxFind,
          value: [loFind, hiFind],
          onChange: setFindWin,
          readout: findAll ? 'all' : `${loFind}${loFind !== hiFind ? `–${hiFind}` : ''}`,
          onReset: findAll ? undefined : () => setFindWin(null),
          title: 'Trim rows by finding count — drag the low thumb up to hide lightly-flagged characters and focus the most-flagged.'
        }}
      />
      {preview && <PageReadDialog path={preview.path} kind={preview.kind} title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  )
}


function CoherenceHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Coherence — how it works" size="detail">
      <div className="space-y-5">
        <HelpSection title="What it flags">
          <HelpList
            items={[
              <>Each finding compares what a <b className="text-foreground/80">page says</b> (a character or thread's declared profile) against what your <b className="text-foreground/80">scenes show</b> — read at chapter checkpoints.</>,
              <>It's the analysis agent's reading, not authored truth — a queue of places to check, never a verdict you have to obey.</>
            ]}
          />
        </HelpSection>
        <HelpSection title="Reading a finding">
          <HelpTable
            rows={[
              ['category', 'the kind chip — Contradiction · Drift · Gap · Plot hole · Open hook · Confirmation'],
              ['severity', 'the triage color — high · medium · low (what to weigh first)'],
              ['Subject', 'who/what it concerns — a character, a thread, or the whole story'],
              ['Where', 'the chapter the issue actually occurs in (drawn from its evidence)'],
              ['Analyzed through', 'how far the run read — the same for every finding, so not where the issue is'],
              ['page says / scenes show', 'the declared profile vs the prose — the heart of the flag']
            ]}
          />
        </HelpSection>
        <HelpSection title="Acting on it">
          <HelpList
            items={[
              <><b className="text-foreground/80">Open …'s page</b> — edit the profile that's out of sync (the fix the finding points at).</>,
              <><b className="text-foreground/80">Verify in scenes</b> — open the scenes it draws on and read the prose for yourself before changing anything.</>,
              <><b className="text-foreground/80">Inspect thread</b> — jump to the thread a finding is about.</>,
              <>The amber <b className="text-foreground/80">Suggestion</b> is the assistant's read — fenced off from the facts on purpose. It's advice, your call.</>
            ]}
          />
        </HelpSection>
        <HelpSection title="Confirmation">
          <HelpList items={[<><b className="text-foreground/80">Confirmation</b> findings are consistency <i>confirmed</i> — nothing to fix; they sink to the bottom of the roster.</>]} />
        </HelpSection>
      </div>
    </Dialog>
  )
}

/** The selected finding, reviewed in the main area — declared vs observed + evidence + links out. */
export function CoherenceReview({
  finding,
  onScene,
  onInspectThread,
  embedded
}: {
  finding: CoherenceFinding
  onScene: (s: ScenePreview) => void
  onInspectThread: (threadId: string) => void
  embedded?: boolean // stacked inside a FindingBlock card (which owns the kind/severity header); sizes to content
}): JSX.Element {
  const scenes = useWorkspace((s) => s.scenes)
  const characters = useWorkspace((s) => s.characters)
  const worldPages = useWorkspace((s) => s.worldPages) // entity findings (item/faction) resolve pages here
  const threads = useWorkspace((s) => s.threads)
  const storyTree = useWorkspace((s) => s.storyTree)
  const selectArc = useWorkspace((s) => s.setSelectedArc) // open the character's arc float (like the thread rail), not the page
  const openPage = useWorkspace((s) => s.openPage)
  const setRuling = useWorkspace((s) => s.setCoherenceRuling)
  const setWorkspace = useWorkspace((s) => s.setWorkspace)

  const v = severityVisual(finding.severity)
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes])
  const entityPage = finding.entityId ? worldPages.find((c) => c.id === finding.entityId) ?? null : null
  const linkedThread = finding.threadId ? threads?.find((t) => t.id === finding.threadId) ?? null : null
  // slug = thread's human handle, or the last segment of the id if the thread list isn't loaded.
  const threadSlug = linkedThread?.slug ?? (finding.threadId ? finding.threadId.split(':').pop() : null)

  // The reader-facing classifiers (de-jargoned): Category + plain blurb, Subject, As-of chapter.
  const gloss = kindGloss(finding.kind)
  const subjectKind = finding.entityId ? 'Character' : finding.threadId ? 'Thread' : 'Story'
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
  const pageOwner = subjectKind === 'Character' ? subjectName : null
  const declaredEmpty = !finding.declared || /^\(?\s*(unstated|not stated|unmentioned|none|n\/?a|silent|[—-])\s*\)?$/i.test(finding.declared.trim())
  const openEntityPage = (): void => {
    if (!entityPage) return
    void openPage({ path: entityPage.path, title: entityPage.name, kind: entityPage.kind })
    setWorkspace('world')
  }
  // Clicking a name in a finding opens that character's arc SCOPED to this finding's chapter (its Where),
  // so you land on the relevant window instead of their whole arc.
  const openArcScoped = (id: string): void => selectArc(id, whereKeys[0])

  return (
    <div className={cn('flex flex-col', embedded ? '' : 'min-h-0 flex-1')}>
      <div className={cn('px-6', embedded ? 'py-4' : 'min-h-0 flex-1 overflow-auto py-5')}>
        <div className="mx-auto max-w-3xl space-y-4 text-[13px]">
          {/* Header — one kind·severity pill (dropped when stacked in a FindingBlock, whose card header already
              carries it), the plain trait, and a LIGHT subject·where line (no dl grid, no "analyzed-through"
              noise, no gloss paragraph — the two sides below make the finding self-explanatory). */}
          {!embedded && (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-current/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', v.text)}>
              <span className={cn('size-1.5 rounded-full', v.dot)} /> {gloss.label} · {severityLabel(finding.severity)}
            </span>
          )}
          <div>
            <div className="text-[15px] font-medium text-foreground">{finding.trait}</div>
            <p className="mt-1 text-[11px] text-faint">
              {subjectKind === 'Story' ? 'The whole story' : `${subjectKind}${subjectName ? ` · ${subjectName}` : ''}`}
              {whereLabels.length > 0 && <> · {whereLabels.join(', ')}</>}
            </p>
          </div>

          {/* The mismatch — page vs scenes. This IS the finding. */}
          <div className="space-y-3">
            <div>
              <DetailLabel>{pageOwner ? `${pageOwner}’s page` : 'The page'}</DetailLabel>
              <p className={DETAIL_PROSE}>
                {declaredEmpty ? (
                  <span className="italic text-faint">doesn’t mention this</span>
                ) : (
                  <Annotated text={finding.declared} names={names} onName={openArcScoped} threads={threads ?? []} onThread={onInspectThread} />
                )}
              </p>
            </div>
            <div>
              <DetailLabel>The scenes show</DetailLabel>
              <p className={DETAIL_PROSE}><Annotated text={finding.observed || '—'} names={names} onName={openArcScoped} threads={threads ?? []} onThread={onInspectThread} /></p>
            </div>
          </div>

          {/* Act — fix the out-of-sync page, or rule the divergence intentional (persists across re-runs). */}
          <div className="flex flex-wrap items-center gap-2">
            {entityPage && (
              <button onClick={openEntityPage} className="inline-flex items-center gap-1.5 rounded-md border border-character/40 bg-character/5 px-3 py-1.5 text-[12px] font-medium text-character hover:bg-character/10">
                <Pencil className="size-3.5" /> Open {entityPage.name}’s page
              </button>
            )}
            {finding.entityId && (
              <button
                onClick={() => void setRuling(finding.entityId as string, finding.trait, !finding.intentional)}
                className={cn('inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium', finding.intentional ? 'border-ok/40 bg-ok/5 text-ok hover:bg-ok/10' : 'border-border text-muted-foreground hover:bg-panel-soft hover:text-foreground')}
                title={finding.intentional ? 'Ruled intentional — click to resume flagging' : 'By design (a deception/twist)? Rule it intentional so re-runs stay quiet'}
              >
                <Check className="size-3.5" /> {finding.intentional ? 'Intentional' : 'Mark intentional'}
              </button>
            )}
          </div>

          {/* Verify — the scenes that show it (exact scenes link directly; chapter-grain evidence expands below). */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Verify in scenes</span>
              {evScenes.map((sc) => (
                <button key={sc.path} onClick={() => onScene(sc)} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-thread hover:bg-panel-soft">
                  {sc.title}
                </button>
              ))}
              {finding.threadId && (
                <button
                  onClick={() => onInspectThread(finding.threadId as string)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] hover:bg-panel-soft"
                  title="Inspect the thread"
                >
                  <Link2 className="size-3 text-thread" />
                  {linkedThread && <span className={cn('size-2 shrink-0 rounded-full', threadVisual(linkedThread.type).bg)} />}
                  <span className="font-mono text-thread">{threadSlug ?? 'thread'}</span>
                </button>
              )}
            </div>

            {/* Chapter-grain evidence: the chapter label on its own row, its scenes as chips beneath (the
                analysis read at chapter level, so we surface the whole chapter — pick the scene that matches). */}
            {evChapterKeys.map((key) => {
              const ch = index.chapters.get(key)
              if (!ch) return null
              const chScenes = ch.sceneIds
                .map((sid) => sceneById.get(sid))
                .filter((s): s is SceneFile => !!s)
                .map((s) => ({ path: s.path, title: s.title }))
              return (
                <div key={key} className="space-y-1">
                  <span className="block text-[10px] uppercase tracking-wide text-faint" title="Read at chapter level — pick the scene that matches">
                    {ch.title}
                  </span>
                  <div className="flex flex-wrap items-end gap-1.5">
                    {chScenes.length === 0 ? (
                      <span className="text-[11px] text-faint">no scenes found</span>
                    ) : (
                      chScenes.map((sc) => (
                        <button
                          key={sc.path}
                          onClick={() => onScene(sc)}
                          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-thread hover:bg-panel-soft"
                          title={`Open “${sc.title}”`}
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

          {/* The NOTE — the assistant's free advice, visually fenced off from the facts above so it
              never reads as system truth. Amber left-bar + lightbulb + "your call" framing. */}
          {(finding.why || finding.suggestion) && (
            <div className="rounded-md border border-warn/25 border-l-2 border-l-warn/70 bg-warn/6 px-4 py-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-warn/90">
                <Lightbulb className="size-3" /> Suggestion — the assistant’s read, your call
              </div>
              <div className="space-y-2 text-[12.5px] italic leading-relaxed text-muted-foreground">
                {finding.why && <p><Annotated text={finding.why} names={names} onName={openArcScoped} /></p>}
                {finding.suggestion && <p className="not-italic text-foreground/80"><Annotated text={finding.suggestion} names={names} onName={openArcScoped} /></p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** ALL of one character's coherence findings, stacked (like the arc float lists a character's windows). A cell
 *  with two findings opens this and shows both — no more "fs[0] only". Falls back to a single card for a
 *  thread-verdict finding (no entity). */
export function CoherenceDetail({
  entityId,
  onScene,
  onInspectThread,
  onClose
}: {
  entityId: string | null
  onScene: (s: ScenePreview) => void
  onInspectThread: (threadId: string) => void
  onClose: () => void
}): JSX.Element {
  const all = useWorkspace((s) => s.coherence)
  const worldPages = useWorkspace((s) => s.worldPages) // name resolution across all kinds (items/factions too)
  const kindFilter = useWorkspace((s) => s.coherenceKind)
  const setKindFilter = useWorkspace((s) => s.setCoherenceKind)
  const [oldestFirst, setOldestFirst] = useState(false) // order by checkpoint chapter; default latest first
  const mine = useMemo(() => {
    const chOf = (f: CoherenceFinding): number => { const n = chapterNum(f.asOf ?? ''); return n ? parseInt(n, 10) : 0 }
    return (all ?? [])
      .filter((f) => f.entityId === entityId && f.kind !== 'confirmation')
      .sort((a, b) => (oldestFirst ? chOf(a) - chOf(b) : chOf(b) - chOf(a)) || SEV.indexOf(a.severity) - SEV.indexOf(b.severity))
  }, [all, entityId, oldestFirst])
  // Honor the map's Highlight filter — show only that category here too. If the filter would empty the
  // float (the cell had no matching finding), fall back to all so it never reads as blank.
  const matched = kindFilter ? mine.filter((f) => f.kind === kindFilter) : mine
  const list = matched.length > 0 ? matched : mine
  const name = worldPages.find((c) => c.id === entityId)?.name ?? entityId ?? 'Coherence'
  // Kinds to offer as toggle chips — those present; shown only when there's a real choice (≥2) or one is active.
  const kindChips = (() => {
    const kinds = [...new Set(mine.map((f) => f.kind))]
    return kinds.length >= 2 || kindFilter ? kinds : []
  })()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2">
        {/* Title row — always single-line (name truncates). */}
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
          <span className="shrink-0 text-[11px] text-faint">{list.length} finding{list.length === 1 ? '' : 's'}</span>
          <div className="flex-1" />
          <DetailSortToggle oldestFirst={oldestFirst} onToggle={() => setOldestFirst((v) => !v)} />
          <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground" title="Close">
            <X className="size-4" />
          </button>
        </div>
        {/* Kind filter — its OWN wrapping row (re-appliable toggles, never overflows the title). Shown when
            this character has more than one kind, or a filter is currently active. */}
        {kindChips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {kindChips.map((k) => {
              const on = kindFilter === k
              return (
                <button
                  key={k}
                  onClick={() => setKindFilter(on ? null : k)}
                  className={cn('rounded-full border px-2 py-0.5 text-[10px] capitalize', on ? 'border-foreground/40 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
                  title={on ? 'Showing only this — click to show all' : `Filter to ${kindLabel(k)}`}
                >
                  {kindLabel(k)}{on ? ' ✕' : ''}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {/* Stacked findings as a SPINE of collapsible cards (same grammar as the thread/arc sheets): a severity
          badge on the rail, a severity-tinted header, collapsed = trait + a clamp, expand = the full review. */}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {list.map((f, i) => (
          <FindingBlock key={f.id} f={f} last={i === list.length - 1} onScene={onScene} onInspectThread={onInspectThread} />
        ))}
      </div>
    </div>
  )
}

/**
 * One finding as a card on the coherence spine (CoherenceDetail's per-character list). Collapsed: a severity-
 * tinted header (category + severity) + the trait headline and a 2-line clamp of what the scenes show — the
 * roster reads at a glance. Expanding reveals the full CoherenceReview (its own top strip suppressed, since the
 * header owns category/severity) and a bottom Collapse. Same grammar as the thread/arc sheets — but coherence is
 * a triage LIST, so there's no "terminal" treatment; the rail is just visual kinship.
 */
function FindingBlock({
  f,
  last,
  onScene,
  onInspectThread
}: {
  f: CoherenceFinding
  last: boolean
  onScene: (s: ScenePreview) => void
  onInspectThread: (threadId: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const v = severityVisual(f.severity)
  const gloss = kindGloss(f.kind)
  return (
    <div className="flex gap-1.5">
      {/* rail — a severity badge (matching the roster), then the connector to the next finding */}
      <div className="flex w-4 flex-col items-center">
        <span className={cn('z-10 mt-1.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-current/40 bg-panel', v.text)} title={f.severity}>
          <span className={cn('size-1.5 rounded-full', v.dot)} />
        </span>
        {!last && <span className="w-px flex-1 bg-border/70" />}
      </div>

      <div className="relative min-w-0 flex-1 pb-3">
        <span className="absolute -left-1.5 top-3 h-px w-1.5 bg-border/70" />
        <div className="overflow-hidden rounded-lg border border-border">
          {/* severity-tinted header — category + severity (click toggles) */}
          <div onClick={() => setOpen((o) => !o)} className={cn('flex cursor-pointer items-center gap-2 px-2.5 py-1.5', severityWash(f.severity))}>
            <span className={cn('shrink-0 text-[10px] font-semibold uppercase tracking-wide', v.text)}>{gloss.label}</span>
            <div className="flex-1" />
            <span className="shrink-0 text-[9px] uppercase tracking-wide text-faint">{severityLabel(f.severity)}</span>
            {!open && <ChevronRight className="size-3.5 shrink-0 text-faint" />}
          </div>

          {!open ? (
            <div onClick={() => setOpen(true)} className="cursor-pointer space-y-1 px-3 py-2">
              <p className="text-[12.5px] font-medium text-foreground">{f.trait}</p>
              <p className="line-clamp-2 text-[12px] text-faint">{f.observed || f.declared || gloss.blurb}</p>
            </div>
          ) : (
            <div>
              <CoherenceReview embedded finding={f} onScene={onScene} onInspectThread={onInspectThread} />
              <button onClick={() => setOpen(false)} className="flex w-full items-center justify-center gap-1 border-t border-border/50 px-3 pb-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint hover:text-foreground">
                <ChevronRight className="size-3 -rotate-90" /> Collapse
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const SEV = ['high', 'medium', 'low']
