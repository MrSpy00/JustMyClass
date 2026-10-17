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
export type OoxmlBlock = {
  tag: string
  inner: string
  attrs: string
  /** Blokun acilis etiketinin kaynak XML icindeki indeksi. */
  start: number
  /** Blok govdesinin bittigi indeks (kapanis etiketinin basi). */
  innerEnd: number
  /** Blokun bittigi indeks (kapanis etiketi dahil). */
  end: number
}

/** Etiket adini duzenli ifade icinde guvenli kullanilacak sekilde kacirir. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
  const alt = tags.map(escapeRegExp).join('|')
  const openRe = new RegExp(`<(${alt})(\\s[^>]*?)?(/?)>`, 'g')
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
      out.push({
        tag,
        attrs: m[2] ?? '',
        inner: m[2] ?? '',
        start: m.index,
        innerEnd: m.index,
        end: m.index + m[0].length,
      })
      continue
    }
    // Dengeli kapanis etiketini bul (ic ice ayni etiketler varsayiminda).
    //
    // KRITIK HATA DUZELTMESI — ETIKET ALTERNATIFI GRUPLANMAMISTI:
    // eski desen su halde kuruluyordu:
    //   `<(/?)w:tr|table:table-row(?:\s[^>]*?)?(/?)>`
    // Bu, `|` operatorunun o oncelik/arka plan grubu DISINDA kaldigi bir
    // desendir. Iki sonucu var:
    //   1) Ilk dal (`<w:tr`) sonuna `>` zorlamadan biter, dolayisiyla
    //      `<w:trPr>` ve `<w:tcW .../>` gibi ALT etiketler de "acilan w:tr /
    //      w:tc" sayiliyordu. Kendini kapatan `<w:tcW/>` kapanis etiketi
    //      OLMADIGI icin derinlik kalici olarak +1 bozuluyor ve hucre, kendi
    //      `</w:tc>` etiketinden sonra ikinci hucreyi de YUTUYORDU —
    //      "cok satirlı tablo tek satira cokuyor, hucreler birbirine giriyor"
    //      belirtisinin AYNIK kaynagi.
    //   2) Ikinci dal `<` olmadan calistigi icin duz metin icindeki
    //      `table:table-row>` dizisini de etiket saniyordu.
    // Duzeltme: etiket listesi `(?:...)` icine alindi ve grup numaralari
    // korundu (1 = slash, 2 = kendini kapatan slash).
    let depth = 1
    const scanRe = new RegExp(`<(/?)(?:${alt})(?:\\s[^>]*?)?(/?)>`, 'g')
    scanRe.lastIndex = startInner
    let found = -1
    let closeLen = 0
    let s: RegExpExecArray | null
    while ((s = scanRe.exec(xml)) !== null) {
      if (s[2] === '/') continue // kendini kapatan
      if (s[1] === '/') {
        depth--
        if (depth === 0) {
          found = s.index
          closeLen = s[0].length
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
    out.push({
      tag,
      attrs: m[2] ?? '',
      inner: xml.slice(startInner, found),
      start: m.index,
      innerEnd: found,
      end: found + closeLen,
    })
    openRe.lastIndex = found + closeLen
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Paket iliskileri (`.rels`) ve kopru hedefleri
 * ------------------------------------------------------------------ */

export type RelationshipMap = Map<string, string>

/**
 * `_rels/*.rels` govdesinden `Id -> Target` eslesmesini cikarir.
 * Hedef degerler cozulmus (absolute) adres olarak saklanir.
 */
export function parseRelationships(xml: string, partDir: string): RelationshipMap {
  const map: RelationshipMap = new Map()
  if (!xml) return map
  for (const rel of extractOoxmlBlocks(xml, ['Relationship'])) {
    const id = /\bId="([^"]+)"/.exec(rel.attrs)?.[1]
    const target = /\bTarget="([^"]+)"/.exec(rel.attrs)?.[1]
    if (id && target) map.set(id, resolveRelationshipTarget(target, partDir))
  }
  return map
}

/**
 * Bir `Target` degerini mutlak adrese cevirir.
 * `http(s):` / `mailto:` gibi semali adresler oldugu gibi birakilir;
 * `../media/image.png` gibi paket-ici gosterimler `word/media/image.png`
 * bicimine cozulur. Yuzde kodlamasi guvenle cozulur.
 */
