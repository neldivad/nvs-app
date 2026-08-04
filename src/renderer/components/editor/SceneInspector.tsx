/**
 * SceneInspector — the scene editor's right-hand aside (counterpart to the world-page Outline; both sit in the
 * shared EditorAside shell). Where Scrivener's Inspector shows blank cards you fill in, this shows what NVS has
 * ALREADY DERIVED about the open scene. Every category is ALWAYS listed: populated when there's data, otherwise a
 * faint "ghost" line stating what triggers it — so the panel doubles as a legend for what the reader surfaces,
 * instead of hiding and reappearing.
 *
 * Reads only already-loaded store state (useSceneContext) plus a one-shot fetch of the secret/custody event
 * lists. Purpose (goals + conflicts) awaits a per-scene `sceneAnalysis` engine query and is not shown yet.
 */
import { createContext, useContext, useEffect, useMemo, useState, type JSX } from 'react'
import { BookText, BookMarked, TrendingUp, Boxes, Package, Spline, TriangleAlert, KeyRound, Users, Target, LogIn, Flag, Eye, EyeOff, type LucideIcon } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { useSceneContext } from '@/lib/editor/sceneContext'
import { EditorAside } from './EditorAside'
import { threadVisual } from '@/config/threadVisual'
import { cn } from '@/lib/utils'
import type { ArcChangeEvent, PossessionEvent, SceneAnalysis } from '@shared/ipc'

// When true (the default, toggled by the header eye), a Section with no data hides entirely instead of showing its
// faint ghost line — decluttering the panel to only what the scene actually has. Eye off = the full legend.
const HideEmptyCtx = createContext(false)

// Purpose badge colors. Goal STATUS (stated|pursued|achieved|abandoned) and conflict KIND (interpersonal|internal|
// external) each get a tone so the outcome reads at a glance (achieved = won, abandoned = dropped).
const GOAL_STATUS: Record<string, string> = { achieved: 'text-ok', pursued: 'text-thread', abandoned: 'text-flag', stated: 'text-muted-foreground' }
const CONFLICT_KIND: Record<string, string> = { external: 'text-warn', internal: 'text-character', interpersonal: 'text-flag' }

/** A small uppercase pill — colored text on a neutral chip, matching the arc/entity Changes tables. */
function Tag({ label, tone }: { label: string; tone: string }): JSX.Element {
  return <span className={cn('inline-flex shrink-0 items-center self-start rounded bg-panel-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', tone)}>{label}</span>
}

