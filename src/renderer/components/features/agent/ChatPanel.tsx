/**
 * The right-side agent chat panel — the persistent, multi-session inbox.
 *
 * State lives in the workspace store (sessions persisted per-project), so it survives the panel
 * collapsing/unmounting. The active page is passed to each run as context (so "this page/character"
 * requests resolve). Connections/keys are configured in the bottom dock's Agent tab.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { regionAttrs } from '@/config/regions'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clapperboard, Copy, MessageSquarePlus, Paperclip, Search, Send, Sparkles, Square, Trash2, X } from 'lucide-react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isAnalysis } from '@shared/config/agentCommands'
import { entityVisual } from '@/config/entityVisual'
import { PagedList } from '@/components/ui/PagedList'
import type { AgentEvent, AiConnection, ChatSession, PageRef } from '@shared/ipc'
import { useWorkspace } from '@/stores/workspace'
import { ConfirmDialog } from '@/components/ui/confirm'
import { useModalOpen } from '@/lib/editor/escapeStack'
import { cn } from '@/lib/utils'

// Fast/small models tend to loop or misfire on multi-step tool use (find scenes → queue bulk edits). The `plan`
// backend (Claude via the subscription) is capable regardless. Name-based heuristic — imperfect, but it only
// drives an advisory hint, never blocks anything.
const WEAK_MODEL = /\b(flash|mini|nano|lite|haiku|gemma|8b|small|tiny|instant)\b/i
function isWeakAgentModel(conn: AiConnection | undefined): boolean {
  return !!conn && conn.type !== 'plan' && WEAK_MODEL.test(conn.model)
}

/** Expandable ⚠ in the chat header when a weak model drives the agent — nudges toward the Claude plugin / a
 *  stronger model, without blocking. Only appears for models the heuristic flags. */