function resolveRelationshipTarget(target: string, partDir: string): string {
  const raw = decodeXmlEntities(target).trim()
  if (!raw) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw
  if (raw.startsWith('#')) return '' // dahili sapma; disarida acilamaz
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    /* bozuk yuzde kodlamasi: ham haliyle devam */
  }
  const base = partDir ? partDir.replace(/\/*$/, '/') : ''
  const stack: string[] = []
  for (const seg of (base + decoded).split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      stack.pop()
      continue
    }
    stack.push(seg)
  }
  return stack.join('/')
}

/** Bir adresin arayuzde `openExternalUrl` ile acilmaya uygun olup olmadigi. */
function isExternallyOpenable(url: string | undefined): url is string {
  if (!url) return false
  return /^(https?:|mailto:)/i.test(url.trim())
}

/**
 * Bir `<w:r>` (run) govdesinden duz metin uretir.
 * KENDINI KAPATAN `<w:tab/>`, `<w:br/>`, `<w:cr/>` ve `<w:noBreakHyphen/>`
 * etiketlerini de isler.
 *
 * `prefix` ile ODT (`text:span`, `text:line-break`) de desteklenir.
 */
function runsToText(runsXml: string, prefix = 'w'): string {
  let out = ''
  const p = escapeRegExp(prefix)
  const tokenRe = new RegExp(`<${p}:(t|span|tab|br|cr|line-break|noBreakHyphen)(?:\\s[^>]*)?\\/?>`, 'g')
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(runsXml)) !== null) {
    const tag = m[1]
    if (tag === 't' || tag === 'span') {
      // <w:t xml:space="preserve"> metin </w:t>
      const closing = `</${prefix}:${tag}>`
      const closeIdx = runsXml.indexOf(closing, m.index)
      if (closeIdx === -1) continue
      const raw = runsXml.slice(m.index + m[0].length, closeIdx)
      // Kapanis etiketinin konumu tarayiciyi ilerletmeli.
      tokenRe.lastIndex = closeIdx + closing.length
      out += decodeXmlEntities(raw.replace(/<[^>]+>/g, ''))
    } else if (tag === 'tab') {
      out += '    '
      tokenRe.lastIndex = m.index + m[0].length
    } else if (tag === 'br' || tag === 'cr' || tag === 'line-break') {
      out += '\n'
      tokenRe.lastIndex = m.index + m[0].length
    } else if (tag === 'noBreakHyphen') {
      out += '-'
      tokenRe.lastIndex = m.index + m[0].length
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * DOCX: yapilandirilmis bloklar (paragraf + tablo) ve kopro hedefleri
 * ------------------------------------------------------------------ */

/** Duz metin paragrafi. `w:hyperlink r:id` ile eslesen harici adresi tasir. */
export interface DocxParagraphBlock {
  type: 'paragraph'
  text: string
  /** Madde imli (`<w:numPr>`) mi? */
  bullet: boolean
  /** Kopyrunun harici hedefi (yoksa `undefined`). */
  url?: string
}

/**
 * Tablo. Her `<w:tr>` AYRI bir satirdir; her `<w:tc>` o satirda ayri bir
 * hueredir. Bos huereler KORUNUR ve tum satirlar ayni sutun sayisina
 * esitlenir (`gridSpan` ek sutun uretir, `vMerge` ust hucreye birlesir).
 */
export interface DocxTableBlock {
  type: 'table'
  rows: string[][]
  /** `rows` ile ayni sekilli hucre adresleri. */
  cellUrls: Array<Array<string | undefined>>
}

export type DocxBlock = DocxParagraphBlock | DocxTableBlock

/** Bir `<w:p>` icindeki metni ve varsa kopyrunun hedefini birlikte dondurur. */
function paragraphToBlock(
  paragraphXml: string,
  prefix: string,
  rels: RelationshipMap,
): { text: string; url?: string; bullet: boolean } {
  const bullet = paragraphXml.includes(`<${prefix}:numPr>`) || paragraphXml.includes('<text:list>')

  // Once kopro etiketlerini konumlarıyla bul; sonra metni parcalara bolerek
  // her parcayi kendi hedefiyle birlestir.
  const links =
    prefix === 'w' ? extractOoxmlBlocks(paragraphXml, ['w:hyperlink']) : []

  let text = ''
  let url: string | undefined
  let cursor = 0
  for (const link of links) {
    if (link.start > cursor) text += runsToText(paragraphXml.slice(cursor, link.start), prefix)
    text += runsToText(link.inner, prefix)
    const rid = /\br:id="([^"]+)"/.exec(link.attrs)?.[1]
    const target = rid ? rels.get(rid) : undefined
    if (!url && isExternallyOpenable(target)) url = target
    cursor = link.end
  }
  if (cursor < paragraphXml.length) text += runsToText(paragraphXml.slice(cursor), prefix)

  return { text: text.replace(/[ \t]+/g, ' ').trim(), url, bullet }
}

/** Hucre/ozel kutu icerigini tek satira indirger (ic ice tablo varsa markdown'a). */
function blockToPlainLine(block: DocxBlock): string {
  if (block.type === 'paragraph') return block.bullet ? block.text.replace(/^[•\-*]\s*/, '').trim() : block.text
  return block.rows.map(r => r.filter(Boolean).join(' ')).join(' ').trim()
}

/** Bir `<w:tbl>` govdesinden satirlari ve hucre adreslerini cikarir. */
function tableToBlock(tableInner: string, prefix: string, rels: RelationshipMap): DocxTableBlock {
  const rowTag = prefix === 'w' ? 'w:tr' : 'table:table-row'
  const cellTag = prefix === 'w' ? 'w:tc' : 'table:table-cell'

  const rows: string[][] = []
  const cellUrls: Array<Array<string | undefined>> = []

  for (const row of extractOoxmlBlocks(tableInner, [rowTag])) {
    const cells: string[] = []
    const urls: Array<string | undefined> = []
    for (const cell of extractOoxmlBlocks(row.inner, [cellTag])) {
      const innerBlocks = ooxmlBodyToBlocks(cell.inner, `${prefix}:p`, prefix, rels, false)
      const text = innerBlocks
        .map(blockToPlainLine)
        .filter(Boolean)
        .join(' ')
      const url = innerBlocks
        .map(block => (block.type === 'paragraph' ? block.url : undefined))
        .find(candidate => isExternallyOpenable(candidate))

      // `vMerge` (restart olmayan) = ust hucreye dikey birlestirilmis hucre.
      // Metni ust hucreye tasiyor, sutun sayisi bozulmuyor.
      const vMerge = new RegExp(`<${escapeRegExp(prefix)}:vMerge\\b`).test(cell.inner)
      const vMergeRestart = /<w:vMerge\b[^>]*\bw:val="restart"/.test(cell.inner)
      if (vMerge && !vMergeRestart && rows.length > 0) {
        const col = cells.length
        const prevRow = rows[rows.length - 1]
        const prevUrls = cellUrls[cellUrls.length - 1]
        if (prevRow && prevRow[col] !== undefined) {
          if (text) prevRow[col] = prevRow[col] ? `${prevRow[col]} ${text}` : text
          if (!prevUrls[col] && url) prevUrls[col] = url
          cells.push('')
          urls.push(undefined)
          continue
        }
      }

      cells.push(text)
      urls.push(url)

      // `gridSpan` hucreyi birden fazla sutuna yayiyor; komsu sutin bos
      // gorunmesi icin bos huereler ekliyoruz (kolon sayisi tutarli kalsin).
      const spanMatch = new RegExp(`<w:gridSpan\\b[^>]*\\bw:val="(\\d+)"`).exec(cell.inner)
      const span = spanMatch ? Math.min(64, Math.max(1, parseInt(spanMatch[1], 10) || 1)) : 1
      for (let i = 1; i < span; i++) {
        cells.push('')
        urls.push(undefined)
      }
    }
    if (cells.length === 0) continue
    rows.push(cells)
    cellUrls.push(urls)
  }

  // Sutun sayisini tum satirlarda esitle (bos hucreler korunur).
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0)
  for (const r of rows) while (r.length < width) r.push('')
  for (const u of cellUrls) while (u.length < width) u.push(undefined)

  return { type: 'table', rows, cellUrls }
}

