import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

const DOWNLOADS = makeTempUserDataDir()
const USER_DATA = DOWNLOADS

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'downloads' ? DOWNLOADS : USER_DATA) },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

const { KeyringService } = await import('../electron/services/keyringService')
const { StorageService } = await import('../electron/services/storageService')
const { ExportService } = await import('../electron/services/exportService')

type KeyringType = InstanceType<typeof KeyringService>
type StorageType = InstanceType<typeof StorageService>

describe('ExportService', () => {
  let keyring: KeyringType
  let storage: StorageType
  let exporter: InstanceType<typeof ExportService>

  beforeEach(() => {
    keyring = new KeyringService()
    storage = new StorageService(keyring)
    storage.wipeLocalCache()
    exporter = new ExportService(storage)

    storage.saveCourses([
      {
        id: 'course-ai',
        name: 'BIL-301 Yapay Zeka',
        section: 'A Subesi',
        room: 'D-204',
        ownerId: 'hoca',
        courseState: 'ACTIVE',
        updateTime: '',
      },
    ])

    storage.saveCourseWork('course-ai', [
      {
        id: 'work-astar',
        courseId: 'course-ai',
        title: 'Arama algoritmalari',
        description: '## Genislik oncelikli arama\n\nKuyruk tabanli arama nasil calisir?',
        state: 'PUBLISHED',
        workType: 'ASSIGNMENT',
        materials: [],
        creationTime: '',
        updateTime: '',
        maxPoints: 100,
        dueDate: { year: 2026, month: 10, day: 24 },
      },
    ])

    storage.saveRubric({
      id: 'rubric-1',
      courseId: 'course-ai',
      courseWorkId: 'work-astar',
      criteria: [
        {
          id: 'crit-1',
          title: 'Algoritma secimi',
          description: 'Uygun arama algoritmasinin secilmesi',
          levels: [
            { levelId: 'l1', title: 'Yetersiz', points: 5 },
            { levelId: 'l2', title: 'Yeterli', points: 15 },
          ],
        },
      ],
    })
  })

  afterEach(() => {
    storage.wipeLocalCache()
  })

  it('JSON ciktisi gercek veriyi icerir', async () => {
    const res = await exporter.exportData('json')
    expect(fs.existsSync(res.filePath)).toBe(true)

    const parsed = JSON.parse(fs.readFileSync(res.filePath, 'utf8'))
    expect(parsed.application).toContain('JustMyClass')
    expect(parsed.courses).toHaveLength(1)
    expect(parsed.courses[0].name).toBe('BIL-301 Yapay Zeka')
    expect(parsed.courses[0].courseWork).toHaveLength(1)
  })

  it('CSV basligi sabit ve veriler kacirilmis olarak yazilir', async () => {
    const res = await exporter.exportData('csv')
    const content = fs.readFileSync(res.filePath, 'utf8')

    expect(content.split('\n')[0]).toContain('Ders ID')
    expect(content).toContain('BIL-301 Yapay Zeka')
    expect(content).toContain('Arama algoritmalari')
  })

  it('CSV icindeki ayirici ve tirnak karakterleri kacirilir', async () => {
    storage.saveCourses([
      {
        id: 'c-quote',
        name: 'Virgulu, "tirnakli" ders',
        courseState: 'ACTIVE',
        ownerId: 'u',
        updateTime: '',
      },
    ])
    storage.saveCourseWork('c-quote', [
      {
        id: 'w-q',
        courseId: 'c-quote',
        title: 'Noktali; baslik',
        state: 'PUBLISHED',
        workType: 'ASSIGNMENT',
        materials: [],
        creationTime: '',
        updateTime: '',
      },
    ])

    const res = await exporter.exportData('csv')
    const content = fs.readFileSync(res.filePath, 'utf8')
    // Ayirici karakter iceren alan tirnak icine alinir, icteki tirnaklar ikiye katlanir.
    expect(content).toContain('"Virgulu, ""tirnakli"" ders"')
    expect(content).toContain('"Noktali; baslik"')
  })

  it('Markdown ciktisi gercek basliklari ve kaynak baglantilarini icerir', async () => {
    const res = await exporter.exportData('markdown')
    const content = fs.readFileSync(res.filePath, 'utf8')

    expect(content).toContain('# JustMyClass')
    expect(content).toContain('https://github.com/MrSpy00/JustMyClass')
    expect(content).toContain('BIL-301 Yapay Zeka')
    expect(content).toContain('Arama algoritmalari')
  })

  it('Anki ciktisi yalnizca veriden turetilen kartlari icerir', async () => {
    const res = await exporter.exportData('anki')
    const content = fs.readFileSync(res.filePath, 'utf8')

    expect(content.startsWith('#separator:Tab')).toBe(true)
    // Rubrik kriterinden uretilmis gercek bir kart.
    expect(content).toContain('Algoritma secimi')
    // Odev yonergesindeki basliktan uretilmis soru.
    expect(content).toContain('Kuyruk tabanli arama nasil calisir?')
  })

  it('kart uretilebilecek veri yoksa hata verir, sahte kart uretmez', async () => {
    storage.wipeLocalCache()
    storage.saveCourses([
      {
        id: 'bos',
        name: 'Bos Ders',
        courseState: 'ACTIVE',
        ownerId: 'u',
        updateTime: '',
      },
    ])
    await expect(exporter.exportData('anki')).rejects.toThrow(/Kart üretilecek veri/)
  })

  it('desteklenmeyen bicim reddedilir', async () => {
    await expect(exporter.exportData('pdf' as never)).rejects.toThrow()
  })
})