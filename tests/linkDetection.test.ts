import { describe, it, expect } from 'vitest'
import { findUrls } from '../src/components/ClickableText'
import { isRealTld, countRealTlds } from '../src/lib/tldList'

/**
 * Kullanici bildirimi:
 *   "Bazi link olmayan seyler de link gibi gozukuyo, mesela
 *    linkgib.linkler bu link algilaniyor."
 *
 * Sebep: son etiketin "2-24 harf" olmasi yeterli sayiliyordu; IANA
 * listesine bakilmadigi icin uydurma uzantilar da adres sayiliyordu.
 */

/** Bir adresin kac kez bulundugunu dondurur. */
function countOf(text: string, needle: string): number {
  return findUrls(text).filter(u => u.url.includes(needle)).length
}

describe('tldList', () => {
  it('IANA listesinin tamamini yukler', () => {
    // KAYNAK: https://data.iana.org/TLD/tlds-alpha-by-domain.txt
    // Bu deger, `scripts/tlds.txt` IANA'dan son kez indirildigindeki
    // gercek sayi. Daha kucuk bir sayi, listenin YARIM indirildigini
    // ve `.ai` gibi gTLD'lerin kayboldugunu gosterir; bu bir kez olmustur.
    expect(countRealTlds()).toBeGreaterThanOrEqual(1400)
    expect(countRealTlds()).toBeLessThan(2000)
  })

  it('gercek ust duzeyleri kabul eder', () => {
    for (const tld of ['com', 'tr', 'edu', 'gov', 'org', 'net', 'io', 'ai', 'dev', 'app', 'zip']) {
      expect(isRealTld(tld), tld).toBe(true)
    }
  })

  it('uydurma ust duzeyleri reddeder', () => {
    // Bunlar Turkce metinde siklikle gecen, IANA listesinde YER ALMAYAN
    // kelimeler. Kullanicinin "linkgib.linkler" seklindeki bildiriminin
    // ozeti: bunlar adres sayilmamali.
    for (const tld of ['links', 'linkler', 'adres', 'baglanti', 'baglantilari', 'siteler', 'sayfa', 'xyzzy']) {
      expect(isRealTld(tld), tld).toBe(false)
    }
  })

  it('GERCEK TLD oldugu halde bakisi ozetlemeye calisan uzantilari kabul eder', () => {
    // Bu bir hata degil, IANA'nin gercegi: `.link` (Google), `.domains`
    // ve `.site` (Donuts) gecerli ust duzeylerdir. Sonradan "mantikli
    // gorundugu" icin bunlari sansal olarak reddetmek, gercek adresleri
    // bozardi. Test, bu ayrimin BILINCLI oldugunu sabitler.
    for (const tld of ['link', 'domains', 'site', 'dev', 'app']) {
      expect(isRealTld(tld), tld).toBe(true)
    }
  })

  it('buyuk/kucuk harf ve bos girdiye dayaniklidir', () => {
    expect(isRealTld('COM')).toBe(true)
    expect(isRealTld('Tr')).toBe(true)
    expect(isRealTld('')).toBe(false)
    expect(isRealTld('  ')).toBe(false)
  })

  it('ilk ve son kayit dahil liste butunlugu saglar', () => {
    // "Dilim siniri bosluk kaybi" hatasinda ilk ve son kelimeler kaybolurdu
    // ve iki kelime birlisip sahte bir ust duzey olusuyordu. Uct nokta
    // burada dosyanin tam olarak uretilip uretilmedigini sabitler.
    expect(isRealTld('aaa')).toBe(true) // alfabetik ilk
    expect(isRealTld('zw')).toBe(true) // alfabetik son
    expect(countRealTlds()).toBe(1437) // IANA listesinin tamami
  })

  it('hicbir sanal ust duzey kazara listelenmemis', () => {
    for (const fake of ['linkler', 'links', 'adres', 'baglanti', 'siteler']) {
      expect(isRealTld(fake), fake).toBe(false)
    }
  })
})

