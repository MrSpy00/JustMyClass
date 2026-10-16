import React, { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCode2,
  Globe,
  GraduationCap,
  HelpCircle,
  KeyRound,
  Loader2,
  Lock,
  RotateCcw,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react'
import { Account } from '../../types/jmc'
import { useI18n } from '../../i18n/i18nContext'

interface AuthOnboardingModalProps {
  isOpen: boolean
  onClose: () => void
  onLoginSuccess: (account: Account) => void
}

/**
 * Google giriş hatasini, kullaniciya ne yapmasi gerektigini soyleyen
 * tek paragraf lik bir aciklamaya cevirir.
 *
 * Ana surec `explainTokenError` ile ham hata kodlarini (`invalid_client`,
 * `access_denied`, ...) aciklamaya ceviriyor; bu fonksiyon o mesaji
 * kullanicinin tarayicida gordugu ekranla birlestirip, HTML satir
 * sonlari ve teknik ayrintilardan arindirilmis tek bir metin uretir.
 */
function explainLoginError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')

  if (!raw || raw.trim().length === 0) return 'Oturum açma tamamlanamadı.'

  // Kullanici tarayicida hatayi gorduyse (uygulama ekraninda degil),
  // iptal edilmis ya da zaman asimina ugramis olabilir.
  if (/iptal edildi/i.test(raw)) return 'Giriş işlemi iptal edildi.'

  if (/iptal/i.test(raw) && /kapat/i.test(raw)) {
    return 'Giriş penceresi kapatıldı. Lütfen tekrar deneyin.'
  }

  if (/zaman aşımına uğradı|Giriş tamamlanmadı/i.test(raw)) {
    return (
      'Tarayıcıda giriş tamamlanmadı.\n\n' +
      'Tarayıcıda bir hata görüyorsanız — örneğin "Erişim engellendi" veya ' +
      '"OAuth istemcisi bulunamadı" — sorun uygulamada değil, Google Cloud ' +
      'projesindeki OAuth istemcisindedir.\n\n' +
      'Bu durumda aşağıdaki "Google istemci kimliği" bölümünden kendi ' +
      'masaüstü istemci kimliğinizi girebilirsiniz.'
    )
  }

  // Ana surec zaten ayrintili Turkce aciklama uretti; onu oldugu gibi goster.
  return raw
}

/** Google'ın dört renkli resmi vektör amblemi. */
const GoogleMark: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
)

const CLOUD_URLS = {
  console: 'https://console.cloud.google.com/',
  credentials: 'https://console.cloud.google.com/apis/credentials',
  consent: 'https://console.cloud.google.com/apis/credentials/consent',
  classroomApi: 'https://console.cloud.google.com/apis/library/classroom.googleapis.com',
  driveApi: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
}

