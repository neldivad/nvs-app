/**
 * Pro entitlement (Autumn lifetime) — a machine-local `pro` flag, architecture-agnostic.
 *
 * The app NEVER holds the Autumn secret. Verification is PLUGGABLE: a tiny proxy you deploy separately (holds
 * the Autumn secret) answers "does this email have `pro`?" over HTTP. We cache the result in userData and, if
 * an email is on file, re-verify on startup — but a cached Pro keeps working OFFLINE (the cache is trusted;
 * the proxy is only consulted to gain/lose Pro, not to keep it). A dev override (NVS_PRO=1) forces Pro so the
 * gated feature (the prettier export theme) is testable before the proxy exists. Pro = the theme; files are
 * never gated. See internal/pro-identity.md.
 */
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Entitlement } from '@shared/ipc'

const PROXY = process.env.NVS_PRO_PROXY // e.g. https://…/verify — your deployed Autumn-verify proxy (email → {pro})

function file(): string {
  return join(app.getPath('userData'), 'entitlement.json')
}
function read(): Entitlement {
  try {
    if (!existsSync(file())) return { pro: false, email: null, verifiedAt: null }
    return { pro: false, email: null, verifiedAt: null, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Entitlement>) }
  } catch {
    return { pro: false, email: null, verifiedAt: null }
  }
}
function write(e: Entitlement): void {
  try {
    writeFileSync(file(), JSON.stringify(e, null, 2), 'utf8')
  } catch {
    /* best-effort — a locked file just means Pro isn't remembered next launch */
  }
}

/** The effective flag everything gates on. Dev override wins; otherwise the cached entitlement (trusted offline). */
export function isPro(): boolean {
  return process.env.NVS_PRO === '1' || read().pro
}
export function getEntitlement(): Entitlement {
  return read()
}

/** Verify an email against the Autumn proxy → cache the result. No proxy configured → no-op (dev uses NVS_PRO=1).
 *  Offline / proxy-down → keep the cached entitlement (Pro survives offline; it's only lost on a definitive `false`). */
export async function verifyPro(email: string): Promise<Entitlement> {
  if (!PROXY || !email) return read()
  try {
    const res = await fetch(PROXY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
    if (!res.ok) return read()
    const data = (await res.json()) as { pro?: boolean }
    const e: Entitlement = { pro: !!data.pro, email, verifiedAt: new Date().toISOString() }
    write(e)
    return e
  } catch {
    return read()
  }
}

/** Re-verify on startup if we have an email on file (fire-and-forget; keeps Pro fresh without blocking launch). */
export function refreshEntitlement(): void {
  const e = read()
  if (e.email) void verifyPro(e.email)
}

/** Dev/QA toggle — force the flag without a purchase (paired with NVS_PRO=1 for env-level forcing). */
export function setProDev(pro: boolean): Entitlement {
  const e: Entitlement = { pro, email: read().email, verifiedAt: new Date().toISOString() }
  write(e)
  return e
}
