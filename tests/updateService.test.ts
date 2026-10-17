import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  UpdateService,
  computeFileSha256,
  evaluateReleaseUpdate,
  isNewerVersion,
  isSameVersion,
  normalizeSha256Digest,
} from '../electron/services/updateService'
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

  it('SHA-256 digest ve derleme zamanı ile aynı sürüm kodunda (0.0.1 === 0.0.1) hotfix güncellemesini algılar', () => {
    const oldHash = 'a'.repeat(64)
    const newHash = 'b'.repeat(64)

    expect(isNewerVersion('0.0.1', '0.0.2')).toBe(true)
    expect(isSameVersion('v0.0.1', '0.0.1')).toBe(true)
    expect(normalizeSha256Digest(`sha256:${oldHash.toUpperCase()}`)).toBe(oldHash)

    // 1. Aynı sürüm ama SHA-256 farklı -> Hotfix algılanmalı
    const hotfixByHash = evaluateReleaseUpdate({
      currentVersion: '0.0.1',
      remoteTag: 'v0.0.1',
      localPortableSha256: oldHash,
      remoteAssetDigest: `sha256:${newHash}`,
    })
    expect(hotfixByHash.updateAvailable).toBe(true)
    expect(hotfixByHash.isHotfixRebuild).toBe(true)
    expect(hotfixByHash.displayVersion).toContain('Yeni Derleme')

    // 2. Aynı sürüm ve SHA-256 aynı -> Güncel
    const upToDateByHash = evaluateReleaseUpdate({
      currentVersion: '0.0.1',
      remoteTag: 'v0.0.1',
      localPortableSha256: oldHash,
      remoteAssetDigest: `sha256:${oldHash}`,
    })
    expect(upToDateByHash.updateAvailable).toBe(false)
    expect(upToDateByHash.isHotfixRebuild).toBe(false)

    // 3. Kurulu (NSIS) modda baselineReleaseSha256 farklıysa veya sunucu asset'i yerel derlemeden >10dk daha yeniyse -> Hotfix algılanmalı
    const hotfixByBaseline = evaluateReleaseUpdate({
      currentVersion: '0.0.1',
      remoteTag: 'v0.0.1',
      baselineReleaseSha256: oldHash,
      remoteAssetDigest: `sha256:${newHash}`,
    })
    expect(hotfixByBaseline.updateAvailable).toBe(true)
    expect(hotfixByBaseline.isHotfixRebuild).toBe(true)

    const hotfixByTime = evaluateReleaseUpdate({
      currentVersion: '0.0.1',
      remoteTag: 'v0.0.1',
      remoteAssetDigest: `sha256:${newHash}`,
      localBuildMtimeMs: 1_700_000_000_000,
      remoteAssetUpdatedAt: new Date(1_700_000_900_000).toISOString(),
    })
    expect(hotfixByTime.updateAvailable).toBe(true)
    expect(hotfixByTime.isHotfixRebuild).toBe(true)
  })

  it('computeFileSha256 dosyanın gerçek SHA-256 özetini hesaplar', async () => {
    const tmpFile = path.join(os.tmpdir(), `jmc-sha-test-${Date.now()}.bin`)
    fs.writeFileSync(tmpFile, 'JustMyClass-SHA256-Test')
    try {
      const hash = await computeFileSha256(tmpFile)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        // ignore
      }
    }
  })
})

