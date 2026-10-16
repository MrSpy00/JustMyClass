import path from 'node:path'
import zlib from 'node:zlib'
import type { Attachment, FilePreviewResult } from '../../types/jmc'
import type { StorageService } from './storageService'
import type { DriveService } from './driveService'
import { extractTextFromPdf, extractTextFromDocx, extractTextFromPptx, extractZipEntries } from './toolDispatcher'

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10))
      } catch {
        return ''
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16))
      } catch {
        return ''
      }
    })
}

/**
 * DOCX icindeki paragraflari ve tablolari ayiklar.
 */
function extractDocxParagraphs(buf: Buffer): string[] {
  try {
    const entries = extractZipEntries(buf)
    const docXml = entries.get('word/document.xml')
    if (!docXml) return []
    const xml = docXml.toString('utf8')

    const paragraphs: string[] = []
    const elementRegex = /<(w:p|w:tbl)(?: [^>]*)?>([\s\S]*?)<\/\1>/g
    let elMatch: RegExpExecArray | null

    while ((elMatch = elementRegex.exec(xml)) !== null) {
      const tag = elMatch[1]
      const inner = elMatch[2]

      if (tag === 'w:tbl') {
        const rows: string[][] = []
        const rowRegex = /<w:tr(?: [^>]*)?>([\s\S]*?)<\/w:tr>/g
        let trMatch: RegExpExecArray | null
        while ((trMatch = rowRegex.exec(inner)) !== null) {
          const cells: string[] = []
          const cellRegex = /<w:tc(?: [^>]*)?>([\s\S]*?)<\/w:tc>/g
          let tcMatch: RegExpExecArray | null
          while ((tcMatch = cellRegex.exec(trMatch[1])) !== null) {
            const cellTextMatches = tcMatch[1].match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) || []
            const cellText = cellTextMatches.map(m => m.replace(/<[^>]+>/g, '')).join('').trim()
            cells.push(decodeXmlEntities(cellText))
          }
          if (cells.some(c => c.length > 0)) {
            rows.push(cells)
          }
        }
        if (rows.length > 0) {
          paragraphs.push(rows.map(r => `| ${r.join(' | ')} |`).join('\n'))
        }
      } else if (tag === 'w:p') {
        const isBullet = inner.includes('<w:numPr>')
        const textRuns: string[] = []
        const runRegex = /<w:r(?: [^>]*)?>([\s\S]*?)<\/w:r>/g
        let rMatch: RegExpExecArray | null
        while ((rMatch = runRegex.exec(inner)) !== null) {
          const rXml = rMatch[1]
          const subMatches = rXml.match(/<w:(t|tab|br)(?: [^>]*)?>([^<]*)<\/?w:\1>/g) || []
          for (const sm of subMatches) {
            if (sm.startsWith('<w:tab')) {
              textRuns.push('    ')
            } else if (sm.startsWith('<w:br')) {
              textRuns.push('\n')
            } else {
              textRuns.push(sm.replace(/<[^>]+>/g, ''))
            }
          }
        }
        let pText = decodeXmlEntities(textRuns.join('')).trim()
        if (pText.length > 0) {
          if (isBullet) {
            pText = `• ${pText}`
          }
          paragraphs.push(pText)
        }
      }
    }

    return paragraphs
  } catch {
    return []
  }
}

/**
 * PPTX slaytlarini ayiklar.
 */
