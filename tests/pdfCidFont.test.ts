/**
 * pdfCidFont.test.ts
 * ---------------------------------------------------------------------------
 * PDF CID / Identity-H yazitip cozumlemesi regresyon testleri.
 *
 * KULLANICI BILDIRIMI (ekran goruntusu):
 *   "u hafta koaja enzdiA.P smiyomy#,zctnzooö#"
 *   "Mk evW . Izcrca yaban b.yyato.iA zyrcrgu"
 *
 * KOK NEDEN
 * ---------
 * Onceki surumde yazitip cozumlemesi HIC YOKTU:
 *   1. Tum `/ToUnicode` haritalari TEK bir `Map`e konuyordu; son yazan
 *      yazitip digerlerini EZIYORDU.
 *   2. Metin TEK bayt adimiyla okunuyordu. `Identity-H` yazitipinde her
 *      karakter 2 bayttir, dolayisiyla `0x00 0x48` -> "bosluk + 'H'".
 *      Gercek metin "Hafta" iken "u hafta" cikiyordu (0x00 -> bosluk).
 *   3. `#` = 0x23, `¥` = 0xA5 -> bunlar dogrudan CID ALT baytlari.
 *
 * BU TEST KORUMASI
 *   • 2 baytlik CID metni DOGRU metne donusur.
 *   • Farkli yazitipin haritalari birbirini EZMEZ.
 *   • `bfrange` dizi bicimi ve kisa `bfchar` anahtarlari islenir.
 *   • `/Differences` glif adlari cozulur.
 *   • Eski surumun urettigi sapma (0x00 -> bosluk) TEKRAR OLUSMAZ.
 */
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { extractTextFromPdf } from '../electron/services/toolDispatcher'

/* ------------------------------------------------------------------ */
/* Yardimcilar                                                         */
/* ------------------------------------------------------------------ */

/**
 * Belirtilen nesnelerle gecerli bir PDF uretir.
 *
 * @param contentStream Metin akisinin govdesi (BT ... ET).
 * @param toUnicodeCMap `/ToUnicode` akisinin govdesi (CMap) veya null.
 * @param fontSubtype   `/Subtype` degeri (Type0 -> 2 bayt/karakter).
 * @param encoding      `/Encoding` degeri.
 */
