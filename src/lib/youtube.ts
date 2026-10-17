/**
 * youtube.ts
 * ---------------------------------------------------------------------------
 * Sıfır bağımlılıklı (0 MB ek yük), hızlı ve güvenli YouTube URL ayrıştırıcı,
 * küçük resim (thumbnail) ve gizlilik korumalı (`youtube-nocookie.com`)
 * uygulama içi oynatıcı yardımcıları.
 */

export interface YouTubeVideoRef {
  videoId: string
  url: string
  startSeconds?: number
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/

/** `?t=1m30s`, `?t=90`, `?start=45` gibi zaman damgalarını saniyeye çevirir. */
function parseTimeParam(raw: string | null): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10)
    return sec > 0 ? sec : undefined
  }
  const hms = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i.exec(trimmed)
  if (!hms) return undefined
  const h = hms[1] ? parseInt(hms[1], 10) : 0
  const m = hms[2] ? parseInt(hms[2], 10) : 0
  const s = hms[3] ? parseInt(hms[3], 10) : 0
  const total = h * 3600 + m * 60 + s
  return total > 0 ? total : undefined
}

/**
 * Herhangi bir YouTube adresinden (`watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`)
 * 11 karakterlik video kimliğini ve varsa başlangıç saniyesini çıkarır.
 * Geçerli bir YouTube video adresi değilse `null` döndürür.
 */
export function parseYouTubeUrl(rawUrl?: string | null): YouTubeVideoRef | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '').replace(/^music\./, '')
  let videoId: string | null = null

  if (host === 'youtu.be') {
    const seg = parsed.pathname.split('/').filter(Boolean)[0] ?? ''
    if (YT_ID_RE.test(seg)) videoId = seg
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const vParam = parsed.searchParams.get('v')
    if (vParam && YT_ID_RE.test(vParam)) {
      videoId = vParam
    } else {
      const segments = parsed.pathname.split('/').filter(Boolean)
      if (
        segments.length >= 2 &&
        (segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live' || segments[0] === 'v') &&
        YT_ID_RE.test(segments[1])
      ) {
        videoId = segments[1]
      }
    }
  }

  if (!videoId) return null

  const startSeconds = parseTimeParam(parsed.searchParams.get('t') ?? parsed.searchParams.get('start'))
  const canonicalUrl = startSeconds
    ? `https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}s`
    : `https://www.youtube.com/watch?v=${videoId}`

  return {
    videoId,
    url: canonicalUrl,
    ...(startSeconds ? { startSeconds } : {}),
  }
}

/**
 * Metin içindeki tüm YouTube video bağlantılarını (tekrarsız olarak) bulur.
 */
export function extractYouTubeVideosFromText(text?: string | null): YouTubeVideoRef[] {
  if (!text) return []
  const seen = new Set<string>()
  const results: YouTubeVideoRef[] = []

  const urlRegex =
    /\b(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?[^\s<>"'`)\]]+|shorts\/[A-Za-z0-9_-]{11}[^\s<>"'`)\]]*|embed\/[A-Za-z0-9_-]{11}[^\s<>"'`)\]]*|live\/[A-Za-z0-9_-]{11}[^\s<>"'`)\]]*)|youtu\.be\/[A-Za-z0-9_-]{11}[^\s<>"'`)\]]*)/gi

  let match: RegExpExecArray | null
  while ((match = urlRegex.exec(text)) !== null) {
    let raw = match[0]
    while (raw.length > 0 && /[.,;:!?]$/.test(raw)) {
      raw = raw.slice(0, -1)
    }
    const parsed = parseYouTubeUrl(raw)
    if (parsed && !seen.has(parsed.videoId)) {
      seen.add(parsed.videoId)
      results.push(parsed)
    }
  }

  return results
}

/**
 * Gizlilik korumalı (`youtube-nocookie.com`) hafif gömülü oynatıcı URL'si üretir.
 */
export function getYouTubeEmbedUrl(
  videoId: string,
  opts?: { autoplay?: boolean; startSeconds?: number },
): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  })
  if (opts?.autoplay) params.set('autoplay', '1')
  if (opts?.startSeconds && opts.startSeconds > 0) {
    params.set('start', String(Math.floor(opts.startSeconds)))
  }
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`
}

/**
 * YouTube küçük resim (thumbnail) adresini döndürür.
 */
export function getYouTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`
}
