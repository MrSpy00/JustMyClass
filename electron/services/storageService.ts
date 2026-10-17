import { resolveDataDir } from './dataDir'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  Account,
  Course,
  CourseWork,
  Rubric,
  Announcement,
  CourseMaterial,
  CourseParticipant,
  StudentSubmission,
  Topic,
  SyncStatus,
} from '../../types/jmc'
import { KeyringService, aesEncrypt, aesDecrypt } from './keyringService'

export interface CachedFileEntry {
  fileId: string
  courseId: string
  title: string
  mimeType: string
  sizeBytes: number
  /** Duz (sifrelenmemis) icerigin SHA-256 ozeti; bütünlük dogrulamasi icin. */
  sha256: string
  /** CAS dizinine gore goreli yol. */
  casRelativePath: string
  localModifiedAt: string
  syncState: 'DOWNLOADED' | 'LOCAL_MODIFIED' | 'ACCESS_DENIED'
  driveFileId?: string
}

/** Ogrencinin yerel calisma taslagi. Classroom'a gonderilmeden once cihazda kalir. */
export interface DraftEntry {
  courseId: string
  courseWorkId: string
  fileName: string
  content: string
  updatedAt: string
}

const DB_FILE = 'classroom.store.v2'

/**
 * Atomik dosya yazimi: gecici dosyaya yaz, sonra `rename` ile hedefe tası.
 *
 * NEDEN ATOMIK
 * ------------
 * Dogrudan `writeFileSync` hedef dosyayi YERINDE keser: yazma sirasinda
 * surec cokurse (guc kesintisi, kullaniciyi kapatma, cokmeli guncelleme)
 * diskte YARIM BIR DOSYA kalir. Ana depo daha once tmp+rename kullaniyordu;
 * ancak CAS dosyalari dogrudan yaziliyordu, yani indirilen/guncellenen
 * dosyalar bozulmaya acikti.
 *
 * `rename` ayni dosya sistemi icinde atomiktir: ya hedefe tamamen
 * gecer ya da hic olmaz. Okuyucu hicbir zaman yarim dosya gormez.
 *
 * AYRICA: hedef zaten ayni icerigi tasiyorsa yazma yapilmaz. Icerik
 * adresli depoda (CAS) ayni icerik defalarca kaydedilir; gereksiz
 * yazma hem yavaftir hem de dosya zamanini degistirir.
 */
