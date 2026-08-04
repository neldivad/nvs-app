/**
 * Declared secrets — parsing the `## Secrets` section into identified entries (internal/secret-lifecycle.md).
 *
 * The authored entry IS the secret: identity lives in the file, the DB only references it. An entry may
 * carry an explicit id (`- [affair] Knows about the affair…`); otherwise one is DERIVED from its first
 * words (stable as long as the entry's opening words don't change — the scene_id bargain). Extraction
 * never invents ids: the coherence pass is shown the annotated entries and may only CITE these ids.
 */

import { readFileSync } from 'node:fs'
import { listWorldPages } from '@engine/content/world'

/** One declared secret: its stable id + the entry text (id marker stripped). */
export interface DeclaredSecret {
  id: string
  text: string
}

const SECTION_RE = /^##\s*Secrets\b[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im
const ITEM_RE = /^\s*[-*•]\s+(.*)$/
const EXPLICIT_ID_RE = /^\[([A-Za-z0-9][\w-]*)\]\s*(.*)$/

/** Derived id: kebab of the first 4 words (the scene_id bargain — stable unless the opening words change). */
function deriveId(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
  return words.join('-') || 'secret'
}

/** Parse the page's `## Secrets` section → identified entries. [] when no section / no items. */
export function declaredSecrets(pageBody: string): DeclaredSecret[] {
  const section = SECTION_RE.exec(pageBody)?.[1]
  if (!section) return []
  const out: DeclaredSecret[] = []
  const used = new Set<string>()
  for (const line of section.split('\n')) {
    const item = ITEM_RE.exec(line)?.[1]?.trim()
    if (!item) continue
    const explicit = EXPLICIT_ID_RE.exec(item)
    let id = explicit ? explicit[1].toLowerCase() : deriveId(item)
    const text = explicit ? explicit[2].trim() : item
    for (let n = 2; used.has(id); n++) id = `${explicit ? explicit[1].toLowerCase() : deriveId(item)}-${n}`
    used.add(id)
    out.push({ id, text })
  }
  return out
}

/**
 * Annotate the section's entries with their ids (`- [id] text…`) for the LLM payload, so a confirmation
 * can cite the covering secret. Idempotent: explicit ids stay as written; only derived ones are inserted.
 */
export function annotateSecretIds(pageBody: string): string {
  const m = SECTION_RE.exec(pageBody)
  if (!m) return pageBody
  const secrets = declaredSecrets(pageBody)
  let i = 0
  const annotated = m[1]
    .split('\n')
    .map((line) => {
      const item = ITEM_RE.exec(line)?.[1]?.trim()
      if (!item) return line
      const s = secrets[i++]
      if (!s || EXPLICIT_ID_RE.test(item)) return line
      return line.replace(item, `[${s.id}] ${item}`)
    })
    .join('\n')
  return pageBody.slice(0, m.index) + pageBody.slice(m.index, m.index + m[0].length).replace(m[1], annotated) + pageBody.slice(m.index + m[0].length)
}

/** A declared secret with its owner — the project-wide roster the window pass cites against. */
export interface RosterSecret extends DeclaredSecret {
  ownerId: string
  ownerName: string
}

/** Every declared secret in the project (any world page kind — an item's Secrets participate like a
 *  character's). Small by construction: secrets exist only where the author wrote them. */
export function collectDeclaredSecrets(workRoot: string): RosterSecret[] {
  const out: RosterSecret[] = []
  for (const page of listWorldPages(workRoot)) {
    try {
      for (const s of declaredSecrets(readFileSync(page.path, 'utf8'))) {
        out.push({ ...s, ownerId: page.id, ownerName: page.name })
      }
    } catch {
      /* unreadable page — skip (the scan rule) */
    }
  }
  return out
}
