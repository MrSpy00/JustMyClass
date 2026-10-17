import { resolveDataDir } from './dataDir'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'
import { ProviderId } from '../../types/jmc'
import { KeyringService, aesEncrypt, aesDecrypt } from './keyringService'

/**
 * Kasa anahtarlarindan MASKE EDILMEYECEK degerler.
 *
 * Bu bir "guvenlik acigi degil, guvenlik hatasi" listesi: buradaki
 * degerler zaten GIZLI DEGILDIR ve maskelemek kullaniciya zarar verir.
 *
 * `google_client_id` onceki surumde kasada tutuluyordu ve `redact()`
 * onu `[REDACTED]` yapiyordu. Kullanici Ayarlar'a kimligini yaziyor,
 * ekranda `([REDACTED]...)` goruyor ve kimligi dogrulayamiyordu.
 * Istemci kimligi OAuth URL'inde duz metin olarak tarayiciya gider;
 * gizli DEGILDIR. Artik depoda tutuluyor, bu liste ise ikinci bir
 * emniyet bariidir.
 */
const NEVER_REDACT_KEYS = new Set(['google_client_id', 'oauth_client_id'])

/**
 * VaultService
 * ---------------------------------------------------------------------------
 * AI saglayici anahtarlari ve Google OAuth token'larini tutar.
 *
 * Sifreleme gercek ve isletim sistemine baglidir:
 *  Anahtar rastgele uretilir (KeyringService) ve yalnizca OS kasasinin
 *  sarmaladigi bicimde diske yazilir. Diskte duz metin anahtar, kullanici
 *  adi, ortak pepper veya depo sabiti YOKTUR.
 *
 * Cift katmanli yapi:
 *  1) Ana anahtar  -> OS kasasi (DPAPI / Keychain / libsecret)
 *  2) Kasa icerigi -> AES-256-GCM(ana anahtar)
 */

/** Bilesik anahtar tanimlari icin ayri bir kaynak dizini kullanilir. */
const VAULT_FILE = 'secrets.vault'

/**
 * Veri URI'si ya da uzun saf base64 yuku mu?
 *
 * `redact()` bunlara DOKUNMAZ. Gerekce:
 *
 *   • `data:application/pdf;base64,JVBERi0xLj...` -> dosya onizlemesi
 *   • `JVBERi0xLj...` (yuzlerce KB) -> gorsel/ses onizlemesi
 *
 * Bunlar kullaniciya ait IKILI dosyalardir; iclerinde sir yoktur. Ve
 * sirlama desenleri base64 ile tesadufen eslesip metni bozdugu icin
 * uzerlerinden GECMELER dogru davranistir. Ayrica tek bir API anahtari
 * bile base64 icinde gecebilir; kullanici kendi PDF'ini yuklediginde
 * dosya bozulmamalidir.
 *
 * Esik degerleri:
 *   • 512 karakter: normal bir API anahtari (~44-100 karakter) veya bir
 *     hata mesaji bu esigi gecmez, dolayisiyla sirlama ETKILENMEZ.
 *   • Yalnizca tamamen base64 alfabesinden olusan, sonunda `=` dolgulu
 *     bir dizi kabul edilir. NormalTurkce metin, JSON, URL veya hata
 *     mesaji bu bicime girmez.
 */
function isBinaryPayload(s: string): boolean {
  if (!s) return false
  // data URI: base64 ya da URL-encoded ikili
  if (/^data:[\w.+-]+\/[\w.+-]+(;[\w-]+=[\w-]+)*;base64,/i.test(s)) return true
  // Duz base64 yuku. Satir sonu kirilmalari (RFC 2045) tolere edilir.
  const body = s.replace(/\s+/g, '')
  if (body.length < 512) return false
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return false
  return true
}

export class VaultService {
  private readonly vaultPath: string
  private readonly keyring: KeyringService
  private memoryKeys = new Map<string, string>()
  private isLoaded = false
  /** Kasa iceriginin hangi bicimde yazildigi (migrasyon ve tanilama icin). */
  private lastFormat: 'aes-256-gcm' | 'none' = 'none'
  /** Cozulemeyen kasa dosyasi diskte duruyor ve UZERINE YAZILAMAZ. */
  private vaultUnreadable = false
  private vaultUnreadableReason = ''

