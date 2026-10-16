import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
const { ToolDispatcher } = await import('../electron/services/toolDispatcher')
const { AiOrchestrator, JMC_AI_TOOLS, isLoopbackUrl } = await import(
  '../electron/services/ai/aiOrchestrator'
)

describe('AiOrchestrator & Araç Entegrasyonu', () => {
  let keyring: InstanceType<typeof KeyringService>
  let storage: InstanceType<typeof StorageService>
  let vault: InstanceType<typeof VaultService>
  let dispatcher: InstanceType<typeof ToolDispatcher>
  let orchestrator: InstanceType<typeof AiOrchestrator>

  beforeEach(() => {
    keyring = new KeyringService()
    storage = new StorageService(keyring)
    vault = new VaultService(keyring)
    vault.wipeAllKeys()
    storage.wipeLocalCache()
    dispatcher = new ToolDispatcher(storage, vault)
    orchestrator = new AiOrchestrator(vault, storage, dispatcher)
  })

  afterEach(() => {
    vault.wipeAllKeys()
    storage.wipeLocalCache()
  })

  it('JMC_AI_TOOLS listesi tüm kritik araçları içerir', () => {
    const toolNames = JMC_AI_TOOLS.map(t => t.function.name)
    expect(toolNames).toContain('classroom_search')
    expect(toolNames).toContain('classroom_get_assignment_details')
    expect(toolNames).toContain('workspace_read_open_file')
    expect(toolNames).toContain('web_search')
    expect(toolNames).toContain('classroom_stage_draft')
    expect(toolNames).toContain('fs_create_or_update_file')
  })

  it('varsayılan sağlayıcılar ve modeller eksiksiz yüklenir', () => {
    const providers = orchestrator.getProviders()
    const pIds = providers.map(p => p.id)
    expect(pIds).toContain('anthropic')
    expect(pIds).toContain('openai')
    expect(pIds).toContain('gemini')
    expect(pIds).toContain('deepseek')
    expect(pIds).toContain('xai')
    expect(pIds).toContain('groq')
    expect(pIds).toContain('ollama')
  })

  it('isLoopbackUrl yerel adresleri güvenle tanır ve harici adresleri reddeder', () => {
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true)
    expect(isLoopbackUrl('http://127.0.0.1:1234')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:8080')).toBe(true)
    expect(isLoopbackUrl('https://api.openai.com')).toBe(false)
    expect(isLoopbackUrl('https://malicious-site.com')).toBe(false)
    expect(isLoopbackUrl('gecersiz-url')).toBe(false)
  })

  it('anahtar olmadan uzak sağlayıcıya çağrı denendiğinde uydurma yanıt dönmez, açık hata verir', async () => {
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
    ).rejects.toThrow(/API anahtarı girilmemiş/)
  })

  it('özel sağlayıcı kaydedilebilir, güncellenebilir ve silinebilir', () => {
    orchestrator.saveCustomProvider({
      id: 'custom_mistral',
      displayName: 'Mistral Local',
      protocolType: 'openai',
      baseUrl: 'http://localhost:8000/v1',
      isLocal: true,
      isEnabled: true,
      hasKey: false,
      models: [{ id: 'mistral-7b', name: 'Mistral 7B', contextWindow: 32768, maxOutputTokens: 4096, supportsVision: false, supportsTools: true, supportsReasoning: false }],
    })

    const found = orchestrator.getProviders().find(p => p.id === 'custom_mistral')
    expect(found).toBeDefined()
    expect(found?.displayName).toBe('Mistral Local')

    orchestrator.removeProvider('custom_mistral')
    const deleted = orchestrator.getProviders().find(p => p.id === 'custom_mistral')
    expect(deleted).toBeUndefined()
  })

  it('setProviderKey ve deleteProviderKey saglayici durumunu aninda gunceller', () => {
    // Ilk durum: anahtar yok
    const initial = orchestrator.getProviders().find(p => p.id === 'openai')
    expect(initial?.hasKey).toBe(false)
    expect(initial?.maskedKey).toBeUndefined()

    // Anahtar kaydet
    orchestrator.setProviderKey('openai', 'sk-proj-test123456789')
    const saved = orchestrator.getProviders().find(p => p.id === 'openai')
    expect(saved?.hasKey).toBe(true)
    expect(saved?.maskedKey).toBeDefined()
    expect(typeof saved?.maskedKey).toBe('string')
    // Gercek anahtar karakterlerinin arayüze sızmadığını doğrula
    expect(saved?.maskedKey).not.toContain('sk-proj-test123456789')

    // Anahtar sil
    orchestrator.deleteProviderKey('openai')
    const afterDelete = orchestrator.getProviders().find(p => p.id === 'openai')
    expect(afterDelete?.hasKey).toBe(false)
    expect(afterDelete?.maskedKey).toBeUndefined()
  })

  it('önbelleğe alınan modelleri (ai.cachedModels) ve yerel uç noktaları yeniden başlatmada korur', () => {
    storage.setSetting('ai.cachedModels', {
      gemini: [
        {
          id: 'gemini-2.5-pro-live-test',
          name: 'Gemini 2.5 Pro Live Test',
          contextWindow: 1000000,
          maxOutputTokens: 65536,
          supportsVision: true,
          supportsTools: true,
          supportsReasoning: true,
        },
      ],
    })
    orchestrator.setLocalEndpoint('ollama', 'http://127.0.0.1:11435')

    const freshOrchestrator = new AiOrchestrator(vault, storage, dispatcher)
    const gemini = freshOrchestrator.getProviders().find(p => p.id === 'gemini')
    expect(gemini?.models.some(m => m.id === 'gemini-2.5-pro-live-test')).toBe(true)

    const ollama = freshOrchestrator.getProviders().find(p => p.id === 'ollama')
    expect(ollama?.baseUrl).toBe('http://127.0.0.1:11435')
  })
})
