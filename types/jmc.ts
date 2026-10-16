export type UserRole = 'STUDENT' | 'TEACHER'

export interface Account {
  id: string
  googleSub: string
  email: string
  displayName: string
  givenName?: string
  familyName?: string
  photoUrl?: string
  hostedDomain?: string
  institution?: string
  role: UserRole
  grantedScopes: string[]
  lastAuthAt: string
}

export interface Course {
  id: string
  name: string
  section?: string
  descriptionHeading?: string
  room?: string
  ownerId: string
  courseState: 'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED'
  alternateLink?: string
  teacherFolderId?: string
  updateTime: string
  lastSyncedAt?: string
  isPinned?: boolean
  customColor?: string
}

export interface CourseParticipant {
  userId: string
  courseId: string
  role: 'TEACHER' | 'STUDENT'
  fullName: string
  email?: string
  photoUrl?: string
}

export interface Topic {
  id: string
  courseId: string
  name: string
  updateTime?: string
}

export interface Attachment {
  id: string
  title: string
  thumbnailUrl?: string
  alternateLink?: string
  mimeType?: string
  sizeBytes?: number
  driveFileId?: string
  youTubeVideoId?: string
  linkUrl?: string
  formUrl?: string
  isLocalAvailable?: boolean
  localPath?: string
  /** İndirilenler klasöründeki kullanıcı tarafından erişilebilir tam dosya yolu. */
  downloadedPath?: string
  /** Duz (sifrelenmemis) icerigin SHA-256 butunluk ozeti. */
  sha256?: string
  syncState?: 'METADATA_ONLY' | 'DOWNLOADED' | 'LOCAL_MODIFIED' | 'ACCESS_DENIED'
}

export interface RubricLevel {
  levelId: string
  title: string
  description?: string
  points?: number
}

export interface RubricCriterion {
  id: string
  title: string
  description?: string
  weight?: number
  levels: RubricLevel[]
}

export interface Rubric {
  id: string
  courseId: string
  courseWorkId: string
  criteria: RubricCriterion[]
  updateTime?: string
}

export interface CourseWork {
  id: string
  courseId: string
  topicId?: string
  title: string
  description?: string
  materials: Attachment[]
  state: 'PUBLISHED' | 'DRAFT' | 'DELETED'
  alternateLink?: string
  creationTime: string
  updateTime: string
  dueDate?: { year: number; month: number; day: number }
  dueTime?: { hours: number; minutes: number }
  maxPoints?: number
  workType: 'ASSIGNMENT' | 'SHORT_ANSWER_QUESTION' | 'MULTIPLE_CHOICE_QUESTION'
  submissionModificationMode?: string
  creatorUserId?: string
  rubricId?: string
  hasRubric?: boolean
  submission?: StudentSubmission
}

/** Ogrencinin yerel calisma taslagi. Classroom'a gonderilmeden once cihazda kalir. */
export interface DraftEntry {
  courseId: string
  courseWorkId: string
  fileName: string
  content: string
  updatedAt: string
}

export interface StudentSubmission {
  id: string
  courseId: string
  courseWorkId: string
  userId: string
  state: 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT'
  assignedGrade?: number
  draftGrade?: number
  late?: boolean
  alternateLink?: string
  assignmentSubmission?: {
    attachments?: Attachment[]
  }
  shortAnswerSubmission?: {
    answer?: string
  }
  multipleChoiceSubmission?: {
    answer?: string
  }
  submissionHistory?: Array<{
    stateHistory?: {
      state: string
      stateTimestamp: string
      actorUserId?: string
    }
    gradeHistory?: {
      pointsEarned?: number
      maxPoints?: number
      gradeTimestamp: string
      gradeChangeType?: string
      actorUserId?: string
    }
  }>
  updateTime?: string
}

export interface Announcement {
  id: string
  courseId: string
  text: string
  materials: Attachment[]
  state: 'PUBLISHED' | 'DRAFT' | 'DELETED'
  alternateLink?: string
  creationTime: string
  updateTime: string
  creatorUserId?: string
}

export interface CourseMaterial {
  id: string
  courseId: string
  topicId?: string
  title: string
  description?: string
  materials: Attachment[]
  state: 'PUBLISHED' | 'DRAFT'
  alternateLink?: string
  creationTime: string
  updateTime: string
}

