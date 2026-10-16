import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowDown,
  BookOpen,
  Bookmark,
  Brain,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Command,
  Copy,
  Download,
  Edit2,
  FileText,
  GraduationCap,
  History,
  Info,
  KeyRound,
  Library,
  LogIn,
  PanelRightClose,
  Paperclip,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Send,
  ShieldAlert,
  Square,
  Star,
  Settings,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import {
  Account,
  AccountCapability,
  ActiveContext,
  AiMessage,
  AiProviderConfig,
  Announcement,
  Attachment,
  ChatAttachment,
  ChatSession,
  Course,
  CourseMaterial,
  CourseParticipant,
  CourseWork,
  MemoryItem,
  MemoryProfile,
  ProviderId,
  Rubric,
  StudentSubmission,
  SyncStatus,
  Topic,
  FilePreviewResult,
} from '../types/jmc'
import { useI18n } from '../i18n/i18nContext'
import { DocumentStudio } from '../features/studio/DocumentStudio'
import { CourseOverview } from '../components/CourseOverview'
import { CommandPalette } from '../features/command-palette/CommandPalette'
import { MarkdownView } from '../components/MarkdownView'
import { ModelPicker } from '../components/ModelPicker'
import { DocumentViewerModal } from '../components/DocumentViewerModal'
import {
  ACCOUNT_CHANGED_EVENT,
  AI_MODE_CHANGED_EVENT,
  AUTOSYNC_CHANGED_EVENT,
  PROVIDERS_CHANGED_EVENT,
} from '../lib/events'

interface AppLayoutProps {
  onOpenSettings: (tab?: string) => void
  onOpenAbout: () => void
  onOpenAuth: () => void
  onExport: (format: 'csv' | 'json' | 'markdown' | 'anki') => void
  /** Uygulama genelinde kullanilan bildirim kanalini iletir. */
  onNotify: (kind: 'success' | 'error', text: string) => void
}

const AI_MODES = [
  { id: 'socratic', label: 'Sokratik', hint: 'Adım adım düşündürür' },
  { id: 'draft', label: 'Taslak', hint: 'Çözüm ve rapor iskeleti' },
  { id: 'rubric', label: 'Rubrik', hint: 'Kriterlere göre ön denetim' },
  { id: 'quiz', label: 'Çalışma', hint: 'Soru ve tekrar kartı' },
] as const

const SOURCE_LABEL: Record<string, string> = {
  classroom_coursework: 'Ödev',
  drive_file: 'Dosya',
  rubric: 'Rubrik',
  web_search: 'Web',
}

/** Panel genisligi anahtarlari (yalnizca gorunum tercihi, gizli veri YOK). */
const PANE_WIDTH_STORAGE_KEY = 'jmc.paneWidths'

interface PaneWidths {
  left: number
  right: number
}

/** Kaydedilmis panel genisliklerini okur; gecersizse varsayilani doner. */
function readStoredPaneWidth(side: 'left' | 'right', fallback: number): number {
  try {
    const raw = window.localStorage.getItem(PANE_WIDTH_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PaneWidths>
    const value = side === 'left' ? parsed.left : parsed.right
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    // Bozuk bir kayit (orn. elle yazilmis 99999) uygulamayi bozmasin.
    return Math.max(160, Math.min(900, Math.round(value)))
  } catch {
    return fallback
  }
}

/** Panel genisliklerini kalici olarak saklar. */
function persistPaneWidth(side: 'left' | 'right', value: number): void {
  try {
    const raw = window.localStorage.getItem(PANE_WIDTH_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<PaneWidths>) : {}
    const next: PaneWidths = {
      left: side === 'left' ? value : (parsed.left ?? 280),
      right: side === 'right' ? value : (parsed.right ?? 370),
    }
    window.localStorage.setItem(PANE_WIDTH_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* Depolama kotası dolu olabilir; sessizce gec. */
  }
}

/**
 * Bir liste icindeki secili ogeyi gorunur alana getirir.
 *
 * Kullanicinin bildirdigi "soldan secettigim oge orta ekrana gelmiyor"
 * sorununun karsiligi: kod tabaninda `scrollIntoView` YALNIZCA sohbet
 * kaydirmasi icin vardi; ders ve odev listelerinde secili oge ekran
 * disinda kaldiginda hicbir sey onu geri getirmiyordu.
 */
function scrollIntoViewIfNeeded(element: HTMLElement | null, container: HTMLElement | null): void {
  if (!element || !container) return
  const itemTop = element.offsetTop
  const itemBottom = itemTop + element.offsetHeight
  const viewTop = container.scrollTop
  const viewBottom = viewTop + container.clientHeight
  // Tamamen gorunurdegilse hicbir sey yapma; mevcut kayma konumu korunur.
  if (itemTop >= viewTop && itemBottom <= viewBottom) return
  // Ortala: hedef, konteyner icinde ortaya yakin konumlanir.
  const target = itemTop - container.clientHeight / 2 + element.offsetHeight / 2
  container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  onOpenSettings,
  onOpenAbout,
  onOpenAuth,
  onExport,
  onNotify,
}) => {
  const { t, lang } = useI18n()

  const [account, setAccount] = useState<Account | null>(null)
  const accountRef = useRef<Account | null>(null)
  accountRef.current = account
  /**
   * Hesabin Classroom'a erisip erisedigi.
   *
   * `null` => henuz sorgulanmadi. `personal-gmail` => bireysel hesap;
   * bu durumda ders listesi BOGOLMAMALIDIR, kullaniciya gercek neden
   * yazilmalidir.
   */
  const [accountCapability, setAccountCapability] = useState<AccountCapability | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null)
  const [courseWorks, setCourseWorks] = useState<CourseWork[]>([])
  const [courseAnnouncements, setCourseAnnouncements] = useState<Announcement[]>([])
  const [courseMaterials, setCourseMaterials] = useState<CourseMaterial[]>([])
  const [courseParticipants, setCourseParticipants] = useState<CourseParticipant[]>([])
  const [courseTopics, setCourseTopics] = useState<Topic[]>([])
  const [selectedWork, setSelectedWork] = useState<CourseWork | null>(null)
  const [currentRubric, setCurrentRubric] = useState<Rubric | undefined>()
  const [currentSubmission, setCurrentSubmission] = useState<StudentSubmission | undefined>()
  const [activeContext, setActiveContext] = useState<ActiveContext>({})
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)
  const [sessionSearchQuery, setSessionSearchQuery] = useState('')
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const handleSyncAllRef = useRef<(() => Promise<void>) | undefined>(undefined)
  const selectCourseRefFn = useRef<((course: Course) => Promise<void>) | undefined>(undefined)

  const [providers, setProviders] = useState<AiProviderConfig[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | ''>('')
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  /** `loadProviders` kendi dongusu icinde mevcut secimi okuyabilsin. */
  const selectedProviderIdRef = useRef<ProviderId | ''>('')
  selectedProviderIdRef.current = selectedProviderId

  /**
   * Kullanicinin favorilere ekledigi modeller.
   *
   * Anahtar `saglayiciKimligi::modelKimligi` bicimindedir; boylece ayni
   * model adi iki farkli saglayicida ayri tutulur.
   */
  const [favoriteModels, setFavoriteModels] = useState<string[]>([])

  useEffect(() => {
    void window.jmcAPI
      .getSetting<string[]>('ai.favoriteModels', [])
      .then(list => {
        if (Array.isArray(list)) setFavoriteModels(list)
      })
      .catch(() => setFavoriteModels([]))
  }, [])

  const isFavoriteModel = useCallback(
    (providerId: string, modelId: string) =>
      favoriteModels.includes(`${providerId}::${modelId}`),
    [favoriteModels],
  )

  /**
   * Secili saglayicinin modelleri; favoriler en basta siralanir.
   *
   * Model katalogu her yenilemede yeniden cekildigi icin `isDefault`
   * rozeti kayboluyordu. Favori isareti kalici oldugu icin model
   * kullanicinin kisisel listesinde nereye ait oldugunu gosterir.
   */
  const orderedModelList = useMemo(() => {
    const providerKey = String(selectedProviderId)
    const models = providers.find(p => p.id === selectedProviderId)?.models ?? []
    if (models.length <= 1) return models
    const favorites = models.filter(m => favoriteModels.includes(`${providerKey}::${m.id}`))
    const rest = models.filter(m => !favoriteModels.includes(`${providerKey}::${m.id}`))
    return [...favorites, ...rest]
  }, [favoriteModels, providers, selectedProviderId])

  const toggleFavoriteModel = useCallback(
    async (providerId: string, modelId: string) => {
      const key = `${providerId}::${modelId}`
      const next = favoriteModels.includes(key)
        ? favoriteModels.filter(item => item !== key)
        : [...favoriteModels, key]
      // onceki durum: hata olursa kullanici yanlislikla kaybolmus yildizla kalmaz
      setFavoriteModels(next)
      try {
        await window.jmcAPI.setSetting('ai.favoriteModels', next)
      } catch {
        setFavoriteModels(favoriteModels)
      }
    },
    [favoriteModels],
  )

  /**
   * Manuel model yenileme.
   *
   * Kullanici istemisti: "durmadan manuel basmak zorunda kalmayalim".
   * Ana surec ZATEN otomatik senkron yapar; bu yalnizca:
   *   - yeni bir API anahtari girdikten hemen sonra,
   *   - saglayicinin model listesini degistirdiginde,
   *   - kullanici paneldeki yenile dugmesine bastiginda
   * calisir.
   */
  const [refreshingModels, setRefreshingModels] = useState(false)

  const handleRefreshAllModels = useCallback(async () => {
    if (refreshingModels) return
    setRefreshingModels(true)
    try {
      await window.jmcAPI.syncAllProviderModels()
      // Liste senkronu bitince saglayici listesini de tazele.
      const list = await window.jmcAPI.getProviders()
      setProviders(list)
    } finally {
      setRefreshingModels(false)
    }
  }, [refreshingModels])

  /**
   * Secili saglayici/modeli kalici olarak saklar.
   *
   * Bu sayede uygulama her yeniden acildiginda kullanici ayni modelle
   * devam eder; "hangi modeli kullaniyordum" aramasina gerek kalmaz.
   */
  useEffect(() => {
    if (!selectedProviderId) return
    void window.jmcAPI.setSetting('ai.lastProviderId', selectedProviderId).catch(() => undefined)
  }, [selectedProviderId])

  useEffect(() => {
    if (!selectedProviderId || !selectedModelId) return
    void window.jmcAPI.setSetting('ai.lastModelId', selectedModelId).catch(() => undefined)
  }, [selectedProviderId, selectedModelId])
  const [aiMode, setAiMode] = useState<'socratic' | 'draft' | 'rubric' | 'quiz' | 'general'>('socratic')
  const [autoSyncMinutes, setAutoSyncMinutes] = useState<number>(5)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [inputPrompt, setInputPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [chatAttachment, setChatAttachment] = useState<ChatAttachment | null>(null)
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const [copyErrorMsgId, setCopyErrorMsgId] = useState<string | null>(null)
  const copyResetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void window.jmcAPI
      ?.getSetting<number>('autoSyncMinutes', 5)
      .then(val => {
        if (typeof val === 'number' && Number.isFinite(val)) setAutoSyncMinutes(val)
      })
      .catch(() => setAutoSyncMinutes(5))

    void window.jmcAPI
      ?.getSetting<string>('ai.defaultMode', 'socratic')
      .then(mode => {
        if (mode === 'socratic' || mode === 'draft' || mode === 'rubric' || mode === 'quiz' || mode === 'general') {
          setAiMode(mode)
        }
      })
      .catch(() => undefined)

    const onAutoSyncChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<number>).detail
      if (typeof detail === 'number' && Number.isFinite(detail)) {
        setAutoSyncMinutes(detail)
      } else {
        void window.jmcAPI?.getSetting<number>('autoSyncMinutes', 5).then(val => {
          if (typeof val === 'number' && Number.isFinite(val)) setAutoSyncMinutes(val)
        })
      }
    }
    const onAiModeChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail
      if (detail === 'socratic' || detail === 'draft' || detail === 'rubric' || detail === 'quiz' || detail === 'general') {
        setAiMode(detail)
      }
    }
    window.addEventListener(AUTOSYNC_CHANGED_EVENT, onAutoSyncChanged)
    window.addEventListener(AI_MODE_CHANGED_EVENT, onAiModeChanged)
    return () => {
      window.removeEventListener(AUTOSYNC_CHANGED_EVENT, onAutoSyncChanged)
      window.removeEventListener(AI_MODE_CHANGED_EVENT, onAiModeChanged)
    }
  }, [])

  /**
   * Panoya kopyalar.
   *
   * `navigator.clipboard.writeText` bir promise dondurdugu icin `void`
   * ile cagrilinca hatasi YUTULURDU; "Kopyalandi" rozeti her zaman
   * gosteriliyordu. Ustelik ana surecteki izin handler'i tum pano
   * isteklerini reddettiigi icin islem cogu durumda hicbir sey
   * kopyalamadan basarili gorunuyordu.
   *
   * Artik Electron'un kendi pano modulu ana surecten cagrilir; hata
   * senkron olarak firlatilir ve kullaniciya GERCEK durum gosterilir.
   */
  const handleCopyMessage = useCallback(async (id: string, text: string) => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
    try {
      await window.jmcAPI.copyText(text)
      setCopyErrorMsgId(null)
      setCopiedMsgId(id)
    } catch {
      setCopiedMsgId(null)
      setCopyErrorMsgId(id)
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedMsgId(null)
      setCopyErrorMsgId(null)
    }, 2000)
  }, [])

  useEffect(
    () => () => {
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
    },
    [],
  )

  // Yeniden boyutlandırılabilir kenar panelleri
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => readStoredPaneWidth('left', 280))
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => readStoredPaneWidth('right', 370))
  const leftSidebarWidthRef = useRef(leftSidebarWidth)
  const rightSidebarWidthRef = useRef(rightSidebarWidth)
  const isDraggingLeftRef = useRef(false)
  const isDraggingRightRef = useRef(false)

  useEffect(() => {
    leftSidebarWidthRef.current = leftSidebarWidth
  }, [leftSidebarWidth])

  useEffect(() => {
    rightSidebarWidthRef.current = rightSidebarWidth
  }, [rightSidebarWidth])

  /**
   * Sol/sag panel genislikleri BIRLIKTE sinirlanir.
   *
   * Onceki surum her paneli bagimsizca 200–500 ve 280–650 araligina
   * kisiyordu. Toplam istek edilebilecek en genis deger 56 + 500 + 4 + 4 + 650
   * = 1214 piksel; `main` ise `min-w-0 flex-1` oldugu icin tasma fazlasini
   * soğurup SIFIRA kadar daraliyordu. Pencere minimumu 1080 olduğundan
   * orta panel tamamen kaybolabiliyor ve kullanici uygulamayi kullanamiyordu.
   *
   * Artik orta panel icin ayrilan bir minimum genislik rezerve edilir ve
   * iki panel bu bütceye gore sinirlanir.
   */
  const RAIL_WIDTH = 56
  const SPLITTER_WIDTH = 4
  const MIN_MAIN_WIDTH = 420
  const MIN_LEFT = 200
  const MIN_RIGHT = 300

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const available = window.innerWidth - RAIL_WIDTH - SPLITTER_WIDTH * 2
      // Orta panele her zaman yer birak: iki taraf da buyuyunca
      // ortadaki bosluk daralir, ortadaki panel cokmez.
      const maxCombined = Math.max(MIN_LEFT + MIN_RIGHT, available - MIN_MAIN_WIDTH)
      // Ayni anda buyuyemezler: aktif olan digerinin mevcut degerini korur.
      const otherWidth = isDraggingLeftRef.current ? rightSidebarWidthRef.current : leftSidebarWidthRef.current
      const minOther = isDraggingLeftRef.current ? MIN_RIGHT : MIN_LEFT
      const budget = Math.max(minOther, maxCombined - otherWidth)

      if (isDraggingLeftRef.current) {
        const nextLeft = Math.max(MIN_LEFT, Math.min(budget, e.clientX - RAIL_WIDTH))
        leftSidebarWidthRef.current = nextLeft
        setLeftSidebarWidth(nextLeft)
      } else if (isDraggingRightRef.current) {
        const maxRight = Math.max(MIN_RIGHT, window.innerWidth - e.clientX)
        const nextRight = Math.max(MIN_RIGHT, Math.min(budget, maxRight))
        rightSidebarWidthRef.current = nextRight
        setRightSidebarWidth(nextRight)
      }
    }
    const handleMouseUp = () => {
      if (isDraggingLeftRef.current || isDraggingRightRef.current) {
        isDraggingLeftRef.current = false
        isDraggingRightRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        persistPaneWidth('left', leftSidebarWidthRef.current)
        persistPaneWidth('right', rightSidebarWidthRef.current)
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  /**
 * Secili ders/odev satirlari gorunur alana getirilir.
 *
 * Kullanicinin "soldan seçtiğim oge orta ekrana gelmiyor" sorunu:
 * 30+ ders veya 50+ odev oldugunda secili oge listede ekran
 * disinda kaliyor ve kullanici onu bulamiyordu.
 */
const sidebarScrollRef = useRef<HTMLDivElement | null>(null)
  const activeCourseRef = useRef<HTMLButtonElement | null>(null)
  const activeWorkRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    scrollIntoViewIfNeeded(activeCourseRef.current, sidebarScrollRef.current)
  }, [selectedCourse?.id, courses.length])

  useEffect(() => {
    scrollIntoViewIfNeeded(activeWorkRef.current, sidebarScrollRef.current)
  }, [selectedWork?.id, courseWorks.length])

  /**
   * Sohbet panelinde otomatik asagi kaydirma.
   *
   * Onceki surum her `messages` degisiminde (yani her GELEN TOKEN'DA)
   * `scrollIntoView` cagirip `behavior: 'smooth'` ile yeni bir kayma
   * animasyonu baslatiyordu. Iki sonucu vardi:
   *   1) Kullanici eski bir mesaji okumak icin yukari kaydiginda,
   *      bir sonraki token (~100 ms) onu tekrar asagi cekiyordu.
   *   2) Saniyede onlarca token icin yuzlerce animasyon kuyruga
   *      birikiyor, kaydirma titriyordu.
   *
   * Artik kaydirma yalnizca kullanici konteynerin ALTINDA ise (yani
   * zaten en sonu okuyor) yapilir. Yukari kaydirinca sabitlenir ve
   * kullanici kendi konumuna saygi gorulur.
   */
