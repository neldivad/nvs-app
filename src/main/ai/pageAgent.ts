/**
 * Page-agent — the one-shot WRITE path for in-editor slash commands (ephemeral, no chat session).
 *
 * Unlike the chat runner (agent.ts), this is a single completion with NO tools: page-in, edited/
 * appended Markdown out. The renderer applies the result as one editor transaction (native undo), so
 * we collect the full text rather than streaming it. Routed by the same active connection (plan | key).
 */
import Anthropic from '@anthropic-ai/sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { AI_PROVIDERS } from '@shared/config/aiProviders'
import { buildPagePrompt, modeDirective, kindDirective } from '@shared/config/agentCommands'
import { languageDirective } from '@shared/config/extraction'
import type { PageAgentInput, PageAgentResult } from '@shared/ipc'
import * as engine from '@engine/index'
import { getActive } from './registry'
import { runPlanEdit } from './planSession'

const MAX_TOKENS = 8192

/** WORKING-SET canon roster (unbounded-input audit): every page-edit prompt used to carry EVERY
 *  character+location — quadratic weight as the world grows, and a character who died 4000 episodes
 *  ago kept surfacing. Rank: (1) anyone NAMED on the page being edited (must stay linkable —
 *  correctness), (2) recent presence (last RECENT_WINDOW scenes), (3) total appearances; zero/ancient
 *  presence sinks out past the cap. Under the cap, pass through untouched. */
const CANON_CAP = { character: 60, location: 30 }
const RECENT_WINDOW = 25
function rankedCanon(pages: { name: string; id: string }[], pageText: string, cap: number): { name: string; id: string }[] {
  if (pages.length <= cap) return pages
  const graph = engine.timelineGraph()
  const appearances = new Map<string, number>()
  const lastPos = new Map<string, number>()
  let maxPos = 0
  for (const sc of Object.values(graph.scenes)) {
    const pos = sc.linearPos ?? 0
    maxPos = Math.max(maxPos, pos)
    for (const c of sc.cast) {
      appearances.set(c.entityId, (appearances.get(c.entityId) ?? 0) + 1)
      lastPos.set(c.entityId, Math.max(lastPos.get(c.entityId) ?? 0, pos))
    }
  }
  const text = pageText.toLowerCase()
  const score = (p: { name: string; id: string }): number => {
    if (text.includes(p.name.toLowerCase()) || text.includes(`(${p.id})`)) return Number.MAX_SAFE_INTEGER // on-page → must-link
    const recent = (lastPos.get(p.id) ?? -1) >= maxPos - RECENT_WINDOW ? 1e6 : 0
    return recent + (appearances.get(p.id) ?? 0)
  }
  return [...pages].sort((a, b) => score(b) - score(a)).slice(0, cap)
}

/** The { system, user } sent to the page-agent — built from the SHARED assembler (so the in-editor
 *  preview matches), with the work's cast/locations pulled live from the engine. */
function pagePrompt(input: PageAgentInput): { system: string; user: string } {
  const pages = engine.listWorldPages()
  const built = buildPagePrompt({
    pageText: input.pageText,
    instruction: input.instruction,
    mode: input.mode,
    kind: input.kind,
    pageTitle: input.pageTitle,
    characters: rankedCanon(pages.filter((p) => p.kind === 'character').map((p) => ({ name: p.name, id: p.id })), input.pageText, CANON_CAP.character),
    locations: rankedCanon(pages.filter((p) => p.kind === 'location').map((p) => ({ name: p.name, id: p.id })), input.pageText, CANON_CAP.location)
  })
  // page edits follow the WORK's language too (no-op for English/unset)
  return { system: built.system, user: built.user + languageDirective(engine.readProjectInfo().inLanguage?.[0]) }
}

/** Models sometimes wrap output in a ``` fence; strip a single enclosing one so we apply raw Markdown. */
function stripFences(s: string): string {
  const t = s.trim()
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/)
  return (m ? m[1] : t).trim()
}

/** When an instruction isn't a real page edit, models decline with empty output or a bare HTML comment.
 *  Reject those so we never apply junk (an empty `replace` would also wipe the page). */
function guard(text: string): PageAgentResult {
  const stripped = stripFences(text)
  if (!stripped.replace(/<!--[\s\S]*?-->/g, '').trim()) {
    return { ok: false, text: '', error: 'No page edit produced — rephrase as a concrete change to this page.' }
  }
  return { ok: true, text: stripped }
}

export async function runPageAgent(input: PageAgentInput, signal: AbortSignal): Promise<PageAgentResult> {
  const active = getActive()
  if (!active) return { ok: false, text: '', error: 'No active AI connection. Add one in the Agent dock.' }
  const { system, user } = pagePrompt(input)
  const meta = AI_PROVIDERS[active.type]
  try {
    if (meta.api === 'plan') return await planComplete(system, user, input.mode, input.kind, active.model, signal)
    if (meta.api === 'anthropic') return await anthropicComplete(system, user, active.model, active.secret, signal)
    return await openaiComplete(system, user, active.model, active.secret, meta.baseUrl ?? '', signal)
  } catch (err) {
    if (signal.aborted) return { ok: false, text: '', error: 'cancelled' }
    return { ok: false, text: '', error: err instanceof Error ? err.message : String(err) }
  }
}

async function anthropicComplete(system: string, user: string, model: string, apiKey: string, signal: AbortSignal): Promise<PageAgentResult> {
  const client = new Anthropic({ apiKey })
  const stream = client.messages.stream({ model, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content: user }] }, { signal })
  const msg = await stream.finalMessage()
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  return guard(text)
}

async function openaiComplete(system: string, user: string, model: string, apiKey: string, baseUrl: string, signal: AbortSignal): Promise<PageAgentResult> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Novel Visual Studio' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal
  })
  if (!res.ok) return { ok: false, text: '', error: `${res.status}: ${(await res.text()).slice(0, 300)}` }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return guard(data.choices?.[0]?.message?.content ?? '')
}

async function planComplete(system: string, user: string, mode: PageAgentInput['mode'], kind: PageAgentInput['kind'], model: string, signal: AbortSignal): Promise<PageAgentResult> {
  const cwd = engine.currentProject()?.root ?? process.cwd()
  // Try the WARM session first (skips the subprocess cold-start). The session's systemPrompt is
  // kind/mode-agnostic, so restate both in the message. Returns null if warm is unavailable → one-shot.
  const warm = await runPlanEdit(`${kindDirective(kind)}\n${modeDirective(mode)}\n\n${user}`, model, cwd, signal)
  if (warm !== null) return guard(warm)

  // One-shot fallback — a fresh `query` per call (the original, always-correct path).
  const ac = new AbortController()
  const onAbort = (): void => ac.abort()
  if (signal.aborted) ac.abort()
  else signal.addEventListener('abort', onAbort)
  let text = ''
  let result = ''
  try {
    for await (const msg of query({
      prompt: user,
      options: {
        ...(model ? { model } : {}),
        systemPrompt: system,
        tools: [], // no tools — pure text edit
        permissionMode: 'bypassPermissions',
        settingSources: [],
        cwd,
        maxTurns: 1,
        abortController: ac
      }
    })) {
      if (msg.type === 'assistant') {
        for (const b of msg.message.content) if (b.type === 'text') text += b.text
      } else if (msg.type === 'result' && msg.subtype === 'success') {
        result = msg.result
      }
    }
    return guard(text || result)
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
