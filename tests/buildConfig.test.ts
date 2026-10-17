/**
 * buildConfig.test.ts
 * ---------------------------------------------------------------------------
 * `electron-builder.yml` yapilandirmasinin regresyon testleri.
 *
 * Buradaki kurallarin hicbiri "stil" degildir; her biri bir KIRILMA
 * senaryosunu engeller.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readYml = () => fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')
const readPkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/** Yalnizca `win:` bolumunu dondurur (ilk `win:` anahtarindan sonraki ayni
 *  seviyedeki anahtara kadar). */
function winSection(yml: string): string {
  const start = yml.indexOf('\nwin:')
  if (start === -1) return ''
  const rest = yml.slice(start + 1)
  const next = rest.search(/\n[a-zA-Z#]/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('electron-builder yapilandirmasi', () => {
  it('win icinde publisherName SABIT YAZILMAZ (otomatik guncellemeyi kirar)', () => {
    // KIRILMA SENARYOSU
    // -----------------
    // `win.signtoolOptions.publisherName` degeri `electron-builder.yml`e
    // yazilirsa, electron-builder bunu `latest.yml` ICINE koyar. Bu,
    // sertifika olsa da olmasa da gecerlidir:
    //
    //   app-builder-lib/out/codeSign/windowsSignToolManager.js
    //     computedPublisherName = signtoolOptions.publisherName ?? <cert>
    //
    //   app-builder-lib/out/publish/PublishManager.js
    //     if (isForceCodeSigningVerification) publishConfig.publisherName = ...
    //
    // `electron-updater` `latest.yml`de publisherName gordugu icin indirdigi
    // dosyanin dogru yayici tarafindan imzalanip imzalanmadigini SORAR ve
    // imzasiz dosyayi REDDEDER. Sonuc: imzasiz gelistirme surumunde
    // otomatik guncelleme sessizce calismaz ve kullanici guncellenemez.
    //
    // COZUM: deger yalnizca gercekten imzaladigimizda komut satirindan
    // gecirilir (bkz. scripts/build-win.mjs).
    const win = winSection(readYml())
    expect(win).not.toMatch(/^\s*publisherName\s*:/m)
  })

  it('win.sign altinda publisherName de sabit yazilmaz (eski, kullanilmayan anahtar)', () => {
    const win = winSection(readYml())
    expect(win).not.toMatch(/^\s{2}publisherName\s*:/m)
  })

  it('guncelleme imzasi dogrulama acik', () => {
    // `verifyUpdateCodeSignature: true` (varsayilan da olsa) imzali
    // surumlerde `latest.yml`e yayinci adini yazar; boylece kullaniciya
    // sunulan guncelleme dosyasi DEGISTIRILMISSE kurulum reddedilir.
    const win = winSection(readYml())
    expect(win).toMatch(/verifyUpdateCodeSignature\s*:\s*true/)
  })

  it('zaman damgasi sunucusu tanimli (imza sertifika suresi dolunca gecerli kalir)', () => {
    const win = winSection(readYml())
    expect(win).toMatch(/timeStampServer\s*:\s*https?:\/\//)
  })

  it('yalnizca SHA-256 imza uretilir (eski SHA-1 uretilen dosyayi buyutur)', () => {
    const win = winSection(readYml())
    const algos = win.match(/signingHashAlgorithms:\s*\n((?:\s*-\s*\w+\s*\n)+)/)
    expect(algos).not.toBeNull()
    expect(algos![1]).toMatch(/sha256/)
    expect(algos![1]).not.toMatch(/sha1\b/)
  })

  it('kaldirma verileri SILMEZ', () => {
    // Kullanici "verilerim neden sifirlandi?" diye sordu. Iki ayri yol
    // vardi: bu ayar ve NSIS betigindeki RMDir. Ikisi de kapali olmali.
    const yml = readYml()
    expect(yml).toMatch(/deleteAppDataOnUninstall\s*:\s*false/)

    // NSIS betiginde yorum satirlari (`;` ile baslayan) kaldirilan davranisi
    // BELGELER; onlar silinmis kodu icerir ve test bunlari saymamalidir.
    const nshAll = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8')
    const nshCode = nshAll
      .split(/\r?\n/)
      .filter(l => !/^\s*;/.test(l))
      .join('\n')

    // Kullanici verisi %APPDATA%\JustMyClass icinde durur. Silinmemeli.
    expect(nshCode).not.toMatch(/RMDir\s+\/r\s+"?\$APPDATA\\JustMyClass/i)
    expect(nshCode).not.toMatch(/rmdir\s+\/s\s+\/q\s+"?\$APPDATA\\JustMyClass/i)
    expect(nshCode).not.toMatch(/RMDir\s+\/r\s+"?\$LOCALAPPDATA\\JustMyClass"?\s*$/im)
    // ExecShell satiri icinde de olmamali
    expect(nshCode).not.toMatch(/\$APPDATA\\JustMyClass/i)
  })

  it('uygulama adi her yerde tam olarak "JustMyClass"', () => {
    const pkg = readPkg()
    const yml = readYml()
    expect(pkg.productName).toBe('JustMyClass')
    expect(yml).toMatch(/^productName:\s*JustMyClass\s*$/m)
    // Surum numarasi eklenmemis olmali (YAML girintisine izin verilir)
    expect(yml).toMatch(/^\s*uninstallDisplayName:\s*JustMyClass\s*$/m)
    expect(yml).toMatch(/^\s*shortcutName:\s*JustMyClass\s*$/m)
    expect(yml).toMatch(/^\s*title:\s*JustMyClass\s*$/m)
    // html basligi
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    expect(html).toMatch(/<title>JustMyClass<\/title>/)
    // pencere basligi
    const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.ts'), 'utf8')
    expect(main).toMatch(/title:\s*'JustMyClass'/)
  })
})

describe('imza betigi (package.json)', () => {
  const pkg = readPkg()

  it('build:win imzayi dogrulayan betigi kullanir', () => {
    expect(pkg.scripts['build:win']).toContain('scripts/build-win.mjs')
  })

  it('imzasiz derleme acikca secilebilir', () => {
    expect(pkg.scripts['build:win:unsigned']).toContain('--force-unsigned')
  })

  it('imza dogrulama tek basina calistirilabilir', () => {
    expect(pkg.scripts['verify:sign']).toContain('--verify-only')
  })

  it('betik dosyasi gercekten var', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'build-win.mjs'))).toBe(true)
  })

  it('sertifika alimi icin rehber dokumani var', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', 'IMZA.md'))).toBe(true)
  })
})