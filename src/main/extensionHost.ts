/**
 * Extension host — install, spawn, supervise out-of-process extensions (internal/extensions.md,
 * internal/host-api.md §handshake, Carla patterns in gh/NOTES.md).
 *
 * Trust model in one line: the extension is a child process that can ONLY talk over its stdio pipe, and
 * the host answers only the methods covered by capabilities that were (a) declared in its manifest,
 * (b) checked by checkManifest at install, (c) granted and persisted. It never gets fs/db/engine access.
 *
 * Supervision (Carla's bridge, scaled to us):
 *  - handshake: checkManifest BEFORE spawn; after spawn the child must answer `hello` with `ready`
 *    within INIT_TIMEOUT or it's killed ("crashed on initialization?").
 *  - liveness: ping every PING_EVERY; no message of any kind for SILENCE_LIMIT → unresponsive, killed.
 *  - honesty: a crash is surfaced as a crash ("exited mid-run (code 1)") — never silently restarted.
 *
 * Layout: installed extensions live in userData/extensions/<id>/ (manifest + entry, copied on install);
 * grants in userData/extensions/extensions.json. Bundled samples ship in resources/sample-extension.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as engine from '@engine/index'
import { checkManifest, ENGINE_API, type CapabilityManifest } from '@engine/hostApi'
import type { ExtensionInfo, ExtensionStatus, HandshakeResult } from '@shared/ipc'

const INIT_TIMEOUT = 5000
const PING_EVERY = 2500
const SILENCE_LIMIT = 8000

let EXT_DIR = '' // userData/extensions
let BUNDLED_DIRS: string[] = [] // dirs each containing one bundled extension (manifest.json + entry)

export function setExtensionPaths(userExtensionsDir: string, bundledDirs: string[]): void {
  EXT_DIR = userExtensionsDir
  BUNDLED_DIRS = bundledDirs
}

interface FullManifest extends CapabilityManifest {
  name?: string
  description?: string
  version?: string
  kind?: string
  run?: { type: string; entry: string }
  contributes?: import('@shared/ipc').ExtensionContributions // ambient (ui) contributions, no subprocess
  panel?: string // an active extension's running-UI entry file (e.g. "panel.html") — served over nvs-ext://, hosted in a sandboxed iframe
}

function readManifest(dir: string): FullManifest | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as FullManifest
  } catch {
    return null
  }
}

function grantsPath(): string {
  return join(EXT_DIR, 'extensions.json')
}

interface Grant {
  granted: string[]
  installedAt: string
  enabled?: boolean // absent = enabled (default on); an ambient extension's effect / an active one's availability
}

function readGrants(): Record<string, Grant> {
  try {
    return JSON.parse(readFileSync(grantsPath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeGrants(grants: Record<string, Grant>): void {
  mkdirSync(EXT_DIR, { recursive: true })
  writeFileSync(grantsPath(), JSON.stringify(grants, null, 2))
}

/** Everything the Extensions tab shows: bundled + installed, each with its handshake verdict. */
export function listExtensions(): ExtensionInfo[] {
  const grants = readGrants()
  const seen = new Set<string>()
  const infos: ExtensionInfo[] = []
  const add = (dir: string, source: 'bundled' | 'installed'): void => {
    const m = readManifest(dir)
    if (!m || seen.has(m.id)) return
    seen.add(m.id)
    const check = checkManifest(m)
    infos.push({
      id: m.id,
      name: m.name ?? m.id,
      description: m.description,
      version: m.version ?? '0.0.0',
      kind: m.kind ?? 'integration',
      capabilities: m.capabilities,
      installed: m.id in grants || source === 'installed',
      enabled: (grants[m.id]?.enabled ?? true), // default on; only meaningful once installed
      contributes: m.contributes,
      panel: m.panel, // a running-UI panel the app hosts in a sandboxed iframe (served over nvs-ext://)
      check: check.ok ? { ok: true } : { ok: false, reasons: check.reasons },
      running: running.get(m.id)?.status.state === 'running' || running.get(m.id)?.status.state === 'starting'
    })
  }
  if (EXT_DIR && existsSync(EXT_DIR)) {
    for (const entry of readdirSync(EXT_DIR)) {
      const p = join(EXT_DIR, entry)
      try {
        if (existsSync(join(p, 'manifest.json'))) add(p, 'installed')
      } catch {
        /* skip unreadable — the library-scan rule */
      }
    }
  }
  for (const dir of BUNDLED_DIRS) add(dir, 'bundled')
  return infos
}

/** The on-disk dir for an extension id — its installed copy (userData) if present, else the bundled source.
 *  The nvs-ext:// protocol serves an extension's declared UI panel (+ its assets) from here, path-guarded. */
export function extensionDir(id: string): string | null {
  const inst = join(EXT_DIR, id)
  if (existsSync(join(inst, 'manifest.json'))) return inst
  return BUNDLED_DIRS.find((d) => readManifest(d)?.id === id) ?? null
}

