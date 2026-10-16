/**
 * Birlesik saglayici + model secici.
 *
 * COZULEN SORUNLAR
 * ----------------
 * 1. "Alt alta iki model listesi var"
 *    Asistan panelinde Ayni `ai.model` etiketli IKAYNAK bir `<select>`
 *    vardi: biri `orderedModelList` (favoriler one) digeri ham liste.
 *    Kullanici ayni alan icin iki farkli kontrol goruyordu ve ikisi de
 *    calisiyordu; hangisinin gecerli oldugu belirsizdi.
 *
 * 2. "Bütün hepsinde aynı 2 ikon var"
 *    Rozetler duz metin olarak `<option>` icine yaziliyordu
 *    (`★ ◉ ⚡ ◆`). Duz metin oldugu icin ikon degil, karakter
 *    basilirdi; ayrica `orderedModelList` favorileri one aldigindan
 *    ikinci liste ham listeyi gosteriyor ve rozetler tutarsizdi.
 *
 * 3. "Favoriler listesi duvar"
 *    Favoriler, secicinin ALTINDA her model icin bir cip olarak
 *    seriliyordu. 40 model oldugunda panel 40 satir uzunluguna
 *    cokuyor ve asistanin geri kalani ekrandan tasiyordu.
 *
 * YENI YAPI
 * ---------
 * Tek bir kontrol. Tiklaninca acilan panelde:
 *   - Saglayici listesi (marka ikonuyla, anahtari olanlar en ustte,
 *     "Ayarlar" satirinda "anahtar ekle" yolu).
 *   - Alt menude o saglayicinin modelleri, ustte arama kutusu.
 *   - "Favoriler" ve "Tum modeller" gruplari AYRI, kucuk baslikli.
 *   - Her satir: model adi, yetenek ikonlari (SVG, emoji degil),
 *     ve tek tikla favorileme.
 *   - Tam klavye destegi: ↑ ↓ Home End Enter Escape Tab.
 *   - Disari tiklayinca kapanir, odak geri gelir.
 *
 * Duyarlilik: panel `w-full` oldugu icin sag panel daraltildiginda
 * da tek sutun kalir; genis panelde iki sutun (saglayici | model)
 * yan yana gosterilir.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Brain,
  Check,
  ChevronDown,
  Eye,
  KeyRound,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react'
import type { AiModel, AiProviderConfig } from '../../types/jmc'
import { ProviderIcon } from './icons/ProviderIcon'

interface ModelPickerProps {
  providers: AiProviderConfig[]
  providerId: string
  modelId: string
  onProviderChange: (providerId: string) => void
  onModelChange: (modelId: string) => void
  /** `providerId::modelId` seklinde favoriler. */
  favorites: string[]
  onToggleFavorite: (providerId: string, modelId: string) => void
  /** Manuel yenileme. Verilmezse buton gizlenir. */
  onRefreshModels?: () => Promise<unknown> | void
  refreshing?: boolean
  /** Anahtar eksikken cagriilir. */
  onOpenProviderSettings?: () => void
  emptyProviderLabel: string
  emptyModelLabel: string
}

const MODEL_LIMIT = 400

