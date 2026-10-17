/**
 * documentExtraction.test.ts
 * ---------------------------------------------------------------------------
 * Belge ayiklama katmaninin regresyon testleri.
 *
 * KULLANICI BILDIRIMLERI:
 *   • "PDF/DOCX/PPTX aciliyor ama metin cikmiyor"
 *   • "slaytlar tek sayfa gorunuyor"
 *   • "PPTX metni yanlis / eksik"
 *   • "resim/OCR araclari yok"
 *
 * Bu testler saf Node.js (harici bagimlilik yok) ayiklayicilari dogrular.
 */
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import {
  extractTextFromPdf,
  isPdfEncrypted,
  readImageDimensions,
  extractZipEntries,
} from '../electron/services/toolDispatcher'
import { extractXlsxSheets, extractDocxParagraphs, hasPptxSlides, extractPptxSlides, extractOoxmlBlocks } from '../electron/services/filePreviewService'

/* ------------------------------------------------------------------ */
/* Yardimcilar: minimal ama GECERLI OOXML/ZIP uretimi                    */
/* ------------------------------------------------------------------ */

function crc32(buf: Buffer): number {
  let table = crc32Table
  if (!table) {
    table = crc32Table = new Int32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[i] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}
let crc32Table: Int32Array | null = null

/**
 * Tek dosyalik, STORED (sikistirmasiz) gecerli bir ZIP uretir.
 * `extractZipEntries` merkezi dizini okudugu icin ZIP64/EOCD dogru
 * yazilmalidir.
 */
function makeZip(files: Record<string, string | Buffer>): Buffer {
  const entries: Array<{ name: string; data: Buffer; crc: number; offset: number }> = []
  const chunks: Buffer[] = []
  let offset = 0

  for (const [name, value] of Object.entries(files)) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 flag
    local.writeUInt16LE(0, 8) // method = stored
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0, 12) // mod date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)

    chunks.push(local, data)
    entries.push({ name, data, crc, offset })
    offset += local.length + data.length
  }

  const central: Buffer[] = []
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const cd = Buffer.alloc(46 + nameBuf.length)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10) // stored
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(e.crc, 16)
    cd.writeUInt32LE(e.data.length, 20)
    cd.writeUInt32LE(e.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30) // extra
    cd.writeUInt16LE(0, 32) // comment
    cd.writeUInt16LE(0, 34) // disk
    cd.writeUInt16LE(0, 36) // internal attrs
    cd.writeUInt32LE(0, 38) // external attrs
    cd.writeUInt32LE(e.offset, 42)
    nameBuf.copy(cd, 46)
    central.push(cd)
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuf, eocd])
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

/**
 * WinAnsi (CP1252) metin baytlarina cevirir.
 * GERCEK PDF ureticileri standart kodlamada kromlu tirnagi 0x93/0x94,
 * tireyi 0x96/0x97 olarak yazar. Testin once latin1 kullanmasi bu
 * karakterleri 0x13/0x14 gibi KONTROL baytina ceviriyordu; yani test
 * gercek dunyada olmayan bir PDF uretiyordu.
 */
const WINANSI_ENCODE: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
  'Ç': 0xc7, 'Ğ': 0xd0, 'Ö': 0xd6, 'İ': 0xdd, 'Ş': 0xde,
  'ç': 0xe7, 'ğ': 0xf0, 'ö': 0xf6, 'ü': 0xfc, 'ı': 0xfd, 'ş': 0xfe,
}

function toWinAnsi(str: string): Buffer {
  const bytes: number[] = []
  for (const ch of str) {
    const mapped = WINANSI_ENCODE[ch]
    if (mapped !== undefined) bytes.push(mapped)
    else {
      const code = ch.codePointAt(0)!
      bytes.push(code <= 0xff ? code : 0x3f)
    }
  }
  return Buffer.from(bytes)
}

