import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertCircle, Check, Copy, ExternalLink } from 'lucide-react'
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

interface MarkdownViewProps {
  content: string
  className?: string
  isUser?: boolean
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

function getPrismGrammar(lang?: string): { grammar: Prism.Grammar; langKey: string } | null {
  if (!lang) return null
  const l = lang.toLowerCase().trim()
  if (l === 'ts' || l === 'typescript' || l === 'tsx') {
    return { grammar: Prism.languages.typescript || Prism.languages.javascript, langKey: 'typescript' }
  }
  if (l === 'js' || l === 'javascript' || l === 'jsx') {
    return { grammar: Prism.languages.javascript, langKey: 'javascript' }
  }
  if (l === 'py' || l === 'python') return { grammar: Prism.languages.python, langKey: 'python' }
  if (l === 'java') return { grammar: Prism.languages.java, langKey: 'java' }
  if (l === 'c') return { grammar: Prism.languages.c, langKey: 'c' }
  if (l === 'cpp' || l === 'c++') return { grammar: Prism.languages.cpp || Prism.languages.c, langKey: 'cpp' }
  if (l === 'cs' || l === 'csharp' || l === 'c#') return { grammar: Prism.languages.csharp, langKey: 'csharp' }
  if (l === 'sql') return { grammar: Prism.languages.sql, langKey: 'sql' }
  if (l === 'sh' || l === 'bash' || l === 'shell' || l === 'zsh') return { grammar: Prism.languages.bash, langKey: 'bash' }
  if (l === 'json') return { grammar: Prism.languages.json, langKey: 'json' }
  if (l === 'yaml' || l === 'yml') return { grammar: Prism.languages.yaml, langKey: 'yaml' }
  if (l === 'md' || l === 'markdown') return { grammar: Prism.languages.markdown, langKey: 'markdown' }
  if (l === 'rs' || l === 'rust') return { grammar: Prism.languages.rust, langKey: 'rust' }
  if (l === 'go') return { grammar: Prism.languages.go, langKey: 'go' }
  if (l === 'html' || l === 'xml' || l === 'svg') return { grammar: Prism.languages.markup, langKey: 'markup' }
  if (l === 'css' || l === 'scss' || l === 'sass') return { grammar: Prism.languages.css, langKey: 'css' }
  if (l === 'php') return { grammar: Prism.languages.php, langKey: 'php' }
  if (l === 'rb' || l === 'ruby') return { grammar: Prism.languages.ruby, langKey: 'ruby' }
  if (l === 'kt' || l === 'kotlin') return { grammar: Prism.languages.kotlin, langKey: 'kotlin' }
  if (l === 'swift') return { grammar: Prism.languages.swift, langKey: 'swift' }
  if (l === 'dart') return { grammar: Prism.languages.dart, langKey: 'dart' }
  if (Prism.languages[l]) return { grammar: Prism.languages[l], langKey: l }
  return null
}

/** Kod bloklarını kopyalanabilir ve renklendirilmiş hâle getiren bileşen. */
const CodeBlock: React.FC<{
  code: string
  lang?: string
  onCopy: () => void
  copied: boolean
  failed?: boolean
}> = ({ code, lang, onCopy, copied, failed }) => {
  const lines = React.useMemo(() => {
    const normalized = code.replace(/\r\n/g, '\n')
    const rawLines = normalized.split('\n')
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') {
      rawLines.pop()
    }
    const match = getPrismGrammar(lang)
    let highlightedLines: string[] = []
    if (match) {
      try {
        const fullHtml = Prism.highlight(rawLines.join('\n'), match.grammar, match.langKey)
        highlightedLines = splitHighlightedHtmlLines(fullHtml)
      } catch {
        highlightedLines = rawLines.map(l => escapeHtml(l))
      }
    } else {
      highlightedLines = rawLines.map(l => escapeHtml(l))
    }
    return rawLines.map((raw, idx) => ({
      index: idx + 1,
      raw,
      html: highlightedLines[idx] || '&nbsp;',
    }))
  }, [code, lang])

  return (
    <div className="my-2.5 overflow-hidden rounded-[var(--jmc-radius)] bg-[var(--jmc-code-bg)] shadow-[var(--jmc-shadow-sm)] border border-[var(--jmc-border-subtle)]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg)]/40">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--jmc-primary)]">
            {lang || 'kod'}
          </span>
          <span className="text-[10px] text-[var(--jmc-text-dim)]">· {lines.length} satır</span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          aria-label={failed ? 'Kod kopyalanamadı' : copied ? 'Kod kopyalandı' : 'Kodu kopyala'}
          className="flex items-center gap-1.5 rounded-[var(--jmc-radius-sm)] px-1.5 py-0.5 text-[10px] text-[var(--jmc-text-dim)] transition-colors hover:bg-[var(--jmc-bg-surface)] hover:text-[var(--jmc-text)]"
        >
          {copied ? (
            <Check className="h-3 w-3 text-[var(--jmc-success)]" />
          ) : failed ? (
            <AlertCircle className="h-3 w-3 text-[var(--jmc-danger)]" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? 'Kopyalandı' : failed ? 'Kopyalanamadı' : 'Kopyala'}
        </button>
      </div>
      <div className="overflow-x-auto py-2 font-mono text-[11px] leading-[1.6]">
        {lines.map(row => (
          <div key={row.index} className="flex items-start hover:bg-white/[0.03] transition-colors">
            <span className="select-none pl-3 pr-3 text-right text-[var(--jmc-text-dim)] shrink-0 min-w-[2.75rem] font-mono text-[10.5px] opacity-40 border-r border-[var(--jmc-border-subtle)]/40">
              {row.index}
            </span>
            <div
              className="flex-1 pl-3 pr-3 min-w-0 font-mono text-[var(--jmc-text)] whitespace-pre"
              dangerouslySetInnerHTML={{ __html: row.html }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  className = '',
  isUser = false,
}) => {
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const [copyFailedKey, setCopyFailedKey] = React.useState<string | null>(null)

  /**
   * Kod blogunu panoya kopyalar.
   *
   * `navigator.clipboard` yerine ana surecteki Electron pano modulu
   * kullanilir. Tarayici API'si bir promise dondurdugu icin onceki
   * surumde hata sessizce yutuluyor ve kullanici "Kopyalandi" yazisini
   * gorup hicbir sey kopyalanmadigini fark etmiyordu.
   */
  const copyCode = React.useCallback(async (code: string) => {
    try {
      await window.jmcAPI.copyText(code)
      setCopyFailedKey(null)
      setCopiedKey(code)
      window.setTimeout(() => setCopiedKey(prev => (prev === code ? null : prev)), 1600)
    } catch {
      setCopiedKey(null)
      setCopyFailedKey(code)
      window.setTimeout(() => setCopyFailedKey(prev => (prev === code ? null : prev)), 2200)
    }
  }, [])

  /**
   * Bağlantılar yalnızca http/https/mailto şemalarıyla açılabilir.
   * javascript: gibi şemalar React tarafında hiç işlenmez.
   */
  const handleLinkClick = (href?: string) => {
    if (!href) return
    let url: URL
    try {
      url = new URL(href)
    } catch {
      return
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:') return
    window.jmcAPI?.openExternalUrl(url.toString())
  }

  return (
    <div className={`prose ${className}`} data-selectable="">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Başlıklar: ağır çizgi yerine tipografik hiyerarşi.
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => <h2>{children}</h2>,
          h3: ({ children }) => <h3>{children}</h3>,
          h4: ({ children }) => (
            <h4 className="text-[0.95em] font-semibold text-[var(--jmc-text-muted)]">{children}</h4>
          ),

          // **kalın** metin: react-markdown `strong` düğümü üretir.
          // Önceki sürümde ağır biçim ve düşük kontrastlı renk nedeniyle
          // kalın metin normal metinden ayırt edilemiyordu.
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--jmc-text)]">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="opacity-70">{children}</del>,

          p: ({ children }) => <p>{children}</p>,

          ul: ({ children }) => <ul>{children}</ul>,
          ol: ({ children }) => <ol>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,

          blockquote: ({ children }) => <blockquote>{children}</blockquote>,
          hr: () => <hr />,

          a: ({ href, children }) => (
            <a
              href={href}
              onClick={e => {
                e.preventDefault()
                handleLinkClick(href)
              }}
              rel="noreferrer noopener"
            >
              <span>{children}</span>
              <ExternalLink className="ml-0.5 inline-block h-2.5 w-2.5 opacity-60" aria-hidden />
            </a>
          ),

          // Satır içi kod için ReactMarkdown `code` düğümünü, blok kod için
          // `pre` düğümünü kullanır. Bu yüzden blok kod `pre` içinde ele alınır.
          code: ({ className: codeClassName, children, ...props }) => {
            const text = String(children)
            const isBlock = !!codeClassName || text.includes('\n')
            if (isBlock) return null
            return (
              <code {...props} className={isUser ? 'bg-white/15 text-inherit' : undefined}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => {
            const raw = extractText(children).replace(/\n$/, '')
            const lang = readLanguage(children)
            return (
      <CodeBlock
        code={raw}
        lang={lang}
        copied={copiedKey === raw}
        failed={copyFailedKey === raw}
        onCopy={() => copyCode(raw)}
      />
    )
          },

          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] shadow-[var(--jmc-shadow-sm)]">
              <table>{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          th: ({ children }) => <th>{children}</th>,
          td: ({ children }) => <td>{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** Bir React alt ağacının düz metnini çıkarır. */
function extractText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  const el = node as React.ReactElement<{ children?: React.ReactNode }>
  return extractText(el.props?.children)
}

/** `language-xxx` sınıfından dil etiketini okur. */
function readLanguage(node: React.ReactNode): string | undefined {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
  const el = node as React.ReactElement<{ className?: string }>
  const match = /language-([\w+-]+)/.exec(el.props?.className ?? '')
  return match?.[1]
}