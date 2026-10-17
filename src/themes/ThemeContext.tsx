import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ThemeColors, ThemeName } from '../../types/jmc'
import { THEMES } from './themeConfig'

/** Bir rengi sRGB → lineer RGB'ye çevirir (WCAG 2.x formülü). */
function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** #rgb / #rrggbb biçimindeki rengi [r,g,b] olarak ayrıştırır. */
export function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim()
  if (h.startsWith('rgb')) {
    const m = h.match(/[\d.]+/g)
    if (!m || m.length < 3) return null
    return [Number(m[0]), Number(m[1]), Number(m[2])]
  }
  h = h.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length !== 6) return null
  const n = Number.parseInt(h, 16)
  if (Number.isNaN(n)) return null
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** İki renk arasındaki gerçek WCAG kontrast oranı (1–21). */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return 1
  const lum = ([r, g, bl]: [number, number, number]) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl)
  const la = lum(ca)
  const lb = lum(cb)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

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
  }
}

/**
 * Rengin göreli parlaklığını döndürür (0 = siyah, 1 = beyaz).
 *
 * `color-scheme` ve Prism vurgu renkleri bu değere göre karar verir.
 */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * Tema "açık" mı?
 *
 * SORUN: `color-scheme` her zaman `dark` yazılıyordu. `Light` ve `Sand`
 * temalarında tarayıcı-native kaydırma çubuğu, `<select>` açılır listesi ve
 * metin seçimi KOYU zeminde beyaz gösteriyordu; ayrıca açık temada gölge
 * ve vurgular okunmuyordu. Karar artık gerçek arka plan parlaklığından
 * türetiliyor.
 */
export function isLightTheme(colors: ThemeColors): boolean {
  return relativeLuminance(colors.bg) > 0.4
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
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const FALLBACK = THEMES['Neon Dreams']

function loadCustomColors(): ThemeColors {
  try {
    const raw = localStorage.getItem('jmc_custom_theme')
    if (!raw) return THEMES.Custom
    const parsed = JSON.parse(raw) as Partial<ThemeColors>
    // Kayıtlı özel tema eski biçimdeyse (elevation yoksa) tamamlanır.
    return { ...THEMES.Custom, ...parsed, elevation: parsed.elevation ?? THEMES.Custom.elevation }
  } catch {
    return THEMES.Custom
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('jmc_theme') as ThemeName | null
    return saved && saved in THEMES ? saved : 'Neon Dreams'
  })
  const [customColors, setCustomColors] = useState<ThemeColors>(loadCustomColors)
  const [reduceMotion, setReduceMotion] = useState<boolean>(
    () => localStorage.getItem('jmc_reduce_motion') === '1',
  )
  const [compact, setCompactState] = useState<boolean>(
    () => localStorage.getItem('jmc_compact') === '1',
  )

  const colors = useMemo(
    () => (theme === 'Custom' ? customColors : THEMES[theme] ?? FALLBACK),
    [theme, customColors],
  )
  const audit = useMemo(() => auditTheme(colors), [colors])

  useEffect(() => {
    const root = document.documentElement
    const set = (k: string, v: string) => root.style.setProperty(k, v)
    set('--jmc-bg', colors.bg)
    set('--jmc-bg-elevated', colors.bgElevated)
    set('--jmc-bg-surface', colors.bgSurface)
    set('--jmc-border', colors.border)
    set('--jmc-border-subtle', colors.borderSubtle)
    set('--jmc-text', colors.text)
    set('--jmc-text-muted', colors.textMuted)
    set('--jmc-text-dim', colors.textDim)
    set('--jmc-primary', colors.primary)
    set('--jmc-primary-hover', colors.primaryHover)
    set('--jmc-accent', colors.accent)
    set('--jmc-accent-hover', colors.accentHover)
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
    // parlakligindan karar verilir; aksi halde `Light` ve `Sand` temalarinda
    // kaydirma cubugu koyu zeminde kalirdi.
    const scheme: 'light' | 'dark' = isLightTheme(colors) ? 'light' : 'dark'
    set('color-scheme', scheme)
    root.style.colorScheme = scheme
    root.dataset.jmcScheme = scheme

    // Prism vurgulari: acik temada koyu tonlarin yerini acik tonlar alir.
    set('--jmc-code-comment', scheme === 'dark' ? '#7c89a0' : '#5b6478')
    set('--jmc-code-punct', scheme === 'dark' ? '#9aa8bd' : '#4b5563')
    set('--jmc-code-literal', scheme === 'dark' ? '#f2857f' : '#b4322b')
    set('--jmc-code-string', scheme === 'dark' ? '#4fd6a4' : '#0a7a4f')
    set('--jmc-code-operator', scheme === 'dark' ? '#57c7f0' : '#0a6f8f')
    set('--jmc-code-keyword', scheme === 'dark' ? '#b18cff' : '#6b21d6')
    set('--jmc-code-function', scheme === 'dark' ? '#7fb0ff' : '#1d4ed8')
    set('--jmc-code-meta', scheme === 'dark' ? '#fbbf24' : '#a16207')

    localStorage.setItem('jmc_theme', theme)
  }, [theme, colors])

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? '1' : '0'
    localStorage.setItem('jmc_reduce_motion', reduceMotion ? '1' : '0')
  }, [reduceMotion])

  useEffect(() => {
    document.documentElement.dataset.density = compact ? 'compact' : 'comfortable'
    localStorage.setItem('jmc_compact', compact ? '1' : '0')
  }, [compact])

  const setTheme = (name: ThemeName) => setThemeState(name)

  const updateCustomColor = (key: keyof ThemeColors, value: string) => {
    setCustomColors(prev => {
      const next = { ...prev, [key]: value }
      localStorage.setItem('jmc_custom_theme', JSON.stringify(next))
      return next
    })
  }

  const resetCustomColors = () => {
    setCustomColors(THEMES.Custom)
    localStorage.removeItem('jmc_custom_theme')
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
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme yalnızca ThemeProvider içinde kullanılabilir.')
  return ctx
}