function formatContextWindow(tokens?: number): string | null {
  if (!tokens || tokens <= 0) return null
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`
  }
  return `${tokens}`
}

export function ModelPicker({
  providers,
  providerId,
  modelId,
  onProviderChange,
  onModelChange,
  favorites,
  onToggleFavorite,
  onRefreshModels,
  refreshing = false,
  onOpenProviderSettings,
  emptyProviderLabel,
  emptyModelLabel,
}: ModelPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const autoSyncedRef = useRef<Set<string>>(new Set())

  const [popoverPos, setPopoverPos] = useState<{
    top: number
    right: number
    width: number
    maxHeight: number
  }>({
    top: 0,
    right: 0,
    width: 600,
    maxHeight: 480,
  })

  const updatePopoverPos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const width = Math.min(620, Math.max(340, window.innerWidth - 24))
    let right = window.innerWidth - rect.right
    if (right + width > window.innerWidth - 12) {
      right = window.innerWidth - width - 12
    }
    if (right < 12) right = 12

    let top = rect.bottom + 6
    let maxHeight = window.innerHeight - top - 16
    if (maxHeight < 280 && rect.top > 300) {
      maxHeight = Math.min(480, rect.top - 16)
      top = rect.top - maxHeight - 6
    } else {
      maxHeight = Math.min(500, Math.max(260, maxHeight))
    }

    setPopoverPos({ top, right, width, maxHeight })
  }, [])

  const provider = useMemo(
    () => providers.find(p => p.id === providerId) ?? null,
    [providers, providerId],
  )
  const model = useMemo(
    () => provider?.models.find(m => m.id === modelId) ?? null,
    [provider, modelId],
  )

  const favoriteKey = useCallback(
    (id: string) => `${String(providerId)}::${id}`,
    [providerId],
  )
  const isFavorite = useCallback((id: string) => favorites.includes(favoriteKey(id)), [
    favorites,
    favoriteKey,
  ])

  // Filtrelenmis ve gruplanmis model listesi.
  const groups = useMemo(() => {
    const all = provider?.models ?? []
    const q = query.trim().toLowerCase()
    const matched = q
      ? all.filter(
          m =>
            m.name.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            favoriteKey(m.id).toLowerCase().includes(q),
        )
      : all
    const limited = matched.slice(0, MODEL_LIMIT)
    const favs = limited.filter(m => isFavorite(m.id))
    const rest = limited.filter(m => !isFavorite(m.id))
    const out: Array<{ key: string; title: string; items: AiModel[] }> = []
    if (favs.length) out.push({ key: 'fav', title: 'Favoriler', items: favs })
    if (rest.length) out.push({ key: 'all', title: favs.length ? 'Diğer modeller' : 'Modeller', items: rest })
    return out
  }, [provider, query, isFavorite, favoriteKey])

  /** Klavye imleci icin duz bir dizi (gruplar duzlestirilmis hali). */
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])

  useEffect(() => {
    if (!open) return
    setCursor(Math.max(0, flat.findIndex(m => m.id === modelId)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, providerId])

  // Panel acildiginda veya aktif saglayici degistiginde anahtar varsa modelleri otomatik sorgula.
  useEffect(() => {
    if (!open || !provider || !onRefreshModels || refreshing) return
    const usable = provider.hasKey || provider.isLocal
    if (!usable) return
    if (!autoSyncedRef.current.has(provider.id)) {
      autoSyncedRef.current.add(provider.id)
      void Promise.resolve(onRefreshModels()).catch(() => {})
    }
  }, [open, provider, onRefreshModels, refreshing])

  // Disari tik / Escape ile kapatma + odak geri donusu.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current && rootRef.current.contains(target)) return
      if (panelRef.current && panelRef.current.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  // Panel acildiginda konumu hesapla ve pencere boyutu degisirse guncelle.
  useEffect(() => {
    if (open) {
      updatePopoverPos()
      window.addEventListener('resize', updatePopoverPos)
      window.addEventListener('scroll', updatePopoverPos, true)
      return () => {
        window.removeEventListener('resize', updatePopoverPos)
        window.removeEventListener('scroll', updatePopoverPos, true)
      }
    }
    return undefined
  }, [open, updatePopoverPos])

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => searchRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [open])

  // Imleci gorunur alanda tut.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  const commit = useCallback(
    (id: string) => {
      onModelChange(id)
      setOpen(false)
      setQuery('')
      triggerRef.current?.focus()
    },
    [onModelChange],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setOpen(true)
        }
        return
      }
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          setOpen(false)
          setQuery('')
          triggerRef.current?.focus()
          break
        case 'ArrowDown':
          e.preventDefault()
          setCursor(i => (flat.length ? (i + 1) % flat.length : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setCursor(i => (flat.length ? (i - 1 + flat.length) % flat.length : 0))
          break
        case 'Home':
          e.preventDefault()
          setCursor(0)
          break
        case 'End':
          e.preventDefault()
          setCursor(Math.max(0, flat.length - 1))
          break
        case 'Enter': {
          e.preventDefault()
          const target = flat[cursor]
          if (target) commit(target.id)
          break
        }
        case 'Tab':
          // Odagi panelin icinde tut; disari cikinca kapat ve geri ver.
          if (e.shiftKey && document.activeElement === searchRef.current) {
            e.preventDefault()
          }
          break
        default:
          break
      }
    },
    [open, flat, cursor, commit],
  )

  const handleRefresh = useCallback(async () => {
    if (!onRefreshModels) return
    try {
      await onRefreshModels()
    } catch {
      /* yenileme hatasi ust katmanda gosterilir */
    }
  }, [onRefreshModels])

  const keyless = !!provider && !provider.isLocal && !provider.hasKey

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={onKeyDown}>
      {/* ---------------- TETIKLEYICI ---------------- */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Saglayici ve model sec"
        title={model ? `${provider?.displayName ?? ''} — ${model.name} (${model.id})` : 'Model seçin'}
        className="group flex w-full items-center gap-2.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] px-2.5 py-1.5 text-left shadow-[var(--jmc-shadow-sm)] transition-[border-color,box-shadow,background-color] duration-[var(--jmc-dur)] ease-[var(--jmc-ease)] hover:border-[var(--jmc-primary)]/45 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--jmc-primary)]"
      >
        {provider ? (
          <ProviderIcon
            brand={provider.brand}
            displayName={provider.displayName}
            size={22}
            className="shrink-0 rounded-[5px]"
          />
        ) : (
          <span
            className="h-5 w-5 shrink-0 rounded-[5px] bg-[var(--jmc-bg-elevated)] ring-1 ring-[var(--jmc-border)]"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[10px] leading-tight text-[var(--jmc-text-dim)]">
            <span className="truncate font-medium">{provider?.displayName ?? emptyProviderLabel}</span>
            {model?.contextWindow && (
              <span className="shrink-0 rounded bg-[var(--jmc-badge-bg)] px-1 py-0.2 font-mono text-[9px] text-[var(--jmc-text-muted)]">
                {formatContextWindow(model.contextWindow)}
              </span>
            )}
          </span>
          <span className="block break-words text-[11.5px] font-semibold leading-snug text-[var(--jmc-text)]">
            {model?.name ?? emptyModelLabel}
          </span>
        </span>
        {refreshing ? (
          <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin-slow text-[var(--jmc-primary)]" />
        ) : (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-[var(--jmc-text-dim)] transition-transform duration-[var(--jmc-dur)] ease-[var(--jmc-ease)] ${
              open ? 'rotate-180 text-[var(--jmc-primary)]' : ''
            }`}
          />
        )}
      </button>

      {/* ---------------- PANEL (Genis & Tam Isim Gorunumlu Portal) ---------------- */}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label="Saglayici ve model secimi"
            style={{
              position: 'fixed',
              top: `${popoverPos.top}px`,
              right: `${popoverPos.right}px`,
              width: `${popoverPos.width}px`,
              maxHeight: `${popoverPos.maxHeight}px`,
              zIndex: 99999,
            }}
            className="animate-pop-in flex flex-col overflow-hidden rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] shadow-[var(--jmc-shadow-xl)] backdrop-blur-2xl"
          >
            <div className="flex items-center gap-2 border-b border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)]/50 px-3 py-2">
            <Search
              className="h-3.5 w-3.5 shrink-0 text-[var(--jmc-text-dim)]"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setCursor(0)
              }}
              placeholder="Model adı veya teknik ID ile ara… (Esc kapatır)"
              aria-label="Model ara"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--jmc-text)] outline-none placeholder:text-[var(--jmc-text-dim)]"
            />
            {provider && (
              <span className="hidden rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-badge-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--jmc-text-muted)] sm:inline-block">
                {provider.models.length} model
              </span>
            )}
            {onRefreshModels && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Canlı model listesini şimdi sorgula"
                aria-label="Modelleri yenile"
                className="inline-flex shrink-0 items-center gap-1 rounded-[var(--jmc-radius-sm)] border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] px-2 py-1 text-[10.5px] font-medium text-[var(--jmc-text-muted)] transition-colors hover:border-[var(--jmc-primary)]/40 hover:text-[var(--jmc-text)] disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin-slow text-[var(--jmc-primary)]' : ''}`} />
                <span>{refreshing ? 'Sorgulanıyor…' : 'Yenile'}</span>
              </button>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
            {/* --- Saglayici sutunu --- */}
            <div
              className="w-full shrink-0 overflow-y-auto border-b border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]/35 p-1.5 sm:w-52 sm:border-b-0 sm:border-r"
              role="presentation"
            >
              {providers.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-[var(--jmc-text-dim)]">
                  {emptyProviderLabel}
                </p>
              ) : (
                providers.map(p => {
                  const active = p.id === providerId
                  const usable = p.hasKey || p.isLocal
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onProviderChange(p.id)
                        setCursor(0)
                        setQuery('')
                      }}
                      className={`mb-0.5 flex w-full items-center gap-2 rounded-[var(--jmc-radius-sm)] px-2 py-1.5 text-left transition-colors duration-[var(--jmc-dur)] ease-[var(--jmc-ease)] ${
                        active
                          ? 'bg-[var(--jmc-primary)]/14 text-[var(--jmc-text)] ring-1 ring-[var(--jmc-primary)]/30'
                          : 'text-[var(--jmc-text-muted)] hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)]'
                      }`}
                    >
                      <ProviderIcon
                        brand={p.brand}
                        displayName={p.displayName}
                        size={18}
                        glyphOnly
                        className="shrink-0 rounded-[4px]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[11.5px] font-medium leading-tight">
                          {p.displayName}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-[9.5px] leading-tight text-[var(--jmc-text-dim)]">
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                              usable ? 'bg-[var(--jmc-success)]' : 'bg-[var(--jmc-text-dim)]/50'
                            }`}
                          />
                          {p.isLocal ? 'Yerel uç nokta' : usable ? `${p.models.length} model hazır` : 'Anahtar girilmedi'}
                        </span>
                      </span>
                      {active && (
                        <Check
                          className="h-3.5 w-3.5 shrink-0 text-[var(--jmc-primary)]"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  )
                })
              )}
              {onOpenProviderSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onOpenProviderSettings()
                  }}
                  className="mt-1.5 flex w-full items-center gap-1.5 rounded-[var(--jmc-radius-sm)] border border-dashed border-[var(--jmc-border)] px-2 py-1.5 text-left text-[11px] font-medium text-[var(--jmc-text-muted)] transition-colors hover:border-[var(--jmc-primary)]/45 hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-primary)]"
                >
                  <KeyRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Anahtar ekle / yönet
                </button>
              )}
            </div>

            {/* --- Model sutunu (Tam isim ve ID gosterimi, kesme yok) --- */}
            <div ref={listRef} className="min-w-0 flex-1 overflow-y-auto p-1.5" role="presentation">
              {keyless && (
                <div className="animate-fade-in mb-2 flex items-center justify-between gap-2 rounded-[var(--jmc-radius-sm)] border border-[var(--jmc-warning)]/35 bg-[var(--jmc-warning)]/10 px-2.5 py-2 text-[11px] leading-snug text-[var(--jmc-warning)]">
                  <span>
                    <strong className="font-semibold">{provider?.displayName}</strong> için API anahtarı girilmedi. Anahtar eklediğinizde canlı modeller otomatik çekilir.
                  </span>
                  {onOpenProviderSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onOpenProviderSettings()
                      }}
                      className="shrink-0 rounded bg-[var(--jmc-warning)]/20 px-2 py-1 text-[10px] font-semibold text-[var(--jmc-warning)] hover:bg-[var(--jmc-warning)]/30"
                    >
                      Anahtar Gir
                    </button>
                  )}
                </div>
              )}
              {flat.length === 0 ? (
                <p className="px-2.5 py-4 text-[11px] text-[var(--jmc-text-dim)]">
                  {query.trim() ? 'Eşleşen model bulunamadı.' : emptyModelLabel}
                </p>
              ) : (
                groups.map(group => (
                  <div key={group.key} className="mb-2 last:mb-0">
                    <p className="px-2 pb-1 pt-1 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[var(--jmc-text-dim)]">
                      {group.title}
                      <span className="ml-1.5 rounded bg-[var(--jmc-badge-bg)] px-1.5 py-0.2 font-normal normal-case tracking-normal text-[var(--jmc-text-muted)]">
                        {group.items.length}
                      </span>
                    </p>
                    {group.items.map(m => {
                      const idx = flat.indexOf(m)
                      const active = m.id === modelId
                      const fav = isFavorite(m.id)
                      const ctxBadge = formatContextWindow(m.contextWindow)
                      return (
                        <div
                          key={m.id}
                          data-idx={idx}
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setCursor(idx)}
                          onClick={() => commit(m.id)}
                          className={`mb-0.5 flex cursor-pointer items-start gap-2.5 rounded-[var(--jmc-radius-sm)] px-2 py-1.5 transition-[background-color,color] duration-[var(--jmc-dur)] ease-[var(--jmc-ease)] ${
                            active
                              ? 'bg-[var(--jmc-primary)]/12 text-[var(--jmc-text)] ring-1 ring-[var(--jmc-primary)]/45'
                              : cursor === idx
                                ? 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text)]'
                                : 'text-[var(--jmc-text-muted)] hover:bg-[var(--jmc-bg-surface)]/70'
                          }`}
                        >
                          <span className="mt-0.5 flex w-3.5 shrink-0 justify-center">
                            {active && (
                              <Check
                                className="h-3.5 w-3.5 text-[var(--jmc-primary)]"
                                aria-hidden="true"
                              />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="block break-words text-[12px] font-medium leading-snug text-[var(--jmc-text)]">
                                {m.name}
                              </span>
                              {m.isDefault && (
                                <span
                                  title="Sağlayıcının varsayılan ve önerilen modeli"
                                  className="inline-flex items-center gap-0.5 rounded bg-[var(--jmc-primary)]/15 px-1.5 py-0.2 text-[9.5px] font-semibold text-[var(--jmc-primary)] border border-[var(--jmc-primary)]/25"
                                >
                                  <Sparkles className="h-2.5 w-2.5" />
                                  <span>Önerilen</span>
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block break-all font-mono text-[10px] leading-snug text-[var(--jmc-text-dim)]">
                              {m.id}
                            </span>
                          </span>
                          <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
                            {ctxBadge && (
                              <span
                                title={`Bağlam penceresi: ${m.contextWindow?.toLocaleString('tr-TR')} token`}
                                className="rounded bg-[var(--jmc-badge-bg)] px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-[var(--jmc-text-muted)]"
                              >
                                {ctxBadge}
                              </span>
                            )}
                            {m.supportsReasoning && (
                              <span title="Akıl yürütme (Reasoning)" aria-label="Akıl yürütme destekler">
                                <Brain className="h-3.5 w-3.5 text-[var(--jmc-accent)]" aria-hidden="true" />
                              </span>
                            )}
                            {m.supportsTools && (
                              <span title="Araç çağırma (Tool Calling)" aria-label="Araç çağırma destekler">
                                <Zap className="h-3.5 w-3.5 text-[var(--jmc-success)]" aria-hidden="true" />
                              </span>
                            )}
                            {m.supportsVision && (
                              <span title="Görsel / PDF girdisi (Vision)" aria-label="Görsel destekler">
                                <Eye className="h-3.5 w-3.5 text-[var(--jmc-warning)]" aria-hidden="true" />
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={ev => {
                              ev.stopPropagation()
                              onToggleFavorite(String(providerId), m.id)
                            }}
                            aria-pressed={fav}
                            aria-label={fav ? `${m.name} favorilerden çıkar` : `${m.name} favorilere ekle`}
                            title={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                            className={`mt-0.5 shrink-0 rounded p-0.5 transition-[color,background-color,transform] duration-[var(--jmc-dur)] ease-[var(--jmc-ease)] hover:scale-110 active:scale-90 ${
                              fav
                                ? 'text-[var(--jmc-warning)]'
                                : 'text-[var(--jmc-text-dim)] hover:text-[var(--jmc-warning)]'
                            }`}
                          >
                            <Star className={`h-3.5 w-3.5 ${fav ? 'fill-current' : ''}`} aria-hidden="true" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default ModelPicker