/**
 * Global quick-open — the TitleBar search + Ctrl/Cmd+P palette. Searches every class of data already in the
 * store (scenes · world pages · custody topics · threads · entities · lore topics · coherence findings · chart
 * sequences); fully client-side, no IPC. Selecting a hit routes to the right workspace and opens/selects it:
 * scene → editor, world → world, custody → custody, thread/entity/lore → the Threads workspace's tab + float,
 * finding → coherence, sequence → timeline config (and activates it). Keyboard: ↑/↓ move, Enter opens, Esc closes.
 */
import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, FileText, Globe, Users, Spline, Package, ShieldAlert, KeyRound, ScrollText, Route, CornerDownLeft } from 'lucide-react'
import { regionAttrs } from '@/config/regions'
import { HOTKEYS } from '@/config/hotkeys'
import { useModalOpen } from '@/lib/editor/escapeStack'
import { useWorkspace } from '@/stores/workspace'
import { variantSequences } from '@/lib/timeline/treeVariant'
import { cn } from '@/lib/utils'
import type { ContentMatch } from '@shared/ipc'

// 'Content' is the async full-text section (searchContent IPC over prose bodies) — the others are client-side
// metadata (titles/names). Content isn't in GROUP_ORDER because it never shows on an empty (browse) query.
type Group = 'Scenes' | 'World' | 'Custody' | 'Threads' | 'Entities' | 'Lore' | 'Coherence' | 'Sequences' | 'Content'
const GROUP_ORDER: Group[] = ['Scenes', 'World', 'Custody', 'Threads', 'Entities', 'Lore', 'Coherence', 'Sequences']
const PER_GROUP = 8 // cap each group so a big project can't paint thousands of rows

interface Hit {
  key: string
  group: Group
  icon: ReactNode
  title: string
  subtitle: string
  detail?: ReactNode // content hits: the full-width highlighted prose snippet, rendered under the title
  run: () => void
}

