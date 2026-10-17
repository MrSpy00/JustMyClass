import zlib from 'node:zlib'
import { StorageService } from './storageService'
import { VaultService } from './vaultService'
import { providerHttp } from './httpClient'
import { extractXlsxSheets } from './filePreviewService'
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

/**
 * CP1252 / WinAnsi 0x80-0x9F bandı.
 *
 * PDF'te varsayılan kodlama budur ve KROMLU TIRNAK (0x91/0x92/0x93/0x94),
 * TIRE (0x96 kisa, 0x97 uzun), UÇ NOKTA (0x85), MADDE İŞARETİ (0x95) ve
 * KROMLU TEK TIRNAKLAR bu aralıkta yer alır.
 *
 * ONCEKI SURUMUN HATASI: bu baytlar oldukları gibi bırakılıyordu. Sonraki
 * "kontrol karakteri var" filtresi de satiri (dolayısıyla SAYFAYI) tamamen
 * düşürüyordu. Sonuç: tırnak ve tire ile dolu Türkçe sayfaların metni hiç
 * çıkmıyordu. Artık doğru Unicode karşılıklarına çevriliyor.
 */
const WINANSI_HIGH_MAP: Record<number, string> = {
  0x80: '\u20AC', // €
  0x82: '\u201A', // ‚
  0x83: '\u0192', // ƒ
  0x84: '\u201E', // „
  0x85: '\u2026', // …
  0x86: '\u2020', // †
  0x87: '\u2021', // ‡
  0x88: '\u02C6', // ˆ
  0x89: '\u2030', // ‰
  0x8a: '\u0160', // Š
  0x8b: '\u2039', // ‹
  0x8c: '\u0152', // Œ
  0x8e: '\u017D', // Ž
  0x91: '\u2018', // '
  0x92: '\u2019', // '
  0x93: '\u201C', // "
  0x94: '\u201D', // "
  0x95: '\u2022', // •
  0x96: '\u2013', // –
  0x97: '\u2014', // —
  0x98: '\u02DC', // ˜
  0x99: '\u2122', // ™
  0x9a: '\u0161', // š
  0x9b: '\u203A', // ›
  0x9c: '\u0153', // œ
  0x9e: '\u017E', // ž
  0x9f: '\u0178', // Ÿ
}

/**
 * MacRomanEncoding yüksek bayt (0x80-0xFF) tablosu (özellikle macOS / Quartz / Keynote / Pages
 * ve bazı LaTeX/Office PDF üreticilerinin madde işareti 0xA5 • ve tire/tırnak karakterleri için).
 */
const MACROMAN_HIGH_MAP: Record<number, string> = {
  0xa0: '\u2020', // †
  0xa1: '\u00B0', // °
  0xa5: '\u2022', // • (MacRoman bullet — WinAnsi'de ¥ olduğu için PDF'lerde ¥ çıkmasına yol açıyordu)
  0xa6: '\u00B6', // ¶
  0xa7: '\u00DF', // ß
  0xa8: '\u00AE', // ®
  0xa9: '\u00A9', // ©
  0xaa: '\u2122', // ™
  0xc7: '\u00AB', // «
  0xc8: '\u00BB', // »
  0xc9: '\u2026', // …
  0xca: ' ',      // non-breaking space
  0xd0: '\u2013', // – (en dash)
  0xd1: '\u2014', // — (em dash)
  0xd2: '\u201C', // “
  0xd3: '\u201D', // ”
  0xd4: '\u2018', // ‘
  0xd5: '\u2019', // ’
  0xd6: '\u00F7', // ÷
  0: ' ',
}

/** Tek bir PDF metin baytini doğru karaktere cevirir (once Turkce, sonra MacRoman/WinAnsi). */
function pdfByteToChar(b: number, encoding?: 'MacRoman' | 'WinAnsi'): string {
  if (encoding === 'MacRoman' && MACROMAN_HIGH_MAP[b] !== undefined) {
    return MACROMAN_HIGH_MAP[b]
  }
  // 0xA5 bayti PDF metinlerinde neredeyse her zaman MacRoman madde isareti (•) olarak kullanilir
  if (b === 0xa5) return '\u2022'
  return TURKISH_WIN1254_MAP[b] ?? WINANSI_HIGH_MAP[b] ?? String.fromCharCode(b)
}

/**
 * Tekil Tj / TJ parçasındaki kontrol baytlarını temizler ancak
 * BAŞTAKİ / SONDAKİ / TEK BAŞINA BOŞLUKLARI ASLA KIRPMAZ (.trim() yapmaz).
 *
 * ÖNCEKİ SÜRÜMÜN KRİTİK HATASI: `decodeWithFont` her küçük TJ parçası için
 * `.trim()` yapan `scrubPdfText` çağırıyordu. Böylece `[(5. ) (Hafta ) (Uygulama )]`
 * veya `[(Bu) ( ) (haftaki)]` dizilerindeki tüm boşluklar siliniyor ve
 * `5.HaftaUygulamaProjesi:SıcaklıkKontrollü` gibi yapışık kelimeler oluşuyordu!
 */
function scrubPdfFragment(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    if (code === 9 || code === 10 || code === 13) {
      out += ch
      continue
    }
    if (code === 0x0b || code === 0x0c) {
      out += '\n'
      continue
    }
    if (code === 0xa0) {
      out += ' '
      continue
    }
    if (code === 0xa5) {
      out += '\u2022'
      continue
    }
    if (code >= 0x20 && code !== 0x7f) {
      out += ch
      continue
    }
    out += WINANSI_HIGH_MAP[code] ?? ' '
  }
  return out
}

/**
 * PDF metin satırındaki kontrol baytlarını temizler ve satır sonu/başı boşlukları kırpar.
 */
