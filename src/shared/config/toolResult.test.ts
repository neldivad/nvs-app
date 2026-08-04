import { describe, it, expect } from 'vitest'
import { clampMiddleOut, nearestStrings, teachError, TEACH_MAX_VALID } from './toolResult'

describe('clampMiddleOut', () => {
  it('returns short strings unchanged', () => {
    expect(clampMiddleOut('hello', 100)).toBe('hello')
    expect(clampMiddleOut('', 100)).toBe('')
  })

  it('keeps head AND tail with a declared omission', () => {
    const s = 'HEAD-' + 'x'.repeat(5000) + '-TAIL'
    const out = clampMiddleOut(s, 500)
    expect(out.startsWith('HEAD-')).toBe(true)
    expect(out.endsWith('-TAIL')).toBe(true) // the old head-only slice lost exactly this
    expect(out).toContain('middle truncated')
    expect(out).toContain(`of ${s.length} chars omitted`)
  })

  it('never exceeds the budget', () => {
    for (const max of [120, 500, 6000]) {
      const out = clampMiddleOut('a'.repeat(max * 3), max)
      expect(out.length).toBeLessThanOrEqual(max)
    }
  })

  it('head gets the larger share (orientation), tail survives (errors/summaries live there)', () => {
    const s = 'A'.repeat(4000) + 'Z'.repeat(4000)
    const out = clampMiddleOut(s, 1000)
    const headLen = out.indexOf('…')
    const tailLen = out.length - out.lastIndexOf('…') - 1
    expect(headLen).toBeGreaterThan(tailLen)
    expect(tailLen).toBeGreaterThan(0)
  })
})

describe('nearestStrings', () => {
  const cols = ['entities.entity_id', 'entities.display_name', 'entities.kind', 'thread_events.scene_id', 'units.title']

  it('ranks the real column nearest a bad guess ("name" → display_name)', () => {
    const hits = nearestStrings('name', cols)
    expect(hits[0]).toBe('entities.display_name')
  })

  it('matches loosely across spacing/case/punctuation (folderMatch normalization)', () => {
    expect(nearestStrings('Display Name', cols)[0]).toBe('entities.display_name')
    expect(nearestStrings('SCENE-ID', cols)[0]).toBe('thread_events.scene_id')
  })

  it('returns empty for a hopeless guess or an all-punctuation guess', () => {
    expect(nearestStrings('zzz_nothing', cols)).toEqual([])
    expect(nearestStrings('///', cols)).toEqual([])
  })

  it('caps at k', () => {
    const many = Array.from({ length: 20 }, (_, i) => `t.name_${i}`)
    expect(nearestStrings('name', many).length).toBeLessThanOrEqual(TEACH_MAX_VALID)
  })
})

describe('teachError', () => {
  it('carries echo + alternatives + literal retry', () => {
    const e = teachError('no column "name"', ['entities.display_name'], 'SELECT display_name FROM entities')
    expect(e).toEqual({ error: 'no column "name"', valid: ['entities.display_name'], next: 'SELECT display_name FROM entities' })
  })

  it('drops an empty valid list instead of teaching "there are no options"', () => {
    const e = teachError('miss', [], 'try search()')
    expect(e.valid).toBeUndefined()
    expect(e.next).toBe('try search()')
  })

  it('trims valid to the graspable cap and drops empties', () => {
    const e = teachError('miss', ['', 'a', 'b', 'c', 'd', 'e', 'f'])
    expect(e.valid).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
