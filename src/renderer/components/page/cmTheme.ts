/**
 * The app's CodeMirror look — ONE theme for every raw-markdown surface (scene Write/Source, custody
 * Source, future PageShell tabs). Extracted from SceneEditor as step 1 of the BasePage unification
 * (internal/pending.md): shared surfaces must share their pieces, or they drift.
 */
import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const cmTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--prose)' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': {
    maxWidth: 'var(--measure)', // the shared prose measure (globals.css) — matches block-write + preview
    margin: '0 auto',
    padding: '32px 28px',
    caretColor: 'var(--thread)',
    userSelect: 'text'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--thread)' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--panel-soft)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--panel-soft)' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  // Line-number gutter — NO strip: transparent, borderless, muted, and HIDDEN until the host reveals it (adds
  // `.reveal-gutter` on left-edge hover). Space is always reserved (opacity, not display) so text never shifts.
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--faint)' },
  '.cm-lineNumbers .cm-gutterElement': { color: 'var(--faint)', opacity: '0', transition: 'opacity 0.15s ease', paddingRight: '10px', fontSize: '11px', whiteSpace: 'nowrap' },
  '&.reveal-gutter .cm-lineNumbers .cm-gutterElement': { opacity: '0.55' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  // Find panel (⌘F, @codemirror/search) — themed to the app tokens so it flips light/dark instead of CM's
  // default white chrome, and reads as part of the editor.
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--foreground)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 10px', fontFamily: 'var(--font-sans)', fontSize: '12px' },
  '.cm-panel.cm-search label': { fontSize: '11px', color: 'var(--muted-foreground)' },
  '.cm-textfield': { backgroundColor: 'var(--canvas)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 6px' },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--thread)' },
  '.cm-button': { backgroundColor: 'var(--panel-soft)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: '4px', backgroundImage: 'none', padding: '2px 8px' },
  '.cm-button:hover': { backgroundColor: 'var(--border)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--muted-foreground)', cursor: 'pointer' },
  // Match highlights: all matches amber, the current one indigo (the app's find vs active-find accents).
  '.cm-searchMatch': { backgroundColor: 'var(--lore-bg)', outline: '1px solid var(--lore)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--thread-bg)', outline: '1px solid var(--thread)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--panel-soft)' }
})

// Markdown token styling so links / headings / emphasis read as such.
export const cmMdHighlight = HighlightStyle.define([
  { tag: t.link, color: 'var(--thread)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--faint)' },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], fontWeight: '600', color: 'var(--foreground)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--lore)' }
])
