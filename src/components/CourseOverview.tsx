import React, { useMemo, useState, useEffect } from 'react'
import {
  AlertCircle,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  GraduationCap,
  Layers,
  Link as LinkIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  Video,
} from 'lucide-react'
import {
  Announcement,
  Attachment,
  Course,
  CourseMaterial,
  CourseParticipant,
  CourseWork,
  Topic,
} from '../types/jmc'
import { useI18n } from '../i18n/i18nContext'
import { MarkdownView } from './MarkdownView'
import { ClickableText } from './ClickableText'

const YouTubeIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
)

interface CourseOverviewProps {
  course: Course
  topics: Topic[]
  courseWorks: CourseWork[]
  announcements: Announcement[]
  materials: CourseMaterial[]
  participants: CourseParticipant[]
  onSelectWork: (work: CourseWork) => void
  onSyncCourse?: () => void
  isSyncing?: boolean
  onDownloadAttachment?: (att: Attachment) => void
  onPreviewAttachment?: (att: Attachment) => void
  onInspectAttachment?: (att: Attachment) => void
}

type TabKey = 'assignments' | 'announcements' | 'materials' | 'people'
type AssignmentFilter = 'all' | 'pending' | 'turned_in' | 'graded'

export const CourseOverview: React.FC<CourseOverviewProps> = ({
  course,
  topics,
  courseWorks,
  announcements,
  materials,
  participants,
  onSelectWork,
  onSyncCourse,
  isSyncing = false,
  onDownloadAttachment,
  onPreviewAttachment,
  onInspectAttachment,
}) => {
  const { t, lang } = useI18n()
  const [activeTab, setActiveTab] = useState<TabKey>('assignments')
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [downloadedStatusMap, setDownloadedStatusMap] = useState<Record<string, { exists: boolean; filePath?: string }>>({})
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({})

  // Disk üzerindeki indirilen dosyaları kontrol et
  useEffect(() => {
    let cancelled = false
    if (!window.jmcAPI?.checkDownloadedFile) return

    const allAttachments: Attachment[] = []
    for (const ann of announcements) {
      if (ann.materials) allAttachments.push(...ann.materials)
    }
    for (const mat of materials) {
      if (mat.materials) allAttachments.push(...mat.materials)
    }
    for (const cw of courseWorks) {
      if (cw.materials) allAttachments.push(...cw.materials)
    }

    if (allAttachments.length === 0) return

    Promise.all(
      allAttachments.map(async att => {
        try {
          const res = await window.jmcAPI.checkDownloadedFile(att)
          return { id: att.id, driveId: att.driveFileId, res }
        } catch {
          return { id: att.id, driveId: att.driveFileId, res: { exists: false } }
        }
      }),
    ).then(results => {
      if (cancelled) return
      setDownloadedStatusMap(prev => {
        const next = { ...prev }
        for (const item of results) {
          if (item.res.exists) {
            next[item.id] = item.res
            if (item.driveId) {
              next[item.driveId] = item.res
            }
          }
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [announcements, materials, courseWorks])

  const handleDownloadItem = async (att: Attachment) => {
    setDownloadingIds(prev => ({ ...prev, [att.id]: true }))
    try {
      if (onDownloadAttachment) {
        await onDownloadAttachment(att)
      }
      if (window.jmcAPI?.checkDownloadedFile) {
        const res = await window.jmcAPI.checkDownloadedFile(att)
        if (res.exists) {
          setDownloadedStatusMap(prev => ({
            ...prev,
            [att.id]: res,
            ...(att.driveFileId ? { [att.driveFileId]: res } : {}),
          }))
        }
      }
    } finally {
      setDownloadingIds(prev => ({ ...prev, [att.id]: false }))
    }
  }

  // Konu haritası
  const topicMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const top of topics) {
      map.set(top.id, top.name)
    }
    return map
  }, [topics])

  // Eğitmenler ve öğrenciler
  const teachers = useMemo(
    () => participants.filter(p => p.role === 'TEACHER'),
    [participants],
  )
  const students = useMemo(
    () => participants.filter(p => p.role === 'STUDENT'),
    [participants],
  )

  // Katılımcı haritası (kullanıcı ID -> Katılımcı)
  const participantMap = useMemo(() => {
    const map = new Map<string, CourseParticipant>()
    for (const p of participants) {
      map.set(p.userId, p)
    }
    return map
  }, [participants])

  // Filtrelenmiş ve sıralanmış ödevler
  const filteredAssignments = useMemo(() => {
    return courseWorks.filter(w => {
      // Metin araması
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const matchTitle = w.title.toLowerCase().includes(query)
        const matchDesc = w.description?.toLowerCase().includes(query)
        const matchTopic = w.topicId ? topicMap.get(w.topicId)?.toLowerCase().includes(query) : false
        if (!matchTitle && !matchDesc && !matchTopic) return false
      }

      // Durum filtrelemesi
      const subState = w.submission?.state
      if (assignmentFilter === 'turned_in') {
        return subState === 'TURNED_IN'
      }
      if (assignmentFilter === 'graded') {
        return subState === 'RETURNED' || w.submission?.assignedGrade != null
      }
      if (assignmentFilter === 'pending') {
        return subState !== 'TURNED_IN' && subState !== 'RETURNED'
      }
      return true
    })
  }, [courseWorks, assignmentFilter, searchQuery, topicMap])

  // Teslim durumu etiketi
  const getSubmissionBadge = (work: CourseWork) => {
    const sub = work.submission
    if (!sub || sub.state === 'NEW') {
      return (
        <span className="inline-flex items-center gap-1 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--jmc-text-muted)] border border-[var(--jmc-border)]">
          <Clock className="h-3 w-3" />
          {t('coursework.status.NEW')}
        </span>
      )
    }
    if (sub.state === 'TURNED_IN') {
      return (
        <span className="inline-flex items-center gap-1 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-success)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--jmc-success)] border border-[var(--jmc-success)]/20">
          <CheckCircle2 className="h-3 w-3" />
          {t('coursework.status.TURNED_IN')}
        </span>
      )
    }
    if (sub.state === 'RETURNED' || sub.assignedGrade != null) {
      return (
        <span className="inline-flex items-center gap-1 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--jmc-primary)] border border-[var(--jmc-primary)]/20">
          <Award className="h-3 w-3" />
          {sub.assignedGrade != null ? `${sub.assignedGrade} Puan` : t('coursework.status.RETURNED')}
        </span>
      )
    }
    if (sub.state === 'RECLAIMED_BY_STUDENT') {
      return (
        <span className="inline-flex items-center gap-1 rounded-[var(--jmc-radius-sm)] bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500 border border-amber-500/20">
          <Clock className="h-3 w-3" />
          {t('coursework.status.RECLAIMED')}
        </span>
      )
    }
    return null
  }

  // Tarih biçimlendirme
  const formatDate = (isoString?: string) => {
    if (!isoString) return ''
    try {
      const d = new Date(isoString)
      return d.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return isoString
    }
  }

  // Ödev son teslim tarihi biçimlendirici
  const formatDueDate = (work: CourseWork) => {
    if (!work.dueDate) return null
    const date = new Date(
      work.dueDate.year,
      work.dueDate.month - 1,
      work.dueDate.day,
      work.dueTime?.hours ?? 23,
      work.dueTime?.minutes ?? 59,
    )
    const now = new Date()
    const diffHours = (date.getTime() - now.getTime()) / (1000 * 60 * 60)
    const isPast = diffHours < 0
    const isUrgent = diffHours >= 0 && diffHours <= 48

    const formatted = date.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

    return {
      text: formatted,
      isPast,
      isUrgent,
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--jmc-bg)] text-[var(--jmc-text)]">
      {/* ---------------- Üst Başlık Banner ---------------- */}
      <header className="border-b border-[var(--jmc-border-subtle)] bg-[var(--jmc-bg-elevated)] px-6 py-6 shadow-[var(--jmc-shadow-sm)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--jmc-primary)]/15 px-2.5 py-0.5 text-[10.5px] font-semibold text-[var(--jmc-primary)]">
                <GraduationCap className="h-3 w-3" />
                {course.section || 'Ders'}
              </span>
              {course.courseState === 'ARCHIVED' && (
                <span className="rounded-full bg-[var(--jmc-bg-surface)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--jmc-text-dim)] border border-[var(--jmc-border)]">
                  {t('courses.archiveBadge')}
                </span>
              )}
              {course.room && (
                <span className="text-[11px] text-[var(--jmc-text-muted)]">
                  Derslik: {course.room}
                </span>
              )}
            </div>

            <h1 className="text-[22px] font-bold tracking-tight text-[var(--jmc-text)]">
              {course.name}
            </h1>

            {course.descriptionHeading && (
              <p className="text-[12.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                {course.descriptionHeading}
              </p>
            )}

            {teachers.length > 0 && (
              <div className="flex items-center gap-2 pt-1 text-[11.5px] text-[var(--jmc-text-muted)]">
                <span className="font-medium text-[var(--jmc-text)]">Eğitmen:</span>
                <span>{teachers.map(t => t.fullName || t.email).join(', ')}</span>
              </div>
            )}
          </div>

          {/* Aksiyon butonları */}
          <div className="flex flex-wrap items-center gap-2">
            {onSyncCourse && (
              <button
                type="button"
                onClick={onSyncCourse}
                disabled={isSyncing}
                title="Ders verilerini Google Classroom ile senkronize et"
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] transition-colors hover:bg-[var(--jmc-border-subtle)] hover:text-[var(--jmc-text)] border border-[var(--jmc-border)]"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Eşitleniyor...' : 'Eşitle'}</span>
              </button>
            )}

            {course.alternateLink && (
              <button
                type="button"
                onClick={() => void window.jmcAPI?.openExternalUrl(course.alternateLink!)}
                title="Google Classroom web arayüzünde aç"
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] transition-colors hover:bg-[var(--jmc-border-subtle)] hover:text-[var(--jmc-text)] border border-[var(--jmc-border)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Classroom'da Aç</span>
              </button>
            )}

            {course.teacherFolderId && (
              <button
                type="button"
                onClick={() =>
                  void window.jmcAPI?.openExternalUrl(
                    `https://drive.google.com/drive/folders/${encodeURIComponent(course.teacherFolderId!)}`,
                  )
                }
                title="Google Drive ders klasörünü aç"
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] transition-colors hover:bg-[var(--jmc-border-subtle)] hover:text-[var(--jmc-text)] border border-[var(--jmc-border)]"
              >
                <Folder className="h-3.5 w-3.5 text-amber-500" />
                <span>Drive Klasörü</span>
              </button>
            )}
          </div>
        </div>

        {/* İstatistikler */}
        <div className="mt-5 flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 border border-[var(--jmc-border)]">
            <FileText className="h-3.5 w-3.5 text-[var(--jmc-primary)]" />
            <span className="text-[11.5px] font-medium">{courseWorks.length} Ödev / Görev</span>
          </div>
          <div className="flex items-center gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 border border-[var(--jmc-border)]">
            <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-[11.5px] font-medium">{announcements.length} Duyuru</span>
          </div>
          <div className="flex items-center gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 border border-[var(--jmc-border)]">
            <BookOpen className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-[11.5px] font-medium">{materials.length} Materyal</span>
          </div>
          <div className="flex items-center gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 border border-[var(--jmc-border)]">
            <Users className="h-3.5 w-3.5 text-purple-500" />
            <span className="text-[11.5px] font-medium">{participants.length} Katılımcı</span>
          </div>
        </div>

        {/* ---------------- Sekme Seçimi ---------------- */}
        <nav className="mt-6 flex gap-1 border-b border-[var(--jmc-border)] -mb-6" aria-label="Ders sekmeleri">
          <button
            type="button"
            onClick={() => setActiveTab('assignments')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-[12.5px] font-medium transition-colors ${
              activeTab === 'assignments'
                ? 'border-[var(--jmc-primary)] text-[var(--jmc-primary)]'
                : 'border-transparent text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Ödevler & Görevler</span>
            <span className="rounded-full bg-[var(--jmc-bg-surface)] px-1.5 py-0.2 text-[10.5px]">
              {courseWorks.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('announcements')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-[12.5px] font-medium transition-colors ${
              activeTab === 'announcements'
                ? 'border-[var(--jmc-primary)] text-[var(--jmc-primary)]'
                : 'border-transparent text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            <span>Duyurular</span>
            <span className="rounded-full bg-[var(--jmc-bg-surface)] px-1.5 py-0.2 text-[10.5px]">
              {announcements.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('materials')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-[12.5px] font-medium transition-colors ${
              activeTab === 'materials'
                ? 'border-[var(--jmc-primary)] text-[var(--jmc-primary)]'
                : 'border-transparent text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
            }`}
          >
            <BookOpen className="h-4 w-4" />
            <span>Materyaller</span>
            <span className="rounded-full bg-[var(--jmc-bg-surface)] px-1.5 py-0.2 text-[10.5px]">
              {materials.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('people')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-[12.5px] font-medium transition-colors ${
              activeTab === 'people'
                ? 'border-[var(--jmc-primary)] text-[var(--jmc-primary)]'
                : 'border-transparent text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
            }`}
          >
            <Users className="h-4 w-4" />
            <span>Katılımcılar</span>
            <span className="rounded-full bg-[var(--jmc-bg-surface)] px-1.5 py-0.2 text-[10.5px]">
              {participants.length}
            </span>
          </button>
        </nav>
      </header>

      {/* ---------------- Sekme İçeriği ---------------- */}
      <div className="flex-1 p-6">
        {/* ================= TAB 1: ÖDEVLER & GÖREVLER ================= */}
        {activeTab === 'assignments' && (
          <div className="space-y-4">
            {/* Arama ve Filtreleme Çubuğu */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative min-w-[220px] flex-1 max-w-md">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Ödevlerde veya konularda ara..."
                  className="w-full rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-elevated)] pl-9 pr-3 py-1.5 text-[12px] text-[var(--jmc-text)] border border-[var(--jmc-border)] placeholder:text-[var(--jmc-text-dim)] focus:border-[var(--jmc-primary)] focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-[var(--jmc-text-dim)]" />
                <button
                  type="button"
                  onClick={() => setAssignmentFilter('all')}
                  className={`rounded-[var(--jmc-radius-sm)] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    assignmentFilter === 'all'
                      ? 'bg-[var(--jmc-primary)] text-white'
                      : 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                  }`}
                >
                  Tümü ({courseWorks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAssignmentFilter('pending')}
                  className={`rounded-[var(--jmc-radius-sm)] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    assignmentFilter === 'pending'
                      ? 'bg-[var(--jmc-primary)] text-white'
                      : 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                  }`}
                >
                  Bekleyenler
                </button>
                <button
                  type="button"
                  onClick={() => setAssignmentFilter('turned_in')}
                  className={`rounded-[var(--jmc-radius-sm)] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    assignmentFilter === 'turned_in'
                      ? 'bg-[var(--jmc-primary)] text-white'
                      : 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                  }`}
                >
                  Teslim Edilenler
                </button>
                <button
                  type="button"
                  onClick={() => setAssignmentFilter('graded')}
                  className={`rounded-[var(--jmc-radius-sm)] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    assignmentFilter === 'graded'
                      ? 'bg-[var(--jmc-primary)] text-white'
                      : 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
                  }`}
                >
                  Notlandırılanlar
                </button>
              </div>
            </div>

            {/* Ödev Kartları Listesi */}
            {filteredAssignments.length === 0 ? (
              <div className="grid place-items-center rounded-[var(--jmc-radius-lg)] border border-dashed border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-12 text-center">
                <FileText className="h-8 w-8 text-[var(--jmc-text-dim)]" />
                <h3 className="mt-3 text-[14px] font-semibold">Ödev veya Görev Bulunamadı</h3>
                <p className="mt-1 max-w-sm text-[12px] text-[var(--jmc-text-muted)]">
                  {searchQuery || assignmentFilter !== 'all'
                    ? 'Arama kriterlerinize uygun ödev bulunamadı. Filtreleri temizlemeyi deneyin.'
                    : 'Bu derste öğretmen tarafından henüz bir ödev veya çalışma yayımlanmamış.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredAssignments.map(work => {
                  const due = formatDueDate(work)
                  const topicName = work.topicId ? topicMap.get(work.topicId) : null

                  return (
                    <article
                      key={work.id}
                      onClick={() => onSelectWork(work)}
                      className="group cursor-pointer rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-4 transition-all duration-150 hover:border-[var(--jmc-primary)]/50 hover:shadow-[var(--jmc-shadow-md)] hover:scale-[1.003]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {topicName && (
                              <span className="inline-flex items-center gap-1 rounded bg-[var(--jmc-bg-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--jmc-text-dim)] border border-[var(--jmc-border)]">
                                <Layers className="h-2.5 w-2.5" />
                                {topicName}
                              </span>
                            )}
                            <span className="text-[10.5px] font-medium text-[var(--jmc-primary)]">
                              {work.workType === 'ASSIGNMENT'
                                ? 'Ödev'
                                : work.workType === 'SHORT_ANSWER_QUESTION'
                                  ? 'Kısa Cevaplı Soru'
                                  : 'Çoktan Seçmeli Soru'}
                            </span>
                            {work.maxPoints != null && (
                              <span className="text-[10.5px] text-[var(--jmc-text-dim)]">
                                · {work.maxPoints} Puan
                              </span>
                            )}
                          </div>

                          <h3 className="text-[15px] font-semibold text-[var(--jmc-text)] group-hover:text-[var(--jmc-primary)] transition-colors">
                            {work.title}
                          </h3>

                          {work.description && (
                            <p className="line-clamp-2 text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                              {/* Duz metin olarak basilirsa icindeki adresler
                                  TIKLANAMAZ kaliyordu. */}
                              <ClickableText text={work.description} />
                            </p>
                          )}
                        </div>

                        {/* Sağ Rozetler & Eylemler */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {getSubmissionBadge(work)}

                          {due && (
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                                due.isPast
                                  ? 'text-[var(--jmc-danger)]'
                                  : due.isUrgent
                                    ? 'text-amber-500 font-semibold'
                                    : 'text-[var(--jmc-text-muted)]'
                              }`}
                            >
                              <Calendar className="h-3 w-3" />
                              <span>{due.text}</span>
                            </span>
                          )}

                          {work.materials.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--jmc-text-dim)]">
                              <Paperclip className="h-3 w-3" />
                              <span>{work.materials.length} Ek</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: DUYURULAR ================= */}
        {activeTab === 'announcements' && (
          <div className="space-y-4 max-w-4xl">
            {announcements.length === 0 ? (
              <div className="grid place-items-center rounded-[var(--jmc-radius-lg)] border border-dashed border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-12 text-center">
                <MessageSquare className="h-8 w-8 text-[var(--jmc-text-dim)]" />
                <h3 className="mt-3 text-[14px] font-semibold">Duyuru Bulunmuyor</h3>
                <p className="mt-1 text-[12px] text-[var(--jmc-text-muted)]">
                  Bu derste öğretmen tarafından henüz bir duyuru paylaşılmamış.
                </p>
              </div>
            ) : (
              announcements.map(ann => {
                const author = ann.creatorUserId ? participantMap.get(ann.creatorUserId) : null
                return (
                  <article
                    key={ann.id}
                    className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-5 shadow-[var(--jmc-shadow-sm)] space-y-3"
                  >
                    {/* Yazar Bilgisi */}
                    <div className="flex items-center justify-between border-b border-[var(--jmc-border-subtle)] pb-3">
                      <div className="flex items-center gap-2.5">
                        {author?.photoUrl ? (
                          <img
                            src={author.photoUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-7 w-7 rounded-full object-cover"
                          />
                        ) : (
                          <div className="grid h-7 w-7 place-items-center rounded-full bg-[var(--jmc-primary)]/15 text-[11px] font-semibold text-[var(--jmc-primary)]">
                            {author?.fullName?.[0] || 'E'}
                          </div>
                        )}
                        <div>
                          <span className="block text-[12px] font-semibold text-[var(--jmc-text)]">
                            {author?.fullName || 'Ders Eğitmeni'}
                          </span>
                          <span className="block text-[10.5px] text-[var(--jmc-text-dim)]">
                            {formatDate(ann.creationTime)}
                          </span>
                        </div>
                      </div>

                      {ann.alternateLink && (
                        <button
                          type="button"
                          onClick={() => void window.jmcAPI?.openExternalUrl(ann.alternateLink!)}
                          title="Duyuruyu Classroom'da görüntüle"
                          className="text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] transition-colors p-1"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Duyuru Metni */}
                    <div className="text-[13px] leading-relaxed text-[var(--jmc-text)]">
                      <MarkdownView content={ann.text} />
                    </div>

                    {/* Ekler */}
                    {ann.materials.length > 0 && (
                      <div className="pt-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--jmc-text-dim)]">
                          Ekler ({ann.materials.length})
                        </span>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {ann.materials.map(mat => (
                            <div
                              key={mat.id}
                              className="flex items-center justify-between gap-2 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-2.5 text-[11.5px]"
                            >
                              {(() => {
                                const isYouTube = Boolean(mat.youTubeVideoId) || (Boolean(mat.alternateLink) && /(?:youtube\.com|youtu\.be)/i.test(mat.alternateLink || ''))
                                const isWebLink = !mat.driveFileId && Boolean(mat.alternateLink) && !isYouTube

                                return (
                                  <>
                                    <div
                                      onClick={() => {
                                        if (isWebLink && mat.alternateLink) {
                                          void window.jmcAPI?.openExternalUrl(mat.alternateLink)
                                        } else if (onPreviewAttachment) {
                                          onPreviewAttachment(mat)
                                        }
                                      }}
                                      className={`flex items-center gap-2 min-w-0 flex-1 cursor-pointer hover:text-[var(--jmc-primary)] transition-colors`}
                                      title={isWebLink ? 'Bağlantıyı tarayıcıda açmak için tıklayın' : 'Görüntülemek için tıklayın'}
                                    >
                                      {isYouTube ? (
                                        <YouTubeIcon className="h-4 w-4 shrink-0 text-red-500" />
                                      ) : isWebLink ? (
                                        <LinkIcon className="h-4 w-4 shrink-0 text-indigo-400" />
                                      ) : mat.driveFileId ? (
                                        <FileText className="h-4 w-4 shrink-0 text-blue-500" />
                                      ) : (
                                        <Paperclip className="h-4 w-4 shrink-0 text-[var(--jmc-text-dim)]" />
                                      )}
                                      <span className="truncate font-medium">{mat.title || (isWebLink ? 'Web Bağlantısı' : 'Ek')}</span>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                      {isYouTube ? (
                                        <>
                                          {onPreviewAttachment && (
                                            <button
                                              type="button"
                                              onClick={() => onPreviewAttachment(mat)}
                                              title="Videoyu Uygulama İçinde İzle"
                                              className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-1 text-[10.5px] font-semibold text-red-400 hover:bg-red-500/25 transition-colors"
                                            >
                                              <Eye className="h-3.5 w-3.5" />
                                              <span>İzle</span>
                                            </button>
                                          )}
                                          {mat.alternateLink && (
                                            <button
                                              type="button"
                                              onClick={() => void window.jmcAPI?.openExternalUrl(mat.alternateLink!)}
                                              title="YouTube'da Aç"
                                              className="rounded p-1 text-[var(--jmc-text-dim)] hover:text-red-400 hover:bg-[var(--jmc-bg)] transition-colors"
                                            >
                                              <ExternalLink className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                        </>
                                      ) : isWebLink ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => void window.jmcAPI?.openExternalUrl(mat.alternateLink!)}
                                            title="Bağlantıyı Tarayıcıda Aç"
                                            className="inline-flex items-center gap-1 rounded bg-[var(--jmc-primary)]/15 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/25 transition-colors"
                                          >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            <span>Aç</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              await window.jmcAPI?.copyText(mat.alternateLink!)
                                            }}
                                            title="Bağlantıyı Kopyala"
                                            className="rounded p-1 text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-bg)] transition-colors"
                                          >
                                            <LinkIcon className="h-3.5 w-3.5" />
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          {onPreviewAttachment && (mat.driveFileId || mat.isLocalAvailable) && (
                                            <button
                                              type="button"
                                              onClick={() => onPreviewAttachment(mat)}
                                              title="Uygulama İçinde Görüntüle"
                                              className="inline-flex items-center gap-1 rounded bg-[var(--jmc-primary)]/15 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/25 transition-colors"
                                            >
                                              <Eye className="h-3.5 w-3.5" />
                                              <span>Görüntüle</span>
                                            </button>
                                          )}
                                          {(() => {
                                            const status = downloadedStatusMap[mat.id] || (mat.driveFileId ? downloadedStatusMap[mat.driveFileId] : undefined)
                                            const isDownloaded = Boolean(status?.exists || (mat.isLocalAvailable && (mat.downloadedPath || mat.localPath)))
                                            const targetPath = status?.filePath || mat.downloadedPath || mat.localPath
                                            const isDownloading = Boolean(downloadingIds[mat.id])

                                            if (isDownloaded && targetPath) {
                                              return (
                                                <>
                                                  <button
                                                    type="button"
                                                    onClick={() => void (window.jmcAPI?.openPath ? window.jmcAPI.openPath(targetPath) : window.jmcAPI?.openLocalFile(targetPath))}
                                                    title="İndirilen Dosyayı Aç"
                                                    className="inline-flex items-center gap-1 rounded bg-[var(--jmc-success)]/15 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-success)] hover:bg-[var(--jmc-success)]/25 transition-colors"
                                                  >
                                                    <FolderOpen className="h-3.5 w-3.5" />
                                                    <span>Aç</span>
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => void window.jmcAPI?.showItemInFolder?.(targetPath)}
                                                    title="İndirilenler Klasöründe Göster"
                                                    className="inline-flex items-center gap-1 rounded border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2 py-1 text-[10.5px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] transition-colors"
                                                  >
                                                    <Folder className="h-3.5 w-3.5 text-amber-500" />
                                                    <span className="hidden sm:inline">Klasörde</span>
                                                  </button>
                                                </>
                                              )
                                            }

                                            if (onDownloadAttachment && mat.driveFileId) {
                                              return (
                                                <button
                                                  type="button"
                                                  onClick={() => void handleDownloadItem(mat)}
                                                  disabled={isDownloading}
                                                  title="İndirilenler Klasörüne İndir"
                                                  className="inline-flex items-center gap-1 rounded border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2 py-1 text-[10.5px] font-medium text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] transition-colors disabled:opacity-50"
                                                >
                                                  {isDownloading ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--jmc-primary)]" />
                                                  ) : (
                                                    <Download className="h-3.5 w-3.5" />
                                                  )}
                                                  <span>{isDownloading ? 'İndiriliyor...' : 'İndir'}</span>
                                                </button>
                                              )
                                            }

                                            return null
                                          })()}
                                          {mat.alternateLink && (
                                            <button
                                              type="button"
                                              onClick={() => void window.jmcAPI?.openExternalUrl(mat.alternateLink!)}
                                              title="Google Drive'da Aç"
                                              className="rounded p-1 text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-bg)]"
                                            >
                                              <ExternalLink className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                        </>
                                      )}
                                      {onInspectAttachment && (
                                        <button
                                          type="button"
                                          onClick={() => onInspectAttachment(mat)}
                                          title="Yapay Zekâ Asistanı ile İncele"
                                          className="inline-flex items-center gap-1 rounded bg-[var(--jmc-primary)]/10 border border-[var(--jmc-primary)]/20 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/20 transition-colors"
                                        >
                                          <Sparkles className="h-3 w-3" />
                                          <span className="hidden sm:inline">İncele</span>
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )
                              })()}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                )
              })
            )}
          </div>
        )}

        {/* ================= TAB 3: MATERYALLER ================= */}
        {activeTab === 'materials' && (
          <div className="space-y-4 max-w-4xl">
            {materials.length === 0 ? (
              <div className="grid place-items-center rounded-[var(--jmc-radius-lg)] border border-dashed border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-12 text-center">
                <BookOpen className="h-8 w-8 text-[var(--jmc-text-dim)]" />
                <h3 className="mt-3 text-[14px] font-semibold">Materyal Bulunmuyor</h3>
                <p className="mt-1 text-[12px] text-[var(--jmc-text-muted)]">
                  Bu ders için yayımlanmış ders notu veya kaynak bulunmuyor.
                </p>
              </div>
            ) : (
              materials.map(mat => {
                const topicName = mat.topicId ? topicMap.get(mat.topicId) : null
                return (
                  <article
                    key={mat.id}
                    className="rounded-[var(--jmc-radius-lg)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-5 shadow-[var(--jmc-shadow-sm)] space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        {topicName && (
                          <span className="inline-flex items-center gap-1 rounded bg-[var(--jmc-bg-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--jmc-text-dim)] border border-[var(--jmc-border)]">
                            <Layers className="h-2.5 w-2.5" />
                            {topicName}
                          </span>
                        )}
                        <h3 className="mt-1 text-[15px] font-semibold text-[var(--jmc-text)]">
                          {mat.title}
                        </h3>
                      </div>
                      <span className="text-[11px] text-[var(--jmc-text-dim)]">
                        {formatDate(mat.creationTime)}
                      </span>
                    </div>

                    {mat.description && (
                      <p className="text-[12.5px] leading-relaxed text-[var(--jmc-text-muted)]">
                        {/* Materyal aciklamalari duz metin olarak basilirdi;
                            iclerindeki baglantilar calismiyordu. */}
                        <ClickableText text={mat.description} />
                      </p>
                    )}

                    {mat.materials.length > 0 && (
                      <div className="pt-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {mat.materials.map(att => {
                            const isYouTube = Boolean(att.youTubeVideoId) || (Boolean(att.alternateLink) && /(?:youtube\.com|youtu\.be)/i.test(att.alternateLink || ''))
                            const isWebLink = !att.driveFileId && Boolean(att.alternateLink) && !isYouTube

                            return (
                              <div
                                key={att.id}
                                className="flex items-center justify-between gap-2 rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-2.5 text-[11.5px]"
                              >
                                <div
                                  onClick={() => {
                                    if (isWebLink && att.alternateLink) {
                                      void window.jmcAPI?.openExternalUrl(att.alternateLink)
                                    } else if (onPreviewAttachment) {
                                      onPreviewAttachment(att)
                                    }
                                  }}
                                  className={`flex items-center gap-2 min-w-0 flex-1 cursor-pointer hover:text-[var(--jmc-primary)] transition-colors`}
                                  title={isWebLink ? 'Bağlantıyı tarayıcıda açmak için tıklayın' : 'Görüntülemek için tıklayın'}
                                >
                                  {isYouTube ? (
                                    <YouTubeIcon className="h-4 w-4 shrink-0 text-red-500" />
                                  ) : isWebLink ? (
                                    <LinkIcon className="h-4 w-4 shrink-0 text-indigo-400" />
                                  ) : att.driveFileId ? (
                                    <FileText className="h-4 w-4 shrink-0 text-blue-500" />
                                  ) : (
                                    <Paperclip className="h-4 w-4 shrink-0 text-[var(--jmc-text-dim)]" />
                                  )}
                                  <span className="truncate font-medium">{att.title || (isWebLink ? 'Web Bağlantısı' : 'Materyal')}</span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {isYouTube ? (
                                    <>
                                      {onPreviewAttachment && (
                                        <button
                                          type="button"
                                          onClick={() => onPreviewAttachment(att)}
                                          title="Videoyu Uygulama İçinde İzle"
                                          className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-1 text-[10.5px] font-semibold text-red-400 hover:bg-red-500/25 transition-colors"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                          <span>İzle</span>
                                        </button>
                                      )}
                                      {att.alternateLink && (
                                        <button
                                          type="button"
                                          onClick={() => void window.jmcAPI?.openExternalUrl(att.alternateLink!)}
                                          title="YouTube'da Aç"
                                          className="rounded p-1 text-[var(--jmc-text-dim)] hover:text-red-400 hover:bg-[var(--jmc-bg)] transition-colors"
                                        >
                                          <ExternalLink className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </>
                                  ) : isWebLink ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => void window.jmcAPI?.openExternalUrl(att.alternateLink!)}
                                        title="Bağlantıyı Tarayıcıda Aç"
                                        className="inline-flex items-center gap-1 rounded bg-[var(--jmc-primary)]/15 px-2.5 py-1 text-[10.5px] font-semibold text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/25 transition-colors"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        <span>Aç</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          await window.jmcAPI?.copyText(att.alternateLink!)
                                        }}
                                        title="Bağlantıyı Kopyala"
                                        className="rounded p-1 text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-bg)] transition-colors"
                                      >
                                        <LinkIcon className="h-3.5 w-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {onPreviewAttachment && (att.driveFileId || att.isLocalAvailable) && (
                                        <button
                                          type="button"
                                          onClick={() => onPreviewAttachment(att)}
                                          title="Uygulama İçinde Görüntüle"
                                          className="inline-flex items-center gap-1 rounded bg-[var(--jmc-primary)]/15 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/25 transition-colors"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                          <span>Görüntüle</span>
                                        </button>
                                      )}
                                      {(() => {
                                        const status = downloadedStatusMap[att.id] || (att.driveFileId ? downloadedStatusMap[att.driveFileId] : undefined)
                                        const isDownloaded = Boolean(status?.exists || (att.isLocalAvailable && (att.downloadedPath || att.localPath)))
                                        const targetPath = status?.filePath || att.downloadedPath || att.localPath
                                        const isDownloading = Boolean(downloadingIds[att.id])

                                        if (isDownloaded && targetPath) {
                                          return (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => void (window.jmcAPI?.openPath ? window.jmcAPI.openPath(targetPath) : window.jmcAPI?.openLocalFile(targetPath))}
                                                title="İndirilen Dosyayı Aç"
                                                className="inline-flex items-center gap-1 rounded bg-[var(--jmc-success)]/15 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-success)] hover:bg-[var(--jmc-success)]/25 transition-colors"
                                              >
                                                <FolderOpen className="h-3.5 w-3.5" />
                                                <span>Aç</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => void window.jmcAPI?.showItemInFolder?.(targetPath)}
                                                title="İndirilenler Klasöründe Göster"
                                                className="inline-flex items-center gap-1 rounded border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2 py-1 text-[10.5px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] transition-colors"
                                              >
                                                <Folder className="h-3.5 w-3.5 text-amber-500" />
                                                <span className="hidden sm:inline">Klasörde</span>
                                              </button>
                                            </>
                                          )
                                        }

                                        if (onDownloadAttachment && att.driveFileId) {
                                          return (
                                            <button
                                              type="button"
                                              onClick={() => void handleDownloadItem(att)}
                                              disabled={isDownloading}
                                              title="İndirilenler Klasörüne İndir"
                                              className="inline-flex items-center gap-1 rounded border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2 py-1 text-[10.5px] font-medium text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] transition-colors disabled:opacity-50"
                                            >
                                              {isDownloading ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--jmc-primary)]" />
                                              ) : (
                                                <Download className="h-3.5 w-3.5" />
                                              )}
                                              <span>{isDownloading ? 'İndiriliyor...' : 'İndir'}</span>
                                            </button>
                                          )
                                        }

                                        return null
                                      })()}
                                      {att.alternateLink && (
                                        <button
                                          type="button"
                                          onClick={() => void window.jmcAPI?.openExternalUrl(att.alternateLink!)}
                                          title="Google Drive'da Aç"
                                          className="rounded p-1 text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] hover:bg-[var(--jmc-bg)]"
                                        >
                                          <ExternalLink className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {onInspectAttachment && (
                                    <button
                                      type="button"
                                      onClick={() => onInspectAttachment(att)}
                                      title="Yapay Zekâ Asistanı ile İncele"
                                      className="inline-flex items-center gap-1 rounded bg-[var(--jmc-primary)]/10 border border-[var(--jmc-primary)]/20 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/20 transition-colors"
                                    >
                                      <Sparkles className="h-3 w-3" />
                                      <span className="hidden sm:inline">İncele</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </article>
                )
              })
            )}
          </div>
        )}

        {/* ================= TAB 4: KATILIMCILAR ================= */}
        {activeTab === 'people' && (
          <div className="space-y-6 max-w-3xl">
            {/* Eğitmenler */}
            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--jmc-text-dim)]">
                Öğretmenler ({teachers.length})
              </h3>
              <div className="grid gap-2">
                {teachers.map(t => (
                  <div
                    key={t.userId}
                    className="flex items-center justify-between rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-3 shadow-[var(--jmc-shadow-sm)]"
                  >
                    <div className="flex items-center gap-3">
                      {t.photoUrl ? (
                        <img
                          src={t.photoUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--jmc-primary)]/15 text-[12px] font-semibold text-[var(--jmc-primary)]">
                          {t.fullName?.[0] || 'Ö'}
                        </div>
                      )}
                      <div>
                        <span className="block text-[12.5px] font-semibold text-[var(--jmc-text)]">
                          {t.fullName || 'Öğretmen'}
                        </span>
                        {t.email && (
                          <span className="block text-[11px] text-[var(--jmc-text-dim)]">
                            {t.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="rounded-full bg-[var(--jmc-primary)]/10 px-2.5 py-0.5 text-[10.5px] font-medium text-[var(--jmc-primary)]">
                      Eğitmen
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Sınıf Arkadaşları / Öğrenciler */}
            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--jmc-text-dim)]">
                Sınıf Arkadaşları ({students.length})
              </h3>
              {students.length === 0 ? (
                <div className="rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] p-4 text-[12px] text-[var(--jmc-text-muted)] leading-relaxed">
                  Üniversite veya kurum güvenlik ilkeleri gereği öğrenciler için sınıf arkadaşı listeleme yetkisi sınırlandırılmış olabilir. Sınıf içeriğine, ödevlerinize ve teslimlerinize eksiksiz erişebilirsiniz.
                </div>
              ) : (
                <div className="grid gap-2">
                  {students.map(s => (
                    <div
                      key={s.userId}
                      className="flex items-center justify-between rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-elevated)] p-3"
                    >
                      <div className="flex items-center gap-3">
                        {s.photoUrl ? (
                          <img
                            src={s.photoUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--jmc-bg-surface)] text-[12px] font-semibold text-[var(--jmc-text-dim)]">
                            {s.fullName?.[0] || 'Ö'}
                          </div>
                        )}
                        <div>
                          <span className="block text-[12.5px] font-medium text-[var(--jmc-text)]">
                            {s.fullName || 'Öğrenci'}
                          </span>
                          {s.email && (
                            <span className="block text-[11px] text-[var(--jmc-text-dim)]">
                              {s.email}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="rounded-full bg-[var(--jmc-bg-surface)] px-2 py-0.5 text-[10px] text-[var(--jmc-text-dim)]">
                        Öğrenci
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
