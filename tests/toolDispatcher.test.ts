import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'
// Ag katmanini sahtele. Bu, servisler import edilmeden ONCE yuklenmelidir;
// `vi.mock` kaldirilabilir (hoist) oldugu icin dosya import sirasi onemlidir.
import { requestSpy } from './helpers/fakeWeb'

const USER_DATA = makeTempUserDataDir()

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

const { KeyringService } = await import('../electron/services/keyringService')
const { StorageService } = await import('../electron/services/storageService')
const { VaultService } = await import('../electron/services/vaultService')
const { ToolDispatcher, DEFAULT_TOOL_PERMISSIONS, extractTextFromPdf, extractTextFromDocx } = await import(
  '../electron/services/toolDispatcher'
)

type KeyringType = InstanceType<typeof KeyringService>
type StorageType = InstanceType<typeof StorageService>
type VaultType = InstanceType<typeof VaultService>
type DispatcherType = InstanceType<typeof ToolDispatcher>

describe('ToolDispatcher', () => {
  let keyring: KeyringType
  let storage: StorageType
  let vault: VaultType
  let dispatcher: DispatcherType

  beforeEach(() => {
    keyring = new KeyringService()
    storage = new StorageService(keyring)
    vault = new VaultService(keyring)
    vault.wipeAllKeys()
    storage.wipeLocalCache()
    dispatcher = new ToolDispatcher(storage, vault)
  })

  afterEach(() => {
    vault.wipeAllKeys()
    storage.wipeLocalCache()
  })

  it('mimari düzeyde yasakli araclari hicbir kosulda calistirmaz', async () => {
    for (const name of ['shell_exec', 'read_browser_cookies', 'terminal_run', 'auto_submit_grade']) {
      const res = await dispatcher.executeTool(name, {})
      expect(res.requiresApproval).toBe(false)
      expect(res.result).toBeUndefined()
      expect(res.error).toMatch(/engellenmiştir/)
    }
  })

  it('salt okunur arac otomatik izinle calisir', async () => {
    storage.saveCourses([
      { id: 'c1', name: 'Yapay Zeka', courseState: 'ACTIVE', ownerId: 'u', updateTime: '' },
    ])
    const res = await dispatcher.executeTool('classroom_search', { query: 'Yapay' })
    expect(res.requiresApproval).toBe(false)
    expect(JSON.parse(res.result!)[0].title).toBe('Yapay Zeka')
  })

  /**
   * ANAHTARSIZ ARAMA TESTI
   * ---------------------
   * Onceki surumde bu test GERCEK INTERNETE cikiyordu. Boylece:
   *   • ag olmayan/korunlu bir makinede kirmizi ve rastgele basarisiz olurdu,
   *   • DDG veya Wikipedia sayfa yapisini degistirdiginde test kirilirdi,
   *     kodun degil dis kaynagin hatasi sanilirdi.
   *
   * Asil test edilmesi gereken sey zaten "ag cagrisi yapildi mi, sonucu
   * hangi kaynaktan aldi" degil, SUNUCU DIZISI koptugunda sonraki
   * anahtarsiz kaynaga GECIP GECMEDIGIDIR. Asagida tam olarak bu
   * dogrulanir ve ag tamamen sahtelenir.
   */
  it('anahtarsiz kaynaklarin ilki calismazsa sonrakine gecer', async () => {
    requestSpy.mockReset()
    const seen: string[] = []
    requestSpy.mockImplementation(async (url: string) => {
      seen.push(String(url))
      if (String(url).includes('api.duckduckgo.com')) {
        // Birinci kaynak bos sonuc doner -> sonrakine gecilmelidir.
        return { Heading: '', AbstractURL: '', RelatedTopics: [] }
      }
      if (String(url).includes('tr.wikipedia.org')) {
        return {
          query: {
            search: [
              {
                title: 'Graf kuramı',
                snippet: 'Graf kuramı <b>matematik</b> dalıdır.',
              },
            ],
          },
        }
      }
      throw new Error(`Beklenmeyen istek: ${url}`)
    })

    const res = await dispatcher.executeTool('web_search', { query: 'graf kurami' })
    expect(res.requiresApproval).toBe(false)
    expect(res.error).toBeUndefined()

    const hits = JSON.parse(res.result!)
    expect(hits.length).toBeGreaterThan(0)
    // Wikipedia'nin cevabinda HTML etiketi olmadan temiz metin olmali.
    expect(hits[0].snippet).toBe('Graf kuramı matematik dalıdır.')
    expect(hits[0].url).toContain('tr.wikipedia.org')

    // DuckDuckGo denendi ve bos dondugu icin Wikipedia'ya gecildi.
    expect(seen.some(u => u.includes('api.duckduckgo.com'))).toBe(true)
    expect(seen.some(u => u.includes('tr.wikipedia.org'))).toBe(true)
  })

  it('tum anahtarsiz kaynaklar basarisiz olursa kullaniciya acik hata verir', async () => {
    requestSpy.mockReset()
    requestSpy.mockImplementation(async () => {
      throw new Error('ENETUNREACH')
    })

    const res = await dispatcher.executeTool('web_search', { query: 'herhangi bir şey' })
    expect(res.requiresApproval).toBe(false)
    // Bos liste donmek, modele "bulamadim" bile dedirtmiyor ve model
    // kendi bilgisiyle uyduruyordu. Artik acik bir hata donuyor.
    expect(res.error).toBeTruthy()
    expect(res.result).toBeUndefined()
  })

  it('dosya yazma onay bekler ve onaylanana kadar icerik degismez', async () => {
    const fileId = 'report-md'
    storage.saveFileToCas(fileId, 'c1', 'rapor.md', 'text/markdown', Buffer.from('# Taslak', 'utf8'))

    const res = await dispatcher.executeTool('fs_create_or_update_file', {
      fileId,
      content: '# Guncellendi',
    })
    expect(res.requiresApproval).toBe(true)
    expect(res.callId).toBeDefined()
    expect(dispatcher.getPendingCall(res.callId!)?.status).toBe('pending')

    // Onaylanana kadar icerik degismez. CAS dosyalari sifreli yazildigi
    // icin icerik readCasFile ile okunur.
    const before = storage
      .readCasFile(storage.getCachedFile(fileId)!.absolutePath)
      .toString('utf8')
    expect(before).toBe('# Taslak')

    expect(dispatcher.approveCall(res.callId!)).toBe(true)
    const after = storage
      .readCasFile(storage.getCachedFile(fileId)!.absolutePath)
      .toString('utf8')
    expect(after).toBe('# Guncellendi')
  })

  it('reddedilen cagri uygulanmaz', async () => {
    const res = await dispatcher.executeTool('classroom_stage_draft', {
      courseId: 'c1',
      courseWorkId: 'w1',
      content: 'Test',
    })
    expect(dispatcher.rejectCall(res.callId!)).toBe(true)
    expect(dispatcher.getPendingCall(res.callId!)?.status).toBe('rejected')
  })

  it('classroom_stage_draft onaylandiginda taslak sifreli depoya kaydedilir', async () => {
    const res = await dispatcher.executeTool('classroom_stage_draft', {
      courseId: 'c-101',
      courseWorkId: 'cw-202',
      fileName: 'proje_raporu.md',
      content: '# Proje Başlığı\nBu bir taslaktır.',
    })
    expect(res.requiresApproval).toBe(true)
    expect(res.callId).toBeDefined()
    expect(storage.getDraft('c-101', 'cw-202')).toBeNull()

    const approved = dispatcher.approveCall(res.callId!)
    expect(approved).toBe(true)

    const draft = storage.getDraft('c-101', 'cw-202')
    expect(draft).not.toBeNull()
    expect(draft?.fileName).toBe('proje_raporu.md')
    expect(draft?.content).toBe('# Proje Başlığı\nBu bir taslaktır.')
  })

  it('ayarlardan kapatilan arac model istese de calismaz', async () => {
    const saved = storage.saveFileToCas('f1', 'c1', 'a.md', 'text/markdown', Buffer.from('x'))
    expect(saved.absolutePath).toBeTruthy()

    dispatcher.setPermissions({ fileWrite: false })
    const res = await dispatcher.executeTool('fs_create_or_update_file', {
      fileId: 'f1',
      content: 'yazma denemesi',
    })
    expect(res.requiresApproval).toBe(false)
    expect(res.error).toMatch(/kapatıldığı için çalıştırılmadı/)
  })

  it('izinler varsayilan acik gelir ve sifreli depoda saklanir', async () => {
    expect(dispatcher.getPermissions()).toMatchObject(DEFAULT_TOOL_PERMISSIONS)

    dispatcher.setPermissions({ webSearch: false })
    expect(dispatcher.getPermissions().webSearch).toBe(false)

    const reopened = new ToolDispatcher(storage, vault)
    expect(reopened.getPermissions().webSearch).toBe(false)
  })

  it('kapatilan web aramasi ust katmanda engellenir', async () => {
    dispatcher.setPermissions({ webSearch: false })
    const res = await dispatcher.executeTool('web_search', { query: 'x' })
    expect(res.error).toMatch(/kapatıldığı için çalıştırılmadı/)
  })

  it('workspace_list_open_files aktif ders secili olmasa bile kayitli derslerin dosyalarini listeler', async () => {
    storage.saveCourses([
      { id: 'c1', name: 'Algoritmalar', courseState: 'ACTIVE', ownerId: 'u', updateTime: '' },
    ])
    storage.saveCourseWork('c1', [
      {
        id: 'w1',
        courseId: 'c1',
        title: 'Ödev 1',
        materials: [{ id: 'f1', title: 'odev_yönergesi.pdf', isLocalAvailable: false }],
        state: 'PUBLISHED',
        workType: 'ASSIGNMENT',
        creationTime: '',
        updateTime: '',
      },
    ])

    const res = await dispatcher.executeTool('workspace_list_open_files', {})
    expect(res.requiresApproval).toBe(false)
    expect(res.error).toBeUndefined()
    const parsed = JSON.parse(res.result!)
    expect(parsed.ok).toBe(true)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0].title).toBe('odev_yönergesi.pdf')
    expect(parsed.files[0].course).toBe('Algoritmalar')
  })

  it('extractTextFromPdf ve extractTextFromDocx gecersiz/bos tampon karsisinda patlamaz', () => {
    expect(extractTextFromPdf(Buffer.from('not-a-pdf'))).toBe('')
    expect(extractTextFromDocx(Buffer.from('not-a-docx'))).toBe('')
  })
})