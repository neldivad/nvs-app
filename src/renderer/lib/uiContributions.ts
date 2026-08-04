/**
 * UI-contribution applier — the renderer half of ambient (declarative) extensions.
 *
 * An active extension runs a subprocess; an ambient one (`kind: 'ui'`) just declares a `contributes` block
 * that the app applies while the extension is installed + enabled. v1 contribution: `editorFont` → the
 * manuscript font (`--font-editor`, consumed by .ProseMirror / .nvs-manuscript in globals.css).
 *
 * This is intentionally tiny and pull-based: whenever extensions change (install / uninstall / enable-toggle)
 * or the app mounts, call applyUiContributions() — it re-derives the active set from listExtensions and stamps
 * the CSS var on <html>. No subscriptions, no store coupling; the store just calls it after a mutation.
 */

/** Re-derive + apply all enabled ui contributions. Safe to call repeatedly (idempotent). */
export async function applyUiContributions(): Promise<void> {
  const exts = await window.nvs.listExtensions?.().catch(() => []) ?? []
  const active = exts.filter((x) => x.installed && x.enabled !== false && x.kind === 'ui')

  // Editor font: the last enabled contributor wins (deterministic; later install overrides earlier).
  const font = active.map((x) => x.contributes?.editorFont).filter(Boolean).pop()
  const root = document.documentElement
  if (font) root.style.setProperty('--font-editor', font.stack ?? `'${font.family}'`)
  else root.style.removeProperty('--font-editor') // fall back to the stylesheet default (var(--font-sans))
}
