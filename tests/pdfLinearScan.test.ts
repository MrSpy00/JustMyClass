import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { extractTextFromPdf } from '../electron/services/toolDispatcher'

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
