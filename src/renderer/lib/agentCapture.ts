/**
 * AGENT EYES — the renderer half of region-scoped screenshots for MCP (`listRegions` / `captureView`).
 *
 * `captureView` alone can only return the viewport: whatever the author happens to be looking at, clipped to the
 * screen. That's wrong for an agent asking "does my timeline look tangled" — a gantt is mostly BELOW the fold.
 * So main drives the renderer through `window.__nvsAgentCapture` (installed once at boot, read via
 * `executeJavaScript`) rather than opening new IPC channels for a debug-grade capability.
 *
 * Two jobs:
 *  1. `regions()` — what's on screen right now, as the typed region vocabulary (config/regions.ts) an agent can
 *     name back to us. Off-screen/unmounted regions are simply absent, so the list doubles as "where am I".
 *  2. `capture(id)` — a PNG of ONE region, reusing the rail-export recipe (`fullTarget` un-clips scroll containers
 *     so the WHOLE grid is captured, not the visible slice) but WITHOUT the branding pass.
 *
 * TOKEN COST, which is why this doesn't just reuse useRailExport: a model pays for image AREA (~w*h/750 tokens),
 * not bytes. The branded export renders at `scale: 2` — beautiful for a poster, 4x the tokens for a reader that
 * gains nothing from device pixels. Here scale is chosen to land the long edge on `maxPx` (never upscaling), and
 * the logo/caption footer is dropped: an agent doesn't need a wordmark, and burnt-in text invites misreading it
 * as story content.
 */
import { domToPng } from 'modern-screenshot'
import { REGIONS, type RegionId } from '@/config/regions'
import { fullTarget, baseBg } from '@/lib/timeline/exportRail'
import { useWorkspace, type WorkspaceId, type ThemeMode } from '@/stores/workspace'
import type { PageRef } from '@shared/ipc'

/** The rails an agent can send itself to. Mirrors WorkspaceId — the type keeps them in sync. */
const WORKSPACES: WorkspaceId[] = ['editor', 'world', 'threads', 'cast', 'relationships', 'custody', 'coherence', 'timeline', 'corkboard']

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Each rail's MAIN panel — what must be mounted before a capture means anything. */
const WORKSPACE_REGION: Record<WorkspaceId, RegionId> = {
  editor: 'sceneEditor',
  world: 'worldNavigator',
  threads: 'threadsPanel',
  cast: 'castPanel',
  relationships: 'relationshipsPanel',
  custody: 'custodyPanel',
  coherence: 'coherencePanel',
  timeline: 'timelinePanel',
  corkboard: 'mainContent' // slice 1: the content area IS the canvas; a dedicated corkboardPanel region can come later
}

/** Is this rail's own panel mounted at a real size? (Not "any big box" — the sidebar is always mounted.) */
function railReady(workspace: WorkspaceId): boolean {
  const el = document.querySelector<HTMLElement>(`[data-region="${REGIONS[WORKSPACE_REGION[workspace]].label}"]`)
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 100 && r.height > 60
}

/**
 * Switch rails and wait for THAT rail's panel to actually be on screen. A panel mounts a frame after the store
 * changes and then fetches its own data, so "set state and screenshot" reliably captures an empty shell. Returns
 * false if the panel never mounted (no project, empty rail) — the caller reports that instead of a blank image.
 */
async function goTo(workspace: WorkspaceId, timeoutMs = 5000): Promise<boolean> {
  useWorkspace.getState().setWorkspace(workspace)
  const deadline = Date.now() + timeoutMs
  let ready = false
  while (Date.now() < deadline) {
    await frame()
    if (railReady(workspace)) {
      ready = true
      break
    }
    await sleep(80)
  }
  if (ready) await sleep(400) // rows/markers paint after their data lands — settle before capturing
  return ready
}

export type AgentRegion = { id: string; label: string; group: string; desc: string; width: number; height: number }

/** Every mounted, non-empty region — the menu an agent picks from. */
function regions(): AgentRegion[] {
  const out: AgentRegion[] = []
  for (const el of document.querySelectorAll<HTMLElement>('[data-region]')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue // mounted but collapsed/hidden — not a capture target
    // The DOM carries the LABEL; map it back to the typed id so the agent's vocabulary matches config/regions.ts.
    const label = el.dataset.region ?? ''
    const entry = (Object.entries(REGIONS) as [RegionId, (typeof REGIONS)[RegionId]][]).find(([, m]) => m.label === label)
    out.push({
      id: entry?.[0] ?? label,
      label,
      group: entry?.[1].group ?? 'unknown',
      desc: entry?.[1].desc ?? '',
      width: Math.round(r.width),
      height: Math.round(r.height)
    })
  }
  return out
}

/**
 * PNG (data URL) of one region. `full` un-clips scroll containers to capture the entire chart.
 * `maxPx` caps the long edge — the token dial. Returns null when the region isn't on screen.
 */
