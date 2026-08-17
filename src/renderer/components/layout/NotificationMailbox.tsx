/**
 * The notification mailbox — a bell in the status bar (bottom-right) that opens a stack of cards.
 *
 * Two sources, one surface (internal/ingest-model.md → the UX layer):
 *  • the live "catch-up" nudge, derived from analysis freshness (auto-clears when up to date), and
 *  • persistent events from the store (warnings / run results — the ingest runner pushes these in Phase 2).
 * It's the ambient half of the freshness story: the rail badge nags in-context, this nags globally, so a
 * busy author never silently drifts out of date and never gets a black box working unseen.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Bell, Check, CheckCircle2, Copy, Info, RefreshCw, X } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { freshnessCounts, needsAttention, outdatedCount } from '@shared/config/ingest'
import { useFreshness } from '@/components/ui/FreshnessBadge'
import { useAiEnabled } from '@/config/aiFeatures'
import { cn } from '@/lib/utils'

export function NotificationMailbox(): JSX.Element | null {
  const { t } = useTranslation('notifications')
  const project = useWorkspace((s) => s.project)
  const aiEnabled = useAiEnabled() // the freshness nudge is analysis-derived → drop it (only it) when AI is off
  const rows = useFreshness()
  const items = useWorkspace((s) => s.notifications)
  const dismiss = useWorkspace((s) => s.dismissNotification)
  const markRead = useWorkspace((s) => s.markNotificationsRead)
  const clearAll = useWorkspace((s) => s.clearNotifications)
  const openDockTab = useWorkspace((s) => s.openDockTab)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const counts = freshnessCounts(rows)
  const nudge = aiEnabled && needsAttention(counts) // the derived freshness card — AI-only (analysis must be runnable)
  const unread = (nudge ? 1 : 0) + items.filter((i) => !i.read).length

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  if (!project) return null

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next) markRead() // opening clears the unread state on stored items (kept OUT of the setState updater)
  }

  const empty = !nudge && items.length === 0

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={toggle}
        title={t('title')}
        className={cn('flex items-center gap-1 rounded px-1.5 transition-colors hover:bg-panel-soft', open && 'bg-panel-soft text-foreground')}
      >
        <Bell className="size-3" />
        {unread > 0 && (
          <span className="min-w-3 rounded-full bg-warn px-1 text-center text-[8px] font-semibold leading-[1.4] text-black">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1.5 w-80 overflow-hidden rounded-lg border border-border bg-panel shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px]">
            <span className="font-medium text-foreground/90">{t('title')}</span>
            <div className="ml-auto flex items-center gap-2">
              {items.length > 0 && (
                <button onClick={clearAll} className="text-[10px] text-muted-foreground hover:text-flag">{t('clearAll')}</button>
              )}
            </div>
          </div>

          <div className="max-h-72 overflow-auto">
            {empty ? (
              <p className="p-4 text-center text-[11px] text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {nudge && (
                  <Card
                    icon={<AlertTriangle className="size-3.5 text-warn" />}
                    title={t('outdated', { count: outdatedCount(counts) })}
                    body={t('outdatedBody')}
                    action={{ label: t('openAnalysis'), onClick: () => { setOpen(false); openDockTab('ingest') } }}
                  />
                )}
                {items.map((n) => (
                  <Card
                    key={n.id}
                    icon={n.kind === 'warning' ? <AlertTriangle className="size-3.5 text-flag" /> : n.kind === 'success' ? <CheckCircle2 className="size-3.5 text-ok" /> : <Info className="size-3.5 text-muted-foreground" />}
                    title={n.title}
                    body={n.body}
                    action={n.href ? { label: n.actionLabel ?? t('open'), onClick: () => void window.nvs.openUrl?.(n.href!) } : undefined}
                    onDismiss={() => dismiss(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ icon, title, body, action, onDismiss }: {
  icon: React.ReactNode
  title: string
  body?: string
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void
}): JSX.Element {
  const { t } = useTranslation('notifications')
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1200); return () => clearTimeout(timer) }, [copied])
  const copy = (): void => { void navigator.clipboard.writeText(body ? `${title}\n${body}` : title); setCopied(true) }
  return (
    <li className="group flex items-start gap-2 px-3 py-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        {/* selectable so the message (a file path, an export error) can be highlighted; copy button mirrors the toast */}
        <p className="cursor-text text-[11px] font-medium text-foreground/90 select-text">{title}</p>
        {body && <p className="mt-0.5 cursor-text text-[10px] leading-snug text-muted-foreground select-text">{body}</p>}
        {action && (
          <button onClick={action.onClick} className="mt-1 flex items-center gap-1 rounded border border-thread/50 bg-thread/10 px-1.5 py-0.5 text-[10px] text-foreground hover:bg-thread/20">
            <RefreshCw className="size-2.5" /> {action.label}
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button onClick={copy} title={copied ? t('copied') : t('copy')} aria-label={t('copyAria')} className="rounded p-0.5 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-panel-soft hover:text-foreground focus-visible:opacity-100">
          {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
        </button>
        {onDismiss && (
          <button onClick={onDismiss} title={t('dismiss')} aria-label={t('dismissAria')} className="rounded p-0.5 text-faint hover:bg-panel-soft hover:text-foreground"><X className="size-3" /></button>
        )}
      </div>
    </li>
  )
}
