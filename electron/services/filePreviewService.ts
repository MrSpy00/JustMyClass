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
 * Bir OOXML belgesinden `<w:p>` ve `<w:tbl>` bloklarını DENGELI olarak
 * ayırır.
 *
 * ONCEKI SURUMUN HATASI: `/<(w:p|w:tbl)(?: [^>]*)?>([\s\S]*?)<\/\1>/g`
 * ic ice tablolarda (`<w:tbl>` bir `<w:tc>` icinde) dis etiketi ilk
 * `</w:tbl>` ile eslesiyor, dis tablonun kalan satirlari tasmaliyor ve
 * sonra ikinci kez tarandigi icin metin IKI KEZ yaziliyordu.
 * Ayrica `<w:tab/>` ve `<w:br/>` KENDINI KAPATAN etiketlerdir; eski regex
 * `</w:tab>` bekledigi icin hicbir sekilde eslesmiyor ve TUM sekme/satir
 * kirilmalari sessizce yok oluyordu.
 */
export type OoxmlBlock = { tag: string; inner: string; attrs: string }

export function extractOoxmlBlocks(xml: string, tags: string[]): OoxmlBlock[] {
  const out: OoxmlBlock[] = []
  // ONEMLI: ozellik `[^>]*` DEGIL `[^>]*?` (tembel/lazy) OLMALI.
  //
  // Acgre (greedy) desen, kendini kapatan etiketlerde sondaki `/` karakterini
  // YUTUYORDU: `<sheet name="Notlar" r:id="rId1"/>` icin `(\\s[^>]*)?` tum
  // ozellik listesini VE `/` karakterini aliyor, `(/?)` bos kaliyor ve etiket
  // "kendini kapatan" sayilmadan kapatma etiketi araniyordu. Kapama etiketi
  // olmadigi icin fonksiyon `break` ile BOS DIZI donuyordu.
  //
  // Sonuc: Excel calisma kitaplarinda sayfa ADLARI (`<sheet name=...>`) ve
  // paket iliskileri (`<Relationship .../>`) HIC okunamiyordu; kullanici
  // "Notlar" yerine "sheet1" goruyordu.
  const openRe = new RegExp(`<(${tags.join('|')})(\\s[^>]*?)?(/?)>`, 'g')
  let m: RegExpExecArray | null
  while ((m = openRe.exec(xml)) !== null) {
    const tag = m[1]
    const selfClosing = m[3] === '/'
    const startInner = m.index + m[0].length
    if (selfClosing) {
      // Kendini kapatan etiketlerde BILGI OZELLIKLERDE (attributes) ve
      // govde yoktur. `inner` alanina ozellik metnini koyuyoruz; boylece
      // `<sheet name="Notlar" r:id="rId1"/>`, `<Relationship Id=... />` ve
      // `<p:sldId r:id=.../>` gibi etiketler de okunabiliyor.
      // (Daha once `inner` BOS donuyordu; bu yuzden Excel sayfa adi ve
      // PowerPoint slayt sirasi okunamadan yedek yola dusuyordu.)
      out.push({ tag, attrs: m[2] ?? '', inner: m[2] ?? '' })
      continue
    }
    // Dengeli kapanis etiketini bul (ic ice ayni etiketler varsayiminda).
    let depth = 1
    let p = startInner
    const scanRe = new RegExp(`<(/?)${tag}(?:\\s[^>]*?)?(/?)>`, 'g')
    scanRe.lastIndex = startInner
    let found = -1
    let s: RegExpExecArray | null
    while ((s = scanRe.exec(xml)) !== null) {
      p = s.index
      if (s[2] === '/') continue // kendini kapatan
      if (s[1] === '/') {
        depth--
        if (depth === 0) {
          found = s.index
          break
        }
      } else {
        depth++
      }
    }
    if (found === -1) break
    // Kendini KAPATAN OLMAYAN etiketlerde govde `inner`, acilis etiketinin
    // ozellikleri `attrs` alanindadir. Onceki surumde `<c r="A1" t="s"><v>0</v></c>`
    // gibi hucrelerde `r=` / `t=` ozellikleri HIC BIR YERDE gorunmedigi icin
    // sutun konumu ve hucre tipi (shared string mi) kayboluyor; hucreler ham
    // indeks (`0`, `1`) olarak yaziliyordu.
    out.push({ tag, attrs: m[2] ?? '', inner: xml.slice(startInner, found) })
    openRe.lastIndex = found
  }
  return out
}

