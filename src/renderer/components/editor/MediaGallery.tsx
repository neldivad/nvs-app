import { useRef, useState, type JSX } from 'react'
import { ImagePlus, Crop, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { DialogZoomCrop } from '@/components/ui/zoom-crop'

/**
 * MediaGallery — the ONE image-list editor (PropertyDialog media row, and any
 * future gallery surface): add via picker or drag-drop, drag-sort the order,
 * remove, and crop any image into the identity slot.
 *
 * The two reliability fixes this consolidates, so they never regress per-dialog:
 *
 *  - DROP: dragenter/dragleave are counted (depth), not toggled. The naive
 *    onDragLeave fires every time the cursor crosses a CHILD tile, which both
 *    flickered the outline and, on some crossings, dropped the copy effect
 *    entirely — the "unreliable" drop. File drags are also distinguished from
 *    the gallery's own sort drags by dataTransfer type, so sorting never
 *    triggers the import path.
 *  - SORT: tiles are native drag sources carrying their index under a custom
 *    type; dropping on a tile moves the dragged image before it. Order is
 *    meaning here: images[0] is the avatar/cover, so sorting IS choosing the
 *    identity image.
 *
 * The crop action opens DialogZoomCrop and saves the result as a NEW asset via
 * importImageBytes, inserted at index 0 (identity). The source image stays in
 * the gallery untouched.
 */

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i
const SORT_MIME = 'application/x-nvs-gallery-index'

export function MediaGallery({
  images,
  pageId,
  kind,
  firstBadge,
  cropTitle,
  cropAspect = 1,
  onCommit
}: {
  images: string[]
  pageId: string
  kind: string
  /** Label burned onto images[0]: "Avatar" / "Cover". */
  firstBadge: string
  /** Title for the zoom-crop dialog, e.g. "Set avatar". */
  cropTitle: string
  /** Crop window aspect (w/h): avatars 1, scene covers wider. */
  cropAspect?: number
  onCommit: (next: string[]) => Promise<void> | void
}): JSX.Element {
  const { t } = useTranslation('editor')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [sortFrom, setSortFrom] = useState<number | null>(null)
  const [sortOver, setSortOver] = useState<number | null>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const depth = useRef(0)

  const isFileDrag = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes('Files')
  const isSortDrag = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes(SORT_MIME)

  async function addFromPicker(): Promise<void> {
    setBusy(true)
    try {
      const added = await window.nvs.importImages(pageId, kind)
      if (added.length) await onCommit([...images, ...added])
    } finally {
      setBusy(false)
    }
  }

  async function addFromDrop(files: FileList): Promise<void> {
    const paths = Array.from(files)
      .filter((f) => IMAGE_EXT.test(f.name))
      .map((f) => window.nvs.getPathForFile(f))
      .filter(Boolean)
    if (!paths.length) return
    setBusy(true)
    try {
      const added = await window.nvs.importImagePaths(pageId, kind, paths)
      if (added.length) await onCommit([...images, ...added])
    } finally {
      setBusy(false)
    }
  }

  function reorder(from: number, before: number): void {
    if (from === before || from === before - 1) return
    const next = [...images]
    const [moved] = next.splice(from, 1)
    next.splice(from < before ? before - 1 : before, 0, moved)
    void onCommit(next)
  }

  async function applyCrop(bytes: ArrayBuffer): Promise<void> {
    setBusy(true)
    try {
      const rel = await window.nvs.importImageBytes(pageId, kind, 'crop', bytes)
      if (rel) await onCommit([rel, ...images])
      setCropSrc(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      // Depth-counted file-drop zone over the WHOLE gallery block. Sort drags
      // (our own tiles) are excluded by mime type at every handler.
      onDragEnter={(e) => {
        if (!isFileDrag(e) || isSortDrag(e)) return
        e.preventDefault()
        depth.current += 1
        setDragOver(true)
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e) || isSortDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e) || isSortDrag(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragOver(false)
      }}
      onDrop={(e) => {
        if (isSortDrag(e)) return
        e.preventDefault()
        depth.current = 0
        setDragOver(false)
        void addFromDrop(e.dataTransfer.files)
      }}
      className={cn(
        'rounded-md',
        dragOver && 'outline-2 outline-offset-2 outline-primary'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {images.map((rel, i) => (
          <span
            key={rel}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(SORT_MIME, String(i))
              e.dataTransfer.effectAllowed = 'move'
              setSortFrom(i)
            }}
            onDragEnd={() => {
              setSortFrom(null)
              setSortOver(null)
            }}
            onDragOver={(e) => {
              if (!isSortDrag(e)) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'move'
              setSortOver(i)
            }}
            onDragLeave={() => setSortOver((v) => (v === i ? null : v))}
            onDrop={(e) => {
              if (!isSortDrag(e)) return
              e.preventDefault()
              e.stopPropagation()
              const from = Number(e.dataTransfer.getData(SORT_MIME))
              setSortFrom(null)
              setSortOver(null)
              if (Number.isFinite(from)) reorder(from, i)
            }}
            className={cn(
              'group relative size-14 cursor-grab overflow-hidden rounded-md border border-border bg-panel-soft active:cursor-grabbing',
              sortOver === i && sortFrom !== i && 'ring-2 ring-primary',
              sortFrom === i && 'opacity-50'
            )}
          >
            <img
              src={`nvs-asset://${rel}`}
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
            />
            {i === 0 && (
              <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[8px] font-medium uppercase tracking-wide text-white">
                {firstBadge}
              </span>
            )}
            <span className="absolute right-0.5 top-0.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                title={cropTitle}
                onClick={() => setCropSrc(rel)}
                className="rounded bg-black/55 p-0.5 text-white"
              >
                <Crop className="size-3" />
              </button>
              <button
                title={t('property.remove')}
                onClick={() => void onCommit(images.filter((x) => x !== rel))}
                className="rounded bg-black/55 p-0.5 text-white"
              >
                <X className="size-3" />
              </button>
            </span>
          </span>
        ))}
        <button
          disabled={busy}
          onClick={() => void addFromPicker()}
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-faint transition-colors hover:bg-panel-soft hover:text-foreground',
            busy && 'opacity-50'
          )}
          title={t('property.addImages')}
        >
          <ImagePlus className="size-5" />
        </button>
      </div>

      {cropSrc && (
        <DialogZoomCrop
          open
          src={`nvs-asset://${cropSrc}`}
          aspect={cropAspect}
          title={cropTitle}
          busy={busy}
          onCancel={() => setCropSrc(null)}
          onApply={(bytes) => void applyCrop(bytes)}
        />
      )}
    </div>
  )
}
