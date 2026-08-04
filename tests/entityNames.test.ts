import { describe, it, expect } from 'vitest'
import { entityNameVariants, mentionsEntity, buildNameIndex, resolveName, normName } from '../src/shared/entityNames'

const liuBei = { id: 'liu-bei', name: '劉備 Liu Bei', aliases: ['Xuande'] }
const caoCao = { id: 'cao-cao', name: '曹操 Cao Cao' }

describe('entityNameVariants — bilingual names split into matchable runs', () => {
  it('includes the CJK run, the latin run, the aliases, and the id-slug', () => {
    const v = entityNameVariants(liuBei)
    expect(v).toContain('劉備') // CJK run
    expect(v).toContain('liu bei') // latin run (lowercased)
    expect(v).toContain('xuande') // alias
    expect(v).toContain('劉備 liu bei') // the whole name too
  })
  it('drops noise-length latin fragments but keeps 2-char CJK names', () => {
    expect(entityNameVariants({ id: 'x', name: '关羽' })).toContain('关羽') // 2-char CJK kept
    expect(entityNameVariants({ id: 'a', name: 'A' })).not.toContain('a') // 1-char latin dropped
  })
})

describe('mentionsEntity — the warmth/events bug', () => {
  const v = entityNameVariants(liuBei)
  it('matches prose that names the character in ONE script (the exact failure before)', () => {
    // This is the real arc-event text that used to NOT match "劉備 Liu Bei".
    expect(mentionsEntity('Breaches city walls and forces Liu Bei to flee Xu Province', v)).toBe(true)
  })
  it('matches CJK-only prose too', () => {
    expect(mentionsEntity('曹操大破劉備於徐州', v)).toBe(true)
  })
  it('does not match an unrelated character', () => {
    expect(mentionsEntity('Cao Cao defeats Yuan Shao at Guandu', v)).toBe(false)
  })
})

describe('buildNameIndex / resolveName — structured name→id', () => {
  const idx = buildNameIndex([liuBei, caoCao])
  it('resolves a raw extracted name in either script to the entity id', () => {
    expect(resolveName('Liu Bei', idx)).toBe('liu-bei')
    expect(resolveName('劉備', idx)).toBe('liu-bei')
    expect(resolveName('Cao Cao', idx)).toBe('cao-cao')
    expect(resolveName('Xuande', idx)).toBe('liu-bei') // via alias
  })
  it('returns null for an unknown name (caller may mint a new entity)', () => {
    expect(resolveName('Sun Quan', idx)).toBeNull()
  })
})

describe('normName', () => {
  it('keeps word spaces (so substring matching works) and lowercases', () => {
    expect(normName('  Liu   Bei ')).toBe('liu bei')
  })
})
