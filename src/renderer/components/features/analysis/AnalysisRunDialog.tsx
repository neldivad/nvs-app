/**
 * The pre-run dialog — the single gate every analysis run passes through (the dock's Update button opens it;
 * the old bare "N scenes?" confirm is gone). Three choices live here, with honest numbers beside each:
 *
 *   MODE        Fast (skim: summary + threads + presence; no arc/profile rollups; scenes stay marked for a
 *               later expert upgrade) vs Expert (the full ledger contract). Counts re-plan per mode.
 *   CONNECTION  one row per configured connection with a time ESTIMATE RANGE and (for metered APIs) a rough
 *               cost range — the "337 targets ≈ 9h on plan, ~25min on OpenRouter" truth, surfaced BEFORE the
 *               run instead of discovered 3 chapters in. Picking a row sets the dedicated ANALYSIS connection
 *               (chat's active connection is untouched).
 *   READINESS   the read-only preflight (chat prompt) for structural doubts, linked instead of butttoned.
 *
 * Estimates come from config/analysisEstimates (measured-telemetry-calibrated, always shown as ranges).
 */
import { useEffect, useMemo, useState, type JSX } from 'react'
import { ChevronDown, ChevronRight, Gauge, Loader2, Play, Route, Sparkles, TriangleAlert } from 'lucide-react'
import { FreshnessOutline } from '@/components/features/analysis/FreshnessOutline'
import type { AiState, AnalysisDepth, IngestPreview } from '@shared/ipc'
import { AI_PROVIDERS } from '@shared/config/aiProviders'
import { estimateRun, fmtCostRange, fmtDuration } from '@/config/analysisEstimates'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/stores/workspace'
import { activeVariant } from '@/lib/timeline/treeVariant'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<string, string> = { scene: 'scenes', window: 'arcs', profile: 'profiles', digest: 'digests' }
// Above this many targets, a keyless PLAN run is long enough to reliably hit the subscription session cap
// before finishing — the point where we steer the author to a metered API connection instead.
const PLAN_WARN_TARGETS = 40
/** Naive de-plural for the count of 1 (scenes→scene) — all our kind labels are regular. */
const plural = (label: string, n: number): string => (n === 1 ? label.replace(/s$/, '') : label)

