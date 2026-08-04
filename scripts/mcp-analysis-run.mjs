/**
 * hamlet-run.mjs — trial analysis run: Claude-in-terminal drives the NVS app's MCP as the producer.
 *
 * Reads the app's OWN prompt strings from src/shared/config/extraction.ts (no drift), pulls the corpus scene
 * by scene over MCP, calls Anthropic (Haiku) for the extraction, and persists via the MCP writeTier tool —
 * the same contract the GUI runner uses. Scene pass is SEQUENTIAL (each scene needs the threads opened by the
 * ones before it); window + coherence passes run with bounded parallelism.
 *
 * Usage: node hamlet-run.mjs [--scenes-only]   (key: ~/.config/anthropic.key or $ANTHROPIC_API_KEY)
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MCP = 'http://127.0.0.1:4319/mcp'
const REPO = '/home/david/Desktop/programming/nelapps/novel-visual-studio'
const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 4096
const WINDOW_PAR = 3 // parallel chapter windows
const scenesOnly = process.argv.includes('--scenes-only')

// ── key ────────────────────────────────────────────────────────────────────────
const keyFile = join(homedir(), '.config', 'anthropic.key')
const API_KEY = process.env.ANTHROPIC_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '')
if (!API_KEY) {
  console.error('no API key: set ANTHROPIC_API_KEY or write ~/.config/anthropic.key')
  process.exit(1)
}

// ── the app's own prompts (sliced from extraction.ts so producer & GUI can't drift) ──
function promptFrom(src, constName) {
  const marker = `${constName} = \``
  const at = src.indexOf(marker)
  if (at < 0) throw new Error(`prompt ${constName} not found`)
  let i = at + marker.length
  let out = ''
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && src[i + 1] === '`') { out += '`'; i += 2; continue }
    if (ch === '`') break
    out += ch
    i++
  }
  return out
}
const extractionSrc = readFileSync(join(REPO, 'src/shared/config/extraction.ts'), 'utf8')
const EXTRACTION = promptFrom(extractionSrc, 'EXTRACTION_INSTRUCTIONS')
const WINDOW = promptFrom(extractionSrc, 'WINDOW_INSTRUCTIONS')
const COHERENCE = promptFrom(extractionSrc, 'COHERENCE_INSTRUCTIONS')

// ── plumbing ───────────────────────────────────────────────────────────────────
let rpcId = 0
async function mcp(name, args = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } })
  })
  const data = await res.json()
  if (data.error) throw new Error(`mcp ${name}: ${JSON.stringify(data.error)}`)
  return JSON.parse(data.result.content[0].text)
}

async function haiku(system, user, attempt = 0) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, temperature: 0, system, messages: [{ role: 'user', content: user }] })
  })
  if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, [2000, 5000, 12000][attempt]))
    return haiku(system, user, attempt + 1)
  }
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
}

function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const s = body.indexOf('{'), e = body.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try { return JSON.parse(body.slice(s, e + 1)) } catch { return null }
}

const norm = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
async function parallel(items, limit, fn) {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx) }
  }))
  return out
}

// ── phase 0: corpus + grounding ────────────────────────────────────────────────
const project = await mcp('currentProject')
if (!project || !/Hamlet \(Demo\)/.test(project.root)) {
  console.error('open "Hamlet (Demo)" in the app first — currentProject:', project?.root ?? null)
  process.exit(1)
}
console.log(`▶ project: ${project.name}  (${project.counts.scenes} scenes)`)

const structure = JSON.parse(readFileSync(join(project.root, '.nvs', 'structure.json'), 'utf8'))
const thingCats = structure.world.filter((c) => c.tracked && c.key !== 'character' && c.key !== 'location')
const allowedThings = new Set(thingCats.map((c) => c.key))
console.log(`▶ thing categories: ${[...allowedThings].join(', ')}`)

const worldPages = await mcp('listWorldPages')
const charPages = worldPages.filter((p) => p.kind === 'character')
const knownCharacters = charPages.map((p) => p.name)
const pageByNorm = new Map(charPages.map((p) => [norm(p.name), p]))

const tree = await mcp('listStoryTree')
const scenes = [] // { sceneId, path, title, chapterUid, chapterName } in reading order
;(function walk(nodes, chapterUid, chapterName) {
  for (const n of nodes) {
    if (n.type === 'folder') walk(n.children ?? [], n.folderId ? `c:${n.folderId}` : chapterUid, n.name)
    else if (n.sceneId) scenes.push({ sceneId: n.sceneId, path: n.path, title: n.title ?? n.name, chapterUid, chapterName })
  }
})(tree, null, null)
console.log(`▶ ${scenes.length} scenes across ${new Set(scenes.map((s) => s.chapterUid)).size} chapters\n`)

// ── phase 1: scene pass (sequential — thread continuity) ──────────────────────
const openThreads = new Map() // id → description
const sceneResults = [] // for the window pass
let totalThings = 0, totalEntities = 0

for (const [i, sc] of scenes.entries()) {
  const doc = await mcp('readScene', { path: sc.path })
  const user = [
    `scene_id: ${sc.sceneId}`,
    knownCharacters.length ? `known characters: ${knownCharacters.join(', ')}` : 'known characters: (none yet)',
    thingCats.length ? `TRACKABLE CATEGORIES for \`things\` (use these keys verbatim; in this project each means):\n${thingCats.map((c) => `- ${c.key}: ${c.description}`).join('\n')}` : '',
    openThreads.size ? `threads still open:\n- ${[...openThreads].map(([id, d]) => `${id} — ${d}`).join('\n- ')}` : 'threads still open: (none)',
    '',
    'dialogue (raw scene text; speaker lines are `Name: text`, stage directions/narration are plain lines):',
    doc.body || '(no dialogue)'
  ].filter(Boolean).join('\n')

  const x = parseJson(await haiku(EXTRACTION, user))
  if (!x) { console.log(`  ✗ ${sc.sceneId}: unparseable JSON — skipped`); continue }

  const threads = []
  for (const t of x.threads ?? []) {
    if (t.action === 'open' && t.ref) {
      const id = `thr:${sc.sceneId}:${t.ref}`
      threads.push({ threadId: id, subject: null, action: 'open', sortPos: null, evidence: null, confidence: null, description: t.description ?? null, umbrella: { description: t.description || t.ref, title: t.title ?? null, threadType: t.thread_type ?? null, builtBy: 'inferred' } })
      openThreads.set(id, t.description || t.ref)
    } else if ((t.action === 'advance' || t.action === 'close') && t.thread_id && openThreads.has(t.thread_id)) {
      threads.push({ threadId: t.thread_id, subject: null, action: t.action === 'close' ? 'resolve' : 'advance', sortPos: null, evidence: null, confidence: null, description: t.description ?? null })
      if (t.action === 'close') openThreads.delete(t.thread_id)
    }
  }
  const things = (x.things ?? [])
    .filter((t) => t && typeof t.name === 'string' && t.name.trim() && allowedThings.has(t.category))
    .map((t) => ({ name: t.name.trim(), category: t.category, significance: t.significance ?? null, evidence: t.evidence ?? null }))

  const rows = {
    extracted: {
      summary: x.summary ?? null, pov: null,
      characters: x.characters ?? [], locations: x.locations ?? [], plotTimes: x.plot_times ?? [],
      goals: x.goals ?? [], conflicts: x.conflicts ?? [], enters: x.enters ?? [], exits: x.exits ?? [],
      sceneContexts: x.scene_contexts ?? [], things
    },
    threads,
    lore: (x.lore_bombs ?? []).map((l) => ({ loreId: l.lore_ref, summary: l.summary, magnitude: l.magnitude ?? null, builtBy: 'inferred' }))
  }
  const res = await mcp('writeTier', { tier: 't2', kind: 'scene', targetId: sc.sceneId, asOfUnitId: null, rows })
  if (!res.ok) { console.log(`  ✗ ${sc.sceneId}: writeTier — ${res.error}`); continue }
  totalThings += things.length
  totalEntities += res.written.entities ?? 0
  sceneResults.push({ ...sc, x })
  console.log(`  ✓ [${i + 1}/${scenes.length}] ${sc.sceneId}  threads:${threads.length} things:[${things.map((t) => `${t.name}(${t.category})`).join(', ') || '—'}]${res.written.entities ? `  +${res.written.entities} new entities` : ''}`)
}
console.log(`\n▶ scene pass done: ${sceneResults.length}/${scenes.length} ok · ${totalThings} thing mentions · ${totalEntities} new entities\n`)
if (scenesOnly) process.exit(0)

// ── phase 2: window pass (parallel per chapter) ────────────────────────────────
const chapters = [...new Set(sceneResults.map((s) => s.chapterUid).filter(Boolean))]
await parallel(chapters, WINDOW_PAR, async (uid) => {
  const evidence = sceneResults.filter((s) => s.chapterUid === uid)
  const present = new Map()
  for (const s of evidence) for (const nm of s.x.characters ?? []) {
    const pg = pageByNorm.get(norm(nm))
    if (pg) present.set(pg.id, pg.name)
  }
  if (!present.size) return console.log(`  – ${uid}: no resolvable cast`)
  const scenesBlock = evidence.map((s) => [
    `scene_id: ${s.sceneId} — ${s.title}`,
    `  summary: ${s.x.summary ?? '(none)'}`,
    s.x.goals?.length ? `  goals: ${JSON.stringify(s.x.goals)}` : '',
    s.x.conflicts?.length ? `  conflicts: ${JSON.stringify(s.x.conflicts)}` : '',
    s.x.enters?.length ? `  enters: ${JSON.stringify(s.x.enters)}` : '',
    s.x.exits?.length ? `  exits: ${JSON.stringify(s.x.exits)}` : ''
  ].filter(Boolean).join('\n')).join('\n\n')
  const user = [`chapter: ${uid}`, `characters present (use these names verbatim): ${[...present.values()].join(', ')}`, '', 'scene evidence:', scenesBlock].join('\n')
  const x = parseJson(await haiku(WINDOW, user))
  if (!x) return console.log(`  ✗ ${uid}: unparseable window JSON`)
  const idByNorm = new Map([...present].map(([id, name]) => [norm(name), id]))
  const validScenes = new Set(evidence.map((s) => s.sceneId))
  let wrote = 0
  for (const w of x.windows ?? []) {
    const eid = idByNorm.get(norm(w.character ?? ''))
    if (!eid) continue
    const arcEvents = (w.events ?? [])
      .filter((e) => e && validScenes.has(e.scene_id) && ['gain', 'loss', 'expose'].includes(e.change) && e.category && e.value)
      .map((e) => ({ category: e.category, change: e.change, value: e.value, description: e.description ?? '', sceneId: e.scene_id }))
    const res = await mcp('writeTier', { tier: 't2', kind: 'window', targetId: eid, asOfUnitId: uid, rows: { window: { summary: w.summary ?? null }, arcEvents } })
    if (res.ok) wrote++
    else console.log(`  ✗ window ${eid}@${uid}: ${res.error}`)
  }
  console.log(`  ✓ ${uid}: ${wrote} windows`)
})
console.log('\n▶ window pass done\n')

// ── phase 3: coherence (batched over the windowed cast) ───────────────────────
const checkpoint = sceneResults[sceneResults.length - 1].chapterUid
const windowed = new Map() // entityId → { name, blocks: [] }
for (const uid of chapters) {
  const evidence = sceneResults.filter((s) => s.chapterUid === uid)
  for (const s of evidence) for (const nm of s.x.characters ?? []) {
    const pg = pageByNorm.get(norm(nm))
    if (pg && !windowed.has(pg.id)) windowed.set(pg.id, { name: pg.name, page: pg })
  }
}
const arcs = await mcp('listCharacterArcs')
const arcByEntity = new Map(arcs.map((a) => [a.entityId, a]))
const inputs = []
for (const [eid, info] of windowed) {
  const arc = arcByEntity.get(eid)
  if (!arc?.windows?.length) continue
  const declaredDoc = await mcp('readScene', { path: info.page.path }).catch(() => null)
  const declared = declaredDoc ? `${JSON.stringify(declaredDoc.frontmatter ?? {}, null, 1)}\n${declaredDoc.body ?? ''}`.slice(0, 4000) : '(no page)'
  const observed = arc.windows.map((w) => `[${w.chapterId}] ${w.summary ?? ''}\n${(w.events ?? []).map((e) => `  ${e.category} ${e.change}: ${e.value}`).join('\n')}`).join('\n')
  inputs.push({ entityId: eid, name: info.name, declared, observed })
}
console.log(`▶ coherence over ${inputs.length} characters (checkpoint ${checkpoint})`)
for (let i = 0; i < inputs.length; i += 8) {
  const batch = inputs.slice(i, i + 8)
  const user = batch.map((c) => [`entity_id: ${c.entityId}  (${c.name})`, 'declared:', c.declared, 'observed:', c.observed || '(no arc recorded yet)'].join('\n')).join('\n\n────────\n\n')
  const x = parseJson(await haiku(COHERENCE, user))
  if (!x) { console.log('  ✗ coherence batch: unparseable'); continue }
  const byEntity = new Map(batch.map((c) => [c.entityId, []]))
  for (const f of x.findings ?? []) {
    const bucket = byEntity.get(f.entity_id)
    if (!bucket || !['drift', 'gap', 'contradiction'].includes(f.kind) || !['low', 'medium', 'high'].includes(f.severity)) continue
    bucket.push({ trait: f.trait ?? '', declared: f.declared ?? '(unstated)', observed: f.observed ?? '', kind: f.kind, severity: f.severity, suggestion: f.suggestion ?? '', evidence: Array.isArray(f.evidence_unit_ids) ? f.evidence_unit_ids.filter((s) => typeof s === 'string' && s) : [], why: null })
  }
  for (const [eid, findings] of byEntity) {
    const res = await mcp('writeTier', { tier: 't3', kind: 'coherence', targetId: eid, asOfUnitId: checkpoint, rows: { findings } })
    console.log(res.ok ? `  ✓ coherence ${eid}: ${findings.length} findings` : `  ✗ coherence ${eid}: ${res.error}`)
  }
}
console.log('\n▶ DONE')
