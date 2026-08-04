/**
 * Custody topic pages — STRUCTURE-CANONICAL (internal/secret-lifecycle.md, Stage 2 4th pass).
 *
 * A topic lives at content/custody/<id>.md: prose sections (Overview · Truth · Notes) + ONE fenced
 * ```custody block of YAML checkpoint records — the chart's single source, validated AT ENTRY:
 *
 *     ```custody
 *     - scene: ham-a1-s5
 *       event: gain
 *       who: [hamlet, audience]
 *       note: The Ghost tells Hamlet everything.
 *     - scene: start
 *       event: gain
 *       who: [claudius]
 *     ```
 *
 * GRAMMAR v2 — three verbs (gain · lost · public); the topic kind gives them meaning (item: possession,
 * information: knowledge). EVENTS ONLY, state derived (silence = still-secret; on an item a character's
 * gain implies the prior holder's loss — one record per handoff). `scene: start` = true before page one.
 * LEGACY accepted + normalized on read, never written: v1 verbs alias (held-by/known-by → gain,
 * forgotten-by → lost); `since` folds into `scene`; the old `## Timeline` line syntax still parses.
 * Extraction never writes these files.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import matter from 'gray-matter'
import { listScenes } from '@engine/content/scenes'
import { listWorldPages } from '@engine/content/world'
import type { CustodyEventKind, CustodyRecord, CustodyTopic } from '@shared/ipc'

const EVENTS = new Set<CustodyEventKind>(['gain', 'lost', 'public'])
const LEGACY_VERBS: Record<string, CustodyEventKind> = { 'held-by': 'gain', 'known-by': 'gain', 'forgotten-by': 'lost' }
const FENCE_RE = /^```custody\s*\n([\s\S]*?)^```\s*$/m

export function custodyDir(workRoot: string): string {
  return join(workRoot, 'content', 'custody')
}

/** Forward-migrate Stage-1 pages (content/world/custody/) into the pillar. Idempotent; call on openWork. */
export function migrateCustodyPillar(workRoot: string): void {
  const legacy = join(workRoot, 'content', 'world', 'custody')
  if (!existsSync(legacy)) return
  try {
    const dest = custodyDir(workRoot)
    mkdirSync(dest, { recursive: true })
    for (const f of readdirSync(legacy)) {
      if (!f.endsWith('.md')) continue
      const to = join(dest, f)
      if (!existsSync(to)) renameSync(join(legacy, f), to)
    }
    if (readdirSync(legacy).length === 0) rmdirSync(legacy)
  } catch {
    /* partially-migrated is fine — both locations are read */
  }
}

/** Parse the fenced block's YAML into records + structural errors (enum/shape — no project context).
 *  Legacy v1 is NORMALIZED here: verb aliases, and `since` folds into `scene` (the character truly
 *  gained it at the since-scene; the reader's reveal is its own gain [audience] record in v2).
 *  `legacyItem` reports whether v1 possession verbs appeared — for topic-kind inference only. */
export function parseCustodyRecords(body: string): { records: CustodyRecord[]; errors: string[]; legacyItem?: boolean } {
  const records: CustodyRecord[] = []
  const errors: string[] = []
  let legacyItem = false
  const fence = FENCE_RE.exec(body)
  if (!fence) return { records, errors }
  let raw: unknown
  try {
    // gray-matter bundles js-yaml; reuse it rather than adding a dependency
    raw = (matter as unknown as { engines: { yaml: { parse: (s: string) => unknown } } }).engines.yaml.parse(fence[1])
  } catch (e) {
    return { records, errors: [`custody block is not valid YAML: ${String(e instanceof Error ? e.message : e).split('\n')[0]}`] }
  }
  if (raw == null) return { records, errors } // an empty (or comments-only) block is a valid empty ledger
  if (!Array.isArray(raw)) return { records, errors: ['custody block must be a YAML list of records'] }
  raw.forEach((r, i) => {
    const at = `record ${i + 1}`
    if (r == null || typeof r !== 'object') return void errors.push(`${at}: not a record`)
    const rec = r as Record<string, unknown>
    let scene = typeof rec.scene === 'string' ? rec.scene.trim() : ''
    const verb = typeof rec.event === 'string' ? rec.event.trim().toLowerCase() : ''
    if (verb === 'held-by') legacyItem = true
    const event = (LEGACY_VERBS[verb] ?? verb) as CustodyEventKind
    if (!scene) return void errors.push(`${at}: missing scene`)
    if (!EVENTS.has(event)) return void errors.push(`${at}: unknown event "${rec.event}" (gain · lost · public)`)
    const whoRaw = rec.who
    // Normalize, never reject: models (and authors) habitually write prose-style [Name](id) wiki-links
    // in who — collapse them to the link TARGET (the world-page id). Plain ids serialize back out.
    const who = (Array.isArray(whoRaw) ? whoRaw : whoRaw != null ? [whoRaw] : [])
      .map((w) => String(w).trim())
      .map((w) => /^\[([^\]]+)\]\(([^)]+)\)$/.exec(w)?.[2] ?? w)
      .filter(Boolean)
    // legacy `since`: the in-world moment wins — the record moves to the since-scene
    const since = typeof rec.since === 'string' ? rec.since.trim() : null
    if (since && verb === 'known-by') scene = since
    if (event === 'gain' && who.length === 0) errors.push(`${at}: gain needs who`)
    records.push({ scene, event, who, note: typeof rec.note === 'string' ? rec.note : null })
  })
  return { records, errors, legacyItem }
}