  constructor(keyring: KeyringService) {
    this.keyring = keyring
    const userDataPath = resolveDataDir()
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true })
    this.vaultPath = path.join(userDataPath, VAULT_FILE)
  }

  public ensureLoaded(): void {
    if (this.isLoaded) return
    this.isLoaded = true
    this.loadVault()
  }

  public getStatus() {
    return this.keyring.getStatus()
  }

  /** Kasa sagligi: cozulemeyen kasa uzerine yazilmaz. */
  public getVaultHealth(): { readable: boolean; writable: boolean; problem: string } {
    this.ensureLoaded()
    const writable = !this.vaultUnreadable && this.keyring.canPersistEncryptedStores()
    return {
      readable: !this.vaultUnreadable,
      writable,
      problem: this.vaultUnreadableReason || (writable ? '' : this.keyring.getKeyDiagnostics().problem),
    }
  }

  /**
   * Onceki surumden kalan, DUZ METIN ve KIRILABILIR kasa dosyalarini
   * temizler.
   *
   * Eski surum kasa dosyasini `scryptSync(COMPUTERNAME-USERNAME-PEPPER,
   * 'JMC_SALT_ARGON2_EQUIV')` ile sifreliyordu. Tuz ve turev girdileri
   * kaynak kodda herkese acik oldugu icin, kullanicinin Windows kullanici
   * adi ve bilgisayar adi bilinen biri bu dosyayi cozebilir.
   *
   * Bu dosyalar okunmuyor ve silinmiyordu; diskte kurcalanmaya devam
   * ediyorlardi. Artik bir kez silinirler.
   */
