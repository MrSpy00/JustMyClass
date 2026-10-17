/**
 * clickableText.test.ts
 * ---------------------------------------------------------------------------
 * Baglanti yakalama ve guvenlik testleri.
 *
 * KULLANICI BILDIRIMI
 *   "linkler duz metin olarak duruyor", ekran goruntusunde sohbete yazilan
 *   `aegissoft.com.tr` adresi TIKLANAMAZ duz metin olarak kalmisti.
 *
 * COZUMUN KAPSAMI
 *   Onceki desen yalnizca `https://`, `http://` ve `www.` ile baslayan
 *   adresleri yakaliyordu. Yaylisiz alan adlari (`aegissoft.com.tr`) ve
 *   `mailto:` adresleri HICBIR ZAMAN yakalanmiyordu.
 *
 * BU TEST KORUMASI
 *   • Yaylisiz alan adlari yakalanir
 *   • Dosya adi / surum numarasi YANLIS POZITIF olmaz
 *   • Tehlikeli semalar (`javascript:`, `data:`, `vbscript:`) reddedilir
 */
import { describe, it, expect } from 'vitest'
import { findUrls, isSafeExternalUrl, toOpenableUrl } from '../src/components/ClickableText'

/** Bulunan ilk adresi dondurur (yoksa null). */
const first = (text: string): string | null => findUrls(text)[0]?.url ?? null

/** Bulunan tum adresleri dondurur. */
const all = (text: string): string[] => findUrls(text).map(u => u.url)

describe('findUrls — semali adresler', () => {
  it('https adresini yakalar', () => {
    expect(first('bkz: https://example.com/a/b?c=1')).toBe('https://example.com/a/b?c=1')
  })

  it('http adresini yakalar', () => {
    expect(first('http://example.org')).toBe('http://example.org')
  })

  it('www adresini yakalar', () => {
    expect(first('www.example.com')).toBe('www.example.com')
  })

  it('mailto adresini yakalar', () => {
    expect(first('bana e-posta: odev@example.com')).toBe('mailto:odev@example.com')
  })

  it('YouTube watch adresini tam olarak yakalar', () => {
    expect(first('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
  })

  it('birden fazla adresi sirayla yakalar', () => {
    expect(all('aegissoft.com.tr ve github.com/x/y')).toEqual(['aegissoft.com.tr', 'github.com/x/y'])
  })
})

describe('findUrls — yaylisiz alan adlari (ASIL DUVZELTME)', () => {
  it('kullanici senaryosundaki adresi yakalar', () => {
    expect(first('aegissoft.com.tr araştır özetle')).toBe('aegissoft.com.tr')
  })

  it('yol iceren yaylisiz adresi yakalar', () => {
    expect(first('github.com/aegissoft/justmyclass sayfasina bak')).toBe(
      'github.com/aegissoft/justmyclass',
    )
  })

  it('iki harfli ulke uzantisini yakalar (.tr)', () => {
    expect(first('site.com.tr')).toBe('site.com.tr')
  })

  it('uc noktali cok etiketli adresi yakalar', () => {
    expect(first('docs.google.com/spreadsheets/d/abc')).toBe('docs.google.com/spreadsheets/d/abc')
  })

  it('YouTube yaylisiz bicimini yakalar', () => {
    expect(first('youtube.com/watch?v=abc123')).toBe('youtube.com/watch?v=abc123')
  })

  it('nokta ile biten cumle icinde yakalar', () => {
    expect(first('Detaylar icin aegissoft.com.tr.')).toBe('aegissoft.com.tr')
  })
})

describe('findUrls — YANLIS POZITIF korumalari', () => {
  it('dosya uzantilarini adres saymaz', () => {
    expect(first('index.html dosyasini ac')).toBeNull()
    expect(first('main.ts dosyasi')).toBeNull()
    expect(first('rapor.pdf icindekiler')).toBeNull()
    expect(first('styles.css duzenlendi')).toBeNull()
    expect(first('veri.json yuklendi')).toBeNull()
    expect(first('sunum.pptx eklendi')).toBeNull()
    expect(first('tablo.xlsx acildi')).toBeNull()
    expect(first('foto.jpg ve video.mp4')).toBeNull()
  })

  it('surum numaralarini adres saymaz', () => {
    expect(first('sistem surumu 1.5 ile calisiyor')).toBeNull()
    expect(first('versiyon v2.0 cikti')).toBeNull()
    expect(first('2024.1 guncellemesi')).toBeNull()
  })

  it('tek noktali ifadeleri adres saymaz', () => {
    expect(first('bkz. bu konu')).toBeNull()
    expect(first('vb. devam')).toBeNull()
    expect(first('orn. su kodu')).toBeNull()
  })

  it('sadece rakam iceren etiketleri adres saymaz', () => {
    expect(first('123.456 adet')).toBeNull()
  })

  it('kod icindeki nesne.alan atamalarini (this.ad = ad) adres saymaz', () => {
    expect(first('this.ad = ad; this.fiyat = fiyat;')).toBeNull()
    expect(first('self.id = 42')).toBeNull()
    expect(first('urun.ad = "Elma"')).toBeNull()
    expect(first('nesne.io(param)')).toBeNull()
  })
})

describe('findUrls — sondaki isaretler', () => {
  it('virgul ve noktali virgulu keser', () => {
    expect(first('https://example.com/a, b')).toBe('https://example.com/a')
    expect(first('aegissoft.com.tr; sonra')).toBe('aegissoft.com.tr')
  })

  it('uzgun kapanis parantezini adresin parcasi saymaz', () => {
    // Wikipedia tarzi: parantezli basliklar
    expect(first('(https://en.wikipedia.org/wiki/Ankara_(disambiguation))')).toBe(
      'https://en.wikipedia.org/wiki/Ankara_(disambiguation)',
    )
  })
})

describe('isSafeExternalUrl — guvenlik', () => {
  it('http, https ve mailto kabul eder', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('mailto:a@b.com')).toBe(true)
    expect(isSafeExternalUrl('www.example.com')).toBe(true)
    expect(isSafeExternalUrl('aegissoft.com.tr')).toBe(true)
  })

  it('tehlikeli semalari REDDEDER (XSS vektoru)', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('JavaScript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeExternalUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
  })
})

