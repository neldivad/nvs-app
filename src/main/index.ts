import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename, extname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
// App/window icon — resolved by electron-vite for dev AND packaged (resources/icon.png
// alone only covers the packaged build). Shows the NVS mark in the taskbar/dock in dev.
import appIcon from '../../resources/icon.png?asset'

// Must be called before app.ready — registers the custom asset-serving scheme.
protocol.registerSchemesAsPrivileged([
  { scheme: 'nvs-asset', privileges: { bypassCSP: true, stream: true } },
  // nvs-ext:// serves an extension's OWN sandboxed UI (panel.html + its assets). standard+secure = a real,
  // per-extension origin (so the panel document carries its OWN CSP); NOT bypassCSP — the extension's UI stays
  // constrained. Loaded only inside a sandboxed iframe (see ExtensionPanels).
  { scheme: 'nvs-ext', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])
import { CHANNELS } from '@shared/ipc'
import type { TierKind, TierWrite, UiState } from '@shared/ipc'
import * as engine from '@engine/index'
import * as registry from './registry'
import * as extHost from './extensionHost'
import * as library from '@engine/io/library'
import { startMcp, stopMcp, mcpStatus, mcpHeadlessInfo } from './mcp/server'
import { closeSandbox, killSandboxNow, sweepOrphanSandboxes } from './mcp/sandboxSession'
import { buildClaudePlugin } from './mcp/plugin'
import { captureAsset } from './mcp/captureSession' // e2e test hook (gated on NVS_E2E)
import { getState as aiState, saveConnection, removeConnection, setActiveConnection, setAnalysisConnection } from './ai/registry'
import { runAgent } from './ai/agent'
import { runPageAgent } from './ai/pageAgent'
import { enqueueTask, listTasks, cancelTask, dismissTask, clearDoneTasks, loadTasks } from './ai/taskQueue'
import { attachRendererWatchdog } from './guard/rendererWatchdog'
import { startIngestRun, startCoherenceRun, cancelIngestRun, listIngestSessions, revertIngestSession, getIngestProgress } from './ai/ingestRunner'
import { readTelemetry } from './ai/ingestTelemetry'
import { storageUsage, clearStorage, compactSnapshots } from './storage'
import { getEntitlement, verifyPro, setProDev, refreshEntitlement } from './entitlement'
import type { JobRow } from '@shared/ipc'
import { listPrompts, savePrompt, deletePrompt } from './prompts'
import type { ChatContext, ChatMessage, ChatSession, PageAgentInput, SaveConnectionInput, TaskInput, SavedPrompt } from '@shared/ipc'

const isDev = !app.isPackaged

// In-flight agent run, so the renderer's Stop can abort it.
let agentAbort: AbortController | null = null
let pageAgentAbort: AbortController | null = null

// Windows the renderer has OK'd to close (past the unsaved-changes guard).
const allowClose = new WeakSet<BrowserWindow>()

// NVS_OPEN_PROJECT — the plugin's TASK-SCOPED launch (open-on-demand for captureView/export) opens the app
// DIRECTLY onto this project, so the capture lands on the right novel instead of the restored last project. The
// renderer PULLS it on mount (bootOpenWork) and it's consumed once. A normal launch omits it → the usual
// home/restore UX is untouched. An ENV VAR (not an argv flag) because Electron reorders/intercepts `--switches`
// before the app script, so a flag can't be read reliably; env passes through cleanly (same channel the plugin
// already uses for ELECTRON_RUN_AS_NODE).
let bootOpenPath: string | undefined = process.env.NVS_OPEN_PROJECT || undefined

// RENDER SANDBOX (internal/render-sandbox.md) — an ISOLATED, hidden, one-shot instance for headless NATIVE
// rendering/export. It gets its OWN throwaway userData and starts NO MCP server, so it can never collide with
// the user's live app (Chromium SingletonLock · the fixed MCP port 4319 · the single mcp-live handshake) or
// disturb their session. `app.setPath('userData', …)` MUST run before the app is ready — hence here, module-top.
const RENDER_SANDBOX = process.env.NVS_RENDER_SANDBOX === '1'
if (RENDER_SANDBOX) app.setPath('userData', join(app.getPath('temp'), `nvs-render-${process.pid}`))

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    icon: appIcon, // taskbar/window icon (Linux/Windows; macOS uses the bundle .icns)
    backgroundColor: '#1b1714', // DESIGN.md focus canvas; avoids white flash
    // macOS keeps inset traffic lights; win/linux go frameless for the custom title bar.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : { frame: false }),
    autoHideMenuBar: true, // hide the menu bar; accelerators still fire, Alt reveals it
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // renderer can't see Node — the wall
      nodeIntegration: false,
      sandbox: false // preload needs require() for the bridge; renderer stays isolated
    }
  })

  if (!RENDER_SANDBOX) win.once('ready-to-show', () => win.show()) // sandbox stays offscreen — it renders + exports, never shown

  // Core safety net: recover a runaway renderer (infinite loop / memory balloon) instead of letting it thrash the
  // machine. Interactive (Wait/Reload dialog) only for the real window; the sandbox recovers silently.
  attachRendererWatchdog(win, { interactive: !RENDER_SANDBOX })

  // Track renderer responsiveness, so the close guard below never traps the user behind a DEAD/WEDGED renderer.
  let responsive = true
  win.webContents.on('unresponsive', () => (responsive = false))
  win.webContents.on('responsive', () => (responsive = true))

  // Unsaved-changes guard: on the first close, ask the renderer instead of closing. It runs its prompt, then
  // re-triggers the close via confirmClose() (which sets allowClose). BUT a crashed or wedged renderer can't run
  // that prompt — so if the renderer is gone/unresponsive we DON'T preventDefault: the window closes, never
  // becoming un-closeable behind a dead prompt. (A wedged renderer flips `responsive` false via 'unresponsive'.)
  win.on('close', (e) => {
    if (allowClose.has(win)) return
    if (win.webContents.isCrashed() || !responsive) return // dead/wedged → can't prompt; let the window close
    e.preventDefault()
    win.webContents.send(CHANNELS.onAppBeforeClose)
  })

  // F12 toggles DevTools (the View-menu item carries Ctrl+Shift+I / Alt+Cmd+I; a menu item can hold only one
  // accelerator, so F12 is wired here on the window directly).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      e.preventDefault()
      toggleDevToolsDetached(win.webContents)
    }
  })

  // Taskbar icon: X11 reads _NET_WM_ICON from the window, but some WMs (Cinnamon) only pick it up when it's set
  // AFTER creation via setIcon. Log the resolved path so a dev can confirm `?asset` actually pointed at a real
  // file in dev (a bad path silently falls back to the default Electron icon).
  console.log('[nvs] appIcon:', appIcon, '· exists:', existsSync(appIcon))
  try {
    win.setIcon(nativeImage.createFromPath(appIcon))
  } catch (err) {
    console.error('[nvs] setIcon failed', err)
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    // DevTools is opened on demand (View menu / F12), detached — not auto on launch.
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/**
 * Open DevTools DETACHED (its own window). Docked DevTools mis-renders on a
 * frameless window — it clips/vanishes on resize and only reappears after a full
 * relayout (fullscreen). Detached sidesteps that entirely.
 */
function toggleDevToolsDetached(wc: Electron.WebContents): void {
  if (wc.isDevToolsOpened()) wc.closeDevTools()
  else wc.openDevTools({ mode: 'detach' })
}

/** Dev only, OPT-IN (NVS_DEVTOOLS=1): load the React DevTools extension. Off by default — current
 *  React DevTools is Manifest V3 and Electron can't register MV3 service workers, so the install
 *  fails with a ManifestError on EVERY launch (console noise for an extension that never runs). */
async function installDevtools(): Promise<void> {
  if (!isDev || process.env.NVS_DEVTOOLS !== '1') return
  try {
    const { default: install, REACT_DEVELOPER_TOOLS } = require('electron-devtools-installer')
    await install(REACT_DEVELOPER_TOOLS)
  } catch (e) {
    console.warn('[devtools] React DevTools install failed:', e)
  }
}

/** Resolve a bundled-resource dir (dev: in repo under resources/; packaged: extraResources). */
function resourceDir(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'resources', name)
}

