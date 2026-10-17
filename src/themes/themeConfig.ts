import { CustomTheme, CustomThemeDraft, ThemeColors, ThemeName } from '../../types/jmc'

/**
 * Tasarım ilkeleri
 * ----------------
 * 1. Ayırıcı çizgi (border) birincil aracımız DEĞİLDİR. Paneller arasındaki
 *    geçiş yüzey yüksekliği (bg → bgElevated → bgSurface) ve çok hafif bir
 *    gölge ile yapılır. Bu, "çizgi bombardımanası" ve göz yorgunluğunu
 *    ortadan kaldırır.
 * 2. borderSubtle, border'in yarısından koyu/açık olmalı; yüksek kontrastlı
 *    çizgiler yerine düşük kontrastlı ayrım kullanılır.
 * 3. textDim gerçekten okunabilir bir kontrast sağlar (WCAG AA ≥ 4.5:1).
 * 4. Tema ailesi saf siyah/saf beyaz kullanmaz; OLED için ayrı bir tema vardır.
 *    TEK İSTİSNA "High Contrast"tır: erişilebilirlik gereksinimi (düşük
 *    görme, parlak güneş) için bilinçli olarak saf siyah/beyaz seçer.
 * 5. Her temada `elevation` gölge rengi bulunur, böylece kartlar çizgisiz
 *    de yükselmiş görünür.
 * 6. Kod vurgu renkleri (`--jmc-code-*`) sabit değildir: `codeBg`'dan türetilir
 *    ve kontrastı garanti edilir (bkz. `deriveCodeTokens`). Bu sayede kullanıcı
 *    renkli bir kod zemini seçse bile kod okunabilir kalır.
 */

/* ------------------------------------------------------------------ */
/* Renk matematiği (saf fonksiyonlar; test edilebilir)                  */
/* ------------------------------------------------------------------ */

/** Bir rengi sRGB → lineer RGB'ye çevirir (WCAG 2.x formülü). */
function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** #rgb / #rrggbb biçimindeki rengi [r,g,b] olarak ayrıştırır. */
export function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string') return null
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
 * Bir arka plan rengi "açık" mı?
 *
 * `color-scheme`, tarayıcı-native kaydırma çubuğu, `<select>` açılır listesi ve
 * metin seçimi hep bu değere bakar. Sabit `dark` yazmak, açık temalarda
 * koyu zeminde beyaz native arayüz bırakıyordu.
 */
export function isLightBackground(bg: string): boolean {
  return relativeLuminance(bg) > 0.4
}

/** Tema "açık" mı? (bkz. `isLightBackground`) */
export function isLightTheme(colors: ThemeColors): boolean {
  return isLightBackground(colors.bg)
}

/**
 * Bir dolgunun ÜZERİNDE okunabilir metin rengi seçer.
 *
 * KULLANICI BILDIRIMI
 * -------------------
 * "Bazi temalarda yazilar okunmaz oluyor; asistan arkaplan metin
 * kutucuğundan."
 *
 * KOK NEDEN
 * ---------
 * Kullanici balonunda metin rengi `text-white` olarak SERT yaziliydi:
 * `bg-[var(--jmc-primary)] text-white`. Oysa `primary` bir dugme rengidir
 * ve 17 temanin 16'sinda acik bir tondadir. Beyaz metnin bu renkler
 * uzerindeki kontrasti:
 *
 *     High Contrast (#ffd400)  1.43   Graphite (#b8bcc6)   1.90
 *     Matrix (#35d07f)         2.00   Cyberpunk (#31c7e8)  2.01
 *     Amber CRT (#e0a341)      2.21   Hacker Green        2.65
 *     Abyss / Forest (#3aa87c) 2.97   Dark (#4c8dff)      3.20
 *
 * Yani kullanicinin kendi mesaji neredeyse HICbir temada okunmuyordu.
 *
 * COZUM
 * -----
 * Beyaz ve koyu siyah arasinda kontrasti DUSUK olan secilir. Ayni
 * orneklerde koyu metin 5.0-14.7 araligina cikiyor: `#4c8dff` uzerinde
 * beyaz 3.20 iken koyu 6.56'dir.
 *
 * Esik degerle degil KARSILASTIRMA karar verilir.
 *
 * NEDEN SAF SIYAH (`#000000`) VE SAF BEYAZ?
 * ------------------------------------------
 * "Koyu metin" icin `#0b0b0f` (yumuşak siyah) kullanilirsa ARА tonlarda
 * 4.5:1'in altinda kalir: `#a06680` uzerinde 4.46, Sunset Vibes'in hover
 * tonunda 4.48. Saf siyah ise bu ikisini de gecer.
 *
 * Matematiksel garanti: beyaz icin `(1.05)/(L+0.05) >= 4.5` -> `L <= 0.1833`;
 * siyah icin `(L+0.05)/0.05 >= 4.5` -> `L >= 0.175`. Bu iki aralik
 * ORTUSUR (0.175 - 0.1833). Yani HICBIR renkte secilen uclarin ikisinden
 * biri 4.5:1'i gecer. Yumuşak siyahda bu ortusma kayboluyordu.
 */
export function contrastTextOn(bg: string): string {
  return contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000'
}

/** Dolgunun uzerinde okunabilir metin + o metnin `hover` tonu icin taban. */
export interface OnColorText {
  onPrimary: string
  onPrimaryHover: string
  onAccent: string
  onAccentHover: string
  /** Durum renkleri (uyari / tehlike / basari) uzerindeki metin. */
  onWarning: string
  onDanger: string
  onSuccess: string
}

/**
 * Butun dolgu renkleri icin uzerlerine yazilacak metin renklerini uretir.
 *
 * Her alan bagimsiz hesaplanir; `primary` koyu iken `accent` acik olabilir,
 * bu yuzden tek bir karar ikisine birden uygulanamaz.
 */
