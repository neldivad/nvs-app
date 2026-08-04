/**
 * Tool-result shaping — the two legibility mechanisms from the harness study (internal/tool-surface.md,
 * internal/agent-harness-crossref.md), PURE so dispatch (main), the engine's queryDb, and unit tests all
 * share one implementation:
 *
 *  • `clampMiddleOut` — middle-out truncation. A tool result that outgrows the context budget keeps its
 *    HEAD and TAIL (where the summary/error usually lives) and declares what it dropped, instead of the
 *    old head-only slice that silently threw the tail away.
 *  • `teachError` + `nearestStrings` — the teaching-error contract. Every recoverable failure names what
 *    didn't match (echo the guess), offers the nearest REAL alternatives from live data, and hands back a
 *    literal next-call fragment. Weak models convert on graspability, not reasoning — the correction must
 *    be copy-pasteable. The stall-breaker (providers.ts) stays the confidence floor beneath this.
 */

import { normLoose } from '@shared/textMatch'

/** How many alternatives a teaching error offers — enough to correct, few enough to stay graspable. */
export const TEACH_MAX_VALID = 5

/**
 * Middle-out clamp: within `max` chars, keep the head and the tail of `s` with an inline marker declaring
 * the omission (chars dropped + why + what to do). Head gets the larger share (orientation/context), the
 * tail survives because errors, totals and closing summaries live there. Unchanged when it already fits.
 */
export function clampMiddleOut(s: string, max: number): string {
  if (s.length <= max) return s
  // The marker text embeds the omitted-count, whose digit width depends on the split — compute with a
  // worst-case width so the final string NEVER exceeds `max` (a second pass would re-shrink forever).
  const marker = (omitted: number): string => `…[middle truncated: ${omitted} of ${s.length} chars omitted — re-fetch a narrower slice if needed]…`
  const reserve = marker(s.length).length // widest possible marker (omitted ≤ total)
  const budget = Math.max(0, max - reserve)
  const head = Math.ceil(budget * 0.6) // head orients; tail carries the ending — 60/40
  const tail = budget - head
  return s.slice(0, head) + marker(s.length - head - tail) + (tail > 0 ? s.slice(s.length - tail) : '')
}

/**
 * Nearest candidates to a failed guess, ranked by squashed overlap (accent/space/punctuation-insensitive,
 * CJK-safe via normLoose) — the generic sibling of folderMatch.nearestFolders for titles/columns/kinds.
 * Whole-string containment ranks first (longer shared run wins), ties broken by closeness in length.
 */
export function nearestStrings(guess: string, candidates: readonly string[], k = TEACH_MAX_VALID): string[] {
  const g = normLoose(guess)
  if (!g) return []
  return candidates
    .map((c) => {
      const n = normLoose(c)
      const score = n && (n.includes(g) || g.includes(n)) ? Math.min(n.length, g.length) : 0
      return { c, score, dist: Math.abs(n.length - g.length) }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.dist - b.dist)
    .slice(0, k)
    .map((x) => x.c)
}

/** The teaching-error shape every recoverable tool failure returns (tool-surface.md contract). */
export interface TeachError {
  error: string // what didn't match — always echoes the caller's guess
  valid?: string[] // nearest REAL alternatives from live data (≤ TEACH_MAX_VALID)
  next?: string // a literal, copy-pasteable retry fragment
}

/** Build a teaching error: echo + alternatives + next call. Empty `valid` is dropped (never `valid: []`
 *  teaching "there are no options" when we simply had no ranking signal). */
export function teachError(error: string, valid?: readonly string[], next?: string): TeachError {
  const out: TeachError = { error }
  const v = (valid ?? []).filter(Boolean).slice(0, TEACH_MAX_VALID)
  if (v.length) out.valid = v
  if (next) out.next = next
  return out
}
