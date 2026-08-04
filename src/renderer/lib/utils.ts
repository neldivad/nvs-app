import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn's class combiner: merge conditional + conflicting Tailwind classes. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Typeahead match: does `text` contain `query` — ignoring case, spaces, punctuation, and accents? So "hut"
 *  finds "Hu Tao", "obrien" finds "O'Brien", "jose" finds "José". Empty query matches everything. It's a
 *  substring test AFTER normalization (not a fuzzy subsequence), so it stays predictable and won't over-match. */
export function looseIncludes(text: string, query: string): boolean {
  if (query.trim() === '') return true // a truly EMPTY query matches everything (typeahead shows the full list)
  const norm = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const q = norm(query)
  // A non-empty query that normalizes away (all punctuation, e.g. "???") is NOT "match all" — it only matches a
  // candidate that ALSO normalizes to nothing (a literal "???" speaker). Otherwise it'd swallow the whole cast.
  if (q === '') return norm(text) === ''
  return norm(text).includes(q)
}

/** The standard sidebar list-row — one look across every rail's roster (matches CustodySidebar; DESIGN.md).
 *  `rounded px-2 py-1`, panel-soft selection (no border-accent). Compose extra state (opacity…) after it:
 *  `cn(sidebarRow(on), off && 'opacity-50')`. Meta/sub text pairs with `text-[10px] text-faint`. */
export function sidebarRow(on: boolean): string {
  return cn(
    'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors',
    on ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
  )
}

// One cached formatter — Intl.NumberFormat construction is costly, and dense rails render this per row.
const _compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** Compact a count for dense UI, YouTube-style: 999 → "999", 1500 → "1.5K", 23200 → "23.2K", 1_200_000 → "1.2M".
 *  Use for roster/stat counts where the exact value isn't needed inline (pair with a `title` for the full number). */
export function compactNumber(n: number): string {
  return _compact.format(n)
}

/** The ONE "N chars" hover/tooltip label — every cast/graph readout that shows a char volume uses this, so the
 *  format (compact number + wording) lives in a single place. `together` for pair-volume readouts. */
export function charsLabel(n: number, together = false): string {
  return `${compactNumber(n)} chars${together ? ' together' : ''}`
}