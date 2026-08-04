/**
 * Tests for the world-page body helpers (section reasoning over plain Markdown).
 */

import { describe, it, expect } from 'vitest'
import { bodyHeadings, hasSection, ensureSection } from '../src/renderer/lib/fountain/wikiSerializer'

describe('bodyHeadings', () => {
  it('extracts ## and ### headings in order', () => {
    expect(bodyHeadings('## Profile\n\n- Role: x\n\n## Arc\n### Goal\n- win')).toEqual([
      'Profile',
      'Arc',
      'Goal'
    ])
  })
  it('ignores # h1 and non-heading lines', () => {
    expect(bodyHeadings('# Title\n\nprose\n## Real')).toEqual(['Real'])
  })
  it('empty body → no headings', () => {
    expect(bodyHeadings('')).toEqual([])
  })
})

describe('hasSection', () => {
  it('matches case-insensitively', () => {
    expect(hasSection('## Appearance\n', 'appearance')).toBe(true)
    expect(hasSection('## Appearance\n', 'Arc')).toBe(false)
  })
})

describe('ensureSection', () => {
  const tmpl = '## Arc\n\n### Goal\n- \n'

  it('appends the template when the section is absent', () => {
    const out = ensureSection('## Appearance\n\nTall.', 'Arc', tmpl)
    expect(out).toContain('## Appearance')
    expect(out).toContain('## Arc')
    expect(out).toContain('### Goal')
    expect(bodyHeadings(out)).toEqual(['Appearance', 'Arc', 'Goal'])
  })

  it('is a no-op when the section already exists', () => {
    const body = '## Arc\n\n### Goal\n- win'
    expect(ensureSection(body, 'Arc', tmpl)).toBe(body)
  })

  it('seeds an empty body cleanly', () => {
    const out = ensureSection('', 'Arc', tmpl)
    expect(out.startsWith('## Arc')).toBe(true)
    expect(bodyHeadings(out)).toEqual(['Arc', 'Goal'])
  })
})
