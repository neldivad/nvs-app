/**
 * New Work — the birth-choices dialog (replaces the bare name prompt). ONE screen, not a wizard:
 * the two or three decisions that genuinely change downstream behavior (structure TEMPLATE → world
 * categories · LANGUAGE → every analysis pass + page edit writes in it), with defaults pre-selected so
 * Enter-through equals the old behavior. Depth stays in Project Structure (⌘,); teaching stays in the
 * seeded demos; the Help-menu tour replays the walkthrough. After create, mailbox nudges point the
 * author at the ways to learn (F8 pane help · the tour · the live demos).
 */
import { useState, type JSX } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/stores/workspace'
import { STRUCTURE_TEMPLATES, structureTemplatesForKind } from '@shared/config/worldCategories'
import { LANGUAGES, DOMAINS, DEFAULT_DOMAIN } from '@shared/config/projectSchema'

// KIND selection tint (design tokens, NOT literal red — non-fiction isn't a warning): fiction = indigo/thread,
// non-fiction = teal/ok. One picked, the other neutral.
const KIND_TINT: Record<string, { on: string; dot: string }> = {
  fiction: { on: 'border-thread bg-thread/10', dot: 'bg-thread' },
  nonfiction: { on: 'border-ok bg-ok/10', dot: 'bg-ok' }
}

export function NewWorkDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const createWork = useWorkspace((s) => s.createWork)
  const pushNotification = useWorkspace((s) => s.pushNotification)
  const loadProjectInfo = useWorkspace((s) => s.loadProjectInfo)
  const setTourStep = useWorkspace((s) => s.setTourStep)
  const [name, setName] = useState('')
  const [domain, setDomain] = useState<string>(DEFAULT_DOMAIN)
  const [template, setTemplate] = useState('novel')
  const [lang, setLang] = useState('en')
  const [busy, setBusy] = useState(false)

  // Switching KIND re-scopes the structure options — reset the template to that kind's first so a stale
  // fiction template can't survive into a non-fiction project (and vice-versa).
  function pickDomain(d: string): void {
    setDomain(d)
    const first = structureTemplatesForKind(d as 'fiction' | 'nonfiction')[0]
    if (first && STRUCTURE_TEMPLATES.find((t) => t.key === template)?.kind !== d) setTemplate(first.key)
  }
  const templates = structureTemplatesForKind(domain as 'fiction' | 'nonfiction')

  async function submit(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const ok = await createWork(trimmed) // creates + OPENS the work — the writes below hit it
      if (!ok) return // name collision — the input stays for a rename
      const tpl = STRUCTURE_TEMPLATES.find((t) => t.key === template)
      if (tpl) await window.nvs.writeStructure(tpl.world, tpl.scene)
      await window.nvs.writeProjectInfo({ title: trimmed, inLanguage: [lang], domain }) // domain = declaration only (no behavior branch yet)
      await loadProjectInfo() // refresh the store so the tour below reads the JUST-SET domain (fiction vs non-fiction walkthrough)
      // the learning nudges land in the mailbox — present when wanted, never blocking. (The tour, which used to be
      // just a nudge here, now launches directly — the first impression is a guided walkthrough, not a wall of
      // prefilled sample pages.) Its steps are KIND-scoped, so a non-fiction project gets the non-fiction tour.
      pushNotification({ id: 'welcome-work', kind: 'success', title: `“${trimmed}” is ready`, body: 'Write in the editor; the analysis rails light up after your first Update analysis run (status bar). This tour replays any time from Help.' })
      pushNotification({ id: 'welcome-demos', kind: 'info', title: 'See it alive first', body: 'Open “Office Drama (demo)” or “Hamlet (demo)” from the library — pre-analyzed, every rail already lit.' })
      setName('')
      onClose()
      setTourStep(0) // launch the KIND-scoped Tour the app on the fresh project
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New work" className="h-[80vh] w-[80vw] max-w-[80vw]" bodyClassName="flex min-h-0 flex-col gap-6 overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Name</p>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            placeholder="The working title — you can rename any time"
            className="text-sm"
          />
        </div>

        <div>
          <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">What is this?</p>
          <p className="pb-2 text-[11px] text-muted-foreground">Fiction or non-fiction — this shapes what the analysis looks for. You can change it later in Project info.</p>
          <div className="grid grid-cols-2 gap-2">
            {DOMAINS.map((d) => (
              <button
                key={d.value}
                onClick={() => pickDomain(d.value)}
                className={cn(
                  'flex flex-col gap-1 rounded-md border p-3 text-left transition-colors',
                  domain === d.value ? KIND_TINT[d.value].on : 'border-border hover:bg-panel-soft'
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                  <span className={cn('size-2 rounded-full', domain === d.value ? KIND_TINT[d.value].dot : 'bg-border')} />
                  {d.label}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">{d.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Structure</p>
          <p className="pb-2 text-[11px] text-muted-foreground">Picks the world categories (characters, items, suspects…) — change later in Project Structure (⌘,).</p>
          <div className="grid grid-cols-2 gap-2">
            {templates.map((t) => (
              <button
                key={t.key}
                onClick={() => setTemplate(t.key)}
                className={cn(
                  'rounded-md border p-2.5 text-left transition-colors',
                  template === t.key ? 'border-lore bg-lore/10' : 'border-border hover:bg-panel-soft'
                )}
              >
                <span className="block text-[13px] font-medium text-foreground">{t.label}</span>
                <span className="block pt-0.5 text-[11px] leading-snug text-muted-foreground">{t.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Language</p>
          <p className="pb-2 text-[11px] text-muted-foreground">
            The work’s language steers <b>every</b> analysis pass and AI edit — summaries, thread titles, and findings are written in it. Set it now; a wrong first run costs a re-run.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGES.map((l) => (
              <button
                key={l.value}
                onClick={() => setLang(l.value)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  lang === l.value ? 'border-lore bg-lore/10 text-foreground' : 'border-border text-muted-foreground hover:bg-panel-soft'
                )}
              >
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button disabled={!name.trim() || busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Create
          </Button>
          <span className="text-[11px] text-faint">Starts from the guided starter content — delete its sample pages whenever you like.</span>
        </div>
      </div>
    </Dialog>
  )
}
