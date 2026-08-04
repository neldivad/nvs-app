/**
 * Hotkeys — the single source of truth for the app's keyboard shortcuts: both the canonical key(s) that
 * trigger each one AND its display string. Import HOTKEYS wherever a shortcut is BOUND (CommandPalette,
 * AppShell) or SHOWN (the TitleBar search hint), so no component hardcodes "Ctrl P" and the on-screen hint
 * can never drift from the real binding.
 */
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

export interface Hotkey {
  codes: string[] // KeyboardEvent.code values that trigger it (aliases allowed, e.g. KeyK OR KeyP)
  mod: boolean // requires the platform command modifier (⌘ on mac, Ctrl elsewhere)
  display: string // platform-aware label to render in hints / kbd chips
}

function label(mod: boolean, key: string): string {
  if (!mod) return key
  return IS_MAC ? `⌘${key}` : `Ctrl ${key}`
}

/** Platform-aware "mod + key" label (⌘F / Ctrl F) for a shortcut that ISN'T in the HOTKEYS registry — e.g. a
 *  component-local key (⌘F find is handled per-editor, not the global dispatcher) that still wants a consistent
 *  hint. Prefer HOTKEYS.<name>.display for registry shortcuts; use this only for the local ones. */
export function modLabel(key: string): string {
  return label(true, key)
}

export const HOTKEYS = {
  search: { codes: ['KeyK', 'KeyP'], mod: true, display: label(true, 'K') }, // ⌘K primary, ⌘P legacy alias
  // Pane help — F8 on EVERY pane (was F1, which now collides with the first page tab). One flag, one key app-wide.
  paneHelp: { codes: ['F8'], mod: false, display: label(false, 'F8') },
  // F1–F5 switch the ACTIVE page's tab (scene/world write·preview·source → F1–F3; custody
  // chart·records·write·preview·source → F1–F5). Paged surfaces register a tab target (PageShell); AppShell maps
  // the key to its index. Capped at F5 (the most tabs any pane has) so F8 stays free for pane help.
  pageTab: { codes: ['F1', 'F2', 'F3', 'F4', 'F5'], mod: false, display: 'F1–F5' },
  // ⌘S saves the ACTIVE page — scene, world, custody records/source… Pages register a save target while
  // mounted (lib/saveTarget.ts); AppShell binds the key ONCE and dispatches to the top of that stack.
  save: { codes: ['KeyS'], mod: true, display: label(true, 'S') },
  // ⌘, — the universal "settings" chord; opens Project Structure (the setup surface). The project actions
  // also live as an always-visible cluster at the left-rail bottom (out of the header menu).
  projectConfig: { codes: ['Comma'], mod: true, display: label(true, ',') },
  // ⌘Z / ⇧⌘Z (or ⌘Y) — page-level history via the editTarget stack (lib/saveTarget.ts). Native editables
  // (TipTap, CodeMirror, inputs) keep their own text undo; the dispatcher skips them (see AppShell).
  undo: { codes: ['KeyZ'], mod: true, display: label(true, 'Z') },
  redo: { codes: ['KeyY'], mod: true, display: label(true, 'Y') },
  // Composition mode — hide all chrome, just the page. Toggle in; Escape (or the same chord) exits. Requires
  // SHIFT so it clears CodeMirror's ⌘D (select-next-occurrence) — writers keep multi-cursor in the editor.
  compose: { codes: ['KeyD'], mod: true, display: IS_MAC ? '⌘⇧D' : 'Ctrl ⇧ D' }
} satisfies Record<string, Hotkey>
