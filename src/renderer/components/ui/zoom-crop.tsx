import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * DialogZoomCrop — pan/zoom an image inside a fixed crop window, apply, get bytes.
 *
 * Used wherever an image becomes an IDENTITY crop (a character's avatar, a
 * project cover): the source stays untouched in the gallery and the crop is
 * saved as a new derived asset via importImageBytes.
 *
 * Mechanics worth knowing:
 *  - The image is loaded via fetch -> createImageBitmap(blob). Two traps this
 *    dodges at once: an <img> pointed at nvs-asset:// can taint the export
 *    canvas (toBlob throws), and an <img> pointed at a blob: URL is refused by
 *    the renderer CSP (img-src 'self' data:). Decoding the blob in memory is
 *    neither a protocol draw nor a URL load, so both rules stay untouched.
 *  - Zoom is clamped so the image always COVERS the window (no letterboxing a
 *    crop), and pan is clamped to the same rule after every gesture.
 *  - Export renders at OUT_MIN px on the short edge regardless of the preview
 *    size, so the saved crop is not limited by dialog pixels.
 */
export function DialogZoomCrop({
  open,
  src,
  aspect = 1,
  title,
  busy = false,
  onCancel,
  onApply
}: {
  open: boolean
  /** nvs-asset:// URL (or any fetchable URL) of the source image. */
  src: string
  /** Crop window aspect ratio, width / height. Avatars 1, covers 2/3. */
  aspect?: number
  title: string
  busy?: boolean
  onCancel: () => void
  onApply: (bytes: ArrayBuffer) => void
}): JSX.Element {
  const { t } = useTranslation('editor')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<ImageBitmap | null>(null)
  // view state: scale is ABSOLUTE (canvas px per image px); pan is the image
  // centre's offset from the window centre, in canvas px
  const view = useRef({ scale: 1, minScale: 1, x: 0, y: 0 })
  const [ready, setReady] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [zoomPct, setZoomPct] = useState(0) // 0..1 slider position above minScale

  // crop window in CSS px: fit within a 340x300 box at the requested aspect
  const vw = aspect >= 340 / 300 ? 340 : Math.round(300 * aspect)
  const vh = Math.round(vw / aspect)
  const OUT_MIN = 512 // short-edge pixels of the exported crop

  const clampPan = useCallback(() => {
    const v = view.current
    const img = imgRef.current
    if (!img) return
    const halfW = (img.width * v.scale) / 2
    const halfH = (img.height * v.scale) / 2
    v.x = Math.min(halfW - vw / 2, Math.max(-(halfW - vw / 2), v.x))
    v.y = Math.min(halfH - vh / 2, Math.max(-(halfH - vh / 2), v.y))
  }, [vw, vh])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    // Guard BOTH dimensions. A fresh canvas is 300x150 by default, and a crop
    // window whose CSS width is exactly 300 (the 1:1 avatar at dpr 1) made the
    // width-only check skip initialization entirely -- the buffer stayed 150
    // tall under a 300-tall box, drawing everything squashed and clipped. The
    // 200-wide cover window never collided with the default, which is why only
    // the avatar crop distorted.
    if (canvas.width !== vw * dpr || canvas.height !== vh * dpr) {
      canvas.width = vw * dpr
      canvas.height = vh * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, vw, vh)
    const v = view.current
    const w = img.width * v.scale
    const h = img.height * v.scale
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, vw / 2 + v.x - w / 2, vh / 2 + v.y - h / 2, w, h)
    // rule-of-thirds guides, subtle
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    for (let i = 1; i < 3; i++) {
      ctx.beginPath()
      ctx.moveTo((vw / 3) * i, 0)
      ctx.lineTo((vw / 3) * i, vh)
      ctx.moveTo(0, (vh / 3) * i)
      ctx.lineTo(vw, (vh / 3) * i)
      ctx.stroke()
    }
  }, [vw, vh])

  // load on open; blob URL keeps the canvas untainted (see header comment)
  useEffect(() => {
    if (!open) return
    let alive = true
    setReady(false)
    setLoadFailed(false)
    void fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.blob()
      })
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        if (!alive) {
          bmp.close()
          return
        }
        imgRef.current = bmp
        const v = view.current
        v.minScale = Math.max(vw / bmp.width, vh / bmp.height)
        v.scale = v.minScale
        v.x = 0
        v.y = 0
        setZoomPct(0)
        setReady(true)
        draw()
      })
      .catch(() => {
        setReady(false)
        setLoadFailed(true) // a blank crop window is a mystery; say it failed
      })
    return () => {
      alive = false
      imgRef.current?.close()
      imgRef.current = null
    }
  }, [open, src, vw, vh, draw])

  // pointer pan
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX - view.current.x, y: e.clientY - view.current.y }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return
    view.current.x = e.clientX - dragRef.current.x
    view.current.y = e.clientY - dragRef.current.y
    clampPan()
    draw()
  }
  const onPointerUp = () => {
    dragRef.current = null
  }

  const setZoom = useCallback(
    (pct: number, cx = vw / 2, cy = vh / 2) => {
      const v = view.current
      const next = v.minScale * Math.pow(6, Math.min(1, Math.max(0, pct))) // up to 6x cover-fit
      // zoom about the given canvas point: keep the image point under it fixed
      const k = next / v.scale
      v.x = cx - vw / 2 + (v.x - (cx - vw / 2)) * k
      v.y = cy - vh / 2 + (v.y - (cy - vh / 2)) * k
      v.scale = next
      clampPan()
      setZoomPct(pct)
      draw()
    },
    [vw, vh, clampPan, draw]
  )

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!ready) return // same gate as the slider: no image, no zoom
    const rect = e.currentTarget.getBoundingClientRect()
    setZoom(zoomPct - e.deltaY * 0.0012, e.clientX - rect.left, e.clientY - rect.top)
  }

  async function apply(): Promise<void> {
    const img = imgRef.current
    if (!img) return
    const v = view.current
    const outW = Math.round(aspect >= 1 ? OUT_MIN * aspect : OUT_MIN)
    const outH = Math.round(aspect >= 1 ? OUT_MIN : OUT_MIN / aspect)
    const out = document.createElement('canvas')
    out.width = outW
    out.height = outH
    const ctx = out.getContext('2d')
    if (!ctx) return
    const k = outW / vw // canvas px -> out px
    const w = img.width * v.scale * k
    const h = img.height * v.scale * k
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, outW / 2 + v.x * k - w / 2, outH / 2 + v.y * k - h / 2, w, h)
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
    if (blob) onApply(await blob.arrayBuffer())
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="confirm"
      footer={
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            {t('zoomCrop.cancel')}
          </Button>
          <Button size="sm" onClick={() => void apply()} disabled={!ready || busy}>
            {t('zoomCrop.apply')}
          </Button>
        </DialogFooter>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <canvas
          ref={canvasRef}
          style={{ width: vw, height: vh }}
          className="shrink-0 cursor-grab touch-none rounded-md border border-border bg-panel-soft active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onDoubleClick={() => setZoom(0)}
        />
        <div className="flex w-full items-center gap-2 px-1">
          <span className="text-[10px] text-faint">{t('zoomCrop.zoom')}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(zoomPct * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
            disabled={!ready}
            className="h-1 flex-1 accent-primary"
          />
        </div>
        <p className="text-[10px] text-faint">
          {loadFailed ? t('zoomCrop.loadError') : t('zoomCrop.hint')}
        </p>
      </div>
    </Dialog>
  )
}
