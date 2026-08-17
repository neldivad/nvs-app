/**
 * TipTap-based Fountain block editor.
 *
 * Each Fountain block is a custom ProseMirror node (FountainBlock) with attrs
 * `kind` and `speaker`. The document contains only these nodes — no standard
 * paragraphs. Write mode wires it to the workspace body (debounced); source
 * mode falls back to CodeMirror (handled in SceneEditor).
 */

import { JSX, createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSaveTarget } from '@/lib/editor/saveTarget'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor
} from '@tiptap/react'
import { Node as TiptapNode, type JSONContent } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { StarterKit } from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { MessageCircle, Brain, AlignLeft, Clapperboard, Clock, ChevronDown, Sparkles, ArrowUpRight } from 'lucide-react'
import { SceneSearch, setSceneSearch, stepSceneSearch, getSceneSearch, scrollToActive, sceneMarkers, gotoSceneSearch } from '@/lib/fountain/tiptapSearch'
import { FindBar } from './FindBar'
import { SearchMinimap } from './SearchMinimap'
import type { NodeViewProps } from '@tiptap/core'
import { isValidSpeaker } from '@shared/config/fountain'
import { normName, entityNameVariants } from '@shared/entityNames'
import { parseFountain, serializeFountain } from '@/lib/fountain/blockSerializer'
import type { Block, SpeechBlock, ThinkingBlock } from '@/lib/fountain/blockSerializer'
import { WRITER_BLOCKS, MOOD_PRESETS, type BlockKind } from '@/config/writerBlocks'
import type { PageEditMode } from '@shared/config/agentCommands'
import { useWorkspace } from '@/stores/workspace'
import { cn, looseIncludes } from '@/lib/utils'

// Cap the @-mention / speaker pickers' rendered rows so a huge cast can't balloon the DOM — keep typing
// to narrow. (These pickers are arrow-key navigated, so the cap bounds idx + render together.)
const MENTION_CAP = 20

// ── Inline mark conversion ────────────────────────────────────────────────────

const INLINE_RE = /(\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|([^*]+))/g

function parseInlineMarks(text: string): JSONContent[] {
  if (!text) return []
  const nodes: JSONContent[] = []
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m[2]) nodes.push({ type: 'text', text: m[2], marks: [{ type: 'bold' }, { type: 'italic' }] })
    else if (m[3]) nodes.push({ type: 'text', text: m[3], marks: [{ type: 'bold' }] })
    else if (m[4]) nodes.push({ type: 'text', text: m[4], marks: [{ type: 'italic' }] })
    else if (m[5]) nodes.push({ type: 'text', text: m[5] })
  }
  return nodes.filter((n) => n.text && n.text.length > 0)
}

function inlineToText(content: JSONContent[] | undefined): string {
  if (!content) return ''
  return content
    .map((node) => {
      if (node.type === 'hardBreak') return '\n'
      if (node.type !== 'text') return ''
      const t = node.text ?? ''
      const marks = node.marks ?? []
      const bold = marks.some((m) => m.type === 'bold')
      const italic = marks.some((m) => m.type === 'italic')
      if (bold && italic) return `***${t}***`
      if (bold) return `**${t}**`
      if (italic) return `*${t}*`
      return t
    })
    .join('')
}

// ── Body ↔ TipTap JSONContent ─────────────────────────────────────────────────

function getSpeaker(block: Block): string {
  return block.kind === 'speech' || block.kind === 'thinking' ? block.speaker : ''
}

function bodyToContent(body: string): JSONContent {
  const blocks = parseFountain(body)
  const blockNodes = blocks.map((b) => ({
    type: 'fountainBlock',
    attrs: { kind: b.kind, speaker: getSpeaker(b), mood: b.kind === 'speech' ? (b.mood ?? '') : '', start: b.start ?? '', end: b.end ?? '' },
    content: parseInlineMarks(b.text)
  }))
  return {
    type: 'doc',
    content:
      blockNodes.length > 0
        ? blockNodes
        : [{ type: 'fountainBlock', attrs: { kind: 'narration', speaker: '', mood: '', start: '', end: '' }, content: [] }]
  }
}

// Source lines a block occupies (for the Write gutter's file-relative line no.): a cue adds its own line above the
// dialogue; every kind's text spans (hardBreaks + 1) lines. Matches how serializeFountain lays a block out.
function blockLineCount(node: { attrs: Record<string, unknown>; descendants: (f: (n: { type: { name: string } }) => void) => void }): number {
  let breaks = 0
  node.descendants((n) => { if (n.type.name === 'hardBreak') breaks++ })
  const textLines = breaks + 1
  return node.attrs.kind === 'speech' || node.attrs.kind === 'thinking' ? 1 + textLines : textLines
}

// The Write gutter's line numbers are computed ONCE per doc (a single O(n) pass), keyed by each block's start pos
// (= its node view's getPos()), then read O(1) per block via context — NOT recomputed per block (that was O(n²),
// which lagged long scenes on open). Value is file-relative (frontmatter height + preceding blocks).
type LineMap = Map<number, number>
const LineMapContext = createContext<LineMap>(new Map())

function computeLineMap(doc: { childCount: number; child: (i: number) => { nodeSize: number; attrs: Record<string, unknown>; descendants: (f: (n: { type: { name: string } }) => void) => void } }, fmOffset: number): LineMap {
  const map: LineMap = new Map()
  let bodyLine = 1
  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    map.set(pos, bodyLine + fmOffset) // pos before the block = its node view's getPos()
    bodyLine += blockLineCount(child) + 1 // block lines + the blank separator serializeFountain writes
    pos += child.nodeSize
  }
  return map
}

/** Same keys → same values? Lets us keep a STABLE map reference across text edits (line numbers only move on a
 *  structural change), so the context doesn't churn and re-render every block on each keystroke. */
function lineMapsEqual(a: LineMap, b: LineMap): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

