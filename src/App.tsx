import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { ThemeProvider } from './themes/ThemeContext'
import { I18nProvider } from './i18n/i18nContext'
import { AppLayout } from './layouts/AppLayout'
import { SettingsModal } from './features/settings/SettingsModal'
import { AboutModal } from './features/about/AboutModal'
import { AuthOnboardingModal } from './features/auth/AuthOnboardingModal'
import { SetupWizard } from './features/setup/SetupWizard'
import { WelcomeOnboardingModal } from './features/setup/WelcomeOnboardingModal'
import { TitleBar } from './components/TitleBar'
import { Account, UpdateStatus } from './types/jmc'
import { ACCOUNT_CHANGED_EVENT } from './lib/events'

type ToastKind = 'success' | 'error'

interface Toast {
  id: number
  kind: ToastKind
  text: string
}

/** Ekranın alt ortasında gösterilen, kapatılabilir yumuşak bildirim. */
const Toast: React.FC<{ toast: Toast; onDismiss: () => void }> = ({ toast, onDismiss }) => (
  <div
    role="status"
    aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    className="animate-pop-in fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex max-w-md w-auto items-center gap-3 rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)]/60 bg-[var(--jmc-bg-elevated)]/95 px-4 py-2.5 text-[12.5px] leading-snug text-[var(--jmc-text)] shadow-[var(--jmc-shadow-xl)] backdrop-blur-md pointer-events-auto transition-all"
  >
    {toast.kind === 'error' ? (
      <AlertTriangle
        className="h-4 w-4 shrink-0 text-[var(--jmc-danger-text)]"
        aria-hidden="true"
      />
    ) : (
      <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--jmc-success-text)]" aria-hidden="true" />
    )}
    <span className="min-w-0 flex-1 font-medium">{toast.text}</span>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Bildirimi kapat"
      className="-mr-1 shrink-0 rounded-[var(--jmc-radius-sm)] p-1 text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)]"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" fill="none">
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  </div>
)

type SettingsTabId =
  | 'providers'
  | 'appearance'
  | 'account'
  | 'sync'
  | 'tools'
  | 'language'
  | 'privacy'
  | 'update'

const VALID_SETTINGS_TABS: readonly SettingsTabId[] = [
  'providers',
  'appearance',
  'account',
  'sync',
  'tools',
  'language',
  'privacy',
  'update',
]

function resolveSettingsTab(tab?: unknown): SettingsTabId {
  if (typeof tab === 'string' && (VALID_SETTINGS_TABS as readonly string[]).includes(tab)) {
    return tab as SettingsTabId
  }
  return 'providers'
}

