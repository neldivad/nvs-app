/**
 * i18n audit — scan the renderer for hardcoded user-facing strings NOT wrapped in t()/<Trans>, so the
 * localization sweep is a definitive checklist instead of whack-a-mole.
 *
 *   npm run i18n:audit            # every finding, grouped by file (worst first)
 *   npm run i18n:audit -- --count # just per-file counts
 *
 * Uses the TypeScript AST. It flags two things a user can read:
 *   1. JSX TEXT nodes with real words (the stuff between <tags>) — always hardcoded.
 *   2. String-LITERAL values of user-facing attributes: title / aria-label / placeholder / label / alt.
 * A `{t('…')}` expression is a JsxExpression, never a JsxText/StringLiteral, so translated strings don't flag.
 * Heuristic (will have a few false positives — code samples, symbols); treat it as a strong signal, not gospel.
 */
import ts from 'typescript'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'src/renderer'
const SKIP_DIRS = new Set(['node_modules', 'out', 'config', 'styles', 'assets'])
const ATTRS = new Set(['title', 'aria-label', 'placeholder', 'label', 'alt'])
// Real copy = has a 2+ letter word and isn't a url/path/token.
const isCopy = (s: string): boolean => {
  const t = s.trim()
  return /[A-Za-z]{2,}/.test(t) && !/^https?:\/\//.test(t) && !/^[a-z0-9_-]+\/[a-z0-9/_-]+$/.test(t)
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walkFiles(p, out)
    else if (e.endsWith('.tsx')) out.push(p)
  }
  return out
}

interface Finding { line: number; kind: string; text: string }

function auditFile(path: string): Finding[] {
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: Finding[] = []
  const lineOf = (pos: number): number => src.getLineAndCharacterOfPosition(pos).line + 1
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const t = node.text.trim()
      if (t && isCopy(t)) found.push({ line: lineOf(node.getStart(src)), kind: 'text', text: t.replace(/\s+/g, ' ').slice(0, 90) })
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(src)
      if (ATTRS.has(name) && isCopy(node.initializer.text)) {
        found.push({ line: lineOf(node.getStart(src)), kind: name, text: node.initializer.text.slice(0, 90) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return found
}

const perFile = walkFiles(ROOT)
  .map((f) => [relative(ROOT, f), auditFile(f)] as [string, Finding[]])
  .filter(([, f]) => f.length)
  .sort((a, b) => b[1].length - a[1].length)

const countOnly = process.argv.includes('--count')
let total = 0
for (const [file, fnd] of perFile) {
  total += fnd.length
  console.log(`\n${file}  (${fnd.length})`)
  if (!countOnly) for (const x of fnd) console.log(`  ${x.line}  [${x.kind}]  ${x.text}`)
}
console.log(`\n=== ${total} hardcoded strings across ${perFile.length} files ===`)