export interface AiModel {
  id: string
  name: string
  contextWindow: number
  maxOutputTokens: number
  supportsVision: boolean
  supportsTools: boolean
  supportsReasoning: boolean
  isDefault?: boolean
}

export type ProviderId = 
  | 'anthropic' 
  | 'openai' 
  | 'gemini' 
  | 'deepseek' 
  | 'xai' 
  | 'groq' 
  | 'deepinfra' 
  | 'ollama' 
  | 'lmstudio' 
  | 'llamacpp' 
  | string

/**
 * Saglayici marka anahtarlari.
 *
 * Her deger icin arayuzde AYRI bir premium SVG ikon vardir
 * (`src/components/icons/ProviderIcon.tsx`). Marka, modelden bagimsiz
 * oldugu icin bir saglayicinin 40 modeli olsa bile ikon sabit kalir.
 */
export type ProviderBrand =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'groq'
  | 'deepinfra'
  | 'openrouter'
  | 'mistral'
  | 'cerebras'
  | 'together'
  | 'siliconflow'
  | 'novita'
  | 'fireworks'
  | 'nvidia'
  | 'alibaba'
  | 'moonshot'
  | 'zhipu'
  | 'venice'
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp'
  | 'custom'

/**
 * Otomatik guncelleme durumu.
 *
 * `stage` degerleri:
 *   disabled  - yayin adresi tanimli degil (ozellik kapali)
 *   idle      - adres var, henuz kontrol edilmedi
 *   checking  - kontrol ediliyor
 *   available - yeni surum bulundu, kullanici onayi bekliyor
 *   not-available - uygulama guncel
 *   downloading / downloaded / error
 */
export interface UpdateStatus {
  stage:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'disabled'
  currentVersion: string
  availableVersion?: string
  releaseDate?: string
  releaseNotes?: string
  progress?: number
  transferredMb?: number
  totalMb?: number
  error?: string
  configured: boolean
  feedUrl?: string
}

export interface AiProviderConfig {
  id: ProviderId
  displayName: string
  /**
   * Ikon secimi icin sabit anahtar.
   *
   * NEDEN AYRI ALAN
   * ---------------
   * Onceki surumde her saglayici icin ayri bir ikon getProviderIcon
   * fonksiyonunda displayName uzerinden seciliyordu. Ekran
   * goruntusundeki sonuc: "Google Gemini" ve "gemini-3-pro" gibi iki
   * farkli sey ayni ikona dustugu icin kullanici HER modelde ayni iki
   * rozeti goruyordu.
   *
   * Simdi ikon, modelden degil SAGLAYICIDAN gelir; model listesinde
   * ne kadar cok model olursa olsun ikon degismez.
   */
  brand?: ProviderBrand
  /** Anahtarin alindigi resmi adres. Kullaniciya "anahtar nereden" sorusunu tek adimda cevaplar. */
  keyUrl?: string
  protocolType: 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'llamacpp'
  baseUrl: string
  customHeaders?: Record<string, string>
  isLocal: boolean
  isEnabled: boolean
  /**
   * Uygulamanin gomulu saglayicisi mi, kullanici tarafindan eklendi mi?
   *
   * Arayuzde "sil" dugmesinin gorunup gorunmemesi bununla belirlenir.
   * Onceki surumde arayuz saglayici kimliklerinin KENDI listesini
   * tutuyordu; iki liste ayrilinca yeni gomulu saglayicilar "ozel"
   * sanilip silinebilir hale geliyordu.
   */
  builtin?: boolean
  hasKey: boolean
  maskedKey?: string
  models: AiModel[]
  selectedModel: string
  healthStatus: 'healthy' | 'unreachable' | 'unconfigured' | 'checking'
  latencyMs?: number
  privacyNotice: string
}

export interface ActiveContext {
  activeCourseId?: string
  activeCourseName?: string
  activeCourseWorkId?: string
  activeCourseWorkTitle?: string
  activeFileId?: string
  activeFileName?: string
  activeFileMimeType?: string
  activeFileContent?: string
  activePage?: number
  visibleTextSnippet?: string
  selectedText?: string
  hasRubric?: boolean
  rubricCriteriaCount?: number
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoningContent?: string
  timestamp: string
  /** true ise `content` bir hata metnidir; baloncuk hata olarak bicimlendirilir. */
  isError?: boolean
  citations?: Array<{
    title: string
    sourceType: 'classroom_coursework' | 'drive_file' | 'rubric' | 'web_search'
    pageNumber?: number
    fileId?: string
    snippet?: string
    url?: string
  }>
  toolCalls?: ToolCallRecord[]
  diffProposal?: {
    targetFile: string
    oldContent: string
    newContent: string
    diffSummary: string
  }
}