/** Belge govdesini (veya tek bir tablo hucresini) blok listesine cevirir. */
function ooxmlBodyToBlocks(
  xml: string,
  paragraphTag: string,
  prefix: string,
  rels: RelationshipMap,
  skipTables: boolean,
): DocxBlock[] {
  const blocks: DocxBlock[] = []
  const tags = skipTables ? [paragraphTag] : [paragraphTag, 'w:tbl', 'table:table']
  for (const block of extractOoxmlBlocks(xml, tags)) {
    if (block.tag === paragraphTag) {
      const { text, url, bullet } = paragraphToBlock(block.inner, prefix, rels)
      if (text.length > 0) blocks.push({ type: 'paragraph', text, bullet, url })
      continue
    }
    if (skipTables) continue
    const table = tableToBlock(block.inner, prefix, rels)
    if (table.rows.length > 0) blocks.push(table)
  }
  return blocks
}

/**
 * DOCX/ODT govdesinden YAPILANDIRILMIS bloklar uretir.
 * Hem `word/document.xml` (DOCX) hem `content.xml` (ODT) desteklenir.
 * Kopyru hedefleri `word/_rels/document.xml.rels` icinden okunur.
 */
export function extractDocxBlocks(buf: Buffer): DocxBlock[] {
  try {
    const entries = extractZipEntries(buf)
    const docXml = entries.get('word/document.xml')
    if (docXml) {
      const rels = parseRelationships(
        entries.get('word/_rels/document.xml.rels')?.toString('utf8') ?? '',
        'word',
      )
      return ooxmlBodyToBlocks(docXml.toString('utf8'), 'w:p', 'w', rels, false)
    }
    // OpenDocument Text (ODT): `content.xml`
    const odt = entries.get('content.xml')
    if (odt) {
      return ooxmlBodyToBlocks(odt.toString('utf8'), 'text:p', 'text', new Map(), false)
    }
    return []
  } catch {
    return []
  }
}

/**
 * DOCX icindeki paragraflari ve tablolari ayiklar (GERIYE UYUMLU DIZI).
 * Tablolar tek bir `string` icinde, satir basina `| a | b |` olarak tutulur
 * (eski bicim). Arayuz yapilandirilmis veriyi `extractDocxBlocks` uzerinden
 * kullanir.
 */
export function extractDocxParagraphs(buf: Buffer): string[] {
  return extractDocxBlocks(buf)
    .map(block => (block.type === 'paragraph' ? block.text : block.rows.map(r => `| ${r.join(' | ')} |`).join('\n')))
    .filter(line => line.trim().length > 0)
}

/** XLSX ve ODS çalışma kitaplarını okur (sharedStrings + sayfa hücreleri). */
export function extractXlsxSheets(buf: Buffer): Array<{ name: string; rows: string[][] }> {
  const entries = extractZipEntries(buf)
  if (entries.size === 0) return []

  // OpenDocument Spreadsheet (ODS): content.xml icinde table:table bloklari
  const odsXml = entries.get('content.xml')
  if (odsXml && !entries.has('xl/workbook.xml')) {
    const contentStr = odsXml.toString('utf8')
    const odsSheets: Array<{ name: string; rows: string[][] }> = []
    let idx = 1
    for (const tbl of extractOoxmlBlocks(contentStr, ['table:table'])) {
      const sheetName =
        /\btable:name="([^"]+)"/.exec(tbl.attrs)?.[1] ?? `Sayfa ${idx++}`
      const rows: string[][] = []
      for (const row of extractOoxmlBlocks(tbl.inner, ['table:table-row'])) {
        const cells: string[] = []
        for (const cell of extractOoxmlBlocks(row.inner, ['table:table-cell'])) {
          const cellText = extractOoxmlBlocks(cell.inner, ['text:p'])
            .map(p => decodeXmlEntities(p.inner.replace(/<[^>]+>/g, '')).trim())
            .filter(Boolean)
            .join(' ')
          cells.push(cellText)
        }
        if (cells.some(c => c.length > 0)) rows.push(cells)
        if (rows.length >= 2000) break
      }
      if (rows.length > 0) odsSheets.push({ name: decodeXmlEntities(sheetName), rows })
    }
    if (odsSheets.length > 0) return odsSheets
  }

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
 * PPTX slayti. `titleUrl` ve `bulletUrls` kopru hedeflerini tasir;
 * `bulletUrls` `bullets` ile ayni indekslenir.
 */
