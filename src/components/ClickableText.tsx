/**
 * ClickableText
 * ---------------------------------------------------------------------------
 * Duz metni, icindeki adresleri TIKLANABILIR baglantiya cevirir.
 *
 * NEDEN VAR
 * ---------
 * Belge onizlemelerinde (PDF ayiklanan metni, DOCX paragraflari, PPTX
 * maddeleri, CSV hucreleri, duz metin) adresler DUZ METIN olarak
 * gosteriliyordu; yalnizca Markdown yuzeyinde `<a>` etiketi uretiliyordu.
 * Kullanicinin "linkler tiklanabilir degil" sartinin nedeni buydu.
 *
 * Davranis:
 *   • `http://` / `https://` / `mailto:` adresleri tiklanabilir olur.
 *   • Tiklama `shell.openExternal` uzerinden SISTEM TARAYICISINDA acilir.
 *   • Adres bulunmayan metin oldugu gibi basilir (XSS riski yok: React
 *     metni escape eder, `dangerouslySetInnerHTML` KULLANILMAZ).
 *   • Noktali virgul, satir sonu ve tirnak gibi adres bitirici karakterler
 *     adresin disinda birakilir.
 */
import React from 'react'
import { isRealTld } from '../lib/tldList'
import { parseYouTubeUrl } from '../lib/youtube'
import { YouTubeInlineCard } from './YouTubeInlineCard'

/**
 * Dosya UZANTILARI — bunlar alan adi SANILAMAZ.
 *
 * `index.html`, `rapor.pdf`, `main.ts` gibi kalsitlar alan adi regex'ine
 * takilirdi ve kullaniciya yanlis baglanti olarak gosterilirdi.
 */
/**
 * YALNIZCA hem dosya uzantisi HEM de gercek bir TLD olan etiketler.
 *
 * NEDEN BU KADAR KUCUK?
 * -------------------
 * Onceki surumde 60+ dosya uzantisi reddediliyordu. Ancak sekiz tanesi
 * (`md`, `mov`, `py`, `java`, `rs`, `sh`, `zip`, `map`) IANA tarafindan
 * delege edilmis GERCEK ust duzeylerdir; yeniden tanimlanmis gTLD'lerdir.
 * Yani o liste hem gercek alan adlarini hem de dosya adlarini ayni anda
 * reddediyordu.
 *
 * Artik TLD dogrulamasi IANA listesine bakar ve bu ayrim GEREKMEZ;
 * geri kalan 50+ uzantinin listede olmadigi zaten belli olur. Burada
 * yalnizca gercekten IKISI DE olan etiketler kalir: sohbet metninde
 * `script.py`, `notlar.md` yazdiginda dosya soylemek, alan adi soylemekten
 * cok daha olasidir. (Bu deger `scripts/tlds.txt` ile karsilastirilarak
 * bulunur; liste yenilenirse bu kume de gozden gecirilmelidir.)
 */
const AMBIGUOUS_EXTENSIONS = new Set(['md', 'mov', 'py', 'java', 'rs', 'sh', 'zip', 'map'])

/**
 * Gercek bir alan adi olup olmadigini denetler.
 *
 * Uc yanlis pozitif sinifi vardir:
 *   1. UYDURMA UZANTILAR: "linkgib.linkler", "baglanti.adres"
 *      -> son etiket IANA listesinde YOK.
 *   2. Surum numaralari: "1.5", "v2.0", "2024.1" -> son etiket rakam icerir.
 *   3. Belirsiz dosya adlari: "index.html", "main.ts" -> TLD listesinde
 *      olmayanlar zaten 1. maddeyle elenir; gercek TLD olan bir kacinin
 *      dosya adi olarak gorunmesi mumkinse (`script.py`) AMBIGUOUS_EXTENSIONS
 *      eler.
 *
 * Ayrica "ornek.com.tr" gibi cok etiketli adlar ve iki harfli ulke
 * uzantilari (.tr, .de, .uk) desteklenir.
 */
/**
 * Kod parcalarinda nesne/anahtar sozcuk olarak sikca gecen on-ekler.
 * Orn. Java/JS icinde `this.ad = ad;` veya `self.id = id;` yazildiginda
 * `.ad` (Andorra) ve `.id` (Endonezya) gercek ulke TLD'si oldugu icin
 * yanlislikla baglanti sayiliyordu. Iki etiketli ve yolsuz (`slash` olmayan)
 * adaylarda ilk etiket bu listedeyse baglanti kabul edilmez.
 */
