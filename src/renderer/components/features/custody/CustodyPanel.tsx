/**
 * CustodyRail — the authored possession/revelation chart (internal/secret-lifecycle.md v2, Stage 1).
 *
 * THE CHART RENDERS AUTHORED ONLY: a custody topic page's `## Timeline` is the single source — the rail
 * draws exactly those checkpoints, deterministically. No LLM interpretation in the chart, ever. Extraction
 * is demoted to the edges: the "From analysis" sidebar section lists UNPAGED objects the tables know about
 * (the discovery tray); selecting one shows extraction's reading behind a banner, and **Create page**
 * drafts a topic page from those events — deterministically (event rows → timeline lines, no LLM) — which
 * the author then owns and edits.
 *
 * Two algebras, visually self-labeling: item topics render as a BATON (held-by: one holder per checkpoint,
 * segments between); information topics as a CONTAGION (known-by: lanes fill and stay lit; `reader` is a
 * first-class lane, `public` floods). Purpose: the author learns the AUDIENCE EXPERIENCE.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AlertTriangle, Box, Eye, FilePlus2, Globe, KeyRound, Loader2, MapPin, Package, Plus, Save, ScrollText, Sparkles, Trash2, Users } from 'lucide-react'
import { ContextMenuShell } from '@/components/layout/RailContextMenu'
import { EmptyRailState, SidebarEmpty } from '@/components/ui/EmptyRailState'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { SplitDialog } from '@/components/ui/SplitDialog'
import { ConfirmDialog } from '@/components/ui/confirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/Select'
import { HelpSection, HelpTable, HelpList } from '@/components/ui/help'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { regionAttrs } from '@/config/regions'
import { SearchField } from '@/components/ui/SearchField'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { DetailedRow, SidebarHeader, SidebarScroll, SidebarLabel } from '@/components/layout/SidebarKit'
import { LifecycleGantt, deriveWrapLevels, sceneVolumes, type GanttRow } from '@/components/features/custody/LifecycleGantt'
import { useSceneAxis } from '@/lib/timeline/sceneAxis'
import { useGanttWindow, paginate } from '@/lib/timeline/ganttWindow'
import { RailScaleBar } from '@/components/layout/RailScaleBar'
import { RailChrome } from '@/components/layout/RailChrome'
import { WikiPreview } from '@/components/editor/PreviewPane'
import { PageReadDialog } from '@/components/dialogs/PageReadDialog'
import { PageShell } from '@/components/page/PageShell'
import { PAGE_TABS } from '@/components/page/registry'
import { SourceTab } from '@/components/page/SourceTab'
import { ScenePicker } from '@/components/page/ScenePicker'
import { useSaveTarget, useUndoTarget } from '@/lib/editor/saveTarget'
import { schemaFor } from '@/config/worldSchema'
import { BUILTIN_PROMPTS, composeInstruction } from '@shared/config/agentCommands'
import type { CustodyRecord, CustodyTopic, DeclaredSecretInfo, PossessionEvent } from '@shared/ipc'

// ── shared data (sidebar + panel), with a reload for after page creation ───────────────────────────────
interface PossessionData {
  topics: CustodyTopic[]
  custody: PossessionEvent[]
  secrets: PossessionEvent[]
  roster: DeclaredSecretInfo[]
  ready: boolean
  reload: () => void
}
function usePossessionData(): PossessionData {
  const project = useWorkspace((s) => s.project)
  // the tick lives in the STORE so the sidebar's save/create refreshes the panel too (they are separate
  // component instances — a local tick left the panel stale and topics fell through to the unpaged branch)
  const tick = useWorkspace((s) => s.custodyTick)
  const reload = useWorkspace((s) => s.bumpCustody)
  const [state, setState] = useState<Omit<PossessionData, 'reload'>>({ topics: [], custody: [], secrets: [], roster: [], ready: false })
  useEffect(() => {
    if (!project) return
    let alive = true
    void Promise.all([
      window.nvs.listCustodyTopics?.() ?? [],
      window.nvs.listCustodyEvents?.() ?? [],
      window.nvs.listSecretEvents?.() ?? [],
      window.nvs.listDeclaredSecrets?.() ?? []
    ])
      .then(([topics, custody, secrets, roster]) => alive && setState({ topics, custody, secrets, roster, ready: true }))
      .catch(() => alive && setState((s) => ({ ...s, ready: true })))
    return () => {
      alive = false
    }
  }, [project, tick])
  return { ...state, reload }
}

/** Compose deterministic checkpoint RECORDS from existing table events — data, not LLM. */
function recordsFromEvents(kind: 'item' | 'secret', events: PossessionEvent[]): CustodyRecord[] {
  return events.map((e) => {
    const note = (e.description || e.value).replace(/\s+/g, ' ').trim() || null
    if (kind === 'item') {
      if (e.target) return { scene: e.sceneId, event: 'gain' as const, who: [e.target], note }
      return { scene: e.sceneId, event: 'gain' as const, who: ['audience'], note }
    }
    if (e.change === 'expose' && e.target === 'public') return { scene: e.sceneId, event: 'public' as const, who: [], note }
    const who = e.change === 'gain' ? [e.entityId] : e.target ? [e.target] : ['audience']
    return { scene: e.sceneId, event: 'gain' as const, who, note }
  })
}

type Anchor = { id: string; name: string; kind: 'item' | 'information'; cat: string; src?: 'secret' }

