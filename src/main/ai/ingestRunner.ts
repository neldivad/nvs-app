/**
 * The dedicated analysis runner (Phase 2) — the engine behind the single "Update analysis" button.
 *
 * It snapshots the co-located DB, then walks the planned frontier ONE target at a time, broadcasting
 * progress after every step so the dock can show a live queue + per-target loader. Each step is its own
 * writeTier transaction, so a failure leaves prior steps committed and the run continues (resumable
 * frontier). When it finishes it records a session for the "Recent updates" history.
 *
 * Today a step's work is "apply the staged bundle entry" (or skip, honestly, when there's none). Phase 3
 * swaps that single line — `engine.applyEntry(entry)` — for the in-app agent reading the scene live; the
 * runner, progress stream, snapshot, and history all stay exactly as they are.
 */
import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANNELS, type AnalysisDepth, type IngestProgress, type IngestSession, type IngestStep } from '@shared/ipc'
import * as engine from '@engine/index'
import { readSceneBatch, readWindow, readEntityWindow, readCoherence, readDigest, readProfile, resolveModelOutputCap, analysisConcurrency, pooled } from './sceneReader'
import { readContinuity } from './continuityReader'
import { readCritique } from './critiqueReader'
import { batchOutBudget } from '@engine/analysis/extractionBatches'
import { AiError } from './aiErrors'
import { getState, getAnalysis } from './registry'
import { resetIngestTotals, ingestCost, logIngestEvent, type IngestTelemetryEvent } from './ingestTelemetry'

// Working-set M5 — did a scene's re-read MATERIALLY change its downstream contribution? Compares the
// contextKey (summary + thread opens/closes). Thread ops are discrete → exact match. The summary is compared
// by TOKEN OVERLAP (Jaccard), not byte-exact: an LLM re-read rewords a summary cosmetically even for a
// trivial dialogue edit ("who's there"→"who is there"), and byte-exact would cascade on every polish edit.
// Below the threshold = the meaning genuinely moved → cascade; above = cosmetic → downstream stays fresh.
const SEP = String.fromCharCode(1)
const SUMMARY_SIM = 0.82
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2))
}
function materiallyChanged(before: string, after: string): boolean {
  const [bSum = '', bThr = ''] = before.split(SEP)
  const [aSum = '', aThr = ''] = after.split(SEP)
  if (bThr !== aThr) return true // a thread opened/closed differently → real downstream change
  const a = tokens(bSum), b = tokens(aSum)
  if (a.size === 0 && b.size === 0) return false
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const jaccard = inter / (a.size + b.size - inter || 1)
  return jaccard < SUMMARY_SIM
}

let progress: IngestProgress | null = null
let running = false
let runAbort: AbortController | null = null

/** The live run's progress, or null when idle. Headless (analysis:headless) polls this since `broadcast()`
 *  reaches no BrowserWindow; the GUI reads the same object via the onIngestProgress channel. */
export function getIngestProgress(): IngestProgress | null {
  return progress
}

// Phase-aware ETA: scene reads are SERIAL and the bottleneck; window/profile/digest rollups are far cheaper
// AND run in a pool (analysisConcurrency). The naive avg×remaining treated ~200 parallel rollups as serial
// scene reads → ~10× over-estimate. Model the two phases from per-kind timings.
const ROLLUP_FACTOR = 0.35 // a rollup read costs ~a third of a scene read, until we have its real timing
function computeEtaMs(p: IngestProgress): number | null {
  const remaining = p.steps.filter((s) => s.status === 'pending' || s.status === 'running')
  if (remaining.length === 0) return 0
  const acc = new Map<string, { sum: number; n: number }>()
  for (const s of p.steps)
    if ((s.status === 'done' || s.status === 'skipped') && s.ms != null) {
      const a = acc.get(s.kind) ?? { sum: 0, n: 0 }
      a.sum += s.ms
      a.n += 1
      acc.set(s.kind, a)
    }
  const avg = (k: string): number | null => {
    const a = acc.get(k)
    return a && a.n ? a.sum / a.n : null
  }
  const anyAvg = acc.size ? [...acc.values()].reduce((m, a) => m + a.sum, 0) / [...acc.values()].reduce((m, a) => m + a.n, 0) : null
  const sceneAvg = avg('scene') ?? anyAvg
  if (sceneAvg == null) return null // nothing timed yet
  const conc = Math.max(1, analysisConcurrency())
  const byKind = new Map<string, number>()
  for (const s of remaining) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1)
  let ms = 0
  for (const [kind, count] of byKind) {
    if (kind === 'scene') ms += (avg('scene') ?? sceneAvg) * count // serial bottleneck
    else ms += ((avg(kind) ?? sceneAvg * ROLLUP_FACTOR) * count) / conc // parallel pool, lighter
  }
  return ms
}