private purgeLegacyArtifacts(): void {
    const dir = path.dirname(this.vaultPath)
    const legacyFiles = ['secrets.env.vault', 'jmc_vault_database.bin']
    for (const name of legacyFiles) {
      const legacyPath = path.join(dir, name)
      if (!fs.existsSync(legacyPath)) continue
      try {
        const size = fs.statSync(legacyPath).size
        if (size > 0) fs.writeFileSync(legacyPath, crypto.randomBytes(size))
        fs.unlinkSync(legacyPath)
        console.warn(
          `[VaultService] Guvensiz eski kasa dosyasi (${name}) silindi. ` +
            'Bu dosyanin sifreleme anahtari tahmin edilebilirdi. ' +
            'API anahtarlarinizi ve Google oturumunuzu yeniden girmeniz gerekir.',
        )
      } catch {
        /* silinemezse uyari; uygulamanin acilmasi engellenmemeli */
      }
    }
  }

  private loadVault(): void {
    // Once kirilabilir artiklari temizle.
    this.purgeLegacyArtifacts()

    if (!fs.existsSync(this.vaultPath)) return

    try {
      const blob = fs.readFileSync(this.vaultPath)
      if (blob.length === 0) return
      const plain = aesDecrypt(this.keyring.getMasterKey(), blob).toString('utf8')
      const parsed = JSON.parse(plain) as Record<string, string>
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') this.memoryKeys.set(k, v)
      }
      this.lastFormat = 'aes-256-gcm'
    } catch (err) {
      console.error(
        '[VaultService] Kasa acilamadi. Ana anahtar bu isletim sisteminde cozulemiyor olabilir; anahtarlar yeniden girilmeli.',
        err instanceof Error ? err.message : err,
      )
      // VERI KAYBI YARAN YER: Onceki surum burada `this.persist()` ile
      // BOS bir kasa yaziyordu; anahtar duzelttiginde kullanicinin tum
      // API anahtarlari ve Google oturumu kalici olarak yok oluyordu.
      // Artik kasa dosyasi OLDUGU GIBI kalir, UZERINE YAZILMAZ.
      this.vaultUnreadable = true
      this.vaultUnreadableReason =
        'Sifreli kasa acilamadi (' +
        (err instanceof Error ? err.message : String(err)) +
        '). Dosya korunuyor; uzerine yazilmadi.'
      try {
        const backupPath = `${this.vaultPath}.unreadable.${Date.now()}`
        fs.copyFileSync(this.vaultPath, backupPath)
      } catch {
        /* yoksay */
      }
      this.memoryKeys.clear()
    }
  }

  private persist(): void {
    // Anahtar cozulemediyse veya kasa cozulemediyse UZERINE YAZMA.
    if (!this.keyring.canPersistEncryptedStores() || this.vaultUnreadable) {
      return
    }
    try {
      const obj: Record<string, string> = {}
      for (const [k, v] of this.memoryKeys) obj[k] = v
      const plain = Buffer.from(JSON.stringify(obj), 'utf8')
      const cipher = aesEncrypt(this.keyring.getMasterKey(), plain)

      const tmp = `${this.vaultPath}.tmp`
      fs.writeFileSync(tmp, cipher, { mode: 0o600 })
      fs.renameSync(tmp, this.vaultPath)
      this.lastFormat = 'aes-256-gcm'
    } catch (err) {
      console.error('[VaultService] Kasa yazilamadi:', err instanceof Error ? err.message : err)
      throw err
    }
  }

  public setKey(providerId: ProviderId, apiKey: string): void {
    this.ensureLoaded()
    const trimmed = (apiKey ?? '').trim()
    if (!trimmed) {
      this.memoryKeys.delete(providerId)
    } else {
      this.memoryKeys.set(providerId, trimmed)
    }
    this.persist()
  }

  public getKey(providerId: ProviderId): string | undefined {
    this.ensureLoaded()
    return this.memoryKeys.get(providerId)
  }

  public hasKey(providerId: ProviderId): boolean {
    this.ensureLoaded()
    const key = this.memoryKeys.get(providerId)
    return !!key && key.trim().length > 0
  }

  /**
   * Anahtarin varligini dogrulamak icin geri donuslu olmayan bir ozet.
   * Gercek anahtar karakterleri HICBIR ZAMAN arayuze gonderilmez; XSS
   * veya yanlislikla bir ekran goruntusu alinsa bile sifre korunur.
   */
  public getKeyFingerprint(providerId: ProviderId): string | undefined {
    this.ensureLoaded()
    const key = this.memoryKeys.get(providerId)
    if (!key) return undefined
    const digest = crypto.createHash('sha256').update(key).digest('hex')
    return digest.slice(0, 6)
  }

  public deleteKey(providerId: ProviderId): boolean {
    this.ensureLoaded()
    const existed = this.memoryKeys.delete(providerId)
    this.persist()
    return existed
  }

  /** Tum anahtarlari kalici olarak yok eder. */
  public wipeAllKeys(): void {
    this.ensureLoaded()
    this.memoryKeys.clear()
    if (!fs.existsSync(this.vaultPath)) return
    const size = fs.statSync(this.vaultPath).size
    try {
      fs.writeFileSync(this.vaultPath, crypto.randomBytes(size))
    } catch {
      /* yoksay */
    }
    try {
      fs.unlinkSync(this.vaultPath)
    } catch {
      /* yoksay */
    }
    this.lastFormat = 'none'
  }

  /**
 * Kasa anahtarlarindan MASKE EDILMEYECEK degerler.
 *
 * Bu bir "gumvenlik acigi degil, guvenlik hatasi" listesi: buradaki
 * degerler zaten GIZLI DEGILDIR ve maskelemek kullaniciya zarar verir.
 *
 * `google_client_id` onceki surumde kasada tutuluyordu ve `redact()`
 * onu `[REDACTED]` yapiyordu. Kullanici Ayarlar'a kimligini yaziyor,
 * ekranda `([REDACTED]...)` goruyor ve kimligi dogrulayamiyordu.
 * Istemci kimligi OAuth URL'inde duz metin olarak tarayiciya gider;
 * gizli DEGILDIR. Artik depoda tutuluyor, bu liste ise ikinci bir
 * emniyet bariidir.
 */

