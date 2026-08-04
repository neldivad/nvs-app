/**
 * Headless render-check — run the SAME pure display parser the app uses (`parsePreview`) over a project's
 * source files, so an AI (or CI) can judge whether the source/parser output renders CLEANLY, without the GUI.
 *
 * Emits JSON per source file: how each page parses into typed blocks (speech · prose · stage · system ·
 * heading) + speakers + a few triage flags. A malformed source shows up structurally — e.g. a dialogue-heavy
 * novel that parses to ALL `prose` (speaker tags lost), a page with no headings, or empty bodies.
 *
 * Pure + dependency-light: `parsePreview` has zero imports, so this needs no Electron, no DB, no display.
 *
 *   npm run render:check -- /path/to/parser/output      # a project, or a dir of projects
 *   npm run render:check                                  # default: nvs-parser/tests/output
 *   npm run render:check -- <path> --full                 # include every block, not just a sample
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import matter from 'gray-matter'
import { parsePreview, extractSpeakers, type PreviewBlock } from '../src/renderer/lib/fountain/previewParser'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const FULL = process.argv.includes('--full')
const ROOT = args[0] ?? '/home/david/Desktop/programming/nelapps/nvs-parser/tests/output'
const SAMPLE = 12 // blocks shown per file unless --full

/** Every .md under a project's content/ (story = scenes, world = pages), skipping readmes/templates. */
function sourceFiles(projectRoot: string): { file: string; kind: 'scene' | 'world' }[] {
  const out: { file: string; kind: 'scene' | 'world' }[] = []
  const walk = (dir: string, kind: 'scene' | 'world'): void => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, kind)
      else if (name.endsWith('.md') && !/^readme/i.test(name)) out.push({ file: p, kind })
    }
  }
  walk(join(projectRoot, 'content', 'story'), 'scene')
  walk(join(projectRoot, 'content', 'world'), 'world')
  return out
}

/** Structural red-flags — cheap pre-screen; the AI still makes the call from the blocks. */
function flags(kind: 'scene' | 'world', blocks: PreviewBlock[], counts: Record<string, number>): string[] {
  const f: string[] = []
  const total = blocks.length
  if (total === 0) return ['EMPTY']
  const dominant = Math.max(...Object.values(counts))
  if (dominant / total > 0.95 && total > 3) f.push('MONOTONE') // ~one block kind → likely mis-parsed
  if (kind === 'scene' && (counts.speech ?? 0) === 0 && total > 3) f.push('NO-DIALOGUE') // speaker tags lost?
  if (kind === 'world' && (counts.heading ?? 0) === 0 && total > 2) f.push('NO-HEADINGS') // unstructured page
  return f
}

function projectDirs(root: string): string[] {
  if (!existsSync(root)) return []
  if (existsSync(join(root, 'content'))) return [root]
  return readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => {
      try {
        return statSync(p).isDirectory() && existsSync(join(p, 'content'))
      } catch {
        return false
      }
    })
    .sort()
}

const projects = projectDirs(ROOT)
if (!projects.length) {
  console.error(`No projects (folders with content/) under: ${ROOT}`)
  process.exit(2)
}

const report: unknown[] = []
let flagged = 0

for (const proj of projects) {
  for (const { file, kind } of sourceFiles(proj)) {
    let blocks: PreviewBlock[]
    try {
      blocks = parsePreview(matter(readFileSync(file, 'utf8')).content)
    } catch (e) {
      report.push({ file: relative(ROOT, file), kind, error: e instanceof Error ? e.message : String(e) })
      flagged++
      continue
    }
    const counts: Record<string, number> = {}
    for (const b of blocks) counts[b.kind] = (counts[b.kind] ?? 0) + 1
    const fl = flags(kind, blocks, counts)
    if (fl.length) flagged++
    report.push({
      file: relative(ROOT, file),
      kind,
      blocks: counts,
      speakers: extractSpeakers(blocks),
      flags: fl,
      sample: (FULL ? blocks : blocks.slice(0, SAMPLE)).map((b) =>
        b.kind === 'speech' ? { kind: b.kind, speaker: b.speaker, text: b.text.slice(0, 120) } : { kind: b.kind, text: (b as { text: string }).text.slice(0, 120) }
      ),
      ...(!FULL && blocks.length > SAMPLE ? { sampleTruncated: blocks.length - SAMPLE } : {})
    })
  }
}

// JSON to stdout (for the AI / a pipe); a one-line human summary to stderr.
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
console.error(`\nrender-check: ${report.length} source file(s), ${flagged} flagged. Read the JSON per file; flags pre-screen (EMPTY · MONOTONE · NO-DIALOGUE · NO-HEADINGS).`)
process.exit(0)
