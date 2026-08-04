/**
 * Pure reference canonicalization — no DB, no fs (so it's unit-testable and can't drag Electron's native
 * sqlite into a test). `writeTier` fetches the `narrative_units` (id, title) set once and delegates here to
 * normalize `evidence_json` on write (the one reference the schema doesn't FK-enforce). See decisions.md D2.
 */

/** A resolvable target: the unit id, plus its display title (how a producer names a chapter, e.g. "005-act-v"). */
export interface UnitRefTarget {
  id: string
  title?: string | null
}

/**
 * Map each ref → a CANONICAL unit-id that exists among `units`: exact match · a `c:`/`s:`-prefixed form (strip
 * the prefix) · a bare NAME matched against the unit's TITLE (chapter units are keyed `c:<stable-folder-id>`, so
 * the name lives in the title, not the id) · legacy path/colon tail match (pre-stable-id chapter keys like
 * `c:chapters/005-act-v`). Unresolvable refs are DROPPED; the result is de-duped, order-preserving.
 */
export function canonicalizeUnitRefs(units: Array<string | UnitRefTarget>, refs: string[] | null | undefined): string[] {
  if (!refs?.length) return []
  const targets = units.map((u) => (typeof u === 'string' ? { id: u } : u))
  const ids = new Set(targets.map((t) => t.id))
  const byTitle = new Map<string, string>()
  for (const t of targets) {
    const title = t.title?.trim().toLowerCase()
    if (title && !byTitle.has(title)) byTitle.set(title, t.id)
  }
  const out: string[] = []
  for (const ref of refs) {
    let id: string | undefined
    if (ids.has(ref)) id = ref
    else {
      const bare = ref.replace(/^[a-z]+:/i, '') // "c:chapters/005-act-v" → "chapters/005-act-v"
      id =
        (ids.has(bare) ? bare : undefined) ??
        byTitle.get(bare.toLowerCase()) ?? // stable-id world: the name is the TITLE
        targets.find((t) => t.id.endsWith('/' + bare) || t.id.endsWith(':' + bare))?.id // legacy path-keyed ids
    }
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}
