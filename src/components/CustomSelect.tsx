import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface CustomSelectOption<T extends string | number = string> {
  value: T
  label: string
  description?: string
  badge?: string
  icon?: React.ReactNode
}

interface CustomSelectProps<T extends string | number = string> {
  value: T
  options: CustomSelectOption<T>[]
  onChange: (value: T) => void
  label?: string
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  align?: 'left' | 'right'
  className?: string
  minMenuWidth?: number
  ariaLabel?: string
}

interface MenuPosition {
  top: number
  left: number
  width: number
  /** Menü yüksekliği: aşağı açılacaksa `down`, yukarı açılacaksa `up`. */
  placement: 'down' | 'up'
  maxHeight: number
}

const VIEWPORT_MARGIN = 8
const MAX_MENU_HEIGHT = 288 // max-h-72

/**
 * Modern, animasyonlu ve klavye erisilebilir ozel acilir menu (dropdown) bileseni.
 *
 * Yerel `<select>` elemanlarinin demode isletim sistemi gorunumunu kaldirir;
 * uygulamanin aktif temasina (16 tema) tam uyum saglar, rozet ve alt aciklama
 * satirlarini destekler.
 *
 * PORTAL + `position: fixed` NEDEN?
 * ----------------------------------
 * Onceki surum menuyu `absolute` konumlandirip DOM icinde, tetikleyicinin hemen
 * altinda basiyordu. `SetupWizard` ve `SettingsModal` gibi ekranlarda tum panel
 * `overflow-y-auto` icinde oldugu icin menu "kesiliyordu": secenek listesinin
 * alt yarisi gorunmez kaliyor, ust kismi kaydirilabilir bir kapsayicinin
 * disinda kalinca z-index de ise yaramiyordu. Cozum: menu `document.body`
 * uzerine `createPortal` ile tasinir ve tetikleyicinin `getBoundingClientRect()`
 * degerine gore `position: fixed` ile konumlandirilir. Boylece hicbir atas
 * `overflow`/`transform` degeri menuyu kirpamaz.
 */