function extractPptxSlides(buf: Buffer): Array<{ slideNumber: number; title?: string; bullets: string[] }> {
  const slides: Array<{ slideNumber: number; title?: string; bullets: string[] }> = []
  try {
    const entries = extractZipEntries(buf)
    const slideEntries: Array<{ num: number; xml: string }> = []
    for (const [name, data] of entries.entries()) {
      const match = name.match(/ppt\/slides\/slide(\d+)\.xml/i)
      if (match) {
        slideEntries.push({ num: parseInt(match[1], 10), xml: data.toString('utf8') })
      } else if (/ppt\/slides\/.*\.xml/i.test(name)) {
        slideEntries.push({ num: 9999, xml: data.toString('utf8') })
      }
    }

    // ODP (OpenDocument Presentation) desteği
    if (slideEntries.length === 0 && entries.has('content.xml')) {
      const contentXml = entries.get('content.xml')!.toString('utf8')
      const pageRegex = /<draw:page(?: [^>]*)?>([\s\S]*?)<\/draw:page>/g
      let pageMatch: RegExpExecArray | null
      let pageIdx = 1
      while ((pageMatch = pageRegex.exec(contentXml)) !== null) {
        const pageContent = pageMatch[1]
        const pMatches = pageContent.match(/<text:p(?: [^>]*)?>([^<]*)<\/text:p>/g) || []
        const lines = pMatches.map(m => decodeXmlEntities(m.replace(/<[^>]+>/g, '')).trim()).filter(Boolean)
        const title = lines[0] || `Slayt ${pageIdx}`
        const bullets = lines.length > 1 ? lines.slice(1) : []
        slides.push({ slideNumber: pageIdx++, title, bullets })
      }
      if (slides.length > 0) return slides
    }

    slideEntries.sort((a, b) => a.num - b.num)

    for (let i = 0; i < slideEntries.length; i++) {
      const slide = slideEntries[i]
      const slideIndexNum = i + 1
      const paragraphs: string[] = []
      const pRegex = /<a:p(?: [^>]*)?>([\s\S]*?)<\/a:p>/g
      let pMatch: RegExpExecArray | null
      while ((pMatch = pRegex.exec(slide.xml)) !== null) {
        const pXml = pMatch[1]
        const tMatches = pXml.match(/<a:t(?: [^>]*)?>([^<]*)<\/a:t>/g) || []
        const lineText = decodeXmlEntities(tMatches.map(m => m.replace(/<[^>]+>/g, '')).join('')).trim()
        if (lineText.length > 0) {
          paragraphs.push(lineText)
        }
      }

      // Tablo hücreleri ve ek metinler
      const tcRegex = /<a:tc(?: [^>]*)?>([\s\S]*?)<\/a:tc>/g
      let tcMatch: RegExpExecArray | null
      while ((tcMatch = tcRegex.exec(slide.xml)) !== null) {
        const tcXml = tcMatch[1]
        const tMatches = tcXml.match(/<a:t(?: [^>]*)?>([^<]*)<\/a:t>/g) || []
        const cellText = decodeXmlEntities(tMatches.map(m => m.replace(/<[^>]+>/g, '')).join('')).trim()
        if (cellText.length > 0 && !paragraphs.includes(cellText)) {
          paragraphs.push(cellText)
        }
      }

      const title = paragraphs.length > 0 ? paragraphs[0] : `Slayt ${slideIndexNum}`
      const bullets =
        paragraphs.length > 1
          ? paragraphs.slice(1)
          : paragraphs.length === 1
            ? []
            : ['(Bu slayt grafik, şema veya görsel ağırlıklı içerik barındırmaktadır.)']

      slides.push({ slideNumber: slideIndexNum, title, bullets })
    }
  } catch {
    /* fallback */
  }
  return slides
}

const CODE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyw': 'python',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.rs': 'rust',
  '.go': 'go',
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.dart': 'dart',
  '.sh': 'bash',
  '.bash': 'bash',
  '.ps1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',
  '.lua': 'lua',
  '.r': 'r',
  '.scala': 'scala',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.env': 'ini',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.asm': 'assembly',
  '.gradle': 'groovy',
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

const MEDIA_EXTENSIONS: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

function parseCsvToRows(text: string, maxRows = 500): string[][] {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (lines.length === 0) return []

  // Delimiter tespiti: ilk 5 satira gore virgül, noktali virgul veya tab
  const sample = lines.slice(0, 5).join('\n')
  const countComma = (sample.match(/,/g) || []).length
  const countSemicolon = (sample.match(/;/g) || []).length
  const countTab = (sample.match(/\t/g) || []).length
  let delimiter = ','
  if (countTab > countComma && countTab > countSemicolon) delimiter = '\t'
  else if (countSemicolon > countComma) delimiter = ';'

  const rows: string[][] = []
  for (let i = 0; i < Math.min(lines.length, maxRows); i++) {
    const line = lines[i]
    // Basit ve guvenli CSV parser (tirnak icini korur)
    const row: string[] = []
    let inQuote = false
    let cur = ''
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]
      if (ch === '"') {
        inQuote = !inQuote
      } else if (ch === delimiter && !inQuote) {
        row.push(cur.trim())
        cur = ''
      } else {
        cur += ch
      }
    }
    row.push(cur.trim())
    rows.push(row)
  }
  return rows
}


export class FilePreviewService {
  constructor(
    private readonly storageService: StorageService,
    private readonly driveService: DriveService,
  ) {}

