/**
 * The replayable app tour (Help → Tour the app) — the author's curriculum, sequenced by CATEGORY and
 * KIND-SCOPED to the project's domain: FICTION walks Writing → Sequencing → Analysis → Custody → More;
 * NON-FICTION skips the author-only Sequencing + Custody and gets a Learnings step instead (steps carry an
 * optional `kinds`; unmarked = shared). Each step spotlights a `data-region`
 * marker via the SAME registry as the debug overlay (config/regions), so the tour can't drift from real
 * components. A region that isn't mounted (e.g. the tab strip with no open pages) shows the card
 * CENTERED instead of skipping — the tour never auto-advances (the v1 skip read as a bug).
 */
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { useWorkspace, type WorkspaceId } from '@/stores/workspace'
import { regionSelector, type RegionId } from '@/config/regions'
import { useModalEscape } from '@/lib/editor/escapeStack'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TourStep {
  section: string
  region: RegionId
  title: string
  body: string
  workspace?: WorkspaceId
  /** Which KIND(s) this step is for. Omitted = both. Fiction gets Sequencing + Custody; non-fiction skips those
   *  (a transcript has no author-authored timeline or custody) and gets Learnings instead. See the create-wizard
   *  KIND choice — the tour is the same domain concept as the analysis, told as a walkthrough. */
  kinds?: ('fiction' | 'nonfiction')[]
}

