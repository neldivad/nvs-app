#!/usr/bin/env node
/**
 * Ingestion telemetry report — turns `.nvs/ingest-telemetry.jsonl` into a health summary. Plain Node (no
 * bundle, no engine), so it reads a run that's still going, finished, or was killed.
 *
 *   node scripts/telemetryReport.mjs "/path/to/project"
 *
 * The headline metric is the WORKING-SET RATIO: dialogue (the actual scene) as a fraction of the prompt.
 * High = we're reading the scene; low = we're carrying the corpus to read a scene, and `parts` names the
 * part that's eating the budget.
 */
import { readFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/telemetryReport.mjs "<project-path>"')
  process.exit(2)
}
const path = join(dir, '.nvs', 'ingest-telemetry.jsonl')
let raw
try {
  raw = readFileSync(path, 'utf8')
} catch {
  console.error(`no telemetry at ${path}\nrun an analysis first: npm run analysis:headless -- "${dir}" --model haiku`)
  process.exit(1)
}
const evts = raw
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return null
    }
  })
  .filter(Boolean)

const scenes = evts.filter((e) => e.kind === 'scene')
const turns = evts.filter((e) => e.kind === 'plan-turn')
const boots = evts.filter((e) => e.kind === 'boot')

const num = (xs) => xs.filter((x) => typeof x === 'number' && !Number.isNaN(x))
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const avg = (xs) => (xs.length ? sum(xs) / xs.length : 0)
const pctl = (xs, p) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`)
const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`)
const bar = (frac, width = 24) => '█'.repeat(Math.round(frac * width)).padEnd(width, '·')

console.log(`\n  Ingestion telemetry — ${basename(dir)}`)
console.log(`  ${evts.length} events · ${scenes.length} scene reads · ${turns.length} plan-turns · ${boots.length} boots`)
if (evts.length) console.log(`  ${evts[0].at} → ${evts[evts.length - 1].at}`)

if (scenes.length) {
  const readMs = num(scenes.map((e) => e.ms))
  const prompt = num(scenes.map((e) => e.promptChars))
  const resp = num(scenes.map((e) => e.responseChars))
  console.log(`\n  READ TIME       avg ${ms(avg(readMs))} · median ${ms(pctl(readMs, 50))} · p95 ${ms(pctl(readMs, 95))} · max ${ms(Math.max(...readMs))}`)
  console.log(`  PROMPT chars    avg ${k(avg(prompt))} · max ${k(Math.max(...prompt))}`)
  console.log(`  RESPONSE chars  avg ${k(avg(resp))} · max ${k(Math.max(...resp))}  (output size drives read time on a small model)`)

  // Working-set audit: average each part across scene reads.
  const partKeys = [...new Set(scenes.flatMap((e) => Object.keys(e.parts ?? {})))]
  const partAvg = partKeys
    .map((key) => ({ key, v: avg(num(scenes.map((e) => e.parts?.[key]))) }))
    .sort((a, b) => b.v - a.v)
  const promptAvg = avg(prompt) || 1
  const dlgFrac = (partAvg.find((p) => p.key === 'dialogue')?.v ?? 0) / promptAvg
  console.log(`\n  WORKING SET  (avg prompt ${k(promptAvg)} chars)`)
  for (const { key, v } of partAvg) {
    const frac = v / promptAvg
    console.log(`    ${key.padEnd(16)} ${bar(frac)} ${(frac * 100).toFixed(0).padStart(3)}%  ${k(v)}`)
  }
  const verdict =
    dlgFrac >= 0.5
      ? 'healthy — the scene is most of its own prompt'
      : `BLOATED — the scene is only ${(dlgFrac * 100).toFixed(0)}% of the prompt; biggest context part: ${partAvg.find((p) => p.key !== 'dialogue')?.key}`
  console.log(`\n  VERDICT  dialogue = ${(dlgFrac * 100).toFixed(0)}% of prompt → ${verdict}`)

  const slow = [...scenes].filter((e) => typeof e.ms === 'number').sort((a, b) => b.ms - a.ms).slice(0, 5)
  console.log(`\n  SLOWEST READS`)
  for (const e of slow) console.log(`    ${ms(e.ms).padStart(7)} · prompt ${k(e.promptChars ?? 0).padStart(6)} · ${e.targetId ?? '?'}`)
}

if (turns.length) {
  const warm = turns.filter((t) => t.warm).length
  console.log(`\n  PLAN TRANSPORT  ${warm}/${turns.length} turns warm · ${turns.length - warm} (re)booted`)
}
if (boots.length) console.log(`  BOOT            avg ${ms(avg(num(boots.map((b) => b.ms))))} (${boots.length}×)`)
console.log('')
