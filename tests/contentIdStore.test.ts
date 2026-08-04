import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import matter from 'gray-matter'
import { readId, readStampedId, stampId } from '../src/engine/content/contentId'

const dir = mkdtempSync(join(tmpdir(), 'nvs-contentid-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('engine/contentId — read + stamp (prose-safe)', () => {
  it('stamps an id into an UNstamped page without touching the prose body', () => {
    const p = join(dir, 'cao-cao.md')
    writeFileSync(p, '---\nname: 曹操 Cao Cao\n---\nHe is a warlord.\n')
    expect(readStampedId('entity', p)).toBe('') // unstamped
    stampId('entity', p, 'cao-cao')
    const { data, content } = matter(readFileSync(p, 'utf8'))
    expect(String(data.id)).toBe('cao-cao') // id added
    expect(String(data.name)).toBe('曹操 Cao Cao') // existing frontmatter preserved
    expect(content.trim()).toBe('He is a warlord.') // PROSE BODY untouched
    expect(readStampedId('entity', p)).toBe('cao-cao')
  })

  it('is a no-op when already stamped (returns null, no rewrite)', () => {
    const p = join(dir, 'liu-bei.md')
    writeFileSync(p, '---\nid: liu-bei\nname: 劉備\n---\nBody.\n')
    expect(stampId('entity', p, 'liu-bei')).toBeNull()
  })

  it('readId falls back to the filename stem when unstamped', () => {
    const p = join(dir, 'sun-quan.md')
    writeFileSync(p, '---\nname: Sun Quan\n---\nBody.\n')
    expect(readId('entity', p)).toBe('sun-quan')
  })

  it('folder id round-trips through the .id dotfile', () => {
    const fdir = join(dir, 'vol-01')
    mkdirSync(fdir)
    expect(readId('folder', fdir)).toBe('')
    stampId('folder', fdir, 'vol-01-abc')
    expect(readId('folder', fdir)).toBe('vol-01-abc')
  })
})
