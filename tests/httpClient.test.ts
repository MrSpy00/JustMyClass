import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * HttpClient testleri.
 *
 * Bu katman HER AI SAGLAYICI isteginin gectigi yerdir; buradaki bir hata
 * tum saglayicilari ayni anda etkiler. Odak: iptal, zaman asimi, yeniden
 * deneme ve es zamanlilik sinirlari.
 */

const { HttpClient, HttpError } = await import('../electron/services/httpClient')

/**
 * Kontrol edilebilir sahte fetch.
 *
 * ONEMLI: gercek `fetch` `init.signal` iptal EDILDIĞINDE reddeder. Sahte
 * fonksiyon bunu yapmazsa, iptal testleri "hata firlatmaz" sanilan bir
 * kilitlenmeye donusur ve gercek bir regresyon gizlenir. Bu yuzden sinyal
 * her zaman taklit edilir.
 */
function makeFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let handler: (url: string, init: RequestInit, callIndex: number) => Promise<Response> | Response

  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const idx = calls.length
    calls.push({ url, init })
    const result = await handler(url, init, idx)
    const signal = init.signal as AbortSignal | undefined
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    return result
  })
  return {
    fn,
    calls,
    setHandler: (h: typeof handler) => {
      handler = h
    },
  }
}

/**
 * Sinyal iptal edilene kadar ASLA resolve etmeyen bir fetch.
 * Gercek `fetch` gibi iptalde reddeder.
 */
function hangingFetch() {
  const fn = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined
        const abort = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        if (signal?.aborted) abort()
        else signal?.addEventListener('abort', abort, { once: true })
      }),
  )
  return fn
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

let realFetch: typeof globalThis.fetch
let fake: ReturnType<typeof makeFetch>