function broadcast(): void {
  if (progress?.active) {
    progress.etaMs = computeEtaMs(progress)
    progress.memoryMb = Math.round(process.memoryUsage().rss / 1048576)
    progress.cost = ingestCost()
  }
  try {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.onIngestProgress, progress)
  } catch {
    /* headless (ELECTRON_RUN_AS_NODE, e.g. analysis:headless) — no BrowserWindow */
  }
  writeJobHeartbeat()
}

// Cross-process job visibility: a HEADLESS run has no BrowserWindow, so its live progress was invisible to the
// app's Jobs rail. Every broadcast also writes a tiny heartbeat to the project's `.nvs/job-live.json` (local,
// never exported — nvsArtifacts); the app's listAllJobs surfaces any work whose heartbeat is fresh + active as a
// RUNNING row. A stale heartbeat (crashed/killed process) simply ages out — nothing to clean up.
let lastBeat = 0
function writeJobHeartbeat(): void {
  if (!progress?.projectRoot) return
  const now = Date.now()
  if (progress.active && now - lastBeat < 2000) return // throttle live beats; the final (inactive) write always lands
  lastBeat = now
  try {
    const steps = progress.steps
    const done = steps.filter((s) => s.status === 'done' || s.status === 'failed' || s.status === 'skipped').length
    const cur = steps.find((s) => s.status === 'running')
    writeFileSync(
      join(progress.projectRoot, '.nvs', 'job-live.json'),
      JSON.stringify({
        sessionId: progress.sessionId,
        projectName: progress.projectName,
        provider: progress.provider,
        active: progress.active,
        done,
        total: steps.length,
        currentLabel: cur?.label ?? null,
        startedAt: progress.startedAt,
        updatedAt: new Date().toISOString(),
        pid: process.pid
      })
    )
  } catch {
    /* best-effort — a read-only disk must never break the run */
  }
}

