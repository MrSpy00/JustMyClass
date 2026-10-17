import React, { useState, useEffect } from 'react'
import {
  GraduationCap,
  ShieldCheck,
  Lock,
  KeyRound,
  Brain,
  Sparkles,
  FileCheck,
  HelpCircle,
  Folder,
  FolderOpen,
  Download,
  ChevronLeft,
  ChevronRight,
  Check,
  ExternalLink,
  Layers,
  Globe,
  RefreshCw,
  Cpu,
  Eye,
  Palette,
  Clock,
  X,
  Zap,
  CheckCircle2,
  ArrowRight,
  BookOpen,
  FileCode,
  FileSpreadsheet,
  Presentation,
  CheckCircle,
} from 'lucide-react'
import type { ProviderId, ThemeName } from '../../types/jmc'
import { useTheme } from '../../themes/ThemeContext'
import { PROVIDERS_CHANGED_EVENT, AUTOSYNC_CHANGED_EVENT } from '../../lib/events'

interface WelcomeOnboardingModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenSettings?: (tab?: string) => void
  onOpenAuth?: () => void
}

const FEATURED_THEMES: { name: ThemeName; label: string; bg: string; accent: string }[] = [
  { name: 'Neon Dreams', label: 'Neon Dreams', bg: '#0b0f19', accent: '#6366f1' },
  { name: 'Dark', label: 'Koyu Klasik', bg: '#121212', accent: '#3b82f6' },
  { name: 'Abyss', label: 'Derin Gece', bg: '#05070d', accent: '#8b5cf6' },
  { name: 'Cyberpunk', label: 'Cyberpunk', bg: '#0d0d15', accent: '#ec4899' },
  { name: 'Ocean', label: 'Okyanus', bg: '#091826', accent: '#06b6d4' },
  { name: 'Forest', label: 'Zümrüt Yeşil', bg: '#0a1a12', accent: '#10b981' },
  { name: 'Graphite', label: 'Grafit Gri', bg: '#1e2024', accent: '#94a3b8' },
  { name: 'Light', label: 'Açık Mod', bg: '#f8fafc', accent: '#4f46e5' },
]

