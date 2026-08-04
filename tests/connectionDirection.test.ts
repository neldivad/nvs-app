import { describe, it, expect } from 'vitest'
import { connectionDirection } from '../src/renderer/components/canvas/useCardCanvas'

// The ONE connection-direction rule shared by the timeline + corkboard card surfaces. Normalizes every gesture
// to OUT→IN so the two panels can't drift. `fromHandle.type` is xyflow's: 'source' = out/right, 'target' = in/left.
const conn = (fromId: string, toId: string | null, fromType: 'source' | 'target') => ({
  fromNode: { id: fromId },
  toNode: toId ? { id: toId } : null,
  fromHandle: { type: fromType }
})

describe('connectionDirection — OUT→IN normalization', () => {
  it('case 1: start at nodeA (out handle), release at nodeB → A → B', () => {
    expect(connectionDirection(conn('A', 'B', 'source'))).toEqual({ source: 'A', target: 'B' })
  })

  it('case 2: start at nodeA LeftIn (target handle), release at nodeB RightOut → B → A (reversed)', () => {
    expect(connectionDirection(conn('A', 'B', 'target'))).toEqual({ source: 'B', target: 'A' })
  })

  it('quick-connect (released over the card body, no far handle) still normalizes by the START handle', () => {
    expect(connectionDirection({ fromNode: { id: 'A' }, toNode: { id: 'B' }, fromHandle: { type: 'source' } })).toEqual({ source: 'A', target: 'B' })
    expect(connectionDirection({ fromNode: { id: 'A' }, toNode: { id: 'B' }, fromHandle: { type: 'target' } })).toEqual({ source: 'B', target: 'A' })
  })

  it('returns null when the drag did not land on a node (no edge)', () => {
    expect(connectionDirection(conn('A', null, 'source'))).toBeNull()
    expect(connectionDirection({ fromNode: null, toNode: { id: 'B' }, fromHandle: { type: 'source' } })).toBeNull()
  })

  it('falls back to the card the pointer released OVER when xyflow snapped to no handle (body-drop)', () => {
    // no toNode (release beyond the handle radius, mid-card) but the pointer was over card B
    expect(connectionDirection(conn('A', null, 'source'), 'B')).toEqual({ source: 'A', target: 'B' })
    expect(connectionDirection(conn('A', null, 'target'), 'B')).toEqual({ source: 'B', target: 'A' }) // reversed, still
  })

  it('prefers xyflow’s snapped node over the pointer fallback', () => {
    expect(connectionDirection(conn('A', 'B', 'source'), 'C')).toEqual({ source: 'A', target: 'B' })
  })

  it('rejects a self-connect (released back over the origin card)', () => {
    expect(connectionDirection(conn('A', 'A', 'source'))).toBeNull()
    expect(connectionDirection(conn('A', null, 'source'), 'A')).toBeNull()
  })

  it('defaults to the drag direction when the start handle type is unknown', () => {
    expect(connectionDirection({ fromNode: { id: 'A' }, toNode: { id: 'B' }, fromHandle: null })).toEqual({ source: 'A', target: 'B' })
  })
})