function contentToBody(doc: JSONContent): string {
  const blocks: Block[] = (doc.content ?? []).map((node) => {
    const kind: BlockKind = node.attrs?.kind ?? 'narration'
    const speaker: string = node.attrs?.speaker ?? ''
    const mood: string = node.attrs?.mood ?? ''
    // timing (start/end) rides on EVERY kind and must round-trip so editing never strips the author's timecodes
    const timing = { ...(node.attrs?.start ? { start: node.attrs.start as string } : {}), ...(node.attrs?.end ? { end: node.attrs.end as string } : {}) }
    const text = inlineToText(node.content)
    if (kind === 'speech') return { kind, speaker, text, ...(mood ? { mood } : {}), ...timing }
    if (kind === 'thinking') return { kind, speaker, text, ...timing }
    return { kind, text, ...timing } as Block
  })
  return serializeFountain(blocks)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// "see-yi-oh" → "SEE YI OH"  (canonical Fountain cue from character ID)
function idToFountainCue(id: string): string {
  return id.replace(/-/g, ' ').toUpperCase()
}

/** Fixed-position style for a popover anchored to an element. Opens BELOW; when there isn't room (the cue is near
 *  the viewport bottom, e.g. the last block on screen), it FLIPS ABOVE — anchored by its `bottom` so it grows
 *  upward and can never run off the bottom edge, whatever its height. */
function anchoredStyle(anchor: HTMLElement | null): React.CSSProperties {
  if (!anchor) return { position: 'fixed', top: 0, left: 0 }
  const r = anchor.getBoundingClientRect()
  const below = window.innerHeight - r.bottom
  const flipUp = below < 240 && r.top > below // not enough room below, and more room above
  return flipUp
    ? { position: 'fixed', bottom: window.innerHeight - r.top + 4, left: r.left }
    : { position: 'fixed', top: r.bottom + 4, left: r.left }
}

// ── Visual constants ──────────────────────────────────────────────────────────

const KIND_ICON: Record<BlockKind, React.ReactNode> = {
  speech: <MessageCircle className="size-3.5" />,
  thinking: <Brain className="size-3.5" />,
  narration: <AlignLeft className="size-3.5" />,
  action: <Clapperboard className="size-3.5" />,
  transition: <Clock className="size-3.5" />
}

// Semantic tokens (globals.css), NOT raw Tailwind palette — these flip between focus/manuscript modes. The
// LABEL carries the block-kind color cue; the CONTENT stays readable prose so scene text never washes out on
// paper (the old text-amber-200/80 was invisible in manuscript mode).
const KIND_COLOR: Record<BlockKind, string> = {
  speech: 'text-thread',
  thinking: 'text-character',
  narration: 'text-muted-foreground',
  action: 'text-lore',
  transition: 'text-faint'
}

const CONTENT_STYLE: Record<BlockKind, string> = {
  speech: 'text-prose text-sm',
  thinking: 'italic text-prose/80 text-sm',
  narration: 'text-prose text-sm',
  action: 'text-prose text-sm',
  transition: 'text-xs font-medium uppercase tracking-widest text-muted-foreground'
}

// ── Slash command palette ─────────────────────────────────────────────────────

/** One palette row: a block-kind insert, or the `/ag` AI-write action (mirrors the world editor). */
type PaletteItem = {
  slashCommand: string
  label: string
  description: string
  icon: React.ReactNode
  iconColor?: string
  pick: 'agent' | BlockKind
}

function SlashPalette({
  filter,
  onSelect,
  onAgent,
  onClose,
  showAgent = true
}: {
  filter: string
  onSelect: (kind: BlockKind) => void
  onAgent: () => void
  onClose: () => void
  showAgent?: boolean // the block-icon menu opens this WITHOUT the agent-command item (it only converts block types)
}) {
  const { t } = useTranslation('blockEditor')
  const [idx, setIdx] = useState(0)

  const filtered = useMemo(() => {
    const items: PaletteItem[] = [
      ...WRITER_BLOCKS.map((b) => ({
        slashCommand: b.slashCommand,
        label: b.label,
        description: b.description,
        icon: KIND_ICON[b.kind],
        iconColor: KIND_COLOR[b.kind],
        pick: b.kind as BlockKind
      })),
      ...(showAgent
        ? [{
            slashCommand: '/agent',
            label: t('agent.label'),
            description: t('agent.description'),
            icon: <Sparkles className="size-3.5" />,
            iconColor: 'text-thread',
            pick: 'agent' as const
          }]
        : [])
    ]
    const q = filter.toLowerCase()
    return items.filter((b) => b.slashCommand.includes(q) || b.label.toLowerCase().includes(q))
  }, [filter])

  const choose = (item: PaletteItem): void => (item.pick === 'agent' ? onAgent() : onSelect(item.pick))

  // Flip ABOVE the anchor when opening below would run off the viewport bottom (a block near the end of a long
  // scene). The menu is CSS-absolute (top-full), not a fixed portal like the pickers, so we measure its own rect
  // once it's placed below and flip to bottom-full if it overflows — mirroring the pickers' anchoredStyle flip.
  const paletteRef = useRef<HTMLDivElement>(null)
  const [up, setUp] = useState(false)
  useLayoutEffect(() => {
    const el = paletteRef.current
    if (!el || up) return // only measure while placed below; once flipped, leave it
    if (el.getBoundingClientRect().bottom > window.innerHeight - 8) setUp(true)
  }, [filtered.length, up])

  useEffect(() => {
    setIdx(0)
  }, [filter])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIdx((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        if (filtered[idx]) choose(filtered[idx])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [filtered, idx, onSelect, onAgent, onClose])

  if (!filtered.length) return null

  return (
    <div
      ref={paletteRef}
      className={cn(
        'absolute left-0 z-50 w-64 overflow-hidden rounded-lg border border-border bg-panel shadow-lg',
        up ? 'bottom-full mb-1' : 'top-full mt-1'
      )}
    >
      {filtered.map((item, i) => (
        <button
          key={item.slashCommand}
          className={cn(
            'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
            i === idx ? 'bg-panel-soft' : 'hover:bg-panel-soft'
          )}
          onMouseEnter={() => setIdx(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            choose(item)
          }}
        >
          <span className={cn('shrink-0', item.iconColor)}>{item.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">{item.label}</div>
            <div className="truncate text-[11px] text-faint">{item.description}</div>
          </div>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
            {item.slashCommand}
          </span>
        </button>
      ))}
    </div>
  )
}

// ── Speaker picker ────────────────────────────────────────────────────────────

function SpeakerPicker({
  anchorRef,
  current,
  candidates,
  onSelect,
  goToPage,
  onClose
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  current: string
  candidates: string[]
  onSelect: (name: string) => void
  goToPage?: { label: string; onOpen: () => void } // the character page this cue resolves to (name/alias) — jump link
  onClose: () => void
}) {
  const { t } = useTranslation('blockEditor')
  const pickerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState(current)
  const [idx, setIdx] = useState(0)
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', top: 0, left: 0 })

  const filtered = useMemo(() => {
    // Loose match: "hut" finds "Hu Tao" (spaces/punctuation/accents ignored), not just exact substrings.
    return (filter ? candidates.filter((c) => looseIncludes(c, filter)) : candidates).slice(0, MENTION_CAP)
  }, [filter, candidates])

  useEffect(() => { setIdx(0) }, [filter])

  useEffect(() => {
    if (!anchorRef.current) return
    setStyle(anchoredStyle(anchorRef.current))
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [anchorRef])

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as HTMLElement
      if (!anchorRef.current?.contains(t) && !pickerRef.current?.contains(t)) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anchorRef, onClose])

  // Escape via capture (input has focus, so this fires first)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const exactMatch = candidates.some((c) => c.toLowerCase() === filter.toLowerCase())
  // A NEW (non-cast) name may only be added if it round-trips as a cue — otherwise the serializer would emit a
  // line the parser reads back as narration, and the speaker box would have lied. Existing cast picks are valid.
  const canAddTyped = filter.trim().length > 0 && isValidSpeaker(filter)

  return createPortal(
    <div
      ref={pickerRef}
      style={style}
      className="z-9999 w-52 overflow-hidden rounded-lg border border-border bg-panel shadow-lg"
    >
      {/* jump to the character page this cue resolves to (name/alias) — e.g. a SCARAMOUCHE cue → the Wanderer page */}
      {goToPage && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); goToPage.onOpen(); onClose() }}
          className="flex w-full items-center gap-1.5 border-b border-border bg-panel-soft/40 px-3 py-1.5 text-left text-[11px] text-thread transition-colors hover:bg-panel-soft"
        >
          <ArrowUpRight className="size-3 shrink-0" />
          <span className="truncate">{t('speaker.openPageBefore')} <b className="font-medium">{goToPage.label}</b> {t('speaker.openPageAfter')}</span>
        </button>
      )}
      <input
        ref={inputRef}
        className="w-full border-b border-border bg-transparent px-3 py-1.5 text-xs outline-none placeholder:text-faint"
        value={filter}
        placeholder={t('speaker.placeholder')}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            if (filtered[idx]) { onSelect(filtered[idx]); onClose() }               // an existing cast pick — always valid
            else if (canAddTyped) { onSelect(filter.trim().toUpperCase()); onClose() } // a new name, only if it round-trips
            // else: invalid free name → refuse (the inline hint below explains why)
          }
        }}
      />
      <div className="max-h-48 overflow-y-auto">
        {filtered.map((name, i) => (
          <button
            key={name}
            className={cn(
              'flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-panel-soft',
              i === idx ? 'bg-panel-soft' : ''
            )}
            onMouseEnter={() => setIdx(i)}
            onMouseDown={(e) => { e.preventDefault(); onSelect(name); onClose() }}
          >
            {name}
          </button>
        ))}
        {/* "Add" the typed name as a NEW speaker — always available for a non-exact name (not gated on an empty
            list), so loose matches above never hide it; a divider separates it when there are matches. */}
        {filter.trim() && !exactMatch && (
          canAddTyped ? (
            <button
              className={cn('flex w-full items-center px-3 py-1.5 text-left text-[11px] text-faint hover:bg-panel-soft', filtered.length > 0 && 'border-t border-border')}
              onMouseDown={(e) => { e.preventDefault(); onSelect(filter.trim().toUpperCase()); onClose() }}
            >
              {t('speaker.add', { name: filter.trim().toUpperCase() })}
            </button>
          ) : (
            <div className={cn('px-3 py-1.5 text-[11px] text-lore', filtered.length > 0 && 'border-t border-border')}>
              {t('speaker.invalidBefore', { name: filter.trim() })} <code>- &rsquo; .</code> {t('speaker.invalidOnly')} <code>???</code>{t('speaker.invalidAfter')}
            </div>
          )
        )}
      </div>
    </div>,
    document.body
  )
}

