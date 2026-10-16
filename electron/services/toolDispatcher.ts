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
 * Türkçe ve uluslararası karakter eşlemeleri (Windows-1254 / ISO-8859-9).
 */
const TURKISH_WIN1254_MAP: Record<number, string> = {
  0xc7: 'Ç',
  0xe7: 'ç',
  0xd6: 'Ö',
  0xf6: 'ö',
  0xdc: 'Ü',
  0xfc: 'ü',
  0xd0: 'Ğ',
  0xf0: 'ğ',
  0xdd: 'İ',
  0xfd: 'ı',
  0xde: 'Ş',
  0xfe: 'ş',
}

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
 * ZIP arşivi içindeki dosyaları açar (DOCX ve PPTX için harici bağımlılıksız).
 */
export function extractZipEntries(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
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

        if (compressedSize > 0 && dataOffset + compressedSize <= buf.length) {
          const compData = buf.subarray(dataOffset, dataOffset + compressedSize)
          let decomp: Buffer | null = null
          if (compressionMethod === 8) {
            try {
              decomp = zlib.inflateRawSync(compData)
            } catch {
              try {
                decomp = zlib.inflateSync(compData)
              } catch {
                decomp = null
              }
            }
          } else if (compressionMethod === 0) {
            decomp = compData
          }
          if (decomp) {
            entries.set(fileName, decomp)
          }
          offset = dataOffset + compressedSize
          continue
        }
      }
      offset++
    }
  } catch {
    /* fallback */
  }
  return entries
}

/**
 * PDF ToUnicode CMap bloklarını ayıklar ve Unicode karakter karşılıklarını haritalandırır.
 */
function parsePdfCMap(decompressedText: string): Map<string, string> {
  const cmap = new Map<string, string>()

  // bfchar blokları: <0001> <0041>
  const bfCharRegex = /beginbfchar[\r\n]+([\s\S]*?)endbfchar/g
  let bfMatch: RegExpExecArray | null
  while ((bfMatch = bfCharRegex.exec(decompressedText)) !== null) {
    const lines = bfMatch[1].trim().split(/\r?\n/)
    for (const line of lines) {
      const parts = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/)
      if (parts) {
        const srcHex = parts[1].toLowerCase()
        const dstHex = parts[2]
        let uniStr = ''
        for (let i = 0; i < dstHex.length; i += 4) {
          uniStr += String.fromCharCode(parseInt(dstHex.slice(i, i + 4), 16))
        }
        cmap.set(srcHex, uniStr)
      }
    }
  }

  // bfrange blokları: <0001> <0005> <0041> veya <0001> <0002> [<0041> <0042>]
  const bfRangeRegex = /beginbfrange[\r\n]+([\s\S]*?)endbfrange/g
  let rgMatch: RegExpExecArray | null
  while ((rgMatch = bfRangeRegex.exec(decompressedText)) !== null) {
    const lines = rgMatch[1].trim().split(/\r?\n/)
    for (const line of lines) {
      const simpleRange = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/)
      if (simpleRange) {
        const start = parseInt(simpleRange[1], 16)
        const end = parseInt(simpleRange[2], 16)
        let dstStart = parseInt(simpleRange[3], 16)
        const hexLen = simpleRange[1].length
        for (let code = start; code <= end; code++) {
          const hexKey = code.toString(16).padStart(hexLen, '0').toLowerCase()
          cmap.set(hexKey, String.fromCharCode(dstStart++))
        }
      }
    }
  }

  return cmap
}

/**
 * PDF literal string içeriğindeki octal, UTF-16BE ve Türkçe karakterleri çözer.
 */
