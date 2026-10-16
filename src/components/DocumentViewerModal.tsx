import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  X,
  Sparkles,
  Copy,
  Check,
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  Search,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  FileCode,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  Presentation,
  BookOpen,
  WrapText,
  Eye,
  Code,
  Layers,
  AlertCircle,
  Loader2,
  Folder,
  FolderOpen,
  Link,
} from 'lucide-react'
import type { Attachment, FilePreviewResult } from '../../types/jmc'
import { MarkdownView } from './MarkdownView'

interface DocumentViewerModalProps {
  attachment: Attachment | null
  courseId?: string
  isOpen: boolean
  onClose: () => void
  onSendToAssistant?: (preview: FilePreviewResult) => void
  onNotify?: (type: 'success' | 'error' | 'info', message: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function DocumentViewerModal({
  attachment,
  courseId = '',
  isOpen,
  onClose,
  onSendToAssistant,
  onNotify,
}: DocumentViewerModalProps): React.ReactElement | null {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<FilePreviewResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)

  // Alt kontroller
  const [codeWrap, setCodeWrap] = useState(true)
  const [fontSize, setFontSize] = useState<number>(13)
  const [searchQuery, setSearchQuery] = useState('')
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'raw'>('preview')
  const [pdfMode, setPdfMode] = useState<'embed' | 'text'>('embed')
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const [imageZoom, setImageZoom] = useState(1)
  const [imageRotation, setImageRotation] = useState(0)

  const [downloading, setDownloading] = useState(false)
  const [downloadedPath, setDownloadedPath] = useState<string | undefined>(
    attachment?.downloadedPath || attachment?.localPath,
  )
  const [linkCopied, setLinkCopied] = useState(false)

  const contentRef = useRef<HTMLDivElement | null>(null)

  // Dosya önizlemesini yukle
  const loadPreview = useCallback(async () => {
    if (!attachment) return
    setLoading(true)
    setError(null)
    try {
      const res = await window.jmcAPI.getFilePreview(attachment, courseId)
      setPreview(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya önizlemesi yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [attachment, courseId])

  useEffect(() => {
    let cancelled = false
    if (isOpen && attachment) {
      void loadPreview()
      setActiveSlideIndex(0)
      setImageZoom(1)
      setImageRotation(0)
      setSearchQuery('')
      setDownloadedPath(attachment.downloadedPath || attachment.localPath)

      // Disk üzerindeki indirilenler klasöründe dosya var mı kontrol et
      if (window.jmcAPI?.checkDownloadedFile) {
        window.jmcAPI
          .checkDownloadedFile(attachment)
          .then(res => {
            if (!cancelled && res.exists && res.filePath) {
              setDownloadedPath(res.filePath)
            }
          })
          .catch(() => undefined)
      }
    } else {
      setPreview(null)
      setError(null)
      setDownloadedPath(undefined)
    }
    return () => {
      cancelled = true
    }
  }, [isOpen, attachment, loadPreview])

  // ESC ile kapatma
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  // Metin kopyalama
  const handleCopy = useCallback(async () => {
    if (!preview?.text) return
    try {
      await window.jmcAPI.copyText(preview.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      onNotify?.('success', 'İçerik panoya kopyalandı.')
    } catch {
      onNotify?.('error', 'Kopyalama başarısız.')
    }
  }, [preview, onNotify])

  // Google Classroom bağlantısını kopyala
  const handleCopyLink = useCallback(async () => {
    if (!attachment?.alternateLink) return
    try {
      await window.jmcAPI.copyText(attachment.alternateLink)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
      onNotify?.('success', 'Classroom bağlantısı panoya kopyalandı.')
    } catch {
      onNotify?.('error', 'Bağlantı kopyalanamadı.')
    }
  }, [attachment?.alternateLink, onNotify])

  // Doğrudan İndir (İndirilenler Klasörüne)
  const handleDirectDownload = useCallback(async () => {
    if (!attachment) return
    setDownloading(true)
    try {
      const updated = await window.jmcAPI.downloadAttachment(attachment, courseId)
      const finalPath = updated.downloadedPath || updated.localPath
      setDownloadedPath(finalPath)
      onNotify?.(
        'success',
        `Dosya başarıyla indirildi: ${finalPath || updated.title}`,
      )
    } catch (err) {
      onNotify?.('error', `İndirme hatası: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [attachment, courseId, onNotify])

  // İndirilen Dosyayı Aç
  const handleOpenFile = useCallback(async () => {
    const target = downloadedPath || preview?.localPath
    if (!target) return
    try {
      await window.jmcAPI.openPath(target)
    } catch {
      void window.jmcAPI.openLocalFile(target)
    }
  }, [downloadedPath, preview?.localPath])

  // İndirilen Dosyayı Klasörde Göster
  const handleShowInFolder = useCallback(async () => {
    const target = downloadedPath || preview?.localPath
    try {
      if (target) {
        await window.jmcAPI.showItemInFolder(target)
      } else if (window.jmcAPI?.openDownloadsFolder) {
        await window.jmcAPI.openDownloadsFolder()
      }
    } catch {
      onNotify?.('error', 'Klasör açılamadı.')
    }
  }, [downloadedPath, preview?.localPath, onNotify])

  // Farklı Kaydet / Dışa Aktar
  const handleSaveAs = useCallback(async () => {
    if (!preview) return
    try {
      const res = await window.jmcAPI.saveFileAs(preview.fileId, preview.title)
      if (res.success && res.filePath) {
        onNotify?.('success', `Dosya kaydedildi: ${res.filePath}`)
      }
    } catch (err) {
      onNotify?.('error', `Kaydetme hatası: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [preview, onNotify])

  // Sistem uygulamasında aç
  const handleOpenLocal = useCallback(() => {
    if (!preview?.localPath) return
    void window.jmcAPI.openLocalFile(preview.localPath)
  }, [preview])

  // Asistan ile incele
  const handleAnalyzeWithAssistant = useCallback(() => {
    if (!preview) return
    if (onSendToAssistant) {
      onSendToAssistant(preview)
      onClose()
    }
  }, [preview, onSendToAssistant, onClose])

  // Kod satirlari ve arama
  const codeLines = useMemo(() => {
    if (!preview?.text || (preview.kind !== 'code' && preview.kind !== 'text' && preview.kind !== 'markdown')) {
      return []
    }
    return preview.text.split('\n')
  }, [preview])

  const filteredLines = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    return codeLines.map((line, idx) => ({
      line,
      idx: idx + 1,
      match: line.toLowerCase().includes(q),
    }))
  }, [codeLines, searchQuery])

  // Tablo verisi ve filtreleme
  const filteredTableData = useMemo(() => {
    if (!preview?.tableData || preview.tableData.length === 0) return []
    if (!searchQuery.trim()) return preview.tableData
    const q = searchQuery.toLowerCase()
    const header = preview.tableData[0]
    const rows = preview.tableData.slice(1).filter(row =>
      row.some(cell => cell.toLowerCase().includes(q)),
    )
    return [header, ...rows]
  }, [preview, searchQuery])

  if (!isOpen) return null

  const getKindIcon = (kind?: string) => {
    switch (kind) {
      case 'code':
        return <FileCode className="h-5 w-5 text-indigo-400" />
      case 'markdown':
        return <BookOpen className="h-5 w-5 text-sky-400" />
      case 'pdf':
        return <FileText className="h-5 w-5 text-rose-500" />
      case 'docx':
        return <FileText className="h-5 w-5 text-blue-500" />
      case 'pptx':
        return <Presentation className="h-5 w-5 text-amber-500" />
      case 'csv':
      case 'xlsx':
        return <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
      case 'image':
        return <FileImage className="h-5 w-5 text-purple-400" />
      case 'media':
        return <FileVideo className="h-5 w-5 text-cyan-400" />
      default:
        return <FileText className="h-5 w-5 text-[var(--jmc-primary)]" />
    }
  }

  if (!isOpen || !attachment) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment?.title || 'Dosya Önizlemesi'}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md transition-all animate-fade-in"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`flex flex-col overflow-hidden rounded-[var(--jmc-radius-xl)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] shadow-[var(--jmc-shadow-xl)] transition-all ${
          isFullScreen ? 'h-[98vh] w-[98vw]' : 'h-[88vh] w-[92vw] max-w-6xl'
        }`}
      >
        {/* ================= ÜST BAŞLIK & EYLEM ÇUBUĞU ================= */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)]/60 px-4 py-3">
          {/* Sol: İkon, Başlık, Rozetler */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--jmc-bg)] border border-[var(--jmc-border-subtle)] shadow-xs">
              {getKindIcon(preview?.kind)}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[14px] font-semibold text-[var(--jmc-text)]">
                  {preview?.title || attachment?.title || 'Dosya'}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-[var(--jmc-text-dim)]">
                {preview?.language && (
                  <span className="rounded bg-indigo-500/15 px-1.5 py-0.2 font-mono font-medium text-indigo-400 uppercase">
                    {preview.language}
                  </span>
                )}
                {preview?.kind && (
                  <span className="rounded bg-[var(--jmc-bg-surface)] px-1.5 py-0.2 font-medium text-[var(--jmc-text-muted)] border border-[var(--jmc-border-subtle)]">
                    {preview.kind.toUpperCase()}
                  </span>
                )}
                {preview?.sizeBytes !== undefined && (
                  <span>• {formatBytes(preview.sizeBytes)}</span>
                )}
                {preview?.lineCount !== undefined && (
                  <span>• {preview.lineCount} satır</span>
                )}
                {preview?.slides !== undefined && (
                  <span>• {preview.slides.length} slayt</span>
                )}
              </div>
            </div>
          </div>

          {/* Sağ: Eylemler */}
          <div className="flex shrink-0 items-center gap-2">
            {/* ASİSTAN İLE İNCELE (Ana Aksiyon Butonu) */}
            {onSendToAssistant && preview && (preview.text || preview.slides || preview.tableData) && (
              <button
                type="button"
                onClick={handleAnalyzeWithAssistant}
                title="Bu dosyayı yapay zekâ asistanına gönder ve soru sor / analiz ettir"
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-md hover:opacity-95 active:scale-95 transition-all"
              >
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                <span>Asistan ile İncele</span>
              </button>
            )}

            {/* Metin Kopyala */}
            {preview?.text && (
              <button
                type="button"
                onClick={handleCopy}
                title="Metni Kopyala"
                className="inline-flex items-center gap-1 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] transition-all"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-semibold">Kopyalandı</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Kopyala</span>
                  </>
                )}
              </button>
            )}

            {/* Bağlantıyı Kopyala */}
            {attachment?.alternateLink && (
              <button
                type="button"
                onClick={handleCopyLink}
                title="Google Classroom Bağlantısını Kopyala"
                className="inline-flex items-center gap-1 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] transition-colors"
              >
                {linkCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-semibold">Bağlantı Alındı</span>
                  </>
                ) : (
                  <>
                    <Link className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Bağlantı</span>
                  </>
                )}
              </button>
            )}

            {/* Akıllı İndirme ve Açma Butonları (Morphing) */}
            {downloadedPath || preview?.localPath ? (
              <>
                <button
                  type="button"
                  onClick={handleOpenFile}
                  title="İndirilen Dosyayı Sistem Uygulamasıyla Aç"
                  className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[11.5px] font-semibold text-emerald-400 hover:bg-emerald-500/25 active:scale-95 transition-all shadow-sm"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Dosyayı Aç</span>
                </button>

                <button
                  type="button"
                  onClick={handleShowInFolder}
                  title="Dosyayı İndirilenler Klasöründe Göster"
                  className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] active:scale-95 transition-all"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Klasörde Göster</span>
                </button>

                <button
                  type="button"
                  onClick={handleDirectDownload}
                  disabled={downloading}
                  title="Yeniden İndir / Güncelle"
                  className="inline-flex items-center gap-1 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2 py-1.5 text-[11px] font-medium text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] transition-colors disabled:opacity-50"
                >
                  {downloading ? (
                    <Loader2 className="h-3 w-3 animate-spin text-[var(--jmc-primary)]" />
                  ) : (
                    <RotateCw className="h-3 w-3" />
                  )}
                  <span className="hidden lg:inline">Yeniden İndir</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleDirectDownload}
                disabled={downloading}
                title="İndirilenler klasörüne doğrudan kaydet"
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm transition-all hover:bg-[var(--jmc-primary-hover)] active:scale-95 disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>{downloading ? 'İndiriliyor...' : 'Dosyayı İndir'}</span>
              </button>
            )}

            {/* Farklı Kaydet */}
            <button
              type="button"
              onClick={handleSaveAs}
              title="Bilgisayarda İstediğiniz Konuma Farklı Kaydet"
              className="inline-flex items-center gap-1 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2 py-1.5 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Farklı Kaydet</span>
            </button>

            {/* Tam Ekran Toggle */}
            <button
              type="button"
              onClick={() => setIsFullScreen(prev => !prev)}
              title={isFullScreen ? 'Küçült' : 'Tam Ekran'}
              className="rounded p-1.5 text-[var(--jmc-text-dim)] hover:bg-[var(--jmc-bg)] hover:text-[var(--jmc-text)] transition-colors"
            >
              {isFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>

            {/* Kapat */}
            <button
              type="button"
              onClick={onClose}
              title="Kapat (Esc)"
              className="rounded p-1.5 text-[var(--jmc-text-dim)] hover:bg-rose-500/15 hover:text-rose-400 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* ================= İKİNCİL ARAÇ ÇUBUĞU (Bağlama Göre) ================= */}
        {preview && !loading && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]/40 px-4 py-2 text-[11.5px]">
            {/* Kod veya Metin Dosyası Kontrolleri */}
            {(preview.kind === 'code' || preview.kind === 'text') && (
              <>
                <div className="flex items-center gap-2 flex-1 max-w-sm">
                  <div className="relative w-full">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Dosya içinde ara…"
                      className="w-full rounded bg-[var(--jmc-bg-surface)] py-1 pl-8 pr-3 text-[11.5px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[var(--jmc-text-muted)]">
                  <button
                    type="button"
                    onClick={() => setCodeWrap(prev => !prev)}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                      codeWrap ? 'bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)] font-semibold' : 'hover:text-[var(--jmc-text)]'
                    }`}
                  >
                    <WrapText className="h-3.5 w-3.5" />
                    <span>Kaydır</span>
                  </button>

                  <div className="flex items-center gap-1 border-l border-[var(--jmc-border)] pl-2">
                    <button
                      type="button"
                      onClick={() => setFontSize(s => Math.max(10, s - 1))}
                      className="rounded px-1.5 py-0.5 hover:bg-[var(--jmc-bg-surface)] text-[11px]"
                      title="Yazı boyutunu küçült"
                    >
                      A-
                    </button>
                    <span className="font-mono text-[10.5px]">{fontSize}px</span>
                    <button
                      type="button"
                      onClick={() => setFontSize(s => Math.min(20, s + 1))}
                      className="rounded px-1.5 py-0.5 hover:bg-[var(--jmc-bg-surface)] text-[11px]"
                      title="Yazı boyutunu büyüt"
                    >
                      A+
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Markdown Mod Değiştirici */}
            {preview.kind === 'markdown' && (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center rounded bg-[var(--jmc-bg-surface)] p-0.5 border border-[var(--jmc-border)]">
                  <button
                    type="button"
                    onClick={() => setMarkdownMode('preview')}
                    className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                      markdownMode === 'preview'
                        ? 'bg-[var(--jmc-primary)] text-white shadow-xs'
                        : 'text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>Önizleme</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMarkdownMode('raw')}
                    className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                      markdownMode === 'raw'
                        ? 'bg-[var(--jmc-primary)] text-white shadow-xs'
                        : 'text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                    }`}
                  >
                    <Code className="h-3.5 w-3.5" />
                    <span>Kaynak Metin</span>
                  </button>
                </div>
                <div className="text-[11px] text-[var(--jmc-text-dim)]">
                  {preview.lineCount} satır
                </div>
              </div>
            )}

            {/* PDF Mod Değiştirici */}
            {preview.kind === 'pdf' && (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center rounded bg-[var(--jmc-bg-surface)] p-0.5 border border-[var(--jmc-border)]">
                  <button
                    type="button"
                    onClick={() => setPdfMode('embed')}
                    className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                      pdfMode === 'embed'
                        ? 'bg-[var(--jmc-primary)] text-white shadow-xs'
                        : 'text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>PDF Görünümü</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPdfMode('text')}
                    className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-all ${
                      pdfMode === 'text'
                        ? 'bg-[var(--jmc-primary)] text-white shadow-xs'
                        : 'text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                    }`}
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    <span>Ayıklanan Metin</span>
                  </button>
                </div>
                <span className="text-[11px] text-[var(--jmc-text-dim)]">
                  {preview.sizeBytes ? formatBytes(preview.sizeBytes) : ''}
                </span>
              </div>
            )}

            {/* PPTX Slayt Gezinimi */}
            {preview.kind === 'pptx' && preview.slides && preview.slides.length > 0 && (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={activeSlideIndex <= 0}
                    onClick={() => setActiveSlideIndex(i => Math.max(0, i - 1))}
                    className="rounded p-1 hover:bg-[var(--jmc-bg-surface)] disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="font-semibold text-[var(--jmc-text)]">
                    Slayt {activeSlideIndex + 1} / {preview.slides.length}
                  </span>
                  <button
                    type="button"
                    disabled={activeSlideIndex >= preview.slides.length - 1}
                    onClick={() => setActiveSlideIndex(i => Math.min(preview.slides!.length - 1, i + 1))}
                    className="rounded p-1 hover:bg-[var(--jmc-bg-surface)] disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1 max-w-md overflow-x-auto py-0.5">
                  {preview.slides.map((s, idx) => (
                    <button
                      key={s.slideNumber}
                      type="button"
                      onClick={() => setActiveSlideIndex(idx)}
                      className={`h-5 w-6 rounded text-[10px] font-mono transition-all ${
                        activeSlideIndex === idx
                          ? 'bg-[var(--jmc-primary)] text-white font-bold'
                          : 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* CSV / XLSX Tablo Filtresi */}
            {(preview.kind === 'csv' || preview.kind === 'xlsx') && (
              <div className="flex items-center justify-between w-full">
                <div className="relative max-w-xs flex-1">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Tabloda filtrele…"
                    className="w-full rounded bg-[var(--jmc-bg-surface)] py-1 pl-8 pr-3 text-[11.5px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
                  />
                </div>
                <span className="text-[11px] text-[var(--jmc-text-dim)]">
                  {filteredTableData.length > 0 ? `${filteredTableData.length - 1} satır listeleniyor` : 'Satır yok'}
                </span>
              </div>
            )}

            {/* Görsel Büyütme & Döndürme */}
            {preview.kind === 'image' && (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setImageZoom(z => Math.max(0.2, z - 0.2))}
                    className="rounded p-1 hover:bg-[var(--jmc-bg-surface)]"
                    title="Uzaklaş"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <span className="font-mono text-[10.5px] px-1">{Math.round(imageZoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setImageZoom(z => Math.min(3, z + 0.2))}
                    className="rounded p-1 hover:bg-[var(--jmc-bg-surface)]"
                    title="Yakınlaş"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImageZoom(1)
                      setImageRotation(0)
                    }}
                    className="rounded px-2 py-0.5 text-[10px] hover:bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)]"
                  >
                    Sıfırla
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setImageRotation(r => (r + 90) % 360)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] hover:bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)]"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>Döndür</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ================= GÖVDE ALANI (Dinamik Render) ================= */}
        <div ref={contentRef} className="min-h-0 flex-1 overflow-auto bg-[var(--jmc-bg)]">
          {loading && (
            <div className="grid h-full place-items-center p-8 text-center">
              <div className="space-y-3">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--jmc-primary)]" />
                <h4 className="text-[13px] font-semibold text-[var(--jmc-text)]">
                  Belge Hazırlanıyor…
                </h4>
                <p className="text-[11.5px] text-[var(--jmc-text-muted)]">
                  Dosya şifreli yerel kasadan çözülüyor ve önizleme hazırlanıyor.
                </p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="grid h-full place-items-center p-8 text-center">
              <div className="max-w-md space-y-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-6 text-rose-400">
                <AlertCircle className="mx-auto h-8 w-8" />
                <h4 className="text-[13px] font-semibold">Önizleme Oluşturulamadı</h4>
                <p className="text-[11.5px] leading-relaxed text-rose-300/80">{error}</p>
                <div className="pt-2 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={loadPreview}
                    className="rounded bg-rose-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-600 transition-colors"
                  >
                    Tekrar Dene
                  </button>
                  {preview?.localPath && (
                    <button
                      type="button"
                      onClick={handleOpenLocal}
                      className="rounded border border-rose-400/40 px-3 py-1.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20"
                    >
                      Harici Uygulamada Aç
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!loading && !error && preview && (
            <>
              {/* --- 1. KOD GÖRÜNTÜLEYİCİ --- */}
              {preview.kind === 'code' && (
                <div
                  className="flex font-mono text-[12px] leading-relaxed"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {/* Satır Numaraları Sütunu */}
                  <div className="select-none bg-[var(--jmc-bg-surface)]/60 px-3 py-3 text-right text-[var(--jmc-text-dim)] border-r border-[var(--jmc-border-subtle)] shrink-0">
                    {(filteredLines || codeLines).map((item, idx) => (
                      <div key={idx} className="h-6">
                        {typeof item === 'object' ? item.idx : idx + 1}
                      </div>
                    ))}
                  </div>

                  {/* Kod İçerik Sütunu */}
                  <div className={`flex-1 p-3 min-w-0 ${codeWrap ? 'break-words' : 'overflow-x-auto whitespace-pre'}`}>
                    {(filteredLines || codeLines).map((item, idx) => {
                      const text = typeof item === 'object' ? item.line : item
                      const isMatch = typeof item === 'object' ? item.match : false
                      return (
                        <div
                          key={idx}
                          className={`h-6 ${
                            isMatch
                              ? 'bg-amber-500/20 text-amber-200 font-semibold rounded px-1'
                              : 'text-[var(--jmc-text)]'
                          }`}
                        >
                          {text || ' '}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* --- 2. MARKDOWN GÖRÜNTÜLEYİCİ --- */}
              {preview.kind === 'markdown' && (
                <div className="p-6 max-w-4xl mx-auto">
                  {markdownMode === 'preview' ? (
                    <div className="prose prose-invert max-w-none text-[13px] leading-relaxed">
                      <MarkdownView content={preview.text || ''} />
                    </div>
                  ) : (
                    <pre className="font-mono text-[12px] leading-relaxed p-4 rounded-lg bg-[var(--jmc-bg-surface)] whitespace-pre-wrap text-[var(--jmc-text)]">
                      {preview.text}
                    </pre>
                  )}
                </div>
              )}

              {/* --- 3. PDF GÖRÜNTÜLEYİCİ --- */}
              {preview.kind === 'pdf' && (
                <div className="h-full w-full flex flex-col">
                  {pdfMode === 'embed' && preview.dataUrl ? (
                    <iframe
                      src={preview.dataUrl}
                      title={preview.title}
                      className="h-full w-full border-0 bg-neutral-900"
                    />
                  ) : (
                    <div className="p-6 max-w-3xl mx-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[var(--jmc-text)]">
                      {preview.text || 'Bu PDF dosyasından metin ayıklanamadı. PDF Görünümünü kullanın.'}
                    </div>
                  )}
                </div>
              )}

              {/* --- 4. WORD / DOCX DOKÜMAN GÖRÜNTÜLEYİCİ --- */}
              {preview.kind === 'docx' && (
                <div className="p-8 max-w-3xl mx-auto space-y-4">
                  <div className="rounded-xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-8 shadow-sm space-y-3.5">
                    <h2 className="text-[17px] font-bold text-[var(--jmc-text)] border-b border-[var(--jmc-border-subtle)] pb-2.5">
                      {preview.title}
                    </h2>
                    {preview.paragraphs && preview.paragraphs.length > 0 ? (
                      preview.paragraphs.map((p, idx) => (
                        <p key={idx} className="text-[13px] leading-relaxed text-[var(--jmc-text)]">
                          {p}
                        </p>
                      ))
                    ) : (
                      <p className="text-[13px] leading-relaxed text-[var(--jmc-text-muted)]">
                        {preview.text || 'İçerik bulunamadı.'}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* --- 5. POWERPOINT / PPTX SLAYT GÖRÜNTÜLEYİCİ --- */}
              {preview.kind === 'pptx' && preview.slides && (
                <div className="flex h-full flex-col items-center justify-center p-6">
                  {preview.slides[activeSlideIndex] ? (
                    <div className="w-full max-w-3xl aspect-[16/9] rounded-2xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-8 shadow-lg flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-[var(--jmc-text-dim)] border-b border-[var(--jmc-border-subtle)] pb-2">
                          <span>Slayt {activeSlideIndex + 1}</span>
                          <span>{preview.title}</span>
                        </div>
                        <h2 className="mt-4 text-[20px] font-bold text-[var(--jmc-primary)]">
                          {preview.slides[activeSlideIndex].title || 'Başlıksız Slayt'}
                        </h2>
                        <ul className="mt-6 space-y-2.5 text-[14px] text-[var(--jmc-text)] list-disc pl-5">
                          {preview.slides[activeSlideIndex].bullets.map((bullet, bIdx) => (
                            <li key={bIdx} className="leading-relaxed">
                              {bullet}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex justify-between items-center pt-4 border-t border-[var(--jmc-border-subtle)]">
                        <button
                          type="button"
                          disabled={activeSlideIndex <= 0}
                          onClick={() => setActiveSlideIndex(i => Math.max(0, i - 1))}
                          className="rounded px-3 py-1 bg-[var(--jmc-bg)] text-[11px] font-medium disabled:opacity-30"
                        >
                          Önceki
                        </button>
                        <span className="text-[11px] font-mono text-[var(--jmc-text-dim)]">
                          {activeSlideIndex + 1} / {preview.slides.length}
                        </span>
                        <button
                          type="button"
                          disabled={activeSlideIndex >= preview.slides.length - 1}
                          onClick={() => setActiveSlideIndex(i => Math.min(preview.slides!.length - 1, i + 1))}
                          className="rounded px-3 py-1 bg-[var(--jmc-bg)] text-[11px] font-medium disabled:opacity-30"
                        >
                          Sonraki
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12px] text-[var(--jmc-text-muted)]">Slayt bulunamadı.</p>
                  )}
                </div>
              )}

              {/* --- 6. TABLO (CSV / TSV / XLSX) GÖRÜNTÜLEYİCİ --- */}
              {(preview.kind === 'csv' || preview.kind === 'xlsx') && (
                <div className="p-4">
                  {filteredTableData.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-[var(--jmc-border)]">
                      <table className="w-full border-collapse text-left text-[12px]">
                        <thead>
                          <tr className="bg-[var(--jmc-bg-surface)] border-b border-[var(--jmc-border)]">
                            {filteredTableData[0].map((h, hIdx) => (
                              <th key={hIdx} className="px-3.5 py-2.5 font-semibold text-[var(--jmc-text)]">
                                {h || `Sütun ${hIdx + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTableData.slice(1).map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className="border-b border-[var(--jmc-border-subtle)] hover:bg-[var(--jmc-bg-surface)]/50 transition-colors"
                            >
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-3.5 py-2 text-[var(--jmc-text-muted)]">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-[12px] text-[var(--jmc-text-muted)]">
                      Veri bulunamadı.
                    </div>
                  )}
                </div>
              )}

              {/* --- 7. GÖRSEL GÖRÜNTÜLEYİCİ --- */}
              {preview.kind === 'image' && preview.dataUrl && (
                <div className="flex h-full w-full items-center justify-center overflow-auto p-4 bg-neutral-950/70">
                  <img
                    src={preview.dataUrl}
                    alt={preview.title}
                    style={{
                      transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                      transition: 'transform 0.15s ease-out',
                    }}
                    className="max-h-[80vh] max-w-[85vw] object-contain shadow-2xl rounded-md"
                  />
                </div>
              )}

              {/* --- 8. MEDYA (SES / VİDEO) GÖRÜNTÜLEYİCİ --- */}
              {preview.kind === 'media' && preview.dataUrl && (
                <div className="flex h-full w-full items-center justify-center p-8">
                  {preview.mimeType.startsWith('video/') ? (
                    <video
                      controls
                      src={preview.dataUrl}
                      className="max-h-[75vh] max-w-[85vw] rounded-xl shadow-2xl"
                    />
                  ) : (
                    <div className="rounded-2xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-8 shadow-xl text-center space-y-4">
                      <FileVideo className="mx-auto h-12 w-12 text-[var(--jmc-primary)]" />
                      <h4 className="text-[14px] font-semibold text-[var(--jmc-text)]">
                        {preview.title}
                      </h4>
                      <audio controls src={preview.dataUrl} className="w-80" />
                    </div>
                  )}
                </div>
              )}

              {/* --- 9. DÜZ METİN / GENEL GÖRÜNTÜLEYİCİ --- */}
              {(preview.kind === 'text' || preview.kind === 'binary') && (
                <div className="p-6 max-w-4xl mx-auto font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-[var(--jmc-text)]">
                  {preview.text}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default DocumentViewerModal
