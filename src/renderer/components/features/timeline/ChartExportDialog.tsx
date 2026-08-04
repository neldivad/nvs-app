/**
 * Chart export dialog — the "photo mode": exporting the timeline/cells graph opens this instead of saving
 * immediately. A live preview + toggles (like a videogame screenshot screen):
 *   • Pro frame  — the PRETTIER THEME (gradient matte + inset shadow), the thing Pro actually buys.  [Pro]
 *   • Pro badge  — a small "NVS PRO" pill in the footer.                                             [Pro]
 *   • Byline     — "TITLE — by AUTHOR" from .nvs/project.json (set in Project Structure).           [free]
 *
 * The theme is COMPOSITED onto the raw PNG here (canvas post-process) — the chart render itself is untouched,
 * so this works for any image export that hands us a dataUrl. PDF/manuscript exports stay plain by design.
 */
import { type JSX, useEffect, useState } from 'react'
import { useWorkspace } from '@/stores/workspace'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Sparkles, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ShotOpts {
  frame: boolean
  badge: boolean
  byline: string | null
}

async function composite(base: string, opts: ShotOpts): Promise<string> {
  if (!opts.frame && !opts.badge && !opts.byline) return base // nothing to add → the raw export
  const img = new Image()
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('bad image'))
    img.src = base
  })
  const w0 = img.width
  const pad = opts.frame ? Math.round(w0 * 0.03) : 0
  const footer = opts.badge || opts.byline ? Math.round(w0 * 0.045) : 0
  const w = w0 + pad * 2
  const h = img.height + pad * 2 + footer
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return base

  // matte: Pro frame = a deep vertical gradient; plain = the export's own dark
  if (opts.frame) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#14141c')
    g.addColorStop(1, '#0a0a10')
    ctx.fillStyle = g
  } else {
    ctx.fillStyle = '#0b0b0b'
  }
  ctx.fillRect(0, 0, w, h)

  if (opts.frame) {
    // inset shadow + softly rounded chart
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = Math.round(w0 * 0.015)
    const r = Math.round(w0 * 0.008)
    ctx.beginPath()
    ctx.roundRect(pad, pad, img.width, img.height, r)
    ctx.clip()
    ctx.drawImage(img, pad, pad)
    ctx.restore()
  } else {
    ctx.drawImage(img, pad, pad)
  }

  if (footer) {
    const y = h - footer / 2
    const edge = Math.max(pad, Math.round(w0 * 0.018))
    const fs = Math.max(20, Math.round(w0 * 0.014))
    ctx.textBaseline = 'middle'
    if (opts.byline) {
      ctx.fillStyle = 'rgba(255,255,255,0.82)'
      ctx.font = `600 ${fs}px system-ui, sans-serif`
      ctx.fillText(opts.byline, edge, y, w - edge * 2 - (opts.badge ? fs * 8 : 0))
    }
    if (opts.badge) {
      const label = 'NVS PRO'
      ctx.font = `700 ${Math.round(fs * 0.9)}px system-ui, sans-serif`
      const tw = ctx.measureText(label).width
      const bx = w - edge - tw - fs
      ctx.fillStyle = 'rgba(245,158,11,0.16)'
      ctx.beginPath()
      ctx.roundRect(bx - fs * 0.5, y - fs * 0.85, tw + fs, fs * 1.7, fs * 0.4)
      ctx.fill()
      ctx.fillStyle = '#f59e0b'
      ctx.fillText(label, bx, y)
    }
  }
  return c.toDataURL('image/png')
}

function Toggle({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string }): JSX.Element {
  return (
    <label className={cn('flex items-center gap-1.5 text-[12px]', disabled ? 'cursor-not-allowed text-faint' : 'cursor-pointer text-muted-foreground hover:text-foreground')} title={hint}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-amber-500" />
      {label}
    </label>
  )
}

export function ChartExportDialog({ dataUrl, name, onClose }: { dataUrl: string | null; name: string; onClose: () => void }): JSX.Element {
  const pro = useWorkspace((s) => s.pro)
  const info = useWorkspace((s) => s.projectInfo)
  const saveImage = useWorkspace((s) => s.saveImage)
  const [frame, setFrame] = useState(true)
  const [badge, setBadge] = useState(true)
  const [withByline, setWithByline] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const title = info?.title?.trim() ?? ''
  const author = info?.author?.trim() ?? ''
  const bylineText = [title, author ? `by ${author}` : ''].filter(Boolean).join(' — ') || null

  useEffect(() => {
    if (!dataUrl) return
    let alive = true
    setPreview(null)
    void composite(dataUrl, {
      frame: pro && frame,
      badge: pro && badge,
      byline: withByline ? bylineText : null
    })
      .then((d) => alive && setPreview(d))
      .catch(() => alive && setPreview(dataUrl))
    return () => {
      alive = false
    }
  }, [dataUrl, pro, frame, badge, withByline, bylineText])

  const save = async (): Promise<void> => {
    if (!preview) return
    setSaving(true)
    try {
      await saveImage(name, preview)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={!!dataUrl}
      onClose={onClose}
      title="Export chart"
      size="detail"
      bodyClassName="flex min-h-0 flex-col gap-3 p-4"
      footer={
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!preview || saving} onClick={() => void save()}>
            <Download className="mr-1 size-3.5" /> {saving ? 'Saving…' : 'Save PNG'}
          </Button>
        </DialogFooter>
      }
    >
      <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-md border border-border bg-canvas p-2">
        {preview ? (
          <img src={preview} alt="export preview" className="max-h-[52vh] max-w-full rounded-sm object-contain" />
        ) : (
          <div className="p-12 text-xs text-faint">Rendering preview…</div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Toggle checked={frame} onChange={setFrame} disabled={!pro} label="Pro frame" hint={pro ? 'The premium matte + frame' : 'NVS Pro — the prettier export theme'} />
        <Toggle checked={badge} onChange={setBadge} disabled={!pro} label="NVS Pro badge" hint={pro ? 'Show the Pro mark in the footer' : 'NVS Pro'} />
        <Toggle checked={withByline} onChange={setWithByline} disabled={!bylineText} label="Author byline" hint={bylineText ? `“${bylineText}”` : 'Set the title/author in Project Structure (⌘,)'} />
        {!pro && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-faint">
            <Sparkles className="size-3 text-amber-500/70" /> Pro unlocks the frame & badge — see the header chip
          </span>
        )}
      </div>
    </Dialog>
  )
}
