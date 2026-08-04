/**
 * The LIVE-APP HANDSHAKE FILE — how the headless MCP server (a separate process, spawned by Claude) discovers a
 * running NVS app and hands off to it.
 *
 * The running app publishes `<userData>/mcp-live.json` while its HTTP server is up, and deletes it on shutdown.
 * The headless server is TOLD where that file is (`--live <path>`, baked in by the plugin generator) because it
 * runs under ELECTRON_RUN_AS_NODE, where `require('electron')` is just a path string — there is no `app.getPath`,
 * so it cannot resolve userData itself.
 *
 * The file carries the authenticated connect URL, so it holds a SECRET. That's why it lives in userData (same
 * protection as mcp-token.txt) and why the generated plugin zip only ever references its PATH — the zip itself
 * stays token-free and safe to hand around.
 *
 * Staleness: a hard kill leaves the file behind, so it also carries the app's `pid`; readers verify the process is
 * alive before trusting the URL.
 */
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

/** What the running app publishes. `pid` is the liveness proof; `url` embeds the auth token. */
export type LiveConfig = {
  url: string
  pid: number
  port: number
  /** Wall-clock stamp, diagnostics only — never used for decisions. */
  startedAt?: string
}

/** Publish the handshake file (app side, on listen). Best-effort: a failure here only costs the handoff. */
export function publishLive(path: string, cfg: LiveConfig): void {
  try {
    // Owner-only (0600): the url embeds the auth token, so this file is as sensitive as mcp-token.txt.
    // `mode` on writeFileSync only applies on CREATE, so chmod too — this file is rewritten every startup.
    writeFileSync(path, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 })
    chmodSync(path, 0o600)
  } catch {
    /* no handoff this session — the headless server just stays local */
  }
}

/** Remove the handshake file (app side, on stop/quit). */
export function unpublishLive(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Read the handshake file and return it ONLY if the publishing app is still alive (headless side).
 * `process.kill(pid, 0)` sends no signal — it just probes existence — so this costs nothing and needs no network.
 */
export function readLive(path: string): LiveConfig | null {
  try {
    if (!existsSync(path)) return null
    const cfg = JSON.parse(readFileSync(path, 'utf8')) as LiveConfig
    if (!cfg?.url || typeof cfg.pid !== 'number') return null
    try {
      process.kill(cfg.pid, 0)
    } catch {
      return null // stale file from a crashed app — treat as "no live app"
    }
    return cfg
  } catch {
    return null
  }
}
