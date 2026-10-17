import crypto from 'node:crypto'
import {
  Course,
  CourseWork,
  CourseParticipant,
  Attachment,
} from '../../types/jmc'
import { StorageService } from './storageService'
import { VaultService } from './vaultService'
import { AuthService } from './authService'
import { googleHttp, HttpError } from './httpClient'
import { log } from './logger'

const API = 'https://classroom.googleapis.com/v1'

/** Google'in API'de dondurdugu tum sayfalar bitmeden liste "tamam" sayilmaz. */
function pageUrl(base: string, pageToken?: string): string {
  const url = new URL(base)
  url.searchParams.set('pageSize', '100')
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  return url.toString()
}

export class ClassroomService {
  constructor(
    private storageService: StorageService,
    private vaultService: VaultService,
    private authService: AuthService,
  ) {}

  private async getValidAccessToken(): Promise<string | null> {
    if (typeof this.authService.getValidAccessToken === 'function') {
      return this.authService.getValidAccessToken()
    }
    const token = this.vaultService.getKey('google_access_token')
    if (token) return token
    return this.authService.refreshAccessToken()
  }

  /**
   * 401 Unauthorized alındığında Google OAuth erişim belirtecini (access_token)
   * otomatik yenileyip isteği kullanıcıya hata yansıtmadan tekrarlar.
   */
  private async withFreshToken<T>(
    run: (token: string) => Promise<T>,
    initialToken?: string,
  ): Promise<T> {
    const token = initialToken || (await this.getValidAccessToken())
    if (!token) {
      throw new Error('Google Classroom oturumu bulunamadı. Lütfen yeniden giriş yapın.')
    }
    try {
      return await run(token)
    } catch (err) {
      const is401 =
        (err instanceof HttpError && (err.status === 401 || err.isAuthError)) ||
        /\b401\b|unauthorized/i.test(err instanceof Error ? err.message : String(err))
      if (!is401) throw err
      const refreshed = await this.authService.refreshAccessToken()
      if (!refreshed) {
        throw new Error('Oturumunuzun süresi doldu (401). Lütfen Ayarlar > Hesap bölümünden yeniden bağlanın.')
      }
      return await run(refreshed)
    }
  }

  private async authedPaginate<T>(
    urlForPage: (pageToken?: string) => string,
    extract: (page: any) => T[] | undefined,
    initialToken?: string,
  ): Promise<T[]> {
    return this.withFreshToken(
      activeToken =>
        googleHttp.paginate<T>(urlForPage, extract, {
          headers: { Authorization: `Bearer ${activeToken}` },
        }),
      initialToken,
    )
  }

  /**
   * Yetkili GET. 401 alinirsa token bir kez yenilenir ve istek tekrarlanir.
   * 403 ise kapsam/rol eksikligidir ve kullaniciya acikca bildirilir.
   */
  private async authedGet<T>(url: string, token?: string): Promise<T> {
    try {
      return await this.withFreshToken(
        activeToken =>
          googleHttp.request<T>(url, {
            headers: { Authorization: `Bearer ${activeToken}` },
          }),
        token,
      )
    } catch (err) {
      if (err instanceof HttpError && err.isPermissionError) {
        throw new Error(
          'Bu kaynağa erişim için gerekli Google izni verilmemiş. Ayarlar > Hesap bölümünden izinleri yenileyin.',
        )
      }
      throw err
    }
  }

