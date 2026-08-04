/**
 * Free-form story tree (main process).
 *
 * Unlike world pages (schema-driven, fixed kinds), the story side is an arbitrary
 * nested folder tree under content/story/ — the author names + nests it however they
 * like (parts → volumes → chapters → scenes, or whatever the medium needs). Order is
 * NOT alphabetical: each folder carries a `.order` manifest (child names, one per line)
 * that the tree + timeline read; unlisted children append alphanumerically.
 *
 * All ops are guarded to stay inside content/story, with depth + name-length limits so
 * the tree (and the future timeline derived from it) stay sane.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { randomBytes } from 'node:crypto'
import matter from 'gray-matter'
import { slugId, uniqueId } from '@shared/contentId'
import { stampId } from '@engine/content/contentId'
import { memoSlot, fingerprintDir } from '@engine/enumCache'
import { safeFsRegex, sanitizeFsName } from '@shared/config/safeFs'
import type { StoryNode } from '@shared/ipc'

// uniqueId now lives in the shared id module; re-exported so existing `from '@engine/content/storyTree'` imports still hold.
export { uniqueId }

export const MAX_DEPTH = 6 // folder levels under content/story — the story ladder is 6 folders + a scene = 7
export const MAX_NAME = 100 // characters in a folder/scene name
const ARCHIVE = 'archive' // reserved, protected folder name
const ORDER_FILE = '.order'
const TYPE_FILE = '.type' // one line: the folder's container kind (act/part/chapter/…), from the project structure
const ID_FILE = '.id' // one line: the folder's STABLE identity — the scene_id of folders (survives rename/move)

function storyRoot(root: string): string {
  return join(root, 'content', 'story')
}

/** A path is in-bounds only if it resolves inside content/story (no traversal). Exported for unit tests. */
export function safeRel(rel: string): string | null {
  const norm = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (norm === '' || norm.split('/').some((s) => s === '..' || s === '.' || s === '')) return null
  return norm
}

/** Validate a single path segment (folder or scene name) the user typed. */
export function validName(name: string): boolean {
  const n = name.trim()
  return n.length > 0 && n.length <= MAX_NAME && !safeFsRegex.test(n) && n !== '..' && n !== '.'
}

// ── .order manifest ────────────────────────────────────────────────────────