const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const chatStuckRef = useRef(true)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  // Sohbet Oturumları (Chat Sessions) ve Hafıza (Memory) Durumu
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => 'session_' + Date.now())
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isMemoryOpen, setIsMemoryOpen] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editSessionTitle, setEditSessionTitle] = useState('')
  const [memoryProfile, setMemoryProfile] = useState<MemoryProfile | null>(null)
  const [newMemoryKey, setNewMemoryKey] = useState('')
  const [newMemoryValue, setNewMemoryValue] = useState('')
  const [newMemoryScope, setNewMemoryScope] = useState<'global' | 'session'>('global')

  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    chatStuckRef.current = true
    setShowScrollBottom(false)
    const el = chatScrollRef.current
    if (el) {
      if (behavior === 'auto') {
        el.scrollTop = el.scrollHeight
      } else {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }
    }
    chatEndRef.current?.scrollIntoView({ behavior, block: 'end' })
  }, [])

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isAtBottom = distanceFromBottom < 85
    chatStuckRef.current = isAtBottom
    setShowScrollBottom(!isAtBottom)
  }, [])

  // Mesaj listesi veya üretim durumu değiştiğinde otomatik kaydırma
  useEffect(() => {
    if (!chatStuckRef.current) return
    const el = chatScrollRef.current
    if (!el) return
    if (isGenerating) {
      el.scrollTop = el.scrollHeight
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      const timer = window.setTimeout(() => {
        if (chatStuckRef.current && chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
        }
      }, 60)
      return () => window.clearTimeout(timer)
    }
  }, [messages, isGenerating])

  // ResizeObserver ile içeriğin dinamik olarak büyümesini (Markdown render vb.) izle ve dibe sabitle
  useEffect(() => {
    const el = chatScrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (chatStuckRef.current && chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const resetChatScroll = useCallback(() => {
    chatStuckRef.current = true
    setShowScrollBottom(false)
    const el = chatScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    chatEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [])

  const loadSessions = useCallback(async () => {
    try {
      const list = await window.jmcAPI?.getChatSessions?.()
      if (list && Array.isArray(list)) {
        setSessions(list)
      }
    } catch {
      // yoksay
    }
  }, [])

  const loadMemory = useCallback(async (targetSessionId?: string) => {
    try {
      const sid = targetSessionId || currentSessionId
      const prof = await window.jmcAPI?.getMemoryProfile?.(sid)
      if (prof) setMemoryProfile(prof)
    } catch {
      // yoksay
    }
  }, [currentSessionId])

  useEffect(() => {
    void loadSessions()
    void loadMemory()
  }, [loadSessions, loadMemory])

  const handleNewChat = useCallback(() => {
    const newId = 'session_' + Date.now()
    setCurrentSessionId(newId)
    setMessages([])
    setChatAttachment(null)
    setInputPrompt('')
    setIsHistoryOpen(false)
    setIsMemoryOpen(false)
    chatStuckRef.current = true
    setShowScrollBottom(false)
    void loadMemory(newId)
    onNotify('success', t('ai.chat.newChat') + ' oluşturuldu.')
  }, [loadMemory, onNotify, t])

  const handleSwitchSession = useCallback(async (sess: ChatSession) => {
    setCurrentSessionId(sess.id)
    setMessages(sess.messages || [])
    setChatAttachment(null)
    setInputPrompt('')
    setIsHistoryOpen(false)
    chatStuckRef.current = true
    setShowScrollBottom(false)
    // Oturuma ait hafızayı anında tazele
    void loadMemory(sess.id)
    // Eğer oturum belirli bir derse aitse ders bağlamını geri getir
    if (sess.courseId && courses.length > 0) {
      const matched = courses.find(c => c.id === sess.courseId)
      if (matched && (!selectedCourse || selectedCourse.id !== sess.courseId)) {
        void selectCourseRefFn.current?.(matched)
      }
    }
    resetChatScroll()
  }, [courses, loadMemory, resetChatScroll, selectedCourse])

  const handleDeleteSession = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await window.jmcAPI?.deleteChatSession?.(id)
      setSessions(prev => prev.filter(s => s.id !== id))
      if (currentSessionId === id) {
        handleNewChat()
      }
      onNotify('success', 'Sohbet silindi.')
    } catch {
      onNotify('error', 'Sohbet silinemedi.')
    }
  }, [currentSessionId, handleNewChat, onNotify])

  const handleSaveEditTitle = useCallback(async (id: string, e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = editSessionTitle.trim()
    if (!trimmed) {
      setEditingSessionId(null)
      return
    }
    try {
      await window.jmcAPI?.renameChatSession?.(id, trimmed)
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: trimmed } : s))
      setEditingSessionId(null)
    } catch {
      onNotify('error', 'Yeniden adlandırılamadı.')
    }
  }, [editSessionTitle, onNotify])

  const handleAddMemoryItem = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMemoryKey.trim() || !newMemoryValue.trim()) return
    try {
      await window.jmcAPI?.saveMemoryItem?.(
        {
          category: 'preference',
          key: newMemoryKey.trim(),
          value: newMemoryValue.trim(),
          scope: newMemoryScope,
          source: 'user',
        },
        newMemoryScope === 'session' ? currentSessionId : undefined,
      )
      setNewMemoryKey('')
      setNewMemoryValue('')
      void loadMemory()
      onNotify('success', 'Hafıza kaydı eklendi.')
    } catch {
      onNotify('error', 'Hafıza kaydı eklenemedi.')
    }
  }, [currentSessionId, loadMemory, newMemoryKey, newMemoryScope, newMemoryValue, onNotify])

  const handleDeleteMemoryItem = useCallback(async (id: string, scope: 'global' | 'session') => {
    try {
      await window.jmcAPI?.deleteMemoryItem?.(id, scope === 'session' ? currentSessionId : undefined)
      void loadMemory()
      onNotify('success', 'Hafıza silindi.')
    } catch {
      onNotify('error', 'Hafıza silinemedi.')
    }
  }, [currentSessionId, loadMemory, onNotify])

  const handleClearMemory = useCallback(async (scope: 'global' | 'session' | 'all') => {
    try {
      await window.jmcAPI?.clearMemory?.(scope, scope === 'session' ? currentSessionId : undefined)
      void loadMemory()
      onNotify('success', 'Hafıza temizlendi.')
    } catch {
      onNotify('error', 'Hafıza temizlenemedi.')
    }
  }, [currentSessionId, loadMemory, onNotify])

  // Yapay zekânın kullanılabilir olup olmadığı GERÇEK durumdan hesaplanır.
  const aiReady = useMemo(() => {
    const provider = providers.find(p => p.id === selectedProviderId)
    if (!provider) return false
    return provider.isLocal || provider.hasKey
  }, [providers, selectedProviderId])

  /**
   * Asenkron geri çağrıların (ör. `selectWork`) guncel durumu okuyabilmesi
   * icin refle tutulan karsiliklar. Boylece secili ders degisse bile
   * eski bir deger okunmaz.
   */
  const activeContextRef = useRef<ActiveContext>({})
  const selectedCourseRef = useRef<Course | null>(null)

  const selectCourse = useCallback(
    async (course: Course, isStale: () => boolean = () => false) => {
      selectedCourseRef.current = course
      setSelectedCourse(course)
      setSelectedWork(null)
      setCurrentRubric(undefined)
      setCurrentSubmission(undefined)

      // Yeni derste yapay zekâ baglami sifirlanir; aksi halde asistan
      // onceki dersin kimligiyle konusmaya devam eder.
      const cleared: ActiveContext = {}
      activeContextRef.current = cleared
      setActiveContext(cleared)
      void window.jmcAPI.updateActiveContext(cleared)

      try {
        const details = await window.jmcAPI.getCourseDetails(course.id)
        if (isStale()) return
        setCourseWorks(details.courseWork || [])
        setCourseAnnouncements(details.announcements || [])
        setCourseMaterials(details.materials || [])
        setCourseParticipants(details.participants || [])
        setCourseTopics(details.topics || [])
      } catch (err) {
        if (isStale()) return
        setCourseWorks([])
        setCourseAnnouncements([])
        setCourseMaterials([])
        setCourseParticipants([])
        setCourseTopics([])
        setSyncError(err instanceof Error ? err.message : 'Ders içeriği alınamadı.')
      }
    },
    [],
  )

  selectCourseRefFn.current = selectCourse

  const loadAccount = useCallback(async (isStale: () => boolean) => {
    const acc = await window.jmcAPI.getAccount()
    if (isStale()) return
    setAccount(acc)

    // HESAP YETENEĞİ
    // ---------------
    // Bireysel @gmail.com hesaplarında Google Classroom HİÇ YOKTUR.
    // Onceki surumde kullanici senkronizasyonu deniyor, 400/403 aliyor,
    // "Ders bulunamadi" yaziyor ve uygulamanin BOZUK oldugunu saniyordu.
    // Gercek neden (Google bu hizmeti bireysel hesaplara acmaz) ekranda
    // yaziliyor.
    void window.jmcAPI
      .getAccountCapability()
      .then(cap => {
        if (!isStale()) setAccountCapability(cap)
      })
      .catch(() => {
        if (!isStale()) setAccountCapability(null)
      })

    if (!acc) {
      setCourses([])
      setSelectedCourse(null)
      selectedCourseRef.current = null
      setCourseWorks([])
      setCourseAnnouncements([])
      setCourseMaterials([])
      setCourseParticipants([])
      setCourseTopics([])
      setSelectedWork(null)
      setCurrentRubric(undefined)
      setCurrentSubmission(undefined)
      setSyncStatus(null)
      setSyncError(null)
    }
  }, [])

  /** Ders listesini ve seçimi tazeler. Giriş sonrası ve elle yenilemede aynı yol. */
  const loadCourses = useCallback(
    async (isStale: () => boolean) => {
      const acc = await window.jmcAPI.getAccount()
      if (isStale()) return
      if (!acc) {
        setCourses([])
        setSelectedCourse(null)
        selectedCourseRef.current = null
        setCourseWorks([])
        setCourseAnnouncements([])
        setCourseMaterials([])
        setCourseParticipants([])
        setCourseTopics([])
        setSelectedWork(null)
        return
      }
      const list = await window.jmcAPI.getCourses()
      if (isStale()) return
      setCourses(list)

      const current = selectedCourseRef.current
      const next = (current && list.find(c => c.id === current.id)) || list[0] || null
      if (next) {
        await selectCourse(next, isStale)
      } else {
        selectedCourseRef.current = null
        setSelectedCourse(null)
        setCourseWorks([])
        setCourseAnnouncements([])
        setCourseMaterials([])
        setCourseParticipants([])
        setCourseTopics([])
      }
    },
    [selectCourse],
  )

  /**
   * Kullanicinin daha once kullandigi saglayici ve model.
   *
   * ONCEKI SURUMDE BU YOKTU: her acilista `providers[0]` seciliyordu,
   * yani anahtari olan saglayici varsa o seciliyor, kullanici her
   * yeniden baslattiginda modeli bastan secmek zorunda kaliyordu.
   */
  const loadProviders = useCallback(async (isStale: () => boolean = () => false) => {
    try {
      const list = await window.jmcAPI.getProviders()
      if (isStale()) return
      setProviders(list)

      const [savedProviderId, savedModelId] = await Promise.all([
        window.jmcAPI.getSetting<string>('ai.lastProviderId', ''),
        window.jmcAPI.getSetting<string>('ai.lastModelId', ''),
      ])

      // Kayitli secim gercekten kullanilabilir mi?
      const usable = (id: string) => {
        const p = list.find(item => item.id === id)
        return p && (p.hasKey || p.isLocal) ? p : null
      }

      const preferred =
        usable(savedProviderId) ??
        usable(selectedProviderIdRef.current) ??
        list.find(p => p.hasKey) ??
        list.find(p => p.isLocal) ??
        null

      if (!preferred) {
        setSelectedProviderId(list[0]?.id ?? '')
        setSelectedModelId('')
        return
      }

      setSelectedProviderId(preferred.id)

      // Model secimi: onceki secim > saglayicinin varsayilani > ilk model.
      const modelBelongsToProvider =
        savedModelId && preferred.models.some(m => m.id === savedModelId)
      setSelectedModelId(
        (modelBelongsToProvider && savedModelId) ||
          preferred.selectedModel ||
          preferred.models[0]?.id ||
          '',
      )
    } catch {
      /* yoksay */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const isStale = () => cancelled

    void loadAccount(isStale).then(async () => {
      if (!cancelled) {
        try {
          const acc = await window.jmcAPI.getAccount()
          const existing = await window.jmcAPI.getCourses()
          if (acc && existing.length === 0 && handleSyncAllRef.current) {
            void handleSyncAllRef.current()
          }
        } catch {
          /* yoksay */
        }
      }
    })
    void window.jmcAPI.getSyncStatus().then(s => {
      if (!cancelled) setSyncStatus(s)
    })
    void loadCourses(isStale).catch(err => {
      if (!cancelled) {
        setSyncError(err instanceof Error ? err.message : 'Ders listesi alınamadı.')
      }
    })
    void loadProviders(isStale)

    return () => {
      cancelled = true
    }
  }, [loadAccount, loadCourses, loadProviders])

  // Yapay zeka saglayici veya anahtar degisikliklerini anlik dinle
  useEffect(() => {
    let cancelled = false
    const isStale = () => cancelled

    const onProvidersChanged = () => {
      if (!cancelled) void loadProviders(isStale)
    }

    window.addEventListener(PROVIDERS_CHANGED_EVENT, onProvidersChanged)
    const unsubscribeIpc = window.jmcAPI?.onProvidersUpdated?.(() => {
      if (!cancelled) void loadProviders(isStale)
    })

    /*
      OTOMATIK MODEL SENKRONU.
      Ana surec, uygulama acilirken tum anahtarli saglayicilarin model
      listesini paralel ceker ve bitince `ai:modelsUpdated` yayinlar.
      Burada dinleyip listeyi tazeliyoruz: kullanici hicbir seye basmadan
      guncel model adlarini goruyor.
    */
    const unsubscribeModels = window.jmcAPI?.onModelsUpdated?.(() => {
      if (!cancelled) void loadProviders(isStale)
    })

    return () => {
      cancelled = true
      window.removeEventListener(PROVIDERS_CHANGED_EVENT, onProvidersChanged)
      if (unsubscribeIpc) unsubscribeIpc()
      if (unsubscribeModels) unsubscribeModels()
    }
  }, [loadProviders])

  /**
   * Oturuma ozgu arayuz durumunu sifirlar.
   *
   * `loadAccount` ders verisini temizliyordu ancak `messages`,
   * `chatAttachment`, `inputPrompt` ve `copiedMsgId` HICBIR zaman
   * sifirlanmazdi. Sonuc: B hesabina gecen kullanici, A hesabinin
   * sohbetini (içine yapistirdigi odev taslaklari dahil) aciyordu.
   * Bu bir veri sizintisidir ve hesap degisiminde yeni oturuma
   * tasinmamalidir.
   */
const resetSessionUiState = useCallback(() => {
    setMessages([])
    setChatAttachment(null)
    setInputPrompt('')
    setCopiedMsgId(null)
    setCopyErrorMsgId(null)
    chatStuckRef.current = true
    setSelectedWork(null)
    setCurrentRubric(undefined)
    setCurrentSubmission(undefined)
  }, [])

  // Google ile baglanildiginda hesap ve ders listesi yenilenir.
  useEffect(() => {
    const onAccountChanged = () => {
      // Hesap degisti: onceki oturuma ait TUM arayuz durumu birakilmaz.
      resetSessionUiState()

      let cancelled = false
      void loadAccount(() => cancelled)
        .then(async () => {
          if (!cancelled) {
            try {
              const acc = await window.jmcAPI.getAccount()
              if (acc && handleSyncAllRef.current) {
                void handleSyncAllRef.current()
              }
            } catch {
              /* yoksay */
            }
          }
        })
        .catch(() => {
          cancelled = true
        })
      void loadCourses(() => cancelled).catch(err => {
        if (!cancelled) {
          setSyncError(err instanceof Error ? err.message : 'Ders listesi alınamadı.')
        }
      })
    }
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onAccountChanged)
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, onAccountChanged)
  }, [loadAccount, loadCourses, resetSessionUiState])

  // Ctrl+K / Cmd+K komut paletini acar.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const selectWork = useCallback(
    async (courseId: string, work: CourseWork) => {
      setSelectedWork(work)
      try {
        const data = await window.jmcAPI.getCourseWork(courseId, work.id)
        setCurrentRubric(data.rubric)
        setCurrentSubmission(data.submission)

        const ctx: ActiveContext = {
          ...activeContextRef.current,
          activeCourseId: courseId,
          activeCourseName: selectedCourse?.name,
          activeCourseWorkId: work.id,
          activeCourseWorkTitle: work.title,
          hasRubric: !!data.rubric,
          rubricCriteriaCount: data.rubric?.criteria.length ?? 0,
        }
        setActiveContext(ctx)
        void window.jmcAPI.updateActiveContext(ctx)
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'Ödev detayı alınamadı.')
      }
    },
    [selectedCourse?.name],
  )

  const selectFileForContext = useCallback((att: Attachment) => {
    const updated: ActiveContext = {
      ...activeContextRef.current,
      activeFileId: att.driveFileId ?? att.id,
      activeFileName: att.title,
      activeFileMimeType: att.mimeType,
    }
    activeContextRef.current = updated
    setActiveContext(updated)
    void window.jmcAPI.updateActiveContext(updated)
  }, [])

  const handleDownloadAttachment = useCallback(
    async (att: Attachment) => {
      if (!selectedCourse) return
      try {
        onNotify('success', `"${att.title}" indiriliyor...`)
        const updated = await window.jmcAPI.downloadAttachment(att, selectedCourse.id)
        if (updated && updated.isLocalAvailable) {
          onNotify('success', `"${att.title}" başarıyla indirildi.`)
          setCourseMaterials(prev =>
            prev.map(m => ({
              ...m,
              materials: m.materials.map(a =>
                a.id === att.id || (att.driveFileId && a.driveFileId === att.driveFileId)
                  ? { ...a, ...updated }
                  : a,
              ),
            })),
          )
          setCourseWorks(prev =>
            prev.map(w => ({
              ...w,
              materials: (w.materials || []).map(a =>
                a.id === att.id || (att.driveFileId && a.driveFileId === att.driveFileId)
                  ? { ...a, ...updated }
                  : a,
              ),
            })),
          )
          setCourseAnnouncements(prev =>
            prev.map(ann => ({
              ...ann,
              materials: ann.materials.map(a =>
                a.id === att.id || (att.driveFileId && a.driveFileId === att.driveFileId)
                  ? { ...a, ...updated }
                  : a,
              ),
            })),
          )
        } else {
          onNotify('error', `"${att.title}" indirilemedi veya erişim kısıtlı.`)
        }
      } catch (err) {
        onNotify('error', `İndirme hatası: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [selectedCourse, onNotify],
  )

  const handleOpenPreview = useCallback((att: Attachment) => {
    setPreviewAttachment(att)
  }, [])

  const handleClosePreview = useCallback(() => {
    setPreviewAttachment(null)
  }, [])

  const handleSendPreviewToAssistant = useCallback(
    (preview: FilePreviewResult) => {
      setInspectorOpen(true)
      const title = preview.title || 'Belge'
      setInputPrompt(`Lütfen "${title}" belgesini ayrıntılı incele, ana temaları ve önemli noktaları özetle.`)
      const updated: ActiveContext = {
        ...activeContextRef.current,
        activeFileId: preview.fileId,
        activeFileName: preview.title,
        activeFileContent: preview.text ? preview.text.slice(0, 16000) : undefined,
      }
      activeContextRef.current = updated
      setActiveContext(updated)
      void window.jmcAPI?.updateActiveContext(updated)
      onNotify('success', `"${title}" asistan bağlamına eklendi.`)
    },
    [onNotify],
  )

  const handleSyncAll = useCallback(async () => {
    const currentAccount = accountRef.current || (await window.jmcAPI.getAccount())
    if (!currentAccount) {
      onOpenAuth()
      return
    }
    setSyncing(true)
    setSyncError(null)
    try {
      const status = await window.jmcAPI.syncAll()
      const list = await window.jmcAPI.getCourses()
      setCourses(list)

      if (status.activeErrors.length) {
        const errMsg = status.activeErrors.join(' · ')
        setSyncError(errMsg)
        onNotify('error', `Senkronizasyon uyarısı: ${errMsg}`)
      } else {
        onNotify('success', `${list.length} ders başarıyla senkronize edildi.`)
      }

      // Önceki secim hâlâ geçerliyse onu koru, degilse ilk dersi ac.
      // Secim her zaman selectCourse uzerinden gecer; aksi halde ders
      // listesi yenilenirken icerik paneli eski kalir.
      const next =
        (selectedCourseRef.current && list.find(c => c.id === selectedCourseRef.current?.id)) ||
        list[0] ||
        null

      if (next) {
        await selectCourse(next)
      } else {
        setSelectedCourse(null)
        setCourseWorks([])
        setSelectedWork(null)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Senkronizasyon başarısız.'
      setSyncError(msg)
      onNotify('error', msg)
    } finally {
      setSyncing(false)
    }
  }, [onOpenAuth, selectCourse, onNotify])

  handleSyncAllRef.current = handleSyncAll

  // Otomatik periyodik senkronizasyon (varsayilan: 5 dakika)
  useEffect(() => {
    if (!account) return
    if (accountCapability && !accountCapability.canUseClassroom) return
    if (!autoSyncMinutes || autoSyncMinutes <= 0) return

    const intervalMs = Math.max(1, autoSyncMinutes) * 60_000
    const timer = window.setInterval(() => {
      if (!syncing) {
        void handleSyncAll()
      }
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [account, accountCapability, autoSyncMinutes, syncing, handleSyncAll])

  const handleSendMessage = useCallback(async () => {
    const text = inputPrompt.trim()
    if ((!text && !chatAttachment) || isGenerating || !selectedProviderId) return

    const currentAttachment = chatAttachment
    setChatAttachment(null)

    const promptText = text || (currentAttachment ? `Lütfen ekteki ${currentAttachment.name} dosyasını analiz et.` : '')
    const displayContent = currentAttachment
      ? `📎 [${currentAttachment.name}${currentAttachment.size ? ` - ${Math.round(currentAttachment.size / 1024)} KB` : ''}]\n\n${promptText}`
      : promptText

    const userMsg: AiMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: displayContent,
      timestamp: new Date().toISOString(),
    }
    const assistantId = `asst_${Date.now()}`

    const history = [...messages, userMsg]
    setInputPrompt('')
    setIsGenerating(true)
    chatStuckRef.current = true
    setShowScrollBottom(false)
    setMessages(prev => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '', timestamp: new Date().toISOString() },
    ])

    const el = chatScrollRef.current
    if (el) {
      setTimeout(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }, 10)
    }

    let content = ''
    let reasoning = ''

    try {
      // Token tasarrufu ve hız: son 12 mesaj gönderilir, hafıza sistemi genel bağlamı korur
      const payloadMessages = history.slice(-12).map(m => ({ role: m.role, content: m.content }))

      const completed = await window.jmcAPI.sendChatMessage(
        {
          providerId: selectedProviderId,
          modelId: selectedModelId,
          messages: payloadMessages,
          context: activeContext,
          mode: aiMode,
          attachments: currentAttachment ? [currentAttachment] : undefined,
          sessionId: currentSessionId,
        },
        (chunk, reasoningChunk) => {
          if (reasoningChunk) reasoning += reasoningChunk
          if (chunk) content += chunk
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content, reasoningContent: reasoning || undefined }
                : m,
            ),
          )
          if (chatStuckRef.current && chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
          }
        },
      )

      const finalMessages = [
        ...history,
        { ...completed, id: assistantId },
      ]

      setMessages(prev =>
        prev.map(m => (m.id === assistantId ? { ...completed, id: assistantId } : m)),
      )

      // Sohbet oturumunu otomatik kaydet
      const currentTitle = sessions.find(s => s.id === currentSessionId)?.title
      const newTitle = currentTitle && currentTitle !== 'Yeni Sohbet'
        ? currentTitle
        : promptText.slice(0, 35) || 'Sohbet'

      const updatedSession: ChatSession = {
        id: currentSessionId,
        title: newTitle,
        courseId: activeContext.activeCourseId,
        courseName: activeContext.activeCourseName,
        createdAt: sessions.find(s => s.id === currentSessionId)?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: finalMessages.length,
        messages: finalMessages,
      }

      void window.jmcAPI?.saveChatSession?.(updatedSession).then(ok => {
        if (ok) {
          setSessions(prev => {
            const idx = prev.findIndex(s => s.id === updatedSession.id)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = updatedSession
              return next
            }
            return [updatedSession, ...prev]
          })
        }
      })
      void loadMemory()
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const cancelled =
        /durdur|iptal|abort/i.test(raw) && !/failed|basarisiz/i.test(raw)

      if (cancelled) {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content || '_(Yanıt üretimi durduruldu.)_',
                  isError: false,
                  reasoningContent: reasoning || undefined,
                }
              : m,
          ),
        )
      } else {
        let message = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/i, '').trim()
        if (/429|Too Many Requests|quota/i.test(message)) {
          message = 'Model istek sınırı aşıldı (HTTP 429 Too Many Requests). Lütfen bir süre bekleyin veya farklı bir model seçin.'
        } else if (/413|Payload Too Large|Request entity too large/i.test(message)) {
          message = 'İstek yükü çok büyük (HTTP 413 Payload Too Large). Eklenen dosya metinleri sınırlandırıldı; lütfen daha kısa bir dosya veya özet deneyin.'
        }
        if (!message) message = 'Sağlayıcıya ulaşılamadı.'
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: message, isError: true, reasoningContent: undefined }
              : m,
          ),
        )
        onNotify('error', `Yapay zekâ isteği başarısız: ${message}`)
      }
    } finally {
      setIsGenerating(false)
      scrollToBottom('smooth')
    }
  }, [activeContext, aiMode, chatAttachment, currentSessionId, inputPrompt, isGenerating, loadMemory, messages, onNotify, scrollToBottom, selectedModelId, selectedProviderId, sessions])

  /**
   * Devam eden yanit uretimini durdurur.
   *
   * Ana surecteki `AbortController`'i tetikler; akis gercekten
   * kesilir ve arayuz normale doner.
   */
  const handleStopGeneration = useCallback(async () => {
    try {
      await window.jmcAPI.cancelChat()
    } catch {
      /* iptal basarisiz olsa bile arayuzu kilitli birakma */
    } finally {
      setIsGenerating(false)
    }
  }, [])

  const handleApproveTool = async (callId: string) => {
    try {
      const ok = await window.jmcAPI.approveToolCall(callId)
      if (ok) {
        onNotify('success', t('ai.toolApproved'))
        setMessages(prev =>
          prev.map(m => ({
            ...m,
            toolCalls: m.toolCalls?.map(tc =>
              tc.id === callId ? { ...tc, status: 'completed' as const } : tc,
            ),
          })),
        )
      } else {
        onNotify('error', t('ai.toolError'))
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : t('ai.toolError'))
    }
  }

  const handleRejectTool = async (callId: string) => {
    try {
      await window.jmcAPI.rejectToolCall(callId)
      onNotify('success', t('ai.toolRejected'))
      setMessages(prev =>
        prev.map(m => ({
          ...m,
          toolCalls: m.toolCalls?.map(tc =>
            tc.id === callId ? { ...tc, status: 'rejected' as const } : tc,
          ),
        })),
      )
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : t('ai.toolError'))
    }
  }

  const handleTriggerQuickAction = (action: 'summarize' | 'rubric' | 'skeleton' | 'quiz') => {
    if (!selectedWork) return
    let prompt = ''
    let mode: typeof aiMode = 'general'
    if (action === 'summarize') {
      prompt = `Bu görevin (${selectedWork.title}) yönergesini, beklentilerini ve önemli adımlarını özetle.`
      mode = 'socratic'
    } else if (action === 'rubric') {
      prompt = `Bu ödevin (${selectedWork.title}) değerlendirme rubriğini incele ve yüksek puan almak için gereken kriterleri analiz et.`
      mode = 'rubric'
    } else if (action === 'skeleton') {
      prompt = `Bu görev için (${selectedWork.title}) Markdown formatında detaylı bir çözüm ve çalışma raporu taslağı iskeleti hazırla.`
      mode = 'draft'
    } else if (action === 'quiz') {
      prompt = `Bu görev konusuyla (${selectedWork.title}) ilgili kendimi test edebileceğim çalışma soruları ve cevapları üret.`
      mode = 'quiz'
    }

    setAiMode(mode)
    setInputPrompt(prompt)
    if (!inspectorOpen) setInspectorOpen(true)
  }

  const online = Boolean(account)
  const syncLabel = syncing
    ? t('top.syncing')
    : syncStatus?.lastSyncedAt
      ? `${t('settings.sync.lastSync')} ${new Date(syncStatus.lastSyncedAt).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}`
      : t('settings.sync.notSynced')

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--jmc-bg)] text-[var(--jmc-text)]">
      {/* ---------------- Sol gezinme rayı ---------------- */}
      <nav
        aria-label="Ana gezinme"
        className="flex w-14 shrink-0 flex-col items-center justify-between bg-[var(--jmc-bg-elevated)] py-4"
      >
        <div className="flex flex-col items-center gap-5">
          <button
            type="button"
            onClick={onOpenAbout}
            title="JustMyClass hakkında"
            aria-label="JustMyClass hakkında"
            className="grid h-9 w-9 place-items-center rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-badge-bg)] text-[var(--jmc-primary)] shadow-[var(--jmc-shadow-sm)] transition-transform hover:scale-[1.04] active:scale-95"
          >
            <Library className="h-[18px] w-[18px]" />
          </button>

          <div className="flex flex-col gap-1">
            <RailButton label="Komut paleti (Ctrl+K)" onClick={() => setPaletteOpen(true)}>
              <Search className="h-[18px] w-[18px]" />
            </RailButton>
            <RailButton
              label={account ? t('top.sync') : 'Google hesabıyla bağlan'}
              onClick={() => void handleSyncAll()}
              disabled={syncing}
            >
              <RefreshCw className={`h-[18px] w-[18px] ${syncing ? 'animate-spin-slow' : ''}`} />
            </RailButton>
            <RailButton
              label={inspectorOpen ? t('ai.collapse') : t('ai.assistant')}
              onClick={() => setInspectorOpen(prev => !prev)}
            >
              <div className="relative">
                <Sparkles className={`h-[18px] w-[18px] transition-colors ${inspectorOpen ? 'text-[var(--jmc-primary)]' : 'text-[var(--jmc-text-muted)]'}`} />
                {aiReady && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[var(--jmc-success)] ring-1 ring-[var(--jmc-bg-elevated)]" />
                )}
              </div>
            </RailButton>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          {account ? (
            <button
              type="button"
              onClick={() => onOpenSettings('account')}
              title={`${account.displayName || account.email}${account.institution ? ' · ' + account.institution : ''} · ${account.role === 'TEACHER' ? 'Öğretmen' : 'Öğrenci'}`}
              aria-label="Hesap ve ayarlar"
              className="relative rounded-full"
            >
              {account.photoUrl ? (
                <img
                  src={account.photoUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-full object-cover shadow-[var(--jmc-shadow-sm)]"
                />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--jmc-primary)] text-[11px] font-semibold text-white">
                  {initials(account.displayName || account.email)}
                </span>
              )}
            </button>
          ) : (
            <RailButton label="Google ile bağlan" onClick={onOpenAuth}>
              <LogIn className="h-[18px] w-[18px]" />
            </RailButton>
          )}

          <RailButton label={t('nav.settings')} onClick={() => onOpenSettings('providers')}>
            <Settings className="h-[18px] w-[18px]" />
          </RailButton>
          <RailButton label={t('nav.about')} onClick={onOpenAbout}>
            <Info className="h-[18px] w-[18px]" />
          </RailButton>
        </div>
      </nav>

      {/* ---------------- Ders ve görev listesi ---------------- */}
      <aside
        style={{ width: `${leftSidebarWidth}px` }}
        className="flex shrink-0 flex-col bg-[var(--jmc-bg-elevated)] overflow-hidden"
      >
        <header className="flex flex-col gap-1 px-4 py-3 border-b border-[var(--jmc-border-subtle)]">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-tight">{t('courses.title')}</h2>
            <span className="tnum text-[11px] text-[var(--jmc-text-dim)]">{courses.length}</span>
          </div>
          {account?.institution && (
            <div className="flex items-center gap-1.5 truncate text-[10.5px] font-medium text-[var(--jmc-primary)]">
              <GraduationCap className="h-3 w-3 shrink-0" />
              <span className="truncate">{account.institution}</span>
            </div>
          )}
        </header>

        {syncError && (
          <div
            role="alert"
            className="mx-3 mb-2 flex items-start gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-badge-bg)] p-2.5 text-[11px] leading-snug text-[var(--jmc-danger)]"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-3">{syncError}</span>
          </div>
        )}

        <div ref={sidebarScrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {courses.length === 0 ? (
            <EmptyState
              icon={
                accountCapability?.reason === 'personal-gmail' ? (
                  <ShieldAlert className="h-5 w-5 text-[var(--jmc-warning)]" />
                ) : (
                  <BookOpen className="h-5 w-5" />
                )
              }
              title={
                accountCapability?.reason === 'personal-gmail'
                  ? 'Google Classroom kullanılamıyor'
                  : t('courses.noCourses')
              }
              body={
                accountCapability?.reason === 'personal-gmail'
                  ? accountCapability.detail
                  : account
                    ? t('settings.sync.notSynced')
                    : t('settings.accounts.notConnected')
              }
              action={
                accountCapability?.reason === 'personal-gmail' ? (
                  <button
                    type="button"
                    onClick={() => onOpenSettings('account')}
                    className={primaryButton}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Ayarları Aç
                  </button>
                ) : account ? (
                  <button type="button" onClick={handleSyncAll} className={primaryButton} disabled={syncing}>
                    <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin-slow' : ''}`} />
                    {t('top.sync')}
                  </button>
                ) : (
                  <button type="button" onClick={onOpenAuth} className={primaryButton}>
                    <LogIn className="h-3.5 w-3.5" />
                    {t('welcome.connectGoogle')}
                  </button>
                )
              }
            />
          ) : (
            <>
              <ul className="space-y-0.5">
                {courses.map(course => {
                  const active = selectedCourse?.id === course.id
                  return (
                    <li key={course.id}>
                      <button
                        ref={active ? activeCourseRef : undefined}
                        type="button"
                        onClick={() => void selectCourse(course)}
                        aria-current={active ? 'true' : undefined}
                        className={`w-full rounded-[var(--jmc-radius)] px-2.5 py-2 text-left transition-colors ${
                          active
                            ? 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text)] shadow-[var(--jmc-shadow-sm)]'
                            : 'text-[var(--jmc-text-muted)] hover:bg-[var(--jmc-bg-surface)]'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[12px] font-medium">{course.name}</span>
                          {course.courseState === 'ARCHIVED' && (
                            <span className="shrink-0 rounded-full bg-[var(--jmc-bg)] px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--jmc-text-dim)]">
                              {t('courses.archiveBadge')}
                            </span>
                          )}
                        </span>
                        {course.section && (
                          <span className="mt-0.5 block truncate text-[10.5px] text-[var(--jmc-text-dim)]">
                            {course.section}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>

              {selectedCourse && (
                <section className="mt-3">
                  <h3 className="flex items-center justify-between px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--jmc-text-dim)]">
                    <span>{t('courses.assignments')}</span>
                    <span className="tnum">{courseWorks.length}</span>
                  </h3>
                  {courseWorks.length === 0 ? (
                    <p className="px-2.5 py-2 text-[11px] text-[var(--jmc-text-dim)]">
                      {t('courses.noAssignments')}
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {courseWorks.map(work => {
                        const active = selectedWork?.id === work.id
                        const overdue = isOverdue(work)
                        const urgency = getUrgencyBadge(work, t)
                        return (
                          <li key={work.id}>
                            <button
                              ref={active ? activeWorkRef : undefined}
                              type="button"
                              onClick={() => void selectWork(selectedCourse.id, work)}
                              aria-current={active ? 'true' : undefined}
                              className={`w-full rounded-[var(--jmc-radius)] px-2.5 py-2 text-left transition-colors ${
                                active
                                  ? 'bg-[var(--jmc-badge-bg)] text-[var(--jmc-text)] shadow-[var(--jmc-shadow-sm)]'
                                  : 'text-[var(--jmc-text-muted)] hover:bg-[var(--jmc-bg-surface)]'
                              }`}
                            >
                              <span className="flex items-center justify-between gap-1.5">
                                <span className="line-clamp-1 text-[12px] font-medium">{work.title}</span>
                                {urgency && (
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${urgency.className}`}>
                                    {urgency.label}
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 flex items-center justify-between gap-2 text-[10.5px]">
                                {work.dueDate ? (
                                  <span className={`tnum ${overdue ? 'text-[var(--jmc-danger)]' : 'text-[var(--jmc-text-dim)]'}`}>
                                    {work.dueDate.day}.{work.dueDate.month}.{work.dueDate.year}
                                  </span>
                                ) : (
                                  <span className="text-[var(--jmc-text-dim)]">{t('courses.noDate')}</span>
                                )}
                                {work.maxPoints !== undefined && (
                                  <span className="tnum text-[var(--jmc-text-dim)]">{work.maxPoints} {t('courses.points')}</span>
                                )}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--jmc-border-subtle)] px-3.5 py-2.5 text-[10.5px] text-[var(--jmc-text-dim)]">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            {online ? (
              <Wifi className="h-3 w-3 shrink-0 text-[var(--jmc-success)]" />
            ) : (
              <WifiOff className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{syncLabel}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onOpenSettings('sync')}
              title="Otomatik senkronizasyon aralığını değiştir"
              className="inline-flex items-center gap-1 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg-surface)] px-1.5 py-0.5 text-[9.5px] font-medium text-[var(--jmc-text-muted)] transition-colors hover:text-[var(--jmc-primary)]"
            >
              <Clock className="h-2.5 w-2.5 text-[var(--jmc-primary)]" />
              <span>{autoSyncMinutes > 0 ? `${autoSyncMinutes}dk oto` : 'Elle'}</span>
            </button>
            <button
              type="button"
              onClick={() => onExport('csv')}
              disabled={courses.length === 0}
              aria-label="CSV dışa aktar"
              title="CSV dışa aktar"
              className="shrink-0 rounded p-1 transition-colors hover:text-[var(--jmc-primary)] disabled:opacity-35"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </footer>
      </aside>

      {/* ---------------- Sol panel yeniden boyutlandırıcı ---------------- */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={e => {
          e.preventDefault()
          isDraggingLeftRef.current = true
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
        className="w-1 cursor-col-resize hover:bg-[var(--jmc-primary)] transition-colors z-10 shrink-0 select-none bg-[var(--jmc-border-subtle)]"
        title="Genişliği ayarla"
      />

      {/* ---------------- Ana içerik ---------------- */}
      <main className="relative min-w-0 flex-1 overflow-hidden flex flex-col">
        {!inspectorOpen && (
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            aria-label={t('ai.expand')}
            title={t('ai.expand')}
            className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-elevated)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] border border-[var(--jmc-border)] shadow-[var(--jmc-shadow-md)] transition-all duration-200 hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] hover:scale-[1.02] active:scale-[0.98] animate-pop-in"
          >
            <Sparkles className="h-4 w-4 text-[var(--jmc-primary)]" />
            <span>{t('ai.assistant')}</span>
            {aiReady && (
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--jmc-success)]" />
            )}
          </button>
        )}
        {selectedWork ? (
          <DocumentStudio
            course={selectedCourse}
            courseWork={selectedWork}
            rubric={currentRubric}
            submission={currentSubmission}
            onDownloadAttachment={handleDownloadAttachment}
            onPreviewAttachment={handleOpenPreview}
            onSelectFileForContext={selectFileForContext}
            onTriggerAiMode={mode => setAiMode(mode)}
            onSubmissionChanged={state =>
              setCurrentSubmission(prev => (prev ? { ...prev, state } : prev))
            }
            onBackToCourse={() => setSelectedWork(null)}
          />
        ) : selectedCourse ? (
          <CourseOverview
            course={selectedCourse}
            topics={courseTopics}
            courseWorks={courseWorks}
            announcements={courseAnnouncements}
            materials={courseMaterials}
            participants={courseParticipants}
            onSelectWork={work => void selectWork(selectedCourse.id, work)}
            onSyncCourse={handleSyncAll}
            isSyncing={syncing}
            onDownloadAttachment={handleDownloadAttachment}
            onPreviewAttachment={handleOpenPreview}
          />
        ) : (
          <div className="grid h-full place-items-center p-8">
            <div className="max-w-md text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] text-[var(--jmc-primary)] shadow-[var(--jmc-shadow-sm)]">
                <Library className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold tracking-tight">
                {courses.length ? t('welcome.title') : t('welcome.appName')}
              </h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                {courses.length
                  ? t('welcome.instruction')
                  : t('welcome.onboarding')}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {!account && (
                  <button type="button" onClick={onOpenAuth} className={primaryButton}>
                    <LogIn className="h-3.5 w-3.5" />
                    {t('welcome.connectGoogle')}
                  </button>
                )}
                <button type="button" onClick={() => setPaletteOpen(true)} className={ghostButton}>
                  <Command className="h-3.5 w-3.5" />
                  {t('welcome.commandPalette')}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ---------------- Sağ panel yeniden boyutlandırıcı ---------------- */}
      {inspectorOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={e => {
            e.preventDefault()
            isDraggingRightRef.current = true
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          className="w-1 cursor-col-resize hover:bg-[var(--jmc-primary)] transition-colors z-10 shrink-0 select-none bg-[var(--jmc-border-subtle)]"
          title="Genişliği ayarla"
        />
      )}

      {/* ---------------- Yapay zekâ asistan paneli ---------------- */}
      <aside
        aria-label={t('ai.assistant')}
        style={{ width: inspectorOpen ? `${rightSidebarWidth}px` : '0px' }}
        className={`flex shrink-0 flex-col bg-[var(--jmc-bg-elevated)] transition-[width,opacity] duration-200 ease-out select-none overflow-hidden ${
          inspectorOpen
            ? 'opacity-100 border-l border-[var(--jmc-border)]'
            : 'opacity-0 border-l-0 pointer-events-none'
        }`}
      >
        <div style={{ width: `${rightSidebarWidth}px` }} className="flex h-full flex-col relative">
          <header className="shrink-0 px-3.5 pt-3.5 pb-2 border-b border-[var(--jmc-border-subtle)] relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-[var(--jmc-text-dim)] shrink-0">
                  <Sparkles className="h-4 w-4 text-[var(--jmc-primary)]" aria-hidden="true" />
                  {t('ai.assistant')}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setIsHistoryOpen(prev => !prev)
                    setIsMemoryOpen(false)
                    void loadSessions()
                  }}
                  className={`inline-flex items-center gap-1 rounded-[var(--jmc-radius-sm)] px-1.5 py-0.5 text-[10.5px] font-medium transition-colors border max-w-[120px] truncate ${
                    isHistoryOpen
                      ? 'bg-[var(--jmc-primary)] text-white border-transparent'
                      : 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] border-[var(--jmc-border-subtle)]'
                  }`}
                  title={t('ai.chat.history')}
                >
                  <History className="h-3 w-3 shrink-0" />
                  <span className="truncate">{sessions.find(s => s.id === currentSessionId)?.title || t('ai.chat.history')}</span>
                </button>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsMemoryOpen(prev => !prev)
                    setIsHistoryOpen(false)
                    void loadMemory()
                  }}
                  className={`rounded p-1 transition-colors ${
                    isMemoryOpen
                      ? 'bg-[var(--jmc-primary)] text-white'
                      : 'text-[var(--jmc-text-dim)] hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)]'
                  }`}
                  aria-label={t('ai.chat.memoryTitle')}
                  title={t('ai.chat.memoryTitle')}
                >
                  <Brain className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="rounded p-1 text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)] active:scale-95"
                  aria-label={t('ai.chat.newChat')}
                  title={t('ai.chat.newChat')}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMessages([])
                      onNotify('success', 'Sohbet temizlendi.')
                    }}
                    aria-label="Sohbeti temizle"
                    title="Sohbeti temizle"
                    className="rounded p-1 text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-danger)] active:scale-95"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInspectorOpen(false)}
                  aria-label={t('ai.collapse')}
                  title={t('ai.collapse')}
                  className="rounded p-1 text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)] active:scale-95"
                >
                  <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Sohbet Geçmişi Açılır Paneli */}
            {isHistoryOpen && (
              <div className="absolute left-3 right-3 top-[44px] z-30 max-h-[380px] overflow-y-auto rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-2 shadow-xl animate-fade-in space-y-1">
                <div className="flex items-center justify-between pb-1.5 border-b border-[var(--jmc-border-subtle)] px-1">
                  <span className="text-[11px] font-semibold text-[var(--jmc-text)]">{t('ai.chat.history')}</span>
                  <button
                    type="button"
                    onClick={handleNewChat}
                    className="inline-flex items-center gap-1 rounded bg-[var(--jmc-primary)] px-2 py-0.5 text-[10.5px] font-medium text-white hover:bg-[var(--jmc-primary-hover)] transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {t('ai.chat.newChat')}
                  </button>
                </div>
                {sessions.length > 3 && (
                  <div className="px-1 pt-1 pb-0.5">
                    <input
                      type="text"
                      value={sessionSearchQuery}
                      onChange={e => setSessionSearchQuery(e.target.value)}
                      placeholder="Sohbetlerde ara..."
                      className="w-full rounded bg-[var(--jmc-bg)] px-2 py-1 text-[11px] border border-[var(--jmc-border-subtle)] text-[var(--jmc-text)] placeholder:text-[var(--jmc-text-dim)] outline-none focus:border-[var(--jmc-primary)]"
                    />
                  </div>
                )}
                {sessions.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-[var(--jmc-text-dim)]">{t('ai.chat.noSessions')}</p>
                ) : (
                  sessions
                    .filter(s => !sessionSearchQuery.trim() || (s.title || '').toLowerCase().includes(sessionSearchQuery.toLowerCase()))
                    .map(s => {
                    const isCurrent = s.id === currentSessionId
                    const isEditing = editingSessionId === s.id
                    return (
                      <div
                        key={s.id}
                        onClick={() => handleSwitchSession(s)}
                        className={`group flex items-center justify-between gap-1.5 rounded-[var(--jmc-radius-sm)] px-2 py-1.5 cursor-pointer text-[11.5px] transition-colors ${
                          isCurrent
                            ? 'bg-[var(--jmc-primary)]/10 text-[var(--jmc-primary)] font-medium border border-[var(--jmc-primary)]/20'
                            : 'hover:bg-[var(--jmc-bg-surface)] text-[var(--jmc-text)]'
                        }`}
                      >
                        {isEditing ? (
                          <form
                            onSubmit={e => void handleSaveEditTitle(s.id, e)}
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 flex-1 min-w-0"
                          >
                            <input
                              type="text"
                              value={editSessionTitle}
                              onChange={e => setEditSessionTitle(e.target.value)}
                              autoFocus
                              onBlur={() => void handleSaveEditTitle(s.id)}
                              className="w-full rounded bg-[var(--jmc-bg)] px-1.5 py-0.5 text-[11px] border border-[var(--jmc-primary)] outline-none text-[var(--jmc-text)]"
                            />
                          </form>
                        ) : (
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium">{s.title || 'Sohbet'}</div>
                            <div className="text-[10px] text-[var(--jmc-text-dim)]">
                              {new Date(s.updatedAt || s.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {s.messageCount || 0} mesaj
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!isEditing && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                setEditingSessionId(s.id)
                                setEditSessionTitle(s.title)
                              }}
                              className="p-1 rounded text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-bg-surface)]"
                              title={t('ai.chat.renameSession')}
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={e => void handleDeleteSession(s.id, e)}
                            className="p-1 rounded text-[var(--jmc-text-dim)] hover:text-[var(--jmc-danger)] hover:bg-[var(--jmc-bg-surface)]"
                            title={t('ai.chat.deleteSession')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {/* JustMyClass Hafıza & Taste Açılır Paneli */}
            {isMemoryOpen && (
              <div className="absolute left-3 right-3 top-[44px] z-30 max-h-[460px] overflow-y-auto rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-3 shadow-xl animate-fade-in space-y-3">
                <div className="flex items-center justify-between pb-1.5 border-b border-[var(--jmc-border-subtle)]">
                  <div className="flex items-center gap-1.5">
                    <Brain className="h-4 w-4 text-[var(--jmc-primary)]" />
                    <span className="text-[12px] font-semibold text-[var(--jmc-text)]">{t('ai.chat.memoryTitle')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleClearMemory('all')}
                    className="text-[10px] text-[var(--jmc-danger)] hover:underline"
                  >
                    Tümünü Temizle
                  </button>
                </div>
                <p className="text-[10.5px] text-[var(--jmc-text-muted)] leading-relaxed">
                  JustMyClass çalışma tarzınızı, kurallarınızı ve ödev tercihlerinizi burada hatırlar ve her modelle paylaşır.
                </p>

                {/* Yeni Hafıza Kuralı Ekleme */}
                <form onSubmit={handleAddMemoryItem} className="flex flex-col gap-1.5 bg-[var(--jmc-bg-surface)] p-2 rounded-[var(--jmc-radius)] border border-[var(--jmc-border-subtle)]">
                  <div className="text-[10.5px] font-medium text-[var(--jmc-text)]">+ Yeni Alışkanlık / Kural Ekle</div>
                  <input
                    type="text"
                    placeholder="Konu / Başlık (Örn: Çözüm Dili, Matematik, Format)"
                    value={newMemoryKey}
                    onChange={e => setNewMemoryKey(e.target.value)}
                    className="rounded bg-[var(--jmc-bg)] px-2 py-1 text-[11px] border border-[var(--jmc-border)] text-[var(--jmc-text)] outline-none focus:border-[var(--jmc-primary)]"
                  />
                  <textarea
                    placeholder="Kural veya Alışkanlık (Örn: Her zaman Türkçe açıkla, formülleri LaTeX olarak yaz)"
                    value={newMemoryValue}
                    onChange={e => setNewMemoryValue(e.target.value)}
                    rows={2}
                    className="rounded bg-[var(--jmc-bg)] px-2 py-1 text-[11px] border border-[var(--jmc-border)] text-[var(--jmc-text)] outline-none focus:border-[var(--jmc-primary)] resize-none"
                  />
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2 text-[10.5px] text-[var(--jmc-text-muted)]">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="memScope"
                          checked={newMemoryScope === 'global'}
                          onChange={() => setNewMemoryScope('global')}
                          className="accent-[var(--jmc-primary)]"
                        />
                        Genel Profil (Kalıcı)
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="memScope"
                          checked={newMemoryScope === 'session'}
                          onChange={() => setNewMemoryScope('session')}
                          className="accent-[var(--jmc-primary)]"
                        />
                        Bu Sohbet
                      </label>
                    </div>
                    <button
                      type="submit"
                      disabled={!newMemoryKey.trim() || !newMemoryValue.trim()}
                      className="rounded bg-[var(--jmc-primary)] px-2.5 py-1 text-[10.5px] font-medium text-white hover:bg-[var(--jmc-primary-hover)] transition-colors disabled:opacity-40"
                    >
                      Kaydet
                    </button>
                  </div>
                </form>

                {/* Kayıtlı Hafızalar */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-[var(--jmc-text)] flex items-center justify-between">
                    <span>Genel Tercihler ({memoryProfile?.globalItems?.length || 0})</span>
                  </div>
                  {(!memoryProfile?.globalItems || memoryProfile.globalItems.length === 0) ? (
                    <p className="text-[10px] text-[var(--jmc-text-dim)] italic pl-1">Henüz kalıcı tercih kaydedilmedi.</p>
                  ) : (
                    memoryProfile.globalItems.map(item => (
                      <div key={item.id} className="flex items-start justify-between gap-1.5 bg-[var(--jmc-bg-surface)] p-2 rounded text-[11px] border border-[var(--jmc-border-subtle)]">
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-[var(--jmc-text)]">{item.key}: </span>
                          <span className="text-[var(--jmc-text-muted)]">{item.value}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteMemoryItem(item.id, 'global')}
                          className="text-[var(--jmc-text-dim)] hover:text-[var(--jmc-danger)] p-0.5"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}

                  {/* Bu Oturum Hafızası */}
                  <div className="text-[11px] font-semibold text-[var(--jmc-text)] pt-2 flex items-center justify-between">
                    <span>Bu Sohbetin Hafızası ({memoryProfile?.sessionItems?.[currentSessionId]?.length || 0})</span>
                  </div>
                  {(!memoryProfile?.sessionItems?.[currentSessionId] || memoryProfile.sessionItems[currentSessionId].length === 0) ? (
                    <p className="text-[10px] text-[var(--jmc-text-dim)] italic pl-1">Bu sohbete özel çıkarılmış hafıza yok.</p>
                  ) : (
                    memoryProfile.sessionItems[currentSessionId].map(item => (
                      <div key={item.id} className="flex items-start justify-between gap-1.5 bg-[var(--jmc-bg-surface)] p-2 rounded text-[11px] border border-[var(--jmc-border-subtle)]">
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-[var(--jmc-text)]">{item.key}: </span>
                          <span className="text-[var(--jmc-text-muted)]">{item.value}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteMemoryItem(item.id, 'session')}
                          className="text-[var(--jmc-text-dim)] hover:text-[var(--jmc-danger)] p-0.5"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

              <div className="mt-2.5 flex flex-col gap-2.5">
              {/*
                TEK BIRLESIK KONTROL.
                Once iki ayri `ai.model` etiketli <select> vardi (biri
                favoriler one sirali, digeri ham) ve altinda her model icin
                bir favori cipi seriliyordu; 40 modelde panel 40 satir
                uzuyordu. Artik tek panel: marka ikonlu saglayici sutunu +
                arama + gruplanmis model listesi + favoriler icinde.
              */}
              <ModelPicker
                providers={providers}
                providerId={String(selectedProviderId)}
                modelId={selectedModelId}
                onProviderChange={value => {
                  setSelectedProviderId(value)
                  const next = providers.find(p => p.id === value)
                  setSelectedModelId(next?.selectedModel || next?.models[0]?.id || '')
                }}
                onModelChange={setSelectedModelId}
                favorites={favoriteModels}
                onToggleFavorite={toggleFavoriteModel}
                onRefreshModels={handleRefreshAllModels}
                refreshing={refreshingModels}
                onOpenProviderSettings={() => onOpenSettings('providers')}
                emptyProviderLabel={t('ai.emptyProvider')}
                emptyModelLabel={t('ai.emptyModel')}
              />

              <div className="flex flex-wrap gap-1">
                {AI_MODES.map(mode => (
                  <button
                    key={mode.id}
                    type="button"
                    title={mode.hint}
                    onClick={() => setAiMode(mode.id)}
                    aria-pressed={aiMode === mode.id}
                    className={`rounded-[var(--jmc-radius-sm)] px-2 py-[3px] text-[10.5px] font-medium transition-all ${
                      aiMode === mode.id
                        ? 'bg-[var(--jmc-primary)] text-white shadow-xs'
                        : 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                    }`}
                  >
                    {t(`ai.mode.${mode.id}`)}
                  </button>
                ))}
              </div>
              </div>

              <ContextChips context={activeContext} />
            </header>

            <div
              ref={chatScrollRef}
              onScroll={handleChatScroll}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-2.5"
            >
              {messages.length === 0 && (
                aiReady ? (
                  <p className="px-2 py-8 text-center text-[11.5px] leading-relaxed text-[var(--jmc-text-dim)]">
                    {t('ai.noMessages')}
                  </p>
                ) : (
                  <div className="mx-1 my-6 rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] p-4 border border-[var(--jmc-border)] text-center space-y-3 shadow-xs animate-fade-in">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[var(--jmc-warning)]/15 text-[var(--jmc-warning)]">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-[12px] font-semibold text-[var(--jmc-text)]">
                        {providers.find(p => p.id === selectedProviderId)?.displayName || 'Yapay Zekâ'} Anahtarı Gerekli
                      </h4>
                      <p className="text-[11px] text-[var(--jmc-text-muted)] leading-relaxed">
                        {t('ai.noProviderKey')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenSettings('providers')}
                      className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3 py-1.5 text-[11px] font-medium text-white shadow-xs hover:bg-[var(--jmc-primary-hover)] active:scale-95 transition-all"
                    >
                      <Wrench className="h-3 w-3" />
                      <span>{t('settings.tab.providers')} / Anahtar Gir</span>
                    </button>
                  </div>
                )
              )}

              {messages.map(msg => {
                const isUser = msg.role === 'user'
                const isError = Boolean(msg.isError) && !isUser
                return (
                  <article
                    key={msg.id}
                    className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'} animate-fade-in`}
                  >
                    {msg.reasoningContent && (
                      <details className="w-full max-w-[94%] rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-2.5 py-2 border border-[var(--jmc-border-subtle)]">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--jmc-text-dim)]">
                          <Brain className="h-3 w-3" aria-hidden="true" />
                          {t('ai.reasoning')}
                        </summary>
                        <div className="mt-1.5 whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                          {msg.reasoningContent}
                        </div>
                      </details>
                    )}

                    {isError ? (
                      <div
                        role="alert"
                        className="flex max-w-[94%] items-start gap-2 rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--jmc-danger)] border border-[var(--jmc-danger)]/20"
                      >
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1 max-w-[94%]">
                        <div
                          className={`rounded-[var(--jmc-radius-lg)] px-3 py-2.5 shadow-[var(--jmc-shadow-sm)] border border-[var(--jmc-border-subtle)] ${
                            isUser
                              ? 'bg-[var(--jmc-primary)] text-white border-transparent'
                              : 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text)]'
                          }`}
                        >
                          {msg.content ? (
                            <MarkdownView content={msg.content} isUser={isUser} />
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--jmc-text-dim)]">
                              <span className="h-1.5 w-1.5 animate-[jmc-pulse-soft_1.2s_ease-in-out_infinite] rounded-full bg-[var(--jmc-primary)]" />
                              Yanıt bekleniyor...
                            </span>
                          )}
                        </div>

                        {msg.content && (
                          <div className={`flex items-center px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
                            <button
                              type="button"
                              onClick={() => void handleCopyMessage(msg.id, msg.content)}
                              title={
                                copyErrorMsgId === msg.id
                                  ? copyErrorMsgId ? 'Kopyalanamadı' : ''
                                  : copiedMsgId === msg.id
                                    ? 'Kopyalandı'
                                    : 'Mesajı kopyala'
                              }
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-bg-surface)] transition-all"
                            >
                              {copyErrorMsgId === msg.id ? (
                                <>
                                  <AlertCircle className="h-3 w-3 text-[var(--jmc-danger)]" />
                                  <span className="text-[var(--jmc-danger)] font-medium">Kopyalanamadı</span>
                                </>
                              ) : copiedMsgId === msg.id ? (
                                <>
                                  <Check className="h-3 w-3 text-[var(--jmc-success)]" />
                                  <span className="text-[var(--jmc-success)] font-medium">Kopyalandı</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  <span>Kopyala</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Araç Onay Kartları */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="w-full max-w-[94%] space-y-2 mt-1">
                        {msg.toolCalls.map(tc => {
                          const isPending = tc.status === 'pending'
                          const isApproved = tc.status === 'approved' || tc.status === 'completed'
                          return (
                            <div
                              key={tc.id}
                              className="rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] p-2.5 border border-[var(--jmc-border)] shadow-xs space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--jmc-text)]">
                                  <Wrench className="h-3 w-3 text-[var(--jmc-primary)]" />
                                  {t(`ai.toolName.${tc.name}`) || tc.name}
                                </span>
                                <span
                                  className={`text-[9.5px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                                    isPending
                                      ? 'bg-[var(--jmc-warning)]/15 text-[var(--jmc-warning)]'
                                      : isApproved
                                      ? 'bg-[var(--jmc-success)]/15 text-[var(--jmc-success)]'
                                      : 'bg-[var(--jmc-danger)]/15 text-[var(--jmc-danger)]'
                                  }`}
                                >
                                  {isPending
                                    ? t('ai.toolPending')
                                    : isApproved
                                    ? t('ai.toolApproved')
                                    : t('ai.toolRejected')}
                                </span>
                              </div>

                              {isPending && (
                                <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--jmc-border-subtle)]">
                                  <button
                                    type="button"
                                    onClick={() => void handleRejectTool(tc.id)}
                                    className="rounded-[var(--jmc-radius-sm)] px-2.5 py-1 text-[11px] text-[var(--jmc-text-dim)] hover:text-[var(--jmc-danger)] transition-colors"
                                  >
                                    {t('ai.reject')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleApproveTool(tc.id)}
                                    className="rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-primary)] px-3 py-1 text-[11px] font-medium text-white hover:bg-[var(--jmc-primary-hover)] transition-all active:scale-95 shadow-xs"
                                  >
                                    {t('ai.approve')}
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {msg.citations && msg.citations.length > 0 && (
                      <ul className="flex max-w-[94%] flex-wrap gap-1">
                        {msg.citations.map((c, i) => (
                          <li
                            key={`${c.title}-${i}`}
                            title={SOURCE_LABEL[c.sourceType] ?? c.sourceType}
                            className="flex max-w-full items-center gap-1 truncate rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg-surface)] px-1.5 py-0.5 text-[10px] text-[var(--jmc-text-muted)] border border-[var(--jmc-border-subtle)]"
                          >
                            <Bookmark className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{c.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                )
              })}
              <div ref={chatEndRef} className="h-px w-full shrink-0" />
              </div>

            {/* Hızlı Eylem Çipleri (Quick Prompts) */}
            {selectedWork && (
              <div className="shrink-0 flex items-center gap-1 overflow-x-auto px-3.5 py-1.5 border-t border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]">
                <button
                  type="button"
                  onClick={() => handleTriggerQuickAction('summarize')}
                  disabled={isGenerating || !aiReady}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[10px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-badge-bg)] transition-colors border border-[var(--jmc-border-subtle)] disabled:opacity-40"
                >
                  <Zap className="h-2.5 w-2.5 text-[var(--jmc-primary)]" />
                  {t('ai.quick.summarize')}
                </button>
                <button
                  type="button"
                  onClick={() => handleTriggerQuickAction('rubric')}
                  disabled={isGenerating || !aiReady}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[10px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-badge-bg)] transition-colors border border-[var(--jmc-border-subtle)] disabled:opacity-40"
                >
                  <Scale className="h-2.5 w-2.5 text-[var(--jmc-primary)]" />
                  {t('ai.quick.rubric')}
                </button>
                <button
                  type="button"
                  onClick={() => handleTriggerQuickAction('skeleton')}
                  disabled={isGenerating || !aiReady}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[10px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-badge-bg)] transition-colors border border-[var(--jmc-border-subtle)] disabled:opacity-40"
                >
                  <FileText className="h-2.5 w-2.5 text-[var(--jmc-primary)]" />
                  {t('ai.quick.skeleton')}
                </button>
                <button
                  type="button"
                  onClick={() => handleTriggerQuickAction('quiz')}
                  disabled={isGenerating || !aiReady}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[10px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-badge-bg)] transition-colors border border-[var(--jmc-border-subtle)] disabled:opacity-40"
                >
                  <BookOpen className="h-2.5 w-2.5 text-[var(--jmc-primary)]" />
                  {t('ai.quick.quiz')}
                </button>
              </div>
            )}

            {chatAttachment && (
              <div className="shrink-0 flex items-center justify-between gap-2 px-3.5 py-1.5 bg-[var(--jmc-bg)] border-t border-[var(--jmc-border-subtle)] text-[11px] animate-fade-in">
                <div className="flex items-center gap-1.5 truncate text-[var(--jmc-text-muted)]">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--jmc-primary)]" />
                  <span className="truncate font-medium text-[var(--jmc-text)]">{chatAttachment.name}</span>
                  {chatAttachment.size ? (
                    <span className="text-[10px] text-[var(--jmc-text-dim)]">({Math.round(chatAttachment.size / 1024)} KB)</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setChatAttachment(null)}
                  className="rounded p-0.5 text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] transition-colors"
                  title="Eki kaldır"
                  aria-label="Eki kaldır"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {showScrollBottom && (
              <div className="absolute bottom-20 right-5 z-20 animate-fade-in pointer-events-auto">
                <button
                  type="button"
                  onClick={() => scrollToBottom()}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--jmc-primary)] px-3 py-1.5 text-[11px] font-medium text-white shadow-lg hover:bg-[var(--jmc-primary-hover)] active:scale-95 transition-all border border-white/20"
                  title={t('ai.chat.scrollToBottom')}
                >
                  <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
                  <span>{t('ai.chat.scrollToBottom')}</span>
                </button>
              </div>
            )}

            <form
              onSubmit={e => {
                e.preventDefault()
                void handleSendMessage()
              }}
              className="shrink-0 flex items-center gap-1.5 px-3.5 pb-3 pt-2 bg-[var(--jmc-bg-elevated)] border-t border-[var(--jmc-border-subtle)]"
            >
              <button
                type="button"
                onClick={async () => {
                  try {
                    const picked = await window.jmcAPI.pickAttachmentFile()
                    if (picked && !picked.canceled) {
                      setChatAttachment(picked)
                      onNotify('success', `${picked.name} eklendi.`)
                    }
                  } catch (err) {
                    onNotify('error', (err as Error).message)
                  }
                }}
                disabled={isGenerating || !aiReady}
                title="Görsel veya dosya ekle"
                aria-label="Görsel veya dosya ekle"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--jmc-radius)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-bg-surface)] active:scale-95 transition-all disabled:opacity-40"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
              <input
                type="text"
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                placeholder={
                  aiReady
                    ? chatAttachment
                      ? 'Bu dosya hakkında soru sorun veya gönderin...'
                      : t('ai.inputPlaceholder')
                    : t('ai.noProviderKey')
                }
                disabled={isGenerating || !aiReady}
                aria-label={t('ai.inputPlaceholder')}
                className="min-w-0 flex-1 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-2 text-[12px] text-[var(--jmc-text)] shadow-[var(--jmc-shadow-sm)] border border-[var(--jmc-border)] placeholder:text-[var(--jmc-text-dim)] focus:outline-none focus:border-[var(--jmc-primary)] disabled:opacity-50"
              />
              {/*
                DURDUR DUGMESI
                ----------------
                Onceki surumde yanit uretimi durdurulamazdi. Saglayici
                takildiginda, bos dondugunde ya da ag koptugunda
                kullanicinin tek yapabilecegi uygulamayi kapatip acmakti;
                "Yanit bekleniyor..." ekrani kalici olarak ekranda kaliyor
                ve butunler pasifleşiyordu.
              */}
              {isGenerating && (
                <button
                  type="button"
                  onClick={() => void handleStopGeneration()}
                  aria-label="Yanıt üretimini durdur"
                  title="Durdur"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] text-[var(--jmc-text)] border border-[var(--jmc-border)] transition-all hover:bg-[var(--jmc-bg)] hover:border-[var(--jmc-danger)] hover:text-[var(--jmc-danger)] active:scale-95"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              )}
              <button
                type="submit"
                disabled={isGenerating || (!inputPrompt.trim() && !chatAttachment) || !aiReady}
                aria-label={t('ai.send')}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] text-white transition-all hover:bg-[var(--jmc-primary-hover)] active:scale-95 disabled:opacity-40 shadow-xs"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
        </div>
      </aside>

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        courses={courses}
        onSelectCourse={course => {
          void selectCourse(course)
          setPaletteOpen(false)
        }}
        onTriggerAiMode={mode => {
          setAiMode(mode)
          setPaletteOpen(false)
        }}
        onExport={onExport}
      />

      <DocumentViewerModal
        isOpen={!!previewAttachment}
        attachment={previewAttachment}
        courseId={selectedCourse?.id}
        onClose={handleClosePreview}
        onSendToAssistant={handleSendPreviewToAssistant}
        onNotify={(type, msg) => onNotify(type === 'error' ? 'error' : 'success', msg)}
      />
    </div>
  )
}

// =========================================================================
// Yardımcı bileşenler
// =========================================================================

const primaryButton =
  'inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-[var(--jmc-shadow-sm)] transition-colors hover:bg-[var(--jmc-primary-hover)] disabled:opacity-50'
const ghostButton =
  'inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--jmc-text)] shadow-[var(--jmc-shadow-sm)] transition-colors hover:bg-[var(--jmc-bg-elevated)]'

const RailButton: React.FC<{
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    onClick={() => onClick()}
    disabled={disabled}
    title={label}
    aria-label={label}
    className="grid h-9 w-9 place-items-center rounded-[var(--jmc-radius-lg)] text-[var(--jmc-text-muted)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)] disabled:opacity-40"
  >
    {children}
  </button>
)

const ContextChips: React.FC<{ context: ActiveContext }> = ({ context }) => {
  const chips: Array<{ key: string; icon: React.ReactNode; text: string }> = []
  if (context.activeCourseWorkTitle) {
    chips.push({
      key: 'work',
      icon: <ClipboardList className="h-2.5 w-2.5 shrink-0" />,
      text: context.activeCourseWorkTitle,
    })
  }
  if (context.activeFileName) {
    chips.push({
      key: 'file',
      icon: <FileText className="h-2.5 w-2.5 shrink-0" />,
      text: context.activeFileName,
    })
  }
  if (context.hasRubric) {
    chips.push({
      key: 'rubric',
      icon: <Scale className="h-2.5 w-2.5 shrink-0" />,
      text: `Rubrik · ${context.rubricCriteriaCount ?? 0} kriter`,
    })
  }

  if (!chips.length) {
    return (
      <p className="mt-2.5 text-[10.5px] text-[var(--jmc-text-dim)]">
        Bağlam yok. Asistan yalnızca burada listelenen kaynakları kullanır.
      </p>
    )
  }

  return (
    <ul className="mt-2.5 flex flex-wrap gap-1">
      {chips.map(chip => (
        <li
          key={chip.key}
          className="flex max-w-full items-center gap-1 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg-surface)] px-1.5 py-0.5 text-[10px] text-[var(--jmc-text-muted)]"
        >
          {chip.icon}
          <span className="truncate">{chip.text}</span>
        </li>
      ))}
    </ul>
  )
}

const EmptyState: React.FC<{
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}> = ({ icon, title, body, action }) => (
  <div className="flex flex-col items-center px-4 py-10 text-center">
    <div className="grid h-10 w-10 place-items-center rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-dim)] shadow-[var(--jmc-shadow-sm)]">
      {icon}
    </div>
    <p className="mt-3 text-[12px] font-medium">{title}</p>
    <p className="mt-1 text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">{body}</p>
    {action && <div className="mt-3">{action}</div>}
  </div>
)

function initials(name: string): string {
  const parts = name.trim().split(/[\s.@]+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function isOverdue(work: CourseWork): boolean {
  if (!work.dueDate || work.submission?.state === 'TURNED_IN' || work.submission?.state === 'RETURNED') return false
  const { year, month, day } = work.dueDate
  const due = new Date(year, month - 1, day, work.dueTime?.hours ?? 23, work.dueTime?.minutes ?? 59)
  return due.getTime() < Date.now()
}

function getUrgencyBadge(
  work: CourseWork,
  t: (k: string) => string,
): { label: string; className: string } | null {
  if (work.submission?.state === 'TURNED_IN' || work.submission?.state === 'RETURNED') {
    return {
      label: t('badge.turnedIn'),
      className: 'bg-[var(--jmc-success)]/15 text-[var(--jmc-success)] border border-[var(--jmc-success)]/25',
    }
  }
  if (!work.dueDate) return null
  const { year, month, day } = work.dueDate
  const due = new Date(year, month - 1, day, work.dueTime?.hours ?? 23, work.dueTime?.minutes ?? 59)
  const diffMs = due.getTime() - Date.now()
  if (diffMs < 0) {
    return {
      label: t('badge.overdue'),
      className: 'bg-[var(--jmc-danger)]/15 text-[var(--jmc-danger)] border border-[var(--jmc-danger)]/25 font-medium',
    }
  }
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) {
    return {
      label: t('badge.dueToday'),
      className: 'bg-[var(--jmc-warning)]/20 text-[var(--jmc-warning)] border border-[var(--jmc-warning)]/30 font-semibold',
    }
  }
  if (diffDays === 1) {
    return {
      label: t('badge.dueTomorrow'),
      className: 'bg-[var(--jmc-warning)]/15 text-[var(--jmc-warning)] border border-[var(--jmc-warning)]/25',
    }
  }
  if (diffDays <= 7) {
    return {
      label: `${diffDays} ${t('badge.daysLeft')}`,
      className: 'bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)] border border-[var(--jmc-primary)]/25',
    }
  }
  return null
}
