import { JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { regionAttrs } from '@/config/regions'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { highlightSelectionMatches } from '@codemirror/search'
import { useCmFind } from '@/lib/editor/useCmFind'
import { cmFindExtension } from '@/lib/editor/cmFind'
import { FindBar } from './FindBar'
import { SearchMinimap, LintMinimap } from './SearchMinimap'
import { Save, SlidersHorizontal, AlertTriangle, Info, ListTree, PanelRight, Printer } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { cmTheme as theme, cmMdHighlight as mdHighlight } from '@/components/page/cmTheme'
import { PageShell } from '@/components/page/PageShell'
import { PAGE_TABS, pageKindGroup } from '@/components/page/registry'
import { SourceTab } from '@/components/page/SourceTab'
import { Button } from '@/components/ui/button'
import { PropertyDialog } from './PropertyDialog'
import { PreviewPane } from './PreviewPane'
import { BlockEditor } from './BlockEditor'
import { Outline } from './Outline'
import { SceneInspector } from './SceneInspector'
import { useSceneContext } from '@/lib/editor/sceneContext'
import { PrintPreviewDialog } from './PrintPreviewDialog'
import { parseHeadings } from '@/lib/analysis/outline'
import { EditorFab } from './EditorFab'
import { lintFountain as lintScene } from '@/lib/fountain/lintFountain'
import { lintWorldLinks, lintAliasCollisions } from '@/lib/fountain/lintWorldLinks'
import { checkSceneFormat } from '@shared/config/formatCheck'
import { entityVisual } from '@/config/entityVisual'
import { sectionSlashItems } from '@/lib/fountain/wikiSlash'
import { SlashMenu, type SlashItem } from './SlashMenu'
import { AgentCommandDialog } from './AgentCommandDialog'
import { ConfirmDialog } from '@/components/ui/confirm'
import type { PageEditMode } from '@shared/config/agentCommands'
import type { AgentTask } from '@shared/ipc'
import { cn } from '@/lib/utils'

/** The mounted view's vertical scroll element — preview/write are an `overflow-y-auto` div, source is
 *  CodeMirror's `.cm-scroller` (also a div, overflow-y:auto). Only ONE view mounts at a time, so the first
 *  descendant that genuinely overflows vertically is it. Used to save/restore the approximate scroll spot. */
function findScroller(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('div'))) {
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight - el.clientHeight > 4) return el
  }
  return null
}

