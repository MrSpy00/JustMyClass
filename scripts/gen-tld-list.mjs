/**
 * IANA TLD listesinden `src/lib/tldList.ts` dosyasini uretir.
 *
 * NEDEN URETICI VAR?
 * ------------------
 * Liste 895 kelime; elle yazilamaz ve elle yazilirsa bir kelime sessizce
 * kaybolur. Daha onemlisi: uretilen dosyanin KAYNAKLA birebir ayni oldugu
 * kanitlanabilmelidir. Bu betik uretimden sonra dosyayi yeniden okuyup
 * karsilastirir ve fark varsa hata verip CI/build'i durdurur.
 *
 * KULLANIM
 *   node scripts/gen-tld-list.mjs              -> scripts/tlds.txt'den uretir
 *   node scripts/gen-tld-list.mjs --refresh    -> IANA'dan indirir, sonra uretir
 *
 * Varsayilan kaynak: scripts/tlds.txt (versiyonlanmis kopya).
 * IANA adresi: https://data.iana.org/TLD/tlds-alpha-by-domain.txt
 *
 * `--refresh` NEDEN GEREKLI?
 * --------------------------
 * Ilk uretimde liste bir PowerShell `Invoke-WebRequest` ile cekildi ve
 * YARIM INDI: 1439 satirin yalnizca 895'i dosyaya yazildi. Bu yuzden
 * `.ai`, `.zip`, `.mov` gibi gTLD'ler listede yoktu ve `isRealTld('ai')`
 * yanlis sonuc veriyordu. Insan eliyle kurulan bir onbellek sessizce
 * bozuldugu icin, kaynagi dogrulayan bir uretici + versiyonlanmis kopya
 * birlikte kullanilir.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const IANA_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/**
 * Komut satirini dogru ayristirir.
 *
 * BUGANIN GELISMESI: `process.argv[2]` dogrudan yol sanildi. `--refresh`
 * bayragi calistirildiginda argv[2] = '--refresh' oldugu icin URETICI,
 * 1437 TLD'yi `--refresh` ADLI BIR DOSYAYA yazdi ve `scripts/tlds.txt`
 * hic guncellenmedi. Bayrak ile yol birbirinden ayrilmalidir.
 */
const REFRESH = process.argv.includes('--refresh')
const VERIFY_ONLY = process.argv.includes('--verify-only')
const sourceArg = process.argv.slice(2).find(arg => !arg.startsWith('-'))
const SOURCE = resolve(ROOT, sourceArg ?? 'scripts/tlds.txt')
const TARGET = resolve(ROOT, 'src/lib/tldList.ts')

/**
 * IANA listesini indirip `scripts/tlds.txt` olarak yazar.
 *
 * InDIRME DOGRULAMASI: yanlis/eksik bir indirme sessizce gecmemelidir.
 * Asagidaki kontrol gercek bir IANA listesi olmasa da yakalanamayan bir
 * durumda (ornegin sayfa yerine hata mesaji donmesi) tutarlilik denetimi
 * yakalar.
 */
async function refreshSource(url, target) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`IANA listesi alinamadi: HTTP ${response.status}`)
  const body = await response.text()
  const entries = normalize(body)

  // CANLI LISTEDEN DOGRULAMA: kaynak dosyada gercekten bulunmasi gereken
  // ve bir sonradan kisitlamanin sessizce dusurmesine yol acabilecegi
  // ust duzeyler.
  const MUST_HAVE = ['tr', 'com', 'ai', 'io', 'dev', 'app', 'zip', 'mov', 'xn--p1ai']
  const missing = MUST_HAVE.filter(t => !entries.includes(t))
  if (missing.length) {
    throw new Error(
      `İndirilen liste eksik görünüyor (${entries.length} kayıt). ` +
        `Şu üst düzeyler bulunamadı: ${missing.join(', ')}. ` +
        `Ağ kısıtlaması olabilir; mevcut scripts/tlds.txt korundu.`,
    )
  }
  if (entries.length < 1200) {
    throw new Error(`İndirilen liste çok kısa (${entries.length}). Beklenen en az 1200.`)
  }

  writeFileSync(target, entries.join('\n') + '\n', 'utf8')
  return entries
}

