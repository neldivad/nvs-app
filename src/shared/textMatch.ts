/**
 * The ONE fuzzy text-match primitive, shared by the agent's `search` (main) and the ⌘K palette / list filters
 * (renderer) — so agent-search and user-search normalize IDENTICALLY and can never drift. PURE (no Node).
 *
 * `normLoose` folds away everything that shouldn't affect a name match: NFKD decomposition + strip combining
 * marks (accent-insensitive: "café" ⇄ "cafe"), lowercase, then drop every non-letter/number in ANY script
 * (spaces, punctuation, the "1.4 " order prefix, regex-special chars). Uses `\p{L}\p{N}` (u flag) — NOT `[a-z0-9]`,
 * which would erase a CJK name ("胡桃") to "". So "1.4 Hu Tao" / "hutao" / "hu tao" all reduce to comparable keys,
 * and "胡桃" survives. Because callers only ever String.includes the result (never build a RegExp from input),
 * regex-special characters in the text are inert.
 */
export function normLoose(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Does `text` loosely contain `query`? Empty query matches everything (an unfiltered list). */
export function looseIncludes(text: string, query: string): boolean {
  const q = normLoose(query)
  return q === '' || normLoose(text).includes(q)
}
