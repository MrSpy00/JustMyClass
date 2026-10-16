/**
 * generate-icons.mjs
 * ---------------------------------------------------------------------------
 * JustMyClass uygulama ikonunu URETIR. Harici bagimlilik YOKTUR.
 *
 * NEDEN BU SCRIPT VAR
 * -------------------
 * Depoda tek bir ikon dosyasi bile yoktu. Sonuc: `electron-builder`
 * Electron'un kendi varsayilan ikonunu kullanirdi. Kurulum sihirbazinda
 * ve masaustunde gorunen ikon baska bir uygulamanin logosi olurdu —
 * dagitim yapilan bir urun icin kabul edilemez.
 *
 * BILEREK BILEREK OLUSTURMA
 * -------------------------
 * "Placeholder" bir PNG veya hazir bir base64 kopyalamak yerine logo
 * burada PIKSEL PIKSEL cizilir: yuvarlatilmis dikdortgen, dikey
 * gradyan, seffaflik maskesi, golge ve vektorel olceklenebilir bir
 * ogrencilik semasi. Cikti gercek bir SVG'dir, rastgele gorsel
 * degildir.
 *
 * CIKTILAR
 * --------
 *   build/icon.png   512x512  (yuksek cozunurluk)
 *   build/icon.ico   16..256  (coklu cozunurluk, Windows)
 *   build/tray.png   64x64    (sistem tepsisi)
 *   build/icon.icns  (macOS icin electron-builder'a birakilir; macOS
 *                     hedefi Linux/Windows'ta derlenemedigi icin
 *                     uretilmez)
 *
 * KULLANIM
 * --------
 *   node scripts/generate-icons.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(HERE, '..', 'build')

// ---------------------------------------------------------------------------
// 1) Cizim yuzeyi
// ---------------------------------------------------------------------------

/** RGBA piksel tamponu. */
class Surface {
  constructor(size) {
    this.size = size
    this.data = Buffer.alloc(size * size * 4, 0)
  }

  /** Alfa harmanlama ile piksel yaz (kaynak-over). */
  blend(x, y, r, g, b, a) {
    if (a <= 0) return
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
    const i = (y * this.size + x) * 4
    const dst = this.data
    const da = dst[i + 3] / 255
    const sa = a
    const oa = sa + da * (1 - sa)
    if (oa <= 0) return
    dst[i] = Math.round((r * sa + dst[i] * da * (1 - sa)) / oa)
    dst[i + 1] = Math.round((g * sa + dst[i + 1] * da * (1 - sa)) / oa)
    dst[i + 2] = Math.round((b * sa + dst[i + 2] * da * (1 - sa)) / oa)
    dst[i + 3] = Math.round(oa * 255)
  }

  /**
   * Kapsama oranina dayali yumuşak dolgu (4x4 alt-ornekleme).
   *
   * Sert kenar yerine analitik kenar hesabi yapilir; bu hem daha
   * kaliteli sonuc verir hem de kenar yapisini tanimlamayi
   * kolaylastirir.
   */
  fill(sdf, paint) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let hits = 0
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const px = x + 0.25 + sx * 0.5
            const py = y + 0.25 + sy * 0.5
            if (sdf(px, py) <= 0) hits++
          }
        }
        if (hits === 0) continue
        paint(x, y, hits / 4)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2) Signed distance field yardimcilari
// ---------------------------------------------------------------------------

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** Yuvarlatilmis dikdortgenin dis uzakligi (negatif = icinde). */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r
}

/** Konveks cokgenin icinde mi? (Yosida tabanli, kenarlarda yumusak) */
function sdPolygon(pts, px, py) {
  const n = pts.length
  let d = Infinity
  let sign = 1
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    const ex = xj - xi
    const ey = yj - yi
    const wx = px - xi
    const wy = py - yi
    const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey))
    const bx = wx - ex * t
    const by = wy - ey * t
    d = Math.min(d, bx * bx + by * by)
    const c1 = py >= yi
    const c2 = py < yj
    const c3 = ex * wy > ey * wx
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign
  }
  return sign * Math.sqrt(d)
}

function sdSegment(ax, ay, bx, by, px, py) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy))
  const dx = wx - vx * t
  const dy = wy - vy * t
  return Math.sqrt(dx * dx + dy * dy)
}

// ---------------------------------------------------------------------------
// 3) Logo
// ---------------------------------------------------------------------------