export function SceneInspector(): JSX.Element | null {
  const ctx = useSceneContext()
  const selectThread = useWorkspace((s) => s.setSelectedThread)
  const selectFinding = useWorkspace((s) => s.setSelectedFinding)
  const selectArc = useWorkspace((s) => s.setSelectedArc) // Arc row → the character's arc detail float (app-level)
  const selectEntity = useWorkspace((s) => s.setSelectedEntity) // Entity row → the entity journey float
  const selectLore = useWorkspace((s) => s.setSelectedLore) // Lore row → the reveal-progression float
  const characters = useWorkspace((s) => s.characters)
  const loreView = useWorkspace((s) => s.loreView) // world-fact reveals (disclosures carry a sceneId)
  const entityTracks = useWorkspace((s) => s.entityTracks) // non-character entities + their presence trail
  const nameOf = (id: string): string => characters.find((c) => c.id === id)?.name ?? entityTracks?.find((e) => e.id === id)?.name ?? id.replace(/[-_]/g, ' ') // characters, then item/faction entities, then a prettified id
  const charIds = useMemo(() => new Set(characters.map((c) => c.id)), [characters]) // split arc changes: character vs entity
  // Declutter toggle (header eye) — ON by default hides categories with no entry; persisted like the aside width.
  const [hideEmpty, setHideEmpty] = useState(() => localStorage.getItem('nvs.inspectorHideEmpty') !== '0')
  const toggleHideEmpty = (): void =>
    setHideEmpty((v) => { const n = !v; try { localStorage.setItem('nvs.inspectorHideEmpty', n ? '1' : '0') } catch { /* ignore */ } return n })

  // Purpose (goals + conflicts) — one async read per scene (not on the timeline graph). null = not extracted yet.
  const [purpose, setPurpose] = useState<SceneAnalysis | null>(null)
  useEffect(() => {
    let live = true
    if (!ctx.sceneId) { setPurpose(null); return }
    void window.nvs.sceneAnalysis?.(ctx.sceneId).then((p) => { if (live) setPurpose(p) }).catch(() => { if (live) setPurpose(null) })
    return () => { live = false }
  }, [ctx.sceneId])
  const hasPurpose = !!purpose && (purpose.goals.length > 0 || purpose.conflicts.length > 0)

  // Secret + custody + arc events are whole-project lists; fetch once, filter to this scene (the lists are small).
  // Secrets and custody are kept SEPARATE (not merged) — their subjects differ (a secret's is the LEARNER, a
  // custody's is the ITEM+holder), so they render as two distinct sections.
  const [secretEvents, setSecretEvents] = useState<PossessionEvent[]>([])
  const [custodyEvents, setCustodyEvents] = useState<PossessionEvent[]>([])
  const [arcEvents, setArcEvents] = useState<ArcChangeEvent[]>([])
  useEffect(() => {
    let live = true
    void Promise.all([window.nvs.listSecretEvents?.() ?? [], window.nvs.listCustodyEvents?.() ?? [], window.nvs.listArcEvents?.() ?? []])
      .then(([s, c, a]) => { if (live) { setSecretEvents(s); setCustodyEvents(c); setArcEvents(a) } })
      .catch(() => { if (live) { setSecretEvents([]); setCustodyEvents([]); setArcEvents([]) } })
    return () => { live = false }
  }, [])
  const secretsHere = useMemo(() => secretEvents.filter((e) => e.sceneId === ctx.sceneId), [secretEvents, ctx.sceneId])
  const custodyHere = useMemo(() => custodyEvents.filter((e) => e.sceneId === ctx.sceneId), [custodyEvents, ctx.sceneId])
  // Per-scene ledgers: world-facts REVEALED (lore), CHARACTER state changes (arc), and non-character ENTITIES present.
  const loreHere = useMemo(() => (loreView?.topics ?? []).filter((t) => t.disclosures.some((d) => d.sceneId === ctx.sceneId)), [loreView, ctx.sceneId])
  const arcHere = useMemo(() => arcEvents.filter((e) => e.sceneId === ctx.sceneId && charIds.has(e.entityId)), [arcEvents, ctx.sceneId, charIds])
  const entityHere = useMemo(() => (entityTracks ?? []).filter((e) => e.scenes.some((s) => s.sceneId === ctx.sceneId)), [entityTracks, ctx.sceneId])

  if (!ctx.isScene) return null

  return (
    <EditorAside
      title="Inspector"
      widthKey="nvs.inspectorW"
      defaultWidth={256}
      selectable
      region="sceneInspector"
      action={
        <button
          onClick={toggleHideEmpty}
          title={hideEmpty ? 'Showing filled categories — click to show all' : 'Showing all categories — click to hide empty'}
          className={cn('transition-colors hover:text-foreground', hideEmpty ? 'text-muted-foreground' : 'text-faint')}
        >
          {hideEmpty ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
      }
    >
      <HideEmptyCtx.Provider value={hideEmpty}>
      {/* Premise — why the scene starts (the setup/hook). A checkpoint component (analysis-components.md);
          empty on legacy rows extracted before the premise/conclusion split — the Summary still carries it. */}
      <Section icon={LogIn} label="Premise" empty={!purpose?.premise} ghost="Why this scene opens appears here once it's read.">
        <p className="px-3 pb-2 text-[12px] leading-relaxed text-prose">{purpose?.premise}</p>
      </Section>

      {/* Summary */}
      <Section icon={BookText} label="Summary" empty={!ctx.summary} ghost="A one-line summary appears once this scene is read.">
        <p className="px-3 pb-1 text-[12px] leading-relaxed text-prose">{ctx.summary}</p>
        {ctx.pov && <div className="px-3 pb-2"><span className="rounded bg-panel-soft px-1.5 py-0.5 text-[10px] text-muted-foreground">POV · {ctx.pov}</span></div>}
      </Section>

      {/* Conclusion — how it ends / the cliffhanger it leaves on. */}
      <Section icon={Flag} label="Conclusion" empty={!purpose?.conclusion} ghost="How this scene ends (its outcome or cliffhanger) appears here once it's read.">
        <p className="px-3 pb-2 text-[12px] leading-relaxed text-prose">{purpose?.conclusion}</p>
      </Section>

      {/* Purpose — goals + conflicts (the scene's dramatic function / value shift) */}
      <Section icon={Target} label="Purpose" empty={!hasPurpose} ghost="The goals and conflicts driving this scene appear here once it's read.">
        {/* One table (like the arc Changes grid): WHO wants / clashes over WHAT, with a colorized status/kind badge. */}
        <div className="mx-3 mb-2 grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1.5 rounded-md border border-border/60 px-3 py-2 text-[12px] leading-snug">
          <div className="text-[9px] uppercase tracking-wide text-faint">Who</div>
          <div className="text-[9px] uppercase tracking-wide text-faint">Wants / Conflicts</div>
          <div className="text-[9px] uppercase tracking-wide text-faint">Outcome</div>
          {purpose?.goals.map((g, i) => (
            <div key={`g${i}`} className="contents">
              <span className="self-start truncate text-thread">{nameOf(g.actor)}</span>
              <span className="text-foreground/85">{g.goal}</span>
              {g.status ? <Tag label={g.status} tone={GOAL_STATUS[g.status] ?? 'text-muted-foreground'} /> : <span className="justify-self-end text-faint">—</span>}
            </div>
          ))}
          {purpose?.conflicts.map((c, i) => (
            <div key={`c${i}`} className="contents">
              <span className="self-start min-w-0">
                {c.between.map((b, j) => (
                  <span key={j}>{j > 0 && <span className="text-flag/80"> vs </span>}<span className="text-foreground/85">{nameOf(b)}</span></span>
                ))}
              </span>
              <span className="text-foreground/85">{c.over}</span>
              {c.kind ? <Tag label={c.kind} tone={CONFLICT_KIND[c.kind] ?? 'text-muted-foreground'} /> : <span className="justify-self-end text-faint">—</span>}
            </div>
          ))}
        </div>
      </Section>

      {/* Cast present */}
      <Section icon={Users} label="Cast" count={ctx.cast.length} empty={ctx.cast.length === 0} ghost="Characters present in this scene are listed here.">
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {ctx.cast.map((m) => (
            <span
              key={m.entityId}
              title={`${m.volume ? 'speaking' : 'silently present'}${m.role ? ` · ${m.role}` : ''}`}
              className={cn('rounded px-1.5 py-0.5 text-[11px]', m.volume ? 'bg-character/15 text-foreground/85' : 'bg-panel-soft text-muted-foreground')}
            >
              {m.name}
            </span>
          ))}
        </div>
      </Section>

      {/* Threads */}
      <Section icon={Spline} label="Threads" count={ctx.threads.length} empty={ctx.threads.length === 0} ghost="Threads opened, advanced, or resolved in this scene appear here.">
        {ctx.threads.map(({ action, thread }) => (
          <Row key={thread.id} onClick={() => selectThread(thread.id, ctx.sceneId)} title={thread.slug}>
            <span className={cn('mt-1 size-2 shrink-0 rounded-full', threadVisual(thread.type).bg)} title={threadVisual(thread.type).label} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/85">{thread.title ?? thread.slug.replace(/_/g, ' ')}</span>
              <span className="block text-[10px] uppercase tracking-wide text-faint">{action}</span>
            </span>
          </Row>
        ))}
      </Section>

      {/* Arc — character state changes (alignment/knowledge/power/…) that land in this scene (entity_arc_events, sans secret/custody). */}
      <Section icon={TrendingUp} label="Arc" count={arcHere.length} empty={arcHere.length === 0} ghost="Character state changes (alignment, knowledge, power…) in this scene appear here once it's read.">
        {arcHere.map((e, i) => (
          <Row key={`a${i}`} onClick={() => selectArc(e.entityId, ctx.sceneId ? `${ctx.sceneId}\u0001${e.value}` : null)} title={`Open ${nameOf(e.entityId)}'s arc`}>
            <span className="mt-1 size-2 shrink-0 rounded-full bg-character" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/85"><span className="text-thread">{nameOf(e.entityId)}</span> — {e.value || e.description}</span>
              <span className="block text-[10px] uppercase tracking-wide text-faint">{e.category} · {e.change}</span>
            </span>
          </Row>
        ))}
      </Section>

      {/* Entities — non-character trackeds (items, factions…) present in this scene, from the entity presence trail. */}
      <Section icon={Boxes} label="Entities" count={entityHere.length} empty={entityHere.length === 0} ghost="Items, factions, and other tracked entities present in this scene appear here.">
        {entityHere.map((e) => (
          <Row key={e.id} onClick={() => selectEntity(e.id, ctx.sceneId)} title={`Open ${e.name}'s journey`}>
            <span className="mt-1 size-2 shrink-0 rounded-full bg-lore/70" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/85">{e.name}</span>
              <span className="block text-[10px] uppercase tracking-wide text-faint">{e.type}{e.significance ? ` · ${e.significance}` : ''}</span>
            </span>
          </Row>
        ))}
      </Section>

      {/* Lore — world-facts REVEALED in this scene (a disclosure lands here), shaped like the Lore rail's staircase. */}
      <Section icon={BookMarked} label="Lore" count={loreHere.length} empty={loreHere.length === 0} ghost="World-facts revealed in this scene appear here once it's read.">
        {loreHere.map((t) => {
          const d = t.disclosures.find((x) => x.sceneId === ctx.sceneId)
          return (
            <Row key={t.loreId} onClick={() => selectLore(t.loreId)} title={`Open “${t.label}” reveal timeline`}>
              <span className={cn('mt-1 size-2 shrink-0 rounded-full', t.hasRetcon ? 'bg-flag' : 'bg-lore')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate capitalize text-foreground/85">{t.label}</span>
                <span className="block truncate text-[10px] text-faint">{d?.summary || (d?.magnitude ?? 'revealed')}</span>
              </span>
            </Row>
          )
        })}
      </Section>

      {/* Coherence flags */}
      <Section icon={TriangleAlert} label="Flags" count={ctx.flags.length} empty={ctx.flags.length === 0} ghost="Coherence flags that cite this scene appear here.">
        {ctx.flags.map((f) => (
          <Row key={f.id} onClick={() => selectFinding(f.id)}>
            <span className={cn('mt-1 size-2 shrink-0 rounded-full', f.severity === 'high' ? 'bg-flag' : 'bg-warn')} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/85">{f.trait}</span>
              <span className="block text-[10px] text-faint">{f.kind}</span>
            </span>
          </Row>
        ))}
      </Section>

      {/* Secrets — who KNOWS. Subject = the LEARNER (a character); `expose` also names who it reached. Click → the
          learner's arc. Distinct from Custody (items) — the two lanes of the Custody pillar. */}
      <Section icon={KeyRound} label="Secrets" count={secretsHere.length} empty={secretsHere.length === 0} ghost="Secrets learned or exposed in this scene appear here.">
        {secretsHere.map((e, i) => (
          <Row key={`s${i}`} onClick={() => selectArc(e.entityId, ctx.sceneId ? `${ctx.sceneId}\u0001${e.value}` : null)} title={`Open ${nameOf(e.entityId)}'s arc`}>
            <span className="mt-1 size-2 shrink-0 rounded-full bg-lore" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/85"><span className="text-thread">{nameOf(e.entityId)}</span> — {e.description || e.value}</span>
              <span className="block text-[10px] uppercase tracking-wide text-faint">secret · {e.change}{e.target ? ` → ${nameOf(e.target)}` : ''}</span>
            </span>
          </Row>
        ))}
      </Section>

      {/* Custody — who HOLDS. Subject = the ITEM; `target` = the new holder. Click → the item's journey. */}
      <Section icon={Package} label="Custody" count={custodyHere.length} empty={custodyHere.length === 0} ghost="Items changing hands in this scene appear here." last>
        {custodyHere.map((e, i) => (
          <Row key={`c${i}`} onClick={() => selectEntity(e.entityId, ctx.sceneId ? `${ctx.sceneId}${e.value}` : null)} title={`Open ${nameOf(e.entityId)}'s journey`}>
            <span className="mt-1 size-2 shrink-0 rounded-full bg-character" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/85"><span className="text-lore">{nameOf(e.entityId)}</span>{e.target ? <> → <span className="text-thread">{nameOf(e.target)}</span></> : null}</span>
              <span className="block text-[10px] uppercase tracking-wide text-faint">custody · {e.change}</span>
            </span>
          </Row>
        ))}
      </Section>
      </HideEmptyCtx.Provider>
    </EditorAside>
  )
}

/**
 * One inspector category. Always renders its header; shows `children` when populated, else a faint ghost line
 * naming what fills it — the panel's built-in legend. `count` decorates the header only when there's data.
 */
function Section({
  icon: Icon,
  label,
  count,
  empty,
  ghost,
  last,
  children
}: {
  icon: LucideIcon
  label: string
  count?: number
  empty: boolean
  ghost: string
  last?: boolean
  children?: React.ReactNode
}): JSX.Element | null {
  // Declutter: with the header eye ON, a category with no data drops out entirely (rather than showing its ghost).
  const hideEmpty = useContext(HideEmptyCtx)
  if (empty && hideEmpty) return null
  return (
    <div className={cn('py-1', !last && 'border-b border-border/60')}>
      <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" /> {label}
        {!empty && count != null && <span className="text-faint">· {count}</span>}
      </div>
      {empty ? <p className="px-3 pb-1.5 pt-0.5 text-[11px] italic leading-relaxed text-faint">{ghost}</p> : children}
    </div>
  )
}

function Row({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }): JSX.Element {
  return (
    <button onClick={onClick} title={title} className="flex w-full items-start gap-2 px-3 py-1 text-left text-[12px] hover:bg-panel-soft">
      {children}
    </button>
  )
}
