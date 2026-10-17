/**
 * docxTableAndLinks.test.ts
 * ---------------------------------------------------------------------------
 * Belge onizleme katmaninin YENI yetenekleri icin regresyon testleri:
 *
 *   1) DOCX cok satirlı tablolar (her `<w:tr>` ayri satir, bos hucreler,
 *      `gridSpan` / `vMerge`)
 *   2) DOCX kopyru hedefleri (`w:hyperlink r:id` -> `document.xml.rels`)
 *   3) PPTX kopyru hedefleri (`a:hlinkClick r:id` -> `slideN.xml.rels`)
 *   4) Dil tespiti (uzanti / ozel dosya adi / icerikten tahmin)
 *   5) PDF / DOCX / PPTX TEMEL METIN CIKARMA regresyonu
 *
 * `tests/documentExtraction.test.ts` ile paylasilan yardimci yoktur; ZIP
 * uretici ve CRC32 bu dosyada yerel kopyalaridir (cift tanim sorunu olmasin).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import Prism from 'prismjs'
import {
  extractDocxBlocks,
  extractDocxParagraphs,
  extractPptxSlides,
  extractXlsxSheets,
  detectLanguage,
  sniffLanguage,
  parseRelationships,
  extractOoxmlBlocks,
  LANGUAGE_BY_EXTENSION,
  LANGUAGE_BY_FILENAME,
} from '../electron/services/filePreviewService'
import { extractTextFromDocx, extractTextFromPptx, extractTextFromPdf } from '../electron/services/toolDispatcher'
import {
  installedPrismLanguages,
  loadPrismComponent,
  modalPrismAliases,
  modalPrismImports,
} from './helpers/prismLanguageCatalog'

/* ------------------------------------------------------------------ */
/* Yardimcilar                                                         */
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

