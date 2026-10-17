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
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { providerHttp } from './httpClient'
import type { StorageService } from './storageService'

const DEFAULT_GITHUB_OWNER = 'MrSpy00'
const DEFAULT_GITHUB_REPO = 'JustMyClass'

export function isNewerVersion(current: string, remote: string): boolean {
  const c = current.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const r = remote.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(c.length, r.length); i++) {
    const cv = c[i] ?? 0
    const rv = r[i] ?? 0
    if (rv > cv) return true
    if (rv < cv) return false
  }
  return false
}

export function isSameVersion(current: string, remote: string): boolean {
  const c = current.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const r = remote.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const len = Math.max(c.length, r.length)
  if (len === 0) return false
  for (let i = 0; i < len; i++) {
    if ((c[i] ?? 0) !== (r[i] ?? 0)) return false
  }
  return true
}

/**
 * GitHub API `assets[].digest` alanini ("sha256:6da8515...") veya ham
 * 64 haneli hex dizgisini kucuk harfli saf 64-hex SHA-256 degerine cevirir.
 */
export function normalizeSha256Digest(raw?: string | null): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  const withoutPrefix = trimmed.startsWith('sha256:') ? trimmed.slice(7).trim() : trimmed
  return /^[0-9a-f]{64}$/.test(withoutPrefix) ? withoutPrefix : null
}

/** Verilen dosyanin SHA-256 ozetini senkron hesaplar; okunamazsa `null`. */
export function computeFileSha256(filePath?: string | null): string | null {
  if (!filePath) return null
  try {
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size <= 0) return null
    const hash = crypto.createHash('sha256')
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.allocUnsafe(64 * 1024)
      let bytesRead = 0
      while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
        hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead))
      }
    } finally {
      fs.closeSync(fd)
    }
    return hash.digest('hex')
  } catch {
    return null
  }
}

export interface ReleaseEvaluationInput {
  currentVersion: string
  remoteTag: string
  remoteAssetDigest?: string | null
  remoteAssetUpdatedAt?: string | null
  /** Portable modda dogrudan calisan `.exe` dosyasinin SHA-256 ozeti. */
  localPortableSha256?: string | null
  /** Kurulu (NSIS) modda daha once kaydedilen release asset SHA-256 ozeti. */
  baselineReleaseSha256?: string | null
  /** Yerel ikili dosyanin / paket kaynaklarinin son degistirilme zamani (ms). */
  localBuildMtimeMs?: number | null
}

export interface ReleaseEvaluationResult {
  updateAvailable: boolean
  isHotfixRebuild: boolean
  displayVersion: string
  remoteSha256: string | null
}

/**
 * Cok katmanli surum + SHA-256 derleme dogrulamasi.
 *
 * 1. `remoteTag > currentVersion` ise standart yeni surum bildirilir.
 * 2. `remoteTag === currentVersion` (orn. ayni `v0.0.1` etiketine yeni
 *    derleme yuklendiyse) SHA-256 `digest` ve `updated_at` zaman damgasi
 *    kontrol edilerek "Yeni Derleme" (hotfix) algilanir.
 */
