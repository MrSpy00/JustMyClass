/**
 * classroomWrites.test.ts
 * ---------------------------------------------------------------------------
 * Classroom'a YAZMA yollarinin gonderdigi govde bicimini dogrular.
 *
 * NEDEN AYRI BIR DOSYA
 * --------------------
 * `classroomService.test.ts` okuma/senkronizasyon dayanikliligini
 * olcer. Buradaki testler yazma yollarini kapsar: teslim (turnIn) ve
 * coktan secmeli ayristirma.
 *
 * ONCEKI SURUMDEKI GERCEK HATA
 * -----------------------------
 * `attachAndTurnIn` govdesi su bicimi gonderiyordu:
 *
 *   { assignmentSubmission: { attachments: [{ id, title, driveFileId }] } }
 *
 * Classroom API'si ise `{ modifyAttachments: { addAttachments: [{ driveFile: { id } }] } }`
 * bekler. Yanlis sema dogrulanmadigi icin HER Cagri HTTP 400 donuyordu ve
 * ogrencinin dosyasi hicbir zaman teslim edilemiyordu. Bu, uygulamanin
 * en gorunur kırık ozelligiydi ve test hic yoktu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

const USER_DATA = makeTempUserDataDir()

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

const { KeyringService } = await import('../electron/services/keyringService')
const { StorageService } = await import('../electron/services/storageService')
const { VaultService } = await import('../electron/services/vaultService')
const { AuthService } = await import('../electron/services/authService')
const { ClassroomService } = await import('../electron/services/classroomService')
const { googleHttp } = await import('../electron/services/httpClient')

describe('Classroom yazma işlemleri', () => {
  let keyring: InstanceType<typeof KeyringService>
  let storage: InstanceType<typeof StorageService>
  let vault: InstanceType<typeof VaultService>
  let auth: InstanceType<typeof AuthService>
  let classroom: InstanceType<typeof ClassroomService>

  beforeEach(() => {
    keyring = new KeyringService()
    storage = new StorageService(keyring)
    vault = new VaultService(keyring)
    auth = new AuthService(vault, storage)
    classroom = new ClassroomService(storage, vault, auth)

    vault.setKey('google_access_token', 'mock_token_123')
    storage.setAccount({
      id: 'acc1',
      googleSub: 'student_123',
      email: 'student@itu.edu.tr',
      displayName: 'Öğrenci',
      role: 'STUDENT',
      grantedScopes: AuthService.BASE_SCOPES,
      lastAuthAt: new Date().toISOString(),
    })
    vi.restoreAllMocks()
  })

  it('dosya ekleme govdesi Classroom API semasina uyar', async () => {
    const patches: Array<{ url: string; payload: any }> = []
    const posts: string[] = []

    vi.spyOn(googleHttp, 'request').mockImplementation(async (url: any, options: any) => {
      if (options?.method === 'PATCH') {
        patches.push({ url: String(url), payload: JSON.parse(options.body) })
        return { id: 'sub_1', state: 'CREATED' }
      }
      if (options?.method === 'POST') {
        posts.push(String(url))
        return { id: 'sub_1', state: 'TURNED_IN' }
      }
      return {}
    })

    const ok = await classroom.attachAndTurnIn('course_1', 'work_1', 'sub_1', {
      driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      title: 'cozum.pdf',
    })

    expect(ok).toBeUndefined()

    // PATCH govdesi API'nin bekledigi YAPI olmali.
    expect(patches).toHaveLength(1)
    const payload = patches[0].payload

    // ESKI (HATALI) BICIM: assignmentSubmission.attachments
    expect(payload.assignmentSubmission).toBeUndefined()
    expect(payload.modifyAttachments).toBeDefined()
    expect(Array.isArray(payload.modifyAttachments.addAttachments)).toBe(true)

    const added = payload.modifyAttachments.addAttachments[0]
    expect(added.driveFile).toBeDefined()
    // Drive kimligi `driveFile.id` altinda ve ham olmali; `drive:`
    // oneki veya ozel alanlar Classroom tarafindan reddedilir.
    expect(added.driveFile.id).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz')
    expect(added.driveFile.id).not.toContain('drive:')
    expect(added.driveFile.title).toBe('cozum.pdf')

    // Ekler, teslimden ONCE ayri bir cagri ile eklenmeli; ayni istekte
    // gonderilmesi Classroom tarafinda reddedilir.
    expect(patches[0].url).not.toContain(':turnIn')
    expect(posts).toHaveLength(1)
    expect(posts[0]).toContain(':turnIn')
  })

  it('dosya eklenemedigi durumda hicbir sey teslim edilmez ve neden bildirilir', async () => {
    const posts: string[] = []
    vi.spyOn(googleHttp, 'request').mockImplementation(async (_url: any, options: any) => {
      if (options?.method === 'PATCH') {
        // Dosya ekleme basarisiz.
        throw new Error('Dosya eklenemedi')
      }
      if (options?.method === 'POST') {
        posts.push(String(_url))
        return {}
      }
      return {}
    })

    // Metot `false` donmez, HATA FIRLATIR; boylece UI nedeni gosterebilir.
    await expect(
      classroom.attachAndTurnIn('course_1', 'work_1', 'sub_1', {
        driveFileId: 'file-1',
        title: 'a.pdf',
      }),
    ).rejects.toThrow(/Dosya ekleme/)

    // Ogrenci ogretmene BOS bir teslim gondermemeli.
    expect(posts).toHaveLength(0)
  })

  it('coktan secmeli gonderi secenek metinleriyle okunur bicime cevrilir', async () => {
    const submissions = [
      {
        id: 'sub_mc',
        userId: 'student_123',
        state: 'TURNED_IN',
        multipleChoiceSubmission: { answers: [{ choiceId: 'CHOICE_2' }] },
      },
    ]

    vi.spyOn(googleHttp, 'paginate').mockImplementation(async () => submissions as any)
    vi.spyOn(googleHttp, 'request').mockResolvedValue({} as any)

    // Odevin kendi secenek listesi cozumde kullanilir; API `answers`
    // alaninda yalnizca `CHOICE_2` kimligi gelir.
    const rawWork = {
      multipleChoiceQuestion: {
        choices: [
          { choiceId: 'CHOICE_1', title: 'Newton mekaniği' },
          { choiceId: 'CHOICE_2', title: 'Kuantum mekaniği' },
          { choiceId: 'CHOICE_3', title: 'Relativite' },
        ],
      },
    }

    await (classroom as any).syncSubmissionsForWork(
      'course_1',
      'work_1',
      'mock_token_123',
      rawWork,
    )

    const saved = storage.getSubmissions('course_1')['work_1']
    expect(saved).toBeDefined()
    expect(saved.multipleChoiceSubmission?.answer).toBe('Kuantum mekaniği (CHOICE_2)')
  })

  it('multipleChoiceQuestionSubmission alan adi de desteklenir', async () => {
    // Classroom API bu iki alan adini farkli sureclerde donduruyor;
    // hangisi gelirse gelsin ayristirilmalidir.
    vi.spyOn(googleHttp, 'paginate').mockImplementation(async () =>
      [
        {
          id: 'sub_mc2',
          userId: 'student_123',
          state: 'TURNED_IN',
          multipleChoiceQuestionSubmission: { answers: [{ choiceId: 'CHOICE_3' }] },
        },
      ] as any,
    )
    vi.spyOn(googleHttp, 'request').mockResolvedValue({} as any)

    await (classroom as any).syncSubmissionsForWork(
      'course_1',
      'work_2',
      'mock_token_123',
      { multipleChoiceQuestion: { choices: [{ choiceId: 'CHOICE_3', title: 'Termodinamik' }] } },
    )

    const saved = storage.getSubmissions('course_1')['work_2']
    expect(saved.multipleChoiceSubmission?.answer).toBe('Termodinamik (CHOICE_3)')
  })

  it('secim yapilmamis coktan secmeli gonderi acikca belirtilir', async () => {
    vi.spyOn(googleHttp, 'paginate').mockImplementation(async () =>
      [
        {
          id: 'sub_mc3',
          userId: 'student_123',
          state: 'CREATED',
          multipleChoiceSubmission: { answers: [] },
        },
      ] as any,
    )
    vi.spyOn(googleHttp, 'request').mockResolvedValue({} as any)

    await (classroom as any).syncSubmissionsForWork('course_1', 'work_3', 'mock_token_123', {})

    const saved = storage.getSubmissions('course_1')['work_3']
    // Bos string yerine anlasilir bir metin: kullanici "bos mu, yoksa
    // secim yapmamis mi?" ayirt edebilir.
    expect(saved.multipleChoiceSubmission?.answer).toMatch(/seçim/i)
  })

  it('kimlik eslesmezse ham kimlik gosterilir, sahte metin uretilmez', async () => {
    vi.spyOn(googleHttp, 'paginate').mockImplementation(async () =>
      [
        {
          id: 'sub_mc4',
          userId: 'student_123',
          state: 'TURNED_IN',
          multipleChoiceSubmission: { answers: [{ choiceId: 'CHOICE_YOK' }] },
        },
      ] as any,
    )
    vi.spyOn(googleHttp, 'request').mockResolvedValue({} as any)

    await (classroom as any).syncSubmissionsForWork('course_1', 'work_4', 'mock_token_123', {
      multipleChoiceQuestion: { choices: [{ choiceId: 'CHOICE_1', title: 'Birinci' }] },
    })

    const saved = storage.getSubmissions('course_1')['work_4']
    // Odev listesi eksik olabilir; kimlik gosterilir, METIN UYDURULMAZ.
    expect(saved.multipleChoiceSubmission?.answer).toBe('CHOICE_YOK')
  })
})