/**
 * corkboard.ts — the `.nvs/corkboard.json` sidecar: the project's FREEFORM card boards (internal/corkboard.md).
 *
 * A corkboard is a domain-agnostic canvas the author fills by hand — cards (a note and/or an attached
 * scene/page/thread), free-drawn edges (AUTHORED visual links, NOT the leads_to graph), colors, positions. These
 * are authored-but-non-prose-and-non-derivable, so they live neither in frontmatter nor the analysis cache — this
 * sidecar is their durable home (part of the exportable project unit; survives re-analysis).
 *
 * Mirrors trees.ts: pure JSON I/O (unit-testable without Electron), version-stamped, defensive migrate → EMPTY on
 * anything corrupt. Whole-file read-modify-write (the renderer owns board/card editing); one board is small
 * (≤ MAX_CORKBOARD_CARDS) and boards are capped (≤ MAX_CORKBOARDS), so a whole-file write stays cheap.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CORKBOARD_VERSION, MAX_CORK_CARD_REFS, MAX_CORK_TITLE, type CorkboardFile, type CorkBoard, type CorkCard, type CorkEdge, type CorkNote, type CorkRef } from '@shared/ipc'

const EMPTY: CorkboardFile = { version: CORKBOARD_VERSION, activeId: undefined, boards: [] }

export function corkboardPath(workRoot: string): string {
  return join(workRoot, '.nvs', 'corkboard.json')
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

function sanitizeRef(raw: unknown): CorkRef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<CorkRef>
  return typeof r.id === 'string' && r.id && (r.kind === 'scene' || r.kind === 'page' || r.kind === 'thread')
    ? { kind: r.kind, id: r.id, ...(typeof r.label === 'string' ? { label: r.label } : {}), ...(str(r.pageKind) ? { pageKind: r.pageKind } : {}) }
    : null
}
function sanitizeNote(raw: unknown): CorkNote | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Partial<CorkNote>
  return typeof n.text === 'string'
    ? { id: str(n.id) ?? randomUUID(), text: n.text, ...(typeof n.createdAt === 'number' ? { createdAt: n.createdAt } : {}) }
    : null
}

/** Keep only well-formed cards — a corrupt board can't crash the canvas. Migrates any legacy single `note`/`ref`. */
function sanitizeCard(raw: unknown): CorkCard | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Partial<CorkCard> & { note?: unknown; ref?: unknown } // legacy single note/ref
  if (typeof c.id !== 'string' || !c.id) return null
  let notes = Array.isArray(c.notes) ? c.notes.map(sanitizeNote).filter((n): n is CorkNote => !!n) : []
  if (!notes.length && str(c.note)) notes = [{ id: randomUUID(), text: c.note as string }]
  let refs = Array.isArray(c.refs) ? c.refs.map(sanitizeRef).filter((r): r is CorkRef => !!r) : []
  if (!refs.length && c.ref) {
    const r = sanitizeRef(c.ref)
    if (r) refs = [r]
  }
  if (refs.length > MAX_CORK_CARD_REFS) refs = refs.slice(0, MAX_CORK_CARD_REFS)
  const title = str(c.title)?.slice(0, MAX_CORK_TITLE)
  return {
    id: c.id,
    x: num(c.x),
    y: num(c.y),
    ...(typeof c.w === 'number' ? { w: c.w } : {}),
    ...(typeof c.h === 'number' ? { h: c.h } : {}),
    ...(title ? { title } : {}),
    ...(str(c.color) ? { color: c.color } : {}),
    ...(notes.length ? { notes } : {}),
    ...(refs.length ? { refs } : {})
  }
}

/** Keep only edges whose endpoints are real card ids. */
function sanitizeEdges(raw: unknown, cardIds: Set<string>): CorkEdge[] {
  if (!Array.isArray(raw)) return []
  const out: CorkEdge[] = []
  for (const e of raw) {
    if (e && typeof e === 'object' && typeof (e as CorkEdge).id === 'string' && cardIds.has((e as CorkEdge).source) && cardIds.has((e as CorkEdge).target)) {
      out.push({ id: (e as CorkEdge).id, source: (e as CorkEdge).source, target: (e as CorkEdge).target })
    }
  }
  return out
}

function sanitizeBoard(raw: unknown): CorkBoard | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Partial<CorkBoard>
  if (typeof b.id !== 'string' || !b.id) return null
  const cards = (Array.isArray(b.cards) ? b.cards.map(sanitizeCard).filter((c): c is CorkCard => !!c) : [])
  const ids = new Set(cards.map((c) => c.id))
  return { id: b.id, name: str(b.name) ?? 'Board', cards, edges: sanitizeEdges(b.edges, ids) }
}

/** Forward-migrate any on-disk/legacy shape → the current `CorkboardFile`. Never throws; `activeId` is healed. */
export function migrateCorkboard(raw: unknown): CorkboardFile {
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  const r = raw as Partial<CorkboardFile>
  const boards = Array.isArray(r.boards) ? r.boards.map(sanitizeBoard).filter((b): b is CorkBoard => !!b) : []
  const activeId = r.activeId && boards.some((b) => b.id === r.activeId) ? r.activeId : boards[0]?.id
  return { version: CORKBOARD_VERSION, activeId, boards }
}