function scrubPdfText(s: string): string {
  return scrubPdfFragment(s)
    .replace(/\u00A5(?=\s*[A-ZÇĞİÖŞÜa-zçğıöşü0-9(])/g, '\u2022')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

const KNOWN_CAMEL_WORDS = new Set([
  'GitHub', 'GitLab', 'YouTube', 'JavaScript', 'TypeScript', 'PowerPoint',
  'OneDrive', 'SharePoint', 'WordPress', 'OpenAI', 'ChatGPT', 'DeepSeek',
  'PostgreSQL', 'MySQL', 'MongoDB', 'GraphQL', 'FastAPI', 'NextJS', 'NodeJS',
  'ReactJS', 'VueJS', 'MacBook', 'iPhone', 'iPad', 'macOS', 'iOS', 'McGraw',
  'JustMyClass', 'LibreOffice', ' SolidWorks', 'AutoCAD', 'MatLab', 'Simulink',
])

/**
 * PDF çıkarımında veya bazı PDF üreticilerinde (InDesign, Word, Chrome Print vb.)
 * her bir glifin ayrı ayrı konumlandırılması sonucu harfler arasına düşen sahte
 * boşlukları tespit edip doğal Türkçe/İngilizce kelimelere dönüştürür.
 */
export function repairPdfSpacedText(line: string): string {
  if (!line || line.length < 4) return line

  // 1) HTML/XML etiketleri: "< h t m l >", "< / h e a d >", "< / h t m l >" vb.
  let res = line.replace(/<\s*([/!?]?\s*[a-zA-Z0-9_-]+(?:\s+[/a-zA-Z0-9_-]+)*)\s*>/g, (_, inner) => {
    return `<${inner.replace(/\s+/g, '')}>`
  })

  // 2) Parantez içi tekil harf dizileri: "( L i n k l e r )", "( D B )"
  res = res.replace(/\(\s*([A-Za-zÇĞİÖŞÜa-zçğıöşü0-9](?:\s+[A-Za-zÇĞİÖŞÜa-zçğıöşü0-9])+)\s*\)/g, (_, inner) => {
    return `(${inner.replace(/\s+/g, '')})`
  })

  // 3) Çizgi, iki nokta, parantez gibi belirteçlerle ayrılmış token dizilerini incele
  const rawTokens = res.split(/\s+/)
  if (rawTokens.length < 3) return res

  const singleCharCount = rawTokens.filter(t => t.length === 1 && /[A-Za-zÇĞİÖŞÜa-zçğıöşü0-9]/.test(t)).length
  if (singleCharCount < 3) return res

  const isLower = (c: string) => /^[a-zçğıöşü]$/.test(c)
  const isUpper = (c: string) => /^[A-ZÇĞİÖŞÜ]$/.test(c)
  const isDigit = (c: string) => /^[0-9]$/.test(c)

  const COMMON_UPPER_WORDS = new Set([
    'HTML', 'HTML5', 'CSS', 'CSS3', 'JS', 'DB', 'SQL', 'PHP', 'API', 'REST', 'JSON', 'XML',
    'BST', 'FORM', 'VERİLERİNİN', 'GÖNDERİMİ', 'VE', 'VERİTABANI', 'BAĞLANTISI', 'ELEMANLARI',
    'BÖLÜMÜ', 'TABLO', 'TABLOLAR', 'LİSTE', 'LİSTELER', 'METİN', 'BAŞLIK', 'ETİKETLERİ',
    'DERS', 'HAFTA', 'ÖDEV', 'PROJE', 'SINAV', 'İÇİNDEKİLER', 'NOTLAR', 'GİRİŞ', 'SONUÇ'
  ])

  const outTokens: string[] = []
  let buffer: string[] = []

  const flushBuffer = () => {
    if (buffer.length === 0) return
    if (buffer.length === 1) {
      outTokens.push(buffer[0])
      buffer = []
      return
    }

    let currentWord = buffer[0]
    for (let i = 1; i < buffer.length; i++) {
      const prevChar = currentWord[currentWord.length - 1]
      const currChar = buffer[i]

      // Noktalama ayrımı
      if (/^[·—:;,!?]$/.test(currChar)) {
        if (/^[:;,!?]$/.test(currChar)) {
          outTokens.push(currentWord + currChar)
          currentWord = buffer[++i] ?? ''
        } else {
          outTokens.push(currentWord)
          outTokens.push(currChar)
          currentWord = buffer[++i] ?? ''
        }
        continue
      }
      if (/^[·—]$/.test(prevChar)) {
        outTokens.push(currentWord)
        currentWord = currChar
        continue
      }

      // Kural A: Küçük harften Büyük harfe geçiş kesinlikle YENİ KELİMEDİR
      // Örn: 'm' -> 'E' (Tüm Etiketler), 'k' -> 'K' (Örnek Kullanım)
      if (isLower(prevChar) && isUpper(currChar)) {
        outTokens.push(currentWord)
        currentWord = currChar
        continue
      }

      // Kural B: 've' gibi kısa bağlaçların tespiti
      if (
        currChar === 'v' &&
        buffer[i + 1] === 'e' &&
        (i + 2 === buffer.length || isUpper(buffer[i + 2]) || /^[·—:;,!?]$/.test(buffer[i + 2]))
      ) {
        outTokens.push(currentWord)
        currentWord = 've'
        i++
        continue
      }

      // Kural C: Tamamen büyük harfli kelime sınırları
      if (isUpper(prevChar) && isUpper(currChar)) {
        if (COMMON_UPPER_WORDS.has(currentWord)) {
          outTokens.push(currentWord)
          currentWord = currChar
          continue
        }
      }

      // Kural D: Büyük harf serisinden sonra gelen küçük harf bağlacı / kelime
      if (currentWord.length >= 2 && /^[A-ZÇĞİÖŞÜ0-9]+$/.test(currentWord) && isLower(currChar)) {
        outTokens.push(currentWord)
        currentWord = currChar
        continue
      }

      // Kural E: Sayı serisinden sonra gelen büyük harf
      if (isDigit(prevChar) && isUpper(currChar)) {
        outTokens.push(currentWord)
        currentWord = currChar
        continue
      }

      currentWord += currChar
    }

    if (currentWord) {
      outTokens.push(currentWord)
    }
    buffer = []
  }

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i]
    const isSingleChar = token.length === 1 && /[A-Za-zÇĞİÖŞÜa-zçğıöşü0-9·—:;,!?]/.test(token)
    const isAbbrPiece = /^[A-ZÇĞİÖŞÜa-zçğıöşü]\.$/.test(token)

    if (isSingleChar) {
      buffer.push(token)
    } else if (isAbbrPiece) {
      if (buffer.length > 0) {
        buffer.push(token)
      } else {
        outTokens.push(token)
      }
    } else {
      flushBuffer()
      outTokens.push(token)
    }
  }

  flushBuffer()
  return outTokens.join(' ').replace(/\s+([:;,!?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
}

/**
 * PDF üreticilerinin kerning / konumlandırma nedeniyle boşluk karakteri koymadan
 * bitiştirdiği Türkçe kelimeleri ve noktalama geçişlerini güvenli biçimde onarır.
 * Örn: "5.HaftaUygulamaProjesi:SıcaklıkKontrollü" -> "5. Hafta Uygulama Projesi: Sıcaklık Kontrollü"
 */
function repairPdfGluedWords(line: string): string {
  if (!line || line.length < 3) return line
  // URL veya e-posta olmayan parçalarda işlem yap
  return line
    .split(/(\s+)/)
    .map(token => {
      if (/^\s+$/.test(token)) return token
      if (/^(?:https?:\/\/|www\.|mailto:)/i.test(token) || token.includes('@') || token.includes('/')) {
        return token
      }
      if (KNOWN_CAMEL_WORDS.has(token)) return token

      let fixed = token
      // 1) Sayı + nokta + Büyük harf: "5.Hafta" -> "5. Hafta"
      fixed = fixed.replace(/(\d+\.)([A-ZÇĞİÖŞÜ][a-zçğıöşü])/g, '$1 $2')
      // 2) İki nokta / noktalı virgül + Harf: "Projesi:Sıcaklık" -> "Projesi: Sıcaklık"
      fixed = fixed.replace(/([:;])([A-ZÇĞİÖŞÜa-zçğıöşü])/g, '$1 $2')
      // 3) Kapanan parantez + Harf veya Harf + Açılan parantez (fonksiyon çağrısı değilse)
      fixed = fixed.replace(/(\))([A-ZÇĞİÖŞÜa-zçğıöşü])/g, '$1 $2')
      // 4) Küçük harf + Büyük harf + küçük harf (CamelCase yapışması): "HaftaUygulama" -> "Hafta Uygulama"
      fixed = fixed.replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ][a-zçğıöşü])/g, (match, low, up, offset, full) => {
        // Bilinen özel isim kontrolü
        for (const kw of KNOWN_CAMEL_WORDS) {
          if (full.includes(kw)) return match
        }
        return `${low} ${up}`
      })
      // 5) Madde işareti (•) hemen ardından boşluksuz harf geliyorsa
      fixed = fixed.replace(/(\u2022)([^\s])/g, '$1 $2')
      return fixed
    })
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
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
 * ZIP arşivi içindeki dosyaları açar (DOCX / PPTX / XLSX / ODT için
 * harici bağımlılıksız).
 *
 * NEDEN YENIDEN YAZILDI
 * --------------------
 * Önceki sürüm yalnızca YEREL BAŞLIKLARI (local file header) tarıyordu ve
 * `compressedSize > 0` şartını koşuyordu. Üç kritik sonuç doğuyordu:
 *
 *   1. DATA DESCRIPTOR (genel amaç bayrağı bit 3): Word/PowerPoint'in
 *      belirli yazma biçimlerinde yerel başlıktaki boyut alanları SIFIRDIR;
 *      boyutlar veri tanıtıcısında bulunur. `compressedSize > 0` testi
 *      başarısız olur, girdi ATLANIR ve tarayıcı sıkıştırılmış verinin
 *      İÇİNDEKİ sahte `PK\x03\x04` imzalarını aramaya başlar → tüm
 *      belgeler boş dönüyordu. (Kullanıcının "docx/pptx metin açılmıyor"
 *      şikâyetinin birinci nedeni.)
 *   2. SIFIR UZUNLUKLU girdiler düşüyordu.
 *   3. Yalnızca yöntem 0 (store) ve 8 (deflate) destekleniyordu; deflate64,
 *      bzip2, LZMA, zstd gibi yöntemler sessizce düşüyordu.
 *
 * Artık önce ORTA DİZİN (central directory) okunur — burada boyut ve ofset
 * alanları DAİMA doğrudur — ve yalnızca merkez dizin yoksa yerel başlıklara
 * geri düşülür. Veri tanıtıcılı yerel başlıklar merkez dizin sayesinde doğru
 * boyutla açılır.
 */
export function extractZipEntries(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()

  // ---- 1) ORTA DİZİN (central directory) ---------------------------------
  const eocdOffset = findEndOfCentralDirectory(buf)
  if (eocdOffset >= 0) {
    try {
      const cdCount = buf.readUInt16LE(eocdOffset + 10)
      const cdSize = buf.readUInt32LE(eocdOffset + 12)
      const cdOffset = buf.readUInt32LE(eocdOffset + 16)

      // ZIP64: 0xFFFFFFFF/0xFFFF ise ZIP64 uç kaydına bak.
      let entriesCount = cdCount
      let dirOffset = cdOffset
      let dirSize = cdSize
      if (dirOffset === 0xffffffff || entriesCount === 0xffff || dirSize === 0xffffffff) {
        const zip64 = readZip64Locator(buf, eocdOffset)
        if (zip64) {
          const z64 = zip64
          entriesCount = Number(z64.entries)
          dirOffset = Number(z64.centralDirOffset)
          dirSize = Number(z64.centralDirSize)
        }
      }

      if (dirOffset > 0 && dirOffset < buf.length && dirSize >= 0) {
        let p = dirOffset
        const end = Math.min(buf.length, dirOffset + (dirSize || buf.length))
        let read = 0
        while (p + 46 <= end && read < entriesCount + 8) {
          if (buf.readUInt32LE(p) !== 0x02014b50) break
          const flags = buf.readUInt16LE(p + 8)
          const method = buf.readUInt16LE(p + 10)
          let compSize = buf.readUInt32LE(p + 20)
          let uncompSize = buf.readUInt32LE(p + 24)
          const nameLen = buf.readUInt16LE(p + 28)
          const extraLen = buf.readUInt16LE(p + 30)
          const commentLen = buf.readUInt16LE(p + 32)
          let localOffset = buf.readUInt32LE(p + 42)
          const name = buf.toString('utf8', p + 46, p + 46 + nameLen)

          // ZIP64 ek alanı
          if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
            let ep = p + 46 + nameLen
            const eEnd = ep + extraLen
            while (ep + 4 <= eEnd) {
              const hid = buf.readUInt16LE(ep)
              const hsize = buf.readUInt16LE(ep + 2)
              if (hid === 0x0001) {
                let q = ep + 4
                if (uncompSize === 0xffffffff && q + 8 <= eEnd) { uncompSize = Number(buf.readBigUInt64LE(q)); q += 8 }
                if (compSize === 0xffffffff && q + 8 <= eEnd) { compSize = Number(buf.readBigUInt64LE(q)); q += 8 }
                if (localOffset === 0xffffffff && q + 8 <= eEnd) { localOffset = Number(buf.readBigUInt64LE(q)); q += 8 }
                break
              }
              ep += 4 + hsize
            }
          }

          p = p + 46 + nameLen + extraLen + commentLen
          read++

          if (!name || name.endsWith('/')) continue
          const data = readLocalEntryData(buf, localOffset, method, compSize, flags)
          if (data) entries.set(name, data)
        }
      }
    } catch {
      /* merkez dizin okunamadi -> yerel basliklara dusulur */
    }
  }

  if (entries.size > 0) return entries

  // ---- 2) YEREL BAŞLIKLAR (yedek yol) ------------------------------------
  try {
    let offset = 0
    while (offset < buf.length - 30) {
      if (buf.readUInt32LE(offset) !== 0x04034b50) {
        offset++
        continue
      }
      const flags = buf.readUInt16LE(offset + 6)
      const method = buf.readUInt16LE(offset + 8)
      let compSize = buf.readUInt32LE(offset + 18)
      const nameLen = buf.readUInt16LE(offset + 26)
      const extraLen = buf.readUInt16LE(offset + 28)
      const name = buf.toString('utf8', offset + 30, offset + 30 + nameLen)
      const dataOffset = offset + 30 + nameLen + extraLen

      // Veri tanıtıcısı varsa boyut alanları 0'dır; sınırdan türet.
      if (compSize === 0 && (flags & 0x0008) !== 0) {
        const scanned = scanToDataDescriptor(buf, dataOffset)
        if (scanned > dataOffset) compSize = scanned - dataOffset
      }

      if (compSize > 0 && dataOffset + compSize <= buf.length) {
        const decomp = decompressZipEntry(buf.subarray(dataOffset, dataOffset + compSize), method)
        if (decomp && name && !name.endsWith('/')) entries.set(name, decomp)
        offset = dataOffset + compSize
        continue
      }
      if (compSize === 0 && name && !name.endsWith('/')) entries.set(name, Buffer.alloc(0))
      offset = dataOffset
    }
  } catch {
    /* yoksay */
  }

  return entries
}

