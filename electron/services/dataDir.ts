/**
 * dataDir.ts
 * ---------------------------------------------------------------------------
 * Uygulama veri klasorunu TEK bir yerden hesaplar.
 *
 * SORUN (kullanici bildirimi: "oturum surekli sifirlaniyor", "veriler
 * kayboluyor")
 * -----------------------------------------------------------------
 * `keyringService`, `storageService`, `vaultService` ve `oauth` ayni satiri
 * tekrarliyordu:
 *
 *     app.getPath('userData') || path.join(process.cwd(), '.jmc_data')
 *
 * `app.getPath('userData')` HIC BIR SEY donmezse (Electron henuz
 * `app.whenReady()` cagrilmamis, `app` mock'lanmis, ya da paketlenmis
 * uygulama salt-okunur bir dizinden acilmis) geri dusen yer
 * `process.cwd()` idi. Paketlenmis uygulamada `cwd` kullanicinin DOSYA
 * gezgininden gezdirip EXE'yi CIFT TIKLADIGI klasordur — cogu zaman
 * `C:\Program Files\...`, yani YAZILAMAZ. Sonuc:
 *
 *   • Anahtar yazilamaz → her acilista YENI anahtar uretilir → veritabani
 *     cozulemez → ders listesi BOS gorunur.
 *   • Klasor sinirli oldugu icin veri tutulamaz.
 *   • Kurulum klasoru degistiginde tum veri "kaybolur".
 *
 * Duzeltme: geri dus zinciri SABIT ve YAZILABILIR:
 *   1. `app.getPath('userData')`      (normal durum)
 *   2. `app.getPath('appData')/JustMyClass`
 *   3. `os.homedir()/.jmc_data`       (kullanici ev dizini)
 *   4. `os.tmpdir()/JustMyClass`      (son care)
 *
 * `process.cwd()` HICBIR ZAMAN kullanilmaz; kurulum klasoru veri deposu
 * olarak kullanilamaz.
 */
import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const APP_DIR_NAME = 'JustMyClass'

/**
 * Bir klasorun "bizim verimizi iceriyor" oldugunu gosteren dosya adlari.
 * Bunlarin varligi, klasorun daha onceden kullanildigini kanitlar.
 */
const DATA_MARKERS = [
  'jmc_master.key',
  'secrets.vault',
  'jmc_local_store.json',
  'auth.store.json',
  'classroom.store.json',
  'settings.store.json',
]

/** Klasorde bizden kalma veri var mi? */
function dirHasExistingData(dir: string): boolean {
  try {
    return DATA_MARKERS.some(name => fs.existsSync(path.join(dir, name)))
  } catch {
    return false
  }
}

/** Bir dizinin gercekten yazilabilir olup olmadigini sinar. */
function isWritableDir(dir: string): boolean {
  try {
    if (!dir) return false
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.jmc-write-probe-${process.pid}-${Date.now()}`)
    fs.writeFileSync(probe, 'x')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/**
 * Uygulama veri klasorunu dondurur ve olusturur.
 *
 * Sonuc ONCEBELLEGINDEN (module-level) hesaplanir: tum servisler ayni
 * yolu kullanir, boylece veritabani, anahtar kasasi ve OAuth dosyalari
 * ASLA farkli klasorlerde birikmez.
 */
export function resolveDataDir(): string {
  const candidates: string[] = []

  try {
    const userData = app?.getPath?.('userData')
    if (userData) candidates.push(userData)
  } catch {
    /* Electron hazir degil */
  }

  try {
    const appData = app?.getPath?.('appData')
    if (appData) candidates.push(path.join(appData, APP_DIR_NAME))
  } catch {
    /* yoksay */
  }

  candidates.push(path.join(os.homedir(), '.jmc_data'))

  try {
    candidates.push(path.join(os.tmpdir(), APP_DIR_NAME))
  } catch {
    /* yoksay */
  }

  return pickDataDir(candidates)
}

/**
 * ONCEKI YAZILABILIRLIK-KURALLI SECIMIN TEHLIKESI
 * ----------------------------------------------------
 * Yalnizca "ilk yazilabilir aday" seciliyordu. `app.getPath('userData')`
 * yazilabilir ama BOS oldugunda, verisi `appData/JustMyClass` icinde duran
 * bir kullanicinin verisi "kaybolmus" gibi gorunuyordu — kullanicinin
 * bildirdigi "verilerim kayboldu" semptomunun bir kaynagi tam olarak budur.
 *
 * Cozum: once VERI BULUNDURAN aday tercih edilir, ancak yazilabilir olma
 * sarttir (veri bulunan klasor salt-okunur ise oraya yazamayiz ve servisler
 * tani ve yazma engeli bildirir; sessizce bos klasore kaymayiz).
 */
function pickDataDir(candidates: string[]): string {
  const writable = candidates.filter(isWritableDir)
  if (writable.length === 0) {
    return candidates[0] ?? path.join(os.tmpdir(), APP_DIR_NAME)
  }
  const withData = writable.find(dirHasExistingData)
  return withData ?? writable[0]
}

/** Veri klasorunun YOLUNU degistirmeden, yazma kurulumu sonucunu raporlar. */
export function describeDataDir(): { dir: string; writable: boolean; cwdFallbackUsed: boolean } {
  const dir = resolveDataDir()
  return {
    dir,
    writable: isWritableDir(dir),
    cwdFallbackUsed: false,
  }
}