function atomicWriteFileSync(target: string, data: Buffer): void {
  const dir = path.dirname(target)
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`)
  try {
    fs.writeFileSync(tmp, data, { mode: 0o600 })
    // Ayni icerik zaten diskteyse dokunma.
    if (fs.existsSync(target)) {
      try {
        const current = fs.readFileSync(target)
        if (current.length === data.length && current.equals(data)) {
          safeUnlinkSync(tmp)
          return
        }
      } catch {
        /* okunamadiysa yeniden yazmaya devam et */
      }
    }
    fs.renameSync(tmp, target)
  } catch (err) {
    safeUnlinkSync(tmp)
    throw err
  }
}

/** Gecici dosya temizligi; sessizce yoksayilir (asıl hatayi gizlemesin). */
function safeUnlinkSync(file: string): void {
  try {
    fs.unlinkSync(file)
  } catch {
    /* zaten yok / kilitli */
  }
}

/** Duz icerigin SHA-256 ozeti. */
function sha256Hex(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/** SHA-256 ozetinin gercek hex bicimi. */
const SHA256_HEX = /^[0-9a-f]{64}$/i

/**
 * CAS dosya adindan beklenen ozeti cikarir.
 *
 * Ad duzeni: `<sha256>.<sanitize edilmis baslik>`. Baslik icinde nokta
 * olabilir (`rapor.v2.pdf`), bu yuzden ayirici ILK noktadir.
 *
 * Eski duzen (`<sha256>_<baslik>`) ve basliksiz dosyalar da tolere edilir;
 * eski kayitlar okunmaya devam eder.
 */
function sha256FromCasFileName(filePath: string): string | null {
  const base = path.basename(filePath)
  const dot = base.indexOf('.')
  const underscore = base.indexOf('_')
  let candidate = ''
  if (dot > 0 && dot < underscore) candidate = base.slice(0, dot)
  else if (underscore > 0) candidate = base.slice(0, underscore)
  else if (dot > 0) candidate = base.slice(0, dot)
  return SHA256_HEX.test(candidate) ? candidate.toLowerCase() : null
}
const LEGACY_DB_FILE = 'jmc_vault_database.bin'
const LEGACY_JSON_FILE = 'jmc_local_store.json'

export class StorageService {
  private readonly dataDir: string
  private readonly casDir: string
  private readonly dbPath: string
  private readonly keyring: KeyringService
  private masterKey!: Buffer
  private keyReady = false

  /** Gercek senkronizasyon durumu. Onceki surumde sabit "false" donuyordu. */
  private syncState: {
    isSyncing: boolean
    progress?: { label: string; done: number; total: number }
    errors: string[]
  } = { isSyncing: false, errors: [] }

  private db = {
    account: null as Account | null,
    courses: {} as Record<string, Course>,
    topics: {} as Record<string, Topic[]>,
    courseWork: {} as Record<string, Record<string, CourseWork>>,
    rubrics: {} as Record<string, Rubric>,
    announcements: {} as Record<string, Announcement[]>,
    materials: {} as Record<string, CourseMaterial[]>,
    participants: {} as Record<string, CourseParticipant[]>,
    submissions: {} as Record<string, Record<string, StudentSubmission>>,
    cachedFiles: {} as Record<string, CachedFileEntry>,
    /** Ogrencilerin yerel calisma taslaklari (anahtar: "courseId:courseWorkId"). */
    drafts: {} as Record<string, DraftEntry>,
    lastSyncedAt: undefined as string | undefined,
    /**
     * Kullanici ayarlari. Ayni AES-256-GCM sifreli dosyanin icinde saklanir,
     * boylece ayarlar da anahtarsiz okunamaz.
     */
    settings: {
      autoSyncMinutes: 5,
    } as Record<string, unknown>,
  }

  constructor(keyring: KeyringService) {
    this.keyring = keyring
    this.dataDir = resolveDataDir()
    this.casDir = path.join(this.dataDir, 'cas')
    this.dbPath = path.join(this.dataDir, DB_FILE)

    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.mkdirSync(this.casDir, { recursive: true })
  }

  private isLoaded = false

  /**
   * Cozulemeyen depo dosyasi diskte duruyor ve UZERINE YAZILAMAZ.
   * Bu bayrak true iken `persist()` sessizce vazgecir; boylece kullanici
   * verisi sessizce yok olmaz.
   */
  private storeUnreadable = false
  private storeUnreadableReason = ''

  public ensureLoaded(): void {
    if (this.isLoaded) return
    this.isLoaded = true
    this.load()
  }

  private ensureReady(): void {
    if (!this.isLoaded) {
      this.ensureLoaded()
    }
  }

  /**
   * Ana anahtari yavasca edinir. Uygulama acilisi bloklanmasin diye
   * constructor bunu cagrirmaz; ilk gercek erisimde tetiklenir.
   */
  private ensureKey(): Buffer {
    if (!this.keyReady) {
      this.masterKey = this.keyring.getMasterKey()
      this.keyReady = true
    }
    return this.masterKey
  }

  private load(): void {
    // 1) Guncel bicim: AES-256-GCM + OS kasasinin sarmaladigi ana kasa
    if (fs.existsSync(this.dbPath)) {
      try {
        const plain = aesDecrypt(this.ensureKey(), fs.readFileSync(this.dbPath)).toString('utf8')
        const parsed = JSON.parse(plain)
        this.db = { ...this.db, ...parsed }
        return
      } catch (err) {
        console.error(
          '[StorageService] Sifreli yerel depo acilamadi:',
          err instanceof Error ? err.message : err,
        )
        // VERI KAYBI YARAN YER: Onceki surum burada cozulemeyen depoyu
        // yedekleyip `this.persist()` ile UZERINE BOS BIR DEPO yaziyordu.
        // Anahtar (yanlis Windows hesabi, bozuk kasa vb.) duzelttiginde
        // kullanici bos bir depoyla karsi kasiyordu ve tum verileri
        // "kaybolmus" gorunuyordu.
        //
        // Artik: yedek alinir, depo UZERINE YAZILMAZ ve kullaniciya
        // acik bir hata bildirilir. Veri diskte oldugu gibi durur.
        this.storeUnreadable = true
        this.storeUnreadableReason =
          'Sifreli yerel depo acilamadi (' +
          (err instanceof Error ? err.message : String(err)) +
          '). Verileriniz silinmedi; dosya korunuyor ve uzerine yazilmadi.'
        try {
          const corruptedPath = `${this.dbPath}.unreadable.${Date.now()}`
          fs.copyFileSync(this.dbPath, corruptedPath)
          console.warn(`[StorageService] Depo yedegi alindi: ${corruptedPath}`)
        } catch {
          /* yoksay */
        }
        return
      }
    }

    // 2) Eski surumun sifreli dosyasi (reproduksiyonu mumkun anahtarla yazilmis).
    //    Okunmaz; kullaniciya sifirli veri kaybi bildirilir.
    const legacy = path.join(this.dataDir, LEGACY_DB_FILE)
    if (fs.existsSync(legacy)) {
      console.warn(
        '[StorageService] Eski sifreleme biçimine ait depo bulundu ve güvenlik nedeniyle okunmadı. Lütfen Google hesabınızla yeniden bağlanıp verileri yeniden çekin.',
      )
    }

    // 3) En eski surum: duz metin JSON. Icerigi yukleyip sifreli bicime tasi.
    const legacyJson = path.join(this.dataDir, LEGACY_JSON_FILE)
    if (fs.existsSync(legacyJson)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(legacyJson, 'utf8'))
        this.db = { ...this.db, ...parsed }
        this.persist()
        fs.unlinkSync(legacyJson)
      } catch (err) {
        console.error('[StorageService] Eski depo aktarilamadi:', err)
      }
    }
  }

  public persist(): void {
    this.ensureReady()
    // Anahtar cozulemediyse veya depo cozulemediyse UZERINE YAZMA.
    // Yazmak, kullanicinin kurtarilabilir verisini geri donusu olmayan
    // bir bos dosyayla degistirmek demektir.
    if (!this.keyring.canPersistEncryptedStores()) {
      this.storeUnreadable = true
      this.storeUnreadableReason =
        'Sifreleme anahtari cozulemedigi icin verilerinizin uzerine yazilmadi. ' +
        'Eski Windows hesabinizla tekrar giris yaparsaniz veriler geri gelir.'
      return
    }
    if (this.storeUnreadable) {
      return
    }
    try {
      const plain = Buffer.from(JSON.stringify(this.db), 'utf8')
      const cipher = aesEncrypt(this.ensureKey(), plain)
      atomicWriteFileSync(this.dbPath, cipher)
    } catch (err) {
      console.error('[StorageService] Sifreli depo yazilamadi:', err instanceof Error ? err.message : err)
      throw err
    }
  }

  /** Depo/anahtar okunamaz durumda mi? Kullaniciya acikca bildirilir. */
  public getStoreHealth(): { readable: boolean; writable: boolean; problem: string } {
    this.ensureReady()
    return {
      readable: !this.storeUnreadable,
      writable: !this.storeUnreadable && this.keyring.canPersistEncryptedStores(),
      problem: this.storeUnreadableReason || (this.keyring.canPersistEncryptedStores() ? '' : this.keyring.getKeyDiagnostics().problem),
    }
  }

  /** Gercek sifreleme durumu - arayuzdeki guvenlik rozetleri bunu okur. */
  public getStorageSecurityInfo(): {
    isEncrypted: boolean
    algorithm: string
    hardwareProtected: boolean
    backend: string
    description: string
    degraded: boolean
    storePath: string
  } {
    this.ensureReady()
    const status = this.keyring.getStatus()
    return {
      isEncrypted: true,
      algorithm: 'AES-256-GCM',
      hardwareProtected: status.hardwareProtected,
      backend: status.backend,
      description: status.description,
      degraded: status.degraded,
      storePath: this.dbPath,
    }
  }

  // ---- Yerel calisma taslaklari -----------------------------------------
  /** Odevin yerel taslagini okur; yoksa `null`. */
  public getDraft(courseId: string, courseWorkId: string): DraftEntry | null {
    this.ensureReady()
    return this.db.drafts[`${courseId}:${courseWorkId}`] ?? null
  }

  /** Taslagi sifreli depoya yazar. `fileName` teslimde Drive dosya adi olur. */
  public saveDraft(entry: Omit<DraftEntry, 'updatedAt'>): DraftEntry {
    this.ensureReady()
    const stored: DraftEntry = { ...entry, updatedAt: new Date().toISOString() }
    this.db.drafts[`${entry.courseId}:${entry.courseWorkId}`] = stored
    this.persist()
    return stored
  }

  public deleteDraft(courseId: string, courseWorkId: string): void {
    this.ensureReady()
    delete this.db.drafts[`${courseId}:${courseWorkId}`]
    this.persist()
  }

  // ---- Ayarlar (sifreli, kalici) ---------------------------------------
  /**
   * Bir ayar degerini okur. Kayit yoksa `fallback` doner; boylece
   * arayuzde her zaman gecerli bir deger olur.
   */
  public getSetting<T>(key: string, fallback: T): T {
    this.ensureReady()
    const value = this.db.settings[key]
    return value === undefined ? fallback : (value as T)
  }

  /** Bir ayar degerini yazar ve sifreli dosyaya hemen kalici eder. */
  public setSetting(key: string, value: unknown): void {
    this.ensureReady()
    this.db.settings[key] = value
    this.persist()
  }

  /** Birden fazla ayari tek yazma ile gunceller. */
  public setSettings(patch: Record<string, unknown>): void {
    this.ensureReady()
    for (const [key, value] of Object.entries(patch)) this.db.settings[key] = value
    this.persist()
  }

  // ---- Account ----------------------------------------------------------
  public getAccount(): Account | null {
    this.ensureReady()
    return this.db.account
  }

  public setAccount(account: Account | null): void {
    this.ensureReady()
    this.db.account = account
    this.persist()
  }

  // ---- Courses ----------------------------------------------------------
  public getCourses(): Course[] {
    this.ensureReady()
    return Object.values(this.db.courses).sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }

  /**
   * Ders listesini sunucudan gelen veriyle DEGISTIRIR.
   *
   * Onceki surum yalnizca ekliyordu ("merge"): Google'dan silinmis bir
   * ders veya ogrencinin cikis yaptigi bir sinif yerel depoda
   * kalic olarak kaliyordu. Kullanici listeden silinmis bir odevi
   * goruyor, tikliyor ve "Bu odev silinmis" hatasi aliyordu; uygulama
   * her acildiginda eski veriyi yeniden gosteriyordu.
   *
   * Silinen kayitlarin INDIRILMIS DOSYALARI da temizlenir; aksi halde
   * `cas/` klasorunda kullaniciyi referans vermeyen dosyalar birikir.
   */
  public saveCourses(courses: Course[]): void {
    this.ensureReady()
    const incoming = new Set(courses.map(c => c.id))

    // Gitmeyen derslerin odev/teslim/rubrik kovasini dusur.
    for (const courseId of Object.keys(this.db.courseWork)) {
      if (incoming.has(courseId)) continue
      delete this.db.courseWork[courseId]
      delete this.db.submissions[courseId]
      delete this.db.topics[courseId]
      delete this.db.announcements[courseId]
      delete this.db.materials[courseId]
      delete this.db.participants[courseId]
    }
    for (const courseId of Object.keys(this.db.courses)) {
      if (!incoming.has(courseId)) delete this.db.courses[courseId]
    }

    for (const c of courses) this.db.courses[c.id] = c
    this.persist()
  }

  // ---- Topics -----------------------------------------------------------
  public getTopics(courseId: string): Topic[] {
    this.ensureReady()
    return this.db.topics[courseId] || []
  }

  public saveTopics(courseId: string, topics: Topic[]): void {
    this.db.topics[courseId] = topics
    this.persist()
  }

  // ---- CourseWork -------------------------------------------------------
  public getCourseWork(courseId: string): CourseWork[] {
    this.ensureReady()
    const list = Object.values(this.db.courseWork[courseId] || {})
    return list
      .map(item => ({
        ...item,
        hasRubric: !!this.db.rubrics[item.id],
        submission: this.db.submissions[courseId]?.[item.id],
      }))
      .sort((a, b) => (a.dueDate ? -1 : 1) - (b.dueDate ? -1 : 1))
  }

  public getCourseWorkItem(courseId: string, workId: string): CourseWork | null {
    this.ensureReady()
    const item = this.db.courseWork[courseId]?.[workId]
    if (!item) return null
    return {
      ...item,
      hasRubric: !!this.db.rubrics[item.id],
      submission: this.db.submissions[courseId]?.[item.id],
    }
  }

  /**
   * Bir dersin ödev listesini sunucudan gelen veriyle DEĞİŞTİRİR.
   *
   * Önceki sürüm yalnızca ekliyordu. Google Classroom'da silinmiş veya
   * `state: DELETED` olmuş bir ödev yerel depoda kalıcı olarak kalıyor,
   * kullanıcı listede görüyor, tıklıyor ve işlem yapamıyordu.
   *
   * Silinen ödevlerin teslim/rubrik kayıtları da düşürülür.
   */
  public saveCourseWork(courseId: string, items: CourseWork[]): void {
    this.ensureReady()
    if (!this.db.courseWork[courseId]) this.db.courseWork[courseId] = {}

    const incoming = new Set(items.map(item => item.id))
    const bucket = this.db.courseWork[courseId]

    for (const workId of Object.keys(bucket)) {
      if (incoming.has(workId)) continue
      delete bucket[workId]
      delete this.db.rubrics[workId]
      if (this.db.submissions[courseId]) delete this.db.submissions[courseId][workId]
    }

    for (const item of items) bucket[item.id] = item
    this.persist()
  }

  // ---- Rubrics ----------------------------------------------------------
  public getRubric(courseWorkId: string): Rubric | undefined {
    this.ensureReady()
    return this.db.rubrics[courseWorkId]
  }

  public saveRubric(rubric: Rubric): void {
    this.db.rubrics[rubric.courseWorkId] = rubric
    this.persist()
  }

  // ---- Announcements ----------------------------------------------------
  public getAnnouncements(courseId: string): Announcement[] {
    this.ensureReady()
    return this.db.announcements[courseId] || []
  }

  public saveAnnouncements(courseId: string, list: Announcement[]): void {
    this.db.announcements[courseId] = list
    this.persist()
  }

  // ---- Materials --------------------------------------------------------
  public getMaterials(courseId: string): CourseMaterial[] {
    this.ensureReady()
    return this.db.materials[courseId] || []
  }

  public saveMaterials(courseId: string, list: CourseMaterial[]): void {
    this.db.materials[courseId] = list
    this.persist()
  }

  // ---- Participants -----------------------------------------------------
  public getParticipants(courseId: string): CourseParticipant[] {
    this.ensureReady()
    return this.db.participants[courseId] || []
  }

  public saveParticipants(courseId: string, list: CourseParticipant[]): void {
    this.db.participants[courseId] = list
    this.persist()
  }

  // ---- Submissions ------------------------------------------------------
  public getSubmissions(courseId: string): Record<string, StudentSubmission> {
    this.ensureReady()
    return this.db.submissions[courseId] || {}
  }

  public saveSubmission(submission: StudentSubmission): void {
    if (!this.db.submissions[submission.courseId]) {
      this.db.submissions[submission.courseId] = {}
    }
    this.db.submissions[submission.courseId][submission.courseWorkId] = submission
    this.persist()
  }

  // ---- CAS (Content-Addressable Storage) --------------------------------
  /**
   * Indirilen dosyalar duz metin DEGIL, ayni ana anahtarla AES-256-GCM
   * ile sifrelenerek saklanir. Dosya adi icerigi ifsade etmez; duz metin
   * SHA-256 ozeti kullanilir.
   */
  public saveFileToCas(
    fileId: string,
    courseId: string,
    title: string,
    mimeType: string,
    content: Buffer,
    driveFileId?: string,
  ): { sha256: string; absolutePath: string } {
    const hash = sha256Hex(content)
    const safeTitle = title.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120) || 'dosya'
    // Icera gore bolunmus dizin: ayni icerik ayni yere gider (tekillestirme).
    const targetDir = path.join(this.casDir, hash.slice(0, 2))
    fs.mkdirSync(targetDir, { recursive: true })
    const targetFile = path.join(targetDir, `${hash}.${safeTitle}`)
    const encrypted = aesEncrypt(this.ensureKey(), content)
    // Atomik: yarim dosya birakmaz. Ayni icerik zaten varsa `atomicWriteFileSync`
    // yazmayi atlar.
    atomicWriteFileSync(targetFile, encrypted)

    const entry: CachedFileEntry = {
      fileId,
      courseId,
      title,
      mimeType,
      sizeBytes: content.length,
      sha256: hash,
      casRelativePath: path.relative(this.casDir, targetFile),
      localModifiedAt: new Date().toISOString(),
      syncState: 'DOWNLOADED',
      driveFileId,
    }
    this.db.cachedFiles[fileId] = entry
    if (driveFileId && driveFileId !== fileId) {
      this.db.cachedFiles[driveFileId] = entry
    }
    this.persist()
    return { sha256: hash, absolutePath: targetFile }
  }

  /**
   * Sifreli CAS dosyasini cozer ve duz icerigi dondurur.
   *
   * BUTUNLUK DOGRULAMASI
   * --------------------
   * ESKI SURUM DOGRULAMA YAPMIYORDU. Iki ayri bozulma sessizce gecirdi:
   * 1. Surec yazma sirasinda cokerse diskte yarim sifreli dosya kalirdi.
   * 2. `updateLocalFileContent` icerigi ESKI hash'in adini tasiyan dosyaya
   *    yaziyordu; dosya adi ile icerik uyumsuzlugu hic yakalanmazdi.
   *
   * Artik beklenen ozet; acikca verilmezse DOSYA ADINDAN turetilir
   * (`<sha256>.<baslik>` duzeni). Uyuşmazlık sessizce gecilmez; acik bir
   * hata olarak yukseltilir, boylece kullaniciya bozuk dosya gosterilmez.
   *
   * Yol guvenligi de burada tekrar denetlenir: `readCasFile` disaridan
   * gelen bir yol alabiliyor ve CAS disina cikmaya calisan bir yol
   * reddedilmelidir.
   */
  public readCasFile(absolutePath: string, expectedSha256?: string): Buffer {
    const inside = this.isInsideCas(absolutePath)
    if (!inside) {
      throw new Error('Onbellek dosyasi guvenli depolama alaninin disinda.')
    }
    if (!fs.existsSync(inside)) {
      throw new Error('Onbellekteki dosya diskte bulunamadi.')
    }
    const plain = aesDecrypt(this.ensureKey(), fs.readFileSync(inside))
    const expected = (expectedSha256 || sha256FromCasFileName(inside) || '').toLowerCase()
    if (expected) {
      const actual = sha256Hex(plain)
      if (actual !== expected) {
        // Bozulan dosyayi sessizce kullanmak, kullaniciya UYGULANAMAZ bir
        // icerik gostermek demektir. Dosya adi ile icerik eslesmiyor.
        throw new Error(
          'Onbellekteki dosya bozulmus: icerik ile kayit tutmuyor. Dosya yeniden indirilecek.',
        )
      }
    }
    return plain
  }

  /**
   * Bir onbellek dosyasinin butunlugu denetlenir (okumadan bagimsiz).
   * Bozuk dosya tespiti icin; `getStoreHealth` ve tanilama ekranlari kullanir.
   */
  public verifyCasFile(absolutePath: string, expectedSha256?: string): { ok: boolean; reason?: string } {
    try {
      this.readCasFile(absolutePath, expectedSha256)
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  public getCachedFile(fileIdOrTitle: string): { entry: CachedFileEntry; absolutePath: string } | null {
    this.ensureReady()
    if (!fileIdOrTitle) return null
    let entry: CachedFileEntry | undefined = this.db.cachedFiles[fileIdOrTitle]
    if (!entry) {
      const q = fileIdOrTitle.toLowerCase().trim()
      const entries = Object.values(this.db.cachedFiles)
      entry =
        entries.find(e => e.fileId === fileIdOrTitle || (e.driveFileId && e.driveFileId === fileIdOrTitle)) ||
        entries.find(e => e.title.toLowerCase() === q) ||
        entries.find(e => q.length >= 3 && e.title.toLowerCase().includes(q))
    }
    if (!entry) return null
    const abs = this.resolveCasPath(entry.casRelativePath)
    if (!abs || !fs.existsSync(abs)) return null
    return { entry, absolutePath: abs }
  }

  /**
   * CAS yolunu guvenli sekilde cozer. Dizin disina cikan bir yol reddedilir.
   * (path traversal korumasi)
   */
  public resolveCasPath(relativePath: string): string | null {
    const abs = path.resolve(this.casDir, relativePath)
    const root = path.resolve(this.casDir)
    if (abs !== root && !abs.startsWith(root + path.sep)) return null
    return abs
  }

  /**
   * Verilen mutlak yolun CAS onbellek dizini icinde oldugunu dogrular.
   * Arayuzden gelen her yerel dosya yolu bu kontrolden gecmelidir.
   */
  public isInsideCas(absolutePath: string): string | null {
    if (typeof absolutePath !== 'string' || absolutePath.length === 0) return null
    const abs = path.resolve(absolutePath)
    const root = path.resolve(this.casDir)
    if (!abs.startsWith(root + path.sep)) return null
    return abs
  }

  public updateLocalFileContent(fileId: string, content: string | Uint8Array): { newHash: string } {
    const buf =
      typeof content === 'string'
        ? Buffer.from(content, 'utf8')
        : Buffer.from(content.buffer, content.byteOffset, content.byteLength)
    const cached = this.getCachedFile(fileId)
    if (!cached) throw new Error('Dosya yerel onbellekte bulunamadi.')

    const newHash = sha256Hex(buf)
    const previousPath = cached.absolutePath
    const previousRelative = cached.entry.casRelativePath

    if (newHash === cached.entry.sha256) {
      // Icerik degismemis: dosyaya hic dokunma, yalniz zaman damgasini tazele.
      cached.entry.localModifiedAt = new Date().toISOString()
      this.persist()
      return { newHash }
    }

    // YENI DOSYA YAZILIR. ESKISININ UZERINE DEGIL.
    //
    // HATANIN GELISMESI: eski surum `fs.writeFileSync(cached.absolutePath, ...)`
    // ile yeni icerigi ESKI hash'in adini tasiyan dosyaya yaziyordu; sonra
    // yalnizca `entry.sha256` guncelleniyordu. Boylece dosya adi ile icerik
    // kalici olarak eslesmez oluyordu ve ad, icerigin ne oldugunu anlatmaz
    // hale geliyordu.
    //
    // CAS'in temel degismezi "dosya adi = icerik ozeti" oldugu icin, guncellenmis
    // bir dosyaya eski adi tasimak bu degismezi ihlal eder. Dogru davranis:
    // yeni hash'li yeni dosya yaz, indeksi yeni yola cevir, eskiyi sil.
    const safeTitle =
      cached.entry.title.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120) || 'dosya'
    const newDir = path.join(this.casDir, newHash.slice(0, 2))
    fs.mkdirSync(newDir, { recursive: true })
    const newPath = path.join(newDir, `${newHash}.${safeTitle}`)
    const encrypted = aesEncrypt(this.ensureKey(), buf)
    atomicWriteFileSync(newPath, encrypted)

    cached.entry.sha256 = newHash
    cached.entry.sizeBytes = buf.length
    cached.entry.casRelativePath = path.relative(this.casDir, newPath)
    cached.entry.localModifiedAt = new Date().toISOString()
    cached.entry.syncState = 'LOCAL_MODIFIED'

    // Indeks yazildiktan SONRA eskiyi sil. Boylece bir hata olusursa eski
    // dosya durmaya devam eder; kullanici veri kaybetmez.
    this.persist()

    if (previousPath !== newPath && previousRelative !== cached.entry.casRelativePath) {
      // Ayni icerik baska bir dosya girdisi tarafindan paylasiliyorsa
      // SILLENMEZ: birlikte kullanilan bir onbellek kaydi kalirsa o kayit
      // kullanilamaz hale gelirdi.
      const sharedElsewhere = Object.values(this.db.cachedFiles).some(
        e =>
          e.casRelativePath === previousRelative &&
          !(e.fileId === fileId || (cached.entry.driveFileId && e.fileId === cached.entry.driveFileId)),
      )
      if (!sharedElsewhere) safeUnlinkSync(previousPath)
    }

    return { newHash }
  }

  // ---- Yerel arama ------------------------------------------------------
  public search(query: string): Array<{
    type: 'course' | 'coursework' | 'announcement' | 'material' | 'file'
    id: string
    title: string
    snippet: string
    courseId?: string
  }> {
    this.ensureReady()
    const q = query.toLowerCase().trim()
    if (!q) return []
    const results: Array<any> = []
    const courseName = (id: string) => this.db.courses[id]?.name ?? ''

    for (const c of Object.values(this.db.courses)) {
      const haystack = [c.name, c.section, c.room].filter(Boolean).join(' ').toLowerCase()
      if (haystack.includes(q)) {
        results.push({
          type: 'course',
          id: c.id,
          title: c.name,
          snippet: [c.section, c.room].filter(Boolean).join(' · '),
          courseId: c.id,
        })
      }
    }

    for (const [courseId, works] of Object.entries(this.db.courseWork)) {
      for (const w of Object.values(works)) {
        if (w.title.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q)) {
          results.push({
            type: 'coursework',
            id: w.id,
            title: w.title,
            snippet: w.description?.slice(0, 160) ?? courseName(courseId),
            courseId,
          })
        }
      }
    }

    for (const [courseId, announcements] of Object.entries(this.db.announcements)) {
      for (const a of announcements) {
        if (a.text.toLowerCase().includes(q)) {
          results.push({
            type: 'announcement',
            id: a.id,
            title: courseName(courseId),
            snippet: a.text.slice(0, 160),
            courseId,
          })
        }
      }
    }

    for (const [courseId, mats] of Object.entries(this.db.materials)) {
      for (const m of mats) {
        if (m.title.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q)) {
          results.push({
            type: 'material',
            id: m.id,
            title: m.title,
            snippet: m.description?.slice(0, 160) ?? courseName(courseId),
            courseId,
          })
        }
      }
    }

    for (const f of Object.values(this.db.cachedFiles)) {
      if (f.title.toLowerCase().includes(q)) {
        results.push({
          type: 'file',
          id: f.fileId,
          title: f.title,
          snippet: courseName(f.courseId),
          courseId: f.courseId,
        })
      }
    }

    return results.slice(0, 50)
  }

  // ---- Senkronizasyon durumu --------------------------------------------
  public beginSync(label?: string): void {
    this.syncState = { isSyncing: true, errors: [], progress: { label: label ?? '', done: 0, total: 0 } }
  }

  public setSyncProgress(done: number, total: number, label?: string): void {
    this.syncState.progress = { label: label ?? this.syncState.progress?.label ?? '', done, total }
  }

  public recordSyncError(message: string): void {
    this.syncState.errors.push(message)
  }

  public endSync(): void {
    this.syncState.isSyncing = false
    this.syncState.progress = undefined
  }

  public getSyncStatus(): SyncStatus {
    this.ensureReady()
    let totalBytes = 0
    let filesCount = 0
    for (const f of Object.values(this.db.cachedFiles)) {
      if (f.syncState === 'DOWNLOADED' || f.syncState === 'LOCAL_MODIFIED') {
        filesCount += 1
        totalBytes += f.sizeBytes
      }
    }

    let workCount = 0
    for (const works of Object.values(this.db.courseWork)) {
      workCount += Object.keys(works).length
    }

    return {
      isSyncing: this.syncState.isSyncing,
      progress: this.syncState.progress,
      lastSyncedAt: this.db.lastSyncedAt,
      coursesCount: Object.keys(this.db.courses).length,
      courseWorkCount: workCount,
      cachedFilesCount: filesCount,
      totalBytesCached: totalBytes,
      activeErrors: [...this.syncState.errors],
    }
  }

  public updateLastSynced(): void {
    this.db.lastSyncedAt = new Date().toISOString()
    this.persist()
  }

  /**
   * Oturum kapatıldığında veya kullanıcı değiştiğinde sınıflar, ödevler,
   * teslimler, duyurular ve çalışma taslaklarını sıfırlar; kullanıcı ayarlarını korur.
   *
   * İNDİRİLEN DOSYALAR DA SİLİNİR.
   *
   * Önceki sürümde yalnızca `cachedFiles` dizini boşaltılıyordu; `cas/`
   * klasöründeki ödev PDF'leri, teslim belgeleri ve ekler diskte kalıyordu.
   * Aynı Windows hesabını paylaşan ikinci bir kullanıcı bu dosyaları
   * şifreli olsalar bile kasa anahtarıyla açabiliyordu. Dosyalar
   * içerik-adı indeksinden bağımsız olduğu için silinmez de
   * çöp oluşturup birikiyorlardı.
   */
  public resetClassroomData(): void {
    this.db = {
      ...this.db,
      account: null,
      courses: {},
      topics: {},
      courseWork: {},
      rubrics: {},
      announcements: {},
      materials: {},
      participants: {},
      submissions: {},
      cachedFiles: {},
      drafts: {},
      lastSyncedAt: undefined,
    }

    // Indirilen dosyalar: icerikleri sifreli olsa da o hesaba aittir.
    this.purgeCasDirectory()

    this.persist()
  }

  /**
   * `cas/` klasorundeki indirilen dosyalari siler ve klasoru yeniden olusturur.
   * `cachedFiles` indeksi zaten bos oldugu icin bu islem tutarsizlik
   * birakmaz; yalnizca disk alanini geri kazandirir ve veri izini siler.
   */
  private purgeCasDirectory(): void {
    try {
      fs.rmSync(this.casDir, { recursive: true, force: true })
      fs.mkdirSync(this.casDir, { recursive: true })
    } catch {
      /* Klasor kilitliyse sessizce gec; veri indeksi yine temizlendi. */
    }
  }

  /**
   * Tum yerel egitim verisini siler ve depo dosyasini yeniden OLUSTURMAZ.
   * Onceki surumde silme sonrasi persist() cagrisi dosyayi tekrar yaziyordu.
   */
  public wipeLocalCache(): void {
    this.ensureReady()
    // Ayarlar da kullanici verisidir; sifirlama sirasinda korunmaz.
    this.db = {
      account: this.db.account,
      courses: {},
      topics: {},
      courseWork: {},
      rubrics: {},
      announcements: {},
      materials: {},
      participants: {},
      submissions: {},
      cachedFiles: {},
      drafts: {},
      lastSyncedAt: undefined,
      settings: {
        autoSyncMinutes: 5,
      },
    }

    if (fs.existsSync(this.dbPath)) {
      try {
        const size = fs.statSync(this.dbPath).size
        if (size > 0) fs.writeFileSync(this.dbPath, crypto.randomBytes(size))
        fs.unlinkSync(this.dbPath)
      } catch {
        /* yoksay */
      }
    }

    fs.rmSync(this.casDir, { recursive: true, force: true })
    fs.mkdirSync(this.casDir, { recursive: true })

    // Eski surumden kalan, sifreleme oncesi duz metin indirme dosyalari
    // (<hash>_<baslik> bicimi) yeni kaydirma duzeninde taninmaz ve hicbir
    // zaman kullanilmaz. Onlari da temizliyoruz.
    this.purgeLegacyPlaintextCasFiles()

    // Depo dosyasi silindikten sonra YENIDEN yazilmaz.
  }

  /**
   * Onceki surumun duz metin (sifrelenmemis) indirdigi dosyalari siler.
   *
   * Eski kaydirma duzeni `<sha256>_<baslik>` idi ve icerik diskte ACIKTI.
   * Yeni duzen `<sha256>.<baslik>` ve icerik AES-256-GCM ile sifrelenir.
   * Nokta yerine alt cizgi iceren dosyalar bu yuzden yalnizca artiktir.
   */
  private purgeLegacyPlaintextCasFiles(): void {
    try {
      if (!fs.existsSync(this.casDir)) return
      for (const entry of fs.readdirSync(this.casDir)) {
        if (!entry.includes('_')) continue
        try {
          fs.unlinkSync(path.join(this.casDir, entry))
        } catch {
          /* kilitli dosya */
        }
      }
    } catch {
      /* yoksay */
    }
  }
}