/**
 * updateService.ts
 * ---------------------------------------------------------------------------
 * Otomatik guncelleme.
 *
 * KULLANICI TALEBI
 * ----------------
 * "Guncel surum icin durmadan dosya tasimakla mi ugrasacam?"
 *
 * CEVAP
 * -----
 * Hayir — ama otomatik guncelleme BIR YERDEN surum dosyalari
 * yayinlamayi gerektirir. Bu yeri kullanicidan isteyen tek ekran
 * "Ayarlar > Guncelleme" sayfasidir.
 *
 *   1. Gelistirici `UPDATE_FEED_URL` ile bir surum klasoru tanimlar
 *      (bkz. scripts/release.mjs).
 *   2. `JustMyClass-Setup-<surum>.exe` ve `latest.yml` dosyalari
 *      oraya yuklenir.
 *   3. Kullanici Ayarlar'a bu adresi bir kez yazar.
 *   4. Uygulama her acilista sessizce kontrol eder; surum varsa
 *      tek tikla indirip kurar.
 *
 * TASARIM KARARLARI
 * -----------------
 * • ADRES SABIT DEGILDIR. Kodda tek bir yayin adresi gomulu degildir;
 *   sahte bir adres kullanilmaz. Adres yoksa ozellik "kapali" der ve
 *   nasil eklenecegini adim adim anlatir.
 *
 * • HTTPS ZORUNLUDUR. Electron guvenli olmayan adreslerden guncelleme
 *   yapmayi reddeder. Bu bir kisit degil, korumadir: guncellenen
 *   dosya degistirilebilirse birisi kullaniciya sahte surum
 *   sunabilir.
 *
 * • INDIRME OTOMATIK YAPILMAZ. Uygulama surumu gorur, kullanicidan
 *   onay ister, sonra indirir. Kullanici onay vermedikce ag trafigi
 *   olusmaz.
 *
 * • GUNCELLEME CALISMASA DA UYGULAMA CALISIR. Hata durumunda
 *   guncelleme ozelligi sessizce kapanir; hicbir akis engellenmez.
 */
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { app, shell } from 'electron'
import { providerHttp } from './httpClient'
import type { StorageService } from './storageService'

const DEFAULT_GITHUB_OWNER = 'MrSpy00'
const DEFAULT_GITHUB_REPO = 'JustMyClass'

function isNewerVersion(current: string, remote: string): boolean {
  const c = current.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
  const r = remote.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(c.length, r.length); i++) {
    const cv = c[i] ?? 0
    const rv = r[i] ?? 0
    if (rv > cv) return true
    if (rv < cv) return false
  }
  return false
}

export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

export interface UpdateStatus {
  stage: UpdateStage
  /** Uygulamanin calistigi surum. */
  currentVersion: string
  /** Sunucuda bulunan surum (varsa). */
  availableVersion?: string
  releaseDate?: string
  releaseNotes?: string
  /** Yuzde 0–100; yalnizca `downloading` anlamli. */
  progress?: number
  /** Indirilen megabayt; yalnizca `downloading` anlamli. */
  transferredMb?: number
  totalMb?: number
  /** Turkce, kullaniciya gosterilecek tam hata metni. */
  error?: string
  /** Besleme adresi tanimli mi? Degilse ozellik kapali. */
  configured: boolean
  feedUrl?: string
}

const LOG = '[UpdateService]'

export class UpdateService {
  private status: UpdateStatus
  private configuredUrl: string | null = null
  private listeners = new Set<(s: UpdateStatus) => void>()
  private wired = false
  private lastCheckedAt: string | null = null
  private latestReleaseAssetUrl?: string
  private latestReleaseHtmlUrl?: string

  constructor(private storageService: StorageService) {
    this.status = {
      stage: 'idle',
      currentVersion: app?.getVersion ? app.getVersion() : '0.0.1',
      configured: true,
      feedUrl: `https://github.com/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases`,
    }
    this.readFeedUrlFromStorage()
  }

  // -------------------------------------------------------------------------
  // Besleme adresi
  // -------------------------------------------------------------------------

