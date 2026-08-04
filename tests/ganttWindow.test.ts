import { describe, it, expect } from 'vitest'
import { scopeRows } from '../src/renderer/lib/timeline/ganttWindow'

type Row = { id: string; scenes: string[] }
const rows: Row[] = [
  { id: 'a', scenes: ['s1', 's2'] }, // in window
  { id: 'b', scenes: ['s9'] }, // out of window
  { id: 'c', scenes: ['s2', 's3'] }, // in window
  { id: 'd', scenes: ['s8', 's3'] } // partially in (s3)
]
const scenesOf = (r: Row): string[] => r.scenes
const window = new Map([['s1', 0], ['s2', 1], ['s3', 2]]) // the visible column window

describe('scopeRows (window relevance + pagination)', () => {
  it('drops rows with no scene in the visible window', () => {
    const s = scopeRows(rows, scenesOf, window, 0, 100)
    expect(s.shown.map((r) => r.id)).toEqual(['a', 'c', 'd']) // b (only s9) is gone
    expect(s.total).toBe(3)
    expect(s.pageCount).toBe(1)
  })

  it('a partial overlap keeps the row (d touches s3)', () => {
    const s = scopeRows(rows, scenesOf, window, 0, 100)
    expect(s.shown.some((r) => r.id === 'd')).toBe(true)
  })

  it('paginates — one page in the result, total across all pages', () => {
    const p0 = scopeRows(rows, scenesOf, window, 0, 2)
    expect(p0.shown.map((r) => r.id)).toEqual(['a', 'c']) // page 0, stable order
    expect(p0).toMatchObject({ total: 3, page: 0, pageCount: 2, from: 1, to: 2 })
    const p1 = scopeRows(rows, scenesOf, window, 1, 2)
    expect(p1.shown.map((r) => r.id)).toEqual(['d']) // page 1
    expect(p1).toMatchObject({ total: 3, page: 1, pageCount: 2, from: 3, to: 3 })
  })

  it('never returns more than one page (no "show all")', () => {
    const s = scopeRows(rows, scenesOf, window, 0, 2)
    expect(s.shown.length).toBeLessThanOrEqual(2)
  })

  it('clamps a stale page after the set shrinks', () => {
    const s = scopeRows(rows, scenesOf, window, 9, 2) // asked for page 9, only 2 pages exist
    expect(s.page).toBe(1) // clamped to the last valid page
    expect(s.shown.map((r) => r.id)).toEqual(['d'])
  })

  it('an empty window scopes to nothing', () => {
    const s = scopeRows(rows, scenesOf, new Map(), 0, 100)
    expect(s.shown).toHaveLength(0)
    expect(s).toMatchObject({ total: 0, from: 0, to: 0, pageCount: 1 })
  })
})
