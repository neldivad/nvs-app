import { describe, it, expect } from 'vitest'
import { normalizeProjectInfo } from '../src/shared/config/projectSchema'

// Guards the SHAPE DRIFT landmine: early converter output stored array fields as scalars (e.g. inLanguage: "en"),
// and consumers do `field.map(...)`. normalizeProjectInfo coerces scalars → arrays at the boundary.
describe('normalizeProjectInfo', () => {
  it('coerces a scalar inLanguage string to a single-element array', () => {
    expect(normalizeProjectInfo({ inLanguage: 'en' }).inLanguage).toEqual(['en'])
  })

  it('coerces every array field that arrives as a scalar', () => {
    const out = normalizeProjectInfo({ inLanguage: 'en', genre: 'epic', about: 'war', contentRating: 'violence', keywords: 'three kingdoms' })
    expect(out.inLanguage).toEqual(['en'])
    expect(out.genre).toEqual(['epic'])
    expect(out.about).toEqual(['war'])
    expect(out.contentRating).toEqual(['violence'])
    expect(out.keywords).toEqual(['three kingdoms'])
  })

  it('maps an empty / whitespace scalar to an empty array (not [""])', () => {
    expect(normalizeProjectInfo({ inLanguage: '' }).inLanguage).toEqual([])
    expect(normalizeProjectInfo({ genre: '   ' }).genre).toEqual([])
  })

  it('passes valid arrays through untouched', () => {
    const info = { inLanguage: ['en', 'zh'], genre: ['epic', 'war'] }
    const out = normalizeProjectInfo(info)
    expect(out.inLanguage).toEqual(['en', 'zh'])
    expect(out.genre).toEqual(['epic', 'war'])
  })

  it('leaves absent fields absent (undefined stays undefined)', () => {
    const out = normalizeProjectInfo({ title: 'X' })
    expect(out.title).toBe('X')
    expect(out.inLanguage).toBeUndefined()
    expect(out.genre).toBeUndefined()
  })

  it('replaces a non-array, non-string array-field value with an empty array', () => {
    // a number / object where an array is expected → [] rather than a crash downstream
    expect(normalizeProjectInfo({ genre: 42 as unknown as string[] }).genre).toEqual([])
  })

  it('coerces a non-array contributor to an empty array', () => {
    expect(normalizeProjectInfo({ contributor: 'someone' as unknown as [] }).contributor).toEqual([])
  })

  it('preserves a valid contributor array', () => {
    const c = [{ name: 'Yie', roles: ['writer'] }]
    expect(normalizeProjectInfo({ contributor: c }).contributor).toEqual(c)
  })

  it('returns {} for non-object input (null / undefined / string)', () => {
    expect(normalizeProjectInfo(null)).toEqual({})
    expect(normalizeProjectInfo(undefined)).toEqual({})
    expect(normalizeProjectInfo('nope')).toEqual({})
  })

  it('does not mutate the input object', () => {
    const input = { inLanguage: 'en' }
    normalizeProjectInfo(input)
    expect(input.inLanguage).toBe('en') // original untouched (shallow copy)
  })
})
