/**
 * build-win.mjs
 * ---------------------------------------------------------------------------
 * Windows paketini uretir ve KOD IMLZASINI DOGRULAR.
 *
 * NEDEN AYRI BIR BETIK
 * --------------------
 * `electron-builder` imzali/imzasiz ayrimini SESSIZCE yapar:
 *
 *     signing with signtool.exe ...
 *     no signing info identified, signing is skipped
 *
 * Bu bir hata degil, bir BILDIRIMDIR. Yani gelistirici "paket imzali"
 * sanirken paket IMZASIZ olabilir ve tek fark: kullanici SmartScreen
 * uyarisi gorur. Bu betik o sessizligi kaldirir:
 *
 *   1. Sertifika materyali var mi diye bakar (CSC_LINK / WIN_CSC_LINK).
 *   2. Varsa derler VE imzayi dogrular.
 *   3. YOKSA derler, imzasiz oldugunu acikca yazar, ve kullaniciya
 *      SmartScreen'in neden gorunecegini ve ne yapilmasi gerektigini
 *      soyler.
 *   4. "Imzala" denip de imzasiz cikan paket varsa CIKIS KODU 1'dir.
 *      Yani bu hatayi bir suret aramakla degil, hemen gorerek duzeltilir.
 *
 * IMZASIZ PAKET ILE IMZALI PAKET ARASINDAKI TUM FARK
 * --------------------------------------------------
 *   • SmartScreen "Windows korumanizi sagliyor" uyarisi
 *   • Dosya Ozellikleri > Sayisal Imzalar'da yayinci adi
 *   • Kurulum sihirbazinda "Yayinci: bilinmiyor" yerine gercek sirket adi
 *   • Kurum MDM / AppLocker politikalarinin uygulama kurallarina uyum
 *
 * KULLANIM
 * --------
 *   npm run build:win                    # imza varsa onu kullanir
 *   npm run build:win -- --force-unsigned # imzayi bilerek atlar
 *   npm run build:win -- --verify-only   # sadece mevcut paketleri dogrular
 *
 * SERTIFIKA NEREDEN GELIR
 * -----------------------
 *   $env:CSC_LINK          = "C:\...\sertifika.pfx"   (veya base64/URL)
 *   $env:CSC_KEY_PASSWORD  = "..."
 *   (veya WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD)
 *
 * Bu degerler BULUT GIZLI ANAHTARLARI olarak GitHub -> Settings ->
 * Secrets and variables -> Actions altinda tanimlanirsa, imzali
 * derleme GitHub Actions'ta otomatik olur (bkz. docs/IMZA.md).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}
const say = (...a) => console.log(...a)
const head = s => say(`\n${C.bold}${s}${C.reset}`)
const ok = s => say(`  ${C.green}OK${C.reset}   ${s}`)
const bad = s => say(`  ${C.red}HATA${C.reset} ${s}`)
const warn = s => say(`  ${C.yellow}UYARI${C.reset} ${s}`)
const info = s => say(`  ${C.dim}-${C.reset}   ${s}`)

const argv = process.argv.slice(2)
const FORCE_UNSIGNED = argv.includes('--force-unsigned')
const VERIFY_ONLY = argv.includes('--verify-only')

/* ------------------------------------------------------------------ */
/* Sertifika materyalini tespit et                                     */
/* ------------------------------------------------------------------ */

/** electron-builder'in sundugu tum kanalara bakan tek nokta. */
function findSigningMaterial() {
  const link =
    process.env.CSC_LINK ||
    process.env.WIN_CSC_LINK ||
    process.env.ELECTRON_BUILDER_CSC_LINK ||
    null
  const password =
    process.env.CSC_KEY_PASSWORD ||
    process.env.WIN_CSC_KEY_PASSWORD ||
    process.env.ELECTRON_BUILDER_CSC_KEY_PASSWORD ||
    null

  if (!link) return { link: null, password, reason: 'CSC_LINK tanimli degil' }

  // CSC_LINK bir dosya yolu, bir URL veya base64 olabilir.
  if (!/^https?:/i.test(link) && !/^[A-Za-z0-9+/=]{200,}$/.test(link)) {
    if (!fs.existsSync(link)) {
      return { link: null, password, reason: `CSC_LINK bir dosyayi gosteriyor ama dosya yok: ${link}` }
    }
  }
  if (password === null) {
    return {
      link: null,
      password: null,
      reason: 'CSC_LINK var ama CSC_KEY_PASSWORD tanimli degil',
    }
  }
  return { link, password, reason: null }
}

