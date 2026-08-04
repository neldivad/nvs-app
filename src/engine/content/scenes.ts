/**
 * Scene file access for the editor (main process).
 *
 * Reads/lists/writes the `.md` files under a work's content/story. The editor is
 * the only writer of the author's prose; all writes are guarded to stay inside
 * the open work's folder (see engine/index validation).
 */
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep, basename } from 'node:path'
import matter from 'gray-matter'
import type { ContentMatch, SceneDoc, SceneFile } from '@shared/ipc'
import { uniqueId, existingSceneIds } from '@engine/content/storyTree'
import { memoSlot, fingerprintDir } from '@engine/enumCache'

function walkMarkdown(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walkMarkdown(p, out)
    else if (entry.endsWith('.md') && !/^readme\.md$/i.test(entry)) out.push(p)
  }
}

/** Every scene `.md` under content/story, with its frontmatter title/id/chapter. */
const scenesMemo = memoSlot<SceneFile[]>('scenes')
export function listScenes(root: string): SceneFile[] {
  const storyDir = join(root, 'content', 'story')
  // Memoized by the story dir's fingerprint — a hit skips reading + YAML-parsing every scene's frontmatter (the
  // expensive part); the walk + stat (cheap) still runs to detect any change. See enumCache.ts.
  return scenesMemo(fingerprintDir(storyDir), () => buildSceneList(storyDir))
}
function buildSceneList(storyDir: string): SceneFile[] {
  const files: string[] = []
  walkMarkdown(storyDir, files)
  const scenes = files.map((path) => {
    let data: Record<string, unknown> = {}
    try {
      data = matter(readFileSync(path, 'utf8')).data as Record<string, unknown>
    } catch {
      /* unparseable frontmatter → fall back to filename */
    }
    const rel = relative(storyDir, path)
    return {
      path,
      relPath: rel,
      sceneId: String(data.scene_id ?? basename(path, '.md')),
      title: String(data.title ?? basename(path, '.md')),
      // chapter = frontmatter, else the top folder under story/chapters
      chapter: String(data.chapter ?? rel.split(sep).find((s) => s !== 'chapters') ?? ''),
      ...(data.phase ? { phase: String(data.phase) } : {})
    }
  })
  return scenes.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/**
 * Normalize a body to PROSE ONLY for search, so content hits read like sentences and a common name doesn't
 * dupe/flood from markup + machine data (the author flagged links as a dupe source; the deeper driver is
 * structured refs). In order:
 *   1. `[display](target)` → display — a link matched TWICE (display "Hamlet" + slug "hamlet") and leaked raw
 *      `[...](...)` into snippets; keep the display (a page saying "[Hamlet](hamlet)'s friend" IS about Hamlet).
 *   2. `**b**` / `*i*` / `` `c` `` → text — clean emphasis out of snippets.
 *   3. bare `[Token]` → gone — custody `## Timeline` entity refs (`who: [Hamlet]`), never prose.
 *   4. scene-id slugs (`hamlet-a4-s4`, `sanguo-ch001` — lowercase, hyphenated, containing a digit) → gone — the
 *      `- scene:` refs that made "hamlet" match inside an id. Author-kept: descriptions AND `note: "…"` prose.
 * Every replacement is intra-line (no newlines), so line count — hence reported line numbers — is preserved.
 */
function cleanProse(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[[^[\]]+\]/g, ' ') // bare custody entity refs
    .replace(/\b[a-z][a-z0-9]*(?:-[a-z0-9]*\d[a-z0-9]*)+\b/g, ' ') // id slugs (contain a digit); prose "well-being" is untouched
}

/** A ~140-char display window around the first match, so a hit reads in one line without the whole paragraph. */
function snippetAround(line: string, at: number, qlen: number): string {
  const trimmed = line.trim()
  if (trimmed.length <= 140) return trimmed
  const start = Math.max(0, at - 50)
  return (start > 0 ? '…' : '') + line.slice(start, at + qlen + 70).trim() + '…'
}

/**
 * FULL-TEXT content search — the "search by content" the title-only command palette can't do. Greps the PROSE
 * body (not frontmatter) of every `.md` under content/ for a case-insensitive substring, returning the first
 * hit per file with a snippet + total count. Grep-on-demand (no FTS index to maintain): fine at hundreds of
 * scenes; `limit` caps the result set so a common word can't flood the palette. `kind` is the openPage kind so
 * a click opens the page — derived from the content pillar (story→scene, custody→custody, world/<cat>→<cat>).
 */
