import React, { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  LayoutTemplate,
  Link2,
  Lock,
  Monitor,
  Rocket,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { AppVersionInfo } from '../../types/jmc'

/**
 * Lucide paketi marka simgelerini icermez; GitHub amblemi elle cizilir.
 * Emoji kullanilmaz.
 */
const GitHubMark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
  /** Kurulum sihirbazini elle yeniden acar. */
  onOpenSetup: () => void
  /** Karşılama rehberini elle yeniden açar. */
  onOpenOnboarding?: () => void
}

const REPO_URL = 'https://github.com/MrSpy00/JustMyClass'
const SITE_URL = 'https://www.aegissoft.com.tr/'

const STACK = [
  { label: 'Masaüstü', value: 'Electron', icon: Monitor },
  { label: 'Arayüz', value: 'React · TypeScript', icon: LayoutTemplate },
  { label: 'Şifreleme', value: 'AES-256-GCM', icon: Lock },
  { label: 'Anahtar kasası', value: 'İşletim sistemi', icon: KeyRound },
  { label: 'Yerel depo', value: 'Şifreli + CAS', icon: ShieldCheck },
]

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  onOpenSetup,
  onOpenOnboarding,
}) => {
  const [info, setInfo] = useState<AppVersionInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void window.jmcAPI
      .getAppVersion()
      .then(v => {
        if (!cancelled) setInfo(v)
      })
      .catch(() => {
        if (!cancelled) setInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const open = (url: string) => {
    void window.jmcAPI.openExternalUrl(url).catch(() => undefined)
  }

  // Tanılama metnini panoya kopyalar. Electron pano modulu ana
  // surecten cagrilir; onceki surum `navigator.clipboard` kullaniyordu ve
  // hata sessizce yutuluyordu.
  const copyDiagnostics = () => {
    if (!info) return
    const text = [
      'JustMyClass — Tanılama Bilgisi',
      `Sürüm: ${info.version} (${info.gitHash})`,
      `Electron: ${info.electronVersion} · Chromium: ${info.chromeVersion} · Node: ${info.nodeVersion}`,
      `Platform: ${info.platform} ${info.arch} · Dil: ${info.locale}`,
      `Veri deposu: ${info.encryption.algorithm} · Anahtar kasası: ${info.encryption.description}`,
      `Donanım korumalı anahtar: ${info.encryption.hardwareProtected ? 'evet' : 'hayır'}`,
      `Kayıtlı anahtar sayısı: ${info.vault.storedKeyCount}`,
      `Depo: ${REPO_URL}`,
      `Geliştirici: ${SITE_URL}`,
    ].join('\n')
    void window.jmcAPI
      .copyText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => setCopied(false))
  }

  const encryption = info?.encryption

  return (
    // Kullanıcı talebi: Boşluğa (backdrop) tıklayınca modal kapanır.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="JustMyClass hakkında"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 backdrop-blur-[3px] p-6 transition-all duration-200 animate-fade-in"
    >
      <div className="relative flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-elevated)] border border-[var(--jmc-border)] shadow-[var(--jmc-shadow-lg)] animate-pop-in">
        <button
          type="button"
          onClick={onClose}
          aria-label="Kapat"
          className="absolute right-3 top-3 z-10 rounded-[var(--jmc-radius)] p-1.5 text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)]"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-6">
          {/* Marka */}
          <header className="flex items-center gap-3.5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-badge-bg)] shadow-[var(--jmc-shadow-sm)]">
              <svg viewBox="0 0 32 32" className="h-6 w-6 text-[var(--jmc-primary)]" aria-hidden>
                <path
                  d="M5 7.5A2.5 2.5 0 0 1 7.5 5h11A2.5 2.5 0 0 1 21 7.5V11h3.5A2.5 2.5 0 0 1 27 13.5v11a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 7 24.5v-13h2.5v13a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5H21V23h-2V7.5a.5.5 0 0 0-.5-.5h-11a.5.5 0 0 0-.5.5V20H5V7.5Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[17px] font-semibold tracking-tight">JustMyClass</h2>
                <span className="rounded-full bg-[var(--jmc-badge-bg)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--jmc-primary)]">
                  {info?.version ?? '—'}
                </span>
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--jmc-text-muted)]">
                Google Classroom için yerel öncelikli, yapay zekâ destekli masaüstü çalışma alanı
              </p>
            </div>
          </header>

          {/* Bağlantılar */}
          <nav className="mt-5 grid gap-1.5 sm:grid-cols-2">
            <LinkCard
              href={REPO_URL}
              label="Kaynak kodu"
              name="MrSpy00 / JustMyClass"
              icon={<GitHubMark className="h-4 w-4" />}
              onOpen={open}
            />
            <LinkCard
              href={SITE_URL}
              label="Geliştirici"
              name="aegisSoft"
              icon={<Link2 className="h-4 w-4" />}
              onOpen={open}
            />
          </nav>

          {/* Sürüm ve yığın */}
          <section className="mt-5">
            <SectionTitle>Build bilgisi</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11.5px]">
              <Row label="Sürüm" value={info?.version ?? '—'} />
              <Row label="Commit" value={info?.gitHash ?? '—'} mono />
              <Row label="Derleme" value={info ? new Date(info.buildDate).toLocaleString('tr-TR') : '—'} />
              <Row label="Platform" value={info ? `${info.platform} · ${info.arch}` : '—'} mono />
              <Row label="Electron" value={info?.electronVersion ?? '—'} mono />
              <Row label="Chromium" value={info?.chromeVersion ?? '—'} mono />
              <Row label="Node" value={info?.nodeVersion ?? '—'} mono />
              <Row label="Arayüz dili" value={info?.locale ?? '—'} mono />
            </dl>
          </section>

          <section className="mt-5">
            <SectionTitle>Teknoloji yığını</SectionTitle>
            <ul className="flex flex-wrap gap-1.5">
              {STACK.map(item => (
                <li
                  key={item.label}
                  className="flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[11px] text-[var(--jmc-text-muted)]"
                >
                  <item.icon className="h-3 w-3 text-[var(--jmc-text-dim)]" />
                  <span className="text-[var(--jmc-text-dim)]">{item.label}</span>
                  <span>{item.value}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Güvenlik — yalnızca ölçülen durum */}
          <section className="mt-5">
            <SectionTitle>Gizlilik ve güvenlik</SectionTitle>
            {encryption ? (
              <div
                className={`flex items-start gap-2.5 rounded-[var(--jmc-radius)] px-3 py-2.5 ${
                  encryption.hardwareProtected
                    ? 'bg-[var(--jmc-bg-surface)]'
                    : 'bg-[var(--jmc-badge-bg)]'
                }`}
              >
                {encryption.hardwareProtected ? (
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--jmc-success)]" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--jmc-warning)]" />
                )}
                <div className="min-w-0 text-[11px] leading-relaxed">
                  <p className="font-medium">
                    {encryption.algorithm} ile şifreli yerel depo
                  </p>
                  <p className="mt-0.5 text-[var(--jmc-text-muted)]">{encryption.description}</p>
                  <p className="mt-0.5 text-[var(--jmc-text-dim)]">
                    Anahtar dosyası sabit bir parola veya ortak bir değerden türetilmez; işletim sistemi
                    kasası tarafından sarmalanarak saklanır.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-[var(--jmc-text-dim)]">Güvenlik durumu okunamadı.</p>
            )}

            <ul className="mt-2.5 space-y-1.5 text-[11px] leading-relaxed text-[var(--jmc-text-muted)]">
              <PrivacyPoint>
                Uygulama gömülü ortak bir API anahtarı taşımaz. Her yapay zekâ sağlayıcısı için anahtarı
                siz girersiniz ve işletim sistemi kasasında saklanır.
              </PrivacyPoint>
              <PrivacyPoint>
                Sınıf, ödev ve ek verileri cihazınızdan çıkmaz; yalnızca sizin istediğinizde, sizin
                seçtiğiniz sağlayıcıya ve seçtiğiniz kaynak parçaları gönderilir.
              </PrivacyPoint>
              <PrivacyPoint>
                Anahtar karakterleri arayüze hiçbir zaman aktarılmaz; arayüz yalnızca varlık durumu
                ve geri döndürülemeyen bir parmak izi görür.
              </PrivacyPoint>
            </ul>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--jmc-border-subtle)] px-6 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyDiagnostics}
              disabled={!info}
              className="flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-2.5 py-1.5 text-[11px] text-[var(--jmc-text-muted)] transition-colors hover:text-[var(--jmc-text)] disabled:opacity-40"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[var(--jmc-success)]" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Kopyalandı' : 'Tanılama bilgisini kopyala'}
            </button>
            {/*
              Kurulum sihirbazini elle yeniden acma.
              Sihirbaz ilk calistirmada gosterilir ve "goruldu" bayragi
              bir kez yazilir. Kullanici daha sonra unutursa ya da
              baska bir konfigurasyonu anlamak isterse buradan
              istedigi zaman tekrar acabilir.
            */}
            {onOpenOnboarding && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenOnboarding()
                }}
                className="flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)]/15 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--jmc-primary)] transition-colors hover:bg-[var(--jmc-primary)]/25"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Karşılama Rehberini Aç
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onClose()
                onOpenSetup()
              }}
              className="flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-2.5 py-1.5 text-[11px] text-[var(--jmc-text-muted)] transition-colors hover:text-[var(--jmc-text)]"
            >
              <Rocket className="h-3.5 w-3.5" />
              Kurulum sihirbazını aç
            </button>
          </div>
          <p className="text-[10.5px] text-[var(--jmc-text-dim)]">
            <span className="text-[var(--jmc-text-muted)]">aegisSoft</span> · MIT Lisanslı
          </p>
        </footer>
      </div>
    </div>
  )
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--jmc-text-dim)]">
    {children}
  </h3>
)

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-baseline justify-between gap-2">
    <dt className="shrink-0 text-[var(--jmc-text-dim)]">{label}</dt>
    <dd className={`truncate text-[var(--jmc-text)] ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
  </div>
)

const PrivacyPoint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex gap-2">
    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--jmc-text-dim)]" />
    <span>{children}</span>
  </li>
)

const LinkCard: React.FC<{
  href: string
  label: string
  name: string
  icon: React.ReactNode
  onOpen: (url: string) => void
}> = ({ href, label, name, icon, onOpen }) => (
  <button
    type="button"
    onClick={() => onOpen(href)}
    className="group flex items-center justify-between gap-3 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-2.5 text-left shadow-[var(--jmc-shadow-sm)] transition-colors hover:bg-[var(--jmc-bg)]"
  >
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-badge-bg)] text-[var(--jmc-primary)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wider text-[var(--jmc-text-dim)]">
          {label}
        </span>
        <span className="block truncate text-[12.5px] font-medium text-[var(--jmc-text)] group-hover:text-[var(--jmc-primary)]">
          {name}
        </span>
      </span>
    </span>
    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--jmc-text-dim)] transition-colors group-hover:text-[var(--jmc-primary)]" />
  </button>
)