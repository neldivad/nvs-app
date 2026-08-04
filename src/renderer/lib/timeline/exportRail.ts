/**
 * Branded PNG export for a rail (cast / thread / coherence).
 *
 * Captures the rail's `data-region` (html-to-image, timeline's recipe), dropping chrome — anything with
 * `data-export-hide="1"` (toolbar) and the floating `Fab`. Parameters (all overridable per call, so the
 * content pipeline can drive it headlessly):
 *   • scroll — un-clip scrollable containers so the FULL grid is captured, not just the visible screen.
 *   • meta   — burn a project title / author header across the top.
 * Fills a solid base bg (`--canvas`, charts render transparent) and stamps an nvs footer (logo · caption
 * · getqed.app/nvs). Reuses the workspace `saveImage` action.
 */
import { useCallback, useState } from 'react'
import { domToPng } from 'modern-screenshot' // successor to html-to-image: renders transform-positioned
import { useWorkspace } from '@/stores/workspace' // overlays (the gantt lines/markers) that html-to-image dropped
// SVG variants (recolored from assets/nvs-logo.svg) — drawImage consumes SVG like PNG and stays crisp at 2x.
import logoLight from '@/assets/brand/variants/nvs-logo-light.svg' // deep indigo — for a light canvas
import logoDark from '@/assets/brand/variants/nvs-logo-dark.svg' // light indigo — for a dark canvas

const PRODUCT_URL = 'getqed.app/nvs'
const WORDMARK = 'Novel Visual Studio'

export interface RailExportOpts {
  caption?: () => string
  scroll?: boolean // capture the full scroll content (default) vs the visible screen only
  meta?: boolean // burn in a project title / author header (default true, when a project is open)
}

export function useRailExport(region: string, filename: string, opts: RailExportOpts = {}) {
  const saveImage = useWorkspace((s) => s.saveImage)
  const projectInfo = useWorkspace((s) => s.projectInfo)
  const [exporting, setExporting] = useState(false)

  const exportPng = useCallback(
    async (override: Partial<RailExportOpts> = {}) => {
      const o = { scroll: true, meta: true, ...opts, ...override }
      const root = document.querySelector<HTMLElement>(`[data-region="${region}"]`)
      if (!root) return
      setExporting(true)
      // Capture the scroll container expanded to its full content — NOT the region. That way we never
      // fight the region's flex height or collapse absolute-positioned content (markers, cells).
      const { node, restore } = o.scroll ? fullTarget(root) : { node: root, restore: () => {} }
      try {
        const bg = baseBg()
        const dataUrl = await domToPng(node, {
          backgroundColor: bg,
          scale: 2, // modern-screenshot's device scale (was html-to-image's pixelRatio)
          filter: (n) => !(n instanceof HTMLElement) || (n.dataset.exportHide !== '1' && n.dataset.region !== 'Fab')
        })
        const head = o.meta && projectInfo && (projectInfo.title || projectInfo.author)
          ? { title: projectInfo.title ?? '', author: projectInfo.author ?? '' }
          : null
        await saveImage(filename, await compose(dataUrl, bg, o.caption?.() ?? '', head))
      } catch (e) {
        console.error('[nvs] rail export failed', e)
      } finally {
        restore()
        setExporting(false)
      }
    },
    [region, filename, opts, projectInfo, saveImage]
  )

  return { exporting, exportPng }
}

/**
 * Find the rail's main scroll container and return its CONTENT CHILD as the capture target. That child's
 * own box (`offsetHeight`/`offsetWidth`) is the full, unclipped content — the rasterizer renders the node
 * in isolation at that box, so the parent's overflow never clips it and nothing (padding, the bottom
 * counter bar, sticky header) is cut. No style mutation, so nothing can collapse. Falls back to the region
 * when there's no scroll container. Returns the node to shoot + a no-op restore (kept for a stable shape).
 */
