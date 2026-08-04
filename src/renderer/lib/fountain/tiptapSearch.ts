/**
 * In-scene find for the TipTap block editor (#15 Part 2) — the scene Write view is ProseMirror, which has no
 * native search like CodeMirror, so this is a decoration plugin that highlights every match of a query and lets
 * you step through them. The React find bar (BlockEditor) drives it via the helpers below; the plugin owns the
 * match list + decorations and remaps them as the doc changes.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'

export const searchKey = new PluginKey('nvsSceneSearch')

interface Match { from: number; to: number }
interface SearchState { query: string; matches: Match[]; active: number; deco: DecorationSet }

/** All case-insensitive occurrences of `query`, as document positions (walks text nodes). */
function findMatches(doc: PMNode, query: string): Match[] {
  const out: Match[] = []
  const q = query.toLowerCase()
  if (!q) return out
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text.toLowerCase()
    let i = 0
    while ((i = text.indexOf(q, i)) !== -1) {
      out.push({ from: pos + i, to: pos + i + q.length })
      i += q.length
    }
  })
  return out
}

/** Highlight decorations — every match gets `.nvs-find`; the current one also `.nvs-find-active`. */
function buildDeco(doc: PMNode, matches: Match[], active: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === active ? 'nvs-find nvs-find-active' : 'nvs-find' }))
  )
}

/** What the find bar reads each render: the query, the total, and the 0-based current index. */
export interface SceneSearchInfo { query: string; count: number; active: number }
export function getSceneSearch(state: EditorState): SceneSearchInfo {
  const s = searchKey.getState(state) as SearchState | undefined
  return { query: s?.query ?? '', count: s?.matches.length ?? 0, active: s?.active ?? 0 }
}

/** Set (or clear, with '') the search query — recomputes matches and resets to the first. */
export function setSceneSearch(editor: Editor, query: string): void {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query }))
}

/** Scroll the current active match to the CENTER of the editor's scroll container. Done via the DOM (the
 *  decoration element) after paint — `tr.scrollIntoView()` proved unreliable inside the flex/overflow layout. */
function scrollActiveIntoView(editor: Editor): void {
  requestAnimationFrame(() => {
    const el = editor.view.dom.querySelector('.nvs-find-active')
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

/** Step to the next (`dir` +1) or previous (-1) match: wraps, selects it (cursor lands there on close), scrolls
 *  it to center. Focus stays wherever it was (the find input keeps typing focus). No-op with no matches. */
export function stepSceneSearch(editor: Editor, dir: 1 | -1): void {
  const s = searchKey.getState(editor.state) as SearchState | undefined
  if (!s || s.matches.length === 0) return
  const idx = (s.active + dir + s.matches.length) % s.matches.length
  const m = s.matches[idx]
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { active: idx }).setSelection(TextSelection.create(editor.state.doc, m.from, m.to)))
  scrollActiveIntoView(editor)
}

/** Scroll to the first match right after a query is set (so typing jumps you to it, not just highlights). */
export function scrollToActive(editor: Editor): void {
  scrollActiveIntoView(editor)
}

/** Match markers for the SearchMinimap: each match's vertical position as a doc fraction + whether it's current. */
export function sceneMarkers(editor: Editor): { pos: number; active: boolean }[] {
  const s = searchKey.getState(editor.state) as SearchState | undefined
  if (!s || !s.matches.length) return []
  const size = Math.max(1, editor.state.doc.content.size)
  return s.matches.map((m, i) => ({ pos: m.from / size, active: i === s.active }))
}

/** Jump to a specific match by index (a minimap tick click). */
export function gotoSceneSearch(editor: Editor, index: number): void {
  const s = searchKey.getState(editor.state) as SearchState | undefined
  if (!s || index < 0 || index >= s.matches.length) return
  const m = s.matches[index]
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { active: index }).setSelection(TextSelection.create(editor.state.doc, m.from, m.to)))
  scrollActiveIntoView(editor)
}

export const SceneSearch = Extension.create({
  name: 'nvsSceneSearch',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: '', matches: [], active: 0, deco: DecorationSet.empty }),
          apply(tr, value, _old, newState): SearchState {
            const meta = tr.getMeta(searchKey) as { query?: string; active?: number } | undefined
            if (meta?.query !== undefined) {
              const matches = findMatches(newState.doc, meta.query)
              return { query: meta.query, matches, active: 0, deco: buildDeco(newState.doc, matches, 0) }
            }
            if (meta?.active !== undefined) {
              return { ...value, active: meta.active, deco: buildDeco(newState.doc, value.matches, meta.active) }
            }
            // Doc edited while a search is live → re-find so highlights track the new text.
            if (tr.docChanged && value.query) {
              const matches = findMatches(newState.doc, value.query)
              const active = Math.min(value.active, Math.max(0, matches.length - 1))
              return { query: value.query, matches, active, deco: buildDeco(newState.doc, matches, active) }
            }
            if (tr.docChanged) return { ...value, deco: value.deco.map(tr.mapping, tr.doc) }
            return value
          }
        },
        props: {
          decorations(state) {
            return (searchKey.getState(state) as SearchState | undefined)?.deco ?? null
          }
        }
      })
    ]
  }
})
