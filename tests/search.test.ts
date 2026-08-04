/**
 * The general project search (@engine/content/search → the agent's `search` tool). Proves the two properties the
 * design turns on:
 *   • FINDS by name across categories (folders / scenes / world pages), fuzzy + Unicode (spacing, CJK) — so a
 *     casual "hutao" locates the "1.3 Hutao" folder AND the Hu Tao character in one call.
 *   • RAG-shaped: TOP-K cap (ranked, truncated, with `total`) and POINTERS+SNIPPETS (content hits carry a
 *     one-line snippet, never a page body).
 *
 * Run: npm test
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { searchAll } from '../src/engine/content/search'

let root: string

function scene(rel: string, id: string, title: string, body = ''): void {
  const abs = join(root, 'content', 'story', rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, `---\nscene_id: ${id}\ntitle: ${title}\n---\n\n${body}\n`)
}
function character(file: string, name: string, aliases: string[] = [], body = ''): void {
  const abs = join(root, 'content', 'world', 'characters', file)
  mkdirSync(join(abs, '..'), { recursive: true })
  const al = aliases.length ? `aliases:\n${aliases.map((a) => `  - ${a}`).join('\n')}\n` : ''
  writeFileSync(abs, `---\nname: ${name}\n${al}---\n\n${body}\n`)
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nvs-search-'))
  // Liyue story-quest folders, spaced + CJK
  scene('Story Quest/2-liyue/1.3 Hutao/teahouse.md', 's-ht-1', 'Teahouse Reverie')
  scene('Story Quest/2-liyue/1.3 Hutao/funeral.md', 's-ht-2', 'A Fond Farewell')
  scene('Story Quest/2-liyue/1.2 Ganyu/qingxin.md', 's-gy-1', 'Qingxin Flower')
  scene('剧情任务/2-璃月/胡桃/往生堂.md', 's-cn-1', '往生堂的一天') // pure-Chinese folder/scene
  // a scene that only MENTIONS Hu Tao in prose (content hit, different folder/title)
  scene('Story Quest/2-liyue/1.0 Xingqiu/library.md', 's-xq-1', 'Wanwen Bookhouse', 'Xingqiu spotted Hu Tao lurking by the shelves.')
  // world pages
  character('hu-tao.md', 'Hu Tao', ['77th Director'])
  character('ganyu.md', 'Ganyu', [], 'A half-qilin adeptus who works with Hu Tao on occasion.')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('searchAll — finds by name across categories', () => {
  it('a spaced/unspaced name finds the folder AND the character', () => {
    const { hits } = searchAll(root, 'hutao')
    const folder = hits.find((h: { kind: string }) => h.kind === 'folder')
    expect(folder?.ref).toBe('Story Quest/2-liyue/1.3 Hutao')
    expect(folder?.sceneCount).toBe(2)
    expect(hits.some((h: { kind: string; name: string }) => h.kind === 'character' && h.name === 'Hu Tao')).toBe(true)
  })

  it('name matches rank before content matches', () => {
    const { hits } = searchAll(root, 'hutao')
    const firstContent = hits.findIndex((h: { matchedOn: string }) => h.matchedOn === 'content')
    const lastName = hits.map((h: { matchedOn: any }) => h.matchedOn).lastIndexOf('name')
    if (firstContent >= 0) expect(lastName).toBeLessThan(firstContent) // all name hits precede any content hit
  })

  it('resolves a pure-Chinese folder name', () => {
    const { hits } = searchAll(root, '胡桃')
    expect(hits.some((h: { kind: string; ref: string }) => h.kind === 'folder' && h.ref === '剧情任务/2-璃月/胡桃')).toBe(true)
  })

  it('matches a character by alias', () => {
    const { hits } = searchAll(root, '77th director')
    expect(hits.some((h: { kind: string; name: string }) => h.kind === 'character' && h.name === 'Hu Tao')).toBe(true)
  })
})

describe('searchAll — RAG shape: content hits are snippets, not bodies', () => {
  it('a prose-only mention surfaces as a content hit with a snippet (no body)', () => {
    const { hits } = searchAll(root, 'lurking by the shelves')
    const hit = hits.find((h: { matchedOn: string }) => h.matchedOn === 'content')
    expect(hit).toBeTruthy()
    expect(hit!.snippet).toContain('lurking')
    expect(hit!.snippet!.length).toBeLessThan(200) // a snippet, never the whole page
    expect(hit).not.toHaveProperty('body')
  })
})

describe('searchAll — top-k cap', () => {
  it('caps hits to the limit and reports total + truncated', () => {
    const res = searchAll(root, 'hutao', 1)
    expect(res.hits.length).toBe(1)
    expect(res.total).toBeGreaterThan(1)
    expect(res.truncated).toBe(true)
  })

  it('empty / punctuation-only queries return nothing (never match-all)', () => {
    expect(searchAll(root, '').hits).toEqual([])
    expect(searchAll(root, '   .-()').hits).toEqual([])
  })
})
