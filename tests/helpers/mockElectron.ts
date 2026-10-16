import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * Testler icin gecici bir Electron `app.getPath('userData')` uretir.
 * Her cagri farkli bir dizin doner; boylece testler birbirini kirletmez.
 */
let counter = 0

export function makeTempUserDataDir(): string {
  counter += 1
  const dir = path.join(
    os.tmpdir(),
    `jmc-test-${process.pid}-${counter}-${crypto.randomBytes(4).toString('hex')}`,
  )
  return dir
}

/**
 * `safeStorage` icin test sahteci.
 *
 * `hardwareBacked` degeri secilerek hem "gercek" hem "zayif" yol
 * (basic_text geri donusu) test edilebilir.
 */
export function makeSafeStorageMock(hardwareBacked: boolean) {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => (hardwareBacked ? 'dpapi' : 'basic_text'),
    // Gercek Electron gibi davranir: girdi -> cikti donusumu degismez,
    // her cagri ayni girdi icin ayni sonucu uretir.
    encryptString: (plain: string) => Buffer.from(`wrapped:${plain}`, 'utf8'),
    decryptString: (blob: Buffer) => blob.toString('utf8').replace(/^wrapped:/, ''),
  }
}