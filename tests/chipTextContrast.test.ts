import { describe, it, expect } from 'vitest'
import { THEMES, contrastRatio, deriveRoleTextColors } from '../src/themes/themeConfig'
import type { ThemeColors } from '../types/jmc'

/**
 * KULLANICI BILDIRIMI
 * -------------------
 * "Bazi temalarda yazilar okunmaz oluyo pek asistan arkaplan metin
 *  kutucugundan vbvb."
 *
 * Bu, balon duzeltmesinden SONRA kalan ikinci ve tamamen ayri bir
 * sebepdi. Uygulamada rozetler su sekilde yaziliyor:
 *
 *   `bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)]`
 *
 * Zemin rengin yalnizca %10-20'si yuzeyin uzerine bindirildigi icin
 * ETKIN zemin yuzeye yakindir. Okunurluk rengin YUZEYE gore
 * kontrastina baglidir — ve tema renkleri buna gore secilmemisti.
 *
 * DUZELTME ONCESI OLCULEN 25 IHLAL (7 tema):
 *
 *   Pastel Soft accent  #d96a9a / #efe9f7 = 2.73   (en kotu)
 *   Pastel Soft accent  #d96a9a / #ffffff = 3.24
 *   Pastel Soft warning #a9701a / #efe9f7 = 3.52
 *   Bordeaux    primary #c8405a / #28151b = 3.57
 *   Sand        accent  #8a6d2f / #eae5d9 = 3.88
 *   Pastel Soft warning #a9701a / #f7f4fb = 3.84
 *   Light       warning #a86a08 / #f0f2f5 = 3.96
 *   ... + 18 tane daha
 *
 * Turetilmis `--jmc-*-text` degerleri bu rozetlerde kullanilir.
 * Onemli olan: zaten okunabilir olan temalarda deger DEGISMEEZ, yani
 * bu sozlesme yalnizca gercekten bozuk olanlari etkiler.
 */
const ALL_THEMES = Object.entries(THEMES) as Array<[string, ThemeColors]>
const ROLE_KEYS = ['primaryText', 'accentText', 'successText', 'warningText', 'dangerText'] as const

describe('rozet metni kontrast sozlesmesi', () => {
  for (const [name, c] of ALL_THEMES) {
    it(`${name}: yari saydam rozet metni her yuzeyde okunabilir`, () => {
      const roles = deriveRoleTextColors(c)
      const surfaces = [c.bg, c.bgElevated, c.bgSurface].filter(Boolean) as string[]

      for (const key of ROLE_KEYS) {
        const color = roles[key]
        for (const s of surfaces) {
          const ratio = contrastRatio(color, s)
          expect(
            ratio,
            `${name} ${key}: ${color} / ${s} = ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }

  it('ayni rozet rengi 17 temanin HEPSINDE uretilir', () => {
    // Bu bir regresyon: `set()` cagrisi unutulursa ya da yalnizca bazi
    // roller icin eklendiyse, geri kalanlar okunamaz kalir.
    for (const [name, c] of ALL_THEMES) {
      const roles = deriveRoleTextColors(c)
      for (const key of ROLE_KEYS) {
        expect(roles[key], `${name}.${key}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('okunabilir rozet rengi temada DEGISTIRILMEZ (karakter korunur)', () => {
    // Kontrast zorlamasi yalnizca gercekten gerek oldugunda devreye
    // girmelidir; aksi halde tema karakteri bozulur.
    let unchanged = 0
    for (const [name, c] of ALL_THEMES) {
      const roles = deriveRoleTextColors(c)
      if (roles.primaryText.toLowerCase() === c.primary.toLowerCase()) unchanged += 1
      if (roles.dangerText.toLowerCase() === c.danger.toLowerCase()) unchanged += 1
    }
    // 17 tema x en az 2 rol; duzeltme yalnizca 7 temada devreye girer.
    expect(unchanged).toBeGreaterThan(20)
  })
})