/**
 * Bir `<w:r>` (run) gövdesinden düz metin üretir.
 * KENDINI KAPATAN `<w:tab/>`, `<w:br/>`, `<w:cr/>` ve `<w:noBreakHyphen/>`
 * etiketlerini de isler.
 */
function runsToText(runsXml: string): string {
  let out = ''
  const tokenRe = /<w:(t|tab|br|cr|noBreakHyphen|sym)(?:\s[^>]*)?\/?>/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(runsXml)) !== null) {
    const tag = m[1]
    if (tag === 't') {
      // <w:t xml:space="preserve"> metin </w:t>
      const closeIdx = runsXml.indexOf('</w:t>', m.index)
      if (closeIdx === -1) continue
      const raw = runsXml.slice(m.index + m[0].length, closeIdx)
      // Kapanış etiketinin konumu tarayıcıyı ilerletmeli.
      tokenRe.lastIndex = closeIdx + 6
      out += decodeXmlEntities(raw.replace(/<[^>]+>/g, ''))
    } else if (tag === 'tab') {
      out += '    '
      tokenRe.lastIndex = m.index + m[0].length
    } else if (tag === 'br' || tag === 'cr') {
      out += '\n'
      tokenRe.lastIndex = m.index + m[0].length
    } else if (tag === 'noBreakHyphen') {
      out += '-'
      tokenRe.lastIndex = m.index + m[0].length
    }
  }
  return out
}

/** DOCX/ODT: bir XML gövdesinden okunabilir paragraflar üretir. */
function ooxmlBlocksToParagraphs(xml: string, paragraphTag: string, runTag: string): string[] {
  const paragraphs: string[] = []

  const cellToText = (cellXml: string): string =>
    ooxmlBlocksToParagraphs(cellXml, paragraphTag, runTag)
      .map(p => p.replace(/^[•\-*]\s*/, '').trim())
      .filter(Boolean)
      .join(' ')

  for (const block of extractOoxmlBlocks(xml, [paragraphTag, 'w:tbl', 'table:table'])) {
    if (block.tag === paragraphTag) {
      const isBullet = block.inner.includes('<w:numPr>') || block.inner.includes('<text:list>')
      const text = runsToText(block.inner).replace(/[ \t]+/g, ' ').trim()
      if (text.length > 0) paragraphs.push(isBullet ? `• ${text}` : text)
      continue
    }

    // Tablo -> markdown benzeri satirlar
    const rows: string[] = []
    for (const row of extractOoxmlBlocks(block.inner, ['w:tr', 'table:table-row'])) {
      if (row.tag !== 'w:tr') continue
      const cells = extractOoxmlBlocks(row.inner, ['w:tc', 'table:table-cell'])
        .map(c => cellToText(c.inner))
        .filter(c => c.length > 0)
      if (cells.length > 0) rows.push(`| ${cells.join(' | ')} |`)
    }
    if (rows.length > 0) {
      paragraphs.push(rows.join('\n'))
    }
  }

  return paragraphs
}

/**
 * DOCX icindeki paragraflari ve tablolari ayiklar.
 * Hem `word/document.xml` (DOCX) hem `content.xml` (ODT) desteklenir.
 */
export function extractDocxParagraphs(buf: Buffer): string[] {
  try {
    const entries = extractZipEntries(buf)
    const docXml = entries.get('word/document.xml')
    if (docXml) {
      return ooxmlBlocksToParagraphs(docXml.toString('utf8'), 'w:p', 'w:r')
    }
    // OpenDocument Text (ODT): `content.xml`
    const odt = entries.get('content.xml')
    if (odt) {
      return ooxmlBlocksToParagraphs(odt.toString('utf8'), 'text:p', 'text:span')
    }
    return []
  } catch {
    return []
  }
}

