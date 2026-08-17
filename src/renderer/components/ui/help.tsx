/**
 * Shared help primitives — the "Help & reference" look (sections + key/value tables + note lists),
 * reused by the rail help, the timeline dock, and the editor dock so every help surface reads the same.
 *
 * i18n: list items / table values may be **markdown strings** (from a `t('…', { returnObjects: true })` catalog),
 * rendered inline by `HelpMd` — so translated help keeps its **bold** emphasis without any JSX in the catalog.
 * Plain ReactNode still passes through unchanged, so panels can migrate to translatable strings one at a time.
 */
import { Fragment, type ReactNode, type JSX } from 'react';
import Markdown from 'react-markdown'

/** Inline-render a help string as markdown (bold · code · links), styled to the app. Non-strings pass through. */
export function HelpMd({ children }: { children: ReactNode }): JSX.Element {
  if (typeof children !== 'string') return <>{children}</>
  return (
    <Markdown
      components={{
        p: ({ children }) => <Fragment>{children}</Fragment>,
        strong: ({ children }) => <b className="text-foreground/80">{children}</b>,
        code: ({ children }) => <code className="rounded bg-panel-soft px-1 font-mono text-[11px]">{children}</code>,
        a: ({ href, children }) => <a href={href} className="text-thread hover:underline">{children}</a>
      }}
    >
      {children}
    </Markdown>
  )
}

export function HelpSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </div>
  )
}

/** A bordered key → description table (mono key on the left). Values may be markdown strings or ReactNode. */
export function HelpTable({ rows }: { rows: [string, ReactNode][] }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-start gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
          <span className="w-44 shrink-0 font-mono text-[11px] text-foreground/80">{k}</span>
          <span className="text-[12px] text-muted-foreground"><HelpMd>{v}</HelpMd></span>
        </div>
      ))}
    </div>
  )
}

/** A simple bulleted list of notes. Items may be markdown strings or ReactNode. */
export function HelpList({ items }: { items: ReactNode[] }): JSX.Element {
  return (
    <ul className="space-y-1 text-[12px] text-muted-foreground">
      {items.map((it, i) => (
        <li key={i}><HelpMd>{it}</HelpMd></li>
      ))}
    </ul>
  )
}
