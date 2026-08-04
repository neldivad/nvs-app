import { useState, type JSX } from 'react'
import { Plus, X } from 'lucide-react'
import { useWorkspace } from '@/stores/workspace'
import { Dialog } from '@/components/ui/dialog'
import { entityVisual } from '@/config/entityVisual'
import { activeLevels } from '@/config/sceneLadder'
import { StoryLadder } from '@/components/features/story/StoryLadder'
import { STRUCTURE_TEMPLATES, MASTER_WORLD } from '@shared/config/worldCategories'
import { cn } from '@/lib/utils'

type Tab = 'structure' | 'templates' | 'examples'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'structure', label: 'Structure' },
  { id: 'templates', label: 'Templates' },
  { id: 'examples', label: 'Examples' }
]

/**
 * Project Structure — the taxonomy editor (see internal/open-taxonomy.md). Opened from the Rail or a rail's
 * "Extend schema…". Store-driven (shared open-state) + tabbed: Structure (the current world + scene categories),
 * Templates (apply a preset), Examples (coming soon). The structure drives both sidebars, ingest, and extraction.
 */
export function ProjectConfigDialog(): JSX.Element {
  const open = useWorkspace((s) => s.structureDialogOpen)
  const onClose = useWorkspace((s) => s.setStructureDialogOpen)
  const storyTree = useWorkspace((s) => s.storyTree)
  const [tab, setTab] = useState<Tab>('structure')

  return (
    <Dialog region="projectStructureDialog" open={open} onClose={() => onClose(false)} title="Project structure" size="workspace" bodyClassName="flex flex-col overflow-hidden select-text">
      <div className="mb-3 flex shrink-0 gap-1 rounded-lg bg-panel-soft p-0.5 text-[12px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn('flex-1 rounded-md px-2 py-1 font-medium transition-colors', tab === t.id ? 'bg-panel text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'structure' && (
          <div className="space-y-4">
            <Section title="Scene — the story ladder" hint="The fixed 7-level hierarchy (6 folders + a Scene). Highlighted = levels this project uses. Label a folder from the Scene sidebar → right-click → Label as.">
              <StoryLadder active={activeLevels(storyTree)} />
            </Section>
            <Section title="World — the bible" hint="Each authored page in a tracked category becomes an entity the engine follows. Add or remove categories freely.">
              <WorldEditor />
            </Section>
          </div>
        )}

        {tab === 'templates' && (
          <div className="space-y-2">
            <p className="mb-1 text-[12px] text-muted-foreground">Reference layouts for different kinds of work — how each tends to organize its world and story. Nothing here changes your project; build yours under <b>Structure</b> with <b>Add category</b> / <b>Add level</b>.</p>
            {/* Grouped by KIND (matches the create wizard's fiction/non-fiction split) so the reference is contextualized. */}
            {(['fiction', 'nonfiction'] as const).map((kind) => (
              <div key={kind} className="space-y-2">
                <div className="flex items-center gap-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  <span className={cn('size-1.5 rounded-full', kind === 'nonfiction' ? 'bg-ok' : 'bg-thread')} />
                  {kind === 'nonfiction' ? 'Non-fiction' : 'Fiction'}
                </div>
                {STRUCTURE_TEMPLATES.filter((t) => t.kind === kind).map((t) => (
                  <div key={t.key} className="rounded-lg border border-border bg-panel p-3">
                    <span className="text-sm font-medium text-foreground">{t.label}</span>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="mr-0.5 text-[9px] uppercase tracking-wide text-faint">World</span>
                      {t.world.map((k) => (
                        <span key={k} className="rounded-full border border-border px-1.5 py-0 text-[10px] text-faint">{k}</span>
                      ))}
                    </div>
                    <div className="mt-2">
                      <div className="mb-1 text-[9px] uppercase tracking-wide text-faint">Story</div>
                      <StoryLadder active={t.scene} compact />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {tab === 'examples' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">Examples — coming soon.</p>
            <p className="max-w-sm text-[11px] text-faint">Browse how other works organize their world and story, and start from one. (Will draw on the NVS datasets.)</p>
          </div>
        )}
      </div>
    </Dialog>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{title}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

/** The World-bible category editor: the enabled categories (with live counts) + add/remove from the master palette. */
function WorldEditor(): JSX.Element {
  const structure = useWorkspace((s) => s.structure)
  const applyStructure = useWorkspace((s) => s.applyStructure)
  const [busy, setBusy] = useState(false)

  const worldKeys = structure.world.map((c) => c.key)
  const sceneKeys = structure.scene.map((c) => c.key)
  const unused = MASTER_WORLD.filter((m) => !worldKeys.includes(m.key) && !m.pillar) // pillars (custody) aren't addable

  const save = async (nextWorld: string[]): Promise<void> => {
    setBusy(true)
    await applyStructure(nextWorld, sceneKeys) // keep the story ladder untouched
    setBusy(false)
  }
  const add = (key: string): Promise<void> => save(MASTER_WORLD.filter((m) => worldKeys.includes(m.key) || m.key === key).map((m) => m.key))
  const remove = (key: string): Promise<void> => save(worldKeys.filter((k) => k !== key))

  return (
    <div className="space-y-1.5">
      {structure.world.map((c) => {
        const Icon = entityVisual(c.key).Icon
        return (
          <div key={c.key} className="flex items-start gap-3 rounded-lg border border-border bg-panel p-2.5">
            <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-panel-soft', c.tracked ? 'text-character' : 'text-faint')}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{c.label}</span>
                {!c.tracked && <span className="rounded-full border border-border px-1.5 py-0 text-[9px] uppercase tracking-wide text-faint">reference</span>}
                <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
                  {c.tracked ? <><span className="font-medium text-foreground">{c.count}</span> tracked</> : '—'}
                </span>
                <button disabled={busy} onClick={() => void remove(c.key)} title="Remove this category" className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-flag disabled:opacity-50">
                  <X className="size-3.5" />
                </button>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{c.description}</p>
              <div className="mt-0.5 font-mono text-[10px] text-faint">content/world/{c.folder}</div>
            </div>
          </div>
        )
      })}
      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-faint">Add category</span>
          {unused.map((m) => (
            <button key={m.key} disabled={busy} onClick={() => void add(m.key)} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-panel-soft hover:text-foreground disabled:opacity-50">
              <Plus className="size-3" /> {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
