/**
 * Re-export of the shared structural-integrity check (moved to `src/shared/integrity.ts` so the engine can run
 * the SAME algorithm headless on ingest — see internal/renpy-crossref.md second-reader v2). Import from here in
 * the renderer; the implementation and types live in the shared module.
 */
export { checkIntegrity, type IntegrityIssue, type IntegritySeverity, type IntegrityContext } from '@shared/integrity'
