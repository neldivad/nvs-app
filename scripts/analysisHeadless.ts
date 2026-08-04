/**
 * Headless analysis runner — runs the T2 AI analysis (the GUI's "Update analysis" button) on a project
 * WITHOUT the Electron window, on the KEYLESS 'plan' backend (Claude Code login, no API key). Built for
 * long background jobs driven from a Claude Cowork session.
 *
 * Reuses the exact engine + ai runtime the GUI uses: engine.ingestWork() for T1 (deterministic
 * structure/dialogue/entities), then startIngestRun() for T2 (the AI passes) routed through the plan
 * host (planRun → @anthropic-ai/claude-agent-sdk on your `claude` login). Progress broadcasts are a
 * no-op headless (no BrowserWindows), so nothing needs stubbing.
 *
 * Bundled + run under Electron-as-node so better-sqlite3's ABI matches (see `npm run analysis:headless`).
 *
 *   npm run analysis:headless -- "/path/to/project"                     # analysis (sonnet), RESUMABLE
 *   npm run analysis:headless -- "/path/to/project" --model haiku       # analysis on haiku (cheaper)
 *   npm run analysis:headless -- "/path/to/project" --scene <sceneId>   # one scene (smoke test)
 *   npm run analysis:headless -- "/path/to/project" --model haiku --coherence       # T2 + coherence
 *   npm run analysis:headless -- "/path/to/project" --fresh             # clean-slate: wipe DB + re-analyse ALL
 *   ANTHROPIC_API_KEY=sk-… npm run analysis:headless -- "/path"                          # anthropic API (no plan cap)
 *   OPENROUTER_API_KEY=sk-… npm run analysis:headless -- "/path" --provider openrouter    # openrouter (no plan cap)
 *   npm run analysis:headless -- "/path" --connection "My Anthropic"                     # reuse an app-configured connection
 *
 * RESUMABLE by default: the run only does the stale/un-analysed FRONTIER (input-hash based), so a killed job
 * re-run continues where it left off — already-analysed scenes are skipped. `--fresh` forces a full rebuild.
 * A big classical novel (100+ scenes) is many serial LLM calls → cost is TIME + tokens; kill/resume freely.
 *
 * Memory: the plan host is SERIAL (one `claude` process ~300MB at a time) + the engine host — peak <1GB,
 * flat regardless of project size. Cost of a big project is time, not memory.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import * as engine from '../src/engine/index'
import { saveConnection, setActiveConnection, setAnalysisConnection, getState } from '../src/main/ai/registry'
import type { AiProviderType } from '../src/shared/config/aiProviders'
import { startIngestRun, startCoherenceRun, getIngestProgress } from '../src/main/ai/ingestRunner'

// A long run prints progress on a 15s interval. If whoever launched us closes the read end of the pipe (the
// terminal closes, the launcher exits, a `| head` truncates), the NEXT console.log throws `write EPIPE` — which,
// uncaught, surfaced as Electron's "A JavaScript error occurred in the main process" dialog on repeat. A broken
// output pipe is not a failure of the analysis: swallow EPIPE on stdout/stderr and exit cleanly instead.
for (const s of [process.stdout, process.stderr]) {
  s.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0)
    throw err
  })
}

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
const modelFlag = args.indexOf('--model') !== -1 ? args[args.indexOf('--model') + 1] : undefined
const sceneFlag = args.indexOf('--scene') !== -1 ? args[args.indexOf('--scene') + 1] : undefined
const coherenceOnly = args.includes('--coherence-only')
const runCoherence = args.includes('--coherence') || coherenceOnly
const model = modelFlag ?? process.env.NVS_MODEL ?? 'sonnet'
// Backend selection. Keyed providers (anthropic · openrouter) have NO plan usage cap → best for big unattended
// jobs; pick with `--provider anthropic|openrouter` (+ `--api-key <key>` or the provider's env var), or reuse a
// connection already configured in the app with `--connection <label|id>`. Default = the keyless 'plan' host.
const connFlag = args.indexOf('--connection') !== -1 ? args[args.indexOf('--connection') + 1] : undefined
const providerFlag = (args.indexOf('--provider') !== -1 ? args[args.indexOf('--provider') + 1] : undefined) as AiProviderType | undefined
const keyFlag = args.indexOf('--api-key') !== -1 ? args[args.indexOf('--api-key') + 1] : undefined
const ENV_KEY: Partial<Record<AiProviderType, string | undefined>> = { anthropic: process.env.ANTHROPIC_API_KEY, openrouter: process.env.OPENROUTER_API_KEY }
// Resolve provider: explicit --provider, else infer from whichever key is present, else keyless plan.
const provider: AiProviderType = providerFlag ?? (keyFlag ? 'anthropic' : ENV_KEY.anthropic ? 'anthropic' : ENV_KEY.openrouter ? 'openrouter' : 'plan')
const apiKey = provider === 'plan' ? undefined : keyFlag ?? ENV_KEY[provider]
const oneScene = sceneFlag
// RESUMABLE by default: keep the existing analysis DB so a re-run only does the REMAINING frontier — a killed
// job resumes instead of restarting (the frontier is input-hash based, so already-analysed scenes are skipped).
// Opt into a clean-slate full rebuild with `--fresh` (or NVS_ANALYSIS_FRESH=1).
const FRESH = args.includes('--fresh') || process.env.NVS_ANALYSIS_FRESH === '1'

async function main(): Promise<number> {
  if (!dir) {
    console.error('usage: npm run analysis:headless -- <project-path> [sceneId]')
    return 2
  }
  if (!engine.isWork(dir)) {
    console.error(`Not a work (no content/ dir): ${dir}`)
    return 2
  }

  if (FRESH) {
    // Opt-in clean-slate (`--fresh`): drop the analysis DB so T1 re-ingests from scratch and the WHOLE work
    // re-analyses. The manifest (.nvs/project.json) is preserved. Default (no flag) KEEPS the DB → resumable.
    console.log('--fresh: wiping the analysis DB for a full rebuild')
    for (const f of ['nvs.db', 'nvs.db-wal', 'nvs.db-shm', 'snapshots', 'snapshot-cache']) {
      rmSync(join(dir, '.nvs', f), { recursive: true, force: true })
    }
  }

  const proj = engine.openWork(dir)
  console.log(`opened: ${proj?.title ?? dir}`)

  // T1 — deterministic ingest so the DB has scenes/dialogue/entities for the AI passes to read.
  const t1 = engine.ingestWork()
  console.log(`T1 ingest: ${t1.scenes} scenes, ${t1.dialogNodes} dialogue nodes`)
  if (t1.scenes === 0) {
    console.error('0 scenes — nothing to analyze')
    return 1
  }

  // The analysis frontier is CANON scenes only (phase: canon) — converted scenes ship as draft, so mark
  // them canon and re-ingest to open the gate. (Alternatively, emit scenes as canon in the converter.)
  let canonized = 0
  for (const sc of engine.listScenes()) {
    const doc = engine.readScene(sc.path)
    if (doc.frontmatter?.phase !== 'canon') {
      engine.writeScene(sc.path, { ...doc.frontmatter, phase: 'canon' }, doc.body)
      canonized++
    }
  }
  if (canonized) {
    engine.ingestWork()
    console.log(`marked ${canonized} scenes canon (opened the analysis gate)`)
  }

  // Route BOTH the active and the dedicated analysis slot to the chosen backend.
  let connId: string
  if (connFlag) {
    // Reuse a connection already configured in the app (by id or label) — the end-user's own provider/key.
    const c = getState().connections.find((x) => x.id === connFlag || x.label === connFlag)
    if (!c) {
      console.error(`--connection "${connFlag}" not found. Configured: ${getState().connections.map((x) => x.label).join(', ') || '(none)'}`)
      return 2
    }
    connId = c.id
    console.log(`analysis backend: reusing "${c.label}" (${c.type}), model=${c.model}`)
  } else {
    if (provider !== 'plan' && !apiKey) {
      console.error(`provider "${provider}" needs a key — pass --api-key <key> or set ${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY'}`)
      return 2
    }
    // Upsert a headless connection per provider (reused across runs — no duplicates).
    const label = `${provider} (headless)`
    const existing = getState().connections.find((x) => x.label === label)
    const st = saveConnection({ id: existing?.id, type: provider, label, model, secret: apiKey })
    connId = existing?.id ?? st.connections.find((x) => x.label === label)!.id
    console.log(`analysis backend: ${provider}${apiKey ? ' (API key — no plan usage cap)' : ' (keyless Claude Code login — usage-capped)'}, model=${model}`)
  }
  setActiveConnection(connId)
  setAnalysisConnection(connId)

  const t0 = Date.now()

  if (!coherenceOnly) {
    // Preview the frontier so a big run announces its size (and, when resuming, how much is left).
    const plan = engine.planIngestSteps(oneScene ? [oneScene] : undefined)
    console.log(`analysis frontier: ${plan.length} target(s)${FRESH ? '' : ' remaining (resuming — already-analysed targets are skipped)'}`)
    if (plan.length === 0) {
      console.log('nothing to analyse — every target is already fresh.')
    } else {
      console.log(`starting analysis run on ${model}${oneScene ? ` — one scene: ${oneScene}` : ''}…`)
      // Headless has no BrowserWindow, so the runner's broadcast() is a no-op — poll the progress ourselves so
      // a multi-hour job shows life (done/total · % · elapsed · current target) instead of silence.
      const poll = setInterval(() => {
        const p = getIngestProgress()
        if (!p) return
        const done = p.steps.filter((s) => s.status === 'done' || s.status === 'skipped' || s.status === 'failed').length
        const cur = p.steps.find((s) => s.status === 'running')
        const el = Math.round((Date.now() - t0) / 1000)
        console.log(`  … ${done}/${p.steps.length} (${Math.round((done / Math.max(1, p.steps.length)) * 100)}%) · ${el}s${cur ? ` · ${cur.label}` : ''}`)
      }, 15000)
      try {
        await startIngestRun(oneScene ? [oneScene] : undefined)
      } finally {
        clearInterval(poll)
      }
      // HONEST summary — "✓ complete in 2s" once masked a run where EVERY step failed instantly (a broken read
      // query) and nothing was written. Tally the step outcomes + surface the distinct notes; all-failed = exit 1.
      const steps = getIngestProgress()?.steps ?? []
      const okN = steps.filter((s) => s.status === 'done').length
      const skipN = steps.filter((s) => s.status === 'skipped').length
      const failN = steps.filter((s) => s.status === 'failed').length
      const notes = [...new Set(steps.filter((s) => s.status === 'failed' || s.status === 'skipped').map((s) => s.note).filter(Boolean))].slice(0, 6)
      console.log(`analysis finished in ${Math.round((Date.now() - t0) / 1000)}s — ${okN} done · ${skipN} skipped · ${failN} failed`)
      if (notes.length) console.log(`  notes: ${notes.join(' | ')}`)
      if (okN === 0 && (failN > 0 || skipN === steps.length)) {
        console.error(`✗ NOTHING was analysed — every step ${failN > 0 ? 'failed' : 'was skipped'}. Fix the notes above and re-run.`)
        return 1
      }
    }
  }

  if (runCoherence) {
    console.log('starting coherence run…')
    const tc = Date.now()
    await startCoherenceRun()
    console.log(`✓ coherence complete in ${Math.round((Date.now() - tc) / 1000)}s`)
  }

  console.log(`✓ total: ${Math.round((Date.now() - t0) / 1000)}s`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('analysis run failed:', e instanceof Error ? e.stack : String(e))
    process.exit(1)
  })
