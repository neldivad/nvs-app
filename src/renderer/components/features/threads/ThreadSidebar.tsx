/**
 * ThreadsRail sidebar — the pivot navigator. A tab row (Thread · Character · Entity) swaps both the
 * roster here and the main-area lens. Thread roster = the promises; Character roster = who has an
 * arc; Entity = items/factions (data-blocked until extraction emits them). Clicking selects, which
 * highlights in the map + opens the relevant Sheet. Provenance (ⓘ inferred) shows from the first surface.
 */
import { JSX, useMemo, useState } from 'react'
import { regionAttrs } from '@/config/regions'
import { Info, Copy, GitMerge, Loader2, Sparkles } from 'lucide-react'
import { AnalysisRunDialog } from '@/components/features/analysis/AnalysisRunDialog'
import { useWorkspace } from '@/stores/workspace'
import { threadVisual } from '@/config/threadVisual'
import { entityVisual } from '@/config/entityVisual'
import { LoreRoster } from '@/components/features/lore/LorePanel'
import { SidebarRow, SidebarHeader, SidebarScroll, CollapsibleLabel, RosterSection } from '@/components/layout/SidebarKit'
import { duplicateThreadGroups } from '@/lib/analysis/threadDups'
import { offAxisThreads } from '@/lib/timeline/threadAxis'
import { useSceneAxis } from '@/lib/timeline/sceneAxis'
import { GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Thread } from '@shared/ipc'
import { SidebarEmpty } from '@/components/ui/EmptyRailState'

export function ThreadSidebar(): JSX.Element {
  const tab = useWorkspace((s) => s.threadsTab)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // off → hide the "Update analysis" run trigger (analysis is AI)
  const [runOpen, setRunOpen] = useState(false) // reuses the dock's pre-run gate — see AnalysisRunDialog

  return (
    <div {...regionAttrs('threadSidebar')} className="flex h-full flex-col bg-panel">
      {/* Tabs live on the main page (cast-style); the sidebar just labels the current view. The action mirrors
          Custody's sidebar trigger — opens the SAME pre-run dialog the dock uses (no duplicate surface). */}
      <SidebarHeader
        title={tab}
        action={
          aiEnabled ? (
            <button
              title="Update analysis — read changed scenes into the ledgers (the same run as the console)"
              onClick={() => setRunOpen(true)}
              className="rounded p-0.5 text-faint transition-colors hover:text-thread"
            >
              <Sparkles className="size-3.5" />
            </button>
          ) : undefined
        }
      />
      <SidebarScroll className="pb-3">
        {tab === 'thread' ? <ThreadRoster /> : tab === 'character' ? <CharacterRoster /> : tab === 'lore' ? <LoreRoster /> : <EntityRoster />}
      </SidebarScroll>
      {runOpen && <AnalysisRunDialog open onClose={() => setRunOpen(false)} />}
    </div>
  )
}

