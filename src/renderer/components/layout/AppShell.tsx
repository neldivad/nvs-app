import { useEffect, useRef, useState, type JSX } from 'react';
import { Minimize2 } from 'lucide-react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'
import { Rail } from './Rail'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { MainContent } from './MainContent'
import { ConsoleDock } from '@/components/features/agent/ConsoleDock'
import { AgentFloat } from './AgentFloat'
import { PromptLibraryPanel } from '@/components/features/agent/PromptLibraryPanel'
import { ThreadDetailFloat, ArcDetailFloat, CoherenceDetailFloat, EntityDetailFloat, LoreDetailFloat } from './DetailFloats'
import { RightRail } from './RightRail'
import { NotificationToast } from './NotificationToast'
import { WorkDetailDialog } from '@/components/dialogs/WorkDetailDialog'
import { ProjectConfigDialog } from '@/components/dialogs/ProjectConfigDialog'
import { SettingsDialog } from '@/components/dialogs/SettingsDialog'
import { FloatDock } from '@/components/layout/FloatDock'
import { ProjectDetailsDialog } from '@/components/dialogs/ProjectDetailsDialog'
import { ShareDialog } from '@/components/dialogs/ShareDialog'
import { HelpDialog } from '@/components/dialogs/HelpDialog'
import { TourOverlay } from '@/components/layout/TourOverlay'
import { UnsavedExitDialog } from '@/components/dialogs/UnsavedExitDialog'
import { JobsDialog } from '@/components/dialogs/JobsDialog'
import { ExtensionLauncher } from '@/components/store/ExtensionLauncher'
import { ExtensionPanels } from '@/components/store/ExtensionPanels'
import { CommandPalette } from './CommandPalette'
import { TitleBar } from './TitleBar'
import { StoreView } from '@/components/store/StoreView'
import { useWorkspace } from '@/stores/workspace'
import { applyUiContributions } from '@/lib/uiContributions'
import { HOTKEYS } from '@/config/hotkeys'
import { dispatchSave, dispatchUndo, dispatchRedo, dispatchTab } from '@/lib/editor/saveTarget'

/**
 * The VS Code-style shell: a fixed activity rail, then resizable regions —
 * sidebar | (main content / bottom dock) — and a status bar. All built from
 * react-resizable-panels, no docking lib (decisions O6).
 */