describe('findUrls - yanlis pozitifler', () => {
  it('KULLANICI VAKASI: uydurma uzantili sozcukler adres sayilmaz', () => {
    // Metin kurucu olarak gercek bir cümle icinde geciyor.
    const text = 'linkgib.linkler ve baglanti.adres kelimeleri adres degildir.'
    expect(findUrls(text)).toHaveLength(0)
  })

  it('cogu bilinen sahte uzantilar elenir', () => {
    const words = [
      'linkgib.linkler',
      'site.links',
      'baglanti.adres',
      'ornek.siteler',
      'bir.xyzzy',
      'test.adres',
      'ornek.baglantilari',
    ]
    for (const w of words) {
      expect(findUrls(`Bunu oku: ${w} yeterli.`), w).toHaveLength(0)
    }
  })

  it('surum numaralari elenir', () => {
    for (const v of ['surum 1.5 yeni', 'v2.0 cikti', '2024.1 surumu']) {
      expect(findUrls(v), v).toHaveLength(0)
    }
  })

  it('dosya adlari elenir', () => {
    for (const f of ['index.html dosyasina bak', 'main.ts dosyasi', 'rapor.pdf ektesi']) {
      expect(findUrls(f), f).toHaveLength(0)
    }
  })

  it('gercek TLD olan dosya uzantilari icin de koruma durur', () => {
    // `md`, `py`, `sh`, `rs`, `java`, `mov`, `zip`, `map` hem dosya
    // uzantisidir hem gercek TLD'dir (Moldova, Paraguay, Saint Helena,
    // Sırbistan, Oracle, Google, IANA). Sohbette `notlar.md` yazmak alan
    // adi degildir; belirsizlik cozumu dosya tarafina doner.
    for (const f of ['notlar.md dosyasi', 'script.py calistir', 'run.sh komutu', 'build.rs dosyasi']) {
      expect(findUrls(f), f).toHaveLength(0)
    }
  })

  it('uydurma uzantili adres ASLA linklenmez ( satirin ortasinda bile)', () => {
    const text = 'Onceki surumde linkgib.linkler diye bir sey yaziyordu, simdi duzeldi.'
    expect(findUrls(text)).toHaveLength(0)
  })
})

describe('findUrls - dogru pozitifler', () => {
  it('GERCEK alan adlari yine de bulunur', () => {
    expect(countOf('aegissoft.com.tr adresine bak', 'aegissoft.com.tr')).toBe(1)
    expect(countOf('github.com adresi', 'github.com')).toBe(1)
    expect(countOf('example.org sayfasinda', 'example.org')).toBe(1)
    expect(countOf('docs.google.com ac', 'docs.google.com')).toBe(1)
  })

  it('cok etiketli adresler calisir', () => {
    expect(countOf('site.co.uk adresi', 'site.co.uk')).toBe(1)
    expect(countOf('ornek.com.tr adresi', 'ornek.com.tr')).toBe(1)
    expect(countOf('edu.tr gov.tr ac', 'edu.tr')).toBe(1)
  })

  it('yeni gTLD uzantilari calisir', () => {
    // NOT: `.zip` ve `.md` burada YOK. Ikisi de gercek TLD ama ayni zamanda
    // dosya uzantisi; sohbette `kaynak.zip` yazmak dosya soylemek demektir.
    // Bu ayrim bir sonraki testte acikca sinanir.
    for (const d of ['site.ai', 'uygulama.dev', 'sitem.app']) {
      expect(countOf(`adres: ${d} burada`, d), d).toBe(1)
    }
  })

  it('dosya uzantisi olan gercek TLD dosya sayilir', () => {
    // IANA hem `.zip` hem `.md` ust duzeyini delege etti. Sohbet metninde
    // bu son ekler dosya adinin parcasi; belirsizlik dosya lehine cozulur.
    for (const f of ['kaynak.zip dosyasi', 'notlar.md dosyasi', 'arsiv.zip indir']) {
      expect(findUrls(f), f).toHaveLength(0)
    }
  })

  it('yol ve sorgu satiri korunur', () => {
    expect(countOf('https://ornek.com/yol/belge.pdf sayfasinda', 'belge.pdf')).toBe(1)
    expect(countOf('https://ornek.com/sorgu?q=1 dene', 'q=1')).toBe(1)
  })

  it('http/https/mailto/www degismez', () => {
    expect(countOf('https://a.com adres', 'https://a.com')).toBe(1)
    expect(countOf('http://a.com adres', 'http://a.com')).toBe(1)
    expect(countOf('www.a.com adres', 'www.a.com')).toBe(1)
    expect(countOf('ornev@okul.edu.tr adresine yaz', 'ornev@okul.edu.tr')).toBe(1)
  })

  it('gercek TLD iceren duz e-posta kabul edilir', () => {
    expect(countOf('ogrenci@itu.edu.tr adresine yaz', 'mailto:ogrenci@itu.edu.tr')).toBe(1)
  })

  it('uydurma TLD iceren e-posta REDDEDILIR', () => {
    // Eski kural her `x@y.z` bicimini kabul ediyordu.
    expect(findUrls('kullanici@baglanti.adres yaz')).toHaveLength(0)
    expect(findUrls('kullanici@site.links yaz')).toHaveLength(0)
  })

  it('metin icinde birden fazla adresi bulur', () => {
    const text = 'Once a.com sonra b.org ve c.net adreslerine bak.'
    expect(findUrls(text)).toHaveLength(3)
  })
})