const TOUR_STEPS: TourStep[] = [
  // ── Writing ─────────────────────────────────────────────────────────────────
  {
    section: 'Writing',
    region: 'sceneNavigator',
    workspace: 'editor',
    title: 'Your first pages',
    body: 'A novel here is the completed sum of SCENE files — don’t one-shot a manuscript. Break the story into scenes, organize scenes into chapter folders; every rail downstream reads this structure.'
  },
  {
    section: 'Writing',
    region: 'sceneEditor',
    workspace: 'editor',
    title: 'Scenes are turn-based, not free text',
    body: 'A scene follows a Fountain-style format: characters take turns speaking, thinking, and acting — closer to a screenplay than prose. Type / for a block (speaking · thinking · action); prefer character action over long narration.'
  },
  {
    section: 'Writing',
    region: 'sceneEditor',
    workspace: 'editor',
    title: 'Write · Preview · Source',
    body: 'Every page has three views in the header: Write (the editor), Preview (how it reads), and Source (raw Markdown). Source is read-only by default — advanced authors can enable Settings → “Edit source directly” to hand-edit the raw file (know the format first).'
  },
  {
    section: 'Writing',
    region: 'editorFab',
    workspace: 'editor',
    title: 'Properties & help',
    body: 'Properties (header) holds a page’s frontmatter — cast, beat, phase. The ? help Fab (bottom of every rail) and F8 explain the pane you’re in.'
  },
  {
    section: 'Writing',
    region: 'worldNavigator',
    workspace: 'world',
    title: 'World pages — the private wiki',
    body: 'World pages are the author’s declaration of identity: who a character IS, what a place means. Readers never see them and the novel doesn’t ship them — they exist so you (and the analysis) share one truth.'
  },
  {
    section: 'Writing',
    region: 'worldNavigator',
    workspace: 'world',
    title: 'Categories & avatars',
    body: 'Characters, locations, items, factions, lore, information — your Project Structure template picks the set. Add an image in Properties to give characters avatars; the wiki reads better complete.'
  },
  {
    section: 'Writing',
    region: 'corkboardPanel',
    workspace: 'corkboard',
    title: 'Corkboard — think it through',
    body: 'A freeform planning canvas: drop cards, jot notes, draw connections by hand, and pin scenes or pages to a card. Your loose thinking space — separate from the reading-order timeline — for outlines, theories, and what-ifs before they become scenes. Multiple boards per project.'
  },
  {
    section: 'Writing',
    region: 'sceneNavigator',
    workspace: 'editor',
    title: 'CRITICAL: declare pages canon',
    body: 'Analysis only reads pages YOU have confirmed. Right-click a page (or open Properties) and set its phase to canon — non-canon pages are ignored by every AI feature. If a rail looks empty, check canon first.'
  },

  // ── Sequencing pages ────────────────────────────────────────────────────────
  {
    section: 'Sequencing',
    kinds: ['fiction'], // a transcript has no author-authored reading-order timeline
    region: 'timelinePanel',
    workspace: 'timeline',
    title: 'The timeline — how the story is read',
    body: 'Connect scenes in reading order. Branching and merging are supported — alternate timelines, or multiple POV strands converging on one point.'
  },
  {
    section: 'Sequencing',
    kinds: ['fiction'], // a transcript has no author-authored reading-order timeline
    region: 'timelinePanel',
    workspace: 'timeline',
    title: 'Connecting scenes',
    body: 'Drop a chapter folder to lay its scenes down in order, or connect scenes by hand (side-story folders included). Quick-connect and quick-remove keep rework cheap; the layer view sanity-checks canon status per scene.'
  },
  {
    section: 'Sequencing',
    kinds: ['fiction'], // a transcript has no author-authored reading-order timeline
    region: 'timelinePanel',
    workspace: 'timeline',
    title: 'Chart Config — saved routes',
    body: 'Save multiple SEQUENCES of the same scenes: branching paths, alternate routes, or a parallel story joining mid-way. Every chart follows the active route — and each route can get its own analysis run.'
  },
  {
    section: 'Sequencing',
    kinds: ['fiction'],
    region: 'cellView',
    workspace: 'timeline',
    title: 'Cell flow — see the branches',
    body: 'The Cells tab draws the active route as a visual-novel flowchart: main route centered, branches flanking, merges colored. Right-click a scene to paint its whole route a color. Read-only — a way to SEE the shape you wired on the Canvas.'
  },

  // ── Project details ──────────────────────────────────────────────────────────
  {
    section: 'Project details',
    region: 'titleBar',
    title: 'Set up the project',
    body: 'Project → Info holds the work’s identity — title, cover, credits — and its KIND (fiction / non-fiction), which shapes what the analysis looks for. Set the work’s language here too (Project Structure, ⌘,): every summary and finding is written in it, so a wrong first run costs a re-run.'
  },

  // ── Analysis (basic → advanced) ──────────────────────────────────────────────
  {
    section: 'Analysis',
    region: 'castPanel',
    workspace: 'cast',
    title: 'Basic & free: presence',
    body: 'Cast and Relationships count who appears where across your files — no AI needed. Each person’s footprint, shared scenes, and dialogue volume, straight from the text.'
  },
  {
    section: 'Analysis',
    kinds: ['fiction'],
    region: 'threadsPanel',
    workspace: 'threads',
    title: 'Advanced: tracing what you opened',
    body: 'Update analysis reads your canon scenes and returns Threads (every promise and its payoff), character arcs, entity journeys, and Lore reveals — the plot points you opened, traced.'
  },
  {
    section: 'Analysis',
    kinds: ['fiction'],
    region: 'coherencePanel',
    workspace: 'coherence',
    title: 'Advanced: a second reader',
    body: 'Coherence compares what your pages DECLARE against what the scenes SHOW — drift, contradictions, gaps. A tireless second audience verifying your intention, not an editor rewriting you.'
  },
  {
    section: 'Analysis',
    kinds: ['nonfiction'],
    region: 'castPanel',
    workspace: 'cast',
    title: 'Who’s talking, and how much',
    body: 'No AI, no waiting — Cast reads your transcript directly: who speaks, and how much by CHARACTER VOLUME (a long answer outweighs many short questions — turn counts would call them equal). Timeline shows the flow. Deeper, custom analysis will arrive as a skill you run on demand.'
  },

  // ── Custody ─────────────────────────────────────────────────────────────────
  {
    section: 'Custody',
    kinds: ['fiction'],
    region: 'custodyPanel',
    workspace: 'custody',
    title: 'Reader experience: who holds, who knows',
    body: 'Your authored timetable of possession: which character holds an item, who knows a secret, scene by scene. The AUDIENCE row is the reader — the shaded gaps are your suspense and mystery windows, the reader’s experience made visible.'
  },
  {
    section: 'Custody',
    kinds: ['fiction'],
    region: 'custodySidebar',
    workspace: 'custody',
    title: 'A revision-phase tool',
    body: 'Custody is writable any time but earns its keep on the 2nd/3rd draft — once scenes and world pages exist and analysis has run, declare the reveals and let the ghost marks show where the story disagrees with your plan.'
  },

  // ── Learnings (non-fiction) ──────────────────────────────────────────────────
  {
    section: 'Learnings',
    kinds: ['nonfiction'],
    region: 'coherencePanel',
    workspace: 'coherence',
    title: 'What the conversation reveals',
    body: 'For a transcript, coherence reads as CONSISTENCY — does a speaker hold the same position, do the stated facts line up across the whole record? Paired with the topic and speaker rails, it’s the durable read: what was claimed, by whom, and whether it holds up.'
  },

  // ── More (get help · get ai · get community) ─────────────────────────────────
  {
    section: 'More',
    region: 'titleBar',
    title: 'Get help',
    body: 'F8 opens any pane’s help; Help → Reference & Docs is the manual; and this tour replays any time. File and PNG exports live on the rails and menus.'
  },
  {
    section: 'More',
    region: 'statusBar',
    title: 'Make it yours',
    body: 'The dock handle (bottom center) opens Composition · Settings · Theme. Settings holds optional display toggles — Mood chips, Timing codes, and “Edit source directly” — plus a one-button Storage cleanup that purges cached analysis when the project’s .nvs folder grows large.'
  },
  {
    section: 'More',
    region: 'consoleDock',
    title: 'Get AI',
    body: 'AI features need a connection — an API key, or your Claude plan (Settings → AI). It unlocks Update analysis, the assistant chat, the background Tasks inbox (edits you review before they land), and /agent while writing. You can also drive NVS FROM Claude — see the Store.'
  },
  {
    section: 'More',
    region: 'storeView',
    title: 'Get community',
    body: 'The Store is a place: community works to open and learn from, and extensions that add capabilities. Share your own when it’s ready.'
  }
]