function sampleProjectDir(): string {
  return resourceDir('sample-project')
}

/**
 * First-run onboarding: clone the bundled sample into the (empty) library so the
 * welcome page isn't blank on a fresh install. We mark it done with a flag file
 * in userData (the app's PRIVATE state) — not in the works folder — so deleting
 * the sample later won't make it reappear.
 */
// A blank starter to write in, plus two pre-analyzed demos so the panels light up on first open (the "preset
// that makes sound"). They ship inside the app forever (extraResources), so a deleted one is always restorable.
function bundledSeeds(): Array<[name: string, from: string]> {
  return [
    ['Getting Started', sampleProjectDir()],
    ['Office Drama (demo)', join(resourceDir('demos'), 'office-drama')],
    ['Hamlet (demo)', join(resourceDir('demos'), 'hamlet')]
  ]
}

function maybeSeedLibrary(): void {
  const marker = join(app.getPath('userData'), '.library-seeded')
  if (existsSync(marker)) return
  for (const [name, from] of bundledSeeds()) {
    if (!library.createWork(name, from)) console.warn('[seed] missing:', from)
  }
  // Record the attempt regardless, so we don't retry every launch.
  writeFileSync(marker, new Date().toISOString())
}

/** Re-add any bundled example the user has deleted. `createWork` skips a folder that already exists, so this is
 *  idempotent — it only restores what's missing, pristine from the bundle. */
function restoreBundledExamples(): { restored: string[] } {
  const restored: string[] = []
  for (const [name, from] of bundledSeeds()) {
    if (library.createWork(name, from)) restored.push(name)
  }
  return { restored }
}

/**
 * Decode + resize + re-encode as JPEG when Electron's nativeImage can read the source. Falls back
 * to copying the raw bytes unchanged (original extension kept) when it can't — libwebp support in
 * nativeImage has historically been inconsistent across platforms/Electron builds, and previously a
 * failed decode meant the file was silently dropped with no feedback to the user. Returns the
 * written filename (not a path), or null if the source is genuinely unreadable.
 */
function importOneImageFile(src: string, destDir: string, baseName: string, maxWidth: number): string | null {
  const img = nativeImage.createFromPath(src)
  if (!img.isEmpty()) {
    const resized = img.getSize().width > maxWidth ? img.resize({ width: maxWidth, quality: 'better' }) : img
    const filename = `${baseName}.jpg`
    writeFileSync(join(destDir, filename), resized.toJPEG(85))
    return filename
  }
  try {
    const filename = `${baseName}${extname(src) || '.png'}`
    writeFileSync(join(destDir, filename), readFileSync(src))
    return filename
  } catch {
    return null
  }
}

/** Shared by pickCover (dialog-picked path) and pickCoverFromPath (drag-and-drop path). */
function importCoverImage(projectRoot: string, src: string): string | null {
  const destDir = join(projectRoot, 'content', 'assets')
  mkdirSync(destDir, { recursive: true })
  const filename = importOneImageFile(src, destDir, 'cover', 600)
  return filename ? `content/assets/${filename}` : null
}

