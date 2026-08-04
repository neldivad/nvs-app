/**
 * cellLayout — the SELF-GENERATING layout for the Cell view (internal/cell-canvas.md ★). Turns a branch/merge
 * graph + its main sequence into a row/column grid that reads like a VN flowchart, the way the author described it:
 *
 *   • the SEQUENCE is the spine — a vertical line of cells, CENTER-weighted (col 0), so branches flank both sides;
 *   • a BRANCH (an off-spine chain that forks from the spine and dead-ends) lays TOP-DOWN from its fork;
 *   • a MERGE feeder (an off-spine chain that flows INTO a placed node) lays BOTTOM-UP from the merge, so the node
 *     feeding the merge sits directly ABOVE it (the "[pov1,pov2,pov3,main2] → main3" Baccano shape);
 *   • each chain takes its own COLUMN, alternating outward from center (+1,-1,+2,-2,…), first free wins → collisions
 *     (nested / parallel branches) get pushed to the next column;
 *   • OVERRIDES (author-dragged pins) reserve their cell first, and auto-layout flows around them.
 *
 * Pure + deterministic (no store/DOM) so the branch/merge/collision math is unit-tested against canonical shapes.
 * Columns can be negative (left of the spine); `minCol` lets the renderer shift to a 0-based grid.
 */

/** Pixel pitch of one grid cell in the Cell view — how (row,col) map to on-screen position. */
export const CELL_W = 200
export const CELL_H = 96

export interface CellPos {
  row: number
  col: number
}

export interface CellLayout {
  pos: Map<string, CellPos>
  minCol: number // most-negative column used (branches left of the spine); renderer adds -minCol to render 0-based
  maxCol: number
  rows: number // row extent (maxRow + 1)
  forks: Set<string> // out-degree > 1
  merges: Set<string> // in-degree > 1
}

const key = (r: number, c: number): string => `${r},${c}`

/**
 * The DAG's longest path — the default SPINE when no chart sequence is authored (the story's trunk, the line the
 * branches hang off). Topological DP; cycle-safe (nodes in a cycle just don't extend the path). Returns [] for no ids.
 */
export function longestPath(ids: readonly string[], edgesOf: (id: string) => readonly string[] | undefined): string[] {
  if (!ids.length) return []
  const set = new Set(ids)
  const out = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const id of ids) { out.set(id, []); if (!indeg.has(id)) indeg.set(id, 0) }
  for (const id of ids) for (const t of edgesOf(id) ?? []) if (set.has(t) && t !== id) { out.get(id)!.push(t); indeg.set(t, (indeg.get(t) ?? 0) + 1) }
  const ind = new Map(indeg)
  const q = ids.filter((id) => (ind.get(id) ?? 0) === 0)
  const order: string[] = []
  while (q.length) {
    const n = q.shift()!
    order.push(n)
    for (const t of out.get(n) ?? []) { ind.set(t, (ind.get(t) ?? 0) - 1); if ((ind.get(t) ?? 0) === 0) q.push(t) }
  }
  const dist = new Map<string, number>(ids.map((id) => [id, 0]))
  const prev = new Map<string, string | null>(ids.map((id) => [id, null]))
  for (const n of order) for (const t of out.get(n) ?? []) if ((dist.get(n)! + 1) > (dist.get(t) ?? 0)) { dist.set(t, dist.get(n)! + 1); prev.set(t, n) }
  let end = ids[0]
  let best = -1
  for (const id of ids) if ((dist.get(id) ?? 0) > best) { best = dist.get(id)!; end = id }
  const path: string[] = []
  for (let cur: string | null = end; cur; cur = prev.get(cur) ?? null) path.unshift(cur)
  return path
}

/**
 * The longest route (root→leaf path) that passes THROUGH `id` — its longest ancestry chain + its longest descendant
 * chain, joined at `id`. Used by the Cell view's "color this route" (right-click a scene → paint its whole path).
 * Cycle-safe via a visited guard; returns [id] if isolated.
 */