// ── sidebar ─────────────────────────────────────────────────────────────────────────────────────────────
export function CustodySidebar(): JSX.Element {
  const { t } = useTranslation('custody')
  const { topics, custody, secrets, roster, ready, reload } = usePossessionData()
  const entityTracks = useWorkspace((s) => s.entityTracks)
  const characters = useWorkspace((s) => s.characters)
  const selection = useWorkspace((s) => s.custodySelection)
  const select = useWorkspace((s) => s.setCustodySelection)
  const openPage = useWorkspace((s) => s.openPage)
  const closeTab = useWorkspace((s) => s.closeTab)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // off → hide the AI-suggest button
  const [anchorQuery, setAnchorQuery] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const aiRequest = useWorkspace((s) => s.custodyAiRequest)
  const setAiRequest = useWorkspace((s) => s.setCustodyAiRequest)
  useEffect(() => {
    if (aiRequest) setAiOpen(true) // e.g. the Records tab's Ask AI button
  }, [aiRequest])
  const [confirmDel, setConfirmDel] = useState<CustodyTopic | null>(null)
  const [creating, setCreating] = useState<string | null>(null)

  const pagedNames = useMemo(() => new Set(topics.map((t) => t.name.toLowerCase())), [topics])
  const unpagedSecrets = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of secrets) if (e.secret) counts.set(e.secret, (counts.get(e.secret) ?? 0) + 1)
    return roster
      .map((r) => ({ ...r, n: counts.get(r.id) ?? 0 }))
      .filter((r) => !pagedNames.has(`[${r.id}]`.toLowerCase()) && !pagedNames.has(r.id.toLowerCase()))
      .sort((a, b) => b.n - a.n)
  }, [secrets, roster, pagedNames])

  async function createPage(kind: 'item' | 'secret', id: string, name: string): Promise<void> {
    setCreating(id)
    try {
      const events = kind === 'item' ? custody.filter((e) => e.entityId === id) : secrets.filter((e) => e.secret === id)
      const pageId = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || id
      const topic = await window.nvs.createCustodyTopic(
        // subject ALWAYS set — it's the diff anchor: item topics anchor to the entity, secret topics to
        // the declared secret id (without it the observed layer can never fire for them)
        { id: pageId, name, topic: kind === 'item' ? 'item' : 'information', subject: id },
        recordsFromEvents(kind, events)
      )
      if (!topic) return
      reload()
      void openPage({ path: topic.path, title: topic.name, kind: 'custody' })
    } finally {
      setCreating(null)
    }
  }

  // "New topic" is ANCHORED: you pick an existing entity (character/item) — free-text topics about
  // nothing (Character3Secret) can't be created. Custody is authored T3: declarations over existing content.
  const [anchorMenu, setAnchorMenu] = useState<{ x: number; y: number } | null>(null)
  const worldPages = useWorkspace((s) => s.worldPages)
  const anchors = useMemo(() => {
    const taken = new Set(topics.map((t) => (t.subject ?? '').toLowerCase()).filter(Boolean))
    const seen = new Set<string>()
    const add = (id: string, name: string, kind: 'item' | 'information', cat: string): Anchor | null => {
      const key = id.toLowerCase()
      if (taken.has(key) || seen.has(key)) return null
      seen.add(key)
      return { id, name, kind, cat }
    }
    // EVERY world category except character/custody anchors a topic (item pages → item topics; location,
    // information, lore, faction, clue… → information topics). Works before any analysis; analysis-discovered
    // items (entityTracks) fill in the unpaged tail.
    const out: Anchor[] = []
    for (const p of worldPages) {
      if (p.kind === 'character' || p.kind === 'custody') continue
      const a = add(p.id, p.name, p.kind === 'item' ? 'item' : 'information', p.kind)
      if (a) out.push(a)
    }
    for (const tr of entityTracks ?? []) if (tr.type === 'item') { const a = add(tr.id, tr.name, 'item', t('sidebar.itemAnalysisCat')); if (a) out.push(a) }
    return out
  }, [t, topics, entityTracks, worldPages])

  async function createAnchored(anchor: Anchor & { trackId?: string }): Promise<void> {
    if (anchor.src === 'secret') return createPage('secret', anchor.id, anchor.name)
    setCreating(anchor.id)
    try {
      const events = anchor.kind === 'item' ? custody.filter((e) => e.entityId === anchor.id || (anchor.trackId && e.entityId === anchor.trackId)) : []
      const pageId = `${anchor.id}-custody`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
      const topic = await window.nvs.createCustodyTopic(
        { id: pageId, name: anchor.name, topic: anchor.kind, subject: anchor.id },
        recordsFromEvents(anchor.kind === 'item' ? 'item' : 'secret', events)
      )
      if (!topic) return
      reload()
      void openPage({ path: topic.path, title: topic.name, kind: 'custody' })
    } finally {
      setCreating(null)
    }
  }

  const filteredAnchors = useMemo(() => {
    const q = anchorQuery.trim().toLowerCase()
    return q ? anchors.filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.cat.toLowerCase().includes(q)) : anchors
  }, [anchors, anchorQuery])
  // Suggestion sources, ranked by analysis activity: world pages without a topic; analysis-discovered
  // items (entity_arc_events grouped by entity); declared ## Secrets (roster + events citing their id).
  const suggestions = useMemo(() => {
    const trackById = new Map((entityTracks ?? []).map((t) => [t.id.toLowerCase(), t]))
    const trackByName = new Map((entityTracks ?? []).map((t) => [t.name.toLowerCase(), t]))
    const fromAnchors = anchors.map((a) => {
      // a world page and an analysis track are often the SAME thing under two ids — link by id or name
      const tr = trackById.get(a.id.toLowerCase()) ?? trackByName.get(a.name.toLowerCase())
      const seedN = a.kind === 'item' ? custody.filter((e) => e.entityId === a.id || (tr && e.entityId === tr.id)).length : 0
      const presence = tr?.scenes.length ?? 0
      return {
        ...a,
        trackId: tr?.id,
        n: seedN * 10 + presence, // rank: seedable possession events dominate, presence breaks ties
        reason:
          seedN > 0
            ? t('sidebar.reason.seedFrom', { count: seedN })
            : presence > 0
              ? t('sidebar.reason.features', { count: presence })
              : t('sidebar.reason.notTracked')
      }
    })
    const fromSecrets = unpagedSecrets.map((r) => ({
      id: r.id,
      name: r.id,
      kind: 'information' as const,
      cat: t('sidebar.declaredSecretCat'),
      src: 'secret' as const,
      n: r.n * 10,
      reason: r.n > 0 ? t('sidebar.reason.scenesTouch', { count: r.n }) : t('sidebar.reason.declaredOn', { owner: r.ownerName })
    }))
    return [...fromAnchors, ...fromSecrets].sort((x, y) => y.n - x.n)
  }, [t, anchors, custody, unpagedSecrets, entityTracks])

  // Standalone topic — no world anchor. The engine takes subject:null fine; it just won't auto-seed from the
  // observed/analysis layer (that's the trade for an unanchored, hand-authored chart).
  async function createBlank(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = trimmed.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'topic'
    setCreating(id)
    try {
      const topic = await window.nvs.createCustodyTopic({ id, name: trimmed, topic: 'information', subject: null }, [])
      if (!topic) return
      reload()
      void openPage({ path: topic.path, title: topic.name, kind: 'custody' })
    } finally {
      setCreating(null)
    }
  }

  // Search miss → declare the information page AND its topic in one move (the PageModel flow)
  async function createInfoAndTopic(name: string): Promise<void> {
    const id = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
    if (!id) return
    const page = await window.nvs.createWorldPage('information', id, { name }, '')
    if (!page) return
    await createAnchored({ id: page.id, name: page.name, kind: 'information', cat: 'information' })
  }

  const row = (
    key: string,
    icon: JSX.Element,
    label: string,
    sub: string,
    right: JSX.Element | null,
    onClick: () => void,
    on: boolean
  ): JSX.Element => (
    <DetailedRow
      key={key}
      active={on}
      icon={icon}
      label={label}
      sub={sub || undefined}
      onClick={onClick}
      title={sub ? `${label} — ${sub}` : label}
      actions={right}
    />
  )

  return (
    <div {...regionAttrs('custodySidebar')} className="flex h-full flex-col bg-panel">
      <SidebarHeader
        title={t('title')}
        action={
          <div className="flex items-center gap-1">
            {aiEnabled && (
              <button
                title={t('sidebar.aiSuggestTip')}
                onClick={() => setAiOpen(true)}
                className="rounded p-0.5 text-faint transition-colors hover:text-lore"
              >
                <Sparkles className="size-3.5" />
              </button>
            )}
            <button
              title={t('sidebar.newTopicTip')}
              onClick={(e) => setAnchorMenu({ x: e.clientX, y: e.clientY })}
              className="rounded p-0.5 text-faint transition-colors hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        }
      />
      {!ready ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : (
        <SidebarScroll className="px-1 pb-2">
          <SidebarLabel count={topics.length}>{t('sidebar.topics')}</SidebarLabel>
          {topics.map((tp) =>
            row(
              `topic:${tp.pageId}`,
              tp.topic === 'item' ? <Box className="size-3.5 shrink-0 text-lore" /> : <KeyRound className="size-3.5 shrink-0 text-lore" />,
              tp.name,
              `${t('sidebar.topicSub', { kind: tp.topic, count: tp.records.length })}${tp.errors.length ? ` · ${tp.errors.length} ⚠` : ''}`,
              <button
                title={t('sidebar.deleteTopicTip')}
                onClick={() => setConfirmDel(tp)}
                className="shrink-0 rounded p-1 text-faint opacity-0 transition-opacity hover:text-flag group-hover/row:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>,
              () => {
                if (selection?.kind === 'topic' && selection.id === tp.pageId) select(null)
                else void openPage({ path: tp.path, title: tp.name, kind: 'custody' })
              },
              selection?.kind === 'topic' && selection.id === tp.pageId
            )
          )}
          {topics.length === 0 && (
            <SidebarEmpty>
              {t('sidebar.emptyTopics.before')} <span className="font-mono">{t('sidebar.emptyTopics.timeline')}</span> {t('sidebar.emptyTopics.mid')}{' '}
              <Plus className="inline size-3" /> {t('sidebar.emptyTopics.after')}
            </SidebarEmpty>
          )}

          {topics.length === 0 && characters.length === 0 && (
            <SidebarEmpty>
              {t('sidebar.emptyStart.before')} <b>{t('sidebar.emptyStart.bold')}</b> {t('sidebar.emptyStart.after')}
            </SidebarEmpty>
          )}
        </SidebarScroll>
      )}
      {anchorMenu && (
        <ContextMenuShell x={anchorMenu.x} y={anchorMenu.y} onClose={() => { setAnchorMenu(null); setAnchorQuery('') }}>
          <div className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{t('sidebar.newTopicHeading')}</div>
          <div className="px-2 pb-1 pt-0.5">
            <SearchField autoFocus value={anchorQuery} onChange={setAnchorQuery} placeholder={t('sidebar.searchPlaceholder')} />
          </div>
          {anchors.length > 0 && <div className="px-3 pb-0.5 text-[10px] text-faint">{t('sidebar.anchorTo')}</div>}
          {filteredAnchors.slice(0, 10).map((a) => (
            <button
              key={a.id}
              onMouseDown={(e) => { e.preventDefault(); setAnchorMenu(null); setAnchorQuery(''); void createAnchored(a) }}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] text-foreground hover:bg-panel-soft"
            >
              {a.kind === 'item' ? <Box className="size-3.5 shrink-0 text-faint" /> : <KeyRound className="size-3.5 shrink-0 text-faint" />}
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="shrink-0 text-[9px] text-faint">{a.cat}</span>
            </button>
          ))}
          {filteredAnchors.length > 10 && <div className="px-3 py-0.5 text-[10px] text-faint">{t('sidebar.moreHint', { count: filteredAnchors.length - 10 })}</div>}
          {anchorQuery.trim() && !filteredAnchors.some((a) => a.name.toLowerCase() === anchorQuery.trim().toLowerCase()) && (
            <div className="mt-0.5 border-t border-border pt-0.5">
              {/* Create-new — a topic never needs a world anchor; you can make a standalone one, or also spin up a
                  world information page to anchor it to. */}
              <button
                onMouseDown={(e) => { e.preventDefault(); setAnchorMenu(null); const q = anchorQuery.trim(); setAnchorQuery(''); void createBlank(q) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-foreground hover:bg-panel-soft"
              >
                <FilePlus2 className="size-3.5 shrink-0 text-lore" />
                <span className="min-w-0 flex-1 truncate">{t('sidebar.newTopicNamed', { name: anchorQuery.trim() })} <span className="text-faint">{t('sidebar.standaloneSuffix')}</span></span>
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); setAnchorMenu(null); const q = anchorQuery.trim(); setAnchorQuery(''); void createInfoAndTopic(q) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-foreground hover:bg-panel-soft"
              >
                <FilePlus2 className="size-3.5 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate">{t('sidebar.andInfo.before')} <span className="text-lore">{t('sidebar.andInfo.link')}</span> {t('sidebar.andInfo.after')}</span>
              </button>
            </div>
          )}
        </ContextMenuShell>
      )}
      <AiSuggestDialog
        open={aiOpen}
        initial={aiRequest ?? undefined}
        onClose={() => {
          setAiOpen(false)
          setAiRequest(null)
        }}
        suggestions={suggestions}
        topics={topics}
        creating={creating}
        custody={custody}
        secrets={secrets}
        onCreate={createAnchored}
        onChanged={reload}
      />
      <ConfirmDialog
        open={confirmDel != null}
        title={t('sidebar.deleteTopicTitle')}
        message={confirmDel ? <>{t('sidebar.deleteMsg.before')} <b>{confirmDel.name}</b>{t('sidebar.deleteMsg.after', { file: confirmDel.path.split('/').pop() })}</> : ''}
        confirmLabel={t('delete')}
        danger
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => {
          const t = confirmDel
          setConfirmDel(null)
          if (!t) return
          void window.nvs.deletePage(t.path).then((ok) => {
            if (!ok) return
            closeTab(t.path)
            if (selection?.kind === 'topic' && selection.id === t.pageId) select(null)
            reload()
          })
        }}
      />
    </div>
  )
}

// ── the panel ──────────────────────────────────────────────────────────────────────────────────────────
type Lane = {
  kind?: string // world category of the who — drives the gutter icon/accent + lane sort
  key: string
  label: string
  fills: { from: number; to: number; faint?: boolean; tone?: 'mystery' | 'suspense' }[]
  marks: { col: number; kind: 'handoff' | 'slip' | 'public' | 'ghost'; title: string }[]
}


type Resolved = { key: string; label: string; kind?: string }

function makeResolveWho(t: TFunction, characters: { id: string; name: string }[], worldPages: { id: string; name: string; kind: string }[] = []): (tok: string) => Resolved {
  const pages = new Map<string, { name: string; kind: string }>()
  for (const p of worldPages) {
    pages.set(p.id.toLowerCase(), { name: p.name, kind: p.kind })
    pages.set(p.name.toLowerCase(), { name: p.name, kind: p.kind })
  }
  const byId = new Map(characters.map((c) => [c.id.toLowerCase(), c.name]))
  const byName = new Map(characters.map((c) => [c.name.toLowerCase(), c.name]))
  return (tok) => {
    if (tok === 'reader') return { key: '__reader', label: t('lanes.reader') }
    if (tok === 'audience') return { key: '__audience', label: t('lanes.audience') }
    if (tok === 'public') return { key: '__public', label: t('lanes.public') }
    const lc = tok.toLowerCase()
    const page = pages.get(lc)
    if (page) return { key: page.name.toLowerCase(), label: page.name, kind: page.kind }
    const label = byId.get(lc) ?? byName.get(lc) ?? tok
    return { key: label.toLowerCase(), label, kind: byId.has(lc) || byName.has(lc) ? 'character' : undefined }
  }
}

// world-kind → icon/accent (from WORLD_SCHEMA), for lane gutters and who-badges
const KIND_ICONS: Record<string, typeof Users> = { Users, MapPin, Package, ScrollText, KeyRound }
function kindBadge(kind: string | undefined): { Icon: typeof Users; accent: string } | null {
  if (!kind) return null
  const sc = schemaFor(kind)
  if (!sc) return null
  return { Icon: KIND_ICONS[sc.icon] ?? KeyRound, accent: sc.accent }
}
const KIND_ORDER = ['character', 'item', 'information', 'location', 'faction', 'lore']

/** The authored fold — records → lanes. Shared by the panel's chart and the AI dialog's hypothetical
 *  preview. GRAMMAR v2: gain opens a span, lost closes it, public floods. On an ITEM topic a character's
 *  gain CLOSES every other character's span (possession is exclusive — the baton emerges); the specials
 *  (audience) ride alongside as knowledge. `scene: start` = column 0, true before page one. */
