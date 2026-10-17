import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  CloudUpload,
  Code2,
  Copy,
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  PencilLine,
  Save,
  Sparkles,
  Undo2,
} from 'lucide-react'
import { Attachment, Course, CourseWork, DraftEntry, Rubric, StudentSubmission } from '../../types/jmc'
import { useI18n } from '../../i18n/i18nContext'

interface DocumentStudioProps {
  course: Course | null
  courseWork: CourseWork
  rubric?: Rubric
  submission?: StudentSubmission
  onDownloadAttachment: (att: Attachment) => void
  onSelectFileForContext: (att: Attachment) => void
  onPreviewAttachment?: (att: Attachment) => void
  onInspectAttachment?: (att: Attachment) => void
  onTriggerAiMode: (mode: 'socratic' | 'draft' | 'rubric' | 'quiz') => void
  /** Teslim sonrasi AppLayout'un yerel durumunu gunceller. */
  onSubmissionChanged?: (state: StudentSubmission['state']) => void
  /** Dersin genel bakış sayfasına geri döner. */
  onBackToCourse?: () => void
}

type Tab = 'instructions' | 'rubric' | 'draft'

type Notice = { tone: 'ok' | 'error'; text: string } | null

/**
 * Odev adindan guvenli, kararli bir dosya adi uretir.
 * Ogrencinin adini veya sabit bir sablonu diske YAZMAZ; icerik
 * tamamen ogreninin yazdigindan gelir.
 */
function suggestFileName(work: CourseWork): string {
  const base = work.title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
  return `${base || 'calisma'}.md`
}

/** Google'in teslim durumlarini Turkce karsiliklariyla etiketler. */
function submissionLabel(state?: StudentSubmission['state'], t?: (key: string) => string): string | null {
  if (!state) return null
  if (t) {
    const key = `coursework.status.${state === 'RECLAIMED_BY_STUDENT' ? 'RECLAIMED' : state}`
    const val = t(key)
    if (val && val !== key) return val
  }
  switch (state) {
    case 'NEW':
      return 'Henüz başlanmadı'
    case 'CREATED':
      return 'Taslak oluşturuldu'
    case 'TURNED_IN':
      return 'Teslim edildi'
    case 'RETURNED':
      return 'Notlandırıldı'
    case 'RECLAIMED_BY_STUDENT':
      return 'Geri çekildi'
    default:
      return null
  }
}