/** slug/key → human words: "ghost_apparition" → "Ghost Apparition". */
function humanize(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Wrap every case-insensitive occurrence of `q` in `text` with a highlight mark (nelfuma/fumadocs-style) so the
 *  matched term stands out in titles and content snippets. Returns the plain string when `q` is empty/absent. */
function highlight(text: string, q: string): ReactNode {
  const needle = q.trim()
  if (!needle) return text
  const out: ReactNode[] = []
  const lower = text.toLowerCase()
  const nl = needle.toLowerCase()
  let i = 0
  let k = 0
  while (i < text.length) {
    const at = lower.indexOf(nl, i)
    if (at < 0) { out.push(text.slice(i)); break }
    if (at > i) out.push(text.slice(i, at))
    out.push(<mark key={k++} className="rounded-sm bg-lore/25 text-foreground">{text.slice(at, at + needle.length)}</mark>)
    i = at + needle.length
  }
  return out
}

/**
 * Fuzzy subsequence score of `q` against `text` — higher is better, `null` if `q`'s chars don't appear in
 * order. Tiered so intent ranks right: prefix > contiguous substring > scattered subsequence (the last is what
 * saves a misspelled "tignari" → "Tighnari" — the dropped letters just widen the gaps). `q` must be lowercased.
 */
function fuzzyScore(q: string, text: string): number | null {
  if (!q) return 0
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 1000 - t.length
  const sub = t.indexOf(q)
  if (sub !== -1) return 600 - sub * 2 - t.length
  let ti = 0
  let score = 0
  let prev = -2
  for (const c of q) {
    const f = t.indexOf(c, ti)
    if (f === -1) return null
    score += f === prev + 1 ? 12 : 8 // contiguous run beats a scattered one
    if (f === 0 || /[\s_\-·/]/.test(t[f - 1])) score += 6 // landed on a word boundary
    score -= Math.min(f - ti, 4) // small penalty for how far it had to skip
    prev = f
    ti = f + 1
  }
  return score - t.length * 0.1 // tie-break toward tighter targets
}

export function CommandPalette(): JSX.Element | null {
  const { t } = useTranslation('commandPalette')
  const open = useWorkspace((s) => s.searchOpen)
  const setOpen = useWorkspace((s) => s.setSearchOpen)
  const scenes = useWorkspace((s) => s.scenes)
  const worldPages = useWorkspace((s) => s.worldPages)
  const threads = useWorkspace((s) => s.threads)
  const entities = useWorkspace((s) => s.entityTracks)
  const coherence = useWorkspace((s) => s.coherence)
  const custodyTopics = useWorkspace((s) => s.custodyTopics)
  const loreView = useWorkspace((s) => s.loreView)
  const chartSequences = variantSequences(useWorkspace((s) => s.trees)).sequences
  const openPage = useWorkspace((s) => s.openPage)
  const setWorkspace = useWorkspace((s) => s.setWorkspace)
  const setSelectedThread = useWorkspace((s) => s.setSelectedThread)
  const setSelectedEntity = useWorkspace((s) => s.setSelectedEntity)
  const setSelectedFinding = useWorkspace((s) => s.setSelectedFinding)
  const setSelectedLore = useWorkspace((s) => s.setSelectedLore)
  const setThreadsTab = useWorkspace((s) => s.setThreadsTab)
  const setActiveChartSequence = useWorkspace((s) => s.setActiveChartSequence)
  const setTimelineTab = useWorkspace((s) => s.setTimelineTab)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [content, setContent] = useState<ContentMatch[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Full-text CONTENT search — the one section that hits the engine (greps prose bodies). Debounced so typing
  // doesn't fire a file-read per keystroke; cleared under 2 chars. Kept separate from the client-side fuzzy
  // metadata search: content matches are already substring-filtered by the backend, so they bypass fuzzyScore.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setContent([]); return }
    let live = true
    const t = setTimeout(() => {
      void window.nvs.searchContent?.(q).then((r) => { if (live) setContent(r) }).catch(() => { if (live) setContent([]) })
    }, 160)
    return () => { live = false; clearTimeout(t) }
  }, [query])

  useModalOpen(open) // floats defer their Esc while the palette is up

  // Global open key — ⌘/Ctrl+K (primary) or ⌘/Ctrl+P (alias; preventDefault also kills Chromium's Print).
  // Works everywhere (no project gate) — it just shows no hits until a work is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && HOTKEYS.search.codes.includes(e.code)) {
        e.preventDefault()
        const st = useWorkspace.getState()
        st.setSearchOpen(!st.searchOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Fresh query + focus each time it opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const close = (): void => setOpen(false)

  const all = useMemo<Hit[]>(() => {
    const after = (fn: () => void): (() => void) => () => {
      fn()
      setOpen(false)
    }
    const hits: Hit[] = []
    for (const s of scenes)
      hits.push({
        key: `scene:${s.sceneId}`,
        group: 'Scenes',
        icon: <FileText className="size-3.5 shrink-0 text-faint" />,
        title: s.title,
        subtitle: s.chapter || s.relPath,
        run: after(() => {
          void openPage({ path: s.path, title: s.title, kind: 'scene' })
          setWorkspace('editor')
        })
      })
    for (const p of worldPages)
      hits.push({
        key: `world:${p.id}`,
        group: 'World',
        icon:
          p.kind === 'character' ? (
            <Users className="size-3.5 shrink-0 text-character" />
          ) : (
            <Globe className="size-3.5 shrink-0 text-lore" />
          ),
        title: p.name,
        subtitle: humanize(p.kind),
        run: after(() => {
          void openPage({ path: p.path, title: p.name, kind: p.kind })
          setWorkspace('world')
        })
      })
    for (const c of custodyTopics)
      hits.push({
        key: `custody:${c.pageId}`,
        group: 'Custody',
        icon: <KeyRound className="size-3.5 shrink-0 text-lore" />,
        title: c.name,
        subtitle: `${c.topic} · ${t('checkpoints', { count: c.records.length })}`,
        // openPage(kind: custody) routes to the Custody workspace AND selects the topic page.
        run: after(() => void openPage({ path: c.path, title: c.name, kind: 'custody' }))
      })
    for (const t of threads ?? [])
      hits.push({
        key: `thread:${t.id}`,
        group: 'Threads',
        icon: <Spline className="size-3.5 shrink-0 text-thread" />,
        title: t.title || humanize(t.slug),
        subtitle: `${t.type} · ${t.status}`,
        run: after(() => {
          setWorkspace('threads')
          setThreadsTab('thread') // resets selection — so select AFTER
          setSelectedThread(t.id)
        })
      })
    for (const e of entities ?? [])
      hits.push({
        key: `entity:${e.id}`,
        group: 'Entities',
        icon: <Package className="size-3.5 shrink-0 text-lore" />,
        title: e.name,
        subtitle: humanize(e.type),
        run: after(() => {
          setWorkspace('threads')
          setThreadsTab('entity') // resets selection — so select AFTER
          setSelectedEntity(e.id)
        })
      })
    for (const lt of loreView?.topics ?? [])
      hits.push({
        key: `lore:${lt.loreId}`,
        group: 'Lore',
        icon: <ScrollText className="size-3.5 shrink-0 text-lore" />,
        title: humanize(lt.label),
        subtitle: `${t('disclosures', { count: lt.disclosures.length })}${lt.hasRetcon ? ` · ${t('paradox')}` : ''}`,
        run: after(() => {
          setWorkspace('threads')
          setThreadsTab('lore') // resets selection — so select AFTER
          setSelectedLore(lt.loreId)
        })
      })
    // Resolve a finding's entityId → a display name (its subject) so findings are searchable BY character.
    const nameOf = new Map<string, string>()
    for (const p of worldPages) nameOf.set(p.id, p.name)
    for (const e of entities ?? []) nameOf.set(e.id, e.name)
    for (const f of coherence ?? []) {
      if (f.kind === 'confirmation') continue // confirmations are "all clear" — not a navigation target
      const subject = (f.entityId && nameOf.get(f.entityId)) || null
      hits.push({
        key: `finding:${f.id}`,
        group: 'Coherence',
        icon: <ShieldAlert className="size-3.5 shrink-0 text-flag" />,
        title: f.trait,
        subtitle: [subject, humanize(f.kind), f.severity].filter(Boolean).join(' · '),
        run: after(() => {
          setWorkspace('coherence')
          setSelectedFinding(f.id) // opens the app-level CoherenceDetailFloat
        })
      })
    }
    for (const seq of chartSequences ?? [])
      hits.push({
        key: `seq:${seq.id}`,
        group: 'Sequences',
        icon: <Route className="size-3.5 shrink-0 text-thread" />,
        title: seq.name,
        subtitle: `${t('chartAxis')} · ${t('sceneCount', { count: seq.path.length })}`,
        run: after(() => {
          void setActiveChartSequence(seq.id)
          setTimelineTab('config')
          setWorkspace('timeline')
        })
      })
    return hits
  }, [t, scenes, worldPages, custodyTopics, threads, entities, loreView, coherence, chartSequences, openPage, setWorkspace, setThreadsTab, setSelectedThread, setSelectedEntity, setSelectedFinding, setSelectedLore, setActiveChartSequence, setTimelineTab, setOpen])

  // Fuzzy-rank into sections. Each hit scores by the best of its title / subtitle (subtitle penalized so a
  // title match wins); non-matches drop. Within a group, sort by score; then order the GROUPS by their best
  // single hit so index 0 is the globally top match. Empty query → plain browse in the fixed GROUP_ORDER.
  const sections = useMemo<{ group: Group; rows: Hit[] }[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return GROUP_ORDER.map((g) => ({ group: g, rows: all.filter((h) => h.group === g).slice(0, PER_GROUP) })).filter((s) => s.rows.length)
    }
    const byGroup = new Map<Group, { hit: Hit; score: number }[]>()
    for (const h of all) {
      const ts = fuzzyScore(q, h.title)
      const ss = fuzzyScore(q, h.subtitle)
      const score = Math.max(ts ?? -Infinity, ss != null ? ss - 40 : -Infinity)
      if (score === -Infinity) continue
      const arr = byGroup.get(h.group) ?? []
      arr.push({ hit: h, score })
      byGroup.set(h.group, arr)
    }
    return [...byGroup.entries()]
      .map(([group, arr]) => {
        arr.sort((a, b) => b.score - a.score)
        return { group, rows: arr.slice(0, PER_GROUP).map((s) => s.hit), best: arr[0].score }
      })
      .sort((a, b) => b.best - a.best)
      .map(({ group, rows }) => ({ group, rows }))
  }, [all, query])

  // Content hits → the async "Content" section, appended AFTER the fuzzy metadata sections so exact title
  // matches still lead. World hits resolve their precise page kind from the store (backend returns coarse 'world').
  const worldByPath = useMemo(() => new Map(worldPages.map((p) => [p.path, p])), [worldPages])
  const contentSection = useMemo<{ group: Group; rows: Hit[] } | null>(() => {
    if (!content.length) return null
    const q = query.trim()
    const rows: Hit[] = content.map((m) => ({
      key: `content:${m.path}`,
      group: 'Content',
      icon: <FileText className="size-3.5 shrink-0 text-faint" />,
      title: m.title,
      subtitle: m.count > 1 ? t('matches', { count: m.count }) : t('lineNo', { line: m.line }),
      detail: highlight(m.snippet, q), // the prose snippet with the matched term marked (nelfuma-style)
      run: () => {
        setOpen(false)
        if (m.kind === 'scene') { void openPage({ path: m.path, title: m.title, kind: 'scene' }); setWorkspace('editor') }
        else if (m.kind === 'custody') void openPage({ path: m.path, title: m.title, kind: 'custody' })
        else { void openPage({ path: m.path, title: m.title, kind: worldByPath.get(m.path)?.kind ?? 'character' }); setWorkspace('world') }
      }
    }))
    return { group: 'Content', rows }
  }, [t, content, query, worldByPath, openPage, setWorkspace, setOpen])

  const rendered = useMemo(() => (contentSection ? [...sections, contentSection] : sections), [sections, contentSection])
  const flat = useMemo<Hit[]>(() => rendered.flatMap((s) => s.rows), [rendered])

  // Keep the active row in range as results shrink, and scroll it into view.
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, flat.length - 1))), [flat.length])
  useEffect(() => {
    listRef.current?.querySelector('[data-on="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      flat[active]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  if (!open) return null

  let idx = -1 // flat index across groups, matching `flat`
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" onMouseDown={close}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        {...regionAttrs('commandPalette')}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKey}
            placeholder={t('placeholder')}
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
          />
          <kbd className="shrink-0 rounded border border-border px-1 text-[10px] text-faint">Esc</kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-auto py-1">
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              {all.length === 0 ? t('empty.noContent') : t('empty.noMatches')}
            </p>
          ) : (
            rendered.map(({ group: g, rows }) => {
              if (!rows.length) return null
              return (
                <div key={g}>
                  <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{t(`group.${g.toLowerCase()}`)}</div>
                  {rows.map((h) => {
                    idx++
                    const myIdx = idx
                    const on = myIdx === active
                    return (
                      <button
                        key={h.key}
                        data-on={on ? '1' : undefined}
                        onMouseEnter={() => setActive(myIdx)}
                        onClick={h.run}
                        className={cn(
                          'flex w-full items-start gap-2 px-3 py-1.5 text-left text-[13px]',
                          on ? 'bg-panel-soft' : 'hover:bg-panel-soft/60'
                        )}
                      >
                        <span className="mt-0.5 shrink-0">{h.icon}</span>
                        <span className="min-w-0 flex-1">
                          {/* title (query-highlighted) + a right-aligned meta; content hits add the prose snippet below */}
                          <span className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate text-foreground/90">{highlight(h.title, query)}</span>
                            <span className="shrink-0 text-[10px] text-faint">{h.subtitle}</span>
                          </span>
                          {h.detail && <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-muted-foreground">{h.detail}</span>}
                        </span>
                        {on && <CornerDownLeft className="mt-0.5 size-3 shrink-0 text-faint" />}
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