  public async getFilePreview(
    attachment: Attachment,
    courseId = '',
  ): Promise<FilePreviewResult> {
    const fileId = attachment.driveFileId || attachment.id
    let localPath = attachment.localPath

    // 0) YouTube Videosu veya Canlı Web Bağlantısı (Drive CAS indirmesi gerektirmez)
    const isYouTube =
      Boolean(attachment.youTubeVideoId) ||
      (attachment.alternateLink && /(?:youtube\.com|youtu\.be)/i.test(attachment.alternateLink))

    if (isYouTube) {
      const ytId =
        attachment.youTubeVideoId ||
        attachment.alternateLink?.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([a-zA-Z0-9_-]{11})/i)?.[1] ||
        ''
      return {
        fileId: attachment.id,
        title: attachment.title || 'YouTube Videosu',
        mimeType: 'video/youtube',
        sizeBytes: 0,
        kind: 'media',
        dataUrl: ytId ? `https://www.youtube-nocookie.com/embed/${ytId}` : attachment.alternateLink,
        text: `YouTube Videosu: ${attachment.title || ''}\nURL: ${attachment.alternateLink || ''}`,
      }
    }

    if (!attachment.driveFileId && attachment.alternateLink) {
      return {
        fileId: attachment.id,
        title: attachment.title || 'Web Bağlantısı',
        mimeType: 'text/html',
        sizeBytes: 0,
        kind: 'link',
        dataUrl: attachment.alternateLink,
        text: `Web Bağlantısı: ${attachment.title || ''}\nURL: ${attachment.alternateLink}`,
      }
    }

    // 1) Eger dosya henuz CAS'ta yoksa veya erisilemiyorsa, otomatik indir
    let cached = fileId ? this.storageService.getCachedFile(fileId) : null
    if (!cached && attachment.title) {
      cached = this.storageService.getCachedFile(attachment.title)
    }

    if (!cached || !cached.absolutePath) {
      // Indirme tetikle
      try {
        const downloaded = await this.driveService.downloadAttachment(attachment, courseId)
        if (downloaded.localPath) {
          localPath = downloaded.localPath
          cached = this.storageService.getCachedFile(downloaded.driveFileId || fileId)
        }
      } catch (err) {
        if (attachment.alternateLink) {
          return {
            fileId: attachment.id,
            title: attachment.title || 'Bağlantı',
            mimeType: 'text/html',
            sizeBytes: 0,
            kind: 'link',
            dataUrl: attachment.alternateLink,
            text: `Bağlantı: ${attachment.title || ''}\nURL: ${attachment.alternateLink}`,
          }
        }
        throw err
      }
    }

    if (!cached || !cached.absolutePath) {
      if (attachment.alternateLink) {
        return {
          fileId: attachment.id,
          title: attachment.title || 'Bağlantı',
          mimeType: 'text/html',
          sizeBytes: 0,
          kind: 'link',
          dataUrl: attachment.alternateLink,
          text: `Bağlantı: ${attachment.title || ''}\nURL: ${attachment.alternateLink}`,
        }
      }
      throw new Error(`"${attachment.title}" dosyası önbelleğe alınamadı.`)
    }

    const buf = this.storageService.readCasFile(cached.absolutePath)
    const title = cached.entry.title || attachment.title
    const ext = path.extname(title).toLowerCase()
    const mime = cached.entry.mimeType || attachment.mimeType || 'application/octet-stream'
    const sizeBytes = buf.length

    // 2) Kategoriye gore zengin icerik olustur

    // Gorsel
    if (IMAGE_EXTENSIONS[ext] || mime.startsWith('image/')) {
      const imageMime = IMAGE_EXTENSIONS[ext] || mime
      const dataUrl = `data:${imageMime};base64,${buf.toString('base64')}`
      return {
        fileId,
        title,
        mimeType: imageMime,
        sizeBytes,
        kind: 'image',
        dataUrl,
        localPath: cached.absolutePath,
      }
    }

    // Ses / Video
    if (MEDIA_EXTENSIONS[ext] || mime.startsWith('audio/') || mime.startsWith('video/')) {
      const mediaMime = MEDIA_EXTENSIONS[ext] || mime
      const dataUrl = `data:${mediaMime};base64,${buf.toString('base64')}`
      return {
        fileId,
        title,
        mimeType: mediaMime,
        sizeBytes,
        kind: 'media',
        dataUrl,
        localPath: cached.absolutePath,
      }
    }

