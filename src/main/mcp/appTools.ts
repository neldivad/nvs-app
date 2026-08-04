/**
 * APP-ONLY MCP tools — capabilities that need the LIVE app window, so they only ever RUN on the in-app (HTTP)
 * server. This is how an agent goes from "reads the NVS data" to "SEES the NVS app": `captureView` returns a PNG
 * of what the author is looking at, so Claude can judge visual output (a tangled timeline, the coherence rail)
 * that the data tools can't convey. The headless server registers the same NAMES (APP_TOOL_DEFS) but proxies them
 * here, so an agent sees one consistent toolset whether or not the app happens to be open.
 *
 * TWO CAPTURE MODES:
 *  - no `region` → the window as the author sees it (viewport — whatever is on screen, scrolled content clipped).
 *  - a `region`  → that panel alone, rendered from the DOM with scroll containers UN-CLIPPED, so the whole gantt
 *    comes back instead of the visible slice. `listRegions` is how an agent discovers what it can ask for.
 *
 * TOKEN COST is area, not bytes: a model pays roughly (w*h)/750 tokens per image, so re-encoding to JPEG saves
 * transfer but NOT tokens — only fewer pixels do. Hence `maxPx` (default 1200) downscales every capture, and we
 * stay PNG: these are charts and small UI text, which JPEG mangles at exactly the sizes that would save anything.
 */
import { BrowserWindow, nativeImage } from 'electron'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { captureAsset } from './captureSession'

/** Names of the app-only tools (reported alongside the engine tools in mcpStatus). */
export const APP_TOOL_NAMES = ['captureView', 'listRegions', 'showView', 'showPage', 'setTheme', 'setViewport', 'captureAsset'] as const

/** The rails an agent can send itself to — mirrors the renderer's WorkspaceId. */
const VIEWS = ['editor', 'world', 'threads', 'cast', 'relationships', 'custody', 'coherence', 'timeline', 'corkboard'] as const

/** Default cap on a capture's long edge. ~1200px ≈ 1.2k tokens for a wide panel — reads labels, isn't a poster. */
const DEFAULT_MAX_PX = 1200
const MAX_ALLOWED_PX = 2000 // past this a model downsamples anyway, so the extra tokens buy nothing

/** The window's content size at boot (createWindow in main/index.ts) — what setViewport restores to. */
const DEFAULT_VIEWPORT = { width: 1280, height: 820 }

/**
 * Shared descriptors — the in-app server binds real implementations; the headless server registers the same names
 * but routes them to its hidden agent sandbox (scripts/nvsMcp.ts). One definition so the two adapters can't drift apart.
 */