/** Tek dosyalik, STORED (sikistirmasiz) gecerli bir ZIP uretir. */
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
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
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
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(e.crc, 16)
    cd.writeUInt32LE(e.data.length, 20)
    cd.writeUInt32LE(e.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(0, 42)
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

const RELS_HEAD =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'

/* ------------------------------------------------------------------ */
/* 0) extractOoxmlBlocks: etiket alternatifi gruplama regresyonu        */
/* ------------------------------------------------------------------ */

describe('extractOoxmlBlocks - coklu etiket gruplama', () => {
  it('kendi kendini kapatan ALT etiketler hucreleri birbirine katmaz', () => {
    // ONCEKI HATA: `w:tcW .../` kendini kapatan bir ALT etiket. Etiket
    // alternatifi gruplanmadigi icin `<w:tc` olarak sayiliyor ve hucre,
    // kendi `</w:tc>` etiketinden sonra ikinci hucreyi de yutuyordu.
    const row =
      '<w:tr>' +
      '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>' +
      '</w:tr>'

    const blocks = extractOoxmlBlocks(row, ['w:tc', 'table:table-cell'])
    expect(blocks).toHaveLength(2)
    expect(blocks[0].inner).toContain('A1')
    expect(blocks[0].inner).not.toContain('B1')
    expect(blocks[1].inner).toContain('B1')
  })

  it('kendi kendini kapatan satir ozelligi satirlari kaybettirmez', () => {
    // `<w:trHeight .../>` de `<w:tr` onekini paylasir.
    const table =
      '<w:tbl>' +
      '<w:tr><w:trPr><w:trHeight w:val="567"/></w:trPr>' +
      '<w:tc><w:p><w:r><w:t>s1</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>s2</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl>'

    const rows = extractOoxmlBlocks(table, ['w:tr'])
    expect(rows).toHaveLength(2)
    expect(rows[0].inner).toContain('s1')
    expect(rows[1].inner).toContain('s2')
  })

  it('blok konumlarini (start/innerEnd/end) dogru verir', () => {
    const xml = '<w:p>abc</w:p>'
    const [block] = extractOoxmlBlocks(xml, ['w:p'])
    expect(xml.slice(block.start, block.end)).toBe('<w:p>abc</w:p>')
    expect(xml.slice(block.start, block.innerEnd)).toBe('<w:p>abc')
    expect(xml.slice(block.innerEnd, block.end)).toBe('</w:p>')
    expect(block.inner).toBe('abc')
  })
})

/* ------------------------------------------------------------------ */
/* 1) DOCX cok satirlı tablo                                          */
/* ------------------------------------------------------------------ */

describe('extractDocxBlocks - cok satirlı tablo', () => {
  /** Gercekci bir hucre: `<w:tcPr><w:tcW/></w:tcPr>` icerir. */
  const tc = (text: string, tcPr = '<w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>') =>
    `<w:tc>${tcPr}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`
  const tr = (cells: string) => `<w:tr>${cells}</w:tr>`

  const docx = (body: string) =>
    makeZip({
      'word/document.xml':
        '<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
        body +
        '</w:body></w:document>',
    })

  it('her w:tr ayri bir satır, her w:tc ayrı bir hücre olarak döner', () => {
    const body =
      '<w:tbl>' +
      tr(tc('Ad') + tc('Not')) +
      tr(tc('Ali') + tc('95')) +
      tr(tc('Veli') + tc('88')) +
      '</w:tbl>'
    const blocks = extractDocxBlocks(docx(body))
    expect(blocks).toHaveLength(1)
    const table = blocks[0]
    expect(table.type).toBe('table')
    if (table.type !== 'table') throw new Error('tablo degil')
    expect(table.rows).toHaveLength(3)
    expect(table.rows[0]).toEqual(['Ad', 'Not'])
    expect(table.rows[1]).toEqual(['Ali', '95'])
    expect(table.rows[2]).toEqual(['Veli', '88'])
  })

  it('tablo hücreleri birbirine KATILMAZ (regresyon)', () => {
    const body = '<w:tbl>' + tr(tc('A1') + tc('B1')) + tr(tc('A2') + tc('B2')) + '</w:tbl>'
    const blocks = extractDocxBlocks(docx(body))
    const table = blocks[0]
    if (table.type !== 'table') throw new Error('tablo degil')
    // Ilk hucre ikinci satiri YUTMUYORDU
    expect(table.rows[0][0]).toBe('A1')
    expect(table.rows[0][1]).toBe('B1')
    expect(table.rows[1][0]).toBe('A2')
    expect(table.rows[1][1]).toBe('B2')
    // hicbir hucrede yabanci satir metni olmamali
    for (const row of table.rows) {
      for (const cell of row) expect(cell).not.toMatch(/[AB][12][AB][12]/)
    }
  })

  it('bos hücreler korunur ve sütun sayısı satırlar arasında tutarlıdır', () => {
    const body =
      '<w:tbl>' +
      tr(tc('A1') + tc('B1') + tc('C1')) +
      tr(tc('A2') + tc('') + tc('C2')) +
      tr(tc('') + tc('') + tc('C3')) +
      '</w:tbl>'
    const table = extractDocxBlocks(docx(body))[0]
    if (table.type !== 'table') throw new Error('tablo degil')
    expect(table.rows).toHaveLength(3)
    for (const row of table.rows) expect(row).toHaveLength(3)
    expect(table.rows[1]).toEqual(['A2', '', 'C2'])
    expect(table.rows[2]).toEqual(['', '', 'C3'])
  })

  it('gridSpan hücreyi makul bir genişlikte birleştirir (boş sütun ekler)', () => {
    const spanCell =
      '<w:tc><w:tcPr><w:gridSpan w:val="3"/></w:tcPr>' +
      '<w:p><w:r><w:t>Basliklar</w:t></w:r></w:p></w:tc>'
    const body =
      '<w:tbl>' +
      tr(spanCell) +
      tr(tc('A2') + tc('B2') + tc('C2')) +
      '</w:tbl>'
    const table = extractDocxBlocks(docx(body))[0]
    if (table.type !== 'table') throw new Error('tablo degil')
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]).toHaveLength(3)
    expect(table.rows[0][0]).toBe('Basliklar')
    expect(table.rows[0][1]).toBe('')
    expect(table.rows[0][2]).toBe('')
    expect(table.rows[1]).toEqual(['A2', 'B2', 'C2'])
  })

  it('vMerge devam hücresi üst hücreye birleşir, sütun sayısı bozulmaz', () => {
    const restart =
      '<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Ust</w:t></w:r></w:p></w:tc>'
    const cont =
      '<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>Alt</w:t></w:r></w:p></w:tc>'
    const plain = '<w:tc><w:p><w:r><w:t>Diger</w:t></w:r></w:p></w:tc>'
    const body =
      '<w:tbl>' + tr(restart + plain) + tr(cont + plain) + '</w:tbl>'
    const table = extractDocxBlocks(docx(body))[0]
    if (table.type !== 'table') throw new Error('tablo degil')
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]).toHaveLength(2)
    expect(table.rows[1]).toHaveLength(2)
    // ust hucre birlestirilmis metni tasiyor, devam satiri bos
    expect(table.rows[0][0]).toContain('Ust')
    expect(table.rows[0][0]).toContain('Alt')
    expect(table.rows[1][0]).toBe('')
  })

  it('paragraf ve tablo sirayı belge icinde korunur', () => {
    const body =
      '<w:p><w:r><w:t>Onceki paragraf</w:t></w:r></w:p>' +
      '<w:tbl>' + tr(tc('x') + tc('y')) + '</w:tbl>' +
      '<w:p><w:r><w:t>Sonraki paragraf</w:t></w:r></w:p>'
    const blocks = extractDocxBlocks(docx(body))
    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'table', 'paragraph'])
  })

  it('geriye uyumlu extractDocxParagraphs tabloyu satir basina | a | b | olarak verir', () => {
    const body = '<w:tbl>' + tr(tc('A') + tc('B')) + tr(tc('C') + tc('D')) + '</w:tbl>'
    const paragraphs = extractDocxParagraphs(docx(body))
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]).toBe('| A | B |\n| C | D |')
  })
})

