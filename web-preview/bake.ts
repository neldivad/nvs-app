/**
 * Tier-A spike — bake a project's analysis to a static JSON snapshot the browser preview reads instead of the
 * live `window.nvs` bridge. Runs in Node/Electron (where better-sqlite3 works); the browser then never touches the
 * engine. Keys under `reads` MATCH the window.nvs method names, so the browser shim is a one-line lookup.
 *
 * Run: npx tsx --tsconfig tsconfig.node.json web-preview/bake.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import * as engine from '@engine/index'

// Bake from a COPY (arg 1) so openWork's migration/backfill never mutates the author's live demo project.
const ROOT = process.argv[2] || '/home/david/Documents/Novel Visual Studio/Romance of the Three Kingdoms'
const OUT = join(process.cwd(), 'web-preview/public/snapshot.json')

const meta = engine.openWork(ROOT)
if (!meta) throw new Error(`not a valid work: ${ROOT}`)

const safe = <T>(label: string, fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch (e) {
    console.error(`  ! ${label}: ${e instanceof Error ? e.message : e}`)
    return fallback
  }
}

const scenes = safe('listScenes', () => engine.listScenes(), [])
const worldPages = safe('listWorldPages', () => engine.listWorldPages(), [])

// Per-path bodies for readScene(path) — scenes + world pages (readScene resolves any .md path).
const docs: Record<string, unknown> = {}
for (const s of scenes) docs[s.path] = safe(`readScene ${s.sceneId}`, () => engine.readScene(s.path), null)
for (const p of worldPages) docs[p.path] = safe(`readScene ${p.id}`, () => engine.readScene(p.path), null)

const reads = {
  listScenes: scenes,
  listStoryTree: safe('listStoryTree', () => engine.listStoryTree(), []),
  timelineGraph: safe('timelineGraph', () => engine.timelineGraph(), { scenes: {}, edges: [] }),
  listThreads: safe('listThreads', () => engine.listThreads(), []),
  listCoherenceFindings: safe('listCoherenceFindings', () => engine.listCoherenceFindings(), []),
  listCharacterArcs: safe('listCharacterArcs', () => engine.listCharacterArcs(), []),
  listEntityTracks: safe('listEntityTracks', () => engine.listEntityTracks(), []),
  listEntityArcs: safe('listEntityArcs', () => engine.listEntityArcs(), []),
  listLoreView: safe('listLoreView', () => engine.listLoreView(), { topics: [], clock: [] }),
  listWorldPages: worldPages,
  listCustodyTopics: safe('listCustodyTopics', () => engine.listCustodyTopics(), []),
  listCustodyEvents: safe('listCustodyEvents', () => engine.listCustodyEvents(), []),
  listSecretEvents: safe('listSecretEvents', () => engine.listSecretEvents(), []),
  readProjectInfo: safe('readProjectInfo', () => engine.readProjectInfo(), null),
  readStructure: safe('readStructure', () => engine.readStructure(), null),
  readTimeline: safe('readTimeline', () => engine.readTimeline(), null),
  trees: safe('trees', () => engine.trees(), null),
  readUiState: safe('readUiState', () => engine.readUiState(), null),
  listChatSessions: safe('listChatSessions', () => engine.listChatSessions(), { sessions: [], activeId: null })
}

const snapshot = { meta, reads, docs }
const json = JSON.stringify(snapshot)
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, json)

console.log(`\nbaked "${meta.name}" → ${OUT}  (${(json.length / 1e6).toFixed(1)} MB)`)
for (const [k, v] of Object.entries(reads)) console.log(`  ${k.padEnd(22)} ${Array.isArray(v) ? `${v.length} items` : v && typeof v === 'object' ? 'object' : String(v)}`)
console.log(`  ${'docs (bodies)'.padEnd(22)} ${Object.keys(docs).length} paths`)