export function routeThrough(id: string, ids: readonly string[], edgesOf: (id: string) => readonly string[] | undefined): string[] {
  const set = new Set(ids)
  const out = new Map<string, string[]>()
  const inc = new Map<string, string[]>()
  for (const n of ids) { out.set(n, []); if (!inc.has(n)) inc.set(n, []) }
  for (const n of ids) for (const t of edgesOf(n) ?? []) if (set.has(t) && t !== n) { out.get(n)!.push(t); inc.get(t)!.push(n) }
  // longest simple chain following `adj`, memoized (DAG); returns the path FROM start (inclusive).
  const longestFrom = (start: string, adj: Map<string, string[]>): string[] => {
    const memo = new Map<string, string[]>()
    const dfs = (n: string, stack: Set<string>): string[] => {
      if (memo.has(n)) return memo.get(n)!
      let best: string[] = []
      for (const m of adj.get(n) ?? []) {
        if (stack.has(m)) continue // cycle guard
        stack.add(m)
        const p = dfs(m, stack)
        stack.delete(m)
        if (p.length > best.length) best = p
      }
      const res = [n, ...best]
      memo.set(n, res)
      return res
    }
    return dfs(start, new Set([start]))
  }
  const down = longestFrom(id, out) // id … leaf
  const up = longestFrom(id, inc) // id … root (reversed = root … id)
  return [...up.slice(1).reverse(), ...down] // root … id … leaf, id once
}

/**
 * Choose the flowchart SPINE. A saved backbone (a curated sequence, mapped into the current node set) wins ONLY
 * when it covers at least the auto-trunk — otherwise a tiny curated chart-axis (e.g. 7 of 480 scenes, meant for
 * the gantt X) would become the spine and exile every other scene to a flanking column. Falls back to the graph
 * trunk, or to all ids in order when the graph has no real trunk (no edges).
 */
export function pickSpine(savedBackbone: readonly string[], trunk: readonly string[], allIds: readonly string[]): string[] {
  if (savedBackbone.length >= trunk.length && savedBackbone.length > 1) return [...savedBackbone]
  return trunk.length > 1 ? [...trunk] : [...allIds]
}

