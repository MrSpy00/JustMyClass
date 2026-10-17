import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { CustomTheme, CustomThemeDraft, ThemeColors, ThemeName } from '../../types/jmc'
import {
  CUSTOM_THEME_ACTIVE_KEY,
  CUSTOM_THEME_NAME_MAX,
  CUSTOM_THEME_STORAGE_KEY,
  MAX_CUSTOM_THEMES,
  THEMES,
  contrastRatio,
  createCustomTheme,
  deriveCodeTokens,
  deriveLinkColors,
  deriveOnColorText,
  deriveRoleTextColors,
  isLightTheme,
  mixHex,
  parseCustomThemes,
  serializeCustomThemes,
  validateCustomThemeName,
} from './themeConfig'

/**
 * Renk yardımcıları `themeConfig`e taşındı (saf fonksiyonlar, test edilebilir).
 * Eski içe aktarma yolu korunur: `parseHex` / `contrastRatio` /
 * `relativeLuminance` / `isLightTheme` buradan da dışa açıktır.
 */
export { parseHex, contrastRatio, relativeLuminance, isLightTheme } from './themeConfig'

export interface ContrastReport {
  ratio: number
  /** WCAG AA normal metin (4.5:1) */
  aa: boolean
  /** WCAG AA büyük metin (3:1) */
  aaLarge: boolean
  /** WCAG AAA normal metin (7:1) */
  aaa: boolean
}

export interface ThemeAudit {
  body: ContrastReport
  muted: ContrastReport
  dim: ContrastReport
  primaryOnBg: ContrastReport
  /**
   * Baglantinin zemine gore kontrasti.
   *
   * `deriveLinkColors` kontrasti zorladigi icin bu deger pratikte her
   * zaman AA'nin ustundedir. Yine de olculur: kullanici bir tema
   * GOMULU `link` rengi tanimladiysa ve bu renk hedefin altinda kaldiysa
   * panelde gorunur.
   */
  linkOnBg: ContrastReport
}

function report(ratio: number): ContrastReport {
  return { ratio, aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7 }
}

function auditTheme(c: ThemeColors): ThemeAudit {
  return {
    body: report(contrastRatio(c.text, c.bg)),
    muted: report(contrastRatio(c.textMuted, c.bg)),
    dim: report(contrastRatio(c.textDim, c.bg)),
    primaryOnBg: report(contrastRatio(c.primary, c.bg)),
    // Baglanti rengi kontrasti ZORLAYARAK uretilir; bu yuzden asagidaki
    // degerle bakilir. Uretilen rengin kendisi olculur, ham temadaki
    // `accent` degil.
    linkOnBg: report(contrastRatio(deriveLinkColors(c).link, c.bg)),
  }
}

/* ------------------------------------------------------------------ */
/* localStorage güvenli erişim                                          */
/* ------------------------------------------------------------------ */

/**
 * localStorage erişimi her ortamda güvenli olmayabilir (kota dolu, gizli mod,
 * kapatılmış depolama). Tüm tema kalıcılığı bu üç yardımcıdan geçer; hiçbiri
 * çökmez, en kötü ihtimalle varsayılan devreye girer.
 */
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* kota dolu / depolama kapalı: tema yine de oturum içinde çalışır */
  }
}

function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* yoksay */
  }
}

/* ------------------------------------------------------------------ */
/* Özel tema API'si                                                    */
/* ------------------------------------------------------------------ */

export type CustomThemeError = 'name' | 'limit' | 'color' | 'empty' | 'too_long'

export type CustomThemeSaveResult = { ok: true; id: string } | { ok: false; error: CustomThemeError }

function loadCustomColors(): ThemeColors {
  try {
    const raw = readStorage('jmc_custom_theme')
    if (!raw) return THEMES.Custom
    const parsed = JSON.parse(raw) as Partial<ThemeColors>
    // Kayıtlı özel tema eski biçimdeyse (elevation yoksa) tamamlanır.
    return { ...THEMES.Custom, ...parsed, elevation: parsed.elevation ?? THEMES.Custom.elevation }
  } catch {
    return THEMES.Custom
  }
}

