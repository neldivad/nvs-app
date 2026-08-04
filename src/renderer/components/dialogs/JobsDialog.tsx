/**
 * Jobs dashboard (RightRail JobRail) — modeled on Adobe Media Encoder: a QUEUE table (columns from
 * config/jobs.ts) + an ENCODING detail panel for the running job, plus a LOGS tab streaming telemetry.
 *
 * UNIVERSAL: the history is aggregated across EVERY library work (window.nvs.listAllJobs reads each run
 * ledger), so the dashboard shows the same jobs whether you're in the library or inside a project — it never
 * empties on a project switch. The live run (ingestProgress) is the top row while active.
 *
 * Cost / memory / provider are MACHINE-LOCAL (config/jobs.ts) — from local telemetry, never nvs.db, so they
 * never travel with a shared nvsproj.
 */
import { type JSX, type ReactNode, useEffect, useState } from 'react'
import { useWorkspace } from '@/stores/workspace'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Play, Square, Loader2, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { JOB_KINDS, JOB_STATUSES, JOB_COLUMNS, JOB_TONE_CLASS, type JobColumn } from '@/config/jobs'
import { ConfirmDialog } from '@/components/ui/confirm'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ContextMenuShell, MenuSeparator } from '@/components/layout/RailContextMenu'
import type { IngestProgress, JobRow, StorageRow, StorageKind } from '@shared/ipc'

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—' // guards NaN/undefined (e.g. a field a stale main process omits)
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${Math.round(n / 1024)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(1)} GB`
}
const CLEAR_COPY: Record<StorageKind, { title: string; message: string }> = {
  logs: { title: 'Clear analysis logs?', message: 'Deletes this project’s telemetry logs.\n\nDiagnostics only — regenerated on the next run. Nothing else is affected.' },
  history: { title: 'Clear run history?', message: 'Removes past-run records and their revert snapshots.\n\nYour current analysis stays intact — you just lose the ability to revert to earlier versions.' },
  chat: { title: 'Delete chat sessions?', message: 'Deletes this project’s chat history from your machine.\n\nThis can’t be undone.' },
  tasks: { title: 'Clear the task inbox?', message: 'Deletes this project’s background-task inbox — including any completed edits you haven’t applied yet.\n\nThis can’t be undone.' },
  backups: { title: 'Delete reset backups?', message: 'Removes the full “.nvs.bak-…” copies saved before each Reset analysis.\n\nSafe — they’re only recovery snapshots; your current project and analysis are untouched. This can’t be undone.' }
}

// Storage composition — a FIXED categorical order (dataviz rule: stable hue order, never cycled). `db` is the
// non-clearable analysis (the neutral bulk you keep); the rest are reclaimable buckets. Palette = app design
// tokens, so the bar reads in the same visual language as the rest of the app.
const STORAGE_CATS = [
  { key: 'db', label: 'Database', bar: 'bg-muted-foreground', kind: null as StorageKind | null },
  { key: 'history', label: 'History', bar: 'bg-thread', kind: 'history' as StorageKind | null },
  { key: 'backups', label: 'Backups', bar: 'bg-flag', kind: 'backups' as StorageKind | null },
  { key: 'chat', label: 'Chat', bar: 'bg-character', kind: 'chat' as StorageKind | null },
  { key: 'tasks', label: 'Tasks', bar: 'bg-lore', kind: 'tasks' as StorageKind | null },
  { key: 'logs', label: 'Logs', bar: 'bg-ok', kind: 'logs' as StorageKind | null }
] as const

/** Bytes for a composition category; NaN/undefined (a field a stale main omits) folds to 0. */
function catBytes(s: StorageRow, key: string): number {
  const v = key === 'db' ? s.dbBytes : key === 'history' ? s.historyBytes : key === 'backups' ? s.backupsBytes : key === 'chat' ? s.chatBytes : key === 'tasks' ? s.tasksBytes : s.logsBytes
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** A project's total `.nvs` footprint (sum of the categorical segments — the value the bar splits). */
function storageTotal(s: StorageRow): number {
  return STORAGE_CATS.reduce((n, c) => n + catBytes(s, c.key), 0)
}

/** A stacked bar of a project's `.nvs` footprint by category (2px gaps, rounded ends, per-segment hover
 *  tooltip). Replaces six numeric columns — see the legend above the table for identity.
 *  `mode`: 'relative' fills 100% (composition only); 'absolute' scales the bar to `scaleMax` (the largest
 *  project) so bar LENGTH is the actual footprint — projects become comparable at a glance. */
function StorageBar({ s, mode, scaleMax }: { s: StorageRow; mode: 'relative' | 'absolute'; scaleMax: number }): JSX.Element {
  const total = storageTotal(s)
  const fill = mode === 'absolute' && scaleMax > 0 ? (total / scaleMax) * 100 : 100
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-panel-soft">
      {total <= 0 ? null : (
        <div className="flex h-full gap-px" style={{ width: `${fill}%` }}>
          {STORAGE_CATS.map((c) => {
            const b = catBytes(s, c.key)
            return b <= 0 ? null : (
              <div key={c.key} title={`${c.label} — ${fmtBytes(b)}`} className={cn('h-full min-w-0.5', c.bar)} style={{ width: `${(b / total) * 100}%` }} />
            )
          })}
        </div>
      )}
    </div>
  )
}

const isCoherence = (p: IngestProgress): boolean => p.steps.length === 1 && p.steps[0]?.kind === 'coherence'
const doneCount = (p: IngestProgress): number => p.steps.filter((s) => s.status === 'done' || s.status === 'skipped' || s.status === 'failed').length

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  return m < 90 ? `${m}m` : `${(m / 60).toFixed(1)}h`
}

function activeRow(p: IngestProgress): JobRow {
  return {
    id: p.sessionId,
    kind: isCoherence(p) ? 'coherence' : 'analysis',
    projectName: p.projectName,
    projectRoot: p.projectRoot,
    status: p.error ? 'paused' : 'running',
    done: doneCount(p),
    total: p.steps.length,
    currentLabel: p.steps.find((s) => s.status === 'running')?.label ?? null,
    etaMs: p.etaMs ?? null,
    elapsedMs: Date.now() - Date.parse(p.startedAt),
    cost: p.cost ? { inputTokens: p.cost.inTokens, outputTokens: p.cost.outTokens, backend: p.provider ?? undefined } : null,
    memoryMb: p.memoryMb ?? null,
    provider: p.provider ?? null,
    result: null,
    at: p.startedAt
  }
}

const ACCENT_BG: Record<string, string> = { thread: 'bg-thread', flag: 'bg-flag', muted: 'bg-muted-foreground' }

function StatusPill({ status }: { status: JobRow['status'] }): JSX.Element {
  const m = JOB_STATUSES[status]
  return (
    <span className={cn('inline-flex items-center gap-1', JOB_TONE_CLASS[m.tone])}>
      {m.active && <Loader2 className="size-3 animate-spin" />}
      {m.label}
    </span>
  )
}

function cellContent(col: JobColumn, row: JobRow): ReactNode {
  switch (col.id) {
    case 'projectName':
      return <span className="truncate text-foreground">{row.projectName || '—'}</span>
    case 'kind':
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', ACCENT_BG[JOB_KINDS[row.kind].accent] ?? 'bg-muted-foreground')} />
          {JOB_KINDS[row.kind].label}
        </span>
      )
    case 'status':
      return <StatusPill status={row.status} />
    case 'progress': {
      if (row.status === 'running' || row.status === 'paused') {
        const pct = row.total ? Math.round((row.done / row.total) * 100) : 0
        return (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-border">
              <span className="block h-full rounded-full bg-thread" style={{ width: `${pct}%` }} />
            </span>
            <span className="tabular-nums text-faint">{row.done}/{row.total}</span>
          </span>
        )
      }
      return <span className="tabular-nums text-faint">{row.result ? `${row.result.ok} ok${row.result.failed ? ` · ${row.result.failed} failed` : ''}${row.result.skipped ? ` · ${row.result.skipped} skipped` : ''}` : `${row.done}/${row.total}`}</span>
    }
    case 'etaMs':
      return <span className="tabular-nums text-faint">{row.etaMs != null ? fmtDur(row.etaMs) : row.elapsedMs != null && row.status !== 'running' ? fmtDur(row.elapsedMs) : '—'}</span>
    case 'cost': {
      if (row.cost?.usd != null) return <span className="text-faint">${row.cost.usd.toFixed(2)}</span>
      const tok = (row.cost?.inputTokens ?? 0) + (row.cost?.outputTokens ?? 0)
      return <span className="tabular-nums text-faint">{tok ? `~${tok >= 1e6 ? `${(tok / 1e6).toFixed(1)}M` : tok >= 1e3 ? `${Math.round(tok / 1e3)}k` : tok} tok` : '—'}</span>
    }
    case 'memoryMb':
      return <span className="tabular-nums text-faint">{row.memoryMb != null ? `${row.memoryMb}MB` : '—'}</span>
    case 'provider':
      return <span className="text-faint">{row.provider ?? '—'}</span>
    case 'at':
      return <span className="tabular-nums text-faint">{fmtWhen(row.at)}</span>
    default:
      return null
  }
}

function fmtWhen(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// The queue columns as DataTable columns — the JOB_COLUMNS config (config/jobs.ts) mapped through the shared
// cell renderer. Left UNSORTED on purpose: the row order is meaningful (active run pinned first, then history
// by recency), so sorting is reserved for the Storage table where size/name ordering is what you want.
const QUEUE_COLUMNS: Column<JobRow>[] = JOB_COLUMNS.map((c) => ({
  id: c.id,
  header: c.label,
  cell: (row) => cellContent(c, row),
  align: c.align,
  grow: c.grow,
  truncate: c.grow, // the one growing column is the project name — clip it, don't wrap
  headerTag: c.private ? 'local' : undefined,
  headerHint: c.private ? 'Machine-local — never exported' : undefined
}))

/** One row of the Storage kebab. `onMouseDown` (not click) so it fires before the shell's click-away dismiss. */
function StorageMenuItem({
  label,
  hint,
  disabled,
  danger,
  onClick
}: {
  label: string
  hint?: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault()
        if (!disabled) onClick()
      }}
      className={cn(
        'flex w-full items-center gap-4 px-3 py-1.5 text-left text-[12px] disabled:opacity-40 disabled:hover:bg-transparent',
        danger ? 'text-flag hover:bg-flag/10' : 'text-foreground hover:bg-panel-soft'
      )}
    >
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] tabular-nums text-faint">{hint}</span>}
    </button>
  )
}

/** Per-row storage actions — a hover ⋯ button opening Compact + per-category Clear (each shows its size and is
 *  disabled when empty). Replaces the old wall of tiny labeled buttons. */
function StorageMenu({
  s,
  compacting,
  onCompact,
  onClear
}: {
  s: StorageRow
  compacting: string | null
  onCompact: (root: string) => void
  onClear: (row: StorageRow, kind: StorageKind) => void
}): JSX.Element {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const hasHistory = catBytes(s, 'history') > 0
  const isCompacting = compacting === s.root
  return (
    <>
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAnchor({ x: r.right, y: r.bottom + 2 })
        }}
        title="Storage actions"
        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      {anchor && (
        <ContextMenuShell x={anchor.x} y={anchor.y} onClose={() => setAnchor(null)}>
          <StorageMenuItem
            label={isCompacting ? 'Compacting…' : 'Compact snapshots'}
            hint={hasHistory ? undefined : 'none'}
            disabled={!hasHistory || isCompacting}
            onClick={() => {
              onCompact(s.root)
              setAnchor(null)
            }}
          />
          <MenuSeparator />
          {STORAGE_CATS.filter((c) => c.kind).map((c) => {
            const b = catBytes(s, c.key)
            return (
              <StorageMenuItem
                key={c.key}
                label={`Clear ${c.label}`}
                hint={b > 0 ? fmtBytes(b) : 'empty'}
                disabled={b <= 0}
                danger
                onClick={() => {
                  onClear(s, c.kind as StorageKind)
                  setAnchor(null)
                }}
              />
            )
          })}
        </ContextMenuShell>
      )}
    </>
  )
}

function logText(e: Record<string, unknown>): string {
  const kind = String(e.kind ?? '?')
  const target = e.targetId ? ` ${String(e.targetId)}` : ''
  const ms = typeof e.ms === 'number' ? ` · ${fmtDur(e.ms)}` : ''
  const io = e.promptChars != null || e.responseChars != null ? ` · in ${e.promptChars ?? 0} / out ${e.responseChars ?? 0}` : ''
  const warm = e.warm === false ? ' · (re)booted' : e.warm === true ? ' · warm' : ''
  const status = e.status && e.status !== 'ok' ? ` · ${String(e.status)}` : ''
  return `[${kind}]${target}${ms}${io}${warm}${status}`
}

export function JobsDialog(): JSX.Element {
  const open = useWorkspace((s) => s.jobsOpen)
  const setOpen = useWorkspace((s) => s.setJobsOpen)
  const progress = useWorkspace((s) => s.ingestProgress)
  const project = useWorkspace((s) => s.project)
  const startIngestRun = useWorkspace((s) => s.startIngestRun)

  const [tab, setTab] = useState<'queue' | 'logs' | 'storage'>('queue')
  const [barMode, setBarMode] = useState<'relative' | 'absolute'>('relative')
  const [history, setHistory] = useState<JobRow[]>([])
  const [logs, setLogs] = useState<Record<string, unknown>[]>([])
  const [storage, setStorage] = useState<StorageRow[]>([])
  const [pendingClear, setPendingClear] = useState<{ root: string; name: string; kind: StorageKind } | null>(null)
  const [tick, setTick] = useState(0) // 1s heartbeat → the Elapsed clock ticks + logs refresh between step broadcasts

  const active = progress?.active ? progress : null
  const activeFlag = !!progress?.active

  // Heartbeat: broadcasts land only every ~1–3 min (per step), so without this the Elapsed clock froze and the
  // Logs tab only refreshed on a tab switch. Ticks the whole time the dialog is open — it also paces the
  // external-run poll below (headless runs have no broadcast; without the tick they'd never appear).
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [open])

  // Universal history — refetch on open and whenever a run starts/stops (a finished run enters a ledger).
  // Re-pull every ~3s while open so EXTERNAL runs (headless analysis heartbeating job-live.json) tick live —
  // they have no broadcast channel into this window, polling the ledger is their only path in.
  const pollBeat = Math.floor(tick / 3)
  useEffect(() => {
    if (!open) return
    void window.nvs.listAllJobs().then(setHistory)
  }, [open, activeFlag, pollBeat])

  // Logs — the running (or open) project's telemetry, re-read each heartbeat so new events appear live.
  const logRoot = progress?.projectRoot || project?.root || null
  useEffect(() => {
    if (!open || tab !== 'logs' || !logRoot) {
      setLogs([])
      return
    }
    void window.nvs.readTelemetry(logRoot, 300).then(setLogs)
  }, [open, tab, logRoot, tick])

  // Storage — per-project local-disk usage, refetched when the tab opens (and after a clear).
  useEffect(() => {
    if (!open || tab !== 'storage') return
    void window.nvs.storageUsage().then(setStorage)
  }, [open, tab])
  const doClear = async (): Promise<void> => {
    if (!pendingClear) return
    await window.nvs.clearStorage(pendingClear.root, pendingClear.kind)
    setPendingClear(null)
    void window.nvs.storageUsage().then(setStorage)
  }
  const [compacting, setCompacting] = useState<string | null>(null)
  // Non-destructive reclaim: gzip a project's legacy revert snapshots. Keeps every revert point (unlike
  // "clear history"), so it needs no confirm — just run it and refresh the sizes.
  const doCompact = async (root: string): Promise<void> => {
    setCompacting(root)
    try {
      await window.nvs.compactSnapshots(root)
      await window.nvs.storageUsage().then(setStorage)
    } finally {
      setCompacting(null)
    }
  }

  const rows: JobRow[] = [...(active ? [activeRow(active)] : []), ...history]
  const runPct = active ? (active.steps.length ? Math.round((doneCount(active) / active.steps.length) * 100) : 0) : 0
  const runEta = active?.etaMs ?? null

  const scaleMax = storage.reduce((m, s) => Math.max(m, storageTotal(s)), 0)
  const storageColumns: Column<StorageRow>[] = [
    { id: 'name', header: 'Project', width: 180, truncate: true, sortable: true, sortValue: (s) => s.name.toLowerCase(),
      cell: (s) => <span className="text-foreground" title={s.name}>{s.name}</span> },
    { id: 'comp', header: barMode === 'absolute' ? 'Footprint' : 'Composition', grow: true, cell: (s) => <StorageBar s={s} mode={barMode} scaleMax={scaleMax} /> },
    { id: 'total', header: 'Total', align: 'right', width: 92, sortable: true, sortValue: (s) => s.totalBytes,
      cell: (s) => <span className="font-medium tabular-nums text-foreground">{fmtBytes(s.totalBytes)}</span> },
    { id: 'actions', header: '', align: 'right', width: 44,
      cell: (s) => <StorageMenu s={s} compacting={compacting} onCompact={doCompact} onClear={(row, kind) => setPendingClear({ root: row.root, name: row.name, kind })} /> }
  ]

  return (
    <Dialog
      region="jobsDialog"
      open={open}
      onClose={() => setOpen(false)}
      title="Jobs"
      size="workspace"
      bodyClassName="flex min-h-0 flex-col p-0"
    >
      {/* Toolbar — tabs + queue controls */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-1">
          {(['queue', 'logs', 'storage'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn('rounded px-2 py-0.5 capitalize', tab === t ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft')}>
              {t}
            </button>
          ))}
        </div>
        <span className="text-faint">{tab === 'queue' ? `${rows.length} job${rows.length === 1 ? '' : 's'}` : logRoot ? '' : 'no project'}</span>
        <div className="ml-auto flex items-center gap-2">
          {active ? (
            <Button variant="outline" size="sm" onClick={() => void window.nvs.cancelIngestRun()}>
              <Square className="mr-1 size-3" /> Pause
            </Button>
          ) : (
            <Button size="sm" disabled={!project} onClick={() => void startIngestRun()}>
              <Play className="mr-1 size-3" /> Start analysis
            </Button>
          )}
        </div>
      </div>

      {tab === 'queue' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <DataTable
            columns={QUEUE_COLUMNS}
            rows={rows}
            rowKey={(r) => r.id}
            emptyMessage="No jobs yet — run analysis on a project."
            rowClassName={(r) => (active && r.id === active.sessionId ? 'bg-panel-soft' : undefined)}
          />
        </div>
      ) : tab === 'logs' ? (
        <div className="min-h-0 flex-1 overflow-auto bg-canvas px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          {!logRoot ? (
            <p className="text-faint">Open or run a project to see its analysis logs.</p>
          ) : logs.length === 0 ? (
            <p className="text-faint">No telemetry yet — it appears once a run reads its first scene.</p>
          ) : (
            logs.map((e, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                <span className="text-faint">{String(e.at ?? '').slice(11, 19)} </span>
                {logText(e)}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Legend — identity for the composition bars, so a segment's category is never color-alone. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-[10px] text-muted-foreground">
            {STORAGE_CATS.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1">
                <span className={cn('size-2 rounded-[2px]', c.bar)} />
                {c.label}
              </span>
            ))}
            {/* Scale toggle: Relative = each bar fills 100% (composition only); Absolute = bars scaled to the
                largest project, so bar length is the actual footprint (projects comparable across rows). */}
            <div className="ml-auto flex items-center gap-0.5 rounded bg-panel-soft/60 p-0.5">
              {(['relative', 'absolute'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setBarMode(m)}
                  title={m === 'relative' ? 'Each bar fills 100% — shows composition only' : 'Bars scaled to the largest project — shows actual size'}
                  className={cn('rounded px-2 py-0.5 capitalize transition-colors', barMode === m ? 'bg-panel text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <DataTable
              columns={storageColumns}
              rows={storage}
              rowKey={(s) => s.root}
              emptyMessage="No projects yet."
              density="cozy"
              defaultSort={{ id: 'total', dir: 'desc' }}
            />
          </div>
        </div>
      )}

      {/* Encoding-style detail panel for the running job */}
      {active && tab === 'queue' && (
        <div className="shrink-0 border-t border-border bg-panel-soft px-4 py-3">
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin text-thread" />
            <span className="text-foreground">{isCoherence(active) ? 'Coherence' : 'Analysis'} · {active.projectName || 'project'}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              Elapsed {fmtDur(Date.now() - Date.parse(active.startedAt))}
              {runEta != null && <> · Remaining {fmtDur(runEta)}</>}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-thread transition-all" style={{ width: `${runPct}%` }} />
          </div>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={active.steps.find((s) => s.status === 'running')?.label}>
            {active.steps.find((s) => s.status === 'running')?.label ?? '…'}
          </p>
          {active.error && <p className="mt-1 text-[11px] text-flag">Paused on a connection wall: {active.error.message}</p>}
        </div>
      )}

      <div className="shrink-0 border-t border-border px-4 py-1.5 text-[10px] text-faint">
        History is universal — every project's runs, wherever you are. Pause is safe (resumes where it left off). Cost / memory / provider are machine-local.
      </div>

      <ConfirmDialog
        open={!!pendingClear}
        title={pendingClear ? CLEAR_COPY[pendingClear.kind].title : ''}
        danger
        confirmLabel="Clear"
        message={pendingClear ? (<>{CLEAR_COPY[pendingClear.kind].message}{'\n\n'}<span className="text-foreground">{pendingClear.name}</span></>) : ''}
        onConfirm={() => void doClear()}
        onCancel={() => setPendingClear(null)}
      />
    </Dialog>
  )
}
