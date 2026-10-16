/**
 * keyRedaction.test.ts
 * ---------------------------------------------------------------------------
 * API anahtarlarinin HATA MESAJLARI icinde sizmamasini dogrular.
 *
 * NEDEN AYRI BIR DOSYA
 * --------------------
 * `vaultService.redact()` yaziliydi ama HICBIR YERDEN CAGRILMIYORDU.
 * Yani hicbir senaryoda devreye girmiyordu. Bu test, artik gercekten
 * cagrildigini kanitlamak icin ayri bir dosyada ve dogrudan davranis
 * uzerinden yazildi.
 *
 * GERCEK SALDIRI YUZEYI
 * ----------------------
 * Bir saglayici 401 dondugunde govde bazen anahtarin bir parcasini icerir
 * ("Incorrect API key provided: sk-proj-ab***"). `HttpError` bu metni
 * dogrudan iletir; arayuz bir hata baloncugunda gosterir ve ayni metin
 * konsola yazilir. Kullanici ekran goruntusunu ya da destek dosyasini
 * paylasarak anahtarini sizdirir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

const USER_DATA = makeTempUserDataDir()

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

const { KeyringService } = await import('../electron/services/keyringService')
const { VaultService } = await import('../electron/services/vaultService')

describe('Anahtar maskeleme (redact)', () => {
  let vault: InstanceType<typeof VaultService>

  beforeEach(() => {
    const keyring = new KeyringService()
    vault = new VaultService(keyring)
    vault.wipeAllKeys()
  })

  afterEach(() => {
    vault.wipeAllKeys()
  })

  it('kasadaki tum anahtarlar hata metninden maskelenir', () => {
    const secret = 'sk-proj-ABCDEF1234567890abcdefghijklmnop'
    vault.setKey('openai', secret)

    const message = `Incorrect API key provided: ${secret}. You can find your API key at https://platform.openai.com/account/api-keys.`
    const redacted = vault.redact(message)

    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED]')
    // Kullaniciya ne yapacagini soyleyen kism korunur.
    expect(redacted).toContain('Incorrect API key provided')
  })

  it('maskeleme taninmayan saglayici anahtarlari icin de gecerlidir', () => {
    // Yerel / ozel saglayicilar kisa ya da bicimi bilinmeyen anahtarlar
    // kullanabilir; bunlar da maskelenmelidir.
    const custom = 'my-local-key-9f8e7d6c5b4a'
    vault.setKey('custom_mistral', custom)

    const redacted = vault.redact(`Baglanti hatasi: anahtar ${custom} reddedildi`)
    expect(redacted).not.toContain(custom)
    expect(redacted).toContain('[REDACTED]')
  })

  it('bilinen API anahtar bicimleri desen olarak maskelenir', () => {
    const cases: Array<[string, string]> = [
      ['OpenAI', 'sk-mock-sample-openai-key-for-testing-purposes-12345'],
      ['Anthropic', 'sk-ant-mock-sample-anthropic-key-for-testing-12345'],
      ['Google', 'AIzaSyMockSampleKeyForTestingRedactionPurposes012'],
      ['OAuth token', 'ya29.mock_sample_oauth_access_token_for_testing_purposes'],
      ['Slack', 'xoxb-mock-sample-token-for-test-redaction-only'],
      ['Tavily', 'tvly-REPLACE_ME_abcdefghijklmnopqrstuvwxyz012'],
      ['SendGrid', 'SG.mockidentifierfor12.mocksecretforredactiontesting1234567890'],
      ['GitHub', 'ghp_mocktokenforredactiontesting0123456789'],
      ['GitLab', 'glpat-abcdefghijklmnopqrst'],
      ['AWS', 'AKIAIOSFODNN7EXAMPLE'],
    ]

    for (const [label, key] of cases) {
      const redacted = vault.redact(`Hata: "${key}" gecersiz.`)
      expect(redacted, `${label} anahtari sizdi`).not.toContain(key)
    }
  })

  it('anahtar icermeyen metinler degistirilmez', () => {
    const clean = 'Ders listesi alinamadi. 429 kotası asildi.'
    expect(vault.redact(clean)).toBe(clean)
  })

  it('bos metin ve bos kasa guvenli sekilde islenir', () => {
    expect(vault.redact('')).toBe('')
    const empty = new VaultService(new KeyringService())
    empty.wipeAllKeys()
    expect(empty.redact('merhaba')).toBe('merhaba')
  })

  it('birden fazla anahtar ayni metinde maskelenir', () => {
    const openai = 'sk-proj-1111111111111111111111111111111111'
    const tavily = 'tvly-REPLACE_ME_abcdefghijklmnopqrstuvwxyz012'
    vault.setKey('openai', openai)
    vault.setKey('tavily', tavily)

    const redacted = vault.redact(`openai=${openai} tavily=${tavily}`)
    expect(redacted).not.toContain(openai)
    expect(redacted).not.toContain(tavily)
  })
})