export interface PptxSlide {
  slideNumber: number
  title?: string
  titleUrl?: string
  bullets: string[]
  bulletUrls?: Array<string | undefined>
}

/**
 * Bir `<a:p>` paragrafinin metnini ve varsa `a:hlinkClick` kopru hedefini
 * dondurur. Metin `<a:r>` run'lari ile `<a:fld>` alanlarindan toplanir.
 */
function drawingParagraphToLine(paragraphXml: string, rels: RelationshipMap): { text: string; url?: string } {
  const runs = extractOoxmlBlocks(paragraphXml, ['a:r', 'a:fld'])
  let text = ''
  let url: string | undefined
  for (const run of runs) {
    const runText = extractOoxmlBlocks(run.inner, ['a:t'])
      .map(t => decodeXmlEntities(t.inner))
      .join('')
    if (!runText) continue
    text += runText
    if (!url) {
      const rid = /<a:hlinkClick\b[^>]*\br:id="([^"]+)"/.exec(run.inner)?.[1]
      const target = rid ? rels.get(rid) : undefined
      if (isExternallyOpenable(target)) url = target
    }
  }
  return { text: text.trim(), url }
}

/** Bir sekil govdesinden satirlari (metin + kopro) cikarir. */
function shapeToLines(shapeXml: string, rels: RelationshipMap): Array<{ text: string; url?: string }> {
  return extractOoxmlBlocks(shapeXml, ['a:p'])
    .map(p => drawingParagraphToLine(p.inner, rels))
    .filter(l => l.text.length > 0)
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
 * 5) KOPRU HEDEFLERI KAYBOLUYORDU: `a:hlinkClick r:id` ile
 *    `ppt/slides/_rels/slideN.xml.rels` icindeki `Target` eslesmesi hic kurulmuyor,
 *    baglantili metin duz metin olarak kaliyordu. Artik baslik ve her madde
 *    kendi `url` degerini tasiyor.
 */
export function extractPptxSlides(buf: Buffer): PptxSlide[] {
  const slides: PptxSlide[] = []
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
      const slidePath = paths[i]
      const slideXml = entries.get(slidePath)!.toString('utf8')
      const slideIndexNum = i + 1

      // Kopru hedefleri: `ppt/slides/_rels/slideN.xml.rels`
      const slideDir = slidePath.replace(/\/[^/]*$/, '')
      const slideRels = parseRelationships(
        entries.get(`${slideDir}/_rels/${slidePath.slice(slideDir.length + 1)}.rels`)?.toString('utf8') ?? '',
        slideDir,
      )

      const titleShapes: Array<{ text: string; url?: string }> = []
      const bodyParagraphs: Array<{ text: string; url?: string }> = []

      // <p:sp> sekillerini tara
      for (const shape of extractOoxmlBlocks(slideXml, ['p:sp'])) {
        const phType = /<p:ph[^>]*\btype="([^"]+)"/.exec(shape.inner)?.[1] ?? ''
        const lines = shapeToLines(shape.inner, slideRels)

        if (lines.length === 0) continue
        if (phType === 'title' || phType === 'ctrTitle') titleShapes.push(...lines)
        else if (phType === 'ftr' || phType === 'sldNum' || phType === 'dt') continue
        else bodyParagraphs.push(...lines)
      }

      // Tablolar: yalnizca sekil disinda kalan hucre metinleri (yinelenmeyi onle)
      const tableCells: Array<{ text: string; url?: string }> = []
      for (const graphic of extractOoxmlBlocks(slideXml, ['a:tbl'])) {
        for (const cell of extractOoxmlBlocks(graphic.inner, ['a:tc'])) {
          const text = shapeToLines(cell.inner, slideRels)
            .map(l => l.text)
            .filter(Boolean)
            .join(' ')
          const url = shapeToLines(cell.inner, slideRels).find(l => l.url)?.url
          if (text) tableCells.push({ text, url })
        }
      }

      const bulletLines: Array<{ text: string; url?: string }> = []
      let title: string
      let titleUrl: string | undefined

      if (titleShapes.length > 0) {
        title = titleShapes[0].text
        titleUrl = titleShapes[0].url
        bulletLines.push(...titleShapes.slice(1), ...bodyParagraphs, ...tableCells)
      } else if (bodyParagraphs.length > 0) {
        title = bodyParagraphs[0].text
        titleUrl = bodyParagraphs[0].url
        bulletLines.push(...bodyParagraphs.slice(1), ...tableCells)
      } else if (tableCells.length > 0) {
        title = `Slayt ${slideIndexNum}`
        bulletLines.push(...tableCells)
      } else {
        title = `Slayt ${slideIndexNum}`
        bulletLines.push({
          text: '(Bu slayt yalnızca görsel, şema veya grafik içeriyor; metin katmanı yok.)',
        })
      }

      const bullets = bulletLines.map(b => b.text)
      const bulletUrls = bulletLines.some(b => b.url) ? bulletLines.map(b => b.url) : undefined

      slides.push({ slideNumber: slideIndexNum, title, titleUrl, bullets, bulletUrls })
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

/* ------------------------------------------------------------------ *
 * Kod dili tespiti
 * ------------------------------------------------------------------ */

/**
 * Uzantiya gore dil eslesmesi.
 *
 * ONCEKI SURUMUN HATASI: harita eksikti ve `.asm` -> `assembly` gibi
 * Prism'de HICBIR KARSILIGI OLMAYAN degerler iceriyordu. Arayuz
 * `Prism.languages['assembly']` aradigi icin bulamayip sessizce duz metne
 * duserdi ("renklendirme hic calismiyor"). Buradaki HER deger, Prism 1.30
 * `components/prism-<deger>.js` ile yuklenebilen bir anahtardir; `vue` ve
 * `svelte` haric (Prism 1.30 bu ikisini kaldirdi) dogrudan birer `prism-*`
 * dosyasina karsilik gelir.
 */