function foldTopicRecords(t: TFunction, recordsIn: CustodyRecord[], kind: 'item' | 'information', colOf: Map<string, number>, lastCol: number, resolveWho: (tok: string) => Resolved): Lane[] {
  const recs = recordsIn
    .map((r) => ({ ...r, col: r.scene === 'start' ? 0 : colOf.get(r.scene) }))
    .filter((r): r is typeof r & { col: number } => r.col != null)
  recs.sort((a, b) => a.col - b.col)
  let publicAt: number | null = null
  const lanes = new Map<string, { label: string; kind?: string; spans: { from: number; to: number }[]; open: number | null; marks: Lane['marks'] }>()
  const laneFor = (w: Resolved) => {
    if (!lanes.has(w.key)) lanes.set(w.key, { label: w.label, kind: w.kind, spans: [], open: null, marks: [] })
    return lanes.get(w.key)!
  }
  const isSpecial = (key: string): boolean => key.startsWith('__')
  const close = (l: { spans: { from: number; to: number }[]; open: number | null }, col: number): void => {
    if (l.open != null) {
      l.spans.push({ from: l.open, to: Math.max(l.open, col - 1) })
      l.open = null
    }
  }
  for (const r of recs) {
    if (r.event === 'public') {
      publicAt = publicAt ?? r.col
      continue
    }
    if (r.event === 'gain') {
      const whos = r.who.map(resolveWho)
      // the baton: on an item, a character taking it takes it FROM whoever had it — one record, no double-entry
      if (kind === 'item' && whos.some((w) => !isSpecial(w.key)))
        for (const [key, l] of lanes) {
          if (isSpecial(key) || whos.some((w) => w.key === key)) continue
          close(l, r.col)
        }
      for (const w of whos) {
        const l = laneFor(w)
        if (l.open == null) l.open = r.col
        l.marks.push({ col: r.col, kind: 'handoff', title: r.note || (kind === 'item' && !isSpecial(w.key) ? t('marks.takes') : t('marks.learns')) })
      }
    }
    if (r.event === 'lost') {
      if (r.who.length === 0) {
        // an item destroyed/vanished: nobody holds it from here (specials keep KNOWING it existed)
        for (const [key, l] of lanes) {
          if (isSpecial(key)) continue
          close(l, r.col)
          l.marks.push({ col: r.col, kind: 'slip', title: r.note || t('marks.lostHere') })
        }
      } else if (r.who.some((tok) => resolveWho(tok).key === '__public')) {
        // GLOBAL amnesia/destruction: everyone in-world loses it — only the audience remembers
        for (const [key, l] of lanes) {
          if (key === '__audience') continue
          close(l, r.col)
          l.marks.push({ col: r.col, kind: 'slip', title: r.note || (kind === 'item' ? t('marks.destroyedAll') : t('marks.globalAmnesia')) })
        }
        const pl = laneFor({ key: '__public', label: t('lanes.public') })
        close(pl, r.col)
        if (!pl.marks.some((m) => m.col === r.col)) pl.marks.push({ col: r.col, kind: 'slip', title: r.note || t('marks.goneForEveryone') })
      } else {
        for (const tok of r.who) {
          const w = resolveWho(tok)
          const l = laneFor(w)
          close(l, r.col)
          l.marks.push({ col: r.col, kind: 'slip', title: r.note || (kind === 'item' ? t('marks.losesHere') : t('marks.forgetsHere')) })
        }
      }
    }
  }
  for (const l of lanes.values()) if (l.open != null) l.spans.push({ from: l.open, to: lastCol })

  // The AUDIENCE row: DECLARED when any record names the audience (gain fills, lost un-fills,
  // scene: start = page one) — the author owns the reveal moment. Only when NO record ever mentions
  // the audience do we fall back to "visible from the first checkpoint".
  const aud = lanes.get('__audience')
  const audienceSpans = aud
    ? aud.spans.map((sp) => ({ ...sp }))
    : recs.length
      ? [{ from: Math.min(...recs.map((r) => r.col)), to: lastCol }]
      : []
  const audienceFrom = audienceSpans.length ? Math.min(...audienceSpans.map((sp) => sp.from)) : null
  lanes.delete('__audience')
  // PUBLIC is the SECOND reserved row: the `public` event and/or gain [public] records fill it
  const pub = lanes.get('__public')
  lanes.delete('__public')
  const publicSpans = [...(pub?.spans.map((sp) => ({ ...sp })) ?? []), ...(publicAt != null ? [{ from: publicAt, to: lastCol }] : [])]

  const lanesOut: Lane[] = []
  // AUDIENCE pinned first
  lanesOut.push({
    key: '__audience',
    label: t('lanes.audience'),
    fills: audienceSpans,
    marks: aud ? aud.marks : recs.map((r) => ({ col: r.col, kind: 'slip' as const, title: r.note || r.event }))
  })
  // The shade sits on whoever is BEHIND: MYSTERY (they know first) shades the AUDIENCE row's gap;
  // SUSPENSE (the audience knows, they don't) shades EVERY uncovered stretch of the lane after the
  // reveal — including the gap a `lost` reopens (forgetting re-arms suspense). Applies to PUBLIC too.
  const audienceLane = lanesOut[0]
  // mystery ranges ACCUMULATE here and paint as a UNION at the end — one flat tint no matter how many
  // characters are in on the secret (per-knower translucent layers stacked into an opaque slab before)
  const mysteryAcc: { from: number; to: number }[] = []
  const shade = (lane: Lane, spansIn: { from: number; to: number }[]): void => {
    if (audienceFrom == null) return
    const spans = [...spansIn].sort((a, b) => a.from - b.from)
    for (const sp of spans)
      if (sp.from < audienceFrom) mysteryAcc.push({ from: sp.from, to: Math.min(sp.to, audienceFrom - 1) })
    let cur = audienceFrom
    for (const sp of spans) {
      if (sp.to < cur) continue
      const s0 = Math.max(sp.from, cur)
      if (s0 > cur) lane.fills.push({ from: cur, to: s0 - 1, faint: true, tone: 'suspense' })
      cur = sp.to + 1
    }
    if (cur <= lastCol) lane.fills.push({ from: cur, to: lastCol, faint: true, tone: 'suspense' })
  }
  // PUBLIC pinned second — present whenever anything went public; shaded like any knower
  if (publicSpans.length || pub) {
    const publicLane: Lane = { key: '__public', label: t('lanes.public'), fills: publicSpans.map((sp) => ({ ...sp })), marks: pub?.marks ?? [] }
    lanesOut.push(publicLane)
    shade(publicLane, publicSpans)
  }
  // classify + sort the free lanes: characters first, then items/information/…, unknowns last, A–Z inside
  const free = [...lanes.entries()].sort(([, a], [, b]) => {
    const ka = a.kind ? KIND_ORDER.indexOf(a.kind) : KIND_ORDER.length
    const kb = b.kind ? KIND_ORDER.indexOf(b.kind) : KIND_ORDER.length
    return (ka < 0 ? KIND_ORDER.length : ka) - (kb < 0 ? KIND_ORDER.length : kb) || a.label.localeCompare(b.label)
  })
  for (const [key, l] of free) {
    const lane: Lane = { key, label: l.label, kind: l.kind, fills: l.spans.map((sp) => ({ ...sp })), marks: l.marks }
    shade(lane, l.spans)
    lanesOut.push(lane)
  }
  // paint the mystery UNION — merge overlapping/adjacent ranges into flat, non-stacking tints
  if (mysteryAcc.length) {
    const sorted = [...mysteryAcc].sort((a, b) => a.from - b.from)
    const merged: { from: number; to: number }[] = []
    for (const r of sorted) {
      const last = merged[merged.length - 1]
      if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to)
      else merged.push({ ...r })
    }
    for (const r of merged) audienceLane.fills.push({ ...r, faint: true, tone: 'mystery' })
  }
  if (publicAt != null) for (const l of lanesOut) l.marks.push({ col: publicAt, kind: 'public', title: t('marks.publicEveryone') })
  return lanesOut
}

/**
 * Clip lanes to the visible scene-range window [lo,hi] (absolute full-axis columns): offset fills/marks into the
 * window and drop what falls outside it. A lane with NOTHING in the window (a holder/knower whose span doesn't
 * overlap the visible span) drops entirely — that's the per-variant/character-limit relevance for the custody
 * chart. The fold stays over the FULL axis; only the render coordinates window. See internal/gantt-scale.md.
 */
function windowLanes(lanes: Lane[], lo: number, hi: number): Lane[] {
  return lanes
    .map((l) => ({
      ...l,
      fills: l.fills
        .map((f) => ({ ...f, from: Math.max(f.from, lo), to: Math.min(f.to, hi) }))
        .filter((f) => f.to >= f.from)
        .map((f) => ({ ...f, from: f.from - lo, to: f.to - lo })),
      marks: l.marks.filter((m) => m.col >= lo && m.col <= hi).map((m) => ({ ...m, col: m.col - lo }))
    }))
    .filter((l) => l.fills.length > 0 || l.marks.length > 0)
}

/** Lanes → LifecycleGantt rows — one renderer so every custody chart (real or hypothetical) looks
 *  identical. `onGhostClick` makes the ANALYSIS lane's ghosts actionable (click → draft the checkpoint). */
function lanesToGanttRows(t: TFunction, lanes: Lane[], onGhostClick?: (col: number) => void): GanttRow[] {
  return lanes.map((l) => ({
  key: l.key,
  gutter: (
    <span
      className={cn(
        'flex h-full items-center truncate px-2 text-[11px]',
        l.key === '__reader' || l.key === '__audience' ? 'text-lore' : l.key === '__public' ? 'text-flag' : l.key === '__observed' ? 'text-thread' : 'text-foreground/80'
      )}
    >
      {(l.key === '__reader' || l.key === '__audience') && <Eye className="mr-1 size-3 shrink-0" />}
      {l.key === '__public' && <Globe className="mr-1 size-3 shrink-0" />}
      {l.key === '__observed' && <Sparkles className="mr-1 size-3 shrink-0" />}
      {(() => {
        const b = kindBadge(l.kind)
        return b ? <b.Icon className={cn('mr-1 size-3 shrink-0', b.accent)} /> : null
      })()}
      {l.label}
    </span>
  ),
  renderLane: ({ colW }) => (
    <>
      {l.fills.map((f, i) => (
        <div
          key={`f${i}`}
          className={cn('absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm', f.faint ? (f.tone === 'mystery' ? 'bg-thread/20' : 'bg-flag/15') : 'bg-lore/50')}
          style={{ left: f.from * colW + 1, width: Math.max(colW - 2, (f.to - f.from + 1) * colW - 2) }}
          title={f.faint ? (f.tone === 'mystery' ? t('zones.mystery') : t('zones.suspense')) : undefined}
        />
      ))}
      {l.marks.map((m, i) =>
        m.kind === 'public' ? (
          <div key={`m${i}`} className="absolute bottom-0 top-0 w-px bg-flag/70" style={{ left: m.col * colW + colW / 2 }} title={m.title} />
        ) : (
          <div
            key={`m${i}`}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 rounded-full',
              m.kind === 'ghost'
                ? 'size-3 animate-pulse border-2 border-dashed border-thread bg-thread/40 shadow-[0_0_8px_var(--thread)]'
                : cn('size-2', m.kind === 'slip' ? 'border border-lore bg-transparent' : 'bg-lore'),
              m.kind === 'ghost' && onGhostClick && 'cursor-pointer hover:scale-150 hover:animate-none hover:bg-thread/70'
            )}
            style={{ left: m.col * colW + colW / 2 - (m.kind === 'ghost' ? 6 : 4) }}
            title={m.kind === 'ghost' && onGhostClick ? `${m.title}\n\n${t('marks.clickToDraft')}` : m.title}
            onClick={m.kind === 'ghost' && onGhostClick ? () => onGhostClick(m.col) : undefined}
          />
        )
      )}
    </>
  )
}))
}

