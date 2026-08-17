/**
 * NVS Pro dialog — the modal the Pro badge opens.
 *
 * There is no paid offer yet, so the non-Pro state is deliberately a "coming soon + show your support by sharing"
 * page, not a pricing table. Writing / analysis / files are free forever; Pro will only ever add optional niceties
 * (today: the prettier chart-export theme). The email-activation path stays behind a small "already have a license"
 * link so it works the day an offer exists, without cluttering the coming-soon hero.
 *
 * How Pro is recognized: email (Autumn keys customers by email) → window.nvs.verifyPro → cached locally. Cosmetic
 * unlock, so email is enough. See ProBadge for the header trigger.
 */
import { type JSX, useEffect, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Sparkles, Check, Share2, Copy, Github, MessagesSquare, Heart } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { apps, qedConfig } from '@/config/siteConfig'
import type { Entitlement } from '@shared/ipc'

const NVS_URL = apps.find((a) => a.slug === 'nvs')?.url ?? 'https://www.getqed.app/nvs'
const openUrl = (url: string): void => void window.nvs.openUrl(url)

export function ProDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { t } = useTranslation('pro')
  const pro = useWorkspace((s) => s.pro)
  const refreshPro = useWorkspace((s) => s.refreshPro)
  const setProDev = useWorkspace((s) => s.setProDev)
  const [ent, setEnt] = useState<Entitlement | null>(null)
  const [copied, setCopied] = useState(false)
  const [showActivate, setShowActivate] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (open) void window.nvs.getEntitlement().then(setEnt)
    else {
      setShowActivate(false)
      setMsg(null)
      setCopied(false)
    }
  }, [open])

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(NVS_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — the share buttons still work */
    }
  }

  const shareX = (): void =>
    openUrl(`https://x.com/intent/tweet?text=${encodeURIComponent(t('shareText'))}&url=${encodeURIComponent(NVS_URL)}`)

  const activate = async (): Promise<void> => {
    if (!email.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const e = await window.nvs.verifyPro(email.trim())
      setEnt(e)
      await refreshPro()
      setMsg(e.pro ? t('msg.activated') : t('msg.noPurchase'))
    } catch {
      setMsg(t('msg.verifyError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('title')} size="panel" accent="#f59e0b" region="proDialog">
      <div className="space-y-5">
        {pro ? (
          // ── Pro active ───────────────────────────────────────────────────────
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
              <Check className="size-6" />
            </div>
            <div className="type-card-title text-foreground">{t('active.heading')}</div>
            {ent?.email && (
              <div className="type-caption text-muted-foreground">
                <Trans t={t} i18nKey="active.tiedTo" values={{ email: ent.email }} components={{ email: <span className="text-foreground" /> }} />
              </div>
            )}
            <p className="type-caption max-w-xs text-faint">{t('active.body')}</p>
          </div>
        ) : (
          // ── Coming soon + share ──────────────────────────────────────────────
          <>
            <div className="flex flex-col items-center gap-2 py-1 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
                <Sparkles className="size-6" />
              </div>
              <div className="type-card-title text-foreground">{t('comingSoon.heading')}</div>
              <p className="type-body-sm max-w-sm text-muted-foreground">{t('comingSoon.body')}</p>
            </div>

            <div className="rounded-lg border border-border bg-panel-soft/40 p-4">
              <div className="mb-3 flex items-center justify-center gap-1.5 text-center">
                <Heart className="size-3.5 text-amber-500" />
                <span className="type-label text-foreground">{t('share.prompt')}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={shareX}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md bg-amber-500 px-3 py-2 type-body-sm font-medium text-white transition-colors hover:bg-amber-500/90"
                >
                  <Share2 className="size-3.5" /> {t('share.shareX')}
                </button>
                <button
                  onClick={() => void copyLink()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 type-body-sm text-foreground transition-colors hover:bg-panel-soft"
                >
                  {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                  {copied ? t('share.copied') : t('share.copyLink')}
                </button>
              </div>
              <div className="mt-3 flex items-center justify-center gap-4">
                <button onClick={() => openUrl(qedConfig.links.github)} className="flex items-center gap-1.5 type-caption text-muted-foreground hover:text-foreground">
                  <Github className="size-3.5" /> {t('share.starGithub')}
                </button>
                <button onClick={() => openUrl(qedConfig.links.discord)} className="flex items-center gap-1.5 type-caption text-muted-foreground hover:text-foreground">
                  <MessagesSquare className="size-3.5" /> {t('share.joinDiscord')}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Activation — quiet by default; the offer doesn't exist yet, but purchasers (and dev) can still unlock. */}
        {!pro && (
          <div className="border-t border-border pt-3 text-center">
            {showActivate ? (
              <div className="mx-auto max-w-xs space-y-1.5">
                <div className="type-caption text-faint">{t('activate.prompt')}</div>
                <div className="flex gap-1.5">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void activate()}
                    placeholder={t('activate.emailPlaceholder')}
                    className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 py-1 type-body-sm outline-none focus:border-thread"
                  />
                  <button
                    disabled={busy || !email.trim()}
                    onClick={() => void activate()}
                    className="rounded-md bg-panel-soft px-2.5 type-body-sm hover:bg-border disabled:opacity-40"
                  >
                    {busy ? '…' : t('activate.button')}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowActivate(true)} className="type-caption text-faint hover:text-muted-foreground">
                {t('activate.haveLicense')}
              </button>
            )}
            {msg && <div className="mt-2 type-caption text-muted-foreground">{msg}</div>}
          </div>
        )}

        {import.meta.env.DEV && (
          <button
            onClick={() => void setProDev(!pro)}
            className={cn('block w-full text-center type-micro text-faint hover:text-muted-foreground')}
          >
            {t('devToggle')}
          </button>
        )}
      </div>
    </Dialog>
  )
}
