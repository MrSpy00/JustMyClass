import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

/**
 * CAS (icerik-adresli onbellek) butunluk testleri.
 *
 * BURADAKI HEDEF, su iki sessiz veri bozulmasini yakalamak:
 *
 * 1. YAZMA Sirasinda surecin cokmesi. Dogrudan `writeFileSync` hedefi
 *    yerinde keser; diskte yarim sifreli dosya kalir ve okuma dogrulamasi
 *    olmadigi icin bu sessizce gecer.
 *
 * 2. AD/ICERIK ESLESMEMESI. `updateLocalFileContent` yeni icerigi
 *    ESKI hash'in adini tasiyan dosyaya yaziyor, sonra yalnizca indeksteki
 *    `sha256` alanini guncelliyordu. Dosya adi ile icerik kalici olarak
 *    ayrisirdi ve dosya adi icerigi anlatmaz hale geliyordu.
 */

const USER_DATA = makeTempUserDataDir()

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve('') },
}))

const { KeyringService } = await import('../electron/services/keyringService')
const { StorageService } = await import('../electron/services/storageService')

type StorageType = InstanceType<typeof StorageService>

function sha(b: Buffer): string {
  return crypto.createHash('sha256').update(b).digest('hex')
}

/** CAS dizinindeki tum dosyalari dondurur (gici dosya denetimi icin). */
function listAllFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(d => (d.isDirectory() ? listAllFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]))
}