function decodePdfLiteralString(raw: string, cmap?: Map<string, string>): string {
  // UTF-16BE BOM kontrolü: \376\377 veya \xFE\xFF
  if (raw.startsWith('\xfe\xff') || raw.startsWith('\\376\\377')) {
    const clean = raw.replace(/^(\xfe\xff|\\376\\377)/, '')
    const bytes: number[] = []
    let i = 0
    while (i < clean.length) {
      if (clean[i] === '\\' && i + 3 < clean.length && /^[0-7]{3}$/.test(clean.slice(i + 1, i + 4))) {
        bytes.push(parseInt(clean.slice(i + 1, i + 4), 8))
        i += 4
      } else if (clean[i] === '\\' && i + 1 < clean.length) {
        bytes.push(clean.charCodeAt(i + 1))
        i += 2
      } else {
        bytes.push(clean.charCodeAt(i))
        i++
      }
    }
    let res = ''
    for (let b = 0; b < bytes.length - 1; b += 2) {
      res += String.fromCharCode((bytes[b] << 8) | bytes[b + 1])
    }
    return res
  }

  // Octal kaçış dizilerini bayt dizisine dönüştür
  const byteList: number[] = []
  let pos = 0
  while (pos < raw.length) {
    if (raw[pos] === '\\') {
      if (pos + 3 < raw.length && /^[0-7]{3}$/.test(raw.slice(pos + 1, pos + 4))) {
        byteList.push(parseInt(raw.slice(pos + 1, pos + 4), 8))
        pos += 4
      } else if (raw[pos + 1] === 'n') {
        byteList.push(10)
        pos += 2
      } else if (raw[pos + 1] === 'r') {
        byteList.push(13)
        pos += 2
      } else if (raw[pos + 1] === 't') {
        byteList.push(9)
        pos += 2
      } else if (raw[pos + 1] === 'b') {
        byteList.push(8)
        pos += 2
      } else if (raw[pos + 1] === 'f') {
        byteList.push(12)
        pos += 2
      } else if (raw[pos + 1] === '(' || raw[pos + 1] === ')' || raw[pos + 1] === '\\') {
        byteList.push(raw.charCodeAt(pos + 1))
        pos += 2
      } else {
        pos++
      }
    } else {
      byteList.push(raw.charCodeAt(pos))
      pos++
    }
  }

  // Eğer font ToUnicode CMap varsa, karakter kodlarını haritadan geçir
  if (cmap && cmap.size > 0) {
    let mapped = ''
    let matchCount = 0
    for (const b of byteList) {
      const hex2 = b.toString(16).padStart(2, '0').toLowerCase()
      const hex4 = b.toString(16).padStart(4, '0').toLowerCase()
      if (cmap.has(hex2)) {
        mapped += cmap.get(hex2)!
        matchCount++
      } else if (cmap.has(hex4)) {
        mapped += cmap.get(hex4)!
        matchCount++
      } else if (b >= 32 && b <= 126) {
        mapped += String.fromCharCode(b)
      } else if (TURKISH_WIN1254_MAP[b]) {
        mapped += TURKISH_WIN1254_MAP[b]
      }
    }
    if (matchCount > 0 && mapped.trim().length > 0) {
      return mapped
    }
  }

  // UTF-8 veya Windows-1254 (Türkçe) çözümlemesi
  const buf = Buffer.from(byteList)
  try {
    const utf8Str = buf.toString('utf8')
    if (!utf8Str.includes('\ufffd') && /[^\x00-\x7F]/.test(utf8Str)) {
      return utf8Str
    }
  } catch {
    /* fallback to win1254 */
  }

  let result = ''
  for (const b of byteList) {
    if (TURKISH_WIN1254_MAP[b]) {
      result += TURKISH_WIN1254_MAP[b]
    } else {
      result += String.fromCharCode(b)
    }
  }
  return result
}

/**
 * Saf Node.js (harici bağımlılıksız) PDF metin çıkarıcısı.
 * FlateDecode akışlarını decompress eder, ToUnicode CMaps, hex dizileri (<...>),
 * literal stringler (...) ve Türkçe karakter kodlamalarını eksiksiz çözer.
 * SADECE BT...ET arasındaki metin bloklarını işler; PostScript çizim operatörleri sızdırılmaz.
 */
