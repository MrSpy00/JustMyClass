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

/**
 * Dosya UZANTILARI — bunlar alan adi SANILAMAZ.
 *
 * `index.html`, `rapor.pdf`, `main.ts` gibi kalsitlar alan adi regex'ine
 * takilirdi ve kullaniciya yanlis baglanti olarak gosterilirdi.
 */
const FILE_EXTENSIONS = new Set([
  'txt', 'js', 'jsx', 'ts', 'tsx', 'json', 'html', 'htm', 'css', 'scss', 'less',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif', 'heic',
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'rtf', 'odt', 'ods',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'exe', 'dll', 'msi', 'apk', 'dmg',
  'iso', 'mp3', 'mp4', 'm4a', 'm4v', 'wav', 'flac', 'ogg', 'mov', 'avi', 'mkv',
  'webm', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'py', 'rb', 'php', 'java', 'kt', 'swift', 'go', 'rs', 'c', 'h', 'cpp', 'hpp',
  'cs', 'sh', 'bat', 'ps1', 'sql', 'log', 'yml', 'yaml', 'toml', 'ini', 'conf',
  'env', 'gitignore', 'lock', 'map', 'min', 'd.ts', 'bak', 'tmp', 'srt', 'vtt',
])

/**
 * Gercek bir alan adi olup olmadigini denetler.
 *
 * Iki yanlis pozitif sinifi vardir:
 *   1. Surum numaralari: "1.5", "v2.0", "2024.1"  -> son segment rakam icerir
 *   2. Dosya adlari: "index.html", "main.ts"       -> uzantı listesinde
 * Ayrica "ornek.com.tr" gibi cok etiketli adlar ve iki harfli ulke uzantilari
 * (.tr, .de, .uk) desteklenir.
 */
function isPlausibleBareDomain(host: string): boolean {
  if (!host || host.length < 4 || host.length > 253) return false
  if (/^\d/.test(host)) return false
  const labels = host.split('.')
  if (labels.length < 2) return false
  // TLD saf harf olmali (`.pdf`, `.123` gecerli sayilmaz)
  const tld = labels[labels.length - 1]
  if (!/^[a-z]{2,24}$/i.test(tld)) return false
  if (FILE_EXTENSIONS.has(tld.toLowerCase())) return false
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

  // DUZ E-POSTA ADRESI -> mailto:
  //
  // ONCEKI HATA: `odev@example.com` icin alan adi deseninin ACIK KISMASI
  // yakalaniyordu; sonuc `odev@` atilip `example.com` baglanti olarak
  // cikiyordu. Kullanici mail gondermek istiyordu, tarayici web sayfasi
  // acmaya calisiyordu.
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/.test(raw)) {
    return `mailto:${raw}`
  }

  // Yaylisiz aday: once yolu ayir, sonra alan adini dogrula.
  const slash = raw.indexOf('/')
  const host = slash === -1 ? raw : raw.slice(0, slash)
  const path = slash === -1 ? '' : raw.slice(slash)
  if (!isPlausibleBareDomain(host)) return null
  return host + path
}

/**
 * Metindeki adresleri bulur.
 *
 * Kapsam:
 *   • `https://...` / `http://...`
 *   • `www....`
 *   • `mailto:...`
 *   • DUZ e-posta: `odev@example.com` (otomatik `mailto:` olur)
 *   • YAYLISIZ alan adlari: `aegissoft.com.tr`, `github.com/user/repo`
 *
 * TLD deseninde `(?![\w-])` LOOKAHEAD'i sarttir: olmadan `video.mp4`
 * dosyasi `video.mp` olarak kesilip YANLIS adres sayilirdi (TLD deseni
 * rakam kabul etmedigi icin `4`'te duruyordu).
 */
export function findUrls(text: string): Array<{ start: number; end: number; url: string }> {
  const out: Array<{ start: number; end: number; url: string }> = []
  // NOT: karakter sinifi `)` ve `(` karakterlerini DISLAMAZ. Wikipedia
  // tarzi adreslerde parantez adresin gercek bir parcasidir
  // (`.../Ankara_(disambiguation)`). Onceki surumde `)` sinif disinda
  // birakildigi icin DENGELI parantezli adresler hicbir zaman tam
  // yakalanamiyordu; asagidaki denge kirpmasi da bu yuzden ise yaramiyordu.
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
    const normalized = normalizeCandidate(raw)
    if (!normalized) continue
    if (raw.length < 8 && !/^(?:https?:\/\/|mailto:)/i.test(raw) && !raw.includes('@')) continue
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
}

export function ClickableText({ text, className, preserveWhitespace = true }: ClickableTextProps): React.ReactElement {
  const urls = React.useMemo(() => findUrls(text ?? ''), [text])

  const open = React.useCallback((url: string) => {
    if (!isSafeExternalUrl(url)) return
    void window.jmcAPI?.openExternalUrl(toOpenableUrl(url))
  }, [])

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
    nodes.push(
      <a
        key={`u${idx}`}
        href={toOpenableUrl(item.url)}
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          open(item.url)
        }}
        rel="noreferrer noopener"
        className="text-[var(--jmc-primary)] underline underline-offset-2 hover:opacity-80 break-all"
      >
        {item.url}
      </a>,
    )
    cursor = item.end
  })
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>)

  return <span className={`${preserveWhitespace ? 'whitespace-pre-wrap break-words' : ''} ${className ?? ''}`}>{nodes}</span>
}