/** Parse + CANONICAL rewrite: when the block parses clean, the fence is re-serialized from the parsed
 *  records — so what gets WRITTEN stores normalized form (plain ids, quoted notes, no legacy verbs) and
 *  the read-side forgiveness is a safety net, not a load-bearing wall. Errors → canonical = input. */
export function parseCustodyMarkdown(markdown: string): { records: CustodyRecord[]; errors: string[]; legacyItem?: boolean; canonical: string } {
  const parsed = parseCustodyRecords(markdown)
  const canonical =
    parsed.errors.length === 0 && FENCE_RE.test(markdown) ? markdown.replace(FENCE_RE, serializeCustodyBlock(parsed.records)) : markdown
  return { ...parsed, canonical }
}

/** Legacy `## Timeline` line fallback (Stage 1's syntax) → records, so old pages render until edited. */
function legacyTimelineRecords(body: string): CustodyRecord[] {
  const section = /^##\s*Timeline\b[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(body)?.[1]
  if (!section) return []
  const out: CustodyRecord[] = []
  for (const line of section.split('\n')) {
    const item = /^\s*[-*•]\s+(.+)$/.exec(line)?.[1]?.trim()
    if (!item || item.startsWith('<!--')) continue
    const whoM = /\((held[- ]?by|known[- ]?by|holder|to)\s*:\s*([^)]*)\)\s*$/i.exec(item)
    const rest = (whoM ? item.slice(0, whoM.index) : item).trim()
    const ref = /^\[\[([^\]]+)\]\]\s*|^(\S+)\s+/.exec(rest)
    if (!ref) continue
    const scene = (ref[1] ?? ref[2] ?? '').trim()
    if (!scene || scene.endsWith(':')) continue // a broken YAML fence's bullets ("- scene: x") are not checkpoints
    const who = whoM ? whoM[2].split(/[,;]/).map((w) => w.trim()).filter(Boolean) : []
    const held = whoM ? /held|holder/i.test(whoM[1]) : false
    out.push({
      scene,
      event: 'gain',
      who: held ? who.slice(0, 1) : who.length ? who.map((w) => (w.toLowerCase() === 'reader' ? 'audience' : w)) : ['audience'],
      note: rest.slice(ref[0].length).trim() || null
    })
  }
  return out
}

function fm(data: Record<string, unknown>, key: string): string | null {
  const v = data[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Every topic in the pillar (+ un-migrated legacy location), parsed + referentially validated. */
export function listCustodyTopics(workRoot: string): CustodyTopic[] {
  const dirs = [custodyDir(workRoot), join(workRoot, 'content', 'world', 'custody')]
  const allScenes = listScenes(workRoot)
  const sceneIds = new Set(allScenes.map((s) => s.sceneId))
  const scenePos = new Map(allScenes.map((s, i) => [s.sceneId, i])) // story order — for sequence linting
  // who resolves against any world page (id or name) — or the specials
  const known = new Set<string>(['audience', 'public', 'start'])
  for (const p of listWorldPages(workRoot)) {
    known.add(p.id.toLowerCase())
    known.add(p.name.toLowerCase())
  }
  const out: CustodyTopic[] = []
  const seen = new Set<string>()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const path = join(dir, f)
      try {
        const { data, content } = matter(readFileSync(path, 'utf8'))
        const id = fm(data, 'id') ?? basename(f, '.md')
        if (seen.has(id)) continue
        seen.add(id)
        const parsed = parseCustodyRecords(content)
        const records = parsed.records.length ? parsed.records : legacyTimelineRecords(content)
        const errors = [...parsed.errors]
        const declared = (fm(data, 'topic') ?? '').toLowerCase()
        const topic: CustodyTopic['topic'] =
          declared === 'item' || declared === 'information' ? declared : parsed.legacyItem ? 'item' : 'information'
        records.forEach((r, i) => {
          if (r.scene !== 'start' && !sceneIds.has(r.scene)) errors.push(`record ${i + 1}: scene "${r.scene}" not found in the story`)
          for (const w of r.who) if (!known.has(w.toLowerCase())) errors.push(`record ${i + 1}: "${w}" doesn't match any world page`)
          // kind-aware rules: forgetting needs a forgetter. (An item's gain may name SEVERAL holders —
          // joint possession; the record's who always REPLACES the holder set, so no split-brain.)
          if (topic === 'information' && r.event === 'lost' && r.who.length === 0)
            errors.push(`record ${i + 1}: lost on information needs who (who forgets it)`)
          // the AUDIENCE only ever GAINS — the reader can't unlearn a reveal. (lost [public] IS legal:
          // global amnesia / global destruction — everyone in-world forgets, the reader remembers.)
          if (r.event === 'lost')
            for (const w of r.who)
              if (w.toLowerCase() === 'audience')
                errors.push(`record ${i + 1}: audience can only gain — the reader can't unlearn a reveal`)
        })
        // sequence lint: nobody loses what they never gained (in STORY order; scene: start is earliest)
        {
          const pos = (sc: string): number => (sc === 'start' ? -1 : (scenePos.get(sc) ?? Number.MAX_SAFE_INTEGER))
          const ordered = records.map((r, i) => ({ r, i })).sort((a, b) => pos(a.r.scene) - pos(b.r.scene))
          const gained = new Set<string>()
          for (const { r, i } of ordered) {
            if (r.event === 'gain') for (const w of r.who) gained.add(w.toLowerCase())
            if (r.event === 'lost')
              for (const w of r.who) {
                const key = w.toLowerCase()
                if (key === 'audience' || key === 'public') continue // covered above
                if (!gained.has(key))
                  errors.push(
                    `record ${i + 1}: ${w} loses it without ever gaining it — add a gain record (maybe scene: start), or the lost sits earlier in the story than the gain`
                  )
              }
          }
        }
        out.push({ pageId: id, name: fm(data, 'name') ?? id, path, topic, subject: fm(data, 'subject'), records, errors })
      } catch {
        /* unreadable page — skip (the scan rule) */
      }
    }
  }
  return out
}

