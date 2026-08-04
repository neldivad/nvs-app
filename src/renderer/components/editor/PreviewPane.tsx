import { JSX, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { speakerColor, fmStr, fmNested } from '@/lib/fountain/previewParser'
import { parseFountain, type Block } from '@/lib/fountain/blockSerializer'
import { infoBoxFields, PHASE_META, slugify } from '@/config/worldSchema'
import { entityVisual } from '@/config/entityVisual'
import { ImageLightbox } from '@/components/ui/ImageLightbox'
import type { WorldPage } from '@shared/ipc'
import { normName, entityNameVariants } from '@shared/entityNames'

// ── Inline mark renderer ──────────────────────────────────────────────────────

const INLINE_RE = /(\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|([^*]+))/g

function InlineText({ text }: { text: string }): JSX.Element {
  const nodes: React.ReactNode[] = []
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m[2]) nodes.push(<strong key={nodes.length}><em>{m[2]}</em></strong>)
    else if (m[3]) nodes.push(<strong key={nodes.length}>{m[3]}</strong>)
    else if (m[4]) nodes.push(<em key={nodes.length}>{m[4]}</em>)
    else if (m[5]) nodes.push(m[5])
  }
  return <>{nodes}</>
}

// ── Asset URL ────────────────────────────────────────────────────────────────

function assetSrc(rel: string | undefined): string | null {
  return rel ? `nvs-asset://${rel}` : null
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function PreviewPane(): JSX.Element {
  const activePage = useWorkspace((s) => s.activePage)
  const frontmatter = useWorkspace((s) => s.frontmatter)
  const body = useWorkspace((s) => s.body)

  if (!activePage) return <></>
  if (activePage.kind === 'scene') return <ScenePreview frontmatter={frontmatter} body={body} />
  return <WikiPreview frontmatter={frontmatter} body={body} kind={activePage.kind} />
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export function ScenePreview({
  frontmatter,
  body
}: {
  frontmatter: Record<string, unknown>
  body: string
}): JSX.Element {
  const blocks = parseFountain(body)
  const [inspector, setInspector] = useState<string | null>(null)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div data-page-export className="nvs-manuscript mx-auto max-w-[var(--measure)] px-6 py-8">
        <div className="mb-8 border-b border-border pb-5">
          <h1 className="text-lg font-semibold text-foreground">
            {fmStr(frontmatter, 'title') || 'Untitled'}
          </h1>
          {fmStr(frontmatter, 'location') && (
            <p className="mt-0.5 font-mono text-xs text-faint">
              {fmStr(frontmatter, 'location')}
            </p>
          )}
        </div>

        <div className="space-y-0.5">
          {blocks.map((block, i) => (
            <BlockView key={i} block={block} onSpeakerClick={setInspector} />
          ))}
        </div>
      </div>

      {inspector != null && (
        <SpeakerInspector name={inspector} onClose={() => setInspector(null)} />
      )}
    </div>
  )
}

function BlockView({
  block,
  onSpeakerClick
}: {
  block: Block
  onSpeakerClick: (name: string) => void
}): JSX.Element | null {
  switch (block.kind) {
    case 'speech':
      return <SpeechBubble speaker={block.speaker} text={block.text} onSpeakerClick={onSpeakerClick} />
    case 'thinking':
      return <ThinkingBubble speaker={block.speaker} text={block.text} onSpeakerClick={onSpeakerClick} />
    case 'narration':
      return (
        <p className="py-1.5 text-[14px] leading-relaxed text-prose"><InlineText text={block.text} /></p>
      )
    case 'action':
      return (
        <p className="py-1 text-center text-[12px] italic text-muted-foreground">
          <InlineText text={block.text} />
        </p>
      )
    case 'transition':
      return (
        <div className="flex justify-center py-3">
          {/* rounded-md, not rounded-full: a full pill turns a long transition (e.g. an imported transcript
              preamble) into a giant oval. A modest radius reads as a chip at any length. */}
          <span className="max-w-full rounded-md border border-border bg-panel px-4 py-1 font-mono text-[11px] uppercase leading-relaxed tracking-widest text-faint">
            <InlineText text={block.text} />
          </span>
        </div>
      )
  }
}

function SpeechBubble({
  speaker,
  text,
  onSpeakerClick
}: {
  speaker: string
  text: string
  onSpeakerClick: (name: string) => void
}): JSX.Element {
  const worldPages = useWorkspace((s) => s.worldPages)
  const color = speakerColor(speaker)
  const charPage = findCharacter(worldPages, speaker)

  return (
    <div className="flex gap-3 py-1.5">
      <div
        className="w-0.5 shrink-0 self-stretch rounded-full"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onSpeakerClick(speaker)}
          className="mb-0.5 flex items-center gap-1.5 hover:opacity-75"
        >
          <Avatar name={speaker} avatar={charPage?.avatar} color={color} size={18} />
          <span className="text-[11px] font-semibold" style={{ color }}>
            {speaker}
          </span>
        </button>
        <p className="text-[13px] leading-relaxed text-foreground/90"><InlineText text={text} /></p>
      </div>
    </div>
  )
}