/* ------------------------------------------------------------------ */
/* Imza dogrulama (yalnizca Windows'ta)                                 */
/* ------------------------------------------------------------------ */

/**
 * Bir .exe uzerindeki Authenticode imzasini okur.
 * Windows disinda imza dogrulanamaz; bu durumda `null` doner ve cagiran
 * taraf bunu "dogrulanamadi" olarak raporlar (sahte "imzalı" demeyerek).
 */
function readSignature(exePath) {
  if (process.platform !== 'win32') return null
  const ps =
    `$s = Get-AuthenticodeSignature -LiteralPath '${exePath.replace(/'/g, "''")}'; ` +
    `[PSCustomObject]@{ Status = "$($s.Status)"; Signer = "$(if($s.SignerCertificate){$s.SignerCertificate.Subject}else{''})" } | ConvertTo-Json -Compress`
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
  })
  if (r.status !== 0 || !r.stdout) return null
  try {
    const j = JSON.parse(r.stdout.trim())
    return { status: j.Status, signer: j.Signer || '' }
  } catch {
    return null
  }
}

/** release/ altindaki uretilmis tum .exe dosyalarini toplar. */
function collectArtifacts() {
  const out = []
  const walk = dir => {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && /\.exe$/i.test(e.name)) {
        // Kaldirma sihirbazinin GECICI dosyasi; sadece derleme araci.
        // Kullaniciya ulasmaz, dolayisiyla imza kontrolune girmez.
        if (e.name === '__uninstaller-nsis-justmyclass.exe') continue
        out.push(full)
      }
    }
  }
  walk(path.join(ROOT, 'release'))
  return out.sort()
}

/* ------------------------------------------------------------------ */
/* Dogrulama                                                            */
/* ------------------------------------------------------------------ */

function verifyArtifacts(expectedSigned) {
  head('Imza dogrulamasi')
  const artifacts = collectArtifacts()
  if (artifacts.length === 0) {
    bad('release/ altinda imzalanacak .exe bulunamadi. Derleme basarisiz mi?')
    return { ok: false, signed: 0, total: 0, unverifiable: false }
  }

  let signed = 0
  let unverifiable = false
  const unsigned = []
  const rel = p => path.relative(ROOT, p)

  for (const exe of artifacts) {
    const sig = readSignature(exe)
    if (sig === null) {
      unverifiable = true
      warn(`${rel(exe)}  ${C.dim}(dogrulanamadi - Windows disinda)`)
      continue
    }
    if (sig.status === 'Valid') {
      signed++
      ok(`${rel(exe)}  ${C.dim}${sig.signer}${C.reset}`)
    } else {
      unsigned.push(rel(exe))
      bad(`${rel(exe)}  ${C.dim}${sig.status}${C.reset}`)
    }
  }

  const total = artifacts.length
  say('')
  if (signed === total && total > 0) {
    ok(`Tum paketler gecerli imzali: ${signed}/${total}`)
    return { ok: true, signed, total, unverifiable }
  }
  if (signed === 0) {
    bad(`Hicbir paket imzali degil: 0/${total}`)
  } else {
    bad(`Kismi imza: ${signed}/${total} gecerli, ${unsigned.length} imzasiz`)
  }
  for (const u of unsigned) info(`imzasiz: ${u}`)

  // "Imzala" denmisse bu KESIN hatadir.
  if (expectedSigned) {
    bad(
      'İmzalama istendi ama paketler imzasiz cikti. ' +
        'Bu bir hata; yayinlamadan once duzeltilmelidir.',
    )
  }
  return { ok: false, signed, total, unverifiable }
}

/* ------------------------------------------------------------------ */
/* Imzasiz durumda kullaniciyi bilgilendir                              */
/* ------------------------------------------------------------------ */

