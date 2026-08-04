/**
 * SupportDialog — a mini QED "launcher" (HoYoPlay-style), opened from the header Help menu:
 *   • left rail   — our app portfolio (pick one → it fills the middle)
 *   • middle      — the selected app's promo hero + highlights ("ads / updates")
 *   • right rail  — the creator's socials (links open in the system browser)
 * YouTube has no channel yet, so it shows as a disabled "soon" chip. 75vw × 75vh.
 */
import { useState, type JSX, type ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog } from '@/components/ui/dialog'
import { ExternalLink } from '@/components/ui/ExternalLink'
import { DiscordIcon, XIcon, GithubIcon } from '@/components/ui/BrandIcons'
import { qedConfig, apps, type SocialKey } from '@/config/siteConfig'

// Brand glyphs shared with the Share sheet; tint = each platform's color (X/GitHub inherit foreground).
type Social = { label: string; key?: SocialKey; icon?: ReactNode; tint?: string; disabled?: boolean }
const SOCIALS: Social[] = [
  { key: 'discord', label: 'Discord', icon: <DiscordIcon />, tint: 'text-[#5865F2]' },
  { key: 'twitter', label: 'X / Twitter', icon: <XIcon />, tint: 'text-foreground' },
  { key: 'github', label: 'GitHub', icon: <GithubIcon />, tint: 'text-foreground' },
  { label: 'YouTube', disabled: true } // enable in qedConfig.links, then add `key: 'youtube'` + icon
]

const STATUS: Record<'live' | 'beta' | 'soon', { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'text-ok border-ok/40' },
  beta: { label: 'Beta', cls: 'text-thread border-thread/40' },
  soon: { label: 'Coming soon', cls: 'text-faint border-border' }
}

// A soft, theme-aware promo wash behind the hero (stands in for the game art HoYoPlay uses).
const HERO_BG = 'linear-gradient(135deg, color-mix(in srgb, var(--thread) 20%, transparent), color-mix(in srgb, var(--lore) 12%, transparent) 60%, transparent)'

export function SupportDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const [slug, setSlug] = useState<string>(apps.find((a) => a.current)?.slug ?? apps[0].slug)
  const app = apps.find((a) => a.slug === slug) ?? apps[0]

  return (
    <Dialog
      region="supportDialog"
      open={open}
      onClose={onClose}
      title="Support & community"
      size="workspace"
      className="h-[75vh] w-[75vw] max-w-none"
      bodyClassName="min-h-0 flex-1 overflow-hidden p-0"
    >
      <div className="flex h-full min-h-0">
        {/* LEFT RAIL — app portfolio */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-canvas/40">
          <div className="shrink-0 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Our apps</div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2 pb-2">
            {apps.map((a) => (
              <button
                key={a.slug}
                onClick={() => setSlug(a.slug)}
                className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors', a.slug === slug ? 'bg-panel-soft' : 'hover:bg-panel-soft/60')}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-gradient-to-br from-thread/30 to-lore/20 text-[14px] font-semibold text-foreground">
                  {a.name[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-foreground">{a.name}</span>
                  <span className="block truncate text-[10px] text-faint">{STATUS[a.status].label}</span>
                </span>
                {a.current && <span className="size-1.5 shrink-0 rounded-full bg-ok" title="You're using this" />}
              </button>
            ))}
          </div>
        </aside>

        {/* MIDDLE — selected app's promo hero + highlights */}
        <main className="flex min-w-0 flex-1 flex-col overflow-auto">
          <div className="relative shrink-0 overflow-hidden border-b border-border p-6" style={{ background: HERO_BG }}>
            <span className="pointer-events-none absolute -right-4 -top-12 select-none text-[10rem] font-black leading-none text-foreground/[0.04]">
              {app.name[0]}
            </span>
            <div className="relative">
              <div className="mb-2 flex items-center gap-2">
                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', STATUS[app.status].cls)}>{STATUS[app.status].label}</span>
                {app.current && <span className="text-[10px] font-medium uppercase tracking-wide text-ok">● You're using this</span>}
              </div>
              <h3 className="text-lg font-semibold text-foreground">{app.name}</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{app.tagline}</p>
              <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-muted-foreground">{app.description}</p>
              <ExternalLink
                href={app.url}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-thread px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-thread/90"
              >
                {app.current ? 'Product page' : app.status === 'soon' ? 'Follow for launch' : 'Open'} <ArrowUpRight className="size-3.5" />
              </ExternalLink>
            </div>
          </div>

          <div className="min-h-0 flex-1 p-6">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-faint">{app.status === 'soon' ? 'Status' : 'Highlights'}</div>
            {app.highlights.length > 0 ? (
              <ul className="space-y-2.5">
                {app.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-muted-foreground">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-thread/70" />
                    {h}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted-foreground">In development — follow the socials for launch news.</p>
            )}
          </div>
        </main>

        {/* RIGHT RAIL — socials */}
        <aside className="flex w-44 shrink-0 flex-col border-l border-border bg-canvas/40">
          <div className="shrink-0 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Community</div>
          <div className="flex flex-col gap-1.5 px-2">
            {SOCIALS.map((s) =>
              s.disabled || !s.key ? (
                <span
                  key={s.label}
                  title="Coming soon"
                  className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-[12px] text-faint opacity-60"
                >
                  <span className="grid size-4 shrink-0 place-items-center [&_svg]:size-4">{s.icon}</span>
                  <span className="flex-1">{s.label}</span>
                  <span className="text-[9px] uppercase tracking-wide">soon</span>
                </span>
              ) : (
                <ExternalLink
                  key={s.label}
                  href={qedConfig.links[s.key]}
                  className="group/social flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-thread hover:text-foreground"
                >
                  <span className={cn('grid size-4 shrink-0 place-items-center [&_svg]:size-4', s.tint)}>{s.icon}</span>
                  <span className="flex-1">{s.label}</span>
                  <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover/social:opacity-100" />
                </ExternalLink>
              )
            )}
          </div>
          <div className="mt-auto space-y-1.5 p-3 text-[10px] leading-relaxed text-faint">
            <div className="flex items-center gap-1.5">
              <ExternalLink href={qedConfig.legal.privacy} className="transition-colors hover:text-foreground">Privacy</ExternalLink>
              <span aria-hidden>·</span>
              <ExternalLink href={qedConfig.legal.terms} className="transition-colors hover:text-foreground">Terms</ExternalLink>
            </div>
            <div>An app by <ExternalLink href={qedConfig.url}>{qedConfig.name}</ExternalLink> | {qedConfig.description}.</div>
          </div>
        </aside>
      </div>
    </Dialog>
  )
}
