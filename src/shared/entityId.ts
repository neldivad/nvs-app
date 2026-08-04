/**
 * entityId — back-compat shim. The canonical id rule now lives in @shared/contentId (`slugId`), the single
 * generation source for ALL content types (scenes/entities/folders). `nameToId` is kept as an alias for the
 * existing entity call sites + the multiscript test. See internal/content-id.md.
 */
export { slugId as nameToId, isCanonicalId } from './contentId'
