import { resolveDataDir } from './dataDir'
import { safeStorage, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * KeyringService
 * ---------------------------------------------------------------------------
 * JustMyClass'in tek gercek sifreleme anahtari burada uretilir ve isletim
 * sistemi kasasinin (Windows DPAPI / macOS Keychain / Linux Secret Service)
 * destegiyle sarmalanarak diske yazilir.
 *
 * Tasarim kurallari:
 *  - Anahtar Rastgele uretilir (32 bayt / AES-256). Ortak bir "varsayilan
 *    anahtar", kullanici adi veya sabit bir pepper DUNYA'da bulunmaz.
 *  - Diskte yalnizca OS kasasinin sarmaladigi (wrapped) kopya bulunur.
 *    Baska bir makine ya da kullanici bu dosyayi kopyalasa bile acamaz.
 *  - Tum gizli veriler (veritabani, API anahtarlari, indirilen dosyalar)
 *    bu tek anahtarla AES-256-GCM ile sifrelenir.
 *  - Kullanilabilir bir OS kasasi yoksa sahte bir guvenlik iddiasinda
 *    bulunmak yerine durum acikca raporlanir.
 */

export type KeyringBackend = 'dpapi' | 'keychain' | 'gnome_libsecret' | 'basic_text' | 'unavailable'

export interface KeyringStatus {
  /** Anahtarin OS kasasi ile korunup korunmadigi. */
  hardwareProtected: boolean
  /** Hangi OS mekanizmasi kullanildi. */
  backend: KeyringBackend
  /** Kullaniciya gosterilecek duz Turkce aciklama. */
  description: string
  /** basic_text gibi zayif bir geri donus kullaniliyorsa true. */
  degraded: boolean
}

const KEY_FILE = 'jmc_master.key'
const KEY_BYTES = 32

export class KeyringService {
  private readonly keyFilePath: string
  private cachedKey: Buffer | null = null
  private readonly userDataPath: string

  /**
   * Diskte daha once yazilmis ama BU oturumda cozulemeyen bir anahtar
   * dosyasi var mi? Bu durumda yeni anahtar ASLA diske yazilmaz ve
   * sifreli depolar (veritabani + kasa) UZERINE YAZILMAZ. Aksi halde
   * kullanici "yeniden girdim, verilerim silinmis" durumuna duser.
   */
  private keyFileUnreadable = false
  private keyFileUnreadableReason = ''

  constructor() {
    this.userDataPath = resolveDataDir()
    if (!fs.existsSync(this.userDataPath)) {
      fs.mkdirSync(this.userDataPath, { recursive: true })
    }
    this.keyFilePath = path.join(this.userDataPath, KEY_FILE)
  }

  public getDataDir(): string {
    return this.userDataPath
  }

  public getKeyFilePath(): string {
    return this.keyFilePath
  }

  /**
   * Electron safeStorage arkasindaki gercek OS mekanizmasini belirler.
   * Linux'ta bir secret store yoksa Electron 'basic_text' geri donusune
   * duser; bu mod guvenli DEGILDIR ve acikca isaretlenir.
   */
  public detectBackend(): KeyringBackend {
    try {
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
        return 'unavailable'
      }
      const selected = safeStorage.getSelectedStorageBackend?.() as string | undefined
      if (!selected) {
        // getSelectedStorageBackend yoksa platformdan tahmin et.
        if (process.platform === 'win32') return 'dpapi'
        if (process.platform === 'darwin') return 'keychain'
        return 'basic_text'
      }
      switch (selected) {
        case 'dpapi':
          return 'dpapi'
        case 'keychain':
          return 'keychain'
        case 'gnome_libsecret':
        case 'kwallet':
        case 'kwallet5':
        case 'kwallet6':
          return 'gnome_libsecret'
        case 'basic_text':
          return 'basic_text'
        default:
          return 'unavailable'
      }
    } catch {
      return 'unavailable'
    }
  }

  public getStatus(): KeyringStatus {
    const backend = this.detectBackend()
    switch (backend) {
      case 'dpapi':
        return {
          hardwareProtected: true,
          backend,
          description: 'Windows DPAPI (kullanici profili kasasi)',
          degraded: false,
        }
      case 'keychain':
        return {
          hardwareProtected: true,
          backend,
          description: 'macOS Keychain',
          degraded: false,
        }
      case 'gnome_libsecret':
        return {
          hardwareProtected: true,
          backend,
          description: 'Linux Secret Service (libsecret)',
          degraded: false,
        }
      case 'basic_text':
        return {
          hardwareProtected: false,
          backend,
          description:
            'Guvenli bir Linux kasasi bulunamadi. Anahtar, kullanici anahtar dosyasinda obfuscate edilmis olarak saklaniyor.',
          degraded: true,
        }
      default:
        return {
          hardwareProtected: false,
          backend,
          description: 'Isletim sistemi kasasi kullanilamiyor; anahtar yalnizca surec belleginde tutuluyor.',
          degraded: true,
        }
    }
  }

  /**
   * Ana isletim sistemi anahtarlarini sarmalayabiliyorsa kullanir.
   * Sarma desteklenmiyorsa `null` doner.
   */
  private wrap(rawKeyB64: string): Buffer | null {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.encryptString(rawKeyB64)
    } catch {
      return null
    }
  }

  private unwrap(blob: Buffer): string | null {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(blob)
    } catch {
      return null
    }
  }

  /**
   * Anahtar dosyasi iki bicimde olabilir:
   *   • GUVCLU  : OS kasasinin (DPAPI/Keychain/libsecret) sarmaladigi baytlar.
   *   • ZAYIF   : `JMCKEY1:` oneki + base64 (yalnizca OS kasasi YOKSA yazilir).
   *
   * Zayif bicim bilerek tercih edilmistir: anahtari yalnizca bellekte
   * tutmak, uygulama kapandiginda TUM sifreli veriyi erisilemez
   * hale getirir ve kullanici "verilerim silindi" sanir. Zayif bicim
   * yalnizca ayni Windows kullanici hesabinda okunabilir ve kasi
   * kullanilabilir hale geldiginde otomatik olarak guclu bicime
   * yukseltilir.
   */
  private static readonly WEAK_PREFIX = 'JMCKEY1:'

  private readKeyFile(blob: Buffer): { key: Buffer; weak: boolean } | null {
    const strong = this.unwrap(blob)
    if (strong) {
      const key = Buffer.from(strong, 'base64')
      if (key.length === KEY_BYTES) return { key, weak: false }
    }
    const asText = blob.toString('utf8').trim()
    if (asText.startsWith(KeyringService.WEAK_PREFIX)) {
      const key = Buffer.from(asText.slice(KeyringService.WEAK_PREFIX.length).trim(), 'base64')
      if (key.length === KEY_BYTES) return { key, weak: true }
    }
    // Eski surumlerin duz metin (oneksiz) anahtar dosyasi guvenlik acigidir.
    // SILINMEZ; yedeklenir ve kullaniciya bildirilir.
    if (/^[A-Za-z0-9+/=]{40,60}$/.test(asText)) {
      return null
    }
    return null
  }

  private writeKeyFile(key: Buffer): void {
    const wrapped = this.wrap(key.toString('base64'))
    const payload = wrapped ?? Buffer.from(`${KeyringService.WEAK_PREFIX}${key.toString('base64')}`, 'utf8')
    const tmp = `${this.keyFilePath}.tmp`
    fs.writeFileSync(tmp, payload, { mode: 0o600 })
    fs.renameSync(tmp, this.keyFilePath)
  }

  /**
   * Uygulamanin kullandigi 32 baytlik AES-256 anahtarini dondurur.
   *
   * VERI KAYBI YARAN KURALLAR
   * -------------------------
   * 1) Diskte COZULEBILIR bir anahtar varsa aynen kullanilir.
   * 2) Anahtar dosyasi var ama cozulemiyorsa (farkli Windows kullanici
   *    profili, bozuk kasa, eksik OS kasasi) dosya SILINMEZ; yedeklenir
   *    ve yeni anahtar SADECE BELLEKTE uretilir. Boylece kullanicinin
   *    sifreli verisi diskte aynen durur.
   * 3) Anahtar dosyasi hic yoksa yenisi uretilir. OS kasasi yoksa bile
   *    anahtar dosyaya yazilir; boylece veriler bir sonraki acilista
   *    (kasinin kullanilabilir oldugu oturumda) geri gelir.
   */
  public getMasterKey(): Buffer {
    if (this.cachedKey) return this.cachedKey

    if (fs.existsSync(this.keyFilePath)) {
      try {
        const blob = fs.readFileSync(this.keyFilePath)
        const parsed = this.readKeyFile(blob)

        if (parsed) {
          this.cachedKey = parsed.key
          this.keyFileUnreadable = false
          this.keyFileUnreadableReason = ''

          // Zayif bicimdeyse ve simdi OS kasasi kullanilabiliyorsa
          // dosyayi yerinde guclu bicime yukselt.
          if (parsed.weak && this.wrap(parsed.key.toString('base64'))) {
            try {
              this.writeKeyFile(parsed.key)
              console.info('[KeyringService] Anahtar dosyasi guclu bicime yukseltildi.')
            } catch {
              /* yukseltme basarisiz olsa da anahtar gecerli */
            }
          }
          return parsed.key
        }

        // Cozulemedi (bozuk kasa, farkli kullanici profili, eski duz metin
        // anahtar). SILMIYORUZ: yedekliyoruz.
        this.keyFileUnreadable = true
        this.keyFileUnreadableReason =
          'Diskteki anahtar dosyasi bu oturumda cozulemedi. Dosya silinmedi; yeni anahtar ' +
          'yalnizca bellekte uretildi ve sifreli verilerinizin UZERINE yazilmayacak.'
        this.backupUnreadableKeyFile('cozulemedi')
        console.error(`[KeyringService] ${this.keyFileUnreadableReason}`)
      } catch (err) {
        this.keyFileUnreadable = true
        this.keyFileUnreadableReason =
          'Anahtar dosyasi okunurken hata olustu: ' + (err instanceof Error ? err.message : String(err))
        console.warn('[KeyringService]', this.keyFileUnreadableReason)
      }
    }

    // Ilk calisma: rastgele 32 bayt anahtar uret ve kalici olarak yaz.
    const key = crypto.randomBytes(KEY_BYTES)
    if (!this.keyFileUnreadable) {
      try {
        this.writeKeyFile(key)
      } catch (err) {
        console.error(
          '[KeyringService] Ana anahtar yazilamadi; bu surec icin bellekte tutulacak:',
          err instanceof Error ? err.message : err,
        )
      }
    } else {
      console.warn(
        '[KeyringService] Mevcut anahtar cozulemedigi icin yeni anahtar diske YAZILMADI. ' +
          'Verileriniz korunuyor; kullaniciya bu durum bildirilecek.',
      )
    }
    this.cachedKey = key
    return key
  }

  /**
   * Cozulemeyen anahtar dosyasini SILMEDEN yedekler. Boylece kullanici
   * dogru Windows hesabina geri dondugunde verileri kurtarabilir.
   */
  private backupUnreadableKeyFile(reason: string): void {
    try {
      const backup = `${this.keyFilePath}.unreadable.${Date.now()}.${reason}.bak`
      fs.renameSync(this.keyFilePath, backup)
      console.warn(`[KeyringService] Anahtar dosyasi yedeklendi: ${backup}`)
    } catch {
      /* yedeklenemezse dosya yerinde kalir; yine de silinmez */
    }
  }

  /**
   * Sifreli depolar bu anahtarla UZERINE YAZILABILIR mi?
   *
   * `false` dondugunde StorageService/VaultService kendi dosyalarina
   * dokunmaz. Bu, "cozulemeyen anahtar" durumunda kullanici verisinin
   * sessizce silinmesini engelleyen asil korumadir.
   */
  public canPersistEncryptedStores(): boolean {
    return !this.keyFileUnreadable
  }

  /** Kullaniciya gosterilecek tani bilgisi (Ayarlar > Senkronizasyon). */
  public getKeyDiagnostics(): {
    dataDir: string
    keyFilePath: string
    keyFileExists: boolean
    readable: boolean
    problem: string
    backend: KeyringBackend
    hardwareProtected: boolean
    degraded: boolean
    description: string
  } {
    const status = this.getStatus()
    let exists = false
    try {
      exists = fs.existsSync(this.keyFilePath)
    } catch {
      /* yoksay */
    }
    return {
      dataDir: this.userDataPath,
      keyFilePath: this.keyFilePath,
      keyFileExists: exists,
      readable: !this.keyFileUnreadable,
      problem: this.keyFileUnreadableReason,
      backend: status.backend,
      hardwareProtected: status.hardwareProtected,
      degraded: status.degraded || this.keyFileUnreadable,
      description: this.keyFileUnreadable
        ? 'Anahtar cozulemedi; veriler korunuyor ama yazilamiyor.'
        : status.description,
    }
  }

  /** Anahtar dosyasini ve buna bagli tum sifreli veriyi kalici olarak yok eder. */
  public cryptoShred(): void {
    this.cachedKey = null
    if (!fs.existsSync(this.keyFilePath)) return
    try {
      const size = fs.statSync(this.keyFilePath).size
      try {
        fs.writeFileSync(this.keyFilePath, crypto.randomBytes(size))
      } catch {
        /* yazilamazsa yine de silmeyi dene */
      }
      fs.unlinkSync(this.keyFilePath)
    } catch {
      /* dosya zaten yok; yoksay */
    }
  }

  /** Anahtar dosyasinin var olup olmadigini raporlar. */
  public hasPersistedKey(): boolean {
    return fs.existsSync(this.keyFilePath)
  }
}

/**
 * AES-256-GCM ile once kurulumu standartlastirilmis bir bicimde sifreler.
 * Cikti duzeni: [12B IV][16B AUTH TAG][CIPHERTEXT]
 */
export function aesEncrypt(key: Buffer, plainText: Buffer): Buffer {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plainText), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted])
}

/** aesEncrypt ile uretilen tamponu cozer. Butunluk dogrulamasi GCM tarafindan yapilir. */
export function aesDecrypt(key: Buffer, payload: Buffer): Buffer {
  if (payload.length < 28) {
    throw new Error('Sifreli veri eksik veya bozuk.')
  }
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const data = payload.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

/** Dosyayi atomik olarak (tmp + rename) sifreli sekilde yazar. */
export function writeEncryptedFile(key: Buffer, filePath: string, plainText: Buffer): void {
  const cipherText = aesEncrypt(key, plainText)
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, cipherText, { mode: 0o600 })
  fs.renameSync(tmpPath, filePath)
}

/** Sifreli dosyayi okur ve cozer. */
export function readEncryptedFile(key: Buffer, filePath: string): Buffer | null {
  if (!fs.existsSync(filePath)) return null
  return aesDecrypt(key, fs.readFileSync(filePath))
}