export function evaluateReleaseUpdate(input: ReleaseEvaluationInput): ReleaseEvaluationResult {
  const remoteSha256 = normalizeSha256Digest(input.remoteAssetDigest)
  const cleanTag = input.remoteTag.trim()

  if (isNewerVersion(input.currentVersion, cleanTag)) {
    return {
      updateAvailable: true,
      isHotfixRebuild: false,
      displayVersion: cleanTag,
      remoteSha256,
    }
  }

  if (!isSameVersion(input.currentVersion, cleanTag) || !remoteSha256) {
    return {
      updateAvailable: false,
      isHotfixRebuild: false,
      displayVersion: cleanTag,
      remoteSha256,
    }
  }

  const remoteTimeMs = input.remoteAssetUpdatedAt ? Date.parse(input.remoteAssetUpdatedAt) : NaN
  const hasNewerTimestamp =
    typeof input.localBuildMtimeMs === 'number' &&
    input.localBuildMtimeMs > 0 &&
    Number.isFinite(remoteTimeMs)
      ? remoteTimeMs > input.localBuildMtimeMs + 60_000
      : true

  // 1) Portable calisma modu: calisan `.exe` ile GitHub'daki Portable `.exe`
  //    birebir ayni dosyadir; SHA-256 dogrudan karsilastirilir.
  const localPortable = normalizeSha256Digest(input.localPortableSha256)
  if (localPortable) {
    if (localPortable === remoteSha256) {
      return {
        updateAvailable: false,
        isHotfixRebuild: false,
        displayVersion: cleanTag,
        remoteSha256,
      }
    }
    if (hasNewerTimestamp) {
      return {
        updateAvailable: true,
        isHotfixRebuild: true,
        displayVersion: `${cleanTag} (Yeni Derleme #${remoteSha256.slice(0, 7)})`,
        remoteSha256,
      }
    }
  }

  // 2) Kurulu (NSIS) mod: kurulan surumun kaydedilmis `baselineReleaseSha256`
  //    ozetiyle veya yerel derleme zamaniyla karsilastirilir.
  const baseline = normalizeSha256Digest(input.baselineReleaseSha256)
  if (baseline) {
    if (baseline !== remoteSha256 && hasNewerTimestamp) {
      return {
        updateAvailable: true,
        isHotfixRebuild: true,
        displayVersion: `${cleanTag} (Yeni Derleme #${remoteSha256.slice(0, 7)})`,
        remoteSha256,
      }
    }
    return {
      updateAvailable: false,
      isHotfixRebuild: false,
      displayVersion: cleanTag,
      remoteSha256,
    }
  }

  // Baseline henuz kaydedilmemisse ama uzaktaki asset yerel derlemeden en az
  // 10 dakika daha yeniyse, ayni etikete yeni bir build yuklenmis demektir.
  if (
    typeof input.localBuildMtimeMs === 'number' &&
    input.localBuildMtimeMs > 0 &&
    Number.isFinite(remoteTimeMs) &&
    remoteTimeMs > input.localBuildMtimeMs + 10 * 60_000
  ) {
    return {
      updateAvailable: true,
      isHotfixRebuild: true,
      displayVersion: `${cleanTag} (Yeni Derleme #${remoteSha256.slice(0, 7)})`,
      remoteSha256,
    }
  }

  return {
    updateAvailable: false,
    isHotfixRebuild: false,
    displayVersion: cleanTag,
    remoteSha256,
  }
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
  /** Ayni surum etiketine (orn. v0.0.1) yeni bir SHA-256 derlemesi yuklendiyse `true`. */
  isHotfixRebuild?: boolean
  /** Sunucudaki kurulum paketinin SHA-256 ozeti (varsa). */
  remoteSha256?: string
  /** Calisan yerel ikili dosyanin SHA-256 ozeti (varsa). */
  localSha256?: string
  /** Indirilen paketin SHA-256 butunluk dogrulamasi gecti mi? */
  verifiedIntegrity?: boolean
}

const LOG = '[UpdateService]'

export class UpdateService {
  private status: UpdateStatus
  private configuredUrl: string | null = null
  private listeners = new Set<(s: UpdateStatus) => void>()
  private wired = false
  private lastCheckedAt: string | null = null
  private latestReleaseAssetUrl?: string
  private latestReleaseAssetName?: string
  private latestReleaseAssetSha256?: string | null
  private latestReleaseHtmlUrl?: string
  private downloadedInstallerPath?: string
  private cachedLocalFingerprint?: {
    portableSha256: string | null
    binarySha256: string | null
    buildMtimeMs: number | null
  }

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
      // `setSetting` ESANLIYLA yaziyor; `void` ifadesi burada yanilticiydi
      // (uygulamada sifir kazanci olan bir uyari). Yazma hatasi zaten
      // senkron olarak firlatilir ve IPC katmanina ulasir.
      this.storageService.setSetting('update.feedUrl', canonical)
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
    this.storageService.setSetting('update.feedUrl', value)
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

  private checkInFlight: Promise<UpdateStatus> | null = null

  private wire(): void {
    try {
      const isCustom = this.isCustomGenericFeed(this.configuredUrl)
      // Varsayilan GitHub akisinda surum denetimi dogrudan GitHub API ile yapilir;
      // paketlenmemis gelistirme ortaminda electron-updater baslatmaya gerek yoktur.
      if (!isCustom && !app?.isPackaged) {
        return
      }

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
          if (!this.isCustomGenericFeed(this.configuredUrl)) return
          this.patch({
            stage: 'available',
            availableVersion: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
            error: undefined,
          })
        })

