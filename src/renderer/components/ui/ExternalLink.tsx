/**
 * A link that opens in the system browser (via shell.openExternal) instead of navigating
 * the app — the only safe way to do web/docs links in an Electron renderer.
 */
import type { ReactNode, JSX } from 'react';

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (typeof window.nvs?.openUrl !== 'function') {
          console.warn('[nvs] openUrl bridge missing — restart the app (preload changed)')
          return
        }
        window.nvs.openUrl(href).catch((err) => console.error('[nvs] openUrl failed', href, err))
      }}
      className={className ?? 'text-thread underline decoration-dotted underline-offset-2 hover:decoration-solid'}
    >
      {children}
    </a>
  )
}