export function CustodyPanel(): JSX.Element {
  const { t } = useTranslation('custody')
  const { topics, custody, secrets, roster, ready, reload } = usePossessionData()
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)
  const storyTree = useWorkspace((s) => s.storyTree)
  const chapterWrap = useWorkspace((s) => s.ganttLayers.chapters)
  const characters = useWorkspace((s) => s.characters)
  const selection = useWorkspace((s) => s.custodySelection)

  const [page, setPage] = useState(0)
  const cols = useSceneAxis(scenes) // the FULL axis — the fold (below) computes lane spans over it
  const colOf = useMemo(() => new Map(cols.map((s, i) => [s.sceneId, i])), [cols])
  const lastCol = cols.length - 1
  // Gantt scale (internal/gantt-scale.md): window the scene axis + paginate holder/knower lanes. The fold keeps
  // the FULL colOf/lastCol; windowLanes clips its output to win, so the continuous fills stay correct.
  const win = useGanttWindow(cols)
  const wraps = useMemo(() => (chapterWrap ? deriveWrapLevels(storyTree, win.colOf) : undefined), [chapterWrap, storyTree, win.colOf])
  const counts = useMemo(() => sceneVolumes(graph), [graph])

  const topic = selection?.kind === 'topic' ? (topics.find((t) => t.pageId === selection.id) ?? null) : null
  const requestNav = useWorkspace((s) => s.requestNav)
  const [tab, setTab] = useState<'chart' | 'records' | 'write' | 'preview' | 'source'>('chart')
  // Leaving a tab with unsaved Records/Write edits prompts Save/Don't Save/Cancel (same guard as page-switch),
  // instead of silently discarding. requestNav is a no-op passthrough when nothing's dirty.
  const changeTab = (next: typeof tab): void => requestNav(() => setTab(next))
  useEffect(() => setTab('chart'), [selection?.id]) // a fresh topic opens on its chart (topic switch is already guarded via openPage)
  const [scenePreview, setScenePreview] = useState<{ path: string; title: string } | null>(null)
  // Save lives in the HEADER (matching scene/world pages) — the form registers its handler + state here
  const recSave = useRef<(() => void) | null>(null)
  const [recState, setRecState] = useState<{ dirty: boolean; saving: boolean; err: string | null }>({ dirty: false, saving: false, err: null })
  // The Write tab (TopicWrite) reports the same save/state so its Save lives in THIS header too — same as
  // Records — instead of SourceTab's own footer. `edit` picks whichever editable tab is active.
  const writeSave = useRef<(() => void) | null>(null)
  const [writeState, setWriteState] = useState<{ dirty: boolean; saving: boolean; err: string | null }>({ dirty: false, saving: false, err: null })
  const editing = tab === 'records' ? { state: recState, save: recSave } : tab === 'write' ? { state: writeState, save: writeSave } : null
  const sceneById = useMemo(() => new Map(scenes.map((sc) => [sc.sceneId, sc])), [scenes])

  /** Resolve a who-token (entity id, name, or special) to a stable lane key + display label. */
  const worldPages = useWorkspace((s) => s.worldPages)
  const resolveWho = useMemo(() => makeResolveWho(t, characters, worldPages), [t, characters, worldPages])

  const entityTracks = useWorkspace((s) => s.entityTracks)
  const showObserved = useWorkspace((s) => s.ganttLayers.observed)
  // STEP 4 — the unplanned-reveal diff: what analysis OBSERVED about this subject that has no declared
  // checkpoint at that scene. Rendered as a ghost lane; the chart stays yours, analysis whispers.
  const observedGhosts = useMemo(() => {
    if (!topic) return []
    // fallback to the pageId: secret-seeded pages created before 2026-07-09 carry no subject, but their
    // page id IS the declared secret id — so existing files still diff without editing them
    const subject = (topic.subject ?? topic.pageId).toLowerCase()
    if (!subject) return []
    const tr = (entityTracks ?? []).find((t) => t.id.toLowerCase() === subject) ?? (entityTracks ?? []).find((t) => t.name.toLowerCase() === topic.name.toLowerCase())
    const ids = new Set([subject, ...(tr ? [tr.id.toLowerCase()] : [])])
    const src = topic.topic === 'item' ? custody.filter((e) => ids.has(e.entityId.toLowerCase())) : secrets.filter((e) => (e.secret ?? '').toLowerCase() === subject)
    const declaredCols = new Set(topic.records.map((r) => (r.scene === 'start' ? 0 : colOf.get(r.scene))).filter((c): c is number => c != null))
    return src
      .map((e) => ({ col: colOf.get(e.sceneId), e }))
      .filter((x): x is { col: number; e: PossessionEvent } => x.col != null && !declaredCols.has(x.col))
  }, [topic, custody, secrets, entityTracks, colOf])

  const lanes = useMemo<Lane[]>(() => {
    // ── AUTHORED topic: fold the records — grammar v2 (secret-lifecycle.md Stage 2) ──
    // gain fills · lost un-fills · public floods; on items the baton emerges from exclusivity.
    // Shading: MYSTERY = char∧¬audience (bg-thread tint) · SUSPENSE = audience∧¬char (bg-flag tint).
    if (topic) {
      const out = foldTopicRecords(t, topic.records, topic.topic, colOf, lastCol, resolveWho)
      // ANALYSIS rides on TOP — the discrepancies are the attention item; the plan reads below them
      if (showObserved && observedGhosts.length)
        out.unshift({
          key: '__observed',
          label: t('lanes.analysis'),
          fills: [],
          marks: observedGhosts.map((g) => ({
            col: g.col,
            kind: 'ghost' as const,
            title: `${t('panel.observedUndeclared')} ${g.e.change}${g.e.target ? ` → ${g.e.target}` : ''}: ${(g.e.description || g.e.value).slice(0, 140)}`
          }))
        })
      return out
    }

    // ── UNPAGED object: extraction's reading (behind the banner) ──
    if (!selection) return []
    if (selection.kind === 'item') {
      const evs = custody.filter((e) => e.entityId === selection.id && colOf.has(e.sceneId))
      const laneMap = new Map<string, Lane>()
      const laneFor = (key: string, label: string): Lane => {
        if (!laneMap.has(key)) laneMap.set(key, { key, label, fills: [], marks: [] })
        return laneMap.get(key)!
      }
      const byKey = characters
        .flatMap((c) => {
          const parts = c.name.split(/\s+/)
          const keys = [c.name.toLowerCase()]
          if (parts.length >= 3) keys.push(parts.slice(1).join(' ').toLowerCase())
          return keys.map((k) => ({ id: c.id, name: c.name, key: k }))
        })
        .sort((a, b) => b.key.length - a.key.length)
      evs.forEach((e, i) => {
        const from = colOf.get(e.sceneId)!
        const to = i + 1 < evs.length ? Math.max(from, colOf.get(evs[i + 1].sceneId)! - 1) : lastCol
        let h: { id: string; name: string } | null = e.target
          ? { id: e.target, name: characters.find((c) => c.id === e.target)?.name ?? e.target }
          : null
        if (!h) {
          const hay = `${e.value} ${e.description}`.toLowerCase()
          let bestPos = -1
          for (const c of byKey) {
            const pos = hay.lastIndexOf(c.key)
            if (pos > bestPos) {
              bestPos = pos
              h = { id: c.id, name: c.name }
            }
          }
        }
        const hh = h ?? { id: '?', name: t('lanes.unresolved') }
        const lane = laneFor(hh.id, hh.name)
        lane.fills.push({ from, to })
        lane.marks.push({ col: from, kind: 'handoff', title: `${e.change}: ${e.value}` })
      })
      return [...laneMap.values()]
    }
    // unpaged secret: extraction's knowledge fold
    const evs = secrets.filter((e) => e.secret === selection.id && colOf.has(e.sceneId))
    if (evs.length === 0) return []
    const owner = roster.find((r) => r.id === selection.id)
    const nameOf = new Map(characters.map((c) => [c.id, c.name]))
    const knownFrom = new Map<string, number>()
    if (owner) knownFrom.set(owner.ownerId, 0)
    let readerFrom: number | null = null
    let publicAt: number | null = null
    for (const e of evs) {
      const col = colOf.get(e.sceneId)!
      if (readerFrom == null) readerFrom = col
      if (e.change === 'gain' && !knownFrom.has(e.entityId)) knownFrom.set(e.entityId, col)
      if (e.change === 'expose') {
        if (e.target === 'public') publicAt = publicAt ?? col
        else if (e.target && !knownFrom.has(e.target)) knownFrom.set(e.target, col)
      }
    }
    const out: Lane[] = [{ key: '__reader', label: t('lanes.reader'), fills: readerFrom != null ? [{ from: readerFrom, to: lastCol }] : [], marks: [] }]
    for (const [id, from] of knownFrom) {
      const lane: Lane = { key: id, label: nameOf.get(id) ?? (id === owner?.ownerId ? owner.ownerName : id), fills: [{ from, to: lastCol }], marks: [] }
      if (readerFrom != null && from > readerFrom) lane.fills.push({ from: readerFrom, to: from - 1, faint: true })
      out.push(lane)
    }
    if (publicAt != null) for (const l of out) l.marks.push({ col: publicAt, kind: 'public', title: t('marks.public') })
    return out
  }, [t, topic, selection, custody, secrets, roster, characters, colOf, lastCol, resolveWho, showObserved, observedGhosts])

  // Activity WINDOW — trim holder/knower lanes by how many spans+events they carry (drag the low thumb up to hide
  // barely-active lanes; same windowed slider the other rails use). Self-gates when lanes don't vary. The special
  // lanes (ANALYSIS · PUBLIC · READER · AUDIENCE — keys prefixed '__') are always kept: they frame the chart.
  const [actWin, setActWin] = useState<[number, number] | null>(null)
  const laneWeight = (l: Lane): number => l.fills.length + l.marks.length
  const maxAct = useMemo(() => Math.max(1, ...lanes.filter((l) => !l.key.startsWith('__')).map(laneWeight)), [lanes])
  const loAct = actWin ? Math.min(Math.max(1, actWin[0]), maxAct) : 1
  const hiAct = actWin ? Math.min(Math.max(loAct, actWin[1]), maxAct) : maxAct
  const actAll = loAct === 1 && hiAct === maxAct
  const activeLanes = useMemo(
    () => lanes.filter((l) => l.key.startsWith('__') || (laneWeight(l) >= loAct && laneWeight(l) <= hiAct)),
    [lanes, loAct, hiAct]
  )
  // Window (scene-range) + paginate (holder/knower count) — windowLanes clips to win, paginate bounds the DOM.
  const scoped = useMemo(() => paginate(windowLanes(activeLanes, win.lo, win.hi), page), [activeLanes, win.lo, win.hi, page])
  // click a ghost → Records tab with the quick-add line DRAFTED from the observed event (review, ⏎ accepts)
  const [quickSeed, setQuickSeed] = useState<string | null>(null)
  const rows = useMemo<GanttRow[]>(
    () =>
      lanesToGanttRows(t, scoped.shown, (col) => {
        const g = observedGhosts.find((x) => x.col === col + win.lo) // windowed col → full-axis (marks were offset by lo)
        if (!g) return
        const verb = g.e.change === 'expose' && g.e.target === 'public' ? '!public' : /los|forget/.test(g.e.change) ? '!lost' : '!gain'
        const who = verb !== '!public' && g.e.target ? `@${g.e.target} ` : ''
        const note = (g.e.description || g.e.value).replace(/[@#!]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 90)
        setQuickSeed(`${verb} ${who}#${g.e.sceneId} ${note}`)
        setTab('records')
      }),
    [scoped, observedGhosts, win.lo]
  )

  // The shared bottom scale bar — same in both layouts (authored-topic chart · unpaged-selection chart).
  const scaleBar = (
    <RailScaleBar
      scene={{
        lo: win.lo,
        hi: win.hi,
        full: win.full,
        auto: win.auto,
        onChange: win.setRange,
        onReset: win.range ? () => win.setRange(null) : undefined,
        title: `${cols[win.lo]?.title ?? '?'} → ${cols[win.hi]?.title ?? '?'}`
      }}
      page={{ from: scoped.from, to: scoped.to, total: scoped.total, noun: t('panel.holdersNoun'), page: scoped.page, pageCount: scoped.pageCount, onPage: setPage }}
      metric={{
        label: t('panel.rangeLabel'),
        min: 1,
        max: maxAct,
        value: [loAct, hiAct],
        onChange: setActWin,
        readout: actAll ? t('all') : `${loAct}${loAct !== hiAct ? `–${hiAct}` : ''}`,
        onReset: actAll ? undefined : () => setActWin(null),
        title: t('panel.rangeTip')
      }}
    />
  )

  if (!ready)
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )

  if (topic)
    return (
      <PageShell
        region="custodyPanel"
        title={topic.name}
        kind={topic.topic}
        badges={
          <>
            {topic.errors.length > 0 && (
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-flag" title={topic.errors.join('\n')}>
                <AlertTriangle className="size-3" /> {topic.errors.length}
              </span>
            )}
            {/* unsaved state = the same dirty dot scene/world use */}
            {editing?.state.dirty && <span className="size-1.5 shrink-0 rounded-full bg-thread" title={t('unsaved')} />}
          </>
        }
        tabs={PAGE_TABS.custody}
        tab={tab}
        onTab={changeTab}
        // no legend prose in the header (the ? help documents the chart) — a save error is the only hint
        hint={editing?.state.err ? <span className="text-flag">{editing.state.err}</span> : undefined}
        actions={
          editing ? (
            <Button size="sm" variant="ghost" className="shrink-0" disabled={!editing.state.dirty || editing.state.saving} onClick={() => editing.save.current?.()}>
              {editing.state.saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {t('save')}
            </Button>
          ) : undefined
        }
      >
        {tab === 'records' ? (
          <RecordsForm key={topic.pageId} topic={topic} onSaved={reload} saveRef={recSave} onState={setRecState} seed={quickSeed} onSeedConsumed={() => setQuickSeed(null)} />
        ) : tab === 'write' ? (
          <TopicWrite key={topic.pageId} topic={topic} onSaved={reload} saveRef={writeSave} onState={setWriteState} />
        ) : tab === 'preview' ? (
          <TopicPreview key={topic.pageId} topic={topic} />
        ) : tab === 'source' ? (
          <TopicSource key={topic.pageId} path={topic.path} />
        ) : (
          <>
            <LifecycleGantt
              cols={win.cols.map((s) => ({ id: s.sceneId, title: s.title }))}
              wraps={wraps}
              counts={counts}
              rows={rows}
              onColClick={(c) => {
                const sc = sceneById.get(c.id)
                if (sc) setScenePreview({ path: sc.path, title: sc.title })
              }}
              empty={t('panel.emptyChart')}
            />
            {scaleBar}
          </>
        )}
        {tab === 'chart' && (
          <RailChrome region="custodyPanel" name={t('title')} layers={['chapters', 'observed']} export={{ file: 'custody-rail', caption: () => t('railCaption') }} help={CustodyHelp} />
        )}
        {scenePreview && <PageReadDialog path={scenePreview.path} kind="scene" title={scenePreview.title} onClose={() => setScenePreview(null)} />}
      </PageShell>
    )

  return (
    <div {...regionAttrs('custodyPanel')} className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3 text-[11px] text-muted-foreground">
        {selection ? (
          <>
            <span className="shrink-0 rounded border border-lore/40 bg-lore/10 px-1.5 py-0.5 text-[10px] text-lore">
              {t('panel.extractionBanner')}
            </span>
            <span className="ml-auto shrink-0 text-faint">{selection.kind === 'item' ? t('panel.inferredHolder') : t('panel.inferredKnowledge')}</span>
          </>
        ) : (
          <span>{t('panel.selectPrompt')}</span>
        )}
      </div>
      <LifecycleGantt
        cols={win.cols.map((s) => ({ id: s.sceneId, title: s.title }))}
        wraps={wraps}
        counts={counts}
        rows={rows}
        onColClick={(c) => {
          const sc = sceneById.get(c.id)
          if (sc) setScenePreview({ path: sc.path, title: sc.title })
        }}
        empty={
          selection
            ? selection.kind === 'secret'
              ? t('panel.emptySecret')
              : t('panel.emptyItem')
            : <EmptyRailState rail="custody" />
        }
      />
      {scaleBar}
      <RailChrome region="custodyPanel" name={t('title')} layers={['chapters']} export={{ file: 'custody-rail', caption: () => t('railCaption') }} help={CustodyHelp} />
      {scenePreview && <PageReadDialog path={scenePreview.path} kind="scene" title={scenePreview.title} onClose={() => setScenePreview(null)} />}
    </div>
  )
}

// ── AI suggest: two panes — pick on the left, see EXACTLY what changes on the right, then confirm ──────
function AiSuggestDialog({
  open,
  initial,
  onClose,
  suggestions,
  topics,
  creating,
  custody,
  secrets,
  onCreate,
  onChanged
}: {
  open: boolean
  initial?: { tab: 'recommend' | 'populate'; sel?: string }
  onClose: () => void
  suggestions: (Anchor & { n: number; reason: string })[]
  topics: CustodyTopic[]
  creating: string | null
  custody: PossessionEvent[]
  secrets: PossessionEvent[]
  onCreate: (a: Anchor) => Promise<void>
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation('custody')
  const tasks = useWorkspace((s) => s.tasks)
  const enqueueTask = useWorkspace((s) => s.enqueueTask)
  const scenes = useWorkspace((s) => s.scenes)
  const characters = useWorkspace((s) => s.characters)
  const [tab, setTab] = useState<'recommend' | 'populate'>('recommend')
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => {
    if (open && initial) {
      setTab(initial.tab)
      setSel(initial.sel ?? null)
    }
  }, [open, initial])
  const [busy, setBusy] = useState(false)
  const appliedIds = useWorkspace((s) => s.appliedTasks) // shared with the tasks-inbox apply path
  const markApplied = useWorkspace((s) => s.markTaskApplied)
  const applied = useMemo(() => new Set(appliedIds), [appliedIds])
  const [scenePreview, setScenePreview] = useState<{ path: string; title: string } | null>(null)
  useEffect(() => {
    if (!open) setScenePreview(null) // a closed dialog must not resurrect its scene preview on reopen
  }, [open])

  const pick = tab === 'recommend' ? suggestions.find((a) => a.id === sel) : undefined
  const topic = tab === 'populate' ? topics.find((t) => t.pageId === sel) : undefined
  // latest queued job against the picked topic — the queue is the source of truth (re-runs make new tasks)
  const job = useMemo(() => {
    if (!topic) return undefined
    return tasks.filter((t) => t.pagePath === topic.path).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)
  }, [tasks, topic])

  // chart geometry — same fold + renderer as the real Chart tab, so the preview IS the chart
  const orderedScenes = useSceneAxis(scenes) // follows the active chart-sequence (else clean chain / reading order)
  const colOf = useMemo(() => new Map(orderedScenes.map((sc, idx) => [sc.sceneId, idx])), [orderedScenes])
  const sceneById = useMemo(() => new Map(orderedScenes.map((sc) => [sc.sceneId, sc])), [orderedScenes])
  const worldPages = useWorkspace((s) => s.worldPages)
  const resolveWho = useMemo(() => makeResolveWho(t, characters, worldPages), [t, characters, worldPages])

  // what analysis noticed about the picked topic — the evidence the job drafts from
  const findings = useMemo(() => {
    if (!topic) return []
    const subject = (topic.subject ?? '').toLowerCase()
    if (!subject) return []
    const src = topic.topic === 'item' ? custody.filter((e) => e.entityId.toLowerCase() === subject) : secrets.filter((e) => (e.secret ?? '').toLowerCase() === subject)
    return src
      .map((e) => ({ sceneId: e.sceneId, text: e.description || e.value || e.change }))
      .sort((a, b) => (colOf.get(a.sceneId) ?? 1e9) - (colOf.get(b.sceneId) ?? 1e9))
  }, [topic, custody, secrets, colOf])

  // the drafted result, grammar-checked and folded into the chart it WOULD draw
  const [hypo, setHypo] = useState<{ records: CustodyRecord[]; errors: string[]; canonical: string } | null>(null)
  useEffect(() => {
    setHypo(null)
    if (job?.status === 'done' && job.result) void window.nvs.parseCustodyBlock(job.result).then(setHypo)
  }, [job?.id, job?.status, job?.result])
  const hypoRows = useMemo(
    () => (hypo && topic ? lanesToGanttRows(t, foldTopicRecords(t, hypo.records, topic.topic, colOf, Math.max(0, orderedScenes.length - 1), resolveWho)) : []),
    [t, hypo, topic, colOf, orderedScenes.length, resolveWho]
  )

  async function queue(t: CustodyTopic): Promise<void> {
    const preset = BUILTIN_PROMPTS.find((b) => b.id === 'custody-records')
    if (!preset) return
    setBusy(true)
    try {
      const doc = await window.nvs.readScene(t.path)
      const { instruction, mode } = composeInstruction('', [{ directive: preset.directive, mode: preset.mode }])
      // The directive alone gives grammar but no TRUTH — without the scene roster the model can't cite
      // real scene ids, and without the analysis events it has nothing to draft checkpoints FROM.
      // Roster CAPPED: a 1000-scene work would put ~50KB into every job. Priority = scenes the topic
      // already touches (declared + observed) plus story order to fill; the omission is stated.
      const ROSTER_CAP = 250
      const touched = new Set<string>([...t.records.map((r) => r.scene), ...findings.map((f) => f.sceneId)])
      const prioritized = orderedScenes.length > ROSTER_CAP ? [...orderedScenes.filter((sc) => touched.has(sc.sceneId)), ...orderedScenes.filter((sc) => !touched.has(sc.sceneId))].slice(0, ROSTER_CAP) : orderedScenes
      const inOrder = orderedScenes.filter((sc) => prioritized.includes(sc))
      const roster =
        inOrder.map((sc) => `${sc.sceneId} · ${sc.title}`).join('\n') +
        (orderedScenes.length > inOrder.length ? `\n(+${orderedScenes.length - inOrder.length} more scenes omitted — cite only the ids listed above)` : '')
      const observed = findings
        .slice(0, 30)
        .map((f) => `${f.sceneId} · ${f.text}`)
        .join('\n')
      const grounded = [
        instruction,
        `\nSCENE IDS (id · title, story order — \`scene\` must be one of these, or \`start\`):\n${roster}`,
        observed
          ? `\nWHAT ANALYSIS OBSERVED about this topic (scene · event) — draft checkpoints from these plus the page prose:\n${observed}`
          : '\nNo analysis events cite this topic — draft only from the page prose; if the prose declares nothing, leave the block as it is.'
      ].join('\n')
      await enqueueTask({ pagePath: t.path, pageTitle: t.name, pageKind: 'custody', instruction: grounded, mode, baseText: doc.body ?? '' })
    } finally {
      setBusy(false)
    }
  }
  const pushHistory = useWorkspace((s) => s.pushPageHistory)
  const undoWrite = useWorkspace((s) => s.undoPageWrite)
  // Apply writes the page directly (frontmatter preserved) and SNAPSHOTS the prior body into the
  // per-page history — rollback works from the topic header even after tasks are cleared.
  async function apply(tp: CustodyTopic, body: string, taskId: string): Promise<void> {
    setBusy(true)
    try {
      const doc = await window.nvs.readScene(tp.path)
      pushHistory(tp.path, doc?.body ?? '', t('history.aiApply', { name: tp.name }), taskId)
      const ok = await window.nvs.writeScene(tp.path, doc.frontmatter, body)
      if (ok) {
        markApplied(taskId, true)
        onChanged()
      }
    } finally {
      setBusy(false)
    }
  }
  async function unApply(tp: CustodyTopic, taskId: string): Promise<void> {
    setBusy(true)
    try {
      await undoWrite(tp.path)
      markApplied(taskId, false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const listRow = (key: string, on: boolean, onClick: () => void, main: string, side: string, sub: string): JSX.Element => (
    <button
      key={key}
      onClick={onClick}
      className={cn('flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left', on ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft')}
    >
      <span className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs">{main}</span>
        <span className="shrink-0 text-[9px] text-faint">{side}</span>
      </span>
      <span className="truncate text-[10px] text-faint">{sub}</span>
    </button>
  )

  // The PRIMARY action for the current state — lifted into the shared footer (SplitDialog). State-specific
  // CONTENT (findings, the chart preview, errors, the raw draft) stays in the right pane; only the act moves here.
  const doneResult = tab === 'populate' && topic && job?.status === 'done' && job.result != null
  const footerActions =
    tab === 'recommend' && pick ? (
      <Button size="sm" disabled={creating === pick.id} onClick={() => void onCreate(pick).then(() => setSel(null))}>
        {creating === pick.id ? <Loader2 className="size-3 animate-spin" /> : <FilePlus2 className="size-3" />} {t('ai.createTopicPage')}
      </Button>
    ) : tab === 'populate' && topic && !job ? (
      <Button size="sm" disabled={busy} onClick={() => void queue(topic)}>{busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} {t('ai.queueJob')}</Button>
    ) : tab === 'populate' && topic && job?.status === 'failed' ? (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void queue(topic)}><Sparkles className="size-3" /> {t('ai.reRun')}</Button>
    ) : doneResult ? (
      <>
        {!applied.has(job!.id) ? (
          <Button size="sm" disabled={busy || !hypo || hypo.errors.length > 0} title={hypo && hypo.errors.length > 0 ? t('ai.grammarErrTip') : undefined} onClick={() => void apply(topic!, hypo?.canonical ?? job!.result!, job!.id)}>
            <Save className="size-3" /> {t('ai.accept')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void unApply(topic!, job!.id)}>{t('ai.undoRestore')}</Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void queue(topic!)}><Sparkles className="size-3" /> {t('ai.reRun')}</Button>
      </>
    ) : null

  return (
    <>
    <SplitDialog
      open={open}
      onClose={onClose}
      title={t('ai.dialogTitle')}
      leftClassName="w-1/2"
      footer={footerActions && <DialogFooter>{footerActions}</DialogFooter>}
      left={
        <>
          <div className="flex shrink-0 gap-0 border-b border-border px-3 py-2">
            <div className="flex overflow-hidden rounded-md border border-border text-xs">
              {(['recommend', 'populate'] as const).map((tb) => (
                <button
                  key={tb}
                  onClick={() => { setTab(tb); setSel(null) }}
                  className={cn('px-2 py-1 transition-colors', tab === tb ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft')}
                >
                  {tb === 'recommend' ? t('ai.tabRecommend') : t('ai.tabPopulate')}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {tab === 'recommend' && (
              <>
                {suggestions.slice(0, 60).map((a) => listRow(a.id, sel === a.id, () => setSel(a.id), a.name, a.cat, a.reason))}
                {suggestions.length > 60 && <p className="px-2 py-1 text-[10px] text-faint">{t('ai.moreSuggestions', { count: suggestions.length - 60 })}</p>}
                {suggestions.length === 0 && <p className="px-2 text-[11px] text-faint">{t('ai.allHaveTopic')}</p>}
              </>
            )}
            {tab === 'populate' && (
              <>
                {topics.map((tp) => {
                  const j = tasks.filter((x) => x.pagePath === tp.path).at(-1)
                  return listRow(tp.pageId, sel === tp.pageId, () => setSel(tp.pageId), tp.name, j ? j.status : '', t('sidebar.topicSub', { kind: tp.topic, count: tp.records.length }))
                })}
                {topics.length === 0 && <p className="px-2 text-[11px] text-faint">{t('ai.noTopicsYet')}</p>}
              </>
            )}
          </div>
        </>
      }
      right={
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto p-4 text-xs',
            // empty state → flex-centre the placeholder both ways; picked content stays top-aligned + scrollable
            (tab === 'recommend' && !pick) || (tab === 'populate' && !topic) ? 'flex items-center justify-center' : ''
          )}
        >
          {tab === 'recommend' && pick && (
            <>
              <p className="pb-3 leading-relaxed text-muted-foreground">
                <b className="text-foreground/90">{pick.name}</b> — {pick.reason}. {t('ai.creatingA')}{' '}
                {pick.kind === 'item' ? <>{t('ai.who')}<b>{t('ai.holds')}</b>{t('ai.it')}</> : <>{t('ai.who')}<b>{t('ai.knows')}</b>{t('ai.it')}</>}{t('ai.sceneByScene')}
              </p>
              <div className="mb-3 rounded-md border border-border bg-canvas/40 p-2 leading-relaxed text-muted-foreground">
                <div><span className="text-faint">{t('ai.pageLabel')}</span>content/custody/{pick.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}{pick.src === 'secret' ? '' : '-custody'}.md</div>
                <div>
                  <span className="text-faint">{t('ai.startsWithLabel')}</span>
                  {pick.n > 0 ? t('ai.draftedFrom', { count: pick.n }) : t('ai.noCheckpoints')}
                </div>
              </div>
            </>
          )}
          {tab === 'populate' && topic && (
            <>
              <p className="pb-3 leading-relaxed text-muted-foreground">
                <b className="text-foreground/90">{topic.name}</b> {t('ai.hasDeclared', { count: topic.records.length })}{' '}
                {t('ai.jobReads1')}{topic.topic === 'item' ? t('ai.holds') : t('ai.learns')}{t('ai.jobReads2')}
              </p>
              {findings.length > 0 && (
                <>
                  <p className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{t('ai.whatNoticed')}</p>
                  <div className="mb-3 flex flex-col gap-0.5">
                    {findings.slice(0, 8).map((f, idx) => {
                      const sc = sceneById.get(f.sceneId)
                      return (
                        <div key={idx} className="flex items-baseline gap-2">
                          <button
                            onClick={() => sc && setScenePreview({ path: sc.path, title: sc.title })}
                            className="shrink-0 truncate text-left text-[10px] text-lore underline-offset-2 hover:underline"
                          >
                            {sc?.title ?? f.sceneId}
                          </button>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={f.text}>{f.text}</span>
                        </div>
                      )
                    })}
                    {findings.length > 8 && <span className="text-[10px] text-faint">{t('ai.moreFindings', { count: findings.length - 8 })}</span>}
                  </div>
                </>
              )}
              {job && (job.status === 'queued' || job.status === 'running') && (
                <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {t('ai.drafting')}</p>
              )}
              {job && job.status === 'failed' && <p className="pb-2 text-flag">{t('ai.failedPrefix')}{job.error ?? t('ai.unknownError')}</p>}
              {job && job.status === 'done' && job.result != null && (
                <>
                  <p className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                    {t('ai.ifAccept')} {applied.has(job.id) && t('ai.appliedTag')}
                  </p>
                  {hypo && hypo.errors.length > 0 && (
                    <div className="mb-2 rounded border border-flag/40 bg-flag/10 px-2 py-1.5 text-[10px] text-flag">
                      {hypo.errors.slice(0, 4).map((e, idx) => (
                        <div key={idx}>{e}</div>
                      ))}
                    </div>
                  )}
                  <div className="mb-3 overflow-auto rounded-md border border-border bg-canvas/40">
                    {hypo ? (
                      <LifecycleGantt cols={orderedScenes.map((sc) => ({ id: sc.sceneId, title: sc.title }))} rows={hypoRows} empty={t('ai.emptyDraft')} />
                    ) : (
                      <p className="flex items-center gap-2 p-3 text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {t('ai.readingDraft')}</p>
                    )}
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[10px] text-faint">{t('ai.rawDraft')}</summary>
                    <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-canvas/40 p-2 text-[10px] leading-relaxed text-muted-foreground">{job.result}</pre>
                  </details>
                </>
              )}
            </>
          )}
          {((tab === 'recommend' && !pick) || (tab === 'populate' && !topic)) && (
            <p className="max-w-60 text-center text-[11px] leading-relaxed text-faint">
              {t('ai.pickPre')}{tab === 'recommend' ? t('ai.aSuggestion') : t('ai.aTopic')}{t('ai.pickPost')}
            </p>
          )}
        </div>
      }
    />
    {scenePreview && <PageReadDialog path={scenePreview.path} kind="scene" title={scenePreview.title} onClose={() => setScenePreview(null)} />}
    </>
  )
}

// ── WhoPicker: /speaker-style searchable multi-select — chips + a filtered world-page list ─────────────
function WhoPicker({ value, onChange, single, disabled, noSpecials }: { value: string[]; onChange: (who: string[]) => void; single?: boolean; disabled?: boolean; noSpecials?: boolean }): JSX.Element {
  const { t } = useTranslation('custody')
  const worldPages = useWorkspace((s) => s.worldPages)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const candidates = useMemo(() => {
    // the audience only ever GAINS (a reveal can't be unread) — lost rows hide it but keep public,
    // because lost [public] is the global amnesia / global destruction event
    const specials = [
      ...(noSpecials ? [] : [{ id: 'audience', name: 'audience', kind: '★' }]),
      { id: 'public', name: 'public', kind: '★' }
    ]
    const pages = worldPages.filter((p) => p.kind !== 'custody').map((p) => ({ id: p.id, name: p.name, kind: p.kind }))
    const q = query.trim().toLowerCase()
    const chosen = new Set(value.map((w) => w.toLowerCase()))
    return [...specials, ...pages]
      .filter((c) => !chosen.has(c.name.toLowerCase()) && !chosen.has(c.id.toLowerCase()))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      .slice(0, 8)
  }, [worldPages, query, value, noSpecials])
  const pick = (name: string): void => {
    onChange(single ? [name] : [...value, name])
    setQuery('')
    if (single) setOpen(false)
  }
  return (
    <div ref={wrap} className={cn('relative flex min-h-7 w-52 shrink-0 flex-wrap items-center gap-1 rounded-md border border-border bg-canvas px-1.5 py-0.5', disabled && 'opacity-40')}>
      {value.map((w) => {
        const kind = worldPages.find((p) => p.name.toLowerCase() === w.toLowerCase() || p.id.toLowerCase() === w.toLowerCase())?.kind
        const b = kindBadge(kind)
        return (
        <span key={w} className={cn('flex items-center gap-0.5 rounded bg-panel-soft px-1 text-[10px]', w === 'audience' && 'text-lore', w === 'public' && 'text-flag')}>
          {b && <b.Icon className={cn('size-2.5 shrink-0', b.accent)} />}
          {w}
          {!disabled && (
            <button onClick={() => onChange(value.filter((x) => x !== w))} className="text-faint hover:text-flag">
              ×
            </button>
          )}
        </span>
        )
      })}
      {!disabled && (!single || value.length === 0) && (
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={value.length ? '' : single ? t('who.holderPh') : t('who.whoPh')}
          className="min-w-10 flex-1 bg-transparent text-[11px] outline-none placeholder:text-faint"
        />
      )}
      {open && !disabled && candidates.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-md border border-border bg-panel shadow-lg">
          {candidates.map((c) => (
            <button
              key={c.id}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(c.name)
              }}
              className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-panel-soft"
            >
              {(() => {
                const b = kindBadge(c.kind)
                return b ? <b.Icon className={cn('size-3 shrink-0', b.accent)} /> : <span className="w-3 shrink-0 text-center text-[9px] text-lore">★</span>
              })()}
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="shrink-0 text-[9px] text-faint">{c.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── QuickAdd: `gain @ophelia @audience #scene-id the why` — one line per checkpoint, Enter appends.
//    @ and # mirror the editor's mention conventions; suggestions filter as you type each trigger. ──
function QuickAdd({
  topic,
  scenes,
  onAdd,
  seed,
  onSeedConsumed
}: {
  topic: CustodyTopic
  scenes: { sceneId: string; title: string }[]
  onAdd: (r: CustodyRecord) => void
  seed?: string | null // a ghost-click's drafted line — consumed once, then the line is yours to edit
  onSeedConsumed?: () => void
}): JSX.Element {
  const { t } = useTranslation('custody')
  const worldPages = useWorkspace((s) => s.worldPages)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (seed != null) {
      setText(seed)
      inputRef.current?.focus()
      onSeedConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])
  // an open trigger = the token being typed at the END of the line
  const trig = useMemo(() => {
    const m = /([@#!])([\w-]*)$/.exec(text)
    return m ? { kind: m[1] as '@' | '#' | '!', query: m[2].toLowerCase(), at: m.index } : null
  }, [text])
  const options = useMemo(() => {
    if (!trig) return []
    if (trig.kind === '!')
      return (['gain', 'lost', 'public'] as const)
        .filter((v) => !trig.query || v.startsWith(trig.query))
        .map((v) => ({ id: v, label: v === 'gain' ? t('quickAdd.verbGain') : v === 'lost' ? t('quickAdd.verbLost') : t('quickAdd.verbPublic') }))
    if (trig.kind === '@') {
      const specials = [
        { id: 'audience', label: t('quickAdd.audienceOpt') },
        { id: 'public', label: t('quickAdd.publicOpt') }
      ]
      const pages = worldPages.filter((p) => p.kind !== 'custody').map((p) => ({ id: p.id, label: `${p.name} · ${p.kind}` }))
      return [...specials, ...pages].filter((o) => !trig.query || o.id.toLowerCase().includes(trig.query) || o.label.toLowerCase().includes(trig.query)).slice(0, 6)
    }
    return scenes
      .map((sc) => ({ id: sc.sceneId, label: sc.title }))
      .filter((o) => !trig.query || o.id.toLowerCase().includes(trig.query) || o.label.toLowerCase().includes(trig.query))
      .slice(0, 6)
  }, [trig, worldPages, scenes])
  const pick = (id: string): void => {
    if (!trig) return
    setText(text.slice(0, trig.at) + trig.kind + id + ' ') // '!' keeps its prefix too — position-free verbs
    inputRef.current?.focus()
  }
  // the line, parsed LIVE — drives both commit and the chained slot hints below the input
  const parsed = useMemo(() => {
    // !verb anywhere in the line (position-free); a bare leading verb still counts
    const verb = (/!(gain|lost|public)\b/.exec(text)?.[1] ?? /^\s*(gain|lost|public)\b/.exec(text)?.[1]) as CustodyRecord['event'] | undefined
    const who = [...text.matchAll(/@([\w-]+)/g)].map((m) => m[1])
    const scene = /#([\w-]+)/.exec(text)?.[1] ?? ''
    const note = text
      .replace(/!(gain|lost|public)\b/g, '')
      .replace(/^\s*(gain|lost|public)\b/, '')
      .replace(/[@#][\w-]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    // existence checks — the linter would catch these after save; the line refuses them BEFORE
    const known = new Set(['audience', 'public'])
    for (const pg of worldPages) {
      known.add(pg.id.toLowerCase())
      known.add(pg.name.toLowerCase())
    }
    const badWho = who.filter((w) => !known.has(w.toLowerCase()))
    const sceneOk = scene === 'start' || scenes.some((sc) => sc.sceneId === scene)
    const needsWho = (verb ?? 'gain') === 'gain'
    const ready = !!scene && sceneOk && badWho.length === 0 && (!needsWho || who.length > 0)
    return { verb, who, scene, note, needsWho, ready, badWho, sceneOk }
  }, [text, worldPages, scenes])
  const commit = (): void => {
    if (!parsed.ready) return
    onAdd({ scene: parsed.scene, event: parsed.verb ?? 'gain', who: parsed.who, note: parsed.note || null })
    setText('')
    inputRef.current?.focus()
  }
  const insert = (frag: string, prepend = false): void => {
    const t = text.trim()
    setText(prepend ? `${frag} ${t}${t ? ' ' : ''}` : `${t}${t ? ' ' : ''}${frag}`)
    inputRef.current?.focus()
  }
  // Discord-style chained hints: each slot shows filled ✓ or waits its turn; the NEXT missing one glows.
  const nextSlot = !parsed.verb ? 'verb' : parsed.needsWho && parsed.who.length === 0 ? 'who' : !parsed.scene ? 'scene' : 'done'
  const slotChip = (on: boolean, active: boolean, label: string, onClick?: () => void): JSX.Element => (
    <button
      key={label}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick?.()
      }}
      disabled={!onClick}
      className={cn(
        'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
        label.startsWith('⚠')
          ? 'border-flag/50 text-flag'
          : on
            ? 'border-ok/40 text-ok'
            : active
              ? 'border-lore/50 text-lore'
              : 'border-border text-faint',
        onClick && !on && 'hover:bg-panel-soft'
      )}
    >
      {label}
    </button>
  )
  return (
    <div className="relative mb-2">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (trig && options.length > 0) pick(options[0].id)
            else commit()
          }
          if (e.key === 'Escape' && trig) setText(text.slice(0, trig.at))
        }}
        placeholder={t('quickAdd.placeholder', { slot: topic.topic === 'item' ? t('quickAdd.holderSlot') : t('quickAdd.whoSlot') })}
        className="w-full rounded-md border border-border bg-canvas px-2.5 py-1.5 text-[11px] outline-none placeholder:text-faint focus:border-lore/40"
      />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {parsed.verb
          ? slotChip(true, false, `✓ !${parsed.verb}`)
          : slotChip(false, nextSlot === 'verb', t('quickAdd.slotVerb'), () => insert('!'))}
        {parsed.who.length > 0
          ? parsed.badWho.length > 0
            ? slotChip(false, false, `⚠ @${parsed.badWho.join(' @')}${t('quickAdd.noSuchPage')}`, () => insert('@'))
            : slotChip(true, false, `✓ @${parsed.who.join(' @')}`)
          : parsed.verb !== 'public' && slotChip(false, nextSlot === 'who', parsed.needsWho ? t('quickAdd.slotWhoReq') : t('quickAdd.slotWhoOpt'), () => insert('@'))}
        {parsed.scene
          ? parsed.sceneOk
            ? slotChip(true, false, `✓ #${parsed.scene}`)
            : slotChip(false, false, `⚠ #${parsed.scene}${t('quickAdd.noSuchScene')}`, () => insert('#'))
          : slotChip(false, nextSlot === 'scene', t('quickAdd.slotScene'), () => insert('#'))}
        {slotChip(false, false, parsed.ready ? (parsed.note ? t('quickAdd.readyNote') : t('quickAdd.noteOptional')) : t('quickAdd.noteType'))}
      </div>
      {trig && options.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-border bg-panel shadow-lg">
          {options.map((o, idx) => (
            <button
              key={o.id}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o.id)
              }}
              className={cn('flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-panel-soft', idx === 0 && 'bg-panel-soft/60')}
            >
              <span className="shrink-0 font-mono text-[10px] text-lore">{trig.kind}{o.id}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── the Records form: the "CSV with dropdowns" — rows edit the fenced block via updateCustodyRecords ──
function RecordsForm({
  topic,
  onSaved,
  saveRef,
  onState,
  seed,
  onSeedConsumed
}: {
  topic: CustodyTopic
  onSaved: () => void
  saveRef: React.MutableRefObject<(() => void) | null>
  onState: (st: { dirty: boolean; saving: boolean; err: string | null }) => void
  seed?: string | null // ghost-click draft passed through to the quick-add line
  onSeedConsumed?: () => void
}): JSX.Element {
  const { t } = useTranslation('custody')
  const scenes = useWorkspace((s) => s.scenes)
  const setAiRequest = useWorkspace((s) => s.setCustodyAiRequest)
  const [rows, setRows] = useState<CustodyRecord[]>(() => topic.records.map((r) => ({ ...r, who: [...r.who] })))
  const [dirty, setDirty] = useState(false)
  // A rollback/apply rewrites the page under the form — sync the rows whenever we're CLEAN (dirty
  // edits are never clobbered; the header shows "unsaved changes" instead).
  useEffect(() => {
    if (!dirty) setRows(topic.records.map((r) => ({ ...r, who: [...r.who] })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic.records])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => onState({ dirty, saving, err }), [dirty, saving, err, onState])
  useEffect(() => {
    saveRef.current = () => void save()
    return () => { saveRef.current = null }
  })
  useSaveTarget(true, () => { if (dirty && !saving) void save() }, () => dirty) // ⌘S — same stack as the scene editor

  const orderedScenes = useSceneAxis(scenes) // follows the active chart-sequence (else clean chain / reading order)
  // Row-level history: every mutation snapshots; ⌘Z / ⇧⌘Z walk it (via the shared editTarget stack).
  // Text typed INSIDE an input keeps the browser's native character undo — this history is for rows.
  const history = useRef<{ past: CustodyRecord[][]; future: CustodyRecord[][] }>({ past: [], future: [] })
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const mutate = (next: (rs: CustodyRecord[]) => CustodyRecord[]): void => {
    history.current.past.push(rowsRef.current.map((r) => ({ ...r, who: [...r.who] })))
    history.current.future = []
    setRows(next)
    setDirty(true)
  }
  useUndoTarget(true, {
    undo: () => {
      const prev = history.current.past.pop()
      if (!prev) return
      history.current.future.push(rowsRef.current)
      setRows(prev)
      setDirty(true)
    },
    redo: () => {
      const next = history.current.future.pop()
      if (!next) return
      history.current.past.push(rowsRef.current)
      setRows(next)
      setDirty(true)
    }
  })
  const edit = (i: number, patch: Partial<CustodyRecord>): void => mutate((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const remove = (i: number): void => mutate((rs) => rs.filter((_, j) => j !== i))
  const add = (): void =>
    mutate((rs) => [...rs, { scene: orderedScenes[0]?.sceneId ?? '', event: 'gain', who: topic.topic === 'item' ? [] : ['audience'], note: null }])
  const pushHistory = useWorkspace((s) => s.pushPageHistory)
  async function save(): Promise<void> {
    setSaving(true)
    setErr(null)
    try {
      const before = await window.nvs.readScene(topic.path)
      pushHistory(topic.path, before?.body ?? '', t('history.recordsEdit'))
      const updated = await window.nvs.updateCustodyRecords(topic.pageId, rows)
      if (!updated) setErr(t('saveFailed'))
      else {
        setDirty(false)
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }
  const eventOptions = (['gain', 'lost', 'public'] as const).map((ev) => ({ value: ev, label: ev }))
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {topic.errors.length > 0 && (
        <div className="mb-2 rounded border border-flag/40 bg-flag/10 px-2 py-1.5 text-[10px] text-flag">
          {topic.errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
      <QuickAdd topic={topic} scenes={orderedScenes} onAdd={(r) => mutate((rs) => [...rs, r])} seed={seed} onSeedConsumed={onSeedConsumed} />
      <div className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-md border border-border bg-canvas/40 px-2 py-1.5">
            <span className="shrink-0 text-[10px] text-faint">{t('records.inLabel')}</span>
            <ScenePicker value={r.scene} onChange={(v) => edit(i, { scene: v })} allowStart className="shrink-0" />
            <Select
              value={r.event}
              onChange={(v) => edit(i, { event: v as CustodyRecord['event'] })}
              options={eventOptions}
              className="w-32 shrink-0"
            />
            <span className="shrink-0 text-[10px] text-faint">→</span>
            <WhoPicker
              value={r.who}
              onChange={(who) => edit(i, { who })}
              disabled={r.event === 'public'}
              noSpecials={r.event === 'lost'} // hides audience only — lost [public] = global amnesia/destruction
            />
            <Input
              value={r.note ?? ''}
              onChange={(e) => edit(i, { note: e.target.value || null })}
              placeholder={t('records.notePh')}
              className="h-7 min-w-0 flex-1 text-[11px]"
            />
            <button onClick={() => remove(i)} title={t('records.deleteCheckpoint')} className="shrink-0 rounded p-1 text-faint hover:text-flag">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="size-3" /> {t('records.checkpointBtn')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          title={t('records.askAiTip')}
          onClick={() => setAiRequest({ tab: 'populate', sel: topic.pageId })}
        >
          <Sparkles className="size-3" /> {t('records.askAi')}
        </Button>
      </div>
    </div>
  )
}

/** Read-only rendered view: prose via the wiki renderer (fence stripped) + checkpoints as a REAL component. */
function TopicPreview({ topic }: { topic: CustodyTopic }): JSX.Element {
  const { t } = useTranslation('custody')
  const scenes = useWorkspace((s) => s.scenes)
  const [doc, setDoc] = useState<{ frontmatter: Record<string, unknown>; body: string } | null>(null)
  const tick = useWorkspace((s) => s.custodyTick) // rollbacks rewrite the file — refetch on the shared tick
  useEffect(() => {
    void window.nvs.readScene(topic.path).then((d) => setDoc({ frontmatter: d.frontmatter, body: d.body }))
  }, [topic.path, tick])
  const sceneTitle = useMemo(() => new Map(scenes.map((sc) => [sc.sceneId, sc.title])), [scenes])
  if (!doc)
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  // the fence renders as its own component below — strip it from the prose pass
  const prose = doc.body.replace(/^```custody\s*\n[\s\S]*?^```\s*$/m, '').replace(/\n{3,}/g, '\n\n')
  const eventTone: Record<CustodyRecord['event'], string> = {
    gain: 'border-lore/50 text-lore',
    lost: 'border-flag/50 text-flag',
    public: 'border-flag/50 text-flag'
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <WikiPreview frontmatter={doc.frontmatter} body={prose} kind="custody" />
      {topic.records.length > 0 && (
        <div className="mx-auto mt-4 max-w-[var(--measure)]">
          <h2 className="mb-2 border-b border-border pb-1 text-sm font-semibold">{t('preview.checkpoints')}</h2>
          <div className="flex flex-col gap-1">
            {topic.records.map((r, i) => (
              <div key={i} className="flex items-baseline gap-2 rounded px-1 py-1 text-[12px]">
                <span className="w-56 shrink-0 truncate text-muted-foreground" title={r.scene}>
                  {sceneTitle.get(r.scene) ?? `⚠ ${r.scene}`}
                </span>
                <span className={cn('shrink-0 rounded border px-1 text-[10px]', eventTone[r.event])}>{r.event}</span>
                {r.who.length > 0 && (
                  <span className="shrink-0">
                    {r.who.map((w) => (
                      <span key={w} className={cn('mr-1 rounded bg-panel-soft px-1 text-[11px]', w === 'audience' && 'text-lore', w === 'public' && 'text-flag')}>
                        {w}
                      </span>
                    ))}
                  </span>
                )}
                {r.note && <span className="min-w-0 flex-1 truncate text-faint" title={r.note}>— {r.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Raw body editing — the escape hatch (frontmatter preserved as-is on save). */
/** The PROSE write surface (Overview · Truth · Notes — the sections Records can't reach). Saving runs
 *  the SAME grammar gate as AI applies: prose edits flow freely, but a hand-broken ```custody fence
 *  refuses to save (with the parse error shown) — and a clean save writes the CANONICAL form. */
function TopicWrite({ topic, onSaved, saveRef, onState }: { topic: CustodyTopic; onSaved: () => void; saveRef: React.MutableRefObject<(() => void) | null>; onState: (st: { dirty: boolean; saving: boolean; err: string | null }) => void }): JSX.Element {
  const { t } = useTranslation('custody')
  const [text, setText] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pushHistory = useWorkspace((s) => s.pushPageHistory)
  useEffect(() => {
    void window.nvs.readScene(topic.path).then((d) => setText(d.body))
  }, [topic.path])
  useSaveTarget(true, () => { if (dirty && !saving) void save() }, () => dirty)
  // Surface save + state to the custody header (like RecordsForm), so Save sits in the top header — consistent
  // with scene/world/Records — instead of SourceTab's own bottom bar (which we hide via `chromeless`).
  useEffect(() => { saveRef.current = () => void save(); return () => { saveRef.current = null } })
  useEffect(() => onState({ dirty, saving, err }), [dirty, saving, err, onState])
  async function save(): Promise<void> {
    if (text == null) return
    setSaving(true)
    setErr(null)
    try {
      const check = await window.nvs.parseCustodyBlock(text)
      if (check.errors.length > 0) {
        setErr(t('write.fenceBroken', { error: check.errors[0] }))
        return
      }
      const doc = await window.nvs.readScene(topic.path)
      pushHistory(topic.path, doc?.body ?? '', t('history.proseEdit'))
      const ok = await window.nvs.writeScene(topic.path, doc.frontmatter, check.canonical)
      if (!ok) {
        setErr(t('saveFailed'))
        return
      }
      setText(check.canonical)
      setDirty(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }
  if (text == null)
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  return (
    <SourceTab
      text={text}
      onChange={(t) => {
        setText(t)
        setDirty(true)
        setErr(null)
      }}
      onSave={() => void save()}
      dirty={dirty}
      saving={saving}
      error={err}
      chromeless
    />
  )
}

function TopicSource({ path }: { path: string }): JSX.Element {
  // READ-ONLY by design: the source view exists for INSPECTION (yours and the AI job's) — the chart's
  // truth is the ```custody block, and hand-edits here are how charts break. Structured edits go through
  // the Records tab; prose cleanup goes through the /ag custody-records job.
  const [text, setText] = useState<string | null>(null)
  const tick = useWorkspace((s) => s.custodyTick)
  useEffect(() => {
    void window.nvs.readScene(path).then((d) => setText(d.body))
  }, [path, tick])
  if (text == null)
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  return <SourceTab key={`${path}:${tick}`} text={text} readOnly />
}

/** How the Custody rail works — the flow, the syntax, and where it sits in the tier model. */
function CustodyHelp({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('custody')
  return (
    <Dialog open={open} onClose={onClose} title={t('help.title')} size="detail">
      <div className="space-y-5">
        <HelpSection title={t('help.shows.title')}>
          <HelpList items={t('help.shows.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.flow.title')}>
          <HelpTable rows={(t('help.flow.rows', { returnObjects: true }) as { k: string; v: string }[]).map((r) => [r.k, r.v] as [string, import('react').ReactNode])} />
        </HelpSection>
        <HelpSection title={t('help.grammar.title')}>
          <HelpTable rows={(t('help.grammar.rows', { returnObjects: true }) as { k: string; v: string }[]).map((r) => [r.k, r.v] as [string, import('react').ReactNode])} />
        </HelpSection>
        <HelpSection title={t('help.observed.title')}>
          <HelpList items={t('help.observed.items', { returnObjects: true }) as string[]} />
        </HelpSection>
        <HelpSection title={t('help.where.title')}>
          <HelpList items={t('help.where.items', { returnObjects: true }) as string[]} />
        </HelpSection>
      </div>
    </Dialog>
  )
}
