/**
 * Document outline for a world page — the markdown heading tree that drives the Google-Docs-style TOC.
 *
 * Parsing MIRRORS the preview renderer (WikiBody): a heading is any trimmed line matching `#{1,6} text`,
 * no code-fence tracking (WikiBody has none either), so the parsed list is 1:1 and in-order with the
 * `h2,h3` elements the preview emits — that's what lets the outline jump by index. HTML comments are
 * masked to spaces (WikiPreview strips them) WITHOUT changing length, so `pos` (char offset) stays valid
 * for CodeMirror's scroll in write mode.
 */
export interface Heading {
  level: number // 1–6
  text: string
  line: number // 0-based line index
  pos: number // char offset of the line start — for EditorView.scrollIntoView in write mode
}

export function parseHeadings(md: string): Heading[] {
  const masked = md.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  const lines = masked.split('\n')
  const out: Heading[] = []
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+)$/.exec(lines[i].trim())
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i, pos })
    pos += lines[i].length + 1 // + the newline
  }
  return out
}
