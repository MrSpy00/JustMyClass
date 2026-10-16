import path from 'node:path'
import zlib from 'node:zlib'
import type { Attachment, FilePreviewResult } from '../../types/jmc'
import type { StorageService } from './storageService'
import type { DriveService } from './driveService'
import { extractTextFromPdf, extractTextFromDocx } from './toolDispatcher'

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

/**
 * DOCX icindeki paragraflari ayiklar.
 */
function extractDocxParagraphs(buf: Buffer): string[] {
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
          const xmlBuffer = compressionMethod === 8 ? zlib.inflateRawSync(compData) : compData
          const xml = xmlBuffer.toString('utf8')

          // Paragraf bloklarina gore ayir (<w:p>...</w:p>)
          const pRegex = /<w:p(?: [^>]*)?>([\s\S]*?)<\/w:p>/g
          const paragraphs: string[] = []
          let match: RegExpExecArray | null
          while ((match = pRegex.exec(xml)) !== null) {
            const pXml = match[1]
            const textMatches = pXml.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) || []
            const pText = textMatches
              .map(t => t.replace(/<[^>]+>/g, ''))
              .join('')
              .trim()
            if (pText.length > 0) {
              paragraphs.push(pText)
            }
          }
          return paragraphs
        }
        offset = dataOffset + compressedSize
      } else {
        offset++
      }
    }
  } catch {
    /* fallback */
  }
  return []
}

/**
 * PPTX slaytlarini ayiklar.
 */
function extractPptxSlides(buf: Buffer): Array<{ slideNumber: number; title?: string; bullets: string[] }> {
  const slides: Array<{ slideNumber: number; title?: string; bullets: string[] }> = []
  try {
    const slideBuffers: Map<number, Buffer> = new Map()
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

        const slideMatch = fileName.match(/ppt\/slides\/slide(\d+)\.xml/)
        if (slideMatch && dataOffset + compressedSize <= buf.length) {
          const slideNum = parseInt(slideMatch[1], 10)
          const compData = buf.subarray(dataOffset, dataOffset + compressedSize)
          const xmlBuffer = compressionMethod === 8 ? zlib.inflateRawSync(compData) : compData
          slideBuffers.set(slideNum, xmlBuffer)
        }
        offset = dataOffset + compressedSize
      } else {
        offset++
      }
    }

    const sortedNums = Array.from(slideBuffers.keys()).sort((a, b) => a - b)
    for (const num of sortedNums) {
      const xml = slideBuffers.get(num)!.toString('utf8')
      const textMatches = xml.match(/<a:t(?: [^>]*)?>([^<]*)<\/a:t>/g) || []
      const texts = textMatches.map(t => t.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
      if (texts.length > 0) {
        const title = texts[0]
        const bullets = texts.slice(1)
        slides.push({ slideNumber: num, title, bullets })
      }
    }
  } catch {
    /* fallback */
  }
  return slides
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

    // 1) Eger dosya henuz CAS'ta yoksa veya erisilemiyorsa, otomatik indir
    let cached = fileId ? this.storageService.getCachedFile(fileId) : null
    if (!cached && attachment.title) {
      cached = this.storageService.getCachedFile(attachment.title)
    }

    if (!cached || !cached.absolutePath) {
      // Indirme tetikle
      const downloaded = await this.driveService.downloadAttachment(attachment, courseId)
      if (downloaded.localPath) {
        localPath = downloaded.localPath
        cached = this.storageService.getCachedFile(downloaded.driveFileId || fileId)
      }
    }

    if (!cached || !cached.absolutePath) {
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
    if (ext === '.pptx' || mime.includes('presentationml')) {
      const slides = extractPptxSlides(buf)
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
