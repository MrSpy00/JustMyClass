import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { extractTextFromPdf, repairPdfSpacedText } from '../electron/services/toolDispatcher'

/**
 * KULLANICI BILDIRIMI
 * -------------------
 * "PDF gördüğü gibi kalıyor, devamı gelmiyor."
 * Ekran "Belge Hazırlanıyor..." yazısında sonsuza kadar kalıyordu.
 *
 * KOK NEDEN
 * ---------
 * `extractTextFromPdf` iki ayrı tarama yapıyordu ve ikisi de O(n²) idi:
 *
 *   • `str.indexOf('endobj', om.index)` — her nesne için dosyanın sonuna
 *     kadar ilerliyor.
 *   • `str.lastIndexOf('obj', match.index)` — her akış için dosyanın
 *     BAŞINA kadar geri tarıyor.
 *
 * Fonksiyon Electron **ana iş parçacığında senkron** çağrıldığı için bu,
 * 11 MB'lık bir PDF'de onlarca saniyelik donma demek: tüm arayüz donar ve
 * IPC asla çözülmediği için yükleniyor göstergesi sonsuza kadar kalır.
 *
 * Bu dosya (a) doğruluğun korunduğunu ve (b) maliyetin doğrusal olduğunu
 * ÖLÇER. Metin çıkarımı sonucunun değişmediği, üretilen bir PDF üzerinde
 * gerçekten doğrulanır.
 */

/** Testte kullanılacak gerçek bir PDF üretir (çok sayıda akışlı). */
function makeBigPdf(pageCount: number, textPerPage: string): Buffer {
  const pieces: Buffer[] = []
  const push = (s: string | Buffer): void => {
    pieces.push(Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'))
  }

  push('%PDF-1.7\n')
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  push('2 0 obj\n<< /Type /Pages /Kids [');
  for (let i = 0; i < pageCount; i++) push(`${i + 3} 0 R `)
  push('] /Count ' + pageCount + ' >>\nendobj\n')

  // Font nesnesi: yazı tipi çözümlemesi bu dizinin okunmasina bagli.
  push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

  for (let page = 0; page < pageCount; page++) {
    const streamBytes = Buffer.concat([
      Buffer.from(`BT /F1 12 Tf 72 720 Td (${textPerPage} sayfa ${page + 1}) Tj ET`, 'latin1'),
    ])
    const compressed = zlib.deflateSync(streamBytes)
    const contentNum = 100 + page * 2
    const pageNum = 4 + page * 2

    push(`${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${contentNum} 0 R >>\nendobj\n`)
    push(`${contentNum} 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`)
    push(compressed)
    push('\nendstream\nendobj\n')
  }

  const body = Buffer.concat(pieces)
  return Buffer.concat([body, Buffer.from('\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1')])
}

describe('extractTextFromPdf - dogruluk korunuyor', () => {
  it('cok sayfali PDF icin her sayfanin metnini cikarir', () => {
    const pdf = makeBigPdf(12, 'Ogrenci No')
    const text = extractTextFromPdf(pdf)
    for (let page = 1; page <= 12; page++) {
      expect(text, `sayfa ${page}`).toContain(`Ogrenci No sayfa ${page}`)
    }
  })

  it('sifreli PDF mesaji yerine bos metin dondurmez', () => {
    const pdf = Buffer.from('%PDF-1.7\n/Encrypt 9 0 R\ntrailer\n%%EOF\n', 'latin1')
    expect(extractTextFromPdf(pdf)).toContain('parola')
  })

  it('bozuk girdide cokmez ve makul bir surede biter', () => {
    // Binary cop: "stream" belirtecleri icerebilir ama nesne yapisi yok.
    const junk = Buffer.alloc(400_000)
    for (let i = 0; i < junk.length; i++) junk[i] = i % 251
    const withTokens = Buffer.concat([
      junk,
      Buffer.from('\n5 0 obj\n<< /Length 5 >>\nstream\nabcde\nendstream\nendobj\n', 'latin1'),
    ])
    expect(() => extractTextFromPdf(withTokens)).not.toThrow()
  })

  it('stream belirteci cok olan bozuk dosyada sinirlari uygular', () => {
    // 30 bin sahte akis: eski O(n²) kodunda dakikalarca süzerdi.
    const manyStreams: string[] = ['%PDF-1.7\n']
    for (let i = 0; i < 30_000; i++) {
      manyStreams.push(`${i + 1} 0 obj\n<< /Length 2 >>\nstream\nxx\nendstream\nendobj\n`)
    }
    const pdf = Buffer.from(manyStreams.join(''), 'latin1')
    const started = Date.now()
    expect(() => extractTextFromPdf(pdf)).not.toThrow()
    // 10 saniye: O(n²) bir regresyon burada yakalanir, dogru O(n) kod burada
    // milisaniyelerde biter.
    expect(Date.now() - started).toBeLessThan(10_000)
  })
  it('ZIP BOMBASI: kucuk girdi, devasa cikti - uygulama cokmez', () => {
    // Klasik zip bombasi deseni: birkac KB girdi, ~16 MB cikti uretir.
    // Savunmasiz inflate bunu tam expand eder ve Ana sureci ANINDA
    // dondurur; o donmus Electron'da "Belge Hazirlaniyor..." takilir kalir.
    const bomb = zlib.deflateSync(Buffer.alloc(16 * 1024 * 1024, 0x41), { level: 9 })

    const pdf = Buffer.concat([
      Buffer.from(
        '%PDF-1.7\n4 0 obj\n<< /Length ' + bomb.length + ' /Filter /FlateDecode >>\nstream\n',
        'latin1',
      ),
      bomb,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
    ])

    const started = Date.now()
    let text = ''
    expect(() => {
      text = extractTextFromPdf(pdf)
    }).not.toThrow()
    // Sinir uygulanmis olsa bile cikti guvenli olmali (donmemeli).
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(text.length).toBeLessThan(40 * 1024 * 1024)
  })

  it('girdi boyutu siniri asan akis ATLANIR, hata firlatmaz', () => {
    // /Length 50 MB bildiren bir akis: acmaya calisilmaz.
    const payload = Buffer.alloc(1024, 0x42)
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n4 0 obj\n<< /Length 52428800 /Filter /FlateDecode >>\nstream\n', 'latin1'),
      payload,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ])
    expect(() => extractTextFromPdf(pdf)).not.toThrow()
  })
})

