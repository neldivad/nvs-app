/**
 * WriterBlocks registry — every block type in the NVS Fountain dialect.
 *
 * Single source of truth for what the block editor can produce. To add a
 * new block type: add an entry here, then handle it in blockSerializer.ts,
 * lintFountain.ts, and BlockEditor.tsx.
 *
 * See nvs-parser/references/nvs-format.md for the canonical spec.
 */

export type BlockKind = 'speech' | 'thinking' | 'narration' | 'action' | 'transition'

/**
 * How the block is stored in the Fountain file:
 *   caps-cue     — ALL CAPS NAME\ntext
 *   caps-cue-mod — ALL CAPS NAME (MODIFIER)\ntext
 *   plain        — bare paragraph
 *   gt-prefix    — > text
 *   eq-prefix    — = text
 */
export type FountainMarker = 'caps-cue' | 'caps-cue-mod' | 'plain' | 'gt-prefix' | 'eq-prefix'

export interface BlockSpec {
  kind: BlockKind
  /** Lucide icon component name shown in the slash-command palette. */
  icon: string
  label: string
  description: string
  /** The one canonical slash command for this block type. */
  slashCommand: string
  /** Whether this block requires a character to be selected. */
  hasSpeaker: boolean
  /**
   * Whether @name shorthand can open this block type.
   * @hamlet → HAMLET speech cue; @hamlet /thinking → HAMLET (THINKING) cue.
   */
  speakerShorthand: boolean
  /** How this block is written in the Fountain file. */
  fountainMarker: FountainMarker
  /**
   * For caps-cue-mod: the parenthetical written after the name.
   * e.g. "THINKING" → stored as "CHARACTER (THINKING)".
   */
  cueModifier: string | null
}

export const WRITER_BLOCKS: BlockSpec[] = [
  {
    kind: 'speech',
    icon: 'MessageCircle',
    label: 'Speaker',
    description: 'Spoken aloud — heard by everyone in the scene.',
    slashCommand: '/speaker',
    hasSpeaker: true,
    speakerShorthand: true,
    fountainMarker: 'caps-cue',
    cueModifier: null
  },
  {
    kind: 'thinking',
    icon: 'Brain',
    label: 'Thinking',
    description: 'Private thought — heard by no one in the story.',
    slashCommand: '/thinking',
    hasSpeaker: true,
    speakerShorthand: true,
    fountainMarker: 'caps-cue-mod',
    cueModifier: 'THINKING'
  },
  {
    kind: 'narration',
    icon: 'AlignLeft',
    label: 'Narration',
    description: 'Narrator voice — reader-only, no in-world speaker.',
    slashCommand: '/narration',
    hasSpeaker: false,
    speakerShorthand: false,
    fountainMarker: 'plain',
    cueModifier: null
  },
  {
    kind: 'action',
    icon: 'Clapperboard',
    label: 'Action',
    description: 'Physical beat or stage direction — no speaker.',
    slashCommand: '/action',
    hasSpeaker: false,
    speakerShorthand: false,
    fountainMarker: 'gt-prefix',
    cueModifier: null
  },
  {
    kind: 'transition',
    icon: 'Clock',
    label: 'Cut',
    description: 'Time skip, scene break, or separator.',
    slashCommand: '/cut',
    hasSpeaker: false,
    speakerShorthand: false,
    fountainMarker: 'eq-prefix',
    cueModifier: null
  }
]

// ── Lookup helpers ─────────────────────────────────────────────────────────────

/** Look up a block spec by kind. Throws on unknown kind. */
export function blockSpec(kind: BlockKind): BlockSpec {
  const s = WRITER_BLOCKS.find((b) => b.kind === kind)
  if (!s) throw new Error(`Unknown block kind: "${kind}"`)
  return s
}

/** Find a block spec by slash command string (e.g. "/thinking"). */
export function blockSpecByCommand(cmd: string): BlockSpec | undefined {
  return WRITER_BLOCKS.find((b) => b.slashCommand === cmd.toLowerCase())
}

// ── Fountain parsing constants ─────────────────────────────────────────────────

/**
 * Parentheticals that convert a character cue to "thinking" kind.
 * Matched case-insensitively against the text inside `(…)`.
 */
// Single source for the dialect (shared with the T1 ingest parser) — re-exported for existing importers.
export { THINKING_MODIFIERS } from '@shared/config/fountain'

/**
 * Curated MOOD suggestions for a SPEECH cue's parenthetical ("CAO CAO (angry)" → mood "ANGRY"). Simple EMOTION
 * NOUNS, like a visual-novel sprite/expression tag — a speaker's state, not a manner-adverb. UI-only: the picker
 * offers these but the input accepts any free-form tag, and '' = neutral (no parenthetical / default sprite).
 * Kept in config, not inlined in the editor, so the vocabulary is edited in one place.
 */
export const MOOD_PRESETS: readonly string[] = [
  'happy', 'sad', 'angry', 'surprised', 'worried', 'smug', 'serious', 'shy', 'excited', 'scared'
]
