import { shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Attachment } from '../../types/jmc'
import { StorageService } from './storageService'
import { VaultService } from './vaultService'
import { AuthService } from './authService'
import { providerHttp, HttpError } from './httpClient'

/** Google Workspace Belgeleri icin MIME donusum tablosu. */
const WORKSPACE_EXPORT: Record<string, { exportMime: string; extension: string }> = {
  'application/vnd.google-apps.document': {
    exportMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    exportMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    exportMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: 'pptx',
  },
  'application/vnd.google-apps.drawing': { exportMime: 'image/png', extension: 'png' },
  'application/vnd.google-apps.script': { exportMime: 'application/vnd.google-apps.script+json', extension: 'gs' },
}

/** Guvenlik: calistirilabilir ve script dosyalari indirilmez. */
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.msp',
  '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.hta', '.cpl', '.jar', '.app', '.dmg', '.pkg',
])

export class DriveService {
  constructor(
    private storageService: StorageService,
    private vaultService: VaultService,
    private authService?: AuthService,
    private getDownloadsDir?: () => string,
  ) {}

  /**
   * Gecerli bir erisim belirteci dondurur.
   *
   * Google erisim belirtecleri YALNIZCA 1 saat gecerlidir. Onceki
   * surumde kasadaki belirtec dogrudan okunuyordu; 1 saat sonra indirme,
   * dosya acma ve teslim (turn-in) sessizce HTTP 401 aliyor ve kullanici
   * yeniden giris yapmak zorunda kaliyordu. Artik sureci dolmus bir
   * belirtec, kullanicidan istenmeden yenileniyor.
   */
  private async getAccessToken(): Promise<string> {
    const cached = this.vaultService.getKey('google_access_token')
    if (cached) return cached
    if (this.authService) {
      const refreshed = await this.authService.refreshAccessToken()
      if (refreshed) return refreshed
    }
    throw new Error(
      'Google oturumunuzun süresi doldu. Lütfen Ayarlar → Hesap bölümünden çıkış yapıp yeniden bağlanın.',
    )
  }

  /**
   * Google API istegini 401 dayanikli sekilde yurutur.
   *
   * Belirtec sureci dolmus olabilir; bu durumda bir kez yenileyip istegi
   * tekrarlar. Boylece kullanici "Google baglantisi yok" hatasini gormez,
   * islem sessizce kendiliginden duzelir.
   */
  private async withFreshToken<T>(
    run: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    const token = await this.getAccessToken()
    try {
      return await run({ Authorization: `Bearer ${token}` })
    } catch (err) {
      const unauthorized = err instanceof HttpError && (err.status === 401 || err.isAuthError)
      if (!unauthorized || !this.authService) throw err
      const refreshed = await this.authService.refreshAccessToken()
      if (!refreshed) throw err
      return await run({ Authorization: `Bearer ${refreshed}` })
    }
  }

  /** Dosya adindan yurutulebilir bir uzantı tespit eder. */
  private isExecutableName(title: string): boolean {
    const lower = title.toLowerCase()
    return [...BLOCKED_EXTENSIONS].some(ext => lower.endsWith(ext))
  }

