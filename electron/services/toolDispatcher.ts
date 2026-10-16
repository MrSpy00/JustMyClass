import zlib from 'node:zlib'
import { StorageService } from './storageService'
import { VaultService } from './vaultService'
import { providerHttp } from './httpClient'
import type { DriveService } from './driveService'
import type { ActiveContext } from '../../types/jmc'

export interface PendingToolCall {
  id: string
  name: string
  tier: 1 | 2 | 3
  args: Record<string, any>
  createdAt: string
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'error'
  result?: string
}

/** Mimari düzeyde var olmayan araçlar: model metinsel olarak istese bile çalıştırılamaz. */
const FORBIDDEN_TOOLS = new Set([
  'shell_exec',
  'terminal_run',
  'disk_scan_root',
  'read_browser_cookies',
  'auto_submit_grade',
  'auto_turn_in',
  'screenshot_desktop',
  'keylogger',
])

export interface WebSearchHit {
  title: string
  snippet: string
  url: string
}

/**
 * Saf Node.js (harici bağımlılıksız) PDF metin çıkarıcısı.
 * FlateDecode akışlarını decompress eder, metin bloklarını (Tj, TJ) ayıklar.
 */
export function extractTextFromPdf(buf: Buffer): string {
  const textChunks: string[] = []
  const str = buf.toString('latin1')

  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g
  let match: RegExpExecArray | null

  while ((match = streamRegex.exec(str)) !== null) {
    const rawData = match[1]
    let decompressed: Buffer | null = null

    const dictStart = Math.max(0, match.index - 300)
    const dictSlice = str.slice(dictStart, match.index)

    if (dictSlice.includes('/FlateDecode')) {
      try {
        const streamBuffer = buf.subarray(
          match.index + match[0].indexOf(rawData),
          match.index + match[0].indexOf(rawData) + rawData.length,
        )
        decompressed = zlib.inflateSync(streamBuffer)
      } catch {
        try {
          const streamBuffer = buf.subarray(
            match.index + match[0].indexOf(rawData),
            match.index + match[0].indexOf(rawData) + rawData.length,
          )
          decompressed = zlib.unzipSync(streamBuffer)
        } catch {
          decompressed = null
        }
      }
    } else {
      decompressed = Buffer.from(rawData, 'latin1')
    }

    if (decompressed) {
      const streamContent = decompressed.toString('latin1')
      const tjRegex = /\(([^)]*)\)\s*Tj/g
      let tjMatch: RegExpExecArray | null
      while ((tjMatch = tjRegex.exec(streamContent)) !== null) {
        if (tjMatch[1]) textChunks.push(tjMatch[1])
      }

      const bigTjRegex = /\[([^\]]*)\]\s*TJ/g
      let bigTjMatch: RegExpExecArray | null
      while ((bigTjMatch = bigTjRegex.exec(streamContent)) !== null) {
        const inner = bigTjMatch[1]
        const innerStrings = inner.match(/\(([^)]*)\)/g)
        if (innerStrings) {
          for (const s of innerStrings) {
            textChunks.push(s.slice(1, -1))
          }
        }
      }
    }
  }

  if (textChunks.length === 0) {
    const fallbackRegex = /\(([^)]{3,})\)/g
    let fbMatch: RegExpExecArray | null
    while ((fbMatch = fallbackRegex.exec(str)) !== null) {
      const val = fbMatch[1].trim()
      if (val.length > 3 && !val.includes('/') && !val.includes('\\')) {
        textChunks.push(val)
      }
    }
  }

  return textChunks
    .map(c =>
      c
        .replace(/\\([0-7]{3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\[nrtbf]/g, ' ')
        .replace(/\\(.)/g, '$1'),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80_000)
}

/**
 * Saf Node.js DOCX metin çıkarıcısı.
 * DOCX bir zip arşividir; word/document.xml içindeki metin etiketlerini ayıklar.
 */
export function extractTextFromDocx(buf: Buffer): string {
  try {
    let offset = 0
    while (offset < buf.length - 30) {
      if (
        buf[offset] === 0x50 &&
        buf[offset + 1] === 0x4b &&
        buf[offset + 2] === 0x03 &&
        buf[offset + 3] === 0x04
      ) {
        const compressionMethod = buf.readUInt16LE(offset + 8)
        const compressedSize = buf.readUInt32LE(offset + 18)
        const fileNameLength = buf.readUInt16LE(offset + 26)
        const extraFieldLength = buf.readUInt16LE(offset + 28)
        const fileName = buf.toString('utf8', offset + 30, offset + 30 + fileNameLength)
        const dataOffset = offset + 30 + fileNameLength + extraFieldLength

        if (fileName === 'word/document.xml' && dataOffset + compressedSize <= buf.length) {
          const compData = buf.subarray(dataOffset, dataOffset + compressedSize)
          let xmlBuffer: Buffer
          if (compressionMethod === 8) {
            xmlBuffer = zlib.inflateRawSync(compData)
          } else {
            xmlBuffer = compData
          }
          const xml = xmlBuffer.toString('utf8')
          const matches = xml.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || []
          return matches
            .map(m => m.replace(/<[^>]+>/g, ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80_000)
        }
        offset = dataOffset + compressedSize
      } else {
        offset++
      }
    }
  } catch {
    /* yut */
  }
  return ''
}

/**
 * Kullanici tarafindan kapatilabilen araclar. Kapali bir arac
 * hicbir kosulda calistirilmaz; model istese de "kapali" hatasi doner.
 */
export const DISABLABLE_TOOLS = [
  'web_search',
  'workspace_read_open_file',
  'workspace_list_open_files',
  'fs_create_or_update_file',
  'classroom_stage_draft',
] as const

export type DisableableTool = (typeof DISABLABLE_TOOLS)[number]

export interface ToolPermissions {
  webSearch: boolean
  workspaceRead: boolean
  fileWrite: boolean
  classroomDraft: boolean
  tavilyKeySet?: boolean
  tavilyKeyMasked?: string
  braveKeySet?: boolean
  braveKeyMasked?: string
}

export const DEFAULT_TOOL_PERMISSIONS: ToolPermissions = {
  webSearch: true,
  workspaceRead: true,
  fileWrite: true,
  classroomDraft: true,
}

const TOOL_TO_PERMISSION: Record<DisableableTool, keyof ToolPermissions> = {
  web_search: 'webSearch',
  workspace_read_open_file: 'workspaceRead',
  workspace_list_open_files: 'workspaceRead',
  fs_create_or_update_file: 'fileWrite',
  classroom_stage_draft: 'classroomDraft',
}

export class ToolDispatcher {
  private pendingCalls = new Map<string, PendingToolCall>()

  constructor(
    private storageService: StorageService,
    private vaultService: VaultService,
    private driveService?: DriveService,
  ) {}

  /**
   * Kullanıcının o an açtığı ödevi/aracı erişim sağlar.
   *
   * Araçlar "hangi dosya?" diye soramaz; bu yüzden `workspace_list_open_files`
   * hangi dosyaların okunabileceğini bilmek zorundadır. Servis kurulum
   * sırasında henüz var olmayabileceği için kurucudan değil, sonradan
   * bağlanan bir geri çağırma ile bağlanır.
   */
  private activeContextProvider: (() => ActiveContext) | null = null

  public setActiveContextProvider(provider: () => ActiveContext): void {
    this.activeContextProvider = provider
  }

  /**
   * Kullanıcının şu anda açtığı ödevin indirilmiş ve indirilebilir
   * dosyalarını listeler.
   *
   * BU ARAÇ OLMAZSA model dosya kimliklerini tahmin etmek zorunda kalır.
   * Tahmin edilen kimlik tanınmadığı için okuma aracı hata döner ve
   * model, okuyamadığı dosyanın içeriğini UYDURUR. Bu, kullanıcının
   * "asistan sadece dosya adını okuyor" izlenimini açıklayan kök nedendir.
   */
  private listOpenFiles(): string {
    const context = this.activeContextProvider?.() ?? {}
    const courseId = context.activeCourseId
    const workId = context.activeCourseWorkId

    const lines: string[] = []
    const seen = new Set<string>()

    const describe = (att: any, kind: 'odev' | 'materyal' | 'teslim', courseName?: string) => {
      const id = att?.driveFileId || att?.id
      if (!id || seen.has(id)) return
      seen.add(id)
      const cached = this.storageService.getCachedFile(id) || this.storageService.getCachedFile(att.title)
      lines.push(
        JSON.stringify({
          fileId: String(id),
          title: String(att.title ?? '(başlıksız)'),
          kind,
          course: courseName || context.activeCourseName || undefined,
          downloaded: !!cached,
          mimeType: att.mimeType || cached?.entry?.mimeType || '',
        }),
      )
    }

    if (!courseId) {
      const courses = this.storageService.getCourses()
      if (!courses.length) {
        return JSON.stringify({
          ok: false,
          error:
            'Şu anda kayıtlı bir ders bulunamadı. Lütfen önce Classroom ile senkronizasyon yapın veya bir ders seçin.',
        })
      }

      for (const course of courses) {
        for (const material of this.storageService.getMaterials(course.id)) {
          for (const att of material.materials || []) describe(att, 'materyal', course.name)
        }
        for (const work of this.storageService.getCourseWork(course.id)) {
          for (const att of work.materials || []) describe(att, 'odev', course.name)
          for (const sub of [work.submission].filter(Boolean) as any[]) {
            for (const att of sub.attachments || []) describe(att, 'teslim', course.name)
          }
        }
      }

      if (!lines.length) {
        return JSON.stringify({
          ok: false,
          error: 'Kayıtlı derslerde okunabilir dosya veya ek bulunamadı.',
        })
      }

      return JSON.stringify({
        ok: true,
        instruction:
          'Aşağıdaki listeden bir fileId veya dosya adı seçip workspace_read_open_file aracıyla oku. ' +
          'Dosya henüz indirilmemiş olsa dahi otomatik olarak indirilip okunacaktır.',
        files: JSON.parse(`[${lines.join(',')}]`),
      })
    }

    if (workId) {
      const work = this.storageService.getCourseWorkItem(courseId, workId)
      if (work) {
        for (const att of work.materials || []) describe(att, 'odev')
        for (const sub of [work.submission].filter(Boolean) as any[]) {
          for (const att of sub.attachments || []) describe(att, 'teslim')
        }
      }
    }

    for (const material of this.storageService.getMaterials(courseId)) {
      for (const att of material.materials || []) describe(att, 'materyal')
    }

    if (!lines.length) {
      return JSON.stringify({
        ok: false,
        error:
          'Bu derste veya ödevde okunabilir dosya bulunamadı. ' +
          'Tüm derslerdeki dosyaları görmek için classroom_search aracını kullanabilirsin.',
        courseId,
        courseWorkId: workId ?? null,
      })
    }

    return JSON.stringify({
      ok: true,
      courseId,
      courseWorkId: workId ?? null,
      courseName: context.activeCourseName ?? '',
      instruction:
        'Yukarıdaki listeden bir fileId seç ve workspace_read_open_file aracıyla içeriğini oku. ' +
        'Dosya henüz indirilmemiş olsa dahi otomatik olarak indirilip okunacaktır.',
      files: JSON.parse(`[${lines.join(',')}]`),
    })
  }

  /** Ayarlardan okunan, gercekten uygulanan izin anlik goruntusu ve kasa durumu. */
  public getPermissions(): ToolPermissions {
    const stored = this.storageService.getSetting<Partial<ToolPermissions>>('toolPermissions', {})
    const hasTavily = this.vaultService.hasKey('tavily')
    const hasBrave = this.vaultService.hasKey('brave')
    return {
      ...DEFAULT_TOOL_PERMISSIONS,
      ...stored,
      tavilyKeySet: hasTavily,
      tavilyKeyMasked: hasTavily ? `•••••••${this.vaultService.getKeyFingerprint('tavily')}` : undefined,
      braveKeySet: hasBrave,
      braveKeyMasked: hasBrave ? `•••••••${this.vaultService.getKeyFingerprint('brave')}` : undefined,
    }
  }

  /** Izin degisikligini sifreli depoya yazar ve aninda gecerli kilar. */
  public setPermissions(patch: Partial<ToolPermissions>): ToolPermissions {
    const current = this.getPermissions()
    const toStore = {
      webSearch: patch.webSearch !== undefined ? Boolean(patch.webSearch) : current.webSearch,
      workspaceRead: patch.workspaceRead !== undefined ? Boolean(patch.workspaceRead) : current.workspaceRead,
      fileWrite: patch.fileWrite !== undefined ? Boolean(patch.fileWrite) : current.fileWrite,
      classroomDraft: patch.classroomDraft !== undefined ? Boolean(patch.classroomDraft) : current.classroomDraft,
    }
    this.storageService.setSetting('toolPermissions', toStore)
    return this.getPermissions()
  }

  public getPendingCall(callId: string): PendingToolCall | undefined {
    return this.pendingCalls.get(callId)
  }

  public getPendingCalls(): PendingToolCall[] {
    return [...this.pendingCalls.values()].filter(c => c.status === 'pending')
  }

  /**
   * Bekleyen tum arac onaylarini temizler.
   *
   * Oturum kapandiginda veya hesap degistiginde cagrilir. Aksi halde
   * onceki hesabin yazma onay kartlari ekranda kalir ve bir sonraki
   * kullanici onlari onaylayip o hesabin dosyalarina yazabilir.
   */
  public clearPendingCalls(): void {
    this.pendingCalls.clear()
  }

  public async executeTool(
    name: string,
    args: Record<string, any>,
  ): Promise<{ requiresApproval: boolean; callId?: string; result?: string; error?: string }> {
    if (FORBIDDEN_TOOLS.has(name)) {
      return {
        requiresApproval: false,
        error: `"${name}" aracı güvenlik politikası gereği tamamen engellenmiştir.`,
      }
    }

    const permissionKey = TOOL_TO_PERMISSION[name as DisableableTool]
    if (permissionKey && !this.getPermissions()[permissionKey]) {
      return {
        requiresApproval: false,
        error: `"${name}" aracı Ayarlar > Araçlar bölümünde kapatıldığı için çalıştırılmadı.`,
      }
    }

    // --- Katman 1: Salt okunur, otomatik izinli -------------------------
    if (name === 'classroom_search') {
      return { requiresApproval: false, result: JSON.stringify(this.storageService.search(String(args.query ?? ''))) }
    }

    if (name === 'workspace_list_open_files') {
      return { requiresApproval: false, result: this.listOpenFiles() }
    }

    if (name === 'classroom_get_assignment_details') {
      const item = this.storageService.getCourseWorkItem(args.courseId, args.workId)
      if (!item) return { requiresApproval: false, error: 'Ödev bulunamadı.' }
      return {
        requiresApproval: false,
        result: JSON.stringify({ item, rubric: this.storageService.getRubric(args.workId) }),
      }
    }

    if (name === 'workspace_read_open_file') {
      const targetIdOrName = String(args.fileId || args.fileName || args.title || '').trim()
      let cached = this.storageService.getCachedFile(targetIdOrName)

      // Eğer henüz önbellekte yoksa, kayıtlı derslerin materyal veya ödevlerinde arayıp otomatik indir
      if (!cached && this.driveService) {
        const courses = this.storageService.getCourses()
        let foundAttachment: any = null
        let foundCourseId = ''

        for (const course of courses) {
          const materials = this.storageService.getMaterials(course.id)
          for (const m of materials) {
            for (const att of m.materials) {
              if (
                att.id === targetIdOrName ||
                att.driveFileId === targetIdOrName ||
                (targetIdOrName && att.title.toLowerCase().includes(targetIdOrName.toLowerCase()))
              ) {
                foundAttachment = att
                foundCourseId = course.id
                break
              }
            }
            if (foundAttachment) break
          }
          if (foundAttachment) break

          const courseWorks = this.storageService.getCourseWork(course.id)
          for (const w of courseWorks) {
            for (const att of w.materials || []) {
              if (
                att.id === targetIdOrName ||
                att.driveFileId === targetIdOrName ||
                (targetIdOrName && att.title.toLowerCase().includes(targetIdOrName.toLowerCase()))
              ) {
                foundAttachment = att
                foundCourseId = course.id
                break
              }
            }
            if (foundAttachment) break
          }
          if (foundAttachment) break
        }

        if (foundAttachment) {
          try {
            await this.driveService.downloadAttachment(foundAttachment, foundCourseId)
            const resolvedId = foundAttachment.driveFileId || foundAttachment.id
            cached = this.storageService.getCachedFile(resolvedId)
          } catch (dlErr) {
            return {
              requiresApproval: false,
              error: `Dosya otomatik olarak indirilemedi: ${(dlErr as Error).message}`,
            }
          }
        }
      }

      if (!cached) {
        return {
          requiresApproval: false,
          error: `"${targetIdOrName || 'Belirtilen dosya'}" yerel önbellekte bulunamadı ve Classroom kayıtlarıyla eşleşmedi.`,
        }
      }

      try {
        const buf = this.storageService.readCasFile(cached.absolutePath)
        const title = cached.entry.title.toLowerCase()
        const mime = (cached.entry.mimeType || '').toLowerCase()

        if (mime === 'application/pdf' || title.endsWith('.pdf')) {
          const text = extractTextFromPdf(buf)
          if (!text) {
            return {
              requiresApproval: false,
              result: `[${cached.entry.title}] PDF dosyası başarıyla indirildi (${Math.round(buf.length / 1024)} KB), ancak taranmış resim formatında olduğu için metin katmanı içermiyor.`,
            }
          }
          return {
            requiresApproval: false,
            result: `[${cached.entry.title} - Çıkarılan PDF Metni]:\n${text.slice(0, 20_000)}`,
          }
        }

        if (
          mime.includes('wordprocessingml') ||
          title.endsWith('.docx')
        ) {
          const text = extractTextFromDocx(buf)
          return {
            requiresApproval: false,
            result: `[${cached.entry.title} - Çıkarılan Belge Metni]:\n${text.slice(0, 20_000)}`,
          }
        }

        const isText =
          mime.startsWith('text/') ||
          /\.(md|txt|csv|json|ts|tsx|js|jsx|py|html|css|c|cpp|h|java|sql|sh)$/i.test(title)

        if (isText) {
          return {
            requiresApproval: false,
            result: `[${cached.entry.title}]:\n${buf.toString('utf8').slice(0, 20_000)}`,
          }
        }

        return {
          requiresApproval: false,
          result: `[${cached.entry.title}] Dosya (${mime}) yerel kasada başarıyla hazırlandı (${Math.round(buf.length / 1024)} KB).`,
        }
      } catch (err) {
        return { requiresApproval: false, error: `Dosya okunamadı: ${(err as Error).message}` }
      }
    }

    // --- Katman 2: Kullanıcı izni gerektiren ağ araçları -----------------
    if (name === 'web_search') {
      const query = String(args.query ?? '').trim()
      if (!query) return { requiresApproval: false, error: 'Arama sorgusu boş.' }
      const results = await this.performWebSearch(query)
      if (!results.length) {
        return {
          requiresApproval: false,
          error:
            'İnternet araması gerçekleştirilemedi. Lütfen ağ bağlantınızı veya Ayarlar > Araçlar bölümündeki API anahtarlarını kontrol edin.',
        }
      }
      return { requiresApproval: false, result: JSON.stringify(results) }
    }

    // --- Katman 3: Yazma islemleri, onay zorunlu -------------------------
    if (name === 'fs_create_or_update_file' || name === 'classroom_stage_draft') {
      const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      this.pendingCalls.set(callId, {
        id: callId,
        name,
        tier: 3,
        args,
        createdAt: new Date().toISOString(),
        status: 'pending',
      })
      return { requiresApproval: true, callId }
    }

    return { requiresApproval: false, error: `Bilinmeyen araç: ${name}` }
  }

  public approveCall(callId: string): boolean {
    const call = this.pendingCalls.get(callId)
    if (!call || call.status !== 'pending') return false
    call.status = 'approved'

    if (call.name === 'fs_create_or_update_file') {
      try {
        this.storageService.updateLocalFileContent(call.args.fileId, String(call.args.content ?? ''))
        call.status = 'completed'
        call.result = 'Dosya güncellendi.'
      } catch (err) {
        call.status = 'error'
        call.result = (err as Error).message
        return false
      }
      return true
    }

    if (call.name === 'classroom_stage_draft') {
      try {
        const courseId = String(call.args.courseId ?? '')
        const courseWorkId = String(call.args.courseWorkId ?? '')
        const content = String(call.args.content ?? '')
        const fileName = String(call.args.fileName ?? 'odev_taslagi.md')
        if (!courseId || !courseWorkId) {
          throw new Error('courseId ve courseWorkId zorunludur.')
        }
          // Bos icerikli taslak KAYDEDILMEZDI.
          //
          // Onceki surumde `content` dogrulanmiyordu; model bos ya da
          // yalnizca bir isaret gonderirse ogrencinin onune BOS bir
          // taslak cikiyordu ve odevi bu bos dosyayla teslim ediyordu.
          if (content.trim().length === 0) {
            throw new Error('Taslak içeriği boş. Ödev çözümünü önce yaz, sonra kaydet.')
          }
        this.storageService.saveDraft({
          courseId,
          courseWorkId,
          fileName,
          content,
        })
        call.status = 'completed'
        call.result = 'Taslak kaydedildi.'
      } catch (err) {
        call.status = 'error'
        call.result = (err as Error).message
        return false
      }
      return true
    }
    return true
  }

  public rejectCall(callId: string): boolean {
    const call = this.pendingCalls.get(callId)
    if (!call || call.status !== 'pending') return false
    call.status = 'rejected'
    return true
  }

  /**
   * Canlı hibrit web araması.
   * 1. Tavily API anahtarı varsa Tavily ile arar.
   * 2. Brave Search API anahtarı varsa Brave ile arar.
   * 3. Hiçbir anahtar girilmemişse veya API kotaları aşılmışsa API'siz DuckDuckGo motoruna başvurur.
   */
  private async performWebSearch(rawQuery: string): Promise<WebSearchHit[]> {
    // Eski yıllara (2020-2024) takılan sorguları günümüz yılına (2026) normalize et
    const currentYear = new Date().getFullYear() // 2026
    const query = rawQuery.replace(/\b202[0-4]\b/g, String(currentYear)).trim()

    // 1. Tavily Arama API'si
    const tavilyKey = this.vaultService.getKey('tavily')
    if (tavilyKey && tavilyKey.trim().length > 0) {
      try {
        const data = await providerHttp.request<any>('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tavilyKey.trim()}` },
          body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false }),
          timeoutMs: 12_000,
          maxRetries: 1,
        })
        const rows: any[] = Array.isArray(data?.results) ? data.results : []
        if (rows.length > 0) {
          return rows.slice(0, 5).map(r => ({
            title: String(r.title ?? ''),
            snippet: String(r.content ?? ''),
            url: String(r.url ?? ''),
          }))
        }
      } catch {
        /* Brave veya DuckDuckGo'ya geç */
      }
    }

    // 2. Brave Search API'si
    const braveKey = this.vaultService.getKey('brave')
    if (braveKey && braveKey.trim().length > 0) {
      try {
        const data = await providerHttp.request<any>(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'X-Subscription-Token': braveKey.trim(),
            },
            timeoutMs: 12_000,
            maxRetries: 1,
          },
        )
        const rows: any[] = Array.isArray(data?.web?.results) ? data.web.results : []
        if (rows.length > 0) {
          return rows.slice(0, 5).map(r => ({
            title: String(r.title ?? ''),
            snippet: String(r.description ?? ''),
            url: String(r.url ?? ''),
          }))
        }
      } catch {
        /* DuckDuckGo'ya geç */
      }
    }

    // 3. ANAHTAR GEREKTIRMEYEN kaynaklar.
    //
    // Kullanicinin istegi: "Anahtar girmeden de arama calissin."
    //
    // Onceki surumde tek anahtarsiz kaynak vardi: DuckDuckGo'nun HTML
    // ucu. O uc sayfa yapisi degistiginde (veya bot korumasina
    // takildiginda) tek duzenli ifade sessizce bos sonuc donuyordu ve
    // kullanici "arama calismiyor" diye dusunuyordu.
    //
    // Asagida birbirini yedekleyen ust kaynak var; biri calismazsa
    // digerine gecilir. Hepsi basarisiz olursa kullaniciya NEDEN
    // soylenir, bos liste donmez.
    for (const source of KEYLESS_SEARCH_SOURCES) {
      try {
        const hits = await source.search(query)
        if (hits.length > 0) return hits
      } catch {
        /* sonraki kaynaga gec */
      }
    }

    return []
  }
}

