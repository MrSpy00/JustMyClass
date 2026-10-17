import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateService } from '../electron/services/updateService'
import type { StorageService } from '../electron/services/storageService'

describe('UpdateService', () => {
  let mockStorage: StorageService
  let settings: Record<string, unknown> = {}

  beforeEach(() => {
    settings = {}
    mockStorage = {
      getSetting: vi.fn((key: string, def: unknown) => (key in settings ? settings[key] : def)),
      setSetting: vi.fn(async (key: string, val: unknown) => {
        settings[key] = val
      }),
    } as unknown as StorageService
  })

  it('GitHub URL\'lerini özel generic yayın olarak algılamaz (doğal GitHub entegrasyonu)', () => {
    const service = new UpdateService(mockStorage)
    expect(service.isCustomGenericFeed('')).toBe(false)
    expect(service.isCustomGenericFeed(null)).toBe(false)
    expect(service.isCustomGenericFeed('https://github.com/MrSpy00/JustMyClass/releases')).toBe(false)
    expect(service.isCustomGenericFeed('https://github.com/org/repo')).toBe(false)
    expect(service.isCustomGenericFeed('https://api.github.com/repos/MrSpy00/JustMyClass')).toBe(false)
  })

  it('Özel CDN/S3 URL\'lerini doğru şekilde özel generic sunucu olarak tespit eder', () => {
    const service = new UpdateService(mockStorage)
    expect(service.isCustomGenericFeed('https://cdn.example.com/justmyclass/updates')).toBe(true)
    expect(service.isCustomGenericFeed('https://universite.edu.tr/yazilim/jmc')).toBe(true)
  })

  it('GitHub beslemesinde 404 alındığında kullanıcıya iç dosya adı gösterilmez', () => {
    const service = new UpdateService(mockStorage)
    // Varsayılan GitHub adresi
    const status = service.getStatus()
    expect(status.feedUrl).toContain('github.com')

    const explained = (service as any).explainUpdateError(new Error('HttpError: 404 Not Found'))
    // Kullanıcı "latest.yml olmalı" diye iç ayrıntı görmemeli.
    expect(explained).not.toContain('latest.yml')
    expect(explained).not.toContain('.yml')
    expect(explained).toContain('Sunucudan yeni bir sürüm okunamadı')
  })

  it('Özel generic sunucuda 404 alındığında sürüm paketinin eksik olduğunu bildirir', () => {
    const service = new UpdateService(mockStorage)
    service.setFeedUrl('https://cdn.example.com/updates')
    const explained = (service as any).explainUpdateError(new Error('HttpError: 404 Not Found'))
    expect(explained).toContain('Özel güncelleme sunucusunda geçerli bir sürüm paketi bulunamadı')
    // İç dosya adı yine de kullanıcıya gösterilmemeli.
    expect(explained).not.toContain('latest.yml')
  })

  it('Paketlenmemiş (geliştirme) ortamda kontrol hata vermez', () => {
    const service = new UpdateService(mockStorage)
    const explained = (service as any).explainUpdateError(
      new Error('Skip checkForUpdates because application is not packed and dev update config is not forced'),
    )
    expect(explained).toContain('kurulmuş sürümde çalışır')
  })

  it('GitHub akışında sürüm kontrolü autoUpdater yerine Releases API üzerinden yapılır', () => {
    const service = new UpdateService(mockStorage)
    // `check()` GitHub beslemesinde asla `autoUpdater.checkForUpdates()`
    // çağırmaz; bunun yerine `checkViaGitHubApi()` yolunu kullanır.
    expect(typeof (service as any).checkViaGitHubApi).toBe('function')
    const source = (service as any).checkViaGitHubApi.toString()
    expect(source).toContain('api.github.com')
    expect(source).not.toContain('autoUpdater')
  })
})
