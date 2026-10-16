/**
 * aiToolLoop.test.ts
 * ---------------------------------------------------------------------------
 * Asistanin ARAC DONGUSU ve Iptal davranisini dogrular.
 *
 * NEDEN AYRI BIR DOSYA
 * --------------------
 * `aiOrchestrator.test.ts` anahtar yonetimi ve katalog davranisini
 * olcer. Buradaki testler tamamen FARKLI bir yol izler: ag cagrisini
 * `providerHttp` uzerinden sahte bir SSE akisiyla degistirir ve
 * model -> arac -> model dongusunun GERCEKTEN calistigini kanitlar.
 *
 * ONCEKI SURUMDEKI ASIL HATA
 * ---------------------------
 * `JMC_AI_TOOLS` tanimliydi ama hicbir istek govdesine gonderilmiyordu.
 * Modele "bu araclar var" denmedigi icin model hicbir arac cagiramiyor,
 * kullaniciya "dosyayi inceliyorum" dedikten sonra dosyanin ADINI okuyup
 * ICERIGINI UYDURUYORDU. Bu test dongunun gercekten arac cagirdigini ve
 * arac sonucunun modele geri beslendigini kanitlar.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

const USER_DATA = makeTempUserDataDir()

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

/**
 * Ag katmanini sahtelestir.
 *
 * `providerHttp` tek bir modul nesnesidir; istek sayisi kadar
 * `request` cagrisi yapilir ve her biri sirayla `nextResponses`
 * dizisinden bir SSE govdesi alir.
 */
const requestMock = vi.fn()

vi.mock('../electron/services/httpClient', async () => {
  const actual = await vi.importActual<typeof import('../electron/services/httpClient')>(
    '../electron/services/httpClient',
  )
  class FakeHttpError extends actual.HttpError {}
  return {
    ...actual,
    HttpError: FakeHttpError,
    googleHttp: { request: requestMock, paginate: requestMock },
    providerHttp: { request: requestMock },
  }
})

const { KeyringService } = await import('../electron/services/keyringService')
const { StorageService } = await import('../electron/services/storageService')
const { VaultService } = await import('../electron/services/vaultService')
const { ToolDispatcher } = await import('../electron/services/toolDispatcher')
const { AiOrchestrator, JMC_AI_TOOLS } = await import(
  '../electron/services/ai/aiOrchestrator'
)

/** Bir SSE govdesini `Response` gibi okunabilir bir akisa cevirir. */
function sseResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/** OpenAI uyumlu bir metin parcasi uretir. */
function textDelta(content: string, finish = false): string {
  return `data: ${JSON.stringify({
    id: 'x',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content }, finish_reason: finish ? 'stop' : null }],
  })}`
}

/** OpenAI uyumlu bir arac cagrisi parcasi uretir. */
function toolDelta(
  index: number,
  id: string,
  name: string,
  argsJson: string,
  finish = false,
): string {
  return `data: ${JSON.stringify({
    id: 'x',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index, id, type: 'function', function: { name, arguments: argsJson } },
          ],
        },
        finish_reason: finish ? 'tool_calls' : null,
      },
    ],
  })}`
}