/** XLSX çalışma kitaplarını okur (sharedStrings + sayfa hücreleri). */
export function extractXlsxSheets(buf: Buffer): Array<{ name: string; rows: string[][] }> {
  const entries = extractZipEntries(buf)
  if (entries.size === 0) return []

  // Ortak metinler
  const shared: string[] = []
  const sharedXml = entries.get('xl/sharedStrings.xml')
  if (sharedXml) {
    const sx = sharedXml.toString('utf8')
    for (const si of extractOoxmlBlocks(sx, ['si'])) {
      shared.push(
        extractOoxmlBlocks(si.inner, ['t'])
          .map(t => decodeXmlEntities(t.inner))
          .join('')
          .trim(),
      )
    }
  }

  // Sayfa adlari (workbook.xml + rels)
  const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8') ?? ''
  const workbookRels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  const relTargets = new Map<string, string>()
  for (const rel of extractOoxmlBlocks(workbookRels, ['Relationship'])) {
    const id = /\bId="([^"]+)"/.exec(rel.attrs)?.[1]
    const target = /\bTarget="([^"]+)"/.exec(rel.attrs)?.[1]
    if (id && target) relTargets.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\.\//, ''))
  }

  const sheetDefs: Array<{ name: string; file: string }> = []
  for (const sheet of extractOoxmlBlocks(workbookXml, ['sheet'])) {
    const name = /\bname="([^"]*)"/.exec(sheet.attrs)?.[1] ?? 'Sayfa'
    const rid = /r:id="([^"]+)"/.exec(sheet.attrs)?.[1]
    const target = rid ? relTargets.get(rid) : undefined
    if (target) sheetDefs.push({ name: decodeXmlEntities(name), file: `xl/${target}` })
  }
  if (sheetDefs.length === 0) {
    // workbook.xml yoksa dosya adindan sirala.
    for (const [key] of entries) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(key)) {
        sheetDefs.push({ name: key.replace(/^.*\//, '').replace(/\.xml$/i, ''), file: key })
      }
    }
  }

  const columnIndex = (ref: string): number => {
    const letters = (/^[A-Z]+/.exec(ref.toUpperCase()) || [''])[0]
    let n = 0
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
    return Math.max(0, n - 1)
  }

  const sheets: Array<{ name: string; rows: string[][] }> = []
  for (const def of sheetDefs.slice(0, 20)) {
    const xml = entries.get(def.file)
    if (!xml) continue
    const sheetXml = xml.toString('utf8')
    const rows: string[][] = []
    for (const row of extractOoxmlBlocks(sheetXml, ['row'])) {
      const cells: string[] = []
      for (const cell of extractOoxmlBlocks(row.inner, ['c'])) {
        const ref = /\br="([A-Z]+\d+)"/i.exec(cell.attrs)?.[1] ?? ''
        const type = /\bt="([^"]+)"/.exec(cell.attrs)?.[1] ?? 'n'
        let value = ''
        const raw = extractOoxmlBlocks(cell.inner, ['v', 'is'])
          .map(v => v.inner)
          .join('')
        if (type === 's') {
          const idx = parseInt(raw.trim(), 10)
          value = Number.isFinite(idx) ? (shared[idx] ?? '') : ''
        } else if (type === 'inlineStr') {
          value = extractOoxmlBlocks(cell.inner, ['t'])
            .map(t => t.inner)
            .join('')
        } else {
          value = raw.trim()
        }
        value = decodeXmlEntities(value).trim()
        const col = ref ? columnIndex(ref) : cells.length
        while (cells.length < col) cells.push('')
        cells[col] = value
      }
      // Tamamen bos satirlari at
      if (cells.some(c => c.length > 0)) rows.push(cells)
      if (rows.length >= 2000) break
    }
    if (rows.length > 0) sheets.push({ name: def.name, rows })
  }
  return sheets
}

