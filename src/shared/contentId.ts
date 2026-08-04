/**
 * contentId — the ONE way NVS generates ids for content (scenes, world pages/entities, folders). See the
 * decision doc internal/content-id.md: the stamped id in the file is the sole identity; the analysis DB is a
 * rebuildable cache keyed by it. This module owns GENERATION (not persistence — that's engine/contentId.ts,
 * which reads/stamps ids into files, and not MATCHING — that's @shared/entityNames).
 *
 * Before this there were FIVE divergent slug functions; only one preserved combining marks. `slugId` is now the
 * single rule, and every create/ingest path routes through it.
 *
 * PURE (no Node) so the renderer and engine share one implementation.
 */

/**
 * The canonical id slug: NFKC-fold → lowercase → keep letters/numbers/COMBINING MARKS → collapse every other
 * run to a single hyphen → trim. Keeping `\p{M}` marks is essential: Indic/Arabic vowel signs are marks (not
 * `\p{L}` letters), and dropping them shatters syllables ("नरेंद्र" → "नर-द-र"). Idempotent — `slugId(id) === id`
 * for an already-canonical id, so it's safe to re-run on existing ids. '' when the name has no letters/numbers
 * (callers supply a fallback like 'scene'/'entity'/'folder').
 */
export function slugId(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/** True when `id` is already a canonical slug (idempotence / validation check). */
export function isCanonicalId(id: string): boolean {
  return id.length > 0 && id === slugId(id)
}

/** Disambiguate `base` against `taken`: base, then base-2, base-3, … (readable + unique). */
export function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}
