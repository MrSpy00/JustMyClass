import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

const USER_DATA = makeTempUserDataDir()

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

const { KeyringService } = await import('../electron/services/keyringService')
const { StorageService } = await import('../electron/services/storageService')
const { aesDecrypt } = await import('../electron/services/keyringService')

type KeyringType = InstanceType<typeof KeyringService>
type StorageType = InstanceType<typeof StorageService>

describe('StorageService', () => {
  let keyring: KeyringType
  let storage: StorageType

  beforeEach(() => {
    keyring = new KeyringService()
    storage = new StorageService(keyring)
  })

  afterEach(() => {
    storage.wipeLocalCache()
  })

  it('dersleri kaydeder ve alfabetik sira ile geri doner', () => {
    storage.saveCourses([
      {
        id: 'c2',
        name: 'Siber Guvenlik',
        courseState: 'ACTIVE',
        ownerId: 'u1',
        updateTime: '',
      },
      {
        id: 'c1',
        name: 'Bilgisayarli Yapay Zeka',
        courseState: 'ACTIVE',
        ownerId: 'u1',
        updateTime: '',
      },
    ])
    const found = storage.getCourses()
    expect(found).toHaveLength(2)
    expect(found[0].name).toBe('Bilgisayarli Yapay Zeka')
  })

  it('odevleri ve duyurulari saklar', () => {
    storage.saveCourseWork('c1', [
      {
        id: 'w1',
        courseId: 'c1',
        title: 'Grafig algoritmalari',
        description: 'En kisa yol algoritmasini yaziniz.',
        state: 'PUBLISHED',
        workType: 'ASSIGNMENT',
        materials: [],
        creationTime: '',
        updateTime: '',
      },
    ])
    storage.saveAnnouncements('c1', [
      {
        id: 'a1',
        courseId: 'c1',
        text: 'Proje teslim tarihi pazartesi.',
        materials: [],
        state: 'PUBLISHED',
        creationTime: '',
        updateTime: '',
      },
    ])
    expect(storage.getCourseWork('c1')).toHaveLength(1)
    expect(storage.getAnnouncements('c1')).toHaveLength(1)
  })

  it('CAS dosyasini SHA-256 ozetiyle saklar ve yerel degisikligi isaretler', () => {
    const fileId = 'file-1'
    const content = Buffer.from('print("merhaba")', 'utf8')
    const saved = storage.saveFileToCas(fileId, 'c1', 'merhaba.py', 'text/x-python', content)

    expect(saved.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.existsSync(saved.absolutePath)).toBe(true)

    const cached = storage.getCachedFile(fileId)
    expect(cached?.entry.syncState).toBe('DOWNLOADED')
    expect(storage.readCasFile(cached!.absolutePath).toString('utf8')).toBe('print("merhaba")')

    const updated = storage.updateLocalFileContent(fileId, 'print("guncellendi")')
    expect(updated.newHash).not.toBe(saved.sha256)
    expect(storage.getCachedFile(fileId)?.entry.syncState).toBe('LOCAL_MODIFIED')
  })

  it('arama ders, odev ve duyurulari kapsar', () => {
    storage.saveCourses([
      {
        id: 'c1',
        name: 'Makine Ogrenmesi',
        courseState: 'ACTIVE',
        ownerId: 'u1',
        updateTime: '',
      },
    ])
    storage.saveCourseWork('c1', [
      {
        id: 'w1',
        courseId: 'c1',
        title: 'Dogrusal Regresyon Odevi',
        description: 'Gradient descent uygulayiniz.',
        state: 'PUBLISHED',
        workType: 'ASSIGNMENT',
        materials: [],
        creationTime: '',
        updateTime: '',
      },
    ])

    expect(storage.search('Makine')[0]?.type).toBe('course')
    expect(storage.search('Gradient descent')[0]?.type).toBe('coursework')
  })

  it('ayarlar sifreli dosyada saklanir ve varsayilana duser', () => {
    expect(storage.getSetting('autoSyncMinutes', 5)).toBe(5)
    storage.setSetting('autoSyncMinutes', 30)
    expect(storage.getSetting('autoSyncMinutes', 5)).toBe(30)

    const reopened = new StorageService(keyring)
    expect(reopened.getSetting('autoSyncMinutes', 5)).toBe(30)
  })

  it('calisma taslaklari odev kimligiyle saklanir', () => {
    storage.saveDraft({ courseId: 'c1', courseWorkId: 'w1', fileName: 'cozum.md', content: '# Cozum' })
    const draft = storage.getDraft('c1', 'w1')
    expect(draft?.content).toBe('# Cozum')
    storage.deleteDraft('c1', 'w1')
    expect(storage.getDraft('c1', 'w1')).toBeNull()
  })

  it('depo dosyasi diskte duz metin JSON degil, AES-256-GCM ciphertexttir', () => {
    storage.saveCourses([
      {
        id: 'c-secret',
        name: 'Kriptoloji',
        courseState: 'ACTIVE',
        ownerId: 'u1',
        updateTime: '',
      },
    ])

    const dbPath = path.join(USER_DATA, 'classroom.store.v2')
    expect(fs.existsSync(dbPath)).toBe(true)

    const raw = fs.readFileSync(dbPath)
    expect(() => JSON.parse(raw.toString('utf8'))).toThrow()
    expect(raw.toString('utf8')).not.toContain('Kriptoloji')

    // Anahtar ile gercekten cozulebilir.
    const plain = aesDecrypt(keyring.getMasterKey(), raw).toString('utf8')
    expect(JSON.parse(plain).courses['c-secret'].name).toBe('Kriptoloji')
  })

  it('yeniden acilan depo ayni veriyi geri yukler', () => {
    storage.saveCourses([
      {
        id: 'c1',
        name: 'Siber Guvenlik',
        courseState: 'ACTIVE',
        ownerId: 'u1',
        updateTime: '',
      },
    ])
    const reopened = new StorageService(keyring)
    expect(reopened.getCourses()[0].name).toBe('Siber Guvenlik')
  })

  it('guvenlik durumu gercek anahtar kasasindan uretilir', () => {
    const info = storage.getStorageSecurityInfo()
    expect(info.algorithm).toBe('AES-256-GCM')
    expect(info.isEncrypted).toBe(true)
    expect(info.backend).toBe('dpapi')
    expect(info.hardwareProtected).toBe(true)
    expect(info.degraded).toBe(false)
  })

  it('isInsideCas yol gezinme denemelerini reddeder', () => {
    expect(storage.isInsideCas(path.join(USER_DATA, 'cas', 'a.txt'))).toBeTruthy()
    expect(storage.isInsideCas(path.join(USER_DATA, '..', '..', 'gizli.txt'))).toBeFalsy()
    expect(storage.isInsideCas('C:\\Windows\\System32\\config\\SAM')).toBeFalsy()
  })

  it('senkronizasyon durumu gercek ilerlemeyi yansitir', () => {
    expect(storage.getSyncStatus().isSyncing).toBe(false)
    storage.beginSync('Dersler')
    storage.setSyncProgress(1, 3)
    const during = storage.getSyncStatus()
    expect(during.isSyncing).toBe(true)
    expect(during.progress).toEqual({ label: 'Dersler', done: 1, total: 3 })

    storage.recordSyncError('bir ders alinamadi')
    storage.endSync()
    const after = storage.getSyncStatus()
    expect(after.isSyncing).toBe(false)
    expect(after.activeErrors).toContain('bir ders alinamadi')
  })

  it('wipeLocalCache ayarlari da temizler ve CAS icerigini atar', () => {
    storage.saveCourses([
      {
        id: 'c1',
        name: 'Silinecek',
        courseState: 'ACTIVE',
        ownerId: 'u1',
        updateTime: '',
      },
    ])
    const saved = storage.saveFileToCas('f1', 'c1', 'a.txt', 'text/plain', Buffer.from('x'))
    storage.setSetting('autoSyncMinutes', 30)

    storage.wipeLocalCache()

    expect(storage.getCourses()).toHaveLength(0)
    expect(storage.getSetting('autoSyncMinutes', 0)).toBe(5)
    expect(storage.getCachedFile('f1')).toBeNull()
    // Onbellek dizini yeniden kullanilabilir olmak icin bos olarak yaratilir,
    // ancak onceki sifreli dosyalar silinmis olmalidir.
    expect(fs.readdirSync(path.join(USER_DATA, 'cas'))).toHaveLength(0)
    expect(fs.existsSync(saved.absolutePath)).toBe(false)
  })

  it('bozuk veya cozulemeyen depo dosyasi karsisinda cokmez ve kendini onarir', () => {
    const dbFile = path.join(USER_DATA, 'classroom.store.v2')
    fs.writeFileSync(dbFile, Buffer.from('bu-gecersiz-ve-bozuk-bir-veri-blokudur-aes-gcm-cozemez'))

    const freshStorage = new StorageService(keyring)
    expect(() => freshStorage.getCourses()).not.toThrow()
    expect(freshStorage.getCourses()).toEqual([])

    // Bozuk dosya .corrupted olarak yedeklenmiş olmalıdır
    const files = fs.readdirSync(USER_DATA)
    const corruptedBackup = files.find(f => f.startsWith('classroom.store.v2.corrupted'))
    expect(corruptedBackup).toBeDefined()
  })
})