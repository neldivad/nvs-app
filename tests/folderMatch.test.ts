/**
 * Forgiving story-folder matching (@shared/config/folderMatch) — the resolver the agent uses to turn a loose
 * chat ref ("hutao", "胡桃", a hand-built path) into a real folder. Covers the bugs that stranded the agent in a
 * loop:
 *   • space/punctuation sensitivity — "hutao" must match the folder "1.4 Hu Tao" (a space broke it; single-word
 *     "Ganyu"/"Xiao" worked, "Hu Tao" didn't).
 *   • non-English names — an ASCII-only squash ([a-z0-9]) erased "胡桃" to "" and broke every CJK folder.
 *   • regex-special names — "…Requiem (of the Echoing Depths).", "King Deshret & … [Caribert]", "C++ (v2.0)?"
 *     must match without throwing (the matcher must never build a RegExp from the ref/name).
 *   • compound/wrong paths — a full path where the ancestors (or region) are wrong still resolves to the leaf.
 *   • genuine ambiguity / junk — resolves to null (so the caller offers nearest matches, never a wrong guess).
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { resolveFolder, nearestFolders, squash, type FolderLike } from '@shared/config/folderMatch'

// A realistic mixed tree: English, pure-Chinese, bilingual, and punctuation/regex-heavy folder names.
const FOLDERS: FolderLike[] = [
  { relPath: 'Story Quest', name: 'Story Quest' },
  { relPath: 'Event Quest', name: 'Event Quest' },
  { relPath: 'Story Quest/2-liyue', name: '2-liyue' },
  { relPath: 'Story Quest/2-liyue/1.2 Ganyu', name: '1.2 Ganyu' },
  { relPath: 'Story Quest/2-liyue/1.3 Xiao', name: '1.3 Xiao' },
  { relPath: 'Story Quest/2-liyue/1.4 Hu Tao', name: '1.4 Hu Tao' },
  { relPath: 'Story Quest/2-liyue/1.0 Xingqiu', name: '1.0 Xingqiu' },
  { relPath: 'Story Quest/1-mondstadt/1.0 Kaeya', name: '1.0 Kaeya' },
  { relPath: 'Story Quest/1-mondstadt/1.0 Diluc', name: '1.0 Diluc' },
  { relPath: 'Story Quest/3-inazuma/1.5 神里綾華 Ayaka', name: '1.5 神里綾華 Ayaka' }, // bilingual
  // pure-Chinese tree
  { relPath: '剧情任务/2-璃月/1.4 胡桃', name: '1.4 胡桃' }, // Hu Tao
  { relPath: '剧情任务/2-璃月/甘雨', name: '甘雨' }, // Ganyu
  { relPath: '剧情任务/2-璃月/魈', name: '魈' }, // Xiao
  // regex-special / punctuation-heavy names
  { relPath: 'Archon Quest/2-liyue/14-Requiem of the Echoing Depths.', name: '14-Requiem of the Echoing Depths.' },
  { relPath: 'Event Quest/misc/King Deshret & the Three Magi (a.k.a. [Caribert])', name: 'King Deshret & the Three Magi (a.k.a. [Caribert])' },
  { relPath: 'Event Quest/misc/C++ Primer (v2.0)?', name: 'C++ Primer (v2.0)?' }
]

const name = (ref: string): string | null => resolveFolder(ref, FOLDERS)?.name ?? null

describe('squash — Unicode-aware match key', () => {
  it('drops spaces / dots / the order prefix but keeps letters+digits', () => {
    expect(squash('1.4 Hu Tao')).toBe('14hutao')
    expect(squash('  Hu   Tao ')).toBe('hutao')
  })

  it('PRESERVES non-Latin scripts (the ASCII-only bug erased them to "")', () => {
    expect(squash('胡桃')).toBe('胡桃')
    expect(squash('1.4 胡桃')).toBe('14胡桃')
    expect(squash('神里綾華')).toBe('神里綾華')
    expect(squash('胡桃')).not.toBe('') // regression guard
  })

  it('strips regex-special punctuation without choking', () => {
    expect(squash('King Deshret & the Three Magi (a.k.a. [Caribert])')).toBe('kingdeshretthethreemagiakacaribert')
    expect(squash('C++ Primer (v2.0)?')).toBe('cprimerv20')
    expect(squash('...(-)[]+*?  ')).toBe('') // all punctuation → empty
  })
})

describe('resolveFolder — English casual names', () => {
  it('matches a spaced name from an unspaced ref (the Hu Tao bug)', () => {
    expect(name('hutao')).toBe('1.4 Hu Tao')
    expect(name('hu tao')).toBe('1.4 Hu Tao')
    expect(name('Hu Tao')).toBe('1.4 Hu Tao')
    expect(name('1.4 Hu Tao')).toBe('1.4 Hu Tao') // exact
  })

  it('still matches the single-word names that already worked', () => {
    expect(name('ganyu')).toBe('1.2 Ganyu')
    expect(name('xiao')).toBe('1.3 Xiao')
    expect(name('xingqiu')).toBe('1.0 Xingqiu')
  })
})

describe('resolveFolder — non-English names', () => {
  it('resolves pure-Chinese folder names', () => {
    expect(name('胡桃')).toBe('1.4 胡桃')
    expect(name('甘雨')).toBe('甘雨')
    expect(name('魈')).toBe('魈')
  })

  it('resolves a bilingual folder by either script', () => {
    expect(name('ayaka')).toBe('1.5 神里綾華 Ayaka')
    expect(name('神里綾華')).toBe('1.5 神里綾華 Ayaka')
  })

  it('does not cross-match the English and Chinese Hu Tao folders', () => {
    expect(name('hutao')).toBe('1.4 Hu Tao') // English
    expect(name('胡桃')).toBe('1.4 胡桃') // Chinese
  })
})

describe('resolveFolder — regex-special / punctuation-heavy names', () => {
  it('matches by an inner word, punctuation inert (no RegExp built from input)', () => {
    expect(name('Requiem')).toBe('14-Requiem of the Echoing Depths.')
    expect(name('requiem of the echoing depths')).toBe('14-Requiem of the Echoing Depths.')
    expect(name('Caribert')).toBe('King Deshret & the Three Magi (a.k.a. [Caribert])')
    expect(name('c++ primer')).toBe('C++ Primer (v2.0)?')
  })

  it('never throws on regex-special refs', () => {
    for (const ref of ['(', '[a-z]+', '.*', 'C++', '\\d{3}', '(?:x)', '$^']) {
      expect(() => resolveFolder(ref, FOLDERS)).not.toThrow()
    }
  })
})

describe('resolveFolder — compound / wrong paths self-heal to the leaf', () => {
  it('resolves a full path with a wrong region + a scene tacked on', () => {
    expect(name("Story Quest/1-liyue/1.0 Xingqiu/Justice, for Books' Sake")).toBe('1.0 Xingqiu')
  })
  it('resolves a content/story-prefixed path', () => {
    expect(name('content/story/Story Quest/2-liyue/1.4 Hu Tao')).toBe('1.4 Hu Tao')
  })
})

describe('resolveFolder — ambiguous / junk → null (caller shows nearest)', () => {
  it('returns null for an ambiguous ref that matches many folders', () => {
    expect(resolveFolder('1.0', FOLDERS)).toBeNull() // 1.0 Xingqiu / Kaeya / Diluc — no single winner
  })
  it('returns null for empty / all-punctuation refs (never match-all)', () => {
    expect(resolveFolder('', FOLDERS)).toBeNull()
    expect(resolveFolder('...(-)', FOLDERS)).toBeNull()
  })
  it('returns null for a nonsense ref', () => {
    expect(resolveFolder('zzzznotathing', FOLDERS)).toBeNull()
  })
})

describe('resolveFolder — unmatched-token guard (the "Event Quests Afterword" incident)', () => {
  it('REFUSES a bare name that contains a folder plus an uncovered token (would silently widen the target)', () => {
    // "Afterword" names something more specific than the Event Quest tree — matching the ancestor would
    // queue a bulk edit on a whole tree the author never named. Must miss → caller shows nearest/teaches.
    expect(resolveFolder('Event Quests Afterword', FOLDERS)).toBeNull()
    expect(resolveFolder('Story Quest epilogue scenes', FOLDERS)).toBeNull()
  })

  it('keeps plural/typo slack (short residue never blocks)', () => {
    expect(name('Event Quests')).toBe('Event Quest')
    expect(name('story quests')).toBe('Story Quest')
  })

  it('keeps fragment refs (ref ⊂ name always has residue, always legitimate)', () => {
    expect(name('Requiem')).toBe('14-Requiem of the Echoing Depths.')
    expect(name('hutao')).toBe('1.4 Hu Tao')
  })

  it('keeps the slashed compound-path self-heal (guard is bare-name only)', () => {
    expect(name("Story Quest/1-liyue/1.0 Xingqiu/Justice, for Books' Sake")).toBe('1.0 Xingqiu')
  })
})

describe('nearestFolders — a miss surfaces the real answer', () => {
  it('surfaces the English Hu Tao folder', () => {
    expect(nearestFolders('hu-tao', FOLDERS)).toContain('Story Quest/2-liyue/1.4 Hu Tao')
  })
  it('surfaces a Chinese folder', () => {
    expect(nearestFolders('胡桃', FOLDERS)).toContain('剧情任务/2-璃月/1.4 胡桃')
  })
  it('ranks by shared segments for a near-miss path', () => {
    const near = nearestFolders('Story Quest/2-liyue/Xingqiu', FOLDERS)
    expect(near[0]).toBe('Story Quest/2-liyue/1.0 Xingqiu')
  })
})
