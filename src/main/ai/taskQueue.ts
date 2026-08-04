/**
 * Tasks inbox — a registry of background WRITE tasks (slash commands + chat fan-out). Tasks run SERIALIZED
 * (one at a time) because the Plan host is a subprocess; each is a one-shot `runPageAgent` call. The renderer
 * reviews a finished task and applies its `result` to the page as ONE editor transaction (editor owns undo —
 * there is no taskbox undo stack).
 *
 * DURABLE, PER-PROJECT: the inbox persists to `.nvs/tasks/<id>.json` (one file per task). A COMPLETED task
 * holds the AI `result` that was already PAID FOR — so losing it on quit threw away money. Now each mutation
 * writes (or unlinks) exactly the task it changed, and `loadTasks(root)` swaps the in-memory list to the
 * opened project's on `openWork` — making this a real per-project inbox (a task from project A no longer
 * lingers when B opens) whose done results survive a restart. A task caught mid-flight by a quit
 * (queued/running) is restored as FAILED (interrupted); we never auto-resume, so an API call that may already
 * have run can't be silently re-charged.
 *
 * Shared concerns vs. the chat inbox: a list cap (evict oldest finished) and an apply-time staleness guard
 * (the renderer compares the live page to the task's `baseText`).
 */
import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANNELS } from '@shared/ipc'
import type { AgentTask, TaskInput } from '@shared/ipc'
import { runPageAgent } from './pageAgent'
import { reconcileLoadedTasks } from './taskRestore'

const MAX_TASKS = 30 // inbox cap — never evict queued/running, only the oldest finished
// Safety net per task — never hang forever. Was 120s, which KILLED plan-backend page reformats mid-run (the plan
// warm-session's own turn allows 600s). Default 10min so the net doesn't fire before the backend's real timeout;
// env-tunable for slow/large pages.
const TASK_TIMEOUT = Number(process.env.NVS_TASK_TIMEOUT) || 600_000

let tasks: AgentTask[] = []
let running = false
let currentId: string | null = null
let currentAbort: AbortController | null = null

// ── Durable per-project inbox (`.nvs/tasks/<id>.json`) ───────────────────────
// `currentRoot` is the project whose inbox is live; set by loadTasks on openWork. Null (no project / headless
// with no work) → persistence is skipped, so the queue degrades to the old in-memory behaviour rather than
// erroring. Writes are targeted (one file per changed task) since n ≤ MAX_TASKS and most mutations touch one.
let currentRoot: string | null = null

