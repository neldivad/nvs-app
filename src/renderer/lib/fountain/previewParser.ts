export type PreviewBlock =
  | { kind: 'speech'; speaker: string; text: string }
  | { kind: 'stage'; text: string }
  | { kind: 'system'; text: string }
  | { kind: 'prose'; text: string }
  | { kind: 'heading'; level: number; text: string }

function stripComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * Parse a scene body into typed display blocks.
 *
 * Patterns matched (in priority order):
 *   **Speaker Name:** text    → speech
 *   *stage direction*         → stage  (whole-line italic, not starting with **)
 *   [[system text]]           → system
 *   ## heading                → heading
 *   everything else           → prose  (blank lines flush the accumulator)
 */
export function parsePreview(body: string): PreviewBlock[] {
  const blocks: PreviewBlock[] = []
  let proseBuf: string[] = []

  function flushProse(): void {
    const text = proseBuf.join(' ').trim()
    if (text) blocks.push({ kind: 'prose', text })
    proseBuf = []
  }

  for (const raw of stripComments(body).split('\n')) {
    const line = raw.trim()

    if (!line) { flushProse(); continue }

    // Speech: **Speaker:** rest-of-line
    const speech = line.match(/^\*\*([^*:]+)\*\*:\s*(.+)$/)
    if (speech) {
      flushProse()
      blocks.push({ kind: 'speech', speaker: speech[1].trim(), text: speech[2].trim() })
      continue
    }

    // System text: [[…]]
    const system = line.match(/^\[\[(.+)\]\]$/)
    if (system) {
      flushProse()
      blocks.push({ kind: 'system', text: system[1].trim() })
      continue
    }

    // Heading: #+ text
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushProse()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }

    // Stage direction: *text* on its own line (not starting with **)
    if (line.startsWith('*') && !line.startsWith('**') && line.endsWith('*') && line.length > 2) {
      flushProse()
      blocks.push({ kind: 'stage', text: line.slice(1, -1).trim() })
      continue
    }

    proseBuf.push(line)
  }

  flushProse()
  return blocks
}

/** Unique speaker names in document order. */
export function extractSpeakers(blocks: PreviewBlock[]): string[] {
  const seen = new Set<string>()
  for (const b of blocks) if (b.kind === 'speech') seen.add(b.speaker)
  return [...seen]
}

/**
 * Deterministic color for a speaker name — a stable hash picks one of a CURATED, theme-aware cycle of
 * SPEAKER_SLOTS discrete hues (globals.css `--speaker-1..10`, reusing the facet/accent tokens so each adapts
 * to light/dark). Replaces the old 24-bucket HSL hash, whose fixed 65%/62% gave muddy, low-contrast hues and
 * still collided (mod 24). A given name always maps to the same slot; distinct names spread across the cycle.
 */
const SPEAKER_SLOTS = 10
export function speakerColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff
  return `var(--speaker-${(h % SPEAKER_SLOTS) + 1})`
}

/** Pull a frontmatter value as a display string; join arrays with ", ". */
export function fmStr(fm: Record<string, unknown>, key: string): string {
  const v = fm[key]
  if (v == null || v === '' || v === 'null') return ''
  if (Array.isArray(v)) return (v as unknown[]).map(String).filter(Boolean).join(', ')
  return String(v)
}

/** Read a nested frontmatter path, e.g. fmNested(fm, 'voice', 'style'). */
export function fmNested(fm: Record<string, unknown>, ...keys: string[]): string {
  let cur: unknown = fm
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return ''
    cur = (cur as Record<string, unknown>)[k]
  }
  if (cur == null || cur === '' || cur === 'null') return ''
  if (Array.isArray(cur)) return (cur as unknown[]).map(String).filter(Boolean).join(', ')
  return String(cur)
}