export function deriveOnColorText(c: ThemeColors): OnColorText {
  return {
    onPrimary: contrastTextOn(c.primary),
    onPrimaryHover: contrastTextOn(c.primaryHover),
    onAccent: contrastTextOn(c.accent),
    onAccentHover: contrastTextOn(c.accentHover),
    onWarning: contrastTextOn(c.warning),
    onDanger: contrastTextOn(c.danger),
    onSuccess: contrastTextOn(c.success),
  }
}

/**
 * Dolgu renklerinin, AÇIK/yarı saydam yüzeylerde METİN olarak
 * kullanılabilir hallerini üretir.
 *
 * KULLANICI BILDIRIMI
 * -------------------
 * "Bazi temalarda yazilar okunmaz oluyo." Balonlar duzeltildikten
 * sonra kalan ikinci sebep BUDUR ve tamamen ayri bir nedendir.
 *
 * KULLANIM DESENI
 * ---------------
 * Uygulamada ~50 yerde rozetler su sekilde yaziliyor:
 *
 *   `bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)]`
 *   `bg-[var(--jmc-warning)]/10 text-[var(--jmc-warning)]`
 *
 * Zemin, rengin yalnizca %10-20'si yuzeyin uzerine bindirilmis oldugu
 * icin ETKIN zemin yuzeye yakindir. Okunurluk dolayisiyla rengin
 * yuzeye gore kontrastina baglidir — ve tema renkleri buna gore
 * secilmemis.
 *
 * OLCULEN HATALAR (yalnizca metin/3 yuzey, 4.5 esigi):
 *
 *   Pastel Soft  accent  #d96a9a / #efe9f7 = 2.73   <-- okunamaz
 *   Pastel Soft  accent  #d96a9a / #ffffff = 3.24
 *   Pastel Soft  warning #a9701a / #efe9f7 = 3.52
 *   Bordeaux     primary #c8405a / #28151b = 3.57
 *   Sand         accent  #8a6d2f / #eae5d9 = 3.88
 *   Pastel Soft  warning #a9701a / #f7f4fb = 3.84
 *   Light        warning #a86a08 / #f0f2f5 = 3.96
 *
 * 25 ihlal, 17 temanin 7'sinde.
 *
 * COZUM
 * -----
 * `onPrimary` KAVRAMI YETERLI DEGIL: o "primary dolgunun UZERINDE
 * yazilacak metin" demektir, yani dolgunun karsi ucunu secer. Burada
 * ise metin rengi, rengin KENDISI ve zemini neredeyse yuzeydir.
 *
 * Bu yuzden ayri bir turetilmis deger gerekir: rol rengi, butun
 * yuzeylerde 4.5:1'i gecmeye ZORLANIR. Zaten okunabilir olan temalarda
 * deger DEGISMEEZ (`ensureContrastOnAll` okunabilir bir rengi olduğu
 * gibi birakir), yani bu duzeltme yalnizca gercekten bozuk olan 7
 * temayi etkiler.
 *
 * `primaryText` ile `onPrimary` KARIŞTIRILMAMALI: biri bu renge
 * bakarken digeri bu rengin UZERINDE yazarken kullanilir.
 */
export interface RoleTextColors {
  primaryText: string
  accentText: string
  successText: string
  warningText: string
  dangerText: string
}

export function deriveRoleTextColors(c: ThemeColors): RoleTextColors {
  const bgs = linkBackgrounds(c)
  return {
    primaryText: ensureContrastOnAll(c.primary, bgs, MIN_TEXT_CONTRAST),
    accentText: ensureContrastOnAll(c.accent, bgs, MIN_TEXT_CONTRAST),
    successText: ensureContrastOnAll(c.success, bgs, MIN_TEXT_CONTRAST),
    warningText: ensureContrastOnAll(c.warning, bgs, MIN_TEXT_CONTRAST),
    dangerText: ensureContrastOnAll(c.danger, bgs, MIN_TEXT_CONTRAST),
  }
}

/**
 * Normal boy metin icin WCAG 2.2 AA esigi.
 *
 * Baglanti hedefi (5.5) bundan YUKSEK tutulur; baglanti govde metniyle
 * ayni boydadir ve fark edilebilir olmasi gerekir. Roster/durum
 * metni icin AA esigi yeterlidir, cunku zaten dolgunun kontrastina
 * gore zorlandi.
 */
const MIN_TEXT_CONTRAST = 4.5

/** Iki rengi karıştırır; `amount` = ikinci rengin ağırlığı (0–1). */
export function mixHex(a: string, b: string, amount: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca) return b
  if (!cb) return a
  const t = Math.min(1, Math.max(0, amount))
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t)
  return (
    '#' +
    [ch(ca[0], cb[0]), ch(ca[1], cb[1]), ch(ca[2], cb[2])]
      .map(n => n.toString(16).padStart(2, '0'))
      .join('')
  )
}

/** Hex rengi `rgba(...)` biçimine çevirir (rozet zemini, gölge vb. için). */
export function hexToRgba(hex: string, alpha: number): string {
  const c = parseHex(hex)
  if (!c) return `rgba(0, 0, 0, ${alpha})`
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`
}

/**
 * `color`/`bg` kontrastı `target`'ın altındaysa rengi zeminin KARŞI ucuna doğru
 * iterek hedefi garanti eder. Kullanıcının seçmediği türetilmiş alanlar
 * (textMuted, textDim, kod vurguları, durum renkleri) için kullanılır.
 */
/**
 * `color`/`bg` kontrastı `target`'ın altındaysa rengi zeminin KARŞI ucuna doğru
 * iterek hedefi garanti eder. Kullanıcının seçmediği türetilmiş alanlar
 * (textMuted, textDim, kod vurguları, durum renkleri) için kullanılır.
 *
 * YÖN SEÇİMİ ÖNEMLİ: "daha açık zemin → daha koyu renk" sezgisi tek başına
 * yetmez. Ornegin #ff00ff zeminde saf beyaz bile yalnizca 3.14:1 verir; bu
 * yuzden dogal yon yetmezse karsi yon denenir.
 */
export function ensureContrast(color: string, bg: string, target: number): string {
  if (contrastRatio(color, bg) >= target) return color
  // Karisim yonu ZEMINE gore secilir: zeminin karsi ucu.
  //
  // HATANIN GELISMESI: onceki surum yonu `relativeLuminance(color) >=
  // relativeLuminance(bg)` ile secmisti. Renk zeminden yalnizca biraz
  // daha koyu/aydinlik oldugunda ayni tarafa denk geliyor ve karisim
  // KENDI KENDINE yapiliyordu; renk hic kipirdamiyor, 64 adim sonra
  // hedefi hic kacaramadan dongu tukeniyordu. Ornegin siyah bir token,
  // `#0b0f16` gibi koyu bir zemine konuldugunda okunmaz kaliyor ve
  // guvenlik agina duserken bile siyaha yakin bir renk donuyordu.
  const primary =
    contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000'
  const other = primary === '#ffffff' ? '#000000' : '#ffffff'

  for (const towards of [primary, other]) {
    // 64 x %5 adim, zeminin karsi ucuna neredeyse tamamen yaklasir.
    let out = color
    for (let i = 0; i < 64; i++) {
      if (contrastRatio(out, bg) >= target) return out
      out = mixHex(out, towards, 0.05)
    }
    // Bu yon uca kadar gittiginde bile yetmiyorsa digerini dene.
    if (contrastRatio(towards, bg) >= target) return towards
  }
  // Guvenlik agi: en yuksek kontrasti veren uc rengi dondur.
  return contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000'
}