function tasksDir(): string | null {
  return currentRoot ? join(currentRoot, '.nvs', 'tasks') : null
}
function writeTaskFile(t: AgentTask): void {
  const dir = tasksDir()
  if (!dir) return
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${t.id}.json`), JSON.stringify(t), 'utf8')
  } catch {
    /* best-effort — a persistence hiccup must never break the running queue */
  }
}
function removeTaskFile(id: string): void {
  const dir = tasksDir()
  if (!dir) return
  try {
    rmSync(join(dir, `${id}.json`), { force: true })
  } catch {
    /* ignore */
  }
}

/**
 * Swap the in-memory inbox to the opened project's persisted tasks (called on openWork). A task caught
 * mid-flight when the app closed (queued/running) is restored as FAILED (interrupted) — we never auto-resume,
 * to avoid re-charging an API call that may already have run. Completed `done` results are restored intact for
 * the author to apply. Idempotent, and safe to call on every open.
 */
export function loadTasks(root: string): void {
  currentRoot = root
  const dir = tasksDir()
  const loaded: AgentTask[] = []
  if (dir && existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const t = JSON.parse(readFileSync(join(dir, f), 'utf8')) as AgentTask
        if (t && typeof t.id === 'string') loaded.push(t)
      } catch {
        /* skip a corrupt task file rather than fail the whole open */
      }
    }
  }
  const wasMidFlight = new Set(loaded.filter((t) => t.status === 'queued' || t.status === 'running').map((t) => t.id))
  tasks = reconcileLoadedTasks(loaded, new Date().toISOString())
  for (const t of tasks) if (wasMidFlight.has(t.id)) writeTaskFile(t) // persist the downgrades so the next open is already stable
  // No queued tasks survive the downgrade, so there's nothing to auto-pump; reset the run guard for the new
  // project. (Switching projects mid-run is an edge case — the old run's in-flight result is not recoverable.)
  running = false
  currentId = null
  currentAbort = null
  broadcast()
}

function broadcast(): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.onTaskUpdate, tasks)
  } catch {
    /* headless (ELECTRON_RUN_AS_NODE) — no BrowserWindow */
  }
}

/** Cap the inbox: drop the oldest finished tasks once over MAX_TASKS. Queued/running are never evicted. */
function trim(): void {
  if (tasks.length <= MAX_TASKS) return
  const finished = (t: AgentTask): boolean => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled'
  let over = tasks.length - MAX_TASKS
  tasks = tasks.filter((t) => {
    if (over > 0 && finished(t)) {
      over--
      removeTaskFile(t.id) // evicted from the inbox → drop its file too
      return false
    }
    return true
  })
}

function set(id: string, patch: Partial<AgentTask>): void {
  let updated: AgentTask | undefined
  tasks = tasks.map((t) => (t.id === id ? (updated = { ...t, ...patch }) : t))
  if (updated) writeTaskFile(updated) // persist the changed task (status transition, or the completed result)
}

export function listTasks(): AgentTask[] {
  return tasks
}

const GROUP_WINDOW = 15_000 // a chat fan-out queues many same-instruction edits in a burst → one group

export function enqueueTask(input: TaskInput): string {
  const id = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const now = Date.now()
  // Group a burst: if a recent task shares this instruction + mode, fold both into one group entry.
  const recent = [...tasks].reverse().find((t) => t.instruction === input.instruction && t.mode === input.mode && now - Date.parse(t.createdAt) < GROUP_WINDOW)
  let groupId: string | undefined
  if (recent) {
    groupId = recent.groupId ?? recent.id
    if (!recent.groupId) {
      tasks = tasks.map((t) => (t.id === recent.id ? { ...t, groupId } : t)) // backfill the first
      const backfilled = tasks.find((t) => t.id === recent.id)
      if (backfilled) writeTaskFile(backfilled)
    }
  }
  const task: AgentTask = { ...input, id, groupId, status: 'queued', createdAt: new Date().toISOString() }
  tasks = [...tasks, task]
  writeTaskFile(task)
  trim()
  broadcast()
  void pump()
  return id
}

/** Run queued tasks one at a time. Re-entrancy-guarded by `running`. */
async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    let next: AgentTask | undefined
    while ((next = tasks.find((t) => t.status === 'queued'))) {
      const id = next.id
      const ac = new AbortController()
      currentId = id
      currentAbort = ac
      // The timeout and a user-cancel both abort — but a TIMEOUT is a failure with a real reason, not a cancel.
      // Track it so the terminal state is 'failed' with a clear message instead of a silent 'cancelled'.
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; ac.abort() }, TASK_TIMEOUT)
      set(id, { status: 'running', startedAt: new Date().toISOString() })
      broadcast()
      const done = (): string => new Date().toISOString()
      // Terminal state on a non-ok result / thrown error: timeout → failed + reason; user-cancel → cancelled; else failed.
      const failState = (err: string | undefined): { status: 'failed' | 'cancelled'; error?: string } =>
        timedOut
          ? { status: 'failed', error: `Timed out after ${Math.round(TASK_TIMEOUT / 1000)}s — the page may be long or the plan/model slow. Try again, or split the scene into smaller edits.` }
          : ac.signal.aborted
            ? { status: 'cancelled', error: err }
            : { status: 'failed', error: err }
      try {
        const res = await runPageAgent({ pageText: next.baseText, instruction: next.instruction, mode: next.mode, kind: next.pageKind, pageTitle: next.pageTitle }, ac.signal)
        // The task may have been cancelled while in flight — don't clobber that terminal state.
        if (tasks.find((t) => t.id === id)?.status === 'running') {
          if (res.ok) set(id, { status: 'done', result: res.text, finishedAt: done() })
          else set(id, { ...failState(res.error), finishedAt: done() })
        }
      } catch (err) {
        if (tasks.find((t) => t.id === id)?.status === 'running') {
          set(id, { ...failState(err instanceof Error ? err.message : String(err)), finishedAt: done() })
        }
      } finally {
        clearTimeout(timer)
        if (currentId === id) {
          currentId = null
          currentAbort = null
        }
      }
      broadcast()
    }
  } finally {
    running = false
  }
}

/** Cancel a queued (drop) or running (abort) task. */
export function cancelTask(id: string): void {
  const t = tasks.find((x) => x.id === id)
  if (!t) return
  if (t.status === 'running' && currentId === id) currentAbort?.abort()
  else if (t.status === 'queued') set(id, { status: 'cancelled', finishedAt: new Date().toISOString() })
  broadcast()
}

/** Remove a task from the inbox entirely (any status). Aborts it first if it's the running one. */
export function dismissTask(id: string): void {
  if (currentId === id) currentAbort?.abort()
  tasks = tasks.filter((t) => t.id !== id)
  removeTaskFile(id)
  broadcast()
}

/** Clear every finished task; keep queued/running. */
export function clearDoneTasks(): void {
  const kept = tasks.filter((t) => t.status === 'queued' || t.status === 'running')
  for (const t of tasks) if (t.status !== 'queued' && t.status !== 'running') removeTaskFile(t.id)
  tasks = kept
  broadcast()
}