export function TourOverlay(): JSX.Element | null {
  const step = useWorkspace((s) => s.tourStep)
  const setStep = useWorkspace((s) => s.setTourStep)
  const setWorkspace = useWorkspace((s) => s.setWorkspace)
  const project = useWorkspace((s) => s.project)
  const domain = useWorkspace((s) => s.projectInfo?.domain) ?? 'fiction'
  const [rect, setRect] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(0) // measured card height → clamp its top so a tall step near the BOTTOM never pushes Back/Next off-screen
  useModalEscape(step != null, () => setStep(null))
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0
    setCardH((prev) => (prev === h ? prev : h))
  }, [step, rect])

  // KIND-scoped curriculum: fiction walks Sequencing + Custody; non-fiction skips those and gets Learnings.
  // Steps with no `kinds` are shared. `step` indexes into THIS filtered list.
  const steps = TOUR_STEPS.filter((s) => !s.kinds || s.kinds.includes(domain as 'fiction' | 'nonfiction'))
  const spec = step != null ? steps[step] : null

  // Switch workspace when the step needs one, then measure (short retry while the target mounts).
  // A region that never appears → rect stays null → the card renders CENTERED (never auto-advance).
  useEffect(() => {
    if (!spec) return
    setRect(null)
    if (spec.workspace && project) setWorkspace(spec.workspace)
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const measure = (): void => {
      const el = document.querySelector(regionSelector(spec.region))
      if (el) setRect(el.getBoundingClientRect())
      else if (++tries < 8) timer = setTimeout(measure, 120)
    }
    measure()
    const onResize = (): void => measure()
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, spec?.region])

  if (step == null || !spec) return null

  const inSection = steps.filter((s) => s.section === spec.section)
  const sectionIdx = inSection.indexOf(spec) + 1
  const cardBelow = rect ? rect.bottom + 200 < window.innerHeight : false
  const rawTop = rect ? (cardBelow ? rect.bottom + 12 : Math.max(12, rect.top - 210)) : window.innerHeight / 2 - 110
  // Clamp so the WHOLE card (incl. Back/Next) stays on screen — a tall step over a bottom-anchored region (e.g. Get AI
  // on the console dock) otherwise overflowed the viewport. `cardH || 220` = a first-paint estimate before measuring.
  const cardTop = Math.max(12, Math.min(rawTop, window.innerHeight - (cardH || 220) - 12))
  const cardLeft = rect ? Math.min(Math.max(12, rect.left), window.innerWidth - 384) : window.innerWidth / 2 - 180

  return (
    <div className="fixed inset-0 z-70" onClick={() => setStep(null)}>
      {rect ? (
        <div
          className="absolute rounded-lg ring-2 ring-lore transition-all duration-200"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}
      <div
        ref={cardRef}
        className="absolute max-h-[calc(100dvh-1.5rem)] w-90 overflow-y-auto rounded-lg border border-border bg-panel p-4 shadow-2xl"
        style={{ top: cardTop, left: cardLeft }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* section pills — jump straight to a part (the curriculum is browsable, not a corridor) */}
        <div className="flex flex-wrap items-center gap-1 pb-2">
          {[...new Set(steps.map((s) => s.section))].map((sec) => (
            <button
              key={sec}
              onClick={() => setStep(steps.findIndex((s) => s.section === sec))}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                sec === spec.section ? 'border-lore bg-lore/10 text-foreground' : 'border-border text-muted-foreground hover:bg-panel-soft'
              )}
            >
              {sec}
            </button>
          ))}
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-lore">
          {spec.section} · {sectionIdx}/{inSection.length}
        </p>
        <p className="pt-0.5 text-[13px] font-medium text-foreground">{spec.title}</p>
        <p className="pt-1 text-[12px] leading-relaxed text-muted-foreground">{spec.body}</p>
        {!rect && <p className="pt-1 text-[10px] text-faint">(this surface isn’t on screen right now — e.g. it needs an open page or a project)</p>}
        <div className="flex items-center gap-2 pt-3">
          <div className="flex flex-1 items-center gap-1">
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                title={`${s.section} — ${s.title}`}
                className={cn('size-1.5 rounded-full transition-transform hover:scale-150', i === step ? 'bg-lore' : 'bg-border')}
              />
            ))}
          </div>
          {step > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button size="sm" onClick={() => setStep(step + 1 < steps.length ? step + 1 : null)}>
            {step + 1 < steps.length ? 'Next' : 'Done'}
          </Button>
        </div>
      </div>
    </div>
  )
}
