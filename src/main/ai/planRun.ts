/**
 * Plan host — the keyless agent loop. Instead of calling a provider API with a key, NVS drives
 * Claude Code via the Agent SDK (`query`) on the user's existing `claude` login/subscription. Our
 * engine tools are attached as an IN-PROCESS MCP server (`createSdkMcpServer`), so the same catalog +
 * dispatch the key providers use runs here too — and writes go through `writeTier` exactly the same.
 *
 * It mirrors the provider loops (providers.ts): same (history, model, emit, signal, ctxNote) shape,
 * same AgentEvent transcript (text bubbles + tool / tool_result lines), so the chat panel can't tell
 * which backend produced a turn. Auth is the Claude Code login (one-time, browser) — no API key. We
 * never set ANTHROPIC_API_KEY here; that would route off-plan onto pay-per-token billing.
 */
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { SYSTEM_PROMPT, TOOL_CATALOG, wireDesc } from '@shared/config/aiTools'
import type { AgentRunResult, ChatMessage } from '@shared/ipc'
import * as engine from '@engine/index'
import { callTool } from './dispatch'
import type { Emit } from './providers'

const MCP_NAME = 'nvs' // tools surface to the agent as mcp__nvs__<tool>
const MAX_TURNS = 16
const MAX_RESULT_CHARS = 6000

/** Clip one tool result fed back to the model (same cap as the key providers). */
function clampResult(out: unknown): string {
  const s = JSON.stringify(out ?? null)
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}…[truncated ${s.length - MAX_RESULT_CHARS} chars — re-fetch a narrower slice if needed]` : s
}

/**
 * Build the in-process MCP tools from the SAME catalog the API path uses. Each handler emits the
 * tool / tool_result transcript lines (we own the call here, so the chat shows them just like the
 * key path) and routes to the shared dispatch, stamping `session:plan` provenance.
 */
function buildTools(emit: Emit): ReturnType<typeof tool>[] {
  return TOOL_CATALOG.map((t) =>
    tool(t.name, wireDesc(t), t.input, async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      emit({ type: 'tool', name: t.name, input })
      const out = callTool(t.name, input, 'session:plan')
      emit({ type: 'tool_result', name: t.name, result: out })
      return { content: [{ type: 'text' as const, text: clampResult(out) }] }
    })
  )
}

export async function planRun(history: ChatMessage[], model: string, emit: Emit, signal: AbortSignal, ctxNote: string): Promise<AgentRunResult> {
  const proj = engine.currentProject()
  if (!proj) return { ok: false, reply: '', error: 'No work open.' }

  const server = createSdkMcpServer({ name: MCP_NAME, version: '0.0.0', tools: buildTools(emit) })
  const system = ctxNote ? `${SYSTEM_PROMPT}\n\n${ctxNote}` : SYSTEM_PROMPT
  // Main stays stateless (like the key path, which resends history each call): flatten the trimmed
  // turns into one prompt; the final user turn is the request, the rest is context.
  const prompt = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n')

  // Bridge our cancel signal → the SDK's AbortController (Stop button / IPC cancelAgent).
  const ac = new AbortController()
  const onAbort = (): void => ac.abort()
  if (signal.aborted) ac.abort()
  else signal.addEventListener('abort', onAbort)

  let reply = ''
  try {
    for await (const msg of query({
      prompt,
      options: {
        ...(model ? { model } : {}), // empty → CLI default for the plan
        systemPrompt: system, // our analysis-agent persona (not the claude_code coding preset)
        mcpServers: { [MCP_NAME]: server },
        allowedTools: [`mcp__${MCP_NAME}__*`], // auto-approve our tools (headless: no prompt)
        tools: [], // drop built-ins (Bash/Read/Write/…) — only our engine tools are reachable
        permissionMode: 'bypassPermissions', // headless main has no permission UI to answer prompts
        settingSources: [], // ignore ~/.claude + project settings — predictable, no CLAUDE.md leakage
        cwd: proj.root,
        maxTurns: MAX_TURNS,
        abortController: ac,
        includePartialMessages: true // stream text token-by-token (settled assistant msgs carry the same text — ignore them)
      }
    })) {
      if (msg.type === 'stream_event') {
        const ev = msg.event
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
          emit({ type: 'text_delta', text: ev.delta.text })
          reply += ev.delta.text
        }
      } else if (msg.type === 'result' && msg.subtype !== 'success' && !signal.aborted) {
        return { ok: false, reply, error: `agent stopped: ${msg.subtype}` }
      }
    }
    return { ok: true, reply }
  } catch (err) {
    if (signal.aborted) return { ok: true, reply } // user stopped — keep what streamed
    return { ok: false, reply, error: err instanceof Error ? err.message : String(err) }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
