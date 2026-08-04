/**
 * scripts/nvsMcp.ts — the STANDALONE headless MCP server (host-api-v1-spec.md Phase 3). The one that lets Claude
 * Code / Claude Desktop drive the NVS engine with NO app window: point it at a folder of markdown, and an agent
 * builds `nvs.db` from it (openWork → ingestWork → the agent's own writeTier loop, keyless).
 *
 * ISOLATION (the author's live app is OFF-LIMITS to the agent — see internal/render-sandbox.md, the nvs-sandbox
 * skill). The agent NEVER touches the author's running window: there is no proxy to the live app, and the
 * live-drive tools (showView/showPage/setTheme/setViewport) are not exposed here at all.
 *  - **Reads** (listCast/queryDb/…) serve from the AGENT SANDBOX when one is open (openSandbox), else from the
 *    local engine on `--work`. Never from the live app.
 *  - **Captures** (captureView/captureAsset/listRegions) REQUIRE a sandbox — a hidden instance, so the author's
 *    window is untouched. No sandbox → a clear "call openSandbox first" error, never a peek at the live window.
 *  - **Lifecycle** (openWork/ingestWork) stays local — it owns this process's `--work` context.
 * The author keeps their writing session entirely to themselves; the agent works in the sandbox or headless.
 *
 * WHY it runs under Electron's node (ELECTRON_RUN_AS_NODE=1 electron out/headless/mcp.cjs, like ingest:headless):
 *  - `better-sqlite3` is compiled for Electron's ABI, so plain `node` can't load it; Electron-as-node matches.
 *  - `dispatch.ts` imports `electron` (BrowserWindow) — under ELECTRON_RUN_AS_NODE that resolves, and its renderer
 *    broadcast is already try/caught for the no-window case. (Note `require('electron')` is only a PATH STRING
 *    there — no `app.getPath` — which is why the live handshake file's location must be passed in, not derived.)
 *
 * Transport = STDIO (what an MCP client spawns). It exposes the FULL TOOL_CATALOG including lifecycle — this adapter
 * OWNS the work context, so there's no GUI to hijack, and no token is needed (a spawned stdio child has no network
 * surface). STDOUT is the MCP protocol channel — NEVER write to it; every diagnostic goes to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { writeFileSync } from 'node:fs'
import { IN_APP_TOOLS, TOOL_CATALOG } from '@shared/config/aiTools'
import { buildMcpServer, localCall } from '@main/mcp/factory'
import { APP_TOOL_DEFS } from '@main/mcp/appTools'
import { openSandbox, closeSandbox, sandboxUrl, proxySandbox } from '@main/mcp/sandboxSession'
import * as engine from '@engine/index'
import { z } from 'zod'

const log = (...a: unknown[]): void => console.error('[nvs-mcp]', ...a) // stderr only — stdout is the protocol

/** Tools the LIVE app serves. Anything outside this (openWork/ingestWork) is ours alone and never proxies. */
const LIVE_SERVED = new Set(IN_APP_TOOLS.map((t) => t.name))

