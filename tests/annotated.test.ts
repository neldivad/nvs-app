import { describe, it, expect } from 'vitest'
import { tokenize } from '../src/renderer/components/ui/Annotated'

const NAMES = [{ id: 'guan-yu', name: 'Guan Yu' }]

describe('Annotated.tokenize — inline thread citations', () => {
  it('parses a `[thread · thr:<scene>:<slug>]` citation into a clickable thread token (not a mono defined-term)', () => {
    const text = 'Guan Yu demands rank. [thread · thr:sanguo-ch065:guan_yu_rank_dispute]: he refuses.'
    const toks = tokenize(text, NAMES, new Map([['guan_yu_rank_dispute', 'thr:sanguo-ch065:guan_yu_rank_dispute']]))
    const thread = toks.find((t) => t.kind === 'thread')
    expect(thread).toBeTruthy()
    expect(thread).toMatchObject({ kind: 'thread', t: 'guan_yu_rank_dispute', id: 'thr:sanguo-ch065:guan_yu_rank_dispute' })
    // the snake_case slug must NOT also surface as an 'enum' (mono "defined term") token — that was the bug
    expect(toks.some((t) => t.kind === 'enum' && t.t === 'guan_yu_rank_dispute')).toBe(false)
  })

  it('leaves the thread id empty (non-clickable, still not mono) when the slug is unknown', () => {
    const text = 'See [thread · thr:sanguo-ch001:unknown_thread] here.'
    const toks = tokenize(text, NAMES)
    expect(toks.find((t) => t.kind === 'thread')).toMatchObject({ kind: 'thread', t: 'unknown_thread', id: '' })
  })

  it('still tags genuine snake_case machine terms as enum defined-terms', () => {
    const toks = tokenize('the flag never_says otherwise', [])
    expect(toks.find((t) => t.kind === 'enum')).toMatchObject({ kind: 'enum', t: 'never_says' })
  })

  it('still links known character names', () => {
    const toks = tokenize('Guan Yu arrives.', NAMES)
    expect(toks.find((t) => t.kind === 'name')).toMatchObject({ kind: 'name', t: 'Guan Yu', id: 'guan-yu' })
  })
})
