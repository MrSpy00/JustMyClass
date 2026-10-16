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
const { googleHttp, HttpError } = await import('../electron/services/httpClient')

describe('ClassroomService Sync Resilience', () => {
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
      displayName: 'İTÜ Öğrenci',
      role: 'STUDENT',
      grantedScopes: AuthService.BASE_SCOPES,
      lastAuthAt: new Date().toISOString(),
    })
  })

  it('öğrenci rolünde studentSubmissions isteğine userId=me eklenir', async () => {
    const urlsCalled: string[] = []
    vi.spyOn(googleHttp, 'paginate').mockImplementation(async (makeUrl: any) => {
      const url = makeUrl(undefined)
      urlsCalled.push(url)
      if (url.includes('/studentSubmissions')) {
        return [
          {
            id: 'sub_1',
            userId: 'student_123',
            state: 'TURNED_IN',
          },
        ]
      }
      return []
    })

    // Private metodu çağır
    await (classroom as any).syncSubmissionsForWork('course_1', 'work_1', 'mock_token_123')

    const submissionCall = urlsCalled.find(u => u.includes('/studentSubmissions'))
    expect(submissionCall).toBeDefined()
    expect(submissionCall).toContain('userId=me')
  })

  it('öğrenci listesi 403 Forbidden dönse dahi senkronizasyon çökmez ve ödevleri kaydeder', async () => {
    vi.spyOn(googleHttp, 'paginate').mockImplementation(async (makeUrl: any) => {
      const url = makeUrl(undefined)
      if (url.includes('/topics')) {
        return [{ topicId: 'top1', name: 'Giriş' }]
      }
      if (url.includes('/announcements')) {
        return [{ id: 'ann1', text: 'Ders duyurusu' }]
      }
      if (url.includes('/courseWorkMaterials')) {
        return [{ id: 'mat1', title: 'Hafta 1 Notları' }]
      }
      if (url.includes('/teachers')) {
        return [{ userId: 'teacher1', profile: { name: { fullName: 'Prof. Dr. Öğretmen' } } }]
      }
      if (url.includes('/students')) {
        // Üniversite alan adı ilkesi gereği 403 Forbidden atılır
        throw new HttpError(403, 'Forbidden: The caller does not have permission', 'http://classroom/students')
      }
      if (url.includes('/courseWork')) {
        return [
          {
            id: 'cw_assignment1',
            title: 'Nesne Tabanlı Ödev 1',
            workType: 'ASSIGNMENT',
            maxPoints: 100,
          },
        ]
      }
      if (url.includes('/studentSubmissions')) {
        return [
          {
            id: 'sub_assignment1',
            userId: 'student_123',
            state: 'NEW',
          },
        ]
      }
      return []
    })

    // syncCourseDetails çağrısının hata fırlatmadan tamamlanması gerekir
    await expect(
      (classroom as any).syncCourseDetails('course_1', 'mock_token_123'),
    ).resolves.not.toThrow()

    // Verilerin başarıyla storage'a kaydedildiğini doğrula
    const topics = storage.getTopics('course_1')
    expect(topics).toHaveLength(1)
    expect(topics[0].name).toBe('Giriş')

    const announcements = storage.getAnnouncements('course_1')
    expect(announcements).toHaveLength(1)
    expect(announcements[0].text).toBe('Ders duyurusu')

    const materials = storage.getMaterials('course_1')
    expect(materials).toHaveLength(1)
    expect(materials[0].title).toBe('Hafta 1 Notları')

    const works = storage.getCourseWork('course_1')
    expect(works).toHaveLength(1)
    expect(works[0].title).toBe('Nesne Tabanlı Ödev 1')

    const participants = storage.getParticipants('course_1')
    // Öğretmen ve oturum açmış öğrenci bulunmalı
    expect(participants.some(p => p.role === 'TEACHER')).toBe(true)
    expect(participants.some(p => p.userId === 'student_123')).toBe(true)
  })
})