/** Read `.nvs/corkboard.json` (migrated), or EMPTY when absent/unreadable. */
export function readCorkboard(workRoot: string): CorkboardFile {
  const p = corkboardPath(workRoot)
  if (!existsSync(p)) return { ...EMPTY }
  try {
    return migrateCorkboard(JSON.parse(readFileSync(p, 'utf8')))
  } catch {
    return { ...EMPTY }
  }
}

/** Write `.nvs/corkboard.json` (creates `.nvs/` if needed), stamping the current version. */
export function writeCorkboard(workRoot: string, file: CorkboardFile): void {
  const p = corkboardPath(workRoot)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ ...migrateCorkboard(file), version: CORKBOARD_VERSION }, null, 2))
}

/** The active board (`activeId`, else the first), or undefined when there are none. */
export function activeBoard(file: CorkboardFile): CorkBoard | undefined {
  return file.activeId ? file.boards.find((b) => b.id === file.activeId) : file.boards[0]
}

// ── Agent read-shaping (skim → drill) ────────────────────────────────────────
// An agent perceives a board WITHOUT ingesting every note body (freeform, unbounded). Three altitudes mirror
// listStoryTree → search → readScene: boardsOverview (the map), boardSkeleton (nodes + edges, NO bodies), cardDetail
// (one card, full). A board is hard-capped at MAX_CORKBOARD_CARDS, so the skeleton is inherently bounded — the only
// unbounded surface is a single card's note thread, which appears only on the drill (cardDetail).
const SKIM_TITLE = 80

/** A card's fast-scan identity: its authored title, else the first line of its first note, truncated. */
function cardSkimTitle(c: CorkCard): string {
  if (c.title) return c.title
  const first = c.notes?.[0]?.text.split('\n', 1)[0]?.trim()
  return first ? first.slice(0, SKIM_TITLE) + (first.length > SKIM_TITLE ? '…' : '') : '(untitled)'
}

export interface BoardOverview { id: string; name: string; cardCount: number; edgeCount: number }
/** The MAP: every board's id + name + counts. Tiny; the agent picks which board to skim. */
export function boardsOverview(file: CorkboardFile): { boards: BoardOverview[]; activeId?: string } {
  return { activeId: file.activeId, boards: file.boards.map((b) => ({ id: b.id, name: b.name, cardCount: b.cards.length, edgeCount: b.edges.length })) }
}

/** The SKELETON: one board's node identities (title/color/degree/refs-as-chips) + authored edges. NO note bodies,
 *  NO geometry — so an agent reads the idea graph and its connections without the unbounded prose. */
export function boardSkeleton(file: CorkboardFile, boardId: string): { id: string; name: string; nodes: unknown[]; edges: { source: string; target: string }[] } | { error: string } {
  const b = file.boards.find((x) => x.id === boardId)
  if (!b) return { error: `no board with id "${boardId}" — call listBoards for the valid ids` }
  const degree = new Map<string, number>()
  for (const e of b.edges) { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1) }
  const nodes = b.cards.map((c) => ({
    id: c.id,
    title: cardSkimTitle(c),
    ...(c.color ? { color: c.color } : {}),
    noteCount: c.notes?.length ?? 0,
    ...(c.refs?.length ? { refs: c.refs.map((r) => ({ kind: r.kind, label: r.label ?? r.id })) } : {}),
    degree: degree.get(c.id) ?? 0
  }))
  return { id: b.id, name: b.name, nodes, edges: b.edges.map((e) => ({ source: e.source, target: e.target })) }
}

/** The DRILL: one card, FULL — all note bodies, refs (with their scene/page/thread ids so the agent can then read
 *  them), and neighbor titles. The only altitude that returns note text. */
export function cardDetail(file: CorkboardFile, boardId: string, cardId: string): unknown {
  const b = file.boards.find((x) => x.id === boardId)
  if (!b) return { error: `no board with id "${boardId}" — call listBoards for the valid ids` }
  const c = b.cards.find((x) => x.id === cardId)
  if (!c) return { error: `no card "${cardId}" on board "${b.name}" — call readBoard("${boardId}") for its card ids` }
  const neighbors: { id: string; title: string }[] = []
  for (const e of b.edges) {
    const otherId = e.source === cardId ? e.target : e.target === cardId ? e.source : null
    if (!otherId) continue
    const o = b.cards.find((x) => x.id === otherId)
    if (o) neighbors.push({ id: otherId, title: cardSkimTitle(o) })
  }
  return {
    id: c.id,
    title: c.title ?? cardSkimTitle(c),
    ...(c.color ? { color: c.color } : {}),
    notes: (c.notes ?? []).map((n) => n.text),
    ...(c.refs?.length ? { refs: c.refs.map((r) => ({ kind: r.kind, id: r.id, ...(r.label ? { label: r.label } : {}), ...(r.pageKind ? { pageKind: r.pageKind } : {}) })) } : {}),
    neighbors
  }
}
