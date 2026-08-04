/**
 * railGaps.ts — the empty chapters between two events on a timeline rail (the "ghost" stretches that show a
 * thread/arc going quiet). Given the story's chapter keys IN ORDER and two chapter keys, return the keys
 * STRICTLY between them (exclusive both ends), in story order. Symmetric, so the caller's display direction
 * (latest-first vs oldest-first) doesn't matter. Returns [] when the two are adjacent, the same, or either is
 * unknown — so a thread/arc only ever ghosts the gaps INSIDE its own span, never before it opens or after it ends.
 */
export function chaptersBetween(orderedKeys: string[], a: string | undefined, b: string | undefined): string[] {
  if (!a || !b) return []
  const ia = orderedKeys.indexOf(a)
  const ib = orderedKeys.indexOf(b)
  if (ia < 0 || ib < 0) return []
  const lo = Math.min(ia, ib)
  const hi = Math.max(ia, ib)
  return orderedKeys.slice(lo + 1, hi)
}

export interface Station<T> {
  key: string // chapter key
  quiet: boolean // an event-less chapter the line passes (a hollow station)
  terminal: boolean // a chapter where an item closes the timeline (the terminus)
  items: T[] // the cards under this station (empty when quiet)
}

/**
 * Build the chapter-station sequence for a sheet (the "railway"). Consecutive same-chapter items group into one
 * station; between two event-chapters, the genuinely-quiet chapters (`chaptersBetween` minus any in `occupied`,
 * which holds every chapter the timeline touches even if filtered out of `items`) become hollow stations.
 * Display order is preserved; quiet fills are reversed when `descending` (the caller shows latest-first). An
 * item with no chapter folds into the previous station. `isTerminal` marks the closing station(s).
 */
export function buildStations<T>(
  items: T[],
  chapterOf: (it: T) => string | undefined,
  orderedKeys: string[],
  occupied: Set<string>,
  descending: boolean,
  isTerminal?: (it: T) => boolean
): Station<T>[] {
  const out: Station<T>[] = []
  let prev: string | undefined
  for (const it of items) {
    const ck = chapterOf(it)
    const top = out[out.length - 1]
    if (!ck) {
      if (top) top.items.push(it) // chapterless item: keep it under the current station
      continue
    }
    if (top && !top.quiet && top.key === ck) {
      top.items.push(it)
      continue
    }
    if (prev) {
      const quiet = chaptersBetween(orderedKeys, prev, ck).filter((k) => !occupied.has(k))
      for (const qk of descending ? [...quiet].reverse() : quiet) out.push({ key: qk, quiet: true, terminal: false, items: [] })
    }
    out.push({ key: ck, quiet: false, terminal: false, items: [it] })
    prev = ck
  }
  if (isTerminal) for (const s of out) if (!s.quiet) s.terminal = s.items.some(isTerminal)
  return out
}
