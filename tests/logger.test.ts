import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

/**
 * Gunluk (logger) testleri.
 *
 * EN ONEMLI OZELLIK `redactLogText`: gunluk dosyasi kullaniciyla
 * paylasilabilir, bu yuzden bir gelistirici yanlislikla bir API anahtari
 * yazsa bile duz metin olarak cikmasidir. Bu testler o garantiyi tutar.
 */

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA, isPackaged: false },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

import { redactLogText, initLogger, setLogLevel, getLogLevel, log, getLogDir } from '../electron/services/logger'

const USER_DATA = makeTempUserDataDir()

describe('logger', () => {
  beforeEach(() => {
    setLogLevel('debug')
  })

  afterEach(() => {
    try {
      fs.rmSync(path.join(USER_DATA, 'logs'), { recursive: true, force: true })
    } catch {
      /* yoksay */
    }
  })

  describe('redactLogText', () => {
    it('Gemini (AIza) anahtarini temizler', () => {
      const key = 'AIzaSyD-abcdefghijklmnopqrstuvwxyz012345'
      const out = redactLogText(`Anahtar: ${key}`)
      expect(out).not.toContain(key)
      expect(out).toContain('REDACTED')
    })

    it('OpenAI/Anthropic/xAI/Groq anahtarlarini temizler', () => {
      const keys = [
        'sk-abcdefghijklmnopqrstuvwxyz0123',
        'xai-abcdefghijklmnopqrstuvwxyz0123',
        'gsk_abcdefghijklmnopqrstuvwxyz0123',
      ]
      for (const k of keys) {
        expect(redactLogText(`k=${k}`)).not.toContain(k)
      }
    })

    it('JSON icindeki gizli alanlari temizler', () => {
      const raw = '{"client_secret":"GOCSPX-abc123","client_id":"123.apps.googleusercontent.com","name":"x"}'
      const out = redactLogText(raw)
      expect(out).not.toContain('GOCSPX-abc123')
      expect(out).toContain('client_id')
      // client_id korunur: gizli degildir, tanilama icin gereklidir.
      expect(out).toContain('123.apps.googleusercontent.com')
    })

    it('sifre alanini temizler', () => {
      const out = redactLogText('{"password":"SuperGizli123","user":"ahmet"}')
      expect(out).not.toContain('SuperGizli123')
      expect(out).toContain('ahmet')
    })

    it('Authorization basligindaki bearer jetonu temizler', () => {
      const out = redactLogText('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
      expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    })

    it('gunluk mesajini degistirmez (gizli deger yoksa dokunmaz)', () => {
      const raw = '[JustMyClass] Model katalogu guncellendi: gemini(12)'
      expect(redactLogText(raw)).toBe(raw)
    })

    it('kisaltilmis anahtari TEMIZLEMEZ (yanlis pozitif uretmemeli)', () => {
      // Cok kisa / gecersiz desenler dokunulmadan gecirilir; aksi halde
      // her gunluk satiri bozulur ve gercek hata okunamaz olur.
      expect(redactLogText('sk-kisa')).toBe('sk-kisa')
      expect(redactLogText('AIza123')).toBe('AIza123')
    })
  })

  describe('seviye filtreleme', () => {
    it('getLogLevel/setLogLevel calisir', () => {
      setLogLevel('warn')
      expect(getLogLevel()).toBe('warn')
      setLogLevel('debug')
      expect(getLogLevel()).toBe('debug')
    })
  })

  describe('dosya havuzu', () => {
    it('initLogger sonrasi gunluk dizini olusur', () => {
      initLogger(USER_DATA)
      expect(getLogDir()).toBe(path.join(USER_DATA, 'logs'))
      expect(fs.existsSync(getLogDir()!)).toBe(true)
    })

    it('log.* cagrisi dosyaya satir yazar', () => {
      initLogger(USER_DATA)
      log.info('deneme mesaji')
      const day = new Date().toISOString().slice(0, 10)
      const file = path.join(USER_DATA, 'logs', `justmyclass-${day}.log`)
      expect(fs.existsSync(file)).toBe(true)
      const raw = fs.readFileSync(file, 'utf8')
      expect(raw).toContain('deneme mesaji')
      expect(raw).toContain('[INFO]')
    })

    it('dosyaya yazilan kayitlar da temizlenir', () => {
      initLogger(USER_DATA)
      const key = 'AIzaSyD-abcdefghijklmnopqrstuvwxyz012345'
      log.error(`istek basarisiz, anahtar: ${key}`)
      const day = new Date().toISOString().slice(0, 10)
      const raw = fs.readFileSync(path.join(USER_DATA, 'logs', `justmyclass-${day}.log`), 'utf8')
      expect(raw).not.toContain(key)
    })

    it('cok satirli mesaj tek satira indirgenir', () => {
      initLogger(USER_DATA)
      log.warn('satir1\nsatir2\nsatir3')
      const day = new Date().toISOString().slice(0, 10)
      const raw = fs.readFileSync(path.join(USER_DATA, 'logs', `justmyclass-${day}.log`), 'utf8')
      // Her satir [WARN] ile baslamamali
      expect(raw.split('\n').filter(l => l.trim().startsWith('satir')).length).toBe(0)
    })

    it('Error nesnesi okunabilir sekilde yazilir', () => {
      initLogger(USER_DATA)
      log.error(new Error('patlama detayi'))
      const day = new Date().toISOString().slice(0, 10)
      const raw = fs.readFileSync(path.join(USER_DATA, 'logs', `justmyclass-${day}.log`), 'utf8')
      expect(raw).toContain('Error: patlama detayi')
    })

    it('initLogger cagrilmadan once de konsola yazilir (veri kaybi yok)', () => {
      // Dosya havuzu kapali; cagri patlamamali.
      expect(() => log.info('erken mesaj')).not.toThrow()
    })

    it('null veri dizini hata vermez', () => {
      expect(() => initLogger(null)).not.toThrow()
      expect(() => log.info('mesaj')).not.toThrow()
    })

    it('gunluk dosyalari 5 ile sinirlanir', () => {
      initLogger(USER_DATA)
      const dir = path.join(USER_DATA, 'logs')
      for (let d = 1; d <= 9; d += 1) {
        fs.writeFileSync(path.join(dir, `justmyclass-2026-01-0${d}.log`), 'eski')
      }
      // Yeni bir yazma, prune tetikler
      log.info('tetikleyici')
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.log'))
      expect(files.length).toBeLessThanOrEqual(6) // 5 arsiv + bugun
    })
  })
})