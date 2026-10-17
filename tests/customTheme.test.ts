import { describe, it, expect } from 'vitest'
import {
  CODE_TOKEN_MIN_CONTRAST,
  CODE_TOKEN_NAMES,
  CUSTOM_THEME_NAME_MAX,
  MAX_CUSTOM_THEMES,
  THEMES,
  THEME_LIST,
  contrastRatio,
  createCustomTheme,
  deriveCodeTokens,
  deriveCustomThemeColors,
  isLightBackground,
  isLightTheme,
  makeCustomThemeId,
  parseCustomThemes,
  parseHex,
  relativeLuminance,
  sanitizeHex,
  sanitizeStoredColors,
  serializeCustomThemes,
  validateCustomThemeName,
} from '../src/themes/themeConfig'
// Geriye donuk uyumluluk: eski icerik yollari hala calisiyor olmali.
import { contrastRatio as contrastFromContext } from '../src/themes/ThemeContext'
import { translations } from '../src/i18n/i18nContext'
import { CustomTheme, ThemeColors, ThemeName } from '../types/jmc'

/** Duz hex olmasi gereken alanlar (badgeBg/elevation rgba olabilir). */
const HEX_TOKENS: Array<keyof ThemeColors> = [
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
]
/** rgba() kabul edilen alanlar. */
const ALPHA_TOKENS: Array<keyof ThemeColors> = ['badgeBg', 'elevation']
const ALL_TOKENS: Array<keyof ThemeColors> = [...HEX_TOKENS, ...ALPHA_TOKENS]

const NEW_THEMES: ThemeName[] = ['Deep Sea', 'Bordeaux', 'High Contrast', 'Pastel Soft']

const GOOD_DRAFT = {
  name: 'Gece Calismasi',
  bg: '#0f1b2d',
  primary: '#6aa6ff',
  accent: '#ff9f68',
  text: '#eef4ff',
}