/** EOCD (End Of Central Directory) imzasini bulur. */
function findEndOfCentralDirectory(buf: Buffer): number {
  const minPos = Math.max(0, buf.length - 66_000)
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

function readZip64Locator(
  buf: Buffer,
  eocdOffset: number,
): { entries: bigint; centralDirSize: bigint; centralDirOffset: bigint } | null {
  const locOffset = eocdOffset - 20
  if (locOffset < 0) return null
  if (buf.readUInt32LE(locOffset) !== 0x07064b50) return null
  try {
    const z64Offset = Number(buf.readBigUInt64LE(locOffset + 8))
    if (z64Offset < 0 || z64Offset + 56 > buf.length) return null
    if (buf.readUInt32LE(z64Offset) !== 0x06064b50) return null
    return {
      entries: buf.readBigUInt64LE(z64Offset + 32),
      centralDirSize: buf.readBigUInt64LE(z64Offset + 40),
      centralDirOffset: buf.readBigUInt64LE(z64Offset + 48),
    }
  } catch {
    return null
  }
}

/** Yerel başlıktan veri dilimini okur ve açar. */
function readLocalEntryData(buf: Buffer, localOffset: number, method: number, compSize: number, flags: number): Buffer | null {
  if (localOffset < 0 || localOffset + 30 > buf.length) return null
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) return null
  const nameLen = buf.readUInt16LE(localOffset + 26)
  const extraLen = buf.readUInt16LE(localOffset + 28)
  const dataOffset = localOffset + 30 + nameLen + extraLen
  if (dataOffset > buf.length) return null

  let size = compSize
  if (size === 0 || dataOffset + size > buf.length) {
    // Boyut yanlış/0: veri tanıtıcısını tara ya da dosya sonuna kadar al.
    const scanned = (flags & 0x0008) !== 0 ? scanToDataDescriptor(buf, dataOffset) : -1
    if (scanned > dataOffset) size = scanned - dataOffset
    else return null
  }
  return decompressZipEntry(buf.subarray(dataOffset, dataOffset + size), method)
}

/** Veri tanıtıcısının (PK\x07\x08) baslangicini bulur. */
function scanToDataDescriptor(buf: Buffer, from: number): number {
  for (let i = from; i < Math.min(buf.length - 4, from + 80_000_000); i++) {
    if (buf.readUInt32LE(i) === 0x08074b50) return i
  }
  return -1
}

/** ZIP sikistirma yontemlerini destekler. */
function decompressZipEntry(data: Buffer, method: number): Buffer | null {
  if (method === 0) return data
  if (method === 8) {
    try {
      return zlib.inflateRawSync(data)
    } catch {
      try {
        return zlib.inflateSync(data)
      } catch {
        // Bozuk akis: kismi cozumle dene.
        try {
          const inf = zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
          return inf
        } catch {
          return null
        }
      }
    }
  }
  if (method === 12) {
    // BZIP2 - Electron/Node tarafinda harici bagimlilik yok; atlanir.
    return null
  }
  if (method === 93 || method === 95) {
    // ZSTD - Node 22+ zlib ile destekleniyorsa kullanilir.
    try {
      const zstd = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync
      if (zstd) return zstd(data)
    } catch {
      /* desteklenmiyor */
    }
    return null
  }
  if (method === 9 || method === 14) {
    // Deflate64 / LZMA: desteklenmiyor.
    return null
  }
  return null
}

/**
 * CMap anahtarlarini 4 haneli ondalik (CID) veya 2 haneli ondalik
 * (basit font) bicimine NORMALIZE eder.
 *
 * NEDEN GEREKLI?
 * Bir CMap icinde anahtar uzunlugu karisik olabilir (`<03>`, `<0003>`).
 * Onceki surum anahtari OLDUGU GIBI kaydediyordu, ama metin akisi her
 * zaman 4 hanelik parcalar ariyordu. `<03>` yazan bir CMap ile 4 haneli
 * arama hicbir zaman eslesmiyor, sessizce TUM METIN BOS donuyordu.
 */
function normalizeCMapKey(hex: string, widths: 1 | 2): string {
  const h = hex.toLowerCase().replace(/[^0-9a-f]/g, '')
  return widths === 2 ? h.padStart(4, '0').slice(-4) : h.padStart(2, '0').slice(-2)
}

/**
 * PDF ToUnicode CMap bloklarını ayıklar ve Unicode karakter karşılıklarını haritalandırır.
 *
 * DUZELTMELER (onceki surumun hatalari):
 *  1. `beginbfchar`/`beginbfrange` satir sonu ZORUNLU TUTULUYORDU. Tek
 *     satirlik CMap'ler (`1 beginbfchar <03> <0020> endbfchar`) hicbir
 *     zaman eslesmiyordu.
 *  2. satir satir ilk ESLESME aliniyordu; ayni satirda birden fazla
 *     cift olan CMap'lerde kayitin geri kalani kayboluyordu.
 *  3. `bfrange` DIZI bicimi (`<lo> <hi> [<d1> <d2> ...]`) HIC islenmiyordu
 *     (yorumda vardi, kodda yoktu). Word/LibreOffice sik olarak uretir.
 *  4. Anahtarlar normalize edilmiyordu (yukarida anlatildi).
 *  5. Hedefte >BMP bir karakter iki yalniz suroga bolunuyordu.
 */
function parsePdfCMap(decompressedText: string, widths: 1 | 2 = 2): Map<string, string> {
  const cmap = new Map<string, string>()

  /** <4A> veya <004A> -> gercek Unicode metni (surrogate-safe). */
  const utf16beToString = (hex: string): string => {
    const h = hex.toLowerCase().replace(/[^0-9a-f]/g, '')
    if (h.length === 0) return ''
    if (h.length <= 2) return String.fromCharCode(parseInt(h, 16))
    // CMap hedefleri UTF-16BE'dir. 4 haneli surrogate ciftlerini birlestir.
    let out = ''
    for (let i = 0; i + 4 <= h.length; i += 4) {
      out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16))
    }
    if (h.length % 4 !== 0) {
      // Tek bayt kalan son parca
      const tail = h.slice(h.length - (h.length % 4))
      if (tail.length === 2) out += String.fromCharCode(parseInt(tail, 16))
    }
    return out
  }

  // --- beginbfchar -------------------------------------------------------
  const bfCharRegex = /beginbfchar([\s\S]*?)endbfchar/g
  let bfMatch: RegExpExecArray | null
  const charPairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
  while ((bfMatch = bfCharRegex.exec(decompressedText)) !== null) {
    charPairRe.lastIndex = 0
    let pair: RegExpExecArray | null
    while ((pair = charPairRe.exec(bfMatch[1])) !== null) {
      cmap.set(normalizeCMapKey(pair[1], widths), utf16beToString(pair[2]))
    }
  }

  // --- beginbfrange ------------------------------------------------------
  //Uc bicim:
  //   <lo> <hi> <dstStart>              -> ardisik Unicode
  //   <lo> <hi> [<d1> <d2> ...]         -> dizi (ATLANIYORDU)
  const bfRangeRegex = /beginbfrange([\s\S]*?)endbfrange/g
  let rgMatch: RegExpExecArray | null
  while ((rgMatch = bfRangeRegex.exec(decompressedText)) !== null) {
    const body = rgMatch[1]
    const headRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*/g
    let head: RegExpExecArray | null
    while ((head = headRe.exec(body)) !== null) {
      const lo = parseInt(head[1], 16)
      const hi = parseInt(head[2], 16)
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) continue
      // Guvenlik: absurd araliklar (bozuk CMap) sonsuz dongu yaratir.
      if (hi - lo > 0x10000) continue
      const rest = body.slice(head.index + head[0].length)

      if (rest.startsWith('[')) {
        // DIZI BICIMI: <lo> <hi> [<0041> <0042> ...]
        const end = rest.indexOf(']')
        if (end === -1) break
        const items = rest.slice(1, end).match(/<([0-9a-fA-F]+)>/g) ?? []
        for (let k = 0; k < lo + items.length && k <= hi; k++) {
          const dst = items[k - lo]?.replace(/[<>\s]/g, '')
          if (dst) cmap.set(normalizeCMapKey(k.toString(16), widths), utf16beToString(dst))
        }
        headRe.lastIndex = head.index + head[0].length + end + 1
      } else {
        // DUZ BICIM: <lo> <hi> <dstStart>
        const dstMatch = /^<([0-9a-fA-F]+)>/.exec(rest)
        if (!dstMatch) {
          headRe.lastIndex = head.index + head[0].length
          continue
        }
        let dst = parseInt(dstMatch[1], 16)
        for (let code = lo; code <= hi; code++) {
          cmap.set(normalizeCMapKey(code.toString(16), widths), String.fromCharCode(dst))
          // Hedef 4 haneli surrogate ise tam kod noktasini yaz.
          if (dst >= 0xd800 && dst <= 0xdbff && code + 1 <= hi) {
            const low = dst + 1
            if (low >= 0xdc00 && low <= 0xdfff) {
              cmap.set(normalizeCMapKey((code + 1).toString(16), widths), String.fromCharCode(low))
              dst += 2
              code++
              continue
            }
          }
          dst++
        }
        headRe.lastIndex = head.index + head[0].length + dstMatch[0].length
      }
    }
  }

  return cmap
}

/**
 * Bir yazitipinin cozumlemesi icin gereken her sey.
 *
 * `widths` bu yazitipinin karakter basina kac bayt tukettigini belirtir:
 *   1 -> basit font (Type1 / TrueType / Type3): her karakter 1 bayt
 *   2 -> CID font (Type0 + Identity-H): her karakter 2 bayt
 *
 * ONCEKI SURUMUN HATASI
 * --------------------
 * Yazitipi cozumlemesi HIC YAPILMIYORDU. Tum ToUnicode haritalari tek bir
 * `Map`e dolduruluyor ve TEK bir bayt adimiyla butun metne uygulaniyordu.
 * Boylece `Identity-H` bir metinde her karakter 2 bayt olmasina ragmen
 * 0x00 + 0xNN olarak ayristiriliyordu. 0x00 -> bosluk, 0xNN -> Latin-1.
 * Sonuc: kullanici "u hafta koaja enzdiA.P smiyomy#,zctnzooö#" goruyordu.
 * (# = 0x23, Y = 0xA5 -> dogrudan CID alt baytlari.)
 */
