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

  constructor() {
    this.userDataPath = app?.getPath('userData') || path.join(process.cwd(), '.jmc_data')
    if (!fs.existsSync(this.userDataPath)) {
      fs.mkdirSync(this.userDataPath, { recursive: true })
    }
    this.keyFilePath = path.join(this.userDataPath, KEY_FILE)
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
   * Sarma desteklenmiyorsa anahtari bu surec belleginde uretir ve dosyaya
   * yazmaz (diskte duz metin anahtar birakilmaz).
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
   * Uygulamanin kullandigi 32 baytlik AES-256 anahtarini dondurur.
   * Ilk cagirildiginda rastgele uretilir ve OS kasasinin sarmaladigi
   * bicimde diske yazilir.
   */
  public getMasterKey(): Buffer {
    if (this.cachedKey) return this.cachedKey

    if (fs.existsSync(this.keyFilePath)) {
      try {
        const blob = fs.readFileSync(this.keyFilePath)
        const rawB64 = this.unwrap(blob)
        if (rawB64) {
          const key = Buffer.from(rawB64, 'base64')
          if (key.length === KEY_BYTES) {
            this.cachedKey = key
            return key
          }
        }

        // Eger unwrap basarisiz olduysa dosya duz metin (sarmalanmamis) bir
        // anahtar olabilir. Bu, guvenlik acigi olarak ele alinir: dosya
        // once ezilip silinir, ardindan yeni bir anahtar uretilir.
        const asPlain = blob.toString('utf8').trim()
        if (/^[A-Za-z0-9+/=]{40,60}$/.test(asPlain)) {
          console.error(
            '[KeyringService] Duz metin anahtar dosyasi tespit edildi. Bu bir guvenlik acigidir; ' +
              'anahtar yeniden uretiliyor ve etkilenen sifreli veri okunamaz hale gelecek. ' +
              'API anahtarlarinizi ve Google oturumunuzu yeniden girmeniz gerekecek.',
          )
          this.shredFile(this.keyFilePath)
        }

        // Anahtar bu isletim sisteminde veya kullanici oturumunda cozulemedi.
        // safeStorage kullanilabilir durumdaysa dosyanin bozuk oldugundan
        // emin olabiliriz; kullanilabilir degilse (app.whenReady oncesi
        // erisim gibi) dosyaya dokunmak onu bozardi.
        const encryptionAvailable = !!(safeStorage && safeStorage.isEncryptionAvailable())
        if (encryptionAvailable) {
          console.warn(
            '[KeyringService] Ana kasa dosyasi cozulemedi. Dosya silinip yeni anahtar uretiliyor.',
          )
          this.shredFile(this.keyFilePath)
        } else {
          console.warn(
            '[KeyringService] isletim sistemi kasasi henuz kullanilabilir degil; anahtar dosyasina dokunulmadi.',
          )
        }
      } catch (err) {
        console.warn('[KeyringService] Anahtar dosyası okunurken hata oluştu:', err)
      }
    }

    // Ilk calisma veya kurtarma: rastgele 32 bayt anahtar uret.
    const key = crypto.randomBytes(KEY_BYTES)
    const wrapped = this.wrap(key.toString('base64'))

    if (wrapped) {
      try {
        fs.writeFileSync(this.keyFilePath, wrapped, { mode: 0o600 })
      } catch (err) {
        console.error(
          '[KeyringService] Ana anahtar yazilamadi; bu surec icin bellekte tutulacak:',
          err instanceof Error ? err.message : err,
        )
      }
    } else {
      // OS kasasi yok. Anahtar DUZ METIN olarak diske YAZILMAZ.
      // Onceki surum bu durumda `key.toString('base64')` yaziyordu;
      // sinifin kendi dokumantasyonu ("diskte duz metin anahtar
      // birakilmaz") bunun bir hata oldugunu soyluyordu ve `mode: 0o600`
      // Windows'ta ACL anlami tasimadigi icin dosya baska bir
      // kullaniciya acik kaliyordu.
      console.warn(
        '[KeyringService] Isletim sistemi kasasi kullanilamiyor. Anahtar yalnizca surec belleginde tutulacak; ' +
          'uygulama kapatilinca sifreli veriler okunamaz hale gelecek.',
      )
    }
    this.cachedKey = key
    return key
  }

  /** Bir anahtar dosyasini once rastgele baytlarla ezerek, sonra siler. */
  private shredFile(filePath: string): void {
    try {
      const size = fs.statSync(filePath).size
      if (size > 0) fs.writeFileSync(filePath, crypto.randomBytes(size))
      fs.unlinkSync(filePath)
    } catch {
      try {
        fs.unlinkSync(filePath)
      } catch {
        /* zaten yok */
      }
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