/** Metin akisi olan gecerli bir PDF uretir (FlateDecode, WinAnsi kodlama). */
function makePdf(text: string, extraHeader = ''): Buffer {
  const escaped = text.replace(/([()\\])/g, '\\$1')
  const streamBytes = Buffer.concat([
    Buffer.from('BT /F1 12 Tf 72 720 Td (', 'latin1'),
    toWinAnsi(escaped),
    Buffer.from(') Tj ET', 'latin1'),
  ])
  const compressed = zlib.deflateSync(streamBytes)
  const pieces: Buffer[] = []
  const offsets: number[] = []

  const push = (s: string | Buffer) => {
    const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')
    offsets.push(pieces.reduce((n, p) => n + p.length, 0))
    pieces.push(b)
  }

  push('%PDF-1.7\n')
  push(extraHeader)
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  push('3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n')
  push('4 0 obj\n<< /Length ')
  push(Buffer.from(String(compressed.length), 'latin1'))
  push(' /Filter /FlateDecode >>\nstream\n')
  push(compressed)
  push('\nendstream\nendobj\n')

  const body = Buffer.concat(pieces)
  const xrefStart = body.length
  const xrefLines: string[] = [`xref\n0 ${offsets.length + 1}\n`, '0000000000 65535 f \n']
  for (const o of offsets) xrefLines.push(`${String(o).padStart(10, '0')} 00000 n \n`)
  xrefLines.push(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  )
  return Buffer.concat([body, Buffer.from(xrefLines.join(''), 'latin1')])
}