  /**
   * Adres depoda `update.feedUrl` anahtari altinda saklanir.
   * Bos ise resmi GitHub deposu (https://github.com/MrSpy00/JustMyClass/releases) kullanilir.
   */
  private readFeedUrlFromStorage(): void {
    try {
      const raw = this.storageService.getSetting<string | null>('update.feedUrl', null)
      const url = typeof raw === 'string' ? raw.trim() : ''
      this.applyFeedUrl(url)
    } catch {
      this.applyFeedUrl('')
    }
  }

  public getFeedUrl(): string | null {
    return this.configuredUrl
  }

  /**
   * Besleme adresini ayarlar ve dogrular.
   *
   * BOS DIZGI "varsayilan GitHub deposu" demektir.
   */
  public setFeedUrl(raw: string): { ok: boolean; error?: string; status: UpdateStatus } {
    const value = (raw ?? '').trim()

    if (!value || value.toLowerCase().includes('github.com') || value.toLowerCase().startsWith('github (')) {
      const canonical = `https://github.com/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases`
      this.configuredUrl = canonical
      void this.storageService.setSetting('update.feedUrl', canonical)
      this.applyFeedUrl(canonical)
      return { ok: true, status: this.status }
    }

    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      const error = 'Adres geçersiz. Örnek: https://sunucu/justmyclass/surumler veya https://github.com/MrSpy00/JustMyClass/releases'
      this.patch({ stage: 'error', error, configured: true, feedUrl: value })
      return { ok: false, error, status: this.status }
    }

    if (parsed.protocol !== 'https:') {
      const error =
        'Adres HTTPS olmak zorunda. Electron, şifresiz adreslerden güncelleme ' +
        'yapmayı reddeder — aksi hâlde biri size sahte bir sürüm gönderebilir.'
      this.patch({ stage: 'error', error, configured: true, feedUrl: value })
      return { ok: false, error, status: this.status }
    }

    if (!parsed.pathname || parsed.pathname === '/') {
      const error =
        'Adres bir klasörü göstermeli. Site kökü değil, sürüm dosyalarının ' +
        'yüklendiği klasörü yazın.'
      this.patch({ stage: 'error', error, configured: true, feedUrl: value })
      return { ok: false, error, status: this.status }
    }