/**
 * DLP: gunluk satirlarina sizabilecek API anahtarlarini ve gizli
 * kaliplari maskeler. Tum konsol ciktilarindan gecmelidir.
 *
 * IKI KATMANLI
 * ------------
 * 1) Kasadaki GERCEK anahtarlar dize olarak maskelenir. Bu, uygulamanin
 *    tanidigi her anahtari yakalar; yeni bir saglayici eklense bile
 *    koruma kendiliginden gecerlidir.
 * 2) Bilinen API anahtar BICIMLERI desen olarak maskelenir. Bu katman
 *    gerekli degildir ama ucuzdur ve su an bir acik kapatir: kullanici
 *    daha once bir anahtari elle girdiyse ya da bir saglayici anahtari
 *    isteginin govdesine yansitmisse (orn. Tavily `tvly-...`), o anahtar
 *    kasada bulunmasa bile maskelenir.
 *
 * (1) yetersiz kalirsa hata mesaji anahtari sizdirir; testlerde
 * `tests/keyRedaction.test.ts` bunu dogrudan dogrular.
 */
  public redact(message: string): string {
    this.ensureLoaded()

    // IKILI YUK (BASE64 / DATA URI) KORUMASI
    // ---------------------------------------
    // PDF/gorsel/ses onizleme verisi IPC donusu sirasinda buradan gecer.
    // Asagidaki desenlerden biri base64 icinde YANLISLIKLA eslesirse
    // ciktiya `[REDACTED]` yazilir; `[` ve `]` base64 alfabesinde YOKTUR,
    // dolayisiyla `atob()` cagirildiginda InvalidCharacterError firlatir.
    // Sonuc: kullanici "PDF Gorunumu Acilamadi" / bozuk resim gorur.
    //
    // Bu, gercek bir hatayi maskeliyordu: buyuk dosyalarda neredeyse
    // HER KEZ oluyordu (1 MB uzeri PDF'de olma olasiligi ~%95).
    //
    // Cozum: base64/data URI bicimindeki bir yuk hicbir zaman yeniden
    // yazilmaz. Bu zaten bir "sirlar" degil, kullaniciya ait dosyadır.
    if (isBinaryPayload(message)) return message

    let result = message
    for (const [key, secret] of this.memoryKeys.entries()) {
      if (NEVER_REDACT_KEYS.has(key)) continue
      if (secret && secret.length > 6) {
        result = result.split(secret).join('[REDACTED]')
      }
    }

    // Uzunluğa duyarli desenler. Yanlis pozitif riski dusuk tutmak icin
    // her biri belirli bir on ek ve minimum uzunluk ister.
    //
    // DIKKAT: bu desenler saf base64 ALT KUMELERIYLE eslesir
    // (`1`, `/`, `-` hepsi base64 alfabesindedir). Yuk zaten yukarida
    // `isBinaryPayload` ile elendi; buradaki desenler yalnizca
    // ORDAN SONRA uygulanir.
    const patterns: RegExp[] = [
      /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic
      /sk-ant-[A-Za-z0-9_-]{16,}/g,
      /AIza[0-9A-Za-z_-]{30,}/g, // Google API / OAuth
      /ya29\.[A-Za-z0-9_-]{20,}/g, // Google OAuth erisim belirteci
      /1\/\/[A-Za-z0-9_-]{20,}/g, // Google OAuth yenileme belirteci
      /gsk_[A-Za-z0-9]{20,}/g, // Groq
      /xai-[A-Za-z0-9]{20,}/g, // xAI
      /tvly-[A-Za-z0-9_-]{16,}/g, // Tavily
      /xox[baprs]-[A-Za-z0-9-]{16,}/g, // Slack
      /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, // SendGrid
      /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
      /glpat-[A-Za-z0-9_-]{16,}/g, // GitLab
      /AKIA[0-9A-Z]{16}/g, // AWS erisim anahtari kimligi
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    ]

    for (const pattern of patterns) {
      result = result.replace(pattern, '[REDACTED]')
    }
    return result
  }

  /** Tanilama icin: gercek anahtar sizdirmadan durum ozeti. */
  public describe(): {
    format: string
    hardwareProtected: boolean
    backend: string
    description: string
    degraded: boolean
    storedKeyCount: number
  } {
    this.ensureLoaded()
    const status = this.keyring.getStatus()
    return {
      format: this.lastFormat,
      hardwareProtected: status.hardwareProtected,
      backend: status.backend,
      description: status.description,
      degraded: status.degraded,
      storedKeyCount: this.memoryKeys.size,
    }
  }
}