function explainUnsigned(reason) {
  head('Neden imzali degil?')
  info(reason)
  say('')
  say(`  ${C.bold}SmartScreen uyarisi${C.reset}`)
  say('    Windows, "bilinmeyen yayinci" tarafindan imzalanmamis bir exe')
  say('    indirildiginde "Windows korumanizi sagliyor" diye uyari gosterir.')
  say('    Bu, Microsoft tarafindan zorunlu tutulan bir kontroldur ve')
  say('    UYGULAMA TARAFINDAN KAPATILAMAZ. Tek cozum kod imzalama')
  say('    sertifikasidir.')
  say('')
  say(`  ${C.bold}Cozum${C.reset}`)
  say('    1. Kod imzalama sertifikasi satin alin:')
  say('       - DigiCert / Sectigo / Comodo (Code Signing)')
  say('       - EV sertifikasi: SmartScreen guveni EN HIZLI kurulur')
  say('       - OV sertifikasi: daha ucuz, guven birkac hafta olusur')
  say('    2. Sertifikayi .pfx olarak alin.')
  say('    3. Derleme ortaminda su iki degiskeni ayarlayin:')
  say(`         ${C.cyan}CSC_LINK${C.reset}=C:\\...\\sertifika.pfx`)
  say(`         ${C.cyan}CSC_KEY_PASSWORD${C.reset}=...`)
  say('    4. `npm run build:win` calistirin. Imza otomatik uygulanir ve')
  say('       bu betik her paketin IGERCEKTEN imzali oldugunu dogrular.')
  say('')
  say(`  ${C.dim}Ayrinti: docs/IMZA.md${C.reset}`)
  say('')
  say(`  ${C.yellow}Simdilik kullanicilar icin${C.reset}`)
  say('    Uyariyi "Daha fazla bilgi" > "Yine de calistir" ile gecebilirler.')
  say('    Bu resmi bir dagitim degildir; sertifika alinca uyari kaybolur.')
  say('')
}

/* ------------------------------------------------------------------ */
/* Ana akis                                                             */
/* ------------------------------------------------------------------ */

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  return r.status === 0
}

function main() {
  const material = findSigningMaterial()
  const willSign = !FORCE_UNSIGNED && !!material.link

  head('JustMyClass - Windows paketleme')
  info(`surum      : ${pkg.version}`)
  info(`platform   : ${process.platform} ${process.arch}`)

  if (FORCE_UNSIGNED) warn('--force-unsigned verildi, imzalama bilerek atlandi')
  else if (willSign) ok('sertifika bulundu, paketler IMZALI uretilecek')
  else info(`sertifika yok (${material.reason})`)

  if (!VERIFY_ONLY) {
    head('Derleme')
    if (!run('npx', ['tsc'])) { bad('tsc basarisiz'); process.exit(1) }
    if (!run('npx', ['vite', 'build'])) { bad('vite build basarisiz'); process.exit(1) }

    // electron-builder'a publisherName'i YALNIZCA imzalama varken gecir.
    //
    // NEDEN BU KADAR KRITIK:
    // `signtoolOptions.publisherName` `electron-builder.yml`e yazilsaydi,
    // electron-builder bunu `latest.yml` icine de yazardi - HICBIR SERTIFIKA
    // OLSA BILE. electron-updater `latest.yml`de publisherName gordugu icin
    // imzasiz guncellemeleri REDDEDERDI ve otomatik guncelleme sessizce
    // calisamazdi. Bu deger ancak gercekten imzaladigimizda gecirilmeli.
    const ebArgs = ['electron-builder', '--win']
    if (willSign) {
      const subject =
        process.env.CSC_PUBLISHER_NAME ||
        process.env.WIN_CSC_PUBLISHER_NAME ||
        null
      if (subject) {
        ebArgs.push(`-c.win.signtoolOptions.publisherName=${subject}`)
        ok(`publisherName gecirildi: ${subject}`)
      } else {
        info(
          'publisherName otomatik belirlenecek (sertifika konu adindan). ' +
            'CSC_PUBLISHER_NAME ile elle de verilebilir.',
        )
      }
    }
    if (!run('npx', ebArgs)) { bad('electron-builder basarisiz'); process.exit(1) }
  }

  const result = verifyArtifacts(willSign)

  if (!result.ok && willSign) {
    head('SONUC')
    bad('Imzalama istendi dogrulanamadi. Yayinlama YAPILMAMALI.')
    process.exit(1)
  }

  if (!result.ok) explainUnsigned(material.reason ?? 'sertifika tanimli degil')

  head('Sonuc')
  if (result.ok) {
    ok('Paketler hazir ve gecerli imzali.')
  } else {
    warn('Paketler hazir ama IMZASIZ.')
  }
  info(`cikti: ${path.join(ROOT, 'release')}`)
  say('')
  process.exit(result.ok || !willSign ? 0 : 1)
}

main()