export function AnalysisRunDialog({ open, onClose, initialDepth }: { open: boolean; onClose: () => void; initialDepth?: AnalysisDepth }): JSX.Element | null {
  const project = useWorkspace((s) => s.project)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // analysis runs are AI → the run dialog is unavailable when off
  const startIngestRun = useWorkspace((s) => s.startIngestRun)
  const trees = useWorkspace((s) => s.trees)
  const variant = activeVariant(trees)
  const variantCount = trees.variants.length
  const variantIndex = trees.variants.findIndex((v) => v.id === trees.activeId) + 1
  // initialDepth wins when the caller opens us for a specific pass (the dock's "Expert pass" affordance opens in
  // full so the upgrade isn't buried behind the toggle). The dialog is mounted only while open, so this
  // initializer re-runs each open — no effect needed. Absent that, fall back to the last-used mode.
  const [depth, setDepth] = useState<AnalysisDepth>(() => initialDepth ?? (localStorage.getItem('nvs-analysis-depth') === 'skim' ? 'skim' : 'full'))
  const [preview, setPreview] = useState<IngestPreview | null>(null)
  const [ai, setAi] = useState<AiState | null>(null)
  const [picked, setPicked] = useState<string | null>(null) // connection id this run routes through
  const [measuredSceneMs, setMeasuredSceneMs] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [showOutline, setShowOutline] = useState(false) // §7d: the per-scene outline is summoned, not always-on

  // (Re)load on open + on mode change: the frontier is mode-dependent (fast plans no arc/profile rollups).
  useEffect(() => {
    if (!open) return
    let live = true
    setPreview(null)
    void window.nvs.planIngestPreview(depth).then((p) => live && setPreview(p))
    void window.nvs.aiConnections().then((s) => {
      if (!live) return
      setAi(s)
      setPicked((prev) => prev ?? s.activeId) // one connection drives everything — highlight the active one
    })
    // Calibrate with this project's own measured scene reads when it has some.
    if (project?.root)
      void window.nvs.readTelemetry(project.root, 300).then((rows) => {
        if (!live) return
        const scenes = rows.filter((r) => r.kind === 'scene' && typeof r.ms === 'number').map((r) => r.ms as number)
        setMeasuredSceneMs(scenes.length ? scenes.reduce((a, b) => a + b, 0) / scenes.length : null)
      })
    return () => {
      live = false
    }
  }, [open, depth, project?.root])

  const rows = useMemo(() => {
    if (!preview || !ai) return []
    return ai.connections.map((c) => {
      const est = estimateRun(preview, c.type, c.model, depth, c.type === 'plan' ? measuredSceneMs : null)
      const range = fmtCostRange(est.costLo, est.costHi)
      // plan → subscription; a known price → the range (≈ when it's a family guess); an unknown model → tell
      // the user to look it up rather than showing a fabricated number.
      const cost = c.type === 'plan' ? 'plan usage' : range ? (est.approx ? `≈${range}` : range) : 'check pricing'
      return { conn: c, est, cost }
    })
  }, [preview, ai, depth, measuredSceneMs])

  // Plan (keyless subscription) is ~15× slower per call than a metered API and can't parallelize, so a large
  // run runs for hours and reliably dies on the Claude Code usage/session cap partway through. Warn when the
  // picked connection is plan AND the frontier is big enough for that to bite, and point at the faster row.
  const pickedRow = rows.find((r) => r.conn.id === picked)
  const apiAlt = rows.find((r) => r.conn.type !== 'plan')
  const planWarning =
    pickedRow?.conn.type === 'plan' && preview && preview.total >= PLAN_WARN_TARGETS
      ? { hours: Math.round(pickedRow.est.timeHiMs / 3_600_000), apiLabel: apiAlt ? apiAlt.conn.label || AI_PROVIDERS[apiAlt.conn.type].label : null }
      : null

  if (!open || !aiEnabled) return null

  const breakdown = preview
    ? Object.entries(preview.counts)
        .map(([k, n]) => `${n} ${plural(KIND_LABEL[k] ?? k, n)}`)
        .join(' · ')
    : null

  const start = async (): Promise<void> => {
    if (!picked || starting) return
    setStarting(true)
    try {
      // The run uses whatever the analysis connection ALREADY is (set in the console) — this dialog no longer
      // re-assigns it, so there's a single source of truth. Just kick off the run.
      onClose()
      await startIngestRun(undefined, depth)
    } finally {
      setStarting(false)
    }
  }

  const setMode = (d: AnalysisDepth): void => {
    setDepth(d)
    localStorage.setItem('nvs-analysis-depth', d)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Update analysis"
      size="panel"
      footer={
        <DialogFooter aside={<ReadinessLink onClose={onClose} />}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => void start()} disabled={!picked || !preview || preview.total === 0 || starting}>
            {starting ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Start {depth === 'skim' ? 'fast' : 'expert'} run
          </Button>
        </DialogFooter>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-[12px]">
        {/* Which timeline this run analyzes (staleness + thread ancestry follow the active variant). The "why"
            lives in the tooltip, not inline — the target count below is for THIS timeline. */}
        {variant && (
          <div
            title={variantCount > 1 ? 'Analysis follows the active timeline. Switch it on the canvas to analyze a different one.' : undefined}
            className="flex items-center gap-1.5 rounded-md border border-border bg-panel-soft/40 px-2.5 py-1.5 text-[11px]"
          >
            <Route className="size-3.5 shrink-0 text-thread" />
            <span className="text-faint">Timeline</span>
            <span className="font-medium text-foreground">{variant.name}</span>
            {variantCount > 1 && <span className="ml-auto tabular-nums text-faint">{variantIndex} of {variantCount}</span>}
          </div>
        )}

        {/* What this run would do (mode-dependent frontier) */}
        <div className="text-muted-foreground">
          {preview ? (
            preview.total === 0 ? (
              <span>Everything is up to date at this depth — nothing to run.</span>
            ) : (
              <span>
                <span className="font-medium text-foreground">{preview.total} targets</span>
                <span className="text-faint"> · {breakdown}</span>
              </span>
            )
          ) : (
            <span className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> planning…</span>
          )}
        </div>

        {/* Which scenes — summoned per-scene outline (book>chapter>scene, aggregate state bars per §7d). Lets the
            author see WHAT the "N targets" count is, by chapter, and how the frontier shifts between Fast/Expert. */}
        {preview && (
          <div>
            <button onClick={() => setShowOutline((v) => !v)} className="flex items-center gap-1 text-[11px] text-faint hover:text-foreground">
              {showOutline ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              Preview by chapter
            </button>
            {showOutline && (
              <div className="mt-1 rounded border border-border bg-panel-soft/30 p-2">
                <FreshnessOutline mode={depth} />
              </div>
            )}
          </div>
        )}

        {/* Mode — fast (skim) vs expert (full contract) */}
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-faint">Mode</span>
          <div className="flex overflow-hidden rounded border border-border">
            {(
              [
                { d: 'skim' as const, label: 'Fast', Icon: Gauge, hint: 'summary + threads + presence — story-so-far & timeline stay fresh; arcs wait for an expert pass' },
                { d: 'full' as const, label: 'Expert', Icon: Sparkles, hint: 'the full ledger: goals, conflicts, items, lore, arcs, profiles' }
              ] as const
            ).map(({ d, label, Icon, hint }) => (
              <button
                key={d}
                title={hint}
                onClick={() => setMode(d)}
                className={cn('flex items-center gap-1.5 px-3 py-1', depth === d ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <Icon className="size-3" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Connection — one row per configured connection, with the estimate ranges */}
        <div>
          <div className="mb-1">
            <span
              title="Estimates are approximate. Set your analysis connection in the console’s Connections list."
              className="text-[10px] font-semibold uppercase tracking-wide text-faint"
            >
              Runs on
            </span>
          </div>
          <div className="overflow-hidden rounded border border-border">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-panel-soft/50 text-[10px] uppercase tracking-wide text-faint">
                  <th className="px-2.5 py-1 text-left font-medium">Connection</th>
                  <th className="w-28 px-2.5 py-1 text-right font-medium">Time</th>
                  <th className="w-24 px-2.5 py-1 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ conn, est, cost }) => (
                  // Read-only comparison. The analysis connection has ONE setter — the console's Connections list
                  // (setAnalysisConnection) — so this table only DISPLAYS the current pick + alternatives; it never
                  // sets it (that was a second, confusing entry point). The current one is highlighted.
                  <tr key={conn.id} className={cn('border-t border-border/50', picked === conn.id ? 'bg-thread/10' : 'opacity-70')}>
                    <td className="px-2.5 py-1.5">
                      <span className={cn('mr-1.5 inline-block size-1.5 rounded-full align-middle', picked === conn.id ? 'bg-thread' : 'bg-border')} />
                      <span className="text-foreground">{conn.label || AI_PROVIDERS[conn.type].label}</span>
                      <span className="ml-1.5 text-[10px] text-faint">{conn.model}</span>
                      {picked === conn.id && <span className="ml-1.5 rounded bg-thread/20 px-1 py-px text-[9px] uppercase tracking-wide text-thread">current</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono text-[11px] text-muted-foreground">
                      {preview && preview.total > 0 ? `${fmtDuration(est.timeLoMs)}–${fmtDuration(est.timeHiMs)}` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono text-[11px] text-muted-foreground">
                      {preview && preview.total > 0 ? cost : '—'}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2.5 py-2 text-muted-foreground">No AI connections yet — add one in Settings → AI.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {planWarning && (
            <div className="mt-2 flex items-start gap-2 rounded border border-warn/40 bg-warn/10 px-2.5 py-2 text-[11px] leading-relaxed text-warn">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                This runs on your Claude subscription (no API key), which is ~15× slower per scene and can’t run in
                parallel — about <b>{planWarning.hours || 'several'} hour{planWarning.hours === 1 ? '' : 's'}</b> for
                this run, long enough that it usually hits your usage limit before finishing.{' '}
                {planWarning.apiLabel
                  ? <>Switch the analysis connection to <b>{planWarning.apiLabel}</b> (an API key) in the console — it finishes in minutes.</>
                  : <>Add an API-key connection (Anthropic / OpenRouter) in Settings → AI and use it for full analysis; it finishes in minutes.</>}
              </span>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/** "Not sure the project is ready?" — seeds the read-only preflight prompt into chat (config/chatPrompts). */
function ReadinessLink({ onClose }: { onClose: () => void }): JSX.Element {
  const setChatDraft = useWorkspace((s) => s.setChatDraft)
  const setChatOpen = useWorkspace((s) => s.setChatOpen)
  return (
    <button
      onClick={() => {
        void import('@shared/config/chatPrompts').then(({ analysisReadinessPrompt }) => {
          setChatDraft(analysisReadinessPrompt())
          setChatOpen(true)
          onClose()
        })
      }}
      title="Run a read-only preflight in chat — checks canon prose, structure, and connection before you spend a run."
      className="text-[11px] text-faint underline-offset-2 hover:text-foreground hover:underline"
    >
      Check readiness
    </button>
  )
}