/** Shared by importImages (dialog-picked paths) and importImagePaths (drag-and-drop paths). */
function importImageBatch(projectRoot: string, pageId: string, srcPaths: string[]): string[] {
  const dir = `content/assets/${pageId || 'media'}`
  mkdirSync(join(projectRoot, dir), { recursive: true })
  const out: string[] = []
  for (const src of srcPaths) {
    // Downsize wide gallery images to 1024 px; CSS handles fit.
    const filename = importOneImageFile(src, join(projectRoot, dir), `${Date.now()}-${out.length}`, 1024)
    if (filename) out.push(`${dir}/${filename}`)
  }
  return out
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.ping, () => ({ ok: true as const, version: app.getVersion() }))

  // Custom title-bar window controls (frameless on win/linux).
  const winOf = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(e.sender)
  ipcMain.handle(CHANNELS.minimizeWindow, (e) => void winOf(e)?.minimize())
  ipcMain.handle(CHANNELS.toggleMaximizeWindow, (e) => {
    const w = winOf(e)
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.handle(CHANNELS.closeWindow, (e) => void winOf(e)?.close())
  ipcMain.handle(CHANNELS.toggleDevTools, (e) => toggleDevToolsDetached(e.sender))
  ipcMain.handle(CHANNELS.confirmClose, (e) => {
    const w = winOf(e)
    if (w) {
      allowClose.add(w) // the renderer cleared the unsaved-changes guard — really close now
      w.close()
    }
  })

  ipcMain.handle(CHANNELS.listWorks, () => library.listWorks())

  // Universal job history — every library work's run ledger, so the Jobs dashboard is the same in the library
  // or inside any project. Reads each work's ingest-runs.json without opening it (read-only). Cost/memory stay
  // out (those are local telemetry, never in the shared ledger).
  ipcMain.handle(CHANNELS.listAllJobs, () => {
    const rows: JobRow[] = []
    // LIVE external runs (headless analysis in another process): each runner heartbeats its project's
    // `.nvs/job-live.json`; a FRESH + active beat = a running row. The app's OWN run is excluded (the dialog
    // already renders it from the live progress stream); a stale beat (crashed/killed process) ages out.
    const ownSession = getIngestProgress()?.sessionId
    for (const w of library.listWorks()) {
      try {
        const p = join(w.path, '.nvs', 'job-live.json')
        if (!existsSync(p)) continue
        const live = JSON.parse(readFileSync(p, 'utf8')) as { sessionId: string; projectName?: string; provider?: string; active: boolean; done: number; total: number; currentLabel?: string | null; startedAt: string; updatedAt: string }
        const fresh = live.active && Date.now() - Date.parse(live.updatedAt) < 20_000
        if (!fresh || live.sessionId === ownSession) continue
        rows.push({
          id: `${w.path}::${live.sessionId}`,
          kind: 'analysis',
          projectName: live.projectName || w.title || w.name,
          projectRoot: w.path,
          status: 'running',
          done: live.done,
          total: live.total,
          currentLabel: live.currentLabel ?? null,
          etaMs: null,
          elapsedMs: Date.now() - Date.parse(live.startedAt),
          cost: null,
          memoryMb: null,
          provider: live.provider ?? null,
          result: null,
          at: live.startedAt
        })
      } catch {
        /* corrupt/half-written heartbeat — skip this work's live row */
      }
    }
    for (const w of library.listWorks()) {
      for (const s of engine.sessionsFor(w.path)) {
        rows.push({
          id: `${w.path}::${s.id}`,
          kind: s.kind === 'coherence' ? 'coherence' : 'analysis',
          projectName: w.title || w.name,
          projectRoot: w.path,
          status: s.ok === 0 && s.failed > 0 ? 'failed' : 'done',
          done: s.ok + s.failed + s.skipped,
          total: s.total,
          etaMs: null,
          elapsedMs: Date.parse(s.finishedAt) - Date.parse(s.startedAt),
          cost: null,
          memoryMb: null,
          provider: null,
          result: { ok: s.ok, failed: s.failed, skipped: s.skipped },
          at: s.startedAt // when the run STARTED (matches the live row) — sorts newest-first
        })
      }
    }
    rows.sort((a, b) => Date.parse(b.at ?? '') - Date.parse(a.at ?? ''))
    return rows.slice(0, 100)
  })
  ipcMain.handle(CHANNELS.readTelemetry, (_e, root: string, limit: number) => readTelemetry(typeof root === 'string' ? root : '', typeof limit === 'number' ? limit : 200))
  ipcMain.handle(CHANNELS.storageUsage, () => storageUsage())
  ipcMain.handle(CHANNELS.clearStorage, (_e, root: string, kind: 'logs' | 'history' | 'chat' | 'tasks') => clearStorage(root, kind))
  ipcMain.handle(CHANNELS.compactSnapshots, (_e, root: string) => compactSnapshots(root))
  ipcMain.handle(CHANNELS.getEntitlement, () => getEntitlement())
  ipcMain.handle(CHANNELS.verifyPro, (_e, email: string) => verifyPro(typeof email === 'string' ? email : ''))
  ipcMain.handle(CHANNELS.setProDev, (_e, pro: boolean) => setProDev(!!pro))

  ipcMain.handle(CHANNELS.createWork, (_e, name: string) =>
    library.createWork(name, sampleProjectDir())
  )

  ipcMain.handle(CHANNELS.openExternal, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Open a Novel Visual Studio project',
      properties: ['openDirectory']
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(CHANNELS.openWork, (_e, path: string) => {
    if (typeof path !== 'string' || !engine.isWork(path)) return null
    const info = engine.openWork(path)
    loadTasks(path) // restore this project's durable background-task inbox (done results survive a restart)
    // Opportunistic, non-blocking: gzip any pre-compression legacy revert snapshots so an old project's `.nvs/`
    // shrinks on first open with no user action. Idempotent + instant once nothing raw remains.
    setTimeout(() => {
      try {
        compactSnapshots(path)
      } catch {
        /* best-effort reclaim — never block or fail an open on it */
      }
    }, 0)
    return info
  })
  // The renderer pulls this once on mount: if the app was launched with `--open <path>` (plugin task-scoped
  // launch), hand back that project so the renderer opens it. Consumed once, and validated as a real work.
  ipcMain.handle(CHANNELS.bootOpenWork, () => {
    const p = bootOpenPath
    bootOpenPath = undefined
    return p && engine.isWork(p) ? p : null
  })

  ipcMain.handle(CHANNELS.currentProject, () => engine.currentProject())
  ipcMain.handle(CHANNELS.listRecents, () => engine.recentsRegistry.listRecents())
  ipcMain.handle(CHANNELS.listDownloads, () => engine.downloadsRegistry.listDownloads())
  ipcMain.handle(CHANNELS.saveToLibrary, () => engine.saveCurrentToLibrary())
  ipcMain.handle(CHANNELS.fetchRegistry, () => registry.fetchRegistry())
  ipcMain.handle(CHANNELS.installCommunityWork, (_e, work) => registry.installCommunityWork(work))
  ipcMain.handle(CHANNELS.sceneAnalysis, (_e, unitId: string) => engine.sceneAnalysis(unitId))
  ipcMain.handle(CHANNELS.searchContent, (_e, query: string, limit?: number) => engine.searchContent(query, limit))
  ipcMain.handle(CHANNELS.listSecretEvents, () => engine.listSecretEvents())
  ipcMain.handle(CHANNELS.listCustodyEvents, () => engine.listCustodyEvents())
  ipcMain.handle(CHANNELS.listArcEvents, () => engine.listArcEvents())
  ipcMain.handle(CHANNELS.listDeclaredSecrets, () => engine.collectDeclaredSecrets())
  ipcMain.handle(CHANNELS.listCustodyTopics, () => engine.listCustodyTopics())
  ipcMain.handle(CHANNELS.parseCustodyBlock, (_e, markdown: string) => engine.parseCustodyBlock(markdown))
  ipcMain.handle(CHANNELS.createCustodyTopic, (_e, meta, records) => engine.createCustodyTopic(meta, records))
  ipcMain.handle(CHANNELS.updateCustodyRecords, (_e, pageId, records) => engine.updateCustodyRecords(pageId, records))
  ipcMain.handle(CHANNELS.listExtensions, () => extHost.listExtensions())
  ipcMain.handle(CHANNELS.installExtension, (_e, id: string) => extHost.installExtension(id))
  ipcMain.handle(CHANNELS.uninstallExtension, (_e, id: string) => extHost.uninstallExtension(id))
  ipcMain.handle(CHANNELS.setExtensionEnabled, (_e, id: string, enabled: boolean) => extHost.setExtensionEnabled(id, enabled))
  ipcMain.handle(CHANNELS.startExtension, (_e, id: string, params?: Record<string, unknown>) => extHost.startExtension(id, params))
  ipcMain.handle(CHANNELS.stopExtension, (_e, id: string) => extHost.stopExtension(id))
  ipcMain.handle(CHANNELS.extensionStatus, (_e, id: string) => extHost.extensionStatus(id))
  ipcMain.handle(CHANNELS.listThreads, () => engine.listThreads())
  ipcMain.handle(CHANNELS.listCoherenceFindings, () => engine.listCoherenceFindings())
  ipcMain.handle(CHANNELS.threadDetail, (_e, threadId: string) => engine.threadDetail(threadId))
  ipcMain.handle(CHANNELS.listCharacterArcs, () => engine.listCharacterArcs())
  ipcMain.handle(CHANNELS.inspectTables, () => engine.inspectTables())
  ipcMain.handle(CHANNELS.inspectRows, (_e, table: string, limit: number, offset: number) => engine.inspectRows(table, limit, offset))
  ipcMain.handle(CHANNELS.listEntityTracks, () => engine.listEntityTracks())
  ipcMain.handle(CHANNELS.listEntityArcs, () => engine.listEntityArcs())
  ipcMain.handle(CHANNELS.setCoherenceRuling, (_e, entityId: string, trait: string, intentional: boolean) =>
    engine.setCoherenceRuling(String(entityId), String(trait), !!intentional)
  )
  ipcMain.handle(CHANNELS.readUiState, () => engine.readUiState())
  ipcMain.handle(CHANNELS.writeUiState, (_e, state: UiState) => engine.writeUiState(state))

  ipcMain.handle(CHANNELS.listScenes, () => engine.listScenes())
  ipcMain.handle(CHANNELS.readScene, (_e, path: string) => engine.readScene(path))
  ipcMain.handle(
    CHANNELS.writeScene,
    (_e, path: string, frontmatter: Record<string, unknown>, body: string) =>
      engine.writeScene(path, frontmatter, body)
  )
  ipcMain.handle(CHANNELS.writeSceneRaw, (_e, path: string, text: string) => engine.writeSceneRaw(path, text))
  ipcMain.handle(
    CHANNELS.stringifyScene,
    (_e, frontmatter: Record<string, unknown>, body: string) =>
      engine.stringifyScene(frontmatter, body)
  )
  ipcMain.handle(
    CHANNELS.createScene,
    (_e, chapterSlug: string, id: string, frontmatter: Record<string, unknown>, body: string) =>
      engine.createScene(chapterSlug, id, frontmatter, body)
  )
  ipcMain.handle(CHANNELS.listStoryTree, () => engine.listStoryTree())
  ipcMain.handle(CHANNELS.createFolder, (_e, parentRel: string, name: string, type?: string) =>
    engine.createFolder(parentRel, name, type)
  )
  ipcMain.handle(CHANNELS.setFolderType, (_e, folderRel: string, type: string | null) =>
    engine.setFolderType(folderRel, type)
  )
  ipcMain.handle(CHANNELS.renamePath, (_e, fromRel: string, toRel: string) =>
    engine.renamePath(fromRel, toRel)
  )
  ipcMain.handle(CHANNELS.deletePath, (_e, rel: string) => engine.deletePath(rel))
  ipcMain.handle(CHANNELS.setOrder, (_e, folderRel: string, names: string[]) =>
    engine.setOrder(folderRel, names)
  )
  ipcMain.handle(
    CHANNELS.createSceneInFolder,
    (_e, folderRel: string, id: string, frontmatter: Record<string, unknown>, body: string) =>
      engine.createSceneInFolder(folderRel, id, frontmatter, body)
  )
  ipcMain.handle(CHANNELS.readTimeline, () => engine.readTimeline())
  ipcMain.handle(CHANNELS.timelineGraph, () => engine.timelineGraph())
  ipcMain.handle(
    CHANNELS.writeTimeline,
    (_e, layout: Parameters<typeof engine.writeTimeline>[0]) => engine.writeTimeline(layout)
  )
  ipcMain.handle(CHANNELS.trees, () => engine.trees())
  ipcMain.handle(CHANNELS.saveTrees, (_e, t: Parameters<typeof engine.saveTrees>[0]) => engine.saveTrees(t))
  ipcMain.handle(CHANNELS.corkboard, () => engine.corkboard())
  ipcMain.handle(CHANNELS.saveCorkboard, (_e, f: Parameters<typeof engine.saveCorkboard>[0]) => engine.saveCorkboard(f))
  ipcMain.handle(CHANNELS.deletePage, (_e, path: string) => engine.deletePage(path))
  ipcMain.handle(CHANNELS.listWorldPages, () => engine.listWorldPages())
  ipcMain.handle(CHANNELS.worldBacklinks, (_e, pageId: string) => engine.worldBacklinks(pageId))
  ipcMain.handle(
    CHANNELS.createWorldPage,
    (
      _e,
      kind: Parameters<typeof engine.createWorldPage>[0],
      id: string,
      frontmatter: Record<string, unknown>,
      body: string
    ) => engine.createWorldPage(kind, id, frontmatter, body)
  )

  ipcMain.handle(CHANNELS.importImages, async (event, pageId: string, _kind: string) => {
    const project = engine.currentProject()
    if (!project) return []
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return []
    const res = await dialog.showOpenDialog(win, {
      title: 'Add images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return []
    return importImageBatch(project.root, pageId, res.filePaths)
  })

  ipcMain.handle(
    CHANNELS.importImagePaths,
    async (_event, pageId: string, _kind: string, paths: string[]) => {
      const project = engine.currentProject()
      if (!project) return []
      return importImageBatch(project.root, pageId, paths)
    }
  )

  ipcMain.handle(CHANNELS.ingestWork, () => engine.ingestWork())
  ipcMain.handle(CHANNELS.resetAnalysis, () => engine.resetAnalysis())
  ipcMain.handle(CHANNELS.writeTier, (_e, p: TierWrite) => engine.writeTier(p))
  ipcMain.handle(CHANNELS.mergeThreads, (_e, ids: string[]) => engine.mergeThreads(ids))
  ipcMain.handle(CHANNELS.mergeEntities, (_e, ids: string[]) => engine.mergeEntities(Array.isArray(ids) ? ids.map(String) : []))
  ipcMain.handle(CHANNELS.relationshipEvidence, (_e, aId: string, bId: string) => engine.relationshipEvidence(String(aId), String(bId)))
  ipcMain.handle(CHANNELS.listLoreView, () => engine.listLoreView())

  ipcMain.handle(CHANNELS.exportProject, async (event) => {
    const project = engine.currentProject()
    if (!project) return { ok: false, error: 'no project open' }
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'no window' }
    const res = await dialog.showSaveDialog(win, {
      title: 'Export project',
      defaultPath: `${basename(project.root)}.nvsproj`,
      filters: [{ name: 'NVS Project', extensions: ['nvsproj'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' }
    return engine.exportProject(res.filePath, app.getVersion())
  })

  ipcMain.handle(CHANNELS.exportManuscript, async (event) => {
    const project = engine.currentProject()
    if (!project) return { ok: false, error: 'no project open' }
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'no window' }
    const res = await dialog.showSaveDialog(win, {
      title: 'Export manuscript',
      defaultPath: `${basename(project.root)}.zip`,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' }
    return engine.exportManuscriptZip(res.filePath)
  })

  ipcMain.handle(CHANNELS.exportScene, async (event, scenePath: string) => {
    const project = engine.currentProject()
    if (!project) return { ok: false, error: 'no project open' }
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'no window' }
    const res = await dialog.showSaveDialog(win, {
      title: 'Export scene',
      defaultPath: basename(scenePath), // already a .md filename
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' }
    return engine.exportSceneFile(scenePath, res.filePath)
  })

  ipcMain.handle(CHANNELS.saveImage, async (event, suggestedName: string, dataUrl: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'no window' }
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
    if (!m) return { ok: false, error: 'not a PNG image' }
    const res = await dialog.showSaveDialog(win, {
      title: 'Export image',
      defaultPath: `${suggestedName}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' }
    try {
      writeFileSync(res.filePath, Buffer.from(m[1]!, 'base64'))
      return { ok: true, file: res.filePath, title: basename(res.filePath) }
    } catch (err) {
      return { ok: false, error: `could not write the image: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  ipcMain.handle(CHANNELS.importProject, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'no window' }
    const res = await dialog.showOpenDialog(win, {
      title: 'Import a project bundle',
      properties: ['openFile'],
      filters: [{ name: 'NVS Project', extensions: ['nvsproj'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, error: 'cancelled' }
    return engine.importProject(res.filePaths[0]!)
  })

  ipcMain.handle(CHANNELS.exportStructured, async (event, format: 'json' | 'csv') => {
    const project = engine.currentProject()
    if (!project) return { ok: false, error: 'no project open' }
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'no window' }
    const res = await dialog.showSaveDialog(win, {
      title: `Export as ${format.toUpperCase()}`,
      defaultPath: `${basename(project.root)}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' }
    try {
      writeFileSync(res.filePath, engine.serializeStructured(format), 'utf8')
      return { ok: true, file: res.filePath, title: basename(res.filePath) }
    } catch (err) {
      return { ok: false, error: `could not write ${format}: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  ipcMain.handle(CHANNELS.exportSceneStructured, async (event, scenePath: string, format: 'json' | 'csv' | 'md' | 'srt') => {
    const project = engine.currentProject()
    if (!project) return { ok: false, error: 'no project open' }
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'no window' }
    // Serialize FIRST: a doomed export (e.g. SRT of an untimed scene) then fails with a clear reason and never
    // opens a save dialog for a file that would be empty.
    let content: string
    try {
      content = engine.serializeSceneStructured(scenePath, format)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    const res = await dialog.showSaveDialog(win, {
      title: `Export scene as ${format.toUpperCase()}`,
      defaultPath: `${basename(scenePath, '.md')}.${format}`, // the scene's own name, not the project's
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' }
    try {
      writeFileSync(res.filePath, content, 'utf8')
      return { ok: true, file: res.filePath, title: basename(res.filePath) }
    } catch (err) {
      return { ok: false, error: `could not write ${format}: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  ipcMain.handle(CHANNELS.importStructured, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'no window' }
    const res = await dialog.showOpenDialog(win, {
      title: 'Import structured JSON (from nvs-parser)',
      properties: ['openFile'],
      filters: [{ name: 'Structured JSON', extensions: ['json'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, error: 'cancelled' }
    const file = res.filePaths[0]!
    try {
      return engine.importStructured(readFileSync(file, 'utf8'), basename(file, '.json'))
    } catch (err) {
      return { ok: false, error: `could not read the file: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  ipcMain.handle(CHANNELS.forkWork, (_e, sourcePath: string) => {
    if (engine.currentProject()?.root === sourcePath) return { ok: false, error: 'close the project before forking it' }
    return engine.forkProject(sourcePath)
  })

  ipcMain.handle(CHANNELS.deleteWork, async (_e, path: string) => {
    if (engine.currentProject()?.root === path) return { ok: false, error: 'close the project before deleting it' }
    // Only ever delete a folder that lives directly inside the library root — never an arbitrary path.
    const root = library.libraryRoot()
    if (!root || resolve(path) === resolve(root) || !resolve(path).startsWith(resolve(root) + sep)) {
      return { ok: false, error: 'refusing to delete outside the library' }
    }
    try {
      await shell.trashItem(path) // recoverable — OS trash, not a hard delete
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(CHANNELS.restoreExamples, () => restoreBundledExamples())

  ipcMain.handle(CHANNELS.readProjectInfo, () => engine.readProjectInfo())
  ipcMain.handle(CHANNELS.readProjectInfoAt, (_e, path: string) => engine.readProjectInfoAt(path))
  ipcMain.handle(CHANNELS.readStructure, () => engine.readStructure())
  ipcMain.handle(CHANNELS.writeStructure, (_e, worldKeys: string[], sceneKeys: string[]) => engine.writeStructure(worldKeys, sceneKeys))
  ipcMain.handle(CHANNELS.writeProjectInfo, (_e, patch) => engine.writeProjectInfo(patch))
  ipcMain.handle(CHANNELS.pickCover, async (event) => {
    const project = engine.currentProject()
    if (!project) return null
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a cover image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return importCoverImage(project.root, res.filePaths[0]!)
  })

  ipcMain.handle(CHANNELS.pickCoverFromPath, async (_event, path: string) => {
    const project = engine.currentProject()
    if (!project) return null
    return importCoverImage(project.root, path)
  })

  ipcMain.handle(CHANNELS.renameWork, (_e, path: string, newName: string) => {
    if (engine.currentProject()?.root === path) return null // never rename the OPEN project's folder (live paths)
    return library.renameWorkFolder(path, newName)
  })
  ipcMain.handle(CHANNELS.closeWork, () => engine.closeWork())
  ipcMain.handle(
    CHANNELS.tierInputHash,
    (_e, kind: TierKind, targetId: string, asOf: string | null) =>
      engine.tierInputHash(kind, targetId, asOf)
  )
  ipcMain.handle(CHANNELS.listTierStatus, () => engine.listTierStatus())
  ipcMain.handle(CHANNELS.coherenceStatus, () => engine.coherenceStatus())
  ipcMain.handle(CHANNELS.timelineStatus, () => engine.timelineStatus())
  ipcMain.handle(CHANNELS.runIngestBundle, (_e, name: string) => engine.runIngestBundle(name))
  ipcMain.handle(CHANNELS.listIngestBundles, () => engine.listIngestBundles())
  ipcMain.handle(CHANNELS.startIngestRun, (_e, forceScenes?: string[], depth?: 'skim' | 'full') => startIngestRun(forceScenes, depth === 'skim' ? 'skim' : 'full'))
  ipcMain.handle(CHANNELS.planIngestPreview, (_e, depth?: 'skim' | 'full') => {
    // Dry-run for the pre-run dialog: same planner the run uses, reduced to counts (steps stay main-side).
    const d = depth === 'skim' ? 'skim' : 'full'
    const counts: Record<string, number> = {}
    for (const p of engine.planIngestSteps(undefined, d)) counts[p.step.kind] = (counts[p.step.kind] ?? 0) + 1
    return { depth: d, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }
  })
  ipcMain.handle(CHANNELS.startCoherenceRun, () => startCoherenceRun())
  ipcMain.handle(CHANNELS.cancelIngestRun, () => cancelIngestRun())
  ipcMain.handle(CHANNELS.listIngestSessions, () => listIngestSessions())
  ipcMain.handle(CHANNELS.revertIngestSession, (_e, id: string) => revertIngestSession(id))
  ipcMain.handle(CHANNELS.setViewingVersion, (_e, snapshotId: string | null) => engine.setViewingVersion(snapshotId))
  ipcMain.handle(CHANNELS.mcpStatus, () => mcpStatus())
  ipcMain.handle(CHANNELS.mcpHeadlessInfo, () => mcpHeadlessInfo())
  // One-click Claude Desktop install: generate the plugin .zip (paths baked in), then reveal it so the user can
  // drop it into Plugins → Upload local plugin. Beats telling them to hand-edit claude_desktop_config.json.
  ipcMain.handle(CHANNELS.generateClaudePlugin, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return { ok: false, error: 'no window' }
    const res = await dialog.showSaveDialog(win, {
      title: 'Save the Claude Desktop plugin',
      defaultPath: 'nvs-claude-plugin.zip',
      filters: [{ name: 'Claude plugin (zip)', extensions: ['zip'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' }
    const out = buildClaudePlugin(res.filePath)
    if (out.ok && out.file) shell.showItemInFolder(out.file) // reveal it — next step is dragging it into Claude
    return out
  })
  ipcMain.handle(CHANNELS.aiConnections, () => aiState())
  ipcMain.handle(CHANNELS.saveConnection, (_e, input: SaveConnectionInput) => saveConnection(input))
  ipcMain.handle(CHANNELS.removeConnection, (_e, id: string) => removeConnection(id))
  ipcMain.handle(CHANNELS.setActiveConnection, (_e, id: string | null) => setActiveConnection(id))
  ipcMain.handle(CHANNELS.setAnalysisConnection, (_e, id: string | null) => setAnalysisConnection(id))
  ipcMain.handle(CHANNELS.runAgent, async (e, history: ChatMessage[], context: ChatContext | null) => {
    const ac = new AbortController()
    agentAbort = ac
    try {
      return await runAgent(history, (evt) => e.sender.send(CHANNELS.onAgentEvent, evt), ac.signal, context ?? null)
    } finally {
      if (agentAbort === ac) agentAbort = null
    }
  })
  ipcMain.handle(CHANNELS.cancelAgent, () => agentAbort?.abort())
  ipcMain.handle(CHANNELS.runPageAgent, async (_e, input: PageAgentInput) => {
    const ac = new AbortController()
    pageAgentAbort = ac
    const timer = setTimeout(() => ac.abort(), 120_000) // safety net — never hang forever
    try {
      return await runPageAgent(input, ac.signal)
    } finally {
      clearTimeout(timer)
      if (pageAgentAbort === ac) pageAgentAbort = null
    }
  })
  ipcMain.handle(CHANNELS.cancelPageAgent, () => pageAgentAbort?.abort())
  ipcMain.handle(CHANNELS.enqueueTask, (_e, input: TaskInput) => enqueueTask(input))
  ipcMain.handle(CHANNELS.listTasks, () => listTasks())
  ipcMain.handle(CHANNELS.cancelTask, (_e, id: string) => cancelTask(id))
  ipcMain.handle(CHANNELS.dismissTask, (_e, id: string) => dismissTask(id))
  ipcMain.handle(CHANNELS.clearDoneTasks, () => clearDoneTasks())
  ipcMain.handle(CHANNELS.listPrompts, () => listPrompts())
  ipcMain.handle(CHANNELS.savePrompt, (_e, p: SavedPrompt) => savePrompt(p))
  ipcMain.handle(CHANNELS.deletePrompt, (_e, id: string) => deletePrompt(id))
  ipcMain.handle(CHANNELS.listChatSessions, () => engine.listChatSessions())
  ipcMain.handle(CHANNELS.readChatSession, (_e, id: string) => engine.readChatSession(id))
  ipcMain.handle(CHANNELS.writeChatSession, (_e, session: ChatSession) => engine.writeChatSession(session))
  ipcMain.handle(CHANNELS.setActiveChatSession, (_e, id: string | null) => engine.setActiveChatSession(id))
  ipcMain.handle(CHANNELS.deleteChatSession, (_e, id: string) => engine.deleteChatSession(id))
  ipcMain.handle(CHANNELS.openUrl, (_e, url: string) => {
    // Only open real web/mail links in the system browser — never arbitrary schemes.
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
  })
}

/**
 * LAYER B — the render sandbox's one-shot capture (internal/render-sandbox.md). When the isolated sandbox is
 * launched with NVS_RENDER_OUT set, open the target project in the (dedicated) engine, render ONE posed shot
 * through captureAsset's hidden-window DOM-to-PNG path — no compositor, no window ever shown — write the PNG,
 * set the exit code, and quit. Pose comes from env (NVS_RENDER_PAGE / _VIEW / _REGION / _THEME / _MAXPX). This
 * is pure glue: captureAsset does the render + readiness wait; the only new code is env → opts → file → quit.
 */
async function runRenderPass(outFile: string): Promise<void> {
  const projectPath = process.env.NVS_OPEN_PROJECT
  if (projectPath && engine.isWork(projectPath)) engine.openWork(projectPath)
  const num = (v: string | undefined): number | undefined => (v && Number.isFinite(Number(v)) ? Number(v) : undefined)
  const result = await captureAsset({
    page: process.env.NVS_RENDER_PAGE || undefined,
    view: process.env.NVS_RENDER_VIEW || undefined,
    region: process.env.NVS_RENDER_REGION || undefined,
    theme: process.env.NVS_RENDER_THEME || undefined,
    maxPx: num(process.env.NVS_RENDER_MAXPX)
  })
  if (result.image) {
    try {
      writeFileSync(outFile, result.image.toPNG())
      console.error(`[render-sandbox] wrote ${outFile}`)
      process.exitCode = 0
    } catch (e) {
      console.error(`[render-sandbox] could not write ${outFile}: ${e instanceof Error ? e.message : String(e)}`)
      process.exitCode = 1
    }
  } else {
    console.error(`[render-sandbox] capture failed: ${result.error ?? 'unknown error'}`)
    process.exitCode = 1
  }
  app.quit()
}

app.whenReady().then(async () => {
  if (!RENDER_SANDBOX) sweepOrphanSandboxes() // reap sandbox processes a PRIOR crash orphaned — but NOT from inside a sandbox (it'd reap its own siblings)
  await installDevtools() // dev only: React DevTools "Components" tab

  // Serve project assets (avatars etc.) via the nvs-asset:// scheme so they
  // work in both dev (vite origin) and production (file:// origin) without CORS.
  protocol.handle('nvs-asset', (req) => {
    const rel = decodeURIComponent(req.url.slice('nvs-asset://'.length)).split('?')[0]! // drop cache-bust query
    // Absolute path → a library-grid asset (e.g. another project's cover). Serve ONLY under the library root.
    if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) {
      const root = library.libraryRoot()
      if (root && resolve(rel).startsWith(resolve(root) + sep)) return net.fetch(pathToFileURL(rel).toString())
      return new Response('Forbidden', { status: 403 })
    }
    const project = engine.currentProject()
    if (!project) return new Response('No open project', { status: 404 })
    return net.fetch(pathToFileURL(join(project.root, rel)).toString())
  })

  // nvs-ext://<extId>/<path> — serve an extension's OWN UI files (panel.html + assets) from its dir, so its
  // sandboxed iframe renders itself. PATH-GUARDED to the extension's dir (no traversal) — the whole trust surface.
  protocol.handle('nvs-ext', (req) => {
    const url = new URL(req.url)
    const id = url.hostname
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const dir = extHost.extensionDir(id)
    if (!dir) return new Response('Unknown extension', { status: 404 })
    const file = resolve(dir, rel)
    if (file !== resolve(dir) && !file.startsWith(resolve(dir) + sep)) return new Response('Forbidden', { status: 403 })
    if (!existsSync(file)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // The library lives in the user's Documents — visible, backup/git-friendly (L12).
  library.setLibraryRoot(join(app.getPath('documents'), 'Novel Visual Studio'))
  engine.recentsRegistry.setRecentsPath(join(app.getPath('userData'), 'recents.json'))
  engine.downloadsRegistry.setDownloadsPath(join(app.getPath('userData'), 'downloads.json'))
  extHost.setExtensionPaths(join(app.getPath('userData'), 'extensions'), [resourceDir('sample-extension'), resourceDir('sample-ui-extension')])
  extHost.refreshBundledInstalls() // push newer bundled-sample files to already-installed copies (userData pins to install-time otherwise)
  if (!RENDER_SANDBOX) maybeSeedLibrary() // first run: drop the sample in so the welcome isn't empty (a throwaway render sandbox writes nothing to the library)
  registerIpc()
  // In-app MCP server (localhost) — an agent connects by URL while NVS runs.
  //  · Live app  → the historical fixed port 4319 + userData/mcp-live.json.
  //  · Resident sandbox (NVS_SANDBOX_HANDSHAKE set) → its OWN server on an OS-assigned ephemeral port, published to
  //    the handshake file the spawning adapter chose, so it never collides with the user's live app and the adapter
  //    can proxy captures to THIS hidden instance instead of moving the author's window.
  //  · One-shot render pass (NVS_RENDER_OUT, below) → no MCP at all.
  if (process.env.NVS_SANDBOX_HANDSHAKE) startMcp({ port: 0, handshakePath: process.env.NVS_SANDBOX_HANDSHAKE })
  else if (!RENDER_SANDBOX) startMcp()
  refreshEntitlement() // re-verify Pro in the background if an email is on file (fire-and-forget)

  // A minimal app menu — hidden by autoHideMenuBar, but its accelerators still fire
  // (copy/paste, DevTools via F12 / Ctrl+Shift+I) and Alt reveals it on demand.
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' } as Electron.MenuItemConstructorOptions]
      : []),
    { role: 'fileMenu' },
    // NOT role:'editMenu' — its Undo/Redo ACCELERATORS consume Ctrl+Z/Ctrl+Shift+Z at the menu layer,
    // so the renderer never sees the keydown (dead for React-state surfaces like custody records).
    // registerAccelerator:false shows the chord but lets it reach the DOM; editors keep their own history.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', registerAccelerator: false },
        { role: 'redo', registerAccelerator: false },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    // Custom View (not role:viewMenu) so DevTools opens DETACHED — docked breaks on frameless.
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: (_item, win) => {
            const wc = (win as BrowserWindow | undefined)?.webContents
            if (wc) toggleDevToolsDetached(wc)
          }
        }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

  const renderOut = RENDER_SANDBOX ? process.env.NVS_RENDER_OUT : undefined
  if (renderOut) {
    await runRenderPass(renderOut) // Layer B: one headless shot, then quit — no main window is ever created
    return
  }

  createWindow()

  if (process.env.NVS_E2E === '1') {
    // E2E-ONLY (gated): expose internals for Playwright's electronApp.evaluate() so the e2e suite can open a
    // fixture project + drive captureAsset directly. Never attached in a normal run.
    ;(globalThis as unknown as { __nvsTest?: unknown }).__nvsTest = { openWork: engine.openWork, captureAsset }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => { stopMcp(); void closeSandbox() }) // reap the hidden sandbox on a normal quit

// Belt-and-suspenders for the ABNORMAL exits `will-quit` misses (Ctrl-C in dev, an OS terminate): synchronously kill
// the detached sandbox so it can't zombie. A hard crash of THIS process still can't run JS — that's what the
// startup sweepOrphanSandboxes() covers on the next launch.
process.on('exit', () => killSandboxNow())
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { killSandboxNow(); app.quit() })

app.on('window-all-closed', () => {
  if (RENDER_SANDBOX) return // the render pass owns its lifecycle — it quits itself after writing the PNG
  if (process.platform !== 'darwin') app.quit()
})
