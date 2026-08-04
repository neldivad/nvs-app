/**
 * Locks the producer-output SAFETY NET: even with the prompts that forbid invented names + enforce
 * `[Name](id)` links, the editor's link linter flags a `[Name](id)` whose id isn't a real page (an invented
 * or stale reference) and notes bare `@mentions` that were never linked. (OP2 / "producer control".)
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { lintWorldLinks } from '../src/renderer/lib/fountain/lintWorldLinks'
import type { WorldPage } from '../src/shared/ipc'

const page = (id: string): WorldPage => ({ id, name: id, path: `/world/${id}.md`, kind: 'character' })
const pages = [page('hamlet'), page('horatio')]

describe('lintWorldLinks — flag links to non-existent pages', () => {
  it('passes a link to a real page', () => {
    expect(lintWorldLinks('Best friend of [Hamlet](hamlet).', pages)).toEqual([])
  })

  it('flags a link whose id has no page (invented / stale)', () => {
    const issues = lintWorldLinks('Killed by [the Ghost](kings-ghost).', pages)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 'warn' })
    expect(issues[0].message).toContain('kings-ghost')
  })

  it('de-dupes the same broken id', () => {
    const issues = lintWorldLinks('[A](ghost) then [B](ghost)', pages).filter((i) => i.level === 'warn')
    expect(issues).toHaveLength(1)
  })

  it('notes unlinked @mentions as info (not an error)', () => {
    const issues = lintWorldLinks('met @ophelia and @laertes at court', pages)
    const info = issues.find((i) => i.level === 'info')
    expect(info?.message).toContain('2 unlinked')
  })

  it('clean prose with no links or mentions → no issues', () => {
    expect(lintWorldLinks('A scholar from Wittenberg, steady and rational.', pages)).toEqual([])
  })
})
