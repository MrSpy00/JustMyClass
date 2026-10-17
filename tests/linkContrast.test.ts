import { describe, it, expect } from 'vitest'
import {
  THEMES,
  contrastRatio,
  deriveCustomThemeColors,
  deriveLinkColors,
  relativeLuminance,
} from '../src/themes/themeConfig'
import type { ThemeColors } from '../types/jmc'

/**
 * Kullanici bildirimi:
 *   "Sohbette asistan falan linkler arka planla ayni renkte gozukuyor,
 *    zit belirgin olucak renkte gozukmuyor temalarda bu yuzden linkler
 *    okunmuyor."
 *
 * Bu test, TUM gomulu temalarda ve iki zorlayici sentetik temada link
 * renginin okunabilirligini OLÇER. Sadece "fonksiyon çağrıldı" demek
 * yetmez; kontrast oranı gerçekten 4.5 üzerinde olmalıdır.
 */

const ALL_THEMES = Object.entries(THEMES).filter(
  ([name]) => name !== 'dark' && name !== 'light',
) as Array<[string, ThemeColors]>

/** Sohbet balonu, kenar paneli ve ana yüzey: link bunların HEPSİNDE okunmalı. */
function surfaces(c: ThemeColors): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (c.bg) out.push(['bg', c.bg])
  if (c.bgElevated) out.push(['bgElevated', c.bgElevated])
  if (c.bgSurface) out.push(['bgSurface', c.bgSurface])
  return out
}

