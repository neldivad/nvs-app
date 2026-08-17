/**
 * Full-screen image viewer — zoom (wheel / buttons), focal-point pan (cursor sets the
 * transform-origin while zoomed), and prev/next across a set. Modeled on getimageprompts-m2's
 * image-detail viewer. Used by galleries + read dialogs to inspect a cover/asset at full size.
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next'
import { X, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const MIN = 1
const MAX = 5

export function ImageLightbox({
  images,
  start = 0,
  onClose
}: {
  images: string[] // relative asset paths
  start?: number
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation('imageLightbox')
  const [i, setI] = useState(start)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const n = images.length
  const step = (d: number): void => {
    setI((p) => (p + d + n) % n)
    setZoom(1)
    setPos(null)
  }
  const clampZoom = (z: number): number => Math.min(MAX, Math.max(MIN, z))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && n > 1) step(1)
      else if (e.key === 'ArrowLeft' && n > 1) step(-1)
      else if (e.key === '+' || e.key === '=') setZoom((z) => clampZoom(z + 0.5))
      else if (e.key === '-') setZoom((z) => clampZoom(z - 0.5))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, n])

  const ctrl = 'flex size-8 items-center justify-center rounded-full bg-black/50 text-white/90 transition-colors hover:bg-black/70'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85" onClick={onClose}>
      <button onClick={onClose} className={cn(ctrl, 'absolute right-4 top-4')} title={t('close')}>
        <X className="size-4" />
      </button>

      {n > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); step(-1) }} className={cn(ctrl, 'absolute left-4')} title={t('previous')}>
            <ChevronLeft className="size-5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); step(1) }} className={cn(ctrl, 'absolute right-4 top-1/2')} title={t('next')}>
            <ChevronRight className="size-5" />
          </button>
        </>
      )}

      <div
        className="flex max-h-[90vh] max-w-[90vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => setZoom((z) => clampZoom(z - Math.sign(e.deltaY) * 0.3))}
        onMouseMove={(e) => {
          if (zoom <= 1) return
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
        }}
        onMouseLeave={() => setPos(null)}
      >
        <img
          src={`nvs-asset://${images[i]}`}
          alt=""
          draggable={false}
          className={cn('max-h-[90vh] max-w-[90vw] object-contain transition-transform', zoom > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in')}
          style={{ transform: `scale(${zoom})`, transformOrigin: pos ? `${pos.x}% ${pos.y}%` : 'center' }}
          onClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
        />
      </div>

      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setZoom((z) => clampZoom(z - 0.5))} className={ctrl} title={t('zoomOut')}>
          <ZoomOut className="size-4" />
        </button>
        <span className="min-w-12 text-center font-mono text-xs text-white/80">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => clampZoom(z + 0.5))} className={ctrl} title={t('zoomIn')}>
          <ZoomIn className="size-4" />
        </button>
        <button onClick={() => { setZoom(1); setPos(null) }} className={ctrl} title={t('reset')}>
          <RotateCcw className="size-4" />
        </button>
        {n > 1 && <span className="ml-2 font-mono text-xs text-white/60">{i + 1} / {n}</span>}
      </div>
    </div>
  )
}