beforeEach(() => {
  realFetch = globalThis.fetch
  fake = makeFetch()
  globalThis.fetch = fake.fn as unknown as typeof globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

/** Geri cekilmeden hizli calistirmak icin bekleme suresini sifirlar. */
function fastClient(overrides: Record<string, unknown> = {}) {
  return new HttpClient({
    timeoutMs: 5_000,
    maxRetries: 2,
    maxConcurrency: 2,
    requestsPerSecond: 1000,
    ...overrides,
  })
}

describe('HttpClient', () => {
  describe('temel istek', () => {
    it('JSON yanitini cozer', async () => {
      fake.setHandler(() => jsonResponse({ ok: true, items: [1, 2] }))
      const c = fastClient()
      const r = await c.request<{ ok: boolean }>('https://x.test/a')
      expect(r).toEqual({ ok: true, items: [1, 2] })
    })

    it('bos govde icin null doner', async () => {
      fake.setHandler(() => new Response('', { status: 200 }))
      const c = fastClient()
      expect(await c.request('https://x.test/a')).toBeNull()
    })

    it('varsayilan User-Agent ekler', async () => {
      fake.setHandler(() => jsonResponse({}))
      await fastClient().request('https://x.test/a')
      const headers = fake.calls[0].init.headers as Record<string, string>
      expect(headers['User-Agent']).toMatch(/JustMyClass/)
    })

    it('cagiranin basligi varsayilani EZMEZ', async () => {
      fake.setHandler(() => jsonResponse({}))
      await fastClient().request('https://x.test/a', { headers: { Accept: 'text/plain', 'X-Kendi': '1' } })
      const headers = fake.calls[0].init.headers as Record<string, string>
      expect(headers.Accept).toBe('text/plain')
      expect(headers['X-Kendi']).toBe('1')
    })

    it('govdesi gonderir', async () => {
      fake.setHandler(() => jsonResponse({}))
      await fastClient().request('https://x.test/a', { method: 'POST', body: '{"x":1}' })
      expect(fake.calls[0].init.method).toBe('POST')
      expect(fake.calls[0].init.body).toBe('{"x":1}')
    })
  })

  describe('zaman asimi', () => {
    it('varsayilan zaman asimi uygulanir', async () => {
      // Gercek fetch gibi davran: sinyal iptal edilince reddet.
      globalThis.fetch = hangingFetch() as unknown as typeof globalThis.fetch
      const c = fastClient({ timeoutMs: 30, maxRetries: 0 })
      await expect(c.request('https://x.test/a')).rejects.toThrow()
    })

    it('timeoutMs: 0 istegi ANINDA iptal ETMEZ (kritik regresyon)', async () => {
      // Bu, bulunan gercek hatayi kilitler: `??` operatoru 0'i gecerli
      // saydigindan setTimeout(..., 0) bir sonraki tikte istegi iptal
      // ediyordu; yani "zaman asimi kapali" "hic cevap alma" oluyordu.
      fake.setHandler(async () => {
        await new Promise(res => setTimeout(res, 40))
        return jsonResponse({ gec: true })
      })
      const c = fastClient({ timeoutMs: 0, maxRetries: 0 })
      const r = await c.request<{ gec: boolean }>('https://x.test/a', { timeoutMs: 0 })
      expect(r).toEqual({ gec: true })
    })

    it('timeoutMs: 0 ile akis (raw) modu da calisir', async () => {
      fake.setHandler(async () => {
        await new Promise(res => setTimeout(res, 30))
        return jsonResponse({})
      })
      const c = fastClient({ timeoutMs: 0, maxRetries: 0 })
      const resp = await c.request<Response>('https://x.test/a', { timeoutMs: 0, raw: true })
      expect(resp.ok).toBe(true)
    })
  })

  describe('iptal', () => {
    it('dış iptal isteği durdurur', async () => {
      globalThis.fetch = hangingFetch() as unknown as typeof globalThis.fetch
      const c = fastClient({ maxRetries: 0 })
      const controller = new AbortController()
      const p = c.request('https://x.test/a', { signal: controller.signal })
      setTimeout(() => controller.abort(), 20)
      await expect(p).rejects.toThrow()
    })

    it('ISTENEN ZAMAN once iptal edilmis signal HATA verir (istek hic gonderilmez)', async () => {
      fake.setHandler(() => jsonResponse({}))
      const c = fastClient({ maxRetries: 0 })
      const controller = new AbortController()
      controller.abort()
      await expect(c.request('https://x.test/a', { signal: controller.signal })).rejects.toThrow(/iptal/i)
      expect(fake.calls.length).toBe(0)
    })
  })

  describe('hata siniflandirma', () => {
    it('401/403/404/400 YENIDEN DENENMEZ', async () => {
      for (const status of [401, 403, 404, 400]) {
        const f = makeFetch()
        globalThis.fetch = f.fn as unknown as typeof globalThis.fetch
        f.setHandler(() => jsonResponse({ hata: true }, status))
        const c = fastClient({ maxRetries: 3 })
        await expect(c.request('https://x.test/a')).rejects.toThrow(HttpError)
        expect(f.calls.length, `${status} tekrar denenmemeliydi`).toBe(1)
      }
    })

    it('429 ve 5xx yeniden DENENIR', async () => {
      for (const status of [429, 500, 502, 503]) {
        const f = makeFetch()
        globalThis.fetch = f.fn as unknown as typeof globalThis.fetch
        f.setHandler((_u, _i, idx) => (idx < 1 ? jsonResponse({ e: 1 }, status) : jsonResponse({ basarili: true })))
        const c = fastClient({ maxRetries: 2 })
        const r = await c.request<{ basarili: boolean }>('https://x.test/a')
        expect(r, `${status} yeniden denenmeliydi`).toEqual({ basarili: true })
        expect(f.calls.length).toBe(2)
      }
    })

    it('yeniden deneme sayacini artirir', async () => {
      fake.setHandler((_u, _i, idx) => (idx < 2 ? jsonResponse({}, 503) : jsonResponse({})))
      const c = fastClient({ maxRetries: 3 })
      await c.request('https://x.test/a')
      expect(c.stats.retries).toBeGreaterThanOrEqual(2)
    })

    it('istatistikler istek ve kota sayacini tutar', async () => {
      fake.setHandler((_u, _i, idx) => (idx < 1 ? jsonResponse({}, 429) : jsonResponse({})))
      const c = fastClient({ maxRetries: 2 })
      await c.request('https://x.test/a')
      expect(c.stats.requests).toBeGreaterThanOrEqual(2)
      expect(c.stats.rateLimited).toBe(1)
    })

    it('HATA GOVDESINI kisaltir', async () => {
      const long = 'x'.repeat(5000)
      fake.setHandler(() => new Response(long, { status: 500, statusText: 'Server Error' }))
      const c = fastClient({ maxRetries: 0, maxBodySnippet: 50 })
      try {
        await c.request('https://x.test/a')
        expect.unreachable('hata firlatilmaliydi')
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError)
        expect((e as HttpError).bodySnippet!.length).toBeLessThanOrEqual(50)
      }
    })

    it('JSON OLMAYAN basarili yaniti hata sayar', async () => {
      fake.setHandler(() => new Response('<html>degil json</html>', { status: 200 }))
      const c = fastClient({ maxRetries: 0 })
      await expect(c.request('https://x.test/a')).rejects.toThrow(/JSON degil/)
    })
  })

  describe('Retry-After', () => {
    it('saniye degerini uygular', async () => {
      fake.setHandler((_u, _i, idx) =>
        idx < 1 ? jsonResponse({}, 429, { 'Retry-After': '1' }) : jsonResponse({ ok: 1 }),
      )
      const c = fastClient({ maxRetries: 1 })
      const started = Date.now()
      await c.request('https://x.test/a')
      // 1 saniye beklemesi beklenir; test hizli calismaya calisir ama
      // sifirdan belirgin sekilde uzun surer.
      expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    })

    it('HTTP TARIHI bicimini de uygular', async () => {
      // Onceki surum yalnizca Number() deniyordu; tarih bicimi NaN donup
      // rastgele backoff'a dustugu icin sunucunun istedigi bekleme
      // uygulanmiyordu.
      //
      // NOT: `toUTCString()` SANIYE hassasiyetindedir; 1000 ms ileri
      // bir tarih yalnizca birkac yuz ms sonraya duser. Guvenli olsun diye
      // 3 saniye ileri tarih verilir ve en az 1 saniye beklenmesi beklenir.
      const when = new Date(Date.now() + 3000).toUTCString()
      fake.setHandler((_u, _i, idx) =>
        idx < 1 ? jsonResponse({}, 503, { 'Retry-After': when }) : jsonResponse({ ok: 1 }),
      )
      const c = fastClient({ maxRetries: 1 })
      const started = Date.now()
      await c.request('https://x.test/a')
      expect(Date.now() - started).toBeGreaterThanOrEqual(1000)
    })

    it('gecersiz Retry-After degerinde rastgele backoff a devreder', async () => {
      fake.setHandler((_u, _i, idx) =>
        idx < 1 ? jsonResponse({}, 503, { 'Retry-After': 'yarin' }) : jsonResponse({ ok: 1 }),
      )
      const c = fastClient({ maxRetries: 1 })
      await expect(c.request('https://x.test/a')).resolves.toEqual({ ok: 1 })
    })
  })

  describe('es zamanlilik siniri', () => {
    it('asiri es zamanlilik olusmaz', async () => {
      let active = 0
      let peak = 0
      fake.setHandler(async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(res => setTimeout(res, 15))
        active -= 1
        return jsonResponse({})
      })
      const c = fastClient({ maxConcurrency: 3, maxRetries: 0 })
      await Promise.all(Array.from({ length: 12 }, () => c.request('https://x.test/a')))
      expect(peak).toBeLessThanOrEqual(3)
    })

    it('slot devri yalnizlik yaratmaz (yaris bos an olusmaz)', async () => {
      // Eski surumde release() once `active` azaltiyor, sonra kuyruktaki
      // istegi uyandiriyordu; cozucu bir MICROTASK oldugu icin arada
      // yeni bir istek bos gorunen slota girebiliyordu.
      let active = 0
      let peak = 0
      fake.setHandler(async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(res => setTimeout(res, 8))
        active -= 1
        return jsonResponse({})
      })
      const c = fastClient({ maxConcurrency: 2, maxRetries: 0 })
      await Promise.all(Array.from({ length: 20 }, () => c.request('https://x.test/a')))
      expect(peak).toBeLessThanOrEqual(2)
    })

    it('maxConcurrency 0 verilse en az 1 kullanilir (kilitlenme olmaz)', async () => {
      fake.setHandler(() => jsonResponse({ ok: true }))
      const c = fastClient({ maxConcurrency: 0, maxRetries: 0 })
      await expect(c.request('https://x.test/a')).resolves.toEqual({ ok: true })
    })

    it('istek bitince slot serbest kalir', async () => {
      fake.setHandler(() => jsonResponse({ ok: true }))
      const c = fastClient({ maxConcurrency: 1, maxRetries: 0 })
      await c.request('https://x.test/a')
      await c.request('https://x.test/a')
      expect(fake.calls.length).toBe(2)
    })
  })

  describe('paginate', () => {
    it('nextPageToken zilincirini tamamlar', async () => {
      fake.setHandler((_u, _i, idx) =>
        idx === 0
          ? jsonResponse({ items: [1, 2], nextPageToken: 'p2' })
          : jsonResponse({ items: [3] }),
      )
      const c = fastClient()
      const out = await c.paginate<number>(
        token => `https://x.test/list?page=${token ?? '1'}`,
        p => p.items,
      )
      expect(out).toEqual([1, 2, 3])
    })

    it('ilk sayfa alinamazsa HATA firlatir (kismi liste "tamam" sayilmaz)', async () => {
      fake.setHandler(() => jsonResponse({ e: 1 }, 500))
      const c = fastClient({ maxRetries: 0 })
      await expect(
        c.paginate(() => 'https://x.test/list', p => p.items),
      ).rejects.toThrow(HttpError)
    })

    it('guvenlik sayfa sinirinda durur', async () => {
      fake.setHandler(() => jsonResponse({ items: [1], nextPageToken: 'daha' }))
      const c = fastClient()
      await expect(
        c.paginate(() => 'https://x.test/list', p => p.items, { maxPages: 3 }),
      ).rejects.toThrow(/guvenlik siniri/i)
    })

    it('token yoksa tek sayfada durur', async () => {
      fake.setHandler(() => jsonResponse({ items: [1, 2] }))
      const c = fastClient()
      const out = await c.paginate<number>(() => 'https://x.test/list', p => p.items)
      expect(out).toEqual([1, 2])
      expect(fake.calls.length).toBe(1)
    })

    it('dizisi olmayan sayfayi sessizce atlar ama devam eder', async () => {
      fake.setHandler((_u, _i, idx) =>
        idx === 0 ? jsonResponse({ nextPageToken: 'p2' }) : jsonResponse({ items: [9] }),
      )
      const c = fastClient()
      const out = await c.paginate<number>(() => 'https://x.test/list', p => p.items)
      expect(out).toEqual([9])
    })
  })

  describe('akis (raw) zaman asimi temizligi', () => {
    it('clearStreamDeadline zamanlayiciyi kapatir', async () => {
      fake.setHandler(() => jsonResponse({ a: 1 }))
      const c = fastClient()
      const resp = await c.request<Response>('https://x.test/a', { raw: true, timeoutMs: 5000 })
      const withDeadline = resp as unknown as { __jmcBodyDeadline?: NodeJS.Timeout }
      expect(withDeadline.__jmcBodyDeadline).toBeDefined()
      HttpClient.clearStreamDeadline(resp)
      expect(withDeadline.__jmcBodyDeadline).toBeUndefined()
    })

    it('clearStreamDeadline tanimsiz yanit icin patlamaz', () => {
      expect(() => HttpClient.clearStreamDeadline(null)).not.toThrow()
      expect(() => HttpClient.clearStreamDeadline({})).not.toThrow()
    })

    it('timeoutMs: 0 iken akis zamanlayicisi OLUSTURULMAZ', async () => {
      fake.setHandler(() => jsonResponse({}))
      const c = fastClient()
      const resp = await c.request<Response>('https://x.test/a', { raw: true, timeoutMs: 0 })
      const withDeadline = resp as unknown as { __jmcBodyDeadline?: NodeJS.Timeout }
      expect(withDeadline.__jmcBodyDeadline).toBeUndefined()
    })
  })

  describe('HttpError', () => {
    it('durum bayraklarini dogru siniflandirir', () => {
      expect(new HttpError(401, 'x').isAuthError).toBe(true)
      expect(new HttpError(403, 'x').isPermissionError).toBe(true)
      expect(new HttpError(404, 'x').isNotFound).toBe(true)
      expect(new HttpError(429, 'x').isRateLimited).toBe(true)
      expect(new HttpError(503, 'x').isRateLimited).toBe(true)
      expect(new HttpError(400, 'x').isAuthError).toBe(false)
      expect(new HttpError(500, 'x').isRateLimited).toBe(false)
    })
  })
})