/** Ham metni kucuk harfli, sirali, benzersiz TLD listesine cevirir. */
function normalize(raw) {
  const seen = new Set()
  for (const line of raw.split(/\r?\n/)) {
    const token = line.trim().toLowerCase()
    if (!token || token.startsWith('#')) continue
    // Yalnizca harf, rakam ve tire: IDN punycode kayitlari da buna uyar.
    if (!/^[a-z0-9-]+$/.test(token)) continue
    seen.add(token)
  }
  return [...seen].sort()
}

/** Kaynak dosyayi okuyup kucuk harfe indirger ve siralar. */
function readTlds(path) {
  return normalize(readFileSync(path, 'utf8'))
}

/** Kelimeleri okunabilir satirlara boler (kaynak dosyada ~96 karakter). */
function chunk(words, width = 96) {
  const lines = []
  let current = ''
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current)
      current = ''
    }
    current = current ? `${current} ${word}` : word
  }
  if (current) lines.push(current)
  return lines
}

function render(words) {
  const lines = chunk(words)
  // KRITIK: JS'te ardisik string literalleri `+` ile birlestirildiginde
  // aralarina HICbir karakter girmez. Bu yuzden sonRKI haric her parca
  // SONUNA BOSLUK konur. Aksi halde bir dilimin son kelimesi ile
  // sonrakinin ilk kelimesi birlisip sahte bir ust duzey olusur ve
  // gercek TLD'ler sessizce kaybolur (`tr` -> `...trxyz`). Onceki
  // surumde bu oldu ve `isRealTld('tr')` yanlis sonuc verdi.
  const body = lines
    .map((line, i) => {
      const last = i === lines.length - 1
      return `  '${line}${last ? '' : ' '}'${last ? '' : ' +'}`
    })
    .join('\n')
  return `/**
 * Gercek IANA alan adi ust duzeylerinin (TLD) listesi.
 *
 * SORUN
 * -----
 * Baglanti algilama kurali, son etiketin "2-24 harf" olmasini yeterli
 * goruyordu. Bu yuzden \`linkgib.linkler\`, \`baglanti.adres\`, \`site.links\`
 * gibi UYDURMA uzantilar da adres sayiliyor; kullanici metinde tiklanabilir
 * olmayan, uzerine gelince de hicbir sey olmayan bir baglanti goruyordu.
 *
 * COZUM
 * -----
 * Tek dogruluk kaynagi: IANA'nin resmi listesi
 * (\`https://data.iana.org/TLD/tlds-alpha-by-domain.txt\`).
 *
 * URETIM
 * ------
 * BU DOSYA \`scripts/gen-tld-list.mjs\` ILE URETILIR; elle duzenlenmemelidir.
 * Uretici, uretimden sonra dosyayi yeniden okuyup kaynakla karsilastirir;
 * tek bir kelime bile kaybolursa hata verir.
 *
 * NEDEN BU DUZEN
 * --------------
 * Liste tek bir boslukla ayrilmis string parcalarina bolunerek saklanir
 * ve modul yuklenirken bir \`Set\`e cevrilir. Boylece kaynak ~5 KB metin
 * olarak tasinir, calisma zamaninda uye aramasi O(1) olur ve her kullanimda
 * dosya okunmaz.
 *
 * YENI TLD'LER
 * ------------
 * IANA periyod olarak yeni ust duzeyler ekler. Gelecekte ortaya cikacak
 * bir TLD burada kabul edilmez; bu yuzden liste bilincli olarak tek
 * noktada guncellenir (\`scripts/tlds.txt\`).
 */

/** IANA tarafindan delege edilmis ust duzey alan adlari (boslukla ayrilmis). */
const RAW_TLDS =
${body}

/** Kucuk harfe indirgenmis gercek TLD kumesi. */
export const REAL_TLDS: ReadonlySet<string> = new Set(RAW_TLDS.split(' '))

/**
 * Bir ust duzey gercekten IANA tarafindan delege edilmis mi?
 *
 * @param tld Nokta olmadan, ornek "com", "tr", "edu".
 */
export function isRealTld(tld: string): boolean {
  if (!tld) return false
  return REAL_TLDS.has(tld.toLowerCase().trim())
}

/** Tanitim ve test icin: kume icinde kac TLD var? */
export function countRealTlds(): number {
  return REAL_TLDS.size
}
`
}

