import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CHANNELS, type NvsApi } from '@shared/ipc'

/**
 * The waiter. The ONLY code that sees both the renderer and Electron. It builds
 * one object — the menu — and forwards each call to its channel via
 * ipcRenderer.invoke (post a message to main, await the reply).
 *
 * Typing it `NvsApi` means preload and the contract can't drift: a missing or
 * mis-typed method fails to compile.
 */
const api: NvsApi = {
  ping: () => ipcRenderer.invoke(CHANNELS.ping),
  minimizeWindow: () => ipcRenderer.invoke(CHANNELS.minimizeWindow),
  toggleMaximizeWindow: () => ipcRenderer.invoke(CHANNELS.toggleMaximizeWindow),
  closeWindow: () => ipcRenderer.invoke(CHANNELS.closeWindow),
  toggleDevTools: () => ipcRenderer.invoke(CHANNELS.toggleDevTools),
  confirmClose: () => ipcRenderer.invoke(CHANNELS.confirmClose),
  onAppBeforeClose: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on(CHANNELS.onAppBeforeClose, handler)
    return () => ipcRenderer.removeListener(CHANNELS.onAppBeforeClose, handler)
  },
  bootOpenWork: () => ipcRenderer.invoke(CHANNELS.bootOpenWork),
  listWorks: () => ipcRenderer.invoke(CHANNELS.listWorks),
  listAllJobs: () => ipcRenderer.invoke(CHANNELS.listAllJobs),
  readTelemetry: (root, limit) => ipcRenderer.invoke(CHANNELS.readTelemetry, root, limit),
  storageUsage: () => ipcRenderer.invoke(CHANNELS.storageUsage),
  clearStorage: (root, kind) => ipcRenderer.invoke(CHANNELS.clearStorage, root, kind),
  compactSnapshots: (root) => ipcRenderer.invoke(CHANNELS.compactSnapshots, root),
  getEntitlement: () => ipcRenderer.invoke(CHANNELS.getEntitlement),
  verifyPro: (email) => ipcRenderer.invoke(CHANNELS.verifyPro, email),
  setProDev: (pro) => ipcRenderer.invoke(CHANNELS.setProDev, pro),
  createWork: (name) => ipcRenderer.invoke(CHANNELS.createWork, name),
  openExternal: () => ipcRenderer.invoke(CHANNELS.openExternal),
  openWork: (path) => ipcRenderer.invoke(CHANNELS.openWork, path),
  currentProject: () => ipcRenderer.invoke(CHANNELS.currentProject),
  listRecents: () => ipcRenderer.invoke(CHANNELS.listRecents),
  saveToLibrary: () => ipcRenderer.invoke(CHANNELS.saveToLibrary),
  fetchRegistry: () => ipcRenderer.invoke(CHANNELS.fetchRegistry),
  installCommunityWork: (work) => ipcRenderer.invoke(CHANNELS.installCommunityWork, work),
  listDownloads: () => ipcRenderer.invoke(CHANNELS.listDownloads),
  sceneAnalysis: (unitId) => ipcRenderer.invoke(CHANNELS.sceneAnalysis, unitId),
  searchContent: (query, limit) => ipcRenderer.invoke(CHANNELS.searchContent, query, limit),
  listSecretEvents: () => ipcRenderer.invoke(CHANNELS.listSecretEvents),
  listCustodyEvents: () => ipcRenderer.invoke(CHANNELS.listCustodyEvents),
  listArcEvents: () => ipcRenderer.invoke(CHANNELS.listArcEvents),
  listDeclaredSecrets: () => ipcRenderer.invoke(CHANNELS.listDeclaredSecrets),
  listCustodyTopics: () => ipcRenderer.invoke(CHANNELS.listCustodyTopics),
  parseCustodyBlock: (markdown: string) => ipcRenderer.invoke(CHANNELS.parseCustodyBlock, markdown),
  createCustodyTopic: (meta, records) => ipcRenderer.invoke(CHANNELS.createCustodyTopic, meta, records),
  updateCustodyRecords: (pageId, records) => ipcRenderer.invoke(CHANNELS.updateCustodyRecords, pageId, records),
  listExtensions: () => ipcRenderer.invoke(CHANNELS.listExtensions),
  installExtension: (id) => ipcRenderer.invoke(CHANNELS.installExtension, id),
  uninstallExtension: (id) => ipcRenderer.invoke(CHANNELS.uninstallExtension, id),
  setExtensionEnabled: (id, enabled) => ipcRenderer.invoke(CHANNELS.setExtensionEnabled, id, enabled),
  startExtension: (id, params) => ipcRenderer.invoke(CHANNELS.startExtension, id, params),
  stopExtension: (id) => ipcRenderer.invoke(CHANNELS.stopExtension, id),
  extensionStatus: (id) => ipcRenderer.invoke(CHANNELS.extensionStatus, id),
  listThreads: () => ipcRenderer.invoke(CHANNELS.listThreads),
  listCoherenceFindings: () => ipcRenderer.invoke(CHANNELS.listCoherenceFindings),
  threadDetail: (threadId) => ipcRenderer.invoke(CHANNELS.threadDetail, threadId),
  listCharacterArcs: () => ipcRenderer.invoke(CHANNELS.listCharacterArcs),
  inspectTables: () => ipcRenderer.invoke(CHANNELS.inspectTables),
  inspectRows: (table, limit, offset) => ipcRenderer.invoke(CHANNELS.inspectRows, table, limit, offset),
  listEntityTracks: () => ipcRenderer.invoke(CHANNELS.listEntityTracks),
  listEntityArcs: () => ipcRenderer.invoke(CHANNELS.listEntityArcs),
  setCoherenceRuling: (entityId, trait, intentional) => ipcRenderer.invoke(CHANNELS.setCoherenceRuling, entityId, trait, intentional),
  readUiState: () => ipcRenderer.invoke(CHANNELS.readUiState),
  writeUiState: (state) => ipcRenderer.invoke(CHANNELS.writeUiState, state),
  listScenes: () => ipcRenderer.invoke(CHANNELS.listScenes),
  readScene: (path) => ipcRenderer.invoke(CHANNELS.readScene, path),
  writeScene: (path, frontmatter, body) =>
    ipcRenderer.invoke(CHANNELS.writeScene, path, frontmatter, body),
  writeSceneRaw: (path, text) => ipcRenderer.invoke(CHANNELS.writeSceneRaw, path, text),
  stringifyScene: (frontmatter, body) =>
    ipcRenderer.invoke(CHANNELS.stringifyScene, frontmatter, body),
  createScene: (chapterSlug, id, frontmatter, body) =>
    ipcRenderer.invoke(CHANNELS.createScene, chapterSlug, id, frontmatter, body),
  listStoryTree: () => ipcRenderer.invoke(CHANNELS.listStoryTree),
  createFolder: (parentRel, name, type) => ipcRenderer.invoke(CHANNELS.createFolder, parentRel, name, type),
  setFolderType: (folderRel, type) => ipcRenderer.invoke(CHANNELS.setFolderType, folderRel, type),
  renamePath: (fromRel, toRel) => ipcRenderer.invoke(CHANNELS.renamePath, fromRel, toRel),
  deletePath: (rel) => ipcRenderer.invoke(CHANNELS.deletePath, rel),
  setOrder: (folderRel, names) => ipcRenderer.invoke(CHANNELS.setOrder, folderRel, names),
  createSceneInFolder: (folderRel, id, frontmatter, body) =>
    ipcRenderer.invoke(CHANNELS.createSceneInFolder, folderRel, id, frontmatter, body),
  readTimeline: () => ipcRenderer.invoke(CHANNELS.readTimeline),
  writeTimeline: (layout) => ipcRenderer.invoke(CHANNELS.writeTimeline, layout),
  trees: () => ipcRenderer.invoke(CHANNELS.trees),
  saveTrees: (trees) => ipcRenderer.invoke(CHANNELS.saveTrees, trees),
  corkboard: () => ipcRenderer.invoke(CHANNELS.corkboard),
  saveCorkboard: (file) => ipcRenderer.invoke(CHANNELS.saveCorkboard, file),
  timelineGraph: () => ipcRenderer.invoke(CHANNELS.timelineGraph),
  listWorldPages: () => ipcRenderer.invoke(CHANNELS.listWorldPages),
  worldBacklinks: (pageId) => ipcRenderer.invoke(CHANNELS.worldBacklinks, pageId),
  createWorldPage: (kind, id, frontmatter, body) =>
    ipcRenderer.invoke(CHANNELS.createWorldPage, kind, id, frontmatter, body),
  deletePage: (path) => ipcRenderer.invoke(CHANNELS.deletePage, path),
  importImages: (pageId, kind) => ipcRenderer.invoke(CHANNELS.importImages, pageId, kind),
  importImagePaths: (pageId, kind, paths) =>
    ipcRenderer.invoke(CHANNELS.importImagePaths, pageId, kind, paths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  ingestWork: () => ipcRenderer.invoke(CHANNELS.ingestWork),
  resetAnalysis: () => ipcRenderer.invoke(CHANNELS.resetAnalysis),
  writeTier: (p) => ipcRenderer.invoke(CHANNELS.writeTier, p),
  mergeThreads: (ids) => ipcRenderer.invoke(CHANNELS.mergeThreads, ids),
  mergeEntities: (ids) => ipcRenderer.invoke(CHANNELS.mergeEntities, ids),
  relationshipEvidence: (aId, bId) => ipcRenderer.invoke(CHANNELS.relationshipEvidence, aId, bId),
  listLoreView: () => ipcRenderer.invoke(CHANNELS.listLoreView),
  exportProject: () => ipcRenderer.invoke(CHANNELS.exportProject),
  exportManuscript: () => ipcRenderer.invoke(CHANNELS.exportManuscript),
  exportScene: (scenePath) => ipcRenderer.invoke(CHANNELS.exportScene, scenePath),
  saveImage: (suggestedName, dataUrl) => ipcRenderer.invoke(CHANNELS.saveImage, suggestedName, dataUrl),
  exportStructured: (format) => ipcRenderer.invoke(CHANNELS.exportStructured, format),
  exportSceneStructured: (scenePath, format) => ipcRenderer.invoke(CHANNELS.exportSceneStructured, scenePath, format),
  importStructured: () => ipcRenderer.invoke(CHANNELS.importStructured),
  importProject: () => ipcRenderer.invoke(CHANNELS.importProject),
  forkWork: (sourcePath) => ipcRenderer.invoke(CHANNELS.forkWork, sourcePath),
  deleteWork: (path) => ipcRenderer.invoke(CHANNELS.deleteWork, path),
  restoreExamples: () => ipcRenderer.invoke(CHANNELS.restoreExamples),
  readProjectInfo: () => ipcRenderer.invoke(CHANNELS.readProjectInfo),
  readProjectInfoAt: (path) => ipcRenderer.invoke(CHANNELS.readProjectInfoAt, path),
  readStructure: () => ipcRenderer.invoke(CHANNELS.readStructure),
  writeStructure: (worldKeys, sceneKeys) => ipcRenderer.invoke(CHANNELS.writeStructure, worldKeys, sceneKeys),
  writeProjectInfo: (patch) => ipcRenderer.invoke(CHANNELS.writeProjectInfo, patch),
  pickCover: () => ipcRenderer.invoke(CHANNELS.pickCover),
  pickCoverFromPath: (path) => ipcRenderer.invoke(CHANNELS.pickCoverFromPath, path),
  renameWork: (path, newName) => ipcRenderer.invoke(CHANNELS.renameWork, path, newName),
  closeWork: () => ipcRenderer.invoke(CHANNELS.closeWork),
  tierInputHash: (kind, targetId, asOf) => ipcRenderer.invoke(CHANNELS.tierInputHash, kind, targetId, asOf),
  listTierStatus: () => ipcRenderer.invoke(CHANNELS.listTierStatus),
  coherenceStatus: () => ipcRenderer.invoke(CHANNELS.coherenceStatus),
  timelineStatus: () => ipcRenderer.invoke(CHANNELS.timelineStatus),
  runIngestBundle: (name) => ipcRenderer.invoke(CHANNELS.runIngestBundle, name),
  listIngestBundles: () => ipcRenderer.invoke(CHANNELS.listIngestBundles),
  startIngestRun: (forceScenes, depth) => ipcRenderer.invoke(CHANNELS.startIngestRun, forceScenes, depth),
  planIngestPreview: (depth) => ipcRenderer.invoke(CHANNELS.planIngestPreview, depth),
  startCoherenceRun: () => ipcRenderer.invoke(CHANNELS.startCoherenceRun),
  cancelIngestRun: () => ipcRenderer.invoke(CHANNELS.cancelIngestRun),
  listIngestSessions: () => ipcRenderer.invoke(CHANNELS.listIngestSessions),
  revertIngestSession: (id) => ipcRenderer.invoke(CHANNELS.revertIngestSession, id),
  setViewingVersion: (snapshotId) => ipcRenderer.invoke(CHANNELS.setViewingVersion, snapshotId),
  onIngestProgress: (cb) => {
    const handler = (_e: unknown, p: Parameters<typeof cb>[0]): void => cb(p)
    ipcRenderer.on(CHANNELS.onIngestProgress, handler)
    return () => ipcRenderer.removeListener(CHANNELS.onIngestProgress, handler)
  },
  mcpStatus: () => ipcRenderer.invoke(CHANNELS.mcpStatus),
  mcpHeadlessInfo: () => ipcRenderer.invoke(CHANNELS.mcpHeadlessInfo),
  generateClaudePlugin: () => ipcRenderer.invoke(CHANNELS.generateClaudePlugin),
  aiConnections: () => ipcRenderer.invoke(CHANNELS.aiConnections),
  saveConnection: (input) => ipcRenderer.invoke(CHANNELS.saveConnection, input),
  removeConnection: (id) => ipcRenderer.invoke(CHANNELS.removeConnection, id),
  setActiveConnection: (id) => ipcRenderer.invoke(CHANNELS.setActiveConnection, id),
  setAnalysisConnection: (id) => ipcRenderer.invoke(CHANNELS.setAnalysisConnection, id),
  runAgent: (history, context) => ipcRenderer.invoke(CHANNELS.runAgent, history, context),
  onAgentEvent: (cb) => {
    const handler = (_e: unknown, evt: Parameters<typeof cb>[0]): void => cb(evt)
    ipcRenderer.on(CHANNELS.onAgentEvent, handler)
    return () => ipcRenderer.removeListener(CHANNELS.onAgentEvent, handler)
  },
  cancelAgent: () => ipcRenderer.invoke(CHANNELS.cancelAgent),
  runPageAgent: (input) => ipcRenderer.invoke(CHANNELS.runPageAgent, input),
  cancelPageAgent: () => ipcRenderer.invoke(CHANNELS.cancelPageAgent),
  enqueueTask: (input) => ipcRenderer.invoke(CHANNELS.enqueueTask, input),
  listTasks: () => ipcRenderer.invoke(CHANNELS.listTasks),
  onTaskUpdate: (cb) => {
    const handler = (_e: unknown, tasks: Parameters<typeof cb>[0]): void => cb(tasks)
    ipcRenderer.on(CHANNELS.onTaskUpdate, handler)
    return () => ipcRenderer.removeListener(CHANNELS.onTaskUpdate, handler)
  },
  onProjectChanged: (cb) => {
    const handler = (_e: unknown, change: Parameters<typeof cb>[0]): void => cb(change)
    ipcRenderer.on(CHANNELS.onProjectChanged, handler)
    return () => ipcRenderer.removeListener(CHANNELS.onProjectChanged, handler)
  },
  cancelTask: (id) => ipcRenderer.invoke(CHANNELS.cancelTask, id),
  dismissTask: (id) => ipcRenderer.invoke(CHANNELS.dismissTask, id),
  clearDoneTasks: () => ipcRenderer.invoke(CHANNELS.clearDoneTasks),
  listPrompts: () => ipcRenderer.invoke(CHANNELS.listPrompts),
  savePrompt: (p) => ipcRenderer.invoke(CHANNELS.savePrompt, p),
  deletePrompt: (id) => ipcRenderer.invoke(CHANNELS.deletePrompt, id),
  openUrl: (url) => ipcRenderer.invoke(CHANNELS.openUrl, url),
  listChatSessions: () => ipcRenderer.invoke(CHANNELS.listChatSessions),
  readChatSession: (id) => ipcRenderer.invoke(CHANNELS.readChatSession, id),
  writeChatSession: (session) => ipcRenderer.invoke(CHANNELS.writeChatSession, session),
  setActiveChatSession: (id) => ipcRenderer.invoke(CHANNELS.setActiveChatSession, id),
  deleteChatSession: (id) => ipcRenderer.invoke(CHANNELS.deleteChatSession, id)
}

// The gate: this is the ONLY thing the renderer receives. Everything else in
// Node/Electron stays unreachable from the sandboxed page.
contextBridge.exposeInMainWorld('nvs', api)
