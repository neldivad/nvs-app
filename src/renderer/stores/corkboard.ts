/**
 * Corkboard store — small + isolated (deliberately NOT part of the big workspace store, which is undo-subscribed).
 * Holds the whole `.nvs/corkboard.json` file; the panel and the board-select sidebar both read from here so they
 * stay in sync. Writes are debounced whole-file saves (a board is small; boards are capped).
 *
 * UNDO/REDO — a page-level history (past/future snapshots of the whole file), wired to the app's ⌘Z stack via
 * `useUndoTarget` in the panel. `epoch` bumps ONLY on undo/redo so the canvas re-seeds from the restored state
 * (same-board content edits don't remount it — those are self-driven saves). `updateActiveBoard` no-ops when the
 * board is unchanged, so a post-undo canvas re-save can't pollute history or clear the redo stack.
 */
import { create } from 'zustand'
import { MAX_CORKBOARDS, type CorkBoard, type CorkboardFile } from '@shared/ipc'

const HIST_CAP = 30
const newBoard = (n: number): CorkBoard => ({ id: crypto.randomUUID(), name: `Board ${n}`, cards: [], edges: [] })

let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist(file: CorkboardFile): CorkboardFile {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.nvs.saveCorkboard(file), 300)
  return file
}

interface CorkboardStore {
  file: CorkboardFile | null
  epoch: number // bumped on undo/redo → the canvas re-seeds from the restored file
  past: CorkboardFile[]
  future: CorkboardFile[]
  load: () => Promise<void>
  activeBoard: () => CorkBoard | undefined
  setActive: (id: string) => void
  addBoard: () => void
  renameBoard: (id: string, name: string) => void
  deleteBoard: (id: string) => void
  updateActiveBoard: (board: CorkBoard) => void // canvas → store (cards/edges edited)
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/** Snapshot the current file into `past` (capped) and clear `future` — the history bookkeeping every content edit shares. */
const historied = (s: CorkboardStore): Pick<CorkboardStore, 'past' | 'future'> => ({
  past: s.file ? [...s.past, s.file].slice(-HIST_CAP) : s.past,
  future: []
})

export const useCorkboard = create<CorkboardStore>((set, get) => ({
  file: null,
  epoch: 0,
  past: [],
  future: [],
  load: async () => {
    const f = await window.nvs.corkboard()
    if (f.boards.length === 0) {
      const board = newBoard(1)
      set({ file: persist({ ...f, activeId: board.id, boards: [board] }), past: [], future: [], epoch: 0 })
    } else {
      set({ file: f, past: [], future: [], epoch: 0 })
    }
  },
  activeBoard: () => {
    const f = get().file
    return f ? f.boards.find((b) => b.id === f.activeId) ?? f.boards[0] : undefined
  },
  // board-switch is navigation, not a content edit → no history entry
  setActive: (id) => set((s) => (s.file ? { file: persist({ ...s.file, activeId: id }) } : s)),
  addBoard: () =>
    set((s) => {
      if (!s.file || s.file.boards.length >= MAX_CORKBOARDS) return s
      const board = newBoard(s.file.boards.length + 1)
      return { file: persist({ ...s.file, boards: [...s.file.boards, board], activeId: board.id }), ...historied(s) }
    }),
  renameBoard: (id, name) =>
    set((s) => (s.file ? { file: persist({ ...s.file, boards: s.file.boards.map((b) => (b.id === id ? { ...b, name: name.trim() || b.name } : b)) }), ...historied(s) } : s)),
  deleteBoard: (id) =>
    set((s) => {
      if (!s.file) return s
      const boards = s.file.boards.filter((b) => b.id !== id)
      const activeId = s.file.activeId === id ? boards[0]?.id : s.file.activeId
      return { file: persist({ ...s.file, boards, activeId }), ...historied(s) }
    }),
  updateActiveBoard: (board) =>
    set((s) => {
      if (!s.file) return s
      const current = s.file.boards.find((b) => b.id === board.id)
      if (current && JSON.stringify(current) === JSON.stringify(board)) return s // no real change → no write, no history
      return { file: persist({ ...s.file, boards: s.file.boards.map((b) => (b.id === board.id ? board : b)) }), ...historied(s) }
    }),
  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1]
      if (!prev || !s.file) return s
      return { file: persist(prev), past: s.past.slice(0, -1), future: [...s.future, s.file], epoch: s.epoch + 1 }
    }),
  redo: () =>
    set((s) => {
      const next = s.future[s.future.length - 1]
      if (!next || !s.file) return s
      return { file: persist(next), future: s.future.slice(0, -1), past: [...s.past, s.file], epoch: s.epoch + 1 }
    }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0
}))