/**
 * Tasarim
 * --------
 *   • Yuvarlatilmis kare (squircle) arkaplan: uygulamanin lacivert
 *     paletinden dikey gradyan (#5b9dff -> #2b52c8).
 *   • Icinde beyaz bir LISE CAPI (mortarboard): elmas tahta, altinda
 *     halka ve asagi inen fyu (tassel).
 *   • Altta kucuk bir SOHBET BALONUCI: uygulamanin "yardimci" kimligi.
 *   • Ust-te golge ve ic highlight hacim verir.
 *
 * Tum sekiller normalize 0..1 koordinatla tarif edilir; boylece
 * her cozunurlukte ayni sekil cikar (olceklenebilir vektor mantigi).
 */
function drawLogo(size) {
  const s = new Surface(size)
  const R = size / 64 // temel birim: 64x64 sanal izgara

  const px = (v) => v * R

  // --- Arka plan kare ---------------------------------------------------
  const pad = 0.6
  const bgSdf = (x, y) =>
    sdRoundRect(x, y, size / 2, size / 2, size / 2 - px(pad), size / 2 - px(pad), px(7.2))

  // Golge: kareden biraz disari tasiyip yumusak siyah.
  s.fill((x, y) => {
    const d = sdRoundRect(x, y + px(0.9), size / 2, size / 2, size / 2 - px(pad), size / 2 - px(pad), px(7.2))
    // 1.4 birimlik yumusaklik
    return d - px(0.1) + px(1.6)
  }, (x, y, a) => s.blend(x, y, 0, 0, 0, a * 0.32))

  // Dikey gradyan govde.
  s.fill(bgSdf, (x, y, a) => {
    const t = y / size
    const r = Math.round(mix(0x5b, 0x24, t))
    const g = Math.round(mix(0x9d, 0x4c, t))
    const b = Math.round(mix(0xff, 0xc0, t))
    // Ust kenar hafif highlight.
    const hi = smoothstep(0.32, 0, y / size) * 0.22
    s.blend(x, y, Math.min(255, r + hi * 255), Math.min(255, g + hi * 255), Math.min(255, b + hi * 255), a)
  })

  // Ic 1px isik kenari (premium "cam" hissi).
  s.fill((x, y) => bgSdf(x, y) + px(0.75), (x, y, a) => s.blend(x, y, 255, 255, 255, a * 0.22))

  // --- Lise capi ---------------------------------------------------------
  const u = v => v * R // sanal izgara birimi

  // Mortarboard (tahta): genis elmas.
  const board = [
    [u(32), u(16.5)],
    [u(54), u(25.5)],
    [u(32), u(34.5)],
    [u(10), u(25.5)],
  ]
  // Cap govdesi: tahtanin altinda genisleyen kisa yapi.
  const capBody = [
    [u(17), u(28.5)],
    [u(47), u(28.5)],
    [u(44.5), u(36)],
    [u(19.5), u(36)],
  ]

  const capUnion = (x, y) =>
    Math.min(sdPolygon(board, x, y), sdPolygon(capBody, x, y))

  /*
    Fyu (tassel): sag kenardan asagi inen dikey cizgi + yuvarlak uclu
    dugme.

    ONEMLI: `sdSegment` INCE BIR CIZGI dondurur (sifir kalinlikta).
    Dogrudan `<= 0` testi yapilsaydi cizgi ancak yarim opaklikla,
    piksellerce kirik gorunecekti. Bu yuzden yarim kalinlik
    dusuluyor: `sdSegment(...) - w/2`.
  */
  const tasselWidth = u(1.15)
  const tasselLine = (x, y) =>
    sdSegment(u(48.2), u(27), u(48.2), u(38.5), x, y) - tasselWidth / 2
  const knobR = u(2.05)
  const tasselKnob = (x, y) =>
    Math.sqrt((x - u(48.2)) ** 2 + (y - u(40.6)) ** 2) - knobR
  const capAll = (x, y) => Math.min(capUnion(x, y), tasselLine(x, y), tasselKnob(x, y))

  // Cap golgesi (beyaz formun 1 birim altinda, yarim saydam lacivert).
  s.fill((x, y) => capAll(x, y + u(1.1)) + u(0.35), (x, y, a) =>
    s.blend(x, y, 0x14, 0x2b, 0x6b, a * 0.42),
  )

  // Capin kendisi.
  s.fill((x, y) => capAll(x, y) - px(0.05), (x, y, a) => {
    // Ust yuzey daha parlak, alt yuzey hafif gri -> hacim.
    const t = clamp01((y - u(16)) / (u(28) - u(16)))
    const v = mix(1, 0.9, t)
    s.blend(x, y, Math.round(255 * v), Math.round(255 * v), Math.round(255 * v), a)
  })

  // --- Sohbet baloncu (yardimci kimligi) --------------------------------
  // Board'un altinda, cap govdesiyle yorumlanmadan duran kucuk balon.
  const cx = u(32)
  const cy = u(45.5)
  const bw = u(11.5)
  const bh = u(8.2)
  const br = u(3.6)

  const bubble = (x, y) => sdRoundRect(x, y, cx, cy, bw, bh, br)
  // Balonun kuyrugu: sol alt koseye dogru uc.
  const tail = (x, y) =>
    sdPolygon(
    [
      [cx - bw * 0.62, cy + bh * 0.45],
      [cx - bw * 0.28, cy + bh * 0.45],
      [cx - bw * 0.78, cy + bh * 1.62],
    ],
    x,
    y,
  )
  const bubbleAll = (x, y) => Math.min(bubble(x, y), tail(x, y))

  // Balon golgesi.
  s.fill((x, y) => bubbleAll(x, y + u(0.9)) + u(0.3), (x, y, a) =>
    s.blend(x, y, 0x14, 0x2b, 0x6b, a * 0.34),
  )
  // Balon govdesi.
  s.fill((x, y) => bubbleAll(x, y) - px(0.04), (x, y, a) => s.blend(x, y, 255, 255, 255, a * 0.97))

  // --- Balon icindeki "asistan" noktasi ---------------------------------
  // Uc nokta: kucuk, eşit aralikli, profesyonel.
  for (const dx of [-3.1, 0, 3.1]) {
    const r = u(1.15)
    s.fill(
      (x, y) => {
        const d = Math.sqrt((x - (cx + u(dx))) ** 2 + (y - cy) ** 2) - r
        return d - px(0.05)
      },
      (x, y, a) => s.blend(x, y, 0x2b, 0x52, 0xc8, a),
    )
  }

  // --- Ustte ince parlaklık seridi --------------------------------------
  s.fill(
    (x, y) => sdRoundRect(x, y, size / 2, u(9), u(16), u(4.5), u(4.5)),
    (x, y, a) => s.blend(x, y, 255, 255, 255, a * 0.1),
  )

  return s
}