/**
 * Bir arac çağrısının yaşam döngüsü kaydı.
 *
 * `pending`   → kullanıcı onayı bekliyor (yazma/teslim gibi işlemler)
 * `approved`  → kullanıcı onayladı, çalıştırılmayı bekliyor
 * `completed` → çalıştı ve `result` dolu
 * `rejected`  → kullanıcı reddetti
 * `error`     → çalışırken hata oluştu, `error` dolu
 */
export interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, any>
  result?: string
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'error'
  /** `status === 'error'` iken hata metni. */
  error?: string
  /** Bu çağrı geri alınamaz bir işlem yapıyor ve kullanıcı onayı istiyor. */
  requiresApproval?: boolean
}

export interface ChatAttachment {
  name: string
  mimeType: string
  size?: number
  base64Data?: string
  dataUrl?: string
  textContent?: string
  canceled?: boolean
  isImage?: boolean
  isPdf?: boolean
  error?: string
}

export type ThemeName =
  | 'Dark'
  | 'Light'
  | 'Matrix'
  | 'Amber CRT'
  | 'Cyberpunk'
  | 'Red Team'
  | 'Ocean'
  | 'Forest'
  | 'Sand'
  | 'Graphite'
  | 'Neon Dreams'
  | 'Hacker Green'
  | 'Sunset Vibes'
  | 'Abyss'
  | 'Synthwave'
  | 'Custom'

export interface ThemeColors {
  bg: string
  bgElevated: string
  bgSurface: string
  border: string
  borderSubtle: string
  text: string
  textMuted: string
  textDim: string
  primary: string
  primaryHover: string
  accent: string
  accentHover: string
  warning: string
  danger: string
  success: string
  codeBg: string
  badgeBg: string
  /** Yükseltilmiş yüzeylerin düşüş gölgesi. Çizgi yerine derinlik için kullanılır. */
  elevation: string
}

export interface SyncStatus {
  isSyncing: boolean
  progress?: { label: string; done: number; total: number }
  lastSyncedAt?: string
  coursesCount: number
  courseWorkCount: number
  cachedFilesCount: number
  totalBytesCached: number
  activeErrors: string[]
}

export interface EncryptionStatus {
  isEncrypted: boolean
  algorithm: string
  hardwareProtected: boolean
  backend: string
  description: string
  degraded: boolean
}

export interface StorageSecurityInfo extends EncryptionStatus {
  storePath: string
}

/**
 * Anahtar kasasinin durumu.
 *
 * `EncryptionStatus` DEGIL: kasada bir anahtarin "sifreli olup
 * olmadigi" anlamli degildir — anahtarlar OS tarafindan sarmalanir.
 * Bu yuzden `isEncrypted`/`algorithm` alanlari burada bilinçli olarak
 * YOKTUR; `VaultService.describe()` ne dönerse o ve sadece o.
 */
export interface VaultSecurityInfo {
  format: string
  hardwareProtected: boolean
  backend: string
  description: string
  degraded: boolean
  storedKeyCount: number
}

export interface SecurityInfo {
  store: StorageSecurityInfo
  vault: VaultSecurityInfo
}

export interface AppVersionInfo {
  version: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  buildDate: string
  gitHash: string
  platform: string
  arch: string
  locale: string
  encryption: EncryptionStatus
  vault: StorageSecurityInfo & { storedKeyCount: number }
  /** Kasa arka ucunun adi; tanilama metninde kullanilir. */
  vaultBackend: string
}

/** Ayarlar > Araçlar bölümünde kapatılabilen yetenekler. */
export interface ToolPermissions {
  webSearch: boolean
  workspaceRead: boolean
  fileWrite: boolean
  classroomDraft: boolean
  tavilyKeySet?: boolean
  tavilyKeyMasked?: string
  braveKeySet?: boolean
  braveKeyMasked?: string
}

