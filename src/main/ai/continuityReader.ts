/**
 * The CONTINUITY pass (plot-holes) — the reader the ingest runner calls to check the story against ITSELF and its
 * premise (internal/continuity-coherence.md). Sibling of readCoherence, kept in its own file so it doesn't touch the
 * batching-track's sceneReader (it borrows only the exported `complete`). One WHOLE-STORY call: the declared rules +
 * premise vs the fact/thread timeline → continuity findings, written as ONE t3:continuity TierWrite.
 *
 * v1 is a single call over the whole timeline — realistic corpora (a few hundred fact lines) fit context easily, and
 * the OUTPUT stays bounded because the prompt asks for FEW, high-confidence holes. Act-chunking with priorContext
 * (buildContinuityPayload already accepts it) is a deferred scale step for pathological works; until then a
 * pathological corpus is capped to the most-recent MAX_FACTS lines with a logged note (never a silent truncation).
 */
import { AI_PROVIDERS } from '@shared/config/aiProviders'
import {
  CONTINUITY_KINDS,
  buildContinuityPayload,
  languageDirective,
  analysisPrompts,
  type ContinuityExtraction
} from '@shared/config/extraction'
import { parseJson } from './batchDistribute'
import { recoverEvidence, type EvidenceAnchor } from './evidenceRecovery'
import * as engine from '@engine/index'
import { getAnalysis } from './registry'
import { complete } from './sceneReader'
import { logIngestEvent } from './ingestTelemetry'
import type { ContinuityFindingRow, TierWrite } from '@shared/ipc'

export type ContinuityResult = { write: Extract<TierWrite, { kind: 'continuity' }> } | { skip: string }

const KIND_SET = new Set<string>(CONTINUITY_KINDS)
const SEV = new Set(['low', 'medium', 'high'])
const MAX_FACTS = 1500 // pathological-corpus guard; act-chunking (Phase 5) replaces this

const withLang = (user: string): string => user + languageDirective(engine.readProjectInfo().inLanguage?.[0])

export async function readContinuity(signal: AbortSignal): Promise<ContinuityResult> {
  const active = getAnalysis()
  if (!active) return { skip: 'no AI connected' }
  const inputs = engine.continuityInputs()
  if (!inputs) return { skip: 'no story facts to check yet' }
  if (engine.continuityStatus() === 'fresh') return { skip: 'continuity is up to date' }

  const model = active.model || AI_PROVIDERS[active.type].label
  let facts = inputs.facts
  if (facts.length > MAX_FACTS) {
    logIngestEvent({ kind: 'continuity', targetId: 'story', model, status: 'ok', note: `capped ${facts.length}→${MAX_FACTS} fact lines (act-chunking deferred)` })
    facts = facts.slice(-MAX_FACTS) // keep the most recent stretch, where late-story holes concentrate
  }
  const user = buildContinuityPayload({ declared: inputs.declared, facts, threads: inputs.threads })

  const t0 = Date.now()
  const text = await complete(analysisPrompts(engine.readProjectInfo().domain).continuity, withLang(user), model, signal)
  logIngestEvent({ kind: 'continuity', targetId: 'story', ms: Date.now() - t0, model, promptChars: user.length, responseChars: text.length, status: 'ok' })
  const x = parseJson<ContinuityExtraction>(text)
  if (!x) throw new Error('the continuity pass returned unparseable JSON')

  // Only accept evidence ids we actually offered — a scene_id from the fact timeline or a thread_id from THREADS.
  const sceneIds = new Set(inputs.facts.map((f) => f.sceneId))
  const threadIds = new Set(inputs.threads.map((t) => t.threadId))
  // FK-validation: resolve the model's free-text entity name → the canonical entity id (bilingual-aware), so a
  // finding attaches to the REAL entity ("Emperor Ling" → "emperor-ling") instead of drawing a phantom cast row.
  const resolveEid = engine.entityIdResolver()
  // Same anchors we rendered into the payload (`[title · id] text` for facts and threads) — so a finding that
  // cites nothing can be placed from its own prose instead of collapsing onto the as-of checkpoint.
  const anchors: EvidenceAnchor[] = [
    ...inputs.facts.map((f) => ({ id: f.sceneId, title: f.title, text: f.text })),
    ...inputs.threads.map((t) => ({ id: t.threadId, title: t.title, text: t.text }))
  ]
  const findings: ContinuityFindingRow[] = []
  for (const f of x.findings ?? []) {
    if (!KIND_SET.has(f.kind) || !SEV.has(f.severity)) continue // drop malformed kinds/severities (no invention)
    const cited = Array.isArray(f.evidence_unit_ids) ? f.evidence_unit_ids.filter((id) => typeof id === 'string') : []
    const valid = cited.filter((id) => sceneIds.has(id) || threadIds.has(id))
    // Recover only when the model cited nothing usable; a real citation always wins.
    const evidence = valid.length ? valid : recoverEvidence(`${f.declared ?? ''}\n${f.observed ?? ''}\n${f.suggestion ?? ''}`, anchors)
    findings.push({
      entityId: f.entity_id?.trim() ? resolveEid(f.entity_id) : null, // resolve to canonical id; unresolvable → work-level
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
      kind: 'continuity',
      targetId: 'story',
      asOfUnitId: inputs.checkpoint,
      model,
      inputHash: engine.continuityInputHash(inputs),
      rows: { findings }
    }
  }
}
