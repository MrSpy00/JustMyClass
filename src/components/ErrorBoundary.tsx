import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleReset = () => {
    try {
      localStorage.removeItem('jmc_theme')
      localStorage.removeItem('jmc_custom_theme')
    } catch {
      /* ignore */
    }
    window.location.reload()
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-[#0d0817]/95 backdrop-blur-md p-6 text-[#f2eafb] font-sans pointer-events-auto">
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-purple-900/40 bg-[#150e26] p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/10 border border-rose-500/20">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-white">
                  {this.props.fallbackTitle || 'Beklenmeyen bir arayüz hatası oluştu'}
                </h1>
                <p className="text-xs text-purple-300/70">
                  Uygulama güvenli bir biçimde durduruldu.
                </p>
              </div>
            </div>

            {this.state.error && (
              <div className="mt-4 rounded-lg bg-[#080512] p-3 font-mono text-xs text-rose-300/90 border border-purple-950 overflow-x-auto max-h-36">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem('jmc_theme')
                    localStorage.removeItem('jmc_custom_theme')
                  } catch {
                    /* ignore */
                  }
                  window.location.reload()
                }}
                className="cursor-pointer relative z-20 inline-flex items-center gap-1.5 rounded-lg border border-purple-900/50 bg-purple-950/40 px-3.5 py-2 text-xs font-medium text-purple-200 transition-colors hover:bg-purple-900/50 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Ayarları Sıfırla ve Yenile
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="cursor-pointer relative z-20 inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-purple-600/30 transition-all hover:bg-purple-500 active:scale-95"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Yeniden Başlat
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