export const APP_TOOL_DEFS = {
  captureView: {
    description:
      'Screenshot the NVS app — a PNG. With NO arguments: the whole window as the author sees it. With `view`: ' +
      'PEEK at any rail even when the author is elsewhere — NVS switches there, captures, and switches back, so ' +
      'you can look at the timeline while they keep writing (no need to ask them to navigate). With `region` ' +
      '(from listRegions): one panel INCLUDING the parts scrolled out of view — use it for charts/gantts, where ' +
      'most content sits below the fold. `maxPx` caps the long edge (default 1200): raise it to read fine detail, ' +
      'lower it to spend fewer tokens. Requires the NVS app to be open.',
    input: {
      view: z.enum(VIEWS).optional().describe('Rail to peek at (switches there and back). Omit to capture what is already on screen.'),
      region: z.string().optional().describe('Region id from listRegions (e.g. timelinePanel, threadsPanel). Omit for the whole window, or the main panel when `view` is set.'),
      maxPx: z.number().optional().describe(`Cap the long edge in pixels (default ${DEFAULT_MAX_PX}, max ${MAX_ALLOWED_PX}). Image tokens scale with area.`)
    }
  },
  showView: {
    description:
      'NAVIGATE the author\'s NVS window to a rail and LEAVE it there — for "show me the coherence rail" / "take ' +
      'me to the timeline". This moves what the author sees, so only call it when they asked to go somewhere; to ' +
      'look at a rail yourself without disturbing them, use captureView with `view` instead. Returns what is on ' +
      'screen afterwards (no image tokens).',
    input: { view: z.enum(VIEWS).describe('Which rail to open.') }
  },
  showPage: {
    description:
      'Open a SPECIFIC page — a scene, or a world page (character, location, lore, item) — in the NVS window and ' +
      'leave it there. This is the deep-link between showView (a whole rail) and captureView (a screenshot): use ' +
      'it to FRAME one rich page before capturing, e.g. open a character page with its portrait then captureView. ' +
      'Pass a scene/page path from listScenes / listWorldPages, or a title from listCast (resolution is fuzzy: id, ' +
      'path, path-substring, or title). Returns the resolved page + what is on screen (no image tokens). Requires ' +
      'the NVS app open.',
    input: { ref: z.string().describe('A scene/page path, id, or title — resolve one from listScenes / listWorldPages / listCast first.') }
  },
  setTheme: {
    description:
      'Switch the NVS canvas theme and leave it: "dark" (the warm "focus" drafting canvas, default) or "light" ' +
      '(the warm "manuscript" paper). Light reads cleaner in slides and printed/pitch assets. Persists until ' +
      'changed. Pair with captureView to produce light-mode visuals. Requires the NVS app open.',
    input: { theme: z.enum(['light', 'dark']).describe('dark = warm focus canvas; light = warm manuscript paper.') }
  },
  setViewport: {
    description:
      'Resize the NVS window to a fixed content size for CONSISTENT capture framing across a set of screenshots ' +
      '(e.g. 1600×1000 for slides). Omit BOTH dimensions to restore the default (1280×820); pass one to change it ' +
      'and keep the other. Un-maximizes / exits fullscreen first so the size actually takes effect. Returns the ' +
      'applied size (no image tokens). Requires the NVS app open.',
    input: {
      width: z.number().optional().describe('Content width in px. Omit (with height) to restore the 1280×820 default.'),
      height: z.number().optional().describe('Content height in px. Omit (with width) to restore the 1280×820 default.')
    }
  },
  captureAsset: {
    description:
      'NON-DISRUPTIVE screenshot for producing assets/slides: renders the CURRENTLY-OPEN project in a HIDDEN ' +
      'background window, poses it, and captures it — WITHOUT moving the author\'s live window (unlike showPage/' +
      'setTheme/setViewport, which drive the visible window). One call → one PNG. Pose it with any of: `page` ' +
      '(deep-link a scene/world page by path/title from listScenes/listWorldPages/listCast), `view` (a rail, if no ' +
      'page), `theme` (focus/manuscript — manuscript reads cleaner in slides), `width`×`height` (frame size, ' +
      'default 1280×820), `region` (one panel un-clipped; omit for the whole app shell). Slower than captureView ' +
      '(it boots a fresh render), so prefer it for FINAL assets and captureView for quick live peeks. Captures ' +
      'only the project the author has open (v1). Requires the NVS app open.',
    input: {
      page: z.string().optional().describe('Scene/world-page path, id, or title to frame (from listScenes / listWorldPages / listCast).'),
      view: z.enum(VIEWS).optional().describe('Rail to open instead of a page (ignored if `page` is set).'),
      region: z.string().optional().describe('Region id (from listRegions) to capture alone, un-clipped. Omit for the whole shell.'),
      theme: z.enum(['light', 'dark']).optional().describe('dark = warm focus canvas; light = warm manuscript paper (cleaner for slides).'),
      width: z.number().optional().describe('Frame width in px (default 1280).'),
      height: z.number().optional().describe('Frame height in px (default 820).'),
      maxPx: z.number().optional().describe(`Cap the long edge in px (default ${1400}, max ${2400}).`),
      outPath: z.string().optional().describe('If set, the headless server WRITES the PNG to this absolute path and returns the path instead of the inline image — for saving a batch of assets to disk.')
    }
  },
  listRegions: {
    description:
      'What is on the author\'s screen right now: every visible NVS region (panels, rails, editor, dialogs, ' +
      'floats) with its id, purpose and size. Call before captureView to pick a region — it also answers "what ' +
      'am I looking at?" without spending image tokens.',
    input: {}
  }
} as const

