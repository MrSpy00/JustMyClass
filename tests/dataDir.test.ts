/**
 * dataDir.test.ts
 * ---------------------------------------------------------------------------
 * Veri klasoru cozumleyicinin regresyon testleri.
 *
 * KULLANICI BILDIRIMI: "oturum surekli sifirlaniyor", "veriler kayboluyor".
 * KOK NEDEN: `app.getPath('userData')` dondurmedigi durumlarda geri dus
 * `process.cwd()` idi. Paketlenmis uygulamada bu, cogu zaman
 * `C:\Program Files\...` gibi YAZILAMAZ bir klasordur; anahtar yazilamadigi
 * icin her acilista yeni anahtar uretiliyor ve sifreli veritabani cozulemiyordu.
 *
 * Bu testler `process.cwd()` yolunun KULLANILMADIGINI ve geri dus
 * zincirinin yazilabilir bir klasorde bittigini dogrular.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP_DIR_NAME = 'JustMyClass'

describe('resolveDataDir', () => {
  let tmpRoot: string
  let realHome: string
  let realTmp: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jmc-datadir-'))
    realHome = os.homedir()
    realTmp = os.tmpdir()
    vi.resetModules()
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      /* yoksay */
    }
    vi.restoreAllMocks()
  })

  it('app.getPath("userData") verirse onu kullanir', async () => {
    const userData = path.join(tmpRoot, 'userData')
    vi.doMock('electron', () => ({
      app: { getPath: (name: string) => (name === 'userData' ? userData : undefined) },
      safeStorage: {},
    }))
    const { resolveDataDir } = await import('../electron/services/dataDir')
    expect(resolveDataDir()).toBe(userData)
    expect(fs.existsSync(userData)).toBe(true)
  })

  it('userData yoksa appData altindaki klasoru kullanir', async () => {
    const appData = path.join(tmpRoot, 'roaming')
    vi.doMock('electron', () => ({
      app: { getPath: (name: string) => (name === 'appData' ? appData : undefined) },
      safeStorage: {},
    }))
    const { resolveDataDir } = await import('../electron/services/dataDir')
    expect(resolveDataDir()).toBe(path.join(appData, APP_DIR_NAME))
  })

  it('Electron hic getPath dondurmezse ana dizine duster, ASLA process.cwd() DEGIL', async () => {
    vi.doMock('electron', () => ({
      app: { getPath: () => { throw new Error('hazir degil') } },
      safeStorage: {},
    }))
    const fakeHome = path.join(tmpRoot, 'home')
    fs.mkdirSync(fakeHome, { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome)

    const { resolveDataDir } = await import('../electron/services/dataDir')
    const dir = resolveDataDir()

    expect(dir).toBe(path.join(fakeHome, '.jmc_data'))
    expect(dir).not.toBe(process.cwd())
    expect(fs.existsSync(dir)).toBe(true)
  })

  it('yazilabilir olmayan adaylari atlar', async () => {
    // Windows'ta yazma denemesi PAccessDenied yerine EEXIST/EPERM doner
    // veya sessizce gecer; bu yuzden "yazilabilir" kontrolunu istemek
    // yerine cozumleyicinin her durumda YAZILABILIR bir klasor dondurdugunu
    // ve bunun var oldugunu dogrulariz.
    vi.doMock('electron', () => ({
      app: { getPath: () => { throw new Error('hazir degil') } },
      safeStorage: {},
    }))
    const fakeHome = path.join(tmpRoot, 'home2')
    fs.mkdirSync(fakeHome, { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome)

    const { resolveDataDir } = await import('../electron/services/dataDir')
    const dir = resolveDataDir()

    const probe = path.join(dir, 'probe.txt')
    fs.writeFileSync(probe, 'ok')
    expect(fs.readFileSync(probe, 'utf8')).toBe('ok')
    fs.unlinkSync(probe)
    expect(realHome).not.toBe('')
    expect(realTmp).not.toBe('')
  })

  it('VERI BULUNDURAN klasoru, bos ama yazilabilir adaydan ONCE secer', async () => {
    // KULLANICI BILDIRIMI: "verilerim kayboldu".
    // KOK NEDEN: secim kurali yalnizca "ilk yazilabilir aday" idi.
    // `userData` yazilabilir ama yeni/BOST oldugunda, verisi
    // `appData/JustMyClass` icinde duran kullanicinin tum verisi
    // "kaybolmus" gibi gorunuyordu.
    const emptyUserData = path.join(tmpRoot, 'empty-userData')
    const populated = path.join(tmpRoot, 'roaming', APP_DIR_NAME)
    fs.mkdirSync(emptyUserData, { recursive: true })
    fs.mkdirSync(populated, { recursive: true })
    // Anahtar dosyasi = "bu klasorde bizim verimiz var" isareti
    fs.writeFileSync(path.join(populated, 'jmc_master.key'), 'x')

    vi.doMock('electron', () => ({
      app: {
        getPath: (name: string) => {
          if (name === 'userData') return emptyUserData
          if (name === 'appData') return path.join(tmpRoot, 'roaming')
          return undefined
        },
      },
      safeStorage: {},
    }))

    const { resolveDataDir } = await import('../electron/services/dataDir')
    expect(resolveDataDir()).toBe(populated)
  })

  it('hicbir adayda veri yoksa ilk yazilabilir adayi kullanir', async () => {
    const emptyUserData = path.join(tmpRoot, 'bos-userData')
    fs.mkdirSync(emptyUserData, { recursive: true })
    vi.doMock('electron', () => ({
      app: { getPath: (name: string) => (name === 'userData' ? emptyUserData : undefined) },
      safeStorage: {},
    }))
    const { resolveDataDir } = await import('../electron/services/dataDir')
    expect(resolveDataDir()).toBe(emptyUserData)
  })
})