/* ------------------------------------------------------------------ */
/* Baglanti renkleri                                                   */
/* ------------------------------------------------------------------ */

/**
 * Baglanti rengi icin gereken minimum kontrast orani.
 *
 * WCAG 2.2 AA, normal boy metin icin 4.5:1 ister. Baglantilar govde
 * metniyle ayni boydadir; bu yuzden "buyuk metin" istisnasi (3:1)
 * kullanilmaz.
 *
 * KULLANICI "BIRAZ DAHA BELIRGIN" ISTEDI
 * -------------------------------------
 * Hedef 4.5 -> 5.5'e cikarildi. Govde metni temada 13-16 kontrast
 * verirken linkin 5.5'te kalmasi, arada yeterli bir fark birakiyor:
 * link "bir baska sey" gibi duruyor. 5.5 zorlandigi icin yine de her
 * temada basarilir bir renk uretilir.
 */
const LINK_MIN_CONTRAST = 5.5

/** Uzerine gelindiginde hedeflenen kontrast: govde metnini asar. */
const LINK_HOVER_CONTRAST = 7.5

/** Baglanti renginin okunmasi gereken tum yuzeyler. */
function linkBackgrounds(c: ThemeColors): string[] {
  const bgs = [c.bg, c.bgElevated, c.bgSurface].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  )
  return bgs.length ? bgs : ['#ffffff']
}

/**
 * Bir rengi butun arka planlara gore degerlendirir ve en KOTU orani
 * dondurur.
 *
 * NEDEN EN KOTU?
 * --------------
 * Sohbet balonlari `bgSurface`, kenar panelleri `bgElevated`, ana
 * yuzey `bg` uzerinde durur. Yalnizca `bg`ye bakan bir denetim, linkin
 * balon icinde okunmaz oldugu durumlari kaçirir. Kullanicinin gördugu
 * sey cogu zaman balon icidir.
 */
function worstContrast(color: string, bgs: string[]): number {
  return bgs.reduce((min, bg) => Math.min(min, contrastRatio(color, bg)), Infinity)
}

/** En kotu kontrasti hedefin uzerine cikaran renk. */
function ensureContrastOnAll(color: string, bgs: string[], target: number): string {
  let out = color
  for (let i = 0; i < 64; i += 1) {
    if (worstContrast(out, bgs) >= target) return out
    // En kotu kontrasti veren arka plani referans al.
    const ref = bgs.reduce((worst, bg) =>
      contrastRatio(out, bg) < contrastRatio(out, worst) ? bg : worst,
    )
    // YON, ZEMINE GORE secilir: zeminin karsi ucu (beyaz ya da siyah).
    //
    // HATANIN GELISMESI: yon once `relativeLuminance(out) >=
    // relativeLuminance(ref)` karsilastirmasiyla seciliyordu. Siyah gibi
    // koyu bir renk, yalnizca biraz daha aydinlik bir koyu zemine
    // konuldugunda (link: #000000, bg: #0b0f16) "koyu tarafta" sayiliyor
    // ve karisim YINE SIYAHA yapiliyordu; renk hic kipirdamiyor, dongu
    // 64 adim sonra hedefi hic kacaramadan tukeniyordu. Ayni hata projedeki
    // `ensureContrast` icinde de vardi (kod vurgu renkleri ve ozel tema
    // turetilmis alanlar ayni yon hatasiyla karsi karsiydi).
    const towards =
      contrastRatio('#ffffff', ref) >= contrastRatio('#000000', ref) ? '#ffffff' : '#000000'
    out = mixHex(out, towards, 0.05)
  }
  return out
}

export interface LinkColors {
  link: string
  linkHover: string
}

/**
 * Bir tema icin baglanti renklerini hesaplar.
 *
 * KULLANICI BILDIRIMI
 * -------------------
 * "Sohbette asistan falan linkler arka planla ayni renkte gozukuyor,
 * zit belirgin olucak renkte gozukmuyor temalarda bu yuzden linkler
 * okunmuyor."
 *
 * COZUM
 * -----
 * Once `accent` denenir, sonra `primary`. Daha oncede baglantilar
 * dogrudan `--jmc-primary` kullaniyordu; `primary` cogu temada dugme
 * ve kenar rengidir ve koyu bir zeminde soluk kalabiliyor.
 *
 * - Bir aday zaten butun yuzeylerde okunabiliyorsa OLDUGU GIBI
 *   kullanilir; temanin rengi korunur.
 * - hicbiri okunabilir degilse kontrast zorlanir. `ensureContrast`
 *   benzeri bir guvenlik agi sayesinde bu DAIMA basarili bir renk
 *   dondurur; yani hicbir temada okunmaz bir link uretilemez.
 */
