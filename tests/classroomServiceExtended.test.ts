import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

/**
 * ClassroomService kapsam genisletmesi.
 *
 * Mevcut `classroomService.test.ts` yalnizca iki senkronizasyon dayanikligi
 * senaryosunu olcuyor. Burada sunucudan DOGRULANAMAYAN davranislar
 * kilitlenir:
 *
 *  - `parseMaterials`: materyal turunun (Drive / YouTube / link / form)
 *    dogru eslesmesi, kararli kimlikler, onbellek durumu.
 *  - `parseMultipleChoice`: secenek metinlerinin cozumlenmesi.
 *  - `explainApiError`: kullaniciya gosterilen hata metinleri.
 *  - Yazma yollari: token yokken HATA firlatmali (sessizce gecmemeli).
 *  - `reclaimSubmission`: geri alma durum gecisleri.
 */

const USER_DATA = makeTempUserDataDir()

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA, isPackaged: false },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

const { KeyringService } = await import('../electron/services/keyringService')
const { StorageService } = await import('../electron/services/storageService')
const { VaultService } = await import('../electron/services/vaultService')
const { AuthService } = await import('../electron/services/authService')
const { ClassroomService } = await import('../electron/services/classroomService')
const { googleHttp, HttpError } = await import('../electron/services/httpClient')

/** Testlerde kullanilan kolaylik erisimleri. */
type Classroom = InstanceType<typeof ClassroomService>
type Storage = InstanceType<typeof StorageService>
type Vault = InstanceType<typeof VaultService>

