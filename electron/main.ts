import { app, BrowserWindow, ipcMain, shell, session, type Session, dialog, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import url from 'node:url'
import { execFileSync } from 'node:child_process'

import { KeyringService } from './services/keyringService'
import { VaultService } from './services/vaultService'
import { StorageService } from './services/storageService'
import { AuthService } from './services/authService'
import { ClassroomService } from './services/classroomService'
import { DriveService } from './services/driveService'
import { ToolDispatcher } from './services/toolDispatcher'
import { AiOrchestrator } from './services/ai/aiOrchestrator'
import { JustMyClassMemoryService } from './services/ai/memoryService'
import { ChatSessionService } from './services/ai/chatSessionService'
import { ActiveContextService } from './services/activeContextService'
import { ExportService, ExportFormat } from './services/exportService'
import { UpdateService } from './services/updateService'
import { FilePreviewService, extractUniversalAttachmentText } from './services/filePreviewService'
import { resolveDownloadsDir } from './services/dataDir'
import { log, initLoggerFromElectron } from './services/logger'

app.name = 'JustMyClass'
if (process.platform === 'win32') {
  app.setAppUserModelId('com.aegissoft.justmyclass')
}

let mainWindow: BrowserWindow | null = null

// Servisler tekil olarak kurulur; ana anahtar ilk gercek erisimde alinir.
const keyringService = new KeyringService()
const vaultService = new VaultService(keyringService)
const storageService = new StorageService(keyringService)
const authService = new AuthService(vaultService, storageService)

authService.setOnAuthSuccess(() => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

function getDownloadsDirectory(): string {
  // Kullanicinin secitigi klasor varsa ONCE o gecerilir.
  const custom = storageService.getSetting<string>('downloads.path', '')
  if (custom && typeof custom === 'string' && custom.trim() && fs.existsSync(custom.trim())) {
    return custom.trim()
  }
  // Varsayilan: Electron indirme klasorunun altinda bir alt klasor.
  // `app.getPath('downloads')` hicbir sey dondurmezse veya salt-okunursa
  // `resolveDownloadsDir()` yazilabilir bir yere gecis yapar; boylece
  // indirme sessizce basarisiz olmaz.
  try {
    const downloadsRoot = app.getPath('downloads')
    const defaultDir = path.join(downloadsRoot, 'JustMyClass')
    fs.mkdirSync(defaultDir, { recursive: true })
    return defaultDir
  } catch {
    return path.join(resolveDownloadsDir(), 'JustMyClass')
  }
}

const classroomService = new ClassroomService(storageService, vaultService, authService)
const driveService = new DriveService(storageService, vaultService, authService, () => getDownloadsDirectory())
const filePreviewService = new FilePreviewService(storageService, driveService)
const toolDispatcher = new ToolDispatcher(storageService, vaultService, driveService)
const activeContextService = new ActiveContextService(storageService)
const memoryService = new JustMyClassMemoryService(storageService)
const chatSessionService = new ChatSessionService(storageService)

// Araclara "kullanici su an hangi odevi acti?" bilgisini ver.
// `workspace_list_open_files` bu baglami olmadan hangi dosyalarin
// okunabilecegini bilemez; model dosya kimliklerini tahmin etmek
// zorunda kalir ve okuyamadigi icerigi uydurur.
toolDispatcher.setActiveContextProvider(() => activeContextService.getContext())

const aiOrchestrator = new AiOrchestrator(vaultService, storageService, toolDispatcher, memoryService)
const exportService = new ExportService(storageService)

/**
 * UpdateService YALNIZCA `app.whenReady()` SONRASINDA kurulur.
 *
 * NEDEN: `new UpdateService(storageService)` constructor icinde
 * `storageService.getSetting(...)` cagirir; bu da `getMasterKey()` ->
 * `safeStorage` zincirini tetikler. Electron'da `safeStorage`
 * `app.whenReady()` ONCESINDE kullanilamaz. Onceki surum servisi modul
 * duzeyinde kurdugu icin:
 *   1) anahtar dosyasi okunamadan yeni bir anahtar uretiliyor,
 *   2) kullanici yeniden girdiginde tum sifreli veri okunamaz oluyor,
 *   3) uygulama "verilerim sifirlandi" diye bildiriliyordu.
 */
let updateService: UpdateService | null = null
function getUpdateService(): UpdateService {
  if (!updateService) {
    updateService = new UpdateService(storageService)
    updateService.subscribe(status => {
      mainWindow?.webContents.send('update:status', status)
    })
  }
  return updateService
}

/** Dis tarayicida acilmasina izin verilen protokoller. */
const EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:'])

/**
 * Renderer'in sifreli depoya yazabilecegi ayar anahtarlari.
 * Beyaz liste disindaki her anahtar reddedilir; boylece depo icerigi
 * (hesap, odev, teslim) arayuzden degistirilemez.
 */
const ALLOWED_SETTING_KEYS = new Set([
  // Arayuz tercihleri ve otomasyon ayarlari.
  //
  // `maxAutoDownloadMb`, `confirmWrites` ve `telemetryDisabled` ONCEDEN
  // bu listeydi ama HICBIR YERDE OKUNMUYORDU: ne ayarlar ekraninda bir
  // girdileri vardi ne de bir kodu bunlari sorguluyordu. Renderer'in
  // yazabilecegi ama hicbir yerde kullanilmayan bir anahtar, kullaniciya
  // "ayar degisti" izlenimi verirken HICBIR SEYIN DEGISMEDIGI anlamina
  // gelir. Kaldirildi; yeniden istenirse gercek bir tuketiciyle birlikte
  // eklenmelidir.
  'autoSyncMinutes',
  'ai.lastProviderId',
  'ai.lastModelId',
  'ai.favoriteModels',
  'ai.defaultMode',
  /*
    `update.feedUrl` BILINCLI OLARAK BU LISTEDE DEGIL.
    Genel `system:setSetting` kanalina eklenirse renderer HTTPS
    denetimi olmadan adres yazabilir ve guncelleme sessizce bozulur.
    Bunun yerine dogrudan dogrulanmis `update:setFeedUrl` kanalı
    kullanilir (bkz. setupIpcHandlers).

    `setup.wizardSeen` ise burada olmalidir: sadece bir bayrak ama
    ayar kanalindan yazilabilmesi gerekir, yoksa sihirbaz her acilista
    geri gelir.
  */
  'setup.wizardSeen',
  'setup.onboardingCompleted',
  'downloads.path',
])

/**
 * Renderer'in sifreli depodan OKUYABILECEGI ayar anahtarlari.
 *
 * Bu liste `ALLOWED_SETTING_KEYS` ile ayni olmak zorundadir. Yazma
 * izni olan ama okuma izni olmayan bir anahtar, salt-okunur bir
 * tercih (orn. telemetri kapali) icin kullanilabilir; okuma izni olan
 * ama yazma izni olmayan bir anahtar ise tasima olur ve kullanilmaz.
 *
 * Ayri bir liste olmasinin sebebi guvenlik: depoda `customProviders`
 * gibi anahtarlar da var ve iclerinde kullanicinin yazdigi ham
 * `customHeaders` degerleri bulunabilir. Tek bir liste kullanilsaydi
 * renderer sifreli deponun tamamini okuyabilirdi.
 */
const READABLE_SETTING_KEYS = ALLOWED_SETTING_KEYS

function isTrustedExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return false
  try {
    const parsed = new URL(raw)
    return EXTERNAL_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}

async function openExternalSafely(raw: unknown): Promise<void> {
  if (!isTrustedExternalUrl(raw)) {
    throw new Error('Yalnızca http, https ve mailto bağlantıları açılabilir.')
  }
  await shell.openExternal(raw)
}

/** IPC isteklerinin yalnizca kendi penceremizden geldigini dogrular. */
function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('Yetkisiz istek reddedildi.')
  }
  const url = event.senderFrame?.url ?? ''
  // Uretimde yerel dosya, gelistirmede yalnizca Vite sunucusu.
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (!app.isPackaged && devUrl) {
    // On ek `startsWith` yerine KARSILASTIRILAN origin kullanilir:
    // "http://localhost:5173@evil.example" de `startsWith` testini gecer
    // ama gercek hedef evil.example'dir.
    let trusted = false
    try {
      trusted = new URL(url).origin === new URL(devUrl).origin
    } catch {
      trusted = false
    }
    if (!trusted) throw new Error('Yetkisiz kaynaktan gelen istek reddedildi.')
    return
  }
  if (!url.startsWith('file://')) {
    throw new Error('Yetkisiz kaynaktan gelen istek reddedildi.')
  }
}

