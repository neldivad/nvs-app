/**
 * ONE-OFF disk migration (2026-07-17) — retires the app's in-app back-compat layer.
 *
 * Folds the OLD project-wide canvas out of `.nvs/timeline.json` into the per-variant `.nvs/trees.json`
 * (the T10/T11 shape), so the renderer's open-time migration + the vestigial `TimelineLayout` fields can be
 * DELETED outright ("set a good standard, don't carry if/else for old versions" — author, 2026-07-17).
 *
 * Per project under <library>:
 *   1. `mirrorFrontmatterToTrees` — creates trees.json (default variant, adjacency from frontmatter) if absent.
 *      Uses the ENGINE's own mirror, so a file born here is identical to one the app would create.
 *   2. Seeds EVERY variant that has no canvas with the old project-wide nodes/collapsed. Pre-T11 all variants
 *      SHARED that one canvas, so every one of them inherits it (the shipped in-app migration only seeded the
 *      ACTIVE variant — which would have silently blanked e.g. Genshin's "Timeline 3").
 *   3. Folds legacy `chartSequences`/`activeChartSequenceId` onto the ACTIVE variant (T10's semantics).
 *   4. Rewrites timeline.json down to its post-T11 job: `{ version, view }` (project-wide layers/view only).
 *
 * Idempotent — a migrated project re-runs to "already conforms". Reports a per-project diff; `--dry` writes nothing.
 *   npm run migrate:canvas -- "/home/david/Documents/Novel Visual Studio" [--dry]
 */
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listStoryTree } from '../src/engine/content/storyTree'
import { mirrorFrontmatterToTrees, adjacencyFromTree, readTrees, writeTrees } from '../src/engine/content/trees'
import { DEFAULT_TIMELINE_VIEW } from '../src/shared/ipc'
import type { ChartSequence, TimelineNode } from '../src/shared/ipc'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const library = args.find((a) => !a.startsWith('--'))
if (!library || !existsSync(library)) {
  console.error(`usage: migrate:canvas -- "<library dir>" [--dry]\n  (not found: ${library ?? '<missing>'})`)
  process.exit(1)
}

type Legacy = { version?: number; view?: unknown; nodes?: unknown; collapsed?: unknown; chartSequences?: unknown; activeChartSequenceId?: unknown }

let changed = 0
let clean = 0

for (const name of readdirSync(library).sort()) {
  const root = join(library, name)
  if (!existsSync(join(root, '.nvs'))) continue

  // 1. Ensure trees.json exists, born the way the app would make it (adjacency mirrored from frontmatter).
  //    NOTE: mirrorFrontmatterToTrees WRITES — so it must stay behind the --dry guard (a dry run that creates
  //    files isn't a dry run). Under --dry we model the same shape in memory purely to report on it.
  const created = !existsSync(join(root, '.nvs', 'trees.json'))
  if (created && !DRY) mirrorFrontmatterToTrees(root, listStoryTree(root))

  // 2. Read the legacy project-wide canvas.
  const tlPath = join(root, '.nvs', 'timeline.json')
  const tl: Legacy = existsSync(tlPath) ? (JSON.parse(readFileSync(tlPath, 'utf8')) as Legacy) : {}
  const legacyNodes: TimelineNode[] = Array.isArray(tl.nodes) ? (tl.nodes as TimelineNode[]) : []
  const legacyCollapsed: string[] = Array.isArray(tl.collapsed) ? (tl.collapsed as unknown[]).map(String) : []
  const legacySeqs: ChartSequence[] = Array.isArray(tl.chartSequences) ? (tl.chartSequences as ChartSequence[]) : []
  const legacyActiveSeq = typeof tl.activeChartSequenceId === 'string' ? tl.activeChartSequenceId : undefined

  // 3. Fold onto the variants.
  const trees =
    created && DRY
      ? { version: 1, activeId: 'default', variants: [{ id: 'default', name: 'Timeline 1', adjacency: adjacencyFromTree(listStoryTree(root)) }] }
      : readTrees(root)
  const activeId = trees.activeId ?? trees.variants[0]?.id
  const notes: string[] = []
  if (created) notes.push('trees.json CREATED (mirrored from frontmatter)')

  const variants = trees.variants.map((v) => {
    const out = { ...v }
    if (out.nodes === undefined) {
      out.nodes = legacyNodes.map((n) => ({ ...n })) // every variant shared the old canvas → all inherit it
      out.collapsed = [...legacyCollapsed]
      notes.push(`“${v.name}” canvas seeded (${out.nodes.length} node${out.nodes.length === 1 ? '' : 's'}, ${out.collapsed.length} collapsed)`)
    } else if (out.collapsed === undefined) {
      out.collapsed = []
    }
    if (v.id === activeId && !out.sequences?.length && legacySeqs.length) {
      out.sequences = legacySeqs.map((s) => ({ id: s.id, name: s.name, path: s.path }))
      if (legacyActiveSeq) out.activeSequenceId = legacyActiveSeq
      notes.push(`“${v.name}” took ${out.sequences.length} legacy chart axis/axes`)
    }
    return out
  })

  // 4. timeline.json keeps ONLY its post-T11 job: project-wide layers/view.
  const slimmed = { version: 2, view: tl.view ?? DEFAULT_TIMELINE_VIEW }
  const hadLegacyKeys = ['nodes', 'collapsed', 'chartSequences', 'activeChartSequenceId'].filter((k) => k in tl)
  if (hadLegacyKeys.length) notes.push(`timeline.json stripped of ${hadLegacyKeys.join(', ')}`)

  if (!notes.length) {
    clean++
    console.log(`  ✓ ${name} — already conforms`)
    continue
  }
  changed++
  console.log(`${DRY ? '  ~' : '  →'} ${name}`)
  for (const n of notes) console.log(`      · ${n}`)
  if (DRY) continue
  writeTrees(root, { ...trees, activeId, variants })
  if (existsSync(tlPath)) writeFileSync(tlPath, JSON.stringify(slimmed, null, 2))
}

console.log(`\n${DRY ? 'DRY RUN — nothing written. ' : ''}${changed} migrated · ${clean} already conforming`)
