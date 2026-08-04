/**
 * PrintPreviewDialog — a scrollable "paper preview" of the current page, then native print / Save-as-PDF.
 *
 * The trick: render the SAME preview components (ScenePreview / WikiPreview) into an ISOLATED iframe. The
 * iframe is its own document with no `.dark` ancestor, so the app's stylesheet (cloned in) resolves to the
 * manuscript-LIGHT palette automatically — the print looks like the app's light preview on white paper,
 * without touching the app's own dark UI. Print uses Chromium's built-in flow (`iframe.print()` → the OS
 * "Save as PDF"/printer dialog) — no extra package, no DOM-print CSS hacks on the app.
 *
 * Available from any view mode (write · preview · source) — it reads the page from the store, not the DOM.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { Printer, Sun, Moon } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ScenePreview, WikiPreview } from '@/components/editor/PreviewPane'

/**
 * Rules layered on top of the cloned app CSS. `print-color-adjust: exact` makes the chosen theme's colors +
 * backgrounds print faithfully (WYSIWYG) — so the saved PDF matches the on-screen preview in whichever theme
 * the toggle picks. The paper theme itself is set by the iframe's `.dark` class (see the effect below).
 */
const PRINT_CSS = `
  html, body { margin: 0; background: var(--canvas); }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* the preview root is a flex/scroll container on screen; let it flow so the iframe scrolls the whole page */
  body > * { height: auto !important; overflow: visible !important; }
  @media print {
    h1, h2, h3, h4 { break-after: avoid; }
    p, li, tr, blockquote, img, table { break-inside: avoid; }
    @page { margin: 16mm; }
  }
`

export function PrintPreviewDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const page = useWorkspace((s) => s.activePage)
  const frontmatter = useWorkspace((s) => s.frontmatter)
  const body = useWorkspace((s) => s.body)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [mount, setMount] = useState<HTMLElement | null>(null)
  // Paper theme — Light (manuscript, ink-friendly) by default; Dark matches the app's focus theme 1:1.
  const [dark, setDark] = useState(false)

  // On iframe load: copy the app's stylesheets so Tailwind classes render, add the print rules, expose the
  // iframe body as the portal target. Theme is applied by the effect below (so the toggle re-themes live).
  const onLoad = (): void => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    doc.head.querySelectorAll('style,link[rel="stylesheet"]').forEach((n) => n.remove())
    document.head.querySelectorAll('style,link[rel="stylesheet"]').forEach((n) => doc.head.appendChild(n.cloneNode(true)))
    const style = doc.createElement('style')
    style.textContent = PRINT_CSS
    doc.head.appendChild(style)
    setMount(doc.body)
  }

  // Re-theme the iframe (preview AND the PDF it prints) whenever the toggle flips. Dark mirrors the app's
  // root class; Light strips `dark` so the cloned CSS resolves to the manuscript palette.
  useEffect(() => {
    if (!mount) return
    const appClass = document.documentElement.className
    mount.ownerDocument.documentElement.className = dark ? appClass : appClass.replace(/\bdark\b/g, '').trim()
  }, [dark, mount])

  if (!open || !page) return null
  const isScene = page.kind === 'scene'
  return (
    <Dialog
      region="printPreviewDialog"
      open={open}
      onClose={onClose}
      title={`Print — ${page.title}`}
      size="workspace"
      bodyClassName="flex flex-col p-0"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">Preview — scroll to review; the PDF matches this theme</span>
        {/* Paper theme toggle — Light (paper) / Dark (app). WYSIWYG: the PDF prints whichever is shown. */}
        <div className="ml-auto flex overflow-hidden rounded-md border border-border text-[11px]">
          {([['light', Sun, !dark], ['dark', Moon, dark]] as const).map(([label, Icon, on]) => (
            <button
              key={label}
              onClick={() => setDark(label === 'dark')}
              className={cn('flex items-center gap-1 px-2 py-1 capitalize transition-colors', on ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft')}
            >
              <Icon className="size-3" /> {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => iframeRef.current?.contentWindow?.print()}
          className="flex items-center gap-1.5 rounded-md bg-thread px-2.5 py-1 text-[12px] text-thread-foreground transition-opacity hover:opacity-90"
        >
          <Printer className="size-3.5" /> Print / Save as PDF
        </button>
      </div>
      {/* srcDoc gives a clean, same-origin document whose onLoad fires reliably. */}
      <iframe
        ref={iframeRef}
        onLoad={onLoad}
        srcDoc="<!doctype html><html><head></head><body></body></html>"
        title="Print preview"
        className="min-h-0 w-full flex-1 bg-white"
      />
      {mount &&
        createPortal(
          isScene ? <ScenePreview frontmatter={frontmatter} body={body} /> : <WikiPreview frontmatter={frontmatter} body={body} kind={page.kind} />,
          mount
        )}
    </Dialog>
  )
}
