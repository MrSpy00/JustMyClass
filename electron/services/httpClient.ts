import { setTimeout as delay } from 'node:timers/promises'

/**
 * Google API'lerine yapilan tum cagrilar bu katmandan gecer.
 *
 * Amac:
 *  - Google'in yayimladigi kotalarin (varsayilan: istemci basina 4M/gun,
 *    istemci basina 3000/dk, kullanici basina 1200/dk) asilmamasini garanti
 *    etmek. Istemci tarafi bir sepet (token bucket) ile istekleri yavaslatir.
 *  - 429 / 5xx / ag hatalarinda tam jitter'li ustel backoff + Retry-After.
 *  - Es zamanli istekleri sinirlamak (asiri eszamanlilik kotayi patlatir).
 *  - Sayfalama döngülerinin KESILMEDEN tamamlanmasini garanti etmek.
 *    Kismi sonuc "tamamlandi" diye isaretlenmez; hata yuzeye cikar.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly bodySnippet?: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }

  /** 429: token gecersiz, yenilenmeli. 403: scope/rol eksik. 404: kaynak yok. */
  get isAuthError() {
    return this.status === 401
  }
  get isPermissionError() {
    return this.status === 403
  }
  get isNotFound() {
    return this.status === 404
  }
  get isRateLimited() {
    return this.status === 429 || this.status === 503
  }
}

/**
 * Bir bayt dizisini fetch'e verilebilir TAM boyutlu bir govdeye cevirir.
 *
 * `Buffer.slice()` bir KOPYA degil `subarray` takma adidir; `.buffer`
 * alani varsayilan olarak 8 KB/64 KB'lik Node tampon havuzunun tamamidir.
 * Havuzdan kiralanan kucuk bir govde icin bu, havuzun geri kalaniyla
 * (baska kiracilarin verileri dahil) birlikte gonderilmesine yol acar.
 * Bu yuzden her zaman yeni, tam boyutlu bir kopya uretilir.
 */
/**
 * Calisma zamanina gore en uygun fetch uygulamasini secer.
 * Electron ana surecinde (Chromium ag katmani) `net.fetch` kullanilir.
 * Bu sayede Windows sistem proxy ayarlari, kurumsal sertifikalar (universite/eduroam)
 * ve PAC betikleri otomatik olarak devreye girer.
 * Test ve Node ortamlarinda `globalThis.fetch` kullanilir.
 */
function getFetchImpl(): typeof fetch {
  try {
    if (typeof process !== 'undefined' && process.versions?.electron) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron')
      if (electron?.net?.fetch) {
        return electron.net.fetch.bind(electron.net)
      }
    }
  } catch {
    // fallback
  }
  return globalThis.fetch.bind(globalThis)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

class TokenBucket {
  private tokens: number
  private lastRefill = Date.now()

  constructor(private readonly capacity: number, private readonly refillPerSec: number) {
    this.tokens = capacity
  }

  async take(): Promise<void> {
    for (;;) {
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      const needed = 1 - this.tokens
      const waitMs = Math.max(20, Math.ceil((needed / this.refillPerSec) * 1000))
      await delay(waitMs)
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsedSec = (now - this.lastRefill) / 1000
    if (elapsedSec <= 0) return
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec)
    this.lastRefill = now
  }
}

export interface HttpClientOptions {
  /** Istek basina zaman asimi (ms). */
  timeoutMs?: number
  /** Es zamanli izin verilen azami istek sayisi. */
  maxConcurrency?: number
  /** Istemci basina saniyede azami istek (kota payini asmamak icin). */
  requestsPerSecond?: number
  /** Azami yeniden deneme sayisi (429 / 5xx icin). */
  maxRetries?: number
  /** Her istek icin User-Agent. */
  userAgent?: string
  /** Gelen hata govdesinin loglanacak maksimum uzunlugu. */
  maxBodySnippet?: number
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  /** Metin govdesi veya ikili govde (multipart upload gibi). */
  body?: string | Uint8Array
  /** Bu istek icin zaman asimini gecersiz kilar (uzun streaming icin). */
  timeoutMs?: number
  /** Streaming icin: donen Response govdesini oldugu gibi dondur. */
  raw?: boolean
  /** Bu istek icin yeniden deneme sinirini gecersiz kilar. */
  maxRetries?: number
  signal?: AbortSignal
}