const CODE_IDENTIFIER_PREFIXES = new Set([
  'this', 'self', 'super', 'window', 'document', 'console', 'process',
  'math', 'json', 'object', 'array', 'string', 'number', 'boolean',
  'props', 'state', 'item', 'elem', 'el', 'ev', 'err', 'req', 'res',
  'ctx', 'std', 'sys', 'os', 'io', 'fs', 'path', 'net', 'http', 'url',
  'util', 'fmt', 'log', 'cfg', 'config', 'opts', 'options', 'args',
  'params', 'data', 'result', 'val', 'value', 'obj', 'node', 'user',
])

function isPlausibleBareDomain(host: string, hasPath = false): boolean {
  if (!host || host.length < 4 || host.length > 253) return false
  if (/^\d/.test(host)) return false
  const labels = host.split('.')
  if (labels.length < 2) return false
  const tld = labels[labels.length - 1]
  // TLD saf harf olmali (`.pdf`, `.123` gecerli sayilmaz)
  if (!/^[a-z]{2,24}$/i.test(tld)) return false
  // IANA dogrulamasi: uydurma uzantilar burada elenir.
  if (!isRealTld(tld)) return false
  if (AMBIGUOUS_EXTENSIONS.has(tld.toLowerCase())) return false
  // `this.ad`, `self.id`, `console.in` gibi 2 etiketli kod degiskenlerini ele
  if (labels.length === 2 && !hasPath && CODE_IDENTIFIER_PREFIXES.has(labels[0].toLowerCase())) {
    return false
  }
  // Her etiket kurallara uymali
  for (const label of labels) {
    if (!label || label.length > 63) return false
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) return false
  }
  // En az bir etiket harf icermeli ("123.45" gibi saf rakamlar elenir)
  if (!labels.some(l => /[a-z]/i.test(l))) return false
  return true
}

/** Bir eslesmeyi adres olarak kabul edip URL'ye cevirir; reddedilirse null. */
function normalizeCandidate(raw: string): string | null {
  if (!raw) return null
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) return raw
  if (/^www\./i.test(raw)) return raw

  const emailMatch = /^([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+)$/.exec(raw)
  if (emailMatch) {
    const host = emailMatch[2]
    const hostLabels = host.split('.')
    const hostTld = hostLabels[hostLabels.length - 1]
    if (
      hostLabels.length >= 2 &&
      /^[a-z]{2,24}$/i.test(hostTld) &&
      isRealTld(hostTld) &&
      !AMBIGUOUS_EXTENSIONS.has(hostTld.toLowerCase()) &&
      hostLabels.every(l => l.length > 0 && l.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(l))
    ) {
      return `mailto:${raw}`
    }
    return null
  }

  // Yaylisiz aday: once yolu ayir, sonra alan adini dogrula.
  const slash = raw.indexOf('/')
  const host = slash === -1 ? raw : raw.slice(0, slash)
  const path = slash === -1 ? '' : raw.slice(slash)
  if (!isPlausibleBareDomain(host, slash !== -1 && path.length > 1)) return null
  return host + path
}

