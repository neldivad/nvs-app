/**
 * Linter for world-page body links. Relationships/factions/etc. live in the prose as
 * `[Name](id)` links (inserted by `@`); this flags the ones that don't resolve to a real
 * page (renamed/deleted/typo) and notes bare `@mentions` that were never turned into links.
 * Surfaced in the editor's issues bar — the integrity signal for the linking model.
 */
import type { LintIssue } from './lintFountain'
import type { WorldPage } from '@shared/ipc'

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g
const BARE_MENTION_RE = /(?:^|\s)@[\w-]+/g

export function lintWorldLinks(body: string, pages: WorldPage[]): LintIssue[] {
  const ids = new Set(pages.map((p) => p.id))
  const issues: LintIssue[] = []
  const flagged = new Set<string>()

  let m: RegExpExecArray | null
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(body)) !== null) {
    const id = m[2]
    if (!ids.has(id) && !flagged.has(id)) {
      flagged.add(id)
      issues.push({ level: 'warn', message: `Broken link: “${m[1]}” → no page “${id}”` })
    }
  }

  const bare = body.match(BARE_MENTION_RE)
  if (bare && bare.length) {
    issues.push({
      level: 'info',
      message: `${bare.length} unlinked @mention${bare.length > 1 ? 's' : ''} — pick from the menu to link`
    })
  }

  return issues
}

/**
 * Alias-collision lint for a CHARACTER page: does any of THIS page's names (display name + aliases) also
 * identify ANOTHER character page? If so, the ingest speaker map (nameToEid) is last-write-wins, so a shared
 * cue silently resolves to just one of them, order-dependently (see ingest.ts). We surface it as a `warn`, not
 * an error — twins both called "Traveler", or an impostor wearing a real character's name, are legitimate; the
 * author decides. A single page carrying many aliases (Raiden Shogun = Ei = Baal) never trips this: we only
 * compare across DIFFERENT pages. Both sides gate on `kind === 'character'` (only characters feed nameToEid).
 */
export function lintAliasCollisions(
  current: { id: string; name: string; aliases: string[] },
  pages: WorldPage[]
): LintIssue[] {
  const norm = (s: string): string => s.trim().toLowerCase()
  const mine = new Set([current.name, ...current.aliases].map(norm).filter(Boolean))
  if (!mine.size) return []
  const issues: LintIssue[] = []
  const seen = new Set<string>() // one warning per colliding term, even if several pages share it
  for (const p of pages) {
    if (p.id === current.id || p.kind !== 'character') continue
    for (const term of [p.name, ...(p.aliases ?? [])]) {
      const key = norm(term)
      if (mine.has(key) && !seen.has(key)) {
        seen.add(key)
        issues.push({
          level: 'warn',
          message: `“${term}” also identifies “${p.name}” — a cue resolves to only one of them. Give one a distinct name if they're different characters.`
        })
      }
    }
  }
  return issues
}