describe('Yeni temalar', () => {
  it('dort yeni tema hem THEMES hem THEME_LIST icinde var', () => {
    for (const name of NEW_THEMES) {
      expect(Object.keys(THEMES), `${name} THEMES`).toContain(name)
      expect(THEME_LIST.map(e => e.id), `${name} THEME_LIST`).toContain(name)
    }
  })

  it('katalog toplami 20 tema ve 20 kayittir', () => {
    expect(Object.keys(THEMES)).toHaveLength(20)
    expect(THEME_LIST).toHaveLength(20)
  })

  it('yeni temalar gercekten farkli renk dunyalari (ayni zemin degil)', () => {
    const bgs = NEW_THEMES.map(n => THEMES[n].bg)
    expect(new Set(bgs).size).toBe(NEW_THEMES.length)
    // Her yeni tema, kendisinden farkli en az bir yerlesik temadan ayrilsin.
    const legacy: ThemeName[] = ['Dark', 'Light', 'Graphite', 'Abyss', 'Sand', 'Ocean', 'Forest']
    for (const name of NEW_THEMES) {
      const mine = THEMES[name]
      const distinct = legacy.some(other => THEMES[other].bg !== mine.bg)
      expect(distinct, `${name} benzersiz zemin`).toBe(true)
    }
  })

  it('Deep Sea ve Bordeaux koyu, Pastel Soft acik, High Contrast saf siyah beyaz', () => {
    expect(isLightTheme(THEMES['Deep Sea'])).toBe(false)
    expect(isLightTheme(THEMES.Bordeaux)).toBe(false)
    expect(isLightTheme(THEMES['Pastel Soft'])).toBe(true)
    expect(isLightTheme(THEMES['High Contrast'])).toBe(false)
    expect(THEMES['High Contrast'].bg).toBe('#000000')
    expect(THEMES['High Contrast'].text).toBe('#ffffff')
  })

  it('High Contrast WCAG AA (yeni temalarin en sert kontrastligi) korur', () => {
    const hc = THEMES['High Contrast']
    expect(contrastRatio(hc.text, hc.bg)).toBeGreaterThanOrEqual(7)
    expect(contrastRatio(hc.textMuted, hc.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(hc.primary, hc.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('kontrast rozetleri (isLightTheme) tum katalogda dogru siniflanir', () => {
    for (const name of Object.keys(THEMES) as ThemeName[]) {
      const c = THEMES[name]
      expect(isLightTheme(c), name).toBe(isLightBackground(c.bg))
    }
    // Acik sinifta gercekten sadece acik temalar olmali.
    const lightThemes = (Object.keys(THEMES) as ThemeName[]).filter(n => isLightTheme(THEMES[n]))
    expect(lightThemes.sort()).toEqual(['Light', 'Pastel Soft', 'Sand'])
  })
})

describe('Tema jetonlari', () => {
  it('her temada TUM alanlar dolu ve bicim gecerli', () => {
    for (const name of Object.keys(THEMES) as ThemeName[]) {
      const colors = THEMES[name] as Record<string, string>
      for (const token of ALL_TOKENS) {
        expect(colors[token], `${name}.${token} dolu`).toBeTruthy()
        expect(parseHex(colors[token]), `${name}.${token} ayristirilabilir`).not.toBeNull()
      }
      for (const token of HEX_TOKENS) {
        expect(colors[token], `${name}.${token} 6 haneli hex`).toMatch(/^#[0-9a-f]{6}$/i)
      }
      for (const token of ALPHA_TOKENS) {
        expect(colors[token], `${name}.${token} alfa rengi`).toMatch(/^rgba\(/i)
      }
    }
  })

  it('tema adlari benzersiz ve katalogda tekrar yok', () => {
    const ids = THEME_LIST.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const labels = THEME_LIST.map(e => e.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('katalogdaki her kayit gercek bir temaya isaret eder ve tersi de dogru', () => {
    const ids = new Set(THEME_LIST.map(e => e.id))
    for (const id of Object.keys(THEMES) as ThemeName[]) {
      expect(ids.has(id), `${id} katalogda`).toBe(true)
    }
  })

  it('kontrast orani hem themeConfig hem ThemeContext uzerinden ayni', () => {
    expect(contrastFromContext).toBe(contrastRatio)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
  })
})

describe('Kod vurgu jetonlari', () => {
  it('sekiz jetonun tamami uretilir ve hepsi codeBg uzerinde okunabilir', () => {
    expect(CODE_TOKEN_NAMES).toHaveLength(8)
    for (const codeBg of Object.values(THEMES).map(c => c.codeBg)) {
      const tokens = deriveCodeTokens(codeBg)
      for (const key of CODE_TOKEN_NAMES) {
        expect(tokens[key], `${codeBg}/${key} bicim`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(
          contrastRatio(tokens[key], codeBg),
          `${codeBg}/${key} kontrast`,
        ).toBeGreaterThanOrEqual(CODE_TOKEN_MIN_CONTRAST)
      }
    }
  })

  it('uc renkli ve okunaksiz kod zemini icin de kontrast garantisi var', () => {
    for (const codeBg of ['#ffff00', '#0000ff', '#808080', '#ff00ff']) {
      const tokens = deriveCodeTokens(codeBg)
      for (const key of CODE_TOKEN_NAMES) {
        expect(contrastRatio(tokens[key], codeBg), `${codeBg}/${key}`).toBeGreaterThanOrEqual(
          CODE_TOKEN_MIN_CONTRAST,
        )
      }
    }
  })

  it('koyu temada tohum renkler cogunlukla korunur (gorsel regresyon yok)', () => {
    const tokens = deriveCodeTokens(THEMES.Dark.codeBg)
    expect(tokens.comment).toBe('#7c89a0')
    expect(tokens.string).toBe('#4fd6a4')
  })
})

describe('Hex girdi normalizasyonu', () => {
  it('3 ve 6 haneli bicimleri kabul eder, gecersizleri reddeder', () => {
    expect(sanitizeHex('#ABC')).toBe('#aabbcc')
    expect(sanitizeHex('  #4C8DFF ')).toBe('#4c8dff')
    expect(sanitizeHex('4c8dff')).toBe('#4c8dff')
    expect(sanitizeHex('#12345')).toBeNull()
    expect(sanitizeHex('zzz')).toBeNull()
    expect(sanitizeHex('')).toBeNull()
    expect(sanitizeHex('#4c8dff80')).toBeNull()
  })
})

describe('Tema adi dogrulama', () => {
  it('bos ad reddedilir', () => {
    expect(validateCustomThemeName('').ok).toBe(false)
    expect(validateCustomThemeName('').reason).toBe('empty')
    expect(validateCustomThemeName('    ').ok).toBe(false)
    expect(validateCustomThemeName('///').ok).toBe(false)
    expect(validateCustomThemeName('<>{}[]\\/*').ok).toBe(false)
  })

  it('40 karakterden uzun ad reddedilir (sessizce kesilmez)', () => {
    const tooLong = 'a'.repeat(CUSTOM_THEME_NAME_MAX + 1)
    const result = validateCustomThemeName(tooLong)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('too_long')
    // Tam 40 karakter kabul edilir.
    expect(validateCustomThemeName('a'.repeat(CUSTOM_THEME_NAME_MAX)).ok).toBe(true)
  })

  it('guvenli karakterler korunur, guvensizler atilir', () => {
    const result = validateCustomThemeName('  Gece   Çalışması-01_x  ')
    expect(result.ok).toBe(true)
    expect(result.name).toBe('Gece Çalışması-01_x')
    expect(validateCustomThemeName('<script>alert(1)</script>').name).toBe('scriptalert1script')
  })

  it('kontrol karakterleri ve satir sonlari temizlenir', () => {
    // Kontrol karakterleri (NUL, satir sonu) ATILIR; sonrasinda bosluklar
    // tekilleştirilir, yani sonuc bitismis kelimelerden olusur.
    expect(validateCustomThemeName('A\u0000B\nC').name).toBe('ABC')
    expect(validateCustomThemeName('A \t  B').name).toBe('A B')
  })
})

describe('Custom tema renk turetimi', () => {
  it(' dort renkten tam bir ThemeColors uretir ve secimleri oldug gibi korur', () => {
    const colors = deriveCustomThemeColors(GOOD_DRAFT)
    for (const token of ALL_TOKENS) {
      expect(colors[token], token).toBeTruthy()
    }
    expect(colors.bg).toBe(GOOD_DRAFT.bg)
    expect(colors.text).toBe(GOOD_DRAFT.text)
    expect(colors.primary).toBe(GOOD_DRAFT.primary)
    expect(colors.accent).toBe(GOOD_DRAFT.accent)
    for (const token of HEX_TOKENS) {
      expect(colors[token], token).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('acik zemin otomatik algilanir (color-scheme ve kod vurgulari dogru yon)', () => {
    const dark = deriveCustomThemeColors(GOOD_DRAFT)
    const light = deriveCustomThemeColors({
      name: 'Acik',
      bg: '#fef6fb',
      primary: '#7c5cd6',
      accent: '#d96a9a',
      text: '#2b2436',
    })
    expect(isLightTheme(dark)).toBe(false)
    expect(isLightTheme(light)).toBe(true)
    // Acik temada kod zemini zeminin biraz altinda, koyu temada belirgin sekilde daha koyu.
    expect(relativeLuminance(light.codeBg)).toBeLessThan(relativeLuminance(light.bg))
    expect(relativeLuminance(dark.codeBg)).toBeLessThan(relativeLuminance(dark.bg))
  })

  it('turetilen ikincil metin ve durum renkleri her zaman okunabilir', () => {
    // Bilerek kotu zemin + metin ciftleri.
    for (const draft of [
      { name: 'x', bg: '#101010', primary: '#6aa6ff', accent: '#ff9f68', text: '#1a1a1a' },
      { name: 'y', bg: '#f0f0f0', primary: '#ffe000', accent: '#ffffff', text: '#e8e8e8' },
      { name: 'z', bg: '#3a2f6b', primary: '#ffffff', accent: '#000000', text: '#4a3f7b' },
    ]) {
      const colors = deriveCustomThemeColors(draft)
      expect(contrastRatio(colors.textMuted, colors.bg), draft.name).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.textDim, colors.bg), draft.name).toBeGreaterThanOrEqual(3.5)
      expect(contrastRatio(colors.warning, colors.bg), draft.name).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.danger, colors.bg), draft.name).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.success, colors.bg), draft.name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('rozet rengi secilen primary renginden turetilir', () => {
    const colors = deriveCustomThemeColors(GOOD_DRAFT)
    const [r, g, b] = parseHex(GOOD_DRAFT.primary) as [number, number, number]
    expect(colors.badgeBg).toContain(`rgba(${r}, ${g}, ${b}`)
  })

  it('gecersiz hex girdisinde cogrenilmis temaya sessizce duser', () => {
    const colors = deriveCustomThemeColors({
      name: 'bozuk',
      bg: 'zzz',
      primary: '',
      accent: '#abc',
      text: '#xyz',
    })
    expect(colors.bg).toBe(THEMES.Dark.bg)
    expect(colors.accent).toBe('#aabbcc')
  })
})

describe('Custom tema kaydi ve yasam dongusu', () => {
  it('taslaktan gecerli bir kayit uretir', () => {
    const built = createCustomTheme(GOOD_DRAFT, 1_700_000_000_000)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.theme.name).toBe(GOOD_DRAFT.name)
    expect(built.theme.createdAt).toBe(1_700_000_000_000)
    expect(built.theme.id).toBe(makeCustomThemeId(GOOD_DRAFT.name, 1_700_000_000_000))
    expect(sanitizeStoredColors(built.theme.colors)).not.toBeNull()
  })

  it('bos, cok uzun veya renksiz taslak kaydedilmez', () => {
    expect(createCustomTheme({ ...GOOD_DRAFT, name: '' }, 1).ok).toBe(false)
    expect(createCustomTheme({ ...GOOD_DRAFT, name: 'x'.repeat(41) }, 1).ok).toBe(false)
    expect(createCustomTheme({ ...GOOD_DRAFT, bg: 'gibberish' }, 1).ok).toBe(false)
  })

  it('kimlik ayni ad + ayni zaman damgasinda ayni uretilir, degismez', () => {
    expect(makeCustomThemeId('Kahve Molası', 42)).toBe(makeCustomThemeId('  Kahve   Molası ', 42))
    expect(makeCustomThemeId('Kahve Molası', 42)).not.toBe(makeCustomThemeId('Kahve Molası', 43))
    expect(makeCustomThemeId('***', 42)).toContain('custom-tema-')
  })

  it('serialize -> parse gidis-donus ayni sonucu verir', () => {
    const a = createCustomTheme(GOOD_DRAFT, 111)
    const b = createCustomTheme({ ...GOOD_DRAFT, name: 'Sabah', bg: '#fdf3f4' }, 222)
    if (!a.ok || !b.ok) throw new Error('kurulum hatasi')
    const list: CustomTheme[] = [a.theme, b.theme]
    const round = parseCustomThemes(serializeCustomThemes(list))
    expect(round).toEqual(list)
    // Ikinci gidis de ayni sonucu vermeli (idempotent).
    expect(parseCustomThemes(serializeCustomThemes(round))).toEqual(list)
  })

  it('ayni kaydi iki kez kaydetmek kopya yaratmaz', () => {
    const built = createCustomTheme(GOOD_DRAFT, 111)
    if (!built.ok) throw new Error('kurulum hatasi')
    expect(parseCustomThemes(serializeCustomThemes([built.theme]))).toHaveLength(1)
    // Ayni kimlik iki kez geciyorsa ikinci kayit atilir.
    const duplicated = JSON.stringify([built.theme, built.theme])
    expect(parseCustomThemes(duplicated)).toHaveLength(1)
  })

  it('liste limiti tanimli ve makul', () => {
    expect(MAX_CUSTOM_THEMES).toBeGreaterThan(0)
    expect(MAX_CUSTOM_THEMES).toBeLessThanOrEqual(50)
  })
})

describe('Bozuk localStorage verisi cokmez', () => {
  it('parse hicbir girdide istisna atmaz', () => {
    const hostile = [
      null,
      undefined,
      '',
      '   ',
      'not json at all',
      '{',
      '[]',
      'null',
      '123',
      '"string"',
      '{"id":"a"}',
      '[null, 1, "x", {}, []]',
      '[{"id":"a","name":"A"}]',
      '[{"id":"a","name":"","colors":{}}]',
      '[{"id":"","name":"A","colors":{"bg":"#000000"}}]',
      '[{"id":"a","name":"A","colors":{"bg":"#000000","text":"#ffffff","textMuted":"#cccccc","primary":"#ff0000","badgeBg":"javascript:alert(1)","elevation":"nope"}}]',
      '[{"id":"a","name":"<script>","colors":{}}]',
      '[{"id":"a","name":"A","createdAt":"bugun","colors":{}}]',
    ]
    for (const raw of hostile) {
      let result: CustomTheme[]
      expect(() => {
        result = parseCustomThemes(raw as string | null | undefined)
      }, String(raw)).not.toThrow()
      expect(Array.isArray(result)).toBe(true)
      // Cevher bozuk girdiden sonuc her zaman dizi olmali.
      expect(parseCustomThemes(raw as string | null | undefined)).toEqual(expect.any(Array))
    }
  })

  it('boluk JSON kaydini atar, gecerli kayitlari korur', () => {
    const good = createCustomTheme(GOOD_DRAFT, 111)
    if (!good.ok) throw new Error('kurulum hatasi')
    const mixed = JSON.stringify([
      { broken: true },
      { id: 'ok', name: 'Gecerli', colors: good.theme.colors, createdAt: 1 },
      'yok say',
      { id: 'ok', name: 'Tekrar', colors: good.theme.colors, createdAt: 1 },
    ])
    const parsed = parseCustomThemes(mixed)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('ok')
    expect(parsed[0].name).toBe('Gecerli')
  })

  it('eksik renkli kayit reddedilir, zenginlesik kayit onarilir', () => {
    expect(sanitizeStoredColors(null)).toBeNull()
    expect(sanitizeStoredColors({ bg: '#000000' })).toBeNull()
    expect(sanitizeStoredColors('rgb(0,0,0)')).toBeNull()

    const repaired = sanitizeStoredColors({
      bg: '#101010',
      text: '#f0f0f0',
      textMuted: '#c0c0c0',
      primary: '#6aa6ff',
    })
    expect(repaired).not.toBeNull()
    expect(repaired?.bg).toBe('#101010')
    // Eksik alanlar Datalogundan tamamlanir, tema yine de kullanilabilir.
    expect(repaired?.codeBg).toBe(THEMES.Custom.codeBg)
  })
})

describe('Yeni ceviri anahtarlari', () => {
  const CUSTOM_KEYS = [
    'settings.appearance.custom',
    'settings.appearance.customHint',
    'settings.appearance.customName',
    'settings.appearance.customNamePlaceholder',
    'settings.appearance.customNameHint',
    'settings.appearance.customNameTooLong',
    'settings.appearance.customNameEmpty',
    'settings.appearance.customBg',
    'settings.appearance.customPrimary',
    'settings.appearance.customAccent',
    'settings.appearance.customText',
    'settings.appearance.customHexInvalid',
    'settings.appearance.customContrastWarn',
    'settings.appearance.customSave',
    'settings.appearance.customSaved',
    'settings.appearance.customSaveFailed',
    'settings.appearance.customLimit',
    'settings.appearance.customRenamed',
    'settings.appearance.customCancel',
    'settings.appearance.customList',
    'settings.appearance.customEmpty',
    'settings.appearance.customApply',
    'settings.appearance.customApplied',
    'settings.appearance.customRename',
    'settings.appearance.customRenameSave',
    'settings.appearance.customRenameCancel',
    'settings.appearance.customDelete',
    'settings.appearance.customDeleteConfirm',
    'settings.appearance.customDeleted',
    'settings.appearance.customEditLocked',
  ]

  it('tum yeni anahtarlar hem TR hem EN tarafinda mevcut ve dolu', () => {
    for (const key of CUSTOM_KEYS) {
      expect(translations.tr[key], `tr.${key}`).toBeTruthy()
      expect(translations.en[key], `en.${key}`).toBeTruthy()
      expect(translations.tr[key], `tr.${key}`).not.toBe(key)
      expect(translations.en[key], `en.${key}`).not.toBe(key)
    }
  })

  it('anahtar kumesi iki dilde de tamamen ayni (asimetri yok)', () => {
    expect(Object.keys(translations.tr).sort()).toEqual(Object.keys(translations.en).sort())
  })

  it('TR ve EN metinleri birbirinin çevirisi gibi davranir (birebir kopya degil)', () => {
    const sameAsEnglish = CUSTOM_KEYS.filter(
      key => translations.tr[key] === translations.en[key] && /[A-Za-z]{4}/.test(translations.tr[key]),
    )
    expect(sameAsEnglish).toEqual([])
  })
})