function WeakModelWarning({ conn, onUseClaude }: { conn: AiConnection; onUseClaude: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="This model may struggle with multi-step tasks"
        className={cn('rounded p-1 text-warn hover:bg-panel-soft', open && 'bg-panel-soft')}
      >
        <AlertTriangle className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-warn/40 bg-panel p-2.5 text-[11px] leading-relaxed shadow-lg">
            <p className="mb-1 flex items-center gap-1 font-medium text-warn"><AlertTriangle className="size-3 shrink-0" /> {conn.model} may struggle here</p>
            <p className="text-muted-foreground">Small/fast models tend to loop or misfire on multi-step tool use — finding scenes, queuing bulk edits. For complex agentic work:</p>
            <div className="mt-1.5 space-y-1 text-muted-foreground">
              <p>• <button onClick={() => { setOpen(false); onUseClaude() }} className="text-thread underline underline-offset-2 hover:opacity-80">Drive NVS from Claude</button> — the plugin (Store → Use with Claude).</p>
              <p>• Or pick a stronger model in <span className="text-foreground/80">Settings → AI</span>.</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function ChatPanel(): JSX.Element {
  const project = useWorkspace((s) => s.project)
  const sessions = useWorkspace((s) => s.chatSessions) ?? []
  const activeId = useWorkspace((s) => s.chatActiveId)
  const busy = useWorkspace((s) => s.chatBusy)
  const sendChat = useWorkspace((s) => s.sendChat)
  const stopChat = useWorkspace((s) => s.stopChat)
  const newChat = useWorkspace((s) => s.newChat)
  const switchChat = useWorkspace((s) => s.switchChat)
  const deleteChat = useWorkspace((s) => s.deleteChat)
  const resetChat = useWorkspace((s) => s.resetChat)
  const activePage = useWorkspace((s) => s.activePage)
  const aiState = useWorkspace((s) => s.aiState)
  const setDiscoverOpen = useWorkspace((s) => s.setDiscoverOpen)

  const activeConn = aiState?.connections.find((c) => c.status === 'active')
  const active = sessions.find((s) => s.id === activeId) ?? null
  const events = active?.events ?? []
  const [input, setInput] = useState('')
  // A prefill from elsewhere (e.g. the Lore "Learn more" hand-off): drop it into the composer for the author to
  // review + send — NEVER auto-sent.
  const chatDraft = useWorkspace((s) => s.chatDraft)
  const setChatDraft = useWorkspace((s) => s.setChatDraft)
  useEffect(() => {
    if (chatDraft == null) return
    setInput(chatDraft)
    setChatDraft(null)
    requestAnimationFrame(() => taRef.current?.focus())
  }, [chatDraft, setChatDraft])
  const [attached, setAttached] = useState<PageRef[]>([]) // pages tagged via the attach menu → sent as context
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null) // chat ids pending deletion (1 = single, N = bulk)
  const delCount = confirmDelete?.length ?? 0
  const delTitle = delCount === 1 ? sessions.find((s) => s.id === confirmDelete![0])?.title : null
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events, busy])

  // Auto-grow the composer textarea with its content (1 line → up to ~5, then scroll). Resets when cleared.
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [input])

  const tooBig = input.length > 40_000 // ~10k tokens — past this, Send is hard-disabled (document-dump guard)
  const send = (force = false): void => {
    const t = input.trim()
    if (!t || busy) return
    if (tooBig && !force) return // guard — only the explicit "Send anyway" gets through
    setInput('')
    void sendChat(t, attached)
    setAttached([])
  }

  return (
    <div {...regionAttrs('chatPanel')} className="flex h-full min-w-0 flex-col bg-canvas" style={{ userSelect: 'text' }}>
      {/* Header: sessions + new + close */}
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5 text-[11px]">
        <SessionPicker sessions={sessions} activeId={activeId} onSwitch={switchChat} onDelete={(ids) => setConfirmDelete(ids)} />
        <button onClick={() => newChat()} title="New chat" className="rounded p-1 text-muted-foreground hover:bg-panel-soft"><MessageSquarePlus className="size-3.5" /></button>
        {active && <button onClick={() => setConfirmDelete([active.id])} title="Delete chat" className="rounded p-1 text-muted-foreground hover:bg-panel-soft"><Trash2 className="size-3.5" /></button>}
        {isWeakAgentModel(activeConn) && activeConn && (
          <div className="ml-auto"><WeakModelWarning conn={activeConn} onUseClaude={() => setDiscoverOpen('claude')} /></div>
        )}
      </div>

      {!project ? (
        <Empty>Open a work to chat with the agent.</Empty>
      ) : (
        <>
          {/* Context chip — what the agent "sees" */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-[10px] text-faint">
            <span className="truncate">context: {activePage ? <span className="text-muted-foreground">@ {activePage.title}</span> : 'whole project'}</span>
            {events.length > 0 && <button onClick={() => resetChat()} className="ml-auto rounded px-1.5 py-0.5 text-muted-foreground hover:bg-panel-soft">Clear</button>}
          </div>

          {/* Transcript */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-3 text-[11px]">
            {events.length === 0 && <p className="text-faint">Ask the agent about the open work — it can read scenes and write analysis. Try “analyze Act I,” or with a page open, “find threads from this page.”</p>}
            {groupEvents(events).map((g, i) => (g.tools ? <ToolTrace key={i} events={g.tools} /> : <EventLine key={i} e={g.event} />))}
            {busy && <WorkingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* Big-paste guard — a faint token count once it gets long; past the cap, Send is DISABLED (a warning
              replaces it, with an explicit "Send anyway" escape). So "warned" always means "blocked". */}
          {input.length > 8000 && (
            <div className={cn('flex items-center gap-2 border-t border-border px-2 py-1 text-[10px]', tooBig ? 'text-warn' : 'text-faint')}>
              <span className="min-w-0 flex-1">
                ≈{Math.ceil(input.length / 4).toLocaleString()} tokens
                {tooBig && ' — too large to send; it would crowd the context window / burn usage. Trim it, or analyze one chapter/page at a time.'}
              </span>
              {tooBig && !busy && (
                <button onClick={() => send(true)} className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 text-warn hover:bg-warn/10">Send anyway</button>
              )}
            </div>
          )}

          {/* Attached pages (the @-tag chips) — each shows its page-kind icon */}
          {attached.length > 0 && (
            <div className="flex flex-wrap gap-1 border-t border-border px-2 pt-1.5">
              {attached.map((a) => {
                const v = pageVisual(a.kind)
                return (
                  <button key={a.path} onClick={() => setAttached((cur) => cur.filter((x) => x.path !== a.path))} title="Remove" className="flex items-center gap-1 rounded border border-border bg-panel-soft px-1.5 py-0.5 text-[10px] text-foreground hover:border-flag hover:text-flag">
                    <v.Icon className={cn('size-2.5', v.text)} /> {a.title} <X className="size-2.5 opacity-70" />
                  </button>
                )
              })}
            </div>
          )}

          {/* Composer */}
          <div className="flex items-end gap-2 border-t border-border p-2">
            <AttachMenu attached={attached} onAttach={(p) => setAttached((cur) => (cur.some((x) => x.path === p.path) ? cur : [...cur, p]))} />
            <AnalysisPicker onPick={(directive) => { if (!busy) void sendChat(directive) }} />
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              // Plain Enter sends. Shift+Enter newlines natively; Ctrl/Cmd+Enter won't (Chromium), so insert one.
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return
                e.preventDefault()
                if (e.ctrlKey || e.metaKey) {
                  const el = e.currentTarget
                  const s = el.selectionStart
                  setInput(input.slice(0, s) + '\n' + input.slice(el.selectionEnd))
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 1 })
                } else {
                  send()
                }
              }}
              placeholder="Ask the agent…  (Shift+Enter for a new line)"
              disabled={busy}
              rows={1}
              className="max-h-32 flex-1 resize-none self-stretch rounded-md border border-border bg-panel-soft px-2 py-1 text-[11px] leading-snug text-foreground outline-none focus:border-foreground/30 disabled:opacity-50"
            />
            {busy ? (
              <button onClick={() => stopChat()} title="Stop" className="flex items-center rounded-md border border-border bg-panel-soft px-2 py-1 text-warn hover:border-foreground/30"><Square className="size-3" /></button>
            ) : (
              <button onClick={() => send()} disabled={!input.trim() || tooBig} title={tooBig ? 'Too large — trim it or use “Send anyway”' : 'Send'} className="flex items-center rounded-md border border-border bg-panel-soft px-2 py-1 text-foreground hover:border-foreground/30 disabled:opacity-50"><Send className="size-3" /></button>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={delCount > 1 ? `Delete ${delCount} chats?` : 'Delete chat?'}
        message={
          delCount > 1 ? (
            <>This will permanently delete <span className="text-foreground">{delCount} chats</span> and their transcripts. This can&apos;t be undone.</>
          ) : (
            <>This will permanently delete <span className="text-foreground">{delTitle || 'this chat'}</span> and its transcript. This can&apos;t be undone.</>
          )
        }
        confirmLabel={delCount > 1 ? `Delete ${delCount}` : 'Delete'}
        danger
        onConfirm={() => { confirmDelete?.forEach((id) => deleteChat(id)); setConfirmDelete(null) }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-[12px] text-muted-foreground">{children}</div>
}

const WORKING_PHRASES = ['reading the work', 'thinking it through', 'pulling the threads', 'checking the cast', 'weighing it', 'almost there']

/** Animated "working" signal — cycles editor-ish phrases + trailing dots so a long run reads alive. */
function WorkingIndicator(): JSX.Element {
  const [phrase, setPhrase] = useState(0)
  const [dots, setDots] = useState(1)
  useEffect(() => {
    const a = window.setInterval(() => setPhrase((p) => (p + 1) % WORKING_PHRASES.length), 2400)
    const b = window.setInterval(() => setDots((d) => (d % 3) + 1), 400)
    return () => { window.clearInterval(a); window.clearInterval(b) }
  }, [])
  return (
    <p className="self-start text-faint">
      {WORKING_PHRASES[phrase]}<span className="inline-block w-3 text-left">{'.'.repeat(dots)}</span>
    </p>
  )
}

/** Copy a response's raw Markdown to the clipboard (export = paste anywhere). Reveals on bubble hover. */
function CopyButton({ text }: { text: string }): JSX.Element {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1200) }}
      title="Copy as Markdown"
      className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] text-faint opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
    >
      {done ? <><Check className="size-2.5 text-ok" /> copied</> : <><Copy className="size-2.5" /> copy</>}
    </button>
  )
}

