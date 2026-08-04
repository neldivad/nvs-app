/**
 * The standard "quick-read" modal for any page — a scene OR a world page. Centered, renders
 * the cover + the page's rendered content (ScenePreview for scenes, WikiPreview for world),
 * with Open-in-editor and an optional extra footer action. One base used by the Timeline
 * (scene read), the Cast matrix (scene column + character row), and anywhere else a page
 * needs reading in place.
 */
import { useEffect, useState, type ReactNode, type JSX } from 'react';
import { ExternalLink, X } from 'lucide-react'
import { regionAttrs } from '@/config/regions'
import { useWorkspace } from '@/stores/workspace'
import { useModalEscape } from '@/lib/editor/escapeStack'
import { Button } from '@/components/ui/button'
import { ScenePreview, WikiPreview } from '@/components/editor/PreviewPane'
import { ImageLightbox } from '@/components/ui/ImageLightbox'
import { defaultPhase, PHASE_META } from '@/config/worldSchema'
import { cn } from '@/lib/utils'
import type { PageRef, SceneDoc } from '@shared/ipc'

function imagesOf(fm: Record<string, unknown>): string[] {
  if (Array.isArray(fm.images)) return fm.images.map(String)
  return fm.avatar ? [String(fm.avatar)] : []
}

export function PageReadDialog({
  path,
  kind,
  title,
  missing,
  footer,
  onClose
}: {
  path?: string
  kind: PageRef['kind']
  title: string
  missing?: boolean // the referenced page no longer exists
  footer?: ReactNode // extra footer action (e.g. the timeline's Remove)
  onClose: () => void
}): JSX.Element {
  const openPage = useWorkspace((s) => s.openPage)
  const setWorkspace = useWorkspace((s) => s.setWorkspace)
  const [doc, setDoc] = useState<SceneDoc | null>(null)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    if (!path || missing) {
      setDoc(null)
      return
    }
    let live = true
    void window.nvs
      .readScene(path)
      .then((d) => live && setDoc(d))
      .catch(() => live && setDoc(null))
    return () => {
      live = false
    }
  }, [path, missing])

  useModalEscape(true, onClose) // stack-aware: Esc closes this preview first, the dialog under it stays

  const fm = doc?.frontmatter ?? {}
  const imgs = imagesOf(fm)
  const phase = String(fm.phase ?? defaultPhase(kind))
  const meta = phase !== 'canon' ? PHASE_META[phase] : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div {...regionAttrs('pageReadDialog')} className="relative z-10 flex h-[80vh] w-[75vw] max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {meta && <span title={meta.label} className={cn('size-2 shrink-0 rounded-full', meta.dot)} />}
            <span className="truncate text-sm font-medium text-foreground">{title}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground transition-colors hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {missing || !path ? (
            <p className="p-6 text-sm text-flag">This page no longer exists.</p>
          ) : !doc ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              {/* Scenes have no in-body gallery, so show a vignette cover banner here (click → full
                  view). World pages render their own gallery inside WikiPreview, so skip it. */}
              {kind === 'scene' && imgs.length > 0 && (
                <button onClick={() => setZoom(true)} title="View full image" className="relative block h-56 w-full cursor-zoom-in bg-panel-soft">
                  <img src={`nvs-asset://${imgs[0]}`} alt="" className="h-full w-full object-cover" draggable={false} />
                  <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-black/15" />
                </button>
              )}
              {kind === 'scene' ? (
                <ScenePreview frontmatter={doc.frontmatter} body={doc.body} />
              ) : (
                <WikiPreview frontmatter={doc.frontmatter} body={doc.body} kind={kind} />
              )}
            </>
          )}
        </div>
        {zoom && imgs.length > 0 && <ImageLightbox images={imgs} onClose={() => setZoom(false)} />}

        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          {path && !missing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void openPage({ path, title, kind })
                setWorkspace(kind === 'scene' ? 'editor' : 'world')
                onClose()
              }}
            >
              <ExternalLink className="size-3" />
              Open in editor
            </Button>
          ) : (
            <span />
          )}
          {footer ?? <span />}
        </div>
      </div>
    </div>
  )
}
