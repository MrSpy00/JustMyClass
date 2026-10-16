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

  it('GitHub beslemesinde 404 alındığında yanıltıcı latest.yml hatası vermez', () => {
    const service = new UpdateService(mockStorage)
    // Varsayılan GitHub adresi
    const status = service.getStatus()
    expect(status.feedUrl).toContain('github.com')

    const explained = (service as any).explainUpdateError(new Error('HttpError: 404 Not Found'))
    expect(explained).not.toContain('latest.yml dosyası')
    expect(explained).toContain('Henüz yayınlanmış yeni bir sürüm bulunamadı veya uygulama en güncel sürümde')
  })

  it('Özel generic sunucuda 404 alındığında latest.yml dosyasının eksik olduğunu bildirir', () => {
    const service = new UpdateService(mockStorage)
    service.setFeedUrl('https://cdn.example.com/updates')
    const explained = (service as any).explainUpdateError(new Error('HttpError: 404 Not Found'))
    expect(explained).toContain('latest.yml')
  })
})
