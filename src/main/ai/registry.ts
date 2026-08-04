/**
 * The AI connections registry — the "credit-cards" model: a list of saved provider connections,
 * exactly one active (the router). Metadata persists in userData/ai-connections.json; secrets live
 * in the encrypted secrets store (keyed by connection id). Only the active connection ever fires.
 */
import { app } from 'electron'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_PROVIDERS } from '@shared/config/aiProviders'
import type { AiConnection, AiState, SaveConnectionInput } from '@shared/ipc'
import { deleteSecret, getSecret, hasSecret, setSecret } from './secrets'

interface StoredConn {
  id: string
  type: AiConnection['type']
  label: string
  model: string
}
interface Stored {
  connections: StoredConn[]
  activeId: string | null
  analysisId: string | null // dedicated ANALYSIS connection (scene/window/coherence passes); null = follow active
}

/** userData dir — falls back when there's no electron `app` (headless ELECTRON_RUN_AS_NODE runs, e.g.
 *  `analysis:headless` driven from Cowork) so keyless/plan connections work outside the GUI. */
function userDataDir(): string {
  try {
    return app.getPath('userData')
  } catch {
    /* headless (ELECTRON_RUN_AS_NODE) — no app */
  }
  return process.env.NVS_USER_DATA || join(homedir(), '.config', 'nvs')
}

function file(): string {
  return join(userDataDir(), 'ai-connections.json')
}

/** Keyless connections (the 'plan' host) auth via Claude Code login, not a stored key. */
function keyless(type: AiConnection['type']): boolean {
  return !!AI_PROVIDERS[type].keyless
}

let cache: Stored | null = null

function load(): Stored {
  if (cache) return cache
  try {
    if (existsSync(file())) {
      const d = JSON.parse(readFileSync(file(), 'utf8'))
      cache = {
        connections: Array.isArray(d.connections) ? d.connections : [],
        activeId: typeof d.activeId === 'string' ? d.activeId : null,
        analysisId: typeof d.analysisId === 'string' ? d.analysisId : null
      }
    } else cache = { connections: [], activeId: null, analysisId: null }
  } catch {
    cache = { connections: [], activeId: null, analysisId: null }
  }
  return cache
}

function persist(s: Stored): void {
  cache = s
  try {
    mkdirSync(userDataDir(), { recursive: true })
    writeFileSync(file(), JSON.stringify(s, null, 2))
  } catch {
    /* best-effort */
  }
}

/** Public shape — connections enriched with hasSecret + derived status. */
export function getState(): AiState {
  const s = load()
  return {
    activeId: s.activeId,
    analysisId: s.analysisId,
    connections: s.connections.map((c) => {
      const has = hasSecret(c.id)
      const ready = has || keyless(c.type) // keyless = ready without a stored key
      const status: AiConnection['status'] = c.id === s.activeId ? 'active' : ready ? 'ready' : 'needs-key'
      return { id: c.id, type: c.type, label: c.label, model: c.model, hasSecret: has, secretLen: getSecret(c.id)?.length ?? 0, status }
    })
  }
}

export function saveConnection(input: SaveConnectionInput): AiState {
  const s = load()
  const model = input.model?.trim() || AI_PROVIDERS[input.type].defaultModel
  let id = input.id
  if (id) {
    const c = s.connections.find((x) => x.id === id)
    if (c) {
      c.type = input.type
      c.label = input.label
      c.model = model
    }
  } else {
    id = randomUUID()
    s.connections.push({ id, type: input.type, label: input.label, model })
  }
  if (input.secret) setSecret(id, input.secret)
  // Convenience: the first usable connection (key saved, or keyless) becomes active.
  if (!s.activeId && (hasSecret(id) || keyless(input.type))) s.activeId = id
  persist(s)
  return getState()
}

export function removeConnection(id: string): AiState {
  const s = load()
  s.connections = s.connections.filter((c) => c.id !== id)
  if (s.activeId === id) s.activeId = null
  if (s.analysisId === id) s.analysisId = null
  deleteSecret(id)
  persist(s)
  return getState()
}

export function setActiveConnection(id: string | null): AiState {
  const s = load()
  // Only a usable connection may be active (the router invariant): it exists and either has a
  // stored key or is keyless (plan host auths via Claude Code login).
  const c = id ? s.connections.find((x) => x.id === id) : null
  s.activeId = c && (hasSecret(c.id) || keyless(c.type)) ? c.id : null
  persist(s)
  return getState()
}

/** Pin (or clear) the dedicated analysis connection — same usability invariant as active. */
export function setAnalysisConnection(id: string | null): AiState {
  const s = load()
  const c = id ? s.connections.find((x) => x.id === id) : null
  s.analysisId = c && (hasSecret(c.id) || keyless(c.type)) ? c.id : null
  persist(s)
  return getState()
}

function resolve(c: StoredConn | undefined): { type: AiConnection['type']; model: string; secret: string } | null {
  if (!c) return null
  if (keyless(c.type)) return { type: c.type, model: c.model, secret: '' }
  const secret = getSecret(c.id)
  if (!secret) return null
  return { type: c.type, model: c.model, secret }
}

/** The active connection + its secret — what the agent runner uses. Keyless hosts (plan) return an
 *  empty secret; key providers return null when no key is stored. */
export function getActive(): { type: AiConnection['type']; model: string; secret: string } | null {
  const s = load()
  if (!s.activeId) return null
  return resolve(s.connections.find((x) => x.id === s.activeId))
}

/** The ANALYSIS connection — the scene/window/coherence readers route here. Unified with the ACTIVE
 *  connection (ruling 2026-07-18): one connection drives both chat and analysis ("like saved cards"), so
 *  there's a single per-connection button. The separate analysis pin was one knob too many. (`analysisId`
 *  stays in the schema, ignored — a later reintroduction of a dedicated analysis model can revive it.) */
export function getAnalysis(): { type: AiConnection['type']; model: string; secret: string } | null {
  return getActive()
}