/**
 * PPTX slaytlarini ayiklar.
 *
 * DUZELTMELER
 * -----------
 * 1) `_rels` dosyalari SAHTE SLAYT olarak ekleniyordu.
 *    Eski yedek regex'i `/ppt\/slides\/.*\.xml/i` (baslangicsiz) `_rels/`
 *    klasorunu de eslesiyordu; her slayt icin bir "bogaz slayt" uretiliyor
 *    ve kullanici "N slayt" yazisinda 2N sayi goruyordu.
 * 2) Slayt sirasi `ppt/presentation.xml` + `_rels` ILE alinmali; dosya
 *    numarasina gore siralamak yeniden duzenlenmis sunumlarda yanlis
 *    sonuc verir.
 * 3) Baslik, `type="title"` / `type="ctrTitle"` tasarim yerine konmadan
 *    tahmin ediliyordu; dekoratif sekiller basligi caliyordu.
 * 4) Tablo hucresi metni IKI KEZ yaziliyordu (`<a:p>` taramasi + `<a:tc>`
 *    taramasi).
 */
export function extractPptxSlides(buf: Buffer): Array<{ slideNumber: number; title?: string; bullets: string[] }> {
  const slides: Array<{ slideNumber: number; title?: string; bullets: string[] }> = []
  try {
    const entries = extractZipEntries(buf)
    if (entries.size === 0) return slides

    // ---- ODP (OpenDocument Presentation) --------------------------------
    const odp = entries.get('content.xml')
    if (!hasPptxSlides(entries) && odp) {
      const contentXml = odp.toString('utf8')
      let pageIdx = 1
      for (const page of extractOoxmlBlocks(contentXml, ['draw:page'])) {
        const lines = extractOoxmlBlocks(page.inner, ['text:p'])
          .map(p => decodeXmlEntities(p.inner.replace(/<[^>]+>/g, '')).trim())
          .filter(Boolean)
        if (lines.length === 0) continue
        slides.push({ slideNumber: pageIdx++, title: lines[0], bullets: lines.slice(1) })
      }
      if (slides.length > 0) return slides
    }

    // ---- Slayt dosyalarini gercek sirayla topla -------------------------
    const relTargets = new Map<string, string>()
    const presentationRels = entries.get('ppt/_rels/presentation.xml.rels')
    if (presentationRels) {
      const rx = presentationRels.toString('utf8')
      for (const rel of extractOoxmlBlocks(rx, ['Relationship'])) {
        const id = /\bId="([^"]+)"/.exec(rel.attrs)?.[1]
        const target = /\bTarget="([^"]+)"/.exec(rel.attrs)?.[1]
        if (id && target) relTargets.set(id, target.replace(/^\/?ppt\//, '').replace(/^\.\.\//, ''))
      }
    }

    const orderedPaths: string[] = []
    const presentationXml = entries.get('ppt/presentation.xml')?.toString('utf8')
    if (presentationXml) {
      // <p:sldIdLst><p:sldId r:id="rId2"/>...</p:sldIdLst>
      for (const sldId of extractOoxmlBlocks(presentationXml, ['p:sldId'])) {
        const rid = /r:id="([^"]+)"/.exec(sldId.attrs)?.[1]
        const target = rid ? relTargets.get(rid) : undefined
        if (target) orderedPaths.push(`ppt/${target}`)
      }
    }

    const numericPaths: Array<{ num: number; path: string }> = []
    for (const key of entries.keys()) {
      const m = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(key)
      if (m) numericPaths.push({ num: parseInt(m[1], 10), path: key })
    }
    numericPaths.sort((a, b) => a.num - b.num)

    const paths: string[] = []
    const seen = new Set<string>()
    for (const p of orderedPaths) {
      if (entries.has(p) && !seen.has(p)) {
        seen.add(p)
        paths.push(p)
      }
    }
    for (const { path } of numericPaths) {
      if (!seen.has(path)) {
        seen.add(path)
        paths.push(path)
      }
    }

    for (let i = 0; i < paths.length; i++) {
      const slideXml = entries.get(paths[i])!.toString('utf8')
      const slideIndexNum = i + 1

      const titleShapes: string[] = []
      const bodyParagraphs: string[] = []

      // <p:sp> sekillerini tara
      for (const shape of extractOoxmlBlocks(slideXml, ['p:sp'])) {
        const phType = /<p:ph[^>]*\btype="([^"]+)"/.exec(shape.inner)?.[1] ?? ''
        const lines = extractOoxmlBlocks(shape.inner, ['a:p'])
          .map(p =>
            decodeXmlEntities(
              extractOoxmlBlocks(p.inner, ['a:t'])
                .map(t => t.inner)
                .join(''),
            ).trim(),
          )
          .filter(Boolean)

        if (lines.length === 0) continue
        if (phType === 'title' || phType === 'ctrTitle') titleShapes.push(...lines)
        else if (phType === 'ftr' || phType === 'sldNum' || phType === 'dt') continue
        else bodyParagraphs.push(...lines)
      }

      // Tablolar: yalnizca sekil disinda kalan hucre metinleri (yinelenmeyi onle)
      const tableCells: string[] = []
      for (const graphic of extractOoxmlBlocks(slideXml, ['a:tbl'])) {
        for (const cell of extractOoxmlBlocks(graphic.inner, ['a:tc'])) {
          const text = extractOoxmlBlocks(cell.inner, ['a:p'])
            .map(p =>
              decodeXmlEntities(
                extractOoxmlBlocks(p.inner, ['a:t'])
                  .map(t => t.inner)
                  .join(''),
              ).trim(),
            )
            .filter(Boolean)
            .join(' ')
          if (text) tableCells.push(text)
        }
      }

      let title: string
      let bullets: string[]

      if (titleShapes.length > 0) {
        title = titleShapes[0]
        bullets = [...titleShapes.slice(1), ...bodyParagraphs, ...tableCells]
      } else if (bodyParagraphs.length > 0) {
        title = bodyParagraphs[0]
        bullets = [...bodyParagraphs.slice(1), ...tableCells]
      } else if (tableCells.length > 0) {
        title = `Slayt ${slideIndexNum}`
        bullets = [...tableCells]
      } else {
        title = `Slayt ${slideIndexNum}`
        bullets = [
          '(Bu slayt yalnızca görsel, şema veya grafik içeriyor; metin katmanı yok.)',
        ]
      }

      slides.push({ slideNumber: slideIndexNum, title, bullets })
    }
  } catch {
    /* fallback */
  }
  return slides
}

