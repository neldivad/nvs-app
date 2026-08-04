/**
 * The intentional-rulings ledger (v0 of layered truth): author verdicts on coherence findings, persisted
 * as .nvs/coherence-rulings.json — keyed by (entityId + normalized trait) so they survive re-runs that
 * regenerate finding ids, and Reset analysis (which keeps user JSON).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { annotateFindings, setRuling } from '../src/engine/analysis/coherenceRulings'
import type { CoherenceFinding } from '../src/shared/ipc'

const finding = (entityId: string, trait: string): CoherenceFinding => ({
  id: `${entityId}:${Math.random()}`, // fresh id every "run" — the ledger must not depend on it
  entityId,
  threadId: null,
  asOf: null,
  trait,
  declared: 'x',
  observed: 'y',
  why: null,
  kind: 'contradiction',
  severity: 'high',
  suggestion: '',
  evidence: []
})

describe('coherence rulings ledger', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nvs-rulings-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('marks a finding intentional across re-runs (fresh ids, wording-insensitive key)', () => {
    setRuling(root, 'claudius', 'Genial king persona', true)
    // a later run reproduces the finding with a NEW id and different punctuation/case
    const rerun = [finding('claudius', 'genial KING persona!'), finding('ophelia', 'Cold Hamlet')]
    const out = annotateFindings(root, rerun)
    expect(out[0].intentional).toBe(true)
    expect(out[1].intentional).toBeUndefined()
  })

  it('withdrawing the ruling resumes flagging', () => {
    setRuling(root, 'claudius', 'Genial king persona', true)
    setRuling(root, 'claudius', 'Genial king persona', false)
    const out = annotateFindings(root, [finding('claudius', 'Genial king persona')])
    expect(out[0].intentional).toBeUndefined()
  })

  it('is idempotent (double-mark = one entry) and scoped per entity', () => {
    setRuling(root, 'claudius', 'trait A', true)
    setRuling(root, 'claudius', 'trait A', true)
    const file = JSON.parse(readFileSync(join(root, '.nvs', 'coherence-rulings.json'), 'utf8'))
    expect(file.rulings).toHaveLength(1)
    // same trait on a DIFFERENT entity is untouched
    const out = annotateFindings(root, [finding('laertes', 'trait A')])
    expect(out[0].intentional).toBeUndefined()
  })

  it('tolerates a malformed ledger file (findings pass through unannotated)', () => {
    mkdirSync(join(root, '.nvs'), { recursive: true })
    writeFileSync(join(root, '.nvs', 'coherence-rulings.json'), '{not json')
    const out = annotateFindings(root, [finding('claudius', 'x')])
    expect(out[0].intentional).toBeUndefined()
    // and a write after corruption recovers the file
    setRuling(root, 'claudius', 'x', true)
    expect(annotateFindings(root, [finding('claudius', 'x')])[0].intentional).toBe(true)
  })
})