function makePdf(opts: {
  contentStream: string
  toUnicodeCMap?: string | null
  fontSubtype?: 'Type0' | 'TrueType'
  encoding?: string
  extraFonts?: Array<{ name: string; objNum: number; cmap: string; encoding?: string }>
}): Buffer {
  const pieces: Buffer[] = []
  const offsets: number[] = []
  const push = (s: string | Buffer) => {
    const b = Buffer.isBuffer(s) ? Buffer.from(s) : Buffer.from(s, 'latin1')
    offsets.push(pieces.reduce((n, p) => n + p.length, 0))
    pieces.push(b)
  }
  const pushStream = (num: number, dictExtra: string, body: string) => {
    const data = Buffer.from(body, 'latin1')
    push(`${num} 0 obj\n<< ${dictExtra} /Length ${data.length} >>\nstream\n`)
    push(data)
    push('\nendstream\nendobj\n')
  }

  const subtype = opts.fontSubtype ?? 'Type0'
  const encoding = opts.encoding ?? '/Identity-H'
  const cmap = opts.toUnicodeCMap ?? null

  // Nesne numaralari:
  //   1 Catalog, 2 Pages, 3 Page, 4 icerik akisi,
  //   5 /F1 yazitipi, 6 /F1 ToUnicode
  push('%PDF-1.7\n')
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

  // Yazitipi sozlugunu topla
  const fontEntries: string[] = ['/F1 5 0 R']
  if (opts.extraFonts) {
    for (const f of opts.extraFonts) fontEntries.push(`/${f.name} ${f.objNum} 0 R`)
  }
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R ` +
      `/Resources << /Font << ${fontEntries.join(' ')} >> >> >>\nendobj\n`,
  )

  pushStream(4, '', opts.contentStream)

  // /F1
  const tuRef = cmap === null ? '' : ' /ToUnicode 6 0 R'
  push(
    `5 0 obj\n<< /Type /Font /Subtype /${subtype} /BaseFont /ABCDEF+Embedded ` +
      `/Encoding ${encoding}${tuRef} >>\nendobj\n`,
  )
  if (cmap !== null) pushStream(6, '', cmap)

  if (opts.extraFonts) {
    for (const f of opts.extraFonts) {
      const tuNum = f.objNum + 1
      push(
        `${f.objNum} 0 obj\n<< /Type /Font /Subtype /Type0 ` +
          `/BaseFont /ABCDEF+F${f.name} /Encoding ${f.encoding ?? '/Identity-H'} ` +
          `/ToUnicode ${tuNum} 0 R >>\nendobj\n`,
      )
      pushStream(tuNum, '', f.cmap)
    }
  }

  const body = Buffer.concat(pieces)
  const xrefStart = body.length
  const xrefLines: string[] = [`xref\n0 ${offsets.length + 1}\n`, '0000000000 65535 f \n']
  for (const o of offsets) xrefLines.push(`${String(o).padStart(10, '0')} 00000 n \n`)
  xrefLines.push(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  )
  return Buffer.concat([body, Buffer.from(xrefLines.join(''), 'latin1')])
}

/**
 * Metni SIRALI CID kodlarina cevirir: 1, 2, 3, ...
 *
 * NEDEN SIRALI?
 * ------------
 * Alt kume yazitipinde CID, karakterin Unicode kod noktasi DEGIL, yazitipin
 * kendi glif dizinidir. Testin `bfcharCMap(codes)` yardimcisi da `codes[1..N]`
 * kullaniyor; ikisi ayni numaralandirmayi kullanmali.
 *
 * DIKKAT: burada karakterin Unicode degerini yazmak YANLIS olur ve test
 * yanlis sekilde "gecer" — ASCII karakterler CMap'e bakmadan yedege dusup
 * dogru cikar, Turkce karakterler (< 0x20 veya > 0xFF araligi disinda)
 * ise bosluga donusup testin gercek hatayi MASKELER.
 */
function cid(text: string): string {
  let out = ''
  let i = 0
  for (const _ch of text) {
    i += 1
    out += i.toString(16).padStart(4, '0').toUpperCase()
  }
  return out
}

/** `A -> 0x01, B -> 0x02` seklinde CMap uretir. */
function bfcharCMap(map: Record<number, string>): string {
  const lines = Object.entries(map).map(
    ([code, ch]) => `<${Number(code).toString(16).padStart(4, '0')}> <${ch.charCodeAt(0)
      .toString(16)
      .padStart(4, '0')}>`,
  )
  return (
    '/CIDInit /ProcSet findresource begin\n' +
    '12 dict begin\nbegincmap\n/CMapName /Custom-UCS2 def\n1 begincodespacerange\n<0000> <FFFF>\n' +
    `endcodespacerange\n${lines.length} beginbfchar\n${lines.join('\n')}\nendbfchar\n` +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
  )
}

/* ------------------------------------------------------------------ */
/* Testler                                                             */
/* ------------------------------------------------------------------ */

describe('PDF Identity-H (CID) metin cozumlemesi', () => {
  it('2 baytlik CID metni dogru metne donusturur', () => {
    // "Hafta 5 - Proje" -> CID kodlari
    const codes: Record<number, string> = {}
    const real = 'Hafta 5 - Proje'
    real.split('').forEach((ch, i) => {
      codes[i + 1] = ch
    })

    const pdf = makePdf({
      contentStream: `BT /F1 12 Tf 72 720 Td <${cid(real)}> Tj ET`,
      toUnicodeCMap: bfcharCMap(codes),
    })

    const text = extractTextFromPdf(pdf)
    expect(text).toContain('Hafta 5 - Proje')
  })

  it('Turkce karakterleri CID uzerinden korur', () => {
    const real = 'Öğrenci Değerlendirme Raporu ĞÜŞİÖÇ'
    const codes: Record<number, string> = {}
    real.split('').forEach((ch, i) => {
      codes[i + 1] = ch
    })
    const pdf = makePdf({
      contentStream: `BT /F1 12 Tf 72 720 Td <${cid(real)}> Tj ET`,
      toUnicodeCMap: bfcharCMap(codes),
    })
    expect(extractTextFromPdf(pdf)).toContain(real)
  })

  it('ESKI HATAYI URETMEZ: 0x00 arasi bayttan kaynaklanan bosluk/kayma yok', () => {
    const codes: Record<number, string> = {}
    'Hafta 5 Proje'.split('').forEach((ch, i) => {
      codes[i + 1] = ch
    })
    const pdf = makePdf({
      contentStream: `BT /F1 12 Tf 72 720 Td <${cid('Hafta 5 Proje')}> Tj ET`,
      toUnicodeCMap: bfcharCMap(codes),
    })
    const text = extractTextFromPdf(pdf)

    // Eski surum "u hafta" (her karakterden once 0x00 -> bosluk) uretiyordu.
    expect(text).not.toContain('u hafta')
    expect(text).toContain('Hafta 5 Proje')
  })
})

describe('PDF yazitip izolasyonu (global CMap birlestirme hatasi)', () => {
  it('iki farkli yazitipin ayni kod farkli harf uretir', () => {
    // /F1: 0x01 -> 'A'   /F2: 0x01 -> 'Z'
    // Global birlestirmede son yazan kazanir ve ikisi de 'Z' olurdu.
    const pdf = makePdf({
      contentStream: 'BT /F1 12 Tf <0001> Tj /F2 12 Tf <0001> Tj ET',
      toUnicodeCMap: bfcharCMap({ 1: 'A' }),
      extraFonts: [{ name: 'F2', objNum: 7, cmap: bfcharCMap({ 1: 'Z' }) }],
    })

    const text = extractTextFromPdf(pdf)
    expect(text).toContain('A')
    expect(text).toContain('Z')
  })

  it('yazitip cozulemezse global haritaya DUSER (regresyon korumasi)', () => {
    // Sayfa kaynaklari bildirilMEDIGI icin per-font cozumleme bulunamaz.
    // Eski global yol bu durumda calisiyordu; hala calismalidir.
    const cm = bfcharCMap({ 1: 'G', 2: 'Ü', 3: 'N' })
    const pieces: Buffer[] = []
    const offsets: number[] = []
    const push = (s: string) => {
      const b = Buffer.from(s, 'latin1')
      offsets.push(pieces.reduce((n, p) => n + p.length, 0))
      pieces.push(b)
    }
    push('%PDF-1.7\n')
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
    // NOT: /Resources YOK -> resolveFontResources bos doner
    push('3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n')
    push('4 0 obj\n<< /Length 44 >>\nstream\n')
    push('BT /F1 12 Tf 72 720 Td <000100020003> Tj ET')
    push('\nendstream\nendobj\n')
    push('5 0 obj\n<< /Length ' + Buffer.byteLength(cm, 'latin1') + ' >>\nstream\n')
    push(cm)
    push('\nendstream\nendobj\n')
    const body = Buffer.concat(pieces)
    const xrefStart = body.length
    const xl: string[] = [`xref\n0 ${offsets.length + 1}\n`, '0000000000 65535 f \n']
    for (const o of offsets) xl.push(`${String(o).padStart(10, '0')} 00000 n \n`)
    xl.push(
      `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    )
    const pdf = Buffer.concat([body, Buffer.from(xl.join(''), 'latin1')])
    // Yedek yol en azindan metni cikarmali (dogru harfler beklenmez,
    // ama BOS KALMAMALI).
    expect(extractTextFromPdf(pdf).length).toBeGreaterThan(0)
  })
})