interface PdfFontInfo {
  /** Karakter basina bayt sayisi. */
  widths: 1 | 2
  /** Bu yazitipinin KENDI ToUnicode haritasi (yalnizca bu yazitipine ait). */
  toUnicode: Map<string, string>
  /** `/Differences` ile acikca tanimlanmis kodlar (basit fontlar). */
  differences: Map<number, string>
  /** 1-baytlik yazitip kodlamasi (MacRoman / WinAnsi). */
  encoding?: 'MacRoman' | 'WinAnsi'
}

/** AGL (Adobe Glyph List) alt kumesi: yazitip adindan Unicode. */
const GLYPH_NAME_UNICODE: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%',
  ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*',
  plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', zero: '0', one: '1',
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?',
  at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^',
  underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  bullet: '\u2022', quotedblleft: '\u201C', quotedblright: '\u201D', quotesinglbase: '\u201A',
  quotedblbase: '\u201E', endash: '\u2013', emdash: '\u2014', ellipsis: '\u2026',
  fi: '\uFB01', fl: '\uFB02', dagger: '\u2020', daggerdbl: '\u2021',
  trademark: '\u2122', copyright: '\u00A9', registered: '\u00AE', degree: '\u00B0',
  section: '\u00A7', paragraph: '\u00B6', sterling: '\u00A3', yen: '\u00A5',
  euro: '\u20AC', cent: '\u00A2', currency: '\u00A4', ordfeminine: '\u00AA',
  ordmasculine: '\u00BA', onesuperior: '\u00B9', twosuperior: '\u00B2', threesuperior: '\u00B3',
  onequarter: '\u00BC', onehalf: '\u00BD', threequarters: '\u00BE',
  minus: '\u2212', multiply: '\u00D7', divide: '\u00F7', plusminus: '\u00B1',
  periodcentered: '\u00B7', radical: '\u221A', infinity: '\u221E', notequal: '\u2260',
  lessequal: '\u2264', greaterequal: '\u2265', partialdiff: '\u2202', summation: '\u2211',
  product: '\u220F', pi: '\u03C0', Delta: '\u0394', Omega: '\u03A9', alpha: '\u03B1',
  beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4', pi2: '\u03C0', sigma: '\u03C3',
  lambda: '\u03BB', mu: '\u03BC', theta: '\u03B8', phi: '\u03C6', omega: '\u03C9',
  A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H', I: 'I', J: 'J',
  K: 'K', L: 'L', M: 'M', N: 'N', O: 'O', P: 'P', Q: 'Q', R: 'R', S: 'S', T: 'T',
  U: 'U', V: 'V', W: 'W', X: 'X', Y: 'Y', Z: 'Z',
  a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', g: 'g', h: 'h', i: 'i', j: 'j',
  k: 'k', l: 'l', m: 'm', n: 'n', o: 'o', p: 'p', q: 'q', r: 'r', s: 's', t: 't',
  u: 'u', v: 'v', w: 'w', x: 'x', y: 'y', z: 'z',
}

/** `/g42` gibi adlandirilmis alt kume glifleri, adindan cozulemez. */
function glyphNameToUnicode(name: string): string | null {
  if (!name) return null
  const direct = GLYPH_NAME_UNICODE[name]
  if (direct !== undefined) return direct
  // uniXXXX / uXXXX[XX]
  const uni = /^uni([0-9a-fA-F]{4,6})$/.exec(name)
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16))
  const u = /^u([0-9a-fA-F]{4,6})$/.exec(name)
  if (u) return String.fromCodePoint(parseInt(u[1], 16))
  // space.period -> space
  const dot = name.indexOf('.')
  if (dot > 0) {
    const base = name.slice(0, dot)
    if (base === 'uni' || base === 'u') return glyphNameToUnicode(name.slice(dot + 1))
  }
  return null
}

/** `/F1 12 0 R` kalibindeki nesne numarasini dondurur. */
function parseIndirectRef(text: string, key: string): number | null {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(text)
  return m ? parseInt(m[1], 10) : null
}

/**
 * Belgenin yazitip kaynaklarini cozer: `/F1 -> PdfFontInfo`.
 *
 * NEDEN GEREKLI?
 * --------------
 * Onceki surumde yazitip cozumlemesi YOKTU. Butun ToUnicode haritalari
 * tek bir `Map`e konuyor ve metin TEK bayt adimiyla cozuluyordu. Bu:
 *   1. Farkli yazitipin haritalari BIRBIRINI EZIYORDU (son yazan kazanir)
 *      -> bir yazitipin metni digerinin kodlariyla acilip sahte karakter
 *      uretiyordu.
 *   2. `Identity-H` (2 bayt/karakter) metinleri 1 bayt/karakter gibi
 *      okunuyordu -> "hafta" yazan yerde "u hafta koaja enzdi#" cikiyordu.
 *
 * COZUM
 * -----
 *   • `/Font` sozlugunden ad -> nesne eslesmesi kurulur.
 *   • Her yazitipinin `/Subtype` ve `/Encoding` degerine bakilarak karakter
 *     basina bayt sayisi (1 veya 2) belirlenir.
 *   • `/ToUnicode` akisi o yazitipye OZEL olarak cozulur.
 *   • `/Differences` dizisi varsa glif adlarindan Unicode uretilir.
 */
function resolveFontResources(
  str: string,
  objDict: Map<number, string>,
  streamByObj: Map<number, string>,
): Map<string, PdfFontInfo> {
  const fonts = new Map<string, PdfFontInfo>()

  // 1) Tum `/Font << /F1 12 0 R ... >>` sozluklerini (inline veya ref)
  // Ham ikili akislari (stream) taramak yerine yalnizca sozluk govdelerini tara
  const fontDicts: string[] = []
  const searchSpace = objDict.size > 0 ? Array.from(objDict.values()).join('\n') : str
  const fontDictRe = /\/Font\s*(?:(\d+)\s+\d+\s+R|<<)/g
  let fm: RegExpExecArray | null
  while ((fm = fontDictRe.exec(searchSpace)) !== null) {
    if (fm[1]) {
      const referenced = objDict.get(parseInt(fm[1], 10))
      if (referenced) fontDicts.push(referenced)
      continue
    }
    // Inline sozluk: `<< ... >>` blokunu dengeli sekilde bul
    const start = fm.index + fm[0].length - 2
    const end = findDictEnd(searchSpace, start)
    if (end > start) fontDicts.push(searchSpace.slice(start + 2, end))
  }

  // 2) Her sozlukte `/Ad 12 0 R` ciftlerini oku
  for (const dict of fontDicts) {
    const entryRe = /\/([A-Za-z0-9#._-]+)\s+(\d+)\s+\d+\s+R/g
    let em: RegExpExecArray | null
    while ((em = entryRe.exec(dict)) !== null) {
      const name = em[1]
      const fontObjNum = parseInt(em[2], 10)
      const fontDict = objDict.get(fontObjNum)
      if (!fontDict) continue

      const info = describeFont(fontDict, streamByObj)
      if (info) fonts.set(name, info)
    }
  }

  return fonts
}

/** `<<` ile baslayan bir sozlugun kapanis `>>` konumunu bulur. */
function findDictEnd(text: string, startAt: number): number {
  let depth = 0
  for (let i = startAt; i < text.length - 1; i++) {
    const c = text[i]
    if (c === '(') {
      // Literal string: kacisli parantezleri atla
      i++
      while (i < text.length && text[i] !== ')') {
        if (text[i] === '\\') i++
        i++
      }
      continue
    }
    if (c === '<' && text[i + 1] !== '<') {
      // Hex string
      i++
      while (i < text.length && text[i] !== '>') i++
      continue
    }
    if (c === '<' && text[i + 1] === '<') {
      depth++
      i++
      continue
    }
    if (c === '>' && text[i + 1] === '>') {
      depth--
      i++
      if (depth === 0) return i + 1
      continue
    }
  }
  return -1
}

/** Bir yazitip nesnesinin sozlugunden `PdfFontInfo` uretir. */
function describeFont(fontDict: string, streamByObj: Map<number, string>): PdfFontInfo | null {
  // Karakter basina bayt sayisi
  const isType0 = /\/Subtype\s*\/Type0\b/.test(fontDict)
  const isIdentity = /\/Encoding\s*\/Identity-[HV]\b/.test(fontDict)
  const isMacRoman = /\/Encoding\s*\/MacRomanEncoding\b|\/BaseEncoding\s*\/MacRomanEncoding\b/.test(fontDict)
  const widths: 1 | 2 = isType0 || isIdentity ? 2 : 1
  const encoding: 'MacRoman' | 'WinAnsi' = isMacRoman ? 'MacRoman' : 'WinAnsi'

  // ToUnicode
  const toUnicode = new Map<string, string>()
  const tuNum = parseIndirectRef(fontDict, 'ToUnicode')
  if (tuNum !== null) {
    const stream = streamByObj.get(tuNum)
    if (stream) {
      for (const [k, v] of parsePdfCMap(stream, widths).entries()) toUnicode.set(k, v)
    }
  }

  // /Differences: `[ /bullet /A /B 5 /C ]`
  const differences = new Map<number, string>()
  const diffMatch = /\/Differences\s*\[([^\]]*)\]/.exec(fontDict)
  if (diffMatch) {
    let code = 0
    const tokenRe = /\/([^\s/\[\]]+)|(-?\d+)/g
    let tm: RegExpExecArray | null
    while ((tm = tokenRe.exec(diffMatch[1])) !== null) {
      if (tm[2] !== undefined) {
        code = parseInt(tm[2], 10)
      } else {
        const ch = glyphNameToUnicode(tm[1])
        if (ch !== null) differences.set(code, ch)
        code++
      }
    }
  }

  if (toUnicode.size === 0 && differences.size === 0 && widths === 1 && !isMacRoman) return null
  return { widths, toUnicode, differences, encoding }
}

/**
 * Bir yazitip ve bir bayt dizisi ile metin uretir.
 *
 * 2 baytlik (CID) yazitipinda ciftler halinde, 1 baytlik yazitipinda tek
 * tek ilerler. Cozumleme sirasi:
 *   1. Yazitipin kendi ToUnicode haritasi
 *   2. `/Differences` ile tanimlanmis kod
 *   3. MacRoman / WinAnsi / Turkce Latin-5 tabanli karsilik (en iyi tahmin)
 *
 * ÖNEMLİ: Tekil Tj / TJ parçalarında `.trim()` yapmayan `scrubPdfFragment` kullanılır;
 * aksi halde parça başı/sonu boşluklar silinir ve kelimeler birbirine yapışır!
 */
function decodeWithFont(bytes: number[], font: PdfFontInfo | null): string {
  if (!font) {
    // Yazitip bilinmiyor: eski davranis (bayt bayt) ama taban kodlama ile
    const s = bytes.map(b => pdfByteToChar(b)).join('')
    return scrubPdfFragment(s)
  }

  let out = ''
  const step = font.widths

  // UTF-16BE BOM: metin zaten Unicode esdegeridir, yazitip haritasi
  // UYGULANMAZ. Bu kontrol yazitip cozumlemesinden ONCE yapilir.
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    }
    return scrubPdfFragment(out)
  }

  if (step === 1) {
    for (const b of bytes) {
      const key = b.toString(16).padStart(2, '0')
      const mapped = font.toUnicode.get(key)
      if (mapped !== undefined) {
        out += mapped
        continue
      }
      const diff = font.differences.get(b)
      if (diff !== undefined) {
        out += diff
        continue
      }
      out += pdfByteToChar(b, font.encoding)
    }
  } else {
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1]
      const key = code.toString(16).padStart(4, '0')
      const mapped = font.toUnicode.get(key)
      if (mapped !== undefined) {
        out += mapped
        continue
      }
      // CMap yoksa ya da bu kod icermiyorsa: ONEMLI.
      // Onceki surum burada 0x00 -> bosluk, 0xNN -> Latin-1 yaziyordu ve
      // kullanici "hafta" yerine "u hafta koaja" goruyordu.
      // Su an kodun TAMAMINI tek bir karakter gibi ele aliyoruz; cogu
      // Identity-H alt kume yazitipinde kod dogrudan Unicode esdegeridir.
      if (code === 0xa5) {
        out += '\u2022'
      } else if (code >= 0x20 && code <= 0x7e) {
        out += String.fromCharCode(code)
      } else if (code >= 0xa0 && code <= 0xff) {
        out += String.fromCharCode(code)
      } else {
        // Gercekten cozulemeyen kod: sessizce AT (sahte karakter uretme).
        out += ' '
      }
    }
    // Tek bayt artik kaldiysa (bozuk akis)
    if (bytes.length % 2 === 1) out += pdfByteToChar(bytes[bytes.length - 1], font.encoding)
  }

  return scrubPdfFragment(out)
}