// ── Mood popover (a speech cue's emotion tag — the "(parenthetical)", VN-sprite-style) ──────────────
// Presets live in config (MOOD_PRESETS); the input takes any free-form tag; empty = neutral (no parenthetical).

function MoodPopover({
  anchorRef,
  current,
  onSet,
  onClose
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  current: string
  onSet: (mood: string) => void // '' = neutral (clear the parenthetical)
  onClose: () => void
}) {
  const { t } = useTranslation('blockEditor')
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState(current.toLowerCase())
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', top: 0, left: 0 })

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? MOOD_PRESETS.filter((m) => m.includes(q)) : MOOD_PRESETS
  }, [filter])

  useEffect(() => {
    if (!anchorRef.current) return
    setStyle(anchoredStyle(anchorRef.current))
    inputRef.current?.focus(); inputRef.current?.select()
  }, [anchorRef])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as HTMLElement
      if (!anchorRef.current?.contains(t) && !popRef.current?.contains(t)) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anchorRef, onClose])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return createPortal(
    <div
      ref={popRef}
      style={style}
      className="z-9999 w-48 overflow-hidden rounded-lg border border-border bg-panel shadow-lg"
    >
      <input
        ref={inputRef}
        className="w-full border-b border-border bg-transparent px-3 py-1.5 text-xs outline-none placeholder:text-faint"
        value={filter}
        placeholder={t('mood.placeholder')}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSet(filter.trim()) } }}
      />
      <div className="max-h-48 overflow-y-auto">
        <button
          className="flex w-full items-center px-3 py-1.5 text-left text-[11px] italic text-faint hover:bg-panel-soft"
          onMouseDown={(e) => { e.preventDefault(); onSet('') }}
        >
          {t('mood.neutral')}
        </button>
        {filtered.map((m) => (
          <button
            key={m}
            className={cn('flex w-full items-center px-3 py-1.5 text-left text-xs capitalize hover:bg-panel-soft', current.toLowerCase() === m ? 'bg-panel-soft' : '')}
            onMouseDown={(e) => { e.preventDefault(); onSet(m) }}
          >
            {m}
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}

// ── Timing popover — the beat's start/end timecodes as STRUCTURED HH:MM:SS fields (three 2-digit number inputs
// each), so the output is always a valid, round-trippable timecode. Free text let `0`/`3` through, which the parser
// couldn't read → the tag leaked into prose and demoted the cue to narration; structured input rules that out.
// `ms` is carried but NOT an input cell (the UI is 3-field, second-precision) — so SRT-imported milliseconds ride
// along invisibly and survive an H:M:S edit; a hand-entered timing has ms='' and stays clean HH:MM:SS.
type HMS = { h: string; m: string; s: string; ms: string }
const pad2 = (x: string): string => (x === '' ? '00' : x.replace(/\D/g, '').padStart(2, '0').slice(-2))
function splitTC(tc: string): HMS {
  if (!tc) return { h: '', m: '', s: '', ms: '' }
  const [main, msRaw] = tc.split(/[.,]/)
  const parts = main.split(':').map((p) => p.replace(/\D/g, ''))
  while (parts.length < 3) parts.unshift('00') // right-align to HH:MM:SS (a `MM:SS` or `SS` value fills from the right)
  const [h, m, s] = parts.slice(-3)
  return { h: pad2(h), m: pad2(m), s: pad2(s), ms: (msRaw ?? '').replace(/\D/g, '') }
}
const joinTC = (v: HMS): string => {
  if (!v.h && !v.m && !v.s && !v.ms) return ''
  const base = `${pad2(v.h)}:${pad2(v.m)}:${pad2(v.s)}`
  return v.ms ? `${base}.${v.ms.padEnd(3, '0').slice(0, 3)}` : base // preserve imported ms; hand-entered stays HH:MM:SS
}

function NumIn({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }): JSX.Element {
  return (
    <input
      inputMode="numeric"
      autoFocus={autoFocus}
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
      className="w-7 rounded border border-border bg-canvas px-1 py-0.5 text-center outline-none focus:border-thread/50"
    />
  )
}
function TCRow({ label, val, onChange, autoFocus, onEnter }: { label: string; val: HMS; onChange: (v: HMS) => void; autoFocus?: boolean; onEnter: () => void }): JSX.Element {
  const set = (k: keyof HMS, v: string): void => onChange({ ...val, [k]: v })
  return (
    <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }}>
      <span className="w-8 shrink-0">{label}</span>
      <div className="flex items-center gap-0.5 font-mono text-[11px]">
        <NumIn value={val.h} onChange={(v) => set('h', v)} autoFocus={autoFocus} /><span className="text-faint">:</span>
        <NumIn value={val.m} onChange={(v) => set('m', v)} /><span className="text-faint">:</span>
        <NumIn value={val.s} onChange={(v) => set('s', v)} />
      </div>
    </div>
  )
}