const liveWindow = (): BrowserWindow | null => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  return win && !win.webContents.isDestroyed() ? win : null
}

const noWindow = { content: [{ type: 'text' as const, text: 'no NVS window is open — this needs the running app' }], isError: true }

/** Downscale so the long edge is <= maxPx. Never upscales — invented pixels cost tokens and add no information. */
function clamp(img: Electron.NativeImage, maxPx: number): Electron.NativeImage {
  const { width, height } = img.getSize()
  const longest = Math.max(width, height)
  if (longest <= maxPx || longest === 0) return img
  const scale = maxPx / longest
  return img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' })
}

const png = (img: Electron.NativeImage): { content: { type: 'image'; data: string; mimeType: string }[] } => ({
  content: [{ type: 'image', data: img.toPNG().toString('base64'), mimeType: 'image/png' }]
})

/** Register the app-only tools on an in-app MCP server instance. No-ops safely when no window is open. */
export function registerAppTools(server: McpServer): void {
  server.registerTool(
    'captureView',
    { description: APP_TOOL_DEFS.captureView.description, inputSchema: APP_TOOL_DEFS.captureView.input },
    async (args) => {
      const win = liveWindow()
      if (!win) return noWindow
      const maxPx = Math.min(Math.max(Number(args?.maxPx) || DEFAULT_MAX_PX, 200), MAX_ALLOWED_PX)
      const q = (v: unknown): string => JSON.stringify(v === undefined ? null : String(v))

      // PEEK: switch rails, capture, switch back — the agent gets its own eyes without relocating the author.
      if (args?.view) {
        const res = (await win.webContents.executeJavaScript(
          `window.__nvsAgentCapture ? window.__nvsAgentCapture.peek(${q(args.view)}, ${args.region ? q(args.region) : 'undefined'}, ${maxPx}, false) : null`,
          true
        )) as { ok: boolean; dataUrl?: string; error?: string } | null
        if (!res?.ok || !res.dataUrl) {
          return { content: [{ type: 'text' as const, text: res?.error ?? 'could not reach the NVS window' }], isError: true }
        }
        return png(clamp(nativeImage.createFromDataURL(res.dataUrl), maxPx))
      }

      if (!args?.region) return png(clamp(await win.webContents.capturePage(), maxPx))

      // Region capture runs in the RENDERER — it owns the DOM and the un-clip recipe; main just drives it.
      const dataUrl = (await win.webContents.executeJavaScript(
        `window.__nvsAgentCapture ? window.__nvsAgentCapture.capture(${q(args.region)}, true, ${maxPx}) : null`,
        true
      )) as string | null
      if (!dataUrl) {
        return {
          content: [{ type: 'text' as const, text: `region "${args.region}" isn't on screen right now — call listRegions to see what is, or pass \`view\` to peek at another rail` }],
          isError: true
        }
      }
      return png(clamp(nativeImage.createFromDataURL(dataUrl), maxPx))
    }
  )

  server.registerTool(
    'showView',
    { description: APP_TOOL_DEFS.showView.description, inputSchema: APP_TOOL_DEFS.showView.input },
    async (args) => {
      const win = liveWindow()
      if (!win) return noWindow
      const res = await win.webContents.executeJavaScript(
        `window.__nvsAgentCapture ? window.__nvsAgentCapture.show(${JSON.stringify(String(args.view))}) : null`,
        true
      )
      return { content: [{ type: 'text' as const, text: JSON.stringify(res ?? { ok: false, error: 'the NVS window is not ready' }) }], isError: !res?.ok }
    }
  )

  server.registerTool(
    'listRegions',
    { description: APP_TOOL_DEFS.listRegions.description, inputSchema: APP_TOOL_DEFS.listRegions.input },
    async () => {
      const win = liveWindow()
      if (!win) return noWindow
      const regions = await win.webContents.executeJavaScript('window.__nvsAgentCapture ? window.__nvsAgentCapture.regions() : []', true)
      return { content: [{ type: 'text' as const, text: JSON.stringify(regions ?? []) }] }
    }
  )

  server.registerTool(
    'showPage',
    { description: APP_TOOL_DEFS.showPage.description, inputSchema: APP_TOOL_DEFS.showPage.input },
    async (args) => {
      const win = liveWindow()
      if (!win) return noWindow
      const res = await win.webContents.executeJavaScript(
        `window.__nvsAgentCapture ? window.__nvsAgentCapture.showPage(${JSON.stringify(String(args.ref))}) : null`,
        true
      )
      return { content: [{ type: 'text' as const, text: JSON.stringify(res ?? { ok: false, error: 'the NVS window is not ready' }) }], isError: !res?.ok }
    }
  )

  server.registerTool(
    'setTheme',
    { description: APP_TOOL_DEFS.setTheme.description, inputSchema: APP_TOOL_DEFS.setTheme.input },
    async (args) => {
      const win = liveWindow()
      if (!win) return noWindow
      const res = await win.webContents.executeJavaScript(
        `window.__nvsAgentCapture ? window.__nvsAgentCapture.setTheme(${JSON.stringify(String(args.theme))}) : null`,
        true
      )
      return { content: [{ type: 'text' as const, text: JSON.stringify(res ?? { ok: false, error: 'the NVS window is not ready' }) }], isError: !res?.ok }
    }
  )

  server.registerTool(
    'captureAsset',
    { description: APP_TOOL_DEFS.captureAsset.description, inputSchema: APP_TOOL_DEFS.captureAsset.input },
    async (args) => {
      const num = (v: unknown): number | undefined => (v == null || Number.isNaN(Number(v)) ? undefined : Number(v))
      const res = await captureAsset({
        page: args.page as string | undefined,
        view: args.view as string | undefined,
        region: args.region as string | undefined,
        theme: args.theme as string | undefined,
        width: num(args.width),
        height: num(args.height),
        maxPx: num(args.maxPx)
      })
      if (!res.image) {
        return { content: [{ type: 'text' as const, text: res.error ?? 'captureAsset failed' }], isError: true }
      }
      // captureFull/capture already scaled to maxPx; clamp again is a cheap no-op safety net.
      return png(clamp(res.image, Math.min(Math.max(num(args.maxPx) ?? 1400, 200), MAX_ALLOWED_PX)))
    }
  )

  // setViewport is pure MAIN — it resizes the BrowserWindow itself (the renderer can't), so it doesn't go
  // through __nvsAgentCapture. Both dims omitted → restore the createWindow default; one omitted → keep current.
  server.registerTool(
    'setViewport',
    { description: APP_TOOL_DEFS.setViewport.description, inputSchema: APP_TOOL_DEFS.setViewport.input },
    async (args) => {
      const win = liveWindow()
      if (!win) return noWindow
      const clampDim = (n: number): number => Math.min(Math.max(Math.round(n), 480), 3840)
      const [curW, curH] = win.getContentSize()
      const bothOmitted = args?.width == null && args?.height == null
      const width = bothOmitted ? DEFAULT_VIEWPORT.width : clampDim(Number(args?.width) || curW)
      const height = bothOmitted ? DEFAULT_VIEWPORT.height : clampDim(Number(args?.height) || curH)
      if (win.isFullScreen()) win.setFullScreen(false)
      if (win.isMaximized()) win.unmaximize()
      win.setContentSize(width, height)
      const [aw, ah] = win.getContentSize()
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, width: aw, height: ah }) }] }
    }
  )
}
