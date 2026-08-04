/**
 * Fountain ↔ Block array serializer.
 *
 * parseFountain(text)     → Block[]   (load a .md scene body into the editor)
 * serializeFountain(blocks) → string  (write the editor state back to .md)
 *
 * Spec: nvs-parser/references/nvs-format.md
 */

import { THINKING_MODIFIERS, type BlockKind } from '@/config/writerBlocks'
import { stripTiming, formatTiming, type BeatTiming } from '@shared/config/fountain'

// ── Block types ───────────────────────────────────────────────────────────────

// `mood` = the cue's parenthetical direction on a SPEECH cue ("CAO CAO (angrily)" → "ANGRILY"). `start`/`end` =
// the optional timing tag (`[00:01:23 → 00:01:27]`), on ANY block kind. Both are carried through parse↔serialize so
// editing a scene in the block editor never STRIPS the mood/timing the author wrote in source (round-trip loss).
export interface SpeechBlock    { kind: 'speech';     speaker: string; text: string; mood?: string; start?: string; end?: string }
export interface ThinkingBlock  { kind: 'thinking';   speaker: string; text: string; start?: string; end?: string }
export interface NarrationBlock { kind: 'narration';  text: string; start?: string; end?: string }
export interface ActionBlock    { kind: 'action';     text: string; start?: string; end?: string }
export interface TransitionBlock{ kind: 'transition'; text: string; start?: string; end?: string }

export type Block =
  | SpeechBlock
  | ThinkingBlock
  | NarrationBlock
  | ActionBlock
  | TransitionBlock

// ── Fountain → blocks ─────────────────────────────────────────────────────────

/**
 * Detect whether a line is a Fountain character cue (ALL CAPS name, optional
 * parenthetical). Returns { speaker, kind } or null.
 *
 * A cue line must consist entirely of uppercase letters, digits, spaces,
 * hyphens, apostrophes, and periods — plus an optional `(MODIFIER)` suffix.
 * Any lowercase letter in the name part disqualifies the line.
 *
 * Edge case: single-letter lines (e.g. "I" or "A") are rejected — too
 * likely to be start-of-sentence prose.
 */
function parseCueLine(
  line: string
): { speaker: string; kind: 'speech' | 'thinking'; modifier: string | null } | null {
  const m = line.trim().match(/^(\?{2,}|[A-Z][A-Z0-9\s\-'.]*)(?:\s*\(([^)]+)\))?$/) // `???` = a mystery speaker
  if (!m) return null
  const name = m[1].trim()
  // Reject single chars and names containing lowercase (catches sentences like "A man walked in")
  if (name.length < 2 || /[a-z]/.test(name)) return null
  const modifier = m[2]?.trim().toUpperCase() ?? null
  const kind: 'speech' | 'thinking' = modifier && THINKING_MODIFIERS.has(modifier)
    ? 'thinking'
    : 'speech'
  return { speaker: name, kind, modifier }
}

/**
 * Parse a scene body string into a typed block array.
 *
 * State machine:
 *   normal     → reading prose / looking for cues
 *   after-cue  → next non-blank line(s) are dialogue for the pending cue
 */
export function parseFountain(body: string): Block[] {
  const blocks: Block[] = []
  const lines = body.split('\n')

  type CuePending = { speaker: string; kind: 'speech' | 'thinking'; mood?: string; timing?: BeatTiming | null }
  let pending: CuePending | null = null
  let dialogueBuf: string[] = []
  const tcAttrs = (t: BeatTiming | null | undefined): { start?: string; end?: string } =>
    t?.start ? { start: t.start, ...(t.end ? { end: t.end } : {}) } : {}

  function flushDialogue(): void {
    if (!pending) return
    const text = dialogueBuf.join('\n').trim()
    if (text) {
      const tc = tcAttrs(pending.timing)
      blocks.push(
        pending.kind === 'thinking'
          ? { kind: 'thinking', speaker: pending.speaker, ...tc, text }
          : { kind: 'speech',   speaker: pending.speaker, text, ...(pending.mood ? { mood: pending.mood } : {}), ...tc }
      )
    }
    // If text is empty the cue was orphaned — drop it silently
    // (the linter catches it separately with a warning)
    pending = null
    dialogueBuf = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    // Blank line: flush any accumulated dialogue
    if (!line.trim()) {
      flushDialogue()
      continue
    }

    // Inside a dialogue block — accumulate lines
    if (pending) {
      dialogueBuf.push(line.trim())
      continue
    }

    // A leading timing tag (`[00:01:23 → 00:01:27]`) prefixes any beat — strip it, classify the rest, carry it onto
    // the resulting block so it round-trips.
    const { timing, rest } = stripTiming(line.trim())
    const tc = tcAttrs(timing)

    // Action: > text
    if (rest.startsWith('> ') || rest === '>') {
      blocks.push({ kind: 'action', ...tc, text: rest.replace(/^[\s]*>[\s]*/, '').trim() })
      continue
    }

    // Transition: = text
    if (rest.startsWith('= ') || rest === '=') {
      blocks.push({ kind: 'transition', ...tc, text: rest.replace(/^[\s]*=[\s]*/, '').trim() })
      continue
    }

    // @name shorthand — speaker select; resolve to uppercase
    const atName = rest.match(/^@([\w\s'-]+)$/)
    if (atName) {
      pending = { speaker: atName[1].trim().toUpperCase(), kind: 'speech', timing }
      continue
    }

    // ALL CAPS character cue — a non-thinking parenthetical is the speech MOOD (thinking's IS the marker)
    const cue = parseCueLine(rest)
    if (cue) {
      pending = { speaker: cue.speaker, kind: cue.kind, mood: cue.kind === 'speech' ? (cue.modifier ?? undefined) : undefined, timing }
      continue
    }

    // Plain text → narration
    blocks.push({ kind: 'narration', ...tc, text: rest })
  }

  // End-of-file: flush any open dialogue
  flushDialogue()

  return blocks
}

// ── Blocks → Fountain ─────────────────────────────────────────────────────────

function serializeBlock(block: Block): string {
  const tc = formatTiming(block.start ? { start: block.start, end: block.end } : null) // leading `[start → end] ` when timed
  switch (block.kind) {
    case 'speech':
      return `${tc}${block.speaker.toUpperCase()}${block.mood ? ` (${block.mood})` : ''}\n${block.text}`
    case 'thinking':
      return `${tc}${block.speaker.toUpperCase()} (THINKING)\n${block.text}`
    case 'narration':
      return `${tc}${block.text}`
    case 'action':
      return `${tc}> ${block.text}`
    case 'transition':
      return `${tc}= ${block.text}`
  }
}

/**
 * Serialize a block array back to a Fountain scene body string.
 * Blocks are separated by blank lines.
 */
export function serializeFountain(blocks: Block[]): string {
  return blocks.map(serializeBlock).join('\n\n')
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/** True if the block carries a speaker field. */
export function hasSpeaker(block: Block): block is SpeechBlock | ThinkingBlock {
  return block.kind === 'speech' || block.kind === 'thinking'
}

/** All unique speaker names in document order. */
export function extractSpeakers(blocks: Block[]): string[] {
  const seen = new Set<string>()
  for (const b of blocks) if (hasSpeaker(b)) seen.add(b.speaker)
  return [...seen]
}

/** Re-export the kind union for consumers that only import this module. */
export type { BlockKind }