function ThreadRoster(): JSX.Element {
  const threads = useWorkspace((s) => s.threads)
  const selected = useWorkspace((s) => s.selectedThreadId)
  const select = useWorkspace((s) => s.setSelectedThread)
  const scenes = useWorkspace((s) => s.scenes)
  const graph = useWorkspace((s) => s.timelineGraph)

  // Off-route threads (beats land only on scenes NOT on the active axis) get their own section — they can't be
  // charted on this route, so the gantt drops them; we list them here instead of a bottom bar in the pane.
  const cols = useSceneAxis(scenes)
  const onAxisThreadIds = useMemo(() => {
    const axis = new Set(cols.map((s) => s.sceneId))
    const ids = new Set<string>()
    for (const [sid, sc] of Object.entries(graph.scenes)) {
      if (!axis.has(sid)) continue
      for (const t of sc.threads) ids.add(t.threadId)
    }
    return ids
  }, [graph, cols])
  const offBranch = useMemo(() => offAxisThreads(threads ?? [], onAxisThreadIds), [threads, onAxisThreadIds])

  // Open / Resolved show only threads ON this route; off-route ones move to their own section (3-way partition).
  const { open, closed } = useMemo(() => {
    const off = new Set(offBranch.map((t) => t.id))
    const list = (threads ?? []).filter((t) => !off.has(t.id))
    return { open: list.filter((t) => t.status === 'open'), closed: list.filter((t) => t.status !== 'open') }
  }, [threads, offBranch])

  // Read-only dedup nudge: threads sharing a slug-tail are probably one promise re-opened. No merge yet —
  // we surface them so the author can check (and so we learn how often this fires on real stories).
  const dups = useMemo(() => duplicateThreadGroups(threads ?? []), [threads])

  // At hundreds of threads the flat list overwhelms. Sections collapse; Resolved + Other-branches start
  // collapsed (you usually work the Open ones), Open stays expanded. Counts show on the collapsed header.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['resolved', 'other']))
  const toggle = (k: string): void => setCollapsed((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  const row = (t: Thread): JSX.Element => {
    const v = threadVisual(t.type)
    const on = selected === t.id
    return (
      <SidebarRow
        key={t.id}
        selected={on}
        dim={t.status !== 'open'}
        onClick={() => select(on ? null : t.id)}
        title={t.description || t.slug}
        leading={<span className={cn('size-2 shrink-0 rounded-full', v.bg)} title={v.label} />}
        label={t.title || t.slug}
        labelClassName={cn(!t.title && 'font-mono')}
        trailing={t.builtBy === 'inferred' ? <Info className="size-3 shrink-0 text-faint" /> : undefined}
        meta={t.beats}
      />
    )
  }

  if (threads == null) return <p className="px-3 py-2 text-xs text-muted-foreground">Reading…</p>
  if (threads.length === 0) return <SidebarEmpty>No threads yet — analysis populates these.</SidebarEmpty>
  const section = (id: string, label: JSX.Element | string, items: Thread[]): JSX.Element | null => {
    if (items.length === 0) return null
    const isOpen = !collapsed.has(id)
    return (
      <>
        <CollapsibleLabel open={isOpen} count={items.length} onClick={() => toggle(id)}>{label}</CollapsibleLabel>
        {isOpen && items.map(row)}
      </>
    )
  }

  return (
    <>
      {dups.length > 0 && <DuplicateNudge groups={dups} selected={selected} onSelect={(id) => select(id === selected ? null : id)} />}
      {section('open', 'Open', open)}
      {section('resolved', 'Resolved', closed)}
      {section('other', <span className="inline-flex items-center gap-1"><GitBranch className="size-3" /> Other branches</span>, offBranch)}
    </>
  )
}


/**
 * A flag for threads that share a slug-tail (likely one promise re-opened under a new scene). Each member is
 * clickable to inspect; a non-recast group offers **Merge** — folds them into the earliest opener (the engine's
 * canonical), then re-pulls the analysis views. A `succeeds`-linked group is an intentional recast, so it's
 * shown but NOT mergeable. Merge is a maintenance op (atomic, snapshot-reversible) — the author triggers it.
 */
function DuplicateNudge({
  groups,
  selected,
  onSelect
}: {
  groups: ReturnType<typeof duplicateThreadGroups>
  selected: string | null
  onSelect: (id: string) => void
}): JSX.Element {
  const refresh = useWorkspace((s) => s.refreshAnalysisViews)
  const notify = useWorkspace((s) => s.pushNotification)
  const [confirming, setConfirming] = useState<string | null>(null) // slug awaiting confirm
  const [busy, setBusy] = useState<string | null>(null) // slug being merged

  const doMerge = async (g: ReturnType<typeof duplicateThreadGroups>[number]): Promise<void> => {
    setConfirming(null)
    setBusy(g.slug)
    try {
      const res = await window.nvs.mergeThreads(g.threads.map((t) => t.id))
      if (res.ok) await refresh()
      else notify({ id: 'thread-merge', kind: 'warning', title: 'Merge failed', body: res.error ?? 'unknown error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-2 my-2 rounded-md border border-warn/25 bg-warn/6 px-2.5 py-2 text-[11px]">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold uppercase tracking-wide text-warn/90">
        <Copy className="size-3" /> {groups.length} possible duplicate{groups.length > 1 ? 's' : ''}
      </div>
      <p className="mb-2 text-[10px] leading-snug text-faint">
        These threads share a handle — likely one promise re-opened. Open each to compare, then merge to fold them into the earliest.
      </p>
      <div className="space-y-2">
        {groups.map((g) => {
          const canonical = g.threads[0] // earliest opener = the one the merge keeps (★)
          const canonLabel = canonical.title || canonical.slug
          return (
            <div key={g.slug} className="rounded border border-border/50 bg-panel/40 p-1.5">
              {/* header: the shared handle (truncates) + the action; button is shrink-0 so it never clips */}
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-faint" title={`shared handle: ${g.slug}`}>{g.slug}</span>
                {g.superseded ? (
                  <span className="shrink-0 text-[9px] text-faint" title="A member supersedes another (succeeds) — an intentional recast, not a duplicate. Not mergeable.">recast</span>
                ) : busy === g.slug ? (
                  <span className="flex shrink-0 items-center gap-1 text-[9px] text-faint"><Loader2 className="size-2.5 animate-spin" /> merging…</span>
                ) : (
                  <button
                    onClick={() => setConfirming((s) => (s === g.slug ? null : g.slug))}
                    className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-panel-soft hover:text-foreground"
                    title="Fold these into one thread (the earliest opener)"
                  >
                    <GitMerge className="size-2.5" /> Merge
                  </button>
                )}
              </div>
              {/* the threads by TITLE (so they're findable in the roster/gantt) — ★ marks the one kept */}
              <div className="mt-1 space-y-0.5">
                {g.threads.map((t, i) => (
                  <button
                    key={t.id}
                    onClick={() => onSelect(t.id)}
                    title={`${t.title || t.slug}${t.description ? ` — ${t.description}` : ''}${t.openedAt ? ` · opened ${t.openedAt}` : ''} · ${t.beats} event${t.beats === 1 ? '' : 's'}`}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] transition-colors',
                      selected === t.id ? 'bg-thread/15 text-thread' : 'text-foreground/85 hover:bg-panel-soft'
                    )}
                  >
                    <span className="w-2.5 shrink-0 text-center text-[9px] text-faint" title={i === 0 ? 'kept (earliest)' : 'folds in'}>{i === 0 ? '★' : '↳'}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title || t.slug}</span>
                    <span className="shrink-0 font-mono text-[9px] text-faint">{t.openedAt ?? ''} ·{t.beats}</span>
                  </button>
                ))}
              </div>
              {confirming === g.slug && (
                <div className="mt-1.5 rounded border border-border/70 bg-panel-soft/50 px-1.5 py-1 text-[10px]">
                  <p className="mb-1 text-faint">Keep <span className="text-foreground/85">★ {canonLabel}</span> and fold in the other {g.threads.length - 1}?</p>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => void doMerge(g)} className="rounded bg-thread px-2 py-0.5 font-semibold text-thread-foreground hover:opacity-90">Merge</button>
                    <button onClick={() => setConfirming(null)} className="rounded px-1.5 py-0.5 text-faint hover:text-foreground">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CharacterRoster(): JSX.Element {
  const arcs = useWorkspace((s) => s.characterArc)
  const selected = useWorkspace((s) => s.selectedArcId)
  const select = useWorkspace((s) => s.setSelectedArc)

  const rows = useMemo(
    () =>
      [...(arcs ?? [])]
        .map((a) => ({ a, total: a.windows.reduce((n, w) => n + w.events.length, 0) }))
        .sort((x, y) => y.total - x.total || x.a.name.localeCompare(y.a.name)),
    [arcs]
  )

  if (arcs == null) return <p className="px-3 py-2 text-xs text-muted-foreground">Reading…</p>
  if (rows.length === 0) return <SidebarEmpty>No character arc recorded yet.</SidebarEmpty>
  return (
    <>
      {rows.map(({ a, total }) => {
        const on = selected === a.entityId
        return (
          <SidebarRow
            key={a.entityId}
            selected={on}
            onClick={() => select(on ? null : a.entityId)}
            label={a.name}
            meta={`${a.windows.length}w · ${total}`}
          />
        )
      })}
    </>
  )
}

/** Tracked non-character entities (items · factions · … — open vocabulary), grouped by type. */
function EntityRoster(): JSX.Element {
  const tracks = useWorkspace((s) => s.entityTracks)
  const selected = useWorkspace((s) => s.selectedEntityId)
  const select = useWorkspace((s) => s.setSelectedEntity)

  const [hideUnseen, setHideUnseen] = useState(false) // 0-scene entries (authored but not yet in any scene)

  const { groups, unseen } = useMemo(() => {
    const src = tracks ?? []
    const unseen = src.filter((t) => t.scenes.length === 0).length
    const visible = hideUnseen ? src.filter((t) => t.scenes.length > 0) : src
    const byType = new Map<string, NonNullable<typeof tracks>>()
    for (const t of visible) {
      if (!byType.has(t.type)) byType.set(t.type, [])
      byType.get(t.type)!.push(t)
    }
    return { groups: [...byType.entries()].sort((a, b) => b[1].length - a[1].length), unseen }
  }, [tracks, hideUnseen])

  if (tracks == null) return <p className="px-3 py-2 text-xs text-muted-foreground">Reading…</p>
  if ((tracks?.length ?? 0) === 0)
    return <SidebarEmpty>Nothing tracked yet — run analysis to discover the items and factions your scenes feature.</SidebarEmpty>
  return (
    <>
      {/* 0-scene filter: authored items/factions that don't appear in any scene yet — hide the clutter. */}
      {unseen > 0 && (
        <div className="flex justify-end px-2 pt-1">
          <button onClick={() => setHideUnseen((v) => !v)} className="text-[10px] text-faint underline-offset-2 hover:text-foreground hover:underline">
            {hideUnseen ? `show ${unseen} unseen` : `hide ${unseen} unseen`}
          </button>
        </div>
      )}
      {groups.map(([type, list]) => {
        const { Icon, text } = entityVisual(type)
        return (
          <RosterSection key={type} count={list.length} label={<span className="inline-flex items-center gap-1.5"><Icon className={cn('size-3', text)} /> {type}s</span>}>
            {list.map((t) => {
              const on = selected === t.id
              return <SidebarRow key={t.id} selected={on} onClick={() => select(on ? null : t.id)} label={t.name} meta={`${t.scenes.length}sc`} />
            })}
          </RosterSection>
        )
      })}
    </>
  )
}
