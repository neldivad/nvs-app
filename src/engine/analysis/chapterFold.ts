/**
 * Chapter Ledger fold (fractal-consolidation.md, Slice 1 · Tier-1 deterministic).
 *
 * A `fold([scene beats]) → ChapterLedger` — the first level of the reduction tree. Given a chapter's ordered
 * thread beats (thread_events) + its scene bookends, it produces a self-sufficient chapter node that a HIGHER
 * level (act/book) reads INSTEAD of the raw scenes:
 *   - reconciles each thread's beats into ONE net entry (compression),
 *   - marks threads that opened AND resolved inside the chapter as EVENTS (compress out of the higher ledger),
 *   - carries `openAtEnd` — threads still open leaving the chapter = the FORWARD CONSEQUENCES the next level owns,
 *   - flags the Tier-1 hygiene findings (low-confidence close · reopened · orphan close).
 *
 * PURE + deterministic: no DB, no AI, no clock — so it's trivially testable and its output is content-addressable
 * (the persistence layer hashes the inputs, like character_windows.input_hash). The AI "assembly" of who/why into
 * a full §4a record is Tier-2 and lands later; Tier-1 works the thread-event ledger mechanically.
 */

export type BeatAction = 'open' | 'advance' | 'resolve' | 'reopen' | 'supersede'

/** One thread_events row for a scene in the chapter (the fold's raw input). */
export type ThreadBeat = {
  threadId: string
  action: BeatAction
  pos: number // scene linear_pos (reading order within + across chapters)
  description: string
  subject: string | null
  confidence: number | null
}

export type ChapterFoldInput = {
  chapterId: string
  premise: string // first scene's premise — the chapter's opening bookend
  conclusion: string // last scene's conclusion — the chapter's closing bookend
  beats: ThreadBeat[] // every thread_event landing on this chapter's scenes (any order; the fold sorts)
  openBefore: readonly string[] // thread ids open ENTERING the chapter (openThreadsAsOf) — to tell carried vs in-chapter
}

/** The reconciled per-thread movement this chapter made. `net` compresses many beats into one verb. */
export type LedgerEntry = {
  threadId: string
  subject: string | null
  net: 'opened' | 'advanced' | 'resolved' | 'opened-and-resolved' | 'reopened'
  description: string // the latest beat's description (the thread's state as of chapter end)
  pos: number // first beat's pos (entry ordering)
}

export type LedgerFlag = {
  threadId: string
  kind: 'in-chapter-event' | 'low-confidence-close' | 'reopened' | 'orphan-close'
  detail: string
}

/** The chapter node — a self-sufficient Ledger the next fold level reads instead of the raw scenes. */
export type ChapterLedger = {
  chapterId: string
  premise: string
  conclusion: string
  entries: LedgerEntry[] // reading order; one per thread the chapter touched
  openAtEnd: string[] // thread ids still open leaving the chapter (forward consequence), sorted
  flags: LedgerFlag[]
}

/**
 * Map a child node's reconciled entries BACK into beats — the step that makes the fold CLOSED under recursion
 * (fractal-consolidation.md): a parent unit (act/book) folds its children's LEDGERS via the SAME
 * `foldChapterLedger`, by re-expressing each child's net movement as beats at the child's position. A thread
 * opened in one child and resolved in a later one thus becomes `open` + `resolve` at the parent → the parent fold
 * closes it (the long-arc payoff, recognized at the level where both children are visible).
 */
export function entriesToBeats(entries: LedgerEntry[]): ThreadBeat[] {
  const beats: ThreadBeat[] = []
  for (const e of entries) {
    const base = { threadId: e.threadId, pos: e.pos, description: e.description, subject: e.subject, confidence: null as number | null }
    if (e.net === 'opened') beats.push({ ...base, action: 'open' })
    else if (e.net === 'advanced') beats.push({ ...base, action: 'advance' })
    else if (e.net === 'resolved') beats.push({ ...base, action: 'resolve' })
    else if (e.net === 'reopened') beats.push({ ...base, action: 'reopen' })
    else if (e.net === 'opened-and-resolved') beats.push({ ...base, action: 'open' }, { ...base, action: 'resolve' })
  }
  return beats
}

const CLOSING: ReadonlySet<BeatAction> = new Set<BeatAction>(['resolve', 'supersede'])
const LOW_CONFIDENCE = 0.5

export function foldChapterLedger(input: ChapterFoldInput): ChapterLedger {
  // Group beats by thread, each group in reading order.
  const byThread = new Map<string, ThreadBeat[]>()
  for (const b of input.beats) {
    const g = byThread.get(b.threadId)
    if (g) g.push(b)
    else byThread.set(b.threadId, [b])
  }

  const openBefore = new Set(input.openBefore)
  const openAtEnd = new Set(openBefore) // start from carried-open, adjust per thread below
  const entries: LedgerEntry[] = []
  const flags: LedgerFlag[] = []

  for (const [threadId, group] of byThread) {
    const beats = [...group].sort((a, b) => a.pos - b.pos)
    const first = beats[0]
    const last = beats[beats.length - 1]
    const openedHere = beats.some((b) => b.action === 'open')
    const reopenedHere = beats.some((b) => b.action === 'reopen')
    const closeBeat = beats.find((b) => CLOSING.has(b.action))
    const closedHere = closeBeat != null

    const net: LedgerEntry['net'] =
      openedHere && closedHere ? 'opened-and-resolved' : closedHere ? 'resolved' : reopenedHere ? 'reopened' : openedHere ? 'opened' : 'advanced'

    entries.push({ threadId, subject: first.subject, net, description: last.description, pos: first.pos })

    // Forward-consequence bookkeeping: a close removes it from the open set; an open/reopen adds it.
    if (closedHere) openAtEnd.delete(threadId)
    else if (openedHere || reopenedHere) openAtEnd.add(threadId)

    // Tier-1 hygiene flags (deterministic).
    if (openedHere && closedHere)
      flags.push({ threadId, kind: 'in-chapter-event', detail: 'opened and resolved within this chapter — an EVENT; candidate to compress out of the act/book ledger' })
    if (closeBeat && (closeBeat.confidence ?? 1) < LOW_CONFIDENCE)
      flags.push({ threadId, kind: 'low-confidence-close', detail: `resolve at pos ${closeBeat.pos} has confidence ${closeBeat.confidence}` })
    if (reopenedHere) flags.push({ threadId, kind: 'reopened', detail: 'reopened in this chapter' })
    if (closedHere && !openedHere && !openBefore.has(threadId))
      flags.push({ threadId, kind: 'orphan-close', detail: 'resolved but never opened (before or in this chapter) — an orphan close to reconcile' })
  }

  entries.sort((a, b) => a.pos - b.pos)
  return { chapterId: input.chapterId, premise: input.premise, conclusion: input.conclusion, entries, openAtEnd: [...openAtEnd].sort(), flags }
}