/* ------------------------------------------------------------------ */
/* 2) DOCX kopro hedefleri                                            */
/* ------------------------------------------------------------------ */

describe('extractDocxBlocks - kopro hedefleri', () => {
  it('w:hyperlink r:id metni dogru hedefle eslestirir', () => {
    const documentXml =
      '<?xml version="1.0"?><w:document xmlns:w="w" xmlns:r="r"><w:body>' +
      '<w:p><w:r><w:t>Ondalik: </w:t></w:r>' +
      '<w:hyperlink r:id="rId7"><w:r><w:t>JMC dokumanasyonu</w:t></w:r></w:hyperlink>' +
      '</w:p>' +
      '</w:body></w:document>'
    const rels =
      RELS_HEAD +
      '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"' +
      ' Target="https://example.com/docs/jmc" TargetMode="External"/>' +
      '</Relationships>'

    const blocks = extractDocxBlocks(
      makeZip({ 'word/document.xml': documentXml, 'word/_rels/document.xml.rels': rels }),
    )
    expect(blocks).toHaveLength(1)
    const para = blocks[0]
    if (para.type !== 'paragraph') throw new Error('paragraf degil')
    expect(para.text).toContain('JMC dokumanasyonu')
    expect(para.text).toContain('Ondalik:')
    expect(para.url).toBe('https://example.com/docs/jmc')
  })

  it('kaynaga gore filtrelenmis iliskide hedef bulunamazsa url undefined kalir', () => {
    const documentXml =
      '<w:document xmlns:w="w" xmlns:r="r"><w:body>' +
      '<w:p><w:hyperlink r:id="rIdYok"><w:r><w:t>Kirik</w:t></w:r></w:hyperlink></w:p>' +
      '</w:body></w:document>'
    const blocks = extractDocxBlocks(
      makeZip({ 'word/document.xml': documentXml, 'word/_rels/document.xml.rels': RELS_HEAD + '</Relationships>' }),
    )
    const para = blocks[0]
    if (para.type !== 'paragraph') throw new Error('paragraf degil')
    expect(para.text).toBe('Kirik')
    expect(para.url).toBeUndefined()
  })

  it('paragrafta birden fazla kopro varsa ilki kullanilir, metin tam birlesir', () => {
    const documentXml =
      '<w:document xmlns:w="w" xmlns:r="r"><w:body>' +
      '<w:p>' +
      '<w:hyperlink r:id="rId1"><w:r><w:t>bir </w:t></w:r></w:hyperlink>' +
      '<w:r><w:t>ve </w:t></w:r>' +
      '<w:hyperlink r:id="rId2"><w:r><w:t>iki</w:t></w:r></w:hyperlink>' +
      '</w:p></w:body></w:document>'
    const rels =
      RELS_HEAD +
      '<Relationship Id="rId1" Target="https://a.example/" TargetMode="External"/>' +
      '<Relationship Id="rId2" Target="https://b.example/" TargetMode="External"/>' +
      '</Relationships>'
    const blocks = extractDocxBlocks(
      makeZip({ 'word/document.xml': documentXml, 'word/_rels/document.xml.rels': rels }),
    )
    const para = blocks[0]
    if (para.type !== 'paragraph') throw new Error('paragraf degil')
    expect(para.text).toBe('bir ve iki')
    expect(para.url).toBe('https://a.example/')
  })

  it('tablo hücresi içindeki kopro hücre adresine taşınır', () => {
    const documentXml =
      '<w:document xmlns:w="w" xmlns:r="r"><w:body><w:tbl>' +
      '<w:tr>' +
      '<w:tc><w:p><w:r><w:t>Duz</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:hyperlink r:id="rId1"><w:r><w:t>Bagli</w:t></w:r></w:hyperlink></w:p></w:tc>' +
      '</w:tr></w:tbl></w:body></w:document>'
    const rels =
      RELS_HEAD +
      '<Relationship Id="rId1" Target="https://hucre.example/" TargetMode="External"/>' +
      '</Relationships>'
    const table = extractDocxBlocks(
      makeZip({ 'word/document.xml': documentXml, 'word/_rels/document.xml.rels': rels }),
    )[0]
    if (table.type !== 'table') throw new Error('tablo degil')
    expect(table.rows[0]).toEqual(['Duz', 'Bagli'])
    expect(table.cellUrls[0][0]).toBeUndefined()
    expect(table.cellUrls[0][1]).toBe('https://hucre.example/')
  })

  it('harici adres kodlamasi korunur, paket-ici hedefler cozulur', () => {
    const rels = parseRelationships(
      RELS_HEAD +
        '<Relationship Id="rIdA" Target="https://ornek.example/a%20b" TargetMode="External"/>' +
        '<Relationship Id="rIdB" Target="../media/gorsel.png"/>' +
        '<Relationship Id="rIdC" Target="../media/rapor%20sonucu.pdf"/>' +
        '</Relationships>',
      'word',
    )
    // Harici adresler oldugu gibi birakilir (yuzde kodlamasi tarayiciya birakilir).
    expect(rels.get('rIdA')).toBe('https://ornek.example/a%20b')
    // Paket-ici gosterimler mutlak yola cozulur ve yuzde kodlamasi acilir.
    expect(rels.get('rIdB')).toBe('media/gorsel.png')
    expect(rels.get('rIdC')).toBe('media/rapor sonucu.pdf')
  })
})