function readOrder(dir: string): string[] {
  try {
    return readFileSync(join(dir, ORDER_FILE), 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function writeOrder(dir: string, names: string[]): void {
  if (names.length === 0) return
  writeFileSync(join(dir, ORDER_FILE), names.join('\n') + '\n', 'utf8')
}

/** Real child names of a folder (folders + scene files), excluding meta/dot/readme. */
function childNames(dir: string): string[] {
  return readdirSync(dir).filter(
    (e) => e !== ORDER_FILE && !/^readme\.md$/i.test(e) && !e.startsWith('.')
  )
}

function renameInOrder(dir: string, from: string, to: string): void {
  const order = readOrder(dir)
  const i = order.indexOf(from)
  if (i !== -1) {
    order[i] = to
    writeOrder(dir, order)
  }
}

function removeFromOrder(dir: string, name: string): void {
  const order = readOrder(dir)
  if (order.includes(name)) writeOrder(dir, order.filter((n) => n !== name))
}

/** Put a freshly-created child at the FRONT of its parent's manual order — where the inline "new folder/scene"
 *  input appears — so it doesn't fall to the bottom (unordered entries sort after ordered ones, see sortChildren).
 *  A no-op when the folder has NO manual `.order` (natural alphanumeric sort already places the name sensibly). */
function prependToOrder(dir: string, name: string): void {
  const order = readOrder(dir)
  if (order.length === 0) return // natural-sort folder — let the name fall into its alphanumeric place
  writeOrder(dir, [name, ...order.filter((n) => n !== name)])
}

/** A folder's container kind (act/chapter/…), or undefined for an untyped folder. */
function readFolderType(dir: string): string | undefined {
  try {
    const t = readFileSync(join(dir, TYPE_FILE), 'utf8').trim()
    return t || undefined
  } catch {
    return undefined
  }
}

/** Set (or clear) a folder's container kind. */
export function writeFolderType(dir: string, type: string | null): void {
  const p = join(dir, TYPE_FILE)
  if (type && type.trim()) writeFileSync(p, `${type.trim()}\n`, 'utf8')
  else if (existsSync(p)) rmSync(p, { force: true })
}

// ── folder identity (.id) ───────────────────────────────────────────────────
// Folders get the same treatment as scenes (the scene_id GUARANTEE, D2): a stable id stamped once, so analysis
// (chapter units, character windows, coherence checkpoints) and the timeline survive rename/move. The dotfile
// travels with the folder; ingest keys chapter units as `c:<folderId>` instead of the path.

const idSlug = (name: string): string => slugId(name) || 'folder'

function readFolderId(dir: string): string | undefined {
  try {
    const t = readFileSync(join(dir, ID_FILE), 'utf8').trim()
    return t || undefined
  } catch {
    return undefined
  }
}

/**
 * The folder's stable id — read it, or stamp a fresh one (slug + random hex). `seen` de-dupes ids within one
 * tree walk: a folder duplicated in the file manager carries a cloned `.id`, and the second occurrence must be
 * re-stamped or two folders would share an identity. Write is best-effort (read-only fs → undefined; ingest
 * falls back to the path key for that folder until it's writable — mirrors the scene-stamp behaviour).
 */
function ensureFolderId(dir: string, name: string, seen: Set<string>): string | undefined {
  let id = readFolderId(dir)
  if (!id || seen.has(id)) {
    id = `${idSlug(name)}-${randomBytes(3).toString('hex')}`
    if (stampId('folder', dir, id) == null) return undefined // read-only fs → ingest path-key fallback for this folder
  }
  seen.add(id)
  return id
}

/** Set/clear a folder's container label by its rel path (an OPTIONAL soft badge — no constraint). */
export function setFolderType(root: string, folderRel: string, type: string | null): boolean {
  const r = folderRel === '' ? '' : safeRel(folderRel)
  if (r == null) return false
  const abs = join(storyRoot(root), r)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return false
  writeFolderType(abs, type)
  return true
}

// ── tree ────────────────────────────────────────────────────────────────────

/** Sort entries by the folder's `.order`, then alphanumeric for the rest; archive last. */
function sortChildren(names: string[], order: string[]): string[] {
  const rank = new Map(order.map((n, i) => [n, i]))
  return [...names].sort((a, b) => {
    if (a === ARCHIVE) return 1
    if (b === ARCHIVE) return -1
    const ra = rank.get(a)
    const rb = rank.get(b)
    if (ra != null && rb != null) return ra - rb
    if (ra != null) return -1
    if (rb != null) return 1
    return a.localeCompare(b, undefined, { numeric: true })
  })
}

function buildNode(absDir: string, base: string, rel: string, seenIds: Set<string>): StoryNode[] {
  const order = readOrder(absDir)
  const out: StoryNode[] = []
  for (const name of sortChildren(childNames(absDir), order)) {
    const abs = join(absDir, name)
    const childRel = relative(base, abs)
    const isDir = statSync(abs).isDirectory()
    if (isDir) {
      const folderId = ensureFolderId(abs, name, seenIds) // stamped once; survives rename/move (like scene_id)
      out.push({
        type: 'folder',
        name,
        relPath: childRel,
        path: abs,
        protected: rel === '' && name === ARCHIVE,
        ...(folderId ? { folderId } : {}),
        ...(readFolderType(abs) ? { containerType: readFolderType(abs) } : {}),
        children: buildNode(abs, base, childRel, seenIds)
      })
    } else if (name.endsWith('.md')) {
      let data: Record<string, unknown> = {}
      try {
        data = matter(readFileSync(abs, 'utf8')).data as Record<string, unknown>
      } catch {
        /* fall back to filename */
      }
      const leadsTo = Array.isArray(data.leads_to)
        ? data.leads_to.map(String)
        : data.leads_to
          ? [String(data.leads_to)]
          : []
      const cover = Array.isArray(data.images) && data.images.length ? String(data.images[0]) : data.avatar ? String(data.avatar) : ''
      out.push({
        type: 'scene',
        name: basename(name, '.md'),
        relPath: childRel,
        path: abs,
        sceneId: String(data.scene_id ?? basename(name, '.md')),
        title: String(data.title ?? basename(name, '.md')),
        ...(data.phase ? { phase: String(data.phase) } : {}),
        ...(cover ? { cover } : {}),
        ...(leadsTo.length ? { leadsTo } : {})
      })
    }
  }
  return out
}

/** The whole content/story tree, ordered by each level's `.order` manifest. */
const treeMemo = memoSlot<StoryNode[]>('storyTree')
export function listStoryTree(root: string): StoryNode[] {
  const base = storyRoot(root)
  if (!existsSync(base)) return []
  // Memoized by the story dir's fingerprint — a hit skips re-parsing every scene's frontmatter in buildNode. The
  // fingerprint spans dirs + files, so folder add/remove/rename/reorder/type edits bust it too. See enumCache.ts.
  return treeMemo(fingerprintDir(base), () => buildNode(base, base, '', new Set()))
}

// ── mutations ─────────────────────────────────────────────────────────────

function depthOf(rel: string): number {
  return rel === '' ? 0 : rel.split('/').length
}

/** Create a folder at parentRel/name. Returns the new rel path, or null on invalid/exists. */
export function createFolder(root: string, parentRel: string, name: string, type?: string): string | null {
  const pr = parentRel === '' ? '' : safeRel(parentRel)
  if (pr == null && parentRel !== '') return null
  // Rewrite Windows-reserved chars (a colon, etc.) to the FS-safe standard instead of rejecting — the folder name
  // IS the on-disk directory, so it must open on a collaborator's Windows machine.
  const safe = sanitizeFsName(name, MAX_NAME)
  if (!safe) return null
  const rel = pr ? `${pr}/${safe}` : safe
  if (depthOf(rel) > MAX_DEPTH) return null
  const abs = join(storyRoot(root), rel)
  if (existsSync(abs)) return null
  mkdirSync(abs, { recursive: true })
  if (type) writeFolderType(abs, type) // optional soft label (act/chapter/…)
  ensureFolderId(abs, safe, new Set()) // stable identity from birth (fresh dir → always a new id)
  prependToOrder(dirname(abs), safe) // land at the TOP (where the inline input is), not the bottom
  return rel
}

/** Rename/move a file or folder. Same-parent rename keeps order position. */
export function renamePath(root: string, fromRel: string, toRel: string): boolean {
  const from = safeRel(fromRel)
  let to = safeRel(toRel)
  if (!from || !to) return false
  // On a NAME CHANGE, rewrite Windows-reserved chars in the new basename to the FS-safe standard (instead of
  // rejecting) so the on-disk dir name stays portable. A pure MOVE (basename unchanged) is left exactly as-is,
  // so an existing entry with a legacy name can still be relocated.
  if (basename(from) !== basename(to)) {
    const isMd = to.endsWith('.md')
    const slash = to.lastIndexOf('/')
    const safe = sanitizeFsName(basename(to).replace(/\.md$/, ''), MAX_NAME)
    if (!safe) return false
    to = (slash >= 0 ? to.slice(0, slash + 1) : '') + safe + (isMd ? '.md' : '')
  }
  if (depthOf(to.replace(/\.md$/, '')) > MAX_DEPTH) return false
  const fromAbs = join(storyRoot(root), from)
  const toAbs = join(storyRoot(root), to)
  if (!existsSync(fromAbs) || existsSync(toAbs)) return false
  if (basename(from) === ARCHIVE && dirname(from) === '.') return false // protected
  const sameParent = dirname(fromAbs) === dirname(toAbs)
  // A same-parent rename must never move the entry. When the parent has a manual `.order` that lists it,
  // renameInOrder swaps in place and position is preserved. Otherwise the entry sorts alphanumerically, so
  // the NEW name would re-sort to a different slot — the "renaming shifts the order" bug. Capture the current
  // on-screen order NOW (pre-rename) so we can freeze it below and pin every sibling where it already sits.
  let frozen: string[] | null = null
  if (sameParent) {
    const dir = dirname(fromAbs)
    if (!readOrder(dir).includes(basename(from))) {
      frozen = sortChildren(childNames(dir), readOrder(dir)).filter((n) => n !== ARCHIVE)
    }
  }
  mkdirSync(dirname(toAbs), { recursive: true })
  renameSync(fromAbs, toAbs)
  // Maintain the parent .order entries so position survives the rename (see above).
  if (sameParent) {
    if (frozen) writeOrder(dirname(fromAbs), frozen.map((n) => (n === basename(from) ? basename(to) : n)))
    else renameInOrder(dirname(fromAbs), basename(from), basename(to))
  } else {
    removeFromOrder(dirname(fromAbs), basename(from))
  }
  return true
}

/** Delete a file or folder (recursive). The top-level archive folder is protected. */
export function deletePath(root: string, rel: string): boolean {
  const r = safeRel(rel)
  if (!r) return false
  if (r === ARCHIVE) return false // protected
  const abs = join(storyRoot(root), r)
  if (!existsSync(abs)) return false
  rmSync(abs, { recursive: true, force: true })
  removeFromOrder(dirname(abs), basename(r))
  return true
}

/** Persist a folder's child order (drag-to-reorder). */
export function setOrder(root: string, folderRel: string, names: string[]): boolean {
  const r = folderRel === '' ? '' : safeRel(folderRel)
  if (r == null && folderRel !== '') return false
  const abs = r ? join(storyRoot(root), r) : storyRoot(root)
  if (!existsSync(abs)) return false
  writeOrder(abs, names)
  return true
}

/** Every scene_id in the work — scenes are referenced globally, so ids must be unique work-wide. */
export function existingSceneIds(root: string): Set<string> {
  const ids = new Set<string>()
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir)) {
      if (e === ORDER_FILE || e.startsWith('.')) continue
      const abs = join(dir, e)
      if (statSync(abs).isDirectory()) walk(abs)
      else if (e.endsWith('.md') && !/^readme\.md$/i.test(e)) {
        try {
          ids.add(String(matter(readFileSync(abs, 'utf8')).data.scene_id ?? basename(e, '.md')))
        } catch {
          ids.add(basename(e, '.md'))
        }
      }
    }
  }
  walk(storyRoot(root))
  return ids
}