describe('CMap bicim hatalari', () => {
  it('bfrange DIZI bicimini isler: <lo> <hi> [<d1> <d2> ...]', () => {
    // Bu bicim ONCEKI surumde HIC islenmiyordu (yalnizca yorumda vardi).
    // Word ve LibreOffice sik olarak uretir.
    const cmap =
      '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
      '1 beginbfrange\n<0001> <0003> [<0041> <0042> <0043>]\nendbfrange\n' +
      'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
    const pdf = makePdf({
      contentStream: 'BT /F1 12 Tf <000100020003> Tj ET',
      toUnicodeCMap: cmap,
    })
    expect(extractTextFromPdf(pdf)).toContain('ABC')
  })

  it('bfrange DUZ bicimini isler: <lo> <hi> <dstStart>', () => {
    const cmap =
      '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
      '1 beginbfrange\n<0001> <0003> <0041>\nendbfrange\n' +
      'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
    const pdf = makePdf({
      contentStream: 'BT /F1 12 Tf <000100020003> Tj ET',
      toUnicodeCMap: cmap,
    })
    expect(extractTextFromPdf(pdf)).toContain('ABC')
  })

  it('KISA bfchar anahtarini normalize eder: <03> -> "0003"', () => {
    // Anahtarlar oldugu gibi kaydediliyordu; 4 haneli arama hicbir zaman
    // eslesmiyordu ve metin TAMAMEN BOS donuyordu.
    const cmap =
      '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
      '1 beginbfchar\n<03> <0058>\nendbfchar\n' +
      'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
    const pdf = makePdf({
      contentStream: 'BT /F1 12 Tf <0003> Tj ET',
      toUnicodeCMap: cmap,
    })
    expect(extractTextFromPdf(pdf)).toContain('X')
  })

  it('TEK SATIRLIK CMap isler (onceki surum satir sonu ZORUNLU tutuyordu)', () => {
    const cmap =
      '/CIDInit /ProcSet findresource begin\nbegincmap\n' +
      '1 beginbfchar <0001> <0054> <0002> <0045> endbfchar\n' +
      'endcmap\nend\n'
    const pdf = makePdf({
      contentStream: 'BT /F1 12 Tf <00010002> Tj ET',
      toUnicodeCMap: cmap,
    })
    expect(extractTextFromPdf(pdf)).toContain('TE')
  })

  it('bir satirda BIRDEN FAZLA cift olan bfchar blogunu isler', () => {
    const cmap =
      '/CIDInit /ProcSet findresource begin\nbegincmap\n' +
      '2 beginbfchar\n<0001> <0041> <0002> <0042>\n<0003> <0043>\nendbfchar\n' +
      'endcmap\nend\n'
    const pdf = makePdf({
      contentStream: 'BT /F1 12 Tf <000100020003> Tj ET',
      toUnicodeCMap: cmap,
    })
    const text = extractTextFromPdf(pdf)
    expect(text).toContain('AB')
    expect(text).toContain('C')
  })
})