/**
 * Giris tanilama bilgisi. Gizli deger ICERMEZ: istemci kimligi
 * kisaltilmis, token'lar yalnizca varlik bilgisi olarak doner.
 */
export interface AuthDiagnostics {
  clientIdValid: boolean
  clientIdOrigin: 'custom' | 'build' | 'none'
  clientIdPreview: string
  usingCustomClientId: boolean
  hasClientSecret?: boolean
  signedIn: boolean
  accountEmail: string
  institution: string
  hasAccessToken: boolean
  hasRefreshToken: boolean
  grantedScopes: string[]
  missingScopes: string[]
}

/**
 * Hesabin Classroom'a erisip erisemedigi.
 *
 * Google Classroom yalnizca Workspace for Education kurumsal
 * hesaplarinda vardir; bireysel @gmail.com hesabinda API her zaman
 * yetkisiz doner. Bu bir uygulama hatasi DEGILDIR ve arayuzde
 * ayrica bir bos durum olarak gosterilmelidir.
 */
export interface AccountCapability {
  canUseClassroom: boolean
  reason: 'workspace' | 'personal-gmail' | 'unknown' | 'signed-out'
  detail: string
}

export interface FilePreviewResult {
  fileId: string
  title: string
  mimeType: string
  sizeBytes: number
  kind: 'code' | 'markdown' | 'text' | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'csv' | 'image' | 'media' | 'link' | 'binary'
  text?: string
  dataUrl?: string
  localPath?: string
  language?: string
  lineCount?: number
  paragraphs?: string[]
  slides?: Array<{ slideNumber: number; title?: string; bullets: string[] }>
  tableData?: Array<string[]>
  isTruncated?: boolean
}

export interface DownloadFileStatus {
  exists: boolean
  filePath?: string
  fileName?: string
}

export interface MemoryItem {
  id: string
  category: 'preference' | 'academic' | 'style' | 'rule' | 'context'
  key: string
  value: string
  scope?: 'global' | 'session'
  createdAt: string
  updatedAt: string
  source?: 'user' | 'assistant_extracted'
}

export interface MemoryProfile {
  globalItems: MemoryItem[]
  sessionItems: Record<string, MemoryItem[]>
  lastConsolidatedAt?: string
}

export interface ChatSession {
  id: string
  title: string
  courseId?: string
  courseName?: string
  createdAt: string
  updatedAt: string
  messageCount: number
  messages: AiMessage[]
  lastSummary?: string
}

export interface JmcApi {
  // Auth & Account
  loginWithGoogle: (extraScopes?: string[]) => Promise<Account>
  cancelLogin: () => Promise<boolean>
  logout: (wipeLocalCache?: boolean) => Promise<boolean>
  getAccount: () => Promise<Account | null>
  getDiagnostics: () => Promise<AuthDiagnostics>
  getAccountCapability: () => Promise<AccountCapability>
  setClientId: (clientId: string) => Promise<void>
  getClientId: () => Promise<string | null>
  setClientSecret: (clientSecret: string) => Promise<{ success: boolean; hasClientSecret: boolean }>
  resetCustomClient: () => Promise<{
    valid: boolean
    activeClientId: string
    isCustom: boolean
    isPlaceholder: boolean
    origin: 'custom' | 'build' | 'none'
    hasClientSecret?: boolean
    error?: string
  }>
  validateClientId: (clientId?: string) => Promise<{
    valid: boolean
    activeClientId: string
    isCustom: boolean
    isPlaceholder: boolean
    origin: 'custom' | 'build' | 'none'
    hasClientSecret?: boolean
    error?: string
  }>
  importGoogleCredentialsJson: (jsonContent: string) => Promise<{
    success: boolean
    clientId?: string
    hasClientSecret?: boolean
    error?: string
  }>
  completeAuthWithCode: (rawCodeOrUrl: string, redirectUri?: string, codeVerifier?: string) => Promise<Account>

  pickAndImportCredentialsFile: () => Promise<{
    success: boolean
    clientId?: string
    hasClientSecret?: boolean
    error?: string
    canceled?: boolean
  }>
  pickAttachmentFile: () => Promise<ChatAttachment | null>