function buildVersionInfo() {
  let gitHash = 'bilinmiyor'
  try {
    const root = app.getAppPath()
    gitHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000,
    }).trim()
  } catch {
    /* paketlenmis surumde .git bulunmayabilir */
  }

  const encryption = storageService.getStorageSecurityInfo()
  const vaultStatus = keyringService.getStatus()

  return {
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    buildDate: new Date().toISOString(),
    gitHash,
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
    encryption,
    vault: {
      ...encryption,
      storedKeyCount: vaultService.describe().storedKeyCount,
    },
    vaultBackend: vaultStatus.backend,
  }
}

/** Hesap fotografi icin izin verilen tek harici gorsel kaynagi. */
const PROFILE_IMAGE_ORIGIN = 'https://lh3.googleusercontent.com/'

/**
 * Oturum seviyesinde CSP uygular.
 *
 * Uretimde arayuz yalnizca `file://` uzerinden kendi paketinden yuklendigi
 * icin `default-src 'self'` yeterlidir. Tum ag istekleri main surecinde
 * yapildigindan `connect-src 'none'` bile yeterlidir.
 *
 * Gelistirme modunda Vite HMR'in satir ici kod ve yerel websocket
 * kullandigi icin birkac istisna tanimlanir; bu istisnalar yalnizca
 * paketlenmemis calistirmada gecerlidir.
 */
function applyContentSecurityPolicy(session: Session): void {
  const isDev = !app.isPackaged
  const scriptSrc = isDev ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"] : ["'self'"]
  // Websocket izinleri HMR ile sinirli kalmali; `ws:` herhangi bir
  // sunucuya izin verirdi.
  const connectSrc = [
    "'self'",
    'blob:',
    'data:',
    'chrome-extension:',
    ...(isDev
      ? [
          'ws://localhost:*',
          'ws://127.0.0.1:*',
          'http://localhost:*',
          'http://127.0.0.1:*',
        ]
      : []),
  ]

  // `blob:` hem asagidaki ag filtresinde hem de burada izinlidir; iki
  // liste birbirini yansitmalidir, aksi halde gorseller sessizce bloklanir.
  const imgSrc = [
    "'self'",
    'data:',
    'blob:',
    'https://*.googleusercontent.com',
    'https://lh3.googleusercontent.com',
    'https://lh4.googleusercontent.com',
    'https://lh5.googleusercontent.com',
    'https://lh6.googleusercontent.com',
    'https://*.ytimg.com',
    'https://*.google.com',
    'https://*.gstatic.com',
    'https://*.ggpht.com',
  ]

  const policy = [
    "default-src 'none'",
    `script-src ${scriptSrc.join(' ')} blob: chrome-extension: https://www.youtube.com https://s.ytimg.com https://*.gstatic.com`,
    // Tailwind v4 gelistirmede satir ici stil enjekte eder.
    "style-src 'self' 'unsafe-inline' chrome-extension: https://fonts.googleapis.com",
    "font-src 'self' data: chrome-extension: https://fonts.gstatic.com",
    `img-src ${imgSrc.join(' ')} chrome-extension:`,
    `connect-src ${connectSrc.join(' ')} https://*.googlevideo.com https://*.youtube.com https://*.youtube-nocookie.com https://*.gstatic.com https://*.googleapis.com https://*.ggpht.com`,
    "media-src 'self' data: blob: https://*.googlevideo.com",
    "worker-src 'self' blob: chrome-extension:",
    "child-src 'self' blob: data: chrome-extension: https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com",
    "frame-src 'self' blob: data: chrome-extension: https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com",
    "object-src 'self' blob: data: chrome-extension:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self' file:",
  ].join('; ')

  session.webRequest.onHeadersReceived((details, callback) => {
    // KRITIK: Uygulama CSP basligi YALNIZCA ana uygulama cercevesine (`mainFrame`)
    // uygulanmalidir. Alt cercevelere (`subFrame`) uygulandiginda Chromium'un
    // yerlesik PDF goruntuleyicisi (`chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai`)
    // ve `blob:` PDF akislari kendi CSP'lerini kaybedip `#525659` gri ekranda
    // kilitleniyordu.
    const isAppMainFrame =
      details.resourceType === 'mainFrame' &&
      (details.url.startsWith('file:') ||
        details.url.startsWith('http://localhost') ||
        details.url.startsWith('http://127.0.0.1'))

    if (isAppMainFrame) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [policy],
        },
      })
      return
    }

    // YouTube iframe ve video akışlarının hiçbir zaman engellenmemesi için:
    const isYouTube =
      details.url.includes('youtube.com') ||
      details.url.includes('youtube-nocookie.com') ||
      details.url.includes('googlevideo.com')

    if (isYouTube && details.responseHeaders) {
      const responseHeaders = { ...details.responseHeaders }
      delete responseHeaders['x-frame-options']
      delete responseHeaders['X-Frame-Options']
      callback({ responseHeaders })
      return
    }

    callback({ responseHeaders: details.responseHeaders })
  })

  // YouTube Embed Hata 153 Çözümü:
  // 1) file:// bağlamında Chromium Referer göndermez; YouTube embed oynatıcısı
  //    bunu görünce 'Hata 153: Video oynatıcı yapılandırma hatası' fırlatır.
  // 2) User-Agent içinde 'Electron/' ibaresi varsa YouTube embedleri şüpheli bularak reddeder.
  //    Bu nedenle hedef domaine uygun Referer/Origin eklenir ve User-Agent standartlaştırılır.
  session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        '*://*.youtube.com/*',
        '*://*.youtube-nocookie.com/*',
        '*://*.googlevideo.com/*',
        '*://*.ytimg.com/*',
      ],
    },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders }
      const isNoCookie = details.url.includes('youtube-nocookie.com')
      const targetOrigin = isNoCookie ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com'
      requestHeaders['Referer'] = `${targetOrigin}/`
      requestHeaders['Origin'] = targetOrigin

      if (typeof requestHeaders['User-Agent'] === 'string') {
        requestHeaders['User-Agent'] = requestHeaders['User-Agent']
          .replace(/\s*Electron\/[^\s]+/gi, '')
          .replace(/\s*JustMyClass\/[^\s]+/gi, '')
      }
      callback({ requestHeaders })
    },
  )
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: 'JustMyClass',
    // Varsayılan tema "Neon Dreams" (siyah + mor). Önceden MAVI/LACİVERT
    // (`#0b0f16`) idi ve pencere React boyanana kadar mavi parlıyor,
    // sonra siyaha dönüyordu. Değer artık src/index.css bootstrap
    // belirteçleriyle BİREBİR aynı.
    backgroundColor: '#0d0817',
    autoHideMenuBar: true,
    frame: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    // Cizim hazir olana kadar pencere gosterilmez; `ready-to-show`
    // olayinda gosterilir. Boylece beyaz flaş olusmaz.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
      // Preload yalnizca `contextBridge` ve `ipcRenderer` kullaniyor;
      // ikisi de sandbox icinde mevcuttur. Sandbox, renderer bir RCE
      // yerse calistirabilecegi yuzeyi belirgin sekilde daraltir.
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })

  const wc = mainWindow.webContents

  // Pencere kapandiginda referansi temizle. Aksi halde `second-instance`
  // ve `activate` yolculari yok edilmis bir BrowserWindow'a islem
  // yapmaya calisir ve uygulama yeniden acilamaz.
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Cizim hazir olmadan pencereyi gosterme: beyaz flaş olmaz.
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })

  // Pencere boyut durumunu renderer'a bildir
  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-change', true)
    }
  })
  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-change', false)
    }
  })

  // Ana pencerenin dis adreslere yonlenmesini engelle; ancak gomulu PDF
  // (`blob:`, `chrome-extension:`) ve YouTube embed alt cercevelerine izin ver.
  const isAllowedInternalOrEmbedNavigation = (targetUrl: string): boolean =>
    targetUrl.startsWith('blob:') ||
    targetUrl.startsWith('data:') ||
    targetUrl.startsWith('chrome-extension:') ||
    targetUrl.startsWith('chrome:') ||
    targetUrl.includes('youtube.com/embed/') ||
    targetUrl.includes('youtube-nocookie.com/embed/')

  wc.on('will-navigate', (event, targetUrl) => {
    if (isAllowedInternalOrEmbedNavigation(targetUrl)) return
    event.preventDefault()
  })
  wc.on('will-redirect', (event, targetUrl) => {
    if (isAllowedInternalOrEmbedNavigation(targetUrl)) return
    event.preventDefault()
  })
  wc.on('will-attach-webview', (event, _webPreferences, params) => {
    // Chromium'un yerlesik PDF eklentisi (`mhjfbmdgcfjbbpaeojofohoefgiehjai`)
    // MimeHandlerViewGuest olarak baglanir; bunun disindaki tum webview'ler engellenir.
    const src = String(params?.src ?? '')
    if (src.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai') || src.startsWith('blob:')) {
      return
    }
    event.preventDefault()
  })

  // Renderer cokmusse kullaniciya sessizce donmez, uyari ver.
  wc.on('render-process-gone', (_e, details) => {
    log.error('[JustMyClass] Renderer sureci sonlandi:', details.reason)
    dialog.showErrorBox(
      'JustMyClass durdu',
      `Arayuz sureci beklenmedik sekilde sonlandı (${details.reason}). Uygulama yeniden baslatilacak.`,
    )
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  })

  // window.open yalnizca guvenli semalara ve harici uygulamaya.
  wc.setWindowOpenHandler(({ url }) => {
    if (isTrustedExternalUrl(url)) void openExternalSafely(url)
    return { action: 'deny' }
  })

  // Web izinleri varsayilan olarak tamamen reddedilir (kamera, mikrofon,
  // konum, bildirim vb.).
  //
  // TEK ISTISNA: pano yazma izni. `navigator.clipboard.writeText` bu izne
  // baglidir; her istegi reddetmek, "Kopyalandi" diye geri bildirim verip
  // hicbir seyi kopyalamayan bir buton yaratiyordu. Okuma izni (eski
  // `clipboard-read`) ACIK TUTULMAZ: pano okumak gerekmiyor ve kullanici
  // verisi sizdirabilirdi.
  const ALLOWED_PERMISSIONS = new Set([
    'clipboard-sanitized-write',
    'clipboard-write',
  ])
  wc.session.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  )
  wc.session.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  )

  // Guclu Content-Security-Policy. Meta etiketi yerine oturum seviyesinde
  // uygulanir; boylece uretimde `script-src 'unsafe-inline'` gerekmez.
  applyContentSecurityPolicy(wc.session)

  // Yalnizca renderer (arayuz penceresi) tarafindan baslatilan ag isteklerini
  // filtrele. Node.js / Electron ana surecinden yapilan API istekleri
  // (net.fetch, Google Classroom/Drive, Gemini/AI, surum denetimi)
  // `webContentsId` tasimaz veya ana pencereye ait degildir; bunlar
  // asla engellenmez.
  wc.session.webRequest.onBeforeRequest(
    (
      details: { url: string; webContentsId?: number },
      callback: (r: { cancel: boolean }) => void,
    ) => {
      // Ana surec kaynakli (net.fetch, arka plan servisleri) istekleri dogrudan gecir
      if (
        details.webContentsId === undefined ||
        details.webContentsId === null ||
        details.webContentsId !== wc.id
      ) {
        callback({ cancel: false })
        return
      }

      const reqUrl = details.url
      const devUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined
      const isAllowedScheme =
        reqUrl.startsWith('file:') ||
        (!app.isPackaged && reqUrl.startsWith('devtools:')) ||
        reqUrl.startsWith('blob:') ||
        reqUrl.startsWith('data:') ||
        reqUrl.startsWith('chrome-extension:') ||
        reqUrl.startsWith('chrome:') ||
        (!!devUrl && reqUrl.startsWith(devUrl))

      const isAllowedDomain =
        reqUrl.includes('.googleusercontent.com/') ||
        reqUrl.startsWith('https://lh3.googleusercontent.com') ||
        reqUrl.startsWith('https://lh4.googleusercontent.com') ||
        reqUrl.startsWith('https://lh5.googleusercontent.com') ||
        reqUrl.startsWith('https://lh6.googleusercontent.com') ||
        reqUrl.includes('youtube.com/') ||
        reqUrl.includes('youtube-nocookie.com/') ||
        reqUrl.includes('youtu.be/') ||
        reqUrl.includes('ytimg.com/') ||
        reqUrl.includes('googlevideo.com/') ||
        reqUrl.includes('gstatic.com/') ||
        reqUrl.includes('googleapis.com/') ||
        reqUrl.includes('ggpht.com/') ||
        reqUrl.includes('doubleclick.net/') ||
        reqUrl.includes('google.com/')

      callback({ cancel: !(isAllowedScheme || isAllowedDomain) })
    },
  )

  const isDevMode = !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL
  let devUrlValid = false
  if (isDevMode && process.env.VITE_DEV_SERVER_URL) {
    try {
      const parsed = new URL(process.env.VITE_DEV_SERVER_URL)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        devUrlValid = true
      }
    } catch {
      devUrlValid = false
    }
  }

  if (isDevMode && devUrlValid) {
    void wc.loadURL(process.env.VITE_DEV_SERVER_URL!)
  } else {
    const candidates = [
      path.join(app.getAppPath(), 'dist-renderer/index.html'),
      path.join(__dirname, '../dist-renderer/index.html'),
      path.join(process.cwd(), 'dist-renderer/index.html'),
      path.join(app.getAppPath(), 'dist/index.html'),
      path.join(__dirname, '../dist/index.html'),
    ]
    const resolved = candidates.find(p => fs.existsSync(p))
    if (!resolved) {
      mainWindow = null
      dialog.showErrorBox(
        'JustMyClass başlatılamadı',
        'Arayüz dosyası bulunamadı. Uygulama eksik kurulmuş görünüyor.\n\n' +
          `Beklenen konum: dist-renderer/index.html`,
      )
      app.quit()
      return
    }

    // Yukleme basarisiz olursa sessizce bos pencere birakma.
    wc.on('did-fail-load', (_e, errorCode, errorDescription, failedUrl, isMainFrame) => {
      if (errorCode === -3) return // ERR_ABORTED: normal iptal

      // Alt kaynaklar (resim, favicon, font) ana uygulamanin acilmasini asla engellememelidir
      if (typeof isMainFrame === 'boolean' && !isMainFrame) {
        log.warn('[JustMyClass] Alt kaynak yüklenemedi:', errorCode, errorDescription, failedUrl)
        return
      }

      log.error('[JustMyClass] Ana arayüz yüklenemedi:', errorCode, errorDescription, failedUrl)

      // ERR_INVALID_URL (-300) gibi durumlarda dosya URL'i ile doğrudan tekrar dene
      try {
        const directFileUrl = url.pathToFileURL(resolved).toString()
        if (failedUrl !== directFileUrl) {
          void wc.loadURL(directFileUrl)
          return
        }
      } catch {
        /* yoksay */
      }

      dialog.showErrorBox(
        'JustMyClass başlatılamadı',
        `Arayüz yüklenemedi (${errorCode} ${errorDescription}).\n\nAdres: ${failedUrl || resolved}`,
      )
      app.quit()
    })

    const directFileUrl = url.pathToFileURL(resolved).toString()
    wc.loadURL(directFileUrl).catch(() => {
      void wc.loadFile(resolved).catch(err => {
        log.error('[JustMyClass] Arayuz yuklenemedi:', err)
      })
    })
  }
}