  /** Materyal listesini her tur desteklenen sekle donusturur. */
  private parseMaterials(rawMaterials?: any[], courseId = '', workId = ''): Attachment[] {
    if (!Array.isArray(rawMaterials)) return []
    const attachments: Attachment[] = []
    // Deterministik kimlik: ayni materyal her senkronizasyonda ayni id'yi alir.
    const stableId = (prefix: string, key: string) => `${prefix}_${crypto.createHash('sha1').update(`${courseId}/${workId}/${key}`).digest('hex').slice(0, 16)}`

    for (const m of rawMaterials) {
      if (!m || typeof m !== 'object') continue
      if (m.driveFile) {
        const df = m.driveFile.driveFile || m.driveFile
        if (!df?.id) continue
        const cached = this.storageService.getCachedFile(df.id)
        const isLocal = Boolean(cached && cached.entry.syncState !== 'ACCESS_DENIED')
        attachments.push({
          id: stableId('att', df.id),
          title: df.title ?? '',
          mimeType: df.mimeType,
          sizeBytes: df.sizeBytes ? Number(df.sizeBytes) : undefined,
          thumbnailUrl: df.thumbnailUrl,
          alternateLink: df.alternateLink,
          driveFileId: df.id,
          isLocalAvailable: isLocal,
          localPath: isLocal ? cached?.absolutePath : undefined,
          sha256: isLocal ? cached?.entry.sha256 : undefined,
          syncState: isLocal ? cached?.entry.syncState : undefined,
        })
      } else if (m.youtubeVideo) {
        const yv = m.youtubeVideo
        attachments.push({
          id: yv.id ?? stableId('yt', yv.title ?? 'video'),
          title: yv.title ?? '',
          mimeType: 'video/youtube',
          thumbnailUrl: yv.thumbnailUrl,
          alternateLink: yv.alternateLink,
          youTubeVideoId: yv.youtubeVideoId,
          isLocalAvailable: false,
        })
      } else if (m.link) {
        attachments.push({
          id: stableId('link', m.link.url ?? m.link.title ?? ''),
          title: m.link.title || m.link.url || '',
          mimeType: 'text/html',
          thumbnailUrl: m.link.thumbnailUrl,
          alternateLink: m.link.url,
          linkUrl: m.link.url,
          isLocalAvailable: false,
        })
      } else if (m.form) {
        attachments.push({
          id: stableId('form', m.form.formUrl ?? m.form.title ?? ''),
          title: m.form.title || '',
          mimeType: 'application/vnd.google-apps.form',
          thumbnailUrl: m.form.thumbnailUrl,
          formUrl: m.form.formUrl,
          alternateLink: m.form.formUrl,
          isLocalAvailable: false,
        })
      }
    }
    return attachments
  }