interface ThemeContextValue {
  theme: ThemeName
  setTheme: (name: ThemeName) => void
  colors: ThemeColors
  customColors: ThemeColors
  updateCustomColor: (key: keyof ThemeColors, value: string) => void
  resetCustomColors: () => void
  /** Gerçek, hesaplanmış kontrast denetimi. Sabit değer değildir. */
  audit: ThemeAudit
  reduceMotion: boolean
  setReduceMotion: (v: boolean) => void
  compact: boolean
  setCompact: (v: boolean) => void

  /* --- Custom Theme Builder ------------------------------------- */
  /** Kalıcı olarak saklanmış, kullanıcıya ait temalar. */
  customThemes: CustomTheme[]
  /** Etkin kayıtlı temanın kimliği (yoksa `null`). */
  activeCustomThemeId: string | null
  /** Kayıtlı bir temayı etkinleştirir ve hemen uygular. */
  applyCustomTheme: (id: string) => void
  /** Taslağı doğrular, listeye ekler ve hemen uygular. */
  saveCustomTheme: (draft: CustomThemeDraft) => CustomThemeSaveResult
  /** Kayıtlı temanın adını değiştirir. */
  renameCustomTheme: (id: string, name: string) => CustomThemeSaveResult
  /** Kayıtlı temayı siler; etkinse varsayılan temaya döner. */
  removeCustomTheme: (id: string) => void
  /** Canlı önizleme. `null` verilirse önizleme bırakılır (önceki tema geri gelir). */
  previewColors: (colors: ThemeColors | null) => void
  /** Şu anda bir önizleme mi uygulanıyor? */
  isPreviewing: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const FALLBACK = THEMES['Neon Dreams']

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = readStorage('jmc_theme') as ThemeName | null
    return saved && saved in THEMES ? saved : 'Neon Dreams'
  })
  const [customColors, setCustomColors] = useState<ThemeColors>(loadCustomColors)
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(() =>
    parseCustomThemes(readStorage(CUSTOM_THEME_STORAGE_KEY)),
  )
  const [activeCustomThemeId, setActiveCustomThemeId] = useState<string | null>(() => {
    const id = readStorage(CUSTOM_THEME_ACTIVE_KEY)
    return id && id.trim() ? id : null
  })
  /** Canlı önizleme: kalıcı değildir, vazgeçilince `null` olur. */
  const [preview, setPreview] = useState<ThemeColors | null>(null)
  const [reduceMotion, setReduceMotion] = useState<boolean>(
    () => readStorage('jmc_reduce_motion') === '1',
  )
  const [compact, setCompactState] = useState<boolean>(() => readStorage('jmc_compact') === '1')

  /**
   * Önizleme uygulanmadığı andaki "gerçek" renkler. `Custom` iki kaynaktan
   * beslenir: etkin kayıtlı tema varsa o, yoksa eski tek renk özel ayar.
   */
  const baseColors = useMemo(() => {
    if (theme === 'Custom') {
      if (activeCustomThemeId) {
        return customThemes.find(t => t.id === activeCustomThemeId)?.colors ?? customColors
      }
      return customColors
    }
    return THEMES[theme] ?? FALLBACK
  }, [theme, customThemes, activeCustomThemeId, customColors])

  const colors = preview ?? baseColors
  const audit = useMemo(() => auditTheme(colors), [colors])
  const isPreviewing = preview !== null

  useEffect(() => {
    const root = document.documentElement
    const set = (k: string, v: string) => root.style.setProperty(k, v)
    set('--jmc-bg', colors.bg)
    set('--jmc-bg-elevated', colors.bgElevated)
    set('--jmc-bg-surface', colors.bgSurface)
    set('--jmc-border', colors.border)
    set('--jmc-border-subtle', colors.borderSubtle)
    const borderHover = mixHex(colors.border, colors.text, 0.22)
    set('--jmc-border-hover', borderHover)
    set('--jmc-border-focus', borderHover)
    set('--jmc-text', colors.text)
    set('--jmc-text-muted', colors.textMuted)
    set('--jmc-text-dim', colors.textDim)
    set('--jmc-primary', colors.primary)
    set('--jmc-primary-hover', colors.primaryHover)
    set('--jmc-accent', colors.accent)
    set('--jmc-accent-hover', colors.accentHover)

    // Baglanti renkleri: tema tanimlamadiysa kontrast zorlanarak hesaplanir.
    // Bu iki degisken olmadan bazi temalarda link arka planla ayni renge
    // dustugu icin OKUNMUZ kalirdi.
    const linkColors = deriveLinkColors(colors)
    set('--jmc-link', linkColors.link)
    set('--jmc-link-hover', linkColors.linkHover)

    // Dolgu renklerinin UZERINDE okunabilir metin rengi.
    //
    // Onceki surumde kullanici balonu `text-white` ile sabit yaziliydi.
    // `primary` acik bir ton oldugunda (High Contrast #ffd400 -> 1.43,
    // Graphite #b8bcc6 -> 1.90, Matrix -> 2.00) beyaz metin okunmuyordu;
    // 17 temanin 16'sinda kullanicinin kendi mesaji bozuk kontrastti.
    const onColor = deriveOnColorText(colors)
    set('--jmc-on-primary', onColor.onPrimary)
    set('--jmc-on-primary-hover', onColor.onPrimaryHover)
    set('--jmc-on-accent', onColor.onAccent)
    set('--jmc-on-accent-hover', onColor.onAccentHover)
    set('--jmc-on-warning', onColor.onWarning)
    set('--jmc-on-danger', onColor.onDanger)
    set('--jmc-on-success', onColor.onSuccess)

    /*
      DOLGU RENKLERININ "YARI SAYDAM UZERINDE METIN" HALI
      -----------------------------------------------------
      Rozetler `bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary-text)]`
      seklinde yaziliyor. Zemin rengin yalnizca %15'i yuzeyin uzerine
      bindirildigi icin etkin zemin yuzeye yakindir; okunurluk rengin
      YUZEYE gore kontrastina baglidir.

      Turetilmis degerler, zaten okunabilir olan temalarda DEGISMEZ
      (`ensureContrastOnAll` okunabilir rengi oldugu gibi birakir).
      Olculeen 25 ihlalin tamami duzelir; en kotusu Pastel Soft accent
      2.73 idi (normal metin icin gereken 4.5'in belirgin altinda).

      AYRIM: `--jmc-*-text` bu rengin UZERINDE olmayan, yani acik bir
      zeminde kullanilan halidir. `--jmc-on-*` ise dolgunun UZERINDE
      yazilan metindir. Ikisi karistirilmamalidir.
    */
    const roleText = deriveRoleTextColors(colors)
    set('--jmc-primary-text', roleText.primaryText)
    set('--jmc-accent-text', roleText.accentText)
    set('--jmc-success-text', roleText.successText)
    set('--jmc-warning-text', roleText.warningText)
    set('--jmc-danger-text', roleText.dangerText)
    set('--jmc-warning', colors.warning)
    set('--jmc-danger', colors.danger)
    set('--jmc-success', colors.success)
    set('--jmc-code-bg', colors.codeBg)
    set('--jmc-badge-bg', colors.badgeBg)
    set('--jmc-elevation', colors.elevation)
    set('--jmc-shadow-sm', `0 1px 2px ${colors.elevation}`)
    set('--jmc-shadow-md', `0 4px 14px ${colors.elevation}`)
    set('--jmc-shadow-lg', `0 18px 48px ${colors.elevation}`)
    // `--jmc-shadow-xl` önceden YAZILMIYORDU. Bilesenler (belge onizleme
    // penceresi, model secici) bu belirteci kullaniyordu ve yalnizca
    // stylesheet'teki varsayilana dusuyordu; tema degisince golge gorsel
    // olarak eski kaliyordu.
    set('--jmc-shadow-xl', `0 24px 60px -8px ${colors.elevation}`)

    // Tarayıcı-native bilesenler (select acilir listesi, kaydirma cubugu,
    // metin secimi) de temayi izlesin. Sabit `dark` yerine gercek arka plan
    // parlakligindan karar verilir; aksi halde `Light`, `Sand` ve
    // `Pastel Soft` temalarinda kaydirma cubugu koyu zeminde kalirdi.
    const scheme: 'light' | 'dark' = isLightTheme(colors) ? 'light' : 'dark'
    set('color-scheme', scheme)
    root.style.colorScheme = scheme
    root.dataset.jmcScheme = scheme

    // Prism vurgulari artik SABIT iki paletten secilmiyor: her jeton
    // `codeBg`dan turetilir ve kontrasti garanti edilir. Boylece kullanici
    // renkli kod zemini secse bile kod okunabilir kalir.
    const code = deriveCodeTokens(colors.codeBg)
    set('--jmc-code-comment', code.comment)
    set('--jmc-code-punct', code.punct)
    set('--jmc-code-literal', code.literal)
    set('--jmc-code-string', code.string)
    set('--jmc-code-operator', code.operator)
    set('--jmc-code-keyword', code.keyword)
    set('--jmc-code-function', code.function)
    set('--jmc-code-meta', code.meta)

    writeStorage('jmc_theme', theme)
  }, [theme, colors])

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? '1' : '0'
    writeStorage('jmc_reduce_motion', reduceMotion ? '1' : '0')
  }, [reduceMotion])

  useEffect(() => {
    document.documentElement.dataset.density = compact ? 'compact' : 'comfortable'
    writeStorage('jmc_compact', compact ? '1' : '0')
  }, [compact])

  const previewColors = useCallback((next: ThemeColors | null) => setPreview(next), [])

  // Temayı değiştirirken canlı önizleme düşer; aksi halde önizleme, seçilen
  // yerleşik temanın renklerini gizlerdi.
  const setTheme = useCallback((name: ThemeName) => {
    setPreview(null)
    setThemeState(name)
  }, [])

  const applyCustomTheme = useCallback((id: string) => {
    setActiveCustomThemeId(id)
    writeStorage(CUSTOM_THEME_ACTIVE_KEY, id)
    setPreview(null)
    setThemeState('Custom')
  }, [])

  const saveCustomTheme = useCallback(
    (draft: CustomThemeDraft): CustomThemeSaveResult => {
      if (customThemes.length >= MAX_CUSTOM_THEMES) return { ok: false, error: 'limit' }
      const built = createCustomTheme(draft, Date.now())
      if (!built.ok) return { ok: false, error: built.reason }
      setCustomThemes(prev => {
        const next = [...prev, built.theme]
        writeStorage(CUSTOM_THEME_STORAGE_KEY, serializeCustomThemes(next))
        return next
      })
      applyCustomTheme(built.theme.id)
      return { ok: true, id: built.theme.id }
    },
    [customThemes, applyCustomTheme],
  )

  const renameCustomTheme = useCallback(
    (id: string, rawName: string): CustomThemeSaveResult => {
      if (!customThemes.some(t => t.id === id)) return { ok: false, error: 'name' }
      const checked = validateCustomThemeName(rawName)
      if (!checked.ok) return { ok: false, error: 'name' }
      const name = checked.name
      setCustomThemes(prev => {
        const list = prev.map(t => (t.id === id ? { ...t, name } : t))
        writeStorage(CUSTOM_THEME_STORAGE_KEY, serializeCustomThemes(list))
        return list
      })
      return { ok: true, id }
    },
    [customThemes],
  )

  const removeCustomTheme = useCallback(
    (id: string) => {
      setCustomThemes(prev => {
        const list = prev.filter(t => t.id !== id)
        writeStorage(CUSTOM_THEME_STORAGE_KEY, serializeCustomThemes(list))
        return list
      })
      if (activeCustomThemeId === id) {
        setActiveCustomThemeId(null)
        removeStorage(CUSTOM_THEME_ACTIVE_KEY)
        setPreview(null)
        setThemeState('Dark')
      }
    },
    [activeCustomThemeId],
  )

  const updateCustomColor = (key: keyof ThemeColors, value: string) => {
    setCustomColors(prev => {
      const next = { ...prev, [key]: value }
      writeStorage('jmc_custom_theme', JSON.stringify(next))
      return next
    })
  }

  const resetCustomColors = () => {
    setCustomColors(THEMES.Custom)
    removeStorage('jmc_custom_theme')
  }

  const setCompact = (v: boolean) => setCompactState(v)

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        colors,
        customColors,
        updateCustomColor,
        resetCustomColors,
        audit,
        reduceMotion,
        setReduceMotion,
        compact,
        setCompact,
        customThemes,
        activeCustomThemeId,
        applyCustomTheme,
        saveCustomTheme,
        renameCustomTheme,
        removeCustomTheme,
        previewColors,
        isPreviewing,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export { CUSTOM_THEME_NAME_MAX, MAX_CUSTOM_THEMES }

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme yalnızca ThemeProvider içinde kullanılabilir.')
  return ctx
}