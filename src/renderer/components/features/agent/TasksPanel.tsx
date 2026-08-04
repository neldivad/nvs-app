/**
 * The Tasks inbox — the WORKER half of the agent surface (the chat is the orchestrator).
 *
 * Lists the ephemeral background WRITE tasks (slash commands + chat fan-out), each one a one-shot page
 * edit. The list is owned by the main process and mirrored into the store via the onTaskUpdate push;
 * this panel is pure view + the per-task controls (cancel / apply / dismiss). Applying routes through the
 * open editor as ONE transaction (the editor owns undo) with an apply-time staleness guard.
 */
import { useEffect, useState, type JSX } from 'react';
import { regionAttrs } from '@/config/regions'
import { CheckCircle2, ChevronRight, Circle, Loader2, X, XCircle, Inbox } from 'lucide-react'
import type { AgentTask, TaskStatus } from '@shared/ipc'
import { useWorkspace } from '@/stores/workspace'
import { modeTone } from '@/components/features/agent/PromptLibraryPanel'
import { ConfirmDialog } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'

export function TasksPanel(): JSX.Element {
  const project = useWorkspace((s) => s.project)
  const tasks = useWorkspace((s) => s.tasks)
  const applyTask = useWorkspace((s) => s.applyTask)
  const hasDone = tasks.some((t) => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled')

  return (
    <div {...regionAttrs('tasksPanel')} className="flex h-full min-w-0 flex-col bg-canvas" style={{ userSelect: 'text' }}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-[10px] text-faint">
        <span>background edits — apply lands as one undo step</span>
        {hasDone && (
          <button onClick={() => window.nvs.clearDoneTasks()} className="ml-auto rounded px-1.5 py-0.5 text-muted-foreground hover:bg-panel-soft">
            Clear done
          </button>
        )}
        {tasks.length > 0 && (
          <button onClick={() => tasks.forEach((t) => window.nvs.dismissTask(t.id))} className={cn('rounded px-1.5 py-0.5 text-muted-foreground hover:bg-panel-soft hover:text-flag', !hasDone && 'ml-auto')}>
            Clear all
          </button>
        )}
      </div>

      {!project ? (
        <Empty>Open a work to run background edits.</Empty>
      ) : tasks.length === 0 ? (
        <Empty>
          <div>
            <Inbox className="mx-auto mb-2 size-5 text-faint" />
            <p>
              No tasks yet. Type <span className="font-mono text-muted-foreground">/ag</span> in a page, or ask the chat to edit across pages.
            </p>
          </div>
        </Empty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-2 text-[11px]">
          {groupTasks(tasks).map((row) =>
            row.tasks.length > 1 ? (
              <TaskGroup key={row.group} tasks={row.tasks} onApply={applyTask} />
            ) : (
              <TaskCard key={row.tasks[0].id} task={row.tasks[0]} onApply={() => void applyTask(row.tasks[0].id)} />
            )
          )}
        </div>
      )}
    </div>
  )
}

type TaskRow = { group?: string; tasks: AgentTask[] }

/** Coalesce consecutive tasks sharing a groupId (a chat fan-out burst) into one row; others stand alone. */
function groupTasks(tasks: AgentTask[]): TaskRow[] {
  const out: TaskRow[] = []
  for (const t of tasks) {
    const last = out[out.length - 1]
    if (t.groupId && last?.group === t.groupId) last.tasks.push(t)
    else out.push({ group: t.groupId, tasks: [t] })
  }
  return out
}

/** A fan-out group — one collapsible entry ("N edits · X done") over its member tasks. Keeps the inbox
 *  from flooding when chat queues an edit across many pages. Apply is still per-page (inside). */
function TaskGroup({ tasks, onApply }: { tasks: AgentTask[]; onApply: (id: string) => void }): JSX.Element {
  const applyGroup = useWorkspace((s) => s.applyGroup)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const doneIds = tasks.filter((t) => t.status === 'done').map((t) => t.id)
  const running = tasks.some((t) => t.status === 'queued' || t.status === 'running')
  return (
    <div className="rounded-md border border-border bg-panel-soft/60">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
          <span className="shrink-0 font-medium text-foreground/90">{tasks.length} edits</span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{tasks[0].instruction}</span>
          <span className="shrink-0 text-[9px] tabular-nums text-faint">{doneIds.length}/{tasks.length}{running ? ' · running' : ''}</span>
        </button>
        {doneIds.length > 0 && (
          <button onClick={() => setConfirm(true)} title="Apply all done edits" className="shrink-0 rounded border border-thread/50 bg-thread/10 px-1.5 py-0.5 text-[10px] text-foreground hover:bg-thread/20">Apply all</button>
        )}
        <button onClick={() => tasks.forEach((t) => window.nvs.dismissTask(t.id))} title="Dismiss all" className="shrink-0 rounded p-0.5 text-faint hover:bg-panel hover:text-flag"><X className="size-3" /></button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 border-t border-border p-1.5">
          {tasks.map((t) => <TaskCard key={t.id} task={t} onApply={() => onApply(t.id)} />)}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Apply ${doneIds.length} edit${doneIds.length > 1 ? 's' : ''}?`}
        message={<>This applies the finished edits across {doneIds.length} page{doneIds.length > 1 ? 's' : ''} — each replaces that page (one Ctrl/Cmd+Z per page undoes it). The editor will step through them.</>}
        confirmLabel={`Apply ${doneIds.length}`}
        danger
        onConfirm={() => { void applyGroup(doneIds); setConfirm(false) }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}

function TaskCard({ task, onApply }: { task: AgentTask; onApply: () => void }): JSX.Element {
  const active = task.status === 'queued' || task.status === 'running'
  // Direct-write pages (custody): the task row owns its rollback, DELEGATED to the page's write
  // history — Undo is offered only while this task's apply is the newest write (later edits would be
  // clobbered otherwise; per-task baseText can't know that, the history can).
  const applied = useWorkspace((s) => s.appliedTasks.includes(task.id))
  const hist = useWorkspace((s) => s.pageHistory[task.pagePath])
  const undoPageWrite = useWorkspace((s) => s.undoPageWrite)
  const redoPageWrite = useWorkspace((s) => s.redoPageWrite)
  const undoable = applied && hist?.past[hist.past.length - 1]?.taskId === task.id
  const redoable = !applied && hist?.future[hist.future.length - 1]?.taskId === task.id
  // While running, count from when it actually started; otherwise show the recorded run duration.
  const live = useElapsed(active ? task.startedAt ?? task.createdAt : null)
  const took = runDuration(task)
  return (
    <div className="rounded-md border border-border bg-panel-soft/60 px-2.5 py-1.5">
      <div className="flex items-start gap-2">
        <StatusIcon status={task.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">{task.pageTitle}</span>
            {active ? (
              <span className="shrink-0 text-[9px] tabular-nums text-faint">{task.status === 'running' ? 'running' : 'queued'} {live}</span>
            ) : (
              took && <span className="shrink-0 text-[9px] tabular-nums text-faint">{took}</span>
            )}
            <span className={cn('shrink-0 rounded border px-1 text-[9px] uppercase tracking-wide', modeTone(task.mode))}>{task.mode}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{task.instruction}</p>
          {task.status === 'failed' && task.error && <p className="mt-0.5 text-[10px] text-warn">⚠ {task.error}</p>}
        </div>
        <button
          onClick={() => (active ? window.nvs.cancelTask(task.id) : window.nvs.dismissTask(task.id))}
          title={active ? 'Cancel' : 'Dismiss'}
          className="shrink-0 rounded p-0.5 text-faint hover:bg-panel hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
      {task.status === 'done' && (
        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          {undoable && (
            <button
              onClick={() => void undoPageWrite(task.pagePath)}
              className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-panel"
            >
              Undo
            </button>
          )}
          {redoable && (
            <button
              onClick={() => void redoPageWrite(task.pagePath)}
              className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-panel"
            >
              Redo
            </button>
          )}
          {/* while Redo is offered it IS the re-apply — two routes to one outcome would be confusing */}
          {!applied && !redoable && (
            <button
              onClick={onApply}
              className="rounded-md border border-thread/50 bg-thread/10 px-2 py-0.5 text-[10px] text-foreground hover:bg-thread/20"
            >
              Review & apply
            </button>
          )}
          {applied && <span className="text-[9px] text-ok">applied ✓</span>}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: TaskStatus }): JSX.Element {
  if (status === 'running') return <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-thread" />
  if (status === 'done') return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" />
  if (status === 'failed') return <XCircle className="mt-0.5 size-3.5 shrink-0 text-flag" />
  if (status === 'cancelled') return <XCircle className="mt-0.5 size-3.5 shrink-0 text-faint" />
  return <Circle className="mt-0.5 size-3.5 shrink-0 text-faint" /> // queued
}

function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-[12px] text-muted-foreground">{children}</div>
}

/** Live "it's alive" clock for an active task (ticks while `since` is set) → e.g. "0:08". */
function useElapsed(since: string | null): string {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!since) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [since])
  if (!since) return ''
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** How long a finished task took (started→finished), e.g. "took 0:12". Empty if it never ran. */
function runDuration(task: AgentTask): string {
  if (!task.startedAt || !task.finishedAt) return ''
  const s = Math.max(0, Math.round((Date.parse(task.finishedAt) - Date.parse(task.startedAt)) / 1000))
  return `took ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The count of finished, not-yet-applied tasks — drives the Tasks tab badge. */
export function doneTaskCount(tasks: AgentTask[]): number {
  return tasks.filter((t) => t.status === 'done').length
}