/** Dotted-version compare: is `a` strictly newer than `b`? Missing/garbage segments count as 0. */
function versionGt(a: string | undefined, b: string | undefined): boolean {
  const pa = (a ?? '0').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = (b ?? '0').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

/**
 * On boot, re-sync any INSTALLED bundled extension whose BUNDLED version is newer than the installed copy. Installed
 * copies live in userData and otherwise pin to whatever shipped at install time — so a later change to a bundled
 * sample (the sprint-timer gaining `panel.html`, 2026-07-20) never reached users who'd already installed it, and the
 * store showed a stale extension. Keeps the persisted grant + enabled flag; only refreshes the files. User-installed
 * (non-bundled) extensions are never touched. Bump a bundled sample's `version` to push an update.
 */
export function refreshBundledInstalls(): void {
  if (!EXT_DIR) return
  const bundled = new Map<string, { dir: string; version?: string }>()
  for (const d of BUNDLED_DIRS) {
    const m = readManifest(d)
    if (m) bundled.set(m.id, { dir: d, version: m.version })
  }
  for (const id of Object.keys(readGrants())) {
    const inst = join(EXT_DIR, id)
    const src = bundled.get(id)
    if (!src || !existsSync(join(inst, 'manifest.json'))) continue // only bundled installs we manage
    if (versionGt(src.version, readManifest(inst)?.version)) {
      try {
        rmSync(inst, { recursive: true, force: true })
        cpSync(src.dir, inst, { recursive: true }) // grant in extensions.json is untouched
      } catch {
        /* locked/read-only — harmless; next boot retries */
      }
    }
  }
}

/** Install = handshake, then copy into userData and persist the grant. Refusals carry the reasons. */
export function installExtension(id: string): HandshakeResult {
  const src = BUNDLED_DIRS.map((d) => ({ d, m: readManifest(d) })).find((x) => x.m?.id === id)
  if (!src?.m) return { ok: false, reasons: [`no bundled extension "${id}"`] }
  const check = checkManifest(src.m)
  if (!check.ok) return check
  const dest = join(EXT_DIR, id)
  mkdirSync(dest, { recursive: true })
  cpSync(src.d, dest, { recursive: true })
  const grants = readGrants()
  grants[id] = { granted: check.granted, installedAt: new Date().toISOString(), enabled: true }
  writeGrants(grants)
  return check
}

/** Enable/disable an installed extension WITHOUT uninstalling (VSCode-style). For ambient (ui) extensions this
 *  turns the effect on/off; for active ones it gates availability. A disabled running extension is stopped. */
export function setExtensionEnabled(id: string, enabled: boolean): void {
  const grants = readGrants()
  if (!grants[id]) return // not installed — nothing to toggle
  grants[id] = { ...grants[id], enabled }
  writeGrants(grants)
  if (!enabled) stopExtension(id) // don't leave a disabled extension running
}

/** Uninstall = stop it, drop its grant, and remove the copied-in files. A bundled sample reverts to
 *  "not installed" (its resources copy stays, re-installable); a user extension's userData copy is deleted. */
export function uninstallExtension(id: string): void {
  stopExtension(id)
  const grants = readGrants()
  delete grants[id]
  writeGrants(grants)
  const dir = join(EXT_DIR, id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

// ── The capability router: pipe method → (capability that covers it, engine call) ──────────────────
// A call is answered ONLY if its capability is in the extension's persisted grant. This is the entire
// enforcement surface for v1 (process has no other channel to us; OS-level fs confinement is later).
// `cap` may be a function of the call's args: writeTier's needed capability comes FROM THE PAYLOAD
// (`write:tier:t2:scene/1`), which is what "a producer may only write the tier it declared" means in code.
const METHODS: Record<
  string,
  { cap: string | ((args: Record<string, unknown>) => string); run: (args: Record<string, unknown>) => unknown }
> = {
  listScenes: { cap: 'read:scenes/1', run: () => engine.listScenes() },
  readScene: { cap: 'read:scenes/1', run: (a) => engine.readScene(String(a.path)) },
  listStoryTree: { cap: 'read:story/1', run: () => engine.listStoryTree() },
  currentProject: { cap: 'read:project/1', run: () => engine.currentProject() },
  // the producer surface (internal/host-api.md): list targets + staleness, read T1 dialogue, derive the
  // provenance hash, and write the declared tier through the validating engine writer
  tierStatus: { cap: 'read:tiers/1', run: () => engine.listTierStatus() },
  sceneDialogue: { cap: 'read:tiers/1', run: (a) => engine.sceneDialogue(String(a.unitId)) },
  tierInputHash: {
    cap: 'read:tiers/1',
    run: (a) => engine.tierInputHash(a.kind as never, String(a.targetId), (a.asOf as string | null) ?? null)
  },
  writeTier: {
    cap: (a) => `write:tier:${a.tier}:${a.kind}/1`,
    run: (a) => engine.writeTier(a as never)
  }
}

// ── Supervision ─────────────────────────────────────────────────────────────────────────────────────
interface Running {
  child: ChildProcess
  status: ExtensionStatus
  lastHeard: number
  pinger: ReturnType<typeof setInterval> | null
  buf: string
}

const running = new Map<string, Running>()

function finish(id: string, state: ExtensionStatus['state'], message?: string): void {
  const r = running.get(id)
  if (!r) return
  if (r.pinger) clearInterval(r.pinger)
  r.pinger = null
  if (r.status.state === 'running' || r.status.state === 'starting') {
    r.status.state = state
    if (message) r.status.error = message
  }
  try {
    r.child.kill()
  } catch {
    /* already gone */
  }
}

export function extensionStatus(id: string): ExtensionStatus | null {
  return running.get(id)?.status ?? null
}

export function stopExtension(id: string): void {
  const r = running.get(id)
  if (!r) return
  try {
    r.child.stdin?.write(JSON.stringify({ type: 'stop' }) + '\n')
  } catch {
    /* pipe gone */
  }
  setTimeout(() => finish(id, 'stopped'), 500)
}

/** Spawn under supervision. Uses the app's own binary as node (ELECTRON_RUN_AS_NODE) — no node needed. */
export function startExtension(id: string, params?: Record<string, unknown>): ExtensionStatus {
  const prior = running.get(id)
  if (prior && (prior.status.state === 'running' || prior.status.state === 'starting')) return prior.status

  const dir = join(EXT_DIR, id)
  const manifest = readManifest(dir)
  const grants = readGrants()[id]
  const status: ExtensionStatus = { id, state: 'starting', startedAt: Date.now() }
  if (!manifest || !grants) {
    return { ...status, state: 'crashed', error: 'not installed (no manifest/grant)' }
  }
  const entry = join(dir, manifest.run?.entry ?? 'main.cjs')

  const child = spawn(process.execPath, [entry], {
    cwd: dir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const r: Running = { child, status, lastHeard: Date.now(), pinger: null, buf: '' }
  running.set(id, r)

  const send = (msg: unknown): void => {
    try {
      child.stdin?.write(JSON.stringify(msg) + '\n')
    } catch {
      /* pipe gone — exit handler will settle state */
    }
  }

  // handshake, Carla-style: hello now; ready must arrive within INIT_TIMEOUT
  send({ type: 'hello', engineApi: ENGINE_API, granted: grants.granted, work: engine.currentProject()?.name ?? null })
  const initTimer = setTimeout(() => {
    if (r.status.state === 'starting') finish(id, 'crashed', `no ready within ${INIT_TIMEOUT}ms (crashed on initialization?)`)
  }, INIT_TIMEOUT)

  child.stdout?.on('data', (chunk: Buffer) => {
    r.lastHeard = Date.now()
    r.buf += chunk.toString('utf8')
    let nl
    while ((nl = r.buf.indexOf('\n')) >= 0) {
      const line = r.buf.slice(0, nl)
      r.buf = r.buf.slice(nl + 1)
      let msg: { type?: string; id?: number; method?: string; args?: Record<string, unknown>; payload?: unknown }
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.type === 'ready' && r.status.state === 'starting') {
        clearTimeout(initTimer)
        r.status.state = 'running'
        send({ type: 'start', ...(params ?? {}) })
      } else if (msg.type === 'call' && typeof msg.id === 'number') {
        const spec = METHODS[msg.method ?? '']
        const needed = spec ? (typeof spec.cap === 'function' ? spec.cap(msg.args ?? {}) : spec.cap) : ''
        if (!spec) send({ type: 'error', id: msg.id, message: `unknown method "${msg.method}"` })
        else if (!grants.granted.includes(needed))
          send({ type: 'error', id: msg.id, message: `"${msg.method}" needs ${needed} — not granted to this extension` })
        else {
          try {
            send({ type: 'result', id: msg.id, data: spec.run(msg.args ?? {}) })
          } catch (e) {
            send({ type: 'error', id: msg.id, message: String(e instanceof Error ? e.message : e) })
          }
        }
      } else if (msg.type === 'event') {
        r.status.lastEvent = msg.payload
      } else if (msg.type === 'done') {
        r.status.state = 'done'
        r.status.result = msg.payload
        if (r.pinger) clearInterval(r.pinger)
      }
      // pong needs no handling beyond lastHeard, already updated above
    }
  })

  child.stderr?.on('data', (c: Buffer) => console.warn(`[ext:${id}]`, c.toString().trim()))

  child.on('exit', (code) => {
    clearTimeout(initTimer)
    if (r.pinger) clearInterval(r.pinger)
    if (r.status.state === 'running' || r.status.state === 'starting') {
      // died without done/stop — the honest message, never a silent restart (Carla's rule)
      r.status.state = 'crashed'
      r.status.error = `exited mid-run (code ${code ?? 'signal'})`
    }
  })

  // liveness: ping regularly; total silence past the limit → unresponsive
  r.pinger = setInterval(() => {
    if (Date.now() - r.lastHeard > SILENCE_LIMIT) {
      finish(id, 'unresponsive', `no reply for ${SILENCE_LIMIT}ms — killed`)
      return
    }
    send({ type: 'ping' })
  }, PING_EVERY)

  return status
}
