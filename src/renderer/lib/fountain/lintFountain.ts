/**
 * Fountain dialect linter for NVS scene bodies.
 *
 * Replaces sceneLint.ts — same LintIssue shape, updated for Fountain syntax.
 * Rules: nvs-parser/references/nvs-format.md § Linter rules
 */

import { stripTiming } from '@shared/config/fountain'

export interface LintIssue {
  level: 'warn' | 'info'
  message: string
}

/** Canonical HH:MM:SS(.mmm) → seconds (float), for timing-order checks. */
function tcSeconds(tc: string): number {
  const [main, ms] = tc.split(/[.,]/)
  const p = main.split(':').map((n) => parseInt(n, 10) || 0)
  while (p.length < 3) p.unshift(0)
  const [h, m, s] = p.slice(-3)
  return h * 3600 + m * 60 + s + (ms ? parseInt(ms.padEnd(3, '0').slice(0, 3), 10) / 1000 : 0)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const CAPS_CUE_RE = /^(\?{2,}|[A-Z][A-Z0-9\s\-'.]{1,})(?:\s*\(([^)]*)\))?$/ // `???` = a mystery speaker

function isCueLine(line: string): { name: string; modifier: string | null } | null {
  const m = line.trim().match(CAPS_CUE_RE)
  if (!m) return null
  const name = m[1].trim()
  if (name.length < 2 || /[a-z]/.test(name)) return null
  return { name, modifier: m[2]?.trim().toUpperCase() ?? null }
}

// ── Main linter ───────────────────────────────────────────────────────────────

export function lintFountain(
  frontmatter: Record<string, unknown>,
  body: string,
  lineOffset = 0 // added to every reported line no. so "Line N" matches the FILE (Source view), not the body alone
): LintIssue[] {
  const issues: LintIssue[] = []

  // ── Frontmatter checks ──────────────────────────────────────────────────────
  if (!String(frontmatter.title ?? '').trim()) {
    issues.push({ level: 'warn', message: 'Scene has no title' })
  }

  const present = Array.isArray(frontmatter.characters_present)
    ? (frontmatter.characters_present as unknown[]).map(String)
    : []

  // ── Line-by-line body scan ──────────────────────────────────────────────────
  const lines = body.split('\n')
  const speakersFound = new Set<string>()
  let pendingCue: { name: string; lineNo: number } | null = null
  let prevStart: number | null = null // last beat's start seconds — for the monotonic-order check

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    let line = raw.trim()
    const lineNo = i + 1 + lineOffset

    // Blank line: if we had a pending cue, it was orphaned
    if (!line) {
      if (pendingCue) {
        issues.push({
          level: 'warn',
          message: `Line ${pendingCue.lineNo}: orphan cue "${pendingCue.name}" has no dialogue`
        })
        pendingCue = null
      }
      continue
    }

    // If we're accumulating dialogue for a cue, this line is dialogue
    if (pendingCue) {
      pendingCue = null
      continue
    }

    // A beat may carry a leading timing tag ([start → end]) — strip it (so the cue below is recognised), and lint
    // its ORDER: end must not precede start, and beats should run forward (a start earlier than a prior beat's).
    const { timing, rest } = stripTiming(line)
    if (timing) {
      const s = tcSeconds(timing.start)
      const e = timing.end ? tcSeconds(timing.end) : null
      if (e !== null && e < s) {
        issues.push({ level: 'warn', message: `Line ${lineNo}: timing end (${timing.end}) is before start (${timing.start})` })
      }
      if (prevStart !== null && s < prevStart) {
        issues.push({ level: 'warn', message: `Line ${lineNo}: timing start (${timing.start}) runs backwards — earlier than a preceding beat` })
      }
      prevStart = s
      line = rest // classify the beat on the text after the timing tag
      if (!line) continue // a timing-only line has nothing more to classify
    }

    // Transition: = text  (OK)
    if (line.startsWith('= ') || line === '=') continue

    // Action: > text  (OK)
    if (line.startsWith('> ') || line === '>') continue

    // Auto-convert: triple-dash → transition
    if (line === '---') {
      issues.push({
        level: 'info',
        message: `Line ${lineNo}: "---" auto-converted to transition block`
      })
      continue
    }

    // @name shorthand → speaker (info auto-convert)
    if (/^@[\w\s'-]+$/.test(line)) {
      const name = line.slice(1).trim().toUpperCase()
      issues.push({
        level: 'info',
        message: `Line ${lineNo}: "@${line.slice(1).trim()}" auto-converted to speaker cue "${name}"`
      })
      speakersFound.add(name)
      pendingCue = { name, lineNo }
      continue
    }

    // Unsupported: LaTeX — a backslash command with a brace (`\frac{`, `\text{`). NOT a lone `$`: that flags every
    // dollar amount ("$30 billion") as math, which is the common false positive. Inline `$…$` is left alone.
    if (/\\[a-zA-Z]+\{/.test(line)) {
      issues.push({ level: 'warn', message: `Line ${lineNo}: LaTeX notation will be stripped` })
      continue
    }

    // Unsupported: raw HTML
    if (/<[a-zA-Z][^>]*>/.test(line)) {
      issues.push({ level: 'warn', message: `Line ${lineNo}: HTML markup will be stripped` })
      continue
    }

    // Unsupported: dual dialogue ^CHARACTER^
    if (/\^[A-Z]+\^/.test(line)) {
      issues.push({
        level: 'warn',
        message: `Line ${lineNo}: dual-dialogue caret syntax stripped — use sequential lines`
      })
      continue
    }

    // Unsupported: Fountain lyrics ~ text
    if (/^~\s/.test(line)) {
      issues.push({ level: 'warn', message: `Line ${lineNo}: Fountain lyric "~" will be stripped` })
      continue
    }

    // Unsupported: Fountain page break ===
    if (/^={3,}$/.test(line)) {
      issues.push({ level: 'warn', message: `Line ${lineNo}: Fountain page break "===" will be stripped` })
      continue
    }

    // Malformed parenthetical (unbalanced open paren)
    if (/\([^)]*$/.test(line)) {
      issues.push({ level: 'warn', message: `Line ${lineNo}: unclosed parenthetical` })
    }

    // ALL CAPS character cue
    const cue = isCueLine(line)
    if (cue) {
      speakersFound.add(cue.name)

      // A non-THINKING parenthetical is a MOOD (a speech cue's emotion tag, free-form — see MOOD_PRESETS),
      // now a first-class feature. So there's nothing to flag: `(ANGRY)` is intentional, not an anomaly.
      // (Was: "unknown modifier kept as speech metadata" — obsolete once mood became a real field.)

      // Speakers are presence by definition — cues are the source of truth, so no warning
      // here. (Silent/declared presence is surfaced as info at the end.)
      pendingCue = { name: cue.name, lineNo }
      continue
    }

    // Plain paragraph → narration (fine, no lint)
  }

  // End-of-file pending cue
  if (pendingCue) {
    issues.push({
      level: 'warn',
      message: `Line ${pendingCue.lineNo}: orphan cue "${pendingCue.name}" at end of file`
    })
  }

  // Listed-but-silent: informational
  const speakingNorm = new Set([...speakersFound].map(norm))
  for (const p of present) {
    if (!speakingNorm.has(norm(p))) {
      issues.push({ level: 'info', message: `"${p}" is listed present but has no lines` })
    }
  }

  return issues
}

// ── Re-export for backward compat ─────────────────────────────────────────────

/** @deprecated Use lintFountain */
export { lintFountain as lintScene }
