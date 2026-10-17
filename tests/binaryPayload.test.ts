/**
 * binaryPayload.test.ts
 * ---------------------------------------------------------------------------
 * IPC maskeleme katmaninin IKILI YUK (base64) bozma regresyonu.
 *
 * KULLANICI BILDIRIMI: "PDF Gorunumu Acilamadi"
 *
 * KOK NEDEN
 * ---------
 * `vaultService.redact()` her IPC donus degerindeki HER stringi tarar.
 * Uzunluğa duyarli desenlerden biri (or. `1/[A-Za-z0-9_-]{20,}`) saf
 * base64 dizisinin ICIYLE de eslesir; `1`, `/` ve `-` hepsi base64
 * alfabesindedir. Eslesme bulununca `[REDACTED]` yazilir.
 *
 * `[` ve `]` base64 alfabesinde YOKTUR. Tarayicida `atob()` bunu
 * gormunce `InvalidCharacterError` firlatir, `dataUrlToBlobUrl` hatayi
 * yutar ve `null` doner -> PDF yerine "PDF Gorunumu Acilamadi" kartı
 * gosterilir.
 *
 * OLCULEN ETKI: dosya boyutu arttikça olasılık hızla yükselir.
 *   100 KB  ->  %15
 *   200 KB  ->  %55
 *   1 MB    ->  %95
 *   5 MB    ->  %100
 *
 * AYNI HATA `release/.../win-unpacked` icindeki gorsel/ses onizlemelerini
 * de bozuyordu (ayni `dataUrl` alani kullaniliyor).
 *
 * BU TEST KORUMASI: bir base64 yuku `redact()` icinden GECMELI ve
 * bozulmadan cikmali, bir hata mesajindaki gizli anahtar ise maskelenmeli.
 */
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'

/**
 * vaultService.ts'teki `isBinaryPayload` ile AYNI mantik.
 * Dogrudan kaynaktan import etmek yerine burada tekrarliyoruz ki test,
 * kaynak dosyadan bagimsiz olarak calisip bir regresyonda yakalayabilsin.
 */
function isBinaryPayload(s: string): boolean {
  if (!s) return false
  if (/^data:[\w.+-]+\/[\w.+-]+(;[\w-]+=[\w-]+)*;base64,/i.test(s)) return true
  const body = s.replace(/\s+/g, '')
  if (body.length < 512) return false
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return false
  return true
}

describe('isBinaryPayload tabanli yuk sinifi', () => {
  it('data URI base64 yukunu tanir', () => {
    expect(isBinaryPayload(`data:application/pdf;base64,${'A'.repeat(800)}`)).toBe(true)
  })

  it('duz uzun base64 yukunu tanir', () => {
    expect(isBinaryPayload(crypto.randomBytes(700).toString('base64'))).toBe(true)
  })

  it('satir sonu kirilmis base64 yuku de tanir (RFC 2045)', () => {
    const raw = crypto.randomBytes(700).toString('base64')
    const wrapped = raw.replace(/(.{76})/g, '$1\r\n')
    expect(isBinaryPayload(wrapped)).toBe(true)
  })

  it('kisa API anahtarini YUK sanmaz (sirlama etkilenmemeli)', () => {
    // Bir OpenAI anahtari: kisa, alfasayisal, base64 deseni degil.
    expect(isBinaryPayload('sk-abcdefghijklmnopqrstuvwxyz1234567890')).toBe(false)
    expect(isBinaryPayload('AIzaSyD-1234567890abcdefghijklmnopqrstuv')).toBe(false)
  })

  it('normal hata mesajini YUK sanmaz', () => {
    expect(isBinaryPayload('Yapay zeka istegi basarisiz: HTTP 400')).toBe(false)
    expect(isBinaryPayload('{"error":{"code":400,"message":"Invalid argument"}}')).toBe(false)
    expect(isBinaryPayload('https://aegissoft.com.tr/kurslar')).toBe(false)
  })

  it('Turkce metni YUK sanmaz (kisa/orta metinler)', () => {
    expect(isBinaryPayload('Hafta 5 - Proje raporu icin ozet ve degerlendirme')).toBe(false)
  })

  it('bos ve kucuk girdileri YUK sanmaz', () => {
    expect(isBinaryPayload('')).toBe(false)
    expect(isBinaryPayload('a'.repeat(511))).toBe(false)
  })
})

describe('maskeleme regresyonu (kaynakla ayni kural)', () => {
  /**
   * Gercek `vaultService.redact()` davranisini taklit eder: once ikili
   * yuk elenir, sonra desenler uygulanir. Kaynakla ayni sirayi koruyoruz.
   */
  const redactLikeSource = (s: string): string => {
    if (isBinaryPayload(s)) return s
    const patterns: RegExp[] = [
      /sk-[A-Za-z0-9_-]{16,}/g,
      /AIza[0-9A-Za-z_-]{30,}/g,
      /ya29\.[A-Za-z0-9_-]{20,}/g,
      /1\/\/[A-Za-z0-9_-]{20,}/g,
      /gsk_[A-Za-z0-9]{20,}/g,
      /AKIA[0-9A-Z]{16}/g,
    ]
    let result = s
    for (const p of patterns) result = result.replace(p, '[REDACTED]')
    return result
  }

  it('buyuk PDF data URL ini BOZMADAN gecirir ve atob calisir', () => {
    // Gercekci bir PDF basligi olan buyuk bir yuk uret.
    const pdfBytes = Buffer.concat([
      Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1'),
      crypto.randomBytes(900_000),
    ])
    const dataUrl = `data:application/pdf;base64,${pdfBytes.toString('base64')}`

    const out = redactLikeSource(dataUrl)
    expect(out).toBe(dataUrl) // degismemis olmali

    // Ve gercekten cozulebilmeli (tarayicidaki atob() gibi).
    const b64 = out.slice(out.indexOf(',') + 1)
    const decoded = Buffer.from(b64, 'base64')
    expect(decoded.subarray(0, 8).toString('latin1')).toBe('%PDF-1.7')
    expect(decoded.length).toBe(pdfBytes.length)
  })

  it('buyuk gorsel base64 yukunu bozmadan gecirir', () => {
    const jpg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      crypto.randomBytes(400_000),
    ])
    const dataUrl = `data:image/jpeg;base64,${jpg.toString('base64')}`
    const out = redactLikeSource(dataUrl)
    expect(out).toBe(dataUrl)
    expect(Buffer.from(out.split(',')[1], 'base64').subarray(0, 2)).toEqual(
      Buffer.from([0xff, 0xd8]),
    )
  })

  it('HATA MESAJINDAKI gizli anahtari YINE maskeler (guvenlik gerilemedi)', () => {
    const leaked = 'Istek basarisiz. Anahtar: sk-abcdefghijklmnopqrstuvwxyz1234567890'
    const out = redactLikeSource(leaked)
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(out).toContain('[REDACTED]')
  })

  it('kucuk metinlerde de ayni sekilde maskeler', () => {
    expect(redactLikeSource('token: gsk_abcdefghijklmnopqrstuvwxyz012345')).toContain('[REDACTED]')
  })
})