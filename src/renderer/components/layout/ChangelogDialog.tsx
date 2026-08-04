/**
 * ChangelogDialog — the CHANGELOG.md viewer, opened from the header version chip. Renders the markdown with a
 * tiny inline formatter (headings · bullets · paragraphs); the file's own `# Changelog` title is dropped since
 * the dialog header already names it. Selectable, so a version note can be copied.
 */
import { type JSX } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { CHANGELOG } from '@/lib/changelog'

export function ChangelogDialog({ open, onClose, version }: { open: boolean; onClose: () => void; version: string }): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title={`Changelog · v${version || '—'}`} className="max-w-lg">
      <div className="max-h-[60vh] select-text space-y-1 overflow-y-auto pr-1 type-body-sm text-muted-foreground">
        {CHANGELOG.split('\n').map((line, i) => {
          if (line.startsWith('# ')) return null // file title — the dialog header covers it
          if (line.startsWith('## ')) return <h3 key={i} className="mt-3 type-card-title text-foreground first:mt-0">{line.slice(3)}</h3>
          if (line.startsWith('- ')) return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="mt-1 size-1 shrink-0 rounded-full bg-faint" />
              <span>{line.slice(2)}</span>
            </div>
          )
          if (line.trim() === '') return null
          return <p key={i}>{line}</p>
        })}
      </div>
    </Dialog>
  )
}