export function deriveLinkColors(c: ThemeColors): LinkColors {
  const bgs = linkBackgrounds(c)
  const explicit = (c as { link?: string }).link

  const fallbackBase = c.accent || c.primary || c.text || '#ffffff'
  const raw = explicit ?? (firstReadableCandidate(c, bgs) ?? fallbackBase)

  let link = ensureContrastOnAll(raw, bgs, LINK_MIN_CONTRAST)

  /*
    GOVDE METNINDEN FARKLILIK
    --------------------------
    Aday listesi `text`i de iceriyor ve bazi temalarda `accent`/`primary`
    okunabilir olmadigi halde `text` secilir. O zaman link tam olarak govde
    metniyle ayni renge gelir ve alt cizgi disinda link olmaktan cikar.
    (Bordeaux'ta olculdu: link `#f6ebee`, metin `#f6ebee`.)

    Cozum: renk metinle ayni kalirsa kontrast hedefi BOYULMADAN rengi
    kademeli olarak zeminin karsi ucuna kaydirilir. Boylece hem okunabilir
    kalir hem de govde metninden gorunur sekilde ayrilir.
  */
  if (link.toLowerCase() === c.text.toLowerCase()) {
    link = shiftAwayFrom(link, c.text, bgs, LINK_MIN_CONTRAST)
  }

  return {
    link,
    linkHover: ensureContrastOnAll(link, bgs, LINK_HOVER_CONTRAST),
  }
}

/** Adaylar arasindan zaten butun yuzeylerde okunabilir ilki secer. */
function firstReadableCandidate(c: ThemeColors, bgs: string[]): string | undefined {
  for (const candidate of [c.accent, c.primary, c.accentHover, c.primaryHover, c.text]) {
    if (!candidate) continue
    if (worstContrast(candidate, bgs) >= LINK_MIN_CONTRAST) return candidate
  }
  return undefined
}

/**
 * Rengi, kontrast hedefini bozmadan `avoid` renginden uzaklastirir.
 *
 * Kontrastin EN IYI iki ucu arasinda kademeli gider; boylece renk ne
 * yeterli okunurlugu kaybeder ne de hedeflenen koyu/acik tona savurulur.
 */
