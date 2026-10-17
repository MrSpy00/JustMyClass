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
/**
 * Prism dil bilesenleri.
 *
 * KURALLAR
 * --------
 * 1) Tek tek `prism-<lang>.js` import edilir. `prismjs/components/index.js`
 *    CJS'dir; toplu import Vite altinda ya agirlik sorunu yaratir ya da
 *    `Prism.languages[lang]` anahtarlarini sessizce kaybettirir.
 * 2) SIRA ONEMLIDIR: bir bilesen baska bir dili `require` ediyorsa once o
 *    yuklenmis olmalidir (`node_modules/prismjs/components.json` -> `require`).
 * 3) `filePreviewService`in `LANGUAGE_BY_EXTENSION` haritasindaki HER deger
 *    burada yuklenir. Aksi halde `Prism.languages[lang]` `undefined` olur ve
 *    Prism sessizce duz metin doner ("renklendirme hic calismiyor").
 *
 * Prism 1.30 `vue` ve `svelte` gramerlerini KALDIRMISTIR; bu iki dil icin
 * `PRISM_ALIASES` uzerinden `markup` gramerine dusulur.
 */
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-markup-templating'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-scss'
import 'prismjs/components/prism-sass'
import 'prismjs/components/prism-less'
import 'prismjs/components/prism-stylus'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-json5'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-toml'
import 'prismjs/components/prism-ini'
import 'prismjs/components/prism-properties'
import 'prismjs/components/prism-editorconfig'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-csv'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-scala'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-go-module'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-basic'
import 'prismjs/components/prism-vbnet'
import 'prismjs/components/prism-fsharp'
import 'prismjs/components/prism-cshtml'
import 'prismjs/components/prism-kotlin'
import 'prismjs/components/prism-groovy'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-ruby'
import 'prismjs/components/prism-erb'
import 'prismjs/components/prism-haml'
import 'prismjs/components/prism-pug'
import 'prismjs/components/prism-latex'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-graphql'
import 'prismjs/components/prism-protobuf'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-powershell'
import 'prismjs/components/prism-batch'
import 'prismjs/components/prism-lua'
import 'prismjs/components/prism-r'
import 'prismjs/components/prism-dart'
import 'prismjs/components/prism-swift'
import 'prismjs/components/prism-clojure'
import 'prismjs/components/prism-lisp'
import 'prismjs/components/prism-elixir'
import 'prismjs/components/prism-erlang'
import 'prismjs/components/prism-haskell'
import 'prismjs/components/prism-ocaml'
import 'prismjs/components/prism-fortran'
import 'prismjs/components/prism-perl'
import 'prismjs/components/prism-nim'
import 'prismjs/components/prism-zig'
import 'prismjs/components/prism-nasm'
import 'prismjs/components/prism-verilog'
import 'prismjs/components/prism-smali'
import 'prismjs/components/prism-solidity'
import 'prismjs/components/prism-objectivec'
import 'prismjs/components/prism-arduino'
import 'prismjs/components/prism-docker'
import 'prismjs/components/prism-git'
import 'prismjs/components/prism-ignore'
import 'prismjs/components/prism-makefile'
import 'prismjs/components/prism-cmake'
import 'prismjs/components/prism-hcl'
import 'prismjs/components/prism-nix'
import 'prismjs/components/prism-bicep'
import 'prismjs/components/prism-diff'
import 'prismjs/components/prism-tcl'
import 'prismjs/components/prism-awk'
import 'prismjs/components/prism-jq'
import 'prismjs/components/prism-vim'
import 'prismjs/components/prism-uri'
import 'prismjs/components/prism-http'
import 'prismjs/components/prism-systemd'
import 'prismjs/components/prism-nginx'
import 'prismjs/components/prism-xquery'
import 'prismjs/components/prism-log'

import type { Attachment, FilePreviewResult } from '../../types/jmc'
import { MarkdownView } from './MarkdownView'
import { ClickableText, findUrls, isSafeExternalUrl } from './ClickableText'
import { YouTubeInlineCard } from './YouTubeInlineCard'

/* ------------------------------------------------------------------ *
 * Yerel tip tanimlari
 *
 * `types/jmc.ts` bu dosyanin sahibi disinda baska bir agent tarafindan
 * duzenleniyor; bu yuzden kopru tasiyan blok tipleri BURADA yerel olarak
 * tanimlanir ve `undefined` kontrollu okunur (yoksa eski yola dusulur).
 * ------------------------------------------------------------------ */
interface DocxParagraphBlock {
  type: 'paragraph'
  text: string
  bullet?: boolean
  url?: string
}
interface DocxTableBlock {
  type: 'table'
  rows: string[][]
  cellUrls?: Array<Array<string | undefined>>
}
type DocxBlock = DocxParagraphBlock | DocxTableBlock

interface PptxSlideView {
  slideNumber: number
  title?: string
  titleUrl?: string
  bullets: string[]
  bulletUrls?: Array<string | undefined>
}

type PreviewExtras = { docBlocks?: DocxBlock[] }

function readDocBlocks(preview: FilePreviewResult | null | undefined): DocxBlock[] | undefined {
  if (!preview || preview.kind !== 'docx') return undefined
  const blocks = (preview as FilePreviewResult & PreviewExtras).docBlocks
  return Array.isArray(blocks) ? blocks : undefined
}

function readSlides(preview: FilePreviewResult | null | undefined): PptxSlideView[] | undefined {
  const slides = preview?.slides
  return Array.isArray(slides) ? (slides as PptxSlideView[]) : undefined
}

/** `Prism.languages[lang]` guvenle okunur (Prism'in `languages` tipi dar). */
function prismLanguage(lang: string): Prism.Grammar | undefined {
  return (Prism.languages as unknown as Record<string, Prism.Grammar | undefined>)[lang]
}

/** Kisa dil adlari ve Prism'de olmayan diller icin cozumleme tablosu. */
const PRISM_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  kt: 'kotlin',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  htm: 'html',
  xhtml: 'html',
  h: 'c',
  golang: 'go',
  objc: 'objectivec',
  dockerfile: 'docker',
  make: 'makefile',
  // Prism 1.30'da `vue` / `svelte` grameri YOK -> en yakin Markup tabani
  vue: 'markup',
  svelte: 'markup',
  astro: 'markup',
  // assembly tasiyicilari Prism'de `nasm`
  asm: 'nasm',
  assembly: 'nasm',
  xml: 'markup',
  svg: 'markup',
  html: 'markup',
  plist: 'markup',
  xsl: 'markup',
  xsd: 'markup',
}

/**
 * Dil adindan GERCEKTEN yuklenmis bir Prism grameri cozer.
 * Sirasiyla: dogrudan anahtar -> takma ad. Hicbiri yoksa `null` doner; bu
 * durumda arayuz duz metne duser VE kullaniciya dil secici sunar.
 */
function resolvePrismGrammar(lang: string): { grammar: Prism.Grammar; key: string } | null {
  const norm = (lang || '').toLowerCase().trim()
  if (!norm || norm === 'text' || norm === 'plaintext' || norm === 'plain' || norm === 'txt') return null
  for (const candidate of [norm, PRISM_ALIASES[norm]]) {
    if (!candidate) continue
    const grammar = prismLanguage(candidate)
    if (grammar) return { grammar, key: candidate }
  }
  return null
}

import { parseYouTubeUrl } from '../lib/youtube'

/**
 * DOCX paragrafi: metni gosterir ve `w:hyperlink` ile gelen hedef varsa
 * paragrafi TIKLANABILIR yapar.
 *
 * `url` yoksa davranis `ClickableText` ile aynidir (metindeki duz adresleri
 * tiklanabilir yapar); `url` varsa paragrafin tamami dokunun hedefine gider.
 */
function DocxParagraphText({ text, url }: { text: string; url?: string }): React.ReactElement {
  if (!url || !isSafeExternalUrl(url)) {
    return <ClickableText text={text} preserveWhitespace={false} />
  }
  const yt = parseYouTubeUrl(url)
  return (
    <span className="inline">
      <a
        href={url}
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          void window.jmcAPI?.openExternalUrl(url)
        }}
        rel="noreferrer noopener"
        className="text-[var(--jmc-link)] hover:text-[var(--jmc-link-hover)] font-semibold underline decoration-[1.5px] underline-offset-3 bg-[var(--jmc-link)]/10 hover:bg-[var(--jmc-link)]/20 px-1 py-0.5 rounded transition-colors break-words"
        title={url}
      >
        {text || url}
      </a>
      {yt && (
        <span className="mt-2 block not-italic font-normal max-w-xl" onClick={e => e.stopPropagation()}>
          <YouTubeInlineCard videoId={yt.videoId} url={yt.url} startSeconds={yt.startSeconds} />
        </span>
      )}
    </span>
  )
}

