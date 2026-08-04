/**
 * Evidence recovery — map a finding's OWN prose back to the anchors we offered the model.
 *
 * Why this exists: haiku reliably NAMES where a finding occurs in prose ("in vol-01…", "at Red Cliffs") but often
 * leaves the structured `evidence_unit_ids` empty. Findings are PLACED by that field, so an empty one collapses
 * onto the as-of checkpoint — every finding piling onto the last chapter (which is exactly what made "On this
 * scene" show late-novel holes on chapter 1). We control the anchors we render into each payload
 * (`[title · id] text`, both the coherence observed side and the continuity fact timeline), so when a finding
 * cites nothing we can recover the anchor from the model's own words.
 *
 * PURE (no fs, no Electron, no network) so both readers share one implementation and it stays unit-testable.
 */

/** One offered anchor: the id a finding may cite, its display title, and the content rendered under it. */
export interface EvidenceAnchor {
  id: string
  title: string
  text: string
}

/** Distinctive tokens — NFKC-folded, lowercased, short//noise words dropped. */
function toks(s: string): Set<string> {
  return new Set(
    s
      .normalize('NFKC')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3)
  )
}

/**
 * Recover the anchors a finding rests on from its prose, in two escalating steps:
 *   1. EXACT — the model echoed an anchor's id or title ("in vol-08…"). Precise when present.
 *   2. CONTENT OVERLAP — the model named WHERE differently ("at Red Cliffs", not "vol-08"). Score each anchor's
 *      content against the finding's prose by distinctive-token overlap; keep the best `max`.
 * Returns [] when nothing clears the bar — an empty result is honest, a wrong anchor is not.
 */
export function recoverEvidence(prose: string, anchors: EvidenceAnchor[], max = 2): string[] {
  if (!prose.trim() || !anchors.length) return []

  const exact = anchors.filter((a) => prose.includes(a.id) || (a.title.length >= 3 && prose.includes(a.title))).map((a) => a.id)
  if (exact.length) return [...new Set(exact)]

  const fTok = toks(prose)
  if (fTok.size === 0) return []
  const scored = anchors
    .map((a) => {
      const aTok = toks(a.text)
      let inter = 0
      for (const t of aTok) if (fTok.has(t)) inter++
      return { id: a.id, inter, score: aTok.size ? inter / aTok.size : 0 }
    })
    .filter((s) => s.inter >= 3) // need real shared content, not one incidental word
    .sort((x, y) => y.score - x.score)
  return [...new Set(scored.slice(0, max).map((s) => s.id))]
}
