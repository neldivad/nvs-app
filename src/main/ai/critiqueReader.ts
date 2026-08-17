/**
 * The CRITIQUE pass ("Tough questions") — the fourth family's reader (internal/story-critique.md, Slice 1).
 * Sibling of readContinuity, same one-whole-story-call shape: the engine's DETERMINISTIC cut-candidates + the
 * shared thread/fact timeline → a REFUTE-BIASED confirm pass → `inert` findings, written as ONE t3:critique
 * TierWrite. The graph proposes; the model's only job is to kill false positives (the RoTK probe: episodic
 * spine ≠ cuttable, finales absorb consequences, dependencies live in prose the graph can't see).
 *
 * Opt-in by design (deterministic-over-AI ruling): the runner only calls this when the author explicitly asked
 * for the tough questions — never as part of the automatic analysis flow.
 */
import { AI_PROVIDERS } from '@shared/config/aiProviders'
import { CRITIQUE_KINDS, buildCritiquePayload, languageDirective, analysisPrompts, type CritiqueExtraction } from '@shared/config/extraction'
import { parseJson } from './batchDistribute'
import { recoverEvidence, type EvidenceAnchor } from './evidenceRecovery'
import * as engine from '@engine/index'
import { getAnalysis } from './registry'
import { complete } from './sceneReader'
import { logIngestEvent } from './ingestTelemetry'
import type { CritiqueFindingRow, TierWrite } from '@shared/ipc'

export type CritiqueResult = { write: Extract<TierWrite, { kind: 'critique' }> } | { skip: string }

const KIND_SET = new Set<string>(CRITIQUE_KINDS)
const SEV = new Set(['low', 'medium', 'high'])
const MAX_FACTS = 1500 // same pathological-corpus guard as continuity

const withLang = (user: string): string => user + languageDirective(engine.readProjectInfo().inLanguage?.[0])

export async function readCritique(signal: AbortSignal): Promise<CritiqueResult> {
  const active = getAnalysis()
  if (!active) return { skip: 'no AI connected' }
  const inputs = engine.critiqueInputs()
  if (!inputs) return { skip: 'no cut-candidates to judge yet' }
  if (engine.critiqueStatus() === 'fresh') return { skip: 'tough questions are up to date' }

  const model = active.model || AI_PROVIDERS[active.type].label
  let facts = inputs.facts
  if (facts.length > MAX_FACTS) {
    logIngestEvent({ kind: 'critique', targetId: 'story', model, status: 'ok', note: `capped ${facts.length}→${MAX_FACTS} fact lines` })
    facts = facts.slice(-MAX_FACTS)
  }
  const user = buildCritiquePayload({ candidates: inputs.candidates, threads: inputs.threads, facts })

  const t0 = Date.now()
  const text = await complete(analysisPrompts(engine.readProjectInfo().domain).critique, withLang(user), model, signal)
  logIngestEvent({ kind: 'critique', targetId: 'story', ms: Date.now() - t0, model, promptChars: user.length, responseChars: text.length, status: 'ok' })
  const x = parseJson<CritiqueExtraction>(text)
  if (!x) throw new Error('the critique pass returned unparseable JSON')

  // Only accept evidence we actually offered — a candidate/thread id or a scene id from the fact timeline.
  const sceneIds = new Set(inputs.facts.map((f) => f.sceneId))
  const threadIds = new Set(inputs.threads.map((t) => t.threadId))
  const candidateIds = new Set(inputs.candidates.map((c) => c.id))
  const anchors: EvidenceAnchor[] = [
    ...inputs.candidates.map((c) => ({ id: c.id, title: c.label, text: c.text })),
    ...inputs.threads.map((t) => ({ id: t.threadId, title: t.title, text: t.text })),
    ...inputs.facts.map((f) => ({ id: f.sceneId, title: f.title, text: f.text }))
  ]
  const findings: CritiqueFindingRow[] = []
  for (const f of x.findings ?? []) {
    if (!KIND_SET.has(f.kind) || !SEV.has(f.severity)) continue // family-strict: drop invented kinds
    const cited = Array.isArray(f.evidence_unit_ids) ? f.evidence_unit_ids.filter((id) => typeof id === 'string') : []
    const valid = cited.filter((id) => candidateIds.has(id) || sceneIds.has(id) || threadIds.has(id))
    const evidence = valid.length ? valid : recoverEvidence(`${f.declared ?? ''}\n${f.observed ?? ''}\n${f.suggestion ?? ''}`, anchors)
    findings.push({
      entityId: null, // work-level by contract
      trait: f.trait ?? '',
      declared: f.declared ?? '',
      observed: f.observed ?? '',
      kind: f.kind,
      severity: f.severity,
      suggestion: f.suggestion ?? '',
      evidence
    })
  }

  return {
    write: {
      tier: 't3',
      kind: 'critique',
      targetId: 'story',
      asOfUnitId: inputs.checkpoint,
      model,
      inputHash: engine.critiqueInputHash(inputs),
      rows: { findings }
    }
  }
}