describe('deriveLinkColors', () => {
  it('tum gomulu temalarda her yuzeyde AA kontrastini saglar', () => {
    const failures: string[] = []
    for (const [name, colors] of ALL_THEMES) {
      const { link, linkHover } = deriveLinkColors(colors)
      for (const [surfaceName, bg] of surfaces(colors)) {
        const ratio = contrastRatio(link, bg)
        if (ratio < 4.5) {
          failures.push(`${name}.${surfaceName}: link=${link} oran=${ratio.toFixed(2)}`)
        }
        const hoverRatio = contrastRatio(linkHover, bg)
        if (hoverRatio < 6) {
          failures.push(`${name}.${surfaceName}: linkHover=${linkHover} oran=${hoverRatio.toFixed(2)}`)
        }
      }
    }
    expect(failures, `Okunamayan link renkleri:\n${failures.join('\n')}`).toHaveLength(0)
  })

  it('link rengi ARKA PLANLA AYNI OLMAZ ve GOVDE METNIYLE (c.text) AYNI OLMAZ', () => {
    for (const [name, colors] of ALL_THEMES) {
      const { link } = deriveLinkColors(colors)
      expect(link.toLowerCase(), `${name} link rengi gövde metniyle (text) aynı olmamalı`).not.toBe(
        colors.text.toLowerCase(),
      )
      for (const [surfaceName, bg] of surfaces(colors)) {
        expect(contrastRatio(link, bg), `${name} / ${surfaceName}`).toBeGreaterThanOrEqual(5.5)
      }
    }
  })

  it('temada tanimli link rengini kullanir ve yine de kontrast dogrular', () => {
    const base = THEMES.Dark as ThemeColors
    const explicit: ThemeColors = { ...base, link: '#000000', linkHover: '#000000' }
    const { link, linkHover } = deriveLinkColors(explicit)
    // Siyah koyu temada okunmaz; kontrast zorlanmali.
    expect(contrastRatio(link, base.bg)).toBeGreaterThanOrEqual(4.5)
    expect(link).not.toBe('#000000')
    expect(contrastRatio(linkHover, base.bg)).toBeGreaterThanOrEqual(6)
  })

  it('zaten okunabilir bir adayi DEGISTIRMEZ (tema karakteri korunur)', () => {
    const colors: ThemeColors = {
      ...(THEMES.Dark as ThemeColors),
      accent: '#7fc4ff',
      accentHover: '#a8dbff',
    }
    const { link } = deriveLinkColors(colors)
    expect(link.toLowerCase()).toBe('#7fc4ff')
  })

  it('link rengi accent okunabilir degilse primary denenir', () => {
    // `primary`in kesinlikle 5.5 kontrasti saglayacak kadar koyu
    // secilmesi gerekir; aksi halde (daha once 4.5 hedefi varken)
    // bir sonraki aday olan `accentHover` devreye girerdi.
    const colors: ThemeColors = {
      ...(THEMES.Light as ThemeColors),
      accent: '#fefefe', // beyaz zeminde okunmaz
      primary: '#00307a',
      primaryHover: '#002055',
    }
    const { link } = deriveLinkColors(colors)
    expect(link.toLowerCase()).toBe('#00307a')
  })

  it('hicbir aday hedefi karsilamiyorsa kontrast ZORLANIR', () => {
    // Acik temada tek bir koyu ve okunabilir aday yoksa renk zorlanir.
    const colors: ThemeColors = {
      ...(THEMES.Light as ThemeColors),
      accent: '#fefefe',
      accentHover: '#fefefe',
      primary: '#fefefe',
      primaryHover: '#fefefe',
      text: '#fefefe',
      bg: '#ffffff',
      bgElevated: '#ffffff',
      bgSurface: '#ffffff',
    }
    const { link, linkHover } = deriveLinkColors(colors)
    expect(contrastRatio(link, '#ffffff')).toBeGreaterThanOrEqual(5.5)
    expect(contrastRatio(linkHover, '#ffffff')).toBeGreaterThanOrEqual(7.5)
  })

  it('hicbir aday okunabilir degilse kontrast ZORLANIR (guvenlik agi)', () => {
    const colors: ThemeColors = {
      ...(THEMES.Dark as ThemeColors),
      accent: '#0b0f14', // arka plana neredeyse ayni
      accentHover: '#0b0f14',
      primary: '#0b0f14',
      primaryHover: '#0b0f14',
    }
    const { link, linkHover } = deriveLinkColors(colors)
    expect(contrastRatio(link, colors.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(linkHover, colors.bg)).toBeGreaterThanOrEqual(6)
  })

  it('acik temada koyu link, koyu temada acik link uretir', () => {
    // Kaba kirmizi-kanal tahmini yerine gercek WCAG parlakligi kullanilir.
    // Arka plan `deriveLinkColors` ciktisi DEGIL, temadan okunur.
    const rel = relativeLuminance
    const lightColors = THEMES.Light as ThemeColors
    const darkColors = THEMES.Dark as ThemeColors
    const light = deriveLinkColors(lightColors)
    const dark = deriveLinkColors(darkColors)
    expect(rel(light.link)).toBeLessThan(rel(lightColors.bg))
    expect(rel(dark.link)).toBeGreaterThan(rel(darkColors.bg))
  })

  it('ayni renkte butun yuzeyler icin tutarli sonuc verir', () => {
    const colors: ThemeColors = { ...(THEMES.Ocean as ThemeColors), bgElevated: '#081420', bgSurface: '#081420' }
    const { link } = deriveLinkColors(colors)
    expect(contrastRatio(link, '#081420')).toBeGreaterThanOrEqual(4.5)
  })

  it('yuzey listesi bos olsa bile patlamaz', () => {
    const colors = { ...(THEMES.Dark as ThemeColors), bg: '#101010', bgElevated: '', bgSurface: '' } as ThemeColors
    const { link } = deriveLinkColors(colors)
    expect(contrastRatio(link, '#101010')).toBeGreaterThanOrEqual(4.5)
  })

  it('ozel tema renklerinden de saglam link uretir', () => {
    // Kullanicinin dort renkle olusturdugu tipik bir kombinasyon
    const custom: ThemeColors = {
      ...(THEMES.Dark as ThemeColors),
      bg: '#3b2f5e',
      bgElevated: '#463a6e',
      bgSurface: '#52447e',
      accent: '#3b2f5e', // kullanici zeminiyle ayni ton girdi -> okunmaz
      primary: '#3b2f5e',
      accentHover: '#3b2f5e',
      primaryHover: '#3b2f5e',
    }
    const { link, linkHover } = deriveLinkColors(custom)
    for (const bg of ['#3b2f5e', '#463a6e', '#52447e']) {
      expect(contrastRatio(link, bg), bg).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(linkHover, bg), bg).toBeGreaterThanOrEqual(6)
    }
  })

  it('yuksek kontrastli temada da saglam link uretir', () => {
    const hc = THEMES.Contrast as ThemeColors | undefined
    if (!hc) return
    const { link } = deriveLinkColors(hc)
    expect(contrastRatio(link, hc.bg)).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * Kullanicinin kendi arayuzunde kurdugu temalar da ayni garantiyi almalidir.
 * `deriveCustomThemeColors` yalnizca dort secilen rengi korur; link rengi
 * ondan TURETILIR ve kontrast zorlanir.
 */
describe('ozel tema olusturucu -> baglanti rengi', () => {
  const hostileDrafts = [
    { name: 'Ayni', bg: '#3b2f5e', text: '#3b2f5e', primary: '#3b2f5e', accent: '#3b2f5e' },
    { name: 'Koyu', bg: '#101010', text: '#101010', primary: '#101010', accent: '#101010' },
    { name: 'Acik', bg: '#fefefe', text: '#fefefe', primary: '#fefefe', accent: '#fefefe' },
    { name: 'Zit', bg: '#ffffff', text: '#000000', primary: '#ffffff', accent: '#ffffff' },
    { name: 'Karisik', bg: '#2b2b2b', text: '#2c2c2c', primary: '#2d2d2d', accent: '#2e2e2e' },
  ]

  for (const draft of hostileDrafts) {
    it(`"${draft.name}" kombinasyonunda okunabilir link uretir`, () => {
      const colors = deriveCustomThemeColors(draft)
      const { link, linkHover } = deriveLinkColors(colors)
      for (const bg of [colors.bg, colors.bgElevated, colors.bgSurface]) {
        expect(contrastRatio(link, bg), `${draft.name} / ${bg}`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(linkHover, bg), `${draft.name} / ${bg}`).toBeGreaterThanOrEqual(6)
      }
    })
  }

  it('kullanicinin sectigi dort renk ASLA degistirilmez', () => {
    const draft = { name: 'Koruma', bg: '#123456', text: '#fedcba', primary: '#aabbcc', accent: '#ddeeff' }
    const colors = deriveCustomThemeColors(draft)
    expect(colors.bg).toBe(draft.bg)
    expect(colors.text).toBe(draft.text)
    expect(colors.primary).toBe(draft.primary)
    expect(colors.accent).toBe(draft.accent)
  })

  it('tum TURETILMIS alanlar zemin uzerinde okunabilir kalir', () => {
    // Kontrast zorlamasinin yalnizca linke ozel bir yama olmadigini,
    // butun turetilmis alanlarda gecerli oldugunu dogrular.
    //
    // NOT: `text`, `bg`, `primary`, `accent` denetime DAGILIR; kullanici
    // bunlari ozellestirmek icin secer ve bilincli olarak ayni renk secmis
    // olabilir. Sözlesme bunlari degistirmemektir; arayüz de düsük
    // kontrast seciminde uyari gosterir. Denetim yalnizca TURETILMIS
    // alanlar icin geçerlidir.
    for (const draft of hostileDrafts) {
      const c = deriveCustomThemeColors(draft)
      expect(contrastRatio(c.textMuted, c.bg), `${draft.name}/textMuted`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(c.textDim, c.bg), `${draft.name}/textDim`).toBeGreaterThanOrEqual(3.5)
      expect(contrastRatio(c.warning, c.bg), `${draft.name}/warning`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(c.danger, c.bg), `${draft.name}/danger`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(c.success, c.bg), `${draft.name}/success`).toBeGreaterThanOrEqual(4.5)
    }
  })
})