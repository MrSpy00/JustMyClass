/**
 * Yapilandirilmis uygulama gunlugu.
 *
 * SORUN
 * -----
 * Ana surecte 30'dan fazla `console.log/warn/error` cagrisi vardi. Ham
 * `console` uretimde su sorunlari yaratir:
 *
 * 1. SEVIYESIZ. Hata ile bilgi ayni kanala duser; kullanici "uygulama
 *    neden yavasa?" diye sordugunda elimizde neyin gercek hata, neyin
 *    bilgi oldugu ayirt edilemez.
 * 2. DOSYAYA YAZMAZ. Kullanici hatayi bildirdiginde elimizde gecerli
 *    kanit yok; "ekran goruntusu gonder"ten baska secenek sunamayiz.
 * 3. REPLICA EDILMEZ. Electron'da `console` cikisi varsayilan olarak
 *    konsola gider; paketlenmis uygulamada kullanici cogu zaman
 *    konsolu hic gormez.
 * 4. ASIRI VERI SIZINTISI RISKI. Kimlik dosyasi adi, dosya yolu veya
 *    saglayici ayri bir `console.log` ile ciktiya eklenir ve gelistirici
 *    gunlukleri paylasimda belki de kimlik materyali tasir.
 *
 * COZUM
 * -----
 * - Seviyeli: `error` > `warn` > `info` > `debug`. Uretimde `debug` kapali.
 * - Dosya havuzu: `userData/logs/justmyclass-YYYY-MM-DD.log`, 5 gun birikim.
 * - Merkezi temizleme: `redact()` cagrilardan ONCE gecer, yani bir
 *   gelistirici yanlislikla bir deger yazsa bile sifre/anahtar desenleri
 *   gunluge duz metin olarak girmez.
 * - `initLogger()` cagrilmadan once cagrilar konsola gider; boylece
 *   Electron `app` hazir olmadan gelen kayitlar kaybolmaz.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

const MAX_LOG_FILES = 5
const MAX_LOG_BYTES = 512 * 1024
let minLevel: LogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug'
let logDir: string | null = null
let initialized = false

/**
 * Cagrilardan once gecen metinden hassas degerleri temizler.
 *
 * Bu, bir gelistiricinin bir degeri yanlislikla yazmasina karsi son
 * savunma hattidir: gunluk dosyasi kullaniciyla paylasilabilir.
 */
export function redactLogText(input: string): string {
  let s = input
  // API anahtarlari (Google, OpenAI, Anthropic, xAI, Groq, DeepSeek ...)
  s = s.replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, '[REDACTED:gemini-key]')
  s = s.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED:api-key]')
  s = s.replace(/\bgsk_[A-Za-z0-9_-]{16,}\b/g, '[REDACTED:api-key]')
  s = s.replace(/\bxai-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED:api-key]')
  // Bearer / Authorization basliklari
  s = s.replace(/(authorization"?\s*[:=]\s*"?)(bearer\s+)?[A-Za-z0-9._~+/-]{12,}=*/gi, '$1[REDACTED]')
  // JSON/RAMPA icinde gizli degerler.
  //
  // `client_id` BILINCLI OLARAK listede DEGILDIR: OAuth `client_id` gizli
  // bir kimlik bilgisi DEGILDIR (masaustu istemcileri herkese aciktir) ve
  // "hangi Google Cloud projesi" ayrimi icin tanilamada gereklidir.
  // `client_secret` ise gercek siradir ve daima gizlenir.
  s = s.replace(
    /("(?:client_?secret|api_?key|apikey|password|refresh_?token|access_?token|session_?token|auth_?token|token)"\s*:\s*")([^"]{4,})(")/gi,
    '$1[REDACTED]$3',
  )
  return s
}

/** Gunluk dosyalari icin dizini hazirlar; `app` henuz hazir degilse sessizce gecer. */
export function initLogger(dataDir: string | null): void {
  logDir = dataDir ? path.join(dataDir, 'logs') : null
  initialized = true
  if (logDir) {
    try {
      fs.mkdirSync(logDir, { recursive: true })
      pruneOldLogs(logDir)
    } catch {
      logDir = null
    }
  }
}

/** Asiri eski gunlukleri ve asiri buyuk dosyalari temizler. */
function pruneOldLogs(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter(f => f.startsWith('justmyclass-') && f.endsWith('.log'))
      .sort()
      .reverse()
    for (const stale of files.slice(MAX_LOG_FILES)) {
      try {
        fs.unlinkSync(path.join(dir, stale))
      } catch {
        /* kilitli olabilir */
      }
    }
    // Bugunun dosyasi asiri buyudurse once kirp.
    const current = files[0]
    if (!current) return
    const currentPath = path.join(dir, current)
    if (fs.statSync(currentPath).size > MAX_LOG_BYTES) {
      const raw = fs.readFileSync(currentPath, 'utf8')
      fs.writeFileSync(currentPath, raw.slice(-Math.floor(MAX_LOG_BYTES / 2)))
    }
  } catch {
    /* temizlik basarisiz olabilir; gunluge yazmaya devam et */
  }
}

function writeLine(level: LogLevel, args: unknown[]): void {
  const message = args
    .map(a => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.name}: ${a.message}`
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')

  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${redactLogText(message)}`

  // 1) Konsol: her zaman gorunur (gelistirici tanilari icin).
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  sink(line)

  // 2) Dosya: yalnizca gercekten baslatildiysa ve duz metin kabul ediyorsa.
  if (!initialized || !logDir) return
  try {
    const day = new Date().toISOString().slice(0, 10)
    const file = path.join(logDir, `justmyclass-${day}.log`)
    // Yeni gunun dosyasi acildiginda eski gunlukleri BIR KEZ temizle.
    //
    // NEDEN: temizlik yalnizca `initLogger` icindeydi; kullanici uygulamayi
    // gunlerce kapali tutarsa gunlukler sinirsiz birikir. Yeni gun dosyasi
    // zaten guncellik isareti oldugu icinde dogru zaman noktasi burasidir.
    if (!fs.existsSync(file)) pruneOldLogs(logDir)
    // Cok satirli mesajlarda her satir ayri kayit gorunmesin.
    fs.appendFileSync(file, `${line.replace(/\n/g, ' ')}\n`, { mode: 0o600 })
  } catch {
    /* gunluk yazilamadi; konsol ciktisi yeterli */
  }
}

/** Gunluk seviyesini ayarlar (ayarlar ekranindan baglanabilir). */
export function setLogLevel(level: LogLevel): void {
  minLevel = level
}

export function getLogLevel(): LogLevel {
  return minLevel
}

/** Gunluk dosyalarinin bulundugu dizin (kullaniciya gostermek icin). */
export function getLogDir(): string | null {
  return logDir
}

function write(level: LogLevel, args: unknown[]): void {
  if (LEVEL_ORDER[level] > LEVEL_ORDER[minLevel]) return
  writeLine(level, args)
}

export const log = {
  error: (...args: unknown[]) => write('error', args),
  warn: (...args: unknown[]) => write('warn', args),
  info: (...args: unknown[]) => write('info', args),
  debug: (...args: unknown[]) => write('debug', args),
}

/** Electron hazir oldugunda cagrilir; veri dizini bulunur gunluge baglanir. */
export function initLoggerFromElectron(): void {
  try {
    const dir = app?.getPath?.('userData')
    initLogger(typeof dir === 'string' ? dir : null)
  } catch {
    initLogger(null)
  }
}