export function SceneEditor(): JSX.Element {
  const activePage = useWorkspace((s) => s.activePage)
  const viewMode = useWorkspace((s) => s.viewMode)
  const sceneDirty = useWorkspace((s) => s.sceneDirty)
  const frontmatter = useWorkspace((s) => s.frontmatter)
  const body = useWorkspace((s) => s.body)
  const raw = useWorkspace((s) => s.raw)
  const bufferEpoch = useWorkspace((s) => s.bufferEpoch) // task-row rollback replaced the buffer → remount editors
  const worldPages = useWorkspace((s) => s.worldPages)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // off → drop the /agent slash item (composer is chokepointed too)
  const setViewMode = useWorkspace((s) => s.setViewMode)
  const saveScene = useWorkspace((s) => s.saveScene)
  const editableSource = useWorkspace((s) => s.editableSource)
  const saveSceneRaw = useWorkspace((s) => s.saveSceneRaw)
  const pendingApply = useWorkspace((s) => s.pendingApply)
  const finishApply = useWorkspace((s) => s.finishApply)
  const applyBatch = useWorkspace((s) => s.applyBatch)
  const agentComposerOpen = useWorkspace((s) => s.agentComposerOpen)
  const setAgentComposerOpen = useWorkspace((s) => s.setAgentComposerOpen)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const cmFind = useCmFind(() => viewRef.current) // ⌘F find for the world-page write CM (shared FindBar)
  const [propsOpen, setPropsOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  // Linter "Line N" → click to jump: switch to WRITE and flash the block at that line red. `seq` bumps per click
  // so re-clicking the same issue re-jumps; `path` tags the target page so a stale jump can't fire on a different scene.
  const [lintJump, setLintJump] = useState<{ line: number; seq: number; path: string } | null>(null)
  const jumpPendingRef = useRef(false) // a lint jump sets this → the scroll-memory restore skips it (the jump owns the scroll)
  const jumpToLine = (line: number): void => {
    if (!activePage) return
    jumpPendingRef.current = true
    void setViewMode('write')
    setLintJump((j) => ({ line, seq: (j?.seq ?? 0) + 1, path: activePage.path }))
  }
  // Editable-Source buffer (opt-in): null = untouched (mirrors the mounted `raw`), a string = pending edits. Reset
  // by the remount that follows a save (bufferEpoch bump) or a page switch (key change).
  const [srcBuf, setSrcBuf] = useState<string | null>(null)
  const [srcSaving, setSrcSaving] = useState(false)
  const [staleTask, setStaleTask] = useState<AgentTask | null>(null)
  const [forced, setForced] = useState<string | null>(null) // task id the user confirmed despite staleness
  // The scene editor (TipTap) registers its apply fn here — scene edits land through it (undo + body sync),
  // NOT the read-only Source CM (which never synced back → the "reverts on tab switch" data loss).
  const [sceneApply, setSceneApply] = useState<((text: string, mode: PageEditMode) => void) | null>(null)
  // STABLE identity — a new inline arrow here would change BlockEditor's effect dep every render, looping
  // register → setState → re-render → register… (an infinite loop that exhausted memory and crashed).
  const registerSceneApply = useCallback((fn: ((text: string, mode: PageEditMode) => void) | null) => setSceneApply(() => fn), [])
  // Menus over the world-page CodeMirror (null = closed): `/section` palette + `@mention` linker.
  const [slash, setSlash] = useState<{ query: string; from: number; to: number; top: number; left: number } | null>(null)
  const [mention, setMention] = useState<{ query: string; from: number; to: number; top: number; left: number } | null>(null)

  // Document outline (world pages only) — the Google-Docs-style heading TOC. Toggle persists globally (a UI
  // preference, not per-work). Jumps scroll the ACTIVE pane: preview → the rendered h2/h3; write → CodeMirror.
  const [outlineOpen, setOutlineOpen] = useState(() => localStorage.getItem('nvs.outline') === '1')
  const [activeHeading, setActiveHeading] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const isWorld = !!activePage && activePage.kind !== 'scene'
  const headings = useMemo(() => (isWorld ? parseHeadings(body) : []), [isWorld, body])
  const showOutline = outlineOpen && isWorld && headings.length > 0 && (viewMode === 'write' || viewMode === 'preview')
  // Scene Inspector (scenes only) — the derived-context aside, counterpart to the world-page Outline. Same
  // global-preference persistence; shown in write/preview (source is the raw file, no room for context).
  const [inspectorOpen, setInspectorOpen] = useState(() => localStorage.getItem('nvs.inspector') === '1')
  const showInspector = inspectorOpen && !isWorld && !!activePage && viewMode !== 'source'
  // The scene's debt count (threads + flags) badges the toggle — the at-a-glance signal the FAB popover used to
  // carry, so you see there's something to look at even with the aside collapsed.
  const sceneCtx = useSceneContext()
  const debtCount = sceneCtx.threads.length + sceneCtx.flags.length
  const toggleInspector = (): void =>
    setInspectorOpen((v) => {
      const next = !v
      localStorage.setItem('nvs.inspector', next ? '1' : '0')
      return next
    })
  const toggleOutline = (): void =>
    setOutlineOpen((v) => {
      const next = !v
      localStorage.setItem('nvs.outline', next ? '1' : '0')
      return next
    })
  const jumpToHeading = (i: number): void => {
    setActiveHeading(i)
    const h = headings[i]
    if (!h) return
    if (viewMode === 'preview') {
      const el = contentRef.current?.querySelector('[data-wiki-body]')?.querySelectorAll<HTMLElement>('h2,h3')[i]
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      viewRef.current?.dispatch({ effects: EditorView.scrollIntoView(h.pos, { y: 'start' }) })
      viewRef.current?.focus()
    }
  }
  // Scroll-spy for the PREVIEW pane: highlight the heading whose section is at the top of the viewport.
  useEffect(() => {
    setActiveHeading(0)
    if (!(showOutline && viewMode === 'preview')) return
    const hs = Array.from(contentRef.current?.querySelector('[data-wiki-body]')?.querySelectorAll<HTMLElement>('h2,h3') ?? [])
    if (!hs.length) return
    const recompute = (): void => {
      let idx = 0
      for (let k = 0; k < hs.length; k++) {
        if (hs[k].getBoundingClientRect().top <= 140) idx = k
        else break
      }
      setActiveHeading(idx)
    }
    const obs = new IntersectionObserver(recompute, { threshold: [0, 1] })
    hs.forEach((h) => obs.observe(h))
    recompute()
    return () => obs.disconnect()
  }, [showOutline, viewMode, headings, activePage?.path])

  // ── Scroll memory across view toggles ── Toggling Write/Preview/Source re-mounts the view, which would snap
  // to the top. We remember an APPROXIMATE spot (fraction of scrollable height — the surfaces have different
  // densities, so it can't be line-exact) and restore it, so you keep your place. ONE entry keyed by path →
  // it resets when you open a different scene, exactly the "localized memory" scope asked for.
  const scrollMem = useRef<{ path: string; frac: number } | null>(null)
  const activePathRef = useRef<string | undefined>(undefined)
  activePathRef.current = activePage?.path
  // Capture scrolls from whichever view is mounted (scroll doesn't bubble → capture phase); store the fraction.
  // Depends on activePage?.path (NOT []): contentRef's div only exists while a page is open, so a []-effect that
  // ran before the div mounted (or after a close→reopen re-created it) would never attach the listener → nothing
  // recorded → restore silently no-ops (snaps to top). Re-running on path keys the listener to the live div.
  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    const onScroll = (e: Event): void => {
      const el = e.target as HTMLElement | null
      const path = activePathRef.current
      if (!path || !el || typeof el.scrollTop !== 'number') return
      const max = el.scrollHeight - el.clientHeight
      if (max > 0) scrollMem.current = { path, frac: el.scrollTop / max }
    }
    root.addEventListener('scroll', onScroll, true)
    return () => root.removeEventListener('scroll', onScroll, true)
  }, [activePage?.path])
  // On a view toggle (or buffer reload) restore the fraction — but only within the SAME page (a new scene starts
  // at top). Wait for the freshly-mounted view's height to SETTLE (two frames agree) before restoring: TipTap/CM
  // lay out progressively, so restoring on the first frame lands against a partial body → too high on the page.
  useEffect(() => {
    const path = activePage?.path
    const mem = scrollMem.current
    if (jumpPendingRef.current) { jumpPendingRef.current = false; return } // a linter jump owns this transition's scroll
    if (!path || !mem || mem.path !== path) return
    let raf = 0
    let tries = 0
    let lastH = -1
    const restore = (): void => {
      const el = findScroller(contentRef.current)
      if (el) {
        const h = el.scrollHeight
        const max = h - el.clientHeight
        if (max > 4 && h === lastH) { el.scrollTop = mem.frac * max; return } // height stopped growing → restore
        lastH = h
      }
      if (tries++ < 60) raf = requestAnimationFrame(restore) // ~1s budget for async layout to settle
    }
    raf = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(raf)
  }, [viewMode, activePage?.path, bufferEpoch])

  // World pages as @-mention items — selecting inserts a `[Name](id)` link (id = stable reference).
  const mentionItems = useMemo<SlashItem[]>(
    () =>
      worldPages.map((p) => {
        const v = entityVisual(p.kind)
        const Icon = v.Icon
        return {
          id: p.id,
          label: p.name,
          command: `@${p.id}`,
          insert: `[${p.name}](${p.id})`,
          description: p.kind,
          icon: <Icon className={cn('size-4', v.text)} />
        }
      }),
    [worldPages]
  )

  const issues = useMemo(() => {
    if (activePage?.kind === 'scene') {
      // report FILE-relative line numbers: the body sits below the frontmatter block in the Source view, so
      // shift by the frontmatter height (raw = frontmatter + body) → "Line N" matches the gutter.
      const off = Math.max(0, raw.split('\n').length - body.split('\n').length)
      // Deterministic FORMAT check on top of the Fountain lint — flags mis-format residue a reformat/paste leaves
      // (colon-cue, markdown headings/rules/bullets, [[wiki]]), which the parser calls "valid narration". Skip
      // 'orphan-cue' (lintScene already reports it). Same "Line N" convention → the bar + minimap + jump reuse it.
      const fmt = checkSceneFormat(body)
        .filter((i) => i.kind !== 'orphan-cue')
        .map((i) => ({ level: 'warn' as const, message: `Line ${i.line + off}: ${i.msg}` }))
      return [...lintScene(frontmatter, body, off), ...fmt]
    }
    const out = lintWorldLinks(body, worldPages)
    // On a CHARACTER page, also flag alias collisions with OTHER character pages (the ingest speaker map is
    // last-write-wins, so a shared name silently resolves to one). Aliases read from the LIVE frontmatter buffer,
    // so the warning appears as you type; self excluded by path (id may be unstamped on a fresh page).
    if (activePage?.kind === 'character') {
      const fmAliases = Array.isArray(frontmatter.aliases)
        ? frontmatter.aliases.map(String)
        : typeof frontmatter.aliases === 'string' && frontmatter.aliases.trim()
        ? [String(frontmatter.aliases)]
        : []
      const others = worldPages.filter((p) => p.path !== activePage.path)
      out.push(
        ...lintAliasCollisions(
          { id: String(frontmatter.id ?? ''), name: String(frontmatter.name ?? frontmatter.title ?? activePage.title), aliases: fmAliases },
          others
        )
      )
    }
    return out
  }, [activePage?.kind, activePage?.path, activePage?.title, frontmatter, body, raw, worldPages])

  // Lint overview ruler — one red tick per issue that carries a "Line N", positioned by line / total lines. Shows
  // where a scene's problems cluster; click a tick → jump to it in Write (jumpToLine). Line-less issues (no-title,
  // alias collisions) don't get a tick — there's nowhere to jump.
  const lintMarkers = useMemo(() => {
    const total = Math.max(1, raw.split('\n').length)
    return issues.flatMap((iss) => {
      const m = iss.message.match(/Line (\d+)/)
      if (!m) return []
      const line = Number(m[1])
      return [{ pos: Math.min(1, line / total), line, level: iss.level }]
    })
  }, [issues, raw])

  useEffect(() => {
    // WORLD-WRITE only now — the source view renders through the shared read-only SourceTab
    // (components/page/SourceTab), same surface as custody. One source implementation, app-wide.
    if (!hostRef.current || !activePage) return
    if (viewMode !== 'write' || activePage.kind === 'scene') return
    const isWorldWrite = true
    const st = useWorkspace.getState()

    // Recompute the caret menus: `@word` (mention-link, anywhere) takes priority over
    // `/word` (section palette, line start). Only one is open at a time.
    const updateMenus = (view: EditorView): void => {
      const sel = view.state.selection.main
      if (!sel.empty) {
        setSlash(null)
        setMention(null)
        return
      }
      const line = view.state.doc.lineAt(sel.head)
      const before = view.state.sliceDoc(line.from, sel.head)
      const coords = view.coordsAtPos(sel.head)
      const mm = /(?:^|\s)@([\w-]*)$/.exec(before)
      if (mm && coords) {
        setSlash(null)
        setMention({ query: mm[1], from: sel.head - mm[1].length - 1, to: sel.head, top: coords.bottom + 4, left: coords.left })
        return
      }
      setMention(null)
      const sm = /^\/(\w*)$/.exec(before)
      if (sm && coords) setSlash({ query: sm[1], from: line.from, to: sel.head, top: coords.bottom + 4, left: coords.left })
      else setSlash(null)
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: st.body || '',
        extensions: [
          markdown(),
          syntaxHighlighting(mdHighlight),
          EditorView.lineWrapping,
          theme,
          history(),
          // In-editor find for world-page write — our self-contained highlighter (cmFind) driven by the shared
          // FindBar; NOT @codemirror/search's search(), which auto-opens CM's native panel (a second bar).
          cmFindExtension,
          highlightSelectionMatches(),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                void useWorkspace.getState().saveScene()
                return true
              }
            },
            ...historyKeymap,
            ...defaultKeymap
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) useWorkspace.getState().setBody(u.state.doc.toString())
            if (isWorldWrite && (u.docChanged || u.selectionSet)) updateMenus(u.view)
          })
        ]
      })
    })
    viewRef.current = view
    view.focus()
    return () => {
      viewRef.current = null
      setSlash(null)
      view.destroy()
    }
  }, [activePage?.path, viewMode, bufferEpoch])

  // Insert a slash-command's template, replacing the typed `/query`.
  function commitSlash(item: SlashItem): void {
    const view = viewRef.current
    if (!view || !slash) return
    if (item.id === 'agent') {
      // The agent command isn't a static insert — drop the typed "/ag…" and open the composer inline at the caret.
      const anchor = { top: slash.top, left: slash.left }
      view.dispatch({ changes: { from: slash.from, to: slash.to, insert: '' } })
      setSlash(null)
      setAgentComposerOpen(true, anchor)
      return
    }
    view.dispatch({
      changes: { from: slash.from, to: slash.to, insert: item.insert },
      selection: { anchor: slash.from + item.insert.length }
    })
    setSlash(null)
    view.focus()
  }

  // Apply an edit to a WORLD page as a SINGLE CodeMirror transaction (one Ctrl-Z reverts it). The CM
  // Write view has an updateListener that syncs → store body, so it persists. (Scenes go through TipTap.)
  function applyToCm(text: string, mode: PageEditMode): void {
    const view = viewRef.current
    if (!view) return
    const len = view.state.doc.length
    if (mode === 'replace') view.dispatch({ changes: { from: 0, to: len, insert: text } })
    else view.dispatch({ changes: { from: len, insert: (len ? '\n\n' : '') + text } })
    view.focus()
  }

  // Land a resolved edit through the EDITABLE surface (Write mode), so it syncs to the store body and
  // survives tab/view switches. Returns false when the surface isn't ready yet (the effect re-runs).
  function applyResolved(pa: AgentTask): boolean {
    if (viewMode !== 'write') {
      void setViewMode('write')
      return false
    }
    const isScene = activePage?.kind === 'scene'
    if (isScene && !sceneApply) return false // TipTap not mounted yet
    if (!isScene && !viewRef.current) return false
    // Snapshot the pre-apply body into the page's write history — the tasks inbox's Undo/Redo reads it
    // (same contract as custody's direct-write applies), surviving buffer navigation and Ctrl+Z limits.
    const st = useWorkspace.getState()
    // The post-apply body (redo target) computed the way the editors apply it — replace = the AI text; append =
    // it after the current body. Stored NOW so the inbox's Redo restores the AI's text deterministically, even
    // after a plain Ctrl+Z in the editor reverted the buffer (otherwise redo captured that reverted buffer).
    const result = pa.result ?? ''
    const postBody = pa.mode === 'replace' ? result : (st.body.trim() ? st.body + '\n\n' : '') + result
    st.pushPageHistory(pa.pagePath, st.body, `AI apply — ${pa.pageTitle}`, pa.id, postBody)
    if (isScene) sceneApply!(pa.result ?? '', pa.mode)
    else applyToCm(pa.result ?? '', pa.mode)
    st.markTaskApplied(pa.id, true)
    return true
  }

  // Consume a Tasks-inbox edit the user chose to apply (store.applyTask staged it + opened this page).
  useEffect(() => {
    const pa = pendingApply
    if (!pa || !activePage || activePage.path !== pa.pagePath) return
    // Replace overwrites the whole page (destructive) → confirm first (once, unless forced). Append is
    // additive, so it applies straight away. An "Apply all" batch already confirmed once → its head is forced.
    const batchForce = !!applyBatch && applyBatch[0] === pa.id
    if (pa.mode === 'replace' && forced !== pa.id && !batchForce) {
      setStaleTask(pa)
      return
    }
    if (applyResolved(pa)) {
      finishApply()
      setForced(null)
      setStaleTask(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApply, activePage?.path, viewMode, body, sceneApply, forced, applyBatch])

  // Insert a `[Name](id)` link, replacing the typed `@query`.
  function commitMention(item: SlashItem): void {
    const view = viewRef.current
    if (!view || !mention) return
    view.dispatch({
      changes: { from: mention.from, to: mention.to, insert: item.insert },
      selection: { anchor: mention.from + item.insert.length }
    })
    setMention(null)
    view.focus()
  }

  return (
    // `min-h-0 flex-1` (NOT h-full) — this pane is a flex SIBLING of MainContent's TabBar, so h-full asked for the
    // full height *on top of* the tab strip and, with no min-h-0, couldn't shrink below its content: the pane
    // overflowed by the strip's height (a second Y scrollbar) and pushed the Fab's bottom anchor off-screen.
    // Matches CustodyPanel, the other TabBar sibling.
    <div {...regionAttrs('sceneEditor')} className="relative flex min-h-0 flex-1 flex-col bg-canvas">
      {/* TabBar renders in MainContent now — one strip owner for editor/world/custody alike */}
      {activePage == null && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Pick a page from the sidebar to start writing.
          </p>
        </div>
      )}
      {activePage != null && (
        <PageShell
          title={String(frontmatter.title ?? frontmatter.name ?? activePage.title)}
          kind={activePage.kind}
          badges={sceneDirty ? <span className="size-1.5 shrink-0 rounded-full bg-thread" title="unsaved" /> : undefined}
          tabs={PAGE_TABS[pageKindGroup(activePage.kind)]}
          tab={viewMode}
          onTab={(m: string) => void setViewMode(m as typeof viewMode)}
          actions={
            <>
              {isWorld && viewMode !== 'source' && (
                <button
                  onClick={toggleOutline}
                  title={outlineOpen ? 'Hide outline' : 'Show outline'}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-md transition-colors',
                    outlineOpen ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
                  )}
                >
                  <ListTree className="size-3.5" />
                </button>
              )}
              {!isWorld && viewMode !== 'source' && (
                <button
                  onClick={toggleInspector}
                  title={inspectorOpen ? 'Hide scene inspector' : 'Show scene inspector — summary, cast, threads, flags, reveals'}
                  className={cn(
                    'relative flex size-7 items-center justify-center rounded-md transition-colors',
                    inspectorOpen ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft'
                  )}
                >
                  <PanelRight className="size-3.5" />
                  {!inspectorOpen && debtCount > 0 && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-thread px-1 text-[8px] font-medium leading-tight text-thread-foreground">{debtCount}</span>
                  )}
                </button>
              )}
              {/* Compact header actions — smaller than Button `sm` so they read as secondary chrome, not primary CTAs. */}
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => setPropsOpen(true)}>
                <SlidersHorizontal className="size-3" />
                Properties
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-1.5 text-[11px]"
                title="Print / Save as PDF (paper preview)"
                onClick={() => setPrintOpen(true)}
              >
                <Printer className="size-3" />
                Print
              </Button>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" disabled={!sceneDirty} onClick={() => void saveScene()}>
                <Save className="size-3" />
                Save
              </Button>
            </>
          }
        >
          {issues.length > 0 && (
            <div className="flex max-h-[20vh] shrink-0 flex-wrap content-start items-center gap-x-4 gap-y-1 overflow-y-auto border-b border-border bg-panel/60 px-4 py-1.5">
              {issues.map((iss, i) => {
                const line = iss.message.match(/Line (\d+)/)?.[1] // a "Line N:" issue → click to jump to it in Source
                const icon = iss.level === 'warn' ? <AlertTriangle className="size-3 shrink-0" /> : <Info className="size-3 shrink-0" />
                const cls = cn('flex items-center gap-1 text-left text-[11px]', iss.level === 'warn' ? 'text-flag' : 'text-muted-foreground')
                return line ? (
                  <button key={i} onClick={() => jumpToLine(Number(line))} title={`Go to line ${line} in Source`} className={cn(cls, 'cursor-pointer hover:underline')}>
                    {icon}{iss.message}
                  </button>
                ) : (
                  <span key={i} className={cls}>{icon}{iss.message}</span>
                )
              })}
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            <div ref={contentRef} className="relative flex min-h-0 flex-1 flex-col">
              {viewMode === 'preview' ? (
                <PreviewPane />
              ) : viewMode === 'source' ? (
                // the ONE source surface app-wide — read-only by default (see custody's rule); the opt-in
                // "Edit source directly" setting makes it editable, saving the file verbatim via saveSceneRaw.
                <SourceTab
                  key={`${activePage.path}:${bufferEpoch}`}
                  text={raw}
                  gutter
                  readOnly={!editableSource}
                  onChange={editableSource ? setSrcBuf : undefined}
                  dirty={editableSource && srcBuf !== null && srcBuf !== raw}
                  saving={srcSaving}
                  onSave={
                    editableSource
                      ? () => {
                          if (srcBuf === null || srcBuf === raw) return
                          setSrcSaving(true)
                          void saveSceneRaw(srcBuf).finally(() => {
                            setSrcSaving(false)
                            setSrcBuf(null) // the bufferEpoch bump remounts SourceTab from the re-read `raw`
                          })
                        }
                      : undefined
                  }
                />
              ) : activePage.kind === 'scene' ? (
                <div className="relative flex min-h-0 flex-1 flex-col">
                  {/* key by path+epoch → a fresh editor per page (isolated undo) AND per buffer reload (rollback) */}
                  <BlockEditor key={`${activePage.path}:${bufferEpoch}`} registerApply={registerSceneApply} jumpTo={lintJump?.path === activePage.path ? lintJump : undefined} />
                  {body.trim() === '' && (
                    <EmptyPageHint kind="scene" onOpenProperties={() => setPropsOpen(true)} />
                  )}
                </div>
              ) : (
                <div className="relative min-h-0 flex-1" onKeyDown={cmFind.onKeyDown}>
                  {cmFind.open && (
                    <>
                      <FindBar ref={cmFind.inputRef} query={cmFind.query} count={cmFind.count} active={cmFind.active} onQueryChange={cmFind.onQueryChange} onNext={() => cmFind.step(1)} onPrev={() => cmFind.step(-1)} onClose={cmFind.close} placeholder="Find in page" />
                      <SearchMinimap markers={cmFind.markers} onJump={cmFind.goto} />
                    </>
                  )}
                  <div ref={hostRef} className="h-full" />
                  {body.trim() === '' && (
                    <EmptyPageHint
                      kind={activePage.kind}
                      onOpenProperties={() => setPropsOpen(true)}
                    />
                  )}
                </div>
              )}
              {/* Persistent lint ruler — red ticks per issue, over whichever view is up; click → jump in Write. */}
              <LintMinimap markers={lintMarkers} onJump={jumpToLine} />
            </div>
            {showOutline && <Outline headings={headings} active={activeHeading} onJump={jumpToHeading} />}
            {showInspector && <SceneInspector />}
          </div>

          <PropertyDialog open={propsOpen} onClose={() => setPropsOpen(false)} />

          <PrintPreviewDialog open={printOpen} onClose={() => setPrintOpen(false)} />

          <AgentCommandDialog open={agentComposerOpen} onClose={() => setAgentComposerOpen(false)} />

          <ConfirmDialog
            open={!!staleTask}
            title="Replace the whole page?"
            message={
              <>
                This replaces all of <span className="text-foreground">{staleTask?.pageTitle}</span> with the AI&apos;s version (one Ctrl/Cmd+Z undoes it).
                {staleTask && body.trim() !== staleTask.baseText.trim() && <> You&apos;ve also edited the page since this ran — those edits will be lost.</>}
              </>
            }
            confirmLabel="Replace"
            danger
            onConfirm={() => {
              // Re-arm the apply effect, bypassing the stale gate — it lands through the editable surface.
              if (staleTask) setForced(staleTask.id)
              setStaleTask(null)
            }}
            onCancel={() => {
              finishApply() // unstage; the task stays in the inbox for re-review
              setStaleTask(null)
            }}
          />

          {slash && (
            <SlashMenu
              items={sectionSlashItems(activePage.kind, body).filter((i) => aiEnabled || i.command !== '/agent')}
              query={slash.query}
              top={slash.top}
              left={slash.left}
              onSelect={commitSlash}
              onClose={() => setSlash(null)}
            />
          )}

          {mention && (
            <SlashMenu
              items={mentionItems}
              query={mention.query}
              top={mention.top}
              left={mention.left}
              onSelect={commitMention}
              onClose={() => setMention(null)}
            />
          )}

          <EditorFab />
        </PageShell>
      )}
    </div>
  )
}

