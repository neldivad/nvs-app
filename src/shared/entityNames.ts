/**
 * entityNames — the ONE place that turns an entity's display name (+ aliases + id) into its set of matchable
 * name VARIANTS, and matches prose against them. It replaces the ~4 copied `normName`/`normalizeName` helpers
 * and the ad-hoc name→entity matching scattered across relationship.ts, queries.ts, the Annotated name-linker,
 * and the arc/thread panels (internal/entity-names.md).
 *
 * Why variants: a display name is authored freely — often BILINGUAL ("劉備 Liu Bei"), and the id is the
 * dual-script slug "劉備-liu-bei". But the prose the analysis produces (arc descriptions, conflicts, coherence
 * text) names the character in ONE script ("Liu Bei"), so matching against the whole name/id fails. We split
 * every source on SCRIPT boundaries so each run ("劉備", "liu bei") is independently matchable.
 *
 * NOTE (parked, internal/multilang.md): this does NOT fold Traditional↔Simplified Chinese — those are distinct
 * codepoints, a mapping not a normalization. Cross-variant USER QUERY is a deliberate follow-on; all matching
 * routes through `normName` here, so a Trad/Simp fold drops in at one seam when we build it.
 *
 * PURE (no Node) so the engine (main) and the renderer import ONE implementation, never a fifth copy.
 */

// A "run" is a maximal block of CJK/kana/hangul OR a maximal block of everything else. Splitting on this turns
// "劉備 Liu Bei" into ["劉備", "Liu Bei"] — script-general (Latin, Cyrillic, …).
const SCRIPT_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu
const HAS_CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * Normalize a string for name matching: NFKC fold + strip invisible format chars + lowercase + collapse
 * whitespace. Unlike an id slug, this KEEPS word spaces, so a variant "liu bei" matches prose "…forces Liu Bei
 * to flee…". The `\p{Cf}` strip removes zero-width/format codepoints (ZWSP U+200B, ZWNJ/ZWJ, BOM U+FEFF, word
 * joiner U+2060, soft hyphen U+00AD, …) that pasted-in text can carry — they're never part of a name, but they
 * DON'T fold under NFKC, so a cue "SCARAMOUCHE​" would otherwise never match the alias "Scaramouche". A slug
 * looks clean because slugification is ASCII-lossy and drops them; name matching must strip them explicitly.
 */
export function normName(s: string): string {
  return s.normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Split a name/slug into its per-script runs: "劉備 Liu Bei" → ["劉備", "Liu Bei"]. */
function scriptRuns(name: string): string[] {
  return (name.match(SCRIPT_RUN) ?? []).map((r) => r.trim()).filter(Boolean)
}

/** A short latin fragment ("of", "the") is noise; a 2-char CJK string is a whole name (劉備) — keep it. */
function keepable(v: string): boolean {
  return v.length >= 3 || HAS_CJK.test(v)
}

export interface NameLike { name?: string | null; aliases?: readonly string[] | null; id: string }

/**
 * The NORMALIZED, de-duplicated set of matchable variants for an entity: its full name + each script-run, its
 * aliases (+ runs), and the id-slug de-hyphenated (+ runs) — since the id ("劉備-liu-bei") carries both scripts.
 * The single source of truth for "what strings name this entity".
 */
export function entityNameVariants(input: NameLike): string[] {
  const out = new Set<string>()
  const addAll = (raw: string): void => {
    for (const piece of [raw, ...scriptRuns(raw)]) {
      const v = normName(piece)
      if (v && keepable(v)) out.add(v)
    }
  }
  addAll(input.id.replace(/[-_]+/g, ' ')) // id-slug ("劉備-liu-bei" → "劉備 liu bei")
  if (input.name) addAll(input.name)
  for (const a of input.aliases ?? []) addAll(a)
  return [...out]
}

/** Does `text` mention any of the entity's variants? (normalized substring match). */
export function mentionsEntity(text: string, variants: readonly string[]): boolean {
  const t = normName(text)
  return variants.some((v) => t.includes(v))
}

/**
 * A variant→id index for resolving an extracted/raw name STRING to a canonical entity id. First entity to claim
 * a variant wins (order callers' input by preference), so an ambiguous shared alias doesn't silently flip ids.
 */
export function buildNameIndex(entities: readonly NameLike[]): Map<string, string> {
  const idx = new Map<string, string>()
  for (const e of entities) for (const v of entityNameVariants(e)) if (!idx.has(v)) idx.set(v, e.id)
  return idx
}

/** Resolve a raw extracted name to an entity id via the variant index (exact normalized match). Null = unknown
 *  (a genuinely new name → the caller may mint a new entity). */
export function resolveName(rawName: string, index: Map<string, string>): string | null {
  return index.get(normName(rawName)) ?? null
}
