/**
 * memoryAndChatHistory.test.ts
 * ---------------------------------------------------------------------------
 * JustMyClassMemory (Taste & Hafıza) ve Sohbet Geçmişi (Chat Sessions)
 * servislerinin kalıcılık, izolasyon ve entegrasyon testleri.
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
const { JustMyClassMemoryService } = await import('../electron/services/ai/memoryService')
const { ChatSessionService } = await import('../electron/services/ai/chatSessionService')
const { VaultService } = await import('../electron/services/vaultService')
const { AiOrchestrator } = await import('../electron/services/ai/aiOrchestrator')

describe('JustMyClassMemory & Taste Service', () => {
  let storage: InstanceType<typeof StorageService>
  let memory: InstanceType<typeof JustMyClassMemoryService>

  beforeEach(() => {
    const keyring = new KeyringService()
    storage = new StorageService(keyring)
    memory = new JustMyClassMemoryService(storage)
    memory.clear('all')
  })

  it('küresel hafıza (global taste) öğelerini kaydeder ve getirir', () => {
    const item = memory.saveItem({
      category: 'style',
      key: 'Biçim',
      value: 'Formülleri LaTeX ile açıkla',
      scope: 'global',
    })
    expect(item.id).toBeDefined()
    expect(item.key).toBe('Biçim')

    const profile = memory.getProfile()
    expect(profile.globalItems.length).toBe(1)
    expect(profile.globalItems[0].value).toBe('Formülleri LaTeX ile açıkla')
  })

  it('sohbete özel (session) hafıza öğelerini izole şekilde saklar', () => {
    memory.saveItem(
      {
        category: 'academic',
        key: 'Ders Hedefi',
        value: 'Kuantum fiziği 2. vize çalışması',
        scope: 'session',
      },
      'session_123',
    )

    const prof1 = memory.getProfile('session_123')
    const prof2 = memory.getProfile('session_456')

    expect(prof1.sessionItems['session_123']).toHaveLength(1)
    expect(prof1.sessionItems['session_123'][0].key).toBe('Ders Hedefi')
    expect(prof2.sessionItems['session_456'] || []).toHaveLength(0)
  })

  it('sistem istemi için biçimlendirilmiş hafıza bloğu üretir', () => {
    memory.saveItem({
      category: 'style',
      key: 'Dil',
      value: 'Her zaman Türkçe yanıt ver',
    })
    memory.saveItem(
      {
        category: 'academic',
        key: 'Konu',
        value: 'Elektrostatik',
      },
      'sess_abc',
    )

    const prompt = memory.getFormattedMemoryPrompt('sess_abc')
    expect(prompt).toContain('JUSTMYCLASS HAFIZA & TASTE SİSTEMİ')
    expect(prompt).toContain('Dil: Her zaman Türkçe yanıt ver')
    expect(prompt).toContain('Konu: Elektrostatik')
  })

  it('kural tabanlı hafif otomatik hafıza çıkarımı yapar', () => {
    memory.autoExtractMemories(
      'Ben Bilgisayar Mühendisliği 3. sınıf öğrencisiyim.',
      'Harika! Algoritmalar dersiniz için nasıl yardımcı olabilirim?',
      'sess_dept',
    )

    const profile = memory.getProfile('sess_dept')
    const hasDept = profile.globalItems.some(i => i.key === 'Öğrenim / Bölüm' && i.value.includes('Mühendisliği'))
    expect(hasDept).toBe(true)
  })

  it('hafıza öğesini ve tüm hafızayı güvenle temizler', () => {
    const item = memory.saveItem({ category: 'preference', key: 'Test', value: 'Val' })
    expect(memory.getProfile().globalItems).toHaveLength(1)

    const deleted = memory.deleteItem(item.id)
    expect(deleted).toBe(true)
    expect(memory.getProfile().globalItems).toHaveLength(0)

    memory.saveItem({ category: 'preference', key: 'A', value: '1' })
    memory.clear('all')
    expect(memory.getProfile().globalItems).toHaveLength(0)
  })
})

describe('ChatSessionService', () => {
  let storage: InstanceType<typeof StorageService>
  let chatSessions: InstanceType<typeof ChatSessionService>

  beforeEach(() => {
    const keyring = new KeyringService()
    storage = new StorageService(keyring)
    chatSessions = new ChatSessionService(storage)
  })

  it('yeni sohbet oturumu oluşturur ve listeler', () => {
    const s1 = chatSessions.createSession('Fizik Ödevi', 'c1', 'Fizik 101')
    expect(s1.id).toBeDefined()
    expect(s1.title).toBe('Fizik Ödevi')

    const list = chatSessions.listSessions()
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list[0].id).toBe(s1.id)
  })

  it('sohbeti günceller ve mesaj sayısını yansıtır', () => {
    const s = chatSessions.createSession('Matematik')
    s.messages = [
      { id: '1', role: 'user', content: 'Merhaba', timestamp: new Date().toISOString() },
      { id: '2', role: 'assistant', content: 'Selam!', timestamp: new Date().toISOString() },
    ]
    chatSessions.saveSession(s)

    const loaded = chatSessions.getSession(s.id)
    expect(loaded?.messageCount).toBe(2)
    expect(loaded?.messages).toHaveLength(2)
  })

  it('sohbet başlığını yeniden adlandırır ve siler', () => {
    const s = chatSessions.createSession('Eski Başlık')
    chatSessions.renameSession(s.id, 'Yeni Başlık')
    expect(chatSessions.getSession(s.id)?.title).toBe('Yeni Başlık')

    const del = chatSessions.deleteSession(s.id)
    expect(del).toBe(true)
    expect(chatSessions.getSession(s.id)).toBeNull()
  })
})

describe('AiOrchestrator Provider Branding & Memory Integration', () => {
  it('LM Studio sağlayıcısının displayName değerinde Bionic yer alır', () => {
    const keyring = new KeyringService()
    const storage = new StorageService(keyring)
    const vault = new VaultService(keyring)
    const orchestrator = new AiOrchestrator(vault, storage)

    const providers = orchestrator.getProviders()
    const lm = providers.find(p => p.id === 'lmstudio')
    expect(lm).toBeDefined()
    expect(lm?.displayName).toContain('Bionic')
  })
})
