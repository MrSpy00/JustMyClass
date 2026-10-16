import { describe, it, expect } from 'vitest'
import { THEMES, THEME_LIST } from '../src/themes/themeConfig'
import { contrastRatio, parseHex } from '../src/themes/ThemeContext'
import { translations } from '../src/i18n/i18nContext'
import { ThemeName, ThemeColors } from '../types/jmc'

const REQUIRED_TOKENS: Array<keyof ThemeColors> = [
  'bg',
  'bgElevated',
  'bgSurface',
  'border',
  'borderSubtle',
  'text',
  'textMuted',
  'textDim',
  'primary',
  'primaryHover',
  'accent',
  'accentHover',
  'warning',
  'danger',
  'success',
  'codeBg',
  'badgeBg',
  'elevation',
]

/** Goz yormayan tema: ince ayirici cizgiler. */
function maxBorderRatio(theme: ThemeColors): number {
  return contrastRatio(theme.borderSubtle, theme.bg)
}

describe('Tema sistemi', () => {
  it('her tema tum semantik renk jetonlarini icerir', () => {
    expect(Object.keys(THEMES)).toHaveLength(16)
    for (const name of Object.keys(THEMES) as ThemeName[]) {
      const colors = THEMES[name]
      for (const token of REQUIRED_TOKENS) {
        expect(colors[token], `${name}.${token}`).toBeTruthy()
        expect(parseHex(colors[token]), `${name}.${token} gecersiz hex`).not.toBeNull()
      }
    }
  })

  it('THEME_LIST katalogu gercek tema adlariyla eslesir', () => {
    expect(THEME_LIST).toHaveLength(16)
    for (const entry of THEME_LIST) {
      expect(Object.keys(THEMES)).toContain(entry.id)
      expect(entry.label).toBeTruthy()
    }
  })

  it('her temada ana metin WCAG AA (4.5:1) esligini gecer', () => {
    for (const name of Object.keys(THEMES) as ThemeName[]) {
      const c = THEMES[name]
      expect(contrastRatio(c.text, c.bg), `${name} gövde`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(c.textMuted, c.bg), `${name} ikincil metin`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('her temada vurgu rengi arka plan uzerinde okunabilir', () => {
    for (const name of Object.keys(THEMES) as ThemeName[]) {
      const c = THEMES[name]
      expect(contrastRatio(c.primary, c.bg), `${name} vurgu`).toBeGreaterThanOrEqual(3)
    }
  })

  it('ayirici cizgiler govde metnine gore belirgin sekilde incedir', () => {
    // Cizgi kalinligi yerine kontrastla "goz yorma" kontrolu.
    for (const name of Object.keys(THEMES) as ThemeName[]) {
      const c = THEMES[name]
      const lineRatio = maxBorderRatio(c)
      expect(lineRatio, `${name} ayirici cizgi`).toBeLessThan(2.2)
      // ince cizgi metinden belirgin sekilde soluk olmali
      expect(contrastRatio(c.text, c.bg) / lineRatio, `${name} oran`).toBeGreaterThan(3)
    }
  })

  it('hex ayristirma ucuncu ve alti haneli bicimleri kabul eder', () => {
    expect(parseHex('#abc')).toEqual([170, 187, 204])
    expect(parseHex('#aabbcc')).toEqual([170, 187, 204])
    expect(parseHex('gecersiz')).toBeNull()
  })

  it('kontrast orani siyah-beyaz icin 21:1 olceğindir', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('Ceviri', () => {
  it('Turkce ve Ingilizce anahtar kumesi aynidir', () => {
    const trKeys = Object.keys(translations.tr).sort()
    const enKeys = Object.keys(translations.en).sort()
    expect(trKeys).toEqual(enKeys)
  })

  it('tum degerler bos degildir', () => {
    for (const [lang, table] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(table)) {
        expect(value, `${lang}.${key}`).toBeTruthy()
      }
    }
  })

  it('yanlis sifreleme iddialari ceviri icinde bulunmaz', () => {
    for (const table of Object.values(translations)) {
      for (const value of Object.values(table)) {
        expect(value).not.toMatch(/SQLCipher/i)
      }
    }
  })
})