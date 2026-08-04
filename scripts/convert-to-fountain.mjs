/**
 * One-time migration: convert old `**Name:** text` scene bodies to the NVS Fountain dialect
 * (scene-format.md) — ALL-CAPS cue on its own line, dialogue on the next, blocks blank-separated.
 *
 *   node scripts/convert-to-fountain.mjs <dir> [<dir> …]
 *
 * Walks <dir>/content/story/**\/*.md. A file is converted only if its body still contains `**Name:**`
 * lines (already-Fountain scenes are left untouched). Frontmatter is preserved verbatim. Idempotent.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NAME_RE = /^\*\*(.+?):\*\*\s*(.*)$/
const THINK_RE = /^(.*?)\s*\((?:thinking|thinks|thought|internal|monologue)\)\s*$/i
const NARR_RE = /^\[\[\s*(.+?)\s*\]\]$/
const FM_RE = /^(---\s*\n[\s\S]*?\n---\s*\n)([\s\S]*)$/

function toCue(name) {
  const t = THINK_RE.exec(name.trim())
  return t ? `${t[1].trim().toUpperCase()} (THINKING)` : name.trim().toUpperCase()
}

/** Convert one old-format body to Fountain. Returns the new body, or null if nothing to convert. */
function convertBody(body) {
  if (!/^\*\*.+?:\*\*/m.test(body)) return null // already Fountain (or no dialogue) → leave it
  const blocks = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^---+$/.test(line)) continue // stray markdown HR section break → drop (blank-sep handles it)
    if (/^#{1,6}\s/.test(line)) continue // markdown heading (## Beat / ## Scene scaffolding) → not Fountain
    const m = NAME_RE.exec(line)
    if (m) {
      blocks.push(`${toCue(m[1])}\n${m[2].trim()}`)
      continue
    }
    const n = NARR_RE.exec(line)
    if (n) {
      blocks.push(n[1].trim())
      continue
    }
    blocks.push(line) // `>` action, `=` transition, or plain narration — keep as-is
  }
  return blocks.join('\n\n') + '\n'
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.md') && !/^readme/i.test(name)) out.push(p)
  }
  return out
}

let converted = 0
let skipped = 0
for (const root of process.argv.slice(2)) {
  const storyDir = join(root, 'content', 'story')
  let files
  try {
    files = walk(storyDir)
  } catch {
    console.error(`skip (no story dir): ${root}`)
    continue
  }
  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const fm = FM_RE.exec(raw)
    const [head, body] = fm ? [fm[1], fm[2]] : ['', raw]
    const next = convertBody(body)
    if (next == null) {
      skipped++
      continue
    }
    writeFileSync(file, head + next, 'utf8')
    converted++
    console.log(`converted: ${file.replace(root, '').replace(/^\//, '')}`)
  }
}
console.log(`\n✓ ${converted} converted, ${skipped} already Fountain.`)