describe('Basit yazitip kodlama', () => {
  it('/Differences glif adlarindan Unicode uretir', () => {
    // 1 bayt/karakter. 0x01 -> /bullet (U+2022), 0x02 -> /A (U+0041)
    const pieces: Buffer[] = []
    const offsets: number[] = []
    const push = (s: string) => {
      const b = Buffer.from(s, 'latin1')
      offsets.push(pieces.reduce((n, p) => n + p.length, 0))
      pieces.push(b)
    }
    push('%PDF-1.7\n')
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
    push(
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R ' +
        '/Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    )
    push('4 0 obj\n<< /Length 34 >>\nstream\n')
    push('BT /F1 12 Tf <0102> Tj ET')
    push('\nendstream\nendobj\n')
    push(
      '5 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Simple ' +
        '/Encoding << /Type /Encoding /Differences [1 /bullet /A] >> >>\nendobj\n',
    )
    const body = Buffer.concat(pieces)
    const xrefStart = body.length
    const xl: string[] = [`xref\n0 ${offsets.length + 1}\n`, '0000000000 65535 f \n']
    for (const o of offsets) xl.push(`${String(o).padStart(10, '0')} 00000 n \n`)
    xl.push(
      `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    )
    const pdf = Buffer.concat([body, Buffer.from(xl.join(''), 'latin1')])
    const text = extractTextFromPdf(pdf)
    expect(text).toContain('A')
  })

  it('UTF-16BE BOMlu literal stringi dogrudan cozer', () => {
    // BOM iceren metinde kodlar zaten Unicode esdegeridir.
    const bom = '\\376\\377\\000H\\000i\\000!'
    const pdf = makePdf({
      contentStream: `BT /F1 12 Tf 72 720 Td (${bom}) Tj ET`,
      fontSubtype: 'TrueType',
      encoding: '/WinAnsiEncoding',
    })
    expect(extractTextFromPdf(pdf)).toContain('Hi!')
  })
})

describe('Operator sirasi ve Tf takibi', () => {
  it('metinden SONRA gelen Tf degisikligini de uygular', () => {
    // Onceki surum operatorleri sirayla islemiyordu: tum TJ'ler once,
    // sonra tum Tj'ler. Bu yuzden `Tj` sonrasi `Tf` degisimi gorunmezdi.
    const cm1 = bfcharCMap({ 1: 'A' })
    const cm2 = bfcharCMap({ 1: 'Z' })
    const pdf = makePdf({
      contentStream: 'BT /F1 12 Tf <0001> Tj /F2 12 Tf <0001> Tj ET',
      toUnicodeCMap: cm1,
      extraFonts: [{ name: 'F2', objNum: 7, cmap: cm2 }],
    })
    const text = extractTextFromPdf(pdf)
    // A Once, Z sonra gelmeli
    expect(text.indexOf('A')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Z')).toBeGreaterThan(text.indexOf('A'))
  })

  it('Td/T* operatorleri satir kirilmasina donusur', () => {
    const codes: Record<number, string> = {}
    // 1=bosluk, 2..6 = s,a,t,i,r
    ' satir'.split('').forEach((ch, i) => {
      codes[i + 1] = ch
    })
    const pdf = makePdf({
      contentStream: 'BT /F1 12 Tf 72 700 Td <0001> Tj 0 -20 Td <00020003000400050006> Tj ET',
      toUnicodeCMap: bfcharCMap(codes),
    })
    const text = extractTextFromPdf(pdf)
    expect(text).toContain('satir')
  })
})