async function main(): Promise<void> {
  const argv = process.argv
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const workDir = arg('--work')
  const launchEntry = arg('--launch-entry') // dev: the sandbox spawns `electron <this>` (packaged execPath IS the app)

  if (workDir) {
    const meta = engine.openWork(workDir)
    log(meta ? `opened work "${meta.name}" — ${meta.counts.scenes} scenes` : `WARNING: not a valid work at "${workDir}" (needs a content/ folder) — the agent can openWork elsewhere`)
  } else {
    log('no --work given — the agent must call openWork before the other tools')
  }

  // ISOLATION: never the live app. Reads serve from the AGENT SANDBOX when open (consistent with captures — same
  // project), else the local engine on --work. Lifecycle tools (not in LIVE_SERVED) always stay local.
  const route = async (name: string, args: Record<string, unknown>): Promise<{ content: unknown[]; isError?: boolean }> => {
    const started = Date.now() // stderr timing per tool — the before/after signal for the enumeration-cache work
    try {
      if (sandboxUrl() && LIVE_SERVED.has(name)) {
        try {
          return (await proxySandbox(name, args)) as { content: unknown[] }
        } catch (e) {
          log(`sandbox call "${name}" failed (${e instanceof Error ? e.message : String(e)}) — falling back to the local engine`)
        }
      }
      return localCall(name, args)
    } finally {
      log(`${name} ${Date.now() - started}ms`)
    }
  }

  const server = buildMcpServer(TOOL_CATALOG, 'nvs-mcp', route) // FULL catalog incl. lifecycle (trusted adapter)

  // Capture tools (captureView/captureAsset/listRegions) run ONLY in the agent sandbox — never the author's live
  // window. The other APP_TOOL_DEFS entries are LIVE-DRIVE tools (showView/showPage/setTheme/setViewport) that
  // move the author's actual window; ISOLATION means we don't expose them here at all. Definitions are SHARED with
  // the in-app server (APP_TOOL_DEFS) so the capture tools describe identically.
  // SANDBOX-FRAMED descriptions. The shared APP_TOOL_DEFS text says "requires the NVS app open / the author's
  // window" — TRUE for the in-app server, but WRONG here and it actively misleads the agent (it reaches for the
  // live app, then the skill has to correct it). Under isolation these render in the agent's sandbox, so we
  // OVERRIDE the description for the plugin context. Only these three are exposed; the live-drive tools aren't.
  // captureAsset only (+ listRegions). captureView uses capturePage (needs a COMPOSITED window) — it returns a
  // black frame from a hidden sandbox, so it's not exposed here; captureAsset (DOM-to-PNG) works hidden and covers
  // every pose. The live-drive tools aren't exposed either.
  const CAPTURE_DESC: Record<string, string> = {
    captureAsset:
      "Render a posed screenshot of the project in your AGENT SANDBOX and return a PNG — a hidden instance, so the author's live window is NEVER touched. Call openSandbox FIRST (this errors without one). This is THE capture tool. Pose with `page` (a scene/world page by path/title), `view` (a rail: cast/timeline/threads/coherence/…), `theme` (light = manuscript paper, cleaner for slides), `region` (one panel un-clipped), `width`×`height`, `maxPx`. One call → one PNG, of whichever project the sandbox was opened on.",
    listRegions:
      "List the on-screen regions of your AGENT SANDBOX — each id, purpose and size, no image tokens. Call openSandbox FIRST. Use it to pick a `region` for captureAsset."
  }
  const appDefs = Object.entries(APP_TOOL_DEFS) as [string, { description: string; input: Record<string, unknown> }][]
  for (const [name, def] of appDefs) {
    const description = CAPTURE_DESC[name]
    if (!description) continue // only the sandbox capture tools; live-drive tools are never exposed here
    server.registerTool(name, { description, inputSchema: def.input }, async (args: Record<string, unknown>) => {
      if (!sandboxUrl()) {
        return { content: [{ type: 'text' as const, text: `${name} needs an agent sandbox. Call openSandbox first (a hidden instance — it renders the project WITHOUT touching the author's live window), then retry. The author's writing session is off-limits.` }], isError: true }
      }
      try {
        const res = (await proxySandbox(name, args ?? {})) as { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean }
        // outPath: write the PNG to disk (server-side) and return the path instead of the inline image — lets an
        // agent save a BATCH of captures without spending image tokens on each. captureAsset only.
        const outPath = typeof args?.outPath === 'string' ? args.outPath : ''
        if (outPath && !res.isError) {
          const img = res.content?.find((c) => c.type === 'image' && typeof c.data === 'string')
          if (img?.data) {
            writeFileSync(outPath, Buffer.from(img.data, 'base64'))
            return { content: [{ type: 'text' as const, text: `Saved ${name} → ${outPath} (${Math.round((img.data.length * 3) / 4 / 1024)} KB)` }] }
          }
        }
        return res as { content: { type: 'text'; text: string }[] }
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Couldn't reach the agent sandbox for ${name}: ${e instanceof Error ? e.message : String(e)}. Reopen it with openSandbox.` }], isError: true }
      }
    })
  }

  // openSandbox / closeSandbox — the ONLY way the agent gets a render surface: a HIDDEN, agent-owned instance for
  // captures/visuals of any project WITHOUT touching the author's live window. While open, the capture tools above
  // route to it. Auto-closes after idle; closeSandbox ends it now.
  server.registerTool(
    'openSandbox',
    {
      description:
        "Open a HIDDEN, isolated NVS instance the agent owns, to render/capture WITHOUT disturbing the author — their live writing window is never touched. This is the ONLY way to capture: captureAsset (and listRegions) require it. Renders ANY project, not just one that's open elsewhere. Opens onto `projectPath` (defaults to this server's --work). Blocks until the project is open (~10-30s on a cold start). Auto-closes after ~5 min idle (override with `idleMinutes`); call closeSandbox when done.",
      inputSchema: { projectPath: z.string().optional().describe('Absolute path of the project to render (defaults to --work).'), idleMinutes: z.number().optional().describe('Idle minutes before auto-close (default 5).') }
    },
    async (args: Record<string, unknown>) => {
      const projectPath = (typeof args.projectPath === 'string' && args.projectPath) || workDir
      const idleMs = typeof args.idleMinutes === 'number' && args.idleMinutes > 0 ? args.idleMinutes * 60_000 : undefined
      const r = await openSandbox({ execPath: process.execPath, entry: launchEntry, projectPath, idleMs })
      if (!r.ok) return { content: [{ type: 'text' as const, text: `Couldn't open the sandbox: ${r.error}` }], isError: true }
      const note = r.reused ? 'already open' : r.error ? `open (warning: ${r.error})` : 'open'
      return { content: [{ type: 'text' as const, text: `Agent sandbox ${note}${r.project ? ` on ${r.project}` : ''}. captureAsset / listRegions now render from it (hidden — the author's window is untouched). Call closeSandbox when finished.` }] }
    }
  )
  server.registerTool(
    'closeSandbox',
    { description: 'Close the agent sandbox opened by openSandbox, freeing the hidden instance. No-op if none is open.', inputSchema: {} },
    async () => {
      const r = await closeSandbox()
      return { content: [{ type: 'text' as const, text: r.closed ? 'Agent sandbox closed.' : 'No agent sandbox was open.' }] }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
  log(`ready (stdio) — ${TOOL_CATALOG.length} tools + captureView`)

  // Lifecycle: this adapter is ONE client's private driver (like a Selenium driver process). When that client goes
  // away, tear ourselves down — and reap any sandbox we opened — instead of lingering as an orphan holding a hidden
  // instance (the pile-up you'd see as stray `mcp.cjs` in `ps`). stdin EOF is the reliable "the client died" signal;
  // acting on it only exits OUR process, so a second Claude Code session's adapter is never disturbed.
  let closing = false
  const shutdown = (code: number): void => {
    if (closing) return
    closing = true
    void closeSandbox().catch(() => {}).finally(() => process.exit(code))
  }
  process.stdin.on('end', () => shutdown(0)) // client closed stdin (disconnected / process exited)
  process.stdin.on('close', () => shutdown(0))
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => shutdown(0))
  // The stdio transport otherwise keeps stdin open, holding the event loop; do NOT exit here.
}

main().catch((e) => {
  log('fatal:', e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
