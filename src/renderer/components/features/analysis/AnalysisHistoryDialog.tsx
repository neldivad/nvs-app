/**
 * AnalysisHistoryDialog (internal/batched-extraction.md §7d, build-order #3) — a richer view of a PAST analysis
 * run than the dock's one-line "Recent updates" row. A run picker at top swaps between sessions; two tabs:
 *
 *   • Analyzed graph — the FROZEN outline of what THAT run touched (reuses <OutlineTree> with the HISTORY feed:
 *     read / not-run, from the session's `targets`). The "What THAT run touched" coloring settled 2026-07-18.
 *   • Coverage & stats — the run's phases by kind (Scenes/Arcs/Profiles/Digests, all done) + its numbers.
 *
 * Honest scope: a session retains what it COVERED (`targets`) — not its per-step play-by-play (that stream is
 * live-only) nor cost/depth. So tab 2 is a coverage summary, not a replayed log. Restore reuses the existing
 * snapshot revert. Reuse over rebuild: the tree render + roll-up are the SAME code the pre-run preview uses.
 */
import { useMemo, useState, type JSX } from 'react'
import { History, RotateCcw } from 'lucide-react'
import type { IngestSession } from '@shared/ipc'
import { Dialog } from '@/components/ui/dialog'
import { useWorkspace } from '@/stores/workspace'
import { OutlineTree } from '@/components/features/analysis/FreshnessOutline'
import { build, historyStateOf, HISTORY_ORDER } from '@/lib/analysis/freshnessOutline'
import { cn } from '@/lib/utils'

// The run's phases, in execution order — same vocabulary as the live tracker (window = arcs).
const KIND_ORDER = ['scene', 'window', 'profile', 'digest', 'coherence'] as const
const KIND_LABEL: Record<string, string> = { scene: 'Scenes', window: 'Arcs', profile: 'Profiles', digest: 'Digests', coherence: 'Coherence' }

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtDur(a: string, b: string): string {
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000))
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
}

export function AnalysisHistoryDialog({ open, onClose, sessionId }: { open: boolean; onClose: () => void; sessionId?: string | null }): JSX.Element | null {
  const storyTree = useWorkspace((s) => s.storyTree)
  const revertIngestSession = useWorkspace((s) => s.revertIngestSession)
  const sessions = useWorkspace((s) => s.ingestSessions).filter((s) => (s.kind ?? 'analysis') === 'analysis')
  const [picked, setPicked] = useState<string | null>(sessionId ?? null)
  const [tab, setTab] = useState<'graph' | 'stats'>('graph')

  const session: IngestSession | undefined = sessions.find((s) => s.id === picked) ?? sessions[0]

  // Tab 1 feed — the run's touched SCENES become the "read" set; the rest of the tree is "not run".
  const root = useMemo(() => {
    const readSet = new Set((session?.targets ?? []).filter((t) => t.kind === 'scene').map((t) => t.targetId))
    return build({ type: 'folder', name: '', relPath: '', path: '', children: storyTree }, historyStateOf(readSet))
  }, [storyTree, session])

  // Tab 2 — phases by kind (all done), from the frozen targets.
  const byKind = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of session?.targets ?? []) m.set(t.kind, (m.get(t.kind) ?? 0) + 1)
    return KIND_ORDER.filter((k) => m.has(k)).map((k) => ({ kind: k, n: m.get(k)! }))
  }, [session])

  if (!open) return null

  return (
    <Dialog open={open} onClose={onClose} title="Analysis history" size="panel">
      <div className="flex flex-col gap-3 p-4 text-[12px]">
        {sessions.length === 0 || !session ? (
          <p className="py-6 text-center text-muted-foreground">No past runs yet — run one from the dock’s Update.</p>
        ) : (
          <>
            {/* Run picker */}
            <div className="flex items-center gap-2">
              <History className="size-3.5 shrink-0 text-faint" />
              <select
                value={session.id}
                onChange={(e) => setPicked(e.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-panel-soft px-2 py-1 text-[12px] text-foreground"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmtWhen(s.finishedAt)} · {s.total} targets · {fmtDur(s.startedAt, s.finishedAt)}
                  </option>
                ))}
              </select>
            </div>

            {/* Tabs */}
            <div className="flex overflow-hidden rounded border border-border">
              {(['graph', 'stats'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn('flex-1 px-3 py-1', tab === t ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {t === 'graph' ? 'Analyzed graph' : 'Coverage & stats'}
                </button>
              ))}
            </div>

            {tab === 'graph' ? (
              <div className="rounded border border-border bg-panel-soft/30 p-2">
                <OutlineTree root={root} order={HISTORY_ORDER} empty="This run touched no scenes." />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Phases by kind — all done (this is a frozen record) */}
                <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                  {byKind.length === 0 ? (
                    <span className="text-muted-foreground">This run recorded no coverage.</span>
                  ) : (
                    byKind.map(({ kind, n }, i) => (
                      <span key={kind} className="flex items-center gap-1">
                        {i > 0 && <span className="text-faint/40">›</span>}
                        <span className="flex items-center gap-1 rounded bg-ok/10 px-1.5 py-px text-[11px] text-ok">
                          {KIND_LABEL[kind] ?? kind}
                          <span className="tabular-nums opacity-80">{n}</span>
                        </span>
                      </span>
                    ))
                  )}
                </div>
                {/* Numbers */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
                  <Stat label="Targets" value={`${session.total}`} />
                  <Stat label="Rows written" value={`${session.rowsWritten}`} />
                  <Stat label="Done" value={`${session.ok}`} />
                  <Stat label="Failed / skipped" value={`${session.failed} / ${session.skipped}`} tone={session.failed ? 'flag' : undefined} />
                  <Stat label="Duration" value={fmtDur(session.startedAt, session.finishedAt)} />
                  <Stat label="Finished" value={fmtWhen(session.finishedAt)} />
                </div>
                <p className="text-[10px] text-faint">A run keeps what it covered, not its step-by-step log (that stream is live-only).</p>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-1">
              {session.snapshotId && session.snapshotAvailable !== false ? (
                <button
                  onClick={() => { void revertIngestSession(session.id); onClose() }}
                  className="flex items-center gap-1.5 text-[11px] text-faint hover:text-foreground"
                  title="Roll the analysis DB back to this version’s snapshot"
                >
                  <RotateCcw className="size-3" /> Restore this version
                </button>
              ) : (
                <span className="text-[10px] text-faint">{session.snapshotId ? 'snapshot pruned — can’t restore' : ''}</span>
              )}
              <button onClick={onClose} className="rounded border border-border px-3 py-1 text-muted-foreground hover:bg-panel-soft">Close</button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'flag' }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-faint">{label}</span>
      <span className={cn('tabular-nums', tone === 'flag' ? 'text-flag' : 'text-foreground/90')}>{value}</span>
    </div>
  )
}
