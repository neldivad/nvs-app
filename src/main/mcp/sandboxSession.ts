/**
 * AGENT SANDBOX SESSION (headless-adapter side) — a HIDDEN, isolated NVS instance the agent owns, so it can
 * render/capture ANY project WITHOUT touching the author's live writing window.
 *
 * Why hidden and throwaway (not the author's live app): opening their visible window would interrupt and persist.
 * A sandbox is a second, hidden process (NVS_RENDER_SANDBOX isolation: own userData, no seed, never shown) that
 * runs its OWN MCP server on an OS-assigned ephemeral port (NVS_SANDBOX_HANDSHAKE), so it never collides with the
 * live app on the fixed 4319. The adapter proxies capture tools to it via a StreamableHTTP client — a sandbox is
 * just "a live app that happens to be hidden."
 *
 * It also lifts captureAsset's "currently-open project only" limit: the live app shares ONE engine, but this is a
 * separate PROCESS with its own engine, so the sandbox opens whatever project it was spawned on — any project,
 * conflict-free. Single-project per lifetime (set at open) sidesteps the live server's openWork refusal.
 *
 * Lifecycle: openSandbox spawns + waits for both the MCP handshake AND the project to actually open (so the first
 * captureAsset can't race a null currentProject). closeSandbox kills it. An idle timer auto-closes a forgotten
 * sandbox so a crashed/abandoned agent never leaves a hidden process resident until reboot.
 */
import { spawn } from 'node:child_process'
import { readdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readLive } from './liveConfig'

type CallResult = Awaited<ReturnType<Client['callTool']>>

interface Sandbox {
  handshakePath: string
  url: string
  pid: number
  project?: string
}

const DEFAULT_IDLE_MS = 5 * 60_000

let sandbox: Sandbox | null = null
let client: Client | null = null
let idleTimer: NodeJS.Timeout | null = null
let idleMs = DEFAULT_IDLE_MS
let seq = 0

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0) // signal 0 = existence probe, no actual signal
    return true
  } catch {
    return false
  }
}

/** The open sandbox's connect URL, or null when none is open (or it has died — self-heals by tearing down). */
export function sandboxUrl(): string | null {
  if (!sandbox) return null
  if (!alive(sandbox.pid)) {
    void teardown()
    return null
  }
  return sandbox.url
}

export function sandboxInfo(): { project?: string; pid: number } | null {
  return sandboxUrl() && sandbox ? { project: sandbox.project, pid: sandbox.pid } : null
}

async function teardown(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  const c = client
  client = null
  sandbox = null
  try {
    await c?.close()
  } catch {
    /* already gone */
  }
}

function armIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void closeSandbox(), idleMs)
  idleTimer.unref() // never keep the adapter process alive just to fire this
}

async function connect(url: string): Promise<Client> {
  if (client) return client
  const c = new Client({ name: 'nvs-sandbox-proxy', version: '0.0.0' })
  await c.connect(new StreamableHTTPClientTransport(new URL(url)))
  client = c
  return c
}

const textOf = (r: CallResult): string => {
  const first = Array.isArray(r?.content) ? r.content[0] : null
  return first && typeof first === 'object' && 'text' in first ? String((first as { text: unknown }).text ?? '') : ''
}

/** Forward one tool call to the sandbox (its own client, separate from the live-app handoff so they never thrash). */
export async function proxySandbox(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const url = sandboxUrl()
  if (!url) throw new Error('no sandbox is open')
  armIdle() // any call is activity — push the idle deadline out
  try {
    const c = await connect(url)
    return await c.callTool({ name, arguments: args })
  } catch (e) {
    const c = client // force a fresh connection next time
    client = null
    try {
      await c?.close()
    } catch {
      /* gone */
    }
    throw e
  }
}

/**
 * Open (or reuse) the agent sandbox on `projectPath`. Blocks until the hidden instance's MCP is up AND the project
 * has actually opened in it, so the first captureAsset won't hit a null currentProject. `execPath`/`entry`: dev
 * needs the app main entry (execPath is electron); packaged, execPath IS the app.
 */