/**
 * PDF literal string `(...)` icerigini bayt dizisine cevirir.
 *
 * Yazitip cozumlemesi bayt BAZINDA calistigi icin once kacislar
 * cozulmeli, byte degerleri korunmali. `decodePdfLiteralString` ise
 * dogrudan metin uretiyordu; yazitip genisligi bilinmeden kullanilamaz.
 */
function unescapePdfLiteral(raw: string): number[] {
  const bytes: number[] = []
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch !== '\\') {
      // PDF literal string'leri PDFDocEncoding/8-bit ile saklanir; JS string
      // UTF-16 oldugu icin dusuk bayt alinir.
      bytes.push(ch.charCodeAt(0) & 0xff)
      i++
      continue
    }
    // Kacis
    const next = raw[i + 1]
    if (next === undefined) break
    // Octal: 1-3 hane
    const octal = /^[0-7]{1,3}/.exec(raw.slice(i + 1, i + 4))
    if (octal) {
      bytes.push(parseInt(octal[0], 8) & 0xff)
      i += 1 + octal[0].length
      continue
    }
    switch (next) {
      case 'n': bytes.push(10); i += 2; break
      case 'r': bytes.push(13); i += 2; break
      case 't': bytes.push(9); i += 2; break
      case 'b': bytes.push(8); i += 2; break
      case 'f': bytes.push(12); i += 2; break
      case '\r':
        // Satir sonu devam (line continuation)
        i += 2
        if (raw[i] === '\n') i++
        break
      case '\n':
        i += 2
        break
      default:
        bytes.push(next.charCodeAt(0) & 0xff)
        i += 2
        break
    }
  }
  return bytes
}

/** PDF hex string `<...>` icerigini yazitipina gore cozer. */
function decodePdfHexString(hex: string, font: PdfFontInfo | null): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  if (clean.length === 0) return ''
  // Tek haneli (yarim bayt) veri: sonda bir ondalik atlanir.
  const padded = clean.length % 2 === 1 ? clean + '0' : clean
  const bytes: number[] = []
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.slice(i, i + 2), 16))
  }
  return decodeWithFont(bytes, font)
}


/** ASCII85 (PDF/PostScript) akışını çözer. */
function decodeAscii85(raw: string): Buffer | null {
  try {
    let s = raw.replace(/\s/g, '')
    if (s.startsWith('<~')) s = s.slice(2)
    const end = s.indexOf('~>')
    if (end !== -1) s = s.slice(0, end)
    if (!s) return null
    const out: number[] = []
    let tuple: number[] = []
    for (const ch of s) {
      if (ch === 'z' && tuple.length === 0) {
        out.push(0, 0, 0, 0)
        continue
      }
      const v = ch.charCodeAt(0) - 33
      if (v < 0 || v > 84) continue
      tuple.push(v)
      if (tuple.length === 5) {
        let value = 0
        for (const d of tuple) value = value * 85 + d
        out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
        tuple = []
      }
    }
    if (tuple.length > 1) {
      const pad = 5 - tuple.length
      let value = 0
      for (const d of [...tuple, ...Array(pad).fill(84)]) value = value * 85 + d
      const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
      out.push(...bytes.slice(0, 4 - pad))
    }
    return Buffer.from(out)
  } catch {
    return null
  }
}

/** RunLengthDecode (PDF filtresi) akışını çözer. */
function decodeRunLength(raw: string): Buffer | null {
  try {
    const out: number[] = []
    let i = 0
    while (i < raw.length) {
      const len = raw.charCodeAt(i++) & 0xff
      if (len === 128) break
      if (len < 128) {
        for (let j = 0; j <= len && i < raw.length; j++) out.push(raw.charCodeAt(i++) & 0xff)
      } else {
        const b = raw.charCodeAt(i++) & 0xff
        for (let j = 0; j < 257 - len; j++) out.push(b)
      }
      if (out.length > 20_000_000) break
    }
    return Buffer.from(out)
  } catch {
    return null
  }
}

/**
 * Gorsel dosyanin PIKSEL olculerini harici kutuphane olmadan okur.
 *
 * Desteklenen: PNG, GIF, BMP, JPEG (SOF0..SOF15, DHT/DAC/RST hariç),
 * WEBP (VP8/VP8L/VP8X basliklari), TIFF (II/MM + IFD etiketleri),
 * SVG (viewBox / width-height).
 *
 * Amac: kullaniciya "bu gorsel 3024x4032" demek yerine gercek olcuyu
 * gostermek; boylece model dosyanin buyuklugunu tahmin etmez.
 */
export function readImageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (!buf || buf.length < 16) return null

  try {
    // --- PNG ---
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      if (buf.length >= 24) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
      }
      return null
    }

    // --- GIF ---
    if (buf.toString('latin1', 0, 3) === 'GIF') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    }

    // --- BMP ---
    if (buf[0] === 0x42 && buf[1] === 0x4d) {
      return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) }
    }

    // --- WEBP ---
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
      const fourcc = buf.toString('latin1', 12, 16)
      if (fourcc === 'VP8 ' && buf.length >= 30) {
        // Kaynak: "VP8 " basligindan sonra 14 bayt; 0x9d012a sonrasi
        // 14 bit genislik, 14 bit yukseklik (2 bayt bayt sirasiyla).
        const w = buf.readUInt16LE(26) & 0x3fff
        const h = buf.readUInt16LE(28) & 0x3fff
        if (w > 0 && h > 0) return { width: w, height: h }
      } else if (fourcc === 'VP8L' && buf.length >= 25) {
        const bits = buf.readUInt32LE(21)
        const w = (bits & 0x3fff) + 1
        const h = ((bits >> 14) & 0x3fff) + 1
        return { width: w, height: h }
      } else if (fourcc === 'VP8X' && buf.length >= 30) {
        const w = ((buf[24] | (buf[25] << 8) | (buf[26] << 16)) & 0xffffff) + 1
        const h = ((buf[27] | (buf[28] << 8) | (buf[29] << 16)) & 0xffffff) + 1
        return { width: w, height: h }
      }
      return null
    }

    // --- TIFF ---
    const bom = buf.toString('latin1', 0, 4)
    if (bom === 'II*\u0000' || bom === 'MM\u0000*') {
      const le = bom === 'II*\u0000'
      const read16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o))
      const read32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))
      const ifd = read32(4)
      if (ifd + 2 <= buf.length) {
        const count = read16(ifd)
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12
          if (entry + 12 > buf.length) break
          const tag = read16(entry)
          if (tag === 0x0100 || tag === 0x0101) {
            const type = read16(entry + 2)
            const value = type === 3 ? read16(entry + 8) : read32(entry + 8)
            const other = tag === 0x0100 ? 0 : 1
            if (value > 0) return { width: other === 0 ? value : 0, height: other === 0 ? 0 : value }
          }
        }
      }
      return null
    }

    // --- SVG ---
    const head = buf.toString('utf8', 0, Math.min(buf.length, 2048))
    if (/<svg[\s>]/i.test(head)) {
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(head)
      if (vb) return { width: Math.round(+vb[1]), height: Math.round(+vb[2]) }
      const w = /\bwidth\s*=\s*["']\s*([\d.]+)/i.exec(head)
      const h = /\bheight\s*=\s*["']\s*([\d.]+)/i.exec(head)
      if (w && h) return { width: Math.round(+w[1]), height: Math.round(+h[1]) }
      return null
    }

    // --- JPEG: SOF isaretini tara ---
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset++
          continue
        }
        const marker = buf[offset + 1]
        // SOF0..SOF15, DHT/JPG/DAC haric (0xc0..0xcf, 0xc4, 0xc8, 0xcc)
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) }
        }
        const segLen = buf.readUInt16BE(offset + 2)
        if (segLen < 2) break
        offset += 2 + segLen
      }
      return null
    }
  } catch {
    return null
  }

  return null
}

