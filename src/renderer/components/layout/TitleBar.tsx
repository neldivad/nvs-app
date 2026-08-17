import { useState, type JSX } from 'react'
import { FolderInput, Minus, Search, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('header')
  const [saving, setSaving] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [proOpen, setProOpen] = useState(false)

  const hasProject = !!project
  // Opened via "Open Folder…" from outside the library root — offer to collect it into My Works
  // (the DAW Collect-and-Save move; external open stays an escape hatch, saving is one click, never forced).
  const outsideLibrary = hasProject && project?.insideLibrary === false
  const title = projectTitle || (hasProject ? project?.name : t('appName'))

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
          <MenubarMenu id="file" label={t('menu.file')}>
            <MenubarItem onSelect={() => void openExternal()}>{t('item.openFolder')}</MenubarItem>
            <MenubarItem onSelect={() => void importProject()}>{t('item.importProject')}</MenubarItem>
            <MenubarItem onSelect={() => void importStructured()}>{t('item.importStructured')}</MenubarItem>
            <MenubarSeparator />
            <MenubarItem disabled={!hasProject} onSelect={() => requestReturnToLibrary()}>
              {t('item.returnToLibrary')}
            </MenubarItem>
          </MenubarMenu>

          {hasProject && (
            <MenubarMenu id="project" label={t('menu.project')}>
              <MenubarItem onSelect={() => setStructureDialogOpen(true)}>{t('item.structure')}</MenubarItem>
              <MenubarItem onSelect={() => setDetailsDialogOpen(true)}>{t('item.info')}</MenubarItem>
              <MenubarItem onSelect={() => setShareDialogOpen(true)}>{t('item.share')}</MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={() => void exportManuscript()}>{t('item.exportManuscript')}</MenubarItem>
              {/* Structured JSON/CSV/MD export is SCENE-scoped (the scene FAB's Download) — a whole-project dump
                  is too large to be a useful interchange unit, so it's deliberately not offered at project level. */}
            </MenubarMenu>
          )}

          <MenubarMenu id="view" label={t('menu.view')}>
            <MenubarItem onSelect={() => setDockOpen(!dockOpen)}>{t('item.toggleConsole')}</MenubarItem>
            {aiEnabled && <MenubarItem onSelect={() => setChatOpen(!chatOpen)}>{t('item.toggleAssistant')}</MenubarItem>}
            {/* theme lives on the status-bar toggle (not duplicated here); composition is project-only */}
            {hasProject && (
              <>
                <MenubarSeparator />
                <MenubarItem onSelect={() => setComposing(true)} shortcut={HOTKEYS.compose.display}>
                  {t('item.compositionMode')}
                </MenubarItem>
              </>
            )}
            <MenubarSeparator />
            <MenubarItem onSelect={() => void window.nvs.toggleDevTools()} shortcut="F12">
              {t('item.toggleDevTools')}
            </MenubarItem>
          </MenubarMenu>

          <MenubarMenu id="help" label={t('menu.help')}>
            <MenubarItem onSelect={() => setHelpDialogOpen(true)}>{t('item.referenceDocs')}</MenubarItem>
            {/* the replayable walkthrough — spotlights data-regions step by step (TourOverlay) */}
            <MenubarItem onSelect={() => useWorkspace.getState().setTourStep(0)}>{t('item.tour')}</MenubarItem>
            <MenubarSeparator />
            {/* Using NVS from Claude is a setup task people look for under Help, not in a store tab. */}
            <MenubarItem onSelect={() => setDiscoverOpen('claude')}>{t('item.useWithClaude')}</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => setSupportOpen(true)}>{t('item.supportCommunity')}</MenubarItem>
            <MenubarSeparator />
            {/* Pro + version live here (VS Code-style) instead of taking permanent header space */}
            <MenubarItem onSelect={() => setProOpen(true)}>{pro ? t('item.proActive') : t('item.pro')}</MenubarItem>
            <MenubarItem onSelect={() => setChangelogOpen(true)} shortcut={`v${version || '—'}`}>
              {t('item.whatsNew')}
            </MenubarItem>
          </MenubarMenu>
        </Menubar>
      </div>

      {/* centered: a global search field when a project is open (VS Code-style), else the title */}
      {hasProject ? (
        <button
          onClick={() => setSearchOpen(true)}
          title={t('search.tooltip', { shortcut: HOTKEYS.search.display })}
          className="app-no-drag absolute left-1/2 flex h-6 w-72 max-w-[42vw] -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-canvas/60 px-2 text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 truncate text-left text-[11px] text-faint">{t('search.placeholder')}</span>
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
            title={t('saveToLibrary.tooltip', { root: project?.root })}
            className="app-no-drag mr-2 flex h-6 items-center gap-1.5 rounded-md border border-amber-600/40 bg-amber-500/10 px-2 text-[11px] text-amber-600 transition-colors hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
          >
            <FolderInput className="size-3.5" />
            {saving ? t('saveToLibrary.saving') : t('saveToLibrary.label')}
          </button>
        )}

        {/* Pro + version moved into the Help menu (VS Code-style) — the header stays uncluttered. */}

        {/* window controls (win/linux; macOS uses native traffic lights) */}
        {!isMac && (
          <div className="flex items-stretch">
            <button className={ctlBtn} title={t('window.minimize')} onClick={() => void window.nvs.minimizeWindow()}>
              <Minus className="size-4" />
            </button>
            <button className={ctlBtn} title={t('window.maximize')} onClick={() => void window.nvs.toggleMaximizeWindow()}>
              <Square className="size-3.5" />
            </button>
            <button
              className="app-no-drag flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-flag hover:text-white"
              title={t('window.close')}
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
