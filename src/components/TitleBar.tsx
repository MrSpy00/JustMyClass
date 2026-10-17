import React, { useEffect, useState, useCallback } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!window.jmcAPI) return
    window.jmcAPI.windowIsMaximized?.().then(max => {
      setIsMaximized(Boolean(max))
    }).catch(() => {})

    const unsubscribe = window.jmcAPI.onWindowMaximizedChange?.(max => {
      setIsMaximized(Boolean(max))
    })
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const handleMinimize = useCallback(() => {
    window.jmcAPI?.windowMinimize?.()
  }, [])

  const handleMaximize = useCallback(() => {
    window.jmcAPI?.windowMaximize?.().then(max => {
      setIsMaximized(Boolean(max))
    }).catch(() => {})
  }, [])

  const handleClose = useCallback(() => {
    window.jmcAPI?.windowClose?.()
  }, [])

  return (
    <header
      className="flex h-[34px] w-full shrink-0 select-none items-center justify-between border-b border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)] text-[var(--jmc-text)]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={handleMaximize}
    >
      {/* Sol: Logo ve Uygulama Başlığı */}
      <div
        className="flex items-center gap-2 px-3 text-xs font-semibold tracking-wide"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex h-5 w-5 items-center justify-center rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-badge-bg)] text-[var(--jmc-primary-text)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
            <path d="M6 12v5c3 3 9 3 12 0v-5" />
          </svg>
        </div>
        <span className="font-semibold text-[var(--jmc-text)]">JustMyClass</span>
        <span className="rounded bg-[var(--jmc-bg-surface)] px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-[var(--jmc-text-dim)] border border-[var(--jmc-border-subtle)]">
          v0.0.1
        </span>
      </div>

      {/* Orta: Sürükleme alanı (Tüm pencere taşınabilir) */}
      <div className="flex-1 h-full cursor-default" />

      {/* Sağ: Özel Pencere Kontrol Düğmeleri */}
      <div
        className="flex h-full items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={handleMinimize}
          title="Simge durumuna küçült"
          aria-label="Simge durumuna küçült"
          className="inline-flex h-[34px] w-11 items-center justify-center text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)] active:bg-[var(--jmc-bg-elevated)]"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={handleMaximize}
          title={isMaximized ? 'Önceki boyuta getir' : 'Ekranı kapla'}
          aria-label={isMaximized ? 'Önceki boyuta getir' : 'Ekranı kapla'}
          className="inline-flex h-[34px] w-11 items-center justify-center text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)] active:bg-[var(--jmc-bg-elevated)]"
        >
          {isMaximized ? (
            <Copy className="h-3 w-3 rotate-180" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>

        <button
          type="button"
          onClick={handleClose}
          title="Kapat"
          aria-label="Kapat"
          className="inline-flex h-[34px] w-11 items-center justify-center text-[var(--jmc-text-dim)] transition-colors hover:bg-[#e81123] hover:text-white active:bg-[#c4101f]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
