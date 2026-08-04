/**
 * Forgiving story-folder matching — the ONE place a loose folder REF ("hutao", "hu tao", "1.4 Hu Tao", "胡桃",
 * or even a wrong/compound path a model hand-built) is resolved to a real folder. PURE (no Node/engine) so both
 * the agent dispatch (main) and its unit test import the same logic.
 *
 * Why this exists: an LLM driving NVS guesses folder names the way a human types them in chat — casual, spaced or
 * unspaced, sometimes as a full path. Exact-match kept dead-ending the agent into a loop (internal notes:
 * agent-tool-loop). The matcher below degrades gracefully: exact → case-insensitive → whitespace/punctuation-
 * insensitive (`squash`) → most-specific on a compound path.
 */

import { normLoose } from '@shared/textMatch'

export interface FolderLike {
  relPath: string
  name: string
}

/** Collapse a folder/ref name to a match key — the shared fuzzy normalization (accent-fold + strip spaces /
 *  punctuation / order-prefix, Unicode-aware so CJK survives). Aliased to `normLoose` so folder matching and the
 *  general `search` tool normalize identically. */
export const squash = normLoose

/**
 * Resolve a folder REF to ONE folder, forgivingly. Generic over the node type so callers get their own richer
 * node (with children, etc.) back, not a copy. Returns null when there's no match or a genuinely ambiguous one
 * (the caller then shows `nearestFolders` — never a bare dead-end).
 */
export function resolveFolder<T extends FolderLike>(ref: string, folders: readonly T[]): T | null {
  const raw = ref.trim()
  const rel = raw.replace(/^\.?\/+/, '').replace(/^content\/story\//, '')
  // 1. exact relPath / name (raw or content/story-stripped)
  const exact = folders.find((n) => n.relPath === raw || n.relPath === rel || n.name === raw || n.name === rel)
  if (exact) return exact
  // 2. case-insensitive relPath / name / relPath-suffix
  const lc = rel.toLowerCase()
  const ci = folders.filter((n) => n.relPath.toLowerCase() === lc || n.name.toLowerCase() === lc || n.relPath.toLowerCase().endsWith('/' + lc))
  if (ci.length === 1) return ci[0]
  // 3. whitespace/punctuation-insensitive (squash) — "hutao" ⇄ "1.4 Hu Tao", "胡桃" ⇄ "1.4 胡桃"
  const sq = squash(rel)
  if (!sq) return null // ref was all punctuation/spaces → nothing to match on (never match-all)
  const fuzzy = folders.filter((n) => { const nm = squash(n.name); return !!nm && (nm.includes(sq) || sq.includes(nm)) })
  // The unmatched-token guard applies only to BARE-NAME refs (no '/') in the ref-CONTAINS-name direction:
  // a fragment ref ("chalk" → "1.2 The Chalk Prince…") always has residue and is always legitimate, and a
  // SLASHED compound path self-heals to the leaf below (its extra segments are ancestors/scene tails — the
  // caller's resolution echo makes any mishit visible there).
  const bareName = !rel.includes('/')
  if (fuzzy.length === 1) return bareName && sq.includes(squash(fuzzy[0].name)) && unmatchedResidue(sq, fuzzy) ? null : fuzzy[0]
  // 4. >1 hit is the COMMON compound-path case: a full (even wrong) path contains every ANCESTOR name too. Pick
  //    the MOST SPECIFIC — of the candidates whose squashed name actually appears in the ref, the DEEPEST folder.
  if (fuzzy.length > 1) {
    const ranked = fuzzy.filter((n) => sq.includes(squash(n.name))).sort((a, b) => b.relPath.length - a.relPath.length)
    if (ranked.length) return bareName && unmatchedResidue(sq, fuzzy) ? null : ranked[0]
  }
  return null
}

/**
 * The UNMATCHED-TOKEN guard (from the "Event Quests Afterword" incident): a bare-name ref that CONTAINS a
 * folder name plus significant extra material names something MORE SPECIFIC than that folder — matching the
 * ancestor would silently WIDEN the target (a bulk edit on a whole tree the author never named). Strip every
 * fuzzy candidate's name (ancestors legitimately pad a compound ref) and any digits/order numbers; if
 * meaningful residue remains ("afterword"), refuse — the caller's teaching error then routes the model to
 * `search`. Plural/typo slack stays: a residue under 3 chars ("s", "es") never blocks.
 */
function unmatchedResidue(sq: string, candidates: readonly FolderLike[]): boolean {
  let r = sq
  for (const n of candidates) {
    const nm = squash(n.name)
    if (nm) r = r.split(nm).join('')
  }
  return r.replace(/\d+/g, '').length >= 3
}

/**
 * Closest folders to a FAILED ref, ranked by shared (squashed) name + path segments — so a miss shows the real
 * answer instead of a truncated dump of the whole tree. Squash-based, so it works for CJK and punctuated names.
 */
export function nearestFolders(ref: string, folders: readonly FolderLike[], k = 6): string[] {
  const sq = squash(ref.replace(/^content\/story\//, ''))
  const segs = ref.toLowerCase().split('/').map(squash).filter((s) => s.length > 1)
  return folders
    .map((n) => {
      const rp = squash(n.relPath)
      const nm = squash(n.name)
      let score = nm && sq && (sq.includes(nm) || nm.includes(sq)) ? nm.length : 0 // whole-name overlap, by length
      for (const s of segs) if (s !== nm && rp.includes(s)) score += s.length // shared path segments
      return { rel: n.relPath, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.rel)
}