    // PDF
    if (ext === '.pdf' || mime === 'application/pdf') {
      const text = extractTextFromPdf(buf)
      const dataUrl = `data:application/pdf;base64,${buf.toString('base64')}`
      return {
        fileId,
        title,
        mimeType: 'application/pdf',
        sizeBytes,
        kind: 'pdf',
        text,
        dataUrl,
        localPath: cached.absolutePath,
      }
    }

    // Word / DOCX
    if (ext === '.docx' || mime.includes('wordprocessingml') || ext === '.odt') {
      const paragraphs = extractDocxParagraphs(buf)
      const text = paragraphs.length > 0 ? paragraphs.join('\n\n') : extractTextFromDocx(buf)
      return {
        fileId,
        title,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes,
        kind: 'docx',
        text,
        paragraphs: paragraphs.length > 0 ? paragraphs : text.split('\n\n'),
        localPath: cached.absolutePath,
      }
    }

    // PowerPoint / PPTX
    if (ext === '.pptx' || mime.includes('presentationml') || ext === '.ppsx' || ext === '.potx' || ext === '.odp') {
      let slides = extractPptxSlides(buf)
      if (slides.length === 0) {
        const fallbackText = extractTextFromPptx(buf)
        if (fallbackText.trim().length > 0) {
          const sections = fallbackText.split(/\n{2,}/)
          slides = sections.map((sec, idx) => {
            const lines = sec.split('\n').map(l => l.trim()).filter(Boolean)
            return {
              slideNumber: idx + 1,
              title: lines[0] || `Slayt ${idx + 1}`,
              bullets: lines.length > 1 ? lines.slice(1) : [],
            }
          })
        }
      }
      if (slides.length === 0) {
        slides = [{
          slideNumber: 1,
          title: title || 'Sunum Dosyası',
          bullets: [
            'Bu sunum dosyasında ayrıştırılabilir metin bulunamadı veya slaytlar görsel ağırlıklı olabilir.',
            'Sunumun orijinal biçimini görüntülemek için "Sunum Programında Aç" veya "İndir" butonunu kullanabilirsiniz.',
          ],
        }]
      }
      const text = slides
        .map(s => `[Slayt ${s.slideNumber}: ${s.title || 'Başlıksız'}]\n${s.bullets.map(b => `• ${b}`).join('\n')}`)
        .join('\n\n')
      return {
        fileId,
        title,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sizeBytes,
        kind: 'pptx',
        text,
        slides,
        localPath: cached.absolutePath,
      }
    }

    // CSV / TSV
    if (ext === '.csv' || ext === '.tsv' || mime === 'text/csv') {
      const text = buf.toString('utf8')
      const tableData = parseCsvToRows(text, 600)
      return {
        fileId,
        title,
        mimeType: 'text/csv',
        sizeBytes,
        kind: 'csv',
        text,
        tableData,
        lineCount: text.split('\n').length,
        localPath: cached.absolutePath,
      }
    }

    // Kod Dosyasi
    if (CODE_EXTENSIONS[ext]) {
      const text = buf.toString('utf8')
      const lines = text.split('\n')
      return {
        fileId,
        title,
        mimeType: mime || 'text/plain',
        sizeBytes,
        kind: 'code',
        language: CODE_EXTENSIONS[ext],
        text,
        lineCount: lines.length,
        localPath: cached.absolutePath,
      }
    }

    // Markdown
    if (ext === '.md' || ext === '.markdown') {
      const text = buf.toString('utf8')
      const lines = text.split('\n')
      return {
        fileId,
        title,
        mimeType: 'text/markdown',
        sizeBytes,
        kind: 'markdown',
        text,
        lineCount: lines.length,
        localPath: cached.absolutePath,
      }
    }

    // Genel Metin / Kod Olmayan Metin
    // Null byte kontrolu ile ikili (binary) olup olmadigini anla
    const sampleSize = Math.min(buf.length, 1024)
    let isBinary = false
    for (let i = 0; i < sampleSize; i++) {
      if (buf[i] === 0) {
        isBinary = true
        break
      }
    }

    if (isBinary) {
      return {
        fileId,
        title,
        mimeType: mime,
        sizeBytes,
        kind: 'binary',
        text: 'Bu ikili (binary) bir dosyadır. İndirerek harici bir uygulama ile açabilirsiniz.',
        localPath: cached.absolutePath,
      }
    }

    const text = buf.toString('utf8')
    const lines = text.split('\n')
    return {
      fileId,
      title,
      mimeType: mime || 'text/plain',
      sizeBytes,
      kind: 'text',
      text,
      lineCount: lines.length,
      localPath: cached.absolutePath,
    }
  }
}