/** Dil secici listesi. Her id icin Prism grameri yuklenmis olmalidir. */
const SELECTABLE_LANGUAGES: Array<{ id: string; label: string }> = [
  { id: 'text', label: 'Duz metin' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'tsx', label: 'TSX (React)' },
  { id: 'jsx', label: 'JSX (React)' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'scala', label: 'Scala' },
  { id: 'groovy', label: 'Groovy' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'fsharp', label: 'F#' },
  { id: 'vbnet', label: 'VB.NET' },
  { id: 'cshtml', label: 'Razor / CSHTML' },
  { id: 'objectivec', label: 'Objective-C' },
  { id: 'arduino', label: 'Arduino' },
  { id: 'rust', label: 'Rust' },
  { id: 'go', label: 'Go' },
  { id: 'go-module', label: 'go.mod' },
  { id: 'zig', label: 'Zig' },
  { id: 'nim', label: 'Nim' },
  { id: 'nasm', label: 'Assembly (NASM)' },
  { id: 'verilog', label: 'Verilog' },
  { id: 'smali', label: 'Smali' },
  { id: 'fortran', label: 'Fortran' },
  { id: 'solidity', label: 'Solidity' },
  { id: 'html', label: 'HTML / XML / SVG' },
  { id: 'vue', label: 'Vue (.vue)' },
  { id: 'svelte', label: 'Svelte (.svelte)' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'sass', label: 'Sass' },
  { id: 'less', label: 'Less' },
  { id: 'stylus', label: 'Stylus' },
  { id: 'json', label: 'JSON' },
  { id: 'json5', label: 'JSON5' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'ini', label: 'INI' },
  { id: 'properties', label: '.properties' },
  { id: 'editorconfig', label: '.editorconfig' },
  { id: 'xml', label: 'XML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'sql', label: 'SQL' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'protobuf', label: 'Protocol Buffers' },
  { id: 'bash', label: 'Bash / Shell' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'batch', label: 'Batch' },
  { id: 'lua', label: 'Lua' },
  { id: 'r', label: 'R' },
  { id: 'perl', label: 'Perl' },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'erb', label: 'ERB' },
  { id: 'haml', label: 'Haml' },
  { id: 'pug', label: 'Pug' },
  { id: 'dart', label: 'Dart' },
  { id: 'swift', label: 'Swift' },
  { id: 'clojure', label: 'Clojure' },
  { id: 'lisp', label: 'Lisp' },
  { id: 'elixir', label: 'Elixir' },
  { id: 'erlang', label: 'Erlang' },
  { id: 'haskell', label: 'Haskell' },
  { id: 'ocaml', label: 'OCaml' },
  { id: 'tcl', label: 'Tcl' },
  { id: 'awk', label: 'AWK' },
  { id: 'jq', label: 'JQ' },
  { id: 'latex', label: 'LaTeX' },
  { id: 'docker', label: 'Dockerfile' },
  { id: 'makefile', label: 'Makefile' },
  { id: 'cmake', label: 'CMake' },
  { id: 'hcl', label: 'HCL / Terraform' },
  { id: 'nix', label: 'Nix' },
  { id: 'bicep', label: 'Bicep' },
  { id: 'git', label: 'git config' },
  { id: 'ignore', label: '.gitignore' },
  { id: 'diff', label: 'Diff' },
  { id: 'vim', label: 'Vim script' },
  { id: 'uri', label: 'URI' },
  { id: 'http', label: 'HTTP' },
  { id: 'systemd', label: 'systemd unit' },
  { id: 'nginx', label: 'nginx' },
  { id: 'xquery', label: 'XQuery' },
  { id: 'log', label: 'Log' },
]

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
    // Yalnızca Prism'in ürettiği <span class="..."> ve </span> etiketlerini gözet
    // Kod içindeki < veya > sembolleri Prism tarafından zaten &lt; veya &gt; yapılmıştır.
    const tagRegex = /<span\b[^>]*>|<\/span>/g
    let match: RegExpExecArray | null
    while ((match = tagRegex.exec(line)) !== null) {
      const fullTag = match[0]
      if (fullTag.startsWith('</')) {
        openTags.pop()
      } else {
        openTags.push(fullTag)
      }
    }
    const suffix = openTags
      .slice()
      .reverse()
      .map(() => '</span>')
      .join('')

    result.push(prefix + line + suffix)
  }
  return result
}

/**
 * Bir `data:` URL'inden `blob:` URL uretir.
 *
 * NEDEN AYRI FONKSIYON
 * --------------------
 * Onceki surum bunu `useEffect` icinde YAPIYORDU. `useEffect` ilk boyamadan
 * SONRA calistigi icin `<iframe src={pdfBlobUrl || preview.dataUrl}>` ifadesi
 * ilk karede `data:application/pdf;base64,...` degerini kullaniyordu ve
 * Chromium `data:` adresinden PDF eklentisini yuklemeyi REDDEDIYOR.
 * Sonuc: PDF bos bir cerceve olarak gorunuyor, kullanici "aciliyor ama
 * bos" diyordu. Artik deger `useMemo` ile ILK KARAMDA hazir.
 */
function dataUrlToBlobUrl(dataUrl: string, mimeType: string): string | null {
  try {
    const commaIdx = dataUrl.indexOf(',')
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: mimeType || 'application/octet-stream' }))
  } catch {
    return null
  }
}