function ThinkingBubble({
  speaker,
  text,
  onSpeakerClick
}: {
  speaker: string
  text: string
  onSpeakerClick: (name: string) => void
}): JSX.Element {
  const worldPages = useWorkspace((s) => s.worldPages)
  const color = speakerColor(speaker)
  const charPage = findCharacter(worldPages, speaker)

  return (
    <div className="flex gap-3 py-1.5 opacity-75">
      <div
        className="w-0.5 shrink-0 self-stretch rounded-full opacity-40"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onSpeakerClick(speaker)}
          className="mb-0.5 flex items-center gap-1.5 hover:opacity-75"
        >
          <Avatar name={speaker} avatar={charPage?.avatar} color={color} size={18} />
          <span className="text-[11px] font-semibold italic" style={{ color }}>
            {speaker}
          </span>
        </button>
        <p className="text-[13px] italic leading-relaxed text-foreground/60"><InlineText text={text} /></p>
      </div>
    </div>
  )
}

// ── Speaker inspector ─────────────────────────────────────────────────────────

function SpeakerInspector({
  name,
  onClose
}: {
  name: string
  onClose: () => void
}): JSX.Element {
  const worldPages = useWorkspace((s) => s.worldPages)
  const openPage = useWorkspace((s) => s.openPage)
  const createWorldPage = useWorkspace((s) => s.createWorldPage)
  const [fm, setFm] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const charPage = findCharacter(worldPages, name)
  const color = speakerColor(name)

  useEffect(() => {
    if (!charPage) { setLoading(false); return }
    void window.nvs.readScene(charPage.path).then((doc) => {
      setFm(doc.frontmatter)
      setLoading(false)
    })
  }, [charPage?.path])

  return (
    <Dialog open onClose={onClose} title={name} accent={color}>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-4 animate-spin text-faint" />
        </div>
      ) : !charPage || fm == null ? (
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">"{name}"</span> is a speaker in your scenes, but has no
              character page yet.
            </p>
            <p className="text-xs text-faint">
              Creating one adds <span className="font-mono">content/world/characters/{slugify(name)}.md</span>
            </p>
          </div>
          <Button
            size="sm"
            disabled={creating}
            onClick={() => {
              setCreating(true)
              // The cue is ALL-CAPS ("JEAN"); title-case it for the page's display name (id is
              // slug-normalized either way, so it still links back to the scene cue).
              const display = name.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
              void createWorldPage('character', display).then((page) => {
                if (page) onClose() // createWorldPage opens the new page itself
                else setCreating(false)
              })
            }}
          >
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create character page
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar name={name} avatar={charPage.avatar} color={color} size={48} />
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{fmStr(fm, 'name') || name}</p>
                <PhaseBadge phase={fmStr(fm, 'phase')} />
              </div>
              {fmStr(fm, 'role') && (
                <p className="text-xs capitalize text-muted-foreground">{fmStr(fm, 'role')}</p>
              )}
            </div>
          </div>

          {/* Schema-driven: the same info-box fields the wiki preview shows, minus the
              role (already the subtitle). Stays in sync with worldSchema.ts. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {infoBoxFields('character')
              .filter((f) => f.key !== 'role')
              .map((f) => {
                const v = f.nestedPath ? fmNested(fm, ...f.nestedPath) : fmStr(fm, f.key)
                if (!v) return null
                return (
                  <div key={f.key}>
                    <p className="text-[10px] uppercase tracking-wide text-faint">{f.label}</p>
                    <p className="text-[12px] text-muted-foreground">{v}</p>
                  </div>
                )
              })}
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void openPage({ path: charPage.path, title: charPage.name, kind: 'character' })
                onClose()
              }}
            >
              <ExternalLink className="size-3" />
              Open character page
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ── Wiki preview ──────────────────────────────────────────────────────────────

export function WikiPreview({
  frontmatter,
  body,
  kind
}: {
  frontmatter: Record<string, unknown>
  body: string
  kind: string
}): JSX.Element {
  const accentClass =
    kind === 'character' ? 'text-character' : kind === 'lore' ? 'text-lore' : 'text-lore'
  const fields = infoBoxFields(kind)
  const clean = body.replace(/<!--[\s\S]*?-->/g, '')
  const images = Array.isArray(frontmatter.images)
    ? frontmatter.images.map(String)
    : fmStr(frontmatter, 'avatar')
      ? [fmStr(frontmatter, 'avatar')]
      : []

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div data-page-export className="nvs-manuscript mx-auto max-w-[var(--measure)] px-6 py-8">
        {images.length > 0 && <Gallery images={images} />}
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h1 className={cn('text-xl font-semibold', accentClass)}>
              {fmStr(frontmatter, 'name') || fmStr(frontmatter, 'title') || 'Untitled'}
            </h1>
            <PhaseBadge phase={fmStr(frontmatter, 'phase')} />
          </div>
          {fmStr(frontmatter, 'id') && (
            <p className="mt-0.5 font-mono text-xs text-faint">{fmStr(frontmatter, 'id')}</p>
          )}
        </div>

        {fields.length > 0 && (
          <div className="mb-6 rounded-lg border border-border bg-panel p-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {fields.map(({ key, label, nestedPath }) => {
                const v = nestedPath
                  ? fmNested(frontmatter, ...nestedPath)
                  : fmStr(frontmatter, key)
                if (!v) return null
                return (
                  <div key={key}>
                    <p className="text-[10px] uppercase tracking-wide text-faint">{label}</p>
                    <p className="text-[12px] text-muted-foreground">{v}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <WikiBody markdown={clean} />
        <MentionedBy pageId={fmStr(frontmatter, 'id')} />
      </div>
    </div>
  )
}

/** Backlinks — other world pages whose body links to this one. */
function MentionedBy({ pageId }: { pageId: string }): JSX.Element | null {
  const openPage = useWorkspace((s) => s.openPage)
  const [pages, setPages] = useState<WorldPage[]>([])
  useEffect(() => {
    if (!pageId) {
      setPages([])
      return
    }
    let live = true
    void window.nvs
      .worldBacklinks(pageId)
      .then((p) => live && setPages(p))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [pageId])
  if (pages.length === 0) return null
  const CAP = 40
  const shown = pages.slice(0, CAP)
  return (
    <div className="mt-8 border-t border-border pt-4">
      <p className="mb-2 text-[10px] uppercase tracking-wide text-faint">Mentioned by · {pages.length}</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((p) => {
          const Icon = entityVisual(p.kind).Icon
          return (
            <button
              key={p.id}
              onClick={() => void openPage({ path: p.path, title: p.name, kind: p.kind })}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
            >
              <Icon className={cn('size-3 shrink-0', entityVisual(p.kind).text)} />
              {p.name}
            </button>
          )
        })}
        {pages.length > CAP && (
          <span className="px-1 py-1 text-xs text-faint">+{pages.length - CAP} more</span>
        )}
      </div>
    </div>
  )
}

/** Split a GFM table row "| a | b |" → ["a","b"] (drop the outer pipes). */
const splitRow = (s: string): string[] => s.trim().replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
/** Is this the table's header/body separator row? ("|---|---|", "| :-- | --: |"). */
const isTableSep = (s: string): boolean => { const t = s.trim(); return t.includes('-') && /^\|?[\s:|-]+\|?$/.test(t) }

/** A small Markdown renderer for world prose — headings, dividers, tables, blockquotes, lists, paragraphs. */
function WikiBody({ markdown }: { markdown: string }): JSX.Element {
  const els: JSX.Element[] = []
  const lines = markdown.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { i++; continue }

    // thematic break (---, ***, ___)
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { els.push(<hr key={els.length} className="my-5 border-border" />); i++; continue }

    // heading
    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      els.push(
        h[1].length <= 2 ? (
          <h2 key={els.length} className="mb-1.5 mt-6 border-b border-border pb-1 text-[13px] font-semibold text-foreground/90"><WikiInline text={h[2]} /></h2>
        ) : (
          <h3 key={els.length} className="mb-1 mt-4 text-[12px] font-semibold text-foreground/80"><WikiInline text={h[2]} /></h3>
        )
      )
      i++; continue
    }

    // GFM table: a pipe row followed by a separator row
    if (line.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++ }
      els.push(
        <div key={els.length} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>{header.map((c, j) => <th key={j} className="border border-border bg-panel-soft px-2 py-1 text-left font-semibold text-foreground/80"><WikiInline text={c} /></th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => <tr key={ri}>{header.map((_, j) => <td key={j} className="border border-border px-2 py-1 align-top text-muted-foreground"><WikiInline text={r[j] ?? ''} /></td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // blockquote (consecutive `>` lines)
    if (line.startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) { quote.push(lines[i].trim().replace(/^>\s?/, '')); i++ }
      els.push(<blockquote key={els.length} className="my-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">{quote.map((q, qi) => <p key={qi}>{q ? <WikiInline text={q} /> : ' '}</p>)}</blockquote>)
      continue
    }

    // list (consecutive unordered or ordered items)
    const ordered = /^\d+\.\s+/.test(line)
    if (ordered || /^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const t = lines[i].trim()
        const m = ordered ? t.match(/^\d+\.\s+(.+)$/) : t.match(/^[-*+]\s+(.+)$/)
        if (!m) break
        items.push(m[1]); i++
      }
      const Tag = ordered ? 'ol' : 'ul'
      els.push(<Tag key={els.length} className={cn('my-2 ml-5 space-y-0.5 text-sm text-muted-foreground', ordered ? 'list-decimal' : 'list-disc')}>{items.map((it, ii) => <li key={ii}><WikiInline text={it} /></li>)}</Tag>)
      continue
    }

    // paragraph
    els.push(<p key={els.length} className="mb-2 text-sm leading-relaxed text-muted-foreground"><WikiInline text={line} /></p>)
    i++
  }
  // data-wiki-body: the outline scopes its jump/scroll-spy to these body headings (h2/h3), excluding the title h1.
  return <div data-wiki-body>{els}</div>
}

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

/** Inline renderer for world prose: `[Name](id)` links + bold/italic (reusing InlineText). */
function WikiInline({ text }: { text: string }): JSX.Element {
  const nodes: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(<InlineText key={nodes.length} text={text.slice(last, m.index)} />)
    nodes.push(<WikiLink key={nodes.length} label={m[1]} id={m[2]} />)
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(<InlineText key={nodes.length} text={text.slice(last)} />)
  return <>{nodes}</>
}

/** A `[Name](id)` link, resolved three ways (world-model.md Decision 4):
 *  1. authored PAGE → opens the page.
 *  2. a PAGELESS discovered concept (entity track / character or entity arc / lore topic) → a muted "no page yet"
 *     link that opens that object's DETAIL FLOAT as the learn-more surface (where "Suggest page" lives).
 *  3. nothing → a broken (red) link — a real authoring error worth flagging. */
function WikiLink({ label, id }: { label: string; id: string }): JSX.Element {
  const worldPages = useWorkspace((s) => s.worldPages)
  const openPage = useWorkspace((s) => s.openPage)
  const entityTracks = useWorkspace((s) => s.entityTracks)
  const characterArc = useWorkspace((s) => s.characterArc)
  const loreView = useWorkspace((s) => s.loreView)
  const setWorkspace = useWorkspace((s) => s.setWorkspace)
  const setThreadsTab = useWorkspace((s) => s.setThreadsTab)
  const setSelectedEntity = useWorkspace((s) => s.setSelectedEntity)
  const setSelectedArc = useWorkspace((s) => s.setSelectedArc)
  const setSelectedLore = useWorkspace((s) => s.setSelectedLore)

  const page = worldPages.find((p) => p.id === id)
  if (page) {
    return (
      <button
        onClick={() => void openPage({ path: page.path, title: page.name, kind: page.kind })}
        title={page.name}
        className={cn('underline decoration-dotted underline-offset-2 transition hover:decoration-solid', entityVisual(page.kind).text)}
      >
        {label}
      </button>
    )
  }

  // Pageless — resolve the id against what analysis DISCOVERED, and open that object's rail/detail (learn-more).
  const openDiscovered = ((): (() => void) | null => {
    const go = (tab: 'character' | 'entity' | 'lore', sel: () => void): (() => void) => () => {
      setWorkspace('threads')
      setThreadsTab(tab) // resets selection — so select AFTER
      sel()
    }
    if ((characterArc ?? []).some((a) => a.entityId === id)) return go('character', () => setSelectedArc(id))
    if ((entityTracks ?? []).some((e) => e.id === id)) return go('entity', () => setSelectedEntity(id))
    if ((loreView?.topics ?? []).some((t) => t.loreId === id)) return go('lore', () => setSelectedLore(id))
    return null
  })()
  if (openDiscovered) {
    return (
      <button
        onClick={openDiscovered}
        title={`${label} — no page yet · learn more`}
        className="text-muted-foreground underline decoration-dashed decoration-faint underline-offset-2 transition hover:text-foreground hover:decoration-solid"
      >
        {label}
      </button>
    )
  }

  return (
    <span title={`No page or discovered concept with id "${id}"`} className="text-flag underline decoration-dotted underline-offset-2">
      {label}
    </span>
  )
}

// ── Phase badge ───────────────────────────────────────────────────────────────

function PhaseBadge({ phase }: { phase: string }): JSX.Element | null {
  const meta = PHASE_META[phase]
  if (!meta) return null
  return (
    <span
      className={cn(
        'rounded-full border border-current px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
        meta.text
      )}
    >
      {meta.label}
    </span>
  )
}

// ── Gallery ───────────────────────────────────────────────────────────────────

/** Hero image carousel for a world page. images[0] is the avatar; prev/next when >1. */
function Gallery({ images }: { images: string[] }): JSX.Element {
  const [i, setI] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const n = images.length
  const idx = ((i % n) + n) % n

  return (
    <div className="mb-6">
      <div className="relative overflow-hidden rounded-lg border border-border bg-panel-soft">
        <button
          onClick={() => setZoomed(true)}
          title="View full image"
          className="block w-full cursor-zoom-in"
        >
          <img src={`nvs-asset://${images[idx]}`} alt="" className="max-h-80 w-full object-cover" />
          {/* vignette — darkens the edges so overlaid controls/text stay legible */}
          <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-black/15" />
        </button>
        {n > 1 && (
          <>
            <button
              onClick={() => setI(idx - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-1 text-white transition-colors hover:bg-black/75"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => setI(idx + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-1 text-white transition-colors hover:bg-black/75"
            >
              <ChevronRight className="size-4" />
            </button>
            <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
              {images.map((src, k) => (
                <button
                  key={src}
                  onClick={() => setI(k)}
                  className={cn('size-1.5 rounded-full', k === idx ? 'bg-white' : 'bg-white/40')}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {zoomed && <ImageLightbox images={images} start={idx} onClose={() => setZoomed(false)} />}
    </div>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({
  name,
  avatar,
  color,
  size
}: {
  name: string
  avatar?: string
  color: string
  size: number
}): JSX.Element {
  const src = assetSrc(avatar)
  const initial = name.trim()[0]?.toUpperCase() ?? '?'
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="select-none text-[9px] font-bold leading-none" style={{ color }}>
          {initial}
        </span>
      )}
    </span>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resolve a Fountain speaker cue → its character page, using the SAME shared matcher as the Write view
// (BlockEditor's speakerPage) — name · alias · id, normalized. Routing both views through entityNameVariants
// means an alias like SCARAMOUCHE opens the Wanderer page in the preview too, and both are equally robust to
// invisible/format chars (normName strips \p{Cf}). Previously this rolled its own id/name-only match with loose
// prefix fallbacks, so aliases never resolved and a pasted-in zero-width char broke it.
function findCharacter(pages: WorldPage[], speaker: string): WorldPage | null {
  const key = normName(speaker)
  if (!key) return null
  return (
    pages.find((p) => {
      if (p.kind !== 'character') return false
      // A cue is an EXACT identifier, so match the whole name / any alias directly — this catches SHORT aliases
      // (e.g. "Ei" → 2 chars) that entityNameVariants deliberately drops as prose-matching noise. The variant set
      // still handles bilingual names (cue "Liu Bei" → page "劉備 Liu Bei").
      if (p.name && normName(p.name) === key) return true
      if ((p.aliases ?? []).some((a) => normName(a) === key)) return true
      return entityNameVariants({ id: p.id, name: p.name, aliases: p.aliases }).includes(key)
    }) ?? null
  )
}
