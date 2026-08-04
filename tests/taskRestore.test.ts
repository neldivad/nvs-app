import { describe, it, expect } from 'vitest'
import { reconcileLoadedTasks, INTERRUPTED_MSG } from '../src/main/ai/taskRestore'
import type { AgentTask, TaskStatus } from '../src/shared/ipc'

// The durable inbox exists so a COMPLETED task's paid-for AI result survives a quit. On restart we must:
// keep done/failed/cancelled intact (the results the author still needs), and downgrade anything caught
// mid-flight to a clear FAILED state WITHOUT auto-resuming (no silent re-charge). Pure logic, no DB/electron.
const NOW = '2026-07-29T12:00:00.000Z'
const task = (id: string, status: TaskStatus, extra: Partial<AgentTask> = {}): AgentTask => ({
  id,
  status,
  pagePath: `/proj/${id}.md`,
  pageTitle: id,
  pageKind: 'scene',
  instruction: 'tighten the prose',
  mode: 'maintenance',
  baseText: 'before',
  createdAt: `2026-07-29T10:0${id.slice(-1)}:00.000Z`,
  ...extra
})

describe('reconcileLoadedTasks — durable inbox recovery on open', () => {
  it('KEEPS a completed task and its paid-for result untouched', () => {
    const done = task('t1', 'done', { result: 'the edited markdown', finishedAt: '2026-07-29T10:05:00.000Z' })
    const [out] = reconcileLoadedTasks([done], NOW)
    expect(out).toEqual(done) // result + status preserved verbatim — this is the whole point
  })

  it('downgrades a RUNNING task to failed (interrupted) — never auto-resumes', () => {
    const [out] = reconcileLoadedTasks([task('t2', 'running', { startedAt: '2026-07-29T10:04:00.000Z' })], NOW)
    expect(out.status).toBe('failed')
    expect(out.error).toBe(INTERRUPTED_MSG)
    expect(out.finishedAt).toBe(NOW)
  })

  it('downgrades a QUEUED task the same way (surfaced, not silently re-run)', () => {
    const [out] = reconcileLoadedTasks([task('t3', 'queued')], NOW)
    expect(out.status).toBe('failed')
    expect(out.error).toBe(INTERRUPTED_MSG)
  })

  it('leaves already-terminal failed/cancelled tasks alone', () => {
    const failed = task('t4', 'failed', { error: 'model error', finishedAt: '2026-07-29T10:06:00.000Z' })
    const cancelled = task('t5', 'cancelled', { finishedAt: '2026-07-29T10:07:00.000Z' })
    const out = reconcileLoadedTasks([failed, cancelled], NOW)
    expect(out.find((t) => t.id === 't4')).toEqual(failed) // original error kept, not overwritten
    expect(out.find((t) => t.id === 't5')).toEqual(cancelled)
  })

  it('orders the inbox by creation time', () => {
    const out = reconcileLoadedTasks([task('t3', 'done'), task('t1', 'done'), task('t2', 'done')], NOW)
    expect(out.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
  })

  it('does not mutate the input array', () => {
    const input = [task('t2', 'running'), task('t1', 'done')]
    const snapshot = JSON.parse(JSON.stringify(input))
    reconcileLoadedTasks(input, NOW)
    expect(input).toEqual(snapshot)
  })
})