function getYouTubeVideoId(urlOrId?: string): string | null {
  if (!urlOrId) return null
  const str = urlOrId.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str
  // ONCEKI SURUMDE EKSIK OLANLAR: /shorts/<id>, /live/<id>, /embed/<id>,
  // watch?v=, watch?app=desktop&v=, youtube-nocookie.com/embed/<id>.
  // Bu bicimlerde kimlik bulunamadigi icin gomulu video, OYNATILAMAYAN bir
  // <audio src="https://.../embed/ID"> etiketine dustu.
  const match = str.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|shorts\/|live\/|e\/)|[?&]v=)([a-zA-Z0-9_-]{11})/i,
  )
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
  /** PPTX için "tek tek slayt" / "tüm slaytlar (kaydırmalı)" görünümü. */
  const [slideView, setSlideView] = useState<'single' | 'continuous'>('continuous')
  /**
   * Kullanıcının dil seciciden zorladigi dil. `null` => otomatik tespit
   * (`preview.language`). Tahmin edilemedigi durumda kullanici buradan
   * duz metne dusmeden dogrudan bir dil secabilir.
   */
  const [languageOverride, setLanguageOverride] = useState<string | null>(null)

  const youtubeVideoId = useMemo(() => {
    return (
      attachment?.youTubeVideoId ||
      getYouTubeVideoId(attachment?.alternateLink) ||
      getYouTubeVideoId(preview?.title) ||
      getYouTubeVideoId(attachment?.title)
    )
  }, [attachment, preview])

  // PDF DataUrl'i Blob URL'e çevir.
  //
  // ÖNCEKİ SÜRÜM DÜZELTMESİ: `useEffect` ilk boyamadan SONRA çalıştığı
  // için iframe ilk karede `data:application/pdf;base64,…` adresini
  // kullanıyordu; Chromium `data:` adresinden PDF eklentisini yüklemeyi
  // reddediyor ve PDF boş çerçeve olarak görünüyordu. `useMemo` ile blob
  // adresi İLK KAREDE hazır olur.
  const pdfBlobUrl = useMemo(() => {
    if (preview?.kind !== 'pdf' || !preview.dataUrl) return null
    if (preview.dataUrl.startsWith('blob:') || preview.dataUrl.startsWith('http')) return preview.dataUrl
    return dataUrlToBlobUrl(preview.dataUrl, 'application/pdf')
  }, [preview?.kind, preview?.dataUrl])

  useEffect(() => {
    return () => {
      // Kapatılırken/geçişlerde belleği serbest bırak.
      if (pdfBlobUrl?.startsWith('blob:')) URL.revokeObjectURL(pdfBlobUrl)
    }
  }, [pdfBlobUrl])

  const contentRef = useRef<HTMLDivElement | null>(null)

  /* ------------------------------------------------------------------ *
   * PPTX: "tüm slaytlar (kaydırmalı)" görünümü altyapısı
   * ------------------------------------------------------------------ */
  /** Kaydırmalı görünümde kaydırma kapsayıcısı (IntersectionObserver kökü). */
  const slideScrollRef = useRef<HTMLDivElement | null>(null)
  /** Her slayt kartının DOM referansı (kaydırma takibi için). */
  const slideRefs = useRef<Array<HTMLDivElement | null>>([])

  /**
   * Slayta git. Tekli görünümde yalnızca dizini değiştirir; kaydırmalı
   * görünümde karta kaydırır. Kullanıcı "slaytlar tek sayfa görünüyor"
   * dediği için iki görünüm arasında geçiş yapılabilir olmalı.
   */
  const goToSlide = useCallback(
    (idx: number) => {
      const total = preview?.slides?.length ?? 0
      if (total === 0) return
      const clamped = Math.max(0, Math.min(idx, total - 1))
      setActiveSlideIndex(clamped)
      const root = slideScrollRef.current
      if (slideView === 'continuous') {
        const el = slideRefs.current[clamped]
        if (el && root) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else if (root) {
        root.scrollTo({ top: 0, behavior: 'smooth' })
      }
    },
    [preview?.slides?.length, slideView],
  )

  // Kaydırmalı görünümde görünürlük oranı en yüksek slaytı "aktif" yap.
  //
  // DUZELTME (scroll-spy yanlis slaydi isaretliyordu):
  // IntersectionObserver yalnizca ESIK DEGISTIREN ogeleri bildirir. Onceki
  // surum `entries` dizisi icinde en yuksek orani aryordu; o dizi tum
  // kartlari ICERMEZ, sadece o an esigi asanlari icerir. Bu yuzden aktif
  // slayt, ekranda en cok gorunen kart degil, rastgele bir esik gecis karti
  // olabiliyordu. Artik oranlar bir `Map` icinde tutuluyor ve secim
  // TUM kartlar arasindaki global maksimumdan yapiliyor.
  const slideCount = preview?.slides?.length ?? 0
  const slideFileId = preview?.fileId

  // Onceki dosyanin kart referanslari kalmasin (az slaytli yeni dosyada
  // yanlis karta kaydirma ve gozlemci hedefi tutulmamasi).
  useEffect(() => {
    slideRefs.current = []
  }, [slideFileId])

  useEffect(() => {
    if (!isOpen || slideView !== 'continuous' || slideCount === 0) return
    const root = slideScrollRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return

    const ratios = new Map<Element, number>()
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          ratios.set(entry.target, entry.intersectionRatio)
        }
        let bestEl: Element | null = null
        let bestRatio = 0
        ratios.forEach((ratio, el) => {
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestEl = el
          }
        })
        if (!bestEl || bestRatio < 0.15) return
        const idx = Number((bestEl as HTMLElement).dataset.slideIndex)
        if (Number.isFinite(idx)) setActiveSlideIndex(prev => (prev === idx ? prev : idx))
      },
      { root, threshold: [0, 0.15, 0.35, 0.6, 0.85, 1] },
    )
    for (const el of slideRefs.current) if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [isOpen, slideView, slideCount, slideFileId])

  // Dosya önizlemesini yukle
  //
  // ZAMAN ASIMI NEDEN VAR?
  // ----------------------
  // Kullanicinin bildirdigi: "PDF gördüğü gibi kalıyor, devamı gelmiyor."
  // Ekran "Belge Hazırlanıyor..." yazısında sonsuza kadar kalıyordu.
  //
  // Bu iki ayri bir arıza sınıfıdır:
  //   1) Ana süreçteki cıkarma yavaş/kilitli kalırsa IPC çözülmez. Artık
  //      cıkarma doğrusal (O(n)) ve sinirlidir, ama yine de bir garanti
  //      yoktur: cok buyuk/bozuk bir dosyada beklenmedik bir yol takilabilir.
  //   2) IPC katmani bir hataya duser, cevap donmezse ayni sonuc.
  //
  // Zaman asimi bu ikisini de yakalar: sure dolunca bekleme biter ve
  // kullanici BELIRLI bir hata mesaji gorur. Yalnizca donen bir
  // gosterge yerine acik bir aciklama alir; ayrica dosyayi indirip
  // harici bir okuyucuda acabilir.
  const PREVIEW_TIMEOUT_MS = 60_000

  const loadPreview = useCallback(async () => {
    if (!attachment) return
    setLoading(true)
    setError(null)
    let timer = 0
    try {
      // DIKKAT: `getFilePreview` SADECE BIR KEZ cagrilir. Zaman asimi
      // icin ikinci bir cagri yapmak isi ikiye katlar ve asil sorunu
      // (donen istek) yine cozmez; yalnizca daha cok is yaratirdi.
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(
          () =>
            reject(
              new Error(
                'Belge hazırlanamadı: işlem 60 saniyeyi aştı ve durduruldu. ' +
                  'Dosya çok büyük veya bozuk olabilir. Dosyayı indirip harici bir ' +
                  'okuyucuda açmayı deneyin.',
              ),
            ),
          PREVIEW_TIMEOUT_MS,
        )
      })
      const res = await Promise.race([window.jmcAPI.getFilePreview(attachment, courseId), timeout])
      setPreview(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya önizlemesi yüklenemedi.')
    } finally {
      if (timer) window.clearTimeout(timer)
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
      // Dil secimi dosyaya ozgudur; yeni dosyada otomatik tespit kullanilir.
      setLanguageOverride(null)
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
        goToSlide(activeSlideIndex - 1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goToSlide(activeSlideIndex + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, preview, activeSlideIndex, goToSlide])

  // Etkin dil: kullanici seciciden zorladiysa o, degilse servis tespiti.
  const activeLanguage = (languageOverride ?? preview?.language ?? 'text').toLowerCase().trim()

  /**
   * PrismJS dil grameri cozumlemesi.
   *
   * ONCEKI SURUMUN HATASI: elle yazilmis `if` zinciri `prism-*.js`
   * dosyalarindan daha az dili kapsiyordu ve zincirin sonundaki
   * `Prism.languages[lang]` fallback'i de yuklenmemis diller icin
   * `undefined` donuyordu -> dosya HIC renklendirilmeden gosteriliyordu.
   * Artik yuklenen tum diller `resolvePrismGrammar` ile tek noktadan
   * cozuluyor ve sonuc bulunamazsa `null` (duz metin) doner.
   */
  const prismGrammar = useMemo(() => resolvePrismGrammar(activeLanguage), [activeLanguage])

  /**
   * Gramer bulunamadi mi? Kullaniciya "dil secici" vurgulanarak gosterilir;
   * sessizce duz metne dusulmez.
   */
  const grammarMissing = !prismGrammar

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

  /**
   * Kod icindeki adresler.
   *
   * GEREKCE / YAKLASIM: Prism ciktiyi `<span>` tokenlarina boluyor ve bu
   * HTML `dangerouslySetInnerHTML` ile basiliyor. HTML stringi icine
   * `<a>` eklemek token sinirlarini bozuyor (kapatilan span'larin icinde
   * kalan etiketler) ve kullanici metnini HTML'e cevirmek XSS yuzeyi
   * buyutuyor. `ClickableText` de uygun degil: o bileseni kullanmak renk
   * kodunu tamamen atmayi gerektirirdi. Bu yuzden adresler PRISM SONRASI,
   * HAM metinden `findUrls` ile cikarilip kod blogunun altinda ayri bir
   * "bulunan baglantilar" listesi olarak gosterilir; hem tokenlara dokunulmaz
   * hem de XSS yuzeyi buyutulmez.
   */
  const codeLinks = useMemo(() => {
    if (!preview?.text || (preview.kind !== 'code' && preview.kind !== 'text')) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const hit of findUrls(preview.text)) {
      if (!isSafeExternalUrl(hit.url) || seen.has(hit.url)) continue
      seen.add(hit.url)
      out.push(hit.url)
      if (out.length >= 60) break
    }
    return out
  }, [preview?.text, preview?.kind])

  const filteredCodeRows = useMemo(() => {
    if (!searchQuery.trim()) return highlightedCodeLines
    const q = searchQuery.toLowerCase()
    return highlightedCodeLines.filter(row => row.raw.toLowerCase().includes(q))
  }, [highlightedCodeLines, searchQuery])

  /** Arama kutusunda gercekten bir sorgu var mi? */
  const isSearching = searchQuery.trim().length > 0

  // Tablo verisi ve filtreleme
  const filteredTableData = useMemo(() => {
    if (!preview?.tableData || preview.tableData.length === 0) return []
    if (!searchQuery.trim()) return preview.tableData
    const q = searchQuery.toLowerCase()
    const header = preview.tableData[0]
    const rows = preview.tableData.slice(1).filter(row =>
      row.some(cell => cell.toLowerCase().includes(q)),
    )
    // BOS DURUM DUZELTMESI: Onceki surum basligi daima geri dondurunce
    // `[header]` (uzunluk 1) kaliyor, `length > 0` testi gectigi icin bos
    // durum karti HIC gosterilmiyordu; ekranda yalnizca kolon basligi
    // duruyordu. Artik eslesme yoksa bos dizi doner.
    if (rows.length === 0) return []
    return [header, ...rows]
  }, [preview, searchQuery])

  /** PPTX görüntüleyicisi için daraltılmış (nullable) referans. */
  const slides = readSlides(preview)

  /* ------------------------------------------------------------------ *
   * DOCX: yapilandirilmis bloklar + arama
   * ------------------------------------------------------------------ */
  const docBlocks = readDocBlocks(preview)

  /**
   * Arama kutusuna gore suzulmus bloklar.
   *
   * BOS DURUM DUZELTMESI: Onceki surum `preview.paragraphs.filter(...)`
   * bos dondugunde dogrudan `preview.text` (BELGENIN TAMAMI) gosteriliyordu;
   * yani kullanici "hicbir eslesme yok" yerine butun dokumani goruyordu.
   * Artik arama sonucu bos ise acik bir bos durum kartı basilir.
   */
  const filteredDocBlocks = useMemo(() => {
    if (!docBlocks) return null
    const q = searchQuery.trim().toLowerCase()
    if (!q) return docBlocks
    const matches = (text: string) => text.toLowerCase().includes(q)
    return docBlocks.filter(block => {
      if (block.type === 'paragraph') return matches(block.text)
      return block.rows.some(row => row.some(cell => matches(cell)))
    })
  }, [docBlocks, searchQuery])

  /** Eslesen hucre sayisi (bos durum mesajinda kullanilir). */
  const docxMatchCount = useMemo(() => {
    if (!filteredDocBlocks) return 0
    return filteredDocBlocks.reduce((n, block) => {
      if (block.type === 'paragraph') return n + 1
      return n + block.rows.reduce((m, row) => m + row.filter(cell => cell.trim().length > 0).length, 0)
    }, 0)
  }, [filteredDocBlocks])

  /** Servis `docBlocks` gondermedigyse kullanilan geriye uyumlu duz paragraf listesi. */
  const legacyDocxParagraphs = useMemo(() => {
    if (docBlocks || !preview?.paragraphs || preview.paragraphs.length === 0) return []
    if (!isDocxSearching) return preview.paragraphs
    const q = searchQuery.trim().toLowerCase()
    return preview.paragraphs.filter(p => p.toLowerCase().includes(q))
    // isDocxSearching searchQuery'den turetilir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docBlocks, preview?.paragraphs, searchQuery])

  const isDocxSearching = searchQuery.trim().length > 0

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
        return <FileText className="h-5 w-5 text-[var(--jmc-primary-text)]" />
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
                {(preview?.kind === 'code' || preview?.kind === 'text') && activeLanguage && (
                  <span
                    title={
                      languageOverride
                        ? `Elle secildi (tespit: ${preview?.language || 'bilinmiyor'})`
                        : 'Dosya adindan otomatik tespit edildi'
                    }
                    className={`rounded px-1.5 py-0.2 font-mono font-medium uppercase ${
                      grammarMissing
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-indigo-500/15 text-indigo-400'
                    }${languageOverride ? ' ring-1 ring-indigo-400/50' : ''}`}
                  >
                    {activeLanguage}
                    {languageOverride ? ' (elle)' : ''}
                  </span>
                )}
                {preview?.kind !== 'code' && preview?.kind !== 'text' && preview?.language && (                  <span className="rounded bg-indigo-500/15 px-1.5 py-0.2 font-mono font-medium text-indigo-400 uppercase">
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
                    <Loader2 className="h-3 w-3 animate-spin text-[var(--jmc-primary-text)]" />
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
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--jmc-on-primary)] hover:text-[var(--jmc-on-primary-hover)] shadow-sm transition-all hover:bg-[var(--jmc-primary-hover)] active:scale-95 disabled:opacity-50"
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
                      codeWrap ? 'bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary-text)] font-semibold' : 'hover:text-[var(--jmc-text)]'
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
                            ? 'bg-[var(--jmc-primary)] text-[var(--jmc-on-primary)] font-medium'
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

                  {/* DIL SECICI
                      Servis `language` alanini her zaman doldurur; yine de
                      Prism'de grameri olmayan ya da yanlis tespit edilen
                      dosyalarda kullanici dogrudan dil secebilir. Gramer
                      bulunamadiysa secici vurgulanir ("dil secilemedi"). */}
                  <div className="flex items-center gap-1 border-l border-[var(--jmc-border)] pl-2">
                    <label htmlFor="jmc-code-language" className="text-[10px] text-[var(--jmc-text-dim)]">
                      Dil:
                    </label>
                    <select
                      id="jmc-code-language"
                      value={languageOverride ?? activeLanguage}
                      onChange={e => setLanguageOverride(e.target.value)}
                      title={
                        grammarMissing
                          ? 'Bu dil için sözdizimi tanımı yok. Bir dil seçerek renklendirmeyi etkinleştirin.'
                          : 'Sözdizimi renklendirme dilini değiştir'
                      }
                      className={`max-w-[9.5rem] rounded bg-[var(--jmc-bg-surface)] px-1.5 py-0.5 text-[10.5px] outline-none focus:border-[var(--jmc-primary)] ${
                        grammarMissing
                          ? 'border border-amber-500/50 text-amber-300'
                          : 'border border-[var(--jmc-border)] text-[var(--jmc-text-muted)]'
                      }`}
                    >
                      {SELECTABLE_LANGUAGES.map(lang => (
                        <option key={lang.id} value={lang.id}>
                          {lang.label}
                        </option>
                      ))}
                      {!SELECTABLE_LANGUAGES.some(l => l.id === activeLanguage) && (
                        <option value={activeLanguage}>{activeLanguage || 'Duz metin'}</option>
                      )}
                    </select>
                  </div>

                  {/* Arama sonucu sayaci (bos durumda da bilgi verir) */}
                  <div className="text-[10.5px] text-[var(--jmc-text-dim)] whitespace-nowrap">
                    {isSearching
                      ? `${filteredCodeRows.length} / ${highlightedCodeLines.length} satır`
                      : `${highlightedCodeLines.length} satır`}
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
                        ? 'bg-[var(--jmc-primary)] text-[var(--jmc-on-primary)] shadow-xs'
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
                        ? 'bg-[var(--jmc-primary)] text-[var(--jmc-on-primary)] shadow-xs'
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
                          ? 'bg-[var(--jmc-primary)] text-[var(--jmc-on-primary)] shadow-xs'
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
                          ? 'bg-[var(--jmc-primary)] text-[var(--jmc-on-primary)] shadow-xs'
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
                  <span className="text-[11px] text-[var(--jmc-text-dim)] whitespace-nowrap">
                    {isDocxSearching
                      ? `${docxMatchCount} eşleşme`
                      : `${preview.paragraphs?.length || 0} paragraf`}
                  </span>
                  {isDocxSearching && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      title="Aramayı temizle"
                      className="inline-flex items-center gap-1 rounded border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)]"
                    >
                      <X className="h-3 w-3" />
                      <span>Temizle</span>
                    </button>
                  )}
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
                  {slideView === 'continuous'
                    ? 'Tüm slaytlar kaydırılabilir · ← / → zıplar'
                    : 'Tekli görünüm · ← / → gezinir'}
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
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] whitespace-nowrap ${
                      searchQuery.trim() && filteredTableData.length === 0
                        ? 'text-amber-400'
                        : 'text-[var(--jmc-text-dim)]'
                    }`}
                  >
                    {searchQuery.trim()
                      ? filteredTableData.length > 0
                        ? `${filteredTableData.length - 1} satır listeleniyor`
                        : 'Eşleşen satır yok'
                      : filteredTableData.length > 0
                        ? `${filteredTableData.length - 1} satır listeleniyor`
                        : 'Satır yok'}
                  </span>
                  {searchQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      title="Filtreyi temizle"
                      className="inline-flex items-center gap-1 rounded border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)]"
                    >
                      <X className="h-3 w-3" />
                      <span>Temizle</span>
                    </button>
                  )}
                </div>
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
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--jmc-primary-text)]" />
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
                    {/* Yerleşik oynatıcı engellenirse (gömül oynatma kapalı, ağ
                        kısıtı, özel video) kullanıcı tek tıkla sistem
                        tarayıcısına geçebilsin. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void window.jmcAPI?.openExternalUrl(`https://www.youtube.com/watch?v=${youtubeVideoId}`)
                        }
                        title="Videoyu YouTube'da aç (gömül oynatıcı engellenirse)"
                        className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-white/20 bg-white/10 px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-white/20 transition-all"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Tarayıcıda İzle</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const share = `https://www.youtube.com/watch?v=${youtubeVideoId}`
                          void window.jmcAPI?.copyText(share)
                          setLinkCopied(true)
                          setTimeout(() => setLinkCopied(false), 2000)
                        }}
                        title="YouTube bağlantısını kopyala"
                        className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-white/20 bg-white/10 px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-white/20 transition-all"
                      >
                        {linkCopied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Link className="h-3.5 w-3.5" />
                        )}
                        <span>{linkCopied ? 'Kopyalandı' : 'Bağlantıyı Kopyala'}</span>
                      </button>
                      {attachment?.alternateLink && (
                        <button
                          type="button"
                          onClick={() => void window.jmcAPI?.openExternalUrl(attachment.alternateLink!)}
                          className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-white/20 bg-white/10 px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-white/20 transition-all"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>Classroom'da Aç</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* --- 1. KOD VE METİN GÖRÜNTÜLEYİCİ (PrismJS Sözdizimi, Eşzamanlı Satır Numaraları, Arama ve Satır Aralığı) ---
                   *
                   * `overflow-x-auto` + `w-max/min-w-full` sarmalayıcısı eklendi:
                   * daha önce uzun satırlar `overflow-x-visible` ile dışarı taşıyor
                   * ve modalın `overflow-auto` kapsayıcısı tarafından KIRPILIYORDU
                   * ("renkli satırlar düzgün değil" şikâyetinin görünüm kısmı).
                   */}
                  {(preview.kind === 'code' || preview.kind === 'text') && (
                    <div
                      className="font-mono text-[12px] select-text min-h-full bg-[var(--jmc-bg)]"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      <div className="w-full py-2 overflow-x-auto">
                        <div className="w-max min-w-full">
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
                                  className={`flex-1 pl-4 pr-6 font-mono ${
                                    codeWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                                  } ${isMatch ? 'text-amber-200' : 'text-[var(--jmc-text)]'}`}
                                  dangerouslySetInnerHTML={{ __html: row.html }}
                                />
                              </div>
                            )
                          })}
                          {filteredCodeRows.length === 0 && (
                            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                              <Search className="h-6 w-6 text-[var(--jmc-text-dim)] opacity-60" />
                              <p className="text-[12.5px] font-medium text-[var(--jmc-text)]">
                                {isSearching
                                  ? `"${searchQuery}" için eşleşen satır yok`
                                  : 'Dosya boş görünüyor'}
                              </p>
                              <p className="max-w-sm text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                                {isSearching
                                  ? `Bu dosyanın ${highlightedCodeLines.length} satırının hiçbiri arama metnini içermiyor. Farklı bir sözcük deneyebilir ya da arama kutusunu temizleyebilirsiniz.`
                                  : 'Dosya çözülüyor ancak içinde okunabilir metin yok. Dosyayı harici uygulamada açmayı deneyebilirsiniz.'}
                              </p>
                              {isSearching && (
                                <button
                                  type="button"
                                  onClick={() => setSearchQuery('')}
                                  className="mt-1 rounded border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)]"
                                >
                                  Aramayı Temizle
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Bulunan baglantilar
                          Token'lara dokunmadan, Prism SONRASI ham metinden
                          cikarilan adresler. Renk kodunun HTML'ine gommeden
                          tiklanabilir olmalari bu yolla saglanir. */}
                      {codeLinks.length > 0 && (
                        <div className="border-t border-[var(--jmc-border-subtle)] px-4 py-3 font-sans">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--jmc-text-muted)]">
                            <Link className="h-3.5 w-3.5" />
                            <span>
                              Bulunan bağlantılar ({codeLinks.length})
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {codeLinks.map(url => (
                              <a
                                key={url}
                                href={url.startsWith('www.') ? `https://${url}` : url}
                                title={url}
                                onClick={e => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  void window.jmcAPI?.openExternalUrl(
                                    url.startsWith('www.') ? `https://${url}` : url,
                                  )
                                }}
                                rel="noreferrer noopener"
                                className="max-w-[26rem] truncate rounded border border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-surface)] px-2 py-0.5 text-[11px] text-[var(--jmc-link)] underline underline-offset-2 hover:opacity-80"
                              >
                                {url}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
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

                  {/* --- 3. PDF GÖRÜNTÜLEYİCİ (YALNIZCA Blob URL) ---
                      *
                      * `data:` adresi Chromium PDF eklentisini yüklemez; daha önce
                      * `src={pdfBlobUrl || preview.dataUrl}` yazıyordu ve blob
                      * üretilemediğinde sessizce boş çerçeve gösteriyordu. Artık
                      * embed modu BLOB OLMAYAN durumda açıkça "açılamıyor" kartı
                      * gösterir ve kullanıcıyı ayıklanan metne / sistem okuyucusuna
                      * yönlendirir.
                      */}
                  {preview.kind === 'pdf' && (
                    <div className="h-full w-full flex flex-col">
                      {pdfMode === 'embed' && pdfBlobUrl ? (
                        <embed
                          src={`${pdfBlobUrl}#toolbar=1&navpanes=0&view=FitH`}
                          type="application/pdf"
                          title={preview.title || 'PDF Belgesi'}
                          className="h-full w-full flex-1 border-0 bg-neutral-900 rounded-b-xl"
                        />
                      ) : pdfMode === 'embed' ? (
                        <div className="grid h-full place-items-center p-8">
                          <div className="max-w-md space-y-4 rounded-xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-7 text-center">
                            <FileText className="mx-auto h-10 w-10 text-rose-400" />
                            <h4 className="text-[14px] font-semibold text-[var(--jmc-text)]">
                              PDF Görünümü Açılamadı
                            </h4>
                            <p className="text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                              Chromium'un yerleşik PDF görüntüleyicisi bu dosyayı işleyemedi
                              (şifreli PDF, bozuk sayfa yapısı veya desteklenmeyen sürüm).
                              Aşağıdaki seçeneklerden birini kullanabilirsiniz.
                            </p>
                            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setPdfMode('text')}
                                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3.5 py-2 text-[12px] font-semibold text-[var(--jmc-on-primary)] hover:text-[var(--jmc-on-primary-hover)] transition-all hover:bg-[var(--jmc-primary-hover)] active:scale-95"
                              >
                                <BookOpen className="h-3.5 w-3.5" />
                                <span>Ayıklanan Metni Gör</span>
                              </button>
                              {(downloadedPath || preview.localPath) && (
                                <button
                                  type="button"
                                  onClick={handleOpenFile}
                                  className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-3.5 py-2 text-[12px] font-medium text-[var(--jmc-text)] transition-all hover:border-[var(--jmc-primary)] active:scale-95"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 text-rose-400" />
                                  <span>Sistemde Aç</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-6 md:p-8 max-w-4xl mx-auto w-full">
                          <div className="rounded-2xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-6 md:p-8 shadow-md">
                            <div className="flex items-center justify-between border-b border-[var(--jmc-border-subtle)] pb-3.5 mb-5">
                              <div>
                                <h4 className="text-[14px] font-bold text-[var(--jmc-text)]">
                                  {preview.title || 'PDF Ayıklanan Metin İçeriği'}
                                </h4>
                                <p className="text-[11px] text-[var(--jmc-text-dim)] mt-0.5">
                                  PDF Belgesi · Yapılandırılmış Metin Görünümü
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={handleCopy}
                                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] border border-[var(--jmc-border)]"
                              >
                                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                                <span>{copied ? 'Kopyalandı' : 'Tüm Metni Kopyala'}</span>
                              </button>
                            </div>
                            {preview.text ? (
                              <div className="space-y-3 select-text">
                                {preview.text
                                  .split(/\n{2,}/)
                                  .map(block => block.trim())
                                  .filter(Boolean)
                                  .map((block, bIdx) => {
                                    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
                                    return (
                                      <div key={bIdx} className="space-y-2">
                                        {lines.map((line, lIdx) => {
                                          const bulletMatch = /^(?:[•●▪▸\-*]|¥)\s+(.*)$/.exec(line)
                                          const numberedHeading = /^(\d+\.\s+[^:]+:.*)$/.exec(line)
                                          if (bulletMatch) {
                                            return (
                                              <div
                                                key={lIdx}
                                                className="flex items-start gap-2.5 pl-2 py-0.5 text-[13px] leading-relaxed text-[var(--jmc-text)]"
                                              >
                                                <span className="text-[var(--jmc-primary-text)] font-bold select-none mt-0.5">
                                                  •
                                                </span>
                                                <ClickableText
                                                  text={bulletMatch[1]}
                                                  className="flex-1 font-sans text-[13px] leading-relaxed text-[var(--jmc-text)]"
                                                />
                                              </div>
                                            )
                                          }
                                          if (numberedHeading || (bIdx === 0 && lIdx === 0 && line.length < 110)) {
                                            return (
                                              <h5
                                                key={lIdx}
                                                className="font-sans text-[14px] font-semibold text-[var(--jmc-text)] pt-1"
                                              >
                                                <ClickableText text={line} preserveWhitespace={false} />
                                              </h5>
                                            )
                                          }
                                          return (
                                            <p
                                              key={lIdx}
                                              className="font-sans text-[13px] leading-relaxed text-[var(--jmc-text)]"
                                            >
                                              <ClickableText text={line} />
                                            </p>
                                          )
                                        })}
                                      </div>
                                    )
                                  })}
                              </div>
                            ) : (
                              <p className="font-sans text-[13px] leading-relaxed text-[var(--jmc-text-muted)]">
                                Bu PDF dosyasından metin ayıklanamadı. PDF Görünümünü kullanın.
                              </p>
                            )}
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
                          {/* BOS DURUM: arama sonucu yok veya dokumanin
                              metin katmani bos. Onceki surum, arama sonucu
                              bos oldugunda butun dokumani (`preview.text`)
                              gosteriyordu; artik acik bir bos durum karti
                              basiliyor. */}
                          {filteredDocBlocks ? (
                            filteredDocBlocks.length === 0 ? (
                              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--jmc-border)] bg-[var(--jmc-bg)]/40 px-6 py-10 text-center">
                                <Search className="h-6 w-6 text-[var(--jmc-text-dim)] opacity-60" />
                                <p className="text-[13px] font-semibold text-[var(--jmc-text)]">
                                  {isDocxSearching
                                    ? `"${searchQuery}" için eşleşme bulunamadı`
                                    : 'Bu dokümanda okunabilir içerik yok'}
                                </p>
                                <p className="max-w-sm text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                                  {isDocxSearching
                                    ? 'Arama terimi bu Word belgesinin paragraflarında ve tablolarında geçmiyor. Farklı bir sözcük deneyebilir ya da arama kutusunu temizleyebilirsiniz.'
                                    : 'DOCX metin katmanı boş görünüyor (yalnızca görsel içerik olabilir). Dosyayı Word ya da LibreOffice ile açmayı deneyebilirsiniz.'}
                                </p>
                                {isDocxSearching && (
                                  <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="mt-1 rounded border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)]"
                                  >
                                    Aramayı Temizle
                                  </button>
                                )}
                              </div>
                            ) : (
                              filteredDocBlocks.map((block, idx) => {
                                if (block.type === 'table') {
                                  return (
                                    <div
                                      key={`tbl-${idx}`}
                                      className="my-4 overflow-x-auto rounded-lg border border-[var(--jmc-border)]"
                                    >
                                      <table className="w-full border-collapse text-left text-[12px]">
                                        <tbody>
                                          {/* HER `<w:tr>` AYRI BIR `<tr>`, HER
                                              `<w:tc>` AYRI BIR `<td>`. Bos
                                              hucreler korunur; sutun sayisi
                                              satirlar arasinda tutarlidir. */}
                                          {block.rows.map((row, rIdx) => (
                                            <tr
                                              key={`r-${rIdx}`}
                                              className={`border-b border-[var(--jmc-border-subtle)] last:border-0 ${
                                                rIdx === 0
                                                  ? 'bg-[var(--jmc-bg)]/60 font-medium'
                                                  : 'hover:bg-[var(--jmc-bg)]/35'
                                              }`}
                                            >
                                              {row.map((cell, cIdx) => {
                                                const cellUrl = block.cellUrls?.[rIdx]?.[cIdx]
                                                return (
                                                  <td
                                                    key={`c-${cIdx}`}
                                                    className="px-3.5 py-2 align-top border-r border-[var(--jmc-border-subtle)] last:border-0 text-[var(--jmc-text)]"
                                                  >
                                                    {cellUrl ? (
                                                      <a
                                                        href={cellUrl}
                                                        onClick={e => {
                                                          e.preventDefault()
                                                          e.stopPropagation()
                                                          void window.jmcAPI?.openExternalUrl(cellUrl)
                                                        }}
                                                        rel="noreferrer noopener"
                                                        className="text-[var(--jmc-link)] underline underline-offset-2 hover:opacity-80 break-all"
                                                      >
                                                        <ClickableText
                                                          text={cell || cellUrl}
                                                          preserveWhitespace={false}
                                                        />
                                                      </a>
                                                    ) : (
                                                      <ClickableText text={cell || ' '} preserveWhitespace={false} />
                                                    )}
                                                  </td>
                                                )
                                              })}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )
                                }

                                const isMatch =
                                  isDocxSearching &&
                                  block.text.toLowerCase().includes(searchQuery.trim().toLowerCase())

                                if (block.bullet) {
                                  return (
                                    <div
                                      key={`p-${idx}`}
                                      className={`flex items-start gap-2.5 pl-3 py-0.5 text-[13px] leading-relaxed ${
                                        isMatch
                                          ? 'bg-amber-500/15 text-amber-200 rounded px-2'
                                          : 'text-[var(--jmc-text)]'
                                      }`}
                                    >
                                      <span className="text-[var(--jmc-primary-text)] font-bold select-none">•</span>
                                      <DocxParagraphText text={block.text} url={block.url} />
                                    </div>
                                  )
                                }

                                return (
                                  <p
                                    key={`p-${idx}`}
                                    className={`text-[13px] leading-relaxed transition-colors ${
                                      isMatch
                                        ? 'bg-amber-500/15 text-amber-200 font-medium rounded p-1.5'
                                        : 'text-[var(--jmc-text)]'
                                    }`}
                                  >
                                    <DocxParagraphText text={block.text} url={block.url} />
                                  </p>
                                )
                              })
                            )
                          ) : legacyDocxParagraphs.length > 0 ? (
                            /* Servis yapilandirilmis blok gondermediyse eski
                               duz-paragraf yolu (geriye uyum). */
                            legacyDocxParagraphs.map((p, idx) => (
                              <p key={idx} className="text-[13px] leading-relaxed text-[var(--jmc-text)]">
                                <ClickableText text={p} preserveWhitespace={false} />
                              </p>
                            ))
                          ) : (
                            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--jmc-border)] bg-[var(--jmc-bg)]/40 px-6 py-10 text-center">
                              <Search className="h-6 w-6 text-[var(--jmc-text-dim)] opacity-60" />
                              <p className="text-[13px] font-semibold text-[var(--jmc-text)]">
                                {isDocxSearching
                                  ? `"${searchQuery}" için eşleşme bulunamadı`
                                  : 'Bu dokümanda okunabilir içerik yok'}
                              </p>
                              <ClickableText
                                text={
                                  isDocxSearching
                                    ? 'Arama terimi bu Word belgesinin paragraflarında geçmiyor.'
                                    : preview.text || 'DOCX metin katmanı boş görünüyor.'
                                }
                                className="block text-[12px] leading-relaxed text-[var(--jmc-text-muted)]"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* --- 5. POWERPOINT / PPTX SLAYT GÖRÜNTÜLEYİCİ ---
                   *
                   * KULLANICI ŞİKÂYETİ: "slaytlar tek sayfa olarak görünüyor".
                   * ÇÖZÜM: `slideView` iki mod sunar —
                   *   'continuous' (varsayılan): TÜM slaytlar tek bir kaydırmalı
                   *     sütunda, aralarında boşlukla dizilir. Kaydırma konumu
                   *     IntersectionObserver ile takip edilir, alt çubuktaki
                   *     numara vurgusu ve üst bilgi çubuğu canlı güncellenir.
                   *   'single': eski davranış — yalnızca aktif slayt.
*
                   * KART KUCULMESI: `shrink-0` ZORUNLU
                   * ----------------------------------
                   * Kullanici: "cok uzun olan sayfalar alta dogru gidiyor
                   * ama arkas[i] bos kaliyor" - madde listesi kartin disinda,
                   * sayfa zemini uzerinde gorunuyordu; alt bilgi cubugu bile
                   * kartin disinda kaliyordu.
                   *
                   * GERCEK KOK NEDEN (ilk tespit yanlisti, duzeltildi):
                   * Ust kapayici su yapida:
                   *
                   *   flex-1 min-h-0 overflow-y-auto ... flex flex-col
                   *
                   * `flex-1` + `min-h-0` kapayiciya BELIRLI bir yukseklik
                   * verir. Bir flex SUTUNunda icerik bu yuksekligi asarsa,
                   * varsayilan `flex-shrink: 1` olan ogeler KUCULTULUR.
                   * Oge kuculur; `overflow` varsayilan `visible` oldugu icin
                   * icerigi tasar - arka plan ise yalnizca kucultulmus kutuyu
                   * kaplar. Tam olarak gorulen budur.
                   *
                   * Surekli gorunumdeki kartta `shrink-0` VARDI ve hicbir
                   * sorun yoktu. TEK SLAYT gorunumundeki karda `shrink-0`
                   * YOKTU; `min-h-[380px]` de buna ek olarak taban yuksekligi
                   * veriyordu. Kullanici ekran goruntusunde gordugu da tam
                   * olarak bu dal (tek slayt + klavye ipucu).
                   *
                   * Duzeltme: `shrink-0` eklendi. `h-fit` TEK BASINA
                   * YETMEZDI - flex-shrink taban yuksekligi `fit-content`
                   * olsa bile kucultebilir. Bu yuzden `h-fit` kaldirilip
                   * yerine `shrink-0` kullanildi.
                   *
                   * `justify-between` geri getirildi: `min-h-[380px]`
                   * sayesinde kisa slaytlarda alt bilgi asagi yaslanir.
                   * Uzun icerikte bosluk olmadigi icin zaten etkisizdir.
                   */}
                  {preview.kind === 'pptx' && slides && (
                    <div className="flex h-full min-h-0 flex-col overflow-hidden">
                      {/* Slayt İçerik Alanı */}
                      <div
                        ref={slideScrollRef}
                        className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8 flex flex-col items-center gap-6"
                      >
                        {slides.length === 0 ? (
                          <p className="text-[12px] text-[var(--jmc-text-muted)] my-auto">
                            Bu sunumda okunabilir slayt bulunamadı.
                          </p>
                        ) : slideView === 'continuous' ? (
                          slides.map((slide, idx) => (
                            <div
                              key={`${slide.slideNumber || idx}-${idx}`}
                              data-slide-index={idx}
                              ref={el => {
                                slideRefs.current[idx] = el
                              }}
                              className={`w-full max-w-4xl shrink-0 h-fit scroll-mt-4 rounded-2xl border bg-[var(--jmc-bg-surface)] p-6 md:p-10 shadow-2xl transition-all ${
                                idx === activeSlideIndex
                                  ? 'border-[var(--jmc-primary)]/70 ring-1 ring-[var(--jmc-primary)]/30'
                                  : 'border-[var(--jmc-border)]'
                              }`}
                            >
                              <div>
                                <div className="flex items-center justify-between text-[11px] text-[var(--jmc-text-dim)] border-b border-[var(--jmc-border-subtle)] pb-3">
                                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-400 px-2.5 py-0.5 font-semibold text-[10.5px]">
                                    <Presentation className="h-3 w-3" />
                                    Slayt {idx + 1} / {slides.length}
                                  </span>
                                  <span className="truncate max-w-xs">{preview.title}</span>
                                </div>
                                <h2 className="mt-5 text-[20px] md:text-[24px] font-bold text-[var(--jmc-text)] tracking-tight">
                                  {<DocxParagraphText text={slide.title || `Slayt ${idx + 1}`} url={slide.titleUrl} />}
                                </h2>
                                {slide.bullets.length > 0 ? (
                                  <ul className="mt-6 space-y-3 text-[13.5px] md:text-[14.5px] text-[var(--jmc-text)] list-disc pl-6 leading-relaxed select-text">
                                    {slide.bullets.map((bullet, bIdx) => (
                                      <li key={bIdx} className="leading-relaxed">
                                        <DocxParagraphText text={bullet} url={slide.bulletUrls?.[bIdx]} />
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="mt-6 text-[13px] italic text-[var(--jmc-text-dim)]">
                                    Bu slaytta madde imli metin bulunmuyor veya slayt yalnızca
                                    görsel/şema içeriyor olabilir.
                                  </p>
                                )}
                              </div>
                              <div className="mt-8 pt-4 border-t border-[var(--jmc-border-subtle)] flex items-center justify-between text-[11px] text-[var(--jmc-text-dim)]">
                                <span>Kaydırarak tüm sunumu okuyabilirsiniz</span>
                                <span className="font-mono">
                                  {Math.round(((idx + 1) / slides.length) * 100)}%
                                </span>
                              </div>
                            </div>
                          ))
                        ) : slides[activeSlideIndex] ? (
                          <div className="w-full max-w-4xl shrink-0 my-auto h-fit min-h-[380px] rounded-2xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-6 md:p-10 shadow-2xl flex flex-col justify-between transition-all">
                            <div>
                              <div className="flex items-center justify-between text-[11px] text-[var(--jmc-text-dim)] border-b border-[var(--jmc-border-subtle)] pb-3">
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-400 px-2.5 py-0.5 font-semibold text-[10.5px]">
                                  <Presentation className="h-3 w-3" />
                                  Slayt {activeSlideIndex + 1} / {slides.length}
                                </span>
                                <span className="truncate max-w-xs">{preview.title}</span>
                              </div>
                              <h2 className="mt-5 text-[20px] md:text-[24px] font-bold text-[var(--jmc-text)] tracking-tight">
                                {<DocxParagraphText
                                    text={slides[activeSlideIndex].title || `Slayt ${activeSlideIndex + 1}`}
                                    url={slides[activeSlideIndex].titleUrl}
                                  />}
                              </h2>
                              {slides[activeSlideIndex].bullets.length > 0 ? (
                                <ul className="mt-6 space-y-3 text-[13.5px] md:text-[14.5px] text-[var(--jmc-text)] list-disc pl-6 leading-relaxed select-text">
                                  {slides[activeSlideIndex].bullets.map((bullet, bIdx) => (
                                    <li key={bIdx} className="leading-relaxed">
                                      <DocxParagraphText
                                        text={bullet}
                                        url={slides[activeSlideIndex].bulletUrls?.[bIdx]}
                                      />
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-6 text-[13px] italic text-[var(--jmc-text-dim)]">
                                  Bu slaytta madde imli metin bulunmuyor veya slayt yalnızca
                                  görsel/şema içeriyor olabilir.
                                </p>
                              )}
                            </div>

                            {/* Klavye ipucu BURADAN kaldirildi. Ic kartin
                                en altinda bulundugu icin kayan alan
                                tasmasinda pencerenin altinda KIRPILIYORDU.
                                Artik sabit alt kontrol cubugunda, icerik
                                alanindan DISARIDA ve `shrink-0` ile
                                gosteriliyor; hicbir kaydirma konumunda
                                kesilemez. */}
                            <div className="mt-8 pt-4 border-t border-[var(--jmc-border-subtle)] flex items-center justify-end text-[11px] text-[var(--jmc-text-dim)]">
                              <span className="font-mono">
                                {Math.round(((activeSlideIndex + 1) / slides.length) * 100)}%
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
                            onClick={() => goToSlide(activeSlideIndex - 1)}
                            title="Önceki Slayt (Sol Ok)"
                            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--jmc-text)] shadow-xs transition-all hover:bg-[var(--jmc-primary)] hover:text-[var(--jmc-on-primary)] hover:border-[var(--jmc-primary)] disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            <span>Önceki</span>
                          </button>
                          <button
                            type="button"
                            disabled={activeSlideIndex >= slides.length - 1}
                            onClick={() => goToSlide(activeSlideIndex + 1)}
                            title="Sonraki Slayt (Sağ Ok)"
                            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--jmc-text)] shadow-xs transition-all hover:bg-[var(--jmc-primary)] hover:text-[var(--jmc-on-primary)] hover:border-[var(--jmc-primary)] disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                          >
                            <span>Sonraki</span>
                            <ChevronRight className="h-4 w-4" />
                          </button>

                          {/* Görünüm Modu Anahtarı */}
                          <div className="flex items-center rounded bg-[var(--jmc-bg)] p-0.5 border border-[var(--jmc-border)] ml-1">
                            <button
                              type="button"
                              onClick={() => setSlideView('continuous')}
                              title="Tüm slaytları tek sayfada kaydırarak göster"
                              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-medium transition-all ${
                                slideView === 'continuous'
                                  ? 'bg-[var(--jmc-primary)] text-[var(--jmc-on-primary)]'
                                  : 'text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                              }`}
                            >
                              <Layers className="h-3 w-3" />
                              <span>Tümü</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setSlideView('single')}
                              title="Yalnızca aktif slaydı göster"
                              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-medium transition-all ${
                                slideView === 'single'
                                  ? 'bg-[var(--jmc-primary)] text-[var(--jmc-on-primary)]'
                                  : 'text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                              }`}
                            >
                              <AlignJustify className="h-3 w-3" />
                              <span>Tekli</span>
                            </button>
                          </div>
                        </div>

                        {/* Slayt Numaraları / Hızlı Atlama Çubuğu */}
                        <div className="flex items-center gap-1 overflow-x-auto max-w-xl py-1 no-scrollbar">
                          {slides.map((s, idx) => (
                            <button
                              key={s.slideNumber || idx}
                              type="button"
                              onClick={() => goToSlide(idx)}
                              title={`Slayt ${idx + 1}: ${s.title || 'Başlıksız'}`}
                              className={`h-7 min-w-[28px] px-1.5 rounded text-[11px] font-mono transition-all ${
                                activeSlideIndex === idx
                                  ? 'bg-[var(--jmc-primary)] text-[var(--jmc-on-primary)] font-bold shadow-xs scale-105'
                                  : 'bg-[var(--jmc-bg)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] border border-[var(--jmc-border-subtle)]'
                              }`}
                            >
                              {idx + 1}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11.5px] font-semibold text-[var(--jmc-text)]">
                            {activeSlideIndex + 1} / {slides.length}
                          </span>
                        </div>
                      </div>

                      {/* KLAVYE IPUCU SABIT CUBUKTA
                          Onceki surumde bu ipucu kaydirma alanindaki slayt
                          kartinin EN ALTINDA bulunuyordu; kayan alan
                          tasmadigi icin kartin alti pencerenin disinda
                          kalip metin KIRPILIYORDU. Simdi bu cubuk
                          `shrink-0` oldugu icin hicbir kaydirma
                          konumunda kesilemez. */}
                      <div className="shrink-0 -mt-1 flex items-center justify-center gap-2 border-t border-[var(--jmc-border-subtle)]/70 px-4 pb-2 pt-1.5 text-[10.5px] text-[var(--jmc-text-dim)]">
                        <ChevronLeft className="h-3 w-3" />
                        <span>Sol / Sağ ok tuşları ile slaytlar arasında gezinebilirsiniz</span>
                        <ChevronRight className="h-3 w-3" />
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
                                      <ClickableText text={cell} preserveWhitespace={false} />
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-10 text-center">
                          <Search className="h-6 w-6 text-[var(--jmc-text-dim)] opacity-60" />
                          <p className="text-[13px] font-semibold text-[var(--jmc-text)]">
                            {searchQuery.trim()
                              ? `"${searchQuery}" için eşleşen satır yok`
                              : 'Veri bulunamadı'}
                          </p>
                          <p className="max-w-sm text-[11.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                            {searchQuery.trim()
                              ? 'Arama terimi bu tablodaki hiçbir hücrede geçmiyor. Farklı bir sözcük deneyin ya da filtreyi temizleyin.'
                              : 'Bu dosyadan okunabilir tablo satırı çıkarılamadı.'}
                          </p>
                          {searchQuery.trim() && (
                            <button
                              type="button"
                              onClick={() => setSearchQuery('')}
                              className="mt-1 rounded border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)]"
                            >
                              Filtreyi Temizle
                            </button>
                          )}
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
                          <FileVideo className="mx-auto h-12 w-12 text-[var(--jmc-primary-text)]" />
                          <h4 className="text-[14px] font-semibold text-[var(--jmc-text)]">
                            {preview.title}
                          </h4>
                          <audio controls src={preview.dataUrl} className="w-80" />
                        </div>
                      )}
                    </div>
                  )}

                  {/* --- 9. BAĞLANTI (LINK) KARTI GÖRÜNTÜLEYİCİ ---
                   *
                   * ÇİFT GÖSTERİM HATASI DÜZELTMESİ:
                   * Koşul `preview.kind === 'text'` dalını da kapsıyordu. `kind`
                   * 'text' olduğunda yukarıdaki KOD VE METİN GÖRÜNTÜLEYİCİ de
                   * çiziliyor, dolayısıyla içerik "2 kere" basılıyordu.
                   * Artık bağlantı kartı YALNIZCA gerçek bir bağlantı ya da
                   * (bağlantısı olup da başka görüntüleyicisi bulunmayan) ikili
                   * dosya için çizilir.
                   */}
                  {(preview.kind === 'link' ||
                    (preview.kind === 'binary' && Boolean(attachment.alternateLink))) && (
                    <div className="p-8 max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[350px]">
                      <div className="w-full rounded-2xl border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-8 shadow-xl text-center space-y-4">
                        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--jmc-primary)]/15 text-[var(--jmc-primary-text)]">
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
                            className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-4 py-2 text-[12px] font-semibold text-[var(--jmc-on-primary)] hover:text-[var(--jmc-on-primary-hover)] shadow-md hover:bg-[var(--jmc-primary-hover)] active:scale-95 transition-all"
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
                              className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] border border-[var(--jmc-primary)]/30 bg-[var(--jmc-primary)]/10 px-3.5 py-2 text-[12px] font-medium text-[var(--jmc-primary-text)] hover:bg-[var(--jmc-primary)]/20 active:scale-95 transition-all"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>Asistan ile İncele</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* --- 10. İKİLİ (BINARY) DOSYA BİLGİ KARTI --- */}
                  {preview.kind === 'binary' && !attachment.alternateLink && (
                    <div className="p-6 max-w-4xl mx-auto">
                      <ClickableText
                        text={preview.text || 'Bu dosya metin olarak okunamadı.'}
                        className="block font-mono text-[12.5px] leading-relaxed text-[var(--jmc-text)]"
                      />
                    </div>
                  )}

                  {/* Hiçbir özel görüntüleyiciye düşmeyen türler için son çare. */}
                  {preview.kind !== 'code' &&
                    preview.kind !== 'text' &&
                    preview.kind !== 'markdown' &&
                    preview.kind !== 'pdf' &&
                    preview.kind !== 'docx' &&
                    preview.kind !== 'pptx' &&
                    preview.kind !== 'csv' &&
                    preview.kind !== 'xlsx' &&
                    preview.kind !== 'image' &&
                    preview.kind !== 'media' &&
                    preview.kind !== 'link' &&
                    preview.kind !== 'binary' && (
                      <div className="p-6 max-w-4xl mx-auto space-y-3">
                        <div className="flex items-center gap-2 text-[12px] text-[var(--jmc-text-dim)]">
                          <AlertCircle className="h-4 w-4 text-amber-400" />
                          <span>
                            <strong className="text-[var(--jmc-text)]">{preview.title}</strong> için
                            özel bir görüntüleyici yok; ham içerik aşağıda gösteriliyor.
                          </span>
                        </div>
                        <ClickableText
                          text={preview.text || 'İçerik bulunamadı.'}
                          className="block font-mono text-[12px] leading-relaxed text-[var(--jmc-text)]"
                        />
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