/** Ghost overlay shown on an empty page — tailored to scenes (Fountain) vs world (Markdown). */
function EmptyPageHint({
  kind,
  onOpenProperties
}: {
  kind: string
  onOpenProperties: () => void
}): JSX.Element {
  const scene = kind === 'scene'
  return (
    <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-24">
      <div className="pointer-events-auto max-w-sm space-y-3 text-center">
        <p className="text-sm text-muted-foreground">
          {scene ? 'This scene is empty.' : `This ${kind} page is empty.`}
        </p>
        {scene ? (
          <ul className="space-y-1 text-[13px] text-faint">
            <li>Just start typing for narration</li>
            <li>
              Type <kbd className="rounded border border-border bg-panel px-1 font-mono text-[11px]">/</kbd> for a
              block — speech, thinking, action, transition
            </li>
            <li>
              <kbd className="rounded border border-border bg-panel px-1 font-mono text-[11px]">@name</kbd> sets a
              speaker
            </li>
            <li>
              Open <span className="text-foreground/80">Properties</span> for the cast & beat (goal · conflict ·
              outcome)
            </li>
          </ul>
        ) : (
          <ul className="space-y-1 text-[13px] text-faint">
            <li>
              Open <span className="text-foreground/80">Properties</span> to set the page's details and phase
            </li>
            <li>
              Write in Markdown — start a section with{' '}
              <kbd className="rounded border border-border bg-panel px-1 font-mono text-[11px]">##</kbd> (or type{' '}
              <kbd className="rounded border border-border bg-panel px-1 font-mono text-[11px]">/</kbd>)
            </li>
            <li>Switch to Preview to see the wiki panel</li>
          </ul>
        )}
        <Button size="sm" variant="ghost" onClick={onOpenProperties}>
          <SlidersHorizontal className="size-3.5" />
          Open Properties
        </Button>
      </div>
    </div>
  )
}