async function capture(id: string, full = true, maxPx = 1200): Promise<string | null> {
  const label = (REGIONS as Record<string, { label: string } | undefined>)[id]?.label ?? id
  const root =
    document.querySelector<HTMLElement>(`[data-region="${label}"]`) ?? document.querySelector<HTMLElement>(`[data-region="${id}"]`)
  if (!root) return null
  const { node, restore } = full ? fullTarget(root) : { node: root, restore: () => {} }
  try {
    // Measure AFTER un-clipping — that's the size we're actually rendering.
    const w = node.scrollWidth || node.getBoundingClientRect().width
    const h = node.scrollHeight || node.getBoundingClientRect().height
    const scale = Math.min(1, maxPx / Math.max(w, h, 1)) // never upscale: pixels we don't have cost tokens for nothing
    return await domToPng(node, {
      backgroundColor: baseBg(),
      scale,
      filter: (n) => !(n instanceof HTMLElement) || (n.dataset.exportHide !== '1' && n.dataset.region !== 'Fab')
    })
  } finally {
    restore()
  }
}

/**
 * Go to a rail and STAY there — the author asked to be taken somewhere ("show me the coherence rail").
 * Returns what's on screen afterwards so the agent can describe it without spending image tokens.
 */
async function show(workspace: string): Promise<{ ok: boolean; workspace: string; regions: AgentRegion[]; error?: string }> {
  if (!WORKSPACES.includes(workspace as WorkspaceId)) {
    return { ok: false, workspace, regions: [], error: `unknown view "${workspace}" — one of: ${WORKSPACES.join(', ')}` }
  }
  if (!useWorkspace.getState().project) {
    return { ok: false, workspace, regions: [], error: 'no project is open in NVS' }
  }
  const mounted = await goTo(workspace as WorkspaceId)
  return { ok: mounted, workspace, regions: regions(), error: mounted ? undefined : 'the view opened but rendered nothing (empty rail?)' }
}

/**
 * PEEK at a rail the author isn't on: switch, capture, switch back. Restoring is the default because this is the
 * author's own window — an agent browsing rails shouldn't silently relocate someone who's mid-sentence. Pass
 * `stay` when the navigation IS the point.
 */
async function peek(
  workspace: string,
  region?: string,
  maxPx = 1200,
  stay = false
): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  if (!WORKSPACES.includes(workspace as WorkspaceId)) {
    return { ok: false, error: `unknown view "${workspace}" — one of: ${WORKSPACES.join(', ')}` }
  }
  const store = useWorkspace.getState()
  if (!store.project) return { ok: false, error: 'no project is open in NVS' }
  const previous = store.workspace
  try {
    const mounted = await goTo(workspace as WorkspaceId)
    if (!mounted) return { ok: false, error: `the ${workspace} view rendered nothing to capture` }
    // No explicit region → this rail's own panel (falling back to the biggest mounted one if the map ever drifts).
    const target = region ?? WORKSPACE_REGION[workspace as WorkspaceId] ?? biggestRegionId()
    const dataUrl = target ? await capture(target, true, maxPx) : null
    return dataUrl ? { ok: true, dataUrl } : { ok: false, error: `nothing to capture in the ${workspace} view` }
  } finally {
    if (!stay && previous !== workspace) useWorkspace.getState().setWorkspace(previous) // put the author back
  }
}

/**
 * DEEP-LINK to a specific page — a scene or a world page (character/location/lore/item/custody) — and open it in
 * the window, LEAVING it there. Resolution is the same fuzzy match as an in-app link (id / exact path / path-
 * substring / title), so an agent can pass a path from `listScenes`/`listWorldPages` or a title from `listCast`.
 * force-opens past the unsaved-changes guard: an automated capture run must not stall on a Save prompt.
 * This is the missing rung between `showView` (a whole rail) and `captureView` — it frames ONE rich page (a
 * character with its portrait, a specific scene) so the screenshot after it is the shot you actually wanted.
 */