describe('ClassroomService ayrintili davranis', () => {
  let keyring: InstanceType<typeof KeyringService>
  let storage: Storage
  let vault: Vault
  let auth: InstanceType<typeof AuthService>
  let classroom: Classroom

  beforeEach(() => {
    keyring = new KeyringService()
    storage = new StorageService(keyring)
    vault = new VaultService(keyring)
    auth = new AuthService(vault, storage)
    classroom = new ClassroomService(storage, vault, auth)
  })

  afterEach(() => {
    storage.wipeLocalCache()
    vi.restoreAllMocks()
  })

  function signIn(role: 'STUDENT' | 'TEACHER' = 'STUDENT'): void {
    vault.setKey('google_access_token', 'mock_token_123')
    storage.setAccount({
      id: 'acc1',
      googleSub: 'student_123',
      email: 'ogrenci@itu.edu.tr',
      displayName: 'ITU Ogrenci',
      role,
      grantedScopes: AuthService.BASE_SCOPES,
      lastAuthAt: new Date().toISOString(),
    })
  }

  describe('parseMaterials', () => {
    it('driveFile materyalini tanir ve kararli kimlik verir', () => {
      const raw = [
        { driveFile: { id: 'file_1', title: 'Hafta 1.pdf', mimeType: 'application/pdf', sizeBytes: '2048' } },
      ]
      const a = (classroom as any).parseMaterials(raw, 'c1', 'w1') as any[]
      expect(a).toHaveLength(1)
      expect(a[0].title).toBe('Hafta 1.pdf')
      expect(a[0].driveFileId).toBe('file_1')
      expect(a[0].mimeType).toBe('application/pdf')
      expect(a[0].sizeBytes).toBe(2048)
      expect(a[0].id).toMatch(/^att_/)
    })

    it('AYNI materyal icin kimlik her senkronizasyonda DEGISMEZ', () => {
      const raw = [{ driveFile: { id: 'file_1', title: 'A.pdf' } }]
      const first = (classroom as any).parseMaterials(raw, 'c1', 'w1') as any[]
      const second = (classroom as any).parseMaterials(raw, 'c1', 'w1') as any[]
      expect(first[0].id).toBe(second[0].id)
    })

    it('farkli ders/odev icin kimlik FARKLIDIR', () => {
      const raw = [{ driveFile: { id: 'file_1', title: 'A.pdf' } }]
      const a = (classroom as any).parseMaterials(raw, 'c1', 'w1') as any[]
      const b = (classroom as any).parseMaterials(raw, 'c1', 'w2') as any[]
      const c = (classroom as any).parseMaterials(raw, 'c2', 'w1') as any[]
      expect(a[0].id).not.toBe(b[0].id)
      expect(a[0].id).not.toBe(c[0].id)
    })

    it('ic ice driveFile yapisini da cozer', () => {
      const raw = [{ driveFile: { driveFile: { id: 'file_2', title: 'Ic Ice.pdf' } } }]
      const out = (classroom as any).parseMaterials(raw, 'c1', '') as any[]
      expect(out).toHaveLength(1)
      expect(out[0].driveFileId).toBe('file_2')
    })

    it('idsi olmayan driveFile ATLANIR (yari nesne uretmez)', () => {
      const raw = [{ driveFile: { title: 'Kimliksiz.pdf' } }, { driveFile: null }, null, undefined]
      const out = (classroom as any).parseMaterials(raw, 'c1', '') as any[]
      expect(out).toHaveLength(0)
    })

    it('youtube materyalini tanir', () => {
      const raw = [
        { youtubeVideo: { id: 'yt_1', title: 'Ders Videosu', youtubeVideoId: 'abc', alternateLink: 'https://y' } },
      ]
      const out = (classroom as any).parseMaterials(raw, 'c1', '') as any[]
      expect(out[0].mimeType).toBe('video/youtube')
      expect(out[0].youTubeVideoId).toBe('abc')
      expect(out[0].isLocalAvailable).toBe(false)
    })

    it('baglanti materyalini tanir ve linkUrl doldurur', () => {
      const raw = [{ link: { url: 'https://example.com', title: 'Kaynak' } }]
      const out = (classroom as any).parseMaterials(raw, 'c1', '') as any[]
      expect(out[0].linkUrl).toBe('https://example.com')
      expect(out[0].mimeType).toBe('text/html')
      expect(out[0].alternateLink).toBe('https://example.com')
    })

    it('form materyalini tanir', () => {
      const raw = [{ form: { formUrl: 'https://forms/x', title: 'Anket' } }]
      const out = (classroom as any).parseMaterials(raw, 'c1', '') as any[]
      expect(out[0].formUrl).toBe('https://forms/x')
      expect(out[0].mimeType).toBe('application/vnd.google-apps.form')
    })

    it('bilinmeyen materyal turunu ATLAR', () => {
      const raw = [{ bilinmeyen: true }, { text: 'sadece metin' }]
      const out = (classroom as any).parseMaterials(raw, 'c1', '') as any[]
      expect(out).toHaveLength(0)
    })

    it('dizi olmayan girdide boş liste doner', () => {
      expect((classroom as any).parseMaterials(undefined)).toEqual([])
      expect((classroom as any).parseMaterials(null)).toEqual([])
      expect((classroom as any).parseMaterials('metin')).toEqual([])
    })

    it('onbellekteki dosyayi yerel olarak isaretler', () => {
      storage.saveFileToCas('file_local', 'c1', 'yerel.pdf', 'application/pdf', Buffer.from('icerik'))
      const raw = [{ driveFile: { id: 'file_local', title: 'yerel.pdf' } }]
      const out = (classroom as any).parseMaterials(raw, 'c1', '') as any[]
      expect(out[0].isLocalAvailable).toBe(true)
      expect(out[0].localPath).toBeTruthy()
      expect(out[0].sha256).toHaveLength(64)
    })

    it('onbellekte olmayan dosya yerel DEGIL olarak isaretlenir', () => {
      const raw = [{ driveFile: { id: 'dosya_yok', title: 'uzak.pdf' } }]
      const out = (classroom as any).parseMaterials(raw, 'c1', '') as any[]
      expect(out[0].isLocalAvailable).toBe(false)
      expect(out[0].localPath).toBeUndefined()
    })

    it('ACCESS_DENIED onbellek dosyasi yerel sayilmaz', () => {
      const saved = storage.saveFileToCas('file_denied', 'c1', 'k.pdf', 'application/pdf', Buffer.from('x'))
      const cached = storage.getCachedFile('file_denied')!
      cached.entry.syncState = 'ACCESS_DENIED'
      storage.persist()
      const raw = [{ driveFile: { id: 'file_denied', title: 'k.pdf' } }]
      const out = (classroom as any).parseMaterials(raw, 'c1', '') as any[]
      expect(out[0].isLocalAvailable).toBe(false)
      expect(saved.absolutePath).toBeTruthy()
    })
  })

  describe('parseMultipleChoice', () => {
    const work = {
      multipleChoiceQuestion: {
        choices: [
          { choiceId: 'c1', title: 'Dogru' },
          { choiceId: 'c2', title: 'Yanlis' },
        ],
      },
    }

    it('secim metinlerini cozer', () => {
      const out = (classroom as any).parseMultipleChoice(
        { multipleChoiceSubmission: { answers: [{ choiceId: 'c1' }] } },
        work,
      )
      expect(out.answer).toBe('Dogru (c1)')
    })

    it('coklu secimi alt satirlarla birlestirir', () => {
      const out = (classroom as any).parseMultipleChoice(
        { multipleChoiceSubmission: { answers: [{ choiceId: 'c1' }, { choiceId: 'c2' }] } },
        work,
      )
      expect(out.answer).toContain('Dogru (c1)')
      expect(out.answer).toContain('Yanlis (c2)')
      expect(out.answer).toContain('\n')
    })

    it('eslesmeyen secimi kimligiyle dondurur (veri kaybi yok)', () => {
      const out = (classroom as any).parseMultipleChoice(
        { multipleChoiceSubmission: { answers: [{ choiceId: 'yok' }] } },
        work,
      )
      expect(out.answer).toBe('yok')
    })

    it('bos secim acik bir metin doner', () => {
      const out = (classroom as any).parseMultipleChoice(
        { multipleChoiceSubmission: { answers: [] } },
        work,
      )
      expect(out.answer).toBe('(seçim yapılmamış)')
    })

    it('secim verisi yoksa undefined doner', () => {
      expect((classroom as any).parseMultipleChoice({}, work)).toBeUndefined()
      expect((classroom as any).parseMultipleChoice({ multipleChoiceSubmission: null }, work)).toBeUndefined()
    })

    it('eski alan adini (multipleChoiceQuestionSubmission) da kabul eder', () => {
      const out = (classroom as any).parseMultipleChoice(
        { multipleChoiceQuestionSubmission: { answers: ['c2'] } },
        work,
      )
      expect(out.answer).toBe('Yanlis (c2)')
    })

    it('soru secenekleri yoksa kimlikleri dondurur', () => {
      const out = (classroom as any).parseMultipleChoice(
        { multipleChoiceSubmission: { answers: ['c1'] } },
        {},
      )
      expect(out.answer).toBe('c1')
    })

    it('gecersiz yanit girdilerini ATLAR (bos string uretmez)', () => {
      const out = (classroom as any).parseMultipleChoice(
        { multipleChoiceSubmission: { answers: [null, {}, { choiceId: '' }, { choiceId: 'c1' }] } },
        work,
      )
      expect(out.answer).toBe('Dogru (c1)')
    })
  })

  describe('explainApiError', () => {
    const explain = (raw: string): string => (classroom as any).explainApiError(raw)

    it('403 icin alan adi ipucu verir', () => {
      expect(explain('403 Forbidden')).toContain('403')
    })

    it('401 icin yeniden giris yonlendirmesi verir', () => {
      const out = explain('401 Unauthorized')
      expect(out.toLowerCase()).toMatch(/giris|oturum|token/)
    })

    it('429 icin kota uyarisi verir', () => {
      expect(explain('429 rateLimitExceeded')).toMatch(/kota|limit/i)
    })

    it('5xx icin gecici sunucu hatasi verir', () => {
      expect(explain('503 backendError')).toMatch(/gecici|sonra|tekrar/i)
    })

    it('ag hatasini tanir', () => {
      expect(explain('failed to fetch')).toMatch(/internet|baglanti|ağ|ağ/i)
    })

    it('bilinmeyen hatada mesaji degistirmeden gecer', () => {
      const raw = 'tamamen bilinmeyen bir sey'
      expect(explain(raw)).toBeTruthy()
    })
  })

  describe('yazma islemleri yetki kontrolu', () => {
    // Not: hata metinleri Turkce `ı`/`ğ` icerir; eslesme bu yuzden
    // duz ASCII harflerle degil, kararli bir parcayla kurulur.
    const NO_TOKEN = /Google Classroom/

    it('token yokken writePost HATA firlatir (sessizce gecmez)', async () => {
      vault.setKey('google_access_token', '')
      await expect(
        (classroom as any).writePost('https://classroom/x:turnIn', 'Teslim'),
      ).rejects.toThrow(NO_TOKEN)
    })

    it('token yokken writePatch HATA firlatir', async () => {
      vault.setKey('google_access_token', '')
      await expect(
        (classroom as any).writePatch('https://classroom/x', 'Guncelle', {}),
      ).rejects.toThrow(NO_TOKEN)
    })

    it('writePost HTTP hatasinda sunucu govdesini hataya katar', async () => {
      signIn()
      vi.spyOn(googleHttp, 'request').mockRejectedValue(
        new HttpError(403, 'Forbidden', 'The caller does not have permission'),
      )
      await expect(
        (classroom as any).writePost('https://classroom/x:turnIn', 'Teslim'),
      ).rejects.toThrow(/does not have permission/)
    })

    it('writePatch basarili yaniti dondurur', async () => {
      signIn()
      vi.spyOn(googleHttp, 'request').mockResolvedValue({ ok: true })
      await expect(
        (classroom as any).writePatch('https://classroom/x', 'Guncelle', { a: 1 }),
      ).resolves.toEqual({ ok: true })
    })

    it('writePatch govdeyi JSON olarak gonderir ve yetki basligi ekler', async () => {
      signIn()
      const spy = vi.spyOn(googleHttp, 'request').mockResolvedValue({})
      await (classroom as any).writePatch('https://classroom/x', 'Guncelle', { a: 1 })
      const init = spy.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }
      expect(init.method).toBe('PATCH')
      expect(init.body).toBe('{"a":1}')
      expect(init.headers.Authorization).toBe('Bearer mock_token_123')
    })
  })

  describe('reclaimSubmission', () => {
    // reclaimSubmission sunucuya HER ZAMAN istek atar; sunucu gecersiz kimligi
    // reddeder. "Olmayan teslim" icin sessizce `false` donmez, cunku yerel
    // kayitla sunucudaki durum ayni olmak zorunda degildir.
    it('token yokken ağa cikmadan hata firlatir', async () => {
      vault.setKey('google_access_token', '')
      await expect(classroom.reclaimSubmission('c1', 'w1', 's1')).rejects.toThrow(/Google Classroom/)
    })

    it('basarili geri almada durumu yereldegunceller', async () => {
      signIn()
      vi.spyOn(googleHttp, 'request').mockResolvedValue({})
      storage.saveSubmission({
        courseId: 'c1',
        courseWorkId: 'w1',
        submission: {
          id: 's1',
          userId: 'student_123',
          state: 'TURNED_IN',
        } as any,
      })

      const out = await classroom.reclaimSubmission('c1', 'w1', 's1')
      expect(out).toBe(true)
      expect(storage.getSubmissions('c1')['w1'].state).toBe('RECLAIMED_BY_STUDENT')
    })

    it('dogru uc noktaya istek atar', async () => {
      signIn()
      const spy = vi.spyOn(googleHttp, 'request').mockResolvedValue({})
      await classroom.reclaimSubmission('c1', 'w1', 's1')
      expect(String(spy.mock.calls[0][0])).toContain(':reclaim')
      expect((spy.mock.calls[0][1] as RequestInit).method).toBe('POST')
    })

    it('sunucu hatasini Turkce ve govde detayli firlatir', async () => {
      signIn()
      vi.spyOn(googleHttp, 'request').mockRejectedValue(
        new HttpError(404, 'Not Found', 'Submission not found'),
      )
      await expect(classroom.reclaimSubmission('c1', 'w1', 's1')).rejects.toThrow(/Submission not found/)
    })

    it('yerel kayit yoksa da sunucu cagrisi yapilir ve true doner', async () => {
      signIn()
      const spy = vi.spyOn(googleHttp, 'request').mockResolvedValue({})
      const out = await classroom.reclaimSubmission('c1', 'w1', 'yok')
      expect(out).toBe(true)
      expect(spy).toHaveBeenCalled()
    })
  })

  describe('turnInSubmission', () => {
    it('basarili teslimde durumu TURNED_IN yapar', async () => {
      signIn()
      vi.spyOn(googleHttp, 'request').mockResolvedValue({})
      storage.saveSubmission({
        courseId: 'c1',
        courseWorkId: 'w1',
        submission: { id: 's1', userId: 'student_123', state: 'NEW' } as any,
      })
      const out = await classroom.turnInSubmission('c1', 'w1', 's1')
      expect(out).toBe(true)
      expect(storage.getSubmissions('c1')['w1'].state).toBe('TURNED_IN')
    })

    it('dogru uc noktaya istek atar', async () => {
      signIn()
      const spy = vi.spyOn(googleHttp, 'request').mockResolvedValue({})
      await classroom.turnInSubmission('c1', 'w1', 's1')
      expect(String(spy.mock.calls[0][0])).toContain(':turnIn')
    })
  })

  describe('syncAll dayanikligi', () => {
    it('token yoksa sessizce cikar ve istem atmaz', async () => {
      vault.setKey('google_access_token', '')
      const spy = vi.spyOn(googleHttp, 'paginate')
      await expect(classroom.syncAll()).resolves.not.toThrow()
      expect(spy).not.toHaveBeenCalled()
    })

    it('bir dersin detay hatasi tum senkronizasyonu BOZMAZ', async () => {
      signIn()
      vi.spyOn(googleHttp, 'paginate').mockImplementation(async (makeUrl: any) => {
        const url = makeUrl(undefined)
        if (url.includes('/courses')) {
          return [{ id: 'c1', name: 'Ders 1', courseState: 'ACTIVE' }]
        }
        if (url.includes('/courseWork/c1/')) {
          throw new HttpError(500, 'Server Error', 'ic hata')
        }
        return []
      })
      await expect(classroom.syncAll()).resolves.not.toThrow()
    })
  })
})