describe('toOpenableUrl', () => {
  it('yaylisiz adrese https:// ekler', () => {
    expect(toOpenableUrl('aegissoft.com.tr')).toBe('https://aegissoft.com.tr')
    expect(toOpenableUrl('www.example.com')).toBe('https://www.example.com')
  })

  it('mevcut semayi korur', () => {
    expect(toOpenableUrl('https://example.com')).toBe('https://example.com')
    expect(toOpenableUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
  })
})

describe('findUrls — konum bilgisi', () => {
  it('baslangic ve bitis indeksleri metinle tutarlidir', () => {
    const text = 'Lutfen aegissoft.com.tr adresine bakin'
    const hit = findUrls(text)[0]
    expect(hit).toBeDefined()
    expect(text.slice(hit!.start, hit!.end)).toBe('aegissoft.com.tr')
  })

  it('bos metni cokertmez', () => {
    expect(findUrls('')).toEqual([])
  })
})

import {
  extractYouTubeVideosFromText,
  getYouTubeEmbedUrl,
  getYouTubeThumbnailUrl,
  parseYouTubeUrl,
} from '../src/lib/youtube'

describe('YouTube hafif uygulama içi oynatıcı ayrıştırıcısı (src/lib/youtube.ts)', () => {
  it('watch, youtu.be, shorts, embed ve şemasız youtube.com bağlantılarını tanır', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toEqual({
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s',
      startSeconds: 90,
    })
    expect(parseYouTubeUrl('youtube.com/shorts/abc123XYZ_-')?.videoId).toBe('abc123XYZ_-')
    expect(parseYouTubeUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')?.videoId).toBe(
      'dQw4w9WgXcQ',
    )
    expect(parseYouTubeUrl('https://aegissoft.com.tr')).toBeNull()
  })

  it('metin içindeki benzersiz YouTube videolarını çıkarır ve gizlilik dostu nocookie embed üretir', () => {
    const videos = extractYouTubeVideosFromText(
      'Ders videosu: https://youtu.be/dQw4w9WgXcQ ve tekrar https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    expect(videos).toHaveLength(1)
    expect(videos[0].videoId).toBe('dQw4w9WgXcQ')
    expect(getYouTubeEmbedUrl('dQw4w9WgXcQ', { autoplay: true, startSeconds: 45 })).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1&autoplay=1&start=45',
    )
    expect(getYouTubeThumbnailUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })
})