async function showPage(
  ref: string
): Promise<{ ok: boolean; page?: PageRef; workspace?: string; regions?: AgentRegion[]; error?: string }> {
  const store = useWorkspace.getState()
  if (!store.project) return { ok: false, error: 'no project is open in NVS' }
  const q = ref.trim()
  const lc = q.toLowerCase()
  const sc = store.scenes.find((s) => s.sceneId === q || s.path === q || s.path.includes(q) || s.title.toLowerCase() === lc)
  let page: PageRef | null = sc ? { path: sc.path, title: sc.title, kind: 'scene' } : null
  if (!page) {
    const wp = store.worldPages.find((p) => p.id === q || p.path === q || p.path.includes(q) || p.name.toLowerCase() === lc)
    if (wp) page = { path: wp.path, title: wp.name, kind: wp.kind }
  }
  if (!page) {
    // Custody pages live in the Custody PILLAR (content/custody/), a SEPARATE list from world/. They're lazy —
    // the store only holds them once the Custody rail has opened — so fetch on demand when the store is empty.
    const topics = store.custodyTopics.length ? store.custodyTopics : ((await window.nvs.listCustodyTopics?.()) ?? [])
    const ct = topics.find((t) => t.pageId === q || t.path === q || t.path.includes(q) || t.name.toLowerCase() === lc)
    if (ct) page = { path: ct.path, title: ct.name, kind: 'custody' }
  }
  if (!page) {
    return { ok: false, error: `no scene or page matched "${ref}" — resolve one from listScenes / listWorldPages / listCast / listCustodyTopics first` }
  }
  await store.openPage(page, true) // force: skip the unsaved-changes prompt — no human is mid-sentence in a capture run
  // openPage already switched the workspace; goTo just waits for that rail's panel to mount + settle before we return.
  const workspace: WorkspaceId = page.kind === 'scene' ? 'editor' : page.kind === 'custody' ? 'custody' : 'world'
  const mounted = await goTo(workspace)
  return { ok: mounted, page, workspace, regions: regions(), error: mounted ? undefined : 'the page opened but its panel rendered nothing' }
}

/**
 * Flip the canvas theme and LEAVE it: `dark` (the warm "focus" drafting canvas, default) or `light` (the warm
 * "manuscript" paper). Light reads cleaner in slides and printed assets — the reason a pitch-visual agent wants it.
 */
async function setTheme(mode: string): Promise<{ ok: boolean; theme?: string; error?: string }> {
  if (mode !== 'light' && mode !== 'dark') {
    return { ok: false, error: `unknown theme "${mode}" — one of: light, dark` }
  }
  useWorkspace.getState().setTheme(mode as ThemeMode)
  await frame() // let <html>.dark flip and the DESIGN.md token vars repaint before a capture reads the new colors
  await sleep(150)
  return { ok: true, theme: mode }
}

/**
 * HIDDEN-CAPTURE-WINDOW ONLY: load a project into THIS window's store so showPage/capture can resolve against it.
 * A fresh capture window boots with an empty store; the live author window already opened this project, and the
 * shared main-process engine is on it, so this just hydrates the new renderer (scenes / world pages / rails).
 * Waits until scenes land (or the project at least opens — an empty project is legitimate) before returning.
 */
async function prepare(path: string, timeoutMs = 15000): Promise<{ ok: boolean; scenes: number; error?: string }> {
  try {
    await useWorkspace.getState().openWork(path)
  } catch (e) {
    return { ok: false, scenes: 0, error: `openWork failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const s = useWorkspace.getState()
    if (s.project && s.scenes.length > 0) {
      await sleep(300) // let the auto-opened first scene + editor settle before the first pose/capture
      return { ok: true, scenes: s.scenes.length }
    }
    await sleep(100)
  }
  const s = useWorkspace.getState()
  return s.project
    ? { ok: true, scenes: s.scenes.length } // opened, just no scenes — an empty project, still capturable
    : { ok: false, scenes: 0, error: 'the project did not load in the capture window' }
}

/**
 * Whole-shell PNG (data URL) via DOM-to-PNG on #root. Unlike webContents.capturePage(), this needs NO compositor —
 * it serializes the laid-out DOM — so it works in a window that is never shown (the hidden capture window). Drops
 * the FAB + any data-export-hide chrome, same as region capture.
 */
async function captureFull(maxPx = 1400): Promise<string | null> {
  const root = document.getElementById('root')
  if (!root) return null
  const w = root.scrollWidth || root.getBoundingClientRect().width
  const h = root.scrollHeight || root.getBoundingClientRect().height
  const scale = Math.min(1, maxPx / Math.max(w, h, 1)) // never upscale
  return await domToPng(root, {
    backgroundColor: baseBg(),
    scale,
    filter: (n) => !(n instanceof HTMLElement) || (n.dataset.exportHide !== '1' && n.dataset.region !== 'Fab')
  })
}

/** The largest mounted region — the main content of whatever rail we're on. */
function biggestRegionId(): string | null {
  const all = regions().filter((r) => r.group === 'panel' || r.group === 'editor')
  if (!all.length) return null
  return all.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)).id
}

declare global {
  interface Window {
    __nvsAgentCapture?: {
      regions: typeof regions
      capture: typeof capture
      show: typeof show
      peek: typeof peek
      showPage: typeof showPage
      setTheme: typeof setTheme
      prepare: typeof prepare
      captureFull: typeof captureFull
    }
  }
}

/** Install the bridge (called once at renderer boot). Idempotent. */
export function installAgentCapture(): void {
  window.__nvsAgentCapture = { regions, capture, show, peek, showPage, setTheme, prepare, captureFull }
}
