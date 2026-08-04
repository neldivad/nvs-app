/**
 * engine/contentId — PERSISTENCE for content ids (read + stamp), the Node companion to @shared/contentId
 * (generation). See internal/content-id.md: the stamped id in the file is the sole identity; the analysis DB is
 * a cache keyed by it. This module is the ONE place that reads/writes ids to disk, dispatching frontmatter
 * (scene/entity) vs a `.id` dotfile (folder). Writes are best-effort + read-only-tolerant (like scene_id
 * stamping already is), and `stampId` returns the stamped bytes so a caller can re-hash and NOT see the stamp
 * as a content edit.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import matter from 'gray-matter'

export type IdKind = 'scene' | 'entity' | 'folder'
const FM_KEY = { scene: 'scene_id', entity: 'id' } as const

/** The stamped id ONLY — '' when unstamped (no filename fallback). Used to decide whether to stamp-back. */
export function readStampedId(kind: 'scene' | 'entity', filePath: string): string {
  try {
    const v = matter(readFileSync(filePath, 'utf8')).data[FM_KEY[kind]]
    return v != null ? String(v) : ''
  } catch {
    return ''
  }
}

/**
 * A content file's id, with the legacy filename fallback (scene/entity) — kept until stamp-back guarantees every
 * file carries one. Folder: the `.id` dotfile, else ''. `path` is the .md file (scene/entity) or the dir (folder).
 */
export function readId(kind: IdKind, path: string): string {
  if (kind === 'folder') {
    const f = join(path, '.id')
    try {
      return existsSync(f) ? readFileSync(f, 'utf8').trim() : ''
    } catch {
      return ''
    }
  }
  return readStampedId(kind, path) || basename(path).replace(/\.md$/, '')
}

/**
 * Stamp an id into the file (frontmatter for scene/entity, `.id` dotfile for folder). Best-effort: a read-only
 * fs leaves the file untouched and the caller uses the id in-memory this session. Returns the stamped bytes for
 * scene/entity (re-hash them so the stamp isn't counted as an edit), the id for folder, or null on no-op/failure.
 */
export function stampId(kind: IdKind, path: string, id: string): string | null {
  try {
    if (kind === 'folder') {
      writeFileSync(join(path, '.id'), id)
      return id
    }
    const raw = readFileSync(path, 'utf8')
    const { data, content } = matter(raw)
    if (String(data[FM_KEY[kind]] ?? '') === id) return null // already stamped — no write
    data[FM_KEY[kind]] = id
    const stamped = matter.stringify(content.replace(/^\n+/, ''), data)
    writeFileSync(path, stamped)
    return stamped
  } catch {
    return null
  }
}
