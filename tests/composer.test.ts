/**
 * Locks the `/agent` composer + prompt-routing contract:
 *   • composeInstruction — merges free text + selected prompts into one instruction, and "REPLACE WINS"
 *     (a reformat in the chain rewrites the whole page; otherwise append). A silent flip here would make a
 *     Reformat *append a rewritten copy* instead of replacing — nasty + easy to miss.
 *   • isAnalysis — routes a prompt to chat (analysis) vs a page edit (maintenance/generation).
 *   • modeDirective — the per-mode instruction handed to the model.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest'
import { composeInstruction, isAnalysis, modeDirective } from '@shared/config/agentCommands'

describe('composeInstruction — merge + "replace wins"', () => {
  it('joins free text + each preset directive, dropping empties', () => {
    const { instruction } = composeInstruction('tighten the dialogue', [{ directive: 'Reformat the markup.', mode: 'replace' }])
    expect(instruction).toBe('tighten the dialogue\nReformat the markup.')
  })

  it('free text alone → append', () => {
    expect(composeInstruction('add a beat', []).mode).toBe('append')
  })

  it('any REPLACE preset makes the whole edit replace', () => {
    expect(composeInstruction('', [{ directive: 'a', mode: 'append' }, { directive: 'b', mode: 'replace' }]).mode).toBe('replace')
  })

  it('all-append presets → append', () => {
    expect(composeInstruction('', [{ directive: 'a', mode: 'append' }]).mode).toBe('append')
  })

  it('empty free text + a preset → just the preset', () => {
    expect(composeInstruction('   ', [{ directive: 'Draft the next beat.', mode: 'append' }]).instruction).toBe('Draft the next beat.')
  })
})

describe('isAnalysis — chat vs page-edit routing', () => {
  it('analysis runs in chat; maintenance/generation edit the page', () => {
    expect(isAnalysis('analysis')).toBe(true)
    expect(isAnalysis('maintenance')).toBe(false)
    expect(isAnalysis('generation')).toBe(false)
  })
})

describe('modeDirective — what the model is told to return', () => {
  it('replace asks for the full page; append asks for new text only', () => {
    expect(modeDirective('replace').toLowerCase()).toContain('full')
    expect(modeDirective('append').toLowerCase()).toContain('only')
  })
})