/**
 * Anahtar gerektirmeyen arama kaynaklari.
 *
 * Sira onemlidir: guvenilirlik azalan sirada denenir ve ilk sonuc
 * donduren kaynak kullanilir.
 */
const KEYLESS_SEARCH_SOURCES: Array<{
  name: string
  search: (query: string) => Promise<WebSearchHit[]>
}> = [
  {
    // DuckDuckGo'nun kendi JSON ucu; HTML kazima duzenine gore daha
    // kararli ve sayfa yapisi degisiminden daha az etkileniyor.
    name: 'duckduckgo-json',
    search: async query => {
      const res = await providerHttp.request<any>(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { method: 'GET', timeoutMs: 12_000, maxRetries: 1 },
      )
      const hits: WebSearchHit[] = []
      const push = (t: string, u: string, s: string) => {
        if (t && u) hits.push({ title: t, snippet: s, url: u })
      }
      push(String(res?.Heading ?? ''), String(res?.AbstractURL ?? ''), String(res?.AbstractText ?? ''))
      for (const topic of Array.isArray(res?.RelatedTopics) ? res.RelatedTopics : []) {
        if (topic?.FirstURL) push(String(topic.Text ?? ''), String(topic.FirstURL), String(topic.Text ?? ''))
        for (const sub of Array.isArray(topic?.Topics) ? topic.Topics : []) {
          if (sub?.FirstURL) push(String(sub.Text ?? ''), String(sub.FirstURL), String(sub.Text ?? ''))
        }
      }
      return hits.slice(0, 5)
    },
  },
  {
    // Wikipedia arama API'si: anahtar istemez ve akademik konularda
    // guvenilir bir ilk kaynaktir.
    name: 'wikipedia',
    search: async query => {
      const res = await providerHttp.request<any>(
        `https://tr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&utf8=1`,
        { method: 'GET', timeoutMs: 12_000, maxRetries: 1 },
      )
      const rows: any[] = Array.isArray(res?.query?.search) ? res.query.search : []
      return rows.slice(0, 5).map(r => ({
        title: String(r.title ?? ''),
        snippet: String(r.snippet ?? '').replace(/<[^>]+>/g, '').trim(),
        url: `https://tr.wikipedia.org/wiki/${encodeURIComponent(String(r.title ?? '').replace(/ /g, '_'))}`,
      }))
    },
  },
  {
    // HTML kazimasi: en zayif kaynak, yalnizca yukarilari basarisiz
    // oldugunda denenir.
    name: 'duckduckgo-html',
    search: async query => {
      // Bu kaynak da `providerHttp` uzerinden cagrilir; dogrudan global
      // `fetch` KULLANILMAZ.
      //
      // NEDEN
      // ----
      // 1) Tutarlilik: diger iki anahtarsiz kaynak `providerHttp` kullanir.
      //    Bu kaynak global `fetch` kullaniyordu; boylece zaman asimi ve
      //    yeniden deneme davranislari digerlerinden farkliydi ve TEST
      //    EDILEMIYORDU (mock `fetch` kurulamiyor, `requestSpy` bu yolu
      //    hic gormuyordu).
      // 2) Onarilabilirlik: `fetch` hata durumunda sessizce `[]` doner
      //    ve zincirdeki bu son adim "calisti" saniliyordu.
      const res = await providerHttp.request<string>(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeoutMs: 12_000,
          maxRetries: 1,
        },
      )
      const html = typeof res === 'string' ? res : String(res ?? '')
      const results: WebSearchHit[] = []
      // Yalnizca kirsilim degil, sinif adi degisse de eslesen bloklar.
      const regex =
        /<h2 class="[^"]*result__title[^"]*">[\s\S]*?<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
      let m: RegExpExecArray | null
      while ((m = regex.exec(html)) !== null && results.length < 5) {
        const rawUrl = m[1]
        const title = m[2].replace(/<[^>]+>/g, '').trim()
        const snippet = m[3].replace(/<[^>]+>/g, '').trim()
        let finalUrl = rawUrl
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/)
        if (uddgMatch) {
          try {
            finalUrl = decodeURIComponent(uddgMatch[1])
          } catch {
            /* url çözümlenemezse rawUrl kalır */
          }
        }
        if (title && snippet) results.push({ title, snippet, url: finalUrl })
      }
      return results
    },
  },
]