  // Sync & Classroom data
  syncAll: () => Promise<SyncStatus>
  getSyncStatus: () => Promise<SyncStatus>
  getCourses: () => Promise<Course[]>
  search: (
    query: string,
  ) => Promise<Array<{ type: string; id: string; title: string; snippet: string; courseId?: string }>>
  turnIn: (courseId: string, workId: string, submissionId: string) => Promise<boolean>
  reclaim: (courseId: string, workId: string, submissionId: string) => Promise<boolean>
  /** Taslagi Drive'a yukler, teslime ekler ve ardindan teslim eder. */
  /**
   * Taslagi sifreli depoya yazar, Google Drive'a yukler, odevin eklerine
   * ekler ve teslim eder.
   *
   * Basarisiz olursa HATA FIRLATIR (donus degeri yoktur). Onceki imza
   * `Promise<boolean>` idi ama UI cagrisini yok sayiyordu; `false`
   * donen bir yolda kullaniciya "Teslim edildi" yazisi gosterilirdi.
   */
  attachAndTurnIn: (
    courseId: string,
    workId: string,
    submissionId: string,
    fileName: string,
    content: string,
  ) => Promise<void>

  // Local working draft (encrypted, device-only)
  getDraft: (courseId: string, workId: string) => Promise<DraftEntry | null>
  saveDraft: (
    courseId: string,
    workId: string,
    fileName: string,
    content: string,
  ) => Promise<DraftEntry>
  deleteDraft: (courseId: string, workId: string) => Promise<boolean>
  getCourseDetails: (courseId: string) => Promise<{
    course: Course
    topics: Topic[]
    courseWork: CourseWork[]
    announcements: Announcement[]
    materials: CourseMaterial[]
    participants: CourseParticipant[]
  }>
  getCourseWork: (courseId: string, workId: string) => Promise<{
    work: CourseWork
    rubric?: Rubric
    submission?: StudentSubmission
  }>

  // Drive & Files & Downloads
  downloadAttachment: (attachment: Attachment, courseId: string) => Promise<Attachment>
  checkDownloadedFile: (attachment: Partial<Attachment>) => Promise<DownloadFileStatus>
  openLocalFile: (filePath: string) => Promise<boolean>
  saveLocalEditedFile: (fileId: string, content: string | Uint8Array) => Promise<{ newHash: string }>
  readCachedFile: (fileId: string) => Promise<Uint8Array>
  getFilePreview: (attachment: Attachment, courseId?: string) => Promise<FilePreviewResult>
  saveFileAs: (fileId: string, defaultName?: string) => Promise<{ success: boolean; filePath?: string; canceled?: boolean }>
  getDownloadsConfig: () => Promise<{ currentPath: string; defaultPath: string; isDefault: boolean }>
  selectDownloadsFolder: () => Promise<{ currentPath: string; defaultPath: string; isDefault: boolean } | null>
  resetDownloadsFolder: () => Promise<{ currentPath: string; defaultPath: string; isDefault: boolean }>
  openDownloadsFolder: () => Promise<boolean>
  openPath: (filePath: string) => Promise<boolean>
  showItemInFolder: (filePath: string) => Promise<boolean>

  // Active Context
  updateActiveContext: (context: Partial<ActiveContext>) => Promise<ActiveContext>
  getActiveContext: () => Promise<ActiveContext>

