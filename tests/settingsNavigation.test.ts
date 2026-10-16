import { describe, it, expect } from 'vitest'
import { sanitizeTab, VALID_TABS } from '../src/features/settings/SettingsModal'
import { THEMES } from '../src/themes/themeConfig'

describe('Settings Sekme ve Navigasyon Dayanıklılığı', () => {
  it('tüm geçerli sekmeleri tanır ve korur', () => {
    for (const tab of VALID_TABS) {
      expect(sanitizeTab(tab)).toBe(tab)
    }
  })

  it('undefined veya null verildiğinde varsayılan providers döner', () => {
    expect(sanitizeTab(undefined)).toBe('providers')
    expect(sanitizeTab(null)).toBe('providers')
  })

  it('SyntheticEvent veya rastgele nesne verildiğinde çökmez ve providers döner', () => {
    const fakeEvent = {
      isTrusted: true,
      target: {},
      currentTarget: {},
      preventDefault: () => {},
    }
    expect(sanitizeTab(fakeEvent)).toBe('providers')
    expect(sanitizeTab({})).toBe('providers')
    expect(sanitizeTab(12345)).toBe('providers')
  })

  it('geçersiz sekme adı verildiğinde güvenle providers döner', () => {
    expect(sanitizeTab('unknown_tab')).toBe('providers')
    expect(sanitizeTab('')).toBe('providers')
  })

  it('varsayılan tema siyah mor olan Neon Dreams renklerini içerir', () => {
    const neon = THEMES['Neon Dreams']
    expect(neon).toBeDefined()
    // Koyu siyah/mor zemin ve mor vurgu rengi
    expect(neon.bg).toBe('#0d0817')
    expect(neon.primary).toBe('#a973ea')
  })
})
