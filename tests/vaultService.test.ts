import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

const USER_DATA = makeTempUserDataDir()

// Electron, test kosucusunda yok. Gercek bir anahtar kasasi taklit edilir.
vi.mock('electron', () => ({
  app: {
    getPath: () => USER_DATA,
    getVersion: () => '1.0.0-test',
    getLocale: () => 'tr-TR',
  },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

const { KeyringService } = await import('../electron/services/keyringService')
const { VaultService } = await import('../electron/services/vaultService')

describe('KeyringService', () => {
  let keyring: InstanceType<typeof KeyringService>

  beforeEach(() => {
    keyring = new KeyringService()
  })

  afterEach(() => {
    keyring.cryptoShred()
  })

  it('raporlanan anahtar tam olarak 32 bayttir (AES-256)', () => {
    const key = keyring.getMasterKey()
    expect(key).toBeInstanceOf(Buffer)
    expect(key.length).toBe(32)
  })

  it('anahtar dosyasi master key baytlarini icermez', () => {
    const key = keyring.getMasterKey()
    const raw = fs.readFileSync(`${USER_DATA}/jmc_master.key`)

    // Master key'in 32 ham bayti diskte duz haliyle bulunmamali.
    expect(raw.includes(key)).toBe(false)
    // Anahtar dosyasi gercekten var.
    expect(raw.length).toBeGreaterThan(0)
  })

  it('donanim korumali oldugunda durum bunu dogru bildirir', () => {
    const status = keyring.getStatus()
    expect(status.backend).toBe('dpapi')
    expect(status.hardwareProtected).toBe(true)
    expect(status.degraded).toBe(false)
  })

  it('anahtar ayni disk dosyasindan yeniden okunabilir', () => {
    const first = keyring.getMasterKey()
    const second = new KeyringService().getMasterKey()
    expect(first.equals(second)).toBe(true)
  })

  it('cryptoShred anahtar dosyasini kaldirir', () => {
    keyring.getMasterKey()
    expect(fs.existsSync(`${USER_DATA}/jmc_master.key`)).toBe(true)
    keyring.cryptoShred()
    expect(fs.existsSync(`${USER_DATA}/jmc_master.key`)).toBe(false)
  })
})

describe('VaultService', () => {
  let keyring: InstanceType<typeof KeyringService>
  let vault: InstanceType<typeof VaultService>

  beforeEach(() => {
    keyring = new KeyringService()
    vault = new VaultService(keyring)
    vault.wipeAllKeys()
  })

  afterEach(() => {
    vault.wipeAllKeys()
  })

  it('anahtari saklar, geri okur ve varligini bildirir', () => {
    expect(vault.hasKey('anthropic')).toBe(false)
    const secret = 'sk-ant-api03-abcdef1234567890abcdef1234567890'
    vault.setKey('anthropic', secret)
    expect(vault.hasKey('anthropic')).toBe(true)
    expect(vault.getKey('anthropic')).toBe(secret)
  })

  it('arayuze donen parmak izi gercek anahtar karakterleri icermez', () => {
    const secret = 'sk-proj-1234567890abcdef1234567890'
    vault.setKey('openai', secret)
    const fingerprint = vault.getKeyFingerprint('openai')
    expect(fingerprint).toBeTypeOf('string')
    expect(fingerprint).not.toContain(secret)
    expect(fingerprint).not.toContain('1234567890')
  })

  it('belirli bir saglayicinin anahtarini siler', () => {
    vault.setKey('groq', 'gsk_test1234567890')
    expect(vault.hasKey('groq')).toBe(true)
    expect(vault.deleteKey('groq')).toBe(true)
    expect(vault.hasKey('groq')).toBe(false)
  })

  it('gunluk ciktilarindaki anahtar kaliplarini temizler', () => {
    const secret = 'AIzaSyTestKey12345678901234567890123'
    vault.setKey('gemini', secret)
    const raw = `istek gonderildi: ${secret} ve sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
    const redacted = vault.redact(raw)
    expect(redacted).not.toContain(secret)
    expect(redacted).not.toContain('sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(redacted).toContain('[REDACTED]')
  })

  it('tum anahtarlari siler', () => {
    vault.setKey('ollama', 'http://127.0.0.1:11434')
    vault.setKey('deepinfra', 'token_infra_987654321')
    vault.wipeAllKeys()
    expect(vault.hasKey('ollama')).toBe(false)
    expect(vault.hasKey('deepinfra')).toBe(false)
  })

  it('aciklama, gercek anahtar kasa durumundan uretilir', () => {
    const described = vault.describe()
    expect(described.backend).toBe('dpapi')
    expect(described.hardwareProtected).toBe(true)
    expect(described.description).toContain('DPAPI')
  })

  it('bozuk kasa dosyasini silmez, yedekler ve nedeni bildirir', () => {
    const vaultFile = path.join(USER_DATA, 'secrets.vault')
    fs.writeFileSync(vaultFile, Buffer.from('bozuk-kasa-verisi-aes-cozemez'))

    const freshVault = new VaultService(keyring)
    expect(() => freshVault.getKey('openai')).not.toThrow()
    expect(freshVault.getKey('openai')).toBeUndefined()

    // VERI KAYBI YARAN YER: eski surum cozulemeyen kasayi sifirdan
    // baslatiyor ve .corrupted diye yedekliyordu. Artik dosya yedeklenir
    // ama okunabilir sayilmaz; neden kullaniciya bildirilir.
    const health = freshVault.getVaultHealth()
    expect(health.readable).toBe(false)
    expect(health.problem).not.toBe('')

    const files = fs.readdirSync(USER_DATA)
    const backup = files.find(f => f.startsWith('secrets.vault.unreadable.'))
    expect(backup).toBeDefined()
    // Orijinal dosya yerinde durmali: veri yok edilmemis olmali.
    expect(fs.existsSync(vaultFile)).toBe(true)
  })
})

describe('KeyringService - zayif arka uç raporu', () => {
  it('basic_text kullaniliyorsa bunu gizlemez, degraded olarak bildirir', async () => {
    const dir = makeTempUserDataDir()
    vi.doMock('electron', () => ({
      app: { getPath: () => dir },
      safeStorage: makeSafeStorageMock(false),
    }))
    vi.resetModules()
    const mod = await import('../electron/services/keyringService')
    const status = new mod.KeyringService().getStatus()
    expect(status.backend).toBe('basic_text')
    expect(status.hardwareProtected).toBe(false)
    expect(status.degraded).toBe(true)
    vi.doUnmock('electron')
    vi.resetModules()
  })
})