export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  // JavaScript / TypeScript
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.jsx': 'jsx',
  // Web
  '.html': 'html', '.htm': 'html', '.xhtml': 'html',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'markup',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less', '.styl': 'stylus',
  // Veri / yapilandirma
  '.json': 'json', '.json5': 'json5', '.jsonc': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini', '.env': 'ini',
  '.properties': 'properties',
  '.editorconfig': 'editorconfig',
  '.xml': 'xml', '.xsd': 'xml', '.xsl': 'xml', '.plist': 'xml',
  '.svg': 'markup',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.proto': 'protobuf',
  '.sql': 'sql', '.psql': 'sql', '.ddl': 'sql',
  // Sistem
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
  '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp', '.ipp': 'cpp', '.tpp': 'cpp',
  '.asm': 'nasm', '.nasm': 'nasm', '.s': 'nasm',
  '.rs': 'rust',
  '.go': 'go', '.mod': 'go-module',
  '.zig': 'zig',
  '.nim': 'nim',
  '.v': 'verilog', '.sv': 'verilog',
  '.sol': 'solidity',
  '.f': 'fortran', '.for': 'fortran', '.f90': 'fortran',
  '.smali': 'smali',
  // JVM / .NET
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.scala': 'scala',
  '.groovy': 'groovy', '.gradle': 'groovy',
  '.clj': 'clojure', '.cljs': 'clojure', '.cljc': 'clojure',
  '.cs': 'csharp',
  '.fs': 'fsharp', '.fsx': 'fsharp', '.fsi': 'fsharp',
  '.vb': 'vbnet',
  '.cshtml': 'cshtml', '.razor': 'cshtml',
  // Betik
  '.py': 'python', '.pyw': 'python', '.pyi': 'python',
  '.rb': 'ruby', '.rake': 'ruby',
  '.php': 'php', '.phtml': 'php',
  '.pl': 'perl', '.pm': 'perl',
  '.lua': 'lua',
  '.r': 'r',
  '.dart': 'dart',
  '.swift': 'swift',
  '.m': 'objectivec',
  '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang', '.hrl': 'erlang',
  '.hs': 'haskell',
  '.ml': 'ocaml', '.mli': 'ocaml',
  '.el': 'lisp', '.lisp': 'lisp',
  '.tcl': 'tcl',
  '.jq': 'jq',
  '.awk': 'awk',
  '.ino': 'arduino',
  // Kabuk / altyapi
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.ksh': 'bash',
  '.ps1': 'powershell', '.psm1': 'powershell', '.psd1': 'powershell',
  '.bat': 'batch', '.cmd': 'batch',
  '.hcl': 'hcl', '.tf': 'hcl', '.tfvars': 'hcl',
  '.nix': 'nix',
  '.bicep': 'bicep',
  // Dokuman / diger
  '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown',
  '.tex': 'latex', '.bib': 'latex',
  '.diff': 'diff', '.patch': 'diff',
  '.vim': 'vim',
}

/** Uzantisi olmayan / ozel adli dosyalar. */
export const LANGUAGE_BY_FILENAME: Record<string, string> = {
  dockerfile: 'docker',
  containerfile: 'docker',
  'docker-compose.yml': 'yaml',
  'docker-compose.yaml': 'yaml',
  makefile: 'make',
  gnumakefile: 'make',
  'makefile.am': 'make',
  'makefile.in': 'make',
  cmakelists: 'cmake',
  'cmake.in': 'cmake',
  rakefile: 'ruby',
  gemfile: 'ruby',
  podfile: 'ruby',
  vagrantfile: 'ruby',
  brewfile: 'ruby',
  'gitignore': 'ignore',
  '.gitignore': 'ignore',
  'gitattributes': 'git',
  '.gitattributes': 'git',
  'gitmodules': 'git',
  '.gitmodules': 'git',
  'npmrc': 'ini',
  '.npmrc': 'ini',
  '.yarnrc': 'ini',
  '.env': 'ini',
  '.env.local': 'ini',
  '.env.example': 'ini',
  '.bashrc': 'bash',
  '.bash_profile': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
  '.vimrc': 'vim',
  '.editorconfig': 'editorconfig',
  '.dockerignore': 'ignore',
  '.eslintrc': 'json',
  '.prettierrc': 'json',
}

/**
 * IcERIKTEN dil tahmini.
 *
 * Yalnizca "guvenilir" sinyaller kullanilir; belirsiz durumda `'text'`
 * doner. Arayuz bu durumda "dil secici" sunar (sessizce duz metne dusmez).
 */
