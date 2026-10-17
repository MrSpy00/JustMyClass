import React, { useEffect, useState } from 'react'
import { ExternalLink, Play, X } from 'lucide-react'
import { getYouTubeEmbedUrl, getYouTubeThumbnailUrl } from '../lib/youtube'
import type { YouTubeMetadata } from '../../types/jmc'

const metadataCache = new Map<string, YouTubeMetadata>()

interface YouTubeInlineCardProps {
  videoId: string
  url: string
  startSeconds?: number
  defaultOpen?: boolean
  className?: string
}

export const YouTubeInlineCard: React.FC<YouTubeInlineCardProps> = ({
  videoId,
  url,
  startSeconds,
  defaultOpen = false,
  className = '',
}) => {
  const [isPlaying, setIsPlaying] = useState(defaultOpen)
  const [meta, setMeta] = useState<YouTubeMetadata | null>(() => metadataCache.get(videoId) ?? null)

  useEffect(() => {
    if (metadataCache.has(videoId)) {
      setMeta(metadataCache.get(videoId)!)
      return
    }

    let active = true
    window.jmcAPI?.getYouTubeMetadata?.(videoId).then(data => {
      if (active && data) {
        metadataCache.set(videoId, data)
        setMeta(data)
      }
    }).catch(() => {})

    return () => {
      active = false
    }
  }, [videoId])

  const handleOpenExternal = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    void window.jmcAPI?.openExternalUrl(url)
  }

  const title = meta?.title || `YouTube Videosu (${videoId})`
  const author = meta?.authorName || 'YouTube'
  const thumbnail = meta?.thumbnailUrl || getYouTubeThumbnailUrl(videoId)

  return (
    <div
      onClick={e => e.stopPropagation()}
      className={`my-2 block not-italic font-normal overflow-hidden rounded-xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] shadow-[var(--jmc-shadow-sm)] transition-all ${className}`}
    >
      {isPlaying ? (
        <div className="flex flex-col">
          <div className="relative aspect-video w-full bg-black">
            <iframe
              src={getYouTubeEmbedUrl(videoId, { autoplay: true, startSeconds })}
              title={title}
              className="absolute inset-0 h-full w-full border-0"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] bg-[var(--jmc-bg-surface)] border-t border-[var(--jmc-border-subtle)]">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-[var(--jmc-text)]">{title}</p>
              <p className="truncate text-[10px] text-[var(--jmc-text-dim)]">{author}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleOpenExternal}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium text-[var(--jmc-link)] hover:bg-[var(--jmc-bg)] transition-colors"
              >
                <span>Tarayıcıda Aç</span>
                <ExternalLink className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setIsPlaying(false)}
                title="Oynatıcıyı Kapat"
                className="inline-flex items-center gap-1 rounded-md bg-[var(--jmc-bg)] px-2 py-1 text-[10.5px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                <span>Kapat</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-2.5">
          {/* Küçük Resim ve Oynatma Butonu */}
          <button
            type="button"
            onClick={() => setIsPlaying(true)}
            className="group relative h-20 sm:h-16 w-full sm:w-28 shrink-0 overflow-hidden rounded-lg bg-black focus:outline-none focus:ring-0"
          >
            <img
              src={thumbnail}
              alt={title}
              loading="lazy"
              className="h-full w-full object-cover opacity-85 group-hover:scale-105 group-hover:opacity-100 transition-all duration-200"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/15 transition-colors">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff0033] text-white shadow-md group-hover:scale-110 transition-transform">
                <Play className="h-3.5 w-3.5 ml-0.5 fill-current" />
              </span>
            </span>
          </button>

          {/* Başlık ve Butonlar */}
          <div className="min-w-0 flex-1 flex flex-col justify-center gap-1">
            <span className="line-clamp-2 text-[12px] font-semibold leading-tight text-[var(--jmc-text)]">
              {title}
            </span>
            <span className="truncate text-[10.5px] text-[var(--jmc-text-dim)]">
              {author}
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlaying(true)}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--jmc-on-primary)] hover:bg-[var(--jmc-primary-hover)] transition-colors"
              >
                <Play className="h-3 w-3 fill-current" />
                <span>Uygulama İçinde İzle</span>
              </button>
              <button
                type="button"
                onClick={handleOpenExternal}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius-sm)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                <span>Tarayıcıda Aç</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
