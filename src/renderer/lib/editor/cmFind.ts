/**
 * CodeMirror find engine — a SELF-CONTAINED decoration highlighter for the shared <FindBar>, so world-page /
 * Source CM surfaces search exactly like the scene block editor (same `.nvs-find` / `.nvs-find-active` classes)
 * and NEVER show CodeMirror's native panel.
 *
 * Why not @codemirror/search's commands: `findNext`/`findPrevious` auto-open the native search PANEL when their
 * internal query state isn't "valid" (search dist L833) — that produced a SECOND search bar. So we own the state:
 * a StateField holds {query, matches, active} and provides the highlight decorations; navigation just moves the
 * selection (which auto-scrolls). We only borrow `SearchCursor` (a pure text scanner, no UI). The host must NOT
 * include `search()` or bind `searchKeymap`.
 */
import { StateField, StateEffect, type EditorState } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { SearchCursor } from '@codemirror/search'

interface Match { from: number; to: number }
interface FindState { query: string; matches: Match[]; active: number; deco: DecorationSet }

/** Set the query + active index; recomputes matches + highlights. */
const setFind = StateEffect.define<{ query: string; active: number }>()

const matchMark = Decoration.mark({ class: 'nvs-find' })
const activeMark = Decoration.mark({ class: 'nvs-find nvs-find-active' })

function findAll(state: EditorState, query: string): Match[] {
  const out: Match[] = []
  if (!query) return out
  const cur = new SearchCursor(state.doc, query, 0, state.doc.length, (s) => s.toLowerCase())
  while (!cur.next().done) out.push({ from: cur.value.from, to: cur.value.to })
  return out
}

function buildDeco(matches: Match[], active: number): DecorationSet {
  if (!matches.length) return Decoration.none
  return Decoration.set(matches.map((m, i) => (i === active ? activeMark : matchMark).range(m.from, m.to)))
}

const findField = StateField.define<FindState>({
  create: () => ({ query: '', matches: [], active: 0, deco: Decoration.none }),
  update(value, tr): FindState {
    let { query, matches, active, deco } = value
    let recompute = false
    for (const e of tr.effects) if (e.is(setFind)) { query = e.value.query; active = e.value.active; recompute = true }
    if (!recompute && tr.docChanged && query) recompute = true // edits while searching → re-find
    if (recompute) {
      matches = findAll(tr.state, query)
      active = matches.length ? Math.max(0, Math.min(active, matches.length - 1)) : 0
      deco = buildDeco(matches, active)
    } else if (tr.docChanged) {
      deco = deco.map(tr.changes)
      matches = matches.map((m) => ({ from: tr.changes.mapPos(m.from), to: tr.changes.mapPos(m.to) }))
    }
    return { query, matches, active, deco }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco)
})

/** The extension to add to a CM host so the FindBar can drive it. */
export const cmFindExtension = findField

/** The FindBar's counter reads this each step. */
export function cmFindInfo(view: EditorView): { count: number; active: number } {
  const s = view.state.field(findField, false)
  return { count: s?.matches.length ?? 0, active: s?.active ?? 0 }
}

function selectMatch(view: EditorView, m: Match): void {
  view.dispatch({ selection: { anchor: m.from, head: m.to } })
  // Smooth + centered scroll to MATCH the scene (TipTap) find, instead of CM's instant `scrollIntoView: true`.
  // `lineBlockAt` gives the match's offset even when off-screen (CM virtualizes), so we can animate scrollDOM.
  const block = view.lineBlockAt(m.from)
  const scroller = view.scrollDOM
  const target = block.top - Math.max(0, (scroller.clientHeight - block.height) / 2)
  scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
}

/** Set (or clear, with '') the query; jumps to the first match. */
export function cmSetQuery(view: EditorView, query: string): void {
  view.dispatch({ effects: setFind.of({ query, active: 0 }) })
  const s = view.state.field(findField, false)
  if (s?.matches.length) selectMatch(view, s.matches[0])
}

/** Next (+1) / previous (-1) match — wraps, selects, scrolls. */
export function cmStep(view: EditorView, dir: 1 | -1): void {
  const s = view.state.field(findField, false)
  if (!s || !s.matches.length) return
  const idx = (s.active + dir + s.matches.length) % s.matches.length
  view.dispatch({ effects: setFind.of({ query: s.query, active: idx }) })
  const m = view.state.field(findField, false)?.matches[idx]
  if (m) selectMatch(view, m)
}

/** Match markers for the SearchMinimap: each match's vertical position as a line fraction + whether it's current. */
export function cmMarkers(view: EditorView): { pos: number; active: boolean }[] {
  const s = view.state.field(findField, false)
  if (!s || !s.matches.length) return []
  const total = Math.max(1, view.state.doc.lines)
  return s.matches.map((m, i) => ({ pos: view.state.doc.lineAt(m.from).number / total, active: i === s.active }))
}

/** Jump to a specific match by index (a minimap tick click). */
export function cmGoto(view: EditorView, index: number): void {
  const s = view.state.field(findField, false)
  if (!s || index < 0 || index >= s.matches.length) return
  view.dispatch({ effects: setFind.of({ query: s.query, active: index }) })
  const m = view.state.field(findField, false)?.matches[index]
  if (m) selectMatch(view, m)
}

/** Clear the highlights (on close). */
export function cmClear(view: EditorView): void {
  view.dispatch({ effects: setFind.of({ query: '', active: 0 }) })
}