/**
 * PDF şifreli mi? (/Encrypt sözlüğü)
 *
 * Şifreli PDF'lerde tum akislar RC4/AES ile sarilmistir; dekompresyon
 * denemeleri hep basarisiz olur ve kullaniciya "taranmis resim" yalani
 * soylenir. Artik acik bir mesaj donuyor.
 */
export function isPdfEncrypted(buf: Buffer): boolean {
  if (!buf || buf.length < 10) return false
  const head = buf.toString('latin1', 0, Math.min(buf.length, 4096))
  if (!head.startsWith('%PDF-')) return false
  const tail = buf.toString('latin1', Math.max(0, buf.length - 4096))
  return /\/Encrypt\b/.test(head) || /\/Encrypt\b/.test(tail)
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

  // SIFRELI PDF: akislar cozulemez. Kullaniciya acikca bildir.
  if (isPdfEncrypted(buf)) {
    return '[Bu PDF parola korumalıdır. Parolayı bilmeden metin çıkarılamaz; dosyayı harici bir PDF okuyucusunda açıp metni kopyalayabilir veya asistanla paylaşabilirsiniz.]'
  }

  // -------------------------------------------------------------------------
  // NESNE DIZINI: nesne no -> sozluk metni
  // -------------------------------------------------------------------------
  // Yazitip cozumlemesi icin gerekli. Onceki surumde nesne dizini HIC
  // kurulmuyordu; `/F1 12 0 R` gibi bir referans `12` sayisi saniliyordu.
  // -------------------------------------------------------------------------
  // TEK GECISLI DIZINLEYICI (OBJE + AKIS)
  // -------------------------------------------------------------------------
  //
  // HATANIN GELISMESI
  // -----------------
  // Onceki surum IKI ayri tarama yapiyordu ve ikisi de O(n^2) idi:
  //
  //   1) `str.indexOf('endobj', om.index)`  -> her nesne icin dosyanin
  //      sonuna kadar ilerliyor.
  //   2) `str.lastIndexOf('obj', match.index)` -> her akis icin dosyanin
  //      BASINA kadar GERI tarıyor. Son akis icin bu ~11 MB'dir; 500 akis
  //      oldugunda ~2.7 GB karakter taramasi olusuyor.
  //   3) `str.slice(dictStart, match.index)` -> her akis icin yeni bir
  //      onlarca KB'lik dize olusturuyor.
  //
  // `extractTextFromPdf` Ana surecte SENKRON cagrildigi icin bu, 11 MB'lik
  // bir PDF'de onlarca saniyelik donma demek; kullanici ekranda "Belge
  // Hazirlaniyor..." yuzunden sonsuza kadar kaliyor ve tum arayuz donuyor.
  //
  // COZUM
  // -----
  // `obj` / `endobj` / `stream` / `endstream` belirtecleri TEK bir
  // duzenli ifade ile dosya boyunca sirali taranir. Ayni gecis hem nesne
  // govdesini hem de akis sahipligini doldurur: toplam maliyet O(n) olur
  // ve yazma hatasi ihtimali ortadan kalkar (ikinci bir tarama gerekmez).
  const objDict = new Map<number, string>()

  /** Bulunan akis: ait oldugu nesne, sozluk metni ve ham akis govdesi. */
  interface RawStreamEntry {
    objNum: number | null
    dictSlice: string
    rawData: string
    /** Ham govdenin `buf` icindeki baslangic ofseti. */
    streamStart: number
  }
  const rawStreams: RawStreamEntry[] = []

  // GECEK SINIRLAR
  // -------------
  // Bozuk/olusturulmus dosyalar milyonlarca sahte `stream` belirteci
  // uretebilir. Bunlar hem bellegi hem de sureci tuketirdigi icin sert
  // sinirlar konur; asil bir PDF'in onlarca-yuzlerce akisi vardir.
  const MAX_PDF_OBJECTS = 200_000
  const MAX_PDF_STREAMS = 20_000
  /** Tek bir akisin cozulmus en fazla bayt sayisi (zip bomba korumasi). */
  const MAX_PDF_STREAM_BYTES = 32 * 1024 * 1024

  {
    /*
      BELIRTEC DIZISI
      ----------------
      1) `endstream`in icindeki `stream`e `\bstream\b` UYMAZ: `endstream`de
         `stream`in onunde `d` vardir, yani kelime siniri yoktur.

      2) `stream` anahtar kelimesinden SONRA satir sonu ZORUNLUDUR.
         PDF spec'i bunu soyler ve bu kural bir sahte eslesmeyi daha
         ortadan kaldirir: sozlugun icindeki bir metinde gecebilen
         kelime `stream` (orn. `/Title (my stream notes)`) giris
         olarak sayilirsa, akisin geri kalani "endstream" aranarak
         yutulur ve o nesnenin govdesi yanlis cikarilir.

         Onceki surumun `/stream[\r\n]+...` deseni de satir sonu ariyordu;
         yani bu kisitlama bir gerileme degil, eski davranisin aynisi.
    */
    const tokenRe = /(\d+)\s+(\d+)\s+obj\b|endobj\b|endstream\b|stream\b[ \t]*(?=\r?\n)/g

    let tm: RegExpExecArray | null
    let currentObjNum: number | null = null
    /** Aktif nesnenin govdesinin `str` icindeki baslangici. */
    let currentObjBodyStart = -1
    /** Aktif nesnenin sozlugunun basladigi yer (akis sahipligi icin). */
    let currentObjStart = -1
    /** `stream` kelimesinin basladigi yer. */
    let pendingStreamKeyword = -1
    let objects = 0

    /*
      DURUM MAKINESI - ZORUNLU
      -------------------------
      Sikistirilmis akis govdesi IKILIDIR ve icinde `stream`, `endobj`
      ya da `12 0 obj` benzeri bayt dizileri OLABILIR. Ilk taslak
      belirtecleri durumsuz sayiyordu; boylece bir sayfanin akisi yanlis
      baslangic ofsetiyle KAYBOLUYORDU ve o sayfanin metni cikmiyordu
      (12 sayfalik denemede 1-8 cikti, 9-12 kayboldu).

      Dogru davranis: `stream` goruldugunde akisin ICINDE sayilir ve
      `endstream` gelene kadar hicbir belirtec dikkate alinmaz. Boylece
      ikili govde icindeki sahte belirtecler yanlis eslesme uretmez.

      (Kalan tek kabul: govdenin icinde `endstream` bayt dizisi varsa
      akis orada kesilir. Onceki surumun
      `/stream[\r\n]+([\s\S]*?)[\r\n]+endstream/` deseni de ayni kabulu
      tasiyordu; yani bu bir regresyon degil.)
    */
    let insideStream = false

    while ((tm = tokenRe.exec(str)) !== null) {
      const token = tm[0]

      // Akis icindeyken yalnizca cikis belirteci anlamlidir.
      if (insideStream) {
        if (token !== 'endstream') continue
        insideStream = false

        // Akis govdesi `stream` anahtar kelimesinden sonra, satir sonu
        // atlandiktan sonra baslar.
        let bodyStart = pendingStreamKeyword + 'stream'.length
        if (str.charCodeAt(bodyStart) === 13) bodyStart += 1 // \r
        if (str.charCodeAt(bodyStart) === 10) bodyStart += 1 // \n

        // Bu akisin sozlugu: aktif nesnenin basindan `stream` anahtarina kadar.
        const dictSlice =
          currentObjStart >= 0 && currentObjStart <= pendingStreamKeyword
            ? str.slice(currentObjStart, pendingStreamKeyword)
            : str.slice(Math.max(0, pendingStreamKeyword - 1500), pendingStreamKeyword)

// Govde sonu: ONCE `/Length` degerine guvenilir, ancak olmayinca
        // `endstream` oncesindeki satir sonuna guvenilir.
        //
        // NEDEN BU SIRA ONEMLI?
        // -------------------
        // Satir sonu temizligi, govdenin SON bayti 0x0A/0x0D ise o bayti
        // da siler. Sikistirilmis veri IKILIDIR ve boyle bir baytla
        // bitmesi tamamen normaldir; boyle bir akisin inflate'i basarisiz
        // olur ve O SAYFA TAMAMEN KAYBOLUR. Testte 12 sayfanin 9'u bu
        // yuzden cikmiyordu.
        //
        // `/Length` ise PDF sozlugunde yazan BOYUTTUR: inflate girdisinin
        // gercekten kac bayt olmasi gerektigini tam olarak bildirir.
        // `/Length 12 0 R` yazimi bir referanstir (dolayli boyut) ve
        // guvenilmez; bu yuzden negatif bakis ile elenir.
        const declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictSlice)
        let bodyEnd = tm.index
        if (declared && declared[1]) {
          const n = parseInt(declared[1], 10)
          if (Number.isFinite(n) && n >= 0 && bodyStart + n <= str.length) {
            bodyEnd = bodyStart + n
          } else {
            // Bildirilen boyut tutarsiz: satir sonu tahminine duser.
            if (bodyEnd > bodyStart && str.charCodeAt(bodyEnd - 1) === 10) bodyEnd -= 1
            if (bodyEnd > bodyStart && str.charCodeAt(bodyEnd - 1) === 13) bodyEnd -= 1
          }
        } else {
          if (bodyEnd > bodyStart && str.charCodeAt(bodyEnd - 1) === 10) bodyEnd -= 1
          if (bodyEnd > bodyStart && str.charCodeAt(bodyEnd - 1) === 13) bodyEnd -= 1
        }

        if (bodyEnd > bodyStart) {
          if (rawStreams.length < MAX_PDF_STREAMS) {
            rawStreams.push({
              objNum: currentObjNum,
              dictSlice,
              rawData: str.slice(bodyStart, bodyEnd),
              streamStart: bodyStart,
            })
          }
        }
        pendingStreamKeyword = -1
        continue
      }

      if (tm[1] !== undefined) {
        if (objects >= MAX_PDF_OBJECTS) break
        objects += 1
        currentObjNum = parseInt(tm[1], 10)
        currentObjStart = tm.index
        currentObjBodyStart = tm.index + token.length
        continue
      }

      if (token === 'endobj') {
        if (currentObjNum !== null && currentObjBodyStart >= 0 && tm.index > currentObjBodyStart && !objDict.has(currentObjNum)) {
          objDict.set(currentObjNum, str.slice(currentObjBodyStart, tm.index))
        }
        currentObjNum = null
        currentObjBodyStart = -1
        continue
      }

      if (token === 'stream') {
        if (currentObjNum !== null && currentObjBodyStart >= 0 && tm.index > currentObjBodyStart) {
          objDict.set(currentObjNum, str.slice(currentObjBodyStart, tm.index))
        }
        pendingStreamKeyword = tm.index
        insideStream = true
        continue
      }
    }
  }

  // 1) Tüm akışları aç. Ayrica nesne no -> acik akis haritasi kurulur
  //    (yazitip `/ToUnicode` referanslarini cozmek icin gerekli).
  const decompressedStreams: string[] = []
  /** nesne no -> cozulmus akis metni */
  const streamByObj = new Map<number, string>()

  for (const entry of rawStreams) {
    const rawData = entry.rawData
    const objNum = entry.objNum
    const dictSlice = entry.dictSlice

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

    // SIKISTIRMA FILTRESI TESPITI
    // -------------------------------
    // ONCEKI SURUM `dictSlice.includes('/Filter')` degerini "Flate"
    // sayiyordu. LZWDecode / ASCII85Decode / RunLengthDecode / DCTDecode
    // akislari da `inflate*`e veriliyor, acilamiyor ve DUSURULUYORDU;
    // sayfa metni kayboluyordu.
    const filterMatch = dictSlice.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/)
    const filterNames = filterMatch
      ? (filterMatch[1].match(/\/([A-Za-z0-9]+)/g) || []).map(f => f.slice(1).toLowerCase())
      : []
    const isFlate =
      filterNames.includes('flatedecode') ||
      filterNames.length === 0 && dictSlice.includes('/Flate')

    let decomp: Buffer | null = null

    if (isFlate) {
      // /Length DOLAYSIZ (inline) olmalidir. `/Length 12 0 R` yazimi bir
      // DOLAYSIZ BOYUT DEGIL, 12 numarali nesne referansidir; eski regex
      // `12`yi bayt sayisi saniyor ve 12 baytlik bir "akis" inflate
      // ediliyordu -> sayfa metni tamamen kayboluyordu.
      const lenMatch = dictSlice.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)
      const streamStart = entry.streamStart
      const streamLen = lenMatch ? Math.min(parseInt(lenMatch[1], 10), rawData.length) : rawData.length
      const streamBuf = buf.subarray(streamStart, streamStart + streamLen)

      /*
        ZIP BOMBA KORUMASI
        -------------------
        Sikistirilmis girdi kucuk, cozulen hali gigabayt olabilir: az
        sayida bayttan milyonlarca bayt ureten bir akis (zip bombasi)
        hem bellegi tuketir hem de Ana sureci ANINDA dondurur. O
        surecte donmus bir Electron hicbir sey cizemez ve kullanicinin
        "Belge Hazirlaniyor..." ekrani takilir kalir.

        Bu yuzden hem girdi hem cozulen cikti sinirlandirilir. Bir akis
        siniri asarsa ATLANIR (metin eksik olur) ama uygulama ayakta
        kalir; bu, yarim metin gostermekten cok daha iyidir.
      */
      if (streamLen > MAX_PDF_STREAM_BYTES) continue

      try {
        // \maxOutputLength\ verilmezse inflate sinirsiz buyuyebilir.
        decomp = zlib.inflateSync(streamBuf, { maxOutputLength: MAX_PDF_STREAM_BYTES })
      } catch {
        try {
          decomp = zlib.inflateRawSync(streamBuf, { maxOutputLength: MAX_PDF_STREAM_BYTES })
        } catch {
          // Açılmayan FlateDecode akışları ASLA ham ikili metin olarak eklenmez!
          decomp = null
        }
      }
    } else if (filterNames.length === 0) {
      // Sıkıştırılmamış akış: kontrol et, ikili değilse kabul et
      decomp = Buffer.from(rawData, 'latin1')
    } else if (filterNames.includes('ascii85decode') || filterNames.includes('asciihexdecode')) {
      // ASCII85 metin akışları (nadir ama gerçek)
      decomp = decodeAscii85(rawData)
    } else if (filterNames.includes('runlengthdecode')) {
      decomp = decodeRunLength(rawData)
    }
    // LZW / DCT / JPX / CCITT: metin akisi degildir, atlanir.

    if (decomp && decomp.length > 0) {
      const decodedStr = decomp.toString('latin1')
      // İkili binary çöp akışlarını filtrele:
      // Kontrol KARAKTERLERI oranina bakilir. Onceki surum `0x7F-0x9F`
      // araligini da "gecersiz" sayiyordu; CP1252'de kromlu tirnak
      // (0x91), tire (0x96) ve kenar tirnaklari bu araliktadir ve Turkce
      // belgeler nadiren tirnakla doludur. Sonuc: sayfa metni TAMAMEN
      // dusuyordu. Artik yalnizca gercek kontrol karakterleri sayilir.
      const sample = decodedStr.slice(0, 2000)
      const controlChars = (sample.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length
      if (sample.length === 0 || controlChars / sample.length < 0.02) {
        decompressedStreams.push(decodedStr)
        if (objNum !== null) streamByObj.set(objNum, decodedStr)
      }
    }
  }

  // -------------------------------------------------------------------------
  // YAZITIP COZUMLEMESI (per-font, global CMap DEGIL)
  // -------------------------------------------------------------------------
  // ONCEKI SURUM: tum ToUnicode haritalari tek bir `Map`e dolduruluyor ve
  // metin TEK bayt adimiyla cozuluyordu. Iki sonuc:
  //   1. Son yazan yazitip digerlerinin kodlarini EZIYORDU.
  //   2. `Identity-H` (2 bayt/karakter) metinler yanlis okunuyordu.
  const fontsByName = resolveFontResources(str, objDict, streamByObj)

  // -------------------------------------------------------------------------
  // YEDEK YOL: yazitip cozumlemesi basarisIZ oldugunda
  // -------------------------------------------------------------------------
  // REGRESYON KORUMASI
  // ------------------
  // Per-font cozumleme bazen hic sonuc vermez: yazitip sozlugu sıkistirilmis
  // nesne akisinda (object stream) saklanirsa `/Font << >>` duz metin
  // taramasinda gorunmez. Onceki surum bu durumda TUM ToUnicode haritalarini
  // birlestirip metne uyguluyordu; cok sayida PDF'i bu sayede okuyordu.
  //
  // Bu yuzden global harita KORUNUR. Per-font cozumleme onceliklidir, global
  // harita yalnizca yazitip bulunamayan metin icin devreye girer.
  //
  // Iki genislikte de anahtar uretilir (`41` ve `0041`) ve belgede
  // `/Identity-H` varsa 2 bayt, yoksa 1 bayt varsayilir. Boylece yazitip
  // cozumlemesi calissin ya da calismasin, metin HICBIR ZAMAN
  // daha kotu hale gelmez.
  const globalCMap = new Map<string, string>()
  for (const st of streamByObj.values()) {
    if (!st.includes('beginbfchar') && !st.includes('beginbfrange')) continue
    for (const [k, v] of parsePdfCMap(st, 1).entries()) globalCMap.set(k, v)
    for (const [k, v] of parsePdfCMap(st, 2).entries()) globalCMap.set(k, v)
  }
  const fallbackFont: PdfFontInfo = {
    widths: /\/Identity-[HV]\b/.test(str) ? 2 : 1,
    toUnicode: globalCMap,
    differences: new Map(),
  }

  // 2) SADECE BT ... ET metin bloklarını tara (Grafik ve PostScript operatörleri filtrelenir)
  const rawBlockGroups: string[][] = []

  for (const content of decompressedStreams) {
    const btRegex = /\bBT\b([\s\S]*?)\bET\b/g
    let btMatch: RegExpExecArray | null

    while ((btMatch = btRegex.exec(content)) !== null) {
      const textBlock = btMatch[1]
      const currentBlockLines: string[] = []

      // `/F1 12 Tf` operatörü AKTIF YAZITIPI belirtir.
      let activeFont: PdfFontInfo = fallbackFont
      const tokenizeWithFont = (source: string): string => {
        const out: string[] = []
        let lastX: number | null = null
        let lastY: number | null = null

        const pushSpaceIfNeeded = () => {
          if (out.length === 0) return
          const prev = out[out.length - 1]
          if (!prev || /[\s\n]$/.test(prev)) return
          out.push(' ')
        }

        const pushNewlineIfNeeded = () => {
          if (out.length === 0) return
          const prev = out[out.length - 1]
          if (prev === '\n') return
          out.push('\n')
        }

        // Metni operator sirasiyla tara:
        // 1: Tf (font degisimi)
        // 2: (...) Tj (literal metin)
        // 3: <...> Tj (hex metin)
        // 4: [...] TJ (metin + kerning dizisi)
        // 5,6: dx dy Td / TD (goreceli konum degisimi)
        // 7,8: a b c d tx ty Tm (mutlak metin matrisi)
        // 9: (...) ' (yeni satir + literal metin)
        // T*: yeni satir
        const opRe =
          /\/([A-Za-z0-9#._-]+)\s+[-\d.]+\s+Tf|\(([^\\)]*(?:\\[\s\S][^\\)]*)*)\)\s*Tj|<([0-9a-fA-F]+)>\s*Tj|\[((?:[^\]\\(]|\([^\\)]*(?:\\[\s\S][^\\)]*)*\)|\\[\s\S])*)\]\s*TJ|([-\d.]+)\s+([-\d.]+)\s+(?:Td|TD)\b|(?:[-\d.]+\s+){4}([-\d.]+)\s+([-\d.]+)\s+Tm\b|\(([^\\)]*(?:\\[\s\S][^\\)]*)*)\)\s*'|\bT\*\b/g
        let op: RegExpExecArray | null
        while ((op = opRe.exec(source)) !== null) {
          if (op[1] !== undefined) {
            const f = fontsByName.get(op[1])
            if (f) activeFont = f
            continue
          }
          if (op[2] !== undefined) {
            out.push(decodeWithFont(unescapePdfLiteral(op[2]), activeFont))
          } else if (op[3] !== undefined) {
            out.push(decodePdfHexString(op[3], activeFont))
          } else if (op[4] !== undefined) {
            // TJ dizisi: literal, hex ve negatif kerning bosluk sayilarini birlestir
            const inner = op[4]
            const tjToken = /\(([^\\)]*(?:\\[\s\S][^\\)]*)*)\)|<([0-9a-fA-F]+)>|(-?\d+(?:\.\d+)?)/g
            let t: RegExpExecArray | null
            while ((t = tjToken.exec(inner)) !== null) {
              if (t[1] !== undefined) {
                out.push(decodeWithFont(unescapePdfLiteral(t[1]), activeFont))
              } else if (t[2] !== undefined) {
                out.push(decodePdfHexString(t[2], activeFont))
              } else if (t[3] !== undefined) {
                const kern = parseFloat(t[3])
                // PDF TJ icinde genis negatif kerning (<= -220) kelime boslugunu temsil eder;
                // optik glif sikilastirmalari (-40..-150) asla kelime boslugu sayilmaz
                if (Number.isFinite(kern) && kern <= -220) {
                  pushSpaceIfNeeded()
                }
              }
            }
          } else if (op[5] !== undefined && op[6] !== undefined) {
            const dx = parseFloat(op[5])
            const dy = parseFloat(op[6])
            if (Number.isFinite(dy) && Math.abs(dy) > 1.2) {
              pushNewlineIfNeeded()
              if (lastY !== null) lastY += dy
              if (lastX !== null && Number.isFinite(dx)) lastX += dx
            } else if (Number.isFinite(dx) && dx >= 14.0) {
              pushSpaceIfNeeded()
              if (lastX !== null) lastX += dx
            }
          } else if (op[7] !== undefined && op[8] !== undefined) {
            const tx = parseFloat(op[7])
            const ty = parseFloat(op[8])
            if (Number.isFinite(ty) && lastY !== null && Math.abs(ty - lastY) > 1.5) {
              pushNewlineIfNeeded()
            } else if (Number.isFinite(tx) && lastX !== null && tx - lastX >= 18.0) {
              pushSpaceIfNeeded()
            }
            if (Number.isFinite(tx)) lastX = tx
            if (Number.isFinite(ty)) lastY = ty
          } else if (op[9] !== undefined) {
            pushNewlineIfNeeded()
            out.push(decodeWithFont(unescapePdfLiteral(op[9]), activeFont))
          } else {
            // T* -> satir kirilmasi
            pushNewlineIfNeeded()
          }
        }
        return out.join('')
      }

      const blockText = tokenizeWithFont(textBlock)
      for (const rawLine of blockText.split('\n')) {
        const withoutOps = rawLine.replace(/\b(?:TJ|ET|BT|Tm|Tf|cm|q|Q|rg|RG|re|W\*)\b/g, '')
        const t = repairPdfGluedWords(repairPdfSpacedText(scrubPdfText(withoutOps))).trim()
        if (t.length > 0 && !/^[\d\s.\-+,#()\[\];]+$/.test(t)) {
          currentBlockLines.push(t)
        }
      }

      if (currentBlockLines.length > 0) {
        rawBlockGroups.push(currentBlockLines)
      }
    }
  }

  // Paragraf, baslik ve madde isaretlerini koruyarak satirlari yapilandir
  const cleaned: string[] = []
  const isBulletOrNumbered = (line: string) =>
    /^(?:[\u2022\u2023\u25E6•▪◦▸►*\-]|\d+[.)]|\([a-zA-Z0-9]+\)|[a-zA-Z]\))\s+/.test(line) ||
    /^\u2022/.test(line)
  const isHeadingLike = (line: string) =>
    /^(?:\d+\.\s*Hafta|Hafta\s*\d+|Bölüm\s*\d+|Ünite\s*\d+|Konu\s*:|Amaç\s*:|Hedef\s*:|Özet\s*:|Giriş\b|Sonuç\b|Kaynakça\b|Uygulama\s+Projesi)/i.test(line) ||
    (line.length <= 85 && /:$/.test(line)) ||
    (line.length <= 70 && /^[A-ZÇĞİÖŞÜ0-9]/.test(line) && !/[.;,!?\-]$/.test(line))

  for (const group of rawBlockGroups) {
    let currentPara = ''
    for (const line of group) {
      const normalizedLine = line.startsWith('\u2022') && !line.startsWith('\u2022 ')
        ? `\u2022 ${line.slice(1).trim()}`
        : line

      if (!currentPara) {
        currentPara = normalizedLine
        continue
      }

      if (isBulletOrNumbered(normalizedLine) || isHeadingLike(normalizedLine) || isHeadingLike(currentPara)) {
        cleaned.push(currentPara.trim())
        currentPara = normalizedLine
        continue
      }

      // Tire ile bolunmus satir sonu kelimesini birlestir: "uygula-" + "ması" -> "uygulaması"
      if (/[a-zA-ZçğıöşüÇĞİÖŞÜ]-$/.test(currentPara) && /^[a-zçğıöşü]/.test(normalizedLine)) {
        currentPara = `${currentPara.slice(0, -1)}${normalizedLine}`
        continue
      }

      // Cumle bitmisse ve yeni satir buyuk harfle basliyorsa yeni paragraf/satir olabilir;
      // ancak ayni paragrafin devami da olabilir — eger onceki satir kisa (< 65) ise ayri tut
      if (/[.!?…:]$/.test(currentPara) && currentPara.length < 65) {
        cleaned.push(currentPara.trim())
        currentPara = normalizedLine
      } else {
        currentPara = `${currentPara} ${normalizedLine}`
      }
    }
    if (currentPara.trim().length > 0) {
      cleaned.push(currentPara.trim())
    }
  }

  if (cleaned.length > 0) {
    return cleaned.join('\n\n').slice(0, 80_000)
  }

  // Güvenli yedek yol: SADECE gerçek anlamlı metin içeren satırları kabul et.
  // ONCEKI SURUMUN HATASI: `!/[\x7F-\x9F]/` kontrolü CP1252'de yazan
  // (kromlu tirnak, tire, uc nokta) satirlari ve kontrol baytlarini
  // oldugu gibi reddediyordu. Artik once metin normalize/scrub ediliyor,
  // sonra okunabilirlik orani olculuyor.
  for (const st of decompressedStreams) {
    const fallbackMatches = st.match(/\(([^)]{4,})\)/g)
    if (fallbackMatches) {
      for (const fm of fallbackMatches) {
        const raw = fm.slice(1, -1)
        if (/[<>{}\\]/.test(raw)) continue
        let clean = scrubPdfText(raw.replace(/\\(.)/g, '$1'))
        if (clean.length < 4) continue
        // Anlamlı metin oranı: harf, rakam, noktalama ve boşluk.
        // Tirnak/dilek karakterleri de "okunabilir" sayilir.
        const readableChars = (
          clean.match(/[a-zA-ZçğıöşüÇĞİÖŞÜâîû0-9\s.,;:!?'"()\-\u2013\u2014\u2018\u2019\u201C\u201D\u00AB\u00BB\u2022\u2026]/g) || []
        ).length
        if (readableChars / clean.length >= 0.8) cleaned.push(clean)
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
        const buf = this.storageService.readCasFile(cached.absolutePath, cached.entry.sha256)
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

        // 4) Excel calisma kitaplari (XLSX/XLSM)
        //
        // ONCEKI SURUMDE YOKTU: XLSX bir ZIP oldugu icin "metin dosyasi"
        // kontrolune dustu ve modele sifreli ZIP baytlari gonderiliyordu.
        if (
          mime.includes('spreadsheetml') ||
          mime === 'application/vnd.ms-excel' ||
          title.endsWith('.xlsx') ||
          title.endsWith('.xlsm') ||
          title.endsWith('.xltx')
        ) {
          const sheets = extractXlsxSheets(buf)
          if (sheets.length === 0) {
            return {
              requiresApproval: false,
              result: `[${cached.entry.title}] Excel dosyasi acildi ancak icinde okunabilir sayfa bulunamadi (dosya bozuk veya sifreli olabilir).`,
            }
          }
          const MAX_ROWS = 200
          const rendered = sheets.slice(0, 8).map(sheet => {
            const rows = sheet.rows.slice(0, MAX_ROWS)
            const table = rows.map(r => `| ${r.join(' | ')} |`).join('\n')
            return `### Sayfa: ${sheet.name} (${rows.length}/${sheet.rows.length} satir)\n${table}`
          })
          const more = sheets.length > 8 ? `\n\n(Toplam ${sheets.length} sayfanin ilk 8'i gösterildi.)` : ''
          return {
            requiresApproval: false,
            result: `[${cached.entry.title} - Excel Verisi (${sheets.length} sayfa)]:\n${rendered.join('\n\n')}${more}`,
          }
        }

        // 5) Tablolar (CSV / TSV)
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

        // 6) Gorseller
        //
        // ONCEKI SURUMDE YOKTU: gorsel dosya "metin dosyasi" kontrolune
        // dustu, UTF-8 olarak okunup modele BOS/GARIP metin gonderiliyordu.
        // Artik format ve OLCULER okunur, modele ne yapabilecegi acikca
        // soylenir. Gorseli GERCEKTEN inceletmek icin sohbete eklenmesi
        // (vision modeli) ya da OCR gerekir.
        if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|avif)$/i.test(title)) {
          const dims = readImageDimensions(buf)
          const kb = Math.round(buf.length / 1024)
          const info = dims ? `${dims.width}x${dims.height} piksel` : 'boyut bilgisi okunamadi'
          return {
            requiresApproval: false,
            result:
              `[${cached.entry.title}] Gorsel dosyasi: ${mime || 'bilinmeyen'} · ${info} · ${kb} KB.\n` +
              'Bu bir gorsel oldugu icin metin icerigi YOKTUR. Icerigi incelemek icin ya ' +
              '(1) dosyayi sohbete ekleyip gorum destekleyen (vision) bir model secin, ya da ' +
              '(2) gorseli once PDF/Word belgesine cevirip o dosyayi paylasin.',
          }
        }

        // 7) Kod ve Metin Dosyaları
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