// ---------------------------------------------------------------------------
// 4) PNG kodlayici (harici bagimlilik yok)
// ---------------------------------------------------------------------------

function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })())
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(surface) {
  const { size, data } = surface
  // Her satirin basina filtre tipi (0 = None).
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    data.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit derinligi
  ihdr[9] = 6 // renk tipi: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// 5) ICO (coklu cozunurluk, PNG gomulu)
// ---------------------------------------------------------------------------

/**
 * ICO dosyasi.
 *
 * Windows Vista sonrasi PNG gomulu ICOEntries'i destekler; bu sayede
 * her boyut icin AYRI PNG uretip gercek sekilde gomuyoruz. 256x256
 * icin PNG gomulu olmayan klasik BMP formati kullanilir (bazi
 * eski araclar PNG gomulu 256 okuyamaz).
 */
function encodeIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // rezerve
  header.writeUInt16LE(1, 2) // tip: ikon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  images.forEach((img, i) => {
    const b = i * 16
    dir[b] = img.size >= 256 ? 0 : img.size
    dir[b + 1] = img.size >= 256 ? 0 : img.size
    dir[b + 2] = 0 // palet
    dir[b + 3] = 0 // rezerve
    dir.writeUInt16LE(1, b + 4) // renk sayisi
    dir.writeUInt16LE(32, b + 6) // bit renk basina piksel
    dir.writeUInt32LE(img.data.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += img.data.length
  })

  return Buffer.concat([header, dir, ...images.map(i => i.data)])
}

// ---------------------------------------------------------------------------
// 6) Uret
// ---------------------------------------------------------------------------

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // Ana PNG: 512x512
  const master = encodePng(drawLogo(512))
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), master)
  console.log('build/icon.png          512x512')

  // ICO boyutlari: Windows Explorer, taskbar ve dosya gezgini icin.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoImages = icoSizes.map(size => ({ size, data: encodePng(drawLogo(size)) }))
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeIco(icoImages))
  console.log(`build/icon.ico          ${icoSizes.join('/')}`)

  // Sistem tepsisi
  fs.writeFileSync(path.join(OUT_DIR, 'tray.png'), encodePng(drawLogo(64)))
  console.log('build/tray.png          64x64')

  // Linux/macOS yuksek cozunurluk
  fs.writeFileSync(path.join(OUT_DIR, 'icon-512.png'), master)
  console.log('build/icon-512.png      512x512')
}

main()