export const WelcomeOnboardingModal: React.FC<WelcomeOnboardingModalProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onOpenAuth,
}) => {
  const { theme, setTheme } = useTheme()
  const [currentPage, setCurrentPage] = useState<number>(0)
  const totalPages = 5

  // Ayarlar
  const [autoSyncMinutes, setAutoSyncMinutes] = useState<number>(5)
  const [downloadsPath, setDownloadsPath] = useState<string>('')
  const [quickApiKey, setQuickApiKey] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('gemini')
  const [savingKey, setSavingKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    if (window.jmcAPI?.getDownloadsConfig) {
      window.jmcAPI.getDownloadsConfig().then(cfg => {
        setDownloadsPath(cfg.currentPath)
      }).catch(() => {})
    }
    if (window.jmcAPI?.getSetting) {
      window.jmcAPI.getSetting<number>('autoSyncMinutes', 5).then(m => {
        if (typeof m === 'number') setAutoSyncMinutes(m)
      }).catch(() => {})
    }
  }, [isOpen])

  // ESC ve Ok Tuşları ile Navigasyon
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleFinish()
      } else if (e.key === 'ArrowRight' && currentPage < totalPages - 1) {
        setCurrentPage(prev => prev + 1)
      } else if (e.key === 'ArrowLeft' && currentPage > 0) {
        setCurrentPage(prev => prev - 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, currentPage, totalPages])

  if (!isOpen) return null

  const handleFinish = () => {
    localStorage.setItem('jmc_onboarding_v2_seen', 'true')
    localStorage.setItem('jmc_setup_wizard_seen', 'true')
    void window.jmcAPI?.setSetting('setup.onboardingCompleted', true).catch(() => {})
    void window.jmcAPI?.setSetting('setup.wizardSeen', true).catch(() => {})
    onClose()
  }

  const handleSaveQuickKey = async () => {
    const trimmed = quickApiKey.trim()
    if (!trimmed || !window.jmcAPI) return
    setSavingKey(true)
    try {
      await window.jmcAPI.saveProviderKey(selectedProvider, trimmed)
      setKeySaved(true)
      window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT))
      setTimeout(() => setKeySaved(false), 3000)
    } finally {
      setSavingKey(false)
    }
  }

  const handlePickDownloadsFolder = async () => {
    if (!window.jmcAPI?.selectDownloadsFolder) return
    try {
      const res = await window.jmcAPI.selectDownloadsFolder()
      if (res) setDownloadsPath(res.currentPath)
    } catch {
      /* yoksay */
    }
  }

  const handleAutoSyncChange = async (min: number) => {
    setAutoSyncMinutes(min)
    await window.jmcAPI?.setSetting('autoSyncMinutes', min)
    window.dispatchEvent(new CustomEvent(AUTOSYNC_CHANGED_EVENT, { detail: { minutes: min } }))
  }

  const openUrl = (url: string) => {
    void window.jmcAPI?.openExternalUrl(url).catch(() => {})
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="JustMyClass Hoş Geldiniz"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 transition-all duration-300 animate-fade-in"
      onClick={e => {
        if (e.target === e.currentTarget) handleFinish()
      }}
    >
      <div className="relative flex flex-col h-[90vh] w-full max-w-4xl overflow-hidden rounded-[var(--jmc-radius-xl)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] shadow-[var(--jmc-shadow-xl)] transition-all animate-pop-in">
        {/* Üst Bar: Logo, Sayfa Başlığı & Kapat Butonu */}
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)]/70 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-badge-bg)] text-[var(--jmc-primary)] shadow-sm">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[16px] font-bold tracking-tight text-[var(--jmc-text)]">
                  JustMyClass Rehberi
                </h1>
                <span className="rounded-full bg-[var(--jmc-primary)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--jmc-primary)]">
                  Adım {currentPage + 1} / {totalPages}
                </span>
              </div>
              <p className="text-[11.5px] text-[var(--jmc-text-muted)]">
                {currentPage === 0 && 'Genel Bakış & Güvenli Yerel Mimari'}
                {currentPage === 1 && 'Google Classroom Bağlantısı & Otomatik Eşitleme'}
                {currentPage === 2 && 'Yapay Zekâ & API Anahtarları Rehberi'}
                {currentPage === 3 && 'Akademik Asistan, Hafıza & Dahili Görüntüleyici'}
                {currentPage === 4 && 'Kişiselleştirme & Hemen Başlayın'}
              </p>
            </div>
          </div>

          {/* Sayfa Gösterge Çubukları */}
          <div className="hidden sm:flex items-center gap-1.5">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentPage(i)}
                aria-label={`Sayfa ${i + 1}`}
                className={`h-2 rounded-full transition-all duration-300 ${
                  currentPage === i
                    ? 'w-7 bg-[var(--jmc-primary)]'
                    : 'w-2 bg-[var(--jmc-border)] hover:bg-[var(--jmc-text-dim)]'
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleFinish}
            title="Kapat ve Çalışma Alanına Geç"
            className="rounded-[var(--jmc-radius)] p-1.5 text-[var(--jmc-text-dim)] hover:bg-[var(--jmc-bg)] hover:text-[var(--jmc-text)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Ana İçerik Alanı (Animasyonlu Sayfa Geçişleri) */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6 md:p-8">
          {/* ================= SAYFA 1: GENEL BAKIŞ & GÜVENLİK ================= */}
          {currentPage === 0 && (
            <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
              <div className="text-center space-y-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--jmc-primary)]/15 px-3 py-1 text-[11px] font-semibold text-[var(--jmc-primary)]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Maksimum Gizlilik ve Güvenlik
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--jmc-text)]">
                  JustMyClass'a Hoş Geldiniz
                </h2>
                <p className="text-[13px] leading-relaxed text-[var(--jmc-text-muted)] max-w-xl mx-auto">
                  Google Classroom deneyiminizi hızlandıran, tüm derslerinizi çevrimdışı önbelleğe alan ve güçlü yapay zekâ asistanlarıyla donatılmış bağımsız masaüstü çalışma alanınız.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center gap-2.5 text-[var(--jmc-primary)]">
                    <ShieldCheck className="h-5 w-5" />
                    <h3 className="text-[13.5px] font-semibold text-[var(--jmc-text)]">
                      %100 Yerel Öncelikli (Local-First)
                    </h3>
                  </div>
                  <p className="text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                    Verileriniz herhangi bir üçüncü taraf sunucuya veya bulut veritabanına aktarılmaz. Tüm sınıf özetleri, materyaller ve ödevler cihazınızda saklanır.
                  </p>
                </div>

                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center gap-2.5 text-emerald-400">
                    <Lock className="h-5 w-5" />
                    <h3 className="text-[13.5px] font-semibold text-[var(--jmc-text)]">
                      AES-256-GCM ve İşletim Sistemi Kasası
                    </h3>
                  </div>
                  <p className="text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                    Yerel veritabanınız endüstri standardı AES-256-GCM ile şifrelenir. Anahtarlarınız ise Windows DPAPI / macOS Keychain donanım korumalı kasasında saklanır.
                  </p>
                </div>

                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center gap-2.5 text-amber-400">
                    <Zap className="h-5 w-5" />
                    <h3 className="text-[13.5px] font-semibold text-[var(--jmc-text)]">
                      Hızlı ve Çevrimdışı Çalışma
                    </h3>
                  </div>
                  <p className="text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                    İnternet bağlantınız kopsa bile önceden eşitlenmiş tüm ders notlarınıza, ödevlerinize ve eklerinize milisaniyeler içinde anında erişebilirsiniz.
                  </p>
                </div>

                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center gap-2.5 text-indigo-400">
                    <Eye className="h-5 w-5" />
                    <h3 className="text-[13.5px] font-semibold text-[var(--jmc-text)]">
                      Sıfır Telemetri ve Sıfır İzleme
                    </h3>
                  </div>
                  <p className="text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                    Kullanım alışkanlıklarınız, ödev içerikleriniz veya kişisel verileriniz asla kaydedilmez ya da üçüncü taraflarla paylaşılmaz.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ================= SAYFA 2: CLASSROOM BAĞLANTISI ================= */}
          {currentPage === 1 && (
            <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
              <div className="text-center space-y-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-3 py-1 text-[11px] font-semibold text-blue-400">
                  <Globe className="h-3.5 w-3.5" />
                  Google Entegrasyonu
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--jmc-text)]">
                  Google Classroom Nasıl Bağlanır?
                </h2>
                <p className="text-[13px] leading-relaxed text-[var(--jmc-text-muted)] max-w-xl mx-auto">
                  Okul/üniversite (.edu) hesabınızla veya kişisel hesabınızla resmi Google OAuth2 loopback üzerinden güvenle bağlanın.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3.5 rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)] font-bold text-[13px]">
                    1
                  </div>
                  <div>
                    <h4 className="text-[13px] font-semibold text-[var(--jmc-text)]">
                      "Google ile Bağlan" Butonuna Basın
                    </h4>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                      Uygulama veya sol paneldeki giriş butonuna bastığınızda varsayılan tarayıcınızda resmi Google giriş sayfası açılır. Hiçbir şifreniz JustMyClass'a girilmez.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)] font-bold text-[13px]">
                    2
                  </div>
                  <div>
                    <h4 className="text-[13px] font-semibold text-[var(--jmc-text)]">
                      Derslerinizin Bulunduğu Hesabı Seçin
                    </h4>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                      Okulunuzun verdiği Google Workspace for Education (.edu) veya kişisel hesabınızı seçip Google Classroom okuma izinlerini onaylayın.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)] font-bold text-[13px]">
                    3
                  </div>
                  <div>
                    <h4 className="text-[13px] font-semibold text-[var(--jmc-text)]">
                      Otomatik Algılama ve Arka Plan Eşitlemesi
                    </h4>
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                      Yetkilendirme bittiğinde tarayıcı güvenli döngüyle masaüstü uygulamasına döner. Uygulama bağlantıyı algılar ve tüm sınıflarınızı, ödevlerinizi ve notlarınızı otomatik senkronize eder.
                    </p>
                  </div>
                </div>
              </div>

              {onOpenAuth && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      onOpenAuth()
                    }}
                    className="inline-flex items-center gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-5 py-2.5 text-[12.5px] font-semibold text-white shadow-md hover:bg-[var(--jmc-primary-hover)] active:scale-95 transition-all"
                  >
                    <Globe className="h-4 w-4" />
                    <span>Google Hesabını Şimdi Bağla</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ================= SAYFA 3: YAPAY ZEKÂ REHBERİ ================= */}
          {currentPage === 2 && (
            <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
              <div className="text-center space-y-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/15 px-3 py-1 text-[11px] font-semibold text-purple-400">
                  <Brain className="h-3.5 w-3.5" />
                  Yapay Zekâ Motorları
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--jmc-text)]">
                  API Anahtarı Nereden Alınır & Nasıl Girilir?
                </h2>
                <p className="text-[13px] leading-relaxed text-[var(--jmc-text-muted)] max-w-xl mx-auto">
                  Google Gemini (ücretsiz), DeepSeek, OpenAI, Claude veya bilgisayarınızda çevrimdışı çalışan yerel modeller.
                </p>
              </div>

              {/* Sağlayıcı Kartları */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-primary)]/40 bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-[13px] text-[var(--jmc-text)]">
                      <Sparkles className="h-4 w-4 text-[var(--jmc-primary)]" />
                      <span>Google Gemini (Önerilen)</span>
                    </div>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">Ücretsiz Kota</span>
                  </div>
                  <p className="text-[11.5px] text-[var(--jmc-text-muted)] leading-relaxed">
                    Hızlı, akıllı ve PDF/resim okuyabilen <code className="text-[var(--jmc-primary)] font-mono">gemini-2.0-flash</code> modeli için tek tıkla anahtar alın.
                  </p>
                  <button
                    type="button"
                    onClick={() => openUrl('https://aistudio.google.com/app/apikey')}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--jmc-link)] hover:underline"
                  >
                    <span>aistudio.google.com'dan Anahtar Al</span>
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>

                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-[13px] text-[var(--jmc-text)]">
                      <Cpu className="h-4 w-4 text-pink-400" />
                      <span>DeepSeek & Groq</span>
                    </div>
                    <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">Akıl Yürütme / Hız</span>
                  </div>
                  <p className="text-[11.5px] text-[var(--jmc-text-muted)] leading-relaxed">
                    Matematik ve derin ödev analizi için <code className="text-pink-400 font-mono">deepseek-reasoner (R1)</code> veya Groq ile saniyede 500 token hızında Llama modelleri.
                  </p>
                  <div className="flex gap-3 text-[11px] font-semibold text-[var(--jmc-text-dim)]">
                    <button type="button" onClick={() => openUrl('https://platform.deepseek.com/')} className="hover:text-[var(--jmc-text)] inline-flex items-center gap-1">
                      <span>DeepSeek</span> <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                    <button type="button" onClick={() => openUrl('https://console.groq.com/keys')} className="hover:text-[var(--jmc-text)] inline-flex items-center gap-1">
                      <span>Groq Cloud</span> <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>

                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-[13px] text-[var(--jmc-text)]">
                    <KeyRound className="h-4 w-4 text-emerald-400" />
                    <span>OpenAI & Anthropic Claude</span>
                  </div>
                  <p className="text-[11.5px] text-[var(--jmc-text-muted)] leading-relaxed">
                    GPT-4o veya Claude 3.7 Sonnet modelleri ile akademik makale ve deneme yazımı.
                  </p>
                  <div className="flex gap-3 text-[11px] font-semibold text-[var(--jmc-text-dim)]">
                    <button type="button" onClick={() => openUrl('https://platform.openai.com/api-keys')} className="hover:text-[var(--jmc-text)] inline-flex items-center gap-1">
                      <span>OpenAI Keys</span> <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                    <button type="button" onClick={() => openUrl('https://console.anthropic.com/settings/keys')} className="hover:text-[var(--jmc-text)] inline-flex items-center gap-1">
                      <span>Claude Console</span> <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>

                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-[13px] text-[var(--jmc-text)]">
                    <Brain className="h-4 w-4 text-amber-400" />
                    <span>Ollama & LM Studio (Bionic)</span>
                  </div>
                  <p className="text-[11.5px] text-[var(--jmc-text-muted)] leading-relaxed">
                    Tamamen yerel ve çevrimdışı model çalıştırma. Hiçbir API anahtarı veya internet gerekmez; kendi GPU'nuzda çalışır.
                  </p>
                  <div className="flex gap-3 text-[11px] font-semibold text-[var(--jmc-text-dim)]">
                    <button type="button" onClick={() => openUrl('https://ollama.com/download')} className="hover:text-[var(--jmc-text)] inline-flex items-center gap-1">
                      <span>Ollama</span> <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                    <button type="button" onClick={() => openUrl('https://lmstudio.ai/')} className="hover:text-[var(--jmc-text)] inline-flex items-center gap-1">
                      <span>LM Studio (Bionic)</span> <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Hızlı Anahtar Giriş Alanı */}
              <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-[var(--jmc-text)]">Hızlı Anahtar Tanımla:</span>
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSelectedProvider('gemini')}
                      className={`px-2 py-0.5 rounded ${selectedProvider === 'gemini' ? 'bg-[var(--jmc-primary)] text-white' : 'text-[var(--jmc-text-muted)]'}`}
                    >
                      Gemini
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedProvider('openai')}
                      className={`px-2 py-0.5 rounded ${selectedProvider === 'openai' ? 'bg-[var(--jmc-primary)] text-white' : 'text-[var(--jmc-text-muted)]'}`}
                    >
                      OpenAI
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedProvider('deepseek')}
                      className={`px-2 py-0.5 rounded ${selectedProvider === 'deepseek' ? 'bg-[var(--jmc-primary)] text-white' : 'text-[var(--jmc-text-muted)]'}`}
                    >
                      DeepSeek
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder={`${selectedProvider} API anahtarını buraya yapıştırın...`}
                    value={quickApiKey}
                    onChange={e => setQuickApiKey(e.target.value)}
                    className="flex-1 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 font-mono text-[11.5px] border border-[var(--jmc-border)] text-[var(--jmc-text)] outline-none focus:border-[var(--jmc-primary)]"
                  />
                  <button
                    type="button"
                    onClick={handleSaveQuickKey}
                    disabled={savingKey || !quickApiKey.trim()}
                    className="rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3.5 py-1.5 text-[11.5px] font-medium text-white hover:bg-[var(--jmc-primary-hover)] transition-colors disabled:opacity-40"
                  >
                    {savingKey ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                </div>
                {keySaved && (
                  <p className="text-[11px] text-[var(--jmc-success)] font-medium flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Anahtar güvenli işletim sistemi kasasına kaydedildi!
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ================= SAYFA 4: ASİSTAN & VIEWER ================= */}
          {currentPage === 3 && (
            <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
              <div className="text-center space-y-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-400">
                  <Layers className="h-3.5 w-3.5" />
                  Öğrenme & Araştırma Araçları
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--jmc-text)]">
                  Akademik Asistan, Hafıza & Dahili Görüntüleyici
                </h2>
                <p className="text-[13px] leading-relaxed text-[var(--jmc-text-muted)] max-w-xl mx-auto">
                  5 uzmanlaşmış asistan modu, kişisel tercihlerinizi unutmayan hafıza sistemi ve 50+ dosya formatını uygulama içinde açan önizleyici.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-2">
                {/* Asistan Modları */}
                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center gap-2 text-[var(--jmc-primary)] font-semibold text-[13px]">
                    <Sparkles className="h-4 w-4" />
                    <span>5 Asistan Modu</span>
                  </div>
                  <ul className="space-y-2 text-[11.5px] text-[var(--jmc-text-muted)]">
                    <li><strong className="text-[var(--jmc-text)]">Sokratik:</strong> Doğrudan cevap vermez, sorularla düşündürür.</li>
                    <li><strong className="text-[var(--jmc-text)]">Taslak:</strong> Akademik ödev yapısı ve iskelet oluşturur.</li>
                    <li><strong className="text-[var(--jmc-text)]">Rubrik:</strong> Kriterlere göre ödev puanınızı denetler.</li>
                    <li><strong className="text-[var(--jmc-text)]">Sınav:</strong> Materyallerden pratik sorular türetir.</li>
                  </ul>
                </div>

                {/* JustMyClassMemory */}
                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center gap-2 text-purple-400 font-semibold text-[13px]">
                    <Brain className="h-4 w-4" />
                    <span>JustMyClass Hafıza & Taste</span>
                  </div>
                  <p className="text-[11.5px] text-[var(--jmc-text-muted)] leading-relaxed">
                    Çalışma tarzınızı, çözüm kurallarınızı (örneğin "Her zaman Türkçe açıkla, formülleri KaTeX ile yaz") hem tüm oturumlarda kalıcı olarak (Global) hem de o sohbete özel (Session) hatırlar.
                  </p>
                </div>

                {/* Dahili Belge Görüntüleyici */}
                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-4 space-y-2">
                  <div className="flex items-center gap-2 text-amber-400 font-semibold text-[13px]">
                    <BookOpen className="h-4 w-4" />
                    <span>Dahili Belge Görüntüleyici</span>
                  </div>
                  <p className="text-[11.5px] text-[var(--jmc-text-muted)] leading-relaxed">
                    PDF, DOCX, XLSX/CSV tabloları, PPTX slaytları, kod dosyaları (syntax highlighting ile) ve resimleri harici hiçbir yere yönlendirmeden içeride açar; anında arama, kopyalama ve tek tıkla indirme sağlar.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ================= SAYFA 5: KİŞİSELLEŞTİRME & BAŞLA ================= */}
          {currentPage === 4 && (
            <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
              <div className="text-center space-y-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-400">
                  <Palette className="h-3.5 w-3.5" />
                  Kişiselleştirme
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--jmc-text)]">
                  Hazırsınız! Çalışma Alanınızı Özelleştirin
                </h2>
                <p className="text-[13px] leading-relaxed text-[var(--jmc-text-muted)] max-w-xl mx-auto">
                  Göz zevkinize uygun temayı ve senkronizasyon ayarlarınızı belirleyin, ardından hemen başlayın.
                </p>
              </div>

              {/* Tema Seçici */}
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-[var(--jmc-text)] flex items-center gap-2">
                  <Palette className="h-3.5 w-3.5 text-[var(--jmc-primary)]" />
                  <span>Görünüm Teması Seçin:</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {FEATURED_THEMES.map(th => {
                    const isSelected = theme === th.name
                    return (
                      <button
                        key={th.name}
                        type="button"
                        onClick={() => setTheme(th.name)}
                        className={`flex items-center gap-2 rounded-[var(--jmc-radius)] border p-2.5 text-left text-[11.5px] transition-all ${
                          isSelected
                            ? 'border-[var(--jmc-primary)] bg-[var(--jmc-primary)]/15 shadow-sm font-semibold text-[var(--jmc-text)]'
                            : 'border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)] hover:border-[var(--jmc-primary)]/50'
                        }`}
                      >
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-white/20 shrink-0"
                          style={{ backgroundColor: th.accent }}
                        />
                        <span className="truncate">{th.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Otomatik Eşitleme Aralığı & İndirilenler Klasörü */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-3.5 space-y-2">
                  <label className="text-[12px] font-semibold text-[var(--jmc-text)] flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[var(--jmc-primary)]" />
                    <span>Otomatik Eşitleme Aralığı</span>
                  </label>
                  <p className="text-[11px] text-[var(--jmc-text-muted)]">
                    Uygulama açıkken Classroom ödev ve notlarınızı periyodik olarak arka planda günceller.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {[5, 10, 15, 30, 0].map(min => (
                      <button
                        key={min}
                        type="button"
                        onClick={() => void handleAutoSyncChange(min)}
                        className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          autoSyncMinutes === min
                            ? 'bg-[var(--jmc-primary)] text-white'
                            : 'bg-[var(--jmc-bg)] border border-[var(--jmc-border)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                        }`}
                      >
                        {min === 0 ? 'Elle' : `${min} dk`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] p-3.5 space-y-2">
                  <label className="text-[12px] font-semibold text-[var(--jmc-text)] flex items-center gap-1.5">
                    <Folder className="h-3.5 w-3.5 text-amber-400" />
                    <span>İndirilenler Klasörü</span>
                  </label>
                  <p className="text-[11px] text-[var(--jmc-text-muted)]">
                    İndirilen ders belgeleri ve ödev ekleri bu klasöre kaydedilir.
                  </p>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span
                      className="min-w-0 flex-1 truncate rounded bg-[var(--jmc-bg)] px-2 py-1 font-mono text-[10.5px] border border-[var(--jmc-border)] text-[var(--jmc-text)]"
                      title={downloadsPath || 'Varsayılan'}
                    >
                      {downloadsPath || 'Downloads/JustMyClass'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handlePickDownloadsFolder()}
                      className="rounded bg-[var(--jmc-bg-surface)] border border-[var(--jmc-border)] px-2 py-1 text-[11px] font-medium text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] transition-colors shrink-0"
                    >
                      Gözat
                    </button>
                  </div>
                </div>
              </div>

              {/* Başlama Butonları */}
              <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
                {onOpenAuth && (
                  <button
                    type="button"
                    onClick={() => {
                      handleFinish()
                      onOpenAuth()
                    }}
                    className="inline-flex items-center gap-2 rounded-[var(--jmc-radius)] border border-[var(--jmc-primary)] bg-[var(--jmc-primary)]/10 px-5 py-2.5 text-[12.5px] font-semibold text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/20 transition-all"
                  >
                    <Globe className="h-4 w-4" />
                    <span>Google Hesabını Bağla</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleFinish}
                  className="inline-flex items-center gap-2 rounded-[var(--jmc-radius)] bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-6 py-2.5 text-[12.5px] font-semibold text-white shadow-lg hover:opacity-95 active:scale-95 transition-all"
                >
                  <span>Çalışma Alanına Başla</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Alt Navigasyon Çubuğu: Geri / İleri Butonları */}
        <footer className="flex shrink-0 items-center justify-between border-t border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)]/70 px-6 py-3.5">
          <div>
            {currentPage > 0 ? (
              <button
                type="button"
                onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-3.5 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-border-subtle)] transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Geri</span>
              </button>
            ) : (
              <span className="text-[11px] text-[var(--jmc-text-dim)]">
                Kılavuzda gezinmek için ok tuşlarını kullanabilirsiniz.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {currentPage < totalPages - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-4 py-1.5 text-[11.5px] font-semibold text-white hover:bg-[var(--jmc-primary-hover)] transition-colors active:scale-95"
              >
                <span>İleri</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-success)] px-4 py-1.5 text-[11.5px] font-semibold text-white hover:opacity-95 transition-all active:scale-95"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Tamamla</span>
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