  public async downloadAttachment(attachment: Attachment, courseId: string): Promise<Attachment> {
    let fileId = attachment.driveFileId
    if (!fileId && attachment.alternateLink) {
      const match = attachment.alternateLink.match(
        /\/(?:file\/d\/|open\?id=|document\/d\/|spreadsheets\/d\/|presentation\/d\/)([a-zA-Z0-9_-]+)/i,
      )
      if (match && match[1]) {
        fileId = match[1]
      }
    }

    // Once onbellekte var mi?
    if (fileId) {
      const cached = this.storageService.getCachedFile(fileId)
      if (cached && cached.entry.syncState !== 'ACCESS_DENIED') {
        let downloadedPath: string | undefined = undefined
        if (this.getDownloadsDir) {
          try {
            const downloadsFolder = this.getDownloadsDir()
            if (!fs.existsSync(downloadsFolder)) {
              fs.mkdirSync(downloadsFolder, { recursive: true })
            }
            const safeTitle = (cached.entry.title || attachment.title || 'dosya').replace(/[\\/:*?"<>|]/g, '_').trim() || 'dosya'
            let destPath = path.join(downloadsFolder, safeTitle)
            if (!fs.existsSync(destPath)) {
              const content = this.storageService.readCasFile(cached.absolutePath, cached.entry.sha256)
              fs.writeFileSync(destPath, content)
            }
            downloadedPath = destPath
          } catch {
            // downloads klasorune kopyalama basarisiz olursa guvenli CAS yolu kullanilir
          }
        }
        return {
          ...attachment,
          driveFileId: fileId,
          isLocalAvailable: true,
          localPath: downloadedPath || cached.absolutePath,
          downloadedPath,
          sha256: cached.entry.sha256,
          syncState: cached.entry.syncState,
        }
      }
    }

    if (!fileId) {
      return attachment
    }
    if (this.isExecutableName(attachment.title)) {
      return { ...attachment, syncState: 'ACCESS_DENIED' }
    }

    try {
      // 1) METADATA HER ZAMAN ONCE ALINIR.
      //
      // Classroom API'sinin `DriveFile` kaynaginda yalnizca `id`, `title`,
      // `alternateLink` ve `thumbnailUrl` alanlari vardir; `mimeType`
      // DONDURULMEZ. Onceki surum `attachment.mimeType` degerine bakip
      // dogrudan `alt=media` cagirdigi icin Google Docs/Sheets/Slides
      // dosyalari her zaman "Only files with binary content can be
      // downloaded" (403) hatasiyla basarisiz oluyordu.
      //
      // Drive'in kendi metadata ucu ise gercek MIME turunu verir ve
      // Workspace export yolunu dogru sekilde secmemizi saglar.
      let meta: any = null
      try {
        meta = await this.withFreshToken(headers =>
          providerHttp.request<any>(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
              `?fields=id,name,mimeType,size,capabilities(canDownload),exportLinks`,
            { headers, timeoutMs: 30_000, maxRetries: 1 },
          ),
        )
      } catch {
        /* meta API çağrısı başarısız olsa da alternatif dışa aktarma uçları denenecek */
      }

      const driveMime: string = typeof meta?.mimeType === 'string' ? meta.mimeType : (attachment.mimeType || '')
      let finalTitle = (meta?.name as string) || attachment.title

      const declaredSize = Number(meta?.size ?? meta?.sizeBytes ?? 0)
      const MAX_BYTES = 512 * 1024 * 1024
      if (declaredSize > MAX_BYTES) {
        throw new Error('Dosya 512 MB sınırını aşıyor; indirilmedi.')
      }

      let content: Buffer | null = null
      let finalMime = driveMime || attachment.mimeType || 'application/octet-stream'

      const mapping = WORKSPACE_EXPORT[driveMime]
      if (mapping) {
        // 2) Google Workspace belgesi: `export` ucu ile disa aktar.
        try {
          const url =
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export` +
            `?mimeType=${encodeURIComponent(mapping.exportMime)}`
          const res = await this.withFreshToken(headers =>
            providerHttp.request<Response>(url, { headers, raw: true, timeoutMs: 120_000 }),
          )
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length > 0) {
            content = buf
            finalMime = mapping.exportMime
            if (!/\.[a-z0-9]+$/i.test(finalTitle)) finalTitle = `${finalTitle}.${mapping.extension}`
          }
        } catch {
          /* Fallback uçlarına geç */
        }
      }

      if (!content && !mapping) {
        // 3) Normal ikili dosya: doğrudan indir.
        try {
          const res = await this.withFreshToken(headers =>
            providerHttp.request<Response>(
              `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
              { headers, raw: true, timeoutMs: 120_000 },
            ),
          )
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length > 0) {
            content = buf
            finalMime = driveMime || attachment.mimeType || 'application/octet-stream'
          }
        } catch {
          /* Fallback uçlarına geç */
        }
      }

      // 4) Okul alan adı kısıtlamalarına karşı doğrudan dışa aktarma/indirme yedek uçları
      if (!content) {
        const altLink = attachment.alternateLink || ''
        const isDocs = altLink.includes('document/d/') || driveMime.includes('document')
        const isSheets = altLink.includes('spreadsheets/d/') || driveMime.includes('spreadsheet')
        const isSlides = altLink.includes('presentation/d/') || driveMime.includes('presentation')

        const fallbackEndpoints: Array<{ url: string; ext: string; mime: string }> = []
        if (isDocs) {
          fallbackEndpoints.push(
            { url: `https://docs.google.com/document/d/${fileId}/export?format=pdf`, ext: 'pdf', mime: 'application/pdf' },
            { url: `https://docs.google.com/document/d/${fileId}/export?format=docx`, ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          )
        } else if (isSheets) {
          fallbackEndpoints.push(
            { url: `https://docs.google.com/spreadsheets/d/${fileId}/export?format=pdf`, ext: 'pdf', mime: 'application/pdf' },
            { url: `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`, ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
          )
        } else if (isSlides) {
          fallbackEndpoints.push(
            { url: `https://docs.google.com/presentation/d/${fileId}/export/pdf`, ext: 'pdf', mime: 'application/pdf' },
            { url: `https://docs.google.com/presentation/d/${fileId}/export/pptx`, ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
          )
        }
        fallbackEndpoints.push({
          url: `https://drive.google.com/uc?export=download&id=${fileId}`,
          ext: '',
          mime: 'application/octet-stream',
        })

        for (const ep of fallbackEndpoints) {
          try {
            const res = await this.withFreshToken(headers =>
              providerHttp.request<Response>(ep.url, { headers, raw: true, timeoutMs: 60_000 }),
            )
            const buf = Buffer.from(await res.arrayBuffer())
            if (buf.length > 500) {
              content = buf
              finalMime = ep.mime || finalMime
              if (ep.ext && !finalTitle.toLowerCase().endsWith(`.${ep.ext}`)) {
                finalTitle = `${finalTitle.replace(/\.[^/.]+$/, '')}.${ep.ext}`
              }
              break
            }
          } catch {
            /* sonraki fallback uca geç */
          }
        }
      }

      if (!content || content.length === 0) {
        if (meta?.capabilities?.canDownload === false) {
          return { ...attachment, syncState: 'ACCESS_DENIED' }
        }
        throw new Error('Dosya içeriği indirilemedi. Erişim izinlerini veya dosya durumunu kontrol edin.')
      }

      const { sha256, absolutePath } = this.storageService.saveFileToCas(
        fileId,
        courseId,
        finalTitle,
        finalMime,
        content,
        attachment.driveFileId,
      )

      // Kullanıcının yapılandırılmış İndirilenler klasörüne de doğrudan kaydedilir
      let downloadedPath: string | undefined
      if (this.getDownloadsDir) {
        try {
          const downloadsFolder = this.getDownloadsDir()
          if (!fs.existsSync(downloadsFolder)) {
            fs.mkdirSync(downloadsFolder, { recursive: true })
          }
          let safeTitle = finalTitle.replace(/[\\/:*?"<>|]/g, '_').trim() || 'dosya'
          let destPath = path.join(downloadsFolder, safeTitle)
          if (fs.existsSync(destPath)) {
            const ext = path.extname(safeTitle)
            const base = path.basename(safeTitle, ext)
            let counter = 1
            while (fs.existsSync(destPath)) {
              destPath = path.join(downloadsFolder, `${base} (${counter})${ext}`)
              counter++
            }
          }
          fs.writeFileSync(destPath, content)
          downloadedPath = destPath
        } catch {
          // İndirilenler klasörüne yazma başarısız olursa güvenli CAS yolu kullanılır
        }
      }

      return {
        ...attachment,
        title: finalTitle,
        mimeType: finalMime,
        sizeBytes: content.length,
        isLocalAvailable: true,
        localPath: downloadedPath || absolutePath,
        downloadedPath,
        sha256,
        syncState: 'DOWNLOADED',
      }
    } catch (err) {
      if (err instanceof HttpError && err.isPermissionError) {
        return { ...attachment, syncState: 'ACCESS_DENIED' }
      }
      const message = this.explainDownloadError(err)
      throw new Error(`Dosya indirilemedi: ${message}`)
    }
  }

  /**
   * Indirme hatasini kullaniciya ne yapmasi gerektigini soyleyen
   * Turkce bir mesaja cevirir.
   */
  private explainDownloadError(err: unknown): string {
    if (!(err instanceof HttpError)) {
      return err instanceof Error ? err.message : 'Bilinmeyen hata'
    }
    const snippet = (err.bodySnippet ?? '').toLowerCase()
    if (err.status === 403) {
      if (snippet.includes('binary content')) {
        return (
          'Google Belgesi/Sheet/Slide içeriği doğrudan indirilemiyor. ' +
          'Belgeyi Google Dokümanlar uygulamasından PDF olarak dışa aktarıp yükleyin.'
        )
      }
      if (snippet.includes('insufficient') || snippet.includes('permission')) {
        return 'Drive paylaşım izniniz yok. Dosyayı paylaşan kişiyle iletişime geçin.'
      }
      if (snippet.includes('quota')) {
        return 'Google API kotası aşıldı. Lütfen birazdan tekrar deneyin.'
      }
      return 'Google bu dosyaya erişime izin vermedi. Paylaşım ayarlarını kontrol edin.'
    }
    if (err.status === 400) {
      if (snippet.includes('invalid field') || snippet.includes('parameter')) {
        return 'Google Drive parametre hatası. Lütfen tekrar deneyin.'
      }
      return 'Geçersiz indirme isteği (HTTP 400).'
    }
    if (err.status === 404) return 'Dosya bulunamadı. Silinmiş olabilir.'
    if (err.status === 401) return 'Oturumunuzun süresi doldu. Çıkış yapıp yeniden bağlanın.'
    if (err.status === 429) return 'Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.'
    return err.message
  }

  /**
   * Yerel dosyayı sistem varsayılan uygulamasıyla açar.
   */
  public openLocalFile(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') return false
    if (fs.existsSync(filePath)) {
      void shell.openPath(filePath)
      return true
    }
    const resolved = this.storageService.isInsideCas(filePath)
    if (resolved && fs.existsSync(resolved)) {
      void shell.openPath(resolved)
      return true
    }
    return false
  }

  /**
   * Dosyayı Windows Gezgini'nde klasör içinde seçili olarak gösterir.
   */
  public showItemInFolder(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') return false
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
      return true
    }
    const resolved = this.storageService.isInsideCas(filePath)
    if (resolved && fs.existsSync(resolved)) {
      shell.showItemInFolder(resolved)
      return true
    }
    return false
  }

  /** Drive'a yuklenecek icerik turleri. Diger turler reddedilir. */
  private static readonly UPLOADABLE: Record<string, string> = {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    text: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    jsx: 'text/javascript',
    ts: 'text/plain',
    tsx: 'text/plain',
    py: 'text/x-python',
    java: 'text/x-java-source',
    c: 'text/x-c',
    cpp: 'text/x-c++src',
    h: 'text/x-c',
    cs: 'text/x-csharp',
    rb: 'text/x-ruby',
    go: 'text/x-go',
    rs: 'text/x-rust',
    php: 'text/x-php',
    sh: 'text/x-sh',
    sql: 'text/x-sql',
    xml: 'application/xml',
    pdf: 'application/pdf',
  }

  /** Ucuz ve tum dosya turlerinde calisan yazma: once olustur, sonra guncelle. */
  public async uploadTextFile(
    fileName: string,
    content: string,
  ): Promise<{ driveFileId: string; title: string; mimeType: string; sizeBytes: number }> {
    const cleanName = fileName.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 180)
    if (!cleanName) throw new Error('Dosya adı boş olamaz.')

    const ext = cleanName.includes('.') ? cleanName.split('.').pop()!.toLowerCase() : ''
    const mimeType = DriveService.UPLOADABLE[ext]
    if (!mimeType) {
      throw new Error(
        `".${ext}" türü Drive'a yüklenemez. Desteklenen türler: ${Object.keys(DriveService.UPLOADABLE).join(', ')}`,
      )
    }

    const body = Buffer.from(content, 'utf8')
    if (body.length > 25 * 1024 * 1024) {
      throw new Error('İçerik 25 MB sınırını aşıyor.')
    }

    // 1) Dosyayı oluştur (multipart upload, uygulamanın kendi "My Drive"ine).
    // Belirteç 1 saatte doldugu icin `withFreshToken` 401 durumunda
    // sessizce yenileyip istegi tekrarlar.
    const createRes = await this.withFreshToken(headers =>
      providerHttp.request<any>(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size',
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'multipart/related; boundary=JMCBOUNDARY' },
          body: Buffer.concat([
            Buffer.from(
              `--JMCBOUNDARY\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
                JSON.stringify({ name: cleanName, mimeType }) +
                `\r\n--JMCBOUNDARY\r\nContent-Type: ${mimeType}\r\n\r\n`,
              'utf8',
            ),
            body,
            Buffer.from('\r\n--JMCBOUNDARY--', 'utf8'),
          ]),
          timeoutMs: 60_000,
          maxRetries: 2,
        },
      ),
    )

    const driveFileId = createRes?.id
    if (typeof driveFileId !== 'string' || !driveFileId) {
      throw new Error('Drive dosya kimliği alınamadı.')
    }

    // 2) Yerel önbelleğe de al; çevrimdışı çalışırken dosya kaybolmasın.
    this.storageService.saveFileToCas(driveFileId, '__uploads__', cleanName, mimeType, body)

    return {
      driveFileId,
      title: String(createRes?.name ?? cleanName),
      mimeType: String(createRes?.mimeType ?? mimeType),
      sizeBytes: body.length,
    }
  }
}