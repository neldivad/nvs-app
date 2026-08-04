/**
 * In-app MCP server (the "agent v2" rung — see internal/extensions.md, host-api.md).
 *
 * The running NVS app hosts an MCP server on localhost; an external agent (Claude Code/Desktop)
 * connects by URL and calls engine capabilities as live tools — the SAME contract the renderer
 * uses via window.nvs. No separate process, no monorepo: the engine already lives in this (main)
 * process, so we just expose a thin MCP adapter over it. Keyless — the LLM runs in the agent, not
 * here; these tools only read/write the local work + DB.
 *
 * Transport: Streamable HTTP, stateless (a fresh server+transport per request, JSON response). This
 * is the standard MCP transport for a long-lived host reachable by URL.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { IN_APP_TOOLS, TOOL_CATALOG } from '@shared/config/aiTools'
import type { McpHeadlessInfo } from '@shared/ipc'
import { buildMcpServer } from './factory'
import { registerAppTools, APP_TOOL_NAMES } from './appTools'
import { publishLive, unpublishLive } from './liveConfig'

const MCP_HOST = '127.0.0.1'
const MCP_PORT = 4319
const MCP_PATH = '/mcp'

// Auth token — localhost-only isn't enough: any LOCAL process could otherwise read the open manuscript and
// drive the write tools. A per-install secret (persisted in userData) is required on every request via the
// `Authorization: Bearer <token>` header OR a `?key=<token>` query param (the connect URL embeds it). Raises
// the bar from "any process on this machine" to "a process that can read the token file".
let token: string | null = null
function mcpToken(): string {
  if (token) return token
  const p = join(app.getPath('userData'), 'mcp-token.txt')
  try {
    if (existsSync(p)) token = readFileSync(p, 'utf8').trim() || null
    if (!token) {
      token = randomBytes(24).toString('hex')
      writeFileSync(p, token, { encoding: 'utf8', mode: 0o600 }) // owner-only: the token is the auth secret
    }
    chmodSync(p, 0o600) // fix pre-existing installs written world-readable before this hardening
  } catch {
    token = token ?? randomBytes(24).toString('hex') // fs unavailable → in-memory secret for this session
  }
  return token
}
function authed(req: IncomingMessage): boolean {
  const t = mcpToken()
  const auth = req.headers['authorization']
  if (typeof auth === 'string' && auth === `Bearer ${t}`) return true
  try {
    return new URL(req.url ?? '', `http://${MCP_HOST}`).searchParams.get('key') === t
  } catch {
    return false
  }
}

/** Tool names exposed — surfaced in the Agent tab so the user sees the contract. */
export const MCP_TOOLS = [...IN_APP_TOOLS.map((t) => t.name), ...APP_TOOL_NAMES]

// ── HTTP lifecycle (stateless Streamable HTTP) ─────────────────────────────────

let httpServer: Server | null = null
let lastError: string | null = null
// The port we actually bound (4319 for the live app; an OS-assigned ephemeral port for a render sandbox, which
// passes port 0) and the handshake file we published to — remembered so stopMcp cleans up the right one.
let boundPort = MCP_PORT
let activeHandshakePath = ''

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!req.url || !req.url.startsWith(MCP_PATH)) {
    res.writeHead(404).end()
    return
  }
  if (req.method !== 'POST') {
    // Stateless: no standalone SSE stream / session deletion.
    res.writeHead(405).end()
    return
  }
  if (!authed(req)) {
    res.writeHead(401).end()
    return
  }
  const body = await readBody(req)
  const server = buildMcpServer(IN_APP_TOOLS)
  registerAppTools(server) // app-only tools (captureView) — the in-app server has a live window; the headless one doesn't
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

/**
 * Start the in-app MCP server (idempotent). Binds to localhost only.
 *
 * `opts.port` / `opts.handshakePath` override the defaults so a RENDER SANDBOX can run its OWN MCP server on an
 * OS-assigned ephemeral port (port 0 — the whole reason two instances used to collide on the fixed 4319) and
 * publish to a handshake file the spawning adapter chose (the sandbox's throwaway userData is unknown to it). The
 * live app passes neither → the historical 4319 + userData/mcp-live.json, unchanged.
 */
export function startMcp(opts?: { port?: number; handshakePath?: string }): void {
  if (httpServer) return
  const wantPort = opts?.port ?? MCP_PORT
  activeHandshakePath = opts?.handshakePath ?? liveConfigPath()
  const srv = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
      lastError = err instanceof Error ? err.message : String(err)
    })
  })
  srv.on('error', (err) => {
    lastError = err instanceof Error ? err.message : String(err)
    httpServer = null
  })
  srv.listen(wantPort, MCP_HOST, () => {
    lastError = null
    boundPort = (srv.address() as AddressInfo | null)?.port ?? wantPort // ephemeral port isn't known until we bind
    // Publish this app's liveness handshake (endpoint + pid). Historically the headless server PROXIED tool calls
    // to it; under the current ISOLATION model the agent never touches the author's live app (see scripts/nvsMcp.ts —
    // it routes to a hidden sandbox or reads --work locally, never here), so this is now only a liveness/discovery
    // marker (surfaced by mcpHeadlessInfo). The agent sandbox has its own separate handshake.
    publishLive(activeHandshakePath, { url: `http://${MCP_HOST}:${boundPort}${MCP_PATH}?key=${mcpToken()}`, pid: process.pid, port: boundPort, startedAt: new Date().toISOString() })
  })
  httpServer = srv
}

export function stopMcp(): void {
  httpServer?.close()
  httpServer = null
  unpublishLive(activeHandshakePath || liveConfigPath()) // headless falls back to local the moment we're gone
}

/** Where the live handshake file lives. The plugin generator bakes this exact path into the plugin's args. */
export function liveConfigPath(): string {
  return join(app.getPath('userData'), 'mcp-live.json')
}

/**
 * The paths the "Use NVS from Claude Code" panel renders into a copy-paste config for the HEADLESS stdio server
 * (host-api-v1-spec.md Phase 5). `command` is this Electron/app binary (run as node via ELECTRON_RUN_AS_NODE);
 * `script` is the bundled headless entry — in dev it must be built first (`npm run mcp:build`), which `built` reports.
 */
export function mcpHeadlessInfo(): McpHeadlessInfo {
  const script = app.isPackaged ? join(process.resourcesPath, 'headless', 'mcp.cjs') : join(app.getAppPath(), 'out', 'headless', 'mcp.cjs')
  return { command: process.execPath, script, built: existsSync(script), toolCount: TOOL_CATALOG.length, httpUrl: mcpStatus().url, home: app.getPath('home'), liveConfig: liveConfigPath() }
}

/** Status for the Agent tab: is it up, the connect URL, and the exposed tools. */
export function mcpStatus(): { running: boolean; url: string | null; tools: string[]; error: string | null } {
  const running = !!httpServer && httpServer.listening
  return {
    running,
    // The connect URL EMBEDS the auth token (?key=…) so the user copies one working, authenticated string.
    url: running ? `http://${MCP_HOST}:${boundPort}${MCP_PATH}?key=${mcpToken()}` : null,
    tools: [...MCP_TOOLS],
    error: lastError
  }
}
