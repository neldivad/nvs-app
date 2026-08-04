/**
 * Agent runner (host mode) — routes the chat to the ACTIVE connection's provider loop.
 *
 * The registry guarantees one active connection (the router), so only one request path fires.
 * The provider loops (providers.ts) share the catalog + dispatch; this file just picks the loop.
 */
import { AI_PROVIDERS } from '@shared/config/aiProviders'
import type { AgentRunResult, ChatContext, ChatMessage } from '@shared/ipc'
import * as engine from '@engine/index'
import { getActive } from './registry'
import { anthropicRun, openaiRun, type Emit } from './providers'
import { planRun } from './planRun'

const MAX_HISTORY = 40 // only the last N turns are resent to the model (cost + context drift)

export async function runAgent(history: ChatMessage[], emit: Emit, signal: AbortSignal, context: ChatContext | null): Promise<AgentRunResult> {
  const active = getActive()
  if (!active) return { ok: false, reply: '', error: 'No active AI connection. Add one and set it active.' }
  if (!engine.currentProject()) return { ok: false, reply: '', error: 'No work open.' }

  const meta = AI_PROVIDERS[active.type]
  // The open page + any attached pages → a system note so "this page" resolves and attachments get read.
  const noteParts: string[] = []
  // Tell the agent its own runtime — the chat model has no way to know which connection is driving it, so
  // "what model am I on?" was unanswerable. `plan` = the user's Claude subscription via Claude Code (keyless,
  // no API billing); a keyed provider = that provider's API (billed to the user's key).
  const backend = active.type === 'plan' ? 'the user’s Claude subscription via Claude Code (keyless — no API billing)' : `the ${meta.label} API (billed to the user’s own key)`
  noteParts.push(`Runtime: you are running as model "${active.model}" on ${backend}. If the user asks which model or backend they're on, answer with exactly this — don't say you can't tell.`)
  if (context?.active) noteParts.push(`The user is currently viewing the ${context.active.kind} page "${context.active.title}" (path: ${context.active.path}). Treat "this page/scene/character" as referring to it.`)
  // readScene resolves a scene by title, so a scene ref needs no path; a WORLD page isn't in the scene index, so
  // it keeps its path. Either way the agent reads them with readScene as needed.
  if (context?.attached?.length) noteParts.push(`The user attached these pages as the focus of this request — read them with readScene as needed: ${context.attached.map((a) => (a.kind === 'scene' ? `"${a.title}"` : `"${a.title}" (${a.path})`)).join('; ')}.`)
  const ctxNote = noteParts.join(' ')
  const trimmed = history.slice(-MAX_HISTORY)
  // 'plan' = the keyless host: NVS drives Claude Code via the Agent SDK on the user's subscription,
  // with our engine tools attached in-process. Same chat panel + event stream as the key providers.
  if (meta.api === 'plan') return planRun(trimmed, active.model, emit, signal, ctxNote)
  if (meta.api === 'anthropic') return anthropicRun(trimmed, active.model, active.secret, emit, signal, ctxNote)
  return openaiRun(trimmed, active.model, active.secret, meta.baseUrl ?? '', emit, signal, ctxNote)
}
