import { contextBridge, ipcRenderer } from 'electron'
import { JmcApi, Attachment, ProviderId, ActiveContext, AiProviderConfig, UpdateStatus } from '../types/jmc'

/**
 * Guvenli preload köprüsü.
 *
 * Renderer'a yalnizca acikca tanimlanmis, dar bir API yüzeyi açılır.
 * Hiçbir zaman ham API anahtarı, dosya sistemi erişimi veya Node yeteneği
 * renderer'a sızmaz. Tüm çağrılar main sürecinde yeniden doğrulanır.
 */
/**
 * Su anda devam eden yayin kanali (varsa).
 *
   * Yalnizca tanilama icin tutulur; iptal `ai:cancel` uzerinden global
   * calisir ve kanala ihtiyac duymaz.
   */
let activeChannelId: string | null = null

const api: JmcApi = {
  // Hesap
  loginWithGoogle: (extraScopes) => ipcRenderer.invoke('auth:loginWithGoogle', extraScopes),
  cancelLogin: () => ipcRenderer.invoke('auth:cancelLogin'),
  logout: (wipeLocalCache) => ipcRenderer.invoke('auth:logout', wipeLocalCache),
  getAccount: () => ipcRenderer.invoke('auth:getAccount'),
  getDiagnostics: () => ipcRenderer.invoke('auth:getDiagnostics'),
  getAccountCapability: () => ipcRenderer.invoke('auth:getAccountCapability'),
  setClientId: (clientId) => ipcRenderer.invoke('auth:setClientId', clientId),
  getClientId: () => ipcRenderer.invoke('auth:getClientId'),
  setClientSecret: (clientSecret) => ipcRenderer.invoke('auth:setClientSecret', clientSecret),
  resetCustomClient: () => ipcRenderer.invoke('auth:resetCustomClient'),
  validateClientId: (clientId) => ipcRenderer.invoke('auth:validateClientId', clientId),
  importGoogleCredentialsJson: (jsonContent) => ipcRenderer.invoke('auth:importGoogleCredentialsJson', jsonContent),
  pickAndImportCredentialsFile: () => ipcRenderer.invoke('auth:pickAndImportCredentialsFile'),
  pickAttachmentFile: () => ipcRenderer.invoke('app:pickAttachmentFile'),
  completeAuthWithCode: (rawCodeOrUrl, redirectUri, codeVerifier) =>
    ipcRenderer.invoke('auth:completeAuthWithCode', rawCodeOrUrl, redirectUri, codeVerifier),

  // Senkronizasyon
  syncAll: () => ipcRenderer.invoke('classroom:syncAll'),
  getSyncStatus: () => ipcRenderer.invoke('classroom:getSyncStatus'),
  getCourses: () => ipcRenderer.invoke('classroom:getCourses'),
  search: (query) => ipcRenderer.invoke('classroom:search', query),
  turnIn: (courseId, workId, submissionId) =>
    ipcRenderer.invoke('classroom:turnIn', courseId, workId, submissionId),
  reclaim: (courseId, workId, submissionId) =>
    ipcRenderer.invoke('classroom:reclaim', courseId, workId, submissionId),
  attachAndTurnIn: (courseId, workId, submissionId, fileName, content) =>
    ipcRenderer.invoke('classroom:attachAndTurnIn', courseId, workId, submissionId, fileName, content),
  getCourseDetails: (courseId) => ipcRenderer.invoke('classroom:getCourseDetails', courseId),
  getCourseWork: (courseId, workId) => ipcRenderer.invoke('classroom:getCourseWork', courseId, workId),

  // Dosyalar
  downloadAttachment: (attachment: Attachment, courseId: string) =>
    ipcRenderer.invoke('drive:downloadAttachment', attachment, courseId),
  checkDownloadedFile: (attachment: unknown) =>
    ipcRenderer.invoke('downloads:checkFileStatus', attachment),
  openLocalFile: (filePath) => ipcRenderer.invoke('drive:openLocalFile', filePath),
  saveLocalEditedFile: (fileId, content) =>
    ipcRenderer.invoke('drive:saveLocalEditedFile', fileId, content),
  readCachedFile: (fileId) => ipcRenderer.invoke('drive:readCachedFile', fileId),
  getFilePreview: (attachment: Attachment, courseId?: string) =>
    ipcRenderer.invoke('drive:getFilePreview', attachment, courseId),
  saveFileAs: (fileId: string, defaultName?: string) =>
    ipcRenderer.invoke('drive:saveFileAs', fileId, defaultName),
  getDownloadsConfig: () => ipcRenderer.invoke('downloads:getConfig'),
  selectDownloadsFolder: () => ipcRenderer.invoke('downloads:selectFolder'),
  resetDownloadsFolder: () => ipcRenderer.invoke('downloads:resetFolder'),
  openDownloadsFolder: () => ipcRenderer.invoke('downloads:openFolder'),
  openPath: (filePath: string) => ipcRenderer.invoke('downloads:openPath', filePath),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('downloads:showItemInFolder', filePath),

  // Yerel calisma taslagi
  getDraft: (courseId, workId) => ipcRenderer.invoke('draft:get', courseId, workId),
  saveDraft: (courseId, workId, fileName, content) =>
    ipcRenderer.invoke('draft:save', courseId, workId, fileName, content),
  deleteDraft: (courseId, workId) => ipcRenderer.invoke('draft:delete', courseId, workId),

  // Baglam
  updateActiveContext: (context: Partial<ActiveContext>) => ipcRenderer.invoke('context:update', context),
  getActiveContext: () => ipcRenderer.invoke('context:get'),

  // Yapay zeka
  getProviders: () => ipcRenderer.invoke('ai:getProviders'),
  saveProviderKey: (providerId: ProviderId, apiKey: string) =>
    ipcRenderer.invoke('ai:saveProviderKey', providerId, apiKey),
  saveCustomProvider: (config: Partial<AiProviderConfig>) =>
    ipcRenderer.invoke('ai:saveCustomProvider', config),
  removeProvider: (providerId: ProviderId) => ipcRenderer.invoke('ai:removeProvider', providerId),
  setLocalEndpoint: (providerId: ProviderId, baseUrl: string) =>
    ipcRenderer.invoke('ai:setLocalEndpoint', providerId, baseUrl),
  deleteProviderKey: (providerId: ProviderId) => ipcRenderer.invoke('ai:deleteProviderKey', providerId),
  fetchProviderModels: (providerId: ProviderId) => ipcRenderer.invoke('ai:fetchProviderModels', providerId),
  syncAllProviderModels: () => ipcRenderer.invoke('ai:syncAllProviderModels'),
  testProviderConnection: (providerId: ProviderId) =>
    ipcRenderer.invoke('ai:testProviderConnection', providerId),
  onProvidersUpdated: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('ai:providersUpdated', listener)
    return () => {
      ipcRenderer.removeListener('ai:providersUpdated', listener)
    }
  },
  /**
   * Model listesi guncellendiginde cagrilir.
   *
   * Uygulama acilisinda ana surec otomatik senkron yapar ve bu olayi
   * yayinlar. Arayuz dinleyip listeyi yeniden cektigi icin kullanici
   * "Modelleri sorgula" dugmesine basmak ZORUNDA KILMAZ.
   */
  onModelsUpdated: (callback: (results: Array<{ providerId: string; count: number }>) => void) => {
    const listener = (_e: unknown, results: Array<{ providerId: string; count: number }>) =>
      callback(results ?? [])
    ipcRenderer.on('ai:modelsUpdated', listener)
    return () => {
      ipcRenderer.removeListener('ai:modelsUpdated', listener)
    }
  },

  /**
   * Kanal kimligini disariya acar; `cancelChat` ayni akisi iptal edebilsin.
   *
   * Iptal `ai:cancel` ile global bir bayrak uzerinden calisir; kanal
   * kimligine ihtiyac yoktur, ancak akis sayaci icin saklanir.
   */
  sendChatMessage: async (params, onChunk) => {
    const channelId = `ai_stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    activeChannelId = channelId
    const listener = (_: unknown, data: { chunk: string; reasoning?: string }) => {
      onChunk(data.chunk ?? '', data.reasoning)
    }
    ipcRenderer.on(channelId, listener)
    try {
      return await ipcRenderer.invoke('ai:sendChatMessage', { ...params, channelId })
    } finally {
      ipcRenderer.removeListener(channelId, listener)
      if (activeChannelId === channelId) activeChannelId = null
    }
  },

  /**
   * Devam eden yanit uretimini durdurur.
   *
   * Onceki surumde bu yol HIC YOKTU; saglayici takilip kaldiginda
   * kullanicinin tek yapabilecegi uygulamayi kapatip acmakti.
   */
  cancelChat: async () => ipcRenderer.invoke('ai:cancel'),

  // Hafiza (JustMyClassMemory & Taste)
  getMemoryProfile: (sessionId?: string) => ipcRenderer.invoke('ai:getMemoryProfile', sessionId),
  saveMemoryItem: (item, sessionId?: string) => ipcRenderer.invoke('ai:saveMemoryItem', item, sessionId),
  deleteMemoryItem: (id: string, sessionId?: string) => ipcRenderer.invoke('ai:deleteMemoryItem', id, sessionId),
  clearMemory: (scope, sessionId?: string) => ipcRenderer.invoke('ai:clearMemory', scope, sessionId),

  // Sohbet Gecmisi (Chat Sessions)
  getChatSessions: () => ipcRenderer.invoke('ai:getChatSessions'),
  getChatSession: (id: string) => ipcRenderer.invoke('ai:getChatSession', id),
  saveChatSession: (session) => ipcRenderer.invoke('ai:saveChatSession', session),
  deleteChatSession: (id: string) => ipcRenderer.invoke('ai:deleteChatSession', id),
  renameChatSession: (id: string, newTitle: string) => ipcRenderer.invoke('ai:renameChatSession', id, newTitle),

  /*
    Otomatik guncelleme.
    Besleme adresi yalnizca dogrulanmis `update:setFeedUrl` kanalindan
    yazilabilir; genel ayar kanalindan degil.
  */
  getUpdateStatus: () => ipcRenderer.invoke('update:getStatus'),
  setUpdateFeedUrl: (raw: string) => ipcRenderer.invoke('update:setFeedUrl', raw),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const listener = (_: unknown, status: UpdateStatus) => callback(status)
    ipcRenderer.on('update:status', listener)
    return () => {
      ipcRenderer.removeListener('update:status', listener)
    }
  },

  // Arac onaylari
  approveToolCall: (callId) => ipcRenderer.invoke('tool:approve', callId),
  rejectToolCall: (callId) => ipcRenderer.invoke('tool:reject', callId),
  executeTool: (name, args) => ipcRenderer.invoke('tool:execute', name, args),
  getToolPermissions: () => ipcRenderer.invoke('tool:getPermissions'),
  setToolPermissions: (patch) => ipcRenderer.invoke('tool:setPermissions', patch),

  // Ayarlar (beyaz liste disindaki anahtarlar reddedilir)
  getSetting: <T>(key: string, fallback: T) => ipcRenderer.invoke('settings:get', key, fallback) as Promise<T>,
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),

  // Disa aktarma
  exportCourseData: (format, courseId) => ipcRenderer.invoke('export:data', format, courseId),

  // Sistem
  openExternalUrl: (url) => ipcRenderer.invoke('system:openExternalUrl', url),
  getAppVersion: () => ipcRenderer.invoke('system:getAppVersion'),
  getSecurityInfo: () => ipcRenderer.invoke('system:securityInfo'),
  getDataPath: () => ipcRenderer.invoke('system:getDataPath'),
    getStorageDiagnostics: () => ipcRenderer.invoke('system:diagnostics'),
  wipeLocalCache: () => ipcRenderer.invoke('system:wipeLocalCache'),
  wipeEverything: () => ipcRenderer.invoke('system:wipeEverything'),
  copyText: (text) => ipcRenderer.invoke('app:copyText', text),
}

contextBridge.exposeInMainWorld('jmcAPI', api)