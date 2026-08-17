/**
 * Outline — the Google-Docs-style document TOC for a world page: the heading tree, indented by level,
 * click to jump. The active section (tracked by the editor's scroll-spy) gets a left accent. Rendered
 * beside the write/preview content; the parent owns the jump + which pane it scrolls.
 */
import { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { EditorAside } from './EditorAside'
import type { Heading } from '@/lib/analysis/outline'

export function Outline({ headings, active, onJump }: { headings: Heading[]; active: number; onJump: (i: number) => void }): JSX.Element {
  const { t } = useTranslation('editor')
  const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1
  return (
    <EditorAside title={t('outline.title')} widthKey="nvs.outlineW" defaultWidth={224}>
      <nav className="pb-3">
        {headings.map((h, i) => (
          <button
            key={i}
            onClick={() => onJump(i)}
            title={h.text}
            style={{ paddingLeft: 10 + (h.level - minLevel) * 12 }}
            className={cn(
              'block w-full truncate border-l-2 py-1 pr-3 text-left text-[12px] transition-colors',
              i === active
                ? 'border-thread bg-panel-soft/50 text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-panel-soft hover:text-foreground'
            )}
          >
            {h.text}
          </button>
        ))}
      </nav>
    </EditorAside>
  )
}