export function AppShell(): JSX.Element {
  const loadWorks = useWorkspace((s) => s.loadWorks)
  const dockOpen = useWorkspace((s) => s.dockOpen)
  const setDockOpen = useWorkspace((s) => s.setDockOpen)
  const chatOpen = useWorkspace((s) => s.chatOpen)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // off → no assistant float (defensive; chatOpen is also forced false)
  const storeOpen = useWorkspace((s) => s.discoverOpen) // the full-page Store (community + extensions)
  const composing = useWorkspace((s) => s.composing) // composition mode — chrome hidden, just the page
  const setComposing = useWorkspace((s) => s.setComposing)
  const detailsDialogOpen = useWorkspace((s) => s.detailsDialogOpen)
  const setDetailsDialogOpen = useWorkspace((s) => s.setDetailsDialogOpen)
  const shareDialogOpen = useWorkspace((s) => s.shareDialogOpen)
  const setShareDialogOpen = useWorkspace((s) => s.setShareDialogOpen)
  const helpDialogOpen = useWorkspace((s) => s.helpDialogOpen)
  const setHelpDialogOpen = useWorkspace((s) => s.setHelpDialogOpen)
  const [version, setVersion] = useState('')
  const dockRef = useRef<ImperativePanelHandle>(null)

  useEffect(() => {
    void loadWorks()
    void useWorkspace.getState().loadPrompts()
    void applyUiContributions() // apply enabled ui-extension contributions (e.g. the manuscript font)
    void window.nvs.ping().then((r) => setVersion(r.version))
    // Stream agent events into the chat store (survives the dock/chat being unmounted).
    const offAgent = window.nvs.onAgentEvent(useWorkspace.getState().appendChatEvent)
    // Mirror the main-owned tasks inbox into the store (push on every change; fires the done toast).
    const offTasks = window.nvs.onTaskUpdate(useWorkspace.getState().setTasks)
    // Stream the analysis runner's live progress into the store (drives the dock queue + completion toast).
    const offIngest = window.nvs.onIngestProgress(useWorkspace.getState().applyIngestProgress)
    // Re-fetch the project when an out-of-band write (agent createPage/setPhase) changes files on disk.
    const offProject = window.nvs.onProjectChanged((change) => void useWorkspace.getState().refreshProject(change))
    // Main intercepts the window close and asks us first — run the unsaved-changes guard.
    const offBeforeClose = window.nvs.onAppBeforeClose(() => useWorkspace.getState().requestCloseApp())
    void useWorkspace.getState().refreshPro() // load the Pro flag (gates the prettier export theme)
    // If the app was launched to render a specific project (`--open <path>`, the plugin's task-scoped launch),
    // open it now — this wins over the usual home/restore so a headless captureView/export lands on it.
    void window.nvs.bootOpenWork().then((p) => { if (p) void useWorkspace.getState().openWork(p) })
    return () => {
      offAgent()
      offTasks()
      offIngest()
      offProject()
      offBeforeClose()
    }
  }, [loadWorks])

  // Drive the collapsible bottom dock from store state (StatusBar toggle ⇄ panel).
  useEffect(() => {
    const p = dockRef.current
    if (!p) return
    if (dockOpen && p.isCollapsed()) p.expand()
    else if (!dockOpen && p.isExpanded()) p.collapse()
  }, [dockOpen])

  // Dev aid: Ctrl/Cmd+Alt+D toggles the component-boundary overlay (see globals.css).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && (e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
        document.documentElement.classList.toggle('debug-regions')
      }
      // Ctrl/Cmd+Alt+P — the finer PART overlay (labels every [data-part] sub-block).
      if (e.altKey && (e.ctrlKey || e.metaKey) && e.code === 'KeyP') {
        document.documentElement.classList.toggle('debug-parts')
      }
      // Timeline routing hotkeys — GLOBAL (not bound to canvas focus, so they fire no matter what was last
      // clicked): C/X act on the marquee selection, ⇧C/⇧X on the whole variant (both bulk ops open the confirm
      // dialog, since they overwrite/clear connectors). Skipped inside text fields and while a dialog is up.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.code === 'KeyC' || e.code === 'KeyX')) {
        const st = useWorkspace.getState()
        const t = e.target as HTMLElement | null
        // Only on the Canvas tab — that's where the graph, the marquee selection, and the confirm dialogs live.
        if (st.workspace === 'timeline' && st.timelineTab === 'canvas' && !t?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) {
          e.preventDefault()
          if (e.code === 'KeyC') e.shiftKey ? st.setTimelineConfirm('quick') : void st.connectSelectedScenes()
          else e.shiftKey ? st.setTimelineConfirm('reset') : void st.disconnectSelectedScenes()
          return
        }
      }
      // ⌘S — save the active page via the saveTarget stack (any registered editor surface).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && HOTKEYS.save.codes.includes(e.code)) {
        if (dispatchSave()) e.preventDefault()
        return
      }
      // ⌘Z / ⇧⌘Z / ⌘Y — page-level history (custody records, …). Inside a real text editor
      // (TipTap/CodeMirror/inputs) the editable owns its own undo — don't touch it.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (HOTKEYS.undo.codes.includes(e.code) || HOTKEYS.redo.codes.includes(e.code))) {
        const t = e.target as HTMLElement | null
        const inEditable = !!t?.closest?.('input, textarea, [contenteditable="true"], .cm-editor')
        if (!inEditable) {
          const redo = e.shiftKey || HOTKEYS.redo.codes.includes(e.code)
          if (redo ? dispatchRedo() : dispatchUndo()) e.preventDefault()
        }
        return
      }
      // F1–F5 → switch the active page's Nth tab (paged surfaces register a tab target via PageShell). Bare
      // F-keys only (a modifier means something else). Consumes the key only when a paged surface has that tab;
      // otherwise it no-ops (tab-less panels, or F4/F5 on a 3-tab page). Pane help is a separate key (F8), below.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // Yield to a focused sidebar tree — it owns F2 (rename) + its own nav keys, and doesn't stopPropagation,
        // so without this the global tab-switch ALSO fires (double-trigger: rename + view toggle). Editors don't
        // claim F-keys, so F1/F2/… still flip write/preview while you're writing in the prose editor.
        const t = e.target as HTMLElement | null
        const inTree = !!t?.closest?.('[role="tree"]')
        const fi = HOTKEYS.pageTab.codes.indexOf(e.code)
        if (!inTree && fi >= 0 && dispatchTab(fi)) {
          e.preventDefault()
          return
        }
      }
      // Open (toggle) the help for the pane you're in (the rail's Help Fab, reachable by keyboard).
      if (HOTKEYS.paneHelp.codes.includes(e.code)) {
        e.preventDefault()
        const st = useWorkspace.getState()
        st.setPaneHelpOpen(!st.paneHelpOpen)
      }
      // ⌘, — open Project Structure (the setup surface), the settings-key convention. Only with a project open.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && HOTKEYS.projectConfig.codes.includes(e.code)) {
        const st = useWorkspace.getState()
        if (st.project) {
          e.preventDefault()
          st.setStructureDialogOpen(true)
        }
      }
      // ⌘⇧D — toggle composition mode (chrome hidden, just the page). SHIFT keeps it clear of CodeMirror's ⌘D
      // (select-next-occurrence) and !altKey of the Ctrl+Alt+D debug overlay. Only meaningful with a project open.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && HOTKEYS.compose.codes.includes(e.code)) {
        const st = useWorkspace.getState()
        if (st.project) {
          e.preventDefault()
          st.setComposing(!st.composing)
        }
      }
      // Escape leaves composition mode (the universal "get me out"), but only when nothing modal is capturing it.
      if (e.code === 'Escape') {
        const st = useWorkspace.getState()
        if (st.composing) {
          e.preventDefault()
          st.setComposing(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Composition mode — everything but the page falls away. A conditional branch (not CSS-hiding) so the
  // ResizablePanel groups don't leave empty gutters; the editor renders full-bleed, Escape or ⌘D returns.
  if (composing) {
    return (
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-canvas text-foreground">
        <div className="h-full overflow-auto">
          <MainContent />
        </div>
        <button
          onClick={() => setComposing(false)}
          title="Leave composition mode (Esc)"
          className="app-no-drag fixed right-3 top-3 z-50 flex items-center gap-1 rounded-md border border-border bg-panel/70 px-2 py-1 text-[11px] text-muted-foreground opacity-40 backdrop-blur transition-opacity hover:opacity-100"
        >
          <Minimize2 className="size-3.5" /> Esc
        </button>
        {/* Keep the command palette reachable so navigation still works without the sidebar. */}
        <CommandPalette />
        <NotificationToast />
        <UnsavedExitDialog />
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-foreground">
      <TitleBar version={version} />
      {/* The rails are the PERMANENT frame — the Store swaps only the CENTER, so opening it never strands you
          in a railless full-page view. A left-rail click exits the Store (setWorkspace clears discoverOpen). */}
      <div className="flex min-h-0 flex-1">
        <Rail />
        {storeOpen ? (
          <StoreView />
        ) : (
          /* Body splits horizontally: a full-height sidebar, then the editor stacked over its dock
             (the dock spans only the editor column, not the sidebar). */
          <ResizablePanelGroup direction="horizontal" className="flex-1">
            <ResizablePanel defaultSize={22} minSize={12} maxSize={34}>
              <Sidebar />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={78}>
              <ResizablePanelGroup direction="vertical" className="h-full">
                <ResizablePanel>
                  <div className="h-full overflow-auto">
                    <MainContent />
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle className={dockOpen ? undefined : 'opacity-0'} />
                <ResizablePanel
                  ref={dockRef}
                  collapsible
                  collapsedSize={0}
                  defaultSize={0}
                  minSize={18}
                  onCollapse={() => setDockOpen(false)}
                  onExpand={() => setDockOpen(true)}
                >
                  {aiEnabled && <ConsoleDock />}
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
        <RightRail />
      </div>

      {/* Non-modal floating surfaces — draggable/resizable; overlay the editor (never block it).
          The detail floats are app-level + selection-driven so they survive switching rails/views. */}
      {aiEnabled && chatOpen && <AgentFloat />}
      {/* Prompt library — a master-detail dialog (self-gates on promptsOpen). */}
      <PromptLibraryPanel />
      <ThreadDetailFloat />
      <ArcDetailFloat />
      <EntityDetailFloat />
      <CoherenceDetailFloat />
      <LoreDetailFloat />

      <StatusBar />
      <FloatDock />
      <NotificationToast />
      <WorkDetailDialog />
      <ProjectConfigDialog />
      <SettingsDialog />
      <ProjectDetailsDialog open={detailsDialogOpen} onClose={() => setDetailsDialogOpen(false)} />
      <ShareDialog open={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />
      <HelpDialog open={helpDialogOpen} onClose={() => setHelpDialogOpen(false)} />
      <TourOverlay />
      <UnsavedExitDialog />
      <JobsDialog />
      <ExtensionLauncher />
      <ExtensionPanels />
      <CommandPalette />
    </div>
  )
}