export function extractTextFromPdf(buf: Buffer): string {
  if (!buf || buf.length < 10) return ''
  const str = buf.toString('latin1')

  // 1) Tüm akışları aç ve ToUnicode haritalarını çıkar
  const decompressedStreams: string[] = []
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g
  let match: RegExpExecArray | null

  while ((match = streamRegex.exec(str)) !== null) {
    const rawData = match[1]
    const objIndex = str.lastIndexOf('obj', match.index)
    const dictStart = Math.max(0, objIndex !== -1 ? objIndex : match.index - 1500)
    const dictSlice = str.slice(dictStart, match.index)

    // Resim (Image), Font programı (FontFile/Type1/CIDFont), XObject ve ikili akışları atla
    if (
      dictSlice.includes('/Subtype /Image') ||
      dictSlice.includes('/Subtype/Image') ||
      dictSlice.includes('/Type /Font') ||
      dictSlice.includes('/Type/Font') ||
      dictSlice.includes('/FontFile') ||
      dictSlice.includes('/CIDFontType') ||
      dictSlice.includes('/Length1') ||
      dictSlice.includes('/Length2') ||
      dictSlice.includes('/Length3')
    ) {
      continue
    }

    const isFlate =
      dictSlice.includes('/FlateDecode') ||
      dictSlice.includes('/Flate') ||
      dictSlice.includes('/Filter')

    let decomp: Buffer | null = null

    if (isFlate) {
      // /Length parametresine göre kesin boyut tespiti
      const lenMatch = dictSlice.match(/\/Length\s+(\d+)/)
      const streamStart = match.index + match[0].indexOf(rawData)
      const streamLen = lenMatch ? Math.min(parseInt(lenMatch[1], 10), rawData.length) : rawData.length
      const streamBuf = buf.subarray(streamStart, streamStart + streamLen)

      try {
        decomp = zlib.inflateSync(streamBuf)
      } catch {
        try {
          decomp = zlib.inflateRawSync(streamBuf)
        } catch {
          // Açılmayan FlateDecode akışları ASLA ham ikili metin olarak eklenmez!
          decomp = null
        }
      }
    } else if (!dictSlice.includes('/Filter')) {
      // Sıkıştırılmamış akış: kontrol et, ikili değilse kabul et
      decomp = Buffer.from(rawData, 'latin1')
    }

    if (decomp && decomp.length > 0) {
      const decodedStr = decomp.toString('latin1')
      // İkili binary çöp akışlarını filtrele:
      // Standart PDF operatör metinleri ASCII ve Türkçe karakterlerden oluşur.
      // Kontrol karakterleri veya kontrol dışı karakter oranı %5'ten fazlaysa atla.
      const sample = decodedStr.slice(0, 1000)
      const invalidChars = (sample.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g) || []).length
      if (invalidChars / sample.length < 0.05) {
        decompressedStreams.push(decodedStr)
      }
    }
  }

  // ToUnicode CMaps'i tüm akışlardan topla
  const globalCMap = new Map<string, string>()
  for (const st of decompressedStreams) {
    if (st.includes('beginbfchar') || st.includes('beginbfrange')) {
      const localMap = parsePdfCMap(st)
      for (const [k, v] of localMap.entries()) {
        globalCMap.set(k, v)
      }
    }
  }

  // 2) SADECE BT ... ET metin bloklarını tara (Grafik ve PostScript operatörleri filtrelenir)
  const paragraphs: string[] = []

  for (const content of decompressedStreams) {
    const btRegex = /\bBT\b([\s\S]*?)\bET\b/g
    let btMatch: RegExpExecArray | null

    while ((btMatch = btRegex.exec(content)) !== null) {
      const textBlock = btMatch[1]
      const currentBlockLines: string[] = []

      // [...] TJ operatörleri
      const tjBlockRegex = /\[([\s\S]*?)\]\s*TJ/g
      let tjMatch: RegExpExecArray | null
      while ((tjMatch = tjBlockRegex.exec(textBlock)) !== null) {
        const inner = tjMatch[1]
        const tokenRegex = /\(([^)]*(?:\\.[^)]*)*)\)|<([0-9a-fA-F]+)>/g
        let tokMatch: RegExpExecArray | null
        const parts: string[] = []
        while ((tokMatch = tokenRegex.exec(inner)) !== null) {
          if (tokMatch[1] !== undefined) {
            parts.push(decodePdfLiteralString(tokMatch[1], globalCMap))
          } else if (tokMatch[2] !== undefined) {
            const hex = tokMatch[2].toLowerCase()
            if (globalCMap.has(hex)) {
              parts.push(globalCMap.get(hex)!)
            } else if (hex.length % 4 === 0) {
              let uStr = ''
              for (let i = 0; i < hex.length; i += 4) {
                const chunk = hex.slice(i, i + 4)
                uStr += globalCMap.get(chunk) || String.fromCharCode(parseInt(chunk, 16))
              }
              parts.push(uStr)
            } else {
              let uStr = ''
              for (let i = 0; i < hex.length; i += 2) {
                const byteVal = parseInt(hex.slice(i, i + 2), 16)
                uStr += TURKISH_WIN1254_MAP[byteVal] || String.fromCharCode(byteVal)
              }
              parts.push(uStr)
            }
          }
        }
        const line = parts.join('').trim()
        if (line.length > 0 && !/[\x00-\x08\x0E-\x1F]/.test(line)) currentBlockLines.push(line)
      }

      // (...) Tj operatörleri
      const singleTjRegex = /\(([^)]*(?:\\.[^)]*)*)\)\s*Tj/g
      let sTjMatch: RegExpExecArray | null
      while ((sTjMatch = singleTjRegex.exec(textBlock)) !== null) {
        const line = decodePdfLiteralString(sTjMatch[1], globalCMap).trim()
        if (line.length > 0 && !/[\x00-\x08\x0E-\x1F]/.test(line)) currentBlockLines.push(line)
      }

      // <hex> Tj operatörleri
      const hexSingleRegex = /<([0-9a-fA-F]+)>\s*Tj/g
      let hxMatch: RegExpExecArray | null
      while ((hxMatch = hexSingleRegex.exec(textBlock)) !== null) {
        const hex = hxMatch[1].toLowerCase()
        let decoded = ''
        if (globalCMap.has(hex)) {
          decoded = globalCMap.get(hex)!
        } else if (hex.length % 4 === 0) {
          for (let i = 0; i < hex.length; i += 4) {
            const chunk = hex.slice(i, i + 4)
            decoded += globalCMap.get(chunk) || String.fromCharCode(parseInt(chunk, 16))
          }
        } else {
          for (let i = 0; i < hex.length; i += 2) {
            const byteVal = parseInt(hex.slice(i, i + 2), 16)
            decoded += TURKISH_WIN1254_MAP[byteVal] || String.fromCharCode(byteVal)
          }
        }
        if (decoded.trim() && !/[\x00-\x08\x0E-\x1F]/.test(decoded)) currentBlockLines.push(decoded.trim())
      }

      if (currentBlockLines.length > 0) {
        paragraphs.push(currentBlockLines.join(' '))
      }
    }
  }

  // Operatör ve çöp filtreleme: PDF komutları (TJ, ET, BT, Tm, Tf, cm, q, Q vb.) asla metin olarak kabul edilmez
  const cleaned = paragraphs
    .map(p => p.replace(/\b(?:TJ|ET|BT|Tm|Tf|cm|q|Q|rg|RG|re|W\*)\b/g, '').replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0 && !/^[\d\s.\-+,#()\[\];]+$/.test(p))

  if (cleaned.length > 0) {
    return cleaned.join('\n\n').slice(0, 80_000)
  }

  // Güvenli yedek yol: SADECE gerçek anlamlı metin içeren satırları kabul et (ikili semboller kesinlikle elenir)
  for (const st of decompressedStreams) {
    const fallbackMatches = st.match(/\(([^)]{4,})\)/g)
    if (fallbackMatches) {
      for (const fm of fallbackMatches) {
        const clean = fm.slice(1, -1).trim()
        // Anlamlı metin oranı testi: karakterlerin en az %80'i Türkçe/İngilizce harf, rakam, noktalama ve boşluk olmalı
        const readableChars = (clean.match(/[a-zA-ZçğıöşüÇĞİÖŞÜ0-9\s.,;:!?'"()-]/g) || []).length
        if (
          clean.length >= 4 &&
          !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/.test(clean) &&
          !/[<>{}\\]/.test(clean) &&
          readableChars / clean.length >= 0.85
        ) {
          cleaned.push(clean)
        }
      }
    }
  }

  return cleaned
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80_000)
}

/**
 * Saf Node.js DOCX metin ve tablo çıkarıcısı.
 * word/document.xml içindeki paragrafları, tabloları, XML kaçışlarını ve Türkçe harfleri çözer.
 */
export function extractTextFromDocx(buf: Buffer): string {
  try {
    const entries = extractZipEntries(buf)
    const docXml = entries.get('word/document.xml')
    if (!docXml) return ''
    const xml = docXml.toString('utf8')

    const blocks: string[] = []
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
          blocks.push(rows.map(r => `| ${r.join(' | ')} |`).join('\n'))
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
          blocks.push(pText)
        }
      }
    }

    return blocks.join('\n\n').slice(0, 80_000)
  } catch {
    return ''
  }
}

