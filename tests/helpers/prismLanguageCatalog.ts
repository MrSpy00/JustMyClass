/**
 * prismLanguageCatalog.ts (test yardimcisi)
 * ---------------------------------------------------------------------------
 * `node_modules/prismjs/components/` altindaki GERCEK dosya adlarindan
 * Prism dil katalogunu uretir.
 *
 * NEDEN VAR
 * ---------
 * "Kod renklendirme hic calismiyor" belirtisinin birinci nedeni, servis icindeki
 * uzanti -> dil haritasinda Prism'de OLMAYAN bir deger yazmasiydi (orn. `.asm`
 * -> `assembly`). Elle yazilmis bir test listesi zamanla geride kalir ve
 * hatayi yakalayamaz; bu yuzden katalog `prismjs/components/` klasorunden
 * TEK TEK dosya adlarindan turetilir.
 *
 * Bu dosya yalnizca TEST ortaminda (node) calisir; kaynak kodda kullanilmaz.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Kurulu tum `prism-<id>.js` dosyalarinin kimlikleri (min.js / core haric). */
export function installedPrismLanguages(): string[] {
  // `require.resolve('prismjs')` -> <paket>/prism.js ; components bir yanda
  const dir = path.join(path.dirname(require.resolve('prismjs')), 'components')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(name => /^prism-[a-z0-9#+.-]+\.js$/i.test(name))
    .map(name => name.replace(/^prism-/, '').replace(/\.js$/i, ''))
    .filter(id => id !== 'core')
    .sort()
}

/** Bir dil icin `prism-<id>` bilesen dosyasini yukler (yoksa false). */
export function loadPrismComponent(id: string): boolean {
  try {
    require(`prismjs/components/prism-${id}`)
    return true
  } catch {
    return false
  }
}

/**
 * `DocumentViewerModal.tsx` icindeki `PRISM_ALIASES` tablosunu okur.
 * Uretim kodunu CALISTIRMAZ (renderer + node bagimliliklari); yalnizca dosya
 * metnini okur.
 *
 * DONUS: `{ keys, targets }` — `keys` kisa adlardir (`vue`), `targets` gercek
 * gramer adlaridir (`markup`). Ikisi de cozumlenebilir sayilir.
 */
export function modalPrismAliases(source: string): { keys: string[]; targets: string[] } {
  const keys: string[] = []
  const targets: string[] = []
  const block = /const PRISM_ALIASES[^=]*=\s*\{([\s\S]*?)\n\}/.exec(source)
  if (!block) return { keys, targets }
  const re = /^\s*'?([a-z0-9#+.-]+)'?\s*:\s*'([^']+)'/gim
  let m: RegExpExecArray | null
  while ((m = re.exec(block[1])) !== null) {
    keys.push(m[1].toLowerCase())
    targets.push(m[2])
  }
  return { keys, targets }
}

/** Bir dosyadan `import 'prismjs/components/prism-<id>'` satirlarini toplar. */
export function modalPrismImports(source: string): string[] {
  const out: string[] = []
  const re = /import\s+'prismjs\/components\/prism-([a-z0-9#+.-]+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) out.push(m[1])
  return out
}
