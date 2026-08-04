/**
 * HIDDEN-WINDOW ASSET CAPTURE — render the currently-open project in an OFF-SCREEN BrowserWindow, pose it
 * (page / rail / theme / viewport), screenshot it via DOM-to-PNG, and tear it down. The author's live window is
 * never touched — that is the entire point (vs. the live-drive showPage/setTheme/setViewport tools, which move
 * the author's own view). Non-disruptive: they keep working while a batch of pitch/asset shots generates.
 *
 * WHY DOM-to-PNG, not webContents.capturePage(): capturePage needs the window composited to a surface, which a
 * never-shown window may skip on some platforms (black frame). DOM-to-PNG serializes the laid-out DOM in the
 * renderer — no compositor — so the capture window can stay `show:false` forever.
 *
 * SCOPE (v1): the CURRENTLY-OPEN project only. The engine is a single shared main-process instance (one
 * `currentProject()`), so opening a DIFFERENT project here would swap it out from under the live window and
 * corrupt any read it does mid-capture. Same-project is conflict-free (both windows read the same engine; each
 * renderer's store/theme/DOM is its own). Any-project background capture needs a multi-context engine — deferred.
 */
import { BrowserWindow, nativeImage } from 'electron'
import { join } from 'node:path'
import * as engine from '@engine/index'

export interface CaptureAssetOpts {
  page?: string // deep-link a scene/world page (fuzzy id/path/title) before capturing
  view?: string // OR open a rail (editor/world/threads/…); ignored if `page` is set
  region?: string // capture ONE panel (un-clipped); omit for the whole shell
  theme?: string // 'light' | 'dark'
  width?: number
  height?: number
  maxPx?: number
}

const DEFAULT_W = 1280
const DEFAULT_H = 820
const DEFAULT_MAX_PX = 1400
const MAX_ALLOWED_PX = 2400

const clampDim = (n: number): number => Math.min(Math.max(Math.round(n), 480), 3840)
const jstr = (v: unknown): string => JSON.stringify(String(v))

/** Run an async renderer expression and get its resolved value; never throws (renderer errors → {ok:false}). */
async function evalAsync(win: BrowserWindow, expr: string): Promise<{ ok?: boolean; error?: string } | null> {
  return (await win.webContents.executeJavaScript(
    `(async () => { try { return await (${expr}) } catch (e) { return { ok: false, error: String((e && e.message) || e) } } })()`,
    true
  )) as { ok?: boolean; error?: string } | null
}

/** Poll a boolean renderer expression until true or timeout. */
async function waitFor(win: BrowserWindow, boolExpr: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await win.webContents.executeJavaScript(boolExpr, true).catch(() => false)
    if (ok) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

/**
 * Capture one posed shot of the open project in a hidden window. Returns a PNG NativeImage, or an error string.
 * Every path tears the window down (finally), so a failure never leaks an off-screen window.
 */
export async function captureAsset(opts: CaptureAssetOpts): Promise<{ image?: Electron.NativeImage; error?: string; meta?: unknown }> {
  const proj = engine.currentProject()
  if (!proj) return { error: 'no project is open — captureAsset renders the currently-open project (open one first)' }

  const width = clampDim(opts.width ?? DEFAULT_W)
  const height = clampDim(opts.height ?? DEFAULT_H)
  const maxPx = Math.min(Math.max(Number(opts.maxPx) || DEFAULT_MAX_PX, 200), MAX_ALLOWED_PX)

  const win = new BrowserWindow({
    width,
    height,
    show: false, // never shown — the author's screen is untouched
    skipTaskbar: true,
    paintWhenInitiallyHidden: true, // (BrowserWindow option) lay out + paint despite show:false, so the DOM is real
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'), // same bundle layout as createWindow (out/main → ../preload)
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  try {
    const url = process.env['ELECTRON_RENDERER_URL']
    if (url) await win.loadURL(url)
    else await win.loadFile(join(__dirname, '../renderer/index.html'))

    if (!(await waitFor(win, '!!window.__nvsAgentCapture', 10_000))) {
      return { error: 'the capture window never finished booting (agent bridge not installed)' }
    }

    // Hydrate this window's store with the open project (its own renderer state; the live window is unaffected).
    const prep = await evalAsync(win, `window.__nvsAgentCapture.prepare(${jstr(proj.root)})`)
    if (!prep?.ok) return { error: prep?.error ?? 'the capture window could not load the project' }

    // Pose: theme first (so the shot is themed), then a specific page, else a rail.
    if (opts.theme) {
      const t = await evalAsync(win, `window.__nvsAgentCapture.setTheme(${jstr(opts.theme)})`)
      if (!t?.ok) return { error: t?.error ?? `could not set theme "${opts.theme}"` }
    }
    if (opts.page) {
      const p = await evalAsync(win, `window.__nvsAgentCapture.showPage(${jstr(opts.page)})`)
      if (!p?.ok) return { error: p?.error ?? `could not open page "${opts.page}"` }
    } else if (opts.view) {
      const v = await evalAsync(win, `window.__nvsAgentCapture.show(${jstr(opts.view)})`)
      if (!v?.ok) return { error: v?.error ?? `could not open view "${opts.view}"` }
    }

    // Capture via DOM-to-PNG (no compositor needed): one panel un-clipped, or the whole shell.
    const expr = opts.region
      ? `window.__nvsAgentCapture.capture(${jstr(opts.region)}, true, ${maxPx})`
      : `window.__nvsAgentCapture.captureFull(${maxPx})`
    const dataUrl = (await win.webContents.executeJavaScript(expr, true)) as string | null
    if (!dataUrl) {
      return { error: opts.region ? `region "${opts.region}" wasn't found in the capture window` : 'capture produced no image' }
    }

    return {
      image: nativeImage.createFromDataURL(dataUrl),
      meta: { project: proj.name, width, height, page: opts.page, view: opts.view, region: opts.region, theme: opts.theme }
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
