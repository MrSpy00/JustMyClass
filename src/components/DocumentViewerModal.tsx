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
  AlignJustify,
} from 'lucide-react'
import Prism from 'prismjs'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-ruby'
import 'prismjs/components/prism-kotlin'
import 'prismjs/components/prism-swift'
import 'prismjs/components/prism-dart'

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function splitHighlightedHtmlLines(html: string): string[] {
  const lines = html.split('\n')
  const result: string[] = []
  const openTags: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const prefix = openTags.join('')
    const tagRegex = /<\/?([a-zA-Z0-9]+)[^>]*>/g
    let match: RegExpExecArray | null
    while ((match = tagRegex.exec(line)) !== null) {
      const fullTag = match[0]
      if (fullTag.startsWith('</')) {
        openTags.pop()
      } else if (!fullTag.endsWith('/>')) {
        openTags.push(fullTag)
      }
    }
    const suffix = openTags
      .slice()
      .reverse()
      .map(t => {
        const name = t.match(/<([a-zA-Z0-9]+)/)?.[1] || 'span'
        return `</${name}>`
      })
      .join('')

    result.push(prefix + line + suffix)
  }
  return result
}

function getYouTubeVideoId(urlOrId?: string): string | null {
  if (!urlOrId) return null
  const str = urlOrId.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str
  const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([a-zA-Z0-9_-]{11})/i)
  return match ? match[1] : null
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
  const [codeWrap, setCodeWrap] = useState(false)
  const [fontSize, setFontSize] = useState<number>(13)
  const [lineSpacing, setLineSpacing] = useState<'compact' | 'normal' | 'relaxed'>('normal')
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
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)

  const youtubeVideoId = useMemo(() => {
    return (
      attachment?.youTubeVideoId ||
      getYouTubeVideoId(attachment?.alternateLink) ||
      getYouTubeVideoId(preview?.title) ||
      getYouTubeVideoId(attachment?.title)
    )
  }, [attachment, preview])

  // PDF DataUrl'i Electron/Chromium engellerine takılmaması için Blob URL'e çevir
  useEffect(() => {
    if (preview?.kind === 'pdf' && preview.dataUrl) {
      if (preview.dataUrl.startsWith('blob:') || preview.dataUrl.startsWith('http')) {
        setPdfBlobUrl(preview.dataUrl)
        return
      }
      try {
        const parts = preview.dataUrl.split(',')
        const base64 = parts[1] || parts[0]
        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        setPdfBlobUrl(url)
        return () => {
          URL.revokeObjectURL(url)
        }
      } catch {
        setPdfBlobUrl(preview.dataUrl)
      }
    } else {
      setPdfBlobUrl(null)
    }
  }, [preview?.kind, preview?.dataUrl])

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

  // Asistan ile incele (Görseller, kodlar, belgeler ve tüm ekler dahil)
  const handleAnalyzeWithAssistant = useCallback(() => {
    if (preview) {
      onSendToAssistant?.(preview)
      onClose()
    } else if (attachment) {
      onSendToAssistant?.({
        fileId: attachment.driveFileId || attachment.id,
        title: attachment.title,
        kind: 'text',
        mimeType: 'text/plain',
        sizeBytes: 0,
        text: `Dosya / Ek: ${attachment.title}\nBağlantı: ${attachment.alternateLink || ''}`,
      })
      onClose()
    }
  }, [preview, attachment, onSendToAssistant, onClose])

  // Klavye ile slayt geçişi (Sol / Sağ Ok tuşları)
  useEffect(() => {
    if (!isOpen || preview?.kind !== 'pptx' || !preview.slides || preview.slides.length === 0) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setActiveSlideIndex(i => Math.max(0, i - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setActiveSlideIndex(i => Math.min(preview.slides!.length - 1, i + 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, preview])

  // PrismJS dil grameri eşleştirmesi
  const prismGrammar = useMemo(() => {
    const lang = preview?.language?.toLowerCase().trim() || ''
    if (lang === 'ts' || lang === 'typescript' || lang === 'tsx') {
      return { grammar: Prism.languages.typescript || Prism.languages.javascript, key: 'typescript' }
    }
    if (lang === 'js' || lang === 'javascript' || lang === 'jsx') {
      return { grammar: Prism.languages.javascript, key: 'javascript' }
    }
    if (lang === 'py' || lang === 'python') return { grammar: Prism.languages.python, key: 'python' }
    if (lang === 'java') return { grammar: Prism.languages.java, key: 'java' }
    if (lang === 'c') return { grammar: Prism.languages.c, key: 'c' }
    if (lang === 'cpp' || lang === 'c++') return { grammar: Prism.languages.cpp || Prism.languages.c, key: 'cpp' }
    if (lang === 'cs' || lang === 'csharp' || lang === 'c#') return { grammar: Prism.languages.csharp, key: 'csharp' }
    if (lang === 'sql') return { grammar: Prism.languages.sql, key: 'sql' }
    if (lang === 'sh' || lang === 'bash' || lang === 'shell' || lang === 'zsh') return { grammar: Prism.languages.bash, key: 'bash' }
    if (lang === 'json') return { grammar: Prism.languages.json, key: 'json' }
    if (lang === 'yaml' || lang === 'yml') return { grammar: Prism.languages.yaml, key: 'yaml' }
    if (lang === 'md' || lang === 'markdown') return { grammar: Prism.languages.markdown, key: 'markdown' }
    if (lang === 'rs' || lang === 'rust') return { grammar: Prism.languages.rust, key: 'rust' }
    if (lang === 'html' || lang === 'xml' || lang === 'svg') return { grammar: Prism.languages.markup, key: 'markup' }
    if (lang === 'css' || lang === 'scss' || lang === 'sass') return { grammar: Prism.languages.css, key: 'css' }
    if (lang === 'php') return { grammar: Prism.languages.php, key: 'php' }
    if (lang === 'rb' || lang === 'ruby') return { grammar: Prism.languages.ruby, key: 'ruby' }
    if (lang === 'kt' || lang === 'kotlin') return { grammar: Prism.languages.kotlin, key: 'kotlin' }
    if (lang === 'swift') return { grammar: Prism.languages.swift, key: 'swift' }
    if (lang === 'dart') return { grammar: Prism.languages.dart, key: 'dart' }
    if (Prism.languages[lang]) return { grammar: Prism.languages[lang], key: lang }
    return null
  }, [preview?.language])

  // Kod satırları ve Prism renklendirmesi
  const highlightedCodeLines = useMemo(() => {
    if (!preview?.text || (preview.kind !== 'code' && preview.kind !== 'text')) return []
    const normalized = preview.text.replace(/\r\n/g, '\n')
    const lines = normalized.split('\n')
    let highlightedLines: string[] = []
    if (prismGrammar) {
      try {
        const fullHtml = Prism.highlight(normalized, prismGrammar.grammar, prismGrammar.key)
        highlightedLines = splitHighlightedHtmlLines(fullHtml)
      } catch {
        highlightedLines = lines.map(l => escapeHtml(l))
      }
    } else {
      highlightedLines = lines.map(l => escapeHtml(l))
    }
    return lines.map((line, idx) => ({
      lineIndex: idx + 1,
      raw: line,
      html: highlightedLines[idx] || '&nbsp;',
    }))
  }, [preview?.text, preview?.kind, prismGrammar])

  const filteredCodeRows = useMemo(() => {
    if (!searchQuery.trim()) return highlightedCodeLines
    const q = searchQuery.toLowerCase()
    return highlightedCodeLines.filter(row => row.raw.toLowerCase().includes(q))
  }, [highlightedCodeLines, searchQuery])

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
            {/* ASİSTAN İLE İNCELE (Ana Aksiyon Butonu - Görseller, Kodlar, Slaytlar, Tüm Ekler İçin) */}
            {onSendToAssistant && (preview || attachment) && (
              <button
                type="button"
                onClick={handleAnalyzeWithAssistant}
                title="Bu dosyayı veya eki yapay zekâ asistanına gönder ve soru sor / analiz ettir"
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
                      placeholder="Kod veya metin içinde ara…"
                      className="w-full rounded bg-[var(--jmc-bg-surface)] py-1 pl-8 pr-3 text-[11.5px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[var(--jmc-text-muted)]">
                  {/* Satır Kaydırma */}
                  <button
                    type="button"
                    onClick={() => setCodeWrap(prev => !prev)}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                      codeWrap ? 'bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)] font-semibold' : 'hover:text-[var(--jmc-text)]'
                    }`}
                  >
                    <WrapText className="h-3.5 w-3.5" />
                    <span>{codeWrap ? 'Kaydır Açık' : 'Kaydır'}</span>
                  </button>

                  {/* Satır Boşlukları (Aralığı) */}
                  <div className="flex items-center gap-1 border-l border-[var(--jmc-border)] pl-2">
                    <span className="text-[10px] text-[var(--jmc-text-dim)] mr-0.5">Satır:</span>
                    {(['compact', 'normal', 'relaxed'] as const).map(spacing => (
                      <button
                        key={spacing}
                        type="button"
                        onClick={() => setLineSpacing(spacing)}
                        className={`rounded px-1.5 py-0.5 text-[10.5px] transition-colors ${
                          lineSpacing === spacing
                            ? 'bg-[var(--jmc-primary)] text-white font-medium'
                            : 'hover:bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-dim)]'
                        }`}
                      >
                        {spacing === 'compact' ? 'Sık' : spacing === 'normal' ? 'Normal' : 'Rahat'}
                      </button>
                    ))}
                  </div>

                  {/* Yazı Boyutu */}
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
                      onClick={() => setFontSize(s => Math.min(22, s + 1))}
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
              <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-2">
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

                  {(downloadedPath || preview.localPath) && (
                    <button
                      type="button"
                      onClick={handleOpenFile}
                      title="PDF dosyasını sisteminizdeki varsayılan okuyucuda aç (Adobe Acrobat, Edge, Chrome)"
                      className="inline-flex items-center gap-1 rounded bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--jmc-text-muted)] border border-[var(--jmc-border)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] transition-all"
                    >
                      <ExternalLink className="h-3 w-3 text-rose-400" />
                      <span>Sistem Okuyucusunda Aç</span>
                    </button>
                  )}
                </div>

                {pdfMode === 'text' && (
                  <div className="relative max-w-xs flex-1">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="PDF metninde ara…"
                      className="w-full rounded bg-[var(--jmc-bg-surface)] py-1 pl-8 pr-3 text-[11px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
                    />
                  </div>
                )}

                <span className="text-[11px] text-[var(--jmc-text-dim)]">
                  {preview.sizeBytes ? formatBytes(preview.sizeBytes) : ''}
                </span>
              </div>
            )}

            {/* Word / DOCX Doküman Kontrolleri */}
            {preview.kind === 'docx' && (
              <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                <div className="relative max-w-xs flex-1">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Word dokümanında ara…"
                    className="w-full rounded bg-[var(--jmc-bg-surface)] py-1 pl-8 pr-3 text-[11.5px] text-[var(--jmc-text)] border border-[var(--jmc-border)] outline-none focus:border-[var(--jmc-primary)]"
                  />
                </div>

                <div className="flex items-center gap-2">
                  {(downloadedPath || preview.localPath) && (
                    <button
                      type="button"
                      onClick={handleOpenFile}
                      title="Word belgesini Microsoft Word veya LibreOffice ile aç"
                      className="inline-flex items-center gap-1 rounded bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--jmc-text-muted)] border border-[var(--jmc-border)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] transition-all"
                    >
                      <ExternalLink className="h-3 w-3 text-blue-400" />
                      <span>Word'de Aç</span>
                    </button>
                  )}
                  <span className="text-[11px] text-[var(--jmc-text-dim)]">
                    {preview.paragraphs?.length || 0} paragraf
                  </span>
                </div>
              </div>
            )}

            {/* PPTX Slayt Başlık Bilgisi (Ana Butonlar Aşağıda Sabit & Kenetlenmiştir) */}
            {preview.kind === 'pptx' && preview.slides && preview.slides.length > 0 && (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-amber-500/15 text-amber-400 px-2 py-0.5 font-semibold text-[11px]">
                    Slayt {activeSlideIndex + 1} / {preview.slides.length}
                  </span>
                  <span className="text-[11px] text-[var(--jmc-text-muted)] truncate max-w-sm">
                    {preview.slides[activeSlideIndex]?.title || 'Başlıksız'}
                  </span>
                </div>
                <div className="text-[10.5px] text-[var(--jmc-text-dim)] hidden sm:block">
                  Klavye: ← Sol / → Sağ Ok Tuşları
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
              {/* --- 0. YOUTUBE VİDEO OYNATICI (Uygulama İçi Yerleşik, Sıfır Ekstra Paket, Üstün Performans) --- */}
              {youtubeVideoId ? (
                <div className="flex h-full w-full flex-col items-center justify-center p-4 md:p-8 bg-black/90">
                  <div className="w-full max-w-4xl aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${youtubeVideoId}?rel=0&autoplay=0`}
                      title={preview?.title || attachment?.title || 'YouTube Video'}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="w-full h-full border-0"
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between w-full max-w-4xl px-2 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="rounded bg-red-600 px-2 py-0.5 text-[10.5px] font-bold text-white uppercase tracking-wider">
                        YouTube
                      </span>
                      <span className="text-[12.5px] font-semibold text-white/90 truncate">
                        {preview?.title || attachment?.title}
                      </span>
                    </div>
                    {attachment?.alternateLink && (
                      <button
                        type="button"
                        onClick={() => void window.jmcAPI?.openExternalUrl(attachment.alternateLink!)}
                        className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-white/20 bg-white/10 px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-white/20 transition-all"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Tarayıcıda Aç</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* --- 1. KOD GÖRÜNTÜLEYİCİ (PrismJS Sözdizimi, Eşzamanlı Satır Numaraları, Satır Aralığı) --- */}
                  {preview.kind === 'code' && (
                    <div
                      className="font-mono text-[12px] select-text min-h-full bg-[var(--jmc-bg)]"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      <div className="w-full py-2">
                        {filteredCodeRows.map(row => {
                          const isMatch =
                            searchQuery.trim().length > 0 &&
                            row.raw.toLowerCase().includes(searchQuery.toLowerCase())
                          const lineSpacingStyle =
                            lineSpacing === 'compact'
                              ? 'py-0 leading-[1.3]'
                              : lineSpacing === 'relaxed'
                                ? 'py-1.5 leading-[1.85]'
                                : 'py-0.5 leading-[1.55]'

                          return (
                            <div
                              key={row.lineIndex}
                              className={`flex items-start transition-colors hover:bg-white/[0.04] ${lineSpacingStyle} ${
                                isMatch ? 'bg-amber-500/15' : ''
                              }`}
                            >
                              <span className="select-none pl-3 pr-4 text-right text-[var(--jmc-text-dim)] shrink-0 min-w-[3.75rem] font-mono text-[11px] opacity-60 border-r border-[var(--jmc-border-subtle)]">
                                {row.lineIndex}
                              </span>
                              <div
                                className={`flex-1 pl-4 pr-4 min-w-0 font-mono ${
                                  codeWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-visible'
                                } ${isMatch ? 'text-amber-200' : 'text-[var(--jmc-text)]'}`}
                                dangerouslySetInnerHTML={{ __html: row.html }}
                              />
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

                  {/* --- 3. PDF GÖRÜNTÜLEYİCİ (Blob URL ve Yerleşik PDF Eklentisi) --- */}
                  {preview.kind === 'pdf' && (
                    <div className="h-full w-full flex flex-col">
                      {pdfMode === 'embed' && (pdfBlobUrl || preview.dataUrl) ? (
                        <iframe
                          src={pdfBlobUrl || preview.dataUrl}
                          title={preview.title || 'PDF Belgesi'}
                          className="h-full w-full border-0 bg-neutral-900 rounded-b-xl"
                        />
                      ) : (
                        <div className="p-6 md:p-8 max-w-4xl mx-auto w-full">
                          <div className="rounded-xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-6 shadow-sm">
                            <div className="flex items-center justify-between border-b border-[var(--jmc-border-subtle)] pb-3 mb-4">
                              <h4 className="text-[13px] font-semibold text-[var(--jmc-text)]">
                                PDF Ayıklanan Metin İçeriği
                              </h4>
                              <button
                                type="button"
                                onClick={handleCopy}
                                className="inline-flex items-center gap-1 rounded bg-[var(--jmc-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] border border-[var(--jmc-border)]"
                              >
                                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                                <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
                              </button>
                            </div>
                            <div className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[var(--jmc-text)] select-text">
                              {preview.text || 'Bu PDF dosyasından metin ayıklanamadı. PDF Görünümünü kullanın.'}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* --- 4. WORD / DOCX DOKÜMAN GÖRÜNTÜLEYİCİ --- */}
                  {preview.kind === 'docx' && (
                    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-6">
                      <div className="rounded-2xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-6 md:p-10 shadow-md space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--jmc-border-subtle)] pb-4">
                          <div>
                            <h2 className="text-[18px] md:text-[20px] font-bold text-[var(--jmc-text)] tracking-tight">
                              {preview.title}
                            </h2>
                            <p className="text-[11.5px] text-[var(--jmc-text-dim)] mt-0.5">
                              DOCX Dokümanı · Biçimlendirilmiş Okuma Görünümü
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleCopy}
                            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] transition-colors"
                          >
                            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                            <span>{copied ? 'Kopyalandı' : 'Tüm Metni Kopyala'}</span>
                          </button>
                        </div>

                        <div className="space-y-3.5 pt-2 select-text">
                          {preview.paragraphs && preview.paragraphs.length > 0 ? (
                            preview.paragraphs
                              .filter(p => !searchQuery.trim() || p.toLowerCase().includes(searchQuery.toLowerCase()))
                              .map((p, idx) => {
                                const trimmed = p.trim()
                                const isMatch = searchQuery.trim() && trimmed.toLowerCase().includes(searchQuery.toLowerCase())

                                // Basit Markdown Tablo Tespiti
                                if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|')) {
                                  const cells = trimmed
                                    .split('|')
                                    .map(c => c.trim())
                                    .filter((_, i, arr) => i > 0 && i < arr.length - 1)
                                  return (
                                    <div key={idx} className="overflow-x-auto my-3 rounded-lg border border-[var(--jmc-border)]">
                                      <table className="w-full text-left text-[12px]">
                                        <tbody>
                                          <tr className="bg-[var(--jmc-bg)]/60">
                                            {cells.map((cell, cIdx) => (
                                              <td
                                                key={cIdx}
                                                className="px-3.5 py-2 border-r border-[var(--jmc-border-subtle)] last:border-0 font-medium text-[var(--jmc-text)]"
                                              >
                                                {cell}
                                              </td>
                                            ))}
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  )
                                }

                                // Madde İmli Paragraf
                                if (trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                                  return (
                                    <div
                                      key={idx}
                                      className={`flex items-start gap-2.5 pl-3 py-0.5 text-[13px] leading-relaxed ${
                                        isMatch ? 'bg-amber-500/15 text-amber-200 rounded px-2' : 'text-[var(--jmc-text)]'
                                      }`}
                                    >
                                      <span className="text-[var(--jmc-primary)] font-bold select-none">•</span>
                                      <span>{trimmed.replace(/^[•\-\*]\s*/, '')}</span>
                                    </div>
                                  )
                                }

                                // Normal Paragraf
                                return (
                                  <p
                                    key={idx}
                                    className={`text-[13px] leading-relaxed transition-colors ${
                                      isMatch
                                        ? 'bg-amber-500/15 text-amber-200 font-medium rounded p-1.5'
                                        : 'text-[var(--jmc-text)]'
                                    }`}
                                  >
                                    {trimmed}
                                  </p>
                                )
                              })
                          ) : (
                            <p className="text-[13px] leading-relaxed text-[var(--jmc-text-muted)]">
                              {preview.text || 'İçerik bulunamadı.'}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* --- 5. POWERPOINT / PPTX SLAYT GÖRÜNTÜLEYİCİ (Kenetlenmiş Sabit Gezinim Çubuğu, Kesilmeyen Ortalı Düzen) --- */}
                  {preview.kind === 'pptx' && preview.slides && (
                    <div className="flex h-full flex-col justify-between overflow-hidden">
                      {/* Slayt İçerik Alanı (Ortalanmış ve Kesintisiz Kaydırılabilir) */}
                      <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col items-center">
                        {preview.slides[activeSlideIndex] ? (
                          <div className="w-full max-w-4xl my-auto min-h-[380px] rounded-2xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-6 md:p-10 shadow-2xl flex flex-col justify-between transition-all">
                            <div>
                              <div className="flex items-center justify-between text-[11px] text-[var(--jmc-text-dim)] border-b border-[var(--jmc-border-subtle)] pb-3">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-400 px-2.5 py-0.5 font-semibold text-[10.5px]">
                                  <Presentation className="h-3 w-3" />
                                  Slayt {activeSlideIndex + 1} / {preview.slides.length}
                                </span>
                                <span className="truncate max-w-xs">{preview.title}</span>
                              </div>
                              <h2 className="mt-5 text-[20px] md:text-[24px] font-bold text-[var(--jmc-text)] tracking-tight">
                                {preview.slides[activeSlideIndex].title || `Slayt ${activeSlideIndex + 1}`}
                              </h2>
                              {preview.slides[activeSlideIndex].bullets.length > 0 ? (
                                <ul className="mt-6 space-y-3 text-[13.5px] md:text-[14.5px] text-[var(--jmc-text)] list-disc pl-6 leading-relaxed select-text">
                                  {preview.slides[activeSlideIndex].bullets.map((bullet, bIdx) => (
                                    <li key={bIdx} className="leading-relaxed">
                                      {bullet}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-6 text-[13px] italic text-[var(--jmc-text-dim)]">
                                  Bu slaytta madde imli metin bulunmuyor veya slayt yalnızca görsel/şema içeriyor olabilir.
                                </p>
                              )}
                            </div>

                            <div className="mt-8 pt-4 border-t border-[var(--jmc-border-subtle)] flex items-center justify-between text-[11px] text-[var(--jmc-text-dim)]">
                              <span>Klavye: ← Sol / → Sağ Ok tuşları ile gezinebilirsiniz</span>
                              <span className="font-mono">
                                {Math.round(((activeSlideIndex + 1) / preview.slides.length) * 100)}%
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[12px] text-[var(--jmc-text-muted)] my-auto">Slayt bulunamadı.</p>
                        )}
                      </div>

                      {/* SABİT & KENETLENMİŞ ALT KONTROL ÇUBUĞU */}
                      <div className="shrink-0 border-t border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={activeSlideIndex <= 0}
                            onClick={() => setActiveSlideIndex(i => Math.max(0, i - 1))}
                            title="Önceki Slayt (Sol Ok)"
                            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--jmc-text)] shadow-xs transition-all hover:bg-[var(--jmc-primary)] hover:text-white hover:border-[var(--jmc-primary)] disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            <span>Önceki Slayt</span>
                          </button>
                          <button
                            type="button"
                            disabled={activeSlideIndex >= preview.slides.length - 1}
                            onClick={() => setActiveSlideIndex(i => Math.min(preview.slides!.length - 1, i + 1))}
                            title="Sonraki Slayt (Sağ Ok)"
                            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--jmc-text)] shadow-xs transition-all hover:bg-[var(--jmc-primary)] hover:text-white hover:border-[var(--jmc-primary)] disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                          >
                            <span>Sonraki Slayt</span>
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>

                        {/* Slayt Numaraları / Hızlı Atlama Çubuğu */}
                        <div className="flex items-center gap-1 overflow-x-auto max-w-xl py-1 no-scrollbar">
                          {preview.slides.map((s, idx) => (
                            <button
                              key={s.slideNumber || idx}
                              type="button"
                              onClick={() => setActiveSlideIndex(idx)}
                              title={`Slayt ${idx + 1}: ${s.title || 'Başlıksız'}`}
                              className={`h-7 min-w-[28px] px-1.5 rounded text-[11px] font-mono transition-all ${
                                activeSlideIndex === idx
                                  ? 'bg-[var(--jmc-primary)] text-white font-bold shadow-xs scale-105'
                                  : 'bg-[var(--jmc-bg)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] border border-[var(--jmc-border-subtle)]'
                              }`}
                            >
                              {idx + 1}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11.5px] font-semibold text-[var(--jmc-text)]">
                            {activeSlideIndex + 1} / {preview.slides.length}
                          </span>
                        </div>
                      </div>
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

                  {/* --- 7. GÖRSEL GÖRÜNTÜLEYİCİ (Tam Otomatik Sığdırma, Yüzen Akıllı Slider) --- */}
                  {preview.kind === 'image' && preview.dataUrl && (
                    <div className="group relative flex h-full w-full items-center justify-center overflow-auto p-4 bg-neutral-950/70 select-none">
                      <img
                        src={preview.dataUrl}
                        alt={preview.title}
                        style={{
                          transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                          transition: 'transform 0.15s ease-out',
                        }}
                        className="max-h-[75vh] max-w-[88vw] object-contain shadow-2xl rounded-md transition-transform"
                      />

                      {/* Yüzen Kontrol Çubuğu */}
                      <div
                        className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/10 bg-neutral-900/80 px-4 py-2 backdrop-blur-md shadow-2xl transition-opacity duration-200 ${
                          imageZoom !== 1 || imageRotation !== 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setImageZoom(z => Math.max(0.2, z - 0.2))}
                          className="rounded p-1 hover:bg-white/10 text-white transition-colors"
                          title="Uzaklaş (-)"
                        >
                          <ZoomOut className="h-4 w-4" />
                        </button>
                        <input
                          type="range"
                          min="0.2"
                          max="3"
                          step="0.1"
                          value={imageZoom}
                          onChange={e => setImageZoom(parseFloat(e.target.value))}
                          className="w-24 accent-[var(--jmc-primary)] cursor-pointer"
                        />
                        <span className="font-mono text-[11px] text-white/90 min-w-[42px] text-center">
                          {Math.round(imageZoom * 100)}%
                        </span>
                        <button
                          type="button"
                          onClick={() => setImageZoom(z => Math.min(3, z + 0.2))}
                          className="rounded p-1 hover:bg-white/10 text-white transition-colors"
                          title="Yakınlaş (+)"
                        >
                          <ZoomIn className="h-4 w-4" />
                        </button>
                        <div className="h-4 w-px bg-white/20 mx-1" />
                        <button
                          type="button"
                          onClick={() => setImageRotation(r => (r + 90) % 360)}
                          className="rounded p-1 hover:bg-white/10 text-white transition-colors"
                          title="90° Döndür"
                        >
                          <RotateCw className="h-4 w-4" />
                        </button>
                        {(imageZoom !== 1 || imageRotation !== 0) && (
                          <button
                            type="button"
                            onClick={() => {
                              setImageZoom(1)
                              setImageRotation(0)
                            }}
                            className="rounded px-2 py-0.5 text-[10.5px] font-medium bg-white/15 hover:bg-white/25 text-white transition-colors ml-1"
                          >
                            Sıfırla
                          </button>
                        )}
                      </div>
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

                  {/* --- 9. BAĞLANTI (LINK) KARTI GÖRÜNTÜLEYİCİ --- */}
                  {(preview.kind === 'link' || ((preview.kind === 'binary' || preview.kind === 'text') && attachment.alternateLink)) && (
                    <div className="p-8 max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[350px]">
                      <div className="w-full rounded-2xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-8 shadow-xl text-center space-y-4">
                        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary)]">
                          <Link className="h-7 w-7" />
                        </div>
                        <div>
                          <h3 className="text-[16px] font-bold text-[var(--jmc-text)]">
                            {preview.title || attachment.title}
                          </h3>
                          <p className="mt-1 font-mono text-[11px] text-[var(--jmc-text-dim)] truncate max-w-md mx-auto">
                            {attachment.alternateLink || preview.dataUrl}
                          </p>
                        </div>
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                          <button
                            type="button"
                            onClick={() => void window.jmcAPI?.openExternalUrl((attachment.alternateLink || preview.dataUrl)!)}
                            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-4 py-2 text-[12px] font-semibold text-white shadow-md hover:bg-[var(--jmc-primary-hover)] active:scale-95 transition-all"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>Tarayıcıda Aç</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyLink}
                            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-3.5 py-2 text-[12px] font-medium text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] active:scale-95 transition-all"
                          >
                            {linkCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                            <span>{linkCopied ? 'Kopyalandı' : 'Bağlantıyı Kopyala'}</span>
                          </button>
                          {onSendToAssistant && (
                            <button
                              type="button"
                              onClick={handleAnalyzeWithAssistant}
                              className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-primary)]/30 bg-[var(--jmc-primary)]/10 px-3.5 py-2 text-[12px] font-medium text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/20 active:scale-95 transition-all"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>Asistan ile İncele</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* --- 10. DÜZ METİN / GENEL GÖRÜNTÜLEYİCİ --- */}
                  {(preview.kind === 'text' || preview.kind === 'binary') && !attachment.alternateLink && (
                    <div className="p-6 max-w-4xl mx-auto font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-[var(--jmc-text)]">
                      {preview.text}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default DocumentViewerModal