export const DocumentStudio: React.FC<DocumentStudioProps> = ({
  course,
  courseWork,
  rubric,
  submission,
  onDownloadAttachment,
  onSelectFileForContext,
  onPreviewAttachment,
  onInspectAttachment,
  onTriggerAiMode,
  onSubmissionChanged,
  onBackToCourse,
}) => {
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<Tab>('instructions')
  const [draft, setDraft] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'save' | 'turnin' | 'reclaim' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [downloadedStatusMap, setDownloadedStatusMap] = useState<Record<string, { exists: boolean; filePath?: string }>>({})
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({})

  const courseId = course?.id ?? ''
  const workId = courseWork.id

  // ---- Taslak yukleme ---------------------------------------------------
  useEffect(() => {
    let cancelled = false
    setDirty(false)
    setNotice(null)
    setDraft('')
    setFileName(suggestFileName(courseWork))

    if (!courseId || !window.jmcAPI?.getDraft) {
      return () => {
        cancelled = true
      }
    }
    void window.jmcAPI
      .getDraft(courseId, workId)
      .then((entry: DraftEntry | null) => {
        if (cancelled || !entry) return
        setDraft(entry.content)
        setFileName(entry.fileName)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [courseId, workId, courseWork])

  const flash = useCallback((next: Notice) => {
    setNotice(next)
    if (next) window.setTimeout(() => setNotice(null), 6000)
  }, [])

  /**
   * Kopyalama hatasini bildirim olarak gosterir.
   *
   * `flash` yukarida tanimli oldugu icin bu yordam, kopyalama
   * isleminin kendisinden ayri tutulur.
   */
  const notifyCopyFailure = useCallback(
    (err: unknown) => {
      flash({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Taslak panoya kopyalanamadı.',
      })
    },
    [flash],
  )

  /**
   * Taslagi panoya kopyalar.
   *
   * `navigator.clipboard` bir promise dondurdugu icin onceki surumde
   * `.catch()` eksikti ve basarisizlik `window.onunhandledrejection`
   * icinde kayboluyordu; kullanici hicbir geri bildirim almiyordu.
   * Artik Electron pano modulu ana surecten cagrilir ve hata durumu
   * bildirim olarak gosterilir.
   */
  const handleCopyDraft = useCallback(() => {
    if (!draft) return
    void window.jmcAPI
      .copyText(draft)
      .then(() => {
        setCopied(true)
        setCopyFailed(false)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(err => {
        setCopied(false)
        setCopyFailed(true)
        setTimeout(() => setCopyFailed(false), 2200)
        notifyCopyFailure(err)
      })
  }, [draft, notifyCopyFailure])

  const handleSave = useCallback(async () => {
    if (!courseId) return
    setBusy('save')
    try {
      await window.jmcAPI.saveDraft(courseId, workId, fileName, draft)
      setDirty(false)
      flash({ tone: 'ok', text: t('coursework.draftSavedNotice') })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : t('coursework.draftSaveError') })
    } finally {
      setBusy(null)
    }
  }, [courseId, workId, fileName, draft, flash, t])

  const handleTurnIn = useCallback(async () => {
    if (!courseId) return
    if (!submission) {
      flash({
        tone: 'error',
        text: t('coursework.noSubmissionError'),
      })
      return
    }
    if (!draft.trim()) {
      flash({ tone: 'error', text: t('coursework.emptyDraftError') })
      setTab('draft')
      return
    }

    setBusy('turnin')
    try {
      // Once taslagi sifreli depoya yaz: ag hatasi olursa is kaybolmaz.
      await window.jmcAPI.saveDraft(courseId, workId, fileName, draft)
      setDirty(false)
      await window.jmcAPI.attachAndTurnIn(courseId, workId, submission.id, fileName, draft)
      onSubmissionChanged?.('TURNED_IN')
      flash({ tone: 'ok', text: t('coursework.turnedInNotice') })
    } catch (err) {
      flash({
        tone: 'error',
        text: err instanceof Error ? err.message : t('coursework.turnInError'),
      })
    } finally {
      setBusy(null)
    }
  }, [courseId, workId, submission, fileName, draft, flash, onSubmissionChanged, t])

  const handleReclaim = useCallback(async () => {
    if (!courseId || !submission) return
    setBusy('reclaim')
    try {
      await window.jmcAPI.reclaim(courseId, workId, submission.id)
      onSubmissionChanged?.('RECLAIMED_BY_STUDENT')
      flash({ tone: 'ok', text: t('coursework.reclaimedNotice') })
    } catch (err) {
      flash({ tone: 'error', text: err instanceof Error ? err.message : t('coursework.reclaimError') })
    } finally {
      setBusy(null)
    }
  }, [courseId, workId, submission, flash, onSubmissionChanged, t])

  // ---- Gosterilecek gercek degerler -------------------------------------
  const stateLabel = useMemo(() => submissionLabel(submission?.state, t), [submission?.state, t])
  const isTurnedIn = submission?.state === 'TURNED_IN' || submission?.state === 'RETURNED'
  const dueDate = courseWork.dueDate
    ? new Date(
        courseWork.dueDate.year,
        courseWork.dueDate.month - 1,
        courseWork.dueDate.day,
        courseWork.dueTime?.hours ?? 23,
        courseWork.dueTime?.minutes ?? 59,
      )
    : null
  const submittedFiles = submission?.assignmentSubmission?.attachments ?? []

  // Disk üzerindeki indirilen dosyaları kontrol et
  useEffect(() => {
    let cancelled = false
    if (!window.jmcAPI?.checkDownloadedFile) return

    const allAttachments = [...(courseWork.materials || []), ...(submittedFiles || [])]
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
  }, [courseWork.materials, submittedFiles])

  const handleDownloadItem = async (att: Attachment) => {
    setDownloadingIds(prev => ({ ...prev, [att.id]: true }))
    try {
      await onDownloadAttachment(att)
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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--jmc-bg)] text-[var(--jmc-text)]">
      {/* ---------------- Başlık ---------------- */}
      <header className="space-y-3.5 bg-[var(--jmc-bg-elevated)] px-6 pb-4 pt-5 shadow-[var(--jmc-shadow-sm)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {onBackToCourse && (
              <button
                type="button"
                onClick={onBackToCourse}
                className="mb-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--jmc-link)] hover:underline transition-all group"
              >
                <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                <span>{course?.name ? `${course.name} Genel Bakışına Dön` : 'Ders Genel Bakışı'}</span>
              </button>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
              <span className="rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-badge-bg)] px-2 py-0.5 font-medium text-[var(--jmc-primary)]">
                {courseWork.workType === 'ASSIGNMENT'
                  ? t('coursework.workType.ASSIGNMENT')
                  : courseWork.workType === 'SHORT_ANSWER_QUESTION'
                    ? t('coursework.workType.SHORT_ANSWER_QUESTION')
                    : t('coursework.workType.MULTIPLE_CHOICE_QUESTION')}
              </span>
              {dueDate && (
                <span className="text-[var(--jmc-text-muted)]">
                  {t('coursework.due')}: {dueDate.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'long' })}
                </span>
              )}
              {/* Puan bilgisi yoksa sayı uydurulmaz. */}
              {courseWork.maxPoints != null && (
                <span className="text-[var(--jmc-text-muted)]">
                  {courseWork.maxPoints} {t('coursework.points')}
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-[19px] font-semibold leading-tight tracking-tight">
              {courseWork.title}
            </h1>
          </div>

          {/* Teslim durumu ve eylemler */}
          <div className="flex shrink-0 items-center gap-2">
            {stateLabel && (
              <span className="rounded-full bg-[var(--jmc-bg-surface)] px-2.5 py-1 text-[11px] text-[var(--jmc-text-muted)]">
                {stateLabel}
                {submission?.assignedGrade != null && ` · ${submission.assignedGrade} ${t('coursework.points').toLowerCase()}`}
              </span>
            )}
            {isTurnedIn ? (
              <button
                type="button"
                onClick={handleReclaim}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] transition-colors hover:text-[var(--jmc-text)] disabled:opacity-50"
              >
                {busy === 'reclaim' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Undo2 className="h-3.5 w-3.5" />
                )}
                {t('coursework.reclaim')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleTurnIn}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3.5 py-1.5 text-[11.5px] font-medium text-[var(--jmc-on-primary)] hover:text-[var(--jmc-on-primary-hover)] shadow-[var(--jmc-shadow-sm)] transition-colors hover:bg-[var(--jmc-primary-hover)] disabled:opacity-50"
              >
                {busy === 'turnin' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="h-3.5 w-3.5" />
                )}
                {t('coursework.turnIn')}
              </button>
            )}
          </div>
        </div>

        {/* Sekmeler ve kısayollar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav className="flex items-center gap-1" aria-label="Görev görünümü">
            <TabButton active={tab === 'instructions'} onClick={() => setTab('instructions')}>
              <FileText className="h-3.5 w-3.5" />
              {t('coursework.instructions')}
            </TabButton>
            {rubric && rubric.criteria.length > 0 && (
              <TabButton active={tab === 'rubric'} onClick={() => setTab('rubric')}>
                <ListChecks className="h-3.5 w-3.5" />
                {t('coursework.rubricTitle')}
                <span className="text-[var(--jmc-text-dim)]">({rubric.criteria.length})</span>
              </TabButton>
            )}
            <TabButton active={tab === 'draft'} onClick={() => setTab('draft')}>
              <PencilLine className="h-3.5 w-3.5" />
              {t('coursework.solutionReport')}
              {dirty && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--jmc-warning)]"
                  title="Kaydedilmemiş değişiklik"
                />
              )}
            </TabButton>
          </nav>

          <div className="flex items-center gap-1.5">
            <AiShortcut
              onClick={() => onTriggerAiMode('rubric')}
              label={t('ai.quick.rubric')}
              icon={<ListChecks className="h-3.5 w-3.5" />}
            />
            <AiShortcut
              onClick={() => onTriggerAiMode('socratic')}
              label={t('ai.mode.socratic')}
              icon={<MessageCircleQuestion className="h-3.5 w-3.5" />}
            />
          </div>
        </div>

        {notice && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-[var(--jmc-radius)] px-3 py-2 text-[11.5px] leading-relaxed ${
              notice.tone === 'ok'
                ? 'bg-[var(--jmc-bg-surface)] text-[var(--jmc-success)]'
                : 'bg-[var(--jmc-badge-bg)] text-[var(--jmc-warning)]'
            }`}
          >
            {notice.tone === 'ok' ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
        )}
      </header>

      {/* ---------------- Gövde ---------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {tab === 'instructions' && (
          <div className="max-w-3xl space-y-6">
            <section>
              <SectionHeading>{t('coursework.instructions')}</SectionHeading>
              {courseWork.description?.trim() ? (
                <p className="whitespace-pre-wrap text-[13px] leading-[1.7] text-[var(--jmc-text)]">
                  {courseWork.description}
                </p>
              ) : (
                <p className="text-[12.5px] italic text-[var(--jmc-text-dim)]">
                  {t('coursework.noInstructions')}
                </p>
              )}
            </section>

            <section>
              <SectionHeading>
                {t('coursework.materials')}
                {courseWork.materials.length > 0 && (
                  <span className="text-[var(--jmc-text-dim)]"> ({courseWork.materials.length})</span>
                )}
              </SectionHeading>
              {courseWork.materials.length === 0 ? (
                <p className="text-[12.5px] text-[var(--jmc-text-dim)]">{t('coursework.noMaterials')}</p>
              ) : (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {courseWork.materials.map(mat => (
                    <li key={mat.id}>
                      <AttachmentRow
                        attachment={mat}
                        onOpen={() => onSelectFileForContext(mat)}
                        onPreview={() => onPreviewAttachment?.(mat)}
                        onInspect={() => onInspectAttachment?.(mat)}
                        onDownload={() => void handleDownloadItem(mat)}
                        isDownloading={Boolean(downloadingIds[mat.id])}
                        downloadedStatus={downloadedStatusMap[mat.id] || (mat.driveFileId ? downloadedStatusMap[mat.driveFileId] : undefined)}
                        downloadLabel={t('coursework.download')}
                        localLabel={t('coursework.offlineAvailable')}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {submittedFiles.length > 0 && (
              <section>
                <SectionHeading>{t('coursework.submittedFiles')}</SectionHeading>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {submittedFiles.map(att => (
                    <li key={att.id}>
                      <AttachmentRow
                        attachment={att}
                        onOpen={() => onSelectFileForContext(att)}
                        onPreview={() => onPreviewAttachment?.(att)}
                        onInspect={() => onInspectAttachment?.(att)}
                        onDownload={() => void handleDownloadItem(att)}
                        isDownloading={Boolean(downloadingIds[att.id])}
                        downloadedStatus={downloadedStatusMap[att.id] || (att.driveFileId ? downloadedStatusMap[att.driveFileId] : undefined)}
                        downloadLabel={t('coursework.download')}
                        localLabel={t('coursework.offlineAvailable')}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/*
              METIN CEVABI
              ------------
              Kisa yanitli ve coktan secmeli odevlerde dosya EKLENMEZ;
              cevap `shortAnswerSubmission` / `multipleChoiceSubmission`
              alanlarinda durur. Onceki surum bu alanlari hic ayristirmiyor
              ve hic gostermiyordu: ogrenci kendi cevabini gondermis,
              teslim edilmis gorunuyor ama NE YAZDIGINI GOREMIYORDU.
            */}
            {(submission?.shortAnswerSubmission?.answer ||
              submission?.multipleChoiceSubmission?.answer) && (
              <section>
                <SectionHeading>
                  {submission?.shortAnswerSubmission?.answer
                    ? 'Gönderdiğiniz Cevap'
                    : 'Seçiminiz'}
                </SectionHeading>
                <div className="whitespace-pre-wrap rounded-[var(--jmc-radius)] border border-[var(--jmc-border)] bg-[var(--jmc-bg-surface)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--jmc-text)]">
                  {submission?.shortAnswerSubmission?.answer ||
                    submission?.multipleChoiceSubmission?.answer}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === 'rubric' && rubric && (
          <div className="max-w-3xl space-y-4">
            <p className="text-[12.5px] leading-relaxed text-[var(--jmc-text-muted)]">
              {t('coursework.rubricIntro')}
            </p>
            {rubric.criteria.map((crit, idx) => (
              <section key={crit.id} className="space-y-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[13px] font-medium">
                    {idx + 1}. {crit.title}
                  </h3>
                  {/* Agirlik yoksa sayi gosterilmez. */}
                  {crit.weight != null && (
                    <span className="shrink-0 text-[11px] text-[var(--jmc-text-dim)]">
                      {t('coursework.weight')} {crit.weight}
                    </span>
                  )}
                </div>
                {crit.description && (
                  <p className="text-[12px] leading-relaxed text-[var(--jmc-text-muted)]">
                    {crit.description}
                  </p>
                )}
                <ul className="grid gap-1.5 sm:grid-cols-3">
                  {crit.levels.map(level => (
                    <li
                      key={level.levelId}
                      className="rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-2 shadow-[var(--jmc-shadow-sm)]"
                    >
                      <div className="flex items-baseline justify-between gap-2 text-[12px] font-medium">
                        <span>{level.title}</span>
                        {level.points != null && (
                          <span className="font-mono text-[11px] text-[var(--jmc-primary)]">
                            {level.points}
                          </span>
                        )}
                      </div>
                      {level.description && (
                        <p className="mt-1 text-[11px] leading-snug text-[var(--jmc-text-dim)]">
                          {level.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {tab === 'draft' && (
          <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <label htmlFor="jmc-draft-name" className="sr-only">
                  {t('coursework.fileName')}
                </label>
                <input
                  id="jmc-draft-name"
                  type="text"
                  value={fileName}
                  onChange={e => {
                    setFileName(e.target.value)
                    setDirty(true)
                  }}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 font-mono text-[12px] text-[var(--jmc-text)] outline-none transition-shadow focus:shadow-[var(--jmc-shadow-sm)]"
                />
                <span className="shrink-0 text-[11px] text-[var(--jmc-text-dim)]">
                  {draft.length.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')} {t('coursework.chars')}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyDraft}
                disabled={!draft}
                title={
                  copyFailed
                    ? 'Kopyalanamadı'
                    : copied
                      ? t('coursework.codeCopied')
                      : t('coursework.copyCode')
                }
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-text-muted)] transition-colors hover:text-[var(--jmc-text)] disabled:opacity-50"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-[var(--jmc-success)]" />
                ) : copyFailed ? (
                  <AlertCircle className="h-3.5 w-3.5 text-[var(--jmc-danger)]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? t('coursework.codeCopied') : copyFailed ? 'Kopyalanamadı' : t('coursework.copyCode')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={busy !== null || !courseId}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-primary)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--jmc-on-primary)] hover:text-[var(--jmc-on-primary-hover)] transition-colors hover:bg-[var(--jmc-primary-hover)] disabled:opacity-50"
              >
                {busy === 'save' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {t('settings.save')}
              </button>
            </div>

            <p className="text-[11px] leading-relaxed text-[var(--jmc-text-dim)]">
              {t('coursework.draftDisclaimer').replace('{turnIn}', t('coursework.turnIn'))}
            </p>

            <label htmlFor="jmc-draft-body" className="sr-only">
              {t('coursework.workContent')}
            </label>
            <textarea
              id="jmc-draft-body"
              value={draft}
              onChange={e => {
                setDraft(e.target.value)
                setDirty(true)
              }}
              spellCheck
              placeholder={t('coursework.draftPlaceholder')}
              className="min-h-[26rem] w-full flex-1 resize-y rounded-[var(--jmc-radius-lg)] bg-[var(--jmc-code-bg)] p-4 font-mono text-[12.5px] leading-[1.65] text-[var(--jmc-text)] outline-none"
            />
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const TabButton: React.FC<{
  active: boolean
  onClick: () => void
  children: React.ReactNode
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] px-2.5 py-1.5 text-[12px] transition-colors ${
      active
        ? 'bg-[var(--jmc-bg-surface)] font-medium text-[var(--jmc-primary)] shadow-[var(--jmc-shadow-sm)]'
        : 'text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)]'
    }`}
  >
    {children}
  </button>
)

const AiShortcut: React.FC<{
  onClick: () => void
  label: string
  icon: React.ReactNode
}> = ({ onClick, label, icon }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-2.5 py-1.5 text-[11.5px] text-[var(--jmc-text-muted)] transition-colors hover:text-[var(--jmc-primary)]"
  >
    {icon}
    {label}
  </button>
)

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--jmc-text-dim)]">
    {children}
  </h2>
)

const AttachmentRow: React.FC<{
  attachment: Attachment
  onOpen: () => void
  onPreview?: () => void
  onInspect?: () => void
  onDownload: () => void
  isDownloading?: boolean
  downloadedStatus?: { exists: boolean; filePath?: string }
  downloadLabel: string
  localLabel: string
}> = ({
  attachment,
  onOpen,
  onPreview,
  onInspect,
  onDownload,
  isDownloading,
  downloadedStatus,
  downloadLabel,
  localLabel,
}) => {
  const { t } = useI18n()
  const isPdf = Boolean(attachment.mimeType?.includes('pdf'))
  const isDownloaded = Boolean(
    downloadedStatus?.exists ||
    (attachment.isLocalAvailable && (attachment.downloadedPath || attachment.localPath))
  )
  const targetPath =
    downloadedStatus?.filePath ||
    attachment.downloadedPath ||
    attachment.localPath

  const meta = isDownloaded
    ? `${localLabel} · ${attachment.sha256 ? `sha256 ${attachment.sha256.slice(0, 12)}` : 'Yerel kopya'}`
    : attachment.driveFileId
      ? t('coursework.onDrive')
      : t('coursework.link')

  return (
    <div className="flex items-center gap-2 rounded-[var(--jmc-radius)] bg-[var(--jmc-bg-surface)] px-3 py-2 shadow-[var(--jmc-shadow-sm)] border border-[var(--jmc-border-subtle)]">
      {isPdf ? (
        <FileText className="h-4 w-4 shrink-0 text-[var(--jmc-text-dim)]" />
      ) : (
        <Code2 className="h-4 w-4 shrink-0 text-[var(--jmc-text-dim)]" />
      )}
      <button
        type="button"
        onClick={() => onPreview ? onPreview() : onOpen()}
        className="min-w-0 flex-1 text-left"
        title="Görüntülemek için tıklayın"
      >
        <span className="block truncate text-[12px] font-medium hover:text-[var(--jmc-primary)] transition-colors">
          {attachment.title}
        </span>
        <span className="block truncate font-mono text-[10.5px] text-[var(--jmc-text-dim)]">
          {meta}
        </span>
      </button>

      <div className="flex items-center gap-1 shrink-0">
        {onPreview && (attachment.driveFileId || isDownloaded || attachment.alternateLink) && (
          <button
            type="button"
            onClick={onPreview}
            title="Uygulama İçinde Görüntüle"
            className="inline-flex items-center gap-1 rounded bg-[var(--jmc-primary)]/15 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/25 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>Görüntüle</span>
          </button>
        )}

        {onInspect && (attachment.driveFileId || isDownloaded || attachment.alternateLink) && (
          <button
            type="button"
            onClick={onInspect}
            title="Yapay Zekâ Asistanı ile İncele"
            className="inline-flex items-center gap-1 rounded bg-[var(--jmc-primary)]/10 border border-[var(--jmc-primary)]/20 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-primary)] hover:bg-[var(--jmc-primary)]/20 transition-colors"
          >
            <Sparkles className="h-3 w-3" />
            <span className="hidden sm:inline">İncele</span>
          </button>
        )}

        {isDownloaded && targetPath ? (
          <>
            <button
              type="button"
              onClick={() => void (window.jmcAPI?.openPath ? window.jmcAPI.openPath(targetPath) : window.jmcAPI?.openLocalFile(targetPath))}
              title="İndirilen Dosyayı Aç"
              className="inline-flex items-center gap-1 rounded-[var(--jmc-radius-sm)] bg-[var(--jmc-success)]/15 px-2 py-1 text-[10.5px] font-semibold text-[var(--jmc-success)] hover:bg-[var(--jmc-success)]/25 transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Aç</span>
            </button>
            <button
              type="button"
              onClick={() => void window.jmcAPI?.showItemInFolder?.(targetPath)}
              title="İndirilenler Klasöründe Göster"
              className="inline-flex items-center gap-1 rounded-[var(--jmc-radius-sm)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2 py-1 text-[10.5px] font-medium text-[var(--jmc-text-muted)] hover:text-[var(--jmc-text)] transition-colors"
            >
              <Folder className="h-3.5 w-3.5 text-amber-500" />
              <span className="hidden sm:inline">Klasörde</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onDownload}
            disabled={isDownloading}
            title={downloadLabel}
            aria-label={`${downloadLabel}: ${attachment.title}`}
            className="inline-flex items-center gap-1 rounded-[var(--jmc-radius-sm)] border border-[var(--jmc-border)] bg-[var(--jmc-bg)] px-2 py-1 text-[10.5px] font-medium text-[var(--jmc-text-dim)] hover:text-[var(--jmc-text)] hover:border-[var(--jmc-primary)] transition-colors disabled:opacity-50"
          >
            {isDownloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--jmc-primary)]" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>{isDownloading ? 'İndiriliyor...' : 'İndir'}</span>
          </button>
        )}
      </div>
    </div>
  )
}