export function CustomSelect<T extends string | number = string>({
  value,
  options,
  onChange,
  placeholder = 'Seçin…',
  disabled = false,
  size = 'md',
  align = 'left',
  className = '',
  minMenuWidth = 240,
  ariaLabel,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const selectedOption = options.find(opt => opt.value === value) ?? options[0]

  const close = useCallback(() => {
    setOpen(false)
    setPosition(null)
  }, [])

  /** Tetikleyicinin ekrandaki dikdortgenini menunun yerlesimi icin cevirir. */
  const computePosition = useCallback((): MenuPosition | null => {
    const trigger = rootRef.current
    if (!trigger) return null
    const rect = trigger.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Yukaridan/tasindan az yer varsa asagi, yoksa yukaracagiz.
    const spaceBelow = vh - rect.bottom - VIEWPORT_MARGIN
    const spaceAbove = rect.top - VIEWPORT_MARGIN
    const placement: 'down' | 'up' = spaceBelow >= MAX_MENU_HEIGHT || spaceBelow >= spaceAbove ? 'down' : 'up'
    const available = placement === 'down' ? spaceBelow : spaceAbove

    // Tercih edilen minimum genislik, tetikleyicinin genisligi ve ekran
    // boslugu arasindaki en buyugu; hicbiri sigmiyorsa ekrana gore kisaltilir.
    const width = Math.min(Math.max(minMenuWidth, rect.width), Math.max(vw - VIEWPORT_MARGIN * 2, 120))

    let left = align === 'right' ? rect.right - width : rect.left
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(vw - width - VIEWPORT_MARGIN, VIEWPORT_MARGIN))

    // Ust cubukta acilmasina izin ver: ekranin ustune birkac piksel tasarabilir.
    const top = placement === 'down' ? rect.bottom + 6 : Math.max(VIEWPORT_MARGIN, rect.top - Math.min(MAX_MENU_HEIGHT, available) - 6)

    return {
      top,
      left,
      width,
      placement,
      maxHeight: Math.max(Math.min(MAX_MENU_HEIGHT, available), 96),
    }
  }, [align, minMenuWidth])

  // Konumu, menu cizilmeden HEN once hesapla (ilk karede yanlis yerde belirmesin).
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    setPosition(computePosition())
  }, [open, computePosition])

  useEffect(() => {
    if (!open) return
    const currentIdx = options.findIndex(opt => opt.value === value)
    setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0)

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      // Menu portal ile body'se tasindigi icin ayrica menunun kendisini de kontrol et.
      if (menuRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlightedIndex(prev => (prev + 1) % Math.max(options.length, 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlightedIndex(prev => (prev - 1 + Math.max(options.length, 1)) % Math.max(options.length, 1))
      } else if (event.key === 'Enter' && highlightedIndex >= 0 && options[highlightedIndex]) {
        event.preventDefault()
        onChange(options[highlightedIndex].value)
        close()
      } else if (event.key === 'Tab') {
        close()
      }
    }
    // Kaydirma ve boyut degisince yeniden konumlandir: panel kaydirilirsa menu
    // tetikleyicinin altinda kalmaya devam etsin.
    const reposition = () => setPosition(computePosition())

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, options, value, highlightedIndex, onChange, close, computePosition])

  const isSmall = size === 'sm'

  const menu =
    open && position && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            style={{
              position: 'fixed',
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
              maxHeight: `${position.maxHeight}px`,
              // Kayan ust cubuk (modal basligi gibi) altinda kalmasin diye yuksek z-index.
              zIndex: 9999,
            }}
            className="animate-pop-in overflow-y-auto overscroll-contain rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-1.5 shadow-[var(--jmc-shadow-lg)] backdrop-blur-xl"
          >
            {options.length === 0 ? (
              <p className="px-3 py-2 text-[11.5px] text-[var(--jmc-text-dim)]">Seçenek bulunmuyor.</p>
            ) : (
              options.map((opt, idx) => {
                const isSelected = opt.value === value
                const isHighlighted = idx === highlightedIndex
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onClick={() => {
                      onChange(opt.value)
                      close()
                    }}
                    className={`flex w-full items-start justify-between gap-3 rounded-[var(--jmc-radius-sm)] px-3 py-2 text-left transition-all duration-100 ${
                      isSelected
                        ? 'bg-[var(--jmc-primary)]/14 text-[var(--jmc-text)] ring-1 ring-[var(--jmc-primary)]/35'
                        : isHighlighted
                          ? 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text)]'
                          : 'text-[var(--jmc-text-muted)] hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)]'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      {opt.icon && (
                        <span
                          className={`mt-0.5 shrink-0 ${
                            isSelected ? 'text-[var(--jmc-primary-text)]' : 'text-[var(--jmc-text-dim)]'
                          }`}
                        >
                          {opt.icon}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-xs leading-snug ${
                              isSelected ? 'font-semibold text-[var(--jmc-text)]' : 'font-medium'
                            }`}
                          >
                            {opt.label}
                          </span>
                          {opt.badge && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                isSelected
                                  ? 'bg-[var(--jmc-primary)] text-[var(--jmc-on-primary)]'
                                  : 'bg-[var(--jmc-badge-bg)] text-[var(--jmc-text-dim)]'
                              }`}
                            >
                              {opt.badge}
                            </span>
                          )}
                        </div>
                        {opt.description && (
                          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
                            {opt.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Secili onay ikonu SVG */}
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {isSelected && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                          className="text-[var(--jmc-primary-text)]"
                        >
                          <path
                            d="M3.5 8.5L6.5 11.5L12.5 4.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  </button>
                )
              })
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <div ref={rootRef} className={`relative inline-block ${className}`}>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={ariaLabel}
          onClick={() => !disabled && setOpen(prev => !prev)}
          className={`group flex w-full items-center justify-between gap-2.5 rounded-[var(--jmc-radius)] border transition-all duration-[var(--jmc-dur)] ease-[var(--jmc-ease)] select-none ${
            isSmall ? 'px-2.5 py-1.5 text-[11.5px]' : 'px-3.5 py-2 text-xs'
          } ${
            open
              ? 'border-[var(--jmc-primary)] bg-[var(--jmc-bg-surface)] text-[var(--jmc-text)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--jmc-primary)_16%,transparent)]'
              : 'border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] text-[var(--jmc-text)] hover:border-[var(--jmc-primary)]/45 hover:bg-[var(--jmc-bg-elevated)]'
          } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedOption?.icon && (
              <span className="shrink-0 text-[var(--jmc-primary-text)]">{selectedOption.icon}</span>
            )}
            <span className="truncate font-medium">
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            {selectedOption?.badge && (
              <span className="shrink-0 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-primary)]/14 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--jmc-primary-text)]">
                {selectedOption.badge}
              </span>
            )}
          </span>

          {/* Özel animasyonlu ok SVG */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={`shrink-0 text-[var(--jmc-text-muted)] transition-transform duration-200 group-hover:text-[var(--jmc-text)] ${
              open ? 'rotate-180 text-[var(--jmc-primary-text)]' : ''
            }`}
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {menu}
    </>
  )
}
export default CustomSelect