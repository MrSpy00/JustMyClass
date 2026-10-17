import { describe, it, expect } from 'vitest'
import {
  THEMES,
  contrastRatio,
  contrastTextOn,
  deriveLinkColors,
  deriveOnColorText,
} from '../src/themes/themeConfig'
import type { ThemeColors } from '../types/jmc'

/**
 * KULLANICI BILDIRIMI
 * -------------------
 * "Bazi temalarda yazilar okunmaz oluyo pek asistan arkaplan metin
 *  kutucuğundan vbvb."
 *
 * KOK NEDEN
 * ---------
 * Kullanici balonu `bg-[var(--jmc-primary)] text-white` idi. `text-white`
 * SERT yaziliydi; `primary` ise dugme rengi ve 17 temanin 16'sinda acik
 * bir ton. Olculeen beyaz/primary oranlari:
 *
 *     High Contrast #ffd400 -> 1.43      Graphite  #b8bcc6 -> 1.90
 *     Matrix        #35d07f -> 2.00      Cyberpunk #31c7e8 -> 2.01
 *     Amber CRT     #e0a341 -> 2.21      Dark      #4c8dff -> 3.20
 *
 * Yani kullanicinin KENDI mesaji neredeyse hicbir temada okunmuyordu.
 *
 * Bu dosya her iki yuzeyi de (kullanici ve asistan balonu) tum temalar
 * icin OLCEYEN bir kontrat sabitler.
 */

const ALL_THEMES = Object.entries(THEMES) as Array<[string, ThemeColors]>

describe('contrastTextOn', () => {
  it('beyaz ile koyu arasindan kontrasti yuksek olani secer', () => {
    // Koyu zemin -> beyaz metin.
    expect(contrastTextOn('#0b0f16')).toBe('#ffffff')
    // Acik zemin -> koyu metin.
    expect(contrastTextOn('#ffd400')).not.toBe('#ffffff')
    expect(contrastTextOn('#b8bcc6')).not.toBe('#ffffff')
    // Tam beyaz zemin kesinlikle koyu metin ister.
    expect(contrastTextOn('#ffffff')).not.toBe('#ffffff')
  })

  it('her girdi icin 4.5 kontrastin USTUNDE bir sonuc uretir', () => {
    // Orta tonlar icin bile (beyaz ne ise ne) en iyi secim yeterli.
    for (let r = 0; r <= 255; r += 5) {
      for (let g = 0; g <= 255; g += 51) {
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}80`
        const fg = contrastTextOn(hex)
        expect(contrastRatio(fg, hex), hex).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('kullanici balonu kontrast sozlesmesi', () => {
  const failures: string[] = []

  for (const [name, c] of ALL_THEMES) {
    it(`${name}: balon uzerindeki metin okunabilir`, () => {
      const on = deriveOnColorText(c)
      const ratio = contrastRatio(on.onPrimary, c.primary)
      expect(ratio, `${name}: ${on.onPrimary} / ${c.primary} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)

      // Hover durumu da okunabilir olmali.
      const hoverRatio = contrastRatio(on.onPrimaryHover, c.primaryHover)
      expect(
        hoverRatio,
        `${name} hover: ${on.onPrimaryHover} / ${c.primaryHover} = ${hoverRatio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5)
    })

    it(`${name}: vurgu/durum renkleri uzerindeki metin okunabilir`, () => {
      const on = deriveOnColorText(c)
      expect(contrastRatio(on.onAccent, c.accent), `${name} accent`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(on.onDanger, c.danger), `${name} danger`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(on.onWarning, c.warning), `${name} warning`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(on.onSuccess, c.success), `${name} success`).toBeGreaterThanOrEqual(4.5)
    })
  }

  afterAll(() => {
    expect(
      failures,
      `Okunamayan balon kontrastlari:\n${failures.join('\n')}`,
    ).toHaveLength(0)
  })
})

describe('asistan balonu kontrast sozlesmesi', () => {
  for (const [name, c] of ALL_THEMES) {
    it(`${name}: asistan balonunda govde metni okunabilir`, () => {
      // Arayuz: `bg-[var(--jmc-bg-surface)] text-[var(--jmc-text)]`
      expect(
        contrastRatio(c.text, c.bgSurface),
        `${name}: ${c.text} / ${c.bgSurface}`,
      ).toBeGreaterThanOrEqual(4.5)
    })
  }
})

describe('baglanti belirginligi artirildi', () => {
  for (const [name, c] of ALL_THEMES) {
    it(`${name}: link govde metninden ayirt edilebilir`, () => {
      const link = deriveLinkColors(c)
      for (const bg of [c.bg, c.bgElevated, c.bgSurface]) {
        // Kullanici "link belirginligini artir" dedi: hedef 4.5 -> 5.5.
        expect(contrastRatio(link.link, bg), `${name} / ${bg}`).toBeGreaterThanOrEqual(5.5)
        expect(contrastRatio(link.linkHover, bg), `${name} hover / ${bg}`).toBeGreaterThanOrEqual(7.5)
      }
    })
  }

  it('link, govde metninden FARKLI bir renge sahip olur', () => {
    // Aksi halde baglanti yalnizca alt cizgiyle ayirt edilir; renk farki
    // yoksa "belirginlik" hedefi tam olarak gerceklesmez.
    for (const [name, c] of ALL_THEMES) {
      const link = deriveLinkColors(c)
      expect(link.link.toLowerCase(), `${name}: ${link.link} == ${c.text}`).not.toBe(c.text.toLowerCase())
    }
  })

  it('her temada cozum DONUSUMUNDE kalicidir (idempotent)', () => {
    for (const [name, c] of ALL_THEMES) {
      const once = deriveLinkColors(c)
      const twice = deriveLinkColors({ ...c, link: once.link, linkHover: once.linkHover })
      expect(twice.link, name).toBe(once.link)
      expect(twice.linkHover, name).toBe(once.linkHover)
    }
  })
})