export function fullTarget(root: HTMLElement): { node: HTMLElement; restore: () => void } {
  let scroller: HTMLElement | null = null
  let best = 0
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    const cs = getComputedStyle(el)
    const scrolls = /(auto|scroll)/.test(cs.overflowY) || /(auto|scroll)/.test(cs.overflowX)
    const over = Math.max(el.scrollHeight - el.clientHeight, el.scrollWidth - el.clientWidth)
    if (scrolls && over > best) {
      best = over
      scroller = el
    }
  }
  const content = scroller?.firstElementChild
  return { node: content instanceof HTMLElement ? content : root, restore: () => {} }
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
export function baseBg(): string {
  return cssVar('--canvas') || '#1b1714'
}
function isDark(color: string): boolean {
  const n = color.startsWith('#')
    ? (() => {
        const h = color.slice(1)
        const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
        return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
      })()
    : (color.match(/\d+/g) ?? ['27', '23', '20']).map(Number)
  return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2] < 128
}
async function loadImg(src: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    return img
  } catch {
    return null
  }
}

const SANS = 'ui-sans-serif, system-ui, sans-serif'

/** Compose: optional project/author header · the graph · an nvs footer (logo · caption · getqed.app/nvs). */
async function compose(dataUrl: string, bg: string, caption: string, head: { title: string; author: string } | null): Promise<string> {
  const graph = new Image()
  graph.src = dataUrl
  await graph.decode()
  const dark = isDark(bg)
  const logo = await loadImg(dark ? logoDark : logoLight)
  const accent = cssVar('--thread') || (dark ? '#818cf8' : '#4f46e5')
  const fg = dark ? '#e8e8ef' : '#1b1714'
  const muted = dark ? 'rgba(200,200,210,0.82)' : 'rgba(90,80,70,0.85)'

  const pad = 28
  const header = head ? 100 : 0
  const footer = 96
  const W = graph.naturalWidth
  const H = header + graph.naturalHeight + footer
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return dataUrl

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // ── header: project title + author ──
  if (head) {
    ctx.textBaseline = 'alphabetic'
    if (head.title && head.author) {
      ctx.font = `700 34px ${SANS}`
      ctx.fillStyle = fg
      ctx.fillText(head.title, pad, header * 0.46)
      ctx.font = `400 24px ${SANS}`
      ctx.fillStyle = muted
      ctx.fillText(`by ${head.author}`, pad, header * 0.78)
    } else {
      ctx.textBaseline = 'middle'
      ctx.font = `700 34px ${SANS}`
      ctx.fillStyle = fg
      ctx.fillText(head.title || `by ${head.author}`, pad, header / 2)
    }
    ctx.fillStyle = accent
    ctx.fillRect(pad, header - 3, W - pad * 2, 3)
  }

  ctx.drawImage(graph, 0, header)

  // ── footer: logo · caption · url ──
  const fy = header + graph.naturalHeight
  ctx.fillStyle = accent
  ctx.fillRect(pad, fy, W - pad * 2, 3)
  const cy = fy + footer / 2 + 2
  ctx.textBaseline = 'middle'
  let leftX = pad
  if (logo && logo.naturalWidth && logo.naturalHeight) {
    const lh = 36
    const lw = lh * (logo.naturalWidth / logo.naturalHeight)
    ctx.drawImage(logo, pad, cy - lh / 2, lw, lh)
    leftX = pad + lw + 18
  } else {
    ctx.font = `600 28px ${SANS}`
    ctx.fillStyle = fg
    ctx.fillText(WORDMARK, pad, cy)
    leftX = pad + ctx.measureText(WORDMARK).width + 18
  }
  if (caption) {
    ctx.font = `400 24px ${SANS}`
    ctx.fillStyle = muted
    ctx.fillText(caption, leftX, cy)
  }
  ctx.font = `500 24px ${SANS}`
  ctx.fillStyle = accent
  ctx.fillText(PRODUCT_URL, W - ctx.measureText(PRODUCT_URL).width - pad, cy)
  return c.toDataURL('image/png')
}