export function searchContent(root: string, query: string, limit = 40): ContentMatch[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return [] // 1-char queries match everything — not useful, and expensive
  const contentDir = join(root, 'content')
  const files: string[] = []
  walkMarkdown(contentDir, files)
  const out: ContentMatch[] = []
  for (const path of files) {
    if (out.length >= limit) break
    let raw = ''
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const parsed = matter(raw)
    const body = cleanProse(parsed.content) // strip link/emphasis markup so links don't double-count or leak into snippets
    if (!body.toLowerCase().includes(q)) continue // frontmatter (titles) is the palette's job — content only here
    const lines = body.split(/\r?\n/)
    let count = 0
    let line = -1
    let snippet = ''
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].toLowerCase().indexOf(q)
      if (idx < 0) continue
      count++
      if (line < 0) {
        line = i + 1
        snippet = snippetAround(lines[i], idx, q.length)
      }
    }
    const rel = relative(contentDir, path)
    const segs = rel.split(sep)
    // Coarse PILLAR only (story→scene, custody→custody, else world) — the renderer resolves a world hit to its
    // precise kind (character/location/…) from its worldPages store, since the folder is plural ("characters").
    const kind = segs[0] === 'story' ? 'scene' : segs[0] === 'custody' ? 'custody' : 'world'
    const data = parsed.data as Record<string, unknown>
    out.push({ path, relPath: rel, title: String(data.title ?? data.name ?? basename(path, '.md')), kind, count, line, snippet })
  }
  return out
}

/** Read a scene split into frontmatter (form data) + body (prose) + raw (source view). */
export function readScene(path: string): SceneDoc {
  const raw = readFileSync(path, 'utf8')
  const parsed = matter(raw)
  return { frontmatter: parsed.data as Record<string, unknown>, body: parsed.content, raw }
}

/** Recombine frontmatter + body into the file's markdown (gray-matter owns the YAML). */
export function stringifyScene(frontmatter: Record<string, unknown>, body: string): string {
  // gray-matter prepends a newline to content; trim one so the body starts clean.
  // Pass an OBJECT ({ content }) — NOT the raw string. `matter.stringify(str, …)` re-parses `str` for existing
  // frontmatter first (`matter(str)`), so a body that begins with a `---` line (a Fountain/markdown section
  // break) is misread as a YAML front-fence and everything after it is parsed as YAML → it throws on the first
  // prose line with a colon. The object form skips that re-parse entirely; the body is written as-is.
  return matter.stringify({ content: body.replace(/^\n+/, '') } as unknown as string, frontmatter)
}

export function writeScene(path: string, frontmatter: Record<string, unknown>, body: string): void {
  writeFileSync(path, stringifyScene(frontmatter, body), 'utf8')
}

/**
 * Write the file's markdown VERBATIM — no frontmatter/body round-trip through gray-matter. Backs the opt-in
 * "edit source directly" mode: what the author types in the Source view is exactly what lands on disk (YAML key
 * order, quoting, blank lines all preserved). The buffer is re-read via readScene afterwards, so the split
 * frontmatter/body model re-syncs from the bytes the author committed.
 */
export function writeSceneRaw(path: string, text: string): void {
  writeFileSync(path, text, 'utf8')
}

/**
 * Create a scene `.md` under content/story/chapters/{chapterSlug}/{id}.md from
 * renderer-supplied frontmatter + body. Returns the new SceneFile, or null if a file
 * with that id already exists in the chapter. Folder = organization; the `chapter`
 * frontmatter is the grouping the navigator/engine read.
 */
export function createScene(
  root: string,
  chapterSlug: string,
  id: string,
  frontmatter: Record<string, unknown>,
  body: string
): SceneFile | null {
  const storyDir = join(root, 'content', 'story')
  const dir = join(storyDir, 'chapters', chapterSlug)
  const uid = uniqueId(id, existingSceneIds(root)) // scene_id is a global identity → unique work-wide
  const path = join(dir, `${uid}.md`)
  if (existsSync(path)) return null
  mkdirSync(dir, { recursive: true })
  // New scenes start as `draft` (outside the analysis gate until marked canon); explicit phase wins.
  const fm: Record<string, unknown> = { phase: 'draft', ...frontmatter, scene_id: uid }
  writeFileSync(path, stringifyScene(fm, body), 'utf8')
  return {
    path,
    relPath: relative(storyDir, path),
    sceneId: uid,
    title: String(fm.title ?? uid),
    chapter: String(fm.chapter ?? chapterSlug)
  }
}