/**
 * Create a scene `.md` inside folderRel. The `scene_id` is made **globally unique**
 * (slug + -2/-3 on collision) — it's the immutable identity the timeline/links reference,
 * so two same-titled scenes in different folders can't clash. Returns its rel path, or null.
 */
export function createSceneInFolder(
  root: string,
  folderRel: string,
  id: string,
  frontmatter: Record<string, unknown>,
  body: string
): string | null {
  const fr = folderRel === '' ? '' : safeRel(folderRel)
  if (fr == null && folderRel !== '') return null
  const safeId = sanitizeFsName(id, MAX_NAME) // reserved chars → FS-safe standard (matches createFolder)
  if (!safeId) return null
  const uid = uniqueId(safeId, existingSceneIds(root))
  const dir = fr ? join(storyRoot(root), fr) : storyRoot(root)
  const abs = join(dir, `${uid}.md`)
  if (existsSync(abs)) return null
  mkdirSync(dir, { recursive: true })
  // New scenes start as `draft` (outside the analysis gate until the author marks them canon — matches the
  // createPage "mark it canon when ready" note); an explicit phase in frontmatter wins. scene_id is the
  // disambiguated unique id (the renderer passed the raw slug).
  writeFileSync(abs, matter.stringify(body.replace(/^\n+/, ''), { phase: 'draft', ...frontmatter, scene_id: uid }), 'utf8')
  prependToOrder(dir, `${uid}.md`) // land at the TOP (where the inline input is), not the bottom
  return relative(storyRoot(root), abs)
}
