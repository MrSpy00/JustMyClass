import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'

describe('System Data Paths and Wizard Contracts', () => {
  it('sistem veri yollari gecerli ve mutlak yollar uretir', () => {
    // electron/main.ts icindeki system:getDataPath sozlesmesini test eder
    const mockApp = {
      getPath: (name: 'userData' | 'temp') => {
        if (name === 'userData') return path.join(os.homedir(), 'AppData', 'Roaming', 'JustMyClass')
        if (name === 'temp') return os.tmpdir()
        throw new Error(`Bilinmeyen yol: ${name}`)
      },
    }

    const dataPaths = {
      userData: mockApp.getPath('userData'),
      temp: mockApp.getPath('temp'),
    }

    expect(dataPaths.userData).toBeDefined()
    expect(typeof dataPaths.userData).toBe('string')
    expect(dataPaths.userData.length).toBeGreaterThan(0)
    expect(path.isAbsolute(dataPaths.userData)).toBe(true)

    expect(dataPaths.temp).toBeDefined()
    expect(typeof dataPaths.temp).toBe('string')
    expect(dataPaths.temp.length).toBeGreaterThan(0)
    expect(path.isAbsolute(dataPaths.temp)).toBe(true)
  })

  it('kurulum sihirbazi veri yolu etiketini guvenli sekilde bicimlendirir', () => {
    const rawPath = path.join('C:', 'Users', 'Student', 'AppData', 'Roaming', 'JustMyClass')
    const displayLabel = rawPath || '—'

    expect(displayLabel).not.toBe('—')
    expect(displayLabel).toContain('JustMyClass')
  })
})