export class HttpClient {
  private readonly bucket: TokenBucket
  private active = 0
  private readonly queue: Array<() => void> = []

  private readonly timeoutMs: number
  private readonly maxConcurrency: number
  private readonly maxRetries: number
  private readonly userAgent: string
  private readonly maxBodySnippet: number

  /** Uygulama genelinde gozlenebilir throttle sayaci (tanilama icin). */
  public stats = { requests: 0, retries: 0, rateLimited: 0, throttledMs: 0 }

  constructor(options: HttpClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 6)
    this.maxRetries = options.maxRetries ?? 5
    this.userAgent = options.userAgent ?? 'JustMyClass/1.0 (+https://github.com/MrSpy00/JustMyClass)'
    this.maxBodySnippet = options.maxBodySnippet ?? 300
    const rps = options.requestsPerSecond ?? 8
    this.bucket = new TokenBucket(Math.max(rps, 8), rps)
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1
      return
    }
    await new Promise<void>(resolve => this.queue.push(resolve))
    this.active += 1
  }

  /**
   * Es zamanlilik slotunu serbest birakir.
   *
   * HATANIN GELISMESI: eski surumde once `active` azaltiliyor, sonra
   * kuyruktaki siradaki istegin cozucusu cagriliyordu. cozucu bir
   * MICROTASK oldugu icin, `active` azaltildiktan sonra ama kuyruktaki
   * istek `active += 1` yapmadan once yeni bir istek `acquire()`'a
   * girebiliyor ve bos bulunan slotu aliyordu. Sonuc: kotada birden fazla
   * istek es zamanli akabiliyor (asiri es zamanlilik Google kotasini patlatir).
   *
   * COZUM: slot elden cikarken hemen kuyruktakine devredilir; arada
   * "bos gorunen" an olusmaz.
   */
  private release(): void {
    const next = this.queue.shift()
    if (next) {
      // Slot devredildi: sayac DUSURULMEZ, kuyruktaki istek zaten
      // sahiplenmis sayaci devralir.
      next()
    } else {
      this.active -= 1
    }
  }

  /**
   * Retry-After basligindan bekleme suresini hesaplar.
   *
   * Baslik iki bicimde gelebilir:
   *   1. Saniye sayisi: `Retry-After: 30`
   *   2. HTTP tarihi:  `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`
   *
   * Onceki surum yalnizca `Number(...)` deniyordu; HTTP tarihi `NaN`
   * donup Rastgele backoff'a dustugu icin sunucunun istedigi bekleme
   * hic uygulanmiyordu. Asagida iki bicim de islenir.
   */
  private async backoffDelay(attempt: number, retryAfterHeader?: string | null): Promise<number> {
    if (retryAfterHeader) {
      const raw = retryAfterHeader.trim()
      const seconds = Number(raw)
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, 60_000)
      }
      const asDate = Date.parse(raw)
      if (Number.isFinite(asDate)) {
        const deltaMs = asDate - Date.now()
        if (deltaMs > 0) return Math.min(deltaMs, 60_000)
      }
    }
    // Tam jitter ustel backoff: 1s, 2s, 4s, 8s ... + rastgele bilesen.
    const ceiling = Math.min(1000 * 2 ** attempt, 30_000)
    return Math.random() * ceiling
  }

  /**
   * CORS gerektirmeyen, zaman asimli, backoff'lu fetch.
   * `raw: true` ise Response nesnesi donulur (streaming icin) ve govde
   * tuketilmez.
   */
  public async request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      headers = {},
      body,
      raw = false,
      signal,
    } = options

    let lastError: Error | null = null
    const maxRetries = options.maxRetries ?? this.maxRetries

    // Dis iptal sinyali ISTEK BASLAMADAN once gelmis olabilir. Onceki
    // surumde `addEventListener('abort', ...)` yalnizca GELECEK olaylari
    // dinlerdi; `signal.aborted === true` ise bu denetimi tetiklemezdi,
    // boylece iptal edilmis bir sohbette istek yine gonderiliyordu.
    if (signal?.aborted) {
      throw new Error('Istek kullanici tarafindan iptal edildi.')
    }

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await this.bucket.take()
      await this.acquire()
      this.stats.requests += 1

      const controller = new AbortController()
      // YANIT DOLGUSUNDA beklemek istemeyen akis (streaming) icin
      // `timeoutMs: 0` "zaman asimi kapali" demektir.
      //
      // HATANIN GELISMESI: `setTimeout(..., options.timeoutMs ?? this.timeoutMs)`
      // yaziliyordu. `??` yalnizca null/undefined icin devreye girer; `0`
      // gecerli bir deger oldugu icin zaman asimi `0` ms OLARAK
      // ayarlaniyor ve `setTimeout` bir sonraki tikte tetiklenip istegi
      // ANINDA iptal ediyordu. Yani "zaman asimi kapali" demek, "hic
      // cevap alma" demek oluyordu - ve kodun kendi niyetinin tam tersi.
      const effectiveTimeout = options.timeoutMs ?? this.timeoutMs
      const timeout =
        effectiveTimeout > 0
          ? setTimeout(() => {
              controller.abort(new Error('Istek zaman asimina ugradi.'))
            }, effectiveTimeout)
          : null
      const onOuterAbort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', onOuterAbort, { once: true })

      // Ikili govde (multipart upload) icin fetch, Node Buffer/Uint8Array
      // nesnesini dogrudan BodyInit kabul etmez ve `view.buffer` alani
      // POOL'un TAMAMIDIR (Buffer.slice = subarray). Kucuk bir govde
      // yuzünden 64 KB havuz bellegi gonderilir ve multipart sonu
      // hizasindan cikar. Bu yuzden kopyalanmis, tam boyutlu bir
      // Uint8Array uretilir.
      const fetchBody: BodyInit | undefined =
        body === undefined || body === null
          ? undefined
          : typeof body === 'string'
            ? body
            : toArrayBuffer(body)

      try {
        const fetchFn = getFetchImpl()
        let response: Response
        try {
          response = await fetchFn(url, {
            method,
            headers: {
              'User-Agent': this.userAgent,
              Accept: 'application/json',
              ...headers,
            },
            body: fetchBody,
            signal: controller.signal,
            redirect: 'follow',
          })
        } catch (fetchErr) {
          // Chromium net.fetch proxy veya ağ katmanı hatası (net::ERR_CONNECTION_REFUSED vb.) verirse
          // doğrudan Node.js yerel fetch (undici) ile tekrar dene.
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
          if ((msg.includes('net::ERR_') || msg.includes('ECONNREFUSED') || msg.includes('Failed to fetch')) && typeof globalThis.fetch === 'function') {
            response = await globalThis.fetch(url, {
              method,
              headers: {
                'User-Agent': this.userAgent,
                Accept: 'application/json',
                ...headers,
              },
              body: fetchBody,
              signal: controller.signal,
              redirect: 'follow',
            })
          } else {
            throw fetchErr
          }
        }

        if (response.ok) {
          if (raw) {
            // Govde zaman asimini KUR; `clearStreamDeadline` ile kapatilir.
            // `effectiveTimeout <= 0` ise zaman asimi kapali demektir ve
            // burada da zamanlayici OLUSTURULMAZ.
            if (effectiveTimeout > 0) {
              const bodyDeadline = setTimeout(() => {
                controller.abort(new Error('Yanit akisi zaman asimina ugradi.'))
              }, Math.max(5_000, effectiveTimeout))
              ;(response as unknown as { __jmcBodyDeadline?: NodeJS.Timeout }).__jmcBodyDeadline =
                bodyDeadline
            }
            return response as unknown as T
          }
          const text = await response.text()
          if (!text) return null as unknown as T
          try {
            return JSON.parse(text) as T
          } catch {
            throw new HttpError(response.status, 'Sunucudan gelen yanit JSON degil.', text.slice(0, this.maxBodySnippet))
          }
        }

        const snippet = await response.text().catch(() => '')
        const err = new HttpError(
          response.status,
          `HTTP ${response.status} ${response.statusText}`.trim(),
          snippet.slice(0, this.maxBodySnippet),
        )

        // Yeniden denenmeyecek durumlar
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          throw err
        }
        if (response.status === 400) {
          throw err
        }

        lastError = err
        if (response.status === 429) this.stats.rateLimited += 1

        if (attempt < maxRetries) {
          this.stats.retries += 1
          const wait = await this.backoffDelay(attempt, response.headers.get('Retry-After'))
          this.stats.throttledMs += wait
          await delay(wait)
          continue
        }
        throw err
      } catch (err) {
        // Kullanici iptali veya kalici hatalar yeniden denenmez.
        if (err instanceof HttpError) throw err
        if (signal?.aborted) throw err
        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.includes('zaman asimi'))

        const cause = (err as any)?.cause
        const causeDetail = cause ? ` (${cause.code || cause.message || String(cause)})` : ''
        if (err instanceof Error && !err.message.includes('(') && causeDetail) {
          err.message = `${err.message}${causeDetail}`
        }

        lastError = err as Error
        if (attempt < maxRetries) {
          this.stats.retries += 1
          const wait = await this.backoffDelay(attempt)
          this.stats.throttledMs += wait
          await delay(wait)
          continue
        }
        throw lastError
      } finally {
        if (timeout) clearTimeout(timeout)
        signal?.removeEventListener('abort', onOuterAbort)
        this.release()
      }
    }

    throw lastError ?? new Error('Bilinmeyen ag hatasi.')
  }

  /**
   * Akis (raw) yanitlarinin govde zaman asiminu temizler.
   *
   * `request()` bir `Response` dondurup `finally` blogundan cikan zaman
   * asimini temizler. Akis modunda govde okunmaya devam eder; bu
   * yardimci, dondurulen `Response` uzerinden bekleyen zaman asimini
   * kapatir. Cagiran taraf `iterateStream` bittikten sonra cagirir.
   */
  public static clearStreamDeadline(response: unknown): void {
    const deadline = (response as { __jmcBodyDeadline?: NodeJS.Timeout } | null | undefined)
      ? (response as { __jmcBodyDeadline?: NodeJS.Timeout }).__jmcBodyDeadline
      : undefined
    if (deadline) {
      clearTimeout(deadline)
      ;(response as { __jmcBodyDeadline?: undefined }).__jmcBodyDeadline = undefined
    }
  }

  /**
   * Google'in sayfalama sozlesmesini tam olarak uygular.
   *
   * `nextPageToken` donduruldugu surece devam eder. Ilk sayfa alinamazsa
   * hata firlatir; hicbir durumda kismi listeyi "tamam" diye dondurmez.
   */
  public async paginate<T>(
    buildUrl: (pageToken?: string) => string,
    select: (payload: any) => T[] | undefined,
    options: RequestOptions & { maxPages?: number } = {},
  ): Promise<T[]> {
    const maxPages = options.maxPages ?? 2000
    const collected: T[] = []
    let pageToken: string | undefined
    let pages = 0

    for (;;) {
      const url = buildUrl(pageToken)
      const payload: any = await this.request<any>(url, options)

      const page = select(payload)
      if (Array.isArray(page)) collected.push(...page)

      pages += 1
      pageToken = payload?.nextPageToken || undefined

      if (!pageToken) break
      if (pages >= maxPages) {
        throw new Error(
          `Sayfalama guvenlik sinirina ulasildi (${maxPages} sayfa). Eksik veri oldugu ihtimali icin islem durduruldu.`,
        )
      }
    }

    return collected
  }
}

/** Uygulama genelinde paylasilan, kotaya saygili tek istemci. */
export const googleHttp = new HttpClient({
  timeoutMs: 30_000,
  maxConcurrency: 6,
  requestsPerSecond: 8,
  maxRetries: 5,
})

/** AI saglayici baglantilarini test etmek icin ayri, daha esnek istemci. */
export const providerHttp = new HttpClient({
  timeoutMs: 15_000,
  maxConcurrency: 4,
  requestsPerSecond: 4,
  maxRetries: 1,
})