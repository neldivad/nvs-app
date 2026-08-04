/**
 * Lens D (dramatic irony) — the pair-scoped projection of AUTHORED custody topics
 * (internal/relationship-rail.md §D, un-gated 2026-07-09: the secret-lifecycle model landed + validated).
 *
 * For a matchup (A, B) and one information topic, the track is:
 *   🔒 established (first checkpoint) → 👁 the reader learns (gain [audience], else the first-checkpoint
 *   fallback — the SAME rule as the custody chart's AUDIENCE row) → ⚡ the character learns (their gain).
 * The IRONY WINDOW for a character = [reader-knows, they-learn) — the reader is ahead of them. That's the
 * suspense computation the custody fold already draws; here it's re-scoped to one pair per topic.
 *
 * Pure + renderer-side: topics come from listCustodyTopics, cols from the active scene axis. No LLM, no
 * interpretation — the chart stays authored (grammar v2: gain fills, lost un-fills, audience gain-only).
 */
import type { CustodyRecord, CustodyTopic } from '@shared/ipc'

export interface IronyTrack {
  pageId: string
  name: string
  path: string // the topic page — bands deep-link to it
  established: number // col of the first checkpoint
  audience: number | null // col where the reader learns (explicit gain [audience], else established)
  aLearns: number | null // col where A first gains — null = never (on-page)
  bLearns: number | null
  /** [from, to] col spans where the reader knows and the character doesn't — dramatic irony. */
  ironyA: { from: number; to: number } | null
  ironyB: { from: number; to: number } | null
  /** [from, to] col spans where the OTHER fighter knows and this one doesn't — information arbitrage
   *  between the pair ("what each hides from the other"), independent of the reader. */
  arbA: { from: number; to: number } | null
  arbB: { from: number; to: number } | null
}

function firstGainCol(records: { r: CustodyRecord; col: number }[], who: (w: string) => boolean): number | null {
  for (const { r, col } of records) if (r.event === 'gain' && r.who.some(who)) return col
  return null
}

/**
 * Project the pair's irony tracks out of the authored topics. `matches(who, id)` resolves a record's who
 * token against a character id (ids and display names both appear in authored records — pass a resolver
 * built from world pages). Topics with no checkpoint on the axis are skipped.
 */
export function ironyTracks(
  topics: CustodyTopic[],
  colOf: Map<string, number>,
  lastCol: number,
  aId: string,
  bId: string,
  matches: (whoToken: string, characterId: string) => boolean
): IronyTrack[] {
  const out: IronyTrack[] = []
  for (const t of topics) {
    if (t.topic !== 'information') continue // items track hands, not knowledge — D is the knowledge lens
    const recs = t.records
      .map((r) => ({ r, col: r.scene === 'start' ? 0 : (colOf.get(r.scene) ?? null) }))
      .filter((x): x is { r: CustodyRecord; col: number } => x.col != null)
      .sort((x, y) => x.col - y.col)
    if (!recs.length) continue
    const aLearns = firstGainCol(recs, (w) => matches(w, aId))
    const bLearns = firstGainCol(recs, (w) => matches(w, bId))
    // public floods everyone in-world — it ends both irony windows
    const publicAt = recs.find((x) => x.r.event === 'public')?.col ?? null
    if (aLearns == null && bLearns == null && publicAt == null) continue // the pair never touches this topic
    const established = recs[0].col
    const audience = firstGainCol(recs, (w) => w.toLowerCase() === 'audience') ?? established
    const knownBy = (learns: number | null): number => Math.min(learns ?? Infinity, publicAt ?? Infinity)
    const windowFor = (learns: number | null): { from: number; to: number } | null => {
      const end = knownBy(learns)
      const to = end === Infinity ? lastCol : end - 1
      return audience <= to ? { from: audience, to } : null
    }
    // arbitrage: the span where the OTHER fighter already knows and this one still doesn't
    const arbFor = (otherLearns: number | null, ownLearns: number | null): { from: number; to: number } | null => {
      if (otherLearns == null) return null
      const end = knownBy(ownLearns)
      const to = end === Infinity ? lastCol : end - 1
      return otherLearns <= to ? { from: otherLearns, to } : null
    }
    out.push({
      pageId: t.pageId,
      name: t.name,
      path: t.path,
      established,
      audience,
      aLearns,
      bLearns,
      ironyA: windowFor(aLearns),
      ironyB: windowFor(bLearns),
      arbA: arbFor(bLearns, aLearns),
      arbB: arbFor(aLearns, bLearns)
    })
  }
  return out
}
