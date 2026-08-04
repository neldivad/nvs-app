import { useState, type JSX } from 'react'
import { FolderInput, Minus, Search, Square, X } from 'lucide-react'
import { regionAttrs } from '@/config/regions'
import { HOTKEYS } from '@/config/hotkeys'
import { useWorkspace } from '@/stores/workspace'
import { Menubar, MenubarMenu, MenubarItem, MenubarSeparator } from '@/components/ui/menubar'
import { ChangelogDialog } from '@/components/layout/ChangelogDialog'
import { SupportDialog } from '@/components/layout/SupportDialog'
import { ProDialog } from '@/components/layout/ProDialog'
import nvsLogo from '@/assets/nvs-logo.svg'

// macOS keeps its native traffic lights (titleBarStyle hiddenInset); win/linux
// get the custom controls on the right.
const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh')

/**
 * The VS Code-style custom title bar. Replaces the native window chrome
 * (frameless on win/linux). Houses the app menu bar (File/Project/View/Help),
 * a centered title, and window controls. The whole strip is a drag region;
 * interactive parts opt out with `.app-no-drag`.
 */
export function TitleBar({ version }: { version: string }): JSX.Element {
  const project = useWorkspace((s) => s.project)
  const projectTitle = useWorkspace((s) => s.projectInfo?.title)
  const requestReturnToLibrary = useWorkspace((s) => s.requestReturnToLibrary)
  const openExternal = useWorkspace((s) => s.openExternal)
  const importProject = useWorkspace((s) => s.importProject)
  const importStructured = useWorkspace((s) => s.importStructured)
  const exportManuscript = useWorkspace((s) => s.exportManuscript)
  const setStructureDialogOpen = useWorkspace((s) => s.setStructureDialogOpen)
  const setDetailsDialogOpen = useWorkspace((s) => s.setDetailsDialogOpen)
  const setShareDialogOpen = useWorkspace((s) => s.setShareDialogOpen)
  const setHelpDialogOpen = useWorkspace((s) => s.setHelpDialogOpen)
  const setDiscoverOpen = useWorkspace((s) => s.setDiscoverOpen)
  const setComposing = useWorkspace((s) => s.setComposing)
  const dockOpen = useWorkspace((s) => s.dockOpen)
  const setDockOpen = useWorkspace((s) => s.setDockOpen)
  const chatOpen = useWorkspace((s) => s.chatOpen)
  const setChatOpen = useWorkspace((s) => s.setChatOpen)
  const aiEnabled = useWorkspace((s) => s.aiEnabled) // off → hide the assistant menu item
  const setSearchOpen = useWorkspace((s) => s.setSearchOpen)
  const saveToLibrary = useWorkspace((s) => s.saveToLibrary)
  const pro = useWorkspace((s) => s.pro)
  const [saving, setSaving] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [proOpen, setProOpen] = useState(false)

  const hasProject = !!project
  // Opened via "Open Folder…" from outside the library root — offer to collect it into My Works
  // (the DAW Collect-and-Save move; external open stays an escape hatch, saving is one click, never forced).
  const outsideLibrary = hasProject && project?.insideLibrary === false
  const title = projectTitle || (hasProject ? project?.name : 'Novel Visual Studio')

  const ctlBtn =
    'app-no-drag flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground'

  return (
    <header
      {...regionAttrs('titleBar')}
      className="app-drag relative flex h-9 shrink-0 select-none items-center border-b border-border bg-panel pl-3"
    >
      {isMac && <div className="w-16" />} {/* clearance for the traffic lights */}

      <img src={nvsLogo} alt="" className="mr-2 size-4" />

      <div className="app-no-drag">
        <Menubar>
          <MenubarMenu id="file" label="File">
            <MenubarItem onSelect={() => void openExternal()}>Open Folder…</MenubarItem>
            <MenubarItem onSelect={() => void importProject()}>Import Project…</MenubarItem>
            <MenubarItem onSelect={() => void importStructured()}>Import Structured JSON…</MenubarItem>
            <MenubarSeparator />
            <MenubarItem disabled={!hasProject} onSelect={() => requestReturnToLibrary()}>
              Return to Library
            </MenubarItem>
          </MenubarMenu>

          {hasProject && (
            <MenubarMenu id="project" label="Project">
              <MenubarItem onSelect={() => setStructureDialogOpen(true)}>Structure…</MenubarItem>
              <MenubarItem onSelect={() => setDetailsDialogOpen(true)}>Info…</MenubarItem>
              <MenubarItem onSelect={() => setShareDialogOpen(true)}>Share…</MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={() => void exportManuscript()}>Export Manuscript</MenubarItem>
              {/* Structured JSON/CSV/MD export is SCENE-scoped (the scene FAB's Download) — a whole-project dump
                  is too large to be a useful interchange unit, so it's deliberately not offered at project level. */}
            </MenubarMenu>
          )}

          <MenubarMenu id="view" label="View">
            <MenubarItem onSelect={() => setDockOpen(!dockOpen)}>Toggle Console</MenubarItem>
            {aiEnabled && <MenubarItem onSelect={() => setChatOpen(!chatOpen)}>Toggle Assistant</MenubarItem>}
            {/* theme lives on the status-bar toggle (not duplicated here); composition is project-only */}
            {hasProject && (
              <>
                <MenubarSeparator />
                <MenubarItem onSelect={() => setComposing(true)} shortcut={HOTKEYS.compose.display}>
                  Composition mode
                </MenubarItem>
              </>
            )}
            <MenubarSeparator />
            <MenubarItem onSelect={() => void window.nvs.toggleDevTools()} shortcut="F12">
              Toggle Developer Tools
            </MenubarItem>
          </MenubarMenu>

          <MenubarMenu id="help" label="Help">
            <MenubarItem onSelect={() => setHelpDialogOpen(true)}>Reference &amp; Docs</MenubarItem>
            {/* the replayable walkthrough — spotlights data-regions step by step (TourOverlay) */}
            <MenubarItem onSelect={() => useWorkspace.getState().setTourStep(0)}>Tour the app</MenubarItem>
            <MenubarSeparator />
            {/* Using NVS from Claude is a setup task people look for under Help, not in a store tab. */}
            <MenubarItem onSelect={() => setDiscoverOpen('claude')}>Use NVS with Claude…</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => setSupportOpen(true)}>Support &amp; community</MenubarItem>
            <MenubarSeparator />
            {/* Pro + version live here (VS Code-style) instead of taking permanent header space */}
            <MenubarItem onSelect={() => setProOpen(true)}>{pro ? 'NVS Pro — active' : 'NVS Pro'}</MenubarItem>
            <MenubarItem onSelect={() => setChangelogOpen(true)} shortcut={`v${version || '—'}`}>
              What&apos;s new
            </MenubarItem>
          </MenubarMenu>
        </Menubar>
      </div>

      {/* centered: a global search field when a project is open (VS Code-style), else the title */}
      {hasProject ? (
        <button
          onClick={() => setSearchOpen(true)}
          title={`Search scenes, world, threads… (${HOTKEYS.search.display})`}
          className="app-no-drag absolute left-1/2 flex h-6 w-72 max-w-[42vw] -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-canvas/60 px-2 text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 truncate text-left text-[11px] text-faint">Search…</span>
          <kbd className="shrink-0 rounded border border-border px-1 text-[9px] text-faint">{HOTKEYS.search.display}</kbd>
        </button>
      ) : (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[12px] text-muted-foreground">
          {title}
        </div>
      )}

      {/* right cluster: outside-library cue · version chip (→ changelog) · window controls */}
      <div className="ml-auto flex items-center">
        {/* outside-library cue: this work isn't in My Works — offer to save a copy in */}
        {outsideLibrary && (
          <button
            disabled={saving}
            onClick={() => {
              setSaving(true)
              void saveToLibrary().finally(() => setSaving(false))
            }}
            title={`Opened from outside your library (${project?.root}). Save a copy to My Works so it shows on the Welcome page.`}
            className="app-no-drag mr-2 flex h-6 items-center gap-1.5 rounded-md border border-amber-600/40 bg-amber-500/10 px-2 text-[11px] text-amber-600 transition-colors hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
          >
            <FolderInput className="size-3.5" />
            {saving ? 'Saving…' : 'Save to Library'}
          </button>
        )}

        {/* Pro + version moved into the Help menu (VS Code-style) — the header stays uncluttered. */}

        {/* window controls (win/linux; macOS uses native traffic lights) */}
        {!isMac && (
          <div className="flex items-stretch">
            <button className={ctlBtn} title="Minimize" onClick={() => void window.nvs.minimizeWindow()}>
              <Minus className="size-4" />
            </button>
            <button className={ctlBtn} title="Maximize" onClick={() => void window.nvs.toggleMaximizeWindow()}>
              <Square className="size-3.5" />
            </button>
            <button
              className="app-no-drag flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-flag hover:text-white"
              title="Close"
              onClick={() => void window.nvs.closeWindow()}
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>

      <ChangelogDialog open={changelogOpen} onClose={() => setChangelogOpen(false)} version={version} />
      <SupportDialog open={supportOpen} onClose={() => setSupportOpen(false)} />
      <ProDialog open={proOpen} onClose={() => setProOpen(false)} />
    </header>
  )
}
