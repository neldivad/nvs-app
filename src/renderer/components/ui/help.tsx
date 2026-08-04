/**
 * Shared help primitives — the "Help & reference" look (sections + key/value tables),
 * reused by the rail help, the timeline dock, and the editor dock so every help surface
 * reads the same.
 */
import type { ReactNode, JSX } from 'react';

export function HelpSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </div>
  )
}

/** A bordered key → description table (mono key on the left). */
export function HelpTable({ rows }: { rows: [string, string][] }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-start gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
          <span className="w-44 shrink-0 font-mono text-[11px] text-foreground/80">{k}</span>
          <span className="text-[12px] text-muted-foreground">{v}</span>
        </div>
      ))}
    </div>
  )
}

/** A simple bulleted list of notes. */
export function HelpList({ items }: { items: ReactNode[] }): JSX.Element {
  return (
    <ul className="space-y-1 text-[12px] text-muted-foreground">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  )
}
