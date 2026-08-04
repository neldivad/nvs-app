/**
 * Deterministic scene-format check — the ORACLE behind the "Check current format" maintenance action and the
 * `checkPageFormat` agent tool. NOT an LLM opinion: it flags the residue of a lookalike reformat or pasted
 * foreign content (a transcript, a screenplay, a chat export) that DIDN'T get converted to the NVS Fountain
 * conventions. Its whole reason to exist is that the plain parser can't catch this — e.g. `CHARLES: hi` is
 * VALID narration, so a parse says "clean", yet it's obviously a mis-formatted speaker line. So this leans on
 * a few conservative HEURISTICS for the common mis-formats, phrased as actionable per-line fixes the agent (or
 * author) can act on after a Reformat. Pure + node-runnable (main process MCP + renderer both import it).
 */
import { parseCue, isAction, isTransition, stripTiming } from './fountain'

export interface FormatIssue {
  line: number // 1-based, body-relative
  kind: 'colon-cue' | 'md-heading' | 'md-rule' | 'md-bullet' | 'wiki-link' | 'orphan-cue'
  msg: string // actionable: what's wrong + how to fix
}

// A leading Name-ish token + `:` + inline text — the transcript / `**Name:**` / `NAME:` dialogue notation that a
// lookalike reformat leaves behind. Uppercase-initial name (so "she said:" prose doesn't trip), ≤30 chars, then
// an optional `**` (the markdown-bold close) before the colon.
const SPEAKER_COLON = /^\*{0,2}\s*(\p{Lu}[\p{L}\p{N} '’.\-]{0,29}?)\s*\*{0,2}\s*:\s*\*{0,2}\s*\S/u
// Colon-prefixes that are ordinary prose labels, not speakers — don't flag these.
const COLON_STOPWORDS = new Set(['NOTE', 'WARNING', 'CAUTION', 'HINT', 'TIP', 'EXAMPLE', 'NB', 'PS', 'TODO', 'FIXME', 'AKA', 'RE'])

/** All deterministic format issues in a scene body, in document order. Empty = the page conforms. */
export function checkSceneFormat(body: string): FormatIssue[] {
  const issues: FormatIssue[] = []
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  let pendingCue: { name: string; line: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const lineNo = i + 1

    if (!line) {
      if (pendingCue) { issues.push({ line: pendingCue.line, kind: 'orphan-cue', msg: `Speaker cue "${pendingCue.name}" has no dialogue below it — add their line, or remove the cue.` }); pendingCue = null }
      continue
    }
    if (pendingCue) { pendingCue = null; continue } // this line is the cue's dialogue — fine

    const rest = stripTiming(line).rest
    if (!rest) continue

    // Valid Fountain constructs — nothing to flag.
    if (isAction(rest) || isTransition(rest)) continue
    if (/^#{2,3}\s/.test(rest)) continue // `## Section` / `### Sub` heading
    const cue = parseCue(rest)
    if (cue) { pendingCue = { name: cue.speaker, line: lineNo }; continue }

    // ── Mis-formats (residue of foreign content / a lookalike reformat) ──
    const colon = rest.match(SPEAKER_COLON)
    if (colon) {
      const name = colon[1].trim()
      // Guard against narration with a mid-line colon ("A quiet street. Note: …"): a real cue name is short (≤3
      // words), isn't a prose label (stopword), and carries no sentence break (`. `).
      if (!COLON_STOPWORDS.has(name.toUpperCase()) && name.split(/\s+/).length <= 3 && !/\.\s/.test(name)) {
        issues.push({ line: lineNo, kind: 'colon-cue', msg: `"${name}:" is dialogue in Name-colon notation — make "${name.toUpperCase()}" a cue ALONE on its own line with the words on the line below (drop the colon and any **).` })
        continue
      }
    }
    if (/^#(?!#)\s/.test(rest) || /^#{4,}\s/.test(rest)) { issues.push({ line: lineNo, kind: 'md-heading', msg: `Markdown heading — scene sections use "## Section" (two hashes).` }); continue }
    if (/^-{3,}\s*$/.test(rest)) { issues.push({ line: lineNo, kind: 'md-rule', msg: `"---" rule — use "= transition" (e.g. "= Two weeks earlier") for a scene/time break.` }); continue }
    if (/\[\[.+?\]\]/.test(rest)) { issues.push({ line: lineNo, kind: 'wiki-link', msg: `[[wiki]] link — not a scene construct; write the name in prose.` }); continue }
    if (/^[-*+]\s+\S/.test(rest)) { issues.push({ line: lineNo, kind: 'md-bullet', msg: `Markdown bullet — a scene is prose/dialogue, not a list.` }); continue }
    // else: plain narration — fine.
  }
  if (pendingCue) issues.push({ line: pendingCue.line, kind: 'orphan-cue', msg: `Speaker cue "${pendingCue.name}" has no dialogue (end of page).` })
  return issues
}
