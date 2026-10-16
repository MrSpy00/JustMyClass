import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { DriveService } from '../electron/services/driveService'
import type { Attachment } from '../types/jmc'

describe('Downloads Management and Inline Viewer Contracts', () => {
  it('varsayılan indirilenler klasörü doğru hesaplanır ve oluşturulabilir', () => {
    const defaultDownloads = path.join(os.homedir(), 'Downloads', 'JustMyClass')
    expect(defaultDownloads).toContain('JustMyClass')
    expect(path.isAbsolute(defaultDownloads)).toBe(true)
  })

  it('DriveService dosyayı kullanıcının indirilenler klasörüne doğrudan kaydeder', async () => {
    const tmpRoot = path.join(os.tmpdir(), 'jmc_test_dl_' + Date.now())
    const downloadsDir = path.join(tmpRoot, 'UserDownloads')
    fs.mkdirSync(downloadsDir, { recursive: true })

    const mockStorage = {
      getCachedFile: vi.fn().mockReturnValue(null),
      saveFileToCas: vi.fn().mockImplementation((_fileId, _courseId, _title, _mime, content) => {
        const hash = crypto.createHash('sha256').update(content).digest('hex')
        return { sha256: hash, absolutePath: path.join(tmpRoot, 'cas', hash) }
      }),
      saveCachedFile: vi.fn(),
      getCasPath: vi.fn().mockReturnValue(path.join(tmpRoot, 'cas', 'dummy')),
    }

    const mockVault = {
      getKey: vi.fn().mockReturnValue('fake-access-token'),
      setKey: vi.fn(),
      deleteKey: vi.fn(),
      hasKey: vi.fn(),
    }

    const driveService = new DriveService(mockStorage as any, mockVault as any, undefined, () => downloadsDir)

    // downloadAttachment mock fetch
    const fileBytes = new TextEncoder().encode('Hello JustMyClass Academic Document')
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(fileBytes.byteLength) }),
        arrayBuffer: async () => fileBytes.buffer,
      } as any
    })

    const sampleAttachment: Attachment = {
      id: 'att-123',
      title: 'Hafta3_DersNotu.pdf',
      driveFileId: 'drive-file-abc',
      mimeType: 'application/pdf',
    }

    const downloaded = await driveService.downloadAttachment(sampleAttachment, 'course-101')

    expect(downloaded.isLocalAvailable).toBe(true)
    expect(downloaded.downloadedPath).toBeDefined()
    expect(downloaded.downloadedPath).toContain('UserDownloads')
    expect(downloaded.downloadedPath).toContain('Hafta3_DersNotu.pdf')
    expect(fs.existsSync(downloaded.downloadedPath!)).toBe(true)

    // Dosya içeriğinin düzgün yazıldığını doğrula
    const savedContent = fs.readFileSync(downloaded.downloadedPath!, 'utf-8')
    expect(savedContent).toBe('Hello JustMyClass Academic Document')

    // Temizle
    globalFetch.mockRestore()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('Aynı isimde dosya indirildiğinde üzerine yazmak yerine sayaç ekler', async () => {
    const tmpRoot = path.join(os.tmpdir(), 'jmc_test_collision_' + Date.now())
    const downloadsDir = path.join(tmpRoot, 'Downloads')
    fs.mkdirSync(downloadsDir, { recursive: true })

    // Önceden var olan bir dosya oluştur
    const existingFile = path.join(downloadsDir, 'Odev1.docx')
    fs.writeFileSync(existingFile, 'Eski İçerik', 'utf-8')

    const mockStorage = {
      getCachedFile: vi.fn().mockReturnValue(null),
      saveFileToCas: vi.fn().mockImplementation((_fileId, _courseId, _title, _mime, content) => {
        const hash = crypto.createHash('sha256').update(content).digest('hex')
        return { sha256: hash, absolutePath: path.join(tmpRoot, 'cas', hash) }
      }),
      saveCachedFile: vi.fn(),
      getCasPath: vi.fn().mockReturnValue(path.join(tmpRoot, 'cas', 'dummy')),
    }

    const mockVault = {
      getKey: vi.fn().mockReturnValue('fake-access-token'),
      setKey: vi.fn(),
      deleteKey: vi.fn(),
      hasKey: vi.fn(),
    }

    const driveService = new DriveService(mockStorage as any, mockVault as any, undefined, () => downloadsDir)

    const fileBytes = new TextEncoder().encode('Yeni İndirilen Odev İçeriği')
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(fileBytes.byteLength) }),
        arrayBuffer: async () => fileBytes.buffer,
      } as any
    })

    const sampleAttachment: Attachment = {
      id: 'att-999',
      title: 'Odev1.docx',
      driveFileId: 'drive-999',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }

    const downloaded = await driveService.downloadAttachment(sampleAttachment, 'course-101')

    expect(downloaded.downloadedPath).toBeDefined()
    expect(downloaded.downloadedPath).toContain('Odev1 (1).docx')
    expect(fs.existsSync(downloaded.downloadedPath!)).toBe(true)
    expect(fs.readFileSync(existingFile, 'utf-8')).toBe('Eski İçerik')
    expect(fs.readFileSync(downloaded.downloadedPath!, 'utf-8')).toBe('Yeni İndirilen Odev İçeriği')

    globalFetch.mockRestore()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })
})
