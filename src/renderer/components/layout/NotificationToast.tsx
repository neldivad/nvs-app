/**
 * The ONE transient toast — flashes app-wide (not bound to the dock), fed by both notification systems:
 *  • a persistent `pushNotification` (agent created a page, analysis rebuilt) → flashes here AND stays in the
 *    bell mailbox for history (NotificationMailbox), and
 *  • an ephemeral `setNotice` (validation feedback like "can't connect a scene to itself") → flashes here only.
 * Replaces the two ad-hoc toasts that used to live inside ConsoleDock + TimelinePanel.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/stores/workspace'

type Flash = { key: string; title: string; body?: string; kind: 'warning' | 'success' | 'info' }
const DUR = 4500

// Fixed park spot — bottom-right, next to the bell mailbox it mirrors. `bottom-9` clears the status bar.
const ANCHOR_POS = 'bottom-9 right-4 justify-end'

export function NotificationToast(): JSX.Element | null {
  const { t } = useTranslation('notifications')
  const notifications = useWorkspace((s) => s.notifications)
  const notice = useWorkspace((s) => s.notice)
  const setNotice = useWorkspace((s) => s.setNotice)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [hovering, setHovering] = useState(false) // pause auto-dismiss while the user is reading / selecting / copying
  const [copied, setCopied] = useState(false)
  const seen = useRef<string | null>(null) // last notification key already flashed (so re-renders don't re-flash)

  // A new persistent notification → flash it (and let it persist in the bell on its own).
  const latest = notifications.length ? notifications.reduce((a, b) => (b.ts > a.ts ? b : a)) : null
  useEffect(() => {
    if (!latest) return
    const key = `${latest.id}:${latest.ts}`
    if (seen.current === key) return
    seen.current = key
    setFlash({ key, title: latest.title, body: latest.body, kind: latest.kind })
  }, [latest])

  // An ephemeral notice → flash it, then clear the store field.
  useEffect(() => {
    if (!notice) return
    setFlash({ key: `notice:${notice}`, title: notice, kind: 'info' })
  }, [notice])

  // Auto-dismiss whatever is currently showing — but NOT while hovered (so it can't vanish mid-read/copy); leaving
  // re-arms a full DUR. Clearing a notice also resets its store field. `copied` resets when a new flash arrives.
  useEffect(() => setCopied(false), [flash])
  useEffect(() => {
    if (!flash || hovering) return
    const t = setTimeout(() => {
      setFlash(null)
      if (flash.key.startsWith('notice:')) setNotice(null)
    }, DUR)
    return () => clearTimeout(t)
  }, [flash, hovering, setNotice])

  if (!flash) return null
  const accent =
    flash.kind === 'warning' ? 'border-l-flag' : flash.kind === 'success' ? 'border-l-ok' : 'border-l-thread'
  const dismiss = (): void => {
    setFlash(null)
    if (flash.key.startsWith('notice:')) setNotice(null)
  }
  const copy = (): void => {
    void navigator.clipboard.writeText(flash.body ? `${flash.title}\n${flash.body}` : flash.title)
    setCopied(true)
  }
  return (
    <div className={cn('pointer-events-none fixed z-50 flex px-4', ANCHOR_POS)}>
      {/* gradient-ring border (brighter at top, fading down) = a raised, beveled edge — not a flat box. No longer a
          button: the body is selectable text; dismiss/copy are explicit controls so a click can't eat a selection. */}
      <div
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="group pointer-events-auto max-w-md rounded-lg bg-linear-to-b from-foreground/25 to-foreground/5 p-px shadow-xl shadow-black/40"
      >
        <div className={cn('relative rounded-[7px] border-l-2 bg-panel py-2 pr-12 pl-3 text-left', accent)}>
          <div className="cursor-text select-text text-[12px] font-medium text-foreground">{flash.title}</div>
          {flash.body && <div className="mt-0.5 cursor-text select-text text-[11px] leading-snug text-muted-foreground">{flash.body}</div>}
          {/* copy + dismiss — appear on hover (the toast is small); copy flips to a check for feedback */}
          <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button onClick={copy} title={copied ? t('copied') : t('copy')} aria-label={t('copyAria')} className="rounded p-1 text-muted-foreground hover:bg-panel-soft hover:text-foreground">
              {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
            </button>
            <button onClick={dismiss} title={t('dismiss')} aria-label={t('dismissAria')} className="rounded p-1 text-muted-foreground hover:bg-panel-soft hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