function TimingPopover({
  anchorRef,
  start,
  end,
  onSet,
  onClose
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  start: string
  end: string
  onSet: (start: string, end: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('blockEditor')
  const popRef = useRef<HTMLDivElement>(null)
  const [s, setS] = useState<HMS>(() => splitTC(start))
  const [e, setE] = useState<HMS>(() => splitTC(end))
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', top: 0, left: 0 })
  const commit = (): void => onSet(joinTC(s), joinTC(e))

  useEffect(() => {
    if (!anchorRef.current) return
    setStyle(anchoredStyle(anchorRef.current))
  }, [anchorRef])

  useEffect(() => {
    function onMouseDown(ev: MouseEvent): void {
      const t = ev.target as HTMLElement
      if (!anchorRef.current?.contains(t) && !popRef.current?.contains(t)) { commit(); onClose() }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  })

  return createPortal(
    <div
      ref={popRef}
      style={style}
      className="z-9999 w-52 rounded-lg border border-border bg-panel p-2.5 shadow-lg"
    >
      <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wide text-faint">
        <Clock className="size-2.5" /> {t('timing.label')} <span className="ml-auto font-mono normal-case tracking-normal text-faint/70">hh:mm:ss</span>
      </div>
      <TCRow label={t('timing.start')} val={s} onChange={setS} autoFocus onEnter={() => { commit(); onClose() }} />
      <TCRow label={t('timing.end')} val={e} onChange={setE} onEnter={() => { commit(); onClose() }} />
      <div className="mt-1.5 flex items-center justify-between border-t border-border/60 pt-1.5">
        <button onMouseDown={(ev) => { ev.preventDefault(); onSet('', ''); onClose() }} className="text-[10px] text-faint hover:text-flag">
          {t('timing.clear')}
        </button>
        <button onMouseDown={(ev) => { ev.preventDefault(); commit(); onClose() }} className="rounded bg-thread/10 px-2 py-0.5 text-[10px] text-thread hover:bg-thread/20">
          {t('timing.set')}
        </button>
      </div>
    </div>,
    document.body
  )
}

// ── @ mention palette ─────────────────────────────────────────────────────────

function AtPalette({
  anchorRef,
  query,
  candidates,
  onSelect,
  onClose
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  query: string
  candidates: string[]
  onSelect: (name: string) => void
  onClose: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', top: 0, left: 0 })

  const filtered = useMemo(() => {
    return (query ? candidates.filter((c) => looseIncludes(c, query)) : candidates).slice(0, MENTION_CAP)
  }, [query, candidates])

  useEffect(() => { setIdx(0) }, [query])

  useEffect(() => {
    if (!anchorRef.current) return
    setStyle(anchoredStyle(anchorRef.current))
  }, [anchorRef])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[idx]) { e.preventDefault(); e.stopPropagation(); onSelect(filtered[idx]) }
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [filtered, idx, onSelect, onClose])

  if (!filtered.length) return null

  return createPortal(
    <div
      style={style}
      className="z-9999 max-h-56 w-48 overflow-y-auto rounded-lg border border-border bg-panel shadow-lg"
    >
      {filtered.map((name, i) => (
        <button
          key={name}
          className={cn(
            'flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-panel-soft',
            i === idx ? 'bg-panel-soft' : ''
          )}
          onMouseEnter={() => setIdx(i)}
          onMouseDown={(e) => { e.preventDefault(); onSelect(name) }}
        >
          {name}
        </button>
      ))}
    </div>,
    document.body
  )
}

// ── FountainBlock NodeView ────────────────────────────────────────────────────

function FountainBlockView({
  node,
  updateAttributes,
  editor,
  getPos
}: NodeViewProps) {
  const { t } = useTranslation('blockEditor')
  const kind: BlockKind = (node.attrs.kind as BlockKind) ?? 'narration'
  const speaker: string = (node.attrs.speaker as string) ?? ''
  const mood: string = (node.attrs.mood as string) ?? '' // '' = neutral (no parenthetical). Speech only.
  const text = node.textContent
  // Global "Show mood tags" pref (NVS Settings). Off → hide the mood CHIP in the Write view; the `mood` attr stays
  // on the node so serialization keeps writing `(mood)` back to source — visibility only, never data loss.
  const moodVisible = useWorkspace((s) => s.showMood)
  // Timing tag (`[start → end]`) — any block kind. Same visibility-only rule as mood: off hides the chip, the
  // start/end attrs + source stay intact.
  const start: string = (node.attrs.start as string) ?? ''
  const end: string = (node.attrs.end as string) ?? ''
  const timingVisible = useWorkspace((s) => s.showTiming)

  // This block's FILE-relative start line — read O(1) from the shared line map (computed once per doc, not per
  // block). Muted Write gutter that matches the Source gutter + the linter's "Line N".
  const lineMap = useContext(LineMapContext)
  const pos = getPos?.()
  const lineNo = pos == null ? null : lineMap.get(pos) ?? null

  const [showSpeaker, setShowSpeaker] = useState(false)
  const [openSpeakerOnMount, setOpenSpeakerOnMount] = useState(false)
  const [showMood, setShowMood] = useState(false)
  const [showTimingPop, setShowTimingPop] = useState(false)
  const [blockMenuOpen, setBlockMenuOpen] = useState(false) // the block-icon type menu
  const [atEscaped, setAtEscaped] = useState(false)
  const badgeRef = useRef<HTMLButtonElement>(null)
  const moodRef = useRef<HTMLButtonElement>(null)
  const timingRef = useRef<HTMLButtonElement>(null)
  const nodeContentRef = useRef<HTMLDivElement>(null)

  // PERF: only `setAgentComposerOpen` is a real subscription (a stable action). We deliberately do NOT subscribe
  // to body/characters/frontmatter here — with ONE node-view per block, a `body` subscription made every block
  // re-render AND re-parse the whole scene on every keystroke (O(n²): 335 blocks × parseFountain(whole doc)). The
  // speaker/@-candidate list is instead built LAZILY (below), only when a picker is actually open.
  const setAgentComposerOpen = useWorkspace((s) => s.setAgentComposerOpen)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // off → the /-palette drops "Ask AI to write" (composer is chokepointed)


  const hasSpeaker = kind === 'speech' || kind === 'thinking'

  // Slash command palette: show when text starts with "/"
  const paletteQuery = text.startsWith('/') ? text.slice(1) : null

  // @ mention palette: show when text starts with "@" (unless dismissed with Escape)
  useEffect(() => { if (!text.startsWith('@')) setAtEscaped(false) }, [text])
  const atQuery = text.startsWith('@') && !atEscaped ? text.slice(1) : null

  // Speaker / @-mention candidate names — built ONLY while a picker is open (see PERF note above), from a fresh
  // state snapshot. Idle blocks (nearly all) never compute this; while a picker is open the list is stable and
  // the @-query filters it. This is what turns scene open + typing from O(n²) back to O(n).
  const needCandidates = showSpeaker || openSpeakerOnMount || atQuery != null
  const candidates = useMemo(() => {
    if (!needCandidates) return []
    const { body, frontmatter, characters } = useWorkspace.getState()
    const sceneSpeakers = parseFountain(body)
      .filter((b): b is SpeechBlock | ThinkingBlock => b.kind === 'speech' || b.kind === 'thinking')
      .map((b) => b.speaker)
      .filter(Boolean)
    const presentIds = new Set(Array.isArray(frontmatter.characters_present) ? (frontmatter.characters_present as unknown[]).map(String) : [])
    const inScene = characters.filter((c) => presentIds.has(c.id)).map((c) => idToFountainCue(c.id))
    const all = characters.map((c) => idToFountainCue(c.id))
    return [...new Set([...sceneSpeakers, ...inScene, ...all])]
    // eslint-disable-next-line react-hooks/exhaustive-deps — reads a getState() snapshot on open, intentionally not reactive
  }, [needCandidates])

  // Resolve the current speaker cue → its character page by NAME · ALIAS · id (the shared entity matcher), so the
  // picker can offer a jump to it — this is what makes an alias like SCARAMOUCHE open the Wanderer page. `worldPages`
  // is read REACTIVELY (a store selector, not a getState snapshot) so a just-added alias resolves once the store
  // updates; the effect below pulls a fresh copy off disk whenever the picker opens, so an alias edited elsewhere
  // (or in another editor) lands without reopening the scene. worldPages changes rarely, so the extra subscription
  // is cheap even across many blocks.
  const worldPages = useWorkspace((s) => s.worldPages)
  useEffect(() => {
    if (needCandidates) void useWorkspace.getState().refreshWorldPages()
  }, [needCandidates])
  const speakerPage = useMemo(() => {
    if (!needCandidates || !speaker) return null
    const key = normName(speaker)
    return worldPages.find((p) => p.kind === 'character' && entityNameVariants({ id: p.id, name: p.name, aliases: p.aliases }).includes(key)) ?? null
  }, [needCandidates, speaker, worldPages])

  function handleAtSelect(name: string) {
    const pos = getPos()
    if (pos === undefined) return
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { kind: 'speech', speaker: name })
      if (node.content.size > 0) tr.delete(pos + 1, pos + 1 + node.content.size)
      return true
    })
  }

  function selectKind(newKind: BlockKind) {
    const pos = getPos()
    if (pos === undefined) return
    // Clear the "/" trigger text from the node
    const nodeEnd = pos + node.nodeSize
    const contentStart = pos + 1
    const contentEnd = nodeEnd - 1
    if (contentEnd > contentStart) {
      editor.commands.command(({ tr }) => {
        tr.delete(contentStart, contentEnd)
        return true
      })
    }
    updateAttributes({ kind: newKind, speaker: '', mood: '' }) // fresh block starts neutral; a non-speech kind carries no mood
    const spec = WRITER_BLOCKS.find((b) => b.kind === newKind)
    if (spec?.hasSpeaker) {
      setOpenSpeakerOnMount(true)
    }
  }

  // Change THIS block's kind WITHOUT deleting its text — the block-icon menu (unlike selectKind, which clears the
  // typed "/cmd"). Keeps the speaker when both the old and new kind carry one (speech⇄thinking); resets it
  // otherwise, and prompts for one if the new kind needs a speaker and has none.
  function changeKind(newKind: BlockKind) {
    const spec = WRITER_BLOCKS.find((b) => b.kind === newKind)
    const keepSpeaker = !!spec?.hasSpeaker && hasSpeaker
    updateAttributes({ kind: newKind, speaker: keepSpeaker ? speaker : '', mood: newKind === 'speech' ? mood : '' })
    setBlockMenuOpen(false)
    if (spec?.hasSpeaker && !keepSpeaker) setOpenSpeakerOnMount(true)
    else focusHere()
  }

  function closePalette() {
    const pos = getPos()
    if (pos === undefined) return
    const contentStart = pos + 1
    const contentEnd = pos + node.nodeSize - 1
    if (contentEnd > contentStart) {
      editor.commands.command(({ tr }) => {
        tr.delete(contentStart, contentEnd)
        return true
      })
    }
  }

  // `/ag` — clear the trigger text, then open the shared write composer inline at the caret.
  function selectAgent() {
    const c = editor.view.coordsAtPos(editor.state.selection.from)
    closePalette()
    setAgentComposerOpen(true, { top: c.bottom + 4, left: c.left })
  }

  // Open speaker picker right after a kind-change if needed
  useEffect(() => {
    if (openSpeakerOnMount) {
      setOpenSpeakerOnMount(false)
      setShowSpeaker(true)
    }
  }, [openSpeakerOnMount])

  // Return focus to THIS block, not the editor's stale caret — otherwise picking a speaker/mood on an off-screen
  // block scrolls the view back up to wherever the cursor last was. getPos()+1 = the start of this node's content.
  function focusHere(): void {
    const pos = getPos()
    if (typeof pos === 'number') editor.commands.focus(pos + 1)
    else editor.commands.focus()
  }

  function handleSpeakerSelect(name: string) {
    updateAttributes({ speaker: name })
    setShowSpeaker(false)
    focusHere()
  }

  return (
    <NodeViewWrapper className="group relative px-8 py-3">
      {/* muted line-number gutter (hover the left edge to reveal) — mirrors the Source view + the linter's "Line N" */}
      {lineNo != null && (
        <span className="nvs-linegutter pointer-events-none absolute left-0 top-3 w-7 select-none whitespace-nowrap text-right text-[10px] tabular-nums text-faint" contentEditable={false}>
          {lineNo}
        </span>
      )}
      {/* Timing chip — universal (any beat kind). LEFT-aligned, on its OWN line above the beat (not inline with the
          cue) so it's easy to reach and never crowds the text. Shown only when the "Show timing tags" pref is on. */}
      {timingVisible && (
        <div className="relative mb-1 flex" contentEditable={false}>
          <button
            ref={timingRef}
            onMouseDown={(e) => { e.preventDefault(); setShowTimingPop((v) => !v) }}
            title={t('timing.title')}
            className={cn(
              // TEAL (character token) — deliberately distinct from the AMBER (lore) mood chip so timing and mood
              // never read as the same kind of tag.
              'flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
              start ? 'bg-character/10 text-character hover:bg-character/20' : 'text-faint/50 hover:bg-panel-soft hover:text-faint'
            )}
          >
            <Clock className="size-2.5" />
            {start ? (end ? `${start} → ${end}` : start) : t('timing.add')}
          </button>
          {showTimingPop && (
            <TimingPopover
              anchorRef={timingRef}
              start={start}
              end={end}
              onSet={(s, e) => updateAttributes({ start: s, end: e })}
              onClose={() => { setShowTimingPop(false); focusHere() }}
            />
          )}
        </div>
      )}
      {/* Speaker badge — sits above the icon+text row so the icon aligns with dialogue */}
      {hasSpeaker && (
        <div className="mb-1 inline-block" contentEditable={false}>
          <button
            ref={badgeRef}
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wider transition-colors',
              KIND_COLOR[kind],
              'bg-panel-soft hover:bg-panel'
            )}
            onMouseDown={(e) => {
              e.preventDefault()
              setShowSpeaker((v) => !v)
            }}
          >
            {speaker || <span className="font-normal italic text-faint">{t('speaker.noSpeaker')}</span>}
            <ChevronDown className="size-2.5 opacity-50" />
          </button>
          {showSpeaker && (
            <SpeakerPicker
              anchorRef={badgeRef}
              current={speaker}
              candidates={candidates}
              onSelect={handleSpeakerSelect}
              goToPage={speakerPage ? { label: speakerPage.name, onOpen: () => void useWorkspace.getState().openPage({ path: speakerPage.path, title: speakerPage.name, kind: speakerPage.kind }) } : undefined}
              onClose={() => { setShowSpeaker(false); focusHere() }}
            />
          )}
          {/* Mood chip — speech only (thinking's parenthetical is the THINKING marker). Neutral by default.
              Hidden when the global "Show mood tags" pref is off (the mood attr + source text are untouched). */}
          {kind === 'speech' && moodVisible && (
            <span className="relative ml-1.5 inline-block">
              <button
                ref={moodRef}
                onMouseDown={(e) => { e.preventDefault(); setShowMood((v) => !v) }}
                title={t('mood.title')}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] transition-colors',
                  mood ? 'bg-panel-soft italic text-lore hover:bg-panel' : 'text-faint/60 hover:bg-panel-soft hover:text-faint'
                )}
              >
                {mood ? `(${mood.toLowerCase()})` : t('mood.add')}
              </button>
              {showMood && (
                <MoodPopover
                  anchorRef={moodRef}
                  current={mood}
                  onSet={(m) => { updateAttributes({ mood: m.trim().toUpperCase() }); setShowMood(false); focusHere() }}
                  onClose={() => { setShowMood(false); focusHere() }}
                />
              )}
            </span>
          )}
        </div>
      )}

      {/* Icon + text row */}
      <div className="flex gap-3">
        <div className="relative mt-0.75 w-4 shrink-0" contentEditable={false}>
          <button
            title={t('blockType')}
            onMouseDown={(e) => { e.preventDefault(); setBlockMenuOpen((v) => !v) }}
            className={cn(
              'block rounded transition-opacity hover:bg-panel-soft',
              KIND_COLOR[kind],
              blockMenuOpen ? 'opacity-90' : 'opacity-30 group-hover:opacity-70'
            )}
          >
            {KIND_ICON[kind]}
          </button>
          {blockMenuOpen && (
            <>
              {/* click-away backdrop (the palette self-positions above it) */}
              <div className="fixed inset-0 z-40" onMouseDown={() => setBlockMenuOpen(false)} />
              <SlashPalette filter="" showAgent={false} onSelect={changeKind} onAgent={() => setBlockMenuOpen(false)} onClose={() => setBlockMenuOpen(false)} />
            </>
          )}
        </div>

        <div ref={nodeContentRef} className="relative min-w-0 flex-1">
          <NodeViewContent
            className={cn(
              'min-h-[1.4em] outline-none',
              CONTENT_STYLE[kind],
              'empty:before:pointer-events-none empty:before:text-faint/40 empty:before:content-[attr(data-placeholder)]'
            )}
            data-placeholder={t(`placeholder.${kind}`)}
          />

          {paletteQuery !== null && (
            <SlashPalette filter={paletteQuery} showAgent={aiEnabled} onSelect={selectKind} onAgent={selectAgent} onClose={closePalette} />
          )}

          {atQuery !== null && (
            <AtPalette
              anchorRef={nodeContentRef}
              query={atQuery}
              candidates={candidates}
              onSelect={handleAtSelect}
              onClose={() => setAtEscaped(true)}
            />
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

// ── TipTap extensions ─────────────────────────────────────────────────────────

const FountainDoc = Document.extend({
  content: 'fountainBlock+'
})

const FountainBlock = TiptapNode.create({
  name: 'fountainBlock',
  group: 'block',
  content: 'inline*',

  addAttributes() {
    return {
      kind: { default: 'narration' },
      speaker: { default: '' },
      mood: { default: '' }, // speech cue's parenthetical ("angrily"); '' = neutral. Persisted in the node so
      //                        the block round-trip never strips the mood the author wrote in source.
      start: { default: '' }, // timing tag in/out (`[00:01:23 → 00:01:27]`), any block kind. Persisted like mood so
      end: { default: '' } //    the round-trip never strips the timecodes the author wrote in source.
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-fountain-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-fountain-block': HTMLAttributes.kind, ...HTMLAttributes }, 0]
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state
        const node = selection.$from.parent
        if (node.type.name !== 'fountainBlock') return false
        const text = node.textContent

        // @name shorthand: convert block to speech on Enter
        const atName = text.match(/^@([\w\s'-]+)$/)
        if (atName) {
          const name = atName[1].trim().toUpperCase()
          const pos = selection.$from.before(selection.$from.depth)
          editor.commands.command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { kind: 'speech', speaker: name })
            tr.delete(pos + 1, pos + 1 + node.content.size)
            return true
          })
          return true
        }

        // Normal Enter: SPLIT at the caret. The tail (anything after the cursor) moves into a new block below,
        // instead of leaving all the text behind and opening an empty block. A mid-block split keeps THIS block's
        // kind + speaker, so splitting a line of dialogue leaves both halves as that speaker's speech; when there's
        // no tail (caret at the block's end) we open a fresh narration block, as before (finish a beat → prose).
        const afterPos = selection.$from.after(selection.$from.depth)
        const contentEnd = afterPos - 1 // end of this block's content (before its closing token)
        const { from, to } = selection
        const splitting = to < contentEnd // there is text after the selection to carry down
        return editor.commands.command(({ tr, state }) => {
          const nodeType = state.schema.nodes.fountainBlock
          const tail = splitting ? state.doc.slice(to, contentEnd).content : undefined
          const newNode = nodeType.create(splitting ? { ...node.attrs } : { kind: 'narration', speaker: '' }, tail)
          if (to > from || splitting) tr.delete(from, contentEnd) // drop the selection + tail from the original block
          const insertAt = tr.mapping.map(afterPos) // where the block now ends after that delete
          tr.insert(insertAt, newNode)
          tr.setSelection(TextSelection.create(tr.doc, insertAt + 1)) // caret at the head of the new block
          return true
        })
      },

      // Backspace at the very START of a block MERGES it into the block above, keeping the ABOVE block's kind +
      // speaker (Notion-like) — so dialogue backspaced at its head joins the speaker block above and becomes that
      // speaker's line. ProseMirror's default instead DELETES an empty block above (and even `tr.join` drops an
      // empty above-block rather than appending into it), so we do the merge EXPLICITLY: copy this block's content
      // to the end of the block above, then delete this block. Deterministic whether the above block is empty or
      // not. Falls through (return false) mid-block or at the first block.
      Backspace: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== 'fountainBlock') return false
        const blockStart = $from.before($from.depth) // start of THIS block
        const prev = state.doc.resolve(blockStart).nodeBefore
        if (!prev || prev.type.name !== 'fountainBlock') return false
        const cur = $from.parent
        return editor.commands.command(({ tr, dispatch }) => {
          if (!dispatch) return true
          const prevContentEnd = blockStart - 1 // inside the block above, at the end of its content (before its close)
          const curFrom = blockStart + 1 // this block's content start
          const curTo = blockStart + cur.nodeSize - 1 // this block's content end
          if (curTo > curFrom) tr.insert(prevContentEnd, state.doc.slice(curFrom, curTo).content) // append our content into the above
          tr.delete(tr.mapping.map(blockStart), tr.mapping.map(blockStart + cur.nodeSize)) // then remove this (now-copied) block
          tr.setSelection(TextSelection.create(tr.doc, prevContentEnd)) // caret at the seam (head of the moved text)
          return true
        })
      }
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(FountainBlockView)
  }
})

