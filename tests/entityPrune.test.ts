import { describe, it, expect } from 'vitest'
import { deadEntityIds } from '../src/engine/analysis/ingest'

// content-id.md: page-backed entity dies when its page is gone; minted/legacy dies only when unreferenced.
const ents = [
  { id: 'liu-bei', source: 'page' }, // page present this pass
  { id: 'cao-cao', source: 'page' }, // page DELETED (not in seen)
  { id: 'the-seal', source: 'minted' }, // minted, referenced by analysis
  { id: 'ghost-thing', source: 'minted' }, // minted, orphaned (no refs)
  { id: 'legacy-ref', source: null }, // pre-006 legacy, still referenced
  { id: 'legacy-orphan', source: null } // pre-006 legacy, unreferenced
]
const seen = new Set(['liu-bei'])
const referenced = new Set(['liu-bei', 'cao-cao', 'the-seal', 'legacy-ref'])

describe('deadEntityIds — the two-rule prune decision', () => {
  const dead = deadEntityIds(ents, seen, referenced)
  it('evicts a page-backed entity whose page is gone (even if still referenced)', () => {
    expect(dead).toContain('cao-cao') // page deleted → evict + cascade its analysis
  })
  it('keeps a page-backed entity whose page is present', () => {
    expect(dead).not.toContain('liu-bei')
  })
  it('keeps a minted entity that analysis still references', () => {
    expect(dead).not.toContain('the-seal')
  })
  it('evicts a minted entity that nothing references anymore', () => {
    expect(dead).toContain('ghost-thing')
  })
  it('treats legacy (NULL source) like minted: keep if referenced, evict if orphaned', () => {
    expect(dead).not.toContain('legacy-ref')
    expect(dead).toContain('legacy-orphan')
  })
  it('never evicts a page-backed entity that is present (the safe default)', () => {
    expect(deadEntityIds([{ id: 'x', source: 'page' }], new Set(['x']), new Set())).toEqual([])
  })
})
