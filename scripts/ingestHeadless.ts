/**
 * Headless engine ingest CLI — run the NVS engine's T1 ingest on a project folder (or a directory OF them)
 * WITHOUT the GUI/Electron window. Validates that a parser's output is engine-ingestable and prints what the
 * engine built from it (the "assets": scenes, dialogue, entities, units …).
 *
 * The engine is Electron-free, but its better-sqlite3 binding is built for Electron's ABI — so this is bundled
 * (esbuild, @shared resolved, better-sqlite3 external) and run under Electron-as-node, reusing that exact
 * binding with no rebuild. See `npm run ingest:headless`.
 *
 *   npm run ingest:headless -- /path/to/parser/output      # a work, or a dir of works
 *   npm run ingest:headless                                 # default: nvs-parser/tests/output
 *   NVS_INGEST_FRESH=0 npm run ingest:headless -- <path>    # keep existing .nvs (default wipes → clean-slate)
 *
 * T1 only (structure · dialogue · entities — deterministic, no AI). Exit 1 if any project ingests to 0
 * scenes/dialogue (a parser/shape problem), 2 if the path has no works, else 0.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as engine from '../src/engine/index'

const ROOT = process.argv[2] ?? process.env.NVS_INGEST_ROOT ?? '/home/david/Desktop/programming/nelapps/nvs-parser/tests/output'
const FRESH = process.env.NVS_INGEST_FRESH !== '0'

/** The root itself if it's a work (has content/), else its immediate work subfolders. */
function workDirs(root: string): string[] {
  if (!existsSync(root)) return []
  if (engine.isWork(root)) return [root]
  return readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => {
      try {
        return statSync(p).isDirectory() && engine.isWork(p)
      } catch {
        return false
      }
    })
    .sort()
}

const dirs = workDirs(ROOT)
if (!dirs.length) {
  console.error(`No works (folders with a content/ dir) under: ${ROOT}`)
  process.exit(2)
}

console.log(`Ingesting ${dirs.length} project(s) from ${ROOT}${FRESH ? '  (clean-slate)' : ''}\n`)
const report: Record<string, string | number>[] = []
const integrityDetail: { name: string; issues: ReturnType<typeof engine.listIntegrityIssues> }[] = []
let failures = 0
let integrityFail = 0

for (const dir of dirs) {
  const name = basename(dir)
  try {
    if (FRESH) rmSync(join(dir, '.nvs'), { recursive: true, force: true }) // regenerate the assets from scratch
    const proj = engine.openWork(dir)
    if (!proj) {
      report.push({ project: name, status: 'NOT A WORK' })
      failures++
      continue
    }
    const res = engine.ingestWork() // T1
    const counts = Object.fromEntries(engine.inspectTables().map((t) => [t.name, t.count]))
    const ok = res.scenes > 0 && res.dialogNodes > 0
    if (!ok) failures++
    // Deterministic "second reader" — the same engine check the app's Coherence rail runs, surfaced headless.
    const integrity = engine.listIntegrityIssues()
    const iErr = integrity.filter((x) => x.severity === 'error').length
    if (iErr) integrityFail++
    if (integrity.length) integrityDetail.push({ name, issues: integrity })
    report.push({
      project: name,
      status: ok ? 'ok' : 'EMPTY',
      chapters: res.chapters,
      scenes: res.scenes,
      dialogue: res.dialogNodes,
      entities: counts.entities ?? 0,
      units: counts.narrative_units ?? 0,
      integrity: iErr ? `${iErr} err` : integrity.length ? `${integrity.length} note` : '—'
    })
  } catch (e) {
    failures++
    report.push({ project: name, status: 'ERROR: ' + (e instanceof Error ? e.message : String(e)).slice(0, 70) })
  }
}

console.table(report)

if (integrityDetail.length) {
  console.log('\nStructural integrity (deterministic second reader):')
  for (const { name, issues } of integrityDetail) {
    for (const it of issues.slice(0, 8)) {
      const mark = it.severity === 'error' ? '✗' : it.severity === 'warn' ? '!' : '·'
      console.log(`  ${mark} [${name}] ${it.message}`)
    }
    if (issues.length > 8) console.log(`  … and ${issues.length - 8} more in ${name}`)
  }
}

console.log(failures ? `\n✗ ${failures}/${dirs.length} project(s) failed to ingest — see status above` : `\n✓ all ${dirs.length} project(s) ingested cleanly`)
if (integrityFail) console.log(`✗ ${integrityFail} project(s) have STRUCTURAL ERRORS (duplicate scene_id / dangling leads_to) — fix before shipping`)
console.log('  (T1 assets written to each project’s .nvs/nvs.db — inspect with the app’s dev Database tab)')
process.exit(failures || integrityFail ? 1 : 0)