/** A tiny yield so the renderer paints the "running" state before a fast synchronous step blocks. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 16))

export async function startIngestRun(forceScenes?: string[], depth: AnalysisDepth = 'full'): Promise<void> {
  if (running) return
  running = true
  runAbort = new AbortController()
  const signal = runAbort.signal
  try {
    resetIngestTotals()
    const plan = engine.planIngestSteps(forceScenes, depth)
    const sessionId = randomUUID()
    const startedAt = new Date().toISOString()
    const proj = engine.currentProject()
    const ai = getState()
    const conn = ai.connections.find((c) => c.id === ai.activeId)
    const provider = conn?.label ?? conn?.type ?? 'plan'
    progress = { sessionId, projectRoot: proj?.root ?? '', projectName: proj?.name ?? '', provider, depth, steps: plan.map((p) => p.step), startedAt, finishedAt: null, active: true }
    broadcast()

    let ok = 0
    let failed = 0
    let skipped = 0
    let rowsWritten = 0
    let fatalError: { kind: string; message: string } | null = null // a connection wall — stop, don't churn
    // Adaptive fast-cancel: an UNEXPECTED crash (a bind overflow, a bad cast) won't fix itself scene-to-scene —
    // it repeats identically across the frontier. Track consecutive identical crash messages and abort the whole
    // run once they pile up, rather than grinding all 120 into the same wall. A normal validation reject or a
    // one-off model hiccup resets the streak, so this only trips on a systemic bug.
    const crashStreak = { note: '', n: 0 }
    const CRASH_STREAK_ABORT = 5
    // Persist a failed step (message + STACK) to the auditable telemetry log — the "not a black box" path: a
    // crash is diagnosable from `.nvs/ingest-telemetry.jsonl` alone, no terminal needed. Also drives fast-cancel.
    const noteFailure = (kind: IngestTelemetryEvent['kind'], targetId: string, note: string, stack?: string): void => {
      logIngestEvent({ kind, targetId, status: 'failed', note, error: stack })
      if (stack) { // only an unexpected CRASH (has a stack) counts toward the abort streak, not a validation reject
        crashStreak.n = crashStreak.note === note ? crashStreak.n + 1 : 1
        crashStreak.note = note
        if (crashStreak.n >= CRASH_STREAK_ABORT) fatalError = { kind: 'crash', message: `Analysis stopped: the same error hit ${crashStreak.n} scenes in a row — “${note}”. See .nvs/ingest-telemetry.jsonl for the full stack.` }
      } else {
        crashStreak.n = 0
      }
    }

    // Stamp the per-step duration (the time cue) and push the update.
    const settle = (step: (typeof plan)[number]['step']): void => {
      if (step.startedAt) step.ms = Date.now() - Date.parse(step.startedAt)
      broadcast()
    }

    // Split the plan. Scene reads are now BATCHED (internal/batched-extraction.md ③): live scene steps pack
    // into output-bounded batches, ONE AI call each. Window/digest/profile rollups run AFTER, in a pool.
    const stagedPlan = plan.filter((p) => p.entry) // pre-staged bundle entries (any kind) — applied directly
    const liveScenePlan = plan.filter((p) => !p.entry && p.step.kind === 'scene') // read live, packed into batches
    const windowPlan = plan.filter((p) => !p.entry && p.step.kind === 'window')
    const digestPlanned = plan.filter((p) => !p.entry && p.step.kind === 'digest') // deepest-first (planner order)
    const profilePlanned = plan.filter((p) => !p.entry && p.step.kind === 'profile') // chain order per character

    // Pre-staged bundle entries first (the rare bundle path) — serial, apply directly.
    for (const item of stagedPlan) {
      if (signal.aborted) break
      const { step, entry } = item
      if (!entry) continue
      step.status = 'running'
      step.startedAt = new Date().toISOString()
      broadcast()
      await tick()
      try {
        const res = engine.applyEntry(entry)
        if (res.ok) {
          const n = Object.values(res.written).reduce((a, b) => a + b, 0)
          step.status = 'done'
          step.note = `${n} row${n === 1 ? '' : 's'}`
          rowsWritten += n
          ok++
        } else {
          step.status = 'failed'
          step.note = res.error ?? 'failed'
          failed++
        }
      } catch (e) {
        const ai = e instanceof AiError ? e : null
        step.status = 'failed'
        step.note = ai?.userMessage ?? (e instanceof Error ? e.message : 'error')
        failed++
        if (ai?.fatal) fatalError = { kind: ai.kind, message: ai.userMessage }
      }
      settle(step)
      if (fatalError || signal.aborted) break
    }

    // Live scenes — packed into batches (the packer sizes on output budget), one AI call per batch. Batches
    // run SERIALLY: each reads context as-of its first scene, which needs the prior batches' threads applied.
    if (!fatalError && !signal.aborted && liveScenePlan.length > 0) {
      const stepByScene = new Map(liveScenePlan.map((p) => [p.step.targetId, p.step]))
      // Backend-adaptive batch size: on the slow serial plan host a batch must EMIT within the turn watchdog
      // (else it times out and loses every scene in it), so plan packs small (≈ per-scene); fast APIs pack to
      // the output cap. See batchOutBudget / internal/batched-extraction.md.
      const isPlan = (getAnalysis()?.type ?? 'plan') === 'plan'
      const turnMs = Number(process.env.NVS_PLAN_TURN_TIMEOUT ?? 600_000)
      // Learn the model's REAL output cap once (Anthropic Models API, ~100-300ms, cached) so batches fill a
      // 64k-output model instead of being throttled to the 8k default — and max_tokens is set to match.
      const apiOutCap = isPlan ? undefined : await resolveModelOutputCap()
      // Plan LAZILY — one batch from the remaining frontier per iteration, re-reading the project's learned k
      // each time. The packer sizes a batch by estimated output = dialogueChars × k; k self-learns from measured
      // samples (recordExtractionSample), but a plan frozen at run start uses the COLD-START prior for ALL scenes
      // — so run 1 packed 1 scene/batch even once calibration knew the real ratio. Re-planning per batch lets k
      // converge WITHIN the run: the first batches pack small, then grow as the real out/in ratio is learned.
      const remaining = new Set(liveScenePlan.map((p) => p.step.targetId))
      while (remaining.size > 0 && !fatalError && !signal.aborted) {
        const batch = engine.planExtractionBatches([...remaining], batchOutBudget(isPlan, turnMs, apiOutCap), depth)[0]
        if (!batch) break
        for (const id of batch.sceneIds) remaining.delete(id) // consume now; a failed scene retries next RUN, not this loop
        const steps = batch.sceneIds.map((id) => stepByScene.get(id)).filter((s): s is NonNullable<typeof s> => !!s)
        const startedAt = new Date().toISOString()
        for (const s of steps) {
          s.status = 'running'
          s.startedAt = startedAt
        }
        broadcast()
        await tick()
        const t0 = Date.now()
        try {
          const { entries, skipped: dropped } = await readSceneBatch(batch.sceneIds, signal, depth)
          const perMs = Math.round((Date.now() - t0) / Math.max(1, batch.sceneIds.length)) // split batch time across its scenes
          let anyChanged = false // did any scene's downstream contribution move (full only) → one cascade from the tail
          for (const entry of entries) {
            const step = stepByScene.get(entry.targetId)
            if (!step) continue
            const editedScene = engine.sceneInputChanged(entry.targetId)
            // A skim→full UPGRADE isn't an "edit" (dialogue/hash unchanged) but IS materially downstream — it adds
            // the things/lore grounding later scenes read as context. Cascade it too, else early skim readings
            // linger downstream (the non-monotonic-depth gap). Read the PRIOR depth before applyEntry overwrites it.
            const skimUpgrade = depth === 'full' && engine.sceneWasSkim(entry.targetId)
            const beforeKey = editedScene ? engine.sceneContextKey(entry.targetId) : ''
            const res = engine.applyEntry(entry)
            if (res.ok) {
              const n = Object.values(res.written).reduce((a, b) => a + b, 0)
              step.status = 'done'
              step.note = `${n} row${n === 1 ? '' : 's'}`
              step.ms = perMs
              rowsWritten += n
              ok++
              if (depth === 'full' && (skimUpgrade || (editedScene && materiallyChanged(beforeKey, engine.sceneContextKey(entry.targetId))))) anyChanged = true
            } else {
              step.status = 'failed'
              step.note = res.error ?? 'failed'
              step.ms = perMs
              failed++
              noteFailure('scene', entry.targetId, res.error ?? 'failed', res.stack) // persist stack → auditable + fast-cancel
            }
          }
          if (fatalError) break // fast-cancel tripped inside this batch — stop before the next
          // Scenes the model dropped/omitted (unknown scene_id, no dialogue) — retried next run.
          for (const d of dropped) {
            const step = stepByScene.get(d.sceneId)
            if (step && step.status === 'running') {
              step.status = 'skipped'
              step.note = d.reason
              step.ms = perMs
              skipped++
            }
          }
          // Any step still running got no result at all — mark it failed so the frontier stays honest.
          for (const s of steps) if (s.status === 'running') { s.status = 'failed'; s.note = 'no result in batch reply'; s.ms = perMs; failed++ }
          // Cascade ONCE from the batch's LAST scene (full only) — re-stales scenes AFTER the batch, never within.
          if (anyChanged) engine.markDownstreamStale(batch.sceneIds[batch.sceneIds.length - 1])
        } catch (e) {
          const ai = e instanceof AiError ? e : null
          const note = ai?.userMessage ?? (e instanceof Error ? e.message : 'error')
          for (const s of steps) if (s.status === 'running') { s.status = 'failed'; s.note = note; failed++ }
          if (ai?.fatal) fatalError = { kind: ai.kind, message: ai.userMessage }
          // A NON-AiError here is a local CRASH surfacing through the batch catch (a context query, or
          // applyEntry→tierInputHash). Persist its full stack to the auditable telemetry log — no terminal
          // needed — and feed the fast-cancel streak so a systemic bug stops the run instead of hitting all 120.
          else if (e instanceof Error) noteFailure('scene', batch.sceneIds[0], note, e.stack)
        }
        broadcast()
        if (fatalError || signal.aborted) break
      }
    }

    // Window/arc steps — one chapter each: per-CHARACTER windows AND per-THING windows, the two reads for a
    // chapter fired together, chapters run in a bounded pool. All writes land through the same applyEntry path
    // (better-sqlite3 is synchronous — interleaved completions can't interleave a transaction).
    if (!fatalError && windowPlan.length > 0) {
      await pooled(
        windowPlan,
        analysisConcurrency(),
        async ({ step }) => {
          step.status = 'running'
          step.startedAt = new Date().toISOString()
          broadcast()
          try {
            const [charR, entR] = await Promise.all([readWindow(step.targetId, signal), readEntityWindow(step.targetId, signal)])
            const charEntries = 'entries' in charR ? charR.entries : []
            const entEntries = 'entries' in entR ? entR.entries : []
            if (charEntries.length === 0 && entEntries.length === 0) {
              step.status = 'skipped'
              step.note = ('skip' in charR ? charR.skip : '') || ('skip' in entR ? entR.skip : '') || 'nothing to window'
              skipped++
            } else {
              let n = 0
              for (const e of [...charEntries, ...entEntries]) {
                const res = engine.applyEntry(e)
                if (res.ok) n += Object.values(res.written).reduce((a, b) => a + b, 0)
              }
              step.status = 'done'
              step.note = `${charEntries.length} character${charEntries.length === 1 ? '' : 's'} · ${entEntries.length} thing${entEntries.length === 1 ? '' : 's'} · ${n} rows`
              rowsWritten += n
              ok++
            }
          } catch (e) {
            const ai = e instanceof AiError ? e : null
            step.status = 'failed'
            step.note = ai?.userMessage ?? (e instanceof Error ? e.message : 'error')
            failed++
            if (ai?.fatal) fatalError = { kind: ai.kind, message: ai.userMessage }
          }
          settle(step)
        },
        () => !!fatalError || signal.aborted // a connection wall stops NEW chapters; in-flight ones finish
      )
    }

    // Profile chains (working-set M3) — grouped BY CHARACTER: chains are strictly sequential within a
    // character (each link consumes the previous), characters run in the same bounded pool as windows.
    if (!fatalError && profilePlanned.length > 0) {
      const byChar = new Map<string, typeof profilePlanned>()
      for (const p of profilePlanned) {
        const eid = p.step.targetId.split('|')[0]
        const arr = byChar.get(eid) ?? []
        arr.push(p)
        byChar.set(eid, arr)
      }
      await pooled(
        [...byChar.values()],
        analysisConcurrency(),
        async (links) => {
          for (const { step } of links) {
            if (fatalError || signal.aborted) return
            step.status = 'running'
            step.startedAt = new Date().toISOString()
            broadcast()
            try {
              const [eid, chapter] = step.targetId.split('|')
              const r = await readProfile(eid, chapter ?? '', signal)
              if ('skip' in r) {
                step.status = 'skipped'
                step.note = r.skip
                skipped++
              } else {
                engine.applyProfile(eid, chapter ?? '', r.body, r.model, r.inputHash)
                step.status = 'done'
                step.note = `${r.body.length} chars`
                rowsWritten += 1
                ok++
              }
            } catch (e) {
              const ai = e instanceof AiError ? e : null
              step.status = 'failed'
              step.note = ai?.userMessage ?? (e instanceof Error ? e.message : 'error')
              failed++
              if (ai?.fatal) fatalError = { kind: ai.kind, message: ai.userMessage }
              settle(step)
              return // a broken link invalidates the rest of THIS character's chain — stop it, not the run
            }
            settle(step)
          }
        },
        () => !!fatalError || signal.aborted
      )
    }

    // Digest reduces (working-set M2) — SEQUENTIAL and deepest-first, so a book digest consumes act digests
    // refreshed moments earlier in this same run. Small count (acts + book), cheap calls.
    if (!fatalError) {
      for (const { step } of digestPlanned) {
        if (signal.aborted) break
        step.status = 'running'
        step.startedAt = new Date().toISOString()
        broadcast()
        try {
          const r = await readDigest(step.targetId, signal)
          if ('skip' in r) {
            step.status = 'skipped'
            step.note = r.skip
            skipped++
          } else {
            engine.applyDigest(step.targetId, r.body, r.model, r.inputHash)
            step.status = 'done'
            step.note = `${r.body.length} chars`
            rowsWritten += 1
            ok++
          }
        } catch (e) {
          const ai = e instanceof AiError ? e : null
          step.status = 'failed'
          step.note = ai?.userMessage ?? (e instanceof Error ? e.message : 'error')
          failed++
          if (ai?.fatal) fatalError = { kind: ai.kind, message: ai.userMessage }
        }
        settle(step)
        if (fatalError) break
      }
    }

    // Clean up umbrellas this pass left beat-less (threads from a prior analysis the re-read didn't reproduce).
    engine.pruneOrphanThreads()

    const finishedAt = new Date().toISOString()
    // Only a run that actually wrote something becomes a version. A no-op pass (everything already fresh)
    // leaves the timeline AND `current` untouched — no empty snapshot, no phantom "you are here".
    if (ok > 0) {
      engine.stampTimelineVersion() // bind this run's analysis rows to the leads_to graph version it walked
      // Snapshot the RESULT — this analysis run is now the current restorable version.
      const snapshotId = engine.snapshotDb(sessionId.slice(0, 8))
      engine.recordSession({
        id: sessionId,
        kind: 'analysis',
        startedAt,
        finishedAt,
        total: plan.length,
        ok,
        failed,
        skipped,
        rowsWritten,
        snapshotId,
        // Provenance: the targets this version actually wrote (= the delta this run cleared).
        targets: plan.filter((p) => p.step.status === 'done').map((p) => ({ kind: p.step.kind, targetId: p.step.targetId, label: p.step.label }))
      })
    } else if (failed > 0) {
      // A run that wrote NOTHING but had failures must still land in Jobs history — an invisible mass-fail is
      // exactly how the te.rowid break hid for a day. No snapshot, no version move (nothing was written); just
      // the ledger row so the dashboard shows "0 ok · N failed".
      engine.recordSession({ id: sessionId, kind: 'analysis', startedAt, finishedAt, total: plan.length, ok, failed, skipped, rowsWritten, snapshotId: null, targets: [] })
    }
    if (progress) progress = { ...progress, finishedAt, active: false, error: fatalError }
    broadcast()
  } finally {
    running = false
    runAbort = null
  }
}

/**
 * The coherence check — its OWN trigger, separate from "Update analysis". One AI call diffs every (stale)
 * character's declared page against their observed arc. It is a CHILD of the current analysis version, not a
 * peer: it records which analysis version it diffed (`basedOn`), does NOT snapshot or move `current` (the
 * findings ride the live DB, re-derivable), and a no-op check isn't recorded at all.
 *
 * `opts.critique` — the author explicitly asked the TOUGH QUESTIONS too (story-critique.md): after the two
 * linter passes, run the opt-in dramaturge pass. Never on by default (deterministic-over-AI ruling).
 */
