/**
 * Encrypted at-rest store for connection secrets (API keys), keyed by connection id.
 *
 * One encrypted blob holding an { id → key } map (safeStorage; falls back to plaintext bytes on a
 * box without an OS keyring). Secrets never reach the renderer — only main reads them, and only the
 * agent runner consumes them. Replaces the single-key keystore now that we have many connections.
 */
import { app, safeStorage } from 'electron'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'


function userDataDir(): string {
  try { return app.getPath('userData') } catch { /* headless (ELECTRON_RUN_AS_NODE) — no app */ }
  return process.env.NVS_USER_DATA || join(homedir(), '.config', 'nvs')
}

function secretsFile(): string {
  return join(userDataDir(), 'ai-secrets.bin')
}

/** Is OS-keyring encryption usable? `safeStorage` is UNDEFINED under ELECTRON_RUN_AS_NODE (the headless
 *  analysis/mcp runners) — guard it so we degrade to the documented plaintext fallback instead of throwing
 *  (`Cannot read properties of undefined (reading 'isEncryptionAvailable')`). Also false on a keyring-less box. */
function encAvailable(): boolean {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function readAll(): Record<string, string> {
  if (!existsSync(secretsFile())) return {}
  try {
    const blob = readFileSync(secretsFile())
    const json = encAvailable() ? safeStorage.decryptString(blob) : blob.toString('utf8')
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeAll(map: Record<string, string>): void {
  mkdirSync(userDataDir(), { recursive: true })
  const json = JSON.stringify(map)
  const blob = encAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')
  writeFileSync(secretsFile(), blob)
}

export function hasSecret(id: string): boolean {
  return !!readAll()[id]
}

export function setSecret(id: string, key: string): void {
  const trimmed = key.trim()
  if (!trimmed) return
  const map = readAll()
  map[id] = trimmed
  writeAll(map)
}

export function deleteSecret(id: string): void {
  const map = readAll()
  if (id in map) {
    delete map[id]
    writeAll(map)
  }
}

/** Internal — only the agent runner calls this. Never exposed over IPC. */
export function getSecret(id: string): string | null {
  return readAll()[id] ?? null
}