export function sniffLanguage(text: string): string {
  if (!text || !text.trim()) return 'text'
  const head = text.slice(0, 4000)
  const has = (re: RegExp) => re.test(head)

  // 1) Kesin isaretler — dosyanin ilk satiri (shebang / prolog)
  const firstLine = head.split('\n', 1)[0].trim()
  if (/^#!/.test(firstLine)) {
    if (/\b(bash|sh|zsh|dash|ksh)\b/.test(firstLine)) return 'bash'
    if (/\bpython[0-9.]*\b/.test(firstLine)) return 'python'
    if (/\bnode\b/.test(firstLine)) return 'javascript'
    if (/\bperl\b/.test(firstLine)) return 'perl'
    if (/\bruby\b/.test(firstLine)) return 'ruby'
    if (/\bru\b/.test(firstLine)) return 'r'
  }
  if (/^<\?php/.test(firstLine)) return 'php'
  if (/^<!DOCTYPE\s+html/i.test(firstLine) || /^<html[\s>]/i.test(firstLine)) return 'html'
  if (/^<svg[\s>]/i.test(firstLine)) return 'markup'
  if (/^<\?xml/i.test(firstLine)) return 'xml'

  // 2) Guclu yapisal sinyaller
  if (has(/^\s*(FROM|RUN|CMD|ENTRYPOINT|COPY|ENV|ARG|EXPOSE|WORKDIR|USER|LABEL|VOLUME)\s+\S/m)) {
    return 'docker'
  }
  if (has(/^package\s+main\b/m) || (has(/^\s*func\s+\w+\s*\(/m) && has(/^\s*import\s+"/m))) return 'go'
  if (has(/^\s*fn\s+main\s*\(/m) || (has(/^\s*use\s+std::/m) && has(/^\s*let\s+mut\b/m))) return 'rust'
  if (has(/^\s*#include\s*[<"]/m)) return has(/std::|namespace\s/) ? 'cpp' : 'c'
  if (
    (has(/^\s*def\s+\w+\s*\(.*\)\s*(->[^:]+)?:\s*$/m) || has(/^\s*class\s+\w+\s*(\(.*\))?:\s*$/m)) &&
    (has(/^\s{4,}\S/m) || has(/\bself\b/) || has(/\bprint\s*\(/))
  ) {
    return 'python'
  }
  if (has(/^\s*(public\s+)?(class|interface)\s+\w+/m) && has(/^\s*import\s+java\./m)) return 'java'
  if (has(/^\s*using\s+System\b/m)) return 'csharp'
  if (has(/^\s*namespace\s+\w+/m) && has(/^\s*(public|internal)\s+(static\s+)?(void|class)\b/m)) return 'csharp'
  if (has(/^\s*(const|let|var|function)\s+\w+/m) && has(/=>|console\.log|require\(|export\s+default/)) return 'javascript'
  if (has(/^\s*(interface|type|enum|namespace)\s+\w+/m) && has(/:\s*(string|number|boolean|void|any)\b/)) return 'typescript'
  if (has(/^\s*def\s+\w+/m) && has(/^\s*end\b/m)) return 'ruby'
  if (has(/^\s*\$this->|\?>\s*$/m) && has(/<(\?php|\?)/)) return 'php'
  if (has(/^\s*(local\s+\w+=|function\s+\w+\(\)|echo\s+"|\$\w+\+=|fi$)/m)) return 'bash'
  if (has(/^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/im)) return 'sql'
  if (has(/\bself\.|\belsif\b|\bend\b/) && has(/^\s*def\s+/m)) return 'ruby'
  if (has(/^\s*(module|class|def)\s+\w+/m) && has(/\bend\b/)) return 'ruby'

  // 3) Yapisal / kumulatif sinyaller
  if (/<template[\s>]/.test(head) && /<script[\s>]/.test(head)) {
    return /svelte/.test(head) ? 'svelte' : 'vue'
  }
  if (/<svg[\s>]/.test(head) && /<\/svg>/.test(head)) return 'markup'
  if (/^---\s*$/m.test(head)) return 'yaml'
  // JSON: govde tek parca halinde gercekten ayristirilabiliyorsa. (Yalnizca
  // `{` ve `}` varligina bakmak "JSON benzeri" ama gecersiz dosyalari da
  // yakalardi; bu yuzden parse deniyoruz.)
  const trimmedHead = head.trim()
  if (/^[{[]/.test(trimmedHead)) {
    const stripped = trimmedHead.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    try {
      JSON.parse(stripped)
      return 'json'
    } catch {
      /* JSON degil */
    }
  }
  if (has(/^\s*\.[A-Z]+:/m) || has(/^[A-Z_]+ *[:?+]=/m)) return 'makefile'
  if (has(/^\s*#\s*(include|define|pragma|ifndef|undef)\b/m)) return 'c'
  if (has(/^\s*(sub|package|use|my|our|local)\s+\w+/m) && has(/\{\s*$/m)) return 'perl'
  if (has(/^\s*\(\s*-?\d+\s+-\?\d+\s+\d+\s*$/m)) return 'lisp'
  if (has(/^\s*(defmodule|defprotocol|defimpl)\s+\w+/m)) return 'elixir'
  if (has(/^\s*@(module|middleware|use)\b/m) && has(/\bend\b/)) return 'elixir'
  if (has(/^\s*(data|class|fun|object)\s+\w+.*[:=]/m) && has(/\bend\b/)) return 'kotlin'
  if (has(/^\s*<\?xml/i)) return 'xml'

  return 'text'
}

/**
 * Dosya adindan (uzanti veya ozel ad) dili belirler; bulunamazsa icerikten
 * tahmin yapar. Hicbir sinyal bulunamazsa `'text'` doner.
 */
export function detectLanguage(fileName: string, text = ''): string {
  const base = (fileName || '').replace(/\\/g, '/').split('/').pop() ?? ''
  const lower = base.toLowerCase()
  if (!lower) return sniffLanguage(text)

  // Tam dosya adi (uzantili veya nokta ile baslayan gizli dosyalar).
  if (LANGUAGE_BY_FILENAME[lower]) return LANGUAGE_BY_FILENAME[lower]
  // Nokta ile baslayan gizli dosyalar icin noktasiz deneme.
  if (lower.startsWith('.')) {
    const bare = lower.slice(1)
    if (LANGUAGE_BY_FILENAME[bare]) return LANGUAGE_BY_FILENAME[bare]
  }
  // Uzantili ozel adlar: `Dockerfile.prod`, `Makefile.am` vb.
  const stem = lower.replace(/\.[^.]+$/, '')
  if (stem !== lower && LANGUAGE_BY_FILENAME[stem]) return LANGUAGE_BY_FILENAME[stem]
  if (stem.startsWith('dockerfile.') || stem.startsWith('containerfile.')) return 'docker'

  const ext = path.extname(lower)
  if (ext && LANGUAGE_BY_EXTENSION[ext]) return LANGUAGE_BY_EXTENSION[ext]

  return sniffLanguage(text)
}

/**
 * "Kod dosyasi" dalina giren uzantilar.
 *
 * `LANGUAGE_BY_EXTENSION` Markdown uzantilarini da icerir (dil tespiti icin
 * dogru), ancak `.md` dosyalari Markdown olarak OYNATILMALI; bu yuzden
 * markdown uzantilari buradan cikarilir. Aksi halde `.md` dosyalari kod
 * goruntuleyicisine duser ve `MarkdownView` hic kullanilmaz.
 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])
const CODE_EXTENSIONS: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUAGE_BY_EXTENSION).filter(([ext]) => !MARKDOWN_EXTENSIONS.has(ext)),
)

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
 * `FilePreviewResult`in bu servis tarafinda uretilen EK alanlari.
 * `types/jmc.ts` baska bir sahibin dosyasi oldugu icin burada yerel olarak
 * genisletiyoruz; arayuz bu alanlari `undefined` kontroluyle okur (yoksa
 * geriye uyumlu eski yola duser).
 */
export type RichFilePreviewResult = FilePreviewResult & {
  /** DOCX: yapilandirilmis paragraf/tablo bloklari (kopru hedefleriyle). */
  docBlocks?: DocxBlock[]
}

/** Metin/kod dosyalari icin her zaman bir dil doldurur (bilinmiyorsa 'text'). */
function languageOf(title: string, text: string): string {
  const lang = detectLanguage(title, text)
  return lang && lang.length > 0 ? lang : 'text'
}

export class FilePreviewService {
  constructor(
    private readonly storageService: StorageService,
    private readonly driveService: DriveService,
  ) {}

  public async getFilePreview(
    attachment: Attachment,
    courseId = '',
  ): Promise<RichFilePreviewResult> {
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

    const buf = this.storageService.readCasFile(cached.absolutePath, cached.entry.sha256)
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
      const docBlocks = extractDocxBlocks(buf)
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
        // Yapilandirilmis bloklar: her `<w:tr>` ayri satir, her `<w:tc>` ayri
        // hucre, kopro hedefleriyle birlikte.
        docBlocks,
        language: languageOf(title, finalText),
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
    //
    // DIL ALANI ARTIK HER ZAMAN DOLU. Onceki surum yalnizca katalogdaki
    // uzantiyalara guveniyordu; taninmayan uzantili kod dosyalari `kind:'text'`
    // olarak dusup Prism'de dil bulunamadigi icin sessizce duz metne
    // donusuyordu. Artik uzanti -> dosya adi -> icerik sirasiyla denenir.
    if (CODE_EXTENSIONS[ext]) {
      const text = buf.toString('utf8')
      const lines = text.split('\n')
      return {
        fileId,
        title,
        mimeType: mime || 'text/plain',
        sizeBytes,
        kind: 'code',
        language: languageOf(title, text),
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
        language: 'markdown',
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
      // Bilinmeyen uzantili ama kod olabilecek dosyalar icin icerikten tahmin.
      // Tahmin edilemezse 'text' doner; arayuz bu durumda dil secici sunar.
      language: languageOf(title, text),
      text,
      lineCount: lines.length,
      localPath: cached.absolutePath,
    }
  }
}

/**
 * RTF belgelerinden duz metin ayiklar.
 */
function extractTextFromRtf(rtf: string): string {
  try {
    return rtf
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\tab/g, '\t')
      .replace(/\\'[0-9a-fA-F]{2}/g, match => {
        try {
          return String.fromCharCode(parseInt(match.slice(2), 16))
        } catch {
          return ''
        }
      })
      .replace(/\{\\*?\\[^{}]+;?\}|\\\w+/g, '')
      .replace(/[{}]/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}

export interface UniversalExtractedAttachment {
  text: string
  mimeType: string
  isImage: boolean
  isPdf: boolean
  fileTypeLabel: string
}

/**
 * Tum dosya turlerinden (PDF, DOCX, PPTX, XLSX, ODT, ODP, ODS, RTF, Kod, CSV, JSON, TXT, ZIP)
 * guvenle ve eksiksiz metin cikarir. AI sohbetine eklenen dosyalar boylece model tarafindan
 * dogrudan okunabilir.
 */
export function extractUniversalAttachmentText(
  buf: Buffer,
  fileName: string,
  hintMime = '',
): UniversalExtractedAttachment {
  const ext = path.extname(fileName || '').toLowerCase()
  const mime = hintMime.toLowerCase()

  // 1) Gorseller
  if (IMAGE_EXTENSIONS[ext] || mime.startsWith('image/')) {
    const finalMime = IMAGE_EXTENSIONS[ext] || mime || 'image/png'
    return {
      text: '',
      mimeType: finalMime,
      isImage: true,
      isPdf: false,
      fileTypeLabel: 'Görsel',
    }
  }

  // 2) PDF
  if (ext === '.pdf' || mime === 'application/pdf') {
    const pdfText = extractTextFromPdf(buf)
    return {
      text: pdfText,
      mimeType: 'application/pdf',
      isImage: false,
      isPdf: true,
      fileTypeLabel: 'PDF Belgesi',
    }
  }

  // 3) Word / DOCX / ODT
  if (
    ext === '.docx' ||
    ext === '.odt' ||
    ext === '.doc' ||
    mime.includes('wordprocessingml') ||
    mime.includes('opendocument.text')
  ) {
    const paragraphs = extractDocxParagraphs(buf)
    const text = paragraphs.length > 0 ? paragraphs.join('\n\n') : extractTextFromDocx(buf)
    return {
      text: text.trim(),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      isImage: false,
      isPdf: false,
      fileTypeLabel: ext === '.odt' ? 'OpenDocument Metni' : 'Word Belgesi',
    }
  }

  // 4) Excel / XLSX / ODS
  if (
    ext === '.xlsx' ||
    ext === '.xlsm' ||
    ext === '.ods' ||
    mime.includes('spreadsheetml') ||
    mime.includes('opendocument.spreadsheet') ||
    mime.includes('ms-excel')
  ) {
    const sheets = extractXlsxSheets(buf)
    const text = sheets
      .map(s => `[Sayfa: ${s.name}]\n` + s.rows.map(r => r.join(' | ')).join('\n'))
      .join('\n\n')
    return {
      text: text.trim(),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      isImage: false,
      isPdf: false,
      fileTypeLabel: ext === '.ods' ? 'OpenDocument Hesap Tablosu' : 'Excel Çalışma Kitabı',
    }
  }

  // 5) PowerPoint / PPTX / ODP
  if (
    ext === '.pptx' ||
    ext === '.ppsx' ||
    ext === '.odp' ||
    mime.includes('presentationml') ||
    mime.includes('opendocument.presentation')
  ) {
    let slides = extractPptxSlides(buf)
    if (slides.length === 0) {
      const fallback = extractTextFromPptx(buf)
      if (fallback.trim()) {
        return {
          text: fallback.trim(),
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          isImage: false,
          isPdf: false,
          fileTypeLabel: 'Sunum Dosyası',
        }
      }
    }
    const text = slides
      .map(s => `[Slayt ${s.slideNumber}: ${s.title || 'Başlıksız'}]\n${s.bullets.map(b => `• ${b}`).join('\n')}`)
      .join('\n\n')
    return {
      text: text.trim(),
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      isImage: false,
      isPdf: false,
      fileTypeLabel: ext === '.odp' ? 'OpenDocument Sunumu' : 'PowerPoint Sunumu',
    }
  }

  // 6) RTF
  if (ext === '.rtf' || mime === 'application/rtf' || mime === 'text/rtf') {
    const rtfRaw = buf.toString('utf8')
    const rtfText = extractTextFromRtf(rtfRaw)
    return {
      text: rtfText || rtfRaw,
      mimeType: 'text/rtf',
      isImage: false,
      isPdf: false,
      fileTypeLabel: 'Zengin Metin Belgesi (RTF)',
    }
  }

  // 7) CSV / TSV
  if (ext === '.csv' || ext === '.tsv' || mime === 'text/csv' || mime === 'text/tab-separated-values') {
    const raw = buf.toString('utf8')
    return {
      text: raw,
      mimeType: ext === '.tsv' ? 'text/tab-separated-values' : 'text/csv',
      isImage: false,
      isPdf: false,
      fileTypeLabel: ext === '.tsv' ? 'TSV Veri Dosyası' : 'CSV Veri Dosyası',
    }
  }

  // 8) ZIP / Arşiv (İçerik dosya ağacı ve küçük kod/metin dosyaları)
  if (ext === '.zip' || ext === '.jar' || ext === '.epub') {
    try {
      const entries = extractZipEntries(buf)
      const fileNames = Array.from(entries.keys())
      let zipSummary = `[Arşiv İçeriği: ${fileName} (${fileNames.length} dosya)]\n`
      zipSummary += fileNames.slice(0, 50).map(f => ` - ${f}`).join('\n')
      if (fileNames.length > 50) zipSummary += `\n... ve ${fileNames.length - 50} dosya daha`

      // Küçük kod veya metin dosyaları varsa ilk 3 tanesinin içeriğini de ekle
      let added = 0
      for (const [entryName, entryBuf] of entries) {
        if (added >= 3) break
        const entryExt = path.extname(entryName).toLowerCase()
        if (
          entryBuf.length <= 25_000 &&
          (CODE_EXTENSIONS[entryExt] || entryExt === '.txt' || entryExt === '.md' || entryExt === '.json')
        ) {
          zipSummary += `\n\n--- [${entryName}] ---\n${entryBuf.toString('utf8').slice(0, 5000)}`
          added++
        }
      }
      return {
        text: zipSummary,
        mimeType: 'application/zip',
        isImage: false,
        isPdf: false,
        fileTypeLabel: 'Arşiv Dosyası',
      }
    } catch {
      /* devam */
    }
  }

  // 9) Kod, Yapılandırma veya Genel Metin
  const detectedLang = detectLanguage(fileName, buf.toString('utf8', 0, Math.min(buf.length, 2048)))
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
      text: `[İkili (Binary) Dosya: ${fileName} (${Math.round(buf.length / 1024)} KB)]`,
      mimeType: mime || 'application/octet-stream',
      isImage: false,
      isPdf: false,
      fileTypeLabel: 'İkili Dosya',
    }
  }

  const rawText = buf.toString('utf8')
  return {
    text: rawText,
    mimeType: mime || 'text/plain',
    isImage: false,
    isPdf: false,
    fileTypeLabel: detectedLang !== 'text' ? `Kaynak Kod (${detectedLang})` : 'Metin Dosyası',
  }
}