export function hasPptxSlides(entries: Map<string, Buffer>): boolean {
  for (const key of entries.keys()) {
    if (/^ppt\/slides\/slide\d+\.xml$/i.test(key)) return true
  }
  return false
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

    // Word / DOCX / ODT
    if (ext === '.docx' || mime.includes('wordprocessingml') || ext === '.odt' || ext === '.doc') {
      const paragraphs = extractDocxParagraphs(buf)
      const text = paragraphs.length > 0 ? paragraphs.join('\n\n') : extractTextFromDocx(buf)
      const finalText = text.trim()
      return {
        fileId,
        title,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes,
        kind: 'docx',
        // BOS METIN HATASI: Onceki surum
        //   paragraphs: paragraphs.length > 0 ? paragraphs : text.split('\n\n')
        // yaziyordu. Bos metinde `''.split('\n\n')` === `['']` oldugu icin
        // `paragraphs.length === 1` oluyor ve arayuz bos sayfada tek bir
        // bos paragraf gosterip "İçerik bulunamadı" yedeğine hic dusmuyordu.
        text: finalText,
        paragraphs: paragraphs.filter(p => p.trim().length > 0),
        localPath: cached.absolutePath,
      }
    }

    // Excel / XLSX / ODS
    if (
      ext === '.xlsx' ||
      ext === '.xlsm' ||
      ext === '.ods' ||
      mime.includes('spreadsheetml') ||
      mime.includes('ms-excel')
    ) {
      const sheets = extractXlsxSheets(buf)
      const text = sheets
        .map(s => `[Sayfa: ${s.name}]\n${s.rows.map(r => r.join('\t')).join('\n')}`)
        .join('\n\n')
      const tableData = sheets.length > 0 ? sheets[0].rows : []
      return {
        fileId,
        title,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes,
        kind: 'xlsx',
        text: text.trim(),
        tableData,
        sheetNames: sheets.map(s => s.name),
        lineCount: text.split('\n').length,
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