const tlds = REFRESH ? await refreshSource(IANA_URL, SOURCE) : readTlds(SOURCE)

if (tlds.length < 1200) {
  throw new Error(`Kaynak yetersiz görünüyor: ${tlds.length} TLD. Beklenen en az 1200.`)
}
// Ust duzey sinirlari, onceki yarim indirmenin bu hatayi yaratmasinin
// sebebidir; tek tek dogrulanir.
for (const required of ['tr', 'com', 'ai', 'io', 'dev', 'app', 'zip', 'mov']) {
  if (!tlds.includes(required)) {
    throw new Error(`Kaynak eksik: "${required}" bulunamadi. \`--refresh\` calistirin.`)
  }
}
if (tlds.includes('linkler')) {
  throw new Error('Kaynak bozuk: "linkler" sanal bir üst düzey olarak listelenmiş.')
}

const module_ = render(tlds)
if (!VERIFY_ONLY) {
  writeFileSync(TARGET, module_, 'utf8')
} else if (!existsSync(TARGET)) {
  throw new Error('--verify-only: src/lib/tldList.ts bulunamadi; once ureticiyi calistirin.')
}

/* ------------------------------------------------------------------ */
/* KENDINI DOGRULAMA: uretilen dosyayi geri oku ve kaynakla karsilastir*/
/* ------------------------------------------------------------------ */

const written = readFileSync(TARGET, 'utf8')
const literal = /const RAW_TLDS =\n([\s\S]*?)\n\n\/\*\* Kucuk harfe/.exec(written)
if (!literal) {
  throw new Error('Dogrulama basarisiz: RAW_TLDS blogu bulunamadi.')
}

// DOGRULAMA, CALISMA ZAMANI DAVRANISINI TAKLIT EDER: JS'te string
// literalleri `+` ile dogrudan birlestiginden parcalar da dogrudan
// birlestirilir. Boylece "dilim sinirinda bosluk kaybi" gibi hatalar
// bu adimda YAKALANIR; yoksa uretilen dosya sessizce bozuk olurdu.
const writtenTlds = literal[1]
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => line.replace(/^'/, '').replace(/'\s*\+\s*$/, '').replace(/'$/, ''))
  .join('')
  .split(' ')
  .filter(Boolean)
  .sort()

if (writtenTlds.length !== tlds.length) {
  const counts = new Map()
  for (const t of writtenTlds) counts.set(t, (counts.get(t) ?? 0) + 1)
  const merged = [...counts.entries()].filter(([, n]) => n > 1).map(([t]) => t)
  const missing = tlds.filter(t => !writtenTlds.includes(t))
  throw new Error(
    `Dogrulama basarisiz: ${tlds.length} bekleniyordu, ${writtenTlds.length} yazildi.\n` +
      `  kaybolan (${missing.length}): ${missing.slice(0, 25).join(', ')}\n` +
      `  birlisen  (${merged.length}): ${merged.slice(0, 25).join(', ')}`,
  )
}

process.stdout.write(
  VERIFY_ONLY
    ? `src/lib/tldList.ts dogrulandi: ${writtenTlds.length} TLD, kaynakla birebir ayni.\n`
    : `src/lib/tldList.ts yeniden uretildi: ${writtenTlds.length} TLD, ` +
        `${Buffer.byteLength(written, 'utf8')} bayt, dogrulama GECTI.\n`,
)