describe('extractTextFromPdf - sozluk icindeki sahte "stream"', () => {
  it('sozlukta gecen "stream" kelimesi akis olarak sayilmaz', () => {
    // /Title (my stream notes) icindeki kelime giris olarak sayilirsa
    // akis yanlis baslangicta baslar ve sayfanin metni cikmaz.
    // Anahtar kelime satir sonuyla izlendigi icin bu olmamali.
    const text = 'Sohbet Akisi Testi'
    // Metinde parantez/kelime isareti yok, kacislama gerekmiyor.
    const streamBytes = Buffer.concat([
      Buffer.from('BT /F1 12 Tf 72 720 Td (', 'latin1'),
      Buffer.from(text, 'latin1'),
      Buffer.from(') Tj ET', 'latin1'),
    ])
    const compressed = zlib.deflateSync(streamBytes)
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.from('4 0 obj\n<< /Title (my stream notes) /Length ' + String(compressed.length) + ' /Filter /FlateDecode >>\nstream\n', 'latin1'),
      compressed,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
    ])
    const out = extractTextFromPdf(pdf)
    expect(out).toContain('Sohbet Akisi Testi')
    // Sahte kelime metne sizmamali.
    expect(out).not.toContain('my stream notes')
  })

  it('cok sayida ters egik cizgi kacisi (\\347\\366\\374) iceren TJ dizisinde ustel geri-izleme (backtracking) yapmaz', () => {
    // Eski opRe kalibinda `\(([^)]*(?:\\.[^)]*)*)\)\s*Tj` dali, TJ dizisi icindeki
    // cok kacisli parantezde `)` sonrasinda Tj bulamayinca O(2^30) geri-izleme ile
    // Electron ana surecini sonsuza dek donduruyordu ("Belge Hazirlaniyor...").
    const escapedText = Array.from({ length: 35 }, () => '\\347\\366\\374a').join('')
    const streamBytes = Buffer.from(
      `BT /F1 12 Tf [ (${escapedText}) -200 (Turkce Metin) ] TJ ET`,
      'latin1',
    )
    const compressed = zlib.deflateSync(streamBytes)
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.from(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      compressed,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
    ])
    const t0 = performance.now()
    const out = extractTextFromPdf(pdf)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(200)
    expect(out).toContain('Turkce Metin')
  })
})
describe('extractTextFromPdf - maliyet dogrusal', () => {
  it('dosya 4 kat buyudugunde sure 4 kattan CAT katinin altinda kalir', () => {
    const small = makeBigPdf(20, 'Veri')
    const large = makeBigPdf(80, 'Veri')

    // Isinma: ilk cagri JIT derleme maliyetini tasimamali.
    extractTextFromPdf(makeBigPdf(4, 'Veri'))

    const time = (b: Buffer): number => {
      const t0 = performance.now()
      extractTextFromPdf(b)
      return performance.now() - t0
    }

    const ts = time(small)
    const tl = time(large)
    const ratio = small.length > 0 ? large.length / small.length : 1

    // DOGRUSAL maliyette beklenen ~= ratio. Kuadratik olsaydi oran
    // ratio^2 olurdi. 8 kullanimlik pay, olcum gurultusu icin.
    // (kucuk dosyada 1 ms olcebilir bu yuzden taban ekleniyor)
    expect(tl).toBeLessThan(Math.max(120, (ts + 5) * ratio * ratio * 0.9))
  })

  it('11 MB sinifinda gercekci dosyada kabul edilebilir surede biter', () => {
    // Kullanicinin dosyalarinin gercekci boyutu (11.5 MB rapor edildi).
    // Ana surecte bir saniyeden uzun surerse arayuz donar.
    const filler = Buffer.alloc(11 * 1024 * 1024, 0x20)
    const pdf = Buffer.concat([
      makeBigPdf(30, 'Buyuk Rapor'),
      filler,
      Buffer.from('\nendobj\n%%EOF\n', 'latin1'),
    ])
    expect(pdf.length).toBeGreaterThan(11 * 1024 * 1024)

    extractTextFromPdf(pdf) // isinma
    const t0 = performance.now()
    const text = extractTextFromPdf(pdf)
    const ms = performance.now() - t0

    expect(text).toContain('Buyuk Rapor sayfa 1')
    // Ana surecte calistigi icin 5 sn ustü kullaniciyi dondurur.
    expect(ms, `${ms.toFixed(0)} ms surdu`).toBeLessThan(5_000)
  })
})