export function cellLayout(
  sequence: readonly string[],
  ids: readonly string[],
  edgesOf: (id: string) => readonly string[] | undefined,
  overrides?: ReadonlyMap<string, CellPos>
): CellLayout {
  const inSet = new Set(ids)
  const out = new Map<string, string[]>()
  const inc = new Map<string, string[]>()
  for (const id of ids) {
    out.set(id, [])
    if (!inc.has(id)) inc.set(id, [])
  }
  for (const id of ids) {
    for (const t of edgesOf(id) ?? []) {
      if (!inSet.has(t) || t === id) continue
      out.get(id)!.push(t)
      inc.get(t)!.push(id)
    }
  }

  const pos = new Map<string, CellPos>()
  const occupied = new Set<string>()
  const place = (id: string, row: number, col: number): void => {
    pos.set(id, { row, col })
    occupied.add(key(row, col))
  }

  // 0) Overrides (author pins) claim their cell first, so everything else flows around them.
  const pinned = new Set<string>()
  if (overrides) {
    for (const [id, p] of overrides) {
      if (!inSet.has(id)) continue
      place(id, p.row, p.col)
      pinned.add(id)
    }
  }

  // 1) The spine: the sequence, center column (0), one row each. Pinned spine nodes keep their pin.
  const spine = sequence.filter((id) => inSet.has(id))
  const spineSet = new Set(spine)
  spine.forEach((id, i) => {
    if (!pinned.has(id)) place(id, i, 0)
  })

  // 2) Off-spine nodes → chains (connected components of the off-spine subgraph), each its own column.
  const off = ids.filter((id) => !spineSet.has(id) && !pinned.has(id))
  const offSet = new Set(off)

  // Union-find so a fork/merge chain (e.g. C→E feeding a merge) stays one column.
  const parent = new Map<string, string>(off.map((id) => [id, id]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = x
    while (parent.get(c) !== c) { const n = parent.get(c)!; parent.set(c, r); c = n }
    return r
  }
  const union = (a: string, b: string): void => { parent.set(find(a), find(b)) }
  for (const id of off) for (const t of out.get(id) ?? []) if (offSet.has(t)) union(id, t)

  const comps = new Map<string, string[]>()
  for (const id of off) {
    const r = find(id)
    ;(comps.get(r) ?? comps.set(r, []).get(r)!).push(id)
  }

  // ROW of an off node: nearest PLACED node it reaches downstream → that node's row minus the hop distance
  // (bottom-up from the merge). If it reaches none downstream, anchor to the nearest placed node UPSTREAM and go
  // top-down (a dead-end branch). BFS so the nearest anchor wins.
  const rowOf = (start: string): number => {
    const down = bfsToPlaced(start, out)
    const up = bfsToPlaced(start, inc)
    const downRow = down ? pos.get(down.node)!.row - down.dist : null // bottom-up from the merge
    const upRow = up ? pos.get(up.node)!.row + up.dist : null // top-down from the fork
    // BRANCH PROXIMITY over merge: a CLEAN branch — its head fed only by its fork (in-degree ≤ 1), not by
    // another branch — takes whichever anchor sits HIGHER. So when the branch is shorter than the spine gap it
    // RISES to sit adjacent to its fork (instead of being bottom-aligned to the merge), while a branch that
    // fills the gap keeps the clean merge-up shape. A sub-merge (fed by another branch, in-degree ≥ 2) always
    // keeps merge-up (downstream anchor).
    const fedByAnother = (inc.get(start)?.length ?? 0) > 1
    if (!fedByAnother && downRow != null && upRow != null) return Math.min(downRow, upRow)
    if (downRow != null) return downRow
    if (upRow != null) return upRow
    return 0 // fully isolated component — caller stacks these after
  }
  function bfsToPlaced(start: string, adj: Map<string, string[]>): { node: string; dist: number } | null {
    const seen = new Set([start])
    let frontier = [start]
    let dist = 0
    while (frontier.length) {
      dist++
      const next: string[] = []
      for (const n of frontier) {
        for (const m of adj.get(n) ?? []) {
          if (seen.has(m)) continue
          if (pos.has(m)) return { node: m, dist }
          seen.add(m)
          next.push(m)
        }
      }
      frontier = next
    }
    return null
  }

  // Columns tried outward from the spine: 0 is the spine, so branches start at ±1, alternating.
  const offsetOrder = (max: number): number[] => {
    const o: number[] = []
    for (let k = 1; k <= max; k++) { o.push(k); o.push(-k) }
    return o
  }

  // Place each component in the first column (outward from center) where ALL its cells are free. A component with
  // two nodes on the SAME row can't share one column → the collider spills to the next free offset (rare nesting).
  const isolated: string[][] = []
  const ordered = [...comps.values()].sort((a, b) => b.length - a.length) // biggest chains get inner columns
  for (const comp of ordered) {
    const rows = comp.map((id) => [id, rowOf(id)] as const)
    const anchored = rows.some(([id]) => bfsToPlaced(id, out) || bfsToPlaced(id, inc))
    if (!anchored) { isolated.push(comp); continue }
    let placedComp = false
    for (const off0 of offsetOrder(comp.length + ids.length)) {
      if (rows.every(([, r]) => !occupied.has(key(r, off0)))) {
        for (const [id, r] of rows) place(id, r, off0)
        placedComp = true
        break
      }
    }
    if (!placedComp) {
      // couldn't fit as one column (same-row collision inside the component) → place node-by-node, nearest free col
      for (const [id, r] of rows) {
        const c = offsetOrder(comp.length + ids.length).find((o) => !occupied.has(key(r, o))) ?? 0
        place(id, r, c)
      }
    }
  }

  // Fully isolated components (no edges to anything placed): stack below the whole diagram, center column.
  let stackRow = 0
  for (const p of pos.values()) stackRow = Math.max(stackRow, p.row + 1)
  for (const comp of isolated) for (const id of comp) place(id, stackRow++, 0)

  let minCol = 0
  let maxCol = 0
  let rows = 0
  for (const p of pos.values()) {
    minCol = Math.min(minCol, p.col)
    maxCol = Math.max(maxCol, p.col)
    rows = Math.max(rows, p.row + 1)
  }

  const forks = new Set(ids.filter((id) => (out.get(id)?.length ?? 0) > 1))
  const merges = new Set(ids.filter((id) => (inc.get(id)?.length ?? 0) > 1))
  return { pos, minCol, maxCol, rows, forks, merges }
}