export const AuthOnboardingModal: React.FC<AuthOnboardingModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
}) => {
  const { t } = useI18n()
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [showManualCode, setShowManualCode] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const [clientIdSaved, setClientIdSaved] = useState(false)
  const [jsonInput, setJsonInput] = useState('')
  const [showJsonModal, setShowJsonModal] = useState(false)
  const [clientValidation, setClientValidation] = useState<{
    valid: boolean
    activeClientId: string
    isCustom?: boolean
    isPlaceholder: boolean
    hasClientSecret?: boolean
    error?: string
  } | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setSuccessNotice(null)
    setClientIdSaved(false)
    let cancelled = false

    void window.jmcAPI
      ?.getClientId()
      .then(saved => {
        if (!cancelled && saved) setClientId(saved)
      })
      .catch(() => undefined)

    void window.jmcAPI
      ?.validateClientId()
      .then(val => {
        if (!cancelled) {
          setClientValidation(val)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [isOpen])

  // Geri sayım sayacı
  useEffect(() => {
    if (!busy) {
      setCountdown(0)
      return
    }
    setCountdown(120)
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          setBusy(false)
          setError('Giriş işlemi zaman aşımına uğradı (120 saniye). Lütfen tekrar deneyin.')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [busy])

  // Güvenli kapatma ve iptal
  const cancelLogin = async () => {
    try {
      await window.jmcAPI?.cancelLogin()
    } catch {
      /* yoksay */
    } finally {
      setBusy(false)
      setCountdown(0)
    }
  }

  const handleModalClose = () => {
    if (busy) {
      void cancelLogin()
    }
    onClose()
  }

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleModalClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, busy])

  if (!isOpen) return null

  const loginWithGoogle = async () => {
    setError(null)
    setSuccessNotice(null)
    setBusy(true)
    try {
      const account = await window.jmcAPI.loginWithGoogle()
      onLoginSuccess(account)
      onClose()
    } catch (err) {
      setError(explainLoginError(err))
    } finally {
      setBusy(false)
    }
  }

  const saveClientId = async () => {
    const value = clientId.trim()
    const secretVal = clientSecret.trim()
    if (!value) {
      setError('İstemci kimliği boş olamaz.')
      return
    }
    try {
      await window.jmcAPI.setClientId(value)
      if (secretVal) {
        await window.jmcAPI.setClientSecret?.(secretVal)
        setClientSecret('')
      }
      const val = await window.jmcAPI.validateClientId(value)
      setClientValidation(val)
      setClientIdSaved(true)
      setError(null)
      setSuccessNotice('İstemci kimliği başarıyla kaydedildi.')
      window.setTimeout(() => {
        setClientIdSaved(false)
        setSuccessNotice(null)
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İstemci kimliği kaydedilemedi.')
    }
  }

  const handleResetCustomClient = async () => {
    try {
      await window.jmcAPI.resetCustomClient?.()
      const saved = await window.jmcAPI.getClientId()
      setClientId(saved || '')
      setClientSecret('')
      const val = await window.jmcAPI.validateClientId()
      setClientValidation(val)
      setError(null)
      setSuccessNotice('Varsayılan yerleşik Google istemcisine sıfırlandı.')
      window.setTimeout(() => setSuccessNotice(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Varsayılan istemciye sıfırlanamadı.')
    }
  }

  const handleImportJson = async () => {
    if (!jsonInput.trim()) return
    try {
      const res = await window.jmcAPI.importGoogleCredentialsJson(jsonInput.trim())
      if (!res.success) {
        setError(res.error || 'JSON kimlik dosyası doğrulanamadı.')
        return
      }
      if (res.clientId) {
        setClientId(res.clientId)
        const val = await window.jmcAPI.validateClientId(res.clientId)
        setClientValidation(val)
      }
      setShowJsonModal(false)
      setJsonInput('')
      setError(null)
      setSuccessNotice('Google Cloud kimlik bilgileri başarıyla içe aktarıldı.')
      window.setTimeout(() => setSuccessNotice(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JSON içe aktarılamadı.')
    }
  }

  const handlePickAndImportFile = async () => {
    try {
      const res = await window.jmcAPI?.pickAndImportCredentialsFile()
      if (!res || !res.success) {
        if (res?.error && res.error !== 'Dosya seçilmedi.') {
          setError(res.error)
        }
        return
      }
      if (res.clientId) {
        setClientId(res.clientId)
        const val = await window.jmcAPI.validateClientId(res.clientId)
        setClientValidation(val)
      }
      setError(null)
      setSuccessNotice('Google Cloud kimlik dosyası başarıyla içe aktarıldı.')
      window.setTimeout(() => setSuccessNotice(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya içe aktarılamadı.')
    }
  }

  const handleManualCodeSubmit = async () => {
    const code = manualCode.trim()
    if (!code) {
      setError('Lütfen tarayıcıdan kopyaladığınız kodu veya URL\'yi girin.')
      return
    }
    setManualBusy(true)
    setError(null)
    try {
      const account = await window.jmcAPI.completeAuthWithCode(code)
      onLoginSuccess(account)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yetkilendirme kodu doğrulanamadı.')
    } finally {
      setManualBusy(false)
    }
  }

  const openUrl = (url: string) => {
    void window.jmcAPI?.openExternalUrl(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
  }

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('auth.title')}
      onClick={e => {
        if (e.target === e.currentTarget) handleModalClose()
      }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-[4px] px-4 py-6 transition-all duration-200 animate-fade-in"
    >
      <div className="relative flex max-h-[94vh] w-full max-w-lg flex-col overflow-y-auto rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-elevated)] p-6 shadow-[var(--jmc-shadow-lg)] border border-[var(--jmc-border)] transition-all duration-200 animate-pop-in">
        {/* Kapatma Butonu */}
        <button
          type="button"
          onClick={handleModalClose}
          aria-label={t('settings.cancel')}
          className="absolute right-4 top-4 rounded-[var(--jmc-radius)] p-1.5 text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)] active:scale-[0.96]"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Başlık ve İkon */}
        <header className="pr-8">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)]">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">{t('auth.title')}</h2>
              <span className="text-[11px] font-mono text-[var(--jmc-primary)]">Google Classroom & Drive Bağlantısı</span>
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
            Öğrenci veya üniversite (.edu / .edu.tr / küresel) Google hesabınızla oturum açarak sınıflarınızı, ödevlerinizi, teslimlerinizi ve Drive materyallerinizi güvenle bağlayın.
          </p>
        </header>

        {/* Hata Bildirim Alanı */}
        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-danger)]/10 px-3.5 py-3 text-[11.5px] leading-relaxed text-[var(--jmc-danger)] border border-[var(--jmc-danger)]/25 animate-fade-in"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <span className="font-medium">{error}</span>
            </div>
          </div>
        )}

        {/* Başarı Bildirim Alanı */}
        {successNotice && (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-success)]/10 px-3.5 py-2.5 text-[11.5px] font-medium text-[var(--jmc-success)] border border-[var(--jmc-success)]/25 animate-fade-in"
          >
            <Check className="h-4 w-4 shrink-0" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* Canlı Giriş Bölümü */}
        <div className="mt-4 space-y-4 animate-fade-in">
          {/* Ana Giriş Butonu veya Onay Bekleme / İptal Alanı */}
          <div>
            {busy ? (
              <div className="space-y-2.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] p-3.5 border border-[var(--jmc-primary)]/30 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--jmc-primary)]" />
                    <span className="text-[12.5px] font-medium text-[var(--jmc-text)]">
                      {t('auth.openingBrowser')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-mono text-[var(--jmc-primary)]">
                    <Clock className="h-3 w-3" />
                    <span>{formatCountdown(countdown)}</span>
                  </div>
                </div>
                <p className="text-[10.5px] text-[var(--jmc-text-muted)] leading-relaxed">
                  Tarayıcınızda Google hesap seçim ve izin penceresi açıldı. İzin verdiğinizde oturumunuz JustMyClass'e anında aktarılacaktır.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelLogin}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--jmc-radius)] bg-red-500/15 py-2 text-[12px] font-medium text-red-400 hover:bg-red-500/25 transition-colors border border-red-500/30"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>{t('auth.cancel')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualCode(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-3 py-2 text-[11px] font-medium text-[var(--jmc-text)] border border-[var(--jmc-border)] hover:bg-[var(--jmc-bg-surface)]"
                  >
                    Kodu Elle Yapıştır
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={loginWithGoogle}
                  className="inline-flex w-full items-center justify-center gap-2.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-4 py-3 text-[13.5px] font-semibold text-white transition-all duration-150 hover:bg-[var(--jmc-primary-hover)] active:scale-[0.98] shadow-md hover:shadow-lg"
                >
                  <GoogleMark className="h-5 w-5" />
                  <span>{t('auth.continueGoogle')}</span>
                </button>
                <div className="flex items-center justify-between gap-1.5 text-[11px] px-2.5 py-1.5 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg)] border border-[var(--jmc-border-subtle)] text-[var(--jmc-text-dim)]">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-[var(--jmc-primary)] shrink-0" />
                    <span className="truncate">
                      {clientValidation?.isCustom
                        ? `Özel İstemci Devrede (${clientValidation.activeClientId.slice(0, 16)}...)`
                        : clientValidation?.activeClientId
                          ? `Uygulama İstemcisi Devrede (${clientValidation.activeClientId.slice(0, 16)}...)`
                          : 'İstemci Kimliği Bulunamadı'}
                    </span>
                    {clientValidation?.valid && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-medium ${
                          clientValidation.hasClientSecret
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                        }`}
                      >
                        {clientValidation.hasClientSecret ? 'Secret Hazır' : 'Secret Eksik'}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handlePickAndImportFile}
                    className="shrink-0 text-[10.5px] font-medium text-[var(--jmc-primary)] hover:underline ml-1"
                  >
                    JSON Seç
                  </button>
                </div>

                <div className="pt-1 flex justify-center">
                  <button
                    type="button"
                    onClick={handleModalClose}
                    className="text-[11.5px] text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] transition-colors underline underline-offset-4 decoration-dotted"
                  >
                    Hesap bağlamadan devam et (Çevrimdışı Çalışma Alanı)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Manuel Kod Girişi (Alternatif) */}
          {showManualCode && (
            <div className="rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] p-3.5 border border-[var(--jmc-border-subtle)] space-y-2 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-medium text-[var(--jmc-text)]">
                  Yetkilendirme Kodu veya Geri Dönüş URL'si ile Giriş
                </span>
                <button
                  type="button"
                  onClick={() => setShowManualCode(false)}
                  className="text-[11px] text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)]"
                >
                  Kapat
                </button>
              </div>
              <p className="text-[10.5px] text-[var(--jmc-text-muted)] leading-relaxed">
                Yerel güvenlik duvarı veya port engeli nedeniyle geri dönüş yakalanamazsa, tarayıcınızın adres çubuğundaki URL'yi veya <code className="font-mono text-[var(--jmc-primary)]">code=</code> parametresini buraya yapıştırabilirsiniz.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="http://127.0.0.1:... veya 4/0A..."
                  value={manualCode}
                  onChange={e => setManualCode(e.target.value)}
                  className="min-w-0 flex-1 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-3 py-1.5 font-mono text-[11px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
                />
                <button
                  type="button"
                  onClick={handleManualCodeSubmit}
                  disabled={manualBusy || !manualCode.trim()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3 py-1.5 text-[11.5px] font-medium text-white transition-colors hover:bg-[var(--jmc-primary-hover)] disabled:opacity-60"
                >
                  {manualBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Giriş Yap'}
                </button>
              </div>
            </div>
          )}

          {/* Güvenlik Notları */}
          <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
            <li className="flex gap-2 items-center">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--jmc-success)]" />
              <span>Google Classroom dersleri ve ödevleri doğrudan resmi Google API'lerinden çekilir.</span>
            </li>
            <li className="flex gap-2 items-center">
              <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--jmc-primary)]" />
              <span>Erişim belirteçleri yalnızca cihazınızın işletim sistemi kasasında (DPAPI) şifreli tutulur.</span>
            </li>
          </ul>

          {/* Google Cloud Client ID Yapılandırma Akordeonu (İsteğe Bağlı) */}
          <div className="rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] p-3.5 border border-[var(--jmc-border-subtle)]">
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              aria-expanded={showAdvanced}
              className="flex w-full items-center justify-between gap-2 text-left text-[12px] font-medium text-[var(--jmc-text-muted)] transition-colors hover:text-[var(--jmc-text)]"
            >
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-[var(--jmc-primary)]" />
                <span>Gelişmiş: Kendi Google Cloud İstemcinizi Kullanın (İsteğe Bağlı)</span>
              </span>
              {showAdvanced ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 pt-2 border-t border-[var(--jmc-border-subtle)] animate-fade-in">
                {clientValidation && (
                  <div className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded bg-[var(--jmc-bg)] border border-[var(--jmc-border-subtle)]">
                    <span className="text-[var(--jmc-text-dim)]">Aktif İstemci Durumu:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[10.5px] text-[var(--jmc-primary)]">
                        {clientValidation.valid
                          ? clientValidation.isCustom
                            ? 'Özel Kurumsal İstemci Aktif'
                            : 'Resmi Yerleşik İstemci Aktif (Varsayılan)'
                          : 'Ayarlanmadı'}
                      </span>
                      {clientValidation.isCustom && (
                        <button
                          type="button"
                          onClick={handleResetCustomClient}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--jmc-text-muted)] hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)] border border-[var(--jmc-border)]"
                          title="Özel istemciyi sil ve yerleşik .env istemcisine dön"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          <span>Varsayılana Sıfırla</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <p className="text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
                  Varsayılan olarak <code className="font-mono text-[var(--jmc-primary)]">.env</code> ile yapılandırılan yerleşik masaüstü istemcisi kullanılır. İsteğe bağlı olarak kendi Google Cloud Console projenizin <strong>Masaüstü Uygulaması (Desktop App)</strong> Client ID + Client Secret bilgilerini girebilir veya JSON dosyanızı seçebilirsiniz:
                </p>

                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      id="jmc-client-id"
                      type="text"
                      spellCheck={false}
                      placeholder="Client ID: ...apps.googleusercontent.com"
                      value={clientId}
                      onChange={e => setClientId(e.target.value)}
                      className="min-w-0 flex-1 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-3 py-1.5 font-mono text-[11px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
                    />
                    <button
                      type="button"
                      onClick={saveClientId}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text)] border border-[var(--jmc-border)] transition-colors hover:bg-[var(--jmc-bg)] active:scale-[0.97]"
                    >
                      {clientIdSaved && <Check className="h-3 w-3 text-[var(--jmc-success)]" />}
                      {clientIdSaved ? t('auth.clientSaved') : t('auth.saveClient')}
                    </button>
                  </div>
                  <input
                    id="jmc-client-secret"
                    type="password"
                    spellCheck={false}
                    placeholder={
                      clientValidation?.hasClientSecret
                        ? 'Client Secret: Kasada kayıtlı (güncellemek için GOCSPX-... girin)'
                        : 'Client Secret (Masaüstü OAuth için zorunlu: GOCSPX-...)'
                    }
                    value={clientSecret}
                    onChange={e => setClientSecret(e.target.value)}
                    className="w-full rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-3 py-1.5 font-mono text-[11px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePickAndImportFile}
                      className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg)] px-2.5 py-1 text-[11px] text-[var(--jmc-text)] border border-[var(--jmc-border)] hover:bg-[var(--jmc-bg-surface)] font-medium transition-colors"
                      title="Google Cloud Console'dan indirdiğiniz client_secret_*.json dosyasını doğrudan seçin"
                    >
                      <FileCode2 className="h-3.5 w-3.5 text-[var(--jmc-primary)]" />
                      <span>Dosya Seç (.json)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowJsonModal(true)}
                      className="inline-flex items-center gap-1 text-[11px] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] font-medium"
                    >
                      <span>Yapıştır</span>
                    </button>
                  </div>

                  {/* Rehber Butonu */}
                  <button
                    type="button"
                    onClick={() => setShowGuide(v => !v)}
                    className="flex items-center gap-1.5 text-[11px] text-[var(--jmc-primary)] hover:underline font-medium"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span>Kurulum Rehberi</span>
                    {showGuide ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                </div>

                {/* 5 Adımlı İnteraktif Kurulum Rehberi */}
                {showGuide && (
                  <div className="space-y-2 rounded-lg bg-[var(--jmc-bg)] p-3 text-[11px] text-[var(--jmc-text-muted)] border border-[var(--jmc-border-subtle)] animate-fade-in">
                    <div className="rounded bg-[var(--jmc-badge-bg)] p-2 text-[10.5px] text-[var(--jmc-primary)] font-medium">
                      Google Classroom ve Google Drive API servislerinin projenizde etkinleştirildiğinden emin olun.
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--jmc-primary)] text-[9px] font-bold text-white">
                        1
                      </span>
                      <div>
                        <span>Google Cloud Console'a gidin ve yeni bir proje oluşturun:</span>
                        <button
                          type="button"
                          onClick={() => openUrl(CLOUD_URLS.console)}
                          className="ml-1.5 inline-flex items-center gap-0.5 text-[var(--jmc-primary)] hover:underline"
                        >
                          Cloud Console <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--jmc-primary)] text-[9px] font-bold text-white">
                        2
                      </span>
                      <div>
                        <span>Classroom ve Drive API servislerini etkinleştirin:</span>
                        <div className="mt-1 flex gap-2">
                          <button
                            type="button"
                            onClick={() => openUrl(CLOUD_URLS.classroomApi)}
                            className="inline-flex items-center gap-0.5 text-[var(--jmc-primary)] hover:underline"
                          >
                            Classroom API <ExternalLink className="h-2.5 w-2.5" />
                          </button>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() => openUrl(CLOUD_URLS.driveApi)}
                            className="inline-flex items-center gap-0.5 text-[var(--jmc-primary)] hover:underline"
                          >
                            Drive API <ExternalLink className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--jmc-primary)] text-[9px] font-bold text-white">
                        3
                      </span>
                      <div>
                        <span>OAuth Onay Ekranını yapılandırın (Harici veya Dahili):</span>
                        <button
                          type="button"
                          onClick={() => openUrl(CLOUD_URLS.consent)}
                          className="ml-1.5 inline-flex items-center gap-0.5 text-[var(--jmc-primary)] hover:underline"
                        >
                          İzin Ekranı <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--jmc-primary)] text-[9px] font-bold text-white">
                        4
                      </span>
                      <div>
                        <span><strong>Kimlik Bilgisi Oluştur &gt; OAuth İstemci Kimliği &gt; Masaüstü Uygulaması (Desktop App)</strong> seçin:</span>
                        <button
                          type="button"
                          onClick={() => openUrl(CLOUD_URLS.credentials)}
                          className="ml-1.5 inline-flex items-center gap-0.5 text-[var(--jmc-primary)] hover:underline"
                        >
                          Kimlik Bilgileri <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--jmc-primary)] text-[9px] font-bold text-white">
                        5
                      </span>
                      <div>
                        <span>Oluşturulan Client ID'yi kopyalayıp yukarıdaki kutuya yapıştırın ve Kaydet'e basın.</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* JSON Kimlik Giriş Modal Katmanı */}
        {showJsonModal && (
          <div className="fixed inset-0 z-60 grid place-items-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
            <div className="w-full max-w-md rounded-xl bg-[var(--jmc-bg-elevated)] p-5 border border-[var(--jmc-border)] shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[var(--jmc-text)]">
                  Google Cloud JSON Kimliği İçe Aktar
                </span>
                <button
                  type="button"
                  onClick={() => setShowJsonModal(false)}
                  className="rounded p-1 text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[11px] text-[var(--jmc-text-muted)]">
                Google Cloud Console'dan indirdiğiniz <code className="font-mono text-[var(--jmc-primary)]">client_secret_....json</code> dosyasının içeriğini buraya yapıştırın:
              </p>
              <textarea
                rows={6}
                value={jsonInput}
                onChange={e => setJsonInput(e.target.value)}
                placeholder='{"installed": {"client_id": "...", ...}}'
                className="w-full rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] p-2.5 font-mono text-[10.5px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)] resize-none"
              />
              <div className="flex justify-between items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowJsonModal(false)
                    void handlePickAndImportFile()
                  }}
                  className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] text-[var(--jmc-primary)] hover:bg-[var(--jmc-bg)] border border-[var(--jmc-border)] transition-colors font-medium"
                >
                  <FileCode2 className="h-3.5 w-3.5" />
                  <span>Dosyadan Seç...</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowJsonModal(false)}
                    className="rounded px-3 py-1.5 text-[11px] text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)]"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    onClick={handleImportJson}
                    disabled={!jsonInput.trim()}
                    className="rounded bg-[var(--jmc-primary)] px-3.5 py-1.5 text-[11.5px] font-medium text-white hover:bg-[var(--jmc-primary-hover)] disabled:opacity-50"
                  >
                    İçe Aktar ve Kaydet
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alt Buton: Şimdilik Atla */}
        <button
          type="button"
          onClick={handleModalClose}
          className="mt-4 w-full rounded-[var(--jmc-radius)] px-4 py-2 text-[11.5px] text-[var(--jmc-text-dim)] transition-colors hover:text-[var(--jmc-text)] active:scale-[0.99]"
        >
          {t('auth.skipForNow')}
        </button>
      </div>
    </div>
  )
}