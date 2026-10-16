import { defineConfig } from 'vite'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Derleme aninda gomulecek degerleri `.env` dosyasindan okur.
 *
 * Vite'in kendi `loadEnv` yardimcisi yerine bilincli olarak izole bir
 * ayristirma kullanilir: bu degerler yalnizca main surece maskelenerek
 * gomulur ve hicbir zaman arayuze (renderer) veya preload'a sizmamalidir.
 */
function readDotEnv(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of ['.env.local', '.env']) {
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
      if (!(key in out)) {
        out[key] = value
      }
    }
  }
  return out
}

/**
 * Eger `.env` icinde `JMC_GOOGLE_CLIENT_SECRET` eksik kalmissa ve
 * gelistirici ortaminda `client_secret_*.json` dosyasi mevcutsa,
 * `.env` dosyasini otomatik tamamlar; boylece tum degerler `.env`
 * uzerinden tek merkezden okunur.
 */
function ensureEnvSyncedFromLocalJson(root: string, currentEnv: Record<string, string>): void {
  const existingId = (
    currentEnv.JMC_GOOGLE_CLIENT_ID ||
    currentEnv.GOOGLE_CLIENT_ID ||
    ''
  ).trim()
  const existingSecret = (
    currentEnv.JMC_GOOGLE_CLIENT_SECRET ||
    currentEnv.GOOGLE_CLIENT_SECRET ||
    ''
  ).trim()

  if (existingId && existingSecret) return

  const searchDirs = [root]
  try {
    const desktop = path.join(os.homedir(), 'Desktop')
    if (fs.existsSync(desktop)) searchDirs.push(desktop)
  } catch {
    /* yoksay */
  }

  for (const dir of searchDirs) {
    try {
      const files = fs.readdirSync(dir)
      for (const file of files) {
        if (!file.startsWith('client_secret_') || !file.endsWith('.json')) continue
        const raw = fs.readFileSync(path.join(dir, file), 'utf8')
        const parsed = JSON.parse(raw)
        const creds = parsed.installed || parsed.web || parsed
        const jsonId = typeof creds?.client_id === 'string' ? creds.client_id.trim() : ''
        const jsonSecret = typeof creds?.client_secret === 'string' ? creds.client_secret.trim() : ''
        if (!jsonId) continue
        if (existingId && existingId !== jsonId) continue

        if (!existingId && jsonId) {
          currentEnv.JMC_GOOGLE_CLIENT_ID = jsonId
        }
        if (!existingSecret && jsonSecret) {
          currentEnv.JMC_GOOGLE_CLIENT_SECRET = jsonSecret
        }

        // `.env` dosyasinda eksik olan anahtarlari `.env`'ye tamamla
        const envFile = path.join(root, '.env')
        if (fs.existsSync(envFile)) {
          const envContent = fs.readFileSync(envFile, 'utf8')
          const additions: string[] = []
          if (!/^\s*JMC_GOOGLE_CLIENT_ID\s*=/m.test(envContent) && currentEnv.JMC_GOOGLE_CLIENT_ID) {
            additions.push(`JMC_GOOGLE_CLIENT_ID=${currentEnv.JMC_GOOGLE_CLIENT_ID}`)
          }
          if (!/^\s*JMC_GOOGLE_CLIENT_SECRET\s*=/m.test(envContent) && currentEnv.JMC_GOOGLE_CLIENT_SECRET) {
            additions.push(`JMC_GOOGLE_CLIENT_SECRET=${currentEnv.JMC_GOOGLE_CLIENT_SECRET}`)
          }
          if (additions.length > 0) {
            const prefix = envContent.endsWith('\n') ? '' : '\n'
            fs.appendFileSync(envFile, `${prefix}${additions.join('\n')}\n`, 'utf8')
          }
        }
        return
      }
    } catch {
      /* yoksay */
    }
  }
}

const dotEnv = readDotEnv(__dirname)
ensureEnvSyncedFromLocalJson(__dirname, dotEnv)

/**
 * OAuth istemci kimligi ve secret kaynak kodunda bulunmaz; yalnizca `.env`
 * veya ortam degiskeninden okunur ve derleme aninda XOR maskesiyle gomulur.
 */
const googleClientId = (
  process.env.JMC_GOOGLE_CLIENT_ID ??
  process.env.GOOGLE_CLIENT_ID ??
  dotEnv.JMC_GOOGLE_CLIENT_ID ??
  dotEnv.GOOGLE_CLIENT_ID ??
  ''
).trim()

const googleClientSecret = (
  process.env.JMC_GOOGLE_CLIENT_SECRET ??
  process.env.GOOGLE_CLIENT_SECRET ??
  dotEnv.JMC_GOOGLE_CLIENT_SECRET ??
  dotEnv.GOOGLE_CLIENT_SECRET ??
  ''
).trim()

const buildMask = crypto.randomBytes(32)

function xorEncode(plain: string, mask: Buffer): number[] {
  if (!plain) return []
  const buf = Buffer.from(plain, 'utf8')
  const out: number[] = new Array(buf.length)
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ mask[i % mask.length]
  }
  return out
}

const oauthDefine = {
  __JMC_GOOGLE_CLIENT_ID_ENC__: JSON.stringify(xorEncode(googleClientId, buildMask)),
  __JMC_GOOGLE_CLIENT_SECRET_ENC__: JSON.stringify(xorEncode(googleClientSecret, buildMask)),
  __JMC_OAUTH_MASK__: JSON.stringify(Array.from(buildMask)),
}

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          markdown: ['react-markdown', 'remark-gfm'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          define: oauthDefine,
          build: {
            outDir: 'dist-electron',
            sourcemap: false,
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: false,
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
