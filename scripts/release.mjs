/**
 * release.mjs
 * ---------------------------------------------------------------------------
 * Dagitim paketi uretir ve (besleme adresi verilmisse) otomatik
 * guncelleme dosyalarini yaninda birakir.
 *
 * NEDEN AYRI BIR BETIK
 * --------------------
 * Otomatik guncelleme, uygulamanin bilesinden guncellenebilmesi icin
 * BIR YERDE YAYINLANMIS surum dosyalari gerektirir. Bu yeri
 * `electron-builder.yml` icine yazmak yanlis olurdu:
 *
 *   • Adres her dagitimda degisir (siz kendi sunucunuzu seceksiniz).
 *   • Ortam degiskeni tanimli degilse bos adres uretilir ve
 *     guncelleme sessizce calismaz — kullanici "guncelleme yok" sanir.
 *
 * Bu yuzden adres BURADA, acik bir hata mesajiyla zorunlu kiliinir.
 * Sabit deger, sahte adres veya varsayilan URL YOKTUR.
 *
 * KULLANIM (PowerShell)
 * ---------------------
 *   $env:UPDATE_FEED_URL = "https://sunucun/adresin/surumler"
 *   npm run build:release
 *
 * YAYINLAMA
 * ---------
 *   1. Bu betik release/ altina kurulum dosyalarini ve
 *      latest*.yml gunceleme manifestini uretir.
 *   2. `latest.yml` ve `.exe` dosyalarini AYNI klasore yuklersiniz.
 *      GitHub Releases, Netlify, bir S3 kovasi veya basit bir HTTP
 *      sunucusu olabilir. Tek kosul: dizin listesi + dosya indirilebilir
 *      olmali ve HTTPS kullanilmali.
 *   3. `UPDATE_FEED_URL` tam olarak bu klasorun adresidir.
 *
 * HTTPS SARTI
 * -----------
 * Electron, `file://` ve `http://` adreslerinden guncelleme ISTEMEZ.
 * Bu bir kisit degil, guvenlik onlemidir: guncelleme dosyasi
 * degistirilebilse birisi kullaniciya sahte surum sunabilir.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const FEED_ENV = 'UPDATE_FEED_URL'
const feed = (process.env[FEED_ENV] ?? '').trim()

function fail(lines) {
  console.error('')
  console.error('  DERLEME DURDURULDU')
  console.error('')
  for (const l of lines) console.error('  ' + l)
  console.error('')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1) Surum denetimi
// ---------------------------------------------------------------------------
const VERSION_RE = /^\d+\.\d+\.\d+$/
if (!VERSION_RE.test(pkg.version)) {
  fail([
    `package.json surumu gecersiz: "${pkg.version}"`,
    'Beklenen bicim: MAJOR.MINOR.PATCH  (ornek: 1.4.0)',
    'Otomatik guncelleme surumleri karsilastirabilmek icin bu bicime ihtiyac duyar.',
  ])
}

// ---------------------------------------------------------------------------
// 2) Ikon denetimi
// ---------------------------------------------------------------------------
const ICONS = ['icon.ico', 'icon.png']
for (const f of ICONS) {
  const p = path.join(ROOT, 'build', f)
  if (!fs.existsSync(p) || fs.statSync(p).size < 1024) {
    fail([
      `build/${f} eksik veya bos.`,
      'Ikon olmadan kurulum sihirbazi Electron\'un varsayilan logolarini gosterir.',
      'Uretmek icin:  npm run icons',
    ])
  }
}

// ---------------------------------------------------------------------------
// 3) Besleme adresi
// ---------------------------------------------------------------------------
if (!feed) {
  fail([
    'Otomatik guncelleme icin yayin adresi gerekli, ancak tanimli degil.',
    '',
    `Ayarla (PowerShell):  $env:${FEED_ENV} = "https://ornek.com/justmyclass/surumler"`,
    `Ayarla (bash)    :  export ${FEED_ENV}="https://ornek.com/justmyclass/surumler"`,
    '',
    'Bu adres, surum dosyalarinin (latest.yml + .exe) yuklendigi klasordur.',
    'Gizli bir anahtar DEGILDIR; ozel bir depo kullanabilirsiniz.',
    '',
    'Yalnizca kurulum dosyasini uretmek istiyorsaniz (guncelleme istemiyorsaniz):',
    '  npm run build:win',
  ])
}

let feedUrl
try {
  feedUrl = new URL(feed)
} catch {
  fail([`${FEED_ENV} gecerli bir adres degil: "${feed}"`, 'Beklenen: https://... veya http://...'])
}
if (feedUrl.protocol !== 'https:') {
  fail([
    `Yayin adresi HTTPS olmak ZORUNDA: "${feed}"`,
    '',
    'Electron, guvenli olmayan adreslerden guncelleme yapmayi reddeder.',
    'Bu bir engel degil, koruma: guncellenen surum dosyasi degistirilebilirse',
    'biri kullaniciya sahte bir surum sunabilir.',
    '',
    'Yerel deneme yapacaksaniz HTTPS kullanin (orn. Cloudflare Tunnel,',
    'ngrok, ya da kendi sunucunuz).',
  ])
}
if (feedUrl.pathname === '/' || feedUrl.pathname === '') {
  fail([
    'Yayin adresi bir KLASOR isaret etmeli, site kokunden degil.',
    `Su an: "${feed}"`,
    'Beklenen ornek: https://ornek.com/justmyclass/surumler',
  ])
}

// ---------------------------------------------------------------------------
// 4) Ikonlari yeniden uret (her zaman guncel)
// ---------------------------------------------------------------------------
console.log('> Ikonlar uretiliyor...')
const icons = spawnSync(process.execPath, [path.join(HERE, 'generate-icons.mjs')], {
  stdio: 'inherit',
  cwd: ROOT,
})
if (icons.status !== 0) fail(['Ikon uretimi basarisiz.'])

fs.rmSync(path.join(ROOT, 'release'), { recursive: true, force: true })

// ---------------------------------------------------------------------------
// 5) Derle
// ---------------------------------------------------------------------------
console.log(`\n> Surum ${pkg.version} derleniyor...`)
console.log(`> Yayin adresi: ${feedUrl.toString()}\n`)

const args = [
  'electron-builder',
  '--win',
  'nsis',
  'portable',
  '--publish',
  'always',
  '--config',
  `publish.provider=generic`,
  '--config',
  `publish.url=${feedUrl.toString()}`,
  '--config',
  `generateUpdatesFilesForAllChannels=true`,
  '--config',
  `publish.artifactName=JustMyClass-Setup-\${version}-\${arch}.exe`,
]

const run = spawnSync('npx', args, { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' })
if (run.status !== 0) {
  fail([
    'electron-builder basarisiz oldu.',
    '',
    'Yaygin nedenler:',
    '  • Imza yok: SmartScreen uyarisi NORMALDIR, derlemeyi engellemez.',
    '  • Ayni anda iki derleme: once "npm run clean" calistirin.',
    '  • Disk/izin: cikti klasoru yazilabilir olmali.',
  ])
}

// ---------------------------------------------------------------------------
// 6) Cikti raporu
// ---------------------------------------------------------------------------
const outDir = path.join(ROOT, 'release')
if (!fs.existsSync(outDir)) fail(['Cikti klasoru olusmadi.'])

const files = fs.readdirSync(outDir).filter(f => !fs.statSync(path.join(outDir, f)).isDirectory())
const pick = re => files.filter(f => re.test(f))

const setup = pick(/^JustMyClass-Setup-.*\.exe$/i)
const portable = pick(/^JustMyClass-Portable-.*\.exe$/i)
const manifests = pick(/^latest.*\.yml$/i)

const mb = f => (fs.statSync(path.join(outDir, f)).size / 1024 / 1024).toFixed(1)

console.log('')
console.log('  DERLEME TAMAMLANDI')
  console.log('  ' + '-'.repeat(58))
for (const f of setup) console.log(`  Kurulum sihirbazi : ${f}  (${mb(f)} MB)`)
for (const f of portable) console.log(`  TasINabilir       : ${f}  (${mb(f)} MB)`)
for (const f of manifests) console.log(`  Guncelleme manifest: ${f}`)
console.log('  ' + '-'.repeat(58))
console.log('')
console.log(`  SU DOSYALARI BIRLIKTE YAYINLANMALI:`)
console.log(`    ${feedUrl.toString()}`)
console.log('')
console.log('  Icerik:')
console.log('    - Kullanicinin indirip calistiracagi kurulum sihirbazi')
console.log('    - Uygulamanin "guncelleme var mi?" diye sordugu latest.yml')
console.log('')
console.log('  KURULUM SIRHIRBAZI NE YAPAR:')
console.log('    • Kurulum yeri secimi (Varsayilan Program Files degil, secilebilir)')
console.log('    • "Yalnizca bu kullanici" / "Tum kullanicilar" secimi')
console.log('    • Masaustu ve Baslat Menusu kisayollari (ayri secilebilir)')
console.log('    • Turkce / Ingilizce arayuz (sistem diline gore)')
console.log('    • Bitince uygulamayi calistir secenegi')
console.log('    • Denetim Panelinde "Programlar ve Ozellikler"den kaldirma')
console.log('    • Kaldirma KULLANICI VERISINI SILMEZ (anahtarlar, indirmeler)')
console.log('      Verileri silmek icin: Ayarlar > Guvenlik > Tum verileri temizle')
console.log('')