/** Serialize records → the fenced block (the form's save path writes through this too, later). */
export function serializeCustodyBlock(records: CustodyRecord[]): string {
  const lines = records.map((r) => {
    const parts = [`- scene: ${r.scene}`, `  event: ${r.event}`]
    if (r.who.length) parts.push(`  who: [${r.who.join(', ')}]`)
    if (r.note) parts.push(`  note: ${JSON.stringify(r.note)}`)
    return parts.join('\n')
  })
  return '```custody\n' + lines.join('\n') + '\n```'
}

/** Create a topic page in the pillar. Returns the parsed topic, or null if the id is taken. */
export function createCustodyTopic(
  workRoot: string,
  meta: { id: string; name: string; topic: 'item' | 'information'; subject?: string | null },
  records: CustodyRecord[]
): CustodyTopic | null {
  const dir = custodyDir(workRoot)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${meta.id}.md`)
  if (existsSync(path)) return null
  const exampleFence = [
    '```custody',
    '# One record per checkpoint — the chart draws exactly these. Delete the examples as you add real ones.',
    '# - scene: <scene-id>     # a real scene id, or the word start (true before page one)',
    '#   event: gain           # gain · lost · public',
    `#   who: [${meta.topic === 'item' ? 'character-id' : 'character-id, audience'}]  # PLAIN ids — never [markdown](links); audience = the reader`,
    '#   note: "why — always double-quoted"',
    '```'
  ].join('\n')
  const body = [
    '---',
    `id: ${meta.id}`,
    `name: ${JSON.stringify(meta.name)}`,
    `topic: ${meta.topic}`,
    ...(meta.subject ? [`subject: ${meta.subject}`] : []),
    'phase: draft',
    '---',
    '',
    '## Overview',
    '',
    `<!-- ${meta.topic === 'item' ? 'The object being tracked.' : 'The information being tracked.'} -->`,
    '',
    '## Truth',
    '',
    '<!-- The full spoiler (author + analysis only). -->',
    '',
    '## Timeline',
    '',
    records.length ? serializeCustodyBlock(records) : exampleFence,
    '',
    '## Notes',
    ''
  ].join('\n')
  writeFileSync(path, body, 'utf8')
  return listCustodyTopics(workRoot).find((t) => t.pageId === meta.id) ?? null
}

/** Replace (or insert) the page's fenced block with these records — the form's save path. Everything
 *  else on the page (frontmatter, prose sections) is preserved byte-for-byte. */
export function updateCustodyRecords(workRoot: string, pageId: string, records: CustodyRecord[]): CustodyTopic | null {
  const topic = listCustodyTopics(workRoot).find((t) => t.pageId === pageId)
  if (!topic) return null
  const raw = readFileSync(topic.path, 'utf8')
  const block = serializeCustodyBlock(records)
  let next: string
  if (FENCE_RE.test(raw)) {
    next = raw.replace(FENCE_RE, block)
  } else if (/^##\s*Notes\b/m.test(raw)) {
    next = raw.replace(/^##\s*Notes\b/m, `${block}\n\n## Notes`)
  } else {
    next = raw.trimEnd() + '\n\n' + block + '\n'
  }
  writeFileSync(topic.path, next, 'utf8')
  return listCustodyTopics(workRoot).find((t) => t.pageId === pageId) ?? null
}
