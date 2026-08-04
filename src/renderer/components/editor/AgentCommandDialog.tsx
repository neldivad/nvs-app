/**
 * The in-editor agent composer (the WRITE half of slash-commands).
 *
 * A free-text instruction + ONE optional prompt → ENQUEUE a background task (the Tasks inbox). Only EDIT
 * prompts (maintenance / generation) appear here — analysis prompts run in chat. Filtering by category +
 * search narrows the library to up to 8 pills (only matches render, so it scales). The composer closes
 * immediately; the edit lands in Tasks for review-then-apply.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Sparkles, X, Library, Search } from 'lucide-react'
import { composeInstruction, isAnalysis, type PromptCategory } from '@shared/config/agentCommands'
import type { SavedPrompt } from '@shared/ipc'
import { regionAttrs } from '@/config/regions'
import { useWorkspace } from '@/stores/workspace'
import { modeTone } from '@/components/features/agent/PromptLibraryPanel'
import { cn } from '@/lib/utils'

const MAX_PILLS = 8 // category + search narrow the library down to this many pills (scales to 100s)
const EDIT_CATS: PromptCategory[] = ['maintenance', 'generation']

export function AgentCommandDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const body = useWorkspace((s) => s.body)
  const activePage = useWorkspace((s) => s.activePage)
  const enqueueTask = useWorkspace((s) => s.enqueueTask)
  const prompts = useWorkspace((s) => s.prompts)
  const setPromptsOpen = useWorkspace((s) => s.setPromptsOpen)
  const anchor = useWorkspace((s) => s.agentComposerAnchor)
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<SavedPrompt | null>(null) // single prompt (chaining is rare)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'all' | PromptCategory>('all')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    setText('')
    setSelected(null)
    setQ('')
    setCat('all')
    const id = window.setTimeout(() => taRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  // Only EDIT prompts, narrowed by category + search; only the first MAX_PILLS render.
  const pills = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return prompts
      .filter((p) => !isAnalysis(p.category))
      .filter((p) => cat === 'all' || p.category === cat)
      .filter((p) => !needle || `${p.label} ${p.directive}`.toLowerCase().includes(needle))
      .slice(0, MAX_PILLS)
  }, [prompts, q, cat])

  if (!open) return null

  const run = (): void => {
    if (!activePage) return
    const { instruction, mode } = composeInstruction(text, selected ? [selected] : [])
    if (!instruction.trim()) return
    // Stamp AI-provenance only for GENERATION edits (new content) — maintenance tidies the author's own words.
    const stamp = selected?.category === 'generation'
    void enqueueTask({ pagePath: activePage.path, pageTitle: activePage.title, pageKind: activePage.kind, instruction, mode, baseText: body, stamp })
    onClose()
  }

  const canRun = !!(text.trim() || selected)

  // Inline: anchor the composer at the caret (clamped to the viewport), else fall back to centered.
  const W = 448
  const pos = anchor
    ? { top: Math.min(anchor.top, window.innerHeight - 280), left: Math.min(anchor.left, window.innerWidth - W - 8) }
    : null

  return (
    <div className={cn('fixed inset-0 z-50', !pos && 'flex items-start justify-center bg-black/40 pt-32')} onMouseDown={onClose}>
      <div
        {...regionAttrs('agentCommandDialog')}
        className="w-[28rem] max-w-[90vw] rounded-lg border border-border bg-panel p-3 shadow-xl"
        style={pos ? { position: 'absolute', top: pos.top, left: Math.max(8, pos.left) } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-foreground">
          <Sparkles className="size-3.5 text-thread" /> Ask AI to write this page
          <button onClick={onClose} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-panel-soft"><X className="size-3.5" /></button>
        </div>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run()
            else if (e.key === 'Escape') onClose()
          }}
          placeholder="Describe what to write or change… (⌘/Ctrl+Enter to queue)"
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-canvas px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-foreground/30"
        />

        {/* Category filter + search */}
        <div className="mt-2 flex items-center gap-1">
          {(['all', ...EDIT_CATS] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn('rounded px-1.5 py-0.5 text-[10px] capitalize', cat === c ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft')}
            >
              {c}
            </button>
          ))}
          <div className="ml-1 flex flex-1 items-center gap-1 rounded-md border border-border bg-canvas px-1.5">
            <Search className="size-3 shrink-0 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search prompts…"
              className="min-w-0 flex-1 bg-transparent py-1 text-[11px] text-foreground outline-none placeholder:text-faint"
            />
          </div>
        </div>

        {/* Up to 8 prompt pills (single-select) */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pills.length === 0 ? (
            <span className="text-[10px] text-faint">No prompts match.</span>
          ) : (
            pills.map((p) => {
              const on = selected?.id === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => setSelected(on ? null : p)}
                  title={p.directive}
                  className={cn('rounded-md border px-2 py-0.5 text-[11px]', on ? modeTone(p.mode, true) : `${modeTone(p.mode)} hover:bg-panel-soft`)}
                >
                  {p.label}
                </button>
              )
            })
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => setPromptsOpen(true)} title="Manage prompts" className="flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-panel-soft">
            <Library className="size-3" /> Library
          </button>
          <span className="text-[10px] text-faint">runs in the background → Tasks</span>
          <button
            disabled={!canRun}
            onClick={run}
            className="ml-auto rounded-md border border-border bg-panel-soft px-2.5 py-1 text-[11px] text-foreground hover:border-foreground/30 disabled:opacity-50"
          >
            Queue edit
          </button>
        </div>
      </div>
    </div>
  )
}
