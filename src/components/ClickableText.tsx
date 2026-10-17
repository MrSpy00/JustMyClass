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

/** Metindeki `scheme://...` ve `www....` adreslerini bulur. */
export function findUrls(text: string): Array<{ start: number; end: number; url: string }> {
  const out: Array<{ start: number; end: number; url: string }> = []
  const re = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]}，。、]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let raw = m[0]
    let end = m.index + raw.length
    // Sondaki noktalama isaretleri adresin parcası degildir.
    while (raw.length > 0 && /[.,;:!?]$/.test(raw)) {
      raw = raw.slice(0, -1)
      end--
    }
    // Kapanis parantezi dengesi (Wikipedia tarzi baglantilar).
    while (raw.endsWith(')') && (raw.match(/\(/g)?.length ?? 0) < (raw.match(/\)/g)?.length ?? 0)) {
      raw = raw.slice(0, -1)
      end--
    }
    if (raw.length < 8) continue
    out.push({ start: m.index, end, url: raw })
  }
  return out
}

/** Adresin guvenli sayilip sayilmayacagini denetler. */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.startsWith('www.') ? `https://${raw}` : raw)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
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
    const full = url.startsWith('www.') ? `https://${url}` : url
    void window.jmcAPI?.openExternalUrl(full)
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
        href={item.url.startsWith('www.') ? `https://${item.url}` : item.url}
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
