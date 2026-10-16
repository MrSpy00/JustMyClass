import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * OAuth Yapilandirmasi (.env ve derleme ortami uzerinden)
 * ---------------------------------------------------------------------------
 * Google OAuth "Masaustu" istemci kimligi (Client ID) ve gizli anahtari
 * (Client Secret) kaynak kodunda ASLA DÜZ METİN OLARAK YAZILMAZ.
 *
 * Degerler su katmanlardan cozulur:
 *   1) Derleme aninda `.env` dosyasindan XOR maskesiyle gomulen degerler
 *   2) Calisma aninda ortam degiskenleri (`JMC_GOOGLE_CLIENT_ID`, `JMC_GOOGLE_CLIENT_SECRET`)
 *      veya calisma dizinindeki `.env` dosyasi
 *   3) Yerel gecersiz kilma dosyasi (`oauth.local.json`)
 */

declare const __JMC_GOOGLE_CLIENT_ID__: string | undefined
declare const __JMC_GOOGLE_CLIENT_SECRET__: string | undefined
declare const __JMC_GOOGLE_CLIENT_ID_ENC__: number[] | undefined
declare const __JMC_GOOGLE_CLIENT_SECRET_ENC__: number[] | undefined
declare const __JMC_OAUTH_MASK__: number[] | undefined

const LOCAL_OVERRIDE_FILE = 'oauth.local.json'

function xorDecode(encoded: number[] | undefined, mask: number[] | undefined): string {
  try {
    if (!Array.isArray(encoded) || !Array.isArray(mask) || encoded.length === 0 || mask.length === 0) {
      return ''
    }
    const buf = Buffer.alloc(encoded.length)
    for (let i = 0; i < encoded.length; i++) {
      buf[i] = (encoded[i] ^ mask[i % mask.length]) & 0xff
    }
    return buf.toString('utf8').trim()
  } catch {
    return ''
  }
}

function readInjectedClientId(): string {
  try {
    const mask = typeof __JMC_OAUTH_MASK__ !== 'undefined' ? __JMC_OAUTH_MASK__ : undefined
    const enc = typeof __JMC_GOOGLE_CLIENT_ID_ENC__ !== 'undefined' ? __JMC_GOOGLE_CLIENT_ID_ENC__ : undefined
    const decoded = xorDecode(enc, mask)
    if (decoded) return decoded
  } catch {
    /* yoksay */
  }
  try {
    const value = typeof __JMC_GOOGLE_CLIENT_ID__ === 'string' ? __JMC_GOOGLE_CLIENT_ID__ : ''
    return value.trim()
  } catch {
    return ''
  }
}

function readInjectedClientSecret(): string {
  try {
    const mask = typeof __JMC_OAUTH_MASK__ !== 'undefined' ? __JMC_OAUTH_MASK__ : undefined
    const enc =
      typeof __JMC_GOOGLE_CLIENT_SECRET_ENC__ !== 'undefined' ? __JMC_GOOGLE_CLIENT_SECRET_ENC__ : undefined
    const decoded = xorDecode(enc, mask)
    if (decoded) return decoded
  } catch {
    /* yoksay */
  }
  try {
    const value = typeof __JMC_GOOGLE_CLIENT_SECRET__ === 'string' ? __JMC_GOOGLE_CLIENT_SECRET__ : ''
    return value.trim()
  } catch {
    return ''
  }
}

function readRuntimeDotEnv(): Record<string, string> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return {}
  }
  const out: Record<string, string> = {}
  const roots = [process.cwd()]
  try {
    const appPath = app?.getAppPath?.()
    if (appPath && !roots.includes(appPath)) roots.push(appPath)
  } catch {
    /* yoksay */
  }

  for (const root of roots) {
    for (const name of ['.env.local', '.env']) {
      try {
        const file = path.join(root, name)
        if (!fs.existsSync(file)) continue
        for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
          const line = rawLine.trim()
          if (!line || line.startsWith('#')) continue
          const eq = line.indexOf('=')
          if (eq <= 0) continue
          const key = line.slice(0, eq).trim()
          let value = line.slice(eq + 1).trim()
          if (
            (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
            (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
          ) {
            value = value.slice(1, -1)
          }
          if (!(key in out)) out[key] = value
        }
      } catch {
        /* yoksay */
      }
    }
  }
  return out
}

function readEnvClientId(): string {
  try {
    const value = process.env.JMC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
    if (typeof value === 'string' && value.trim()) return value.trim()
    const dotEnv = readRuntimeDotEnv()
    return (dotEnv.JMC_GOOGLE_CLIENT_ID || dotEnv.GOOGLE_CLIENT_ID || '').trim()
  } catch {
    return ''
  }
}

function readEnvClientSecret(): string {
  try {
    const value = process.env.JMC_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
    if (typeof value === 'string' && value.trim()) return value.trim()
    const dotEnv = readRuntimeDotEnv()
    return (dotEnv.JMC_GOOGLE_CLIENT_SECRET || dotEnv.GOOGLE_CLIENT_SECRET || '').trim()
  } catch {
    return ''
  }
}

function readLocalOverride(): { clientId: string; clientSecret: string } {
  try {
    const userDataPath = app?.getPath('userData') || path.join(process.cwd(), '.jmc_data')
    const filePath = path.join(userDataPath, LOCAL_OVERRIDE_FILE)
    if (!fs.existsSync(filePath)) return { clientId: '', clientSecret: '' }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      clientId?: unknown
      clientSecret?: unknown
      client_id?: unknown
      client_secret?: unknown
    }
    const cid =
      typeof parsed.clientId === 'string'
        ? parsed.clientId.trim()
        : typeof parsed.client_id === 'string'
          ? parsed.client_id.trim()
          : ''
    const csec =
      typeof parsed.clientSecret === 'string'
        ? parsed.clientSecret.trim()
        : typeof parsed.client_secret === 'string'
          ? parsed.client_secret.trim()
          : ''
    return { clientId: cid, clientSecret: csec }
  } catch {
    return { clientId: '', clientSecret: '' }
  }
}

let cachedClientId: string | null = null
let cachedClientSecret: string | null = null

/** Uygulamanin kullanacagi istemci kimligi (bos string yapilandirilmadiysa). */
export function getInjectedGoogleClientId(): string {
  if (cachedClientId !== null) return cachedClientId
  cachedClientId =
    readInjectedClientId() || readEnvClientId() || readLocalOverride().clientId || ''
  return cachedClientId
}

/** Uygulamanin kullanacagi istemci gizli anahtari (bos string yapilandirilmadiysa). */
export function getInjectedGoogleClientSecret(): string {
  if (cachedClientSecret !== null) return cachedClientSecret
  cachedClientSecret =
    readInjectedClientSecret() || readEnvClientSecret() || readLocalOverride().clientSecret || ''
  return cachedClientSecret
}

/**
 * Kullaniciya gosterilecek kaynak aciklamasi. Tanilama ekraninda ve
 * ilk kurulum sihirbazinda gorunur; "bu kimlik nereden geliyor?"
 * sorusunu ekranda cevaplar.
 */
export function describeClientIdSource(): 'build' | 'env' | 'local' | 'none' {
  if (readInjectedClientId()) return 'build'
  if (readEnvClientId()) return 'env'
  if (readLocalOverride().clientId) return 'local'
  return 'none'
}

/** Testlerin ve tanilama ekraninin kullanacagi temizleme kancasi. */
export function resetClientIdCache(): void {
  cachedClientId = null
  cachedClientSecret = null
}