function setupIpcHandlers() {
  /**
   * Tum IPC cagrilarinin gectigi TEK nokta.
   *
   * BURAYA ANAHTAR SIZDIRMA KAPISI
   * -------------------------------
   * Bir saglayici 401 dondugunde hata govdesi bazen anahtarin bir
   * parcasini ya da tamamini icerir ("Invalid API key: sk-live-...").
   * `HttpError` bu metni dogrudan iletir, arayuz bir hata baloncugunda
   * gosterir ve ayni metin konsola yazilir. Kullanici ekran goruntusunu
   * ya da destek dosyasini paylasarak ANAHTARINI SIZDIRIR.
   *
   * `vaultService.redact()` kasadaki tum anahtarlari ve bilinen API
   * anahtar bicimlerini (sk-, AIza, ya29., gsk_, xai-, 1//) maskeler.
   * Onceki surumde bu yordam YAZILDI ama HICBIR YERDEN CAGRILMADI;
   * bu yuzden hicbir sizdirma senaryosunda devreye girmiyordu.
   *
   * Maskeleme burada, tek noktada yapilir: her cagri ve her hata
   * icin geçerlidir, unutulma riski yoktur.
   */
  // IPC donuslerinde maskeleme YAPILMAYACAK alanlar.
  //
  // NEDEN?
  // -----
  // `redact()` bir API anahtari kalibini metin icinde arar. Bu kaliplar
  // (ornegin `1/[A-Za-z0-9_-]{20,}`) saf base64 dizilerinin ICIYLE de
  // eslesir. Bir eslesme bulundugunda `[REDACTED]` yazilir; `[` ve `]`
  // base64 alfabesinde olmadigi icin tarayicida `atob()` patlar.
  //
  // GOZLENEN SONUC: 1 MB uzeri PDF'lerde (olasilik ~%95) kullanici
  // "PDF Gorunumu Acilamadi" yazisini goruyordu; buyuk gorseller de ayni
  // sekilde bozuluyordu. Kok neden CSP degil, maskeleme katmaniydi.
  //
  // COZUM: bu alanlar ikili dosya yuku tasir, gizli anahtar TASIMAZ.
  // Asagidaki listede hicbir API anahtari bulunmaz, bu yuzden atlanmak
  // guvenlik acigi degildir.
  const BINARY_FIELDS = new Set(['dataUrl', 'data_url', 'base64Data', 'base64_data', 'bytes'])

  const redactDeep = (value: unknown, depth = 0): unknown => {
    if (depth > 6) return value
    if (typeof value === 'string') return vaultService.redact(value)
    if (Array.isArray(value)) return value.map(item => redactDeep(item, depth + 1))
    if (value && typeof value === 'object') {
      // Hata nesnelerinin `message`/`stack` alanlari ozellikle onemli.
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (BINARY_FIELDS.has(k)) {
          out[k] = v // ikili yuk: oldugu gibi gecer
          continue
        }
        out[k] = k === 'stack' || k === 'message' ? redactDeep(String(v), depth + 1) : redactDeep(v, depth + 1)
      }
      return out
    }
    return value
  }

  const handle = <T>(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event)
      try {
        return redactDeep(await fn(event, ...args)) as T
      } catch (err) {
        // Renderer'a giden her sey buradan gecer; sifre yok sizmaz.
        if (err instanceof Error) {
          err.message = vaultService.redact(err.message)
          if (err.stack) err.stack = vaultService.redact(err.stack)
        }
        throw err
      }
    })
  }

  // ---- Hesap ------------------------------------------------------------
  handle('auth:loginWithGoogle', async (_e, extraScopes?: string[]) => {
    const account = await authService.loginWithGoogle(Array.isArray(extraScopes) ? extraScopes : [])
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    return account
  })
  handle('auth:cancelLogin', () => authService.cancelLogin())
  handle('auth:logout', async (_e, wipeCache?: boolean) => {
    // Depoyu silmek geri alinamaz. Renderer'a "sil" demesini tek
    // basina yeterli saymaz; ana surecte bir de dogrulama istenir.
    if (wipeCache === true) {
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['Vazgeç', 'Önbelleği sil'],
        defaultId: 0,
        cancelId: 0,
        title: 'Yerel verileri sil',
        message: 'Yerel önbellek silinsin mi?',
        detail:
          'Bu cihazda saklanan tüm ödev, materyal ve öğrenci teslim verileri kalıcı olarak silinecek. ' +
          'Google Classroom hesabınızda hiçbir şey değişmez, ancak veriler yeniden indirilene kadar uygulama boş görünecek.',
      })
      if (response !== 1) return false
    }
    const loggedOut = await authService.logout(wipeCache === true)
      // Baglam sifirlanmazsa bir sonraki kullanicinin yapay zeka
      // sohbetinde onceki hesabin ders/odev adlari saglayiciya gider.
      activeContextService.reset()
      toolDispatcher.clearPendingCalls()
      return loggedOut
  })
  handle('auth:getAccount', () => storageService.getAccount())
  handle('auth:getDiagnostics', () => authService.getDiagnostics())
  handle('auth:getAccountCapability', () => authService.getAccountCapability())
  handle('auth:setClientId', (_e, clientId: unknown) => {
    if (typeof clientId !== 'string' || clientId.length > 300) {
      throw new Error('Geçersiz istemci kimliği.')
    }
    authService.setClientId(clientId)
  })
  handle('auth:getClientId', () => authService.getClientId())
  handle('auth:setClientSecret', (_e, clientSecret: unknown) => {
    if (typeof clientSecret !== 'string' || clientSecret.length > 500) {
      throw new Error('Geçersiz istemci gizli anahtarı.')
    }
    authService.setClientSecret(clientSecret)
    return { success: true, hasClientSecret: authService.hasClientSecret() }
  })
  handle('auth:resetCustomClient', () => {
    authService.resetCustomClient()
    return authService.validateClientId()
  })
  handle('auth:validateClientId', (_e, clientId?: string) => authService.validateClientId(clientId))
  handle('auth:importGoogleCredentialsJson', (_e, jsonContent: unknown) => {
    if (typeof jsonContent !== 'string') throw new Error('Geçersiz JSON verisi.')
    return authService.importGoogleCredentialsJson(jsonContent)
  })
  handle('auth:pickAndImportCredentialsFile', async () => {
    if (!mainWindow) throw new Error('Ana pencere bulunamadı.')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Google OAuth İstemci Yapılandırma Dosyası (.json) Seçin',
      filters: [
        { name: 'JSON Dosyaları', extensions: ['json'] },
        { name: 'Tüm Dosyalar', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Dosya seçimi iptal edildi.' }
    }
    try {
      const filePath = result.filePaths[0]
      const content = fs.readFileSync(filePath, 'utf-8')
      return authService.importGoogleCredentialsJson(content)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Dosya okunamadı.' }
    }
  })
  // ---- Pencere Kontrolleri (Modern Temalı Çerçevesiz Pencere) --------
  handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize()
      return true
    }
    return false
  })
  handle('window:maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
      return mainWindow.isMaximized()
    }
    return false
  })
  handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close()
      return true
    }
    return false
  })
  handle('window:isMaximized', () => {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false
  })

  // ---- YouTube OEmbed & Video Bilgileri ----------------------------------
  handle('youtube:getMetadata', async (_e, videoId: unknown) => {
    if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId.trim())) {
      return null
    }
    const cleanId = videoId.trim()
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${cleanId}&format=json`,
        { signal: AbortSignal.timeout(4500) },
      )
      if (!res.ok) {
        return {
          id: cleanId,
          thumbnailUrl: `https://img.youtube.com/vi/${cleanId}/hqdefault.jpg`,
        }
      }
      const data = await res.json()
      return {
        id: cleanId,
        title: typeof data.title === 'string' ? data.title : undefined,
        authorName: typeof data.author_name === 'string' ? data.author_name : undefined,
        thumbnailUrl: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : `https://img.youtube.com/vi/${cleanId}/hqdefault.jpg`,
      }
    } catch {
      return {
        id: cleanId,
        thumbnailUrl: `https://img.youtube.com/vi/${cleanId}/hqdefault.jpg`,
      }
    }
  })

  // ---- Dosya Ekleme (Tüm Formatları Destekleyen Akıllı Ayıklayıcı) --------
  handle('app:pickAttachmentFile', async () => {
    if (!mainWindow) throw new Error('Ana pencere bulunamadı.')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Sohbete Dosya, Belge veya Kod Ekle',
      filters: [
        { name: 'Tüm Dosyalar (*.*)', extensions: ['*'] },
        {
          name: 'Belgeler ve Ofis Dosyaları (*.pdf, *.docx, *.pptx, *.xlsx, *.odt, *.ods, *.odp, *.rtf)',
          extensions: ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'odt', 'ods', 'odp', 'rtf'],
        },
        {
          name: 'Kod ve Yapılandırma Dosyaları',
          extensions: [
            'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'dart', 'html', 'css', 'json', 'yaml', 'yml', 'xml', 'sql', 'sh', 'bat', 'ps1', 'md', 'txt',
          ],
        },
        {
          name: 'Tablo ve Veri Dosyaları (*.csv, *.tsv, *.json, *.xlsx)',
          extensions: ['csv', 'tsv', 'json', 'xlsx', 'ods'],
        },
        {
          name: 'Görseller (*.png, *.jpg, *.webp, *.gif, *.svg)',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'tiff'],
        },
        {
          name: 'Ses ve Medya Dosyaları (*.mp3, *.wav, *.ogg, *.m4a, *.flac, *.mp4, *.webm, *.mkv)',
          extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'mp4', 'webm', 'mkv', 'mov', 'avi'],
        },
        {
          name: 'Arşivler ve Paketler (*.zip, *.jar, *.tar, *.gz, *.epub)',
          extensions: ['zip', 'jar', 'tar', 'gz', 'epub', '7z', 'rar'],
        },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const filePath = result.filePaths[0]
    const name = path.basename(filePath)
    const stats = fs.statSync(filePath)
    if (stats.size > 25 * 1024 * 1024) {
      throw new Error('Dosya boyutu 25 MB sınırını aşıyor.')
    }
    const buffer = fs.readFileSync(filePath)
    const extracted = extractUniversalAttachmentText(buffer, name)
    const base64Data = buffer.toString('base64')
    return {
      name,
      mimeType: extracted.mimeType,
      size: stats.size,
      base64Data,
      textContent: extracted.text,
      isImage: extracted.isImage,
      isPdf: extracted.isPdf,
      dataUrl: extracted.isImage || extracted.isPdf ? `data:${extracted.mimeType};base64,${base64Data}` : undefined,
    }
  })
  handle('auth:completeAuthWithCode', (_e, rawCodeOrUrl: unknown, redirectUri?: unknown, codeVerifier?: unknown) => {
    if (typeof rawCodeOrUrl !== 'string') throw new Error('Geçersiz yetkilendirme kodu.')
    return authService.completeAuthWithCode(
      rawCodeOrUrl,
      typeof redirectUri === 'string' ? redirectUri : undefined,
      typeof codeVerifier === 'string' ? codeVerifier : undefined,
    )
  })

  // ---- Classroom --------------------------------------------------------
  handle('classroom:syncAll', async () => {
    const acc = storageService.getAccount()
    if (!acc) return storageService.getSyncStatus()
    await classroomService.syncAll()
    return storageService.getSyncStatus()
  })
  handle('classroom:getSyncStatus', () => storageService.getSyncStatus())
  handle('classroom:getCourses', () => storageService.getCourses())
  handle('classroom:getCourseDetails', (_e, courseId: string) => {
    // Onceki surum yanlis dersi sessizce donduruyordu.
    const course = storageService.getCourses().find(c => c.id === courseId)
    if (!course) throw new Error('Ders bulunamadı. Lütfen senkronizasyon yapın.')
    return {
      course,
      topics: storageService.getTopics(courseId),
      courseWork: storageService.getCourseWork(courseId),
      announcements: storageService.getAnnouncements(courseId),
      materials: storageService.getMaterials(courseId),
      participants: storageService.getParticipants(courseId),
    }
  })
  handle('classroom:getCourseWork', (_e, courseId: string, workId: string) => {
    const work = storageService.getCourseWorkItem(courseId, workId)
    if (!work) throw new Error('Ödev bulunamadı.')
    return { work, rubric: storageService.getRubric(workId), submission: work.submission }
  })
  handle('classroom:turnIn', (_e, courseId: string, workId: string, submissionId: string) =>
    classroomService.turnInSubmission(String(courseId), String(workId), String(submissionId)),
  )
  handle(
    'classroom:attachAndTurnIn',
    async (_e, courseId: unknown, workId: unknown, submissionId: unknown, fileName: unknown, content: unknown) => {
      if (typeof courseId !== 'string' || typeof workId !== 'string' || typeof submissionId !== 'string') {
        throw new Error('Geçersiz teslim isteği.')
      }
      if (typeof fileName !== 'string' || typeof content !== 'string') {
        throw new Error('Geçersiz dosya içeriği.')
      }
      const uploaded = await driveService.uploadTextFile(fileName, content)
      return classroomService.attachAndTurnIn(courseId, workId, submissionId, {
        driveFileId: uploaded.driveFileId,
        title: uploaded.title,
      })
    },
  )
  handle('classroom:reclaim', (_e, courseId: string, workId: string, submissionId: string) =>
    classroomService.reclaimSubmission(String(courseId), String(workId), String(submissionId)),
  )
  handle('classroom:search', (_e, query: string) => storageService.search(String(query ?? '')))

  // ---- Yerel calisma taslagi --------------------------------------------
  handle('draft:get', (_e, courseId: unknown, workId: unknown) => {
    if (typeof courseId !== 'string' || typeof workId !== 'string') throw new Error('Geçersiz istek.')
    return storageService.getDraft(courseId, workId)
  })
  handle('draft:save', (_e, courseId: unknown, workId: unknown, fileName: unknown, content: unknown) => {
    if (typeof courseId !== 'string' || typeof workId !== 'string') throw new Error('Geçersiz istek.')
    if (typeof fileName !== 'string' || typeof content !== 'string') throw new Error('Geçersiz dosya.')
    if (content.length > 8 * 1024 * 1024) throw new Error('Taslak 8 MB sınırını aşıyor.')
    return storageService.saveDraft({
      courseId,
      courseWorkId: workId,
      fileName: fileName.slice(0, 180),
      content,
    })
  })
  handle('draft:delete', (_e, courseId: unknown, workId: unknown) => {
    if (typeof courseId !== 'string' || typeof workId !== 'string') throw new Error('Geçersiz istek.')
    storageService.deleteDraft(courseId, workId)
    return true
  })

  // ---- Dosyalar ---------------------------------------------------------
  handle('drive:downloadAttachment', (_e, attachment: any, courseId: unknown) => {
    if (!attachment || typeof attachment !== 'object') throw new Error('Geçersiz ek.')
    return driveService.downloadAttachment(attachment, String(courseId ?? ''))
  })
  handle('drive:openLocalFile', (_e, filePath: unknown) => {
    if (typeof filePath !== 'string') return false
    return driveService.openLocalFile(filePath)
  })
  handle('drive:saveLocalEditedFile', (_e, fileId: unknown, content: unknown) => {
    if (typeof fileId !== 'string') throw new Error('Geçersiz dosya kimliği.')
    const MAX = 32 * 1024 * 1024
    const size = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : (content as Uint8Array)?.byteLength ?? 0
    if (size > MAX) throw new Error('Dosya düzenleme sınırı 32 MB.')
    return storageService.updateLocalFileContent(fileId, content as string | Uint8Array)
  })
  handle('drive:readCachedFile', (_e, fileId: unknown) => {
    if (typeof fileId !== 'string') throw new Error('Geçersiz dosya kimliği.')
    const cached = storageService.getCachedFile(fileId)
    if (!cached) throw new Error('Dosya önbellekte yok.')
    return storageService.readCasFile(cached.absolutePath, cached.entry.sha256)
  })
  handle('drive:getFilePreview', (_e, attachment: any, courseId: unknown) => {
    if (!attachment || typeof attachment !== 'object') throw new Error('Geçersiz ek.')
    return filePreviewService.getFilePreview(attachment, String(courseId ?? ''))
  })
  handle('drive:saveFileAs', async (_e, fileId: unknown, defaultName: unknown) => {
    if (typeof fileId !== 'string') throw new Error('Geçersiz dosya kimliği.')
    if (!mainWindow) throw new Error('Ana pencere bulunamadı.')
    const cached = storageService.getCachedFile(fileId)
    if (!cached) throw new Error('Dosya önbellekte bulunamadı.')

    const originalName = typeof defaultName === 'string' && defaultName ? defaultName : cached.entry.title
    const ext = path.extname(originalName)

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Dosyayı Farklı Kaydet',
      defaultPath: originalName,
      filters: ext ? [{ name: 'Dosya Türü', extensions: [ext.replace('.', '')] }, { name: 'Tüm Dosyalar', extensions: ['*'] }] : undefined,
    })

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }

    const decrypted = storageService.readCasFile(cached.absolutePath, cached.entry.sha256)
    fs.writeFileSync(result.filePath, decrypted)
    return { success: true, filePath: result.filePath }
  })

  // ---- İndirilenler Klasörü ve Dosya Yöneticisi --------------------------
  handle('downloads:getConfig', () => {
    const defaultPath = path.join(app.getPath('downloads'), 'JustMyClass')
    const saved = storageService.getSetting<string>('downloads.path', '')
    const isCustom = Boolean(saved && saved.trim() && saved.trim() !== defaultPath)
    return {
      currentPath: isCustom ? saved.trim() : defaultPath,
      defaultPath,
      isDefault: !isCustom,
    }
  })

  handle('downloads:selectFolder', async () => {
    if (!mainWindow) throw new Error('Ana pencere bulunamadı.')
    const defaultPath = path.join(app.getPath('downloads'), 'JustMyClass')
    const current = storageService.getSetting<string>('downloads.path', '') || defaultPath
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'İndirilenler Klasörünü Seçin',
      defaultPath: fs.existsSync(current) ? current : app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) {
      return null
    }
    const selected = result.filePaths[0]
    storageService.setSetting('downloads.path', selected)
    return {
      currentPath: selected,
      defaultPath,
      isDefault: selected === defaultPath,
    }
  })

  handle('downloads:resetFolder', () => {
    const defaultPath = path.join(app.getPath('downloads'), 'JustMyClass')
    storageService.setSetting('downloads.path', '')
    if (!fs.existsSync(defaultPath)) {
      try {
        fs.mkdirSync(defaultPath, { recursive: true })
      } catch {
        /* ignore */
      }
    }
    return {
      currentPath: defaultPath,
      defaultPath,
      isDefault: true,
    }
  })

  handle('downloads:openFolder', () => {
    const dir = getDownloadsDirectory()
    void shell.openPath(dir)
    return true
  })

  handle('downloads:openPath', (_e, targetPath: unknown) => {
    if (typeof targetPath !== 'string' || !targetPath) return false
    driveService.openLocalFile(targetPath)
    return true
  })

  handle('downloads:showItemInFolder', (_e, targetPath: unknown) => {
    if (typeof targetPath !== 'string' || !targetPath) return false
    driveService.showItemInFolder(targetPath)
    return true
  })

  handle('downloads:checkFileStatus', (_e, rawAttachment: unknown) => {
    if (!rawAttachment || typeof rawAttachment !== 'object') {
      return { exists: false }
    }
    const att = rawAttachment as Record<string, unknown>
    const downloadsFolder = getDownloadsDirectory()

    // 1. Doğrudan dosya yolu verilmişse ve diskte varsa
    const explicitPaths = [att.downloadedPath, att.localPath].filter(
      (p): p is string => typeof p === 'string' && !!p.trim(),
    )
    for (const p of explicitPaths) {
      if (fs.existsSync(p)) {
        return { exists: true, filePath: p, fileName: path.basename(p) }
      }
    }

    // 2. İndirilenler klasöründe başlığa göre ara
    const title = typeof att.title === 'string' ? att.title.trim() : ''
    if (title && fs.existsSync(downloadsFolder)) {
      const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').trim()
      if (safeTitle) {
        const directPath = path.join(downloadsFolder, safeTitle)
        if (fs.existsSync(directPath)) {
          return { exists: true, filePath: directPath, fileName: safeTitle }
        }

        // Uzantısız veya farklı uzantılı / numaralandırılmış eşleşme
        try {
          const files = fs.readdirSync(downloadsFolder)
          const baseName = path.basename(safeTitle, path.extname(safeTitle)).toLowerCase()
          const matched = files.find(f => {
            const fLower = f.toLowerCase()
            const fBase = path.basename(f, path.extname(f)).toLowerCase()
            return fLower === safeTitle.toLowerCase() || fBase === baseName || fBase.startsWith(`${baseName} (`)
          })
          if (matched) {
            const matchedPath = path.join(downloadsFolder, matched)
            return { exists: true, filePath: matchedPath, fileName: matched }
          }
        } catch {
          /* klasör okuma hatası yoksayılır */
        }
      }
    }

    // 3. Drive File ID ile CAS önbellek başlığına göre indirilenler klasöründe ara
    let fileId = typeof att.driveFileId === 'string' ? att.driveFileId : ''
    if (!fileId && typeof att.alternateLink === 'string') {
      const match = att.alternateLink.match(
        /\/(?:file\/d\/|open\?id=|document\/d\/|spreadsheets\/d\/|presentation\/d\/)([a-zA-Z0-9_-]+)/i,
      )
      if (match && match[1]) fileId = match[1]
    }
    if (fileId && fs.existsSync(downloadsFolder)) {
      const cached = storageService.getCachedFile(fileId)
      if (cached?.entry?.title) {
        const safeCached = cached.entry.title.replace(/[\\/:*?"<>|]/g, '_').trim()
        if (safeCached) {
          const directPath = path.join(downloadsFolder, safeCached)
          if (fs.existsSync(directPath)) {
            return { exists: true, filePath: directPath, fileName: safeCached }
          }
        }
      }
    }

    // 4. Doğrudan CAS önbellek dosya yolunda mevcutsa
    const targetLookup = fileId || title
    if (targetLookup) {
      const cached = storageService.getCachedFile(targetLookup)
      if (cached?.absolutePath && fs.existsSync(cached.absolutePath)) {
        return {
          exists: true,
          filePath: cached.absolutePath,
          fileName: cached.entry?.title || title || path.basename(cached.absolutePath),
        }
      }
    }

    return { exists: false }
  })

  // ---- Baglam -----------------------------------------------------------
  handle('context:update', (_e, partial: unknown) => {
    if (!partial || typeof partial !== 'object') throw new Error('Geçersiz bağlam.')
    return activeContextService.updateContext(partial as Record<string, unknown>)
  })
  handle('context:get', () => activeContextService.getContext())

  // ---- Otomatik guncelleme ---------------------------------------------
  //
  // Dogrulanmis, ayri bir kanal. Genel `system:setSetting` uzerinden
  // yazilamaz; boylece renderer HTTPS denetimi olmadan gecersiz bir
  // yayin adresi kaydedip guncellemeyi sessizce bozamaz.
  handle('update:getStatus', () => getUpdateService().getStatus())
  handle('update:setFeedUrl', (_e, raw: unknown) => {
    if (typeof raw !== 'string') throw new Error('Geçersiz adres.')
    if (raw.length > 2048) throw new Error('Adres çok uzun.')
    return getUpdateService().setFeedUrl(raw)
  })
  handle('update:check', () => getUpdateService().check())
  handle('update:download', () => getUpdateService().download())
  handle('update:install', () => getUpdateService().quitAndInstall())

  // ---- Yapay zeka -------------------------------------------------------
  handle('ai:getProviders', () => aiOrchestrator.getProviders())
  handle('ai:saveProviderKey', (_e, providerId: unknown, apiKey: unknown) => {
    if (typeof providerId !== 'string' || typeof apiKey !== 'string') throw new Error('Geçersiz istek.')
    if (apiKey.length > 4096) throw new Error('Anahtar çok uzun.')
    const res = aiOrchestrator.setProviderKey(providerId, apiKey)
    mainWindow?.webContents.send('ai:providersUpdated')
    if (res && apiKey.trim().length > 0) {
      void aiOrchestrator
        .fetchProviderModels(providerId)
        .then(models => {
          mainWindow?.webContents.send('ai:providersUpdated')
          mainWindow?.webContents.send('ai:modelsUpdated', [{ providerId, count: models.length }])
        })
        .catch(() => {})
    }
    return res
  })
  handle('ai:deleteProviderKey', (_e, providerId: unknown) => {
    if (typeof providerId !== 'string') return false
    const res = aiOrchestrator.deleteProviderKey(providerId)
    mainWindow?.webContents.send('ai:providersUpdated')
    return res
  })
  handle('ai:saveCustomProvider', (_e, config: unknown) => {
    if (!config || typeof config !== 'object') throw new Error('Geçersiz sağlayıcı tanımı.')
    const res = aiOrchestrator.saveCustomProvider(config as never)
    mainWindow?.webContents.send('ai:providersUpdated')
    if (res?.id && (res.isLocal || res.hasKey)) {
      void aiOrchestrator
        .fetchProviderModels(res.id)
        .then(models => {
          mainWindow?.webContents.send('ai:providersUpdated')
          mainWindow?.webContents.send('ai:modelsUpdated', [{ providerId: res.id, count: models.length }])
        })
        .catch(() => {})
    }
    return res
  })
  handle('ai:removeProvider', (_e, providerId: unknown) => {
    if (typeof providerId !== 'string') throw new Error('Geçersiz sağlayıcı.')
    const res = aiOrchestrator.removeProvider(providerId)
    mainWindow?.webContents.send('ai:providersUpdated')
    return res
  })
  handle('ai:setLocalEndpoint', (_e, providerId: unknown, baseUrl: unknown) => {
    if (typeof providerId !== 'string' || typeof baseUrl !== 'string') {
      throw new Error('Geçersiz istek.')
    }
    const res = aiOrchestrator.setLocalEndpoint(providerId, baseUrl)
    mainWindow?.webContents.send('ai:providersUpdated')
    void aiOrchestrator
      .fetchProviderModels(providerId)
      .then(models => {
        mainWindow?.webContents.send('ai:providersUpdated')
        mainWindow?.webContents.send('ai:modelsUpdated', [{ providerId, count: models.length }])
      })
      .catch(() => {})
    return res
  })
  handle('ai:fetchProviderModels', async (_e, providerId: unknown) => {
    if (typeof providerId !== 'string') return []
    const models = await aiOrchestrator.fetchProviderModels(providerId)
    mainWindow?.webContents.send('ai:providersUpdated')
    mainWindow?.webContents.send('ai:modelsUpdated', [{ providerId, count: models.length }])
    return models
  })

  /**
   * Tum saglayicilarin model listesini tek seferde tazeler.
   */
  handle('ai:syncAllProviderModels', async () => {
    const results = await aiOrchestrator.syncAllProviderModels()
    mainWindow?.webContents.send('ai:providersUpdated')
    mainWindow?.webContents.send('ai:modelsUpdated', results)
    return results
  })

  handle('ai:testProviderConnection', (_e, providerId: unknown) =>
    typeof providerId === 'string'
      ? aiOrchestrator.testConnection(providerId)
      : { healthy: false, latencyMs: 0, error: 'Geçersiz sağlayıcı.' },
  )

  /**
   * Devam eden yapay zeka akisları.
   *
   * Onceki surumde akis yonetimi YOKTU: kullanici "Durdur" dugmesine
   * bassa bile istek server'a gonderilmis oluyor, gomulu `httpClient`
   * zaman asimini `finally` blogunda iptal ediyor ve `iterateStream`
   * `reader.read()` uzerinde sonsuza kadar bekliyordu. Sonuc: uygulama
   * kalici olarak "Yanit bekleniyor..." ekraninda kilitleniyor, butunlar
   * pasifleşiyor ve yeniden baslatmak icin uygulamayi kapatmak gerekiyordu.
   *
   * Artik her istek kendi `AbortController`'ina sahiptir ve kanal kimligiyle
   * eslesir. Ayni kanalda yeni istek baslatilmasi eskisini de otomatik
   * iptal eder.
   */
  const aiStreams = new Map<string, AbortController>()

  handle('ai:sendChatMessage', async (event, params: any) => {
    if (!params || typeof params !== 'object') throw new Error('Geçersiz istek.')
    const { channelId, ...rest } = params
    if (typeof channelId !== 'string' || !/^ai_stream_[a-z0-9_]+$/i.test(channelId)) {
      throw new Error('Geçersiz yayın kanalı.')
    }

    // Ayni kanaldaki onceki akis (orn. kullanicinin hizli arka arkaya
    // gondermesi) iptal edilir.
    aiStreams.get(channelId)?.abort(new Error('Önceki istek iptal edildi.'))
    const controller = new AbortController()
    aiStreams.set(channelId, controller)

    try {
      return await aiOrchestrator.sendChatMessage(
        rest,
        (chunk, reasoning) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(channelId, { chunk, reasoning })
          }
        },
        controller.signal,
      )
    } finally {
      // Yalnizca kendi kaydimizi temizle; araya baska bir akis girmisse
      // onun kaydini silme.
      if (aiStreams.get(channelId) === controller) aiStreams.delete(channelId)
    }
  })

  /**
   * Kullanici "Durdur" dediginde tum akislari iptal eder.
   *
   * Renderer'a `false` doneb, cunku iptal bir hata DEGILDIR: kullanici
   * istedigi bir seyi yapmamistir ve arayuzde hata balonu gosterilmemelidir.
   */
  handle('ai:cancel', () => {
    let count = 0
    for (const controller of aiStreams.values()) {
      controller.abort(new Error('Kullanıcı yanıt üretimini durdurdu.'))
      count += 1
    }
    aiStreams.clear()
    return count > 0
  })

  // ---- Arac onaylari ----------------------------------------------------
  handle('tool:approve', (_e, callId: unknown) =>
    typeof callId === 'string' ? toolDispatcher.approveCall(callId) : false,
  )
  handle('tool:reject', (_e, callId: unknown) =>
    typeof callId === 'string' ? toolDispatcher.rejectCall(callId) : false,
  )
  handle('tool:execute', (_e, name: unknown, args: unknown) => {
    if (typeof name !== 'string') throw new Error('Geçersiz araç adı.')
    return toolDispatcher.executeTool(name, (args as Record<string, unknown>) ?? {})
  })
  handle('tool:getPermissions', () => toolDispatcher.getPermissions())
  handle('tool:setPermissions', (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('Geçersiz izin tanımı.')
    return toolDispatcher.setPermissions(patch as never)
  })

  // ---- JustMyClass Hafıza & Taste Sistemi --------------------------------
  handle('ai:getMemoryProfile', (_e, sessionId?: string) =>
    memoryService.getProfile(sessionId),
  )
  handle('ai:saveMemoryItem', (_e, item: any, sessionId?: string) =>
    memoryService.saveItem(item, sessionId),
  )
  handle('ai:deleteMemoryItem', (_e, id: string, sessionId?: string) =>
    memoryService.deleteItem(id, sessionId),
  )
  handle('ai:clearMemory', (_e, scope: 'global' | 'session' | 'all', sessionId?: string) =>
    memoryService.clear(scope, sessionId),
  )

  // ---- Sohbet Geçmişi & Oturum Yönetimi -----------------------------------
  handle('ai:getChatSessions', () =>
    chatSessionService.listSessions(),
  )
  handle('ai:getChatSession', (_e, id: string) =>
    chatSessionService.getSession(id),
  )
  handle('ai:saveChatSession', (_e, session: any) =>
    chatSessionService.saveSession(session),
  )
  handle('ai:deleteChatSession', (_e, id: string) =>
    chatSessionService.deleteSession(id),
  )
  handle('ai:renameChatSession', (_e, id: string, newTitle: string) =>
    chatSessionService.renameSession(id, newTitle),
  )

  // ---- Ayarlar (sifreli depoda saklanir) ---------------------------------
  // Yalnizca izin verilen anahtar grubu disaridan yazilabilir; boylece
  // renderer herhangi bir anahtari kendi yazma yetisiyle degistiremez.
  // Okuma tarafi AYRI bir beyaz listeye tabidir: depoda `customProviders`
  // gibi anahtarlar da bulunur ve iclerinde kullanicinin yazdigi ham
  // `customHeaders` (ornegin `Authorization: Bearer ...`) degerleri
  // saklanabilir. Tek liste kullanilsaydi renderer bunlari okuyabilirdi.
  handle('settings:get', (_e, key: unknown, fallback?: unknown) => {
    if (typeof key !== 'string' || !READABLE_SETTING_KEYS.has(key)) {
      throw new Error('Bu ayar okunamaz.')
    }
    const value = storageService.getSetting(key, null)
    return value === null ? (fallback ?? null) : value
  })
  handle('settings:set', (_e, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !ALLOWED_SETTING_KEYS.has(key)) {
      throw new Error('Bu ayar değiştirilemez.')
    }
    storageService.setSetting(key, value)
    return true
  })

  // ---- Disa aktarma -----------------------------------------------------
  handle('export:data', (_e, format: unknown, courseId?: unknown) => {
    const allowed: ExportFormat[] = ['csv', 'json', 'markdown', 'anki']
    if (typeof format !== 'string' || !allowed.includes(format as ExportFormat)) {
      throw new Error(`Desteklenmeyen biçim. Seçenekler: ${allowed.join(', ')}`)
    }
    return exportService.exportData(format as ExportFormat, typeof courseId === 'string' ? courseId : undefined)
  })

  // ---- Sistem -----------------------------------------------------------
  handle('system:openExternalUrl', (_e, url: unknown) => openExternalSafely(url))
  handle('system:getAppVersion', () => buildVersionInfo())
  handle('system:securityInfo', () => ({
    store: storageService.getStorageSecurityInfo(),
    vault: vaultService.describe(),
  }))

  /**
   * Kullanicinin verisinin TAM olarak nerede durdugunu soyleyen yol.
   *
   * Kurulum sihirbazi bunu gosterir: "verileriniz burada" demek bir
   * sey, o klasoru `app.getPath('userData')` ile somut olarak
   * gostermek baska bir sey. Kullanici nereye bakacagini bilir.
   *
   * Sadece OKUNUR; yazma veya silme yetkisi vermez.
   */
  handle('system:getDataPath', () => ({
    userData: app.getPath('userData'),
    // Yerel modellerin indirildigi klasor (Ollama vb. harici).
    temp: app.getPath('temp'),
  }))

  /**
   * "Verilerim nereye kaydediliyor ve neden kayboluyor?" sorusunun
   * kesin cevabi. Ayarlar > Senkronizasyon ekraninda gosterilir.
   *
   * Salt okunur; hicbir sey yazmaz veya silmez.
   */
  handle('system:diagnostics', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    dataDir: app.getPath('userData'),
    keyring: keyringService.getKeyDiagnostics(),
    store: storageService.getStoreHealth(),
    vault: vaultService.getVaultHealth(),
    security: {
      store: storageService.getStorageSecurityInfo(),
      vault: vaultService.describe(),
    },
  }))
  handle('system:wipeLocalCache', async () => {
    // Geri alinamaz ve veri kaybettirir; ana surecte dogrulanir.
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Vazgeç', 'Önbelleği sil'],
      defaultId: 0,
      cancelId: 0,
      title: 'Yerel verileri sil',
      message: 'Yerel önbellek silinsin mi?',
      detail:
        'Bu cihazda saklanan tüm ödev, materyal ve öğrenci teslim verileri kalıcı olarak silinecek. ' +
        'Bu işlem geri alınamaz.',
    })
    if (response !== 1) return false
    storageService.wipeLocalCache()
    return true
  })

  /**
   * Panoya yazma.
   *
   * Electron'un kendi `clipboard` modulu kullanilir. Renderer'daki
   * `navigator.clipboard` bir promise dondurdugu icin hata durumu
   * yakalanamaz ve kullaniciya "Kopyalandi" geri bildirimi verilirken
   * hicbir sey kopyalanmayabiliyordu. Burada hata senkron olarak
   * firlatilir ve arayuz gercek durumu gosterebilir.
   */
  handle('app:copyText', (_e, text: unknown) => {
    if (typeof text !== 'string') throw new Error('Geçersiz metin.')
    if (text.length > 5 * 1024 * 1024) throw new Error('Metin çok büyük.')
    clipboard.writeText(text)
    return true
  })

  /**
   * Her seyi sil: oturum, yerel egitim verisi, indirilen dosyalar ve
   * kasadaki TUM anahtarlar.
   *
   * Ayarlar ekraninda "Tum yerel verileri sil" dediginizde once
   * `logout` sonra `wipeLocalCache` cagriliyordu; ancak
   * `vaultService.wipeAllKeys()` HICBIR YERDEN CAGRILMIYORDU. Yani
   * arayuz "kasadaki API anahtarlari silindi" dese de OpenAI, Anthropic,
   * Tavily, Brave anahtarlari ve OAuth client secret'i diskte kaliyordu.
   */
  handle('system:wipeEverything', async () => {
    // Geri alinamaz ve veri kaybettirir; ana surecte dogrulanir.
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Vazgeç', 'Her şeyi sil'],
      defaultId: 0,
      cancelId: 0,
      title: 'Tüm yerel verileri sil',
      message: 'Bu cihazdaki tüm veriler silinsin mi?',
      detail:
        'Silinecekler:\n' +
        '  • Google oturumu ve erişim belirteçleri\n' +
        '  • İndirilen tüm ödev, materyal ve teslim dosyaları\n' +
        '  • Kasada saklanan TÜM API anahtarları (AI sağlayıcıları, arama servisleri)\n' +
        '  • Çalışma taslakları\n\n' +
        'Google Classroom hesabınızda hiçbir şey değişmez. ' +
        'API anahtarlarınızı silerseniz yeniden girmeniz gerekir.\n\n' +
        'Bu işlem geri alınamaz.',
    })
    if (response !== 1) return false

    try {
      // 1) Google oturumunu kapat ve belirtecleri geri cel et.
      await authService.logout(true)
      // 2) Bekleyen arac onaylarini ve baglami temizle.
      activeContextService.reset()
      toolDispatcher.clearPendingCalls()
      // 3) Indirilen dosyalar + egitim verisi + ayarlar.
      storageService.wipeLocalCache()
      // 4) Kasadaki tum anahtarlar.
      vaultService.wipeAllKeys()
      // 5) Ana anahtarin kendisini yok et; sifreli veriler artik acilamaz.
      keyringService.cryptoShred()

      return true
    } catch (err) {
      // Sessizce basari diye bildirme: kullanici gercekte ne oldugunu bilmeli.
      throw new Error(
        `Temizlik sırasında bir hata oluştu: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  })
}

/**
 * Ikinci bir ornegin calismasini engelle: sifreli depo ayni anda iki
 * surec tarafindan acilirsa yazma catismasi olur.
 *
 * Bu kontrol DOSYANIN EN BASINDA olmak zorunda. `app.whenReady()` bir
 * kez armediginda ikinci ornek de kendi `createWindow()` cagrisini
 * yapabilir; kilit bu noktadan sonra alinirsa yarisi acilmis bir
 * uygulama kalir ve `app.quit()` yarisi calisan sureci durdurmaz.
 */
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      // macOS'ta tum pencereler kapanmis olabilir; yenisini ac.
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('open-url', event => {
    event.preventDefault()
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  function registerAppProtocols(): void {
    try {
      if (!app.isDefaultProtocolClient('justmyclass')) {
        app.setAsDefaultProtocolClient('justmyclass')
      }
    } catch (err) {
      log.warn('[JustMyClass] setAsDefaultProtocolClient uyarısı:', err)
    }

    // Windows'ta tarayıcıların "...... adlı uygulamayı aç" yerine
    // temiz şekilde "JustMyClass adlı uygulamayı aç" göstermesini sağlar.
    if (process.platform === 'win32') {
      try {
        const regCmd = `reg add "HKCU\\Software\\Classes\\justmyclass" /v FriendlyTypeName /t REG_SZ /d "JustMyClass" /f`
        execFileSync('cmd.exe', ['/c', regCmd], { stdio: 'ignore', timeout: 3000, windowsHide: true })
        const defCmd = `reg add "HKCU\\Software\\Classes\\justmyclass" /ve /t REG_SZ /d "JustMyClass" /f`
        execFileSync('cmd.exe', ['/c', defCmd], { stdio: 'ignore', timeout: 3000, windowsHide: true })
        const appCmd = `reg add "HKCU\\Software\\Classes\\Applications\\JustMyClass.exe" /v FriendlyAppName /t REG_SZ /d "JustMyClass" /f`
        execFileSync('cmd.exe', ['/c', appCmd], { stdio: 'ignore', timeout: 3000, windowsHide: true })
        const appDefCmd = `reg add "HKCU\\Software\\Classes\\Applications\\JustMyClass.exe" /ve /t REG_SZ /d "JustMyClass" /f`
        execFileSync('cmd.exe', ['/c', appDefCmd], { stdio: 'ignore', timeout: 3000, windowsHide: true })
        const appRelCmd = `reg add "HKCU\\Software\\Classes\\justmyclass" /v Application /t REG_SZ /d "JustMyClass.exe" /f`
        execFileSync('cmd.exe', ['/c', appRelCmd], { stdio: 'ignore', timeout: 3000, windowsHide: true })
      } catch {
        /* yut */
      }
    }
  }

  app.whenReady()
    .then(() => {
      // Gunluk dosya sistemi `userData/logs` altinda acilir. Bundan once gelen
      // kayitlar konsola dusmus olur; kaybolmaz.
      initLoggerFromElectron()

      // safeStorage ve isletim sistemi anahtar deposu artik hazir.
      try {
        vaultService.ensureLoaded()
        storageService.ensureLoaded()
        authService.tryAutoDetectDesktopCredentials()
      } catch (err) {
        log.warn('[JustMyClass] Kasa/depo baslangic yuklemesi uyarisi:', err)
      }

      // Ekstra izin isteklerini de kapat (pano yazma haric).
      const GLOBAL_ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-write'])
      session.defaultSession.setPermissionRequestHandler((_s, permission, cb) =>
        cb(GLOBAL_ALLOWED_PERMISSIONS.has(permission)),
      )
      session.defaultSession.setPermissionCheckHandler((_s, permission) =>
        GLOBAL_ALLOWED_PERMISSIONS.has(permission),
      )

      registerAppProtocols()

      setupIpcHandlers()
      createWindow()

      /*
        Arka planda surum kontrolu.
        Uygulama acilisini GECIKTIRMEZ ve kullanicya bildirim
        GOSTERMEZ; yalnizca "Guncelleme hazir" rozeti belirir.
        Adres tanimli degilse hicbir ag trafigi olusmaz.
      */
      getUpdateService().checkInBackground()

      // -------------------------------------------------------------------
      // MODEL KATALOGU OTOMATIK SENKRONU
      // -------------------------------------------------------------------
      // Kullanici istemisti: "Modelleri sorgula dugmesine basmadan, her
      // uygulama acilisinda otomatik guncel modelleri cek."
      //
      // NEDEN BU NOKTADA
      // ---------------
      //   - Kasa ve depo YUKLENDI, anahtarlar okunabiliyor.
      //   - IPC handlers kuruldu, yeni cagirmalar guvenli.
      //   - `createWindow()` cagrildi; ozellikle "app is acilisinda
      //     bir sey yapmiyor" gibi gorunmesin diye asenkron ve
      //     HICBIR SEYI BLOKE ETMEYEN sekilde baslatiliyor.
      //
      // HATASIZLIK
      // -----------
      // Ag yoksa, saglayici cokerse veya anahtar gecersizse sessizce
      // gecersiz: gomulu katalog zaten doludur ve kullanici calisir
      // durumdadir. Kullaniciya "modeller alinamadi" hatasI GOSTERILMEZ
      // cunku bu bir hata degil, beklenen bir durumdur (uygulama
      // internet kapali acilabilir).
      void aiOrchestrator
        .syncAllProviderModels()
        .then(results => {
          const ok = results.filter(r => r.count > 0)
          if (ok.length) {
            log.info(
              `[JustMyClass] Model katalogu guncellendi: ${ok
                .map(r => `${r.providerId}(${r.count})`)
                .join(', ')}`,
            )
          }
          const notifyRenderer = () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('ai:providersUpdated')
              mainWindow.webContents.send('ai:modelsUpdated', results)
            }
          }
          notifyRenderer()
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.isLoading()) {
            mainWindow.webContents.once('did-finish-load', notifyRenderer)
          }
        })
        .catch(err => {
          log.warn('[JustMyClass] Model senkronu tamamlanamadi:', String(err))
        })

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch(err => {
      // Arma hatasi kullaniciya gorunmez sekilde yutulmaz.
      dialog.showErrorBox(
        'JustMyClass başlatılamadı',
        `Uygulama başlatılırken bir hata oluştu:\n\n${String(err)}`,
      )
      app.exit(1)
    })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})