  // AI & Providers
  getProviders: () => Promise<AiProviderConfig[]>
  saveProviderKey: (providerId: ProviderId, apiKey: string) => Promise<boolean>
  saveCustomProvider: (config: Partial<AiProviderConfig>) => Promise<AiProviderConfig>
  removeProvider: (providerId: ProviderId) => Promise<boolean>
  setLocalEndpoint: (providerId: ProviderId, baseUrl: string) => Promise<AiProviderConfig>
  deleteProviderKey: (providerId: ProviderId) => Promise<boolean>
  fetchProviderModels: (providerId: ProviderId) => Promise<AiModel[]>
  /** Tum saglayicilarin model listesini tek seferde tazeler. Uygulama acilisinda otomatik cagrilir. */
  syncAllProviderModels: () => Promise<Array<{ providerId: string; count: number }>>
  testProviderConnection: (providerId: ProviderId) => Promise<{ healthy: boolean; latencyMs: number; error?: string }>
  onProvidersUpdated?: (callback: () => void) => () => void
  /** Otomatik model senkronu bittiginde yayinlanir. */
  onModelsUpdated?: (
    callback: (results: Array<{ providerId: string; count: number }>) => void,
  ) => () => void
  /** Otomatik guncelleme. */
  getUpdateStatus: () => Promise<UpdateStatus>
  setUpdateFeedUrl: (raw: string) => Promise<{ ok: boolean; error?: string; status: UpdateStatus }>
  checkForUpdates: () => Promise<UpdateStatus>
  downloadUpdate: () => Promise<UpdateStatus>
  installUpdate: () => Promise<boolean>
  onUpdateStatus?: (callback: (status: UpdateStatus) => void) => () => void
  sendChatMessage: (params: {
    providerId: ProviderId
    modelId: string
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    context: ActiveContext
    mode: 'socratic' | 'draft' | 'rubric' | 'quiz' | 'general'
    attachments?: ChatAttachment[]
    /** Araclari (web arama, dosya okuma, taslak) modele sun. Varsayilan `true`. */
    toolsEnabled?: boolean
    sessionId?: string
  }, onChunk: (chunk: string, reasoning?: string) => void) => Promise<AiMessage>

  // Tools & Actions
  approveToolCall: (callId: string) => Promise<boolean>
  rejectToolCall: (callId: string) => Promise<boolean>
  executeTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ requiresApproval: boolean; callId?: string; result?: string; error?: string }>
  getToolPermissions: () => Promise<ToolPermissions>
  setToolPermissions: (patch: Partial<ToolPermissions>) => Promise<ToolPermissions>

  // Settings (only allow-listed keys are writable)
  getSetting: <T>(key: string, fallback: T) => Promise<T>
  setSetting: (key: string, value: unknown) => Promise<boolean>

  // Export
  exportCourseData: (format: 'csv' | 'json' | 'markdown' | 'anki', courseId?: string) => Promise<{ filePath: string }>

  // System & External links
  openExternalUrl: (url: string) => Promise<void>
  getAppVersion: () => Promise<AppVersionInfo>
  getSecurityInfo: () => Promise<SecurityInfo>
  /** Verinin som olarak nerede durdugu (kurulum sihirbazinda gosterilir). */
  getDataPath: () => Promise<{ userData: string; temp: string }>
  wipeLocalCache: () => Promise<boolean>
  /**
   * Her seyi sil: oturum, yerel veriler, indirilen dosyalar ve kasadaki
   * TUM anahtarlar. Onceki surumde bu is yalnizca arayuzde vaat ediliyor,
   * `wipeAllKeys()` hicbir yerden cagrilmadigi icin anahtarlar diskte kaliyordu.
   */
  wipeEverything: () => Promise<boolean>

  /**
   * Panoya yaz. `navigator.clipboard` bir promise dondurdugu icin hata
   * yakalanamaz ve kullaniciya "Kopyalandi" denirken hicbir sey kopyalanmayabiliyordu.
   */
  copyText: (text: string) => Promise<void>

  /**
   * Devam eden yanit uretimini durdurur.
   *
   * Onceki surumde bu yol HIC YOKTU. Saglayici takildiginda ya da
   * dondugunde kullanicinin tek yapabilecegi uygulamayi kapatip acmakti;
   * arayuz surekli "Yanit bekleniyor..." ekraninda kaliyordu.
   *
   * @returns devam eden bir akis varsa `true`, yoksa `false`.
   */
  cancelChat: () => Promise<boolean>

  // Memory (JustMyClassMemory & Taste)
  getMemoryProfile: (sessionId?: string) => Promise<MemoryProfile>
  saveMemoryItem: (item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }, sessionId?: string) => Promise<MemoryItem>
  deleteMemoryItem: (id: string, sessionId?: string) => Promise<boolean>
  clearMemory: (scope: 'global' | 'session' | 'all', sessionId?: string) => Promise<boolean>

  // Chat Sessions (Sohbet Geçmişi)
  getChatSessions: () => Promise<ChatSession[]>
  getChatSession: (id: string) => Promise<ChatSession | null>
  saveChatSession: (session: ChatSession) => Promise<boolean>
  deleteChatSession: (id: string) => Promise<boolean>
  renameChatSession: (id: string, newTitle: string) => Promise<boolean>
}

declare global {
  interface Window {
    jmcAPI: JmcApi
  }
}