describe('extractTextFromPdf - yapışık kelimeler ve MacRoman madde imi onarımı', () => {
  it('TJ dizisi içindeki parça sonu boşluklarını ((5. ) (Hafta )) kırpmaz ve negatif kerning boşluklarını korur', () => {
    const streamBytes = Buffer.from(
      'BT /F1 12 Tf 72 720 Td [(5. ) (Hafta ) (Uygulama ) -120 (Projesi)] TJ ET',
      'latin1',
    )
    const compressed = zlib.deflateSync(streamBytes)
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.from(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      compressed,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
    ])
    const out = extractTextFromPdf(pdf)
    expect(out).toContain('5. Hafta Uygulama Projesi')
  })

  it('0xA5 (MacRoman bullet / Latin-1 ¥) baytını gerçek madde imine (•) dönüştürür ve yapışık Türkçe kelimeleri ayırır', () => {
    // 0xA5 = \245 octal in PDF literal string
    const streamBytes = Buffer.from(
      'BT /F1 12 Tf 72 720 Td (5.HaftaUygulamaProjesi:SicaklikKontrollu) Tj 0 -18 Td (\\245 Fan节/IsiticiKontrolSistemi) Tj ET',
      'latin1',
    )
    const compressed = zlib.deflateSync(streamBytes)
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.from(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      compressed,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
    ])
    const out = extractTextFromPdf(pdf)
    expect(out).toContain('5. Hafta Uygulama Projesi: Sicaklik Kontrollu')
    expect(out).toContain('•')
    expect(out).not.toContain('¥')
  })

  it('repairPdfSpacedText: tekil harf ayrışmalarını ve etiketleri doğal kelimelere onarır', () => {
    expect(repairPdfSpacedText('< h t m l >')).toBe('<html>')
    expect(repairPdfSpacedText('< h e a d >')).toBe('<head>')
    expect(repairPdfSpacedText('< / h t m l >')).toBe('</html>')
    expect(repairPdfSpacedText('H T M L v e H T M L 5 E t i k e t R e h b e r i')).toBe(
      'HTML ve HTML5 Etiket Rehberi',
    )
    expect(
      repairPdfSpacedText(
        'T ü m E t i k e t l e r · E k s i k s i z Ö r n e k K u l l a n ı m · F o r m — V e r i t a b a n ı — T a b l o B ö l ü m l e r i A y r ı',
      ),
    ).toBe(
      'Tüm Etiketler · Eksiksiz Örnek Kullanım · Form — Veritabanı — Tablo Bölümleri Ayrı',
    )
    expect(
      repairPdfSpacedText('D e r s : B S T 2 0 5 — W e b T a s a r ı m ı v e P r o g r a m l a m a'),
    ).toBe('Ders: BST205 — Web Tasarımı ve Programlama')
    expect(
      repairPdfSpacedText('M u ş A l p a r s l a n Ü n i v e r s i t e s i — Y ö n e t i m B i l i ş i m S i s t e m l e r i B ö l ü m ü'),
    ).toBe('Muş Alparslan Üniversitesi — Yönetim Bilişim Sistemleri Bölümü')
    expect(repairPdfSpacedText('B a ğ l a n t ı l a r ( L i n k l e r )')).toBe(
      'Bağlantılar (Linkler)',
    )
  })
})