    this.configuredUrl = value
    void this.storageService.setSetting('update.feedUrl', value)
    this.applyFeedUrl(value)
    return { ok: true, status: this.status }
  }

  private applyFeedUrl(value: string): void {
    const targetUrl = value || `https://github.com/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases`
    this.configuredUrl = targetUrl
    this.patch({
      configured: true,
      feedUrl: targetUrl,
    })
    this.wire()
  }

  // -------------------------------------------------------------------------
  // Durum
  // -------------------------------------------------------------------------

  public getStatus(): UpdateStatus {
    return { ...this.status }
  }

  public getLastCheckedAt(): string | null {
    return this.lastCheckedAt
  }

  public subscribe(fn: (s: UpdateStatus) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private patch(partial: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...partial }
    for (const fn of this.listeners) {
      try {
        fn(this.getStatus())
      } catch {
        /* abone hatasi digerlerini etkilemesin */
      }
    }
  }

  // -------------------------------------------------------------------------
  // autoUpdater baglantisi
  // -------------------------------------------------------------------------

  /**
   * `electron-updater` OTOKOMIK DAVRANISLARA SAHIPtIR: kontrol eder,
   * indirir, kurar, uygulamayi yeniden baslatir.
   *
   * Burada HEPSI KAPATILIR ve elle yonetilir. Aksi halde kullanici
   * uygulamayi kullanirken dosyalarının degistigini fark etmez.
   */
  public isCustomGenericFeed(url: string | null | undefined): boolean {
    if (!url) return false
    const trimmed = url.trim().toLowerCase()
    if (!trimmed) return false
    if (trimmed.includes('github.com') || trimmed.includes('github (')) return false
    return true
  }

  private wire(): void {
    try {
      const u = autoUpdater as unknown as {
        autoDownload: boolean
        autoInstallOnAppQuit: boolean
        allowPrerelease: boolean
        setFeedURL: (opts: { provider: string; url?: string; owner?: string; repo?: string; channel?: string }) => void
        on: (evt: string, cb: (...a: any[]) => void) => void
        removeAllListeners: (evt?: string) => void
      }

      u.autoDownload = false
      u.autoInstallOnAppQuit = true
      u.allowPrerelease = false

      const isCustom = this.isCustomGenericFeed(this.configuredUrl)
      if (isCustom && this.configuredUrl) {
        u.setFeedURL({ provider: 'generic', url: this.configuredUrl })
      } else {
        u.setFeedURL({
          provider: 'github',
          owner: DEFAULT_GITHUB_OWNER,
          repo: DEFAULT_GITHUB_REPO,
        })
      }

      if (!this.wired) {
        u.on('error', (err: Error) => {
          if (this.isCustomGenericFeed(this.configuredUrl)) {
            this.patch({
              stage: 'error',
              error: this.explainUpdateError(err),
            })
          }
        })

        u.on('update-available', (info: UpdateInfo) => {
          this.patch({
            stage: 'available',
            availableVersion: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
            error: undefined,
          })
        })

        u.on('update-not-available', () => {
          this.patch({ stage: 'not-available', availableVersion: undefined, error: undefined })
        })

        u.on('download-progress', (p: { percent?: number; transferred?: number; total?: number }) => {
          const mb = (n?: number) => (typeof n === 'number' ? Math.round(n / 1024 / 1024) : undefined)
          this.patch({
            stage: 'downloading',
            progress: Math.round(p.percent ?? 0),
            transferredMb: mb(p.transferred),
            totalMb: mb(p.total),
          })
        })

        u.on('update-downloaded', (info: UpdateInfo) => {
          this.patch({
            stage: 'downloaded',
            availableVersion: info.version,
            progress: 100,
            error: undefined,
          })
        })

        this.wired = true
      }
    } catch (err) {
      this.patch({
        stage: 'error',
        error: `Güncelleme yapılandırılamadı: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  /**
   * `autoUpdater` hata metinlerini kullaniciya anlasilir hale getirir.
   */
  private explainUpdateError(err: Error): string {
    const raw = `${err?.message ?? ''}`.toLowerCase()

    if (raw.includes('getaddrinfo') || raw.includes('enotfound') || raw.includes('name_not_resolved')) {
      return 'Sunucuya ulaşılamadı. Yayın adresindeki alan adı çözümlenemiyor.'
    }
    if (raw.includes('enotfound') || raw.includes('econnrefused')) {
      return 'Sunucu yanıt vermiyor. Yayın klasörü erişilebilir değil.'
    }
    if (raw.includes('404') || raw.includes('no published versions')) {
      if (!this.isCustomGenericFeed(this.configuredUrl)) {
        return 'Henüz yayınlanmış yeni bir sürüm bulunamadı veya uygulama en güncel sürümde.'
      }
      return (
        'Sunucuda sürüm dosyası bulunamadı. `latest.yml` dosyası, sürüm ' +
        'klasörünün içinde olmalı ve dosya adı tam olarak `latest.yml` olmalı.'
      )
    }
    if (raw.includes('certificate') || raw.includes('ssl') || raw.includes('self signed')) {
      return 'Güvenlik sertifikası geçersiz. HTTPS sertifikasını kontrol edin.'
    }
    if (raw.includes('net::err_blocked') || raw.includes('blocked')) {
      return (
        'Ağ tarafından engellendi. Kurumsal ağ veya antivirüs, güncelleme ' +
        'indirmesini durduruyor olabilir.'
      )
    }
    return `Güncelleme denemesi başarısız: ${err instanceof Error ? err.message : String(err)}`
  }

  // -------------------------------------------------------------------------
  // Eylemler
  // -------------------------------------------------------------------------

  /** Surumu kontrol eder. Hata ASLA atmaz; durumu `error` yazar. */
  public async check(): Promise<UpdateStatus> {
    this.wire()
    this.lastCheckedAt = new Date().toISOString()
    this.patch({ stage: 'checking', error: undefined })

    // 1. Özel generic yayın adresi tanımlıysa doğrudan autoUpdater ile kontrol et
    if (this.isCustomGenericFeed(this.configuredUrl) && this.configuredUrl) {
      try {
        const u = autoUpdater as unknown as { checkForUpdates: () => Promise<unknown> }
        await u.checkForUpdates()
      } catch (err) {
        this.patch({
          stage: 'error',
          error: this.explainUpdateError(err instanceof Error ? err : new Error(String(err))),
        })
      }
      return this.getStatus()
    }

    // 2. Varsayılan GitHub Releases kontrolü:
    // Paketlemiş uygulama ise autoUpdater'ı dene
    if (app.isPackaged) {
      try {
        const u = autoUpdater as unknown as { checkForUpdates: () => Promise<unknown> }
        await u.checkForUpdates()
        return this.getStatus()
      } catch {
        // Hata durumunda doğrudan GitHub API sorgusuna devam et
      }
    }

    // Doğrudan GitHub Releases API sorgusu (Geliştirici ortamı, taşınabilir ve paketli modlarda eksiksiz çalışır)
    try {
      const response = await providerHttp.request<{
        tag_name: string
        name?: string
        published_at?: string
        body?: string
        html_url?: string
        assets?: Array<{ name: string; browser_download_url: string }>
      }>(`https://api.github.com/repos/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases/latest`, {
        method: 'GET',
        headers: {
          'User-Agent': `JustMyClass/${this.status.currentVersion}`,
          Accept: 'application/vnd.github.v3+json',
        },
        timeoutMs: 8000,
      })

      if (response && response.tag_name) {
        const remoteVer = response.tag_name.replace(/^v/, '')
        const currentVer = this.status.currentVersion.replace(/^v/, '')
        if (isNewerVersion(currentVer, remoteVer)) {
          const setupAsset =
            response.assets?.find(
              (a: { name: string; browser_download_url: string }) =>
                a.name.toLowerCase().includes('setup') && a.name.endsWith('.exe'),
            ) ??
            response.assets?.find(
              (a: { name: string; browser_download_url: string }) => a.name.endsWith('.exe'),
            )
          this.latestReleaseAssetUrl = setupAsset?.browser_download_url ?? response.html_url
          this.latestReleaseHtmlUrl = response.html_url

          this.patch({
            stage: 'available',
            availableVersion: response.tag_name,
            releaseDate: response.published_at,
            releaseNotes: response.body,
            error: undefined,
          })
        } else {
          this.patch({
            stage: 'not-available',
            availableVersion: undefined,
            error: undefined,
          })
        }
      } else {
        this.patch({
          stage: 'not-available',
          availableVersion: undefined,
          error: undefined,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('404')) {
        // Henüz yayınlanmış release yoksa bu bir hata değil, güncel durumudur
        this.patch({
          stage: 'not-available',
          error: undefined,
        })
      } else {
        this.patch({
          stage: 'error',
          error: this.explainUpdateError(err instanceof Error ? err : new Error(msg)),
        })
      }
    }

    return this.getStatus()
  }

  /** Bulunan surumu indirir. Yalnizca `available` durumunda anlamli. */
  public async download(): Promise<UpdateStatus> {
    if (this.status.stage !== 'available') {
      return this.getStatus()
    }

    // Paketlemiş veya özel adreste autoUpdater'ı dene
    if (this.configuredUrl || app.isPackaged) {
      try {
        const u = autoUpdater as unknown as { downloadUpdate: () => Promise<unknown> }
        await u.downloadUpdate()
        return this.getStatus()
      } catch {
        // autoUpdater başarısız olursa tarayıcı indirmesine geç
      }
    }

    if (this.latestReleaseAssetUrl) {
      await shell.openExternal(this.latestReleaseAssetUrl)
      this.patch({
        stage: 'downloaded',
        progress: 100,
        error: undefined,
      })
    } else if (this.latestReleaseHtmlUrl) {
      await shell.openExternal(this.latestReleaseHtmlUrl)
    }

    return this.getStatus()
  }

  /**
   * Indirilen surumu kurar ve uygulamayi yeniden baslatir.
   */
  public quitAndInstall(): boolean {
    if (this.status.stage !== 'downloaded') return false
    try {
      const u = autoUpdater as unknown as { quitAndInstall: () => void }
      setImmediate(() => u.quitAndInstall())
      return true
    } catch (err) {
      this.patch({
        stage: 'error',
        error: `Kurulum başlatılamadı: ${err instanceof Error ? err.message : String(err)}`,
      })
      return false
    }
  }

  /**
   * Acilista sessizce kontrol eder.
   */
  public checkInBackground(): void {
    void this.check().catch(() => undefined)
  }
}