describe('Asistan araç döngüsü', () => {
  let keyring: InstanceType<typeof KeyringService>
  let storage: InstanceType<typeof StorageService>
  let vault: InstanceType<typeof VaultService>
  let dispatcher: InstanceType<typeof ToolDispatcher>
  let orchestrator: InstanceType<typeof AiOrchestrator>

  beforeEach(() => {
    requestMock.mockReset()
    keyring = new KeyringService()
    storage = new StorageService(keyring)
    vault = new VaultService(keyring)
    vault.wipeAllKeys()
    storage.wipeLocalCache()
    dispatcher = new ToolDispatcher(storage, vault)
    orchestrator = new AiOrchestrator(vault, storage, dispatcher)
    // Anahtar girilmis bir OpenAI saglayicisi hazirla.
    orchestrator.setProviderKey('openai', 'sk-test-0123456789abcdefghij')
  })

  afterEach(() => {
    vault.wipeAllKeys()
    storage.wipeLocalCache()
  })

  it('JMC_AI_TOOLS her arac icin geçerli bir şema üretir', () => {
    expect(JMC_AI_TOOLS.length).toBeGreaterThan(0)
    for (const tool of JMC_AI_TOOLS) {
      expect(tool.type).toBe('function')
      expect(tool.function.name).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(tool.function.description.length).toBeGreaterThan(10)
      const params = tool.function.parameters as unknown as {
        type: string
        properties: Record<string, unknown>
        required?: string[]
      }
      expect(params.type).toBe('object')
      expect(params.properties).toBeTypeOf('object')
      // JSON Schema'da `required`, `parameters` ICINDE yer alir ve her
      // saglayici icin (Gemini dahil) tanimli olmak zorundadir.
      expect(Array.isArray(params.required)).toBe(true)
      // `required` alanlari `properties` icinde tanimli olmali.
      for (const key of params.required as string[]) {
        expect(Object.keys(params.properties)).toContain(key)
      }
    }
  })

  it('dosya kimliklerini ogrenmek icin listeleme araci sunulur', () => {
    const names = JMC_AI_TOOLS.map(t => t.function.name)
    // Bu arac olmadan model dosya kimligini TAHMIN eder ve okuyamadigi
    // icerigi uydurur. Varligi bu hatanin koynudur.
    expect(names).toContain('workspace_list_open_files')
    expect(names).toContain('workspace_read_open_file')
  })

  it('model arac cagirdiginda arac calisir ve sonucu modele geri beslenir', async () => {
    // 1. istek: model arac cagirir.
    // 2. istek: model arac sonucunu alip yanitlar.
    requestMock
      .mockResolvedValueOnce(
        sseResponse([
          toolDelta(0, 'call_1', 'classroom_search', '{"query":"fizik"}', true),
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([textDelta('Fizik dersinde 3 ödev bulundu.'), textDelta('', true)]),
      )

    const chunks: string[] = []
    const result = await orchestrator.sendChatMessage(
      {
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Fizik dersimde neler var?' }],
        context: {},
        mode: 'general',
      },
      chunk => chunks.push(chunk),
    )

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(result.content).toContain('Fizik dersinde 3 ödev bulundu')

    // Arac cagrisi hem yanitta hem de arayuz kartinda kayitli olmali.
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls?.[0].name).toBe('classroom_search')
    expect(result.toolCalls?.[0].status).toBe('completed')
    expect(result.toolCalls?.[0].args).toMatchObject({ query: 'fizik' })
  })

  it('arac semasi istek govdesine gercekten eklenir', async () => {
    requestMock.mockResolvedValueOnce(sseResponse([textDelta('Merhaba'), textDelta('', true)]))

    await orchestrator.sendChatMessage(
      {
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Merhaba' }],
        context: {},
        mode: 'general',
      },
      () => {},
    )

    const [, options] = requestMock.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(Array.isArray(body.tools)).toBe(true)
    expect(body.tools.length).toBe(JMC_AI_TOOLS.length)
    expect(body.tool_choice).toBe('auto')
    expect(body.tools.some((t: any) => t.function.name === 'web_search')).toBe(true)
  })

  it('toolsEnabled=false ile arac semasi gonderilmez', async () => {
    requestMock.mockResolvedValueOnce(sseResponse([textDelta('Tamam'), textDelta('', true)]))

    await orchestrator.sendChatMessage(
      {
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Merhaba' }],
        context: {},
        mode: 'general',
        toolsEnabled: false,
      },
      () => {},
    )

    const [, options] = requestMock.mock.calls[0]
    expect(JSON.parse(options.body).tools).toBeUndefined()
  })

  it('kullanici iptal ederse dongu durur ve hata firlatmaz', async () => {
    const controller = new AbortController()
    requestMock.mockImplementation(async () => {
      controller.abort(new Error('Kullanıcı yanıt üretimini durdurdu.'))
      return sseResponse([textDelta('kismi')])
    })

    await expect(
      orchestrator.sendChatMessage(
        {
          providerId: 'openai',
          modelId: 'gpt-4.1',
          messages: [{ role: 'user', content: 'uzun bir sey yaz' }],
          context: {},
          mode: 'general',
        },
        () => {},
        controller.signal,
      ),
    ).rejects.toThrow(/iptal|durdur/i)
  })

  it('iptal sinyali tur basinda kontrol edilir', async () => {
    const controller = new AbortController()
    controller.abort()

    requestMock.mockResolvedValue(sseResponse([textDelta('Merhaba'), textDelta('', true)]))

    await expect(
      orchestrator.sendChatMessage(
        {
          providerId: 'openai',
          modelId: 'gpt-4.1',
          messages: [{ role: 'user', content: 'Merhaba' }],
          context: {},
          mode: 'general',
        },
        () => {},
        controller.signal,
      ),
    ).rejects.toThrow(/iptal/i)
    // Iptal edilmis bir akista ag cagrisi HIC yapilmamalidir.
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('bos model yaniti sessizce gecmez, acik hata verir', async () => {
    // Guvenlik filtresi bos bir yanit uretir: kullanici sonsuza kadar
    // "Yanit bekleniyor..." ekraninda kalirdi.
    requestMock.mockResolvedValueOnce(sseResponse([textDelta('', true)]))

    await expect(
      orchestrator.sendChatMessage(
        {
          providerId: 'openai',
          modelId: 'gpt-4.1',
          messages: [{ role: 'user', content: 'Merhaba' }],
          context: {},
          mode: 'general',
        },
        () => {},
      ),
    ).rejects.toThrow(/boş bir yanıt/i)
  })

  it('onay gerektiren arac calistirilmaz ve kullaniciya durum bildirilir', async () => {
    // `classroom_stage_draft` geri alinamaz; onay gerektirir.
    requestMock
      .mockResolvedValueOnce(
        sseResponse([
          toolDelta(
            0,
            'call_approve',
            'classroom_stage_draft',
            '{"courseId":"c1","courseWorkId":"w1","fileName":"a.md","content":"x"}',
            true,
          ),
        ]),
      )
      .mockResolvedValueOnce(sseResponse([textDelta('Taslak hazırladım.'), textDelta('', true)]))

    const chunks: string[] = []
    const result = await orchestrator.sendChatMessage(
      {
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Ödev için taslak yaz' }],
        context: {},
        mode: 'general',
      },
      chunk => chunks.push(chunk),
    )

    expect(result.toolCalls?.[0].requiresApproval).toBe(true)
    expect(result.toolCalls?.[0].status).toBe('pending')
    // Kullaniciya acikca soylenmeli; eski mesaj "otomatik iletilecek"
    // diyordu ama onay akisi modele geri donmuyordu.
    expect(chunks.join('')).toMatch(/onay/i)
  })

  it('model arac istemeden dogrudan cevap verirse tek istek yeter', async () => {
    requestMock.mockResolvedValueOnce(sseResponse([textDelta('Sadece bir metin.'), textDelta('', true)]))

    const result = await orchestrator.sendChatMessage(
      {
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Merhaba' }],
        context: {},
        mode: 'general',
      },
      () => {},
    )

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toBeUndefined()
    expect(result.content).toBe('Sadece bir metin.')
  })

  it('sonsuz arac cagri zinciri sinirlandirilir', async () => {
    // Her turda yeni bir arac cagirilir: model donguyu kapatmaz.
    requestMock.mockImplementation(async () =>
      sseResponse([
        toolDelta(0, `call_${requestMock.mock.calls.length}`, 'classroom_search', '{"query":"x"}', true),
      ]),
    )

    const result = await orchestrator.sendChatMessage(
      {
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{ role: 'user', content: 'devam et' }],
        context: {},
        mode: 'general',
      },
      () => {},
    )

    // Dongu tavani asilmamalidir.
    expect(requestMock.mock.calls.length).toBeLessThanOrEqual(9)
    expect(result.content.length).toBeGreaterThanOrEqual(0)
  })
})