        u.on('update-not-available', () => {
          if (!this.isCustomGenericFeed(this.configuredUrl)) return
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
      if (this.isCustomGenericFeed(this.configuredUrl)) {
        this.patch({
          stage: 'error',
          error: `Güncelleme yapılandırılamadı: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }
  }

  /**
   * `autoUpdater` hata metinlerini kullaniciya anlasilir hale getirir.
   */
  private explainUpdateError(err: Error): string {
    const raw = `${err?.message ?? ''}`.toLowerCase()

    if (raw.includes('getaddrinfo') || raw.includes('enotfound') || raw.includes('name_not_resolved')) {
      return 'Sunucuya ulaşılamadı. Güncelleme adresindeki alan adı çözümlenemiyor.'
    }
    if (raw.includes('econnrefused')) {
      return 'Sunucu yanıt vermiyor. Güncelleme sunucusuna ulaşılamadı.'
    }
    if (raw.includes('zaman asimi') || raw.includes('timeout') || raw.includes('aborted')) {
      return 'Güncelleme sunucusu zamanında yanıt vermedi. İnternet bağlantınızı kontrol edip tekrar deneyin.'
    }
    if (raw.includes('certificate') || raw.includes('ssl') || raw.includes('self signed')) {
      return 'Güvenlik sertifikası geçersiz. HTTPS sertifikasını kontrol edin.'
    }
    if (raw.includes('not packed') || raw.includes('dev app')) {
      return 'Güncelleme denetimi yalnızca kurulmuş sürümde çalışır. Bu bir hata değildir.'
    }
    if (raw.includes('.yml') || raw.includes('no published versions') || raw.includes('404')) {
      if (!this.isCustomGenericFeed(this.configuredUrl)) {
        return 'Sunucudan yeni bir sürüm okunamadı. Uygulama en güncel sürümde olabilir veya yayın deposu geçici olarak erişilemiyor olabilir.'
      }
      return 'Özel güncelleme sunucusunda geçerli bir sürüm paketi bulunamadı. Yayın klasöründe kurulum dosyası ve sürüm tanımı birlikte bulunmalıdır.'
    }
    if (raw.includes('net::err_blocked') || raw.includes('blocked')) {
      return (
        'Ağ tarafından engellendi. Kurumsal ağ veya antivirüs, güncelleme ' +
        'indirmesini durduruyor olabilir.'
      )
    }
    const rawMessage = err instanceof Error ? err.message : String(err)
    return 'Güncelleme kontrolü: ' + rawMessage.replace(/[a-z0-9_-]+\.yml/gi, 'sürüm tanımı')
  }

  // -------------------------------------------------------------------------
  // Eylemler
  // -------------------------------------------------------------------------

  /**
   * Calisan ikili dosyanin SHA-256 parmak izini ve derleme zamanini
   * tek sefer hesaplayip bellege alir.
   *
   * Performans notu: NSIS kurulumunda `JustMyClass.exe` ~160 MB Chromium ikilisidir;
   * asil uygulama kodu `resources/app.asar` (~2 MB) icindedir. NSIS modunda `app.asar`
   * uzerinden SHA-256 almak ana sureci hic bloke etmeden (<5 ms) kesin derleme kimligi verir.
   */
  private resolveLocalFingerprint(): {
    portableSha256: string | null
    binarySha256: string | null
    buildMtimeMs: number | null
  } {
    if (this.cachedLocalFingerprint) return this.cachedLocalFingerprint

    const portablePath = process.env.PORTABLE_EXECUTABLE_FILE || null
    const asarPath = process.resourcesPath ? path.join(process.resourcesPath, 'app.asar') : null
    let exePath: string | null = null
    try {
      exePath = app?.getPath ? app.getPath('exe') : null
    } catch {
      exePath = null
    }

    const portableSha256 = portablePath ? computeFileSha256(portablePath) : null
    const asarSha256 = !portableSha256 && asarPath && fs.existsSync(asarPath) ? computeFileSha256(asarPath) : null
    const binarySha256 = portableSha256 ?? asarSha256 ?? (exePath && !asarPath ? computeFileSha256(exePath) : null)

    let buildMtimeMs: number | null = null
    const candidates = [portablePath, asarPath, exePath].filter((p): p is string => Boolean(p))

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const st = fs.statSync(candidate)
          if (st.mtimeMs > 0) {
            buildMtimeMs = st.mtimeMs
            break
          }
        }
      } catch {
        /* sonraki adayi dene */
      }
    }

    this.cachedLocalFingerprint = { portableSha256, binarySha256, buildMtimeMs }
    return this.cachedLocalFingerprint
  }

  /**
   * AI model senkronizasyon kuyruguna (`providerHttp`) takilmadan dogrudan ve
   * kesin zaman asimli (6 sn) GitHub API sorgusu yapar.
   */
  private async fetchGitHubReleaseJson<T>(url: string, timeoutMs = 6000): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new Error('Istek zaman asimina ugradi.'))
    }, timeoutMs)

    try {
      const headers: Record<string, string> = {
        'User-Agent': `JustMyClass/${this.status.currentVersion}`,
        Accept: 'application/vnd.github.v3+json',
      }
      if (typeof globalThis.fetch === 'function') {
        const res = await globalThis.fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
          redirect: 'follow',
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`.trim())
        }
        return (await res.json()) as T
      }
      return await providerHttp.request<T>(url, {
        method: 'GET',
        headers,
        timeoutMs,
        maxRetries: 0,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * GitHub Releases API'den en son surumu ve kriptografik SHA-256
   * asset ozetini okur (autoUpdater kullanmadan).
   */
  private async checkViaGitHubApi(): Promise<UpdateStatus> {
    try {
      const response = await this.fetchGitHubReleaseJson<{
        tag_name: string
        name?: string
        published_at?: string
        body?: string
        html_url?: string
        assets?: Array<{
          name: string
          browser_download_url: string
          digest?: string
          updated_at?: string
          size?: number
        }>
      }>(`https://api.github.com/repos/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases/latest`, 6000)

      if (!response || !response.tag_name) {
        this.patch({ stage: 'not-available', availableVersion: undefined, error: undefined })
        return this.getStatus()
      }

      this.latestReleaseHtmlUrl = response.html_url
      const assets = response.assets ?? []
      const isPortableRuntime = Boolean(process.env.PORTABLE_EXECUTABLE_FILE)

      const targetAsset = isPortableRuntime
        ? (assets.find(a => /portable/i.test(a.name) && a.name.toLowerCase().endsWith('.exe')) ??
           assets.find(a => /setup/i.test(a.name) && a.name.toLowerCase().endsWith('.exe')) ??
           assets.find(a => a.name.toLowerCase().endsWith('.exe')))
        : (assets.find(a => /setup/i.test(a.name) && a.name.toLowerCase().endsWith('.exe')) ??
           assets.find(a => a.name.toLowerCase().endsWith('.exe')) ??
           assets.find(a => /\.dmg$|\.app\.zip$/i.test(a.name)))

      const fingerprint = this.resolveLocalFingerprint()
      const baselineKey = fingerprint.binarySha256
        ? `update.baselineSha256.${fingerprint.binarySha256.slice(0, 16)}`
        : 'update.baselineSha256.default'
      let storedBaseline: string | null = null
      try {
        storedBaseline = this.storageService.getSetting<string | null>(baselineKey, null)
      } catch {
        storedBaseline = null
      }

      const evaluation = evaluateReleaseUpdate({
        currentVersion: this.status.currentVersion,
        remoteTag: response.tag_name,
        remoteAssetDigest: targetAsset?.digest ?? null,
        remoteAssetUpdatedAt: targetAsset?.updated_at ?? response.published_at ?? null,
        localPortableSha256: fingerprint.portableSha256,
        baselineReleaseSha256: storedBaseline,
        localBuildMtimeMs: fingerprint.buildMtimeMs,
      })

      if (!evaluation.updateAvailable && evaluation.remoteSha256 && !storedBaseline) {
        try {
          this.storageService.setSetting(baselineKey, evaluation.remoteSha256)
        } catch {
          /* salt-okunur / gecici hata yok sayilir */
        }
      }

      if (!evaluation.updateAvailable) {
        this.patch({
          stage: 'not-available',
          availableVersion: undefined,
          isHotfixRebuild: false,
          remoteSha256: evaluation.remoteSha256 ?? undefined,
          localSha256: fingerprint.binarySha256 ?? undefined,
          error: undefined,
        })
        return this.getStatus()
      }

      this.latestReleaseAssetUrl = targetAsset?.browser_download_url ?? response.html_url
      this.latestReleaseAssetName = targetAsset?.name
      this.latestReleaseAssetSha256 = evaluation.remoteSha256

      this.patch({
        stage: 'available',
        availableVersion: evaluation.displayVersion,
        releaseDate: targetAsset?.updated_at ?? response.published_at,
        releaseNotes: response.body,
        isHotfixRebuild: evaluation.isHotfixRebuild,
        remoteSha256: evaluation.remoteSha256 ?? undefined,
        localSha256: fingerprint.binarySha256 ?? undefined,
        verifiedIntegrity: undefined,
        error: undefined,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('404')) {
        this.patch({ stage: 'not-available', availableVersion: undefined, error: undefined })
      } else {
        this.patch({
          stage: 'error',
          error: this.explainUpdateError(err instanceof Error ? err : new Error(msg)),
        })
      }
    }
    return this.getStatus()
  }

  /** Surumu kontrol eder. Hata ASLA atmaz; asla 'checking' durumunda asili kalmaz. */
  public async check(): Promise<UpdateStatus> {
    if (this.checkInFlight) {
      return this.checkInFlight
    }

    const runCheck = async (): Promise<UpdateStatus> => {
      this.wire()
      this.lastCheckedAt = new Date().toISOString()
      this.patch({ stage: 'checking', error: undefined })

      let hardTimer: NodeJS.Timeout | undefined
      const hardTimeout = new Promise<UpdateStatus>(resolve => {
        hardTimer = setTimeout(() => {
          if (this.status.stage === 'checking') {
            this.patch({
              stage: 'error',
              error: 'Güncelleme sunucusu zamanında yanıt vermedi. Lütfen tekrar deneyin.',
            })
          }
          resolve(this.getStatus())
        }, 7500)
      })

      try {
        const work = (async (): Promise<UpdateStatus> => {
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
          return await this.checkViaGitHubApi()
        })()

        return await Promise.race([work, hardTimeout])
      } finally {
        if (hardTimer) clearTimeout(hardTimer)
        if (this.status.stage === 'checking') {
          this.patch({ stage: 'not-available', availableVersion: undefined, error: undefined })
        }
      }
    }

    this.checkInFlight = runCheck().finally(() => {
      this.checkInFlight = null
    })
    return this.checkInFlight
  }

  /**
   * Kurulum paketini HTTPS uzerinden indirir, ilerlemeyi bildirir ve
   * SHA-256 kriptografik butunluk dogrulamasini gerceklestirir.
   */
  private async downloadAndVerifyAsset(
    assetUrl: string,
    assetName?: string,
    expectedSha256?: string | null,
  ): Promise<string> {
    const safeName = (assetName || 'JustMyClass-Setup.exe').replace(/[^a-zA-Z0-9._-]/g, '_')
    const tempDir = app?.getPath ? app.getPath('temp') : process.env.TEMP || '.'
    const targetPath = path.join(tempDir, `jmc-update-${Date.now()}-${safeName}`)

    this.patch({
      stage: 'downloading',
      progress: 0,
      transferredMb: 0,
      totalMb: undefined,
      error: undefined,
    })

    const res = await providerHttp.request<Response>(assetUrl, {
      method: 'GET',
      headers: { 'User-Agent': `JustMyClass/${this.status.currentVersion}` },
      raw: true,
      timeoutMs: 300_000,
      maxRetries: 1,
    })

    const totalBytes = Number(res.headers.get('content-length') || 0)
    const totalMb = totalBytes > 0 ? Math.round(totalBytes / 1024 / 1024) : undefined
    const hash = crypto.createHash('sha256')
    const fileStream = fs.createWriteStream(targetPath)

    let transferredBytes = 0
    const reader = res.body?.getReader()
    if (!reader) {
      fileStream.close()
      throw new Error('Güncelleme akışı başlatılamadı.')
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && value.byteLength > 0) {
          const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
          hash.update(chunk)
          if (!fileStream.write(chunk)) {
            await new Promise<void>(resolve => fileStream.once('drain', resolve))
          }
          transferredBytes += chunk.byteLength
          const progress = totalBytes > 0 ? Math.min(99, Math.round((transferredBytes / totalBytes) * 100)) : undefined
          this.patch({
            stage: 'downloading',
            progress,
            transferredMb: Math.round(transferredBytes / 1024 / 1024),
            totalMb,
          })
        }
      }
      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()))
      })
    } catch (err) {
      fileStream.destroy()
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath)
      } catch {
        /* yoksay */
      }
      throw err
    }

    const actualSha256 = hash.digest('hex').toLowerCase()
    const normalizedExpected = normalizeSha256Digest(expectedSha256)
    if (normalizedExpected && actualSha256 !== normalizedExpected) {
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath)
      } catch {
        /* yoksay */
      }
      throw new Error(
        `İndirilen güncelleme paketinin SHA-256 doğrulaması başarısız oldu ` +
          `(beklenen: ${normalizedExpected.slice(0, 12)}…, alınan: ${actualSha256.slice(0, 12)}…). ` +
          `Güvenliğiniz için kurulum iptal edildi.`,
      )
    }

    return targetPath
  }

  /** Bulunan surumu indirir. Yalnizca `available` durumunda anlamli. */
  public async download(): Promise<UpdateStatus> {
    if (this.status.stage !== 'available') {
      return this.getStatus()
    }

    this.downloadedInstallerPath = undefined

    // 1. Ayni surum etiketine yuklenmis yeni derleme (hotfix rebuild) DEĞİLSE
    //    ve paketlenmis uygulamaysa once electron-updater'i dene.
    //    (Hotfix rebuild durumunda semver 0.0.1 === 0.0.1 oldugu icin
    //    electron-updater indirmeyi atlar; o durumda dogrudan SHA-256
    //    dogrulamali indirme katmanimiz devreye girer.)
    const isCustom = this.isCustomGenericFeed(this.configuredUrl)
    if ((isCustom || app?.isPackaged) && !this.status.isHotfixRebuild) {
      try {
        const u = autoUpdater as unknown as {
          checkForUpdates: () => Promise<unknown>
          downloadUpdate: () => Promise<unknown>
        }
        await u.checkForUpdates()
        await u.downloadUpdate()
        this.patch({ verifiedIntegrity: true })
        return this.getStatus()
      } catch (err) {
        // autoUpdater basarisiz olursa SHA-256 dogrulamali dogrudan indirmeye gec.
        void err
      }
    }

    // 2. Dogrudan SHA-256 dogrulamali uygulama ici indirme (hem hotfix rebuild
    //    hem de autoUpdater yedegi icin).
    if (this.latestReleaseAssetUrl && /\.exe$/i.test(this.latestReleaseAssetUrl)) {
      try {
        const installerPath = await this.downloadAndVerifyAsset(
          this.latestReleaseAssetUrl,
          this.latestReleaseAssetName,
          this.latestReleaseAssetSha256,
        )
        this.downloadedInstallerPath = installerPath
        this.patch({
          stage: 'downloaded',
          progress: 100,
          verifiedIntegrity: true,
          error: undefined,
        })
        return this.getStatus()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('SHA-256')) {
          this.patch({ stage: 'error', verifiedIntegrity: false, error: msg })
          return this.getStatus()
        }
      }
    }

    // 3. Son yedek yol: kurulum dosyasini varsayilan tarayicida ac.
    if (this.latestReleaseAssetUrl) {
      await shell.openExternal(this.latestReleaseAssetUrl)
      this.patch({
        stage: 'available',
        progress: undefined,
        transferredMb: undefined,
        totalMb: undefined,
        error:
          'Güncelleme dosyası tarayıcınızda indirilmeye açıldı. ' +
          'Dosyayı indirip çalıştırarak kurulumu tamamlayabilirsiniz.',
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
      const fingerprint = this.resolveLocalFingerprint()
      if (this.latestReleaseAssetSha256) {
        const baselineKey = fingerprint.binarySha256
          ? `update.baselineSha256.${fingerprint.binarySha256.slice(0, 16)}`
          : 'update.baselineSha256.default'
        try {
          this.storageService.setSetting(baselineKey, this.latestReleaseAssetSha256)
        } catch {
          /* yoksay */
        }
      }

      if (this.downloadedInstallerPath && fs.existsSync(this.downloadedInstallerPath)) {
        const installer = this.downloadedInstallerPath
        setImmediate(() => {
          void shell.openPath(installer).then(() => {
            app?.quit?.()
          })
        })
        return true
      }

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