export const App: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('providers')
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  /*
    Ilk yuklemeye ve calistirmaya ozel 5 sayfalik animasyonlu karsilama rehberi.
    Goruldu bilgisi hem yerel depoda ('setup.onboardingCompleted') hem de
    localStorage'da ('jmc_onboarding_v2_seen') tutulur. Ilk yuklemede acilir,
    ayrica Hakkinda uzerinden istedigi zaman yeniden acilabilir.
  */
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => {
    try {
      return localStorage.getItem('jmc_onboarding_v2_seen') !== 'true'
    } catch {
      return false
    }
  })

  /*
    Kurulum sihirbazi (Ayarlar -> Hakkinda uzerinden manuel erisilebilir).
  */
  const [isSetupOpen, setIsSetupOpen] = useState(false)
  const [dataPath, setDataPath] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsSetupOpen(false)
    localStorage.setItem('jmc_setup_wizard_seen', 'true')
    void window.jmcAPI?.setSetting('setup.wizardSeen', true).catch(() => undefined)

    void window.jmcAPI
      ?.getSetting<boolean>('setup.onboardingCompleted', false)
      .then(done => {
        if (!cancelled && done) {
          setIsOnboardingOpen(false)
          localStorage.setItem('jmc_onboarding_v2_seen', 'true')
        }
      })
      .catch(() => undefined)

    void window.jmcAPI
      ?.getDataPath()
      .then(p => {
        if (!cancelled) setDataPath(p.userData)
      })
      .catch(() => undefined)
    void window.jmcAPI
      ?.getUpdateStatus()
      .then(s => {
        if (!cancelled) setUpdateStatus(s)
      })
      .catch(() => undefined)
    const off = window.jmcAPI?.onUpdateStatus?.(s => setUpdateStatus(s))
    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  const closeSetup = useCallback(() => {
    setIsSetupOpen(false)
    localStorage.setItem('jmc_setup_wizard_seen', 'true')
    void window.jmcAPI?.setSetting('setup.wizardSeen', true).catch(() => undefined)
  }, [])

  const closeOnboarding = useCallback(() => {
    setIsOnboardingOpen(false)
    localStorage.setItem('jmc_onboarding_v2_seen', 'true')
    void window.jmcAPI?.setSetting('setup.onboardingCompleted', true).catch(() => undefined)
  }, [])

  const toastId = useRef(0)
  const toastTimer = useRef<number | null>(null)

  const notify = useCallback((kind: ToastKind, text: string) => {
    toastId.current += 1
    setToast({ id: toastId.current, kind, text })
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => {
      setToast(prev => (prev?.id === toastId.current ? null : prev))
      toastTimer.current = null
    }, kind === 'error' ? 9000 : 4000)
  }, [])

  const dismissToast = useCallback(() => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = null
    setToast(null)
  }, [])

  // Uygulama kapanirken bekleyen zamanlayiciyi temizle.
  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    },
    [],
  )

  const handleExport = useCallback(
    async (format: 'csv' | 'json' | 'markdown' | 'anki') => {
      try {
        const res = await window.jmcAPI.exportCourseData(format)
        notify('success', `Dışa aktarma tamamlandı: ${res.filePath}`)
      } catch (err) {
        notify('error', `Dışa aktarma başarısız: ${err instanceof Error ? err.message : 'bilinmeyen hata'}`)
      }
    },
    [notify],
  )

  const handleLoginSuccess = useCallback(
    (account: Account) => {
      const who = account.displayName || account.email
      notify('success', `Google Classroom bağlantısı kuruldu: ${who}`)
      // Hesap ve ders listesini tazelemek AppLayout'un sorumluluğunda.
      window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT))
    },
    [notify],
  )

  return (
    <ThemeProvider>
      <I18nProvider>
        <div className="relative flex h-screen w-screen flex-col overflow-hidden font-sans bg-[var(--jmc-bg)]">
          <TitleBar />
          <div className="relative flex-1 min-h-0 w-full overflow-hidden">
            {toast && <Toast toast={toast} onDismiss={dismissToast} />}

            <AppLayout
              onOpenSettings={(tab) => {
                setSettingsTab(resolveSettingsTab(tab))
                setIsSettingsOpen(true)
              }}
              onOpenAbout={() => setIsAboutOpen(true)}
              onOpenAuth={() => setIsAuthOpen(true)}
              onExport={handleExport}
              onNotify={notify}
            />
          </div>

          <SettingsModal
            isOpen={isSettingsOpen}
            initialTab={settingsTab}
            onClose={() => setIsSettingsOpen(false)}
            onOpenAbout={() => {
              setIsSettingsOpen(false)
              setIsAboutOpen(true)
            }}
            onOpenAuth={() => {
              setIsSettingsOpen(false)
              setIsAuthOpen(true)
            }}
          />

          <AuthOnboardingModal
            isOpen={isAuthOpen}
            onClose={() => setIsAuthOpen(false)}
            onLoginSuccess={handleLoginSuccess}
          />

          <AboutModal
            isOpen={isAboutOpen}
            onClose={() => setIsAboutOpen(false)}
            onOpenSetup={() => {
              setIsAboutOpen(false)
              setIsSetupOpen(true)
            }}
            onOpenOnboarding={() => {
              setIsAboutOpen(false)
              setIsOnboardingOpen(true)
            }}
          />

          {isOnboardingOpen && (
            <WelcomeOnboardingModal
              isOpen
              onClose={closeOnboarding}
              onOpenSettings={tab => {
                closeOnboarding()
                setSettingsTab(resolveSettingsTab(tab))
                setIsSettingsOpen(true)
              }}
              onOpenAuth={() => {
                closeOnboarding()
                setIsAuthOpen(true)
              }}
            />
          )}

          {isSetupOpen && (
            <SetupWizard
              isOpen
              onClose={closeSetup}
              onOpenSettings={tab => {
                closeSetup()
                setSettingsTab(resolveSettingsTab(tab))
                setIsSettingsOpen(true)
              }}
              onOpenAuth={() => {
                closeSetup()
                setIsAuthOpen(true)
              }}
              updateStatus={updateStatus}
              dataPathLabel={dataPath || '—'}
            />
          )}
        </div>
      </I18nProvider>
    </ThemeProvider>
  )
}