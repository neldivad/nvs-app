/**
 * structuredFormat — the STRUCTURED interchange between NVS and nvs-parser (its `serialize`). A precise,
 * machine-readable dump of a project's prose: scenes → beats (who says what, in which of the 5 NVS modes,
 * with an optional cue MOOD) + characters. Import reads this shape; export writes it. Kept in lockstep with
 * nvs-parser's `serialize.py` (JSON: meta · scenes[].beats · characters; CSV: the flat beats table) so the
 * two round-trip.
 *
 * PURE (no Node) — beat parsing/rendering uses the shared `fountain.ts` cue grammar, so this can't drift from
 * how the engine reads scenes or the block editor writes them.
 */
import { parseCue, isAction, isTransition, stripTiming, formatTiming } from './config/fountain'

/** The five NVS beat modes (matches nvs-parser's `kind`). */
export type BeatKind = 'speech' | 'thinking' | 'narration' | 'action' | 'transition'

export interface StructuredBeat {
  i: number // 0-based index within the scene (reading order)
  speaker: string // the cue for speech/thinking; '' for narration/action/transition
  kind: BeatKind
  mood?: string // the cue's parenthetical direction — `CAO CAO (angrily)` → "ANGRILY". Omitted when none.
  start?: string // timing tag in-point (HH:MM:SS.mmm) — `[00:01:23 → 00:01:27]`. Omitted when untimed.
  end?: string // timing tag out-point; omitted for start-only or untimed beats.
  text: string
}
export interface StructuredScene {
  scene_id: string
  title: string
  chapter: string
  characters_present: string[]
  beats: StructuredBeat[]
}
export interface StructuredCharacter {
  id: string
  name: string
  aliases: string[]
}
export interface StructuredProject {
  meta: { scenes: number; beats: number; characters: number }
  scenes: StructuredScene[]
  characters: StructuredCharacter[]
}

/**
 * Parse a scene BODY (NVS Fountain) into beats — a faithful port of nvs-parser's `parse_dialogue`:
 * split on blank lines; a speaker cue → speech (or thinking on a THINKING modifier), carrying any non-thinking
 * parenthetical as `mood`; `> ` → action, `= ` → transition (both empty-speaker); else → narration. `---` skipped.
 */
export function parseBeats(body: string): StructuredBeat[] {
  const beats: StructuredBeat[] = []
  const paras = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  for (const para of paras) {
    if (para === '---') continue
    const lines = para.split('\n')
    // A timing tag prefixes the beat's first line — strip it FIRST, then classify the remainder as usual.
    const { timing, rest } = stripTiming(lines[0].trim())
    lines[0] = rest
    const t = timing ? { start: timing.start, ...(timing.end ? { end: timing.end } : {}) } : {}
    const first = rest
    const cue = parseCue(first)
    if (cue) {
      const text = lines.slice(1).map((l) => l.trim()).filter(Boolean).join(' ')
      const mood = !cue.thinking && cue.modifier ? cue.modifier : undefined // the parenthetical is a mood unless it's the THINKING marker
      beats.push({ i: beats.length, speaker: cue.speaker, kind: cue.thinking ? 'thinking' : 'speech', ...(mood ? { mood } : {}), ...t, text })
    } else if (isAction(first)) {
      beats.push({ i: beats.length, speaker: '', kind: 'action', ...t, text: lines.map((l) => l.trim().replace(/^[>\s]+/, '')).filter(Boolean).join(' ') })
    } else if (isTransition(first)) {
      beats.push({ i: beats.length, speaker: '', kind: 'transition', ...t, text: first.trim().replace(/^[=\s]+/, '') })
    } else {
      beats.push({ i: beats.length, speaker: '', kind: 'narration', ...t, text: lines.map((l) => l.trim()).filter(Boolean).join(' ') })
    }
  }
  return beats
}

/** Render beats back to a Fountain scene body (the inverse of parseBeats — for IMPORT). */
export function renderBeats(beats: StructuredBeat[]): string {
  const blocks = beats.map((b) => {
    const tc = formatTiming(b.start ? { start: b.start, end: b.end } : null) // leading `[start → end] ` when timed
    switch (b.kind) {
      case 'speech':
        return `${tc}${b.speaker}${b.mood ? ` (${b.mood})` : ''}\n${b.text}`
      case 'thinking':
        return `${tc}${b.speaker} (THINKING)\n${b.text}`
      case 'action':
        return `${tc}> ${b.text}`
      case 'transition':
        return `${tc}= ${b.text}`
      default:
        return `${tc}${b.text}` // narration
    }
  })
  return blocks.join('\n\n') + '\n'
}

/** JSON — the nested shape (matches nvs-parser `project_to_json`, pretty-printed). */
export function toJson(p: StructuredProject): string {
  return JSON.stringify(p, null, 2)
}

const CSV_COLUMNS = ['scene_id', 'chapter', 'beat', 'speaker', 'kind', 'mood', 'start', 'end', 'text'] as const

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Canonical HH:MM:SS(.mmm) → SRT's HH:MM:SS,mmm (comma milliseconds, always 3 digits). */
function tcToSrt(tc: string): string {
  const [main, ms = ''] = tc.split(/[.,]/)
  const parts = main.split(':')
  while (parts.length < 3) parts.unshift('0')
  return `${parts.slice(-3).map((p) => p.padStart(2, '0')).join(':')},${ms.padEnd(3, '0').slice(0, 3)}`
}

/**
 * SRT (SubRip) — one cue per TIMED beat (a beat carrying a `start`), for subtitle export. The inverse of the SRT
 * import (nvs-parser sources/srt): a speech beat becomes `SPEAKER: text`, others just their text. A beat missing
 * an `end` borrows the next timed beat's start (else its own start) so every cue is well-formed. Untimed beats are
 * skipped — SRT is only meaningful where there IS timing. Numbered continuously across all scenes.
 */
export function toSrt(p: StructuredProject): string {
  const cues: string[] = []
  let n = 1
  for (const sc of p.scenes) {
    const timed = sc.beats.filter((b) => b.start)
    for (let i = 0; i < timed.length; i++) {
      const b = timed[i]
      const end = b.end || timed[i + 1]?.start || b.start!
      const text = b.speaker ? `${b.speaker}: ${b.text}` : b.text
      cues.push(`${n++}\n${tcToSrt(b.start!)} --> ${tcToSrt(end)}\n${text}`)
    }
  }
  return cues.join('\n\n') + '\n'
}

/** CSV — the flat beats table (matches nvs-parser `project_to_csv`): one row per beat. */
export function toCsv(p: StructuredProject): string {
  const rows: string[] = [CSV_COLUMNS.join(',')]
  for (const sc of p.scenes) {
    for (const b of sc.beats) {
      rows.push([sc.scene_id, sc.chapter, String(b.i), b.speaker, b.kind, b.mood ?? '', b.start ?? '', b.end ?? '', b.text].map(csvCell).join(','))
    }
  }
  return rows.join('\n') + '\n'
}
