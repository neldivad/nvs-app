/**
 * Jobs taxonomy — the ONE declaration of what a "job" is: its KINDS, its STATUS lifecycle, and the TABLE
 * COLUMNS the Jobs dashboard renders (AME-style queue). The app renders jobs FROM this (like nvsArtifacts /
 * regions), so adding a kind or a column is a config change, not a UI rewrite.
 *
 * ── PERSISTENCE BOUNDARY (the important call) ────────────────────────────────────────────────────────────
 * A job record carries MACHINE-LOCAL, PRIVATE data: cost ($/tokens), memory, per-step timings, the provider
 * used. That must NEVER enter `nvs.db`, because nvs.db is EXPORTED with the nvsproj (nvsArtifacts: nvs.db is
 * `exported:true`, "the inseparable ledger") — a jobs table there would leak the author's spend, provider, and
 * machine profile to anyone who downloads the project. So:
 *   • LIVE jobs        → in-memory (the run state), broadcast to the UI.
 *   • job HISTORY+cost → the LOCAL, non-exported `.nvs/ingest-telemetry.jsonl` (nvsArtifacts: class 'local',
 *                        exported:false, survivesReset) — private, stays on this machine.
 *   • run PROVENANCE   → which analysis VERSION covered what — already in the EXPORTED `ingest-runs.json`
 *                        sessions ledger. That's the ONLY job-adjacent thing that's shared, and it carries no
 *                        cost/provider/memory. Do NOT duplicate it here.
 * Net: nothing new goes in nvs.db; the private columns (cost/memory/provider) are sourced from local telemetry.
 */
import type { JobKind, JobStatus, JobRow } from '@shared/ipc'

export interface JobKindMeta {
  label: string
  blurb: string
  accent: string // a DESIGN.md color token name (thread/flag/…) — a dot in the table, not a lucide import here
}
export const JOB_KINDS: Record<JobKind, JobKindMeta> = {
  analysis: { label: 'Analysis', blurb: 'Read scenes → threads, entities, arcs', accent: 'thread' },
  coherence: { label: 'Coherence', blurb: 'Diff declared pages vs observed prose', accent: 'flag' },
  skim: { label: 'Skim', blurb: 'Structure survey → reading scaffold', accent: 'muted' },
  extension: { label: 'Extension', blurb: 'A community extension run', accent: 'muted' },
  export: { label: 'Export', blurb: 'Bundle the project for sharing', accent: 'muted' }
}

export interface JobStatusMeta {
  label: string
  tone: 'active' | 'paused' | 'ok' | 'error' | 'idle'
  active: boolean // counts toward the "N running" badge + blocks a clean exit
  terminal: boolean // a finished state (done/failed/cancelled) — lives only in history
}
export const JOB_STATUSES: Record<JobStatus, JobStatusMeta> = {
  queued: { label: 'Queued', tone: 'idle', active: false, terminal: false },
  running: { label: 'Running', tone: 'active', active: true, terminal: false },
  paused: { label: 'Paused', tone: 'paused', active: false, terminal: false },
  done: { label: 'Done', tone: 'ok', active: false, terminal: true },
  failed: { label: 'Failed', tone: 'error', active: false, terminal: true },
  cancelled: { label: 'Cancelled', tone: 'idle', active: false, terminal: true }
}

/** The Jobs table columns (AME Queue analog). `private` = sourced from LOCAL telemetry, never exported. */
export interface JobColumn {
  id: keyof JobRow | 'progress'
  label: string
  align: 'left' | 'right'
  grow?: boolean
  private?: boolean
}
export const JOB_COLUMNS: JobColumn[] = [
  { id: 'projectName', label: 'Project', align: 'left', grow: true }, // the ONLY flexible column — absorbs slack + truncates
  { id: 'kind', label: 'Kind', align: 'left' },
  { id: 'status', label: 'Status', align: 'left' },
  { id: 'progress', label: 'Progress', align: 'left' },
  { id: 'etaMs', label: 'ETA', align: 'right' },
  { id: 'cost', label: 'Cost', align: 'right', private: true },
  { id: 'memoryMb', label: 'Memory', align: 'right', private: true },
  { id: 'provider', label: 'Provider', align: 'left' },
  { id: 'at', label: 'Started', align: 'right' }
]

/** tone → text color (DESIGN.md tokens). */
export const JOB_TONE_CLASS: Record<JobStatusMeta['tone'], string> = {
  active: 'text-thread',
  paused: 'text-warn', // was text-amber-500 (raw palette, dark-only) — text-warn is the amber token that flips
  ok: 'text-ok',
  error: 'text-flag',
  idle: 'text-muted-foreground'
}