  // =========================================================================
  // Tam senkronizasyon
  // =========================================================================
  public async syncAll(): Promise<void> {
    const token = await this.getValidAccessToken()
    if (!token) {
      this.storageService.recordSyncError(
        'Google oturumu bulunamadı. Senkronizasyon için önce Ayarlar > Hesap bölümünden ' +
          'Google ile bağlanın. Mevcut yerel ders ve ödev verileriniz korunuyor.',
      )
      return
    }

    this.storageService.beginSync('Sınıflar alınıyor')
    try {
      const courses: Course[] = []
      // Kullanicinin gercekten uye oldugu tum sinif durumlari.
      for (const courseState of ['ACTIVE', 'ARCHIVED'] as const) {
        const fetched = await this.authedPaginate<any>(
          token2 => pageUrl(`${API}/courses?courseStates=${courseState}`, token2),
          p => p?.courses,
        )
        for (const raw of fetched) {
          courses.push({
            id: raw.id,
            name: raw.name ?? '',
            section: raw.section || undefined,
            descriptionHeading: raw.descriptionHeading || undefined,
            room: raw.room || undefined,
            ownerId: raw.ownerId,
            courseState: raw.courseState ?? courseState,
            alternateLink: raw.alternateLink,
            teacherFolderId: raw.teacherFolder?.id,
            updateTime: raw.updateTime ?? '',
            lastSyncedAt: new Date().toISOString(),
          })
        }
      }

      this.storageService.saveCourses(courses)
      this.storageService.setSyncProgress(0, courses.length, 'Sınıf içerikleri alınıyor')

      let index = 0
      const latestToken = (await this.getValidAccessToken()) || token
      for (const course of courses) {
        try {
          await this.syncCourseDetails(course.id, latestToken)
        } catch (err) {
          const rawMsg = err instanceof Error ? err.message : String(err)
          this.storageService.recordSyncError(`${course.name}: ${this.explainApiError(rawMsg)}`)
        }
        index += 1
        this.storageService.setSyncProgress(index, courses.length, 'Sınıf içerikleri alınıyor')
      }

      this.storageService.updateLastSynced()
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err)
      const explained = this.explainApiError(rawMsg)
      this.storageService.recordSyncError(explained)
      throw new Error(explained)
    } finally {
      this.storageService.endSync()
    }
  }

  /**
   * Kismi senkronizasyon hatasini kaydeder ve kullaniciya anlasilir bir
   * mesaj uretir.
   *
   * ONCEKI SURUM
   * -----------
   * Konu, duyuru, materyal, egitmen, odev, gonderi ve rubrik hatalarinin
   * TAMAMI `log.warn(...)` ile yutuluyordu. `recordSyncError` yalnizca
   * ust duzey hatalarda cagriliyordu ve hicbir zaman bu yollara ulasmiyordu.
   *
   * Sonuc: Classroom API erisim yetkisi eksik oldugunda, ag koptugunda
   * ya da onay ekrani Test modunda oldugunda uygulama "Senkronizasyon
   * tamamlandi" gosteriyor ve eksik veriyi gostermeden kullaniciyi
   * YANILTIYORDU. Kullanici eksik odevlerin ve duyurularin neden
   * gorunmedigini anlayamiyordu.
   *
   * Artik her kismi hata hem konsola yazilir hem de `syncError` ile
   * arayuze tasinir.
   */
  private reportSyncFailure(what: string, err: unknown): void {
    const detail = err instanceof Error ? err.message : String(err)
    log.warn(`[Classroom] ${what} alınamadı:`, err)
    this.storageService.recordSyncError(`${what}: ${this.explainApiError(detail)}`)
  }

  /**
   * Classroom API hata metnini kullaniciya ne yapmasi gerektigini
   * soyleyen Turkce bir mesaja cevirir.
   *
   * `403` ve `401` en sik gorulen ve en cok yanlis yorumlanan durumlardir:
   * 403 "forbidden" anlamina gelmez, cogunlukla OAuth onay ekraninin
   * Test modunda oldugunu ya da eksik kapsam istendigini belirtir.
   */
  private explainApiError(raw: string): string {
    const lower = raw.toLowerCase()
    if (lower.includes('403') || lower.includes('forbidden')) {
      return (
        'Google erişimi reddetti (403). Genellikle OAuth onay ekranı "Test" modunda ' +
        've hesabınız test kullanıcısı olarak eklenmemiş demektir. ' +
        'Google Cloud Console > OAuth Consent Screen > Test Users bölümünden ' +
        'hesabınızı ekleyin ya da uygulamayı "Publish" ile yayınlayın.'
      )
    }
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid_grant')) {
      return 'Oturumunuzun süresi doldu (401). Çıkış yapıp yeniden bağlanın.'
    }
    if (lower.includes('429') || lower.includes('quota') || lower.includes('rateLimitExceeded')) {
      return 'Google API kotası aşıldı (429). Lütfen biraz sonra tekrar deneyin.'
    }
    if (lower.includes('500') || lower.includes('503') || lower.includes('backenderror')) {
      return 'Google hizmetinde geçici bir sorun var. Lütfen biraz sonra tekrar deneyin.'
    }
    if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('enotfound')) {
      return 'İnternet bağlantısı kurulamadı. Bağlantınızı kontrol edip tekrar deneyin.'
    }
    return raw
  }

  private async syncCourseDetails(courseId: string, token: string): Promise<void> {
    // A. Konular
    try {
      const rawTopics = await this.authedPaginate<any>(
        t => pageUrl(`${API}/courses/${encodeURIComponent(courseId)}/topics`, t),
        p => p?.topic,
        token,
      )
      this.storageService.saveTopics(
        courseId,
        rawTopics.map((t: any) => ({ id: t.topicId, courseId, name: t.name ?? '', updateTime: t.updateTime })),
      )
    } catch (err) {
      this.reportSyncFailure('Konular', err)
    }

    // B. Duyurular
    try {
      const rawAnnouncements = await this.authedPaginate<any>(
        t => pageUrl(`${API}/courses/${encodeURIComponent(courseId)}/announcements`, t),
        p => p?.announcements,
        token,
      )
      this.storageService.saveAnnouncements(
        courseId,
        rawAnnouncements.map((a: any) => ({
          id: a.id,
          courseId,
          text: a.text ?? '',
          materials: this.parseMaterials(a.materials, courseId, a.id),
          state: a.state ?? 'PUBLISHED',
          alternateLink: a.alternateLink,
          creationTime: a.creationTime,
          updateTime: a.updateTime,
          creatorUserId: a.creatorUserId,
        })),
      )
    } catch (err) {
      this.reportSyncFailure('Duyurular', err)
    }

    // C. Ders materyalleri
    try {
      const rawMaterials = await this.authedPaginate<any>(
        t => pageUrl(`${API}/courses/${encodeURIComponent(courseId)}/courseWorkMaterials`, t),
        p => p?.courseWorkMaterial,
        token,
      )
      this.storageService.saveMaterials(
        courseId,
        rawMaterials.map((m: any) => ({
          id: m.id,
          courseId,
          topicId: m.topicId,
          title: m.title ?? '',
          description: m.description || undefined,
          materials: this.parseMaterials(m.materials, courseId, m.id),
          state: m.state ?? 'PUBLISHED',
          alternateLink: m.alternateLink,
          creationTime: m.creationTime,
          updateTime: m.updateTime,
        })),
      )
    } catch (err) {
      this.reportSyncFailure('Ders materyalleri', err)
    }

    // D. Katilimcilar (ogretmenler ve ogrenciler)
    const participants: CourseParticipant[] = []
    try {
      const rawTeachers = await this.authedPaginate<any>(
        t => pageUrl(`${API}/courses/${encodeURIComponent(courseId)}/teachers`, t),
        p => p?.teachers,
        token,
      )
      for (const t of rawTeachers) {
        participants.push({
          userId: t.userId,
          courseId,
          role: 'TEACHER',
          fullName: t.profile?.name?.fullName ?? '',
          email: t.profile?.emailAddress,
          photoUrl: t.profile?.photoUrl,
        })
      }
    } catch (err) {
      this.reportSyncFailure('Egitmen listesi', err)
    }

    try {
      const rawStudents = await this.authedPaginate<any>(
        t => pageUrl(`${API}/courses/${encodeURIComponent(courseId)}/students`, t),
        p => p?.students,
        token,
      )
      for (const s of rawStudents) {
        participants.push({
          userId: s.userId,
          courseId,
          role: 'STUDENT',
          fullName: s.profile?.name?.fullName ?? '',
          email: s.profile?.emailAddress,
          photoUrl: s.profile?.photoUrl,
        })
      }
    } catch (err) {
      // Üniversite/kurum politikaları gereği öğrenciler tüm sınıf listesini çekemeyebilir (403 Forbidden).
      // Bu beklenen bir kısıtlamadır; kullanıcıyı yanıltıcı bir hata mesajıyla korkutmak yerine
      // önceki önbelleği korur ve duyuru/ödev yorumlarındaki sınıf arkadaşlarını derleriz.
      const is403 = String(err).includes('403') || (err instanceof HttpError && err.status === 403)
      if (!is403) {
        this.reportSyncFailure('Ogrenci listesi', err)
      } else {
        log.info(`[Classroom] ${courseId} için öğrenci listesi kısıtlı (403). Sınıf arkadaşları yorumlardan derleniyor...`)
      }

      // 1. Önceki oturumlardan kaydedilmiş öğrencileri koru
      try {
        const previous = this.storageService.getParticipants(courseId)
        for (const p of previous) {
          if (p.role === 'STUDENT' && !participants.some(existing => existing.userId === p.userId)) {
            participants.push(p)
          }
        }
      } catch {
        /* yoksay */
      }

      // 2. Duyuru ve ödev yorumlarından sınıf arkadaşlarının profillerini derle
      try {
        const announcements = this.storageService.getAnnouncements(courseId)
        for (const ann of announcements.slice(0, 10)) {
          try {
            const commentsRes = await this.authedGet<any>(
              `${API}/courses/${encodeURIComponent(courseId)}/announcements/${encodeURIComponent(ann.id)}/comments`,
              token,
            )
            const comments: any[] = commentsRes?.comments || []
            for (const c of comments) {
              const profile = c.userProfile
              if (profile?.id && !participants.some(p => p.userId === profile.id)) {
                participants.push({
                  userId: profile.id,
                  courseId,
                  role: 'STUDENT',
                  fullName: profile.name?.fullName || profile.name?.givenName || 'Sınıf Arkadaşı',
                  email: profile.emailAddress,
                  photoUrl: profile.photoUrl,
                })
              }
            }
          } catch {
            /* yoksay */
          }
        }

        const courseWorks = this.storageService.getCourseWork(courseId)
        for (const cw of courseWorks.slice(0, 10)) {
          try {
            const cwCommentsRes = await this.authedGet<any>(
              `${API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(cw.id)}/comments`,
              token,
            )
            const comments: any[] = cwCommentsRes?.comments || []
            for (const c of comments) {
              const profile = c.userProfile
              if (profile?.id && !participants.some(p => p.userId === profile.id)) {
                participants.push({
                  userId: profile.id,
                  courseId,
                  role: 'STUDENT',
                  fullName: profile.name?.fullName || profile.name?.givenName || 'Sınıf Arkadaşı',
                  email: profile.emailAddress,
                  photoUrl: profile.photoUrl,
                })
              }
            }
          } catch {
            /* yoksay */
          }
        }
      } catch {
        /* yoksay */
      }
    }

    // Rol tespiti ve oturum açmış kullanıcının listeye dahil edilmesi
    const account = this.storageService.getAccount()
    if (account && !participants.some(p => p.userId === account.googleSub)) {
      participants.push({
        userId: account.googleSub,
        courseId,
        role: account.role || 'STUDENT',
        fullName: account.displayName || account.email,
        email: account.email,
        photoUrl: account.photoUrl,
      })
    }
    this.storageService.saveParticipants(courseId, participants)

    if (account) {
      const role = participants.some(p => p.userId === account.googleSub && p.role === 'TEACHER')
        ? 'TEACHER'
        : account.role
      if (role !== account.role) {
        this.storageService.setAccount({ ...account, role })
      }
    }

    // E. Odevler, gonderiler ve rubrikler
    let rawCourseWork: any[] = []
    try {
      rawCourseWork = await this.authedPaginate<any>(
        t => pageUrl(`${API}/courses/${encodeURIComponent(courseId)}/courseWork`, t),
        p => p?.courseWork,
        token,
      )
    } catch (err) {
      this.reportSyncFailure('Odevler', err)
    }

    const works: CourseWork[] = []
    for (const w of rawCourseWork) {
      const work: CourseWork = {
        id: w.id,
        courseId,
        topicId: w.topicId,
        title: w.title ?? '',
        description: w.description || undefined,
        workType: w.workType ?? 'ASSIGNMENT',
        state: w.state ?? 'PUBLISHED',
        alternateLink: w.alternateLink,
        maxPoints: typeof w.maxPoints === 'number' ? w.maxPoints : undefined,
        dueDate: w.dueDate,
        dueTime: w.dueTime,
        creationTime: w.creationTime,
        updateTime: w.updateTime,
        submissionModificationMode: w.submissionModificationMode,
        creatorUserId: w.creatorUserId,
        materials: this.parseMaterials(w.materials, courseId, w.id),
      }

      try {
        await this.syncSubmissionsForWork(courseId, w.id, token, w)
      } catch (err) {
        this.reportSyncFailure('Gonderi detayi', err)
      }

      try {
        await this.syncRubricForWork(courseId, w.id, token)
      } catch (err) {
        this.reportSyncFailure('Rubrik detayi', err)
      }

      works.push(work)
    }

    this.storageService.saveCourseWork(courseId, works)

    // Sınıf arkadaşlarını yeni kaydedilen ödevlerin yorumlarından tekrar zenginleştir
    if (works.length > 0) {
      try {
        let addedNew = false
        for (const w of works.slice(0, 10)) {
          try {
            const cwCommentsRes = await this.authedGet<any>(
              `${API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(w.id)}/comments`,
              token,
            )
            const comments: any[] = cwCommentsRes?.comments || []
            for (const c of comments) {
              const profile = c.userProfile
              if (profile?.id && !participants.some(p => p.userId === profile.id)) {
                participants.push({
                  userId: profile.id,
                  courseId,
                  role: 'STUDENT',
                  fullName: profile.name?.fullName || profile.name?.givenName || 'Sınıf Arkadaşı',
                  email: profile.emailAddress,
                  photoUrl: profile.photoUrl,
                })
                addedNew = true
              }
            }
          } catch {
            /* yoksay */
          }
        }
        if (addedNew) {
          this.storageService.saveParticipants(courseId, participants)
        }
      } catch {
        /* yoksay */
      }
    }
  }

  /**
   * Gönderiler. Öğrenci izinleri (`classroom.student-submissions.me.readonly`)
   * kapsamında Google API `userId=me` parametresini zorunlu tutar.
   * `userId` olmadan sorgu yapıldığında Google 403 Forbidden döndürür.
   */
  private async syncSubmissionsForWork(
    courseId: string,
    workId: string,
    token: string,
    rawWork?: any,
  ): Promise<void> {
    const account = this.storageService.getAccount()
    let raw: any[] = []

    try {
      // Öncelikli olarak öğrencinin kendi gönderisini çekmek için userId=me kullanılır.
      raw = await this.authedPaginate<any>(
        t => pageUrl(`${API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(workId)}/studentSubmissions?userId=me`, t),
        p => p?.studentSubmissions,
        token,
      )
    } catch (err) {
      // Eğer kullanıcı öğretmen rolündeyse ve tüm sınıfı çekme yetkisine sahipse parametresiz dener:
      if (account?.role === 'TEACHER') {
        try {
          raw = await this.authedPaginate<any>(
            t => pageUrl(`${API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(workId)}/studentSubmissions`, t),
            p => p?.studentSubmissions,
            token,
          )
        } catch {
          /* yut */
        }
      }
    }

    const scoped = account
      ? raw.filter((s: any) => !s.userId || s.userId === account.googleSub)
      : raw

    for (const sub of scoped) {
      this.storageService.saveSubmission({
        id: sub.id,
        courseId,
        courseWorkId: workId,
        userId: sub.userId ?? account?.googleSub ?? '',
        state: sub.state ?? 'NEW',
        assignedGrade: typeof sub.assignedGrade === 'number' ? sub.assignedGrade : undefined,
        draftGrade: typeof sub.draftGrade === 'number' ? sub.draftGrade : undefined,
        late: !!sub.late,
        alternateLink: sub.alternateLink,
        assignmentSubmission: {
          attachments: this.parseMaterials(sub.assignmentSubmission?.attachments, courseId, `${workId}/${sub.id}`),
        },
        shortAnswerSubmission: sub.shortAnswerSubmission
          ? { answer: sub.shortAnswerSubmission.answers?.map((a: any) => a.text).join('\n') ?? '' }
          : undefined,
        multipleChoiceSubmission: this.parseMultipleChoice(sub, rawWork),
        submissionHistory: sub.submissionHistory,
        updateTime: sub.updateTime,
      })
    }
  }

  private parseMultipleChoice(
    sub: any,
    work: any,
  ): { answer: string } | undefined {
    const raw =
      sub.multipleChoiceSubmission ?? sub.multipleChoiceQuestionSubmission
    if (!raw) return undefined

    const answerIds: string[] = Array.isArray(raw.answers)
      ? raw.answers
          .map((a: any) => (typeof a === 'string' ? a : a?.choiceId))
          .filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
      : []

    if (answerIds.length === 0) {
      return { answer: '(seçim yapılmamış)' }
    }

    const choices: Array<{ choiceId?: string; title?: string }> = Array.isArray(
      work?.multipleChoiceQuestion?.choices,
    )
      ? work.multipleChoiceQuestion.choices
      : []

    const texts = answerIds.map(id => {
      const match = choices.find(c => c?.choiceId === id)
      const title = match?.title
      return title ? `${title} (${id})` : id
    })

    return { answer: texts.join('\n') }
  }

  private async syncRubricForWork(courseId: string, workId: string, token: string): Promise<void> {
    try {
      const data = await this.authedGet<any>(
        `${API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(workId)}/rubrics`,
        token,
      )
      if (!Array.isArray(data?.criteria)) return
      this.storageService.saveRubric({
        id: data.id ?? `rubric_${workId}`,
        courseId,
        courseWorkId: workId,
        updateTime: data.updateTime,
        criteria: data.criteria.map((c: any, i: number) => ({
          id: c.id ?? `criterion_${workId}_${i}`,
          title: c.title ?? '',
          description: c.description || undefined,
          weight: typeof c.weight === 'number' ? c.weight : undefined,
          levels: Array.isArray(c.levels)
            ? c.levels.map((l: any, j: number) => ({
                levelId: l.id ?? `level_${workId}_${i}_${j}`,
                title: l.title ?? '',
                description: l.description || undefined,
                points: typeof l.points === 'number' ? l.points : undefined,
              }))
            : [],
        })),
      })
    } catch (err) {
      // Rubrik yoksa ya da erisim yoksa bu bir hata degildir.
      if (err instanceof HttpError && (err.isPermissionError || err.isNotFound)) return
      throw err
    }
  }

  // =========================================================================
  // Yazma islemleri - yalnizca cevrimici ve acik kullanici onayiyla
  // =========================================================================
  private async writePost(url: string, action: string): Promise<void> {
    try {
      await this.withFreshToken(activeToken =>
        googleHttp.request(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json' },
          body: '{}',
        }),
      )
    } catch (err) {
      const detail = err instanceof HttpError ? err.bodySnippet : (err instanceof Error ? err.message : '')
      throw new Error(`${action} işlemi başarısız oldu. ${detail}`.trim())
    }
  }

  private async writePatch(url: string, action: string, payload: unknown): Promise<any> {
    try {
      return await this.withFreshToken(activeToken =>
        googleHttp.request<any>(url, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      )
    } catch (err) {
      const detail = err instanceof HttpError ? err.bodySnippet : (err instanceof Error ? err.message : '')
      throw new Error(`${action} işlemi başarısız oldu. ${detail}`.trim())
    }
  }

  /**
   * Öğrenci teslimine dosya ekler, sonra teslim eder.
   *
   * Dosya once Drive'a yuklenir (drive.file kapsami yalnizca uygulamanin
   * kendi dosyalarina erisim verir), ardindan Classroom API'sine
   * `driveFile` ek olarak baglanir. En sonda `:turnIn` cagrilir.
   *
   * Dosya eklenemezse HICBIR seyde teslim edilmez; boylece ogrenci
   * ogretmene bos bir teslim gondermez.
   */
  /**
   * Dosyayi ekler ve odevi teslim eder.
   *
   * DONUS DEGERI
   * ------------
   * `Promise<boolean>` idi ve UI cagrisini YOK SAYIYORDU. Metot aslinda
   * yalnizca `true` donuyor, her basarisizlikta HATA FIRLATIYORDU. Yani
   * imzadaki `boolean` sozlesmesi ile gercek davranis uyusmuyordu ve
   * `false` donen bir gelecekte kullaniciya "Teslim edildi" yazisi
   * gosterilirdi.
   *
   * Artik donus degeri yoktur: basariliysa bir sey donmez, basarisizsa
   * Turkce, ne yapilacagini anlatan bir hata firlatir. UI zaten
   * `try/catch` icinde oldugu icin davranis degismez, ama sozlesme
   * belirsizligi ortadan kalkar.
   */
  public async attachAndTurnIn(
    courseId: string,
    courseWorkId: string,
    submissionId: string,
    attachment: { driveFileId: string; title: string },
  ): Promise<void> {
    const url = `${API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}`

    // Classroom API'nin bekledigi YAPI bu degildir:
    //   YANLIS (onceki surum):  { attachments: [{ id, title, driveFileId }] }
    //   DOGRU:                  { driveFile: { id: "<driveFileId>" } }
    //
    // Classroom `CourseWork` ekleri GOOGLE DRIVE nesneleriyle temsil
    // eder ve `driveFile: { id }` bekler. Onceki govde schema dogrulanmadigi
    // icin her cagri HTTP 400 donuyordu; ogrencinin dosyasi hicbir zaman
    // teslim edilemiyordu.
    //
    // Ayrica `PATCH` tum ekleri DEGISTIRIR; sozluk uzerine yazmak yerine
    // `modifyAttachments` ile yalnizca yeni dosya EKLENIR. Aksi halde odevin
    // mevcut ekleri (orn. ogretmenin paylastigi sablon) sessizce silinirdi.
    const attachmentPayload = {
      driveFile: {
        id: attachment.driveFileId,
        title: attachment.title,
      },
    }

    const updated = await this.writePatch(url, 'Dosya ekleme', {
      modifyAttachments: {
        addAttachments: [attachmentPayload],
      },
    })

    const current = this.storageService.getSubmissions(courseId)[courseWorkId]
    if (current) {
      const driveFile: Attachment = {
        id: `drive:${attachment.driveFileId}`,
        title: attachment.title,
        driveFileId: attachment.driveFileId,
        isLocalAvailable: false,
        syncState: undefined,
      }
      this.storageService.saveSubmission({
        ...current,
        assignmentSubmission: {
          ...current.assignmentSubmission,
          attachments: [...(current.assignmentSubmission?.attachments ?? []), driveFile],
        },
        updateTime: new Date().toISOString(),
      })
    }

    await this.writePost(`${url}:turnIn`, 'Teslim')

    const refreshed = this.storageService.getSubmissions(courseId)[courseWorkId]
    if (refreshed) {
      this.storageService.saveSubmission({
        ...refreshed,
        state: 'TURNED_IN',
        updateTime: new Date().toISOString(),
      })
    } else if (updated) {
      this.storageService.saveSubmission({
        id: String(updated.id ?? submissionId),
        courseId,
        courseWorkId,
        userId: String(updated.userId ?? ''),
        state: 'TURNED_IN',
        updateTime: new Date().toISOString(),
      })
    }
  }

  public async turnInSubmission(courseId: string, courseWorkId: string, submissionId: string): Promise<boolean> {
    await this.writePost(
      `${API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:turnIn`,
      'Teslim',
    )
    const current = this.storageService.getSubmissions(courseId)[courseWorkId]
    if (current) {
      this.storageService.saveSubmission({
        ...current,
        state: 'TURNED_IN',
        updateTime: new Date().toISOString(),
      })
    }
    return true
  }

  public async reclaimSubmission(courseId: string, courseWorkId: string, submissionId: string): Promise<boolean> {
    await this.writePost(
      `${API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}:reclaim`,
      'Geri alma',
    )
    const current = this.storageService.getSubmissions(courseId)[courseWorkId]
    if (current) {
      this.storageService.saveSubmission({
        ...current,
        state: 'RECLAIMED_BY_STUDENT',
        updateTime: new Date().toISOString(),
      })
    }
    return true
  }
}