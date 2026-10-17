import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  Check,
  CircleCheck,
  Clock,
  Cpu,
  DownloadCloud,
  Crown,
  ExternalLink,
  Eye,
  FileCode2,
  Folder,
  FolderOpen,
  Globe,
  GraduationCap,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
  ShieldAlert,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { useI18n } from '../../i18n/i18nContext'
import { useTheme } from '../../themes/ThemeContext'
import { THEMES } from '../../themes/themeConfig'
import {
  Account,
  AiProviderConfig,
  ProviderId,
  SecurityInfo,
  StorageDiagnostics,
  SyncStatus,
  UpdateStatus,
  ThemeName,
  ToolPermissions,
} from '../../types/jmc'
import { ProviderIcon } from '../../components/icons/ProviderIcon'
import { CustomSelect } from '../../components/CustomSelect'

import {
  ACCOUNT_CHANGED_EVENT,
  AUTOSYNC_CHANGED_EVENT,
  PROVIDERS_CHANGED_EVENT,
} from '../../lib/events'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenAbout: () => void
  onOpenAuth?: () => void
  initialTab?: TabId
}

type TabId =
  | 'providers'
  | 'appearance'
  | 'account'
  | 'sync'
  | 'tools'
  | 'language'
  | 'privacy'
  | 'update'

export const VALID_TABS: readonly TabId[] = [
  'providers',
  'appearance',
  'account',
  'sync',
  'tools',
  'language',
  'privacy',
  'update',
] as const

export function sanitizeTab(tab: unknown): TabId {
  if (typeof tab === 'string' && (VALID_TABS as readonly string[]).includes(tab)) {
    return tab as TabId
  }
  return 'providers'
}

type Notice = { tone: 'ok' | 'error'; text: string } | null
type TestResult = { healthy: boolean; latencyMs: number; error?: string }

const DEFAULT_PERMISSIONS: ToolPermissions = {
  webSearch: true,
  workspaceRead: true,
  fileWrite: true,
  classroomDraft: true,
}

const LOCAL_PROVIDER_IDS: ProviderId[] = ['ollama', 'lmstudio', 'llamacpp']

export const PROVIDER_LINKS: Record<string, { keyUrl: string; label: string; guideTr: string; guideEn: string }> = {
  openai: {
    keyUrl: 'https://platform.openai.com/api-keys',
    label: 'OpenAI API Keys',
    guideTr: 'platform.openai.com adresinden API anahtarı edinin.',
    guideEn: 'Get your API key at platform.openai.com.',
  },
  anthropic: {
    keyUrl: 'https://console.anthropic.com/settings/keys',
    label: 'Anthropic Console',
    guideTr: 'console.anthropic.com adresinden Claude API anahtarı edinin.',
    guideEn: 'Get your Claude API key at console.anthropic.com.',
  },
  gemini: {
    keyUrl: 'https://aistudio.google.com/app/apikey',
    label: 'Google AI Studio',
    guideTr: 'aistudio.google.com üzerinden ücretsiz Gemini API anahtarı edinin.',
    guideEn: 'Get your free Gemini API key via aistudio.google.com.',
  },
  groq: {
    keyUrl: 'https://console.groq.com/keys',
    label: 'Groq Cloud',
    guideTr: 'console.groq.com adresinden yüksek hızlı Llama ve gpt-oss modelleri için anahtar edinin.',
    guideEn: 'Get an ultra-fast key from console.groq.com for Llama & gpt-oss models.',
  },
  deepseek: {
    keyUrl: 'https://platform.deepseek.com/api_keys',
    label: 'DeepSeek Platform',
    guideTr: 'platform.deepseek.com üzerinden DeepSeek-R1 ve V3 için anahtar oluşturun.',
    guideEn: 'Create an API key for DeepSeek-R1 and V3 at platform.deepseek.com.',
  },
  xai: {
    keyUrl: 'https://console.x.ai/',
    label: 'xAI Console',
    guideTr: 'console.x.ai adresinden Grok modelleri için API anahtarı edinin.',
    guideEn: 'Get an API key for Grok models from console.x.ai.',
  },
  deepinfra: {
    keyUrl: 'https://deepinfra.com/dash/api_keys',
    label: 'DeepInfra Dash',
    guideTr: 'deepinfra.com üzerinden açık kaynaklı modeller için anahtar edinin.',
    guideEn: 'Get an API key for open-source models at deepinfra.com.',
  },
  ollama: {
    keyUrl: 'https://ollama.com/download',
    label: 'Ollama İndir',
    guideTr: 'ollama.com adresinden indirip kurun. Terminalden "ollama run gemma2" veya "ollama run llama3.3" çalıştırın.',
    guideEn: 'Download from ollama.com. Start your local model with "ollama run gemma2" or "ollama run llama3.3".',
  },
  lmstudio: {
    keyUrl: 'https://lmstudio.ai/',
    label: 'LM Studio (Bionic) İndir',
    guideTr: 'lmstudio.ai uygulamasını kurun, yerel sunucuyu (port 1234) başlatın.',
    guideEn: 'Install lmstudio.ai and start the local server on port 1234.',
  },
  llamacpp: {
    keyUrl: 'https://github.com/ggerganov/llama.cpp',
    label: 'llama.cpp GitHub',
    guideTr: 'llama-server ile port 8080 üzerinde yerel model sunun.',
    guideEn: 'Serve local GGUF models on port 8080 using llama-server.',
  },
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenAbout,
  onOpenAuth,
  initialTab,
}) => {
  const { t, lang, setLang } = useI18n()
  const {
    theme,
    setTheme,
    customColors,
    updateCustomColor,
    resetCustomColors,
    audit,
    reduceMotion,
    setReduceMotion,
    compact,
    setCompact,
  } = useTheme()

  const [tab, setTab] = useState<TabId>(() => sanitizeTab(initialTab))
  const [notice, setNotice] = useState<Notice>(null)
  const noticeTimer = useRef<number | null>(null)

  const flash = useCallback((next: Notice) => {
    setNotice(next)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    if (next) noticeTimer.current = window.setTimeout(() => setNotice(null), 6000)
  }, [])

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    },
    [],
  )

  // Sekme degisince temizlenen durumlar olmasin diye tum panel verileri
  // ust component'te tutulur; hepsi tek seferde yuklenir.
  const [providers, setProviders] = useState<AiProviderConfig[]>([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<ProviderId | null>(null)
  const [tests, setTests] = useState<Record<string, TestResult>>({})
  const [fetchingModels, setFetchingModels] = useState<ProviderId | null>(null)
  const [fetchingAllModels, setFetchingAllModels] = useState(false)

  const [account, setAccount] = useState<Account | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [security, setSecurity] = useState<SecurityInfo | null>(null)
  const [permissions, setPermissions] = useState<ToolPermissions>(DEFAULT_PERMISSIONS)
  const [endpoints, setEndpoints] = useState<Record<string, string>>({})
  const [autoSyncMinutes, setAutoSyncMinutes] = useState(5)
  const [wiping, setWiping] = useState(false)

  // --- Otomatik guncelleme -------------------------------------------------
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [feedDraft, setFeedDraft] = useState('')
  const [updateBusy, setUpdateBusy] = useState(false)

  const api = typeof window !== 'undefined' ? window.jmcAPI : undefined

  const refresh = useCallback(async () => {
    if (!api) return
    setProvidersLoading(true)
    try {
      const [nextProviders, nextAccount, nextSync, nextSecurity, nextPerms] = await Promise.all([
        api.getProviders().catch(() => []),
        api.getAccount().catch(() => null),
        api.getSyncStatus().catch(() => null),
        api.getSecurityInfo().catch(() => null),
        api.getToolPermissions().catch(() => DEFAULT_PERMISSIONS),
      ])
      setProviders(Array.isArray(nextProviders) ? nextProviders : [])
      setAccount(nextAccount ?? null)
      setSyncStatus(nextSync ?? null)
      setSecurity(nextSecurity ?? null)
      if (nextPerms) setPermissions(nextPerms)
      setEndpoints(prev => {
        const map = { ...prev }
        if (Array.isArray(nextProviders)) {
          for (const p of nextProviders) {
            if (LOCAL_PROVIDER_IDS.includes(p.id)) map[p.id] = p.baseUrl
          }
        }
        return map
      })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : 'Ayarlar okunamadı.' })
    } finally {
      setProvidersLoading(false)
    }
    try {
      const minutes = await api.getSetting<number>('autoSyncMinutes', 5)
      setAutoSyncMinutes(typeof minutes === 'number' ? minutes : 5)
    } catch {
      /* varsayilan kalir */
    }
  }, [api, flash])

  useEffect(() => {
    if (!isOpen) return
    setTab(sanitizeTab(initialTab))
    setNotice(null)
    void refresh()
  }, [isOpen, initialTab, refresh])

  // Escape ile kapanir. Disari tiklamak KAPATMAZ (bilerek).
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  /*
    Güncelleme durumu.
    Ana süreç her durum değişikliğinde `update:status` yayınlar;
    burada tek yerden dinleyip forma yansıtıyoruz. Böylece indirme
    ilerlemesi ve hatalar kullanıcı herhangi bir şeye basmadan
    ekranda belirir.
  */
  useEffect(() => {
    if (!isOpen || !api) return
    let cancelled = false
    void api
      .getUpdateStatus()
      .then(s => {
        if (cancelled) return
        setUpdateStatus(s)
        setFeedDraft(s.feedUrl ?? '')
      })
      .catch(() => undefined)
    const off = api.onUpdateStatus?.(s => {
      if (!cancelled) setUpdateStatus(s)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [isOpen, api])

  const handleSaveFeedUrl = useCallback(async () => {
    if (!api) return
    setUpdateBusy(true)
    try {
      const res = await api.setUpdateFeedUrl(feedDraft)
      setUpdateStatus(res.status)
      if (res.ok) {
        flash({
          tone: 'ok',
          text: feedDraft.trim()
            ? 'Yayın adresi kaydedildi.'
            : 'Otomatik güncelleme kapatıldı.',
        })
      } else {
        flash({ tone: 'error', text: res.error ?? 'Adres kaydedilemedi.' })
      }
    } catch (err) {
      flash({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Adres kaydedilemedi.',
      })
    } finally {
      setUpdateBusy(false)
    }
  }, [api, feedDraft, flash])

  const handleCheckUpdate = useCallback(async () => {
    if (!api) return
    setUpdateBusy(true)
    try {
      setUpdateStatus(await api.checkForUpdates())
    } catch (err) {
      flash({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Kontrol başarısız.',
      })
    } finally {
      setUpdateBusy(false)
    }
  }, [api, flash])

  const handleDownloadUpdate = useCallback(async () => {
    if (!api) return
    setUpdateBusy(true)
    try {
      setUpdateStatus(await api.downloadUpdate())
    } finally {
      setUpdateBusy(false)
    }
  }, [api])

  const handleInstallUpdate = useCallback(async () => {
    if (!api) return
    setUpdateBusy(true)
    try {
      await api.installUpdate()
    } finally {
      setUpdateBusy(false)
    }
  }, [api])

  const handleFetchAllModels = useCallback(async () => {
    if (!api || fetchingAllModels) return
    setFetchingAllModels(true)
    try {
      const results = await api.syncAllProviderModels()
      const next = await api.getProviders()
      setProviders(next)
      window.dispatchEvent(
        new CustomEvent(PROVIDERS_CHANGED_EVENT, { detail: { providerId: '*' } }),
      )
      const total = results.reduce((sum, r) => sum + r.count, 0)
      const okCount = results.filter(r => r.count > 0).length
      flash({
        tone: 'ok',
        text: `${okCount} sağlayıcıdan toplam ${total} model güncellendi.`,
      })
    } catch (err) {
      flash({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Modeller alınamadı.',
      })
    } finally {
      setFetchingAllModels(false)
    }
  }, [api, flash, fetchingAllModels])

  const tabs = useMemo(
    () => [
      { id: 'providers' as const, label: t('settings.tab.providers'), icon: Cpu },
      { id: 'appearance' as const, label: t('settings.tab.appearance'), icon: Palette },
      { id: 'account' as const, label: t('settings.tab.accounts'), icon: Server },
      { id: 'sync' as const, label: t('settings.tab.sync'), icon: RefreshCw },
      { id: 'tools' as const, label: t('settings.tab.tools'), icon: Wrench },
      { id: 'language' as const, label: t('settings.tab.language'), icon: Globe },
      { id: 'update' as const, label: t('settings.tab.update'), icon: DownloadCloud },
      { id: 'privacy' as const, label: t('settings.tab.privacy'), icon: Shield },
    ],
    [t],
  )

  if (!isOpen) return null

  const handleSaveKey = async (providerId: ProviderId) => {
    const value = keyDrafts[providerId]
    if (!api || value === undefined) return
    if (!value.trim()) {
      flash({ tone: 'error', text: 'Anahtar boş olamaz.' })
      return
    }
    try {
      await api.saveProviderKey(providerId, value.trim())
      setKeyDrafts(prev => {
        const next = { ...prev }
        delete next[providerId]
        return next
      })

      /*
        ANAHTAR GIRILDI -> MODELLER ANINDA GELSIN.
        Kullanici istemisti: model listesini elle sorgulamak zorunda
        kalmasin. Anahtar yazildigi anda bu saglayicinin model listesi
        cekilir; kullanici "Modelleri sorgula"ya basmadan listeyi
        gorur. Cagirma BASARISIZ olursa hata gosterilmez — yalnizca
        listeye dokunulmaz; gomulu katalog zaten duruyor.
      */
      const models = await api.fetchProviderModels(providerId).catch(() => [])
      if (models.length) {
        setProviders(prev =>
          prev.map(p => (p.id === providerId ? { ...p, models } : p)),
        )
      }

      await refresh()
      window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT, { detail: { providerId } }))
      flash({
        tone: 'ok',
        text: models.length
          ? `Anahtar kaydedildi · ${models.length} model yüklendi.`
          : 'Anahtar kasaya yazıldı.',
      })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : 'Anahtar kaydedilemedi.' })
    }
  }

  const handleDeleteKey = async (providerId: ProviderId) => {
    if (!api) return
    try {
      await api.deleteProviderKey(providerId)
      await refresh()
      window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT, { detail: { providerId } }))
      flash({ tone: 'ok', text: `${providerId} anahtarı kasadan silindi.` })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : 'Anahtar silinemedi.' })
    }
  }

  const handleRemoveProvider = async (providerId: ProviderId) => {
    if (!api) return
    try {
      await api.removeProvider(providerId)
      await refresh()
      window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT, { detail: { providerId } }))
      flash({ tone: 'ok', text: `${providerId} sağlayıcısı silindi.` })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : 'Sağlayıcı silinemedi.' })
    }
  }

  const handleFetchModels = async (providerId: ProviderId) => {
    if (!api) return
    setFetchingModels(providerId)
    try {
      const models = await api.fetchProviderModels(providerId)
      setProviders(prev => prev.map(p => (p.id === providerId ? { ...p, models } : p)))
      window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT, { detail: { providerId } }))
      flash({
        tone: 'ok',
        text: models.length
          ? `${models.length} model listelendi.`
          : 'Sunucu model listesi döndürmedi.',
      })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : 'Modeller alınamadı.' })
    } finally {
      setFetchingModels(null)
    }
  }

  const handleTestConnection = async (providerId: ProviderId) => {
    if (!api) return
    setTesting(providerId)
    try {
      const res = await api.testProviderConnection(providerId)
      setTests(prev => ({ ...prev, [providerId]: res }))
    } catch (err) {
      setTests(prev => ({
        ...prev,
        [providerId]: {
          healthy: false,
          latencyMs: 0,
          error: err instanceof Error ? err.message : 'Bilinmeyen hata',
        },
      }))
    } finally {
      setTesting(null)
    }
  }

  const handleSaveEndpoint = async (providerId: ProviderId) => {
    if (!api) return
    const value = (endpoints[providerId] ?? '').trim()
    try {
      await api.setLocalEndpoint(providerId, value)
      await refresh()
      window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT, { detail: { providerId } }))
      flash({ tone: 'ok', text: `${providerId} adresi güncellendi.` })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : 'Adres kaydedilemedi.' })
    }
  }

  const handleTriggerSync = async () => {
    if (!api) return
    setSyncing(true)
    try {
      const next = await api.syncAll()
      setSyncStatus(next)
      flash({ tone: 'ok', text: 'Senkronizasyon tamamlandı.' })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : 'Senkronizasyon başarısız.' })
      setSyncStatus(await api.getSyncStatus())
    } finally {
      setSyncing(false)
    }
  }

  const handleAutoSyncChange = async (minutes: number) => {
    setAutoSyncMinutes(minutes)
    if (!api) return
    try {
      await api.setSetting('autoSyncMinutes', minutes)
      window.dispatchEvent(new CustomEvent(AUTOSYNC_CHANGED_EVENT, { detail: minutes }))
      flash({
        tone: 'ok',
        text:
          minutes > 0
            ? `Otomatik senkronizasyon her ${minutes} dakikada çalışacak şekilde ayarlandı.`
            : 'Otomatik senkronizasyon yalnızca elle çalışacak şekilde ayarlandı.',
      })
    } catch {
      flash({ tone: 'error', text: 'Aralık kaydedilemedi.' })
    }
  }

  const handlePermissionChange = async (key: keyof ToolPermissions, value: boolean) => {
    if (!api) return
    const previous = permissions
    setPermissions(prev => ({ ...prev, [key]: value }))
    try {
      await api.setToolPermissions({ [key]: value })
    } catch (err) {
      setPermissions(previous)
      flash({ tone: 'error', text: err instanceof Error ? err.message : 'İzin kaydedilemedi.' })
    }
  }

  const handleLogout = async () => {
    if (!api) return
    try {
      await api.logout(false)
      setAccount(null)
      window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT))
      await refresh()
      flash({ tone: 'ok', text: 'Google oturumu kapatıldı.' })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : 'Çıkış yapılamadı.' })
    }
  }

  /**
   * Her seyi sil: oturum, yerel veri, indirilen dosyalar ve kasadaki
   * TUM anahtarlar.
   *
   * Onceki surum `logout(true)` + `wipeLocalCache()` cagriyordu; ancak
   * `vaultService.wipeAllKeys()` HICBIR YERDEN CAGRILMIYORDU. Yani ekran
   * "Yerel veriler ve anahtarlar silindi" dese de OpenAI, Anthropic,
   * Tavily, Brave anahtarlari ve OAuth client secret'i diskte kaliyordu.
   *
   * Ayrica `wipeLocalCache()` cevap vermezse (kullanici diyalogda
   * iptal ederse) onceki surum yine de "silindi" diye bildiriyordu.
   * Artik `wipeEverything` tek bir dogrulanmis islem yapar ve iptal
   * durumunda acikca bildirir.
   */