/* ------------------------------------------------------------------ */
/* 3) PPTX kopro hedefleri                                            */
/* ------------------------------------------------------------------ */

describe('extractPptxSlides - kopro hedefleri', () => {
  const buildPptx = (slideXml: string, slideRels: string) =>
    makeZip({
      '[Content_Types].xml': '<Types/>',
      'ppt/presentation.xml':
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>' +
        '<p:sldId id="256" r:id="rId1"/>' +
        '</p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        RELS_HEAD + '<Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml': slideXml,
      'ppt/slides/_rels/slide1.xml.rels': slideRels,
    })

  it('baslik ve maddeler kendi a:hlinkClick hedeflerini tasir', () => {
    const slideXml =
      '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>' +
      '<p:sp><p:ph type="title"/><p:txBody><a:p>' +
      '<a:r><a:rPr><a:hlinkClick r:id="rId2"/></a:rPr><a:t>Baslik Baglantisi</a:t></a:r>' +
      '</a:p></p:txBody></p:sp>' +
      '<p:sp><p:txBody><a:p>' +
      '<a:r><a:rPr><a:hlinkClick r:id="rId3"/></a:rPr><a:t>Madde Baglantisi</a:t></a:r>' +
      '</a:p>' +
      '<a:p><a:r><a:t>Duz madde</a:t></a:r></a:p>' +
      '</p:txBody></p:sp>' +
      '</p:spTree></p:cSld></p:sld>'
    const slideRels =
      RELS_HEAD +
      '<Relationship Id="rId2" Target="https://baslik.example/" TargetMode="External"/>' +
      '<Relationship Id="rId3" Target="https://madde.example/" TargetMode="External"/>' +
      '</Relationships>'

    const slides = extractPptxSlides(buildPptx(slideXml, slideRels))
    expect(slides).toHaveLength(1)
    expect(slides[0].title).toBe('Baslik Baglantisi')
    expect(slides[0].titleUrl).toBe('https://baslik.example/')
    expect(slides[0].bullets).toEqual(['Madde Baglantisi', 'Duz madde'])
    expect(slides[0].bulletUrls).toEqual(['https://madde.example/', undefined])
  })

  it('kopro yoksa bulletUrls uretilmez (geriye uyum)', () => {
    const slideXml =
      '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>' +
      '<p:sp><p:ph type="title"/><p:txBody><a:p><a:r><a:t>Baslik</a:t></a:r></a:p></p:txBody></p:sp>' +
      '<p:sp><p:txBody><a:p><a:r><a:t>Madde</a:t></a:r></a:p></p:txBody></p:sp>' +
      '</p:spTree></p:cSld></p:sld>'
    const slides = extractPptxSlides(buildPptx(slideXml, RELS_HEAD + '</Relationships>'))
    expect(slides[0].title).toBe('Baslik')
    expect(slides[0].bullets).toEqual(['Madde'])
    expect(slides[0].bulletUrls).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* 4) Dil tespiti                                                      */
/* ------------------------------------------------------------------ */

describe('detectLanguage', () => {
  it('uzantidan dogrudan dogruya dogrulu dil dondurur', () => {
    expect(detectLanguage('a.ts')).toBe('typescript')
    expect(detectLanguage('a.tsx')).toBe('tsx')
    expect(detectLanguage('a.py')).toBe('python')
    expect(detectLanguage('a.vue')).toBe('vue')
    expect(detectLanguage('a.svelte')).toBe('svelte')
    // Prism'de `assembly` diye bir dil YOK; `nasm` dogru hedef
    expect(detectLanguage('a.asm')).toBe('nasm')
    expect(detectLanguage('a.scss')).toBe('scss')
    expect(detectLanguage('a.tf')).toBe('hcl')
    expect(detectLanguage('a.kt')).toBe('kotlin')
    expect(detectLanguage('a.rs')).toBe('rust')
    expect(detectLanguage('a.sol')).toBe('solidity')
  })

  it('uzantisi olmayan / ozel adli dosyalari tanir', () => {
    expect(detectLanguage('Dockerfile')).toBe('docker')
    expect(detectLanguage('dockerfile.prod')).toBe('docker')
    expect(detectLanguage('Makefile')).toBe('make')
    expect(detectLanguage('CMakeLists.txt')).toBe('cmake')
    expect(detectLanguage('.gitignore')).toBe('ignore')
    expect(detectLanguage('.env')).toBe('ini')
  })

  it('bilinmeyen uzantida icerikten dili tahmin eder', () => {
    expect(detectLanguage('veri.unknownext', '<?php echo "merhaba"; ?>')).toBe('php')
    expect(detectLanguage('veri.unknownext', '<!DOCTYPE html><html><body>x</body></html>')).toBe('html')
    expect(detectLanguage('veri.unknownext', 'package main\n\nfunc main() {}')).toBe('go')
    expect(detectLanguage('veri.unknownext', '#include <stdio.h>\nint main(){return 0;}')).toBe('c')
    expect(detectLanguage('veri.unknownext', 'def topla(a, b):\n    return a + b')).toBe('python')
    expect(detectLanguage('veri.unknownext', '<template>\n  <div>{{ x }}</div>\n</template>\n<script>\nexport default {}\n</script>')).toBe('vue')
    expect(detectLanguage('veri.unknownext', '<template>\n  <h1>svelte</h1>\n</template>\n<script>\nlet n = 1;\n</script>')).toBe('svelte')
    expect(detectLanguage('veri.unknownext', '{"ad":"Ali","yas":20}')).toBe('json')
    expect(detectLanguage('veri.unknownext', '#!/bin/bash\nset -e\necho merhaba')).toBe('bash')
    expect(detectLanguage('veri.unknownext', 'FROM node:20\nRUN npm ci\nCMD ["node","x.js"]')).toBe('docker')
    expect(detectLanguage('veri.unknownext', 'using System;\nnamespace X { class Y {} }')).toBe('csharp')
    expect(detectLanguage('veri.unknownext', 'fn main() {\n    let mut x = 1;\n}')).toBe('rust')
  })

  it('hicbir sinyal bulunamazsa text doner (sessizce basarisiz olmaz)', () => {
    expect(detectLanguage('notlar.txt', 'Bugun hava cok guzel ve ruzgarli bir gun')).toBe('text')
    expect(detectLanguage('bos.unknownext', '')).toBe('text')
    expect(sniffLanguage('')).toBe('text')
    expect(detectLanguage('')).toBe('text')
  })

  it('uzanti tespiti icerik tespitine gore onceliklidir', () => {
    // .py dosyasi icinde HTML olsa bile python kazanir
    expect(detectLanguage('a.py', '<!DOCTYPE html><html></html>')).toBe('python')
  })

  it('.md dosyalari kod goruntuleyicisine DUSMEZ (Markdown olarak oynatilir)', () => {
    // Harita markdown'i tanir ama `kind` markdown kalmalidir; bu yuzden
    // markdown uzantilari "Kod Dosyasi" dalindan cikarilir.
    expect(detectLanguage('a.md')).toBe('markdown')
    expect(detectLanguage('a.mdx')).toBe('markdown')
  })
})

/* ------------------------------------------------------------------ */
/* 4b) Prism dil katalogu korumasi ("renklendirme hic calismiyor")    */
/* ------------------------------------------------------------------ */

describe('Prism dil katalogu', () => {
  const modalSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'DocumentViewerModal.tsx'),
    'utf8',
  )
  const installed = new Set(installedPrismLanguages())
  const aliases = modalPrismAliases(modalSource)
  const aliasKeys = new Set(aliases.keys)
  const aliasTargets = new Set(aliases.targets)
  const imported = new Set(modalPrismImports(modalSource))

  const allLanguages = new Set<string>([
    ...Object.values(LANGUAGE_BY_EXTENSION),
    ...Object.values(LANGUAGE_BY_FILENAME),
  ])

  it('haritadaki HER dil ya Prism bileseni ya da arayuz takma adidir', () => {
    const orphans: string[] = []
    for (const lang of allLanguages) {
      if (lang === 'text') continue
      if (installed.has(lang) || aliasKeys.has(lang) || aliasTargets.has(lang)) continue
      orphans.push(lang)
    }
    // ONCEKI HATA: `.asm` -> `assembly` gibi Prism'de dosyasi OLMAYAN
    // degerler haritadaydi ve arayuz sessizce duz metne dusiyordu.
    expect(orphans).toEqual([])
  })

  it('haritadaki HER yuklenebilir dil arayuzde import edilmis olmali', () => {
    const missing: string[] = []
    for (const lang of allLanguages) {
      if (lang === 'text') continue
      if (!installed.has(lang)) continue
      if (!imported.has(lang)) missing.push(lang)
    }
    // Import edilmeden bir dil haritada olmak, o dil icin sessiz duz metin
    // demektir. Katalog `prismjs/components/` klasorunden turetildigi icin
    // bu test yeni bir dil eklendiginde kirmizi olur.
    expect(missing).toEqual([])
  })

  it('asagidaki diller gercekten yüklenip renklendirme üretiyor', () => {
    const sample: Array<[string, string]> = [
      ['typescript', 'const a: number = 1'],
      ['nasm', 'mov eax, 1'],
      ['lua', 'local x = 1'],
      ['powershell', 'Get-ChildItem'],
      ['batch', 'echo hello'],
      ['docker', 'FROM node:20'],
      ['makefile', 'all:\n\techo hi'],
      ['hcl', 'resource "aws_s3_bucket" "b" {}'],
      ['diff', '- old\n+ new'],
    ]
    for (const [lang, code] of sample) {
      expect(loadPrismComponent(lang), `${lang} yuklenemedi`).toBe(true)
    }
    // `Prism.languages` global nesnesi: yukleme sonrasi anahtarlar dolmali.
    const languages = (Prism.languages as unknown as Record<string, unknown>)
    for (const [lang] of sample) {
      expect(languages[lang], `Prism.languages.${lang} tanimsiz`).toBeTruthy()
    }
    // Onceki surumde tanimsiz kalan diller
    expect(languages.vue).toBeUndefined()
    expect(languages.svelte).toBeUndefined()
    expect(languages.assembly).toBeUndefined()
  })

  it('Prism 1.30 vue/svelte icin gramer sunmaz; arayuz markup yedeğine düşmeli', () => {
    // Bu bir KATALOG GERCEGI: degistirilirse test kirmizi olur ve
    // PRISM_ALIASES'in markup yedegi guncellenmelidir.
    expect(installed.has('vue')).toBe(false)
    expect(installed.has('svelte')).toBe(false)
    expect(aliasTargets.has('markup')).toBe(true)
  })

  it('arayuzdeki import SIRASIyla yuklenince her dil gercekten cozumlenir', () => {
    // Bu test, tarayicida gercekleseyen seyi node'da taklit eder:
    // DocumentViewerModal'in import listesindeki SIRAYLA tum bilesenleri
    // yukler ve haritadaki her dilin `Prism.languages[<ad>]` anahtarinin
    // doldugunu dogrular. Boylece (a) eksik bilesen, (b) yanlis sira
    // (bagimlilik once yuklenmedi) ve (c) sahte dil adi yakalanir.
    const languages = Prism.languages as unknown as Record<string, unknown>
    for (const id of modalPrismImports(modalSource)) {
      loadPrismComponent(id)
    }

    const unresolvable: string[] = []
    for (const lang of allLanguages) {
      if (lang === 'text') continue
      if (languages[lang]) continue
      if (aliasKeys.has(lang) && languages[aliasTargetsFor(lang)]) continue
      unresolvable.push(lang)
    }
    expect(unresolvable).toEqual([])
  })

  function aliasTargetsFor(key: string): string {
    const block = /const PRISM_ALIASES[^=]*=\s*\{([\s\S]*?)\n\}/.exec(modalSource)
    if (!block) return ''
    const re = new RegExp(`^\\s*'?${key}'?\\s*:\\s*'([^']+)'`, 'im')
    return re.exec(block[1])?.[1] ?? ''
  }
})

/* ------------------------------------------------------------------ */
/* 5) TEMEL METIN CIKARMA REGRESYONU                                  */
/* ------------------------------------------------------------------ */

describe('temel metin cikarma regresyonu', () => {
  it('DOCX paragraflari + toolDispatcher yedegi ayni metni verir', () => {
    const documentXml =
      '<w:document xmlns:w="w"><w:body>' +
      '<w:p><w:r><w:t>Merhaba Dunya</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Ikinci paragraf</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Son</w:t></w:r></w:p>' +
      '</w:body></w:document>'
    const buf = makeZip({ 'word/document.xml': documentXml })
    const paragraphs = extractDocxParagraphs(buf).filter(p => p.trim().length > 0)
    expect(paragraphs).toEqual(['Merhaba Dunya', 'Ikinci paragraf', 'Son'])
    // toolDispatcher'in kaba regex yedegi de icerigi bulmaya devam etmeli
    expect(extractTextFromDocx(buf)).toContain('Merhaba Dunya')
  })

  it('PPTX slayt/madde metni degismiyor, yalnizca kopro hedefi eklendi', () => {
    const slideXml =
      '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>' +
      '<p:sp><p:ph type="title"/><p:txBody><a:p><a:r><a:t>Baslik</a:t></a:r></a:p></p:txBody></p:sp>' +
      '<p:sp><p:txBody><a:p><a:r><a:t>madde A</a:t></a:r></a:p>' +
      '<a:p><a:r><a:t>madde B</a:t></a:r></a:p></p:txBody></p:sp>' +
      '</p:spTree></p:cSld></p:sld>'
    const buf = makeZip({
      '[Content_Types].xml': '<Types/>',
      'ppt/slides/slide1.xml': slideXml,
      'ppt/slides/_rels/slide1.xml.rels': RELS_HEAD + '</Relationships>',
    })
    const slides = extractPptxSlides(buf)
    expect(slides).toHaveLength(1)
    expect(slides[0].title).toBe('Baslik')
    expect(slides[0].bullets).toEqual(['madde A', 'madde B'])
    expect(extractTextFromPptx(buf)).toContain('madde A')
  })

  it('XLSX okuma etkilenmedi', () => {
    const buf = makeZip({
      'xl/workbook.xml':
        '<workbook xmlns:r="r"><sheets><sheet name="Notlar" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        RELS_HEAD + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Ad</t></si><si><t>Not</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c>' +
        '<c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>',
    })
    const sheets = extractXlsxSheets(buf)
    expect(sheets[0].name).toBe('Notlar')
    expect(sheets[0].rows[0]).toEqual(['Ad', 'Not'])
  })

  it('inlineStr hucreleri artik okunuyor (cift etiket gruplama duzeltmesi)', () => {
    const buf = makeZip({
      'xl/workbook.xml':
        '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        RELS_HEAD + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1">' +
        '<c r="A1" t="inlineStr"><is><t>Satir ici</t></is></c>' +
        '</row></sheetData></worksheet>',
    })
    const sheets = extractXlsxSheets(buf)
    expect(sheets[0].rows[0][0]).toBe('Satir ici')
  })

  it('PDF metin cikarimi etkilenmedi', () => {
    // documentExtraction.test.ts'deki PDF yardimcisinin sadelestirilmis hali
    const zlib = require('node:zlib')
    const stream = zlib.deflateSync(
      Buffer.from('BT /F1 12 Tf 72 720 Td (Merhaba Dunya) Tj ET', 'latin1'),
    )
    const pieces: Buffer[] = []
    const offsets: number[] = []
    const push = (s: string | Buffer) => {
      const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')
      offsets.push(pieces.reduce((n, x) => n + x.length, 0))
      pieces.push(b)
    }
    push('%PDF-1.7\n')
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
    push('3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n')
    push('4 0 obj\n<< /Length ')
    push(Buffer.from(String(stream.length), 'latin1'))
    push(' /Filter /FlateDecode >>\nstream\n')
    push(stream)
    push('\nendstream\nendobj\n')
    const body = Buffer.concat(pieces)
    const xrefStart = body.length
    const xref = [`xref\n0 ${offsets.length + 1}\n`, '0000000000 65535 f \n']
    for (const o of offsets) xref.push(`${String(o).padStart(10, '0')} 00000 n \n`)
    xref.push(
      `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    )
    const pdf = Buffer.concat([body, Buffer.from(xref.join(''), 'latin1')])
    expect(extractTextFromPdf(pdf)).toContain('Merhaba Dunya')
  })
})
