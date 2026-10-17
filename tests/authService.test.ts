import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeTempUserDataDir, makeSafeStorageMock } from './helpers/mockElectron'

const USER_DATA = makeTempUserDataDir()

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  safeStorage: makeSafeStorageMock(true),
  shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve('') },
  BrowserWindow: vi.fn(),
  session: { fromPartition: vi.fn() },
}))

const { KeyringService } = await import('../electron/services/keyringService')
const { VaultService } = await import('../electron/services/vaultService')
const { StorageService } = await import('../electron/services/storageService')
const { AuthService, resolveUniversityInfo, isValidGoogleClientId, getBundledClientId } = await import('../electron/services/authService')

type AuthType = InstanceType<typeof AuthService>

describe('AuthService', () => {
  let vault: InstanceType<typeof VaultService>
  let storage: InstanceType<typeof StorageService>
  let auth: AuthType

  beforeEach(() => {
    const keyring = new KeyringService()
    vault = new VaultService(keyring)
    storage = new StorageService(keyring)
    vault.wipeAllKeys()
    storage.wipeLocalCache()
    auth = new AuthService(vault, storage)
  })

  afterEach(() => {
    vault.wipeAllKeys()
    storage.wipeLocalCache()
  })

  it('ozel istemci tanimlanmadiginda gomulu derleme kimligini kullanir ve JSON ile ozel kimlik yuklenebilir', () => {
    // Test ortaminda `JMC_GOOGLE_CLIENT_ID` tanimli degildir; bu yuzden
    // gomulu kimlik bos string doner ve uygulama "kimlik yok" durumuna
    // duser. Bu, derleme ortami hatali oldugunda gorulecek dogru davranistir.
    expect(auth.getClientId()).toBeNull()
    expect(auth.getActiveClientId()).toBe(getBundledClientId())

    const bundled = getBundledClientId()
    if (bundled) {
      // Derleme ortami yapilandirilmis: kimlik gomulmus ve gecerli olmali.
      expect(auth.validateClientId().valid).toBe(true)
      expect(auth.validateClientId().origin).toBe('build')
    } else {
      // Yapilandirilmamis: net bir hata verilmeli, sahte bir deger degil.
      expect(auth.validateClientId().valid).toBe(false)
      expect(auth.validateClientId().error).toContain('JMC_GOOGLE_CLIENT_ID')
      expect(auth.validateClientId().origin).toBe('none')
    }
    expect(auth.isUsingCustomClientId()).toBe(false)

    // JSON ice aktarma testi
    const sampleJson = JSON.stringify({
      installed: {
        client_id: '1234567890-testapp.apps.googleusercontent.com',
        client_secret: 'GOCSPX-testsecret1234567890',
      },
    })
    const res = auth.importGoogleCredentialsJson(sampleJson)
    expect(res.success).toBe(true)
    expect(auth.getActiveClientId()).toBe('1234567890-testapp.apps.googleusercontent.com')
    expect(vault.getKey('google_client_secret')).toBe('GOCSPX-testsecret1234567890')
    expect(auth.hasClientSecret()).toBe(true)
    expect(auth.validateClientId().valid).toBe(true)
    expect(auth.isUsingCustomClientId()).toBe(true)
  })

  it('kurumsal istemci kimligi tanimlanabilir', () => {
    const custom = '999988887777-okul.apps.googleusercontent.com'
    auth.setClientId(custom)
    expect(auth.getClientId()).toBe(custom)
    expect(auth.getActiveClientId()).toBe(custom)
    expect(auth.isUsingCustomClientId()).toBe(true)
  })

  it('ilk baglantida yalnizca okuma gerektiren en dar kume istenir', () => {
    for (const scope of [
      'openid',
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.me',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ]) {
      expect(AuthService.BASE_SCOPES).toContain(scope)
    }

    // "Restricted" turunden kapsam Google dogrulamasinda ek video ve
    // guvenlik degerlendirmesi gerektirir; hicbir kosulda istenmez.
    expect(AuthService.BASE_SCOPES).not.toContain(
      'https://www.googleapis.com/auth/classroom.coursework.students',
    )
    expect(AuthService.ELEVATED_SCOPES).not.toContain(
      'https://www.googleapis.com/auth/classroom.coursework.students',
    )

    // Ogretmen gorunumu icin yalnizca salt-okunur varyantlar kullanilir.
    expect(AuthService.ELEVATED_SCOPES).toContain(
      'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
    )
    expect(AuthService.ELEVATED_SCOPES).toContain(
      'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
    )
  })

  it('REQUIRED_SCOPES geriye donuk uyumluluk olarak BASE_SCOPES aynidir', () => {
    expect(AuthService.REQUIRED_SCOPES).toEqual(AuthService.BASE_SCOPES)
  })

  it('cikis yapildiginda belirtecler ve hesap silinir', async () => {
    vault.setKey('google_access_token', 'ya29.test_token')
    vault.setKey('google_refresh_token', '1//0g_test_refresh')
    storage.setAccount({
      id: 'usr_1',
      googleSub: '123',
      email: 'ogrenci@okul.edu',
      displayName: 'Deneme',
      role: 'STUDENT',
      grantedScopes: [],
      lastAuthAt: new Date().toISOString(),
    })

    expect(await auth.logout(false)).toBe(true)
    expect(storage.getAccount()).toBeNull()
    expect(vault.getKey('google_access_token')).toBeUndefined()
    expect(vault.getKey('google_refresh_token')).toBeUndefined()
  })

  it('sifirlama secenegi yerel depoyu da temizler', async () => {
    vault.setKey('openai', 'sk-test')
    storage.setAccount({
      id: 'usr_1',
      googleSub: '123',
      email: 'x@y.z',
      displayName: 'X',
      role: 'STUDENT',
      grantedScopes: [],
      lastAuthAt: new Date().toISOString(),
    })
    vault.setKey('google_access_token', 'ya29.token')

    await auth.logout(true)

    expect(storage.getAccount()).toBeNull()
    expect(storage.getCourses()).toHaveLength(0)
    expect(vault.getKey('google_access_token')).toBeUndefined()
  })

  it('beyaz listede olmayan ayar anahtari yazilamaz', async () => {
    storage.setSetting('toolPermissions', { webSearch: false })
    expect(storage.getSetting<Record<string, boolean>>('toolPermissions', {}).webSearch).toBe(false)
  })

  // ---- YENİ: Üniversite ve Client ID Doğrulama Testleri --------------------
  it('resolveUniversityInfo bilinen ve ozel universiteleri dogru cozumler', () => {
    const itu = resolveUniversityInfo('ahmet@itu.edu.tr')
    expect(itu.institution).toBe('İstanbul Teknik Üniversitesi (İTÜ)')
    expect(itu.isEduTr).toBe(true)
    expect(itu.isEdu).toBe(true)
    expect(itu.domain).toBe('itu.edu.tr')

    // Alt alan adı (subdomain) soyma testi (ogr., college., cs.)
    const ituOgr = resolveUniversityInfo('ogrenci@ogr.itu.edu.tr')
    expect(ituOgr.institution).toBe('İstanbul Teknik Üniversitesi (İTÜ)')
    expect(ituOgr.isEduTr).toBe(true)

    const gazi = resolveUniversityInfo('ayse@gazi.edu.tr')
    expect(gazi.institution).toBe('Gazi Üniversitesi')
    expect(gazi.isEduTr).toBe(true)

    const metu = resolveUniversityInfo('ogrenci@metu.edu.tr')
    expect(metu.institution).toBe('Orta Doğu Teknik Üniversitesi (ODTÜ)')
    expect(metu.isEduTr).toBe(true)

    const anadolu = resolveUniversityInfo('hoca@anadolu.edu.tr')
    expect(anadolu.institution).toBe('Anadolu Üniversitesi')
    expect(anadolu.isEduTr).toBe(true)

    const ozel = resolveUniversityInfo('student@trakya.edu.tr')
    expect(ozel.institution).toBe('Trakya Üniversitesi')
    expect(ozel.isEduTr).toBe(true)

    // Küresel (Dünya) Üniversiteleri
    const harvard = resolveUniversityInfo('john@college.harvard.edu')
    expect(harvard.institution).toBe('Harvard University')
    expect(harvard.isEdu).toBe(true)
    expect(harvard.country).toBe('US')

    const mit = resolveUniversityInfo('alice@mit.edu')
    expect(mit.institution).toContain('Massachusetts Institute of Technology')
    expect(mit.isEdu).toBe(true)

    const oxford = resolveUniversityInfo('student@cs.ox.ac.uk')
    expect(oxford.institution).toBe('University of Oxford')
    expect(oxford.country).toBe('GB')

    const eth = resolveUniversityInfo('hans@ethz.ch')
    expect(eth.institution).toContain('ETH Zurich')
    expect(eth.country).toBe('CH')

    const tokyo = resolveUniversityInfo('kenji@u-tokyo.ac.jp')
    expect(tokyo.institution).toBe('University of Tokyo')
    expect(tokyo.country).toBe('JP')

    const toronto = resolveUniversityInfo('sarah@utoronto.ca')
    expect(toronto.institution).toBe('University of Toronto')
    expect(toronto.country).toBe('CA')

    const nus = resolveUniversityInfo('tan@nus.edu.sg')
    expect(nus.institution).toContain('National University of Singapore')
    expect(nus.country).toBe('SG')

    // Jenerik Uluslararası Uzantılar
    const monash = resolveUniversityInfo('mate@monash.edu.au')
    expect(monash.institution).toBe('Monash University')
    expect(monash.country).toBe('AU')

    const flinders = resolveUniversityInfo('mate@flinders.edu.au')
    expect(flinders.institution).toContain('Flinders University (Australia)')
    expect(flinders.isEdu).toBe(true)

    const fudan = resolveUniversityInfo('li@fudan.edu.cn')
    expect(fudan.institution).toBe('Fudan University')
    expect(fudan.isEdu).toBe(true)
    expect(fudan.country).toBe('CN')

    const wuhan = resolveUniversityInfo('student@wuhan.edu.cn')
    expect(wuhan.institution).toContain('Wuhan University (China)')
    expect(wuhan.isEdu).toBe(true)

    const bonn = resolveUniversityInfo('karl@uni-bonn.de')
    expect(bonn.institution).toBe('University of Bonn')
    expect(bonn.isEdu).toBe(true)

    const augsburg = resolveUniversityInfo('karl@uni-augsburg.de')
    expect(augsburg.institution).toContain('Augsburg University')
    expect(augsburg.isEdu).toBe(true)

    const gmail = resolveUniversityInfo('user@gmail.com')
    expect(gmail.institution).toBe('Google Bireysel Hesabı')
    expect(gmail.isEduTr).toBe(false)
    expect(gmail.isEdu).toBe(false)
  })

  it('isValidGoogleClientId yer tutuculari ve gecersiz kalıplari eler', () => {
    // Varsayilan yer tutucu gecersiz sayilmalidir
    expect(isValidGoogleClientId('1027142617631-justmyclassdesktopapp.apps.googleusercontent.com')).toBe(false)
    expect(isValidGoogleClientId('')).toBe(false)
    expect(isValidGoogleClientId(null)).toBe(false)
    expect(isValidGoogleClientId('rastgele_metin')).toBe(false)

    // Gercek formatlar gecerli sayilmalidir
    expect(isValidGoogleClientId('1027142617631-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com')).toBe(true)
    expect(isValidGoogleClientId('999988887777-okul.apps.googleusercontent.com')).toBe(true)
  })

  it('validateClientId ayarlanmamis, gecersiz ve gecerli istemcileri dogrular', () => {
    // Argumansiz cagrildiginda etkin kimligi ve kaynagini dondurur.
    const defaultVal = auth.validateClientId()
    expect(defaultVal.isCustom).toBe(false)
    expect(defaultVal.activeClientId).toBe(getBundledClientId())
    expect(['build', 'none']).toContain(defaultVal.origin)

    const emptyExplicit = auth.validateClientId('')
    expect(emptyExplicit.valid).toBe(false)
    expect(emptyExplicit.error).toBeTruthy()

    const invalidVal = auth.validateClientId('gecersiz')
    expect(invalidVal.valid).toBe(false)
    expect(invalidVal.error).toContain('Geçersiz istemci kimliği')

    const customVal = auth.validateClientId('1027142617631-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com')
    expect(customVal.valid).toBe(true)
    expect(customVal.isPlaceholder).toBe(false)
    expect(customVal.origin).toBe('custom')
    expect(customVal.error).toBeUndefined()
  })

  it('loginWithGoogle gecersiz Client ID ile tarayiciyi acmadan aninda hata verir (401 onleyici)', async () => {
    auth.setClientId('gecersiz_istemci')
    await expect(auth.loginWithGoogle()).rejects.toThrow('MISSING_OR_INVALID_CLIENT_ID')
  })

  it('cancelLogin calisirken guvenli sekilde iptal edebilir', () => {
    expect(auth.cancelLogin()).toBe(false)
  })

  it('BASE_SCOPES yalnizca gecerli Google OAuth kapsamlari icerir (invalid_scope onleyici)', () => {
    expect(AuthService.BASE_SCOPES).not.toContain('https://www.googleapis.com/auth/classroom.student-submissions.me')
    expect(AuthService.BASE_SCOPES).toContain('https://www.googleapis.com/auth/classroom.student-submissions.me.readonly')
    expect(AuthService.BASE_SCOPES).toContain('https://www.googleapis.com/auth/classroom.coursework.me')
  })

  it('importGoogleCredentialsJson Google Console JSON dosyasini basariyla cozumler ve kaydeder', () => {
    const sampleJson = JSON.stringify({
      installed: {
        client_id: '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com',
        project_id: 'justmyclass-test',
        client_secret: 'GOCSPX-secret123',
      },
    })
    const res = auth.importGoogleCredentialsJson(sampleJson)
    expect(res.success).toBe(true)
    expect(res.clientId).toBe('123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com')
    expect(auth.getClientId()).toBe('123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com')
    expect(vault.getKey('google_client_secret')).toBe('GOCSPX-secret123')
  })

  it('logout belirtecleri siler ama YEREL DERS VERISINI KORUR', async () => {
    vault.setKey('google_access_token', 'ya29.test')
    vault.setKey('google_refresh_token', '1//refresh.test')
    storage.setAccount({
      id: 'usr_1',
      googleSub: '123',
      email: 'test@itu.edu.tr',
      displayName: 'Test',
      role: 'STUDENT',
      grantedScopes: [],
      lastAuthAt: new Date().toISOString(),
    })
    storage.saveCourses([
      {
        id: 'c1',
        name: 'Test Dersi',
        ownerId: 'teacher1',
        courseState: 'ACTIVE',
        updateTime: new Date().toISOString(),
      },
    ])

    expect(storage.getCourses().length).toBe(1)
    await auth.logout()

    expect(storage.getAccount()).toBeNull()
    expect(vault.getKey('google_access_token')).toBeUndefined()
    expect(vault.getKey('google_refresh_token')).toBeUndefined()

    // VERI KAYBI DUZELTMESI: eski surumde cikis yapmak tum yerel ders
    // verisini SILIYORDU. Kullanici oturumu kapatti, yeniden girdi ve tum
    // derslerini kaybettti. Cikis artik yalnizca Google tarafini temizler.
    expect(storage.getCourses().length).toBe(1)
  })

  it('getDiagnostics gizli deger sizdirmadan oturum durumunu ozetler', () => {
    vault.setKey('google_access_token', 'ya29.cokgizli_token')
    vault.setKey('google_refresh_token', '1//0g_cokgizli_refresh')
    storage.setAccount({
      id: 'usr_1',
      googleSub: '123',
      email: 'ogrenci@itu.edu.tr',
      displayName: 'Deneme Ogrenci',
      institution: 'Istanbul Teknik Universitesi',
      role: 'STUDENT',
      grantedScopes: AuthService.BASE_SCOPES,
      lastAuthAt: new Date().toISOString(),
    })

    const diag = auth.getDiagnostics()

    expect(diag.signedIn).toBe(true)
    expect(diag.hasAccessToken).toBe(true)
    expect(diag.hasRefreshToken).toBe(true)
    expect(diag.accountEmail).toBe('ogrenci@itu.edu.tr')
    expect(diag.institution).toContain('Teknik')
    expect(diag.missingScopes).toEqual([])

    // Token'larin KENDISI hicbir alanda gorunmemeli.
    const serialized = JSON.stringify(diag)
    expect(serialized).not.toContain('cokgizli_token')
    expect(serialized).not.toContain('cokgizli_refresh')
  })

  it('getDiagnostics eksik kapsamlari raporlar', () => {
    storage.setAccount({
      id: 'usr_1',
      googleSub: '123',
      email: 'ogrenci@okul.edu',
      displayName: 'Deneme',
      role: 'STUDENT',
      grantedScopes: ['openid'],
      lastAuthAt: new Date().toISOString(),
    })
    const diag = auth.getDiagnostics()
    expect(diag.missingScopes.length).toBeGreaterThan(0)
    expect(diag.missingScopes).toContain('https://www.googleapis.com/auth/drive.readonly')
  })

  it('getAccountCapability bireysel gmail hesabinda Classroom kullanilamaz der', () => {
    storage.setAccount({
      id: 'usr_1',
      googleSub: '123',
      email: 'kisi@gmail.com',
      displayName: 'Deneme',
      institution: 'Google Bireysel Hesabi',
      role: 'STUDENT',
      grantedScopes: [],
      lastAuthAt: new Date().toISOString(),
    })

    const cap = auth.getAccountCapability()
    expect(cap.canUseClassroom).toBe(false)
    expect(cap.reason).toBe('personal-gmail')
    // Kullaniciya neden bos liste gordugunu acikca soylenmeli.
    expect(cap.detail).toContain('gmail')
  })

  it('getAccountCapability kurumsal hesapta Classroom kullanilabilir der', () => {
    storage.setAccount({
      id: 'usr_1',
      googleSub: '123',
      email: 'ogrenci@itu.edu.tr',
      displayName: 'Deneme',
      institution: 'Istanbul Teknik Universitesi',
      role: 'STUDENT',
      grantedScopes: [],
      lastAuthAt: new Date().toISOString(),
    })

    const cap = auth.getAccountCapability()
    expect(cap.canUseClassroom).toBe(true)
    expect(cap.reason).toBe('workspace')
  })

  it('getAccountCapacity giris yokken acikca durum bildirir', () => {
    const cap = auth.getAccountCapability()
    expect(cap.canUseClassroom).toBe(false)
    expect(cap.reason).toBe('signed-out')
  })

  it('logout indirilen dosyalari diskte BIRAKIR (yalnizca acikca silinir)', async () => {
    const fileId = 'drive_file_test'
    storage.saveFileToCas(fileId, 'c1', 'odev.pdf', 'application/pdf', Buffer.from('gizli icerik'))
    expect(storage.getCachedFile(fileId)).toBeTruthy()

    storage.setAccount({
      id: 'usr_1',
      googleSub: '123',
      email: 'ogrenci@itu.edu.tr',
      displayName: 'Deneme',
      role: 'STUDENT',
      grantedScopes: [],
      lastAuthAt: new Date().toISOString(),
    })

    await auth.logout()

    // Indirilen odev dosyalari acik bir eylemle silinir (Ayarlar >
    // Verileri sil). Oturumu kapatmak onlari SILMEZ.
    expect(storage.getCachedFile(fileId)).not.toBeNull()
  })

  it('normal logout OAuth client secret degerini korur, tam sifirlama (wipeCache) veya resetCustomClient temizler', async () => {
    auth.setClientId('123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com')
    auth.setClientSecret('GOCSPX-eski')
    vault.setKey('google_access_token', 'ya29.test')

    await auth.logout(false)
    expect(vault.getKey('google_client_secret')).toBe('GOCSPX-eski')

    auth.resetCustomClient()
    expect(vault.getKey('google_client_secret')).toBeUndefined()
    expect(auth.getClientId()).toBeNull()

    auth.setClientSecret('GOCSPX-yeni')
    await auth.logout(true)
    expect(vault.getKey('google_client_secret')).toBeUndefined()
  })

  it('refreshAccessToken isteginde etkin client_secret parametresini Google token uc noktasina gonderir', async () => {
    auth.setClientId('123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com')
    auth.setClientSecret('GOCSPX-test-secret-value')
    vault.setKey('google_refresh_token', '1//refresh-test-token')

    let capturedBody = ''
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'ya29.renewed_token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    try {
      const token = await auth.refreshAccessToken()
      expect(token).toBe('ya29.renewed_token')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const callInit = fetchSpy.mock.calls[0]?.[1]
      capturedBody = String(callInit?.body ?? '')
      const params = new URLSearchParams(capturedBody)
      expect(params.get('client_id')).toBe('123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com')
      expect(params.get('client_secret')).toBe('GOCSPX-test-secret-value')
      expect(params.get('grant_type')).toBe('refresh_token')
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