export async function openSandbox(opts: {
  execPath: string
  entry?: string
  projectPath?: string
  idleMs?: number
}): Promise<{ ok: boolean; error?: string; project?: string; reused?: boolean }> {
  if (!opts.projectPath) return { ok: false, error: 'openSandbox needs a project (pass projectPath, or start the server with --work)' }
  if (sandboxUrl()) return { ok: true, reused: true, project: sandbox?.project } // one live sandbox at a time

  const handshakePath = join(tmpdir(), `nvs-sandbox-${process.pid}-${++seq}.json`)
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE // else it boots as node and `protocol` is undefined at module top
  env.NVS_RENDER_SANDBOX = '1' // isolation: own userData, no seed, never shown
  env.NVS_SANDBOX_HANDSHAKE = handshakePath // → its MCP publishes here on an ephemeral port
  env.NVS_OPEN_PROJECT = opts.projectPath // boot-open handler opens it in the hidden window

  const child = spawn(opts.execPath, opts.entry ? [opts.entry] : [], { detached: true, stdio: 'ignore', env })
  child.unref()

  // Phase 1 — wait for the MCP handshake (server bound + published).
  const upDeadline = Date.now() + 30_000
  let cfg = readLive(handshakePath)
  while (!cfg && Date.now() < upDeadline) {
    await new Promise((r) => setTimeout(r, 400))
    cfg = readLive(handshakePath)
  }
  if (!cfg) {
    try {
      child.kill()
    } catch {
      /* nothing to kill */
    }
    return { ok: false, error: 'the sandbox never reported its MCP server ready within 30s' }
  }
  sandbox = { handshakePath, url: cfg.url, pid: cfg.pid, project: opts.projectPath }
  idleMs = typeof opts.idleMs === 'number' && opts.idleMs > 0 ? opts.idleMs : DEFAULT_IDLE_MS
  armIdle()

  // Phase 2 — wait for the project to actually open (the renderer boots + pulls bootOpenWork after the MCP binds).
  const projDeadline = Date.now() + 20_000
  while (Date.now() < projDeadline) {
    try {
      const t = textOf(await proxySandbox('currentProject', {}))
      if (t && t !== 'null' && t.includes('root')) return { ok: true, project: opts.projectPath }
    } catch {
      /* not answering yet */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return { ok: true, project: opts.projectPath, error: 'sandbox is up but the project did not confirm open in 20s — captures may need a retry' }
}

/**
 * SYNCHRONOUS reap of THIS process's sandbox — for `process.on('exit'|'SIGINT'|'SIGTERM')`, which can't await the
 * async teardown. A detached+unref'd sandbox otherwise outlives us into a zombie holding its port. Best-effort.
 */
export function killSandboxNow(): void {
  const pid = sandbox?.pid
  sandbox = null
  client = null
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (pid && alive(pid)) { try { process.kill(pid) } catch { /* already gone */ } }
}

/**
 * Startup sweep: reap sandbox processes ORPHANED by a prior crash / force-quit. Each handshake file is
 * `nvs-sandbox-<spawnerPid>-<seq>.json`; if the SPAWNER (the app that made it) is gone, the sandbox it left is an
 * orphan → kill it and drop the stale file. A spawner still alive = another running instance → leave its sandbox
 * alone (multi-instance safe). This is the safety net for a hard crash where no exit handler could run.
 */
export function sweepOrphanSandboxes(): void {
  let files: string[]
  try {
    files = readdirSync(tmpdir())
  } catch {
    return
  }
  for (const f of files) {
    const m = /^nvs-sandbox-(\d+)-\d+\.json$/.exec(f)
    if (!m) continue
    if (alive(Number(m[1]))) continue // its spawner (another instance) is still running — not ours to reap
    const path = join(tmpdir(), f)
    const cfg = readLive(path) // non-null ⇒ the sandbox process is STILL alive (an orphan) → kill it
    if (cfg) { try { process.kill(cfg.pid) } catch { /* already gone */ } }
    try { unlinkSync(path) } catch { /* already gone */ }
  }
}

/** Tear the sandbox down now (kills the hidden process). Idempotent. */
export async function closeSandbox(): Promise<{ ok: boolean; closed: boolean }> {
  const pid = sandbox?.pid
  await teardown()
  if (pid && alive(pid)) {
    try {
      process.kill(pid)
    } catch {
      /* already exited */
    }
    return { ok: true, closed: true }
  }
  return { ok: true, closed: false }
}