const handleWipe = async () => {
    if (!api) return
    setWiping(true)
    try {
      const ok = await api.wipeEverything()
      if (!ok) {
        flash({ tone: 'error', text: 'Silme işlemi iptal edildi. Hiçbir veri silinmedi.' })
        return
      }
      setAccount(null)
      window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT))
      await refresh()
      flash({
        tone: 'ok',
        text: 'Oturum, yerel veriler, indirilen dosyalar ve kasadaki tüm anahtarlar silindi.',
      })
    } catch (err) {
      flash({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Temizlik sırasında bir hata oluştu.',
      })
    } finally {
      setWiping(false)
    }
  }

  const activeTab = sanitizeTab(tab)

  return (
    // Kullanıcı talebi: Boşluğa (backdrop) tıklayınca kapanır.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 backdrop-blur-[3px] p-6 transition-all duration-200 animate-fade-in"
    >
      <div className="flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-elevated)] border border-[var(--jmc-border)] shadow-[var(--jmc-shadow-lg)] animate-pop-in">
        <div className="flex min-h-0 flex-1">
          {/* Sol gezinme */}
          <nav
            aria-label="Ayar bölümleri"
            className="hidden w-56 shrink-0 flex-col justify-between bg-[var(--jmc-bg)] p-3 sm:flex"
          >
            <div>
              <p className="px-2.5 pb-2 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--jmc-text-dim)]">
                {t('settings.title')}
              </p>
              <ul className="space-y-0.5">
                {tabs.map(item => {
                  const Icon = item.icon
                  const active = activeTab === item.id
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setTab(item.id)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex w-full items-center gap-2.5 rounded-[var(--jmc-radius)] px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                          active
                            ? 'bg-[var(--jmc-bg-surface)] font-medium text-[var(--jmc-primary)] shadow-[var(--jmc-shadow-sm)]'
                            : 'text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose()
                onOpenAbout()
              }}
              className="flex items-center gap-2 rounded-[var(--jmc-radius)] px-2.5 py-2 text-left text-[12px] text-[var(--jmc-text-dim)] transition-colors hover:text-[var(--jmc-text)]"
            >
              <Info className="h-4 w-4 shrink-0" />
              {t('nav.about')}
              <ExternalLink className="ml-auto h-3 w-3" />
            </button>
          </nav>

          {/* İçerik */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between gap-3 px-6 pb-3 pt-5">
              <h2 className="text-[15px] font-semibold tracking-tight">
                {tabs.find(x => x.id === activeTab)?.label || tabs[0].label}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('settings.cancel')}
                className="rounded-[var(--jmc-radius)] p-1.5 text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {/* Mobil sekme şeridi */}
            <div className="flex gap-1 overflow-x-auto px-6 pb-3 sm:hidden">
              {tabs.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`shrink-0 rounded-[var(--jmc-radius)] px-2.5 py-1 text-[11.5px] ${
                    activeTab === item.id
                      ? 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-primary)]'
                      : 'text-[var(--jmc-text-muted)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {notice && (
              <div
                role="status"
                className={`mx-6 mb-3 flex items-start gap-2 rounded-[var(--jmc-radius)] px-3 py-2 text-[11.5px] ${
                  notice.tone === 'ok'
                    ? 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-success)]'
                    : 'bg-[var(--jmc-badge-bg)] text-[var(--jmc-warning)]'
                }`}
              >
                {notice.tone === 'ok' ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span>{notice.text}</span>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {activeTab === 'providers' && (
                <ProvidersPanel
                  providers={providers}
                  loading={providersLoading}
                  keyDrafts={keyDrafts}
                  tests={tests}
                  testing={testing}
                  fetchingModels={fetchingModels}
                  endpoints={endpoints}
                  onKeyChange={(id, value) => setKeyDrafts(prev => ({ ...prev, [id]: value }))}
                  onSaveKey={handleSaveKey}
                  onDeleteKey={handleDeleteKey}
                  onRemoveProvider={handleRemoveProvider}
                  onFetchModels={handleFetchModels}
                  onFetchAllModels={handleFetchAllModels}
                  fetchingAllModels={fetchingAllModels}
                  onTest={handleTestConnection}
                  onEndpointChange={(id, value) => setEndpoints(prev => ({ ...prev, [id]: value }))}
                  onSaveEndpoint={handleSaveEndpoint}
                  onRefresh={refresh}
                  lang={lang}
                />
              )}

              {activeTab === 'appearance' && (
                <AppearancePanel
                  theme={theme}
                  onTheme={setTheme}
                  customColors={customColors}
                  onCustomColor={updateCustomColor}
                  onResetCustom={resetCustomColors}
                  audit={audit}
                  reduceMotion={reduceMotion}
                  onReduceMotion={setReduceMotion}
                  compact={compact}
                  onCompact={setCompact}
                />
              )}

              {activeTab === 'account' && (
                <AccountPanel account={account} onLogin={onOpenAuth} onLogout={handleLogout} lang={lang} />
              )}

              {activeTab === 'sync' && (
                <SyncPanel
                  status={syncStatus}
                  syncing={syncing}
                  autoSyncMinutes={autoSyncMinutes}
                  onAutoSyncChange={handleAutoSyncChange}
                  onSync={handleTriggerSync}
                />
              )}

              {activeTab === 'tools' && (
                <ToolsPanel
                  permissions={permissions}
                  onChange={handlePermissionChange}
                  onRefresh={async () => {
                    if (api) {
                      const p = await api.getToolPermissions()
                      setPermissions(p)
                      await refresh()
                    }
                  }}
                  vaultCount={security?.vault.storedKeyCount ?? 0}
                />
              )}

              {activeTab === 'language' && <LanguagePanel lang={lang} onLang={setLang} />}

              {activeTab === 'update' && (
                <UpdatePanel
                  lang={lang}
                  status={updateStatus}
                  feedDraft={feedDraft}
                  busy={updateBusy}
                  onFeedChange={setFeedDraft}
                  onSaveFeed={handleSaveFeedUrl}
                  onCheck={handleCheckUpdate}
                  onDownload={handleDownloadUpdate}
                  onInstall={handleInstallUpdate}
                />
              )}

              {activeTab === 'privacy' && (
                <PrivacyPanel security={security} wiping={wiping} onWipe={handleWipe} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Paneller                                                            */
/* ================================================================== */

/**
 * Otomatik guncelleme paneli.
 *
 * KULLANICI TALEBI
 * ----------------
 * "Guncel surum icin durmadan dosya tasimakla mi ugrasacam?"
 *
 * CEVAP
 * -----
 * Tek kurulum dosyasi + bir yayin adresi yeter. Adres bir kez
 * yazilir; uygulama her acilista kontrol eder ve yeni surum varsa
 * tek tikla guncellenir.
 *
 * ADRES NEREDEN?
 * ---------------
 * Uygulamanin gelistiricisi surum dosyalarini (`latest.yml` ve
 * `JustMyClass-Setup-*.exe`) bir klasore yukler ve o klasorun
 * adresini buraya yazarsiniz. GitHub Releases, Netlify, bir S3
 * kovasi veya kendi sunucunuz olabilir; hepsi calisir.
 *
 * NEDEN HTTPS ZORUNLU?
 * --------------------
 * Guncellenen dosya degistirilebilirse birisi kullaniciya sahte bir
 * surum sunabilir. Electron bu yuzden sifresiz adresleri reddeder.
 */
const UpdatePanel: React.FC<{
  lang: 'tr' | 'en'
  status: UpdateStatus | null
  feedDraft: string
  busy: boolean
  onFeedChange: (v: string) => void
  onSaveFeed: () => void
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
}> = ({
  lang,
  status,
  feedDraft,
  busy,
  onFeedChange,
  onSaveFeed,
  onCheck,
  onDownload,
  onInstall,
}) => {
  const stage = status?.stage ?? 'idle'
  const tr = lang === 'tr'

  const stateLine = (): { tone: 'ok' | 'error' | 'idle'; text: string } => {
    if (!status)
      return { tone: 'idle', text: tr ? 'Durum bilinmiyor.' : 'Status unknown.' }
    switch (stage) {
      case 'disabled':
        return {
          tone: 'idle',
          text: tr
            ? 'Otomatik güncelleme kapalı. Aşağıya yayın adresini yazın.'
            : 'Auto-update is off. Enter your feed URL below.',
        }
      case 'checking':
        return { tone: 'idle', text: tr ? 'Sunucu sorgulanıyor…' : 'Checking server…' }
      case 'available':
        return {
          tone: 'ok',
          text: tr
            ? `Sürüm ${status.availableVersion} hazır.`
            : `Version ${status.availableVersion} is ready.`,
        }
      case 'not-available':
        return {
          tone: 'ok',
          text: tr
            ? `Uygulama güncel (${status.currentVersion}).`
            : `Up to date (${status.currentVersion}).`,
        }
      case 'downloading':
        return {
          tone: 'idle',
          text: tr
            ? `İndiriliyor… %${status.progress ?? 0}${
                status.totalMb ? ` (${status.transferredMb}/${status.totalMb} MB)` : ''
              }`
            : `Downloading… ${status.progress ?? 0}%`,
        }
      case 'downloaded':
        return {
          tone: 'ok',
          text: tr
            ? 'İndirme tamamlandı. Kurmak için uygulamayı yeniden başlatın.'
            : 'Download complete. Restart to install.',
        }
      case 'error':
        return { tone: 'error', text: status.error ?? (tr ? 'Bilinmeyen hata.' : 'Unknown error.') }
      default:
        return {
          tone: 'idle',
          text: tr ? 'Henüz kontrol edilmedi.' : 'Not checked yet.',
        }
    }
  }

  const line = stateLine()
  const lineClass =
    line.tone === 'ok'
      ? 'text-[var(--jmc-success)]'
      : line.tone === 'error'
        ? 'text-[var(--jmc-danger)]'
        : 'text-[var(--jmc-text-dim)]'

  return (
    <div className="space-y-4">
      <article className="rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] p-4 shadow-[var(--jmc-shadow-sm)] border border-[var(--jmc-border-subtle)]">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[13.5px] font-semibold">
              {tr ? 'Uygulama sürümü' : 'Application version'}
            </h3>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--jmc-text-dim)]">
              v{status?.currentVersion ?? '—'}
            </p>
          </div>
          {stage === 'available' ? (
            <SmallButton onClick={onDownload} disabled={busy}>
              {tr ? 'İndir' : 'Download'}
            </SmallButton>
          ) : stage === 'downloaded' ? (
            <SmallButton onClick={onInstall} disabled={busy}>
              {tr ? 'Kur ve yeniden başlat' : 'Install & restart'}
            </SmallButton>
          ) : (
            <SmallButton
              onClick={onCheck}
              disabled={busy || !status?.configured}
              icon={stage === 'checking' ? <Loader2 className="h-3 w-3 animate-spin" /> : undefined}
            >
              {tr ? 'Şimdi kontrol et' : 'Check now'}
            </SmallButton>
          )}
        </header>

        <p className={`mt-2.5 text-[11.5px] leading-relaxed ${lineClass}`} role="status">
          {line.text}
        </p>

        {stage === 'downloading' && typeof status?.progress === 'number' && (
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--jmc-bg)]"
            role="progressbar"
            aria-valuenow={status.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-[var(--jmc-primary)] transition-[width] duration-200 ease-[var(--jmc-ease)]"
              style={{ width: `${Math.max(2, status.progress)}%` }}
            />
          </div>
        )}

        {status?.availableVersion && stage === 'available' && (
          <p className="mt-1.5 text-[11px] text-[var(--jmc-text-dim)]">
            {tr ? 'Yeni sürüm' : 'New version'}: <code>{status.availableVersion}</code>
            {status.releaseDate ? ` · ${new Date(status.releaseDate).toLocaleDateString('tr-TR')}` : ''}
          </p>
        )}
      </article>

      <article className="rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] p-4 shadow-[var(--jmc-shadow-sm)] border border-[var(--jmc-border-subtle)]">
        <h3 className="text-[13.5px] font-semibold">
          {tr ? 'Yayın adresi (güncelleme kaynağı)' : 'Feed URL (update source)'}
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
          {tr
            ? 'Uygulama açılışta ve denetleme yapıldığında GitHub Releases (MrSpy00/JustMyClass) üzerindeki en güncel sürümleri kontrol eder. İsteğe bağlı olarak kendi özel güncelleme sunucunuzun HTTPS adresini de girebilirsiniz.'
            : 'The app checks for new versions via GitHub Releases (MrSpy00/JustMyClass). Optionally, you can specify a custom HTTPS feed address.'}
        </p>
        <div className="mt-2.5 flex flex-col gap-1.5 sm:flex-row">
          <input
            value={feedDraft}
            onChange={e => onFeedChange(e.target.value)}
            placeholder="https://…"
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            aria-label={tr ? 'Yayın adresi' : 'Feed URL'}
            className="min-w-0 flex-1 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--jmc-text)] outline-none border border-[var(--jmc-border)] focus:border-[var(--jmc-primary)]"
          />
          <SmallButton onClick={onSaveFeed} disabled={busy}>
            {tr ? 'Kaydet' : 'Save'}
          </SmallButton>
        </div>
      </article>
    </div>
  )
}

interface ProvidersPanelProps {
  providers: AiProviderConfig[]
  loading: boolean
  keyDrafts: Record<string, string>
  tests: Record<string, TestResult>
  testing: ProviderId | null
  fetchingModels: ProviderId | null
  endpoints: Record<string, string>
  onKeyChange: (id: ProviderId, value: string) => void
  onSaveKey: (id: ProviderId) => void
  onDeleteKey: (id: ProviderId) => void
  onRemoveProvider: (id: ProviderId) => void
  onFetchModels: (id: ProviderId) => void
  /** Tum saglayicilarin model listesini tek seferde tazeler. */
  onFetchAllModels?: () => Promise<void>
  fetchingAllModels?: boolean
  onTest: (id: ProviderId) => void
  onEndpointChange: (id: ProviderId, value: string) => void
  onSaveEndpoint: (id: ProviderId) => void
  onRefresh: () => Promise<void>
  lang: 'tr' | 'en'
}

const ProvidersPanel: React.FC<ProvidersPanelProps> = ({
  providers,
  loading,
  keyDrafts,
  tests,
  testing,
  fetchingModels,
  onFetchAllModels,
  fetchingAllModels,
  endpoints,
  onKeyChange,
  onSaveKey,
  onDeleteKey,
  onRemoveProvider,
  onFetchModels,
  onTest,
  onEndpointChange,
  onSaveEndpoint,
  onRefresh,
  lang,
}) => {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ id: '', displayName: '', baseUrl: '', isLocal: false })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const submit = async () => {
    if (!window.jmcAPI) return
    setSaving(true)
    setFormError(null)
    try {
      await window.jmcAPI.saveCustomProvider({
        id: draft.id.trim() || undefined,
        displayName: draft.displayName.trim() || undefined,
        baseUrl: draft.baseUrl.trim(),
        isLocal: draft.isLocal,
        protocolType: 'openai',
      })
      setDraft({ id: '', displayName: '', baseUrl: '', isLocal: false })
      setAdding(false)
      await onRefresh()
      window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : (lang === 'tr' ? 'Sağlayıcı kaydedilemedi.' : 'Provider could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-xl text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
          {lang === 'tr'
            ? 'Model listeleri uygulama açılışında otomatik olarak, doğrudan sağlayıcının kendi sunucusundan çekilir — gömülü ve bayat bir liste yoktur. Anahtarınız işletim sistemi kasasında saklanır; arayüze hiçbir zaman geri döndürülemez biçimde aktarılmaz.'
            : 'Model lists are fetched automatically on startup, live from each provider. No embedded, stale list. Your key stays in the OS keychain and is never sent back to the UI.'}
        </p>
        <SmallButton
          onClick={() => void onFetchAllModels?.()}
          disabled={fetchingAllModels}
          icon={
            fetchingAllModels ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )
          }
        >
          {lang === 'tr' ? 'Tümünü tazele' : 'Refresh all'}
        </SmallButton>
      </div>

      {loading && providers.length === 0 && (
        <p className="text-[12px] text-[var(--jmc-text-dim)]">{lang === 'tr' ? 'Yükleniyor...' : 'Loading...'}</p>
      )}

      {providers.map(p => {
        const test = tests[p.id]
        // Gömülü mü özel mi, veriden okunur. Arayüzün sağlayıcı
        // kimliklerinin kendi listesini tutması iki listesin ayrılmasına
        // yol açıyordu: yeni gömülü bir sağlayıcı eklendiğinde burada
        // "ÖZEL" görünüp silinebilir hâle geliyordu.
        const isCustom = p.builtin === false
                const isLocal = LOCAL_PROVIDER_IDS.includes(p.id)

        /*
          Anahtar alma adresi.
          Önce ana süreçte tanımlı `keyUrl` (tüm gömülü sağlayıcılarda
          var), yoksa eski tablo. `PROVIDER_LINKS` yalnızca 10 sağlayıcıyı
          kapsıyordu; yeni eklenen sağlayıcılarda rehber metni hiç
          görünmüyordu.
        */
        const localLink = PROVIDER_LINKS[p.id]
        const keyUrl = p.keyUrl ?? localLink?.keyUrl
        const linkInfo = keyUrl
          ? {
              keyUrl,
              label: localLink?.label ?? p.displayName,
              guideTr:
                localLink?.guideTr ??
                `${p.displayName} API anahtarını aşağıdaki resmî adresten edinin ve kutuya yapıştırın.`,
              guideEn:
                localLink?.guideEn ??
                `Get a ${p.displayName} API key from the official link below and paste it here.`,
            }
          : undefined
        return (
          <article
            key={p.id}
            className="rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] p-4 shadow-[var(--jmc-shadow-sm)] border border-[var(--jmc-border-subtle)] transition-all hover:border-[var(--jmc-border)]"
          >
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ProviderIcon
                    brand={p.brand}
                    displayName={p.displayName}
                    size={20}
                    className="shrink-0 rounded-[5px]"
                  />
                  <h3 className="text-[13.5px] font-semibold">{p.displayName}</h3>
                  {isLocal && (
                    <span className="rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-badge-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--jmc-primary)]">
                      {lang === 'tr' ? 'YEREL' : 'LOCAL'}
                    </span>
                  )}
                  {isCustom && (
                    <span className="rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-badge-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--jmc-text-muted)]">
                      {lang === 'tr' ? 'ÖZEL' : 'CUSTOM'}
                    </span>
                  )}
                  <code className="font-mono text-[10.5px] text-[var(--jmc-text-dim)]">{p.id}</code>
                </div>
                <p className="mt-1 break-all font-mono text-[10.5px] text-[var(--jmc-text-dim)]">
                  {p.baseUrl}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <SmallButton
                  onClick={() => onFetchModels(p.id)}
                  disabled={fetchingModels === p.id}
                  icon={fetchingModels === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : undefined}
                >
                  {lang === 'tr' ? 'Modelleri sorgula' : 'Fetch models'}
                </SmallButton>
                <SmallButton
                  onClick={() => onTest(p.id)}
                  disabled={testing === p.id}
                  icon={testing === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : undefined}
                >
                  {lang === 'tr' ? 'Bağlantı testi' : 'Test connection'}
                </SmallButton>
                {isCustom && (
                  <SmallButton
                    onClick={() => onRemoveProvider(p.id)}
                    danger
                    icon={<Trash2 className="h-3 w-3" />}
                  >
                    {lang === 'tr' ? 'Sil' : 'Delete'}
                  </SmallButton>
                )}
              </div>
            </header>

            {/* Sağlayıcı API Anahtarı Alma ve Kurulum Rehberi */}
            {linkInfo && (
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)]/75 px-3 py-2 border border-[var(--jmc-border-subtle)] text-[11px]">
                <span className="text-[var(--jmc-text-muted)] leading-relaxed">
                  {lang === 'tr' ? linkInfo.guideTr : linkInfo.guideEn}
                </span>
                <button
                  type="button"
                  onClick={() => void window.jmcAPI?.openExternalUrl(linkInfo.keyUrl)}
                  className="inline-flex items-center gap-1.5 font-medium text-[var(--jmc-primary)] hover:underline shrink-0"
                >
                  <span>
                    {isLocal
                      ? (lang === 'tr' ? 'Resmi Sayfa & İndir' : 'Official Site & Download')
                      : (lang === 'tr' ? 'API Anahtarı Al' : 'Get API Key')}
                  </span>
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Gizlilik notu */}
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
              {p.privacyNotice}
            </p>

            {test && (
              <p
                className={`mt-2.5 font-mono text-[11px] ${
                  test.healthy ? 'text-[var(--jmc-success)]' : 'text-[var(--jmc-warning)]'
                }`}
              >
                {test.healthy
                  ? `${lang === 'tr' ? 'bağlantı başarılı' : 'connection healthy'} · ${test.latencyMs} ms`
                  : `${lang === 'tr' ? 'hata:' : 'error:'} ${test.error ?? (lang === 'tr' ? 'bilinmeyen' : 'unknown')}`}
              </p>
            )}

            {/* Yerel sunucu adresi */}
            {isLocal && (
              <div className="mt-3 flex items-center gap-2">
                <label htmlFor={`ep-${p.id}`} className="sr-only">
                  {p.displayName} {lang === 'tr' ? 'adresi' : 'endpoint'}
                </label>
                <input
                  id={`ep-${p.id}`}
                  type="text"
                  spellCheck={false}
                  value={endpoints[p.id] ?? ''}
                  onChange={e => onEndpointChange(p.id, e.target.value)}
                  className="min-w-0 flex-1 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--jmc-text)] outline-none border border-[var(--jmc-border)] focus:border-[var(--jmc-primary)]"
                />
                <SmallButton onClick={() => onSaveEndpoint(p.id)}>
                  {lang === 'tr' ? 'Kaydet' : 'Save'}
                </SmallButton>
              </div>
            )}

            {/* API anahtarı */}
            {!p.isLocal && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label htmlFor={`key-${p.id}`} className="sr-only">
                  {p.displayName} {lang === 'tr' ? 'API anahtarı' : 'API key'}
                </label>
                <input
                  id={`key-${p.id}`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={p.maskedKey ? `${lang === 'tr' ? 'kayıtlı: ' : 'stored: '}${p.maskedKey}` : (lang === 'tr' ? 'API anahtarı' : 'API key')}
                  value={keyDrafts[p.id] ?? ''}
                  onChange={e => onKeyChange(p.id, e.target.value)}
                  className="min-w-0 flex-1 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--jmc-text)] outline-none border border-[var(--jmc-border)] focus:border-[var(--jmc-primary)]"
                />
                <SmallButton onClick={() => onSaveKey(p.id)}>
                  {lang === 'tr' ? 'Kaydet' : 'Save'}
                </SmallButton>
                {p.hasKey && (
                  <SmallButton onClick={() => onDeleteKey(p.id)} danger icon={<Trash2 className="h-3 w-3" />}>
                    {lang === 'tr' ? 'Anahtarı sil' : 'Delete key'}
                  </SmallButton>
                )}
              </div>
            )}

            {/* Modeller */}
            {p.models.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1">
                {p.models.map(m => (
                  <li
                    key={m.id}
                    className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg)] px-2 py-0.5 text-[10.5px] text-[var(--jmc-text-muted)] border border-[var(--jmc-border-subtle)]"
                    title={`Bağlam: ${m.contextWindow?.toLocaleString('tr-TR')} · Çıktı: ${m.maxOutputTokens?.toLocaleString('tr-TR') || 'Standart'}`}
                  >
                    <span>{m.name}</span>
                    {/*
                      Yetenek rozetleri.
                      Onceki surumde duz metin EMOJI kullaniliyordu
                      (⭐ 📷 ⚡ 🧠). Emojiler isletim sistemi fontuna
                      bagli oldugu icin koyu temada kontrastlari
                      tutarsizdi ve kucuk boyutta okunmuyordu. Simdi
                      hepsi gercek SVG ikon ve her biri kendi rengine
                      sahip; renk AYNI zamanda anlam tasidir.
                    */}
                    <span className="flex items-center gap-1">
                      {m.isDefault && (
                        <Crown
                          className="h-3 w-3 text-[var(--jmc-warning)]"
                          aria-label="Varsayılan"
                        />
                      )}
                      {m.supportsReasoning && (
                        <Brain
                          className="h-3 w-3 text-[var(--jmc-accent)]"
                          aria-label="Akıl yürütme"
                        />
                      )}
                      {m.supportsTools && (
                        <Zap
                          className="h-3 w-3 text-[var(--jmc-success)]"
                          aria-label="Araç çağırma"
                        />
                      )}
                      {m.supportsVision && (
                        <Eye
                          className="h-3 w-3 text-[var(--jmc-warning)]"
                          aria-label="Görsel ve PDF girdisi"
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[11px] text-[var(--jmc-text-dim)]">
                {lang === 'tr'
                  ? 'Model listesi henüz çekilmedi. Uygulama açılışında otomatik olarak alınır; gerekirse "Modelleri sorgula" ile elle yenileyebilirsiniz.'
                  : 'Model list not fetched yet. It loads automatically on startup; use "Fetch models" to refresh manually.'}
              </p>
            )}
          </article>
        )
      })}

      {/* Yeni sağlayıcı ekleme */}
      <div className="rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] p-4 shadow-[var(--jmc-shadow-sm)]">
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--jmc-primary)] hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            Özel sağlayıcı ekle
          </button>
        ) : (
          <div className="space-y-2.5">
            <h3 className="text-[12.5px] font-medium">Özel uç nokta</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field
                id="np-id"
                label="Kimlik"
                placeholder="ör. vllm-okul"
                value={draft.id}
                onChange={v => setDraft({ ...draft, id: v })}
              />
              <Field
                id="np-name"
                label="Görünen ad"
                placeholder="ör. Okul sunucusu"
                value={draft.displayName}
                onChange={v => setDraft({ ...draft, displayName: v })}
              />
            </div>
            <Field
              id="np-url"
              label="Taban adres"
              placeholder="https://..."
              value={draft.baseUrl}
              onChange={v => setDraft({ ...draft, baseUrl: v })}
              mono
            />
            <label className="flex items-center gap-2 text-[11.5px] text-[var(--jmc-text-muted)]">
              <input
                type="checkbox"
                checked={draft.isLocal}
                onChange={e => setDraft({ ...draft, isLocal: e.target.checked })}
                className="accent-[var(--jmc-primary)]"
              />
              Bu sunucu bu cihazda yerel çalışıyor
            </label>
            {formError && (
              <p className="text-[11.5px] text-[var(--jmc-warning)]">{formError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={saving || !draft.baseUrl.trim()}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3 py-1.5 text-[11.5px] font-medium text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                Ekle
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false)
                  setFormError(null)
                }}
                className="rounded-[var(--jmc-radius)] px-3 py-1.5 text-[11.5px] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]"
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface AppearancePanelProps {
  theme: ThemeName
  onTheme: (name: ThemeName) => void
  customColors: import('../../types/jmc').ThemeColors
  onCustomColor: (key: keyof import('../../types/jmc').ThemeColors, value: string) => void
  onResetCustom: () => void
  audit: ReturnType<typeof useTheme>['audit']
  reduceMotion: boolean
  onReduceMotion: (v: boolean) => void
  compact: boolean
  onCompact: (v: boolean) => void
}

const AppearancePanel: React.FC<AppearancePanelProps> = ({
  theme,
  onTheme,
  customColors,
  onCustomColor,
  onResetCustom,
  audit,
  reduceMotion,
  onReduceMotion,
  compact,
  onCompact,
}) => {
  // Kontrast rozeti SABIT bir sayi degil; secili temanin olculmus oranidir.
  const summary = [
    { label: 'Gövde', report: audit.body },
    { label: 'İkincil', report: audit.muted },
    { label: 'Soluk', report: audit.dim },
    { label: 'Vurgu', report: audit.primaryOnBg },
  ]

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[12.5px] font-medium">Tema</h3>
          <p className="text-[11px] text-[var(--jmc-text-dim)]">
            Kontrast değerleri seçili tema için hesaplanır (WCAG 2.x formülü).
          </p>
        </div>

        <div className="overflow-hidden rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)]">
          <div className="grid grid-cols-2 gap-px bg-[var(--jmc-border-subtle)] sm:grid-cols-4">
            {summary.map(s => {
              const level = s.report.aaa ? 'AAA' : s.report.aa ? 'AA' : s.report.aaLarge ? 'AA büyük' : 'düşük'
              const tone = s.report.aa
                ? 'text-[var(--jmc-success)]'
                : s.report.aaLarge
                  ? 'text-[var(--jmc-warning)]'
                  : 'text-[var(--jmc-danger)]'
              return (
                <div key={s.label} className="bg-[var(--jmc-bg-surface)] px-3 py-2">
                  <div className="text-[10.5px] uppercase tracking-wide text-[var(--jmc-text-dim)]">
                    {s.label}
                  </div>
                  <div className={`mt-0.5 font-mono text-[13px] ${tone}`}>
                    {s.report.ratio.toFixed(2)}:1
                  </div>
                  <div className="text-[10.5px] text-[var(--jmc-text-dim)]">{level}</div>
                </div>
              )
            })}
          </div>
        </div>

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(THEMES) as ThemeName[]).map(name => {
            const c = THEMES[name]
            const active = theme === name
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => onTheme(name)}
                  aria-pressed={active}
                  className={`w-full rounded-[var(--jmc-radius)] px-3 py-2.5 text-left transition-shadow ${
                    active ? 'shadow-[var(--jmc-shadow-md)]' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c.bg, boxShadow: active ? `inset 0 0 0 1.5px ${c.primary}` : undefined }}
                >
                  <span className="block text-[11.5px] font-medium" style={{ color: c.text }}>
                    {name}
                  </span>
                  <span className="mt-1.5 flex gap-1">
                    {[c.primary, c.accent, c.bgSurface, c.textMuted].map((col, i) => (
                      <span
                        key={i}
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: col, boxShadow: `inset 0 0 0 1px ${c.elevation}` }}
                      />
                    ))}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-2.5">
        <h3 className="text-[12.5px] font-medium">Okuma konforu</h3>
        <ToggleRow
          label="Yoğun düzen"
          description="Satır aralığını ve panel boşluklarını daraltır."
          checked={compact}
          onChange={onCompact}
        />
        <ToggleRow
          label="Animasyonları azalt"
          description="Geçiş ve yüklenme animasyonlarını kapatır."
          checked={reduceMotion}
          onChange={onReduceMotion}
        />
      </section>

      {theme === 'Custom' && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[12.5px] font-medium">Özel renkler</h3>
            <button
              type="button"
              onClick={onResetCustom}
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]"
            >
              <RotateCcw className="h-3 w-3" />
              Varsayılanlara dön
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {(
              [
                ['bg', 'Arka plan'],
                ['bgSurface', 'Yüzey'],
                ['text', 'Metin'],
                ['primary', 'Vurgu'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label
                  htmlFor={`cc-${key}`}
                  className="mb-1 block text-[10.5px] text-[var(--jmc-text-dim)]"
                >
                  {label}
                </label>
                <input
                  id={`cc-${key}`}
                  type="color"
                  value={customColors[key]}
                  onChange={e => onCustomColor(key, e.target.value)}
                  className="h-8 w-full cursor-pointer rounded-[var(--jmc-radius-sm)] bg-transparent"
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

const AccountPanel: React.FC<{
  account: Account | null
  onLogin?: () => void
  onLogout: () => Promise<void>
  lang: 'tr' | 'en'
}> = ({ account, onLogin, onLogout, lang }) => {
  const { t } = useI18n()
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecretState] = useState('')
  const [saved, setSaved] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [clientValidation, setClientValidation] = useState<{
    valid: boolean
    activeClientId: string
    isCustom?: boolean
    hasClientSecret?: boolean
    isPlaceholder: boolean
    error?: string
  } | null>(null)

  const [importStatus, setImportStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.jmcAPI?.getClientId().then(savedId => {
      if (!cancelled && savedId) setClientId(savedId)
    })
    void window.jmcAPI?.validateClientId().then(val => {
      if (!cancelled) setClientValidation(val)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handlePickFile = async () => {
    if (!window.jmcAPI) return
    try {
      const res = await window.jmcAPI.pickAndImportCredentialsFile()
      if (!res || !res.success) {
        if (res?.error && res.error !== 'Dosya seçilmedi.') {
          setImportStatus(`Hata: ${res.error}`)
          setTimeout(() => setImportStatus(null), 4000)
        }
        return
      }
      if (res.clientId) {
        setClientId(res.clientId)
        setClientSecretState('')
        const val = await window.jmcAPI.validateClientId(res.clientId)
        setClientValidation(val)
      }
      setImportStatus('JSON kimlik dosyası (Client ID & Secret) başarıyla içe aktarıldı.')
      setTimeout(() => setImportStatus(null), 3000)
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : 'Dosya okunamadı.')
      setTimeout(() => setImportStatus(null), 4000)
    }
  }

  const handleSaveClient = async () => {
    if (!window.jmcAPI) return
    await window.jmcAPI.setClientId(clientId.trim())
    if (clientSecret.trim() && window.jmcAPI.setClientSecret) {
      await window.jmcAPI.setClientSecret(clientSecret.trim())
      setClientSecretState('')
    }
    const val = await window.jmcAPI.validateClientId(clientId.trim())
    setClientValidation(val)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleResetToDefault = async () => {
    if (!window.jmcAPI) return
    if (window.jmcAPI.resetCustomClient) {
      await window.jmcAPI.resetCustomClient()
    } else {
      await window.jmcAPI.setClientId('')
    }
    const defaultId = await window.jmcAPI.getClientId()
    setClientId(defaultId || '')
    setClientSecretState('')
    const val = await window.jmcAPI.validateClientId('')
    setClientValidation(val)
    setImportStatus(
      lang === 'tr'
        ? 'Varsayılan resmi masaüstü istemcisine (.env) sıfırlandı.'
        : 'Reset to default desktop client (.env).',
    )
    setTimeout(() => setImportStatus(null), 3000)
  }

  return (
    <div className="space-y-6">
      {!account ? (
        <div className="rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] p-4 border border-[var(--jmc-border-subtle)] space-y-3">
          <p className="text-[12.5px] text-[var(--jmc-text-muted)]">
            {t('settings.accounts.notConnected')}
          </p>
          <button
            type="button"
            onClick={onLogin}
            disabled={!onLogin}
            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3.5 py-2 text-[12px] font-medium text-white transition-all hover:bg-[var(--jmc-primary-hover)] active:scale-95 disabled:opacity-50"
          >
            <LogIn className="h-3.5 w-3.5" />
            {t('welcome.connectGoogle')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {account.photoUrl ? (
              <img
                src={account.photoUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--jmc-badge-bg)] text-[12px] font-medium text-[var(--jmc-primary)]">
                {(account.displayName || account.email).slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium">
                {account.displayName || 'Google kullanıcısı'}
              </p>
              <p className="truncate font-mono text-[11px] text-[var(--jmc-text-muted)]">
                {account.email}
              </p>
              {account.institution && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--jmc-primary)] font-medium">
                  <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                  <span>{account.institution}</span>
                  {account.hostedDomain && (
                    <span className="rounded bg-[var(--jmc-bg)] px-1.5 py-0.5 text-[9.5px] font-mono text-[var(--jmc-text-dim)] border border-[var(--jmc-border-subtle)]">
                      {account.hostedDomain}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg-surface)] px-2 py-1 text-[11px] text-[var(--jmc-text-muted)]">
                {account.role === 'TEACHER' ? 'Öğretmen' : 'Öğrenci'}
              </span>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] px-2.5 py-1.5 text-[11.5px] text-[var(--jmc-text-muted)] transition-colors hover:text-[var(--jmc-text)]"
              >
                <LogOut className="h-3.5 w-3.5" />
                Oturumu kapat
              </button>
            </div>
          </div>

          <section>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--jmc-text-dim)]">
              {t('settings.accounts.permissions')}
            </h3>
            <ul className="space-y-0.5">
              {account.grantedScopes.map(scope => (
                <li
                  key={scope}
                  className="break-all font-mono text-[10.5px] text-[var(--jmc-text-muted)]"
                >
                  {scope}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
              {t('settings.accounts.tokenNotice')}
            </p>
          </section>
        </div>
      )}

      {/* Google Cloud Desktop Client ID & Secret Ayarları & Rehberi */}
      <section className="rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-surface)] p-4 border border-[var(--jmc-border-subtle)] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--jmc-primary)]" />
            <h3 className="text-[12.5px] font-semibold">{t('auth.customClient')}</h3>
          </div>
          <button
            type="button"
            onClick={() => void window.jmcAPI?.openExternalUrl('https://console.cloud.google.com/apis/credentials')}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--jmc-primary)] hover:underline"
          >
            <span>{t('auth.cloudConsoleLink')}</span>
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>

        <p className="text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
          {t('auth.customClientDesc')}
        </p>

        {clientValidation && (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)]/80 p-2.5 border border-[var(--jmc-border-subtle)] text-[11px]">
            <span className="text-[var(--jmc-text-dim)] font-medium">Aktif İstemci:</span>
            {clientValidation.isCustom ? (
              <span className="inline-flex items-center gap-1 font-medium text-[var(--jmc-accent)]">
                <Check className="h-3.5 w-3.5" />
                Özel Google Cloud İstemcisi ({clientValidation.activeClientId.slice(0, 16)}...)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-[var(--jmc-primary)]">
                <Check className="h-3.5 w-3.5" />
                Varsayılan Resmi Masaüstü İstemcisi (Desktop OAuth 2.0 PKCE)
              </span>
            )}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                clientValidation.hasClientSecret
                  ? 'bg-[var(--jmc-success)]/15 text-[var(--jmc-success)]'
                  : 'bg-[var(--jmc-warning)]/15 text-[var(--jmc-warning)]'
              }`}
            >
              {clientValidation.hasClientSecret ? 'Client Secret: Hazır' : 'Client Secret: Eksik'}
            </span>
            {clientValidation.isCustom && (
              <button
                type="button"
                onClick={handleResetToDefault}
                className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-danger)] transition-colors"
                title="Özel Client ID ve Secret'ı kaldırıp uygulamanın yerleşik .env istemcisine dön"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Varsayılana Sıfırla</span>
              </button>
            )}
          </div>
        )}

        {/* Google Test Users Uyarısı / Çözüm Rehberi */}
        <div className="rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)]/5 p-2.5 border border-[var(--jmc-primary)]/20 text-[11px] leading-relaxed text-[var(--jmc-text-muted)] space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-[var(--jmc-primary)]">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>&quot;Erişim engellendi&quot; veya &quot;client_secret is missing&quot; alıyorsanız:</span>
          </div>
          <p>
            Google Masaüstü OAuth 2.0 istemcileri hem <strong>Client ID</strong> hem de <strong>Client Secret</strong> gerektirir. En kolay yöntem olarak Google Cloud Console&apos;dan indirdiğiniz <code className="font-mono text-[var(--jmc-primary)]">client_secret_*.json</code> dosyasını seçebilirsiniz.
          </p>
        </div>

        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              spellCheck={false}
              placeholder="Client ID (...apps.googleusercontent.com)"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="min-w-0 w-full rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-3 py-1.5 font-mono text-[11.5px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
            />
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                clientValidation?.hasClientSecret
                  ? 'Client Secret (Kayıtlı — değiştirmek için yazın)'
                  : 'Client Secret (GOCSPX-...)'
              }
              value={clientSecret}
              onChange={e => setClientSecretState(e.target.value)}
              className="min-w-0 w-full rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-3 py-1.5 font-mono text-[11.5px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handlePickFile}
              className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--jmc-text)] border border-[var(--jmc-border)] transition-colors hover:bg-[var(--jmc-bg-surface)] active:scale-[0.98]"
              title="Google Cloud Console'dan indirdiğiniz client_secret_*.json dosyasını doğrudan seçin"
            >
              <FileCode2 className="h-3.5 w-3.5 text-[var(--jmc-primary)]" />
              <span>Dosya Seç (.json)...</span>
            </button>
            <button
              type="button"
              onClick={handleSaveClient}
              className="rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3.5 py-1.5 text-[11.5px] font-medium text-white transition-colors hover:bg-[var(--jmc-primary-hover)] disabled:opacity-50"
            >
              {saved ? t('auth.clientSaved') : t('auth.saveClient')}
            </button>
          </div>
          {importStatus && (
            <p className="text-[11px] text-[var(--jmc-success)] font-medium animate-fade-in">
              {importStatus}
            </p>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="text-[11px] font-medium text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] transition-colors inline-flex items-center gap-1"
          >
            <span>{t('auth.guideTitle')}</span>
          </button>

          {showGuide && (
            <ol className="mt-2.5 list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-[var(--jmc-text-muted)] animate-fade-in">
              <li>{t('auth.guideStep1')}</li>
              <li>{t('auth.guideStep2')}</li>
              <li>{t('auth.guideStep3')}</li>
              <li>{t('auth.guideStep4')}</li>
              <li>{t('auth.guideStep5')}</li>
            </ol>
          )}
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const SyncPanel: React.FC<{
  status: SyncStatus | null
  syncing: boolean
  autoSyncMinutes: number
  onAutoSyncChange: (minutes: number) => void
  onSync: () => Promise<void>
}> = ({ status, syncing, autoSyncMinutes, onAutoSyncChange, onSync }) => {
  const { t, lang } = useI18n()
  const mb = (status?.totalBytesCached ?? 0) / (1024 * 1024)

  const stats: Array<{ label: string; value: string }> = [
    { label: t('settings.sync.statCourses'), value: String(status?.coursesCount ?? 0) },
    { label: t('settings.sync.statTasks'), value: String(status?.courseWorkCount ?? 0) },
    { label: t('settings.sync.statFiles'), value: String(status?.cachedFilesCount ?? 0) },
    { label: t('settings.sync.statCache'), value: formatBytes(status?.totalBytesCached ?? 0) },
  ]

  const syncIntervalOptions = useMemo(
    () => [
      {
        value: 5,
        label: t('settings.sync.interval5m'),
        badge: lang === 'tr' ? 'Önerilen' : 'Recommended',
        description:
          lang === 'tr'
            ? 'Sınıfları, ödevleri ve teslim durumlarını her 5 dakikada bir arka planda günceller.'
            : 'Refreshes courses, assignments, and submissions every 5 minutes in the background.',
        icon: <Clock className="h-3.5 w-3.5" />,
      },
      {
        value: 10,
        label: t('settings.sync.interval10m'),
        description:
          lang === 'tr'
            ? 'Dengeli arka plan eşitlemesi (10 dakika).'
            : 'Balanced background sync (10 minutes).',
        icon: <Clock className="h-3.5 w-3.5" />,
      },
      {
        value: 15,
        label: t('settings.sync.interval15m'),
        description:
          lang === 'tr'
            ? 'Standart periyodik eşitleme (15 dakika).'
            : 'Standard periodic sync (15 minutes).',
        icon: <Clock className="h-3.5 w-3.5" />,
      },
      {
        value: 30,
        label: t('settings.sync.interval30m'),
        description:
          lang === 'tr'
            ? 'Düşük ağ kullanımı için yarım saatte bir eşitleme.'
            : 'Sync every 30 minutes for lower network usage.',
        icon: <Clock className="h-3.5 w-3.5" />,
      },
      {
        value: 60,
        label: t('settings.sync.interval1h'),
        description:
          lang === 'tr'
            ? 'Saatlik arka plan kontrolü.'
            : 'Hourly background check.',
        icon: <Clock className="h-3.5 w-3.5" />,
      },
      {
        value: 120,
        label: t('settings.sync.interval2h'),
        description:
          lang === 'tr'
            ? '2 saatte bir arka plan kontrolü.'
            : 'Background check every 2 hours.',
        icon: <Clock className="h-3.5 w-3.5" />,
      },
      {
        value: 0,
        label: t('settings.sync.intervalManual'),
        description:
          lang === 'tr'
            ? 'Otomatik eşitleme kapalı; yalnızca "Şimdi senkronize et" butonuna bastığınızda çalışır.'
            : 'Auto-sync off; only syncs when you click "Sync now".',
        icon: <RefreshCw className="h-3.5 w-3.5" />,
      },
    ],
    [lang, t],
  )

  const [downloadsConfig, setDownloadsConfig] = useState<{
    currentPath: string
    defaultPath: string
    isDefault: boolean
  } | null>(null)
  const [folderNotice, setFolderNotice] = useState<string | null>(null)

  useEffect(() => {
    if (window.jmcAPI?.getDownloadsConfig) {
      window.jmcAPI.getDownloadsConfig().then(setDownloadsConfig).catch(() => {})
    }
  }, [])

  const handleSelectFolder = async () => {
    if (!window.jmcAPI?.selectDownloadsFolder) return
    try {
      const res = await window.jmcAPI.selectDownloadsFolder()
      if (res) {
        setDownloadsConfig(res)
        setFolderNotice(
          lang === 'tr'
            ? 'İndirilenler klasörü güncellendi.'
            : 'Downloads directory updated.',
        )
        window.setTimeout(() => setFolderNotice(null), 4000)
      }
    } catch {
      /* yoksay */
    }
  }

  const handleResetFolder = async () => {
    if (!window.jmcAPI?.resetDownloadsFolder) return
    try {
      const res = await window.jmcAPI.resetDownloadsFolder()
      setDownloadsConfig(res)
      setFolderNotice(
        lang === 'tr'
          ? 'İndirilenler klasörü varsayılana sıfırlandı.'
          : 'Downloads directory reset to default.',
      )
      window.setTimeout(() => setFolderNotice(null), 4000)
    } catch {
      /* yoksay */
    }
  }

  const handleOpenFolder = async () => {
    if (window.jmcAPI?.openDownloadsFolder) {
      await window.jmcAPI.openDownloadsFolder()
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium">{t('settings.sync.localCopy')}</p>
          <p className="mt-0.5 text-[11.5px] text-[var(--jmc-text-muted)]">
            {status?.lastSyncedAt
              ? `${t('settings.sync.lastSync')} ${new Date(status.lastSyncedAt).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')}`
              : t('settings.sync.notSynced')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSync()}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3.5 py-2 text-[12px] font-medium text-white transition-all hover:bg-[var(--jmc-primary-hover)] active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? t('settings.sync.syncing') : t('settings.sync.syncNow')}
        </button>
      </div>

      {status?.isSyncing && status.progress && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-[var(--jmc-text-muted)]">
            <span>{status.progress.label}</span>
            <span className="font-mono">
              {status.progress.done}/{status.progress.total}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--jmc-bg-surface)]">
            <div
              className="h-full bg-[var(--jmc-primary)] transition-[width]"
              style={{
                width: `${status.progress.total > 0 ? (status.progress.done / status.progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--jmc-radius)] bg-[var(--jmc-border-subtle)] sm:grid-cols-4">
        {stats.map(s => (
          <li key={s.label} className="bg-[var(--jmc-bg-surface)] px-3 py-2.5">
            <div className="font-mono text-[15px] text-[var(--jmc-text)]">{s.value}</div>
            <div className="mt-0.5 text-[10.5px] text-[var(--jmc-text-dim)]">{s.label}</div>
          </li>
        ))}
      </ul>
      <p className="sr-only">Önbellek: {mb.toFixed(2)} MB</p>

      {status && status.activeErrors.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--jmc-warning)]">
            {lang === 'tr' ? 'Son hatalar' : 'Recent errors'}
          </h3>
          <ul className="space-y-0.5">
            {status.activeErrors.map((e, i) => (
              <li key={i} className="text-[11px] text-[var(--jmc-text-muted)]">
                {e}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)]/60 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium">{t('settings.sync.interval')}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
            {lang === 'tr'
              ? 'Uygulama açıkken Classroom kotalarına saygılı aralıklarla veri tazeler. Varsayılan olarak her 5 dakikada bir otomatik senkronize edilir.'
              : 'Periodically updates data while respecting Google Classroom quota limits. Defaults to every 5 minutes.'}
          </p>
        </div>
        <CustomSelect<number>
          value={autoSyncMinutes}
          onChange={onAutoSyncChange}
          options={syncIntervalOptions}
          align="right"
          minMenuWidth={300}
          ariaLabel={t('settings.sync.interval')}
          className="w-64 shrink-0"
        />
      </section>

      {/* İndirilenler Klasörü Yönetimi */}
      <section className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)]/60 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Folder className="h-4 w-4 text-[var(--jmc-primary)]" />
              <p className="text-[12.5px] font-medium">
                {lang === 'tr' ? 'İndirilenler Klasörü' : 'Downloads Directory'}
              </p>
              {downloadsConfig?.isDefault ? (
                <span className="rounded-full bg-[var(--jmc-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--jmc-text-dim)] border border-[var(--jmc-border-subtle)]">
                  {lang === 'tr' ? 'Varsayılan' : 'Default'}
                </span>
              ) : (
                <span className="rounded-full bg-[var(--jmc-primary)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--jmc-primary)]">
                  {lang === 'tr' ? 'Özel Konum' : 'Custom'}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
              {lang === 'tr'
                ? 'Ödev dosyaları, öğretmen materyalleri ve ekler indirildiğinde doğrudan bu dizine kaydedilir.'
                : 'Assignments, materials, and attachments are directly downloaded to this local directory.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div
            className="min-w-0 flex-1 truncate rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-3 py-2 font-mono text-[11px] text-[var(--jmc-text)] border border-[var(--jmc-border)] select-all"
            title={downloadsConfig?.currentPath || '...'}
          >
            {downloadsConfig?.currentPath || (lang === 'tr' ? 'Konum okunuyor...' : 'Reading path...')}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleOpenFolder()}
              className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-3 py-2 text-[11.5px] font-medium text-[var(--jmc-text)] border border-[var(--jmc-border)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:border-[var(--jmc-primary)] active:scale-95"
              title={lang === 'tr' ? 'Klasörü Dosya Gezgininde Aç' : 'Open in File Explorer'}
            >
              <ExternalLink className="h-3.5 w-3.5 text-[var(--jmc-primary)]" />
              <span>{lang === 'tr' ? 'Klasörü Aç' : 'Open Folder'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleSelectFolder()}
              className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3 py-2 text-[11.5px] font-medium text-white transition-colors hover:bg-[var(--jmc-primary-hover)] active:scale-95"
              title={lang === 'tr' ? 'Farklı Bir İndirme Klasörü Seç' : 'Choose a Different Downloads Folder'}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>{lang === 'tr' ? 'Gözat / Değiştir' : 'Browse / Change'}</span>
            </button>

            {downloadsConfig && !downloadsConfig.isDefault && (
              <button
                type="button"
                onClick={() => void handleResetFolder()}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-2.5 py-2 text-[11.5px] font-medium text-[var(--jmc-text-muted)] border border-[var(--jmc-border)] transition-colors hover:text-[var(--jmc-text)] active:scale-95"
                title={lang === 'tr' ? 'Varsayılan İndirilenler Konumuna Sıfırla' : 'Reset to Default Location'}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>{lang === 'tr' ? 'Sıfırla' : 'Reset'}</span>
              </button>
            )}
          </div>
        </div>

        {folderNotice && (
          <p className="text-[11px] text-[var(--jmc-success)] font-medium animate-fade-in">
            {folderNotice}
          </p>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const ToolsPanel: React.FC<{
  permissions: ToolPermissions
  onChange: (key: keyof ToolPermissions, value: boolean) => void
  onRefresh?: () => Promise<void>
  vaultCount: number
}> = ({ permissions, onChange, onRefresh, vaultCount }) => {
  const { t } = useI18n()
  const [tavilyDraft, setTavilyDraft] = useState('')
  const [savingTavily, setSavingTavily] = useState(false)
  const [tavilyError, setTavilyError] = useState<string | null>(null)

  const [braveDraft, setBraveDraft] = useState('')
  const [savingBrave, setSavingBrave] = useState(false)
  const [braveError, setBraveError] = useState<string | null>(null)

  // "Kaydedildi" durumu KASADAKI GERCEK DURUMDAN turetilir.
  //
  // Onceki surumde bir `setTavilySaved(true)` flaşı kullaniliyordu ve
  // 2 saniye sonra `false` oluyordu; ayrica `setTavilyDraft('')` ile
  // girdi bosaltiliyordu. Kullanici "kaydettim, sonra bosaldi, yine
  // kaydet yaziyor" diye gozlemledi — oysa anahtar kasanin icine
  // YAZILDIYDI. Artik dogruluk kaynagi `permissions.tavilyKeySet`.
  const tavilySaved = Boolean(permissions.tavilyKeySet)
  const braveSaved = Boolean(permissions.braveKeySet)

  const saveTavily = async () => {
    const val = tavilyDraft.trim()
    if (!val || !window.jmcAPI) return
    setSavingTavily(true)
    setTavilyError(null)
    try {
      await window.jmcAPI.saveProviderKey('tavily', val)
      // Anahtarin gercekten kasaya girdigini dogrula; kaydetme
      // sessizce basarisiz olabilir (disk dolu, izin hatasi, ...).
      await onRefresh?.()
      setTavilyDraft('')
    } catch (err) {
      // Onceki surum hatayi yutup kullaniciga HICBIR sey gostermiyordu.
      setTavilyError(err instanceof Error ? err.message : 'Anahtar kaydedilemedi.')
    } finally {
      setSavingTavily(false)
    }
  }

  const deleteTavily = async () => {
    if (!window.jmcAPI) return
    setTavilyError(null)
    try {
      await window.jmcAPI.deleteProviderKey('tavily')
      setTavilyDraft('')
      await onRefresh?.()
    } catch (err) {
      setTavilyError(err instanceof Error ? err.message : 'Anahtar silinemedi.')
    }
  }

  const saveBrave = async () => {
    const val = braveDraft.trim()
    if (!val || !window.jmcAPI) return
    setSavingBrave(true)
    setBraveError(null)
    try {
      await window.jmcAPI.saveProviderKey('brave', val)
      await onRefresh?.()
      setBraveDraft('')
    } catch (err) {
      setBraveError(err instanceof Error ? err.message : 'Anahtar kaydedilemedi.')
    } finally {
      setSavingBrave(false)
    }
  }

  const deleteBrave = async () => {
    if (!window.jmcAPI) return
    setBraveError(null)
    try {
      await window.jmcAPI.deleteProviderKey('brave')
      setBraveDraft('')
      await onRefresh?.()
    } catch (err) {
      setBraveError(err instanceof Error ? err.message : 'Anahtar silinemedi.')
    }
  }

  const rows: Array<{
    key: 'webSearch' | 'workspaceRead' | 'fileWrite' | 'classroomDraft'
    title: string
    desc: string
  }> = [
    {
      key: 'webSearch',
      title: t('settings.tools.webSearch'),
      desc: t('settings.tools.webSearchDesc'),
    },
    {
      key: 'workspaceRead',
      title: t('settings.tools.workspaceRead'),
      desc: t('settings.tools.workspaceReadDesc'),
    },
    {
      key: 'fileWrite',
      title: t('settings.tools.fileWrite'),
      desc: t('settings.tools.fileWriteDesc'),
    },
    {
      key: 'classroomDraft',
      title: t('settings.tools.classroomDraft'),
      desc: t('settings.tools.classroomDraftDesc'),
    },
  ]

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
        {t('settings.tools.desc')}
      </p>

      <ul className="space-y-2">
        {rows.map(row => (
          <li key={row.key} className="space-y-2">
            <ToggleRow
              label={row.title}
              description={row.desc}
              checked={Boolean(permissions[row.key])}
              onChange={v => onChange(row.key, v)}
            />
            {row.key === 'webSearch' && permissions.webSearch && (
              <div className="ml-7 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] p-3 border border-[var(--jmc-border-subtle)] space-y-3 animate-fade-in">
                {/* 3 Kademeli Arama Bilgilendirmesi */}
                <div className="rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg)] p-2.5 border border-[var(--jmc-border-subtle)] text-[11px] leading-relaxed text-[var(--jmc-text-dim)] space-y-1">
                  <p className="font-semibold text-[var(--jmc-text)]">
                    🌐 3 Kademeli Akıllı Web Arama Mimarisi:
                  </p>
                  <p>
                    1. <strong>Tavily API</strong> (Varsa, akademik ve ödev odaklı arama)<br />
                    2. <strong>Brave Search API</strong> (Varsa, bağımsız web dizini)<br />
                    3. <strong>DuckDuckGo HTML Arama</strong> (100% Anahtarsız, yerel ve sınırsız)
                  </p>
                  <p className="text-[var(--jmc-primary)] font-medium">
                    ✓ Herhangi bir API anahtarı girmeseniz dahi DuckDuckGo ile asistan web aramaları otomatik olarak sorunsuz çalışır.
                  </p>
                </div>

                {/* Tavily API Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label htmlFor="jmc-tavily-key" className="text-[11px] font-medium text-[var(--jmc-text-dim)]">
                        {t('settings.tools.tavilyKey')}
                      </label>
                      {permissions.tavilyKeySet ? (
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--jmc-success)] font-medium">
                          <Check className="h-3 w-3" />
                          <span>Kasada Saklanıyor {permissions.tavilyKeyMasked ? `(${permissions.tavilyKeyMasked})` : ''}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--jmc-text-dim)]">Girilmedi</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void window.jmcAPI?.openExternalUrl('https://app.tavily.com/home')}
                      className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--jmc-primary)] hover:underline"
                    >
                      <span>{t('settings.tools.tavilyGuide')}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="jmc-tavily-key"
                      type="password"
                      placeholder={permissions.tavilyKeySet ? '•••••••••••••••• (Kayıtlı ve korumalı - değiştirmek için yeni anahtar girin)' : t('settings.tools.tavilyPlaceholder')}
                      value={tavilyDraft}
                      onChange={e => {
                        setTavilyDraft(e.target.value)
                        if (tavilyError) setTavilyError(null)
                      }}
                      // Parola yoneticilerinin API anahtarlarini Chromium
                      // profiline yazmasini ve orada saklamasini engeller.
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      aria-invalid={tavilyError ? true : undefined}
                      aria-describedby={tavilyError ? 'jmc-tavily-key-error' : undefined}
                      className="min-w-0 flex-1 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg)] px-2.5 py-1 font-mono text-[11px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)] aria-[invalid=true]:border-[var(--jmc-danger)]"
                    />
                    <button
                      type="button"
                      onClick={saveTavily}
                      disabled={savingTavily || !tavilyDraft.trim()}
                      className={`rounded-[var(--jmc-radius-sm)] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        permissions.tavilyKeySet && !tavilyDraft.trim()
                          ? 'bg-[var(--jmc-success)]/15 text-[var(--jmc-success)] border border-[var(--jmc-success)]/30'
                          : 'bg-[var(--jmc-primary)] text-white hover:bg-[var(--jmc-primary-hover)] disabled:opacity-50'
                      }`}
                    >
                      {permissions.tavilyKeySet && !tavilyDraft.trim() ? 'Kayıtlı ✓' : t('settings.tools.saveKey')}
                    </button>
                    {permissions.tavilyKeySet && (
                      <button
                        type="button"
                        onClick={deleteTavily}
                        className="rounded-[var(--jmc-radius-sm)] px-2 py-1 text-[11px] text-[var(--jmc-text-dim)] hover:text-[var(--jmc-danger)] transition-colors"
                      >
                        {t('settings.tools.deleteKey')}
                      </button>
                    )}
                  </div>
                  {tavilyError && (
                    <p
                      id="jmc-tavily-key-error"
                      role="alert"
                      className="flex items-start gap-1 text-[10.5px] text-[var(--jmc-danger)]"
                    >
                      <AlertCircle className="h-3 w-3 mt-px shrink-0" />
                      <span>{tavilyError}</span>
                    </p>
                  )}
                </div>

                {/* Brave Search API Key */}
                <div className="space-y-1.5 pt-1 border-t border-[var(--jmc-border-subtle)]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label htmlFor="jmc-brave-key" className="text-[11px] font-medium text-[var(--jmc-text-dim)]">
                        Brave Search API Anahtarı (İsteğe bağlı)
                      </label>
                      {permissions.braveKeySet ? (
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--jmc-success)] font-medium">
                          <Check className="h-3 w-3" />
                          <span>Kasada Saklanıyor {permissions.braveKeyMasked ? `(${permissions.braveKeyMasked})` : ''}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--jmc-text-dim)]">Girilmedi</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void window.jmcAPI?.openExternalUrl('https://brave.com/search/api/')}
                      className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--jmc-primary)] hover:underline"
                    >
                      <span>Brave API Al</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="jmc-brave-key"
                      type="password"
                      placeholder={permissions.braveKeySet ? '•••••••••••••••• (Kayıtlı ve korumalı - değiştirmek için yeni anahtar girin)' : 'BSA... (Brave API Anahtarı)'}
                      value={braveDraft}
                      onChange={e => {
                        setBraveDraft(e.target.value)
                        if (braveError) setBraveError(null)
                      }}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      aria-invalid={braveError ? true : undefined}
                      aria-describedby={braveError ? 'jmc-brave-key-error' : undefined}
                      className="min-w-0 flex-1 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg)] px-2.5 py-1 font-mono text-[11px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)] aria-[invalid=true]:border-[var(--jmc-danger)]"
                    />
                    <button
                      type="button"
                      onClick={saveBrave}
                      disabled={savingBrave || !braveDraft.trim()}
                      className={`rounded-[var(--jmc-radius-sm)] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        permissions.braveKeySet && !braveDraft.trim()
                          ? 'bg-[var(--jmc-success)]/15 text-[var(--jmc-success)] border border-[var(--jmc-success)]/30'
                          : 'bg-[var(--jmc-primary)] text-white hover:bg-[var(--jmc-primary-hover)] disabled:opacity-50'
                      }`}
                    >
                      {permissions.braveKeySet && !braveDraft.trim() ? 'Kayıtlı ✓' : t('settings.tools.saveKey')}
                    </button>
                    {permissions.braveKeySet && (
                      <button
                        type="button"
                        onClick={deleteBrave}
                        className="rounded-[var(--jmc-radius-sm)] px-2 py-1 text-[11px] text-[var(--jmc-text-dim)] hover:text-[var(--jmc-danger)] transition-colors"
                      >
                        {t('settings.tools.deleteKey')}
                      </button>
                    )}
                  </div>
                  {braveError && (
                    <p
                      id="jmc-brave-key-error"
                      role="alert"
                      className="flex items-start gap-1 text-[10.5px] text-[var(--jmc-danger)]"
                    >
                      <AlertCircle className="h-3 w-3 mt-px shrink-0" />
                      <span>{braveError}</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-[var(--jmc-text-dim)]">
        {t('settings.tools.vaultStatus')}: {vaultCount}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const LanguagePanel: React.FC<{
  lang: 'tr' | 'en'
  onLang: (l: 'tr' | 'en') => void
}> = ({ lang, onLang }) => (
  <div className="space-y-3">
    <p className="text-[12.5px] leading-relaxed text-[var(--jmc-text-muted)]">
      Arayüz dili yalnızca uygulama metinlerini değiştirir. Ders ve ödev içerikleri Google
      Classroom'dan geldiği için olduğu gibi kalır.
    </p>
    <ul className="space-y-1.5">
      {(
        [
          ['tr', 'Türkçe'],
          ['en', 'English'],
        ] as const
      ).map(([code, label]) => (
        <li key={code}>
          <button
            type="button"
            onClick={() => onLang(code)}
            aria-pressed={lang === code}
            className={`w-full rounded-[var(--jmc-radius)] px-3 py-2 text-left text-[12.5px] transition-colors ${
              lang === code
                ? 'bg-[var(--jmc-bg-surface)] font-medium text-[var(--jmc-primary)] shadow-[var(--jmc-shadow-sm)]'
                : 'text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
            }`}
          >
            {label}
          </button>
        </li>
      ))}
    </ul>
  </div>
)

/* ------------------------------------------------------------------ */

const PrivacyPanel: React.FC<{
  security: SecurityInfo | null
  wiping: boolean
  onWipe: () => Promise<void>
}> = ({ security, wiping, onWipe }) => {
  const [confirming, setConfirming] = useState(false)
  const [diagnostics, setDiagnostics] = useState<StorageDiagnostics | null>(null)

  /**
   * Depolama sagligi tanilamasi.
   *
   * KULLANICI ŞİKÂYETİ: veri kaybolduğunda arayüz HİÇBİR ŞEY söylemiyordu;
   * kullanici derslerin sıfırlandığını sanıp tekrar tekrar giriş yapıyordu.
   * Asıl neden (ana anahtar dosyası okunamıyor / güvenli depolama yok) gizli
   * kalıyordu. Bu panel nedeni açıkça gösterir.
   */
  useEffect(() => {
    let cancelled = false
    void window.jmcAPI
      ?.getStorageDiagnostics?.()
      .then(d => {
        if (!cancelled && d) setDiagnostics(d)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const storeProblem = diagnostics?.store?.readable === false || Boolean(diagnostics?.store?.problem)
  const vaultProblem = diagnostics?.vault?.readable === false || Boolean(diagnostics?.vault?.problem)

  return (
    <div className="space-y-5">
      <section className="space-y-2.5">
        <h3 className="text-[12.5px] font-medium">Yerel depo</h3>
        {security ? (
          <>
            <StatusRow label="Algoritma" value={security.store.algorithm} />
            <StatusRow label="Anahtar kasası" value={security.store.description} />
            <StatusRow
              label="Donanım koruması"
              value={security.store.hardwareProtected ? 'var' : 'yok'}
              tone={security.store.hardwareProtected ? 'ok' : 'warn'}
            />
            <StatusRow
              label="Dosya"
              value={security.store.storePath}
              mono
            />
          </>
        ) : (
          <p className="text-[12px] text-[var(--jmc-text-dim)]">Güvenlik durumu okunamadı.</p>
        )}
      </section>

      {/* ---- Depolama sağlığı tanılaması ---- */}
      {diagnostics && (
        <section className="space-y-2.5">
          <h3 className="text-[12.5px] font-medium">Depolama sağlığı</h3>

          {storeProblem || vaultProblem ? (
            <div className="space-y-2 rounded-[var(--jmc-radius)] border border-[var(--jmc-warning)]/35 bg-[var(--jmc-warning)]/10 p-3">
              <p className="flex items-start gap-2 text-[12px] font-medium text-[var(--jmc-warning)]">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Şifreli depolama açılamadı</span>
              </p>
              <p className="text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                Verileriniz diskte SİLİNMEDİ; şifre çözme anahtarı okunamadığı için uygulama onları
                güvenlik gereği göstermiyor. Sorunlu dosyalar yedek olarak saklandı — verileriniz hâlâ
                duruyor. Bu genellikle işletim sistemi güvenli depolamasının (Windows: DPAPI) hesap
                profili değişikliği, klasör kopyalama veya geri yükleme nedeniyle geçersizleşmesinden
                kaynaklanır.
              </p>
              {diagnostics.store?.problem && (
                <p className="text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
                  <strong className="text-[var(--jmc-text-muted)]">Veritabanı:</strong>{' '}
                  {diagnostics.store.problem}
                </p>
              )}
              {diagnostics.vault?.problem && (
                <p className="text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
                  <strong className="text-[var(--jmc-text-muted)]">Anahtar kasası:</strong>{' '}
                  {diagnostics.vault.problem}
                </p>
              )}
            </div>
          ) : (
            <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
              <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--jmc-success)]" />
              <span>
                Şifreli veritabanı ve anahtar kasası açıldı. Verileriniz yerinde ve okunabilir
                durumda.
              </span>
            </p>
          )}

          <div className="space-y-1 rounded-[var(--jmc-radius)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)]/40 p-2.5 font-mono text-[10.5px] text-[var(--jmc-text-dim)]">
            <StatusRow label="Sürüm" value={diagnostics.version} mono />
            <StatusRow
              label="Çalışma modu"
              value={
                diagnostics.portable ? 'Taşınabilir (Portable)' : diagnostics.packaged ? 'Kurulu' : 'Geliştirme'
              }
              mono
            />
            <StatusRow label="Veri klasörü" value={diagnostics.dataDir} mono />
            <StatusRow
              label="Anahtar dosyası"
              value={diagnostics.keyring?.keyFilePath || '—'}
              mono
              tone={diagnostics.keyring?.readable ? 'ok' : 'warn'}
            />
            {diagnostics.keyring?.problem && (
              <p className="pt-1 text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
                <strong className="text-[var(--jmc-text-muted)]">Anahtar durumu:</strong>{' '}
                {diagnostics.keyring.problem}
              </p>
            )}
          </div>
        </section>
      )}

      <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
        <li className="flex gap-2">
          <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--jmc-text-dim)]" />
          <span>
            Uygulama telemetri göndermez. Sınıf, ödev ve ek verileri yalnızca bu cihazda tutulur.
          </span>
        </li>
        <li className="flex gap-2">
          <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--jmc-text-dim)]" />
          <span>
            Anahtar karakterleri arayüze aktarılmaz; arayüz yalnızca varlık durumu ve geri
            döndürülemeyen bir parmak izi görür.
          </span>
        </li>
        <li className="flex gap-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--jmc-text-dim)]" />
          <span>
            İçerik, sizin seçtiğiniz yapay zekâ sağlayıcısına gönderilir. Öğrenci verisi için en
            az veri saklayan veya tamamen yerel bir sağlayıcı seçin.
          </span>
        </li>
      </ul>

      <section className="space-y-2.5">
        <h3 className="text-[12.5px] font-medium">Verileri sil</h3>
        <p className="text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
          Yerel sınıf kopyası, indirilen dosyalar ve kasadaki API anahtarları kalıcı olarak
          silinir. Google Classroom'daki veriler etkilenmez; bunları siz Google hesabınızdan
          yönetirsiniz.
        </p>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] px-3 py-2 text-[12px] font-medium text-[var(--jmc-danger)] transition-colors hover:bg-[var(--jmc-badge-bg)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Tüm yerel verileri sil
          </button>
        ) : (
          <div className="space-y-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-badge-bg)] p-3">
            <p className="text-[11.5px] text-[var(--jmc-text)]">
              Bu işlem geri alınamaz. Devam edilsin mi?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void onWipe()}
                disabled={wiping}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-danger)] px-3 py-1.5 text-[11.5px] font-medium text-white disabled:opacity-50"
              >
                {wiping && <Loader2 className="h-3 w-3 animate-spin" />}
                Evet, sil
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-[var(--jmc-radius)] px-3 py-1.5 text-[11.5px] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]"
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/* ================================================================== */
/* Ortak parcalar                                                     */
/* ================================================================== */

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const SmallButton: React.FC<{
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  danger?: boolean
  icon?: React.ReactNode
}> = ({ onClick, children, disabled, danger, icon }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex shrink-0 items-center gap-1.5 rounded-[var(--jmc-radius)] px-2.5 py-1.5 text-[11px] transition-colors disabled:opacity-50 ${
      danger
        ? 'text-[var(--jmc-danger)] hover:bg-[var(--jmc-badge-bg)]'
        : 'bg-[var(--jmc-bg)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
    }`}
  >
    {icon}
    {children}
  </button>
)

const Field: React.FC<{
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}> = ({ id, label, value, onChange, placeholder, mono }) => (
  <div>
    <label htmlFor={id} className="mb-1 block text-[10.5px] text-[var(--jmc-text-dim)]">
      {label}
    </label>
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={e => onChange(e.target.value)}
      className={`w-full rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-2.5 py-1.5 text-[11.5px] text-[var(--jmc-text)] outline-none ${
        mono ? 'font-mono' : ''
      }`}
    />
  </div>
)

const ToggleRow: React.FC<{
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}> = ({ label, description, checked, onChange }) => {
  const id = `tg-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div className="flex items-start gap-3 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[12px] font-medium">
          {label}
        </label>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
          {description}
        </p>
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--jmc-primary)]"
      />
    </div>
  )
}

const StatusRow: React.FC<{
  label: string
  value: string
  tone?: 'ok' | 'warn'
  mono?: boolean
}> = ({ label, value, tone, mono }) => (
  <div className="flex items-baseline justify-between gap-3 py-1">
    <span className="shrink-0 text-[11.5px] text-[var(--jmc-text-dim)]">{label}</span>
    <span
      className={`min-w-0 truncate text-right text-[11.5px] ${
        tone === 'ok'
          ? 'text-[var(--jmc-success)]'
          : tone === 'warn'
            ? 'text-[var(--jmc-warning)]'
            : 'text-[var(--jmc-text)]'
      } ${mono ? 'font-mono text-[10.5px]' : ''}`}
      title={value}
    >
      {value}
    </span>
  </div>
)