// ── BlockEditor component ─────────────────────────────────────────────────────

export function BlockEditor({ registerApply, jumpTo }: { registerApply?: (fn: ((text: string, mode: PageEditMode) => void) | null) => void; jumpTo?: { line: number; seq: number } }): JSX.Element {
  const { t } = useTranslation('blockEditor')
  const body = useWorkspace((s) => s.body)
  const raw = useWorkspace((s) => s.raw)
  const setBody = useWorkspace((s) => s.setBody)
  const saveScene = useWorkspace((s) => s.saveScene)
  const activePage = useWorkspace((s) => s.activePage)
  // Frontmatter height (raw = frontmatter + body) — computed ONCE, shared into every block's gutter line number.
  const fmOffset = useMemo(() => Math.max(0, raw.split('\n').length - body.split('\n').length), [raw, body])

  const prevPath = useRef(activePage?.path)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Suppress the next sync after a programmatic content reload
  const suppressSync = useRef(false)

  // In-scene find (⌘F) — the scene Write view is ProseMirror, so its search is the SceneSearch decoration plugin
  // driven from here. `find` mirrors the plugin's count/index for the bar; refreshed after each query/step.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [find, setFind] = useState({ count: 0, active: 0 })
  const findRef = useRef<HTMLInputElement>(null)

  // Cmd+S / Ctrl+S save — via the shared saveTarget stack (AppShell owns the keybinding)
  useSaveTarget(true, () => void saveScene())

  const editor = useEditor({
    immediatelyRender: true,
    // No native browser spell/grammar squiggles — scene prose is stylised (cues, invented names, in-world
    // terms) so the red underlines are all false positives and just add noise. Stamped on the contenteditable.
    editorProps: { attributes: { spellcheck: 'false' } },
    extensions: [
      FountainDoc,
      FountainBlock,
      SceneSearch,
      StarterKit.configure({
        document: false,
        paragraph: false,
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        link: false,
        underline: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false
        // keeps: text, bold, italic, hardBreak, undoRedo
      })
    ],
    content: bodyToContent(body),
    onUpdate: ({ editor: ed }) => {
      if (suppressSync.current) {
        suppressSync.current = false
        return
      }
      // Editing the scene under an OPEN search: the SceneSearch plugin re-finds on every doc change, so mirror its
      // FRESH count/index into React (which also re-renders the minimap) — otherwise the bar shows a stale total
      // and next/prev + markers point at text that was just deleted. Gated on a live query (non-search typing
      // keeps its single debounced update) and bails when nothing changed, so it doesn't re-render each keystroke.
      const s = getSceneSearch(ed.state)
      if (s.query) setFind((prev) => (prev.count === s.count && prev.active === s.active ? prev : { count: s.count, active: s.active }))
      if (syncTimer.current) clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(() => {
        setBody(contentToBody(ed.getJSON()))
      }, 400)
    }
  })

  // Reload content when the active page changes
  useEffect(() => {
    if (!editor || activePage?.path === prevPath.current) return
    prevPath.current = activePage?.path
    suppressSync.current = true
    editor.commands.setContent(bodyToContent(body))
  }, [activePage?.path, body, editor])

  // Expose an apply fn for the Tasks-inbox: land an agent edit as ONE TipTap transaction (native undo)
  // AND write it straight to the store body so it persists across tab/view switches (the old Source-CM
  // path was read-only with no sync → edits reverted). Append adds to the end; replace rewrites the page.
  useEffect(() => {
    if (!editor || !registerApply) return
    registerApply((text, mode) => {
      const cur = contentToBody(editor.getJSON())
      const newBody = mode === 'replace' ? text : (cur.trim() ? cur + '\n\n' : '') + text
      suppressSync.current = true
      // selectAll + insertContent replaces the doc as ONE history-tracked transaction (undoable);
      // `setContent` would load it without an undo entry — which is why Replace couldn't be undone.
      editor.chain().selectAll().insertContent(bodyToContent(newBody).content ?? []).run()
      setBody(newBody)
    })
    return () => registerApply(null)
  }, [editor, registerApply, setBody])

  const syncFind = (): void => { if (editor) { const s = getSceneSearch(editor.state); setFind({ count: s.count, active: s.active }) } }
  // Setting a query jumps to the first hit (scrollToActive) — not just highlight — matching a browser find.
  const runFind = (q: string): void => { setFindQuery(q); if (editor) { setSceneSearch(editor, q); syncFind(); scrollToActive(editor) } }
  const stepFind = (dir: 1 | -1): void => { if (editor) { stepSceneSearch(editor, dir); syncFind() } }
  const openFind = (): void => { setFindOpen(true); requestAnimationFrame(() => { findRef.current?.focus(); findRef.current?.select() }) }
  const closeFind = (): void => { setFindOpen(false); if (editor) setSceneSearch(editor, ''); editor?.commands.focus() }

  const onContainerKey = (e: React.KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') { e.preventDefault(); openFind() }
  }

  // Line-number map for the Write gutter — recomputed once per doc change (DEBOUNCED; the numbers are hover-only, so
  // they don't need to be live), and kept as a STABLE reference across text edits (line no.s only move structurally)
  // so the context never re-renders every block on a keystroke.
  const [mapVer, setMapVer] = useState(0)
  useEffect(() => {
    if (!editor) return
    let t: ReturnType<typeof setTimeout> | null = null
    const bump = (): void => { if (t) clearTimeout(t); t = setTimeout(() => setMapVer((v) => v + 1), 200) }
    editor.on('update', bump)
    setMapVer((v) => v + 1) // initial (content just mounted)
    return () => { editor.off('update', bump); if (t) clearTimeout(t) }
  }, [editor])
  const lineMapRef = useRef<LineMap>(new Map())
  const lineMap = useMemo(() => {
    if (!editor) return lineMapRef.current
    const next = computeLineMap(editor.state.doc, fmOffset)
    if (lineMapsEqual(lineMapRef.current, next)) return lineMapRef.current // stable ref → no per-keystroke churn
    lineMapRef.current = next
    return next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, mapVer, fmOffset])

  // Linter "Line N" → jump: find the block whose start line is the greatest ≤ target, scroll it to center and
  // flash it red (`.lint-jump-flash`). Retries a few frames because a freshly-mounted view (Source/Preview →
  // Write) needs one to lay out. `seq` bumps per click so re-clicking the same issue re-jumps.
  useEffect(() => {
    if (!editor || !jumpTo) return
    let raf = 0
    let tries = 0
    const go = (): void => {
      let pos: number | null = null
      let best = -1
      for (const [p, ln] of lineMapRef.current) if (ln <= jumpTo.line && ln > best) { best = ln; pos = p }
      const dom = pos != null ? editor.view.nodeDOM(pos) : null
      if (dom instanceof HTMLElement) {
        dom.scrollIntoView({ behavior: 'smooth', block: 'center' })
        dom.classList.add('lint-jump-flash')
        window.setTimeout(() => dom.classList.remove('lint-jump-flash'), 1600)
        return
      }
      if (tries++ < 40) raf = requestAnimationFrame(go)
    }
    raf = requestAnimationFrame(go)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.seq])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onContainerKey}>
      {findOpen && (
        <>
          <FindBar
            ref={findRef}
            query={findQuery}
            count={find.count}
            active={find.active}
            onQueryChange={runFind}
            onNext={() => stepFind(1)}
            onPrev={() => stepFind(-1)}
            onClose={closeFind}
            placeholder={t('find')}
          />
          {editor && <SearchMinimap markers={sceneMarkers(editor)} onJump={(i) => { gotoSceneSearch(editor, i); syncFind() }} />}
        </>
      )}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onMouseMove={(e) => {
          const el = e.currentTarget
          const r = el.getBoundingClientRect()
          el.classList.toggle('reveal-linenums', e.clientX - r.left < r.width * 0.3) // numbers fade in near the left edge
        }}
        onMouseLeave={(e) => e.currentTarget.classList.remove('reveal-linenums')}
      >
        <div className="mx-auto max-w-[var(--measure)] py-8">
          <LineMapContext.Provider value={lineMap}>
            <EditorContent
              editor={editor}
              className="outline-none [&_.ProseMirror]:outline-none"
            />
          </LineMapContext.Provider>
        </div>
      </div>
    </div>
  )
}
