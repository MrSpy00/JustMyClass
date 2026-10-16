/**
 * SetupWizard.tsx
 * ---------------------------------------------------------------------------
 * Ilk calistirmada ve Ayarlar -> Hakkinda uzerinden acilan, TEK EKRANDA
 * hem mimariyi ozetleyen hem de interaktif ozellestirme (Tema, Otomatik
 * Esitleme Araligi, Varsayilan AI Kipi, Hizli API Anahtari ve Arac Izinleri)
 * sunan zengin karsilama ve kurulum ekrani.
 */
import React, { useEffect, useState } from 'react'
import {
  Brain,
  Check,
  CheckCircle2,
  Clock,
  Database,
  FileCheck,
  GraduationCap,
  HelpCircle,
  KeyRound,
  Loader2,
  Lock,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import type {
  Account,
  ProviderBrand,
  ProviderId,
  ThemeName,
  ToolPermissions,
  UpdateStatus,
} from '../../types/jmc'
import { useTheme } from '../../themes/ThemeContext'
import { THEMES } from '../../themes/themeConfig'
import { CustomSelect } from '../../components/CustomSelect'
import { ProviderIcon } from '../../components/icons/ProviderIcon'
import {
  AI_MODE_CHANGED_EVENT,
  AUTOSYNC_CHANGED_EVENT,
  PROVIDERS_CHANGED_EVENT,
} from '../../lib/events'

type AiMode = 'socratic' | 'draft' | 'rubric' | 'quiz'

interface SetupWizardProps {
  isOpen: boolean
  onClose: () => void
  onOpenSettings: (tab?: string) => void
  onOpenAuth: () => void
  /** Guncel surum durumu; "zaten guncel misiniz" mesajinda kullanilir. */
  updateStatus: UpdateStatus | null
  /** Veri klasorunun gorunur adi (or. "AppData/Roaming/JustMyClass"). */
  dataPathLabel: string
}

const FEATURED_THEMES: ThemeName[] = [
  'Neon Dreams',
  'Dark',
  'Abyss',
  'Cyberpunk',
  'Graphite',
  'Ocean',
  'Forest',
  'Light',
]

const QUICK_PROVIDERS: { id: ProviderId; brand: ProviderBrand; label: string; placeholder: string }[] = [
  { id: 'gemini', brand: 'google', label: 'Google Gemini', placeholder: 'AIzaSy...' },
  { id: 'openai', brand: 'openai', label: 'OpenAI', placeholder: 'sk-proj-...' },
  { id: 'anthropic', brand: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-...' },
  { id: 'deepseek', brand: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
  { id: 'openrouter', brand: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-v1-...' },
  { id: 'groq', brand: 'groq', label: 'Groq Cloud', placeholder: 'gsk_...' },
]

const AI_MODES: { id: AiMode; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'socratic', label: 'Sokratik Rehber', desc: 'Adım adım düşündürerek öğretir', icon: Brain },
  { id: 'draft', label: 'Taslak Üretici', desc: 'Yapılandırılmış ödev taslağı kurar', icon: Sparkles },
  { id: 'rubric', label: 'Rubrik Denetçisi', desc: 'Kriterlere göre eksiklerinizi bulur', icon: FileCheck },
  { id: 'quiz', label: 'Sınav Hazırlayıcı', desc: 'Konudan pratik sorular üretir', icon: HelpCircle },
]

export function SetupWizard({
  isOpen,
  onClose,
  onOpenSettings,
  onOpenAuth,
  updateStatus,
  dataPathLabel,
}: SetupWizardProps): React.ReactElement | null {
  const { theme, setTheme, compact, setCompact, reduceMotion, setReduceMotion } = useTheme()

  const [account, setAccount] = useState<Account | null>(null)
  const [autoSyncMinutes, setAutoSyncMinutes] = useState<number>(5)
  const [defaultAiMode, setDefaultAiMode] = useState<AiMode>('socratic')
  const [permissions, setPermissions] = useState<ToolPermissions>({
    webSearch: true,
    fileWrite: false,
    workspaceRead: true,
    classroomDraft: false,
  })

  // Hizli AI anahtar kurulumu
  const [quickProvider, setQuickProvider] = useState<ProviderId>('gemini')
  const [quickApiKey, setQuickApiKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [keySavedMsg, setKeySavedMsg] = useState<string | null>(null)
  const [configuredCount, setConfiguredCount] = useState<number>(0)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen || !window.jmcAPI) return
    let cancelled = false

    void Promise.all([
      window.jmcAPI.getAccount().catch(() => null),
      window.jmcAPI.getSetting<number>('autoSyncMinutes', 5).catch(() => 5),
      window.jmcAPI.getSetting<string>('ai.defaultMode', 'socratic').catch(() => 'socratic'),
      window.jmcAPI.getToolPermissions().catch(() => null),
      window.jmcAPI.getProviders().catch(() => []),
    ]).then(([acc, syncMin, savedMode, perms, providers]) => {
      if (cancelled) return
      setAccount(acc)
      setAutoSyncMinutes(Number.isFinite(syncMin) && syncMin >= 0 ? syncMin : 5)
      if (
        savedMode === 'socratic' ||
        savedMode === 'draft' ||
        savedMode === 'rubric' ||
        savedMode === 'quiz'
      ) {
        setDefaultAiMode(savedMode)
      }
      if (perms) setPermissions(perms)
      if (Array.isArray(providers)) {
        setConfiguredCount(providers.filter(p => p.hasKey || p.isLocal).length)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleAutoSyncChange = async (minutes: number) => {
    setAutoSyncMinutes(minutes)
    await window.jmcAPI?.setSetting('autoSyncMinutes', minutes)
    window.dispatchEvent(new CustomEvent(AUTOSYNC_CHANGED_EVENT, { detail: { minutes } }))
  }

  const handleAiModeChange = async (mode: AiMode) => {
    setDefaultAiMode(mode)
    await window.jmcAPI?.setSetting('ai.defaultMode', mode)
    window.dispatchEvent(new CustomEvent(AI_MODE_CHANGED_EVENT, { detail: { mode } }))
  }

  const handleTogglePermission = async (key: keyof ToolPermissions) => {
    const next = { ...permissions, [key]: !permissions[key] }
    setPermissions(next)
    await window.jmcAPI?.setToolPermissions(next)
  }

  const handleSaveQuickKey = async () => {
    const trimmed = quickApiKey.trim()
    if (!trimmed || !window.jmcAPI) return
    setSavingKey(true)
    setKeySavedMsg(null)
    try {
      await window.jmcAPI.saveProviderKey(quickProvider, trimmed)
      setQuickApiKey('')
      const providers = await window.jmcAPI.getProviders().catch(() => [])
      setConfiguredCount(providers.filter(p => p.hasKey || p.isLocal).length)
      const found = providers.find(p => p.id === quickProvider)
      const modelCount = found?.models?.length ?? 0
      setKeySavedMsg(
        modelCount > 0
          ? `Anahtar kasaya kaydedildi ve ${modelCount} model otomatik yüklendi.`
          : 'Anahtar kasaya kaydedildi, modeller arka planda eşitleniyor.'
      )
      window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT))
      window.setTimeout(() => setKeySavedMsg(null), 4000)
    } finally {
      setSavingKey(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="jmc-setup-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-[4px] p-4 transition-all duration-200 animate-fade-in"
    >
      <div className="animate-pop-in flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] shadow-[var(--jmc-shadow-lg)]">
        {/* ---------------- Baslik ---------------- */}
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--jmc-border-subtle)] px-6 py-4 bg-[var(--jmc-bg)]/40">
          <div className="flex items-center gap-3">
            <span
              className="grid h-10 w-10 place-items-center rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-badge-bg)] text-[var(--jmc-primary)] shadow-[var(--jmc-shadow-sm)]"
              aria-hidden="true"
            >
              <GraduationCap className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 id="jmc-setup-title" className="text-base font-semibold text-[var(--jmc-text)]">
                  JustMyClass Kurulum & Özelleştirme Merkezi
                </h1>
                <span className="rounded-full bg-[var(--jmc-badge-bg)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--jmc-primary)]">
                  v{updateStatus?.currentVersion || '0.0.1'}
                </span>
              </div>
              <p className="text-xs text-[var(--jmc-text-muted)]">
                Google Classroom için Yerel-Öncelikli, Gizlilik Odaklı Bağımsız Masaüstü Çalışma Alanı
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded-[var(--jmc-radius)] p-1.5 text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* ---------------- Tek Ekran Kaydirilabilir Ana Govde ---------------- */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Üst 3 Ana Mimari Kartı */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Kart 1: Gizlilik ve Depolama */}
            <div className="flex flex-col justify-between rounded-[var(--jmc-radius)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]/60 p-4 transition-colors hover:border-[var(--jmc-border)]">
              <div>
                <div className="flex items-center gap-2 text-[var(--jmc-primary)] mb-2">
                  <Lock className="h-4 w-4 shrink-0" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--jmc-text)]">
                    Cihazınızda & Şifreli
                  </h2>
                </div>
                <p className="text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                  Verileriniz üçüncü taraf bulutlara gitmez; doğrudan bilgisayarınızda AES-256-GCM ve Windows DPAPI kasası ile şifrelenir.
                </p>
                <div className="mt-2.5 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-code-bg)] p-2 font-mono text-[10px] text-[var(--jmc-text-dim)] border border-[var(--jmc-border-subtle)] break-all">
                  <span className="text-[var(--jmc-primary)] font-semibold">Kasa: </span>
                  {dataPathLabel || 'AppData/Roaming/JustMyClass'}
                </div>
              </div>
              <p className="mt-2.5 text-[10.5px] text-[var(--jmc-text-dim)] flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 shrink-0 text-[var(--jmc-success)]" />
                <span>CSV, JSON ve Anki dışa aktarımı hazır.</span>
              </p>
            </div>

            {/* Kart 2: Google Classroom Baglantisi */}
            <div className="flex flex-col justify-between rounded-[var(--jmc-radius)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]/60 p-4 transition-colors hover:border-[var(--jmc-border)]">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-[var(--jmc-primary)]">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--jmc-text)]">
                      Classroom Eşitleme
                    </h2>
                  </div>
                  {account && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9.5px] font-semibold text-emerald-400 border border-emerald-500/25">
                      Bağlı
                    </span>
                  )}
                </div>
                <p className="text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                  RFC 8252 PKCE geri dönüşü ve <code className="font-mono text-[var(--jmc-primary)]">.env</code> / yerel kasa korumalı OAuth 2.0 istemcisi ile güvenli oturum açın.
                </p>
                {account ? (
                  <div className="mt-2.5 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg-surface)] px-2.5 py-2 text-[11px] border border-[var(--jmc-border-subtle)]">
                    <div className="font-medium text-[var(--jmc-text)] truncate">{account.displayName}</div>
                    <div className="text-[10px] text-[var(--jmc-text-dim)] truncate">{account.email}</div>
                  </div>
                ) : (
                  <ul className="mt-2.5 space-y-1 text-[11px] text-[var(--jmc-text-muted)]">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--jmc-success)] shrink-0" />
                      Ödevler, teslimler, rubrikler ve Drive ekleri
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--jmc-success)] shrink-0" />
                      5 dakikada bir otomatik arka plan eşitleme
                    </li>
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenAuth()
                }}
                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-primary)]/40 bg-[var(--jmc-primary)]/15 px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--jmc-primary)] transition-colors hover:bg-[var(--jmc-primary)] hover:text-white"
              >
                {account ? 'Hesap Ayarlarını Aç' : 'Google ile Bağlan'}
              </button>
            </div>

            {/* Kart 3: Hızlı Yapay Zeka Kurulumu */}
            <div className="flex flex-col justify-between rounded-[var(--jmc-radius)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]/60 p-4 transition-colors hover:border-[var(--jmc-border)]">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-[var(--jmc-primary)]">
                    <Sparkles className="h-4 w-4 shrink-0" />
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--jmc-text)]">
                      Hızlı AI Kurulumu
                    </h2>
                  </div>
                  <span className="rounded-full bg-[var(--jmc-badge-bg)] px-2 py-0.5 text-[9.5px] font-semibold text-[var(--jmc-primary)]">
                    {configuredCount} aktif
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--jmc-text-muted)] mb-2">
                  API anahtarı girdiğiniz anda modeller otomatik sorgulanıp önbelleğe alınır:
                </p>

                <div className="space-y-2">
                  <CustomSelect<ProviderId>
                    value={quickProvider}
                    onChange={setQuickProvider}
                    size="sm"
                    ariaLabel="Hızlı AI Sağlayıcı Seçimi"
                    options={QUICK_PROVIDERS.map(p => ({
                      value: p.id,
                      label: p.label,
                      icon: <ProviderIcon brand={p.brand} className="h-3.5 w-3.5" />,
                    }))}
                  />
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={quickApiKey}
                      onChange={e => setQuickApiKey(e.target.value)}
                      placeholder={
                        QUICK_PROVIDERS.find(p => p.id === quickProvider)?.placeholder || 'API Anahtarı...'
                      }
                      className="min-w-0 flex-1 rounded-[var(--jmc-radius-sm)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] px-2.5 py-1 font-mono text-[11px] text-[var(--jmc-text)] outline-none focus:border-[var(--jmc-primary)]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveQuickKey}
                      disabled={savingKey || !quickApiKey.trim()}
                      className="inline-flex shrink-0 items-center gap-1 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-primary)] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[var(--jmc-primary-hover)] disabled:opacity-50"
                    >
                      {savingKey ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Kaydet'}
                    </button>
                  </div>
                  {keySavedMsg && (
                    <p className="text-[10px] text-[var(--jmc-success)] font-medium animate-fade-in">
                      {keySavedMsg}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenSettings('providers')
                }}
                className="mt-2.5 inline-flex items-center justify-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--jmc-text)] transition-colors hover:bg-[var(--jmc-bg)]"
              >
                <KeyRound className="h-3 w-3 text-[var(--jmc-primary)]" />
                Tüm Sağlayıcıları & Yerel AI'yı Yönet
              </button>
            </div>
          </div>

          {/* İnteraktif Özelleştirme Gridi */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Sol Kutu: Tema & Görünüm Özelleştirme */}
            <div className="rounded-[var(--jmc-radius)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-[var(--jmc-primary)]" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--jmc-text)]">
                    Tema & Görünüm Tercihi
                  </h3>
                </div>
                <span className="text-[10.5px] font-mono text-[var(--jmc-primary)]">{theme}</span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {FEATURED_THEMES.map(tName => {
                  const palette = THEMES[tName]
                  const active = theme === tName
                  return (
                    <button
                      key={tName}
                      type="button"
                      onClick={() => setTheme(tName)}
                      className={`group flex flex-col items-start gap-1.5 rounded-[var(--jmc-radius-sm)] border p-2 text-left transition-all ${
                        active
                          ? 'border-[var(--jmc-primary)] bg-[var(--jmc-badge-bg)] shadow-[var(--jmc-shadow-sm)]'
                          : 'border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-elevated)] hover:border-[var(--jmc-border)]'
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className="h-3 w-3 rounded-full border border-white/20"
                          style={{ backgroundColor: palette.bg }}
                        />
                        <span
                          className="h-3 w-3 rounded-full border border-white/20"
                          style={{ backgroundColor: palette.primary }}
                        />
                        <span
                          className="h-3 w-3 rounded-full border border-white/20"
                          style={{ backgroundColor: palette.accent }}
                        />
                      </div>
                      <span className="text-[10.5px] font-medium text-[var(--jmc-text)] leading-tight truncate w-full">
                        {tName}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCompact(!compact)}
                  className={`flex-1 rounded-[var(--jmc-radius-sm)] border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    compact
                      ? 'border-[var(--jmc-primary)] bg-[var(--jmc-badge-bg)] text-[var(--jmc-primary)]'
                      : 'border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-elevated)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                  }`}
                >
                  {compact ? '✓ Sıkışık Düzen Aktif' : 'Standart Boşluklu Düzen'}
                </button>
                <button
                  type="button"
                  onClick={() => setReduceMotion(!reduceMotion)}
                  className={`flex-1 rounded-[var(--jmc-radius-sm)] border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    reduceMotion
                      ? 'border-[var(--jmc-primary)] bg-[var(--jmc-badge-bg)] text-[var(--jmc-primary)]'
                      : 'border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-elevated)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                  }`}
                >
                  {reduceMotion ? '✓ Azaltılmış Animasyon' : 'Tam Akıcı Animasyonlar'}
                </button>
              </div>
            </div>

            {/* Sağ Kutu: Otomatik Eşitleme & Varsayılan AI Çalışma Kipi */}
            <div className="rounded-[var(--jmc-radius)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]/50 p-4 space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-[var(--jmc-primary)]" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--jmc-text)]">
                      Otomatik Eşitleme Aralığı
                    </h3>
                  </div>
                  <span className="text-[10px] font-medium text-[var(--jmc-success)]">
                    Varsayılan: 5 dk
                  </span>
                </div>
                <CustomSelect<number>
                  value={autoSyncMinutes}
                  onChange={handleAutoSyncChange}
                  size="sm"
                  ariaLabel="Otomatik Eşitleme Aralığı"
                  options={[
                    {
                      value: 5,
                      label: 'Her 5 dakikada bir',
                      description: 'Önerilen varsayılan — ödev ve duyuruları anında yakalar',
                      badge: 'Varsayılan',
                      icon: <Clock className="h-3.5 w-3.5 text-[var(--jmc-primary)]" />,
                    },
                    {
                      value: 15,
                      label: 'Her 15 dakikada bir',
                      description: 'Dengeli arka plan senkronizasyonu',
                      icon: <Clock className="h-3.5 w-3.5 text-[var(--jmc-text-muted)]" />,
                    },
                    {
                      value: 30,
                      label: 'Her 30 dakikada bir',
                      description: 'Düşük ağ kullanımı',
                      icon: <Clock className="h-3.5 w-3.5 text-[var(--jmc-text-muted)]" />,
                    },
                    {
                      value: 60,
                      label: 'Her 1 saatte bir',
                      description: 'Saatlik arka plan kontrolü',
                      icon: <Clock className="h-3.5 w-3.5 text-[var(--jmc-text-muted)]" />,
                    },
                    {
                      value: 0,
                      label: 'Sadece elle (Manuel)',
                      description: 'Arka plan zamanlayıcısını kapatır',
                      icon: <Clock className="h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />,
                    },
                  ]}
                />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Brain className="h-4 w-4 text-[var(--jmc-primary)]" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--jmc-text)]">
                    Varsayılan AI Çalışma Kipi
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {AI_MODES.map(m => {
                    const Icon = m.icon
                    const active = defaultAiMode === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleAiModeChange(m.id)}
                        className={`flex items-start gap-2 rounded-[var(--jmc-radius-sm)] border p-2 text-left transition-all ${
                          active
                            ? 'border-[var(--jmc-primary)] bg-[var(--jmc-badge-bg)]'
                            : 'border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-elevated)] hover:border-[var(--jmc-border)]'
                        }`}
                      >
                        <Icon
                          className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                            active ? 'text-[var(--jmc-primary)]' : 'text-[var(--jmc-text-dim)]'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold text-[var(--jmc-text)] leading-tight">
                            {m.label}
                          </div>
                          <div className="text-[9.5px] text-[var(--jmc-text-dim)] leading-snug mt-0.5">
                            {m.desc}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Araç İzinleri & Güvenlik Kum Havuzu Özeti */}
          <div className="rounded-[var(--jmc-radius)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]/40 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-[var(--jmc-primary)]" />
                <span className="text-[11.5px] font-semibold text-[var(--jmc-text)]">
                  Yapay Zekâ Araç İzinleri (Kum Havuzu)
                </span>
              </div>
              <span className="text-[10.5px] text-[var(--jmc-text-dim)]">
                İstediğiniz zaman üst çubuktan veya Ayarlar → Güvenlik sekmesinden değiştirebilirsiniz
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { key: 'workspaceRead', label: 'Çalışma Alanı Okuma' },
                  { key: 'webSearch', label: 'Canlı Web Araştırması' },
                  { key: 'fileWrite', label: 'Yerel Dosya Yazma' },
                  { key: 'classroomDraft', label: 'Classroom Taslağı' },
                ] as const
              ).map(item => {
                const enabled = permissions[item.key]
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleTogglePermission(item.key)}
                    className={`flex items-center justify-between rounded-[var(--jmc-radius-sm)] border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                      enabled
                        ? 'border-[var(--jmc-primary)]/50 bg-[var(--jmc-badge-bg)] text-[var(--jmc-text)]'
                        : 'border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-elevated)] text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)]'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    <span
                      className={`ml-1.5 h-2 w-2 shrink-0 rounded-full ${
                        enabled ? 'bg-[var(--jmc-success)]' : 'bg-[var(--jmc-border)]'
                      }`}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* ---------------- Alt Bar ---------------- */}
        <footer className="flex shrink-0 items-center justify-between border-t border-[var(--jmc-border-subtle)] px-6 py-3.5 bg-[var(--jmc-bg)]/50">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose()
                onOpenSettings('providers')
              }}
              className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] px-3 py-1.5 text-[11.5px] text-[var(--jmc-text-muted)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)]"
            >
              Detaylı Ayarlar
            </button>
            <span className="hidden sm:inline text-[11px] text-[var(--jmc-text-dim)]">
              Ayarlar → Hakkında bölümünden bu sihirbaza her zaman ulaşabilirsiniz.
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-4 py-2 text-[12px] font-semibold text-white shadow-[var(--jmc-shadow-md)] transition-[background-color,transform] duration-[var(--jmc-dur)] ease-[var(--jmc-ease)] hover:bg-[var(--jmc-primary-hover)] active:scale-[0.98]"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Kurulumu Tamamla & Başla
          </button>
        </footer>
      </div>
    </div>
  )
}

export default SetupWizard