/**
 * NVS Fountain dialect primitives — the ONE source for the cue grammar, shared by the block editor
 * (renderer · parseFountain/serializeFountain) and the T1 ingest parser (engine · parseDialog), so the
 * thing that WRITES scenes and the thing that READS them can never drift apart again.
 *
 * Canonical spec: nvs-parser/references/nvs-format.md. A character cue is an ALL-CAPS name on
 * its own line with an optional `(MODIFIER)`; the next non-blank line(s) are its dialogue. `> ` is action,
 * `= ` is a transition, and any other plain paragraph is narration.
 */

/** Parentheticals that mark a cue as private thought (monologue). Case-insensitive; matched on the `(…)`. */
export const THINKING_MODIFIERS = new Set(['THINKING', 'THINKS', 'THOUGHT', 'INTERNAL', 'MONOLOGUE'])

/**
 * Is this line a character cue? Returns the speaker + whether it's a thinking cue, else null.
 * A cue is ALL-CAPS letters/digits/space/`-'.` (no lowercase), ≥2 chars, with an optional `(MODIFIER)`.
 * Single-char lines and anything with a lowercase letter are rejected (so prose like "A man left" isn't a cue).
 */
export function parseCue(line: string): { speaker: string; modifier: string | null; thinking: boolean } | null {
  const m = line.trim().match(/^(\?{2,}|[A-Z][A-Z0-9\s\-'.]*?)(?:\s*\(([^)]+)\))?$/) // `???` = a mystery speaker
  if (!m) return null
  const speaker = m[1].trim()
  if (speaker.length < 2 || /[a-z]/.test(speaker)) return null
  const modifier = m[2]?.trim().toUpperCase() ?? null
  return { speaker, modifier, thinking: !!modifier && THINKING_MODIFIERS.has(modifier) }
}

/**
 * Would this speaker name survive a write→read round-trip as a cue (instead of silently degrading to
 * narration)? Mirrors parseCue on the UPPERCASED name the serializer emits, so the block editor's speaker
 * box can REFUSE a name the parser would later reject — no more "type a speaker, exit, it's now narration".
 * (`???` passes — a mystery speaker is a real cue.)
 */
export function isValidSpeaker(name: string): boolean {
  return parseCue(name.trim().toUpperCase()) !== null
}

/** `> action` line. */
export function isAction(line: string): boolean {
  const t = line.trimStart()
  return t === '>' || t.startsWith('> ')
}

/** `= transition` line. */
export function isTransition(line: string): boolean {
  const t = line.trimStart()
  return t === '=' || t.startsWith('= ')
}

// ── Timing tags — an OPTIONAL `[start → end]` (or start-only `[start]`) at the FRONT of a beat's first line, for
// subtitle / transcript / podcast work. Times are HH:MM:SS(.mmm) or MM:SS(.mmm). The separator accepts `-->` (SRT),
// `→`, `–`, or `-`; we write `→`. It prefixes ANY beat kind, so every line-classifier strips it FIRST, then reads
// the rest exactly as before (a timed cue must still parse as a cue, never as narration). Comma-ms is normalised to
// a dot. Timing is metadata: it never changes who-hears or the analysis — purely the when.
// LIBERAL READ, STRICT WRITE (same philosophy as mood). A RANGE with a separator may use bare integers as seconds
// (`[0 → 3]` = 0s→3s — intuitive to type); a START-ONLY tag must carry a colon (`[00:01:23]`) so a footnote-like
// `[12]` stays prose. Every accepted value is NORMALISED to canonical HH:MM:SS(.mmm) on read, so the file self-
// heals to the strict form the app writes.
const _TC_ANY = String.raw`\d{1,2}(?::\d{2}){0,2}(?:[.,]\d{1,3})?` // may be a bare integer (seconds)
const _TC_COLON = String.raw`\d{1,2}(?::\d{2}){1,2}(?:[.,]\d{1,3})?` // has ≥1 colon → unambiguously a timecode
const _SEP = String.raw`(?:-->|→|–|-)`
const TIMING_RE = new RegExp(String.raw`^\[\s*(?:(${_TC_ANY})\s*${_SEP}\s*(${_TC_ANY})|(${_TC_COLON}))\s*\]\s*`)

/** Normalise any accepted timecode to canonical HH:MM:SS(.mmm) — "3"→"00:00:03", "1:23"→"00:01:23", ","→".". */
function normTimecode(raw: string): string {
  const [main, ms] = raw.split(/[.,]/)
  const parts = main.split(':')
  while (parts.length < 3) parts.unshift('0')
  const hms = parts.slice(-3).map((p) => p.padStart(2, '0')).join(':')
  return ms ? `${hms}.${ms}` : hms
}

export interface BeatTiming {
  start: string // canonical HH:MM:SS(.mmm)
  end?: string // optional (start-only is legal — a transcript cue with no measured out-point)
}

/** Strip a leading timing tag off a beat's first line → the timing (if any) + the remaining text to classify. */
export function stripTiming(line: string): { timing: BeatTiming | null; rest: string } {
  const m = line.match(TIMING_RE)
  if (!m) return { timing: null, rest: line }
  const startRaw = m[1] ?? m[3] // group 1 = range start, group 3 = start-only
  const endRaw = m[2]
  return { timing: { start: normTimecode(startRaw), ...(endRaw ? { end: normTimecode(endRaw) } : {}) }, rest: line.slice(m[0].length) }
}

/** Render a timing tag for serialization (empty string when there's no start). */
export function formatTiming(t: BeatTiming | null | undefined): string {
  if (!t?.start) return ''
  return t.end ? `[${t.start} → ${t.end}] ` : `[${t.start}] `
}
