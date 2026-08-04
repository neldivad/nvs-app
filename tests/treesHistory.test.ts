import { describe, it, expect } from 'vitest'
import { TreesHistory, isPurePositionChange } from '../src/renderer/lib/timeline/treesHistory'
import type { TreesFile, TimelineNode } from '../src/shared/ipc'

const scene = (id: string, x = 0, y = 0): TimelineNode => ({ kind: 'scene', sceneId: id, x, y })
// A variant factory that SHARES sub-object refs unless overridden (mirrors the store's immutable updates).
const sharedAdj = { a: ['b'] }
const sharedNodes = [scene('a'), scene('b')]
function tf(over: Partial<TreesFile['variants'][0]> = {}): TreesFile {
  return { version: 1, activeId: 'v', variants: [{ id: 'v', name: 'V', adjacency: sharedAdj, nodes: sharedNodes, ...over }] }
}

describe('isPurePositionChange', () => {
  it('only x/y changing → pure position', () => {
    const a = tf()
    const b = tf({ nodes: [scene('a', 10, 20), scene('b')] }) // moved a; same adjacency ref
    expect(isPurePositionChange(a, b)).toBe(true)
  })
  it('adjacency change → NOT pure position (structural)', () => {
    const a = tf()
    const b = tf({ adjacency: { a: ['b', 'c'] } })
    expect(isPurePositionChange(a, b)).toBe(false)
  })
  it('add/remove a node → NOT pure position', () => {
    const a = tf()
    const b = tf({ nodes: [scene('a'), scene('b'), scene('c')] })
    expect(isPurePositionChange(a, b)).toBe(false)
  })
  it('identical → false (nothing changed)', () => {
    expect(isPurePositionChange(tf(), tf())).toBe(false)
  })
})

describe('TreesHistory', () => {
  const s0 = tf()
  const s1 = tf({ adjacency: { a: ['b', 'x'] } }) // structural
  const s2 = tf({ adjacency: { a: ['b', 'x', 'y'] } }) // structural

  it('undo/redo walks the structural stack', () => {
    const h = new TreesHistory()
    h.record(s0, s1)
    h.record(s1, s2)
    expect(h.canUndo()).toBe(true)
    expect(h.popUndo(s2)).toBe(s1) // back to s1
    expect(h.popUndo(s1)).toBe(s0) // back to s0
    expect(h.popUndo(s0)).toBe(null) // exhausted
    expect(h.popRedo(s0)).toBe(s1) // redo forward
    expect(h.popRedo(s1)).toBe(s2)
  })

  it('a new edit after undo clears the redo stack', () => {
    const h = new TreesHistory()
    h.record(s0, s1)
    h.popUndo(s1) // now at s0, redo has s1
    expect(h.canRedo()).toBe(true)
    h.record(s0, s2) // new branch
    expect(h.canRedo()).toBe(false)
  })

  it('a run of pure position-moves coalesces into ONE undo entry', () => {
    const h = new TreesHistory()
    const p0 = tf({ nodes: [scene('a', 0, 0), scene('b')] })
    const p1 = tf({ nodes: [scene('a', 5, 0), scene('b')] })
    const p2 = tf({ nodes: [scene('a', 9, 0), scene('b')] })
    const p3 = tf({ nodes: [scene('a', 12, 0), scene('b')] })
    h.record(p0, p1) // first move → pushes p0
    h.record(p1, p2) // coalesce
    h.record(p2, p3) // coalesce
    expect(h.popUndo(p3)).toBe(p0) // ONE entry: straight back to before the drag run
    expect(h.popUndo(p0)).toBe(null)
  })

  it('respects the cap (oldest entries drop)', () => {
    const h = new TreesHistory(2)
    const a = tf({ adjacency: { a: ['1'] } })
    const b = tf({ adjacency: { a: ['2'] } })
    const c = tf({ adjacency: { a: ['3'] } })
    const d = tf({ adjacency: { a: ['4'] } })
    h.record(a, b)
    h.record(b, c)
    h.record(c, d) // cap=2 → drops the oldest (a)
    expect(h.popUndo(d)).toBe(c)
    expect(h.popUndo(c)).toBe(b)
    expect(h.popUndo(b)).toBe(null) // 'a' was evicted
  })
})