export async function startCoherenceRun(opts?: { critique?: boolean }): Promise<void> {
  if (running) return
  running = true
  runAbort = new AbortController()
  const signal = runAbort.signal
  try {
    const sessionId = randomUUID()
    const startedAt = new Date().toISOString()
    resetIngestTotals()
    const basedOn = engine.currentVersion() // the analysis version this check is computed against
    const proj = engine.currentProject()
    const ai = getState()
    const conn = ai.connections.find((c) => c.id === ai.activeId)
    const provider = conn?.label ?? conn?.type ?? 'plan'
    const step: IngestStep = { id: 't3:coherence', kind: 'coherence', targetId: 'coherence', label: 'Coherence check', status: 'running', note: null, startedAt, ms: null }
    progress = { sessionId, projectRoot: proj?.root ?? '', projectName: proj?.name ?? '', provider, steps: [step], startedAt, finishedAt: null, active: true }
    broadcast()
    await tick()

    let ok = 0
    let failed = 0
    let skipped = 0
    let rowsWritten = 0
    let fatalError: { kind: string; message: string } | null = null
    try {
      const r = await readCoherence(signal)
      if ('skip' in r) {
        step.status = 'skipped'
        step.note = r.skip
        skipped++
      } else {
        let n = 0
        let chars = 0
        for (const e of r.entries) {
          const res = engine.applyEntry(e)
          if (res.ok) { n += Object.values(res.written).reduce((a, b) => a + b, 0); chars++ }
        }
        step.status = 'done'
        step.note = `${chars} character${chars === 1 ? '' : 's'} · ${n} finding${n === 1 ? '' : 's'}`
        rowsWritten += n
        ok++
      }
    } catch (e) {
      const ai = e instanceof AiError ? e : null
      step.status = 'failed'
      step.note = ai?.userMessage ?? (e instanceof Error ? e.message : 'error')
      failed++
      if (ai?.fatal) fatalError = { kind: ai.kind, message: ai.userMessage }
    }
    if (step.startedAt) step.ms = Date.now() - Date.parse(step.startedAt)
    broadcast()

    // ── Continuity (plot-holes): the story vs itself + its premise — the second coherence kind, in the same run.
    const cStep: IngestStep = { id: 't3:continuity', kind: 'continuity', targetId: 'story', label: 'Continuity check', status: 'running', note: null, startedAt: new Date().toISOString(), ms: null }
    if (progress) { progress = { ...progress, steps: [...progress.steps, cStep] }; broadcast(); await tick() }
    try {
      const r = await readContinuity(signal)
      if ('skip' in r) {
        cStep.status = 'skipped'
        cStep.note = r.skip
        skipped++
      } else {
        const res = engine.writeTier(r.write)
        const n = res.ok ? Object.values(res.written).reduce((a, b) => a + b, 0) : 0
        cStep.status = res.ok ? 'done' : 'failed'
        cStep.note = res.ok ? `${n} hole${n === 1 ? '' : 's'}` : (res.error ?? 'write failed')
        if (res.ok) { rowsWritten += n; ok++ } else { failed++ }
      }
    } catch (e) {
      const aiErr = e instanceof AiError ? e : null
      cStep.status = 'failed'
      cStep.note = aiErr?.userMessage ?? (e instanceof Error ? e.message : 'error')
      failed++
      if (aiErr?.fatal && !fatalError) fatalError = { kind: aiErr.kind, message: aiErr.userMessage }
    }
    if (cStep.startedAt) cStep.ms = Date.now() - Date.parse(cStep.startedAt)
    broadcast()

    // ── Critique ("Tough questions") — ONLY when explicitly asked (opt-in dramaturge pass, story-critique.md).
    const qSteps: IngestStep[] = []
    if (opts?.critique) {
      const qStep: IngestStep = { id: 't3:critique', kind: 'critique', targetId: 'story', label: 'Tough questions', status: 'running', note: null, startedAt: new Date().toISOString(), ms: null }
      qSteps.push(qStep)
      if (progress) { progress = { ...progress, steps: [...progress.steps, qStep] }; broadcast(); await tick() }
      try {
        const r = await readCritique(signal)
        if ('skip' in r) {
          qStep.status = 'skipped'
          qStep.note = r.skip
          skipped++
        } else {
          const res = engine.writeTier(r.write)
          const n = res.ok ? Object.values(res.written).reduce((a, b) => a + b, 0) : 0
          qStep.status = res.ok ? 'done' : 'failed'
          qStep.note = res.ok ? `${n} question${n === 1 ? '' : 's'}` : (res.error ?? 'write failed')
          if (res.ok) { rowsWritten += n; ok++ } else { failed++ }
        }
      } catch (e) {
        const aiErr = e instanceof AiError ? e : null
        qStep.status = 'failed'
        qStep.note = aiErr?.userMessage ?? (e instanceof Error ? e.message : 'error')
        failed++
        if (aiErr?.fatal && !fatalError) fatalError = { kind: aiErr.kind, message: aiErr.userMessage }
      }
      if (qStep.startedAt) qStep.ms = Date.now() - Date.parse(qStep.startedAt)
      broadcast()
    }

    const finishedAt = new Date().toISOString()
    // Record only if it actually re-diffed something (ok>0). No snapshot, no `current` move — recordSession
    // keeps it a child of `basedOn` (the analysis version it was computed against).
    if (ok > 0) {
      engine.recordSession({
        id: sessionId, kind: 'coherence', basedOn,
        startedAt, finishedAt, total: 1, ok, failed, skipped, rowsWritten, snapshotId: null,
        targets: [step, cStep, ...qSteps].filter((s) => s.status === 'done').map((s) => ({ kind: s.kind, targetId: s.targetId, label: s.note ? `${s.label} · ${s.note}` : s.label }))
      })
    }
    if (progress) progress = { ...progress, finishedAt, active: false, error: fatalError }
    broadcast()
  } finally {
    running = false
    runAbort = null
  }
}

/** Stop the current run after the in-flight step (the AI call is aborted via the run's signal). */
export function cancelIngestRun(): void {
  runAbort?.abort()
}

/** The run history + which version the live DB currently reflects (the "you are here" pointer). */
export function listIngestSessions(): { sessions: IngestSession[]; current: string | null } {
  return { sessions: engine.listSessions(), current: engine.currentVersion() }
}

/** Restore a past version (reversible — moves the current pointer; nothing is lost). */
export function revertIngestSession(id: string): boolean {
  return engine.restoreVersion(id)
}