export function findUrls(text: string): Array<{ start: number; end: number; url: string }> {
  const out: Array<{ start: number; end: number; url: string }> = []
  const re =
    /\b(?:(?:https?:\/\/|mailto:)|www\.)[^\s<>"'`\]}。，、]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}(?![\w-])|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,24}(?![\w-])(?:\/[^\s<>"'`\]}。，、]*)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let raw = m[0]
    let end = m.index + raw.length
    // Sondaki noktalama isaretleri adresin parcası degildir.
    while (raw.length > 0 && /[.,;:!?]$/.test(raw)) {
      raw = raw.slice(0, -1)
      end--
    }
    // Kapanis parantezi DENGESI (Wikipedia tarzi baglantilar).
    // Sadece dengesizse kirpilir; dengeli `)` adresin bir parcasidir.
    while (raw.endsWith(')') && (raw.match(/\(/g)?.length ?? 0) < (raw.match(/\)/g)?.length ?? 0)) {
      raw = raw.slice(0, -1)
      end--
    }
    // Semasiz (`http`/`www`/`@` icermeyen) 2 etiketli ciplak alan adlarinda
    // hemen ardindan `=` atama operatoru veya `(` fonksiyon cagrisi geliyorsa
    // (`nesne.ad = "Ali"`, `nesne.io()`) bu bir kod ifadesidir, URL degildir.
    const isBare = !/^(?:https?:\/\/|mailto:|www\.)/i.test(raw) && !raw.includes('@') && !raw.includes('/')
    if (isBare && raw.split('.').length === 2) {
      const afterSlice = text.slice(end, end + 8)
      if (/^\s*=[^=]/.test(afterSlice) || /^\(/.test(afterSlice)) {
        continue
      }
    }
    const normalized = normalizeCandidate(raw)
    if (!normalized) continue
    out.push({ start: m.index, end, url: normalized })
  }
  return out
}

/** Adresin guvenli sayilip sayilmayacagini denetler. */
export function isSafeExternalUrl(raw: string): boolean {
  // Semasi olmayan her adres `https://` ile denenir.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(withScheme)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}

/** Adresi mutlaka `https://` ile baslayan tam bir URL'ye cevirir. */
export function toOpenableUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) return raw
  return `https://${raw}`
}

interface ClickableTextProps {
  text: string
  className?: string
  /** Bosluk ve satir sonlarini koru (varsayilan). */
  preserveWhitespace?: boolean
  /** Kullanici sohbet balonu gibi primary dolgulu zeminlerde 'onPrimary' kullanilir. */
  variant?: 'default' | 'onPrimary'
  /** Metin icinde YouTube baglantisi varsa hafif uygulama ici oynatici karti goster (varsayilan: true). */
  enableYouTubeEmbed?: boolean
}

export function ClickableText({
  text,
  className,
  preserveWhitespace = true,
  variant = 'default',
  enableYouTubeEmbed = true,
}: ClickableTextProps): React.ReactElement {
  const urls = React.useMemo(() => findUrls(text ?? ''), [text])

  const open = React.useCallback((url: string) => {
    if (!isSafeExternalUrl(url)) return
    void window.jmcAPI?.openExternalUrl(toOpenableUrl(url))
  }, [])

  const linkClassName =
    variant === 'onPrimary'
      ? 'text-[var(--jmc-on-primary)] font-bold underline decoration-2 underline-offset-3 bg-[var(--jmc-on-primary)]/15 hover:bg-[var(--jmc-on-primary)]/25 px-1.5 py-0.5 rounded transition-colors break-all'
      : 'text-[var(--jmc-link)] hover:text-[var(--jmc-link-hover)] font-semibold underline decoration-[1.5px] underline-offset-3 bg-[var(--jmc-link)]/10 hover:bg-[var(--jmc-link)]/20 px-1 py-0.5 rounded transition-colors break-all'

  if (urls.length === 0) {
    return (
      <span className={`${preserveWhitespace ? 'whitespace-pre-wrap break-words' : ''} ${className ?? ''}`}>
        {text}
      </span>
    )
  }

  const nodes: React.ReactNode[] = []
  let cursor = 0
  urls.forEach((item, idx) => {
    if (item.start > cursor) nodes.push(<span key={`t${idx}`}>{text.slice(cursor, item.start)}</span>)
    const yt = enableYouTubeEmbed ? parseYouTubeUrl(item.url) : null
    nodes.push(
      <React.Fragment key={`u${idx}`}>
        <a
          href={toOpenableUrl(item.url)}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            open(item.url)
          }}
          rel="noreferrer noopener"
          className={linkClassName}
          title={toOpenableUrl(item.url)}
        >
          {item.url}
        </a>
        {yt && (
          <span className="block my-1.5 w-full max-w-xl">
            <YouTubeInlineCard
              videoId={yt.videoId}
              url={yt.url}
              startSeconds={yt.startSeconds}
            />
          </span>
        )}
      </React.Fragment>,
    )
    cursor = item.end
  })
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>)

  return (
    <span className={`${preserveWhitespace ? 'whitespace-pre-wrap break-words' : ''} ${className ?? ''}`}>
      {nodes}
    </span>
  )
}


