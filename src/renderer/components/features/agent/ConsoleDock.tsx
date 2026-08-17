/**
 * The bottom console (VS Code terminal-panel slot). NOT a mirror of the Threads/Coherence rails —
 * that's redundant. This is the home for *operational* surfaces: triggering analysis, inspecting the
 * co-located DB, and (later) agent/MCP output. The **Ingest** tab is live (the canon-set tracer +
 * bundle runner over `writeTier`); Database/Agent are still placeholders. Collapsed by default (L16).
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { useTranslation, Trans } from 'react-i18next'
import type { TFunction } from 'i18next'
import { regionAttrs } from '@/config/regions'
import { Bot, Camera, Check, ChevronRight, Circle, ClipboardCheck, Copy, Cpu, Database, Eye, HeartPulse, HelpCircle, History, Key, Loader2, Minus, MoreHorizontal, Play, Plug, Plus, RefreshCw, RotateCcw, ShieldAlert, Terminal, Trash2, XCircle } from 'lucide-react'
import type { AiConnection, AiConnectionStatus, AiProviderType, AiState, CoherenceStatusRow, DbTable, IngestProgress, IngestSession, IngestStep, McpStatus, SaveConnectionInput, TierStatusRow, TimelineStatus } from '@shared/ipc'
import { AI_PROVIDERS, PROVIDER_TYPES } from '@shared/config/aiProviders'
import { analysisReadinessPrompt, dbHealthPrompt } from '@shared/config/chatPrompts'
import { AnalysisRunDialog } from '@/components/features/analysis/AnalysisRunDialog'
import { CoherenceRunDialog } from '@/components/features/coherence/CoherenceRunDialog'
import { AnalysisHistoryDialog } from '@/components/features/analysis/AnalysisHistoryDialog'
import { STATUS_COLOR, STATUS_LABEL, freshnessCounts, healthLine, outdatedCount } from '@shared/config/ingest'
import { useWorkspace } from '@/stores/workspace'
import { ConsoleHelp } from '@/components/features/agent/ConsoleHelp'
import { ConfirmDialog } from '@/components/ui/confirm'
import { HelpTable } from '@/components/ui/help'
import { ExternalLink } from '@/components/ui/ExternalLink'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'

type Tab = 'ingest' | 'database' | 'agent'

const PROV_CHIP_CAP = 24 // most chips a version's provenance renders inline; the rest collapse to "+N more"
const SCENE_ROW_CAP = 80 // initial rows the All-scenes table paints; "show more" reveals another batch
const RUNQUEUE_CAP = 24 // most step rows the live queue paints — a window near the frontier, not all N

// Database is a raw-records DEBUG surface — hidden from users (dev-only) so the console stays uncluttered;
// the north star is an undistracted writing space, not a DB browser. Flip on in dev builds.
const TABS: { id: Tab; labelKey: string; icon: typeof Play }[] = [
  { id: 'ingest', labelKey: 'tab.analysis', icon: Play },
  ...(import.meta.env.DEV ? [{ id: 'database' as const, labelKey: 'tab.database', icon: Database }] : []),
  { id: 'agent', labelKey: 'tab.agent', icon: Bot }
]

export function ConsoleDock(): JSX.Element {
  const { t } = useTranslation('console')
  const project = useWorkspace((s) => s.project)
  const tab = useWorkspace((s) => s.dockTab) // lifted so the rail freshness badge can deep-link here
  const setTab = useWorkspace((s) => s.setDockTab)
  const [help, setHelp] = useState(false)

  return (
    <div {...regionAttrs('consoleDock')} className="relative flex h-full flex-col bg-canvas" style={{ userSelect: 'text' }}>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors',
              tab === tb.id ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
            )}
          >
            <tb.icon className="size-3.5" />
            {t(tb.labelKey)}
          </button>
        ))}
        <button
          onClick={() => setHelp(true)}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-panel-soft"
          title={t('header.help')}
        >
          <HelpCircle className="size-3.5" />
        </button>
      </div>

      {!project ? (
        <Centered>{t('empty.noProject')}</Centered>
      ) : tab === 'ingest' ? (
        <IngestTab />
      ) : tab === 'agent' ? (
        <AgentTab />
      ) : tab === 'database' && import.meta.env.DEV ? (
        <DbInspectorTab />
      ) : (
        <IngestTab />
      )}

      <ConsoleHelp open={help} onClose={() => setHelp(false)} />
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

function IngestTab(): JSX.Element {
  const { t } = useTranslation('console')
  const [rows, setRows] = useState<TierStatusRow[]>([])
  const [cohRows, setCohRows] = useState<CoherenceStatusRow[]>([])
  const [hasAi, setHasAi] = useState<boolean | undefined>(undefined)
  const [connLabel, setConnLabel] = useState<string | null>(null) // the active connection (for the cost confirm)
  const [runDialog, setRunDialog] = useState(false) // the pre-run gate (mode + connection estimates)
  const [cohRunDialog, setCohRunDialog] = useState(false) // the coherence-run gate (sibling of the analysis one)
  const [historyOpen, setHistoryOpen] = useState(false) // the per-run history view (what each past run analyzed)
  const [moreOpen, setMoreOpen] = useState(false) // header ⋯ overflow
  const [resetConfirm, setResetConfirm] = useState(false)
  const [showScenes, setShowScenes] = useState(false)
  const [sceneLimit, setSceneLimit] = useState(SCENE_ROW_CAP) // how many All-scenes rows are painted (bounded)
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(() => new Set()) // manual re-analyze picks
  const [reanalyzeConfirm, setReanalyzeConfirm] = useState(false)
  const toggleScene = (id: string): void =>
    setSelectedScenes((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const reanalyze = (): void => {
    void startIngestRun([...selectedScenes]) // force-read the picks even if they're fresh (e.g. after a model switch)
    setSelectedScenes(new Set())
  }
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set()) // version rows showing their provenance
  const toggleExpanded = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const domain = useWorkspace((s) => s.projectInfo?.domain) ?? 'fiction'
  const freshnessVersion = useWorkspace((s) => s.freshnessVersion)
  const progress = useWorkspace((s) => s.ingestProgress)
  const sessions = useWorkspace((s) => s.ingestSessions)
  const currentVersion = useWorkspace((s) => s.currentVersion)
  const viewingVersion = useWorkspace((s) => s.viewingVersion)
  const viewVersion = useWorkspace((s) => s.viewVersion)
  const startIngestRun = useWorkspace((s) => s.startIngestRun)
  const resetAnalysis = useWorkspace((s) => s.resetAnalysis)
  const setChatDraft = useWorkspace((s) => s.setChatDraft)
  const setChatOpen = useWorkspace((s) => s.setChatOpen)
  // Preflight: prefill the chat with the read-only readiness audit (config/chatPrompts) — author reviews + sends.
  const checkReadiness = (): void => {
    setChatDraft(analysisReadinessPrompt())
    setChatOpen(true)
  }
  const revertIngestSession = useWorkspace((s) => s.revertIngestSession)
  const loadIngestSessions = useWorkspace((s) => s.loadIngestSessions)

  const [tl, setTl] = useState<TimelineStatus | null>(null) // timeline graph freshness (leads_to edits + cycle)
  const reload = useCallback(async () => {
    const [s, coh, ai, tlStatus] = await Promise.all([window.nvs.listTierStatus(), window.nvs.coherenceStatus(), window.nvs.aiConnections(), window.nvs.timelineStatus()])
    setRows(s)
    setCohRows(coh)
    setHasAi(ai.activeId != null)
    setTl(tlStatus)
    const active = ai.connections.find((c) => c.id === ai.activeId)
    setConnLabel(active ? active.label || active.model : null)
  }, [])

  // Auto-refresh on mount AND whenever freshness may have changed (a save, a run) — no manual recheck.
  useEffect(() => {
    void reload()
    void loadIngestSessions()
  }, [reload, loadIngestSessions, freshnessVersion])

  const counts = freshnessCounts(rows)
  const dirty = outdatedCount(counts)
  const cohDirty = cohRows.filter((r) => r.status !== 'fresh').length // characters whose page/arc moved
  const graphStale = tl?.stale ?? false // the leads_to GRAPH was edited since the last run (may be 0 dirty scenes)
  const graphCycle = (tl?.cycle?.length ?? 0) > 0 // a leads_to loop — analysis can't cleanly walk the graph
  const running = progress?.active ?? false
  const health = healthLine(counts, { hasAi })
  const headDot = dirty > 0 || graphStale ? STATUS_COLOR.stale : counts.total > 0 ? STATUS_COLOR.fresh : STATUS_COLOR.pending
  const viewing = !!viewingVersion && viewingVersion !== currentVersion // viewing a PAST version (read-only)
  // A graph edit needs a re-run too, not just scene edits. AND fresh-but-skim scenes keep the door OPEN — a Fast
  // run leaves everything "fresh" (dirty=0), but an Expert pass can still deepen them (build arcs/profiles); if the
  // button locked here, that path would be unreachable (you switch Fast↔Expert INSIDE the dialog).
  const canRun = (dirty > 0 || graphStale || counts.skim > 0) && !running && !viewing
  // When the ONLY work is a skim→Expert deepen (no edits, no graph change), open the dialog in Expert so the
  // upgrade is front-and-centre instead of hidden behind the mode toggle. Else let the dialog use its saved mode.
  const openDepth = dirty === 0 && !graphStale && counts.skim > 0 ? ('full' as const) : undefined
  const canCheckCoherence = cohRows.length > 0 && !running && !viewing // coherence diffs the current version too

  // Drop no-op runs (nothing applied, nothing written) — they shouldn't be versions. New runs already
  // suppress these; this also hides the legacy no-op coherence skips recorded before suppression existed.
  const shown = sessions.filter((s) => s.ok > 0 || s.rowsWritten > 0)
  // The timeline is the ANALYSIS spine; coherence runs hang off the analysis version they diffed (basedOn).
  const analysisSessions = shown.filter((s) => s.kind !== 'coherence')
  const analysisIds = new Set(analysisSessions.map((a) => a.id))
  const cohChildren = new Map<string, IngestSession[]>()
  const orphanCoh: IngestSession[] = []
  for (const s of shown)
    if (s.kind === 'coherence') {
      if (s.basedOn && analysisIds.has(s.basedOn)) cohChildren.set(s.basedOn, [...(cohChildren.get(s.basedOn) ?? []), s])
      else orphanCoh.push(s) // legacy / parent pruned — shown at the bottom so nothing's lost
    }
  // Coherence is "behind" when the newest check was computed against an older analysis than the current one.
  const latestCoh = shown.find((s) => s.kind === 'coherence')
  const coherenceBehind = !!latestCoh && latestCoh.basedOn !== currentVersion
  const canonRows = rows.filter((r) => !r.phase || r.phase === 'canon') // only canon scenes are re-analyzable
  const allScenesSelected = canonRows.length > 0 && selectedScenes.size === canonRows.length
  // Status detail: only the non-zero segments — "120 up to date" when clean, not "…· 0 outdated · 0 not read".
  const statusDetail = [
    t('statusDetail.upToDate', { n: counts.fresh }),
    counts.stale ? t('statusDetail.outdated', { n: counts.stale }) : null,
    counts.pending ? t('statusDetail.notRead', { n: counts.pending }) : null,
    counts.draft ? t('statusDetail.draft', { n: counts.draft }) : null
  ].filter(Boolean).join(' · ')

  // Non-fiction is deterministic-only for now: the AI analysis run (T2/T3) is off — a conversation surfaces
  // speaker VOLUME (Cast) + Timeline straight from the transcript (T1). Custom/deep analysis is a future
  // agent-invokable skill, not an auto-run everyone pays latency for. So skip the whole run/coherence/rebuild UI.
  if (domain === 'nonfiction')
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
        <span className="text-[12px] font-medium text-foreground/90">{t('nonfiction.title')}</span>
        <span className="max-w-sm text-[11px] leading-snug text-muted-foreground">
          <Trans t={t} i18nKey="nonfiction.body" components={{ b: <b /> }} />
        </span>
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Health header: the one-line status + the single Update action */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2">
        {running ? (
          <Loader2 className="size-3.5 animate-spin text-thread" />
        ) : (
          <span className="inline-block size-2 rounded-full" style={{ backgroundColor: headDot }} />
        )}
        <span className="text-[12px] font-medium text-foreground/90">{running ? t('health.updating') : health}</span>
        <span className="text-[10px] text-faint">{statusDetail}</span>

        <div className="ml-auto flex items-center gap-2">
          {hasAi === false && !running && <span className="max-w-60 text-[10px] text-faint">{t('health.noAi')}</span>}
          {running ? (
            <button
              onClick={() => void window.nvs.cancelIngestRun()}
              title={t('run.stopTip')}
              className="flex items-center gap-1.5 rounded-md border border-flag/50 bg-flag/10 px-2.5 py-1 text-[11px] text-foreground hover:bg-flag/20"
            >
              <Loader2 className="size-3 animate-spin" /> {t('run.stop')}
            </button>
          ) : (
            <>
              {/* Overflow ⋯ — the header's one secondary control (design ruling 2026-07-17: the dialog is
                  the primary surface; coherence / readiness / rebuild live here instead of a button row). */}
              <div className="relative">
                <button
                  onClick={() => setMoreOpen((v) => !v)}
                  title={t('run.moreActions')}
                  className="flex items-center rounded-md border border-border px-1.5 py-1 text-muted-foreground hover:bg-panel-soft"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onMouseDown={() => setMoreOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-border bg-panel py-1 shadow-lg">
                      <button
                        disabled={!canCheckCoherence}
                        onMouseDown={(e) => { e.preventDefault(); setMoreOpen(false); setCohRunDialog(true) }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-foreground hover:bg-panel-soft disabled:cursor-not-allowed disabled:opacity-50"
                        title={viewing ? t('coherence.tipViewing') : cohRows.length === 0 ? t('coherence.tipNone') : t('coherence.tipReady')}
                      >
                        <ShieldAlert className="size-3 shrink-0 text-muted-foreground" />
                        {cohDirty > 0 ? t('coherence.checkCount', { n: cohDirty }) : t('coherence.check')}
                      </button>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); setMoreOpen(false); checkReadiness() }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-foreground hover:bg-panel-soft"
                        title={t('readiness.tip')}
                      >
                        <ClipboardCheck className="size-3 shrink-0 text-muted-foreground" />
                        {t('readiness.label')}
                      </button>
                      <div className="my-1 border-t border-border" />
                      <button
                        onMouseDown={(e) => { e.preventDefault(); setMoreOpen(false); setResetConfirm(true) }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-flag hover:bg-flag/10"
                        title={t('rebuild.tip')}
                      >
                        <RotateCcw className="size-3 shrink-0" />
                        {t('rebuild.button')}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                disabled={!canRun}
                onClick={() => setRunDialog(true)}
                title={
                  viewing
                    ? t('run.tip.viewing')
                    : graphCycle
                      ? t('run.tip.cycle')
                      : dirty > 0
                        ? t('run.tip.dirty')
                        : graphStale
                          ? t('run.tip.graph')
                          : counts.skim > 0
                            ? t('run.tip.skim', { count: counts.skim })
                            : t('run.tip.upToDate')
                }
                className="flex items-center gap-1.5 rounded-md border border-thread/50 bg-thread/10 px-2.5 py-1 text-[11px] text-foreground hover:bg-thread/20 disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-faint disabled:opacity-70"
              >
                <Play className="size-3" />
                {dirty > 0 ? t('run.label.update', { n: dirty }) : graphStale ? t('run.label.graph') : counts.skim > 0 ? t('run.label.expert', { n: counts.skim }) : t('run.label.upToDate')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Timetravel banner — viewing a past version read-only; Update is disabled until you return/restore. */}
      {viewing && (
        <div className="flex items-center gap-2 border-b border-lore/40 bg-lore/10 px-3 py-1.5 text-[11px] text-lore">
          <Eye className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('timetravel.viewing', { time: relTime(sessions.find((s) => s.id === viewingVersion)?.finishedAt ?? '', t) })}</span>
          <button onClick={() => void revertIngestSession(viewingVersion!)} className="shrink-0 rounded border border-lore/50 px-1.5 py-0.5 hover:bg-lore/20">{t('timetravel.restore')}</button>
          <button onClick={() => void viewVersion(null)} className="shrink-0 rounded px-1.5 py-0.5 hover:bg-lore/20">{t('timetravel.return')}</button>
        </div>
      )}

      {/* The pre-run gate: mode (fast/expert) + per-connection time/cost estimates + readiness link. */}
      {/* Mounted only while open so the dialog's depth initializer re-runs each open and honors initialDepth. */}
      {runDialog && <AnalysisRunDialog open onClose={() => setRunDialog(false)} initialDepth={openDepth} />}
      {cohRunDialog && <CoherenceRunDialog open onClose={() => setCohRunDialog(false)} />}
      {historyOpen && <AnalysisHistoryDialog open onClose={() => setHistoryOpen(false)} />}

      <ConfirmDialog
        open={resetConfirm}
        className="h-[50vh] w-[50vw] max-w-none"
        title={t('rebuild.confirmTitle')}
        message={
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              <Trans t={t} i18nKey="rebuild.confirmBody" components={{ b: <b className="text-foreground/80" /> }} />
            </p>
            <HelpTable
              rows={[
                [t('rebuild.table.whenLabel'), t('rebuild.table.whenBody')],
                [t('rebuild.table.whatLabel'), t('rebuild.table.whatBody')],
                [t('rebuild.table.writingLabel'), t('rebuild.table.writingBody')],
                [t('rebuild.table.safetyLabel'), t('rebuild.table.safetyBody')],
                [t('rebuild.table.afterLabel'), t('rebuild.table.afterBody')]
              ]}
            />
          </div>
        }
        confirmLabel={t('rebuild.confirmLabel')}
        onConfirm={() => { setResetConfirm(false); void resetAnalysis() }}
        onCancel={() => setResetConfirm(false)}
      />

      <ConfirmDialog
        open={reanalyzeConfirm}
        title={t('reanalyze.confirmTitle', { count: selectedScenes.size })}
        message={<Trans t={t} i18nKey="reanalyze.confirmBody" count={selectedScenes.size} values={{ conn: connLabel ?? t('reanalyze.yourConnection') }} components={{ b: <b /> }} />}
        confirmLabel={t('reanalyze.confirmLabel')}
        onConfirm={() => { setReanalyzeConfirm(false); reanalyze() }}
        onCancel={() => setReanalyzeConfirm(false)}
      />


      <div className="min-h-0 flex-1 overflow-auto">
        {/* Live queue — the current/last run, target by target (pending → reading → done/failed/skipped) */}
        {progress && progress.steps.length > 0 && <RunQueue progress={progress} />}

        {/* Recent updates (history) — the dedicated runner records each session here */}
        <div className="border-b border-border px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-faint">
              {t('recent.title')}
              {coherenceBehind && <span className="ml-1.5 normal-case text-flag/80">{t('recent.behind')}</span>}
            </p>
            {analysisSessions.length > 0 && (
              <button onClick={() => setHistoryOpen(true)} className="ml-auto flex items-center gap-1 text-[10px] text-faint hover:text-foreground" title={t('recent.historyTip')}>
                <History className="size-3" /> {t('recent.history')}
              </button>
            )}
          </div>
          {analysisSessions.length === 0 && orphanCoh.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t('recent.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {analysisSessions.map((s) => {
                const isCurrent = s.id === currentVersion
                const isViewed = viewing && s.id === viewingVersion
                const pruned = !!s.snapshotId && s.snapshotAvailable === false // recorded a snapshot, but the file's been pruned
                const hasProvenance = !!s.targets?.length
                const isExp = expanded.has(s.id)
                // Provenance can be huge (a full rebuild touches every scene) — summarize by kind and cap the
                // chips so the row never paints 1000 DOM nodes. The count line is the real answer; chips sample it.
                const tgts = s.targets ?? []
                const sc = tgts.filter((t) => t.kind === 'scene').length
                const ar = tgts.filter((t) => t.kind === 'window').length
                const co = tgts.filter((t) => t.kind === 'coherence').length
                const provSummary = [sc && t('provenance.scene', { count: sc }), ar && t('provenance.arc', { count: ar }), co && t('provenance.coherence', { n: co })].filter(Boolean).join(' · ')
                return (
                  <li key={s.id} className={cn('rounded text-[11px]', isViewed && 'bg-lore/10')}>
                    <div className="flex items-center gap-2">
                      {/* Expand → what this version covered (provenance). Hidden when there's no manifest. */}
                      <button
                        onClick={() => toggleExpanded(s.id)}
                        disabled={!hasProvenance}
                        title={hasProvenance ? t('provenance.viewedTip') : t('provenance.noneTip')}
                        className="shrink-0 text-faint hover:text-foreground disabled:opacity-0"
                      >
                        <ChevronRight className={cn('size-3 transition-transform', isExp && 'rotate-90')} />
                      </button>
                      {/* ● = current (live); 👁 = the version you're viewing read-only */}
                      <span className="w-3 shrink-0 text-center text-thread">{isCurrent ? '●' : isViewed ? <Eye className="size-2.5 text-lore" /> : ''}</span>
                      {/* Click a row to VIEW it read-only (or the current row to return to live). A pruned
                          version (snapshot no longer on disk) is dimmed + unclickable — nothing to read back. */}
                      <button
                        onClick={() => void viewVersion(isCurrent ? null : s.id)}
                        disabled={(!s.snapshotId || pruned) && !isCurrent}
                        title={isCurrent ? t('provenance.versionCurrentTip') : pruned ? t('provenance.versionPrunedTip') : t('provenance.versionViewTip')}
                        className={cn('flex min-w-0 flex-1 items-center gap-2 rounded py-0.5 text-left hover:bg-panel-soft/60 disabled:cursor-default disabled:hover:bg-transparent', pruned && 'opacity-45')}
                      >
                        <span className="w-24 shrink-0 text-faint">{relTime(s.finishedAt, t)}</span>
                        <span className={cn('min-w-0 flex-1 truncate', isCurrent ? 'text-foreground/90' : 'text-muted-foreground')}>
                          {t('recent.targets', { count: s.total })}
                          {/* A clean run: "N targets" already means N succeeded — no ✓N noise. Show the split
                              ONLY when something failed or was skipped (then the failures are what matters). */}
                          {(s.failed > 0 || s.skipped > 0) && (
                            <>
                              {' · '}<span className="text-ok">✓{s.ok}</span>
                              {s.failed > 0 && <span className="text-flag"> ✗{s.failed}</span>}
                              {s.skipped > 0 && <span> ⊘{s.skipped}</span>}
                            </>
                          )}
                          {' · '}{t('recent.rows', { n: s.rowsWritten })}
                        </span>
                      </button>
                      {isCurrent ? (
                        <span className="shrink-0 px-1 text-[10px] text-faint">{t('recent.current')}</span>
                      ) : pruned ? (
                        <span className="shrink-0 px-1 text-[10px] text-faint" title={t('recent.prunedTip')}>{t('recent.pruned')}</span>
                      ) : (
                        s.snapshotId && (
                          <button
                            onClick={() => void revertIngestSession(s.id)}
                            title={t('recent.restoreTip')}
                            className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-panel-soft hover:text-foreground"
                          >
                            <RotateCcw className="size-2.5" /> {t('recent.restore')}
                          </button>
                        )
                      )}
                    </div>
                    {/* Provenance — the scenes/chapters/characters this run wrote (= the delta it cleared).
                        Summary line is the real answer; chips are a capped sample so a full rebuild can't paint
                        thousands of nodes. */}
                    {isExp && hasProvenance && (
                      <div className="ml-8 mb-1 mt-0.5">
                        <div className="mb-0.5 text-[10px] text-faint">{provSummary}</div>
                        <div className="flex flex-wrap gap-1">
                          {tgts.slice(0, PROV_CHIP_CAP).map((tg, i) => (
                            <span key={i} className="rounded bg-panel-soft px-1.5 py-0.5 text-[10px] text-faint" title={`${tg.kind} · ${tg.targetId}`}>
                              {tg.label}
                            </span>
                          ))}
                          {tgts.length > PROV_CHIP_CAP && <span className="px-1.5 py-0.5 text-[10px] text-faint">{t('provenance.more', { n: tgts.length - PROV_CHIP_CAP })}</span>}
                        </div>
                      </div>
                    )}
                    {/* Coherence checks are CHILDREN of this analysis version (basedOn) — not peers. */}
                    {(cohChildren.get(s.id) ?? []).map((c) => (
                      <CoherenceChildRow key={c.id} s={c} />
                    ))}
                    {isCurrent && !cohChildren.get(s.id)?.length && (
                      <div className="ml-8 flex items-center gap-2 py-0.5 text-[11px] italic text-faint">
                        <span>↳</span>
                        <span>{latestCoh ? t('coherenceRow.behind') : t('coherenceRow.notChecked')}</span>
                      </div>
                    )}
                  </li>
                )
              })}
              {/* Coherence with no matching parent in view (legacy / parent pruned) — kept so nothing's lost. */}
              {orphanCoh.map((c) => (
                <li key={c.id}>
                  <CoherenceChildRow s={c} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* All scenes — the drill-down (collapsed by default; history is the front page) */}
        <button
          onClick={() => setShowScenes((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-panel-soft/50"
        >
          <ChevronRight className={cn('size-3 transition-transform', showScenes && 'rotate-90')} />
          {t('scenes.all', { n: rows.length })}
        </button>
        {showScenes &&
          (rows.length === 0 ? (
            <p className="px-3 pb-3 text-[11px] text-faint">{t('scenes.empty')}</p>
          ) : (
            <>
              {/* Manual re-analyze: pick scenes (or all) to re-read even when fresh — e.g. after a model switch. */}
              <div className="flex items-center gap-3 border-b border-border/50 px-3 py-1.5 text-[11px]">
                <button onClick={() => setSelectedScenes(new Set(allScenesSelected ? [] : canonRows.map((r) => r.unitId)))} className="text-muted-foreground hover:text-foreground">
                  {allScenesSelected ? t('scenes.clear') : t('scenes.selectAll')}
                </button>
                {selectedScenes.size > 0 && (
                  <button
                    disabled={running || viewing}
                    onClick={() => (hasAi ? setReanalyzeConfirm(true) : reanalyze())}
                    title={t('reanalyze.selectedTip')}
                    className="ml-auto flex items-center gap-1 rounded-md border border-thread/50 bg-thread/10 px-2 py-0.5 text-foreground hover:bg-thread/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className="size-3" /> {t('reanalyze.selected', { n: selectedScenes.size })}
                  </button>
                )}
              </div>
              <table className="w-full text-[11px]">
                <tbody>
                  {rows.slice(0, sceneLimit).map((r) => {
                    const draft = !!r.phase && r.phase !== 'canon'
                    return (
                      <tr key={r.unitId} className="border-b border-border/50 hover:bg-panel-soft/50">
                        <td className="w-5 py-1 pl-3">
                          {!draft && (
                            <input type="checkbox" checked={selectedScenes.has(r.unitId)} onChange={() => toggleScene(r.unitId)} className="size-3 cursor-pointer accent-thread" />
                          )}
                        </td>
                        <td className="w-2 py-1">
                          <span className="inline-block size-2 rounded-full" style={{ backgroundColor: draft ? STATUS_COLOR.pending : STATUS_COLOR[r.status] }} title={draft ? t('scenes.draft') : STATUS_LABEL[r.status]} />
                        </td>
                        <td className="w-16 py-1 pl-2 font-mono text-muted-foreground">{r.code ?? r.unitId}</td>
                        <td className="py-1 pl-2 text-foreground/90">{r.title}</td>
                        <td className="py-1 pr-3 text-right text-faint">
                          {/* Fresh rows say nothing — the status dot carries it; only the EXCEPTIONS (draft /
                              outdated / not-read) spell out a label, so a clean list reads as clean. */}
                          {draft ? (
                            <span className="rounded border border-border px-1">{t('scenes.draft')}</span>
                          ) : r.status !== 'fresh' ? (
                            <span style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* Bounded render: paint a batch, reveal more on demand — never 1000 rows at once. (Select all
                  still operates on the full canon set, not just what's painted.) */}
              {rows.length > sceneLimit && (
                <button onClick={() => setSceneLimit((n) => n + 200)} className="w-full px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-panel-soft/50">
                  {t('scenes.showMore', { n: rows.length - sceneLimit })}
                </button>
              )}
            </>
          ))}

      </div>
    </div>
  )
}

/** A coherence check shown nested under the analysis version it diffed — read-only (no snapshot, no revert). */
function CoherenceChildRow({ s }: { s: IngestSession }): JSX.Element {
  const { t } = useTranslation('console')
  return (
    <div className="ml-8 flex items-center gap-2 py-0.5 text-[11px] text-muted-foreground" title={t('coherenceRow.tip')}>
      <ShieldAlert className="size-3 shrink-0 text-faint" />
      <span className="w-20 shrink-0 text-faint">{relTime(s.finishedAt, t)}</span>
      <span className="min-w-0 flex-1 truncate">
        {t('coherenceRow.findings', { count: s.rowsWritten })}
      </span>
    </div>
  )
}

/** ms → a compact duration: "2.4s" under a minute, else "1:05". */
function fmtMs(ms: number): string {
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

// The runner's REAL phases, in execution order (scenes → arcs → profiles → digests, then coherence as its own
// run). The dock speaks these — NOT the aspirational Plan→Skim→Extract→Fold names — so what the author watches
// matches what actually runs. window = arcs (matches the provenance summary's vocabulary above).
const PHASE_ORDER = ['scene', 'window', 'profile', 'digest', 'coherence'] as const

interface PhaseInfo { kind: string; total: number; settled: number; failed: number; running: boolean }

/** Group the flat step list into the runner's phases — the honest per-phase progress the flat "N of M" hides. */
function phaseSummary(steps: IngestStep[]): PhaseInfo[] {
  const byKind = new Map<string, PhaseInfo>()
  for (const s of steps) {
    let p = byKind.get(s.kind)
    if (!p) { p = { kind: s.kind, total: 0, settled: 0, failed: 0, running: false }; byKind.set(s.kind, p) }
    p.total++
    if (s.status === 'done' || s.status === 'skipped' || s.status === 'failed') p.settled++
    if (s.status === 'failed') p.failed++
    if (s.status === 'running') p.running = true
  }
  return PHASE_ORDER.filter((k) => byKind.has(k)).map((k) => byKind.get(k)!)
}

/** The live (or just-finished) run, target by target — the visible queue + per-step loader + time cue. */
function RunQueue({ progress }: { progress: IngestProgress }): JSX.Element {
  const { t } = useTranslation('console')
  // Tick while active so the running step's elapsed clock advances between progress pushes.
  const [, force] = useState(0)
  useEffect(() => {
    if (!progress.active) return
    const id = window.setInterval(() => force((n) => n + 1), 500)
    return () => window.clearInterval(id)
  }, [progress.active])

  const total = progress.steps.length
  const settled = progress.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length
  // Bounded render: paint a window near the frontier (the last running/settled step) — not all N. A 1000-step
  // run re-rendering every 500ms must not map 1000 nodes. Counts cover what's hidden before/after.
  let frontier = -1
  progress.steps.forEach((s, i) => { if (s.status !== 'pending') frontier = i })
  const start = Math.max(0, frontier - RUNQUEUE_CAP + 1)
  const windowSteps = progress.steps.slice(start, frontier + 1)
  const queued = total - (frontier + 1)
  const phases = phaseSummary(progress.steps)
  return (
    <div className="border-b border-border px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-faint">
          {progress.active ? t('queue.updating', { settled, total }) : t('queue.lastRun')}
        </p>
        {progress.active && <Loader2 className="size-3 animate-spin text-thread" />}
      </div>
      {/* Phase strip — the runner's real phases (Scenes → Arcs → Profiles → Digests → [Coherence]), each with its
          own progress. Turns the flat "N of M" into WHICH phase is running. Only shown when a run spans >1 phase. */}
      {phases.length > 1 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-0.5 gap-y-1">
          {phases.map((p, i) => {
            const done = p.total > 0 && p.settled === p.total
            const active = p.running || (p.settled > 0 && p.settled < p.total)
            const phaseLabel = t(`phase.${p.kind}`, { defaultValue: p.kind })
            return (
              <span key={p.kind} className="flex items-center">
                {i > 0 && <ChevronRight className="size-2.5 shrink-0 text-faint/40" />}
                <span
                  className={cn(
                    'flex items-center gap-1 rounded px-1 py-px text-[10px]',
                    p.failed ? 'text-flag' : done ? 'text-ok' : active ? 'bg-thread/10 text-thread' : 'text-faint'
                  )}
                  title={p.failed
                    ? t('queue.phaseTipFailed', { label: phaseLabel, settled: p.settled, total: p.total, failed: p.failed })
                    : t('queue.phaseTip', { label: phaseLabel, settled: p.settled, total: p.total })}
                >
                  {p.running && <Loader2 className="size-2.5 shrink-0 animate-spin" />}
                  {phaseLabel}
                  <span className="tabular-nums opacity-75">{p.settled}/{p.total}</span>
                </span>
              </span>
            )
          })}
        </div>
      )}
      <ul className="max-h-40 space-y-0.5 overflow-auto">
        {start > 0 && <li className="text-[10px] text-faint">{t('queue.earlier', { n: start })}</li>}
        {windowSteps.map((s) => {
          // Live elapsed while running; the recorded duration once settled.
          const ms = s.status === 'running' && s.startedAt ? Date.now() - Date.parse(s.startedAt) : s.ms
          return (
            <li key={s.id} className="flex items-center gap-2 text-[11px]">
              <StepIcon status={s.status} />
              <span className="min-w-0 flex-1 truncate text-foreground/90">{s.label}</span>
              {s.note && <span className="shrink-0 text-[10px] text-faint">{s.note}</span>}
              {ms != null && <span className="shrink-0 text-[10px] tabular-nums text-faint">{fmtMs(ms)}</span>}
            </li>
          )
        })}
        {queued > 0 && <li className="text-[10px] text-faint">{t('queue.queued', { n: queued })}</li>}
      </ul>
    </div>
  )
}

function StepIcon({ status }: { status: IngestStep['status'] }): JSX.Element {
  if (status === 'running') return <Loader2 className="size-3 shrink-0 animate-spin text-thread" />
  if (status === 'done') return <Check className="size-3 shrink-0 text-ok" />
  if (status === 'failed') return <XCircle className="size-3 shrink-0 text-flag" />
  if (status === 'skipped') return <Minus className="size-3 shrink-0 text-faint" />
  return <Circle className="size-3 shrink-0 text-faint" /> // pending
}

/** Short relative time, e.g. "just now" · "5 min ago" · "2 h ago" · else a date. */
function relTime(iso: string, t: TFunction): string {
  const d = Date.now() - Date.parse(iso)
  if (Number.isNaN(d)) return ''
  const m = Math.floor(d / 60000)
  if (m < 1) return t('time.justNow')
  if (m < 60) return t('time.minAgo', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('time.hAgo', { h })
  return new Date(iso).toLocaleDateString()
}

/**
 * Database — the console's read-only records inspector (the honest "what the engine knows": the raw rows,
 * not a tally that just mirrors the rails). Pick a table, page through its rows, filter the loaded page
 * client-side. Reflects the CURRENT read source, so it follows timetravel. Values are capped + coerced
 * upstream (queries.inspectRows); big tables paginate rather than painting everything at once.
 */
const DB_PAGE = 100

function DbInspectorTab(): JSX.Element {
  const { t } = useTranslation('console')
  const setChatDraft = useWorkspace((s) => s.setChatDraft)
  const setChatOpen = useWorkspace((s) => s.setChatOpen)
  // Health check: prefill the chat with the read-only DB audit (config/chatPrompts) — author reviews + sends.
  const checkDbHealth = (): void => {
    setChatDraft(dbHealthPrompt())
    setChatOpen(true)
  }
  const [tables, setTables] = useState<DbTable[]>([])
  const [sel, setSel] = useState('')
  const [cols, setCols] = useState<string[]>([])
  const [rows, setRows] = useState<(string | number | null)[][]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [filter, setFilter] = useState('')

  const loadTables = useCallback(() => {
    void window.nvs.inspectTables().then((t) => {
      setTables(t)
      setSel((s) => (t.some((x) => x.name === s) ? s : t[0]?.name ?? ''))
    })
  }, [])
  useEffect(loadTables, [loadTables])

  // Reset + first page whenever the selected table changes.
  useEffect(() => {
    if (!sel) {
      setCols([])
      setRows([])
      return
    }
    let live = true
    setLoading(true)
    setDone(false)
    setFilter('')
    void window.nvs.inspectRows(sel, DB_PAGE, 0).then((p) => {
      if (!live) return
      setCols(p.columns)
      setRows(p.rows)
      setDone(p.rows.length < DB_PAGE)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [sel])

  const loadMore = async (): Promise<void> => {
    setLoading(true)
    const p = await window.nvs.inspectRows(sel, DB_PAGE, rows.length)
    setRows((r) => [...r, ...p.rows])
    setDone(p.rows.length < DB_PAGE)
    setLoading(false)
  }

  const q = filter.trim().toLowerCase()
  const shown = q ? rows.filter((r) => r.some((c) => c != null && String(c).toLowerCase().includes(q))) : rows
  const total = tables.find((t) => t.name === sel)?.count ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Database className="size-3.5 shrink-0 text-muted-foreground" />
        <Select value={sel} onChange={setSel} options={tables.map((t) => ({ value: t.name, label: `${t.name} · ${t.count}` }))} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('db.filter')}
          className="w-40 rounded border border-border bg-canvas px-2 py-0.5 text-[11px] outline-none focus:border-thread"
        />
        <span className="ml-auto shrink-0 text-[10px] text-faint">
          {shown.length}
          {q ? ` / ${rows.length}` : ''} {t('db.ofRows', { count: total })}
        </span>
        <button onClick={loadTables} title={t('db.reread')} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-panel-soft">
          <RefreshCw className="size-3" />
        </button>
        <button
          title={t('db.healthTip')}
          onClick={checkDbHealth}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-panel-soft hover:text-foreground"
        >
          <HeartPulse className="size-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tables.length === 0 ? (
          <p className="p-3 text-[11px] text-muted-foreground">{t('db.none')}</p>
        ) : cols.length === 0 && !loading ? (
          <p className="p-3 text-[11px] text-faint">{t('db.empty')}</p>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr>
                {cols.map((c) => (
                  <th key={c} className="whitespace-nowrap border-b border-border px-2 py-1 text-left font-medium text-muted-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {shown.map((r, i) => (
                <tr key={i} className="hover:bg-panel-soft/50">
                  {r.map((c, j) => (
                    <td key={j} title={c == null ? 'NULL' : String(c)} className={cn('max-w-88 truncate border-b border-border/50 px-2 py-0.5', c == null && 'italic text-faint')}>
                      {c == null ? '∅' : String(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!done && cols.length > 0 && (
        <button
          onClick={() => void loadMore()}
          disabled={loading}
          className="shrink-0 border-t border-border py-1 text-[11px] text-muted-foreground hover:bg-panel-soft disabled:opacity-50"
        >
          {loading ? t('db.loading') : t('db.loadMore', { n: DB_PAGE })}
        </button>
      )}
    </div>
  )
}


function CopyButton({ text, label }: { text: string; label?: string }): JSX.Element {
  const { t } = useTranslation('console')
  const [done, setDone] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button
      onClick={() => void copy()}
      className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-panel-soft"
    >
      {done ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
      {done ? t('copy.copied') : (label ?? t('copy.copy'))}
    </button>
  )
}

// Label text lives in the 'console' catalog (status.*); this map is colour-only.
const STATUS_BADGE: Record<AiConnectionStatus, { color: string }> = {
  active: { color: 'var(--ok)' },
  ready: { color: 'var(--faint)' },
  'needs-key': { color: 'var(--warn)' }
}

function AgentTab(): JSX.Element {
  const { t } = useTranslation('console')
  const [view, setView] = useState<'connections' | 'plan'>('connections')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Bot className="size-3.5 text-muted-foreground" />
        <div className="flex items-center gap-1">
          {(['connections', 'plan'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] transition-colors',
                view === v ? 'bg-panel-soft text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-panel-soft'
              )}
            >
              {v === 'connections' ? t('agent.connections') : t('agent.plan')}
            </button>
          ))}
        </div>
      </div>
      {view === 'connections' ? <ConnectionsManager /> : <McpConnectBoard />}
    </div>
  )
}

function StatusBadge({ status }: { status: AiConnectionStatus }): JSX.Element {
  const { t } = useTranslation('console')
  const b = STATUS_BADGE[status]
  return (
    <span className="flex items-center gap-1 text-[10px]" style={{ color: b.color }}>
      <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: b.color }} />
      {t(`status.${status}`)}
    </span>
  )
}

function ConnectionsManager(): JSX.Element {
  const { t } = useTranslation('console')
  const [state, setState] = useState<AiState>({ connections: [], activeId: null, analysisId: null })
  const [adding, setAdding] = useState(false)
  const setAiState = useWorkspace((s) => s.setAiState)
  // Mirror every change into the store too, so the status-bar provider chip updates live.
  const apply = useCallback((s: AiState): void => { setState(s); setAiState(s) }, [setAiState])
  const reload = useCallback(async () => apply(await window.nvs.aiConnections()), [apply])
  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
      <p className="text-[11px] text-faint"><Trans t={t} i18nKey="connections.intro" components={{ span: <span className="text-faint/80" /> }} /></p>
      {state.connections.map((c) => (
        <ConnectionRow key={c.id} c={c} onChanged={apply} />
      ))}
      {adding ? (
        <AddConnectionForm onDone={(s) => { if (s) apply(s); setAdding(false) }} />
      ) : (
        <button onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-panel-soft">
          <Plus className="size-3" /> {t('connections.add')}
        </button>
      )}
    </div>
  )
}

function ConnectionRow({ c, onChanged }: { c: AiConnection; onChanged: (s: AiState) => void }): JSX.Element {
  const { t } = useTranslation('console')
  const meta = AI_PROVIDERS[c.type]
  const setNotice = useWorkspace((s) => s.setNotice)
  const [editKey, setEditKey] = useState(false)
  const [key, setKey] = useState('')
  const [editModel, setEditModel] = useState(false)
  const [model, setModel] = useState(c.model)
  const [custom, setCustom] = useState(!meta.models.includes(c.model)) // current model isn't in the suggested list
  // Masked hint of the stored key's length (never the key itself), capped so a long key doesn't overflow.
  const dots = c.secretLen ? '•'.repeat(Math.min(c.secretLen, 40)) + (c.secretLen > 40 ? '…' : '') : ''

  const saveKey = async (): Promise<void> => {
    onChanged(await window.nvs.saveConnection({ id: c.id, type: c.type, label: c.label, model: c.model, secret: key.trim() }))
    setKey('')
    setEditKey(false)
    setNotice(t('notice.keySaved'))
  }
  // Retroactively switch the model on this saved connection — omits `secret`, so the stored key is kept.
  const saveModel = async (): Promise<void> => {
    const next = model.trim() || c.model
    onChanged(await window.nvs.saveConnection({ id: c.id, type: c.type, label: c.label, model: next }))
    setEditModel(false)
    setNotice(t('notice.modelSet', { model: next }))
  }

  return (
    <div className="rounded-md border border-border bg-panel-soft/40 px-2 py-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        <StatusBadge status={c.status} />
        <span className="truncate font-medium text-foreground/90">{c.label}</span>
        <span className="truncate text-faint">{meta.label} · {c.model}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* ONE button per connection (2026-07-18): the active connection drives BOTH chat and analysis.
              The separate "Analysis" pin was removed — one connection, like saved cards. */}
          {c.status !== 'active' && (c.hasSecret || meta.keyless) && (
            <button onClick={async () => onChanged(await window.nvs.setActiveConnection(c.id))} className="rounded-md border border-thread/50 bg-thread/10 px-1.5 py-0.5 text-foreground hover:bg-thread/20">{t('connections.use')}</button>
          )}
          {c.status === 'active' && (
            <button onClick={async () => onChanged(await window.nvs.setActiveConnection(null))} className="rounded-md border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-panel-soft">{t('connections.deactivate')}</button>
          )}
          <button onClick={() => setEditModel((v) => !v)} title={t('connections.changeModel')} className={cn('rounded p-0.5 hover:bg-panel-soft', editModel ? 'text-foreground' : 'text-muted-foreground')}><Cpu className="size-3" /></button>
          {!meta.keyless && (
            <button onClick={() => setEditKey((v) => !v)} title={t('connections.setKey')} className="rounded p-0.5 text-muted-foreground hover:bg-panel-soft"><Key className="size-3" /></button>
          )}
          <button onClick={async () => onChanged(await window.nvs.removeConnection(c.id))} title={t('connections.remove')} className="rounded p-0.5 text-muted-foreground hover:bg-panel-soft"><Trash2 className="size-3" /></button>
        </div>
      </div>
      {editModel && (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-center gap-2">
            <Select
              className="w-56 shrink-0"
              value={custom ? '__custom__' : model}
              onChange={(v) => { if (v === '__custom__') setCustom(true); else { setCustom(false); setModel(v) } }}
              options={[...meta.models.map((m) => ({ value: m, label: m })), { value: '__custom__', label: t('connections.custom') }]}
            />
            {custom && <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('connections.customModelId')} className="w-48 rounded-md border border-border bg-canvas px-2 py-1 font-mono text-[10px] outline-none focus:border-foreground/30" />}
            <button onClick={() => void saveModel()} className="rounded-md border border-border px-2 py-1 hover:border-foreground/30">{t('connections.save')}</button>
          </div>
        </div>
      )}
      {editKey && (
        <div className="mt-1.5 space-y-1">
          {dots && <p className="truncate font-mono text-[10px] text-faint">{t('connections.current', { dots })}</p>}
          <div className="flex items-center gap-2">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={c.hasSecret ? t('connections.replaceKey') : meta.keyHint} className="flex-1 rounded-md border border-border bg-canvas px-2 py-1 font-mono text-[10px] outline-none focus:border-foreground/30" />
            <button disabled={!key.trim()} onClick={() => void saveKey()} className="rounded-md border border-border px-2 py-1 hover:border-foreground/30 disabled:opacity-50">{t('connections.saveKey')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function AddConnectionForm({ onDone }: { onDone: (s: AiState | null) => void }): JSX.Element {
  const { t } = useTranslation('console')
  const setNotice = useWorkspace((s) => s.setNotice)
  const [type, setType] = useState<AiProviderType>('anthropic')
  const [label, setLabel] = useState(AI_PROVIDERS.anthropic.label)
  const [model, setModel] = useState(AI_PROVIDERS.anthropic.defaultModel)
  const [custom, setCustom] = useState(false) // model id not in the suggested list
  const [key, setKey] = useState('')
  const meta = AI_PROVIDERS[type]

  const changeType = (t: AiProviderType): void => {
    setType(t)
    setLabel(AI_PROVIDERS[t].label)
    setModel(AI_PROVIDERS[t].defaultModel)
    setCustom(false)
  }
  const save = async (): Promise<void> => {
    const input: SaveConnectionInput = { type, label: label.trim() || meta.label, model: model.trim() || meta.defaultModel, secret: key.trim() || undefined }
    onDone(await window.nvs.saveConnection(input))
    if (key.trim()) setNotice(t('notice.keySaved'))
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-2 text-[11px]">
      <div className="flex items-center gap-2">
        <Select
          className="w-28"
          value={type}
          onChange={(v) => changeType(v as AiProviderType)}
          options={PROVIDER_TYPES.map((t) => ({ value: t, label: AI_PROVIDERS[t].label }))}
        />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('connections.label')} className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 py-1 outline-none focus:border-foreground/30" />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-faint">{t('connections.model')}</span>
        {/* A real select shows ALL provider models; "Custom…" frees the field (model ids drift). */}
        <Select
          className="min-w-0 flex-1"
          value={custom ? '__custom__' : model}
          onChange={(v) => { if (v === '__custom__') setCustom(true); else { setCustom(false); setModel(v) } }}
          options={[...meta.models.map((m) => ({ value: m, label: m })), { value: '__custom__', label: t('connections.custom') }]}
        />
      </div>
      {custom && (
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('connections.customModelId')} className="w-full rounded-md border border-border bg-canvas px-2 py-1 font-mono text-[10px] outline-none focus:border-foreground/30" />
      )}
      <div className="flex items-center gap-2">
        {meta.keyless ? (
          <span className="min-w-0 flex-1 text-faint"><Trans t={t} i18nKey="connections.keyless" components={{ code: <code className="font-mono" /> }} /></span>
        ) : (
          <>
            <Key className="size-3.5 shrink-0 text-muted-foreground" />
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={meta.keyHint} className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 py-1 font-mono text-[10px] outline-none focus:border-foreground/30" />
          </>
        )}
        <button onClick={() => void save()} className="rounded-md border border-border px-2 py-1 hover:border-foreground/30">{t('connections.save')}</button>
        <button onClick={() => onDone(null)} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-panel-soft">{t('connections.cancel')}</button>
      </div>
      <p className="text-faint">
        {meta.keyless ? (
          <ExternalLink href={meta.keysUrl}>{t('connections.aboutLogin')}</ExternalLink>
        ) : (
          <><ExternalLink href={meta.keysUrl}>{t('connections.getKey', { provider: meta.label })}</ExternalLink> · <ExternalLink href={meta.pricingUrl}>{t('connections.pricing')}</ExternalLink></>
        )}
      </p>
    </div>
  )
}

function McpConnectBoard(): JSX.Element {
  const { t } = useTranslation('console')
  const [status, setStatus] = useState<McpStatus | null>(null)
  const setDiscoverOpen = useWorkspace((s) => s.setDiscoverOpen)
  const reload = useCallback(async () => setStatus(await window.nvs.mcpStatus()), [])
  useEffect(() => {
    void reload()
  }, [reload])

  const url = status?.url ?? null
  const config = url
    ? JSON.stringify({ mcpServers: { 'novel-visual-studio': { type: 'http', url } } }, null, 2)
    : ''
  const cli = url ? `claude mcp add --transport http novel-visual-studio ${url}` : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Plug className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground/80">{t('mcp.title')}</span>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span
            className="inline-block size-2 rounded-full"
            style={{ backgroundColor: status?.running ? 'var(--ok)' : 'var(--faint)' }}
          />
          {status?.running ? t('mcp.running') : t('mcp.stopped')}
        </span>
        {url && <code className="text-[11px] text-muted-foreground">{url}</code>}
        {url && <CopyButton text={url} label={t('copy.url')} />}
        <button
          onClick={() => void reload()}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-panel-soft"
          title={t('mcp.recheck')}
        >
          <RefreshCw className="size-3" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-[11px]">
        {status?.error && <p className="text-warn">{t('mcp.error', { error: status.error })}</p>}

        <div>
          <p className="mb-1 text-muted-foreground">
            {t('mcp.intro')}
          </p>
        </div>

        {url && (
          <>
            <div>
              <div className="mb-1 flex items-center gap-2">
                <p className="font-medium text-foreground/80">{t('mcp.connectOne')}</p>
                <CopyButton text={cli} />
              </div>
              <pre className="overflow-auto rounded border border-border bg-panel-soft p-2 font-mono text-[10px] text-foreground/90">{cli}</pre>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2">
                <p className="font-medium text-foreground/80">{t('mcp.orConfig')}</p>
                <CopyButton text={config} label={t('copy.json')} />
              </div>
              <pre className="overflow-auto rounded border border-border bg-panel-soft p-2 font-mono text-[10px] text-foreground/90">{config}</pre>
            </div>
          </>
        )}

        <div className="flex items-start gap-1.5 rounded border border-lore/30 bg-lore/5 px-2 py-1.5">
          <Camera className="mt-0.5 size-3 shrink-0 text-lore" />
          <p className="text-muted-foreground"><Trans t={t} i18nKey="mcp.capture" components={{ code: <code className="text-foreground/80" />, b: <b className="text-foreground/80" /> }} /></p>
        </div>

        <button onClick={() => setDiscoverOpen('claude')} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <Terminal className="size-3" /> {t('mcp.fullGuide')}
        </button>

        <div>
          <p className="mb-1 font-medium text-foreground/80">{t('mcp.tools')}</p>
          <div className="flex flex-wrap gap-1">
            {(status?.tools ?? []).map((t) => (
              <span key={t} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