describe('StorageService CAS butunlugu', () => {
  let storage: StorageType

  beforeEach(() => {
    storage = new StorageService(new KeyringService())
  })

  afterEach(() => {
    storage.wipeLocalCache()
  })

  describe('saveFileToCas', () => {
    it('dosya adi icerigin SHA-256 ozetidir', () => {
      const content = Buffer.from('print("merhaba")', 'utf8')
      const r = storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', content)
      expect(r.sha256).toBe(sha(content))
      expect(path.basename(r.absolutePath).startsWith(r.sha256)).toBe(true)
    })

    it('ayni icerik iki kez kaydedilince ayni yolu dondurur (tekillestirme)', () => {
      const content = Buffer.from('ayni icerik', 'utf8')
      const a = storage.saveFileToCas('f1', 'c1', 'a.txt', 'text/plain', content)
      const b = storage.saveFileToCas('f2', 'c1', 'a.txt', 'text/plain', content)
      expect(b.absolutePath).toBe(a.absolutePath)
      expect(b.sha256).toBe(a.sha256)
    })

    it('gici dosya birakmaz', () => {
      storage.saveFileToCas('f1', 'c1', 'a.txt', 'text/plain', Buffer.from('x'))
      const files = listAllFiles(path.join(USER_DATA, 'cas'))
      expect(files.length).toBeGreaterThan(0)
      expect(files.some(f => f.endsWith('.tmp'))).toBe(false)
    })
  })

  describe('readCasFile dogrulamasi', () => {
    it('dogru dosyayi cozer', () => {
      const content = Buffer.from('print("ok")', 'utf8')
      const saved = storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', content)
      expect(storage.readCasFile(saved.absolutePath, saved.sha256).toString('utf8')).toBe('print("ok")')
    })

    it('BEKLENEN HASH UYUSMAZSA hata firlatir', () => {
      const saved = storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from('ok'))
      const other = sha(Buffer.from('baska icerik'))
      expect(() => storage.readCasFile(saved.absolutePath, other)).toThrow(/bozulmus/i)
    })

    it('verifyCasFile bozulan dosyayi raporlar', () => {
      const saved = storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from('ok'))
      expect(storage.verifyCasFile(saved.absolutePath, saved.sha256).ok).toBe(true)
      expect(storage.verifyCasFile(saved.absolutePath, sha(Buffer.from('x'))).ok).toBe(false)
    })

    it('CAS disindaki yolu reddeder (yol gecisi korumasi)', () => {
      const outside = path.join(USER_DATA, 'gizli.txt')
      fs.writeFileSync(outside, 'gizli')
      expect(() => storage.readCasFile(outside)).toThrow(/guvenli depolama alani/i)
    })

    it('beklenen ozet verilmeden de dosya adindan turetir', () => {
      const content = Buffer.from('ok', 'utf8')
      const saved = storage.saveFileToCas('f1', 'c1', 'rapor.v2.pdf', 'application/pdf', content)
      expect(storage.verifyCasFile(saved.absolutePath).ok).toBe(true)
    })

    it('bozulan sifreli dosya sessizce gecilmez', () => {
      const saved = storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from('ok'))
      const raw = fs.readFileSync(saved.absolutePath)
      fs.writeFileSync(saved.absolutePath, raw.subarray(0, Math.max(1, raw.length - 5)))
      expect(() => storage.readCasFile(saved.absolutePath, saved.sha256)).toThrow()
    })
  })

  describe('updateLocalFileContent', () => {
    it('guncelledikten sonra dosya adi YENI icerigin ozetidir', () => {
      storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from('print("a")'))
      const before = storage.getCachedFile('f1')!

      storage.updateLocalFileContent('f1', 'print("b")')
      const after = storage.getCachedFile('f1')!

      const expected = sha(Buffer.from('print("b")', 'utf8'))
      expect(after.entry.sha256).toBe(expected)
      expect(path.basename(after.absolutePath).startsWith(expected)).toBe(true)
      expect(after.absolutePath).not.toBe(before.absolutePath)
    })

    it('guncellenmis dosya yine dogrulanabilir okunur', () => {
      storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from('print("a")'))
      storage.updateLocalFileContent('f1', 'print("guncel")')
      const c = storage.getCachedFile('f1')!
      expect(storage.readCasFile(c.absolutePath, c.entry.sha256).toString('utf8')).toBe('print("guncel")')
    })

    it('eski dosya indeks guncellendikten SONRA silinir', () => {
      const saved = storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from('print("a")'))
      storage.updateLocalFileContent('f1', 'print("b")')
      expect(fs.existsSync(saved.absolutePath)).toBe(false)
    })

    it('paylasilan eski dosyI SILINMEZ', () => {
      const saved = storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from('print("a")'))
      // Ayni icerik iki girdiye islenir -> ayni yol paylasilir.
      storage.saveFileToCas('f2', 'c1', 'kod.py', 'text/x-python', Buffer.from('print("a")'))
      storage.updateLocalFileContent('f1', 'print("b")')
      // f2 hala eski icerige isaret ediyor; silinirse o kayit bozulur.
      expect(fs.existsSync(saved.absolutePath)).toBe(true)
      expect(storage.getCachedFile('f2')!.entry.sha256).toBe(sha(Buffer.from('print("a")')))
    })

    it('icerik degismisse syncState LOCAL_MODIFIED olur', () => {
      storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from('a'))
      storage.updateLocalFileContent('f1', 'b')
      expect(storage.getCachedFile('f1')!.entry.syncState).toBe('LOCAL_MODIFIED')
    })

    it('ayni icerik verilirse yol DEGISTIRILMEZ', () => {
      const content = 'print("ayni")'
      const saved = storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from(content))
      storage.updateLocalFileContent('f1', content)
      const after = storage.getCachedFile('f1')!
      expect(after.absolutePath).toBe(saved.absolutePath)
      expect(after.entry.sha256).toBe(saved.sha256)
    })

    it('onbellekte olmayan dosya icin hata verir', () => {
      expect(() => storage.updateLocalFileContent('yok', 'x')).toThrow(/bulunamadi/i)
    })

    it('Uint8Array icerik de kabul edilir', () => {
      storage.saveFileToCas('f1', 'c1', 'k.bin', 'application/octet-stream', Buffer.from('a'))
      const r = storage.updateLocalFileContent('f1', new Uint8Array([1, 2, 3, 4]))
      expect(r.newHash).toBe(sha(Buffer.from([1, 2, 3, 4])))
    })
  })

  describe('arasi surec dayanikliligi', () => {
    it('guncellemeden sonra TUM onbellek dosyalari dogrulanabilir', () => {
      for (let i = 0; i < 5; i += 1) {
        storage.saveFileToCas(`f${i}`, 'c1', `dosya${i}.txt`, 'text/plain', Buffer.from(`icerik ${i}`))
      }
      storage.updateLocalFileContent('f2', 'degistirilmis icerik')
      for (let i = 0; i < 5; i += 1) {
        const c = storage.getCachedFile(`f${i}`)
        expect(c, `f${i} bulunamadi`).toBeTruthy()
        expect(storage.verifyCasFile(c!.absolutePath, c!.entry.sha256).ok, `f${i} bozuk`).toBe(true)
      }
    })

    it('yeniden yukleme sonrasi butunluk korunur', () => {
      storage.saveFileToCas('f1', 'c1', 'kod.py', 'text/x-python', Buffer.from('a'))
      storage.updateLocalFileContent('f1', 'b')

      // Ikinci bir ornek, ayni veri dizininden yuklenir: indeks diskten okunur
      // ve CAS dosyalari yerinde durur (uygulama yeniden baslatma benzetimi).
      const reopened = new StorageService(new KeyringService())
      const c = reopened.getCachedFile('f1')
      expect(c, 'yeniden yuklemede kayit bulunamadi').toBeTruthy()
      expect(c!.entry.sha256).toBe(sha(Buffer.from('b')))
      expect(reopened.verifyCasFile(c!.absolutePath, c!.entry.sha256).ok).toBe(true)
      expect(reopened.readCasFile(c!.absolutePath, c!.entry.sha256).toString('utf8')).toBe('b')
    })
  })
})