/**
 * The shared MCP server factory (host-api-v1-spec.md Phase 2). Builds an MCP server that exposes a given set of
 * tools over `callTool` — TRANSPORT-AGNOSTIC (the caller attaches Streamable HTTP or stdio) and free of any HTTP /
 * token lifecycle. The two adapters differ only in transport + which catalog they pass:
 *   • in-app (mcp/server.ts): HTTP + token, `IN_APP_TOOLS` (no lifecycle — can't hijack the open GUI's work).
 *   • headless (scripts/nvs-mcp — Phase 3): stdio, the FULL `TOOL_CATALOG` incl. lifecycle (it OWNS the work context).
 * `callTool`'s renderer broadcast is already headless-tolerant (ELECTRON_RUN_AS_NODE → no BrowserWindow), so this
 * layer needs nothing Electron-specific.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { wireDesc, type ToolDef } from '@shared/config/aiTools'
import { callTool } from '../ai/dispatch'

/** Every tool returns its result as one JSON text-content block. */
export function ok(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data ?? null) }] }
}

/** The local engine call, pre-wrapped — the default handler, and the fallback a routing handler delegates to. */
export const localCall = (name: string, args: Record<string, unknown>): ReturnType<typeof ok> => ok(callTool(name, args, 'session:mcp'))

/** What a tool handler must return: MCP content blocks (text, image, …). */
type ToolResult = { content: unknown[]; isError?: boolean }

/**
 * A fresh MCP server exposing `tools`. Stateless HTTP builds one per request; stdio builds one long-lived.
 * `handler` overrides how a call is served — the headless adapter uses it to ROUTE between its hidden agent
 * sandbox and the local engine on --work (scripts/nvsMcp.ts). Omitted, every call goes straight to the local engine.
 */
export function buildMcpServer(
  tools: ToolDef[],
  name = 'novel-visual-studio',
  handler?: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
): McpServer {
  const s = new McpServer({ name, version: '0.0.0' })
  for (const t of tools) {
    s.registerTool(
      t.name,
      { description: wireDesc(t), inputSchema: t.input },
      async (args: Record<string, unknown>) =>
        (handler ? await handler(t.name, args ?? {}) : localCall(t.name, args ?? {})) as ReturnType<typeof ok>
    )
  }
  return s
}
