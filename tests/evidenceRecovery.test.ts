/**
 * Tests for evidence recovery — placing a finding that cited nothing back onto the anchors we offered it.
 * This is what stops findings collapsing onto the as-of checkpoint (the bug where late-novel plot holes
 * showed up on chapter 1's "On this scene" panel).
 */
import { describe, it, expect } from 'vitest'
import { recoverEvidence, type EvidenceAnchor } from '../src/main/ai/evidenceRecovery'

const ANCHORS: EvidenceAnchor[] = [
  { id: 'sanguo-ch001', title: '第一回', text: 'Liu Bei, Guan Yu and Zhang Fei swear brotherhood in the peach garden and raise volunteers against the Yellow Turban rebellion.' },
  { id: 'sanguo-ch076', title: '第七十六回', text: 'Guan Yu loses Jingzhou, retreats to Maicheng and is captured by the forces of Sun Quan at Linju.' },
  { id: 'sanguo-ch077', title: '第七十七回', text: 'Guan Yu is executed by Sun Quan; his spirit appears at Jade Spring Hill and Cao Cao is unsettled by the severed head.' }
]

describe('recoverEvidence', () => {
  it('EXACT — recovers when the model echoed the anchor id', () => {
    expect(recoverEvidence('Contradiction between sanguo-ch076 and the later account.', ANCHORS)).toEqual(['sanguo-ch076'])
  })

  it('EXACT — recovers when the model echoed the anchor title instead of the id', () => {
    expect(recoverEvidence('第七十七回 shows the execution again.', ANCHORS)).toEqual(['sanguo-ch077'])
  })

  it('CONTENT OVERLAP — places a finding that named the events but no id', () => {
    // No id, no title — only the model's own description of what happened.
    const got = recoverEvidence('Guan Yu is captured at Maicheng by Sun Quan forces, then executed by Sun Quan later.', ANCHORS)
    expect(got.length).toBeGreaterThan(0)
    expect(got).not.toContain('sanguo-ch001') // must NOT collapse onto the unrelated opening chapter
    expect(got.some((id) => id === 'sanguo-ch076' || id === 'sanguo-ch077')).toBe(true)
  })

  it('returns [] rather than guessing when nothing overlaps', () => {
    expect(recoverEvidence('A completely unrelated statement about quarterly revenue.', ANCHORS)).toEqual([])
  })

  it('is safe on empty prose / empty anchors', () => {
    expect(recoverEvidence('', ANCHORS)).toEqual([])
    expect(recoverEvidence('Guan Yu executed', [])).toEqual([])
  })

  it('caps the number of recovered anchors', () => {
    const many: EvidenceAnchor[] = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`, title: `T${i}`, text: 'Guan Yu captured executed Maicheng Sun Quan Jingzhou retreat'
    }))
    expect(recoverEvidence('Guan Yu captured and executed at Maicheng by Sun Quan after losing Jingzhou', many, 2).length).toBeLessThanOrEqual(2)
  })

  it('an exact citation wins over content overlap', () => {
    // prose names ch077's content but explicitly cites ch076 — the explicit id must win
    const got = recoverEvidence('sanguo-ch076 — Guan Yu executed by Sun Quan at Jade Spring Hill', ANCHORS)
    expect(got).toEqual(['sanguo-ch076'])
  })
})