// Per-kind icon + accent for the attach list (scenes use the slate icon; world kinds reuse entityVisual).
const KIND_LABEL: Record<string, string> = { scene: 'Scenes', character: 'Characters', location: 'Locations', item: 'Items', lore: 'Lore' }
const KIND_ORDER = ['scene', 'character', 'location', 'item', 'lore']
function pageVisual(kind: string): { Icon: typeof Clapperboard; text: string } {
  if (kind === 'scene') return { Icon: Clapperboard, text: 'text-thread' }
  const v = entityVisual(kind)
  return { Icon: v.Icon, text: v.text }
}

/** Attach a project page (scene or world) as focus for the next message — the agent reads it (readScene).
 *  Searchable + category-filtered popover, per-kind icons; already-attached pages drop out. */
function AttachMenu({ attached, onAttach }: { attached: PageRef[]; onAttach: (p: PageRef) => void }): JSX.Element {
  const scenes = useWorkspace((s) => s.scenes)
  const worldPages = useWorkspace((s) => s.worldPages)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const ref = useRef<HTMLDivElement>(null)
  useModalOpen(open)
  useEffect(() => {
    if (!open) { setQ(''); setCat('all'); return }
    const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const taken = new Set(attached.map((a) => a.path))
  const all: PageRef[] = [
    ...scenes.map((s) => ({ path: s.path, title: s.title, kind: 'scene' as const })),
    ...worldPages.map((p) => ({ path: p.path, title: p.name, kind: p.kind }))
  ].filter((p) => !taken.has(p.path))
  const present = KIND_ORDER.filter((k) => all.some((p) => p.kind === k)) // only show tabs that have pages
  const needle = q.trim().toLowerCase()
  const results = all
    .filter((p) => cat === 'all' || p.kind === cat)
    .filter((p) => !needle || p.title.toLowerCase().includes(needle))

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Attach a page as context" className="flex items-center rounded-md border border-border bg-panel-soft px-2 py-1 text-muted-foreground hover:border-foreground/30 hover:text-foreground">
        <Paperclip className="size-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-72 overflow-hidden rounded-md border border-border bg-panel shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="size-3 shrink-0 text-faint" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Attach a scene or page…" className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-faint" />
          </div>
          {present.length > 1 && (
            <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5 text-[10px]">
              {['all', ...present].map((k) => (
                <button key={k} onClick={() => setCat(k)} className={cn('rounded px-1.5 py-0.5', cat === k ? 'bg-panel-soft text-foreground' : 'text-muted-foreground hover:bg-panel-soft')}>
                  {k === 'all' ? 'All' : KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
          <PagedList
            items={results}
            getKey={(p) => p.path}
            resetKey={`${cat}:${needle}`}
            pageSize={20}
            empty="No pages"
            renderItem={(p) => {
              const v = pageVisual(p.kind)
              return (
                <button onClick={() => { onAttach(p); setQ('') }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-panel-soft">
                  <v.Icon className={cn('size-3.5 shrink-0', v.text)} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/90">{p.title}</span>
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-faint">{p.kind}</span>
                </button>
              )
            }}
          />
        </div>
      )}
    </div>
  )
}

/** Quick-pick for ANALYSIS prompts — they read the work, so they run here in chat (not as page edits).
 *  Hidden when the library has no analysis prompts. Clicking one sends its directive as a chat message. */
function AnalysisPicker({ onPick }: { onPick: (directive: string) => void }): JSX.Element | null {
  const items = useWorkspace((s) => s.prompts).filter((p) => isAnalysis(p.category))
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useModalOpen(open) // Esc closes the popover, not the float
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  if (!items.length) return null
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Analysis prompts" className="flex items-center rounded-md border border-border bg-panel-soft px-2 py-1 text-thread hover:border-foreground/30">
        <Sparkles className="size-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-60 overflow-hidden rounded-md border border-border bg-panel shadow-xl">
          <div className="border-b border-border px-2 py-1 text-[10px] text-faint">Analysis — answered here in chat</div>
          <div className="max-h-56 overflow-auto p-1">
            {items.map((p) => (
              <button key={p.id} onClick={() => { onPick(p.directive); setOpen(false) }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-panel-soft">
                <span className="block truncate text-[11px] font-medium text-foreground/90">{p.label}</span>
                <span className="block truncate text-[10px] text-faint">{p.directive}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Compact markdown styling for the chat — GFM tables/lists/code; links open in the system browser. */
const MD: Components = {
  p: ({ children }) => <p className="mb-1.5 leading-relaxed last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (!href) return
        if (/^(scene|page):/.test(href)) useWorkspace.getState().openLinkedPage(href) // open the work's page
        else if (/^(https?|mailto):/.test(href)) void window.nvs.openUrl(href)
      }}
      className="cursor-pointer underline"
      style={{ color: 'var(--thread)' }}
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-1 ml-3.5 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 ml-3.5 list-decimal space-y-0.5">{children}</ol>,
  code: ({ className, children }) =>
    className
      ? <code className={cn('font-mono text-[10px]', className)}>{children}</code>
      : <code className="rounded bg-canvas px-1 py-0.5 font-mono text-[10px]">{children}</code>,
  pre: ({ children }) => <pre className="my-1 overflow-x-auto rounded bg-canvas p-2 font-mono text-[10px]">{children}</pre>,
  table: ({ children }) => <div className="my-1 overflow-x-auto"><table className="w-full border-collapse text-[10px]">{children}</table></div>,
  th: ({ children }) => <th className="border border-border bg-panel px-1.5 py-0.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-border px-1.5 py-0.5">{children}</td>,
  h1: ({ children }) => <h3 className="mb-1 mt-2 text-[12px] font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-2 text-[12px] font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-1.5 font-semibold first:mt-0">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  hr: () => <hr className="my-2 border-border" />,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-2 text-muted-foreground">{children}</blockquote>
}

type Group = { event: AgentEvent; tools?: undefined } | { tools: AgentEvent[]; event?: undefined }

/** Coalesce consecutive tool / tool_result events into one collapsible trace; keep prose/user/error inline. */
function groupEvents(events: AgentEvent[]): Group[] {
  const out: Group[] = []
  for (const e of events) {
    if (e.type === 'text_delta') continue // merged into the trailing 'text' bubble by the store
    if (e.type === 'tool' || e.type === 'tool_result') {
      const last = out[out.length - 1]
      if (last?.tools) last.tools.push(e)
      else out.push({ tools: [e] })
    } else out.push({ event: e })
  }
  return out
}

/** The tool calls behind a turn, folded away by default — "used N tools", expandable to the → / ← trace. */
function ToolTrace({ events }: { events: AgentEvent[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const names = [...new Set(events.filter((e) => e.type === 'tool').map((e) => (e as Extract<AgentEvent, { type: 'tool' }>).name))]
  return (
    <div className="w-full max-w-[90%] self-start">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[10px] text-faint hover:text-muted-foreground">
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        used {names.length} tool{names.length !== 1 ? 's' : ''}{names.length ? ` · ${names.join(', ')}` : ''}
      </button>
      {open && <div className="mt-0.5 space-y-0.5 border-l border-border pl-2">{events.map((e, i) => <ToolLine key={i} e={e} />)}</div>}
    </div>
  )
}

/** One line of the tool trace; a `path` arg becomes a clickable link that opens the page (VSCode-style). */
function ToolLine({ e }: { e: AgentEvent }): JSX.Element | null {
  if (e.type === 'tool') {
    const o = e.input && typeof e.input === 'object' ? (e.input as Record<string, unknown>) : {}
    const path = typeof o.path === 'string' ? o.path : null
    return (
      <div className="font-mono text-[10px] text-muted-foreground">
        → {e.name}(
        {path ? (
          <a onClick={() => useWorkspace.getState().openLinkedPage(path)} title="Open this page" className="cursor-pointer underline" style={{ color: 'var(--thread)' }}>
            {path.split('/').pop()}
          </a>
        ) : (
          summarizeInput(e.input)
        )}
        )
      </div>
    )
  }
  if (e.type === 'tool_result') {
    // `result` may be an object {ok,written,error,note}, an array (list tools), OR a STRING (a persisted result
    // slimmed to a truncated preview — engine/index slimEvent). Guard EVERY `in` behind typeof object, else
    // `'error' in "str"` throws and crashes the whole trace on expand.
    const r = e.result
    const o = r && typeof r === 'object' && !Array.isArray(r) ? (r as { ok?: boolean; written?: Record<string, number>; error?: string; note?: string }) : null
    const ok = o && 'ok' in o ? o.ok : true
    const text = o
      ? (o.error ?? o.note ?? (o.written ? Object.entries(o.written).map(([k, v]) => `${k} ${v}`).join(', ') || 'ok' : 'ok'))
      : typeof r === 'string'
        ? r.length > 80 ? r.slice(0, 80) + '…' : r
        : 'ok'
    return (
      <div className="font-mono text-[10px]" style={{ color: ok ? 'var(--faint)' : 'var(--warn)' }}>
        ← {e.name}: {text}
      </div>
    )
  }
  return null
}

function EventLine({ e }: { e: AgentEvent }): JSX.Element {
  if (e.type === 'user')
    return (
      <div className="flex max-w-[85%] flex-col items-end self-end">
        {!!e.attached?.length && (
          <div className="mb-1 flex flex-wrap justify-end gap-1">
            {e.attached.map((a) => (
              <button key={a.path} onClick={() => useWorkspace.getState().openLinkedPage(a.path)} title="Open this page" className="flex items-center gap-1 rounded border border-thread/40 bg-thread/10 px-1.5 py-0.5 text-[9px] text-foreground/80 hover:border-thread">
                <Paperclip className="size-2.5" /> {a.title}
              </button>
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap rounded-lg rounded-tr-sm px-2.5 py-1.5 text-white" style={{ backgroundColor: 'var(--thread)' }}>{e.text}</div>
      </div>
    )
  if (e.type === 'text')
    return (
      <div className="group max-w-[90%] self-start">
        <div className="rounded-lg rounded-tl-sm bg-panel-soft px-2.5 py-1.5 text-foreground/90">
          <Markdown remarkPlugins={[remarkGfm]} components={MD}>{e.text}</Markdown>
        </div>
        <div className="mt-0.5 pl-0.5"><CopyButton text={e.text} /></div>
      </div>
    )
  if (e.type === 'error')
    return <div className="self-center rounded-md border px-2 py-0.5 text-center text-[10px] text-warn" style={{ borderColor: 'color-mix(in oklab, var(--warn) 40%, transparent)' }}>⚠ Request failed — {e.message}. Check the API key (dock → Agent), or open Help (?).</div>
  return <></>
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  return Object.entries(o).filter(([k]) => k !== 'rows').map(([k, v]) => `${k}:${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ').slice(0, 80)
}

/** Compact relative time, e.g. "now", "3m", "2h", "5d". */
function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.floor(d / 7)
  return w < 5 ? `${w}w` : `${Math.floor(d / 30)}mo`
}

/** Searchable session history — trigger + popover list (recency-sorted). Per-row quick delete (trash) +
 *  checkbox multi-select → "Delete N". `onDelete` hands ids up to the parent's confirm dialog. */
function SessionPicker({ sessions, activeId, onSwitch, onDelete }: { sessions: ChatSession[]; activeId: string | null; onSwitch: (id: string) => void; onDelete: (ids: string[]) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)
  useModalOpen(open) // while the history popover is open, Esc closes it — not the chat float
  useEffect(() => {
    if (!open) { setSel(new Set()); return } // drop selection when the popover closes
    const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const active = sessions.find((s) => s.id === activeId)
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const filtered = q.trim() ? sorted.filter((s) => s.title.toLowerCase().includes(q.trim().toLowerCase())) : sorted
  const toggle = (id: string): void => setSel((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQ('') }}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-panel-soft px-2 py-1 text-[11px] text-foreground hover:border-foreground/30"
      >
        <span className="truncate">{active?.title || 'No chats yet'}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-72 max-w-[80vw] overflow-hidden rounded-md border border-border bg-panel shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="size-3 shrink-0 text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats…"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-faint"
            />
          </div>
          <div className="max-h-64 overflow-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-faint">No chats</p>
            ) : (
              filtered.map((s) => {
                const on = sel.has(s.id)
                return (
                  <div key={s.id} className={cn('group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-panel-soft', s.id === activeId && 'bg-panel-soft')}>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      title="Select"
                      className={cn('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-thread bg-thread/20 text-thread' : 'border-border text-transparent hover:border-foreground/40')}
                    >
                      <Check className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { onSwitch(s.id); setOpen(false) }}
                      className={cn('flex min-w-0 flex-1 items-center gap-2 text-left text-[11px]', s.id === activeId ? 'text-foreground' : 'text-muted-foreground')}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.title || 'Untitled'}</span>
                      <span className="shrink-0 text-[10px] text-faint">{relTime(s.updatedAt)}</span>
                    </button>
                    <button type="button" onClick={() => onDelete([s.id])} title="Delete chat" className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-flag group-hover:opacity-100">
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
          {sel.size > 0 && (
            <div className="flex items-center gap-2 border-t border-border px-2 py-1.5 text-[11px]">
              <span className="text-faint">{sel.size} selected</span>
              <button onClick={() => setSel(new Set())} className="ml-auto rounded px-1.5 py-0.5 text-muted-foreground hover:bg-panel-soft">Clear</button>
              <button onClick={() => { onDelete([...sel]); setSel(new Set()) }} className="rounded px-1.5 py-0.5 font-medium text-flag hover:bg-flag/10">Delete {sel.size}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
