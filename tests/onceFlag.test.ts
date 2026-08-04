import { describe, it, expect, beforeEach } from 'vitest'
import { seenOnce, markSeen, firstTime, resetSeen } from '../src/renderer/lib/onceFlag'

// vitest node env has no localStorage → the module's in-memory fallback backs these, so latching is testable.
describe('onceFlag — one-time UX gates', () => {
  beforeEach(() => {
    resetSeen('loadout-intro')
    resetSeen('other')
  })

  it('firstTime is true once, then latches false', () => {
    expect(firstTime('loadout-intro')).toBe(true)
    expect(firstTime('loadout-intro')).toBe(false)
    expect(firstTime('loadout-intro')).toBe(false)
  })

  it('gates are independent by id', () => {
    expect(firstTime('loadout-intro')).toBe(true)
    expect(firstTime('other')).toBe(true) // a different gate is unaffected
    expect(firstTime('loadout-intro')).toBe(false)
  })

  it('seenOnce reflects markSeen', () => {
    expect(seenOnce('loadout-intro')).toBe(false)
    markSeen('loadout-intro')
    expect(seenOnce('loadout-intro')).toBe(true)
  })

  it('resetSeen re-arms the gate', () => {
    markSeen('loadout-intro')
    expect(seenOnce('loadout-intro')).toBe(true)
    resetSeen('loadout-intro')
    expect(seenOnce('loadout-intro')).toBe(false)
    expect(firstTime('loadout-intro')).toBe(true) // fires again after a reset
  })
})