function shiftAwayFrom(color: string, avoid: string, bgs: string[], target: number): string {
  const worst = bgs.reduce(
    (w, bg) => (contrastRatio(color, bg) < contrastRatio(color, w) ? bg : w),
    bgs[0],
  )
  const towards =
    contrastRatio('#ffffff', worst) >= contrastRatio('#000000', worst) ? '#ffffff' : '#000000'

  let out = color
  for (let i = 0; i < 40; i += 1) {
    out = mixHex(out, towards, 0.03)
    if (out.toLowerCase() === avoid.toLowerCase()) continue
    if (worstContrast(out, bgs) >= target) return out
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Kod vurgu renkleri                                                  */
/* ------------------------------------------------------------------ */

export const CODE_TOKEN_NAMES = [
  'comment',
  'punct',
  'literal',
  'string',
  'operator',
  'keyword',
  'function',
  'meta',
] as const

export type CodeTokenName = (typeof CODE_TOKEN_NAMES)[number]

/**
 * Her kod jetonunun "tohum" rengi. Koyu tema paletinden seçildi; açık zeminde
 * `ensureContrast` bunları koyulaştırır, koyu zeminde olduğu gibi kalır.
 */
const CODE_TOKEN_SEEDS: Record<CodeTokenName, string> = {
  comment: '#7c89a0',
  punct: '#9aa8bd',
  literal: '#f2857f',
  string: '#4fd6a4',
  operator: '#57c7f0',
  keyword: '#b18cff',
  function: '#7fb0ff',
  meta: '#fbbf24',
}

/** Kod vurgularının codeBg üzerinde garanti edilen minimum kontrastı. */
export const CODE_TOKEN_MIN_CONTRAST = 3.5

/**
 * `codeBg`'dan türetilmiş, kontrastı garanti edilmiş 8 kod vurgu rengi.
 *
 * ÖNEMLİ: `--jmc-code-*` değişkenleri artık sabit iki paletten seçilmiyor.
 * Kullanıcı Custom Theme Builder ile istediği renkli bir kod zemini
 * seçtiğinde bile her vurgu rengi okunabilir kalır.
 */
export function deriveCodeTokens(codeBg: string): Record<CodeTokenName, string> {
  const out = {} as Record<CodeTokenName, string>
  for (const name of CODE_TOKEN_NAMES) {
    out[name] = ensureContrast(CODE_TOKEN_SEEDS[name], codeBg, CODE_TOKEN_MIN_CONTRAST)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Tema kataloğu                                                      */
/* ------------------------------------------------------------------ */

const shared = {
  /** Yükseltilmiş yüzeylerin düşüş gölgesi. Tema başına ayarlanır. */
} as const

export const THEMES: Record<ThemeName, ThemeColors> = {
  Dark: {
    bg: '#0b0f16',
    bgElevated: '#11161f',
    bgSurface: '#171d28',
    border: '#242c3a',
    borderSubtle: '#1a212c',
    text: '#e8edf5',
    textMuted: '#9aa8bd',
    textDim: '#6f7d93',
    primary: '#4c8dff',
    primaryHover: '#3a7ae8',
    accent: '#7aa7ff',
    accentHover: '#4c8dff',
    warning: '#e0a03a',
    danger: '#ef5f6b',
    success: '#3fb98a',
    codeBg: '#0d1219',
    badgeBg: 'rgba(76, 141, 255, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.35)',
  },
  Light: {
    bg: '#f6f7f9',
    bgElevated: '#ffffff',
    bgSurface: '#f0f2f5',
    border: '#dfe3e9',
    borderSubtle: '#e9ecf1',
    text: '#14181f',
    textMuted: '#525c6b',
    textDim: '#78828f',
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    accent: '#0369a1',
    accentHover: '#075985',
    warning: '#a86a08',
    danger: '#c6283a',
    success: '#10795a',
    codeBg: '#eceef2',
    badgeBg: 'rgba(37, 99, 235, 0.09)',
    elevation: 'rgba(15, 23, 42, 0.08)',
  },
  Graphite: {
    bg: '#131315',
    bgElevated: '#191a1d',
    bgSurface: '#212227',
    border: '#2d2f35',
    borderSubtle: '#23252a',
    text: '#edeef1',
    textMuted: '#9ea1aa',
    textDim: '#757983',
    primary: '#b8bcc6',
    primaryHover: '#d3d6de',
    accent: '#dfe2e9',
    accentHover: '#ffffff',
    warning: '#d9a520',
    danger: '#e4566b',
    success: '#4fb37a',
    codeBg: '#0e0e10',
    badgeBg: 'rgba(184, 188, 198, 0.12)',
    elevation: 'rgba(0, 0, 0, 0.4)',
  },
  Abyss: {
    bg: '#030407',
    bgElevated: '#070a10',
    bgSurface: '#0d121b',
    border: '#161e2c',
    borderSubtle: '#0e141e',
    text: '#eaf0f8',
    textMuted: '#94a3b7',
    textDim: '#64748b',
    primary: '#3d9be9',
    primaryHover: '#2f86d6',
    accent: '#5ec8f5',
    accentHover: '#3d9be9',
    warning: '#e0a33c',
    danger: '#f2606c',
    success: '#3fc08c',
    codeBg: '#020305',
    badgeBg: 'rgba(61, 155, 233, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.5)',
  },
  Sand: {
    bg: '#f4f1ea',
    bgElevated: '#fdfbf6',
    bgSurface: '#eae5d9',
    border: '#ded6c5',
    borderSubtle: '#e8e1d2',
    text: '#26221c',
    textMuted: '#57503f',
    textDim: '#847a66',
    primary: '#9a5b13',
    primaryHover: '#7f4a0f',
    accent: '#8a6d2f',
    accentHover: '#6f5725',
    warning: '#96620c',
    danger: '#a8322f',
    success: '#2f6b47',
    codeBg: '#e7e1d3',
    badgeBg: 'rgba(154, 91, 19, 0.1)',
    elevation: 'rgba(90, 74, 45, 0.1)',
  },
  Ocean: {
    bg: '#081420',
    bgElevated: '#0d1c2b',
    bgSurface: '#132536',
    border: '#1d3448',
    borderSubtle: '#152736',
    text: '#e4f0f8',
    textMuted: '#92b3c8',
    textDim: '#6b8ca2',
    primary: '#2f9fd4',
    primaryHover: '#2688b8',
    accent: '#2ec4b6',
    accentHover: '#22a396',
    warning: '#e0aa3c',
    danger: '#ee6060',
    success: '#3fbb8f',
    codeBg: '#050f17',
    badgeBg: 'rgba(47, 159, 212, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.35)',
  },
  Forest: {
    bg: '#0a1410',
    bgElevated: '#101e18',
    bgSurface: '#172a22',
    border: '#24382f',
    borderSubtle: '#1a2b24',
    text: '#e6f2ea',
    textMuted: '#96b3a4',
    textDim: '#6e8b7b',
    primary: '#3aa87c',
    primaryHover: '#2f8d68',
    accent: '#63c9a2',
    accentHover: '#3aa87c',
    warning: '#d9a33f',
    danger: '#e8635f',
    success: '#3aa87c',
    codeBg: '#060d0a',
    badgeBg: 'rgba(58, 168, 124, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.35)',
  },
  'Hacker Green': {
    bg: '#080f0b',
    bgElevated: '#0d1811',
    bgSurface: '#132318',
    border: '#1f3327',
    borderSubtle: '#16261c',
    text: '#e4f5ec',
    textMuted: '#8fbea4',
    textDim: '#668f77',
    primary: '#22b573',
    primaryHover: '#1a9a60',
    accent: '#4ed99c',
    accentHover: '#22b573',
    warning: '#d8b13e',
    danger: '#e8625e',
    success: '#22b573',
    codeBg: '#050b07',
    badgeBg: 'rgba(34, 181, 115, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.38)',
  },
  Matrix: {
    bg: '#050806',
    bgElevated: '#0a110c',
    bgSurface: '#101a13',
    border: '#1b2c20',
    borderSubtle: '#132118',
    text: '#d6f5e0',
    textMuted: '#7fcf9a',
    textDim: '#5da378',
    primary: '#35d07f',
    primaryHover: '#28b06a',
    accent: '#7ef0ad',
    accentHover: '#35d07f',
    warning: '#d6d05a',
    danger: '#f07070',
    success: '#35d07f',
    codeBg: '#030605',
    badgeBg: 'rgba(53, 208, 127, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.4)',
  },
  'Amber CRT': {
    bg: '#0a0703',
    bgElevated: '#130e05',
    bgSurface: '#1c1508',
    border: '#2c230e',
    borderSubtle: '#211a09',
    text: '#f7e3bd',
    textMuted: '#d0ab6b',
    textDim: '#a37f45',
    primary: '#e0a341',
    primaryHover: '#c68c2c',
    accent: '#f0c377',
    accentHover: '#e0a341',
    warning: '#e0a341',
    danger: '#e05c4f',
    success: '#48b07c',
    codeBg: '#070501',
    badgeBg: 'rgba(224, 163, 65, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.42)',
  },
  Cyberpunk: {
    bg: '#080a14',
    bgElevated: '#0e1120',
    bgSurface: '#151930',
    border: '#232848',
    borderSubtle: '#1a1e35',
    text: '#e8ecf7',
    textMuted: '#a2abc4',
    textDim: '#7b84a0',
    primary: '#31c7e8',
    primaryHover: '#23a8c6',
    accent: '#e8467c',
    accentHover: '#c62f61',
    warning: '#e0b13c',
    danger: '#e8467c',
    success: '#40b98a',
    codeBg: '#05070f',
    badgeBg: 'rgba(49, 199, 232, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.4)',
  },
  'Red Team': {
    bg: '#0b0709',
    bgElevated: '#140d10',
    bgSurface: '#1e1418',
    border: '#2f1b20',
    borderSubtle: '#241417',
    text: '#f2ecee',
    textMuted: '#c4a6ac',
    textDim: '#96757c',
    primary: '#e2455f',
    primaryHover: '#c3344c',
    accent: '#f0778c',
    accentHover: '#e2455f',
    warning: '#dc9a37',
    danger: '#e2455f',
    success: '#45ad7e',
    codeBg: '#070405',
    badgeBg: 'rgba(226, 69, 95, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.4)',
  },
  'Neon Dreams': {
    bg: '#0d0817',
    bgElevated: '#150e26',
    bgSurface: '#1e1436',
    border: '#2e1f4e',
    borderSubtle: '#241738',
    text: '#f2eafb',
    textMuted: '#c0a9dd',
    textDim: '#9078ad',
    primary: '#a973ea',
    primaryHover: '#8f57da',
    accent: '#3fa9e8',
    accentHover: '#2b8bc9',
    warning: '#d9a63d',
    danger: '#e8637f',
    success: '#46bb84',
    codeBg: '#080512',
    badgeBg: 'rgba(169, 115, 234, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.4)',
  },
  Synthwave: {
    bg: '#110718',
    bgElevated: '#1a0c26',
    bgSurface: '#241234',
    border: '#38194d',
    borderSubtle: '#2b1139',
    text: '#f6ecfb',
    textMuted: '#cda6e4',
    textDim: '#9b78b5',
    primary: '#dd63e8',
    primaryHover: '#c249cf',
    accent: '#37c5dd',
    accentHover: '#26a8bf',
    warning: '#e0ab3d',
    danger: '#e8557f',
    success: '#43c58a',
    codeBg: '#0a0410',
    badgeBg: 'rgba(221, 99, 232, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.42)',
  },
  'Sunset Vibes': {
    bg: '#120a16',
    bgElevated: '#1c0f21',
    bgSurface: '#27162d',
    border: '#3a1f41',
    borderSubtle: '#2d1833',
    text: '#f6eaf1',
    textMuted: '#cda7bb',
    textDim: '#9c7c90',
    primary: '#e0668c',
    primaryHover: '#c44e73',
    accent: '#e08a3c',
    accentHover: '#c1732a',
    warning: '#dda63d',
    danger: '#e0576f',
    success: '#45b57f',
    codeBg: '#0c050f',
    badgeBg: 'rgba(224, 102, 140, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.4)',
  },

  /* --- Yeni katalog genişletmeleri (4 tema) ------------------------- */

  /**
   * Derin deniz: petrol yeşili–çivit mutesi. `Ocean`'dan belirgin şekilde
   * daha koyu, daha az mavi ve daha düşük doygunluklu; aksanı turkuaz-yeşil.
   */
  'Deep Sea': {
    bg: '#061413',
    bgElevated: '#0b1f1d',
    bgSurface: '#122b28',
    border: '#1d3d39',
    borderSubtle: '#16302d',
    text: '#dff0ec',
    textMuted: '#8fb3ac',
    textDim: '#658a84',
    primary: '#2fa08c',
    primaryHover: '#268776',
    accent: '#5cc4b1',
    accentHover: '#2fa08c',
    warning: '#d3a03f',
    danger: '#e0645f',
    success: '#37b58d',
    codeBg: '#04100f',
    badgeBg: 'rgba(47, 160, 140, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.4)',
  },

  /** Koyu bordo / şarap kırmızısı: mürekkep moru değil, doygun şarap tonları. */
  Bordeaux: {
    bg: '#140a0e',
    bgElevated: '#1d0f14',
    bgSurface: '#28151b',
    border: '#3d1f27',
    borderSubtle: '#2f1820',
    text: '#f6ebee',
    textMuted: '#c8a3ab',
    textDim: '#9a757f',
    primary: '#c8405a',
    primaryHover: '#a9324a',
    accent: '#e06a83',
    accentHover: '#c8405a',
    warning: '#d9a03e',
    danger: '#d94a5e',
    success: '#4aa77a',
    codeBg: '#0d0508',
    badgeBg: 'rgba(200, 64, 90, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.42)',
  },

  /**
   * Yüksek kontrastlı monokrom: saf siyah zemin + saf beyaz metin, tek vurgu
   * rengi (sarı). Düşük görme / parlak ortam için; WCAG AA eşiğini korur,
   * hatta AAA seviyesine çıkar.
   */
  'High Contrast': {
    bg: '#000000',
    bgElevated: '#0a0a0a',
    bgSurface: '#141414',
    border: '#3d3d3d',
    borderSubtle: '#1f1f1f',
    text: '#ffffff',
    textMuted: '#d4d4d4',
    textDim: '#a3a3a3',
    primary: '#ffd400',
    primaryHover: '#ffe34d',
    accent: '#ffd400',
    accentHover: '#ffe34d',
    warning: '#ffd400',
    danger: '#ff5c5c',
    success: '#4ade80',
    codeBg: '#000000',
    badgeBg: 'rgba(255, 212, 0, 0.16)',
    elevation: 'rgba(0, 0, 0, 0.8)',
  },

  /**
   * Pastel yumuşak: AÇIK tema. Koyu metin, açık lavanta zemin.
   * `isLightBackground` bunu "açık" sayar, bu yüzden `color-scheme: light`
   * ve açık kod vurguları devreye girer.
   */
  'Pastel Soft': {
    bg: '#f7f4fb',
    bgElevated: '#ffffff',
    bgSurface: '#efe9f7',
    border: '#dcd2ec',
    borderSubtle: '#e7dff3',
    text: '#2e2a3d',
    textMuted: '#5a5470',
    textDim: '#736c8a',
    primary: '#7c5cd6',
    primaryHover: '#6a49c4',
    accent: '#d96a9a',
    accentHover: '#c15285',
    warning: '#a9701a',
    danger: '#c0395a',
    success: '#1f7a5e',
    codeBg: '#ece5f6',
    badgeBg: 'rgba(124, 92, 214, 0.1)',
    elevation: 'rgba(76, 61, 110, 0.1)',
  },

  Custom: {
    bg: '#0b0f16',
    bgElevated: '#11161f',
    bgSurface: '#171d28',
    border: '#242c3a',
    borderSubtle: '#1a212c',
    text: '#e8edf5',
    textMuted: '#9aa8bd',
    textDim: '#6f7d93',
    primary: '#4c8dff',
    primaryHover: '#3a7ae8',
    accent: '#7aa7ff',
    accentHover: '#4c8dff',
    warning: '#e0a03a',
    danger: '#ef5f6b',
    success: '#3fb98a',
    codeBg: '#0d1219',
    badgeBg: 'rgba(76, 141, 255, 0.14)',
    elevation: 'rgba(0, 0, 0, 0.35)',
  },
}

void shared

/** Tema adlarının arayüzde görünen sırası ve etiketleri. */
export const THEME_LIST: Array<{ id: ThemeName; label: string; group: 'system' | 'neutral' | 'expressive' }> = [
  { id: 'Dark', label: 'Karanlık', group: 'system' },
  { id: 'Light', label: 'Aydınlık', group: 'system' },
  { id: 'High Contrast', label: 'Yüksek Kontrast', group: 'system' },
  { id: 'Pastel Soft', label: 'Pastel Yumuşak', group: 'system' },
  { id: 'Custom', label: 'Özel', group: 'system' },
  { id: 'Graphite', label: 'Grafit', group: 'neutral' },
  { id: 'Abyss', label: 'Derinlik', group: 'neutral' },
  { id: 'Sand', label: 'Kum', group: 'neutral' },
  { id: 'Ocean', label: 'Okyanus', group: 'neutral' },
  { id: 'Deep Sea', label: 'Derin Deniz', group: 'neutral' },
  { id: 'Forest', label: 'Orman', group: 'neutral' },
  { id: 'Hacker Green', label: 'Terminal Yeşili', group: 'expressive' },
  { id: 'Matrix', label: 'Matrix', group: 'expressive' },
  { id: 'Amber CRT', label: 'Amber CRT', group: 'expressive' },
  { id: 'Cyberpunk', label: 'Siberpunk', group: 'expressive' },
  { id: 'Red Team', label: 'Kızıl Operasyon', group: 'expressive' },
  { id: 'Bordeaux', label: 'Bordo', group: 'expressive' },
  { id: 'Neon Dreams', label: 'Neon Dreams', group: 'expressive' },
  { id: 'Synthwave', label: 'Synthwave', group: 'expressive' },
  { id: 'Sunset Vibes', label: 'Gün Batımı', group: 'expressive' },
]

/* ------------------------------------------------------------------ */
/* Custom Theme Builder — saf yardımcılar                              */
/* ------------------------------------------------------------------ */

/** Kayıtlı temaların tutulduğu localStorage anahtarı. */
export const CUSTOM_THEME_STORAGE_KEY = 'jmc_custom_themes'
/** Etkin kayıtlı temanın kimliğini tutan localStorage anahtarı. */
export const CUSTOM_THEME_ACTIVE_KEY = 'jmc_custom_theme_active'
/** localStorage listesinde izin verilen maksimum tema sayısı. */
export const MAX_CUSTOM_THEMES = 12
/** Tema adı uzunluk sınırı. */
export const CUSTOM_THEME_NAME_MAX = 40

/** Kontrol karakterleri (satır sonu, NUL, ...) adlarda kabul edilmez. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g
/** Adlarda izin verilen karakter kümesi: harf, rakam, boşluk, tire, alt çizgi. */
const UNSAFE_NAME_CHARS = /[^\p{L}\p{N} \-_]/gu

/** Kullanıcı adının normalize edilmiş hâli; geçersizse boş string. */
export function normalizeCustomThemeName(raw: string): string {
  return validateCustomThemeName(raw).name
}

export type CustomThemeNameReason = 'empty' | 'too_long'

export interface CustomThemeNameValidation {
  ok: boolean
  name: string
  reason?: CustomThemeNameReason
}

/**
 * Tema adını doğrular ve normalize eder.
 *
 * - Boş ad reddedilir.
 * - 40 karakterden uzun ad reddedilir (sessizce kesilmez).
 * - Harf/rakam/boşluk/tire/alt çizgi dışındaki karakterler atılır; ad tamamen
 *   atılırsa "boş" sayılır.
 */
export function validateCustomThemeName(raw: string): CustomThemeNameValidation {
  if (typeof raw !== 'string') return { ok: false, name: '', reason: 'empty' }
  const stripped = raw
    .normalize('NFKC')
    .replace(CONTROL_CHARS, '')
    .replace(UNSAFE_NAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!stripped) return { ok: false, name: '', reason: 'empty' }
  if (stripped.length > CUSTOM_THEME_NAME_MAX) {
    return { ok: false, name: stripped.slice(0, CUSTOM_THEME_NAME_MAX), reason: 'too_long' }
  }
  return { ok: true, name: stripped }
}

/**
 * Serbest metni `#rrggbb` biçimine çevirir; geçersizse `null`.
 *
 * `<input type="color">` yalnızca 6 haneli döndürdüğü için kullanıcının hex
 * alanına yazdığı `#abc` gibi kısa biçimler de buradan geçer.
 */
export function sanitizeHex(raw: string): string | null {
  if (typeof raw !== 'string') return null
  let h = raw.trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(h)) return null
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length !== 6) return null
  return `#${h}`
}

/** Durum renkleri için şema bazlı tohumlar (her ikisi de kontrast garantilidir). */
const STATUS_SEEDS = {
  dark: { warning: '#e0a03a', danger: '#ef5f6b', success: '#3fb98a' },
  light: { warning: '#a86a08', danger: '#c6283a', success: '#10795a' },
} as const

/**
 * Kullanıcının seçtiği 4 renkten tam bir `ThemeColors` üretir.
 *
 * Kullanıcının seçtiği alanlar (bg / text / primary / accent) ASLA
 * değiştirilmez — düşük kontrastlı bir seçim bilinçli tercih olabilir,
 * arayüz uyarı gösterir. TÜRETİLEN alanlar ise kontrast garantisiyle
 * hesaplanır, böylece bir "textMuted" seçimi her zaman okunabilir kalır.
 */
export function deriveCustomThemeColors(draft: CustomThemeDraft): ThemeColors {
  const bg = sanitizeHex(draft?.bg) ?? THEMES.Dark.bg
  const text = sanitizeHex(draft?.text) ?? THEMES.Dark.text
  const primary = sanitizeHex(draft?.primary) ?? THEMES.Dark.primary
  const accent = sanitizeHex(draft?.accent) ?? THEMES.Dark.accent
  const light = isLightBackground(bg)
  const status = light ? STATUS_SEEDS.light : STATUS_SEEDS.dark

  return {
    bg,
    // Yüzey yüksekliği: koyu temada beyaza doğru hafifçe, açık temada
    // yükseltilmiş yüzey neredeyse saf beyaz, yüzey ise hafifçe koyu.
    bgElevated: light ? mixHex(bg, '#ffffff', 0.9) : mixHex(bg, '#ffffff', 0.05),
    bgSurface: light ? mixHex(bg, '#000000', 0.045) : mixHex(bg, '#ffffff', 0.1),
    border: mixHex(bg, text, light ? 0.16 : 0.14),
    borderSubtle: mixHex(bg, text, light ? 0.085 : 0.075),
    text,
    textMuted: ensureContrast(mixHex(text, bg, 0.28), bg, 4.5),
    textDim: ensureContrast(mixHex(text, bg, 0.5), bg, 3.5),
    primary,
    primaryHover: mixHex(primary, bg, 0.2),
    accent,
    accentHover: mixHex(accent, bg, 0.2),
    warning: ensureContrast(status.warning, bg, 4.5),
    danger: ensureContrast(status.danger, bg, 4.5),
    success: ensureContrast(status.success, bg, 4.5),
    codeBg: light ? mixHex(bg, '#000000', 0.06) : mixHex(bg, '#000000', 0.35),
    badgeBg: hexToRgba(primary, light ? 0.1 : 0.14),
    elevation: light ? 'rgba(15, 23, 42, 0.1)' : 'rgba(0, 0, 0, 0.4)',
  }
}

/** Ad + zaman damgasından kararlı bir kimlik üretir. */
export function makeCustomThemeId(name: string, nonce: number): string {
  const slug =
    normalizeCustomThemeName(name)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'tema'
  return `custom-${slug}-${Math.abs(Math.trunc(nonce)).toString(36)}`
}

/**
 * Taslak + zaman damgasından kalıcı bir `CustomTheme` üretir.
 * Geçersiz ad veya renk verilirse `ok: false` döner.
 */
export function createCustomTheme(
  draft: CustomThemeDraft,
  nonce: number,
):
  | { ok: true; theme: CustomTheme }
  | { ok: false; reason: CustomThemeNameReason | 'color' } {
  const name = validateCustomThemeName(draft?.name)
  if (!name.ok) return { ok: false, reason: name.reason ?? 'empty' }
  const hexes = [draft?.bg, draft?.primary, draft?.accent, draft?.text].map(sanitizeHex)
  if (hexes.some(h => h === null)) return { ok: false, reason: 'color' }
  return {
    ok: true,
    theme: {
      id: makeCustomThemeId(name.name, nonce),
      name: name.name,
      colors: deriveCustomThemeColors(draft),
      createdAt: nonce,
    },
  }
}

/** Kayıtlı tema listesini localStorage metnine çevirir. */
export function serializeCustomThemes(list: CustomTheme[]): string {
  const safe = Array.isArray(list) ? list.filter(t => t && typeof t.id === 'string') : []
  return JSON.stringify(
    safe.map(t => ({ id: t.id, name: t.name, colors: t.colors, createdAt: t.createdAt })),
  )
}

/** `ThemeColors` içinde yalnızca düz hex beklenen alanlar. */
const HEX_COLOR_KEYS = [
  'bg',
  'bgElevated',
  'bgSurface',
  'border',
  'borderSubtle',
  'text',
  'textMuted',
  'textDim',
  'primary',
  'primaryHover',
  'accent',
  'accentHover',
  'warning',
  'danger',
  'success',
  'codeBg',
] as const satisfies readonly (keyof ThemeColors)[]

/** rgba() metni de kabul edilen alanlar. */
const ALPHA_COLOR_KEYS = ['badgeBg', 'elevation'] as const satisfies readonly (keyof ThemeColors)[]

/** Bozuk/eksik bir renk kaydını güvenle onarır; çekirdek alanlar yoksa reddeder. */
export function sanitizeStoredColors(raw: unknown): ThemeColors | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const out: Record<string, string> = { ...THEMES.Custom }

  let valid = 0
  for (const key of HEX_COLOR_KEYS) {
    const value = rec[key]
    if (typeof value !== 'string') continue
    const hex = sanitizeHex(value)
    if (hex) {
      out[key] = hex
      valid++
    }
  }
  for (const key of ALPHA_COLOR_KEYS) {
    const value = rec[key]
    if (typeof value === 'string' && parseHex(value)) out[key] = value
  }

  // Çekirdek dört alan (zemin, metin, iki vurgu) eksikse tema kullanılamaz.
  if (valid < 4) return null
  return out as unknown as ThemeColors
}

/**
 * localStorage metninden kayıtlı tema listesini okur.
 *
 * HİÇBİR ZAMAN çökmez: bozuk JSON, yanlış tip, eksik alan veya tekrar eden
 * kimlikler sessizce atlanır; geçerli kayıtlar geri döner.
 */
export function parseCustomThemes(raw: string | null | undefined): CustomTheme[] {
  if (typeof raw !== 'string' || raw.length === 0) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []

  const out: CustomTheme[] = []
  const seen = new Set<string>()
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : null
    if (!id || seen.has(id)) continue
    const name = validateCustomThemeName(typeof rec.name === 'string' ? rec.name : '')
    if (!name.ok) continue
    const colors = sanitizeStoredColors(rec.colors)
    if (!colors) continue
    seen.add(id)
    const createdAt = typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt) ? rec.createdAt : 0
    out.push({ id, name: name.name, colors, createdAt })
  }
  return out
}