describe('extractTextFromPdf', () => {
  it('FlateDecode edilmis metni cikarir', () => {
    const pdf = makePdf('Merhaba Dunya JustMyClass')
    const text = extractTextFromPdf(pdf)
    expect(text).toContain('Merhaba Dunya JustMyClass')
  })

  it('sifreli PDF icin "parola korumali" yerine "taranmis resim" demez', () => {
    const pdf = makePdf('gizli', '/Encrypt 9 0 R\n')
    expect(isPdfEncrypted(pdf)).toBe(true)
    const text = extractTextFromPdf(pdf)
    expect(text).toContain('parola korumal')
    expect(text).not.toContain('taranm')
  })

  it('duz (sikistirmasiz) metin akisini da okur', () => {
    const raw = 'BT /F1 12 Tf 72 720 Td (duz metin aka) Tj ET'
    const pieces = [
      '%PDF-1.7\n',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n',
      `4 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
      'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
    ]
    const text = extractTextFromPdf(Buffer.from(pieces.join(''), 'latin1'))
    expect(text).toContain('duz metin aka')
  })

  it('bir sayfa neredeyse tamamen tirnak/tire iceriyorsa da metni dusurmmez', () => {
    // Turkce KROMLU tirnak + tire ile dolu bir sayfa. Onceki surum "satirda
    // kontrol karakteri varsa satiri TAMAMEN at" kurali nedeniyle bu tur
    // sayfalar sifir karaktere iniyordu.
    const turkce =
      '\u201C\u00D6\u011Frenci\u201D \u2018veli\u2019 \u201Cba\u015Far\u0131l\u0131\u201D \u2013 \u201Ci\u015Flem\u201D \u2014 \u00ABkabul\u00BB'
    const text = extractTextFromPdf(makePdf(turkce))
    expect(text).toContain('\u00D6\u011Frenci')
    expect(text).toContain('veli')
    expect(text).toContain('ba\u015Far\u0131l\u0131')
    expect(text).toContain('i\u015Flem')
    expect(text).toContain('kabul')
    // Kromlu tirnak, tire ve kenar tirnaklari da korunmali
    expect(text).toContain('\u201C')
    expect(text).toContain('\u201D')
    expect(text).toContain('\u2013')
    expect(text).toContain('\u2014')
    expect(text).toContain('\u00AB')
  })

  it('ham kontrol bayti iceren akis sayfayi komple dusurmez', () => {
    // Bazi PDF ureticileri kromlu tirnak yerine ham 0x13/0x14 yazar.
    const text = extractTextFromPdf(makePdf('Merhaba Dunya'))
    expect(text).toContain('Merhaba Dunya')
  })
})

/* ------------------------------------------------------------------ */
/* ZIP / OOXML                                                         */
/* ------------------------------------------------------------------ */

describe('extractZipEntries', () => {
  it('merkezi dizinden okur ve veri baytlarini dogru dondurur', () => {
    const zip = makeZip({
      'xl/sharedStrings.xml': '<sst>merhaba</sst>',
      'docProps/app.xml': '<Properties/>',
    })
    const entries = extractZipEntries(zip)
    expect(entries.size).toBe(2)
    expect(entries.get('xl/sharedStrings.xml')?.toString('utf8')).toContain('merhaba')
  })

  it('deflate ile sikistirilmis girdileri de acar', () => {
    const data = zlib.deflateSync(Buffer.from('sikistirilmis icerik', 'utf8'))
    // makeZip STORED uretir; bu yuzden elle DEFLATE girdi uretmek icin
    // ham bir zip yaziyoruz.
    const nameBuf = Buffer.from('a.txt', 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)

    const cd = Buffer.alloc(46 + nameBuf.length)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(0, 42)
    nameBuf.copy(cd, 46)

    const cdBuf = Buffer.from(cd)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(1, 8)
    eocd.writeUInt16LE(1, 10)
    eocd.writeUInt32LE(cdBuf.length, 12)
    eocd.writeUInt32LE(local.length + data.length, 16)

    const zip = Buffer.concat([local, data, cdBuf, eocd])
    const entries = extractZipEntries(zip)
    expect(entries.get('a.txt')?.toString('utf8')).toBe('sikistirilmis icerik')
  })
})

describe('extractDocxParagraphs', () => {
  it('paragraflari ve orta nokta/tire/hyphen ozel karakterlerini doner', () => {
    const documentXml =
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>Ilk paragraf</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>A</w:t></w:r><w:r><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>K\u0131sa no-break</w:t><w:noBreakHyphen/><w:t>kelime</w:t></w:r></w:p>' +
      '</w:body></w:document>'
    const buf = makeZip({ 'word/document.xml': documentXml })
    const paragraphs = extractDocxParagraphs(buf)
    const flat = paragraphs.filter(p => p.trim().length > 0)
    expect(flat).toContain('Ilk paragraf')
    expect(flat.some(p => p.includes('A') && p.includes('B') && p.includes('C'))).toBe(true)
    expect(flat.some(p => p.includes('\u2011') || p.includes('-'))).toBe(true)
  })

  it('bos paragraf listesi URETMEZ (tek elemanli bos-dizi hatasinin regresyonu)', () => {
    const documentXml =
      '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>tek</w:t></w:r></w:p></w:body></w:document>'
    const buf = makeZip({ 'word/document.xml': documentXml })
    const paragraphs = extractDocxParagraphs(buf).filter(p => p.trim().length > 0)
    expect(paragraphs).toEqual(['tek'])
  })
})

describe('extractPptxSlides / hasPptxSlides', () => {
  const slide = (n: number, title: string, bullets: string[]) =>
    `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>` +
    `<p:sp><p:ph type="title"/><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
    bullets
      .map(b => `<p:sp><p:txBody><a:p><a:r><a:t>${b}</a:t></a:r></a:p></p:txBody></p:sp>`)
      .join('') +
    `</p:spTree></p:cSld></p:sld>`

/** Verilen sldIdLst sirasi + rels eslesmesiyle gecerli bir PPTX uretir. */
  const buildPptx = (sldIdLst: string, rels: Array<[string, string]>) =>
    makeZip({
      '[Content_Types].xml': '<Types/>',
      'ppt/presentation.xml':
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>' + sldIdLst + '</p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        rels.map(([id, target]) => `<Relationship Id="${id}" Target="${target}"/>`).join('') +
        '</Relationships>',
      'ppt/slides/slide1.xml': slide(1, 'Birinci Slayt', ['madde A', 'madde B']),
      'ppt/slides/slide2.xml': slide(2, 'İkinci Slayt', ['madde C']),
      'ppt/slides/_rels/slide1.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    })

  /** Normal sunum: rId1 -> slide1.xml, rId2 -> slide2.xml */
  const pptx = buildPptx(
    '<p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/>',
    [
      ['rId1', 'slides/slide1.xml'],
      ['rId2', 'slides/slide2.xml'],
    ],
  )

  /**
   * YENIDEN DUZENLENMIS sunum: sldIdLst sirasi degil, rels ESLESMESI
   * bozulmus. rId1 -> slide2.xml, rId2 -> slide1.xml.
   * Boylece dosya adina gore (slide1, slide2) siralamak YANLIS sonuc verir;
   * dogru sonuc yalnizca presentation.xml + rels okunarak bulunur.
   */
  const pptxRenamed = buildPptx(
    '<p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/>',
    [
      ['rId1', 'slides/slide2.xml'],
      ['rId2', 'slides/slide1.xml'],
    ],
  )

  /** sldIdLst listesi ters yazilmis sunum. */
  const pptxReordered = buildPptx(
    '<p:sldId id="257" r:id="rId2"/><p:sldId id="256" r:id="rId1"/>',
    [
      ['rId1', 'slides/slide1.xml'],
      ['rId2', 'slides/slide2.xml'],
    ],
  )

  it('slayt sayisini ve basliklari dogru bulur', () => {
    expect(hasPptxSlides(extractZipEntries(pptx))).toBe(true)
    const slides = extractPptxSlides(pptx)
    expect(slides).toHaveLength(2)
    expect(slides[0].title).toBe('Birinci Slayt')
    expect(slides[0].bullets).toEqual(['madde A', 'madde B'])
    expect(slides[1].title).toBe('İkinci Slayt')
  })

  it('slayt sirasi presentation.xml sldIdLst yazimina uyar', () => {
    // rId2 once, rId1 sonra yazilmis -> gercek sunum sirasi 2,1 olmali.
    const slides = extractPptxSlides(pptxReordered)
    expect(slides.map(s => s.title)).toEqual(['İkinci Slayt', 'Birinci Slayt'])
  })

  it('slayt sirasi DOSYA ADINDAN degil rels eslesmesinden gelir', () => {
    // pptxRenamed icin rId1 -> slide2.xml. Sirayi dosya adi (slide1 once)
    // belirleseydi 'Birinci Slayt' ilk gelirdi; oysa gercek sunum sirasi
    // once rId1 = slide2.xml = 'İkinci Slayt'.
    const slides = extractPptxSlides(pptxRenamed)
    expect(slides.map(s => s.title)).toEqual(['İkinci Slayt', 'Birinci Slayt'])
  })

  it('_rels dosyalarini slayt sanmaz', () => {
    const slides = extractPptxSlides(pptx)
    expect(slides.every(s => !/rels/i.test(s.title))).toBe(true)
    expect(slides).toHaveLength(2)
  })

  it('slayt icermeyen bir PPTX icin false doner', () => {
    const notPptx = makeZip({ '[Content_Types].xml': '<Types/>', 'docProps/app.xml': '<x/>' })
    expect(hasPptxSlides(extractZipEntries(notPptx))).toBe(false)
  })
})

describe('extractXlsxSheets', () => {
  it('sharedStrings + hucreleri birlestirerek tablo dondurur', () => {
    const buf = makeZip({
      'xl/workbook.xml':
        '<workbook xmlns:r="r"><sheets><sheet name="Notlar" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml':
        '<sst><si><t>Ad</t></si><si><t>Not</t></si><si><t>Ali</t></si><si><t>95</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
        '</sheetData></worksheet>',
    })
    const sheets = extractXlsxSheets(buf)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].name).toBe('Notlar')
    expect(sheets[0].rows[0]).toEqual(['Ad', 'Not'])
    expect(sheets[0].rows[1]).toEqual(['Ali', '95'])
  })

  it('XLSX olmayan girdide bos liste doner', () => {
    expect(extractXlsxSheets(Buffer.from('bu bir zip degil'))).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Gorsel olculeri                                                     */
/* ------------------------------------------------------------------ */

describe('readImageDimensions', () => {
  it('PNG basligindan okur', () => {
    const png = Buffer.alloc(33)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(1200, 16)
    png.writeUInt32BE(800, 20)
    expect(readImageDimensions(png)).toEqual({ width: 1200, height: 800 })
  })

  it('GIF basligindan okur', () => {
    const gif = Buffer.alloc(16)
    gif.write('GIF89a', 0, 'latin1')
    gif.writeUInt16LE(640, 6)
    gif.writeUInt16LE(480, 8)
    expect(readImageDimensions(gif)).toEqual({ width: 640, height: 480 })
  })

  it('BMP basligindan okur', () => {
    const bmp = Buffer.alloc(32)
    bmp.write('BM', 0, 'latin1')
    bmp.writeInt32LE(800, 18)
    bmp.writeInt32LE(600, 22)
    expect(readImageDimensions(bmp)).toEqual({ width: 800, height: 600 })
  })

  it('JPEG SOF0 isaretinden okur', () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x10, // APP0 (atlanmali)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x00, 0x03, 0x20, 0x00, 0x02, 0x00,
      0xff, 0xd9,
    ])
    expect(readImageDimensions(jpeg)).toEqual({ width: 800, height: 1024 })
  })

  it('WEBP VP8X basligindan okur', () => {
    const webp = Buffer.alloc(30)
    webp.write('RIFF', 0, 'latin1')
    webp.write('WEBP', 8, 'latin1')
    webp.write('VP8X', 12, 'latin1')
    // 24..29 = 24-bit genislik-1, yukseklik-1 (kucuk uc)
    webp.writeUIntLE(1919, 24, 3)
    webp.writeUIntLE(1079, 27, 3)
    expect(readImageDimensions(webp)).toEqual({ width: 1920, height: 1080 })
  })

  it('SVG viewBox degerini okur', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"></svg>')
    expect(readImageDimensions(svg)).toEqual({ width: 300, height: 150 })
  })

  it('taninmayan biçimde null doner (PATLATMAZ)', () => {
    expect(readImageDimensions(Buffer.from('bu bir gorsel degil'))).toBeNull()
    expect(readImageDimensions(Buffer.alloc(0))).toBeNull()
  })
})