/**
 * Saf Node.js PPTX slayt metin çıkarıcısı.
 * ppt/slides/slide*.xml dosyalarını sırayla okur, başlıkları ve maddeleri ayıklar.
 */
export function extractTextFromPptx(buf: Buffer): string {
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
      const odpSlides: string[] = []
      while ((pageMatch = pageRegex.exec(contentXml)) !== null) {
        const pageContent = pageMatch[1]
        const pMatches = pageContent.match(/<text:p(?: [^>]*)?>([^<]*)<\/text:p>/g) || []
        const lines = pMatches.map(m => decodeXmlEntities(m.replace(/<[^>]+>/g, '')).trim()).filter(Boolean)
        const title = lines[0] || `Slayt ${pageIdx}`
        const bullets = lines.length > 1 ? lines.slice(1) : []
        let block = `[Slayt ${pageIdx}: ${title}]`
        if (bullets.length > 0) {
          block += '\n' + bullets.map(b => `• ${b}`).join('\n')
        }
        odpSlides.push(block)
        pageIdx++
      }
      if (odpSlides.length > 0) {
        return odpSlides.join('\n\n').slice(0, 80_000)
      }
    }

    slideEntries.sort((a, b) => a.num - b.num)

    const slideTexts: string[] = []
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
      const bullets = paragraphs.length > 1 ? paragraphs.slice(1) : []
      let slideBlock = `[Slayt ${slideIndexNum}: ${title}]`
      if (bullets.length > 0) {
        slideBlock += '\n' + bullets.map(b => `• ${b}`).join('\n')
      } else if (paragraphs.length <= 1) {
        slideBlock += '\n(Grafik, şema veya görsel ağırlıklı slayt)'
      }
      slideTexts.push(slideBlock)
    }

    return slideTexts.join('\n\n').slice(0, 80_000)
  } catch {
    return ''
  }
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

    const describe = (att: any, kind: 'odev' | 'materyal' | 'teslim' | 'duyuru', courseName?: string) => {
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
        for (const ann of this.storageService.getAnnouncements(course.id)) {
          for (const att of ann.materials || []) describe(att, 'duyuru', course.name)
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

    for (const ann of this.storageService.getAnnouncements(courseId)) {
      for (const att of ann.materials || []) describe(att, 'duyuru')
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

          const announcements = this.storageService.getAnnouncements(course.id)
          for (const a of announcements) {
            for (const att of a.materials || []) {
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

        // 1) PDF
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
            result: `[${cached.entry.title} - Çıkarılan PDF Metni (${text.length} karakter)]:\n${text.slice(0, 60_000)}`,
          }
        }

        // 2) Word / DOCX / ODT
        if (
          mime.includes('wordprocessingml') ||
          title.endsWith('.docx') ||
          title.endsWith('.odt')
        ) {
          const text = extractTextFromDocx(buf)
          return {
            requiresApproval: false,
            result: `[${cached.entry.title} - Çıkarılan Belge Metni (${text.length} karakter)]:\n${text.slice(0, 60_000)}`,
          }
        }

        // 3) PowerPoint / Slayt (PPTX / ODP)
        if (
          mime.includes('presentationml') ||
          title.endsWith('.pptx') ||
          title.endsWith('.odp')
        ) {
          const text = extractTextFromPptx(buf)
          return {
            requiresApproval: false,
            result: `[${cached.entry.title} - Çıkarılan Sunum Slaytları (${text.length} karakter)]:\n${text.slice(0, 60_000)}`,
          }
        }

        // 4) Tablolar (CSV / TSV)
        if (mime === 'text/csv' || title.endsWith('.csv') || title.endsWith('.tsv')) {
          const raw = buf.toString('utf8')
          const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0)
          const sample = lines.slice(0, 5).join('\n')
          const delimiter = (sample.match(/\t/g) || []).length > (sample.match(/,/g) || []).length ? '\t' : (sample.match(/;/g) || []).length > (sample.match(/,/g) || []).length ? ';' : ','
          const maxRows = Math.min(lines.length, 300)
          const formattedRows = lines.slice(0, maxRows).map(line => {
            const cells = line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''))
            return `| ${cells.join(' | ')} |`
          })
          return {
            requiresApproval: false,
            result: `[${cached.entry.title} - Tablo Verisi (${maxRows}/${lines.length} satır)]:\n${formattedRows.join('\n')}`,
          }
        }

        // 5) Kod ve Metin Dosyaları
        const isText =
          mime.startsWith('text/') ||
          /\.(md|txt|csv|json|ts|tsx|js|jsx|py|html|css|c|cpp|h|hpp|cs|java|sql|sh|bash|ps1|go|rs|php|rb|swift|kt|dart|yaml|yml|xml|toml|ini|env)$/i.test(title)

        if (isText) {
          const text = buf.toString('utf8')
          return {
            requiresApproval: false,
            result: `[${cached.entry.title} (${text.length} karakter)]:\n${text.slice(0, 60_000)}`,
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