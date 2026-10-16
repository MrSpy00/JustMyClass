/**
 * aiModelCatalog.test.ts
 * ---------------------------------------------------------------------------
 * "Modelleri sorgula" ciktisinin KULLANILABILIR olmasini dogrular.
 *
 * KULLANICI TALEBI
 * ----------------
 * "Modelleri sorgula bastim, mesela Gemini'de butun modellerde ayni
 * iki ikon var" ve "manuel olarak modelleri sorgulamak zorunda
 * kalmasin, her acilista otomatik guncel verilerle calissin".
 *
 * GERCEK HATA
 * -----------
 * Google'in `ListModels` ucu `supportedGenerationMethods` alaninda
 * `generateContent` BULUNAN her modeli donduruyor. Bu, sohbet icin
 * KULLANILAMAZ modelleri de iceriyordu:
 *
 *   - metinden sese      : gemini-2.5-*-preview-tts
 *   - gorsel uretim      : gemini-2.5-flash-image, imagen-*, nano-banana-*
 *   - ses / video        : lyria-*, veo-*
 *   - robotiks / ozel    : gemini-3-robotics-er-2-preview
 *   - arama derinligi    : deep-research-*
 *   - gomulu arac kullanan: gemini-2.5-computer-use-preview-*
 *   - gomulu             : text-embedding-*
 *
 * Ekran goruntusundeki listenin YARISI bu kullanilamaz modellerden
 * olusuyordu; kullanici birini secince ya hata aliyor ya da bos
 * cevap aliyordu.
 *
 * Bu test, filtresin gercekten calistigini ve liste normalizasyonunun
 * (tekillestirme + kararli one) beklendigi gibi oldugunu kanitlar.
 */
import { describe, it, expect, vi } from 'vitest'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

const USER_DATA = makeTempUserDataDir()

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

const { isChatCapableModel, normalizeFetchedModels } = await import(
  '../electron/services/ai/aiOrchestrator'
)

describe('isChatCapableModel', () => {
  it('gercek sohbet modellerini gecirir', () => {
    const chatModels = [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-flash-latest',
      'gemini-pro-latest',
      'gemini-3-pro-preview',
      'gemini-3-flash-preview',
      'gemini-1.5-flash',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'gpt-4.1',
      'gpt-4.1-mini',
      'o3',
      'o4-mini',
      'grok-4',
      'deepseek-chat',
      'gpt-oss-120b',
    ]
    for (const id of chatModels) {
      expect(isChatCapableModel(id), `${id} gecmeliydi`).toBe(true)
    }
  })

  it('sohbet icin kullanilamayan modelleri eler', () => {
    // Google'in ListModels ucundan gelen, sohbete uygun OLMAYAN modeller.
    const nonChat = [
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-pro-preview-tts',
      'gemini-2.5-flash-image',
      'gemini-2.0-flash-preview-image-generation',
      'nano-banana-pro',
      'nano-banana',
      'imagen-4.0-ultra',
      'lyria-3.5',
      'veo-3.0-generate-preview',
      'gemini-3-robotics-er-2-preview',
      'deep-research-pro-preview',
      'gemini-2.5-computer-use-preview-10-2025',
      'text-embedding-004',
      'gemini-3-pro-aqa-preview',
      'gemini-2.5-flash-native-audio-preview',
      'gemini-live-2.5-flash-preview',
    ]
    for (const id of nonChat) {
      expect(isChatCapableModel(id), `${id} elenmeliydi`).toBe(false)
    }
  })

  it('bos girdide false doner (liste kirletilmesin)', () => {
    expect(isChatCapableModel('')).toBe(false)
    expect(isChatCapableModel('   ')).toBe(false)
  })
})

describe('normalizeFetchedModels', () => {
  it('Google ListModels ciktisini kullanilabilir sohbet modellerine cevirir', () => {
    // Google'in gercek ListModels yapisinin karsiligi.
    const raw = [
      { id: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576 },
      { id: 'models/gemini-2.5-pro-preview-tts', displayName: 'Gemini 2.5 Pro Preview TTS' },
      { id: 'models/nano-banana-pro', displayName: 'Nano Banana Pro' },
      { id: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1048576 },
      { id: 'models/imagen-4.0-ultra', displayName: 'Imagen 4.0 Ultra' },
      { id: 'models/text-embedding-004', displayName: 'Text Embedding 004' },
      { id: 'models/gemini-flash-latest', displayName: 'Gemini Flash Latest' },
    ]

    const models = normalizeFetchedModels(
      raw.map(m => ({
        id: m.id.replace(/^models\//, ''),
        name: m.displayName,
        contextWindow: m.inputTokenLimit,
      })),
      { visionById: id => id.startsWith('gemini') },
    )

    // Siralama: once `latest` isaretli kararli surum, sonra ayni
    // seviyedekiler ada gore. (Kararli > onizleme > duz surum.)
    expect(models.map(m => m.id)).toEqual([
      'gemini-flash-latest',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ])
    // Tum modeller arac cagirabilir olmali (asistan tam da bunu kullaniyor).
    expect(models.every(m => m.supportsTools)).toBe(true)
  })

  it('ayni gorunen adi tasiyan onizleme/kararli ikilisinden kararliyi secer', () => {
    // Google ayni modelin `preview` ve kararli surumunu birlikte donduruyor.
    // Kullaniciya ikisini birden gostermek karmasa yaratiyordu:
    // ekran goruntusunde ayni ad IKI KEZ gorunuyordu.
    const models = normalizeFetchedModels([
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro' },
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
    ])
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('gemini-3-pro')
  })

  it('`latest` isaretli surumu kararli olanlardan daha one alir', () => {
    const models = normalizeFetchedModels([
      { id: 'gemini-2.0-flash', name: 'A' },
      { id: 'gemini-flash-latest', name: 'B' },
      { id: 'gemini-3-pro-preview', name: 'C' },
    ])
    expect(models.map(m => m.id)).toEqual([
      'gemini-flash-latest',
      'gemini-2.0-flash',
      'gemini-3-pro-preview',
    ])
  })

  it('ayni id birden fazla kez gelirse tekillestirir', () => {
    const models = normalizeFetchedModels([
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    ])
    expect(models).toHaveLength(1)
  })

  it('bos girdide bos liste doner (katalogu BOSALTMAZ)', () => {
    // Kritik: gecici bir ag kesintisinde gomulu katalog silinmemeli.
    // `mergeFetchedWithCatalog` bunu bir ust katmanda sagliyor ama
    // buradaki liste de bos olmamali.
    expect(normalizeFetchedModels([])).toEqual([])
    expect(normalizeFetchedModels([{ id: '', name: '' }])).toEqual([])
  })

  it('tum girdiler elenirse bos liste doner', () => {
    const models = normalizeFetchedModels([
      { id: 'imagen-4.0-ultra', name: 'Imagen 4.0 Ultra' },
      { id: 'text-embedding-004', name: 'Text Embedding 004' },
    ])
    expect(models).toEqual([])
  })

  it('gorsel destegi katalog bayragindan okunur', () => {
    const models = normalizeFetchedModels(
      [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
      { visionById: id => id.includes('pro') },
    )
    expect(models[0].supportsVision).toBe(true)

    const without = normalizeFetchedModels(
      [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
      { visionById: () => false },
    )
    expect(without[0].supportsVision).toBe(false)
  })
})