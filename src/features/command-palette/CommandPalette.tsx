import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Download,
  FileText,
  Layers,
  Palette,
  Search as SearchIcon,
} from 'lucide-react'
import { Course, ThemeName } from '../../types/jmc'
import { useTheme } from '../../themes/ThemeContext'
import { THEMES } from '../../themes/themeConfig'
import { useI18n } from '../../i18n/i18nContext'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  courses: Course[]
  onSelectCourse: (course: Course) => void
  onTriggerAiMode: (mode: 'socratic' | 'draft' | 'rubric' | 'quiz') => void
  onExport: (format: 'csv' | 'json' | 'markdown' | 'anki') => void
}

type SearchHit = {
  type: string
  id: string
  title: string
  snippet: string
  courseId?: string
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  courses,
  onSelectCourse,
  onTriggerAiMode,
  onExport,
}) => {
  const { t } = useI18n()
  const { setTheme } = useTheme()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)

  const aiCommands = useMemo(
    () => [
      {
        token: '/ozetle',
        mode: 'draft' as const,
        label: t('palette.cmdSummarize'),
        desc: t('palette.cmdSummarizeDesc'),
      },
      {
        token: '/rubrik',
        mode: 'rubric' as const,
        label: t('palette.cmdRubric'),
        desc: t('palette.cmdRubricDesc'),
      },
      {
        token: '/quiz',
        mode: 'quiz' as const,
        label: t('palette.cmdQuiz'),
        desc: t('palette.cmdQuizDesc'),
      },
    ],
    [t],
  )

  const exportsList = useMemo(
    () => [
      { format: 'csv' as const, label: t('palette.exportCsv') },
      { format: 'json' as const, label: t('palette.exportJson') },
      { format: 'markdown' as const, label: t('palette.exportMarkdown') },
      { format: 'anki' as const, label: t('palette.exportAnki') },
    ],
    [t],
  )

  // Arama yalnizca gercek yerel veri uzerinde calisir.
  useEffect(() => {
    if (!isOpen) return
    const term = query.trim()
    if (term.length < 2 || !window.jmcAPI?.search) {
      setHits([])
      return
    }
    let cancelled = false
    setSearching(true)
    const handle = window.setTimeout(() => {
      void window.jmcAPI
        .search(term)
        .then(res => {
          if (!cancelled) setHits(res ?? [])
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
      setSearching(false)
    }
  }, [query, isOpen])

  useEffect(() => {
    if (!isOpen) setQuery('')
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const q = query.toLowerCase().trim()

  const matches = useMemo(
    () => (haystack: string) => q === '' || haystack.toLowerCase().includes(q),
    [q],
  )

  const matchingCommands = useMemo(
    () =>
      aiCommands.filter(cmd =>
        q === '' || cmd.token.includes(q) || cmd.label.toLowerCase().includes(q),
      ),
    [aiCommands, q],
  )

  const matchingCourses = useMemo(
    () =>
      courses.filter(
        c => matches(c.name) || matches(c.section ?? '') || matches(c.ownerId),
      ),
    [courses, matches],
  )

  const matchingThemes = useMemo(
    () => (Object.keys(THEMES) as ThemeName[]).filter(matches),
    [matches],
  )

  const nothingToShow =
    matchingCommands.length === 0 &&
    matchingCourses.length === 0 &&
    matchingThemes.length === 0 &&
    hits.length === 0 &&
    !searching

  if (!isOpen) return null

  return (
    // Kullanıcı talebi: Boşluğa (backdrop) tıklayınca kapanır.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('welcome.commandPalette')}
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-[3px] px-4 pt-24 transition-all duration-200 animate-fade-in"
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-bg-elevated)] border border-[var(--jmc-border)] shadow-[var(--jmc-shadow-lg)] animate-pop-in">
        <div className="flex items-center gap-2.5 bg-[var(--jmc-bg)] px-4 py-3">
          <SearchIcon className="h-4 w-4 shrink-0 text-[var(--jmc-text-dim)]" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="jmc-command-results"
            spellCheck={false}
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--jmc-text)] outline-none border-none ring-0 focus:outline-none focus:ring-0 placeholder:text-[var(--jmc-text-dim)]"
          />
          <kbd className="shrink-0 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--jmc-text-dim)]">
            Esc
          </kbd>
        </div>

        <div
          id="jmc-command-results"
          className="max-h-[24rem] overflow-y-auto p-1.5"
          role="listbox"
        >
          {matchingCommands.length > 0 && (
            <>
              <GroupLabel>{t('palette.ai')}</GroupLabel>
              {matchingCommands.map(cmd => (
                <Row
                  key={cmd.token}
                  icon={<Layers className="h-3.5 w-3.5 text-[var(--jmc-primary-text)]" />}
                  title={cmd.label}
                  hint={cmd.desc}
                  trailing={<code className="font-mono text-[10.5px] text-[var(--jmc-text-dim)]">{cmd.token}</code>}
                  onSelect={() => {
                    onTriggerAiMode(cmd.mode)
                    onClose()
                  }}
                />
              ))}
            </>
          )}

          {hits.length > 0 && (
            <>
              <GroupLabel>{searching ? t('palette.searching') : t('palette.results')}</GroupLabel>
              {hits.map(hit => (
                <Row
                  key={`${hit.type}:${hit.id}`}
                  icon={<FileText className="h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />}
                  title={hit.title}
                  hint={hit.snippet}
                  onSelect={() => {
                    const course = hit.courseId ? courses.find(c => c.id === hit.courseId) : undefined
                    if (course) {
                      onSelectCourse(course)
                      onClose()
                    }
                  }}
                />
              ))}
            </>
          )}

          {matchingCourses.length > 0 && (
            <>
              <GroupLabel>{t('palette.courses')}</GroupLabel>
              {matchingCourses.slice(0, 12).map(c => (
                <Row
                  key={c.id}
                  icon={<BookOpen className="h-3.5 w-3.5 text-[var(--jmc-accent-text)]" />}
                  title={c.name}
                  hint={[c.section, c.courseState].filter(Boolean).join(' · ')}
                  onSelect={() => {
                    onSelectCourse(c)
                    onClose()
                  }}
                />
              ))}
            </>
          )}

          {matchingThemes.length > 0 && (
            <>
              <GroupLabel>{t('palette.themes')}</GroupLabel>
              {matchingThemes.slice(0, 6).map(name => (
                <Row
                  key={name}
                  icon={<Palette className="h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />}
                  title={name}
                  onSelect={() => {
                    setTheme(name)
                    onClose()
                  }}
                />
              ))}
            </>
          )}

          {q === '' && (
            <>
              <GroupLabel>{t('palette.sectionActions')}</GroupLabel>
              {exportsList.map(e => (
                <Row
                  key={e.format}
                  icon={<Download className="h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />}
                  title={e.label}
                  onSelect={() => {
                    onExport(e.format)
                    onClose()
                  }}
                />
              ))}
            </>
          )}

          {nothingToShow && (
            <p className="px-3 py-6 text-center text-[12px] text-[var(--jmc-text-dim)]">
              {q.length > 0 ? t('palette.noResults') : t('palette.placeholder')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--jmc-text-dim)]">
    {children}
  </div>
)

const Row: React.FC<{
  icon: React.ReactNode
  title: string
  hint?: string
  trailing?: React.ReactNode
  onSelect: () => void
}> = ({ icon, title, hint, trailing, onSelect }) => (
  <button
    type="button"
    role="option"
    aria-selected="false"
    onClick={onSelect}
    className="flex w-full items-center gap-2.5 rounded-[var(--jmc-radius)] px-3 py-2 text-left transition-colors hover:bg-[var(--jmc-bg-surface)]"
  >
    <span className="shrink-0">{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[12.5px]">{title}</span>
      {hint && (
        <span className="block truncate text-[11px] text-[var(--jmc-text-dim)]">{hint}</span>
      )}
    </span>
    {trailing ?? <ArrowRight className="h-3 w-3 shrink-0 text-[var(--jmc-text-dim)]" />}
  </button>
)