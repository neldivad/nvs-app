/**
 * Inline entity-linking — the "tagged snippet" look, client-side. We don't get marked spans from the
 * model, so we tag what we CAN resolve in free text: known character NAMES (→ clickable, open the
 * character) and CHAPTER tokens like "C4" / "Chapter 4" (→ highlighted, shown as "Chapter 4"; not
 * clickable because a chapter doesn't map to one scene), plus stray snake_case machine terms
 * (never_says, …) marked as defined terms. Shared by the coherence + character-arc rails.
 */
import { useMemo, type JSX } from 'react'
import { chapterNum } from '@/config/coherenceVisual'
import { entityNameVariants, normName } from '@shared/entityNames'

export type NameRef = { id: string; name: string }
export type ThreadRef = { id: string; slug: string }
export type AnnTok =
  | { kind: 'plain'; t: string }
  | { kind: 'name'; t: string; id: string }
  | { kind: 'thread'; t: string; id: string } // inline thread citation → clickable thread link
  | { kind: 'chapter'; t: string; num: string }
  | { kind: 'enum'; t: string }

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function tokenize(text: string, names: NameRef[], threadSlugToId: Map<string, string> = new Map()): AnnTok[] {
  // Match by VARIANTS (script-split) so a bilingual "劉備 Liu Bei" is linked when the prose says just "Liu Bei"
  // (via @shared/entityNames — same matcher every rail uses). variant→id, longest-first so the fullest form wins.
  const variantToId = new Map<string, string>()
  for (const n of names) for (const v of entityNameVariants({ id: n.id, name: n.name })) if (v.length > 1 && !variantToId.has(v)) variantToId.set(v, n.id)
  const variants = [...variantToId.keys()].sort((a, b) => b.length - a.length)
  const namePat = variants.map(escRe).join('|')
  // Inline thread citation the continuity/coherence analysis embeds: `[thread · thr:<sceneId>:<slug>]`. Matched
  // as a WHOLE (first, so its snake_case slug isn't grabbed by enumPat and rendered as a mono "defined term").
  const citePat = '\\[thread\\s*·\\s*thr:[^\\]]+\\]'
  const chapPat = 'Chapters?\\s+\\d+|C\\d+\\b'
  const enumPat = '[a-z]+_[a-z_]+' // snake_case tokens are machine terms leaking into prose (never_says, …)
  // Names are boundary-guarded — not touching a LETTER on either side — so "amber" can't match inside "Chamber".
  // The guard is letter-only (not `\b`) on purpose: `\b` can't bound a CJK/bilingual variant, which has no ASCII
  // word boundary, and would drop those matches. (i-flag makes the variants case-insensitive.)
  const re = new RegExp(`(${citePat})|(${chapPat})|(${enumPat})${namePat ? `|(?<![a-z])(${namePat})(?![a-z])` : ''}`, 'gi')
  const out: AnnTok[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'plain', t: text.slice(last, m.index) })
    if (m[1]) {
      // `[thread · thr:sanguo-ch065:guan_yu_rank_dispute]` → slug = last colon-segment before the ']'.
      const inner = m[1].slice(m[1].indexOf('thr:') + 4, -1)
      const slug = inner.split(':').pop() ?? ''
      out.push({ kind: 'thread', t: slug, id: threadSlugToId.get(slug) ?? '' })
    } else if (m[2]) out.push({ kind: 'chapter', t: m[0], num: chapterNum(m[0]) ?? '' })
    else if (m[3]) out.push({ kind: 'enum', t: m[0] })
    else out.push({ kind: 'name', t: m[0], id: variantToId.get(normName(m[0])) ?? '' })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ kind: 'plain', t: text.slice(last) })
  return out
}

/** Render free text with character names (clickable → onName), chapter tokens, and inline thread citations
 *  (clickable → onThread). Threads/onThread are optional — rails without threads (e.g. arcs) omit them. */
export function Annotated({ text, names, onName, threads, onThread }: { text: string; names: NameRef[]; onName: (id: string) => void; threads?: ThreadRef[]; onThread?: (id: string) => void }): JSX.Element {
  const slugToId = useMemo(() => new Map((threads ?? []).map((t) => [t.slug, t.id])), [threads])
  const toks = useMemo(() => tokenize(text, names, slugToId), [text, names, slugToId])
  return (
    <>
      {toks.map((tk, i) => {
        if (tk.kind === 'name')
          return (
            <button key={i} onClick={() => tk.id && onName(tk.id)} disabled={!tk.id} className="font-medium text-character underline decoration-character/30 underline-offset-2 hover:decoration-character" title={`${tk.t} — open character`}>
              {tk.t}
            </button>
          )
        if (tk.kind === 'thread')
          return (
            <button
              key={i}
              onClick={() => tk.id && onThread?.(tk.id)}
              disabled={!tk.id || !onThread}
              className="font-medium text-thread underline decoration-thread/30 underline-offset-2 hover:decoration-thread disabled:no-underline disabled:opacity-80"
              title={tk.id ? `${tk.t.replace(/_/g, ' ')} — inspect thread` : `thread: ${tk.t.replace(/_/g, ' ')}`}
            >
              {tk.t.replace(/_/g, ' ')}
            </button>
          )
        if (tk.kind === 'chapter')
          return (
            <span key={i} className="font-medium text-thread/80" title={tk.t}>
              {tk.num ? `Chapter ${tk.num}` : tk.t}
            </span>
          )
        if (tk.kind === 'enum')
          return (
            <span key={i} className="font-mono text-muted-foreground" title="defined term">
              {tk.t}
            </span>
          )
        return <span key={i}>{tk.t}</span>
      })}
    </>
  )
}
