/**
 * Baglam butcesi (context budget) yonetimi.
 *
 * SORUN
 * -----
 * Sohbet gecmisi hicbir noktada kisitlanmiyordu. `MAX_TOOL_ROUNDS` (8)
 * tek bir turdaki arac dongusunu sinirliyordu; ancak kullaniciya ait
 * GECMIS (onceki 50/100 mesaj) hicbir zaman budenmiyordu. Ucuza giden
 * token toplami modelin penceresini asinca saglayici HTTP 400
 * `context_length_exceeded` donuyordu.
 *
 * Daha kotusu: mevcut kurtarma yolu (bkz. `executeStreamCallWithRetry`)
 * YALNIZCA 413 "payload too large" durumunu dinliyordu ve gecmisi son 4
 * mesaja buduyordu. Baglam tasmasi saglayicilarin cogunda 413 DEGIL 400
 * dondugu icin bu kurtarma hicbir zaman devreye girmiyordu; kullanici
 * her seferinde ayni hatayi aliyordu.
 *
 * COZUM
 * -----
 * 1. `trimToContextWindow` - modelin gercek `contextWindow` degerine gore
 *    gecmisi PROAKTIF olarak buder. Ic bir etiket gomulur ki model
 *    baglamin kesildigini bilsin.
 * 2. `isContextOverflowError` - 413'e ek olarak 400 tabanli baglam tasmasi
 *    sinyallerini de yakalar, boylece tasma gerceklesirse ayni kurtarma
 *    devreye girer.
 *
 * Bu modul bilerek SIFIR bagimlilik tasiyan saf fonksiyonlardan olusur;
 * test edilmesi ve orchestrator'dan ayri bakilmasi mumkundur.
 */

/** Butce hesabinda kullanilan, ic yapilarla uyumlu mesaj sekli. */
export interface BudgetedMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  /** `role === 'assistant'` ise modelin bu turde yaptigi native arac cagrilari. */
  toolCalls?: unknown[] | undefined
  /** `role === 'tool'` ise sonucun hangi cagriya ait oldugu. */
  toolCallId?: string | undefined
  toolName?: string | undefined
}

/**
 * Baglam tasmasi sonrasi modele gecmise dair bilgi veren etiket.
 *
 * Model bunu gordugunde "onceki konusma ozeti sunuldu" diye dusunur;
 * sessizce birakirsak baglam kopmus gibi devam eder ve tutarsiz
 * cevaplar uretir.
 */
export const CONTEXT_TRIM_NOTICE =
  '[Onceki konusma bu pencerede sigmadi; daha eski turlar ozetlenerek cikartildi. ' +
  'Yeni konuyla ilgili degilse once kullanicidan yeni konu baslatin.]'

/**
 * Baglam tasmasi sonrasi kullaniciya gosterilen aciklama.
 * `trimToContextWindow` sirasinda kullaniciya sessizce kaybolmus
 * gecmis olmamalidir.
 */
export const CONTEXT_TRIM_USER_NOTICE =
  '(Onemli: Bu sohbetin gecmisi model penceresine sigmadi, eski mesajlar kirpildi. ' +
  'Konu kaybolduysa yeni bir sohbet baslat.)'

/**
 * Baglam butcesi icin korunmus guvenlik payi.
 *
 * Token kestirimi her zaman bir miktar hata payi icerir ve saglayicilar
 * gercek pencereyi bastan kucultmus olabilir. Kestirimin ALTINDA kalip
 * 400 yiyoruz; ustunde kalip kullanicidan birkac bin token harcamak
 * neredeyse hic maliyeti olmayan bir tercih. Pay model penceresine gore
 * oranlanir, sabit deger degil.
 */
function safetyMarginFor(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 2048
  return Math.max(1024, Math.min(8192, Math.round(contextWindow * 0.04)))
}

/**
 * Yaklasik token sayisi.
 *
 * BILINCLI OLARAK TAHMINI YUKSEK TUTAR: az kestirmek 400 yiyor, fazla
 * kestirmek yalnizca birkaz bin tokenlik erken budemeye yol acar.
 *
 * Turkce/Latin metin icin ~3.6 karakter/token. CJK, Kiril ve Arap
 * karakterleri belirgin sekilde daha az token harcar (yabanci dilde
 * kelime basina 1-2 token); ASCII disi orani yuksekse bolen dusurulur.
 * Aksi halde CJK agirlikli bir sohbet Latin kestirimiyle kacinir ve
 * gercek penceresi asilir.
 */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0
  let nonAscii = 0
  let len = 0
  for (let i = 0; i < text.length; i += 1) {
    len += 1
    if (text.charCodeAt(i) > 0x7f) nonAscii += 1
  }
  if (len === 0) return 0
  if (nonAscii === 0) return Math.ceil(len / 3.6)
  const ratio = nonAscii / len
  // Tamamen CJK oldugunda karakter basina ~1 token'a iner.
  const charsPerToken = 3.6 * (1 - ratio * 0.72)
  return Math.ceil(len / charsPerToken)
}

/** Tek bir mesajin butce maliyeti. */
export function messageTokens(message: BudgetedMessage): number {
  let total = estimateTokens(message.content)
  // Rol etiketleri, cagri kimlikleri ve arac semalari da kucuk bir maliyet
  // ekler. ihmal edilebilir ama bos birikim binlerce mesajda fark yaratir.
  total += 4
  if (message.toolCallId) total += 8
  if (message.toolName) total += estimateTokens(message.toolName)
  if (message.toolCalls && message.toolCalls.length) {
    total += message.toolCalls.length * 16
    for (const call of message.toolCalls) {
      // Girdi/arguman govdesi serilebiliyor; ham metne bakmadan en azindan
      // isim + bir kac yuz tokenlik tipik arguman payi ayir.
      total += 24
      try {
        total += estimateTokens(JSON.stringify(call) ?? '')
      } catch {
        /* serilemezse tipik pay yeterli */
      }
    }
  }
  return total
}

/** Butce girdileri. */
export interface TrimOptions {
  /** Modelin `contextWindow` degeri. Gecersiz/0 ise kirpma yapilmaz. */
  contextWindow: number
  /** Modelin `maxOutputTokens` degeri; yanit icin ayrilmasi gereken yer. */
  maxOutputTokens?: number
  /** Sistem isteminin token maliyeti. */
  systemPromptTokens?: number
  /**
   * Korunmasi gereken en sondaki mesaj sayisi. Varsayilan 2 (son kullanici
   * + son assistant). 0 verilirse budeme serbesttir.
   */
  minTailMessages?: number
}

export interface TrimResult<T> {
  messages: T[]
  /** Kesim noktasindan once atilan mesaj sayisi. 0 ise hicbir sey budenmedi. */
  droppedCount: number
  /** Kullanilabilir token butcesi (cift yonlu bilgi amacli). */
  budget: number
  /** Kesim sonrasi gercekten kullanilan token (cift yonlu). */
  usedTokens: number
  /** Etiket eklendiyse true. */
  trimmed: boolean
}

/**
 * Sohbet gecmisini model penceresine sigdirir.
 *
 * KURALLAR
 * -------
 * 1. Butce = pencere - cikti payi - sistem istemi - guvenlik payi.
 * 2. Gecmis **sondan basa** korunur: en yeni mesaj her zaman durur.
 * 3. Kesim noktasinda **yalniz kalan arac cagri/sonuclari** temizlenir:
 *    - Kesimden sonra basa degis `tool` mesajlari atilir (sahipleri
 *      kesilen assistant mesaji oldugu icin bagimsiz kalamazlar).
 *    - Ilk korunan mesaj, cagrilari yanitlanmamis bir `assistant` ise
 *      o da atilir (OpenAI protokolu bos tool_calls'i reddeder).
 * 4. Tek bir mesaj bile sigmiyorsa, **son mesaj kirpilir** ve kullaniciya
 *    acikca bildirilir. Mesajin TAMAMINI dusurmek, kullaniciya sessizce
 *    bos ekran gostermekten kotudur.
 * 5. Kirpma olduysa en basa `system` rolunda bir etiket eklenir.
 */
export function trimToContextWindow<T extends BudgetedMessage>(
  messages: T[],
  options: TrimOptions,
): TrimResult<T> {
  const empty: TrimResult<T> = {
    messages,
    droppedCount: 0,
    budget: 0,
    usedTokens: messages.reduce((sum, m) => sum + messageTokens(m), 0),
    trimmed: false,
  }
  if (!Array.isArray(messages) || messages.length === 0) return empty

  const window = Number(options.contextWindow) || 0
  if (!Number.isFinite(window) || window <= 0) return empty

  // Yanit icin ayrilacak yer. Ust sinir pencerenin yarisi: cikti payi
  // pencereden buyukse model taniminda hata var, giris budenmemeli.
  const rawReserve = Number(options.maxOutputTokens) || 0
  const reserve = Math.max(0, Math.min(rawReserve, Math.floor(window * 0.5)))
  const systemTokens = Math.max(0, Number(options.systemPromptTokens) || 0)
  const budget = Math.floor(window - reserve - systemTokens - safetyMarginFor(window))

  // Butce pozitif degilse kirpma mumkun degil; asil pencereye guveniriz.
  if (budget <= 0) return empty

  const costs = messages.map(m => messageTokens(m))
  const total = costs.reduce((a, b) => a + b, 0)
  if (total <= budget) {
    return { messages, droppedCount: 0, budget, usedTokens: total, trimmed: false }
  }

  const minTail = Math.max(1, Math.trunc(options.minTailMessages ?? 2))
  const noticeCost = estimateTokens(CONTEXT_TRIM_NOTICE) + 4
  const usable = Math.max(256, budget - noticeCost)

  // --- ADIM 1: en sondaki minTail mesaj ZORUNLU olarak korunur -----------
  //
  // NIYET: son kullanici sorusu ve son assistant cevabi asla duser.
  //
  // HATANIN GELISMESI: eski surumde bu zorlama, butce kontroluyle ayni
  // dongude yapiliyordu (`if (next > usable && keepStart < len - minTail)
  // break`). Boylece "kuyruktayiz" durumunda butce asilmiyor ve HICBIR
  // budeme yapilmadan butce asiliyordu. Zorlama ayri bir adim olmali:
  // once kesin tut, sonra butce izin verdigi kadar geriye dogru ilerle.
  const forcedTail = Math.min(minTail, messages.length)
  let keepStart = messages.length - forcedTail
  let used = 0
  for (let i = messages.length - forcedTail; i < messages.length; i += 1) used += costs[i]

  // --- ADIM 2: butce izin verdigi kadar daha eskiye dogru ilerle ---------
  while (keepStart > 0) {
    const next = used + costs[keepStart - 1]
    if (next > usable) break
    used = next
    keepStart -= 1
  }

  // Zorunlu kuyruk tek basina butceyi asarsa, EN SON mesaji kirp.
  // Boylece kullanicinin son sorusu yerinde kalir ama toplam butceye
  // uyar; butceyi hicbir sey yapmadan asmaktansa kirpmak tercih edilir.
  //
  // DIKKAT: kirpma sonrasi son mesaj `clippedTail` olarak AYRIca
  // tutulur; yalniz-ara temizligi asagida TEK bir noktada, butcesel
  // sonucu gormeden calisir. Daha once bu dal temizligi tamamen
  // atlardi ve yanitsiz `tool_calls` tasiyan bir assistant mesaji
  // kullaniciya `user` ile yanit yemis olarak gonderiliyordu.
  let clippedTail: T | null = null
  let lastIdx = messages.length - 1
  if (used > usable) {
    const othersUsed = used - costs[lastIdx]
    const room = Math.max(64, usable - othersUsed)
    clippedTail = clipMessageToTokens(messages[lastIdx], room)
    used = othersUsed + messageTokens(clippedTail)
    // Son mesaji kirpildi; asil diziden cikarip sona eklenecek sekilde isaretle.
    if (keepStart < lastIdx) keepStart = Math.max(keepStart, lastIdx)
  }

  // Kesimden sonra yalniz kalan arac sonuclarini temizle.
  const end = clippedTail ? lastIdx : messages.length
  while (keepStart < end && messages[keepStart].role === 'tool') keepStart += 1
  // Cagrilari yanitlanmamis assistant mesajini da dusur.
  const firstKept = messages[keepStart]
  if (
    firstKept &&
    keepStart < end &&
    firstKept.role === 'assistant' &&
    Array.isArray(firstKept.toolCalls) &&
    firstKept.toolCalls.length > 0 &&
    messages[keepStart + 1]?.role !== 'tool'
  ) {
    keepStart += 1
  }

  if (keepStart >= end) {
    // Hicbiri sigmadi: son mesaji kirp.
    const last = clippedTail ?? clipMessageToTokens(messages[lastIdx], Math.max(64, usable - costs[lastIdx]))
    const out = [last, makeNotice<T>(CONTEXT_TRIM_NOTICE)] as T[]
    return {
      messages: out,
      droppedCount: messages.length - 1,
      budget,
      usedTokens: messageTokens(last) + noticeCost,
      trimmed: true,
    }
  }

  const dropped = keepStart
  const kept = clippedTail ? [...messages.slice(keepStart, end), clippedTail] : messages.slice(keepStart, end)
  const out = [makeNotice<T>(CONTEXT_TRIM_NOTICE), ...kept] as T[]
  return {
    messages: out,
    droppedCount: dropped,
    budget,
    usedTokens: used + noticeCost,
    trimmed: true,
  }
}

/** Ic etiketi sistem mesaji olarak one ekler. */
function makeNotice<T extends BudgetedMessage>(text: string): T {
  return { role: 'system', content: text } as unknown as T
}

/**
 * Tek mesaji verilen token odasina kirpar.
 *
 * Kelime ortasinda kesmemek icin en yakin BOSLUK/SEKME noktasina kadar
 * geri gider. Boylece model yarim kelime degil, butun kelime gorur.
 */
export function clipMessageToTokens<T extends BudgetedMessage>(message: T, maxTokens: number): T {
  const text = message.content ?? ''
  if (maxTokens <= 0) return { ...message, content: '' }
  if (estimateTokens(text) <= maxTokens) return message

  // KESME ISARETI DE BUTCEDEN DUSULUR.
  // HATANIN GELISMESI: dongu `text.slice(0, cut)` uzerinden olculuyor,
  // isaret metni sonradan eklendigi icin kirpilan mesaj daima butceyi
  // asiyordu (50 token istendi, 56 cikti). Sinyal, kirpilan govdenin
  // AYNI adimda olculmesi gerekiyor.
  const marker = '\n...[icerik kirpildi]'
  const bodyBudget = Math.max(1, maxTokens - estimateTokens(marker))

  // Once kaba bir karakter siniri koy (bodyBudget * 3.6, ASCII varsayimiyla).
  let cut = Math.max(1, Math.floor(bodyBudget * 3.6))
  if (cut < text.length) {
    const boundary = Math.max(text.lastIndexOf(' ', cut), text.lastIndexOf('\t', cut), text.lastIndexOf('\n', cut))
    // Sinir boslukta bulunduysa BOSLUGUN ONUNDE dur (kelimeyi yari kesme).
    if (boundary > 0) cut = boundary
  } else {
    cut = text.length
  }

  // CJK agirlikli metinde karakter siniri yanlis olabilir; gercek token
  // olcumune yakinlasana kadar daralt.
  while (cut > 0 && estimateTokens(text.slice(0, cut)) > bodyBudget) {
    cut -= Math.max(1, Math.floor(cut * 0.1))
    if (cut > 0) {
      const boundary = Math.max(text.lastIndexOf(' ', cut), text.lastIndexOf('\n', cut), text.lastIndexOf('\t', cut))
      if (boundary > 0) cut = boundary
    }
  }
  if (cut <= 0) return { ...message, content: marker }

  return {
    ...message,
    content: text.slice(0, cut) + marker,
  }
}

/**
 * "Baglam tasmasi" sinyalini tanir.
 *
 * NEDEN AYRI BIR TANIYICI
 * ----------------------
 * 413 govde boyutu demektir ve cogu saglayicida baglam penceresi
 * asimina da 413 doner. Ancak **400** donenler de var (Gemini/OpenAI
 * `context_length_exceeded`). Onceki kurtarma yolu yalnizca 413'e
 * bakardi; 400 donen saglayicilarda hic devreye girmiyordu - kullanici
 * ayni hatayi tekrar tekrar aliyordu.
 *
 * Bilinen kaliplar:
 * - `context_length_exceeded`
 * - `maximum context length`
 * - `context window ... too long`
 * - `too many tokens` / `token count ... exceeds`
 * - `input is too long` / `prompt is too long`
 * - `reduce the length of the messages`
 * - `REQUEST_TOO_LONG`
 */
export function isContextOverflowError(err: unknown): boolean {
  const status = statusOf(err)
  const text = errorTextOf(err).toLowerCase()
  if (!text) return false
  const patterns = [
    'context_length_exceeded',
    'context length exceeded',
    'maximum context length',
    'context window',
    'too many tokens',
    'token count',
    'input is too long',
    'prompt is too long',
    'reduce the length',
    'request_too_long',
    'request too large',
  ]
  if (patterns.some(p => text.includes(p))) return true
  // 413 her zaman tasma demek degildir ama govde/pencere disina cikmis
  // olma olasiligi yuksek; yine de kurtarma denemeye deger.
  return status === 413
}

function statusOf(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null
  const withStatus = err as { status?: unknown; statusCode?: unknown }
  const raw = withStatus.status ?? withStatus.statusCode
  return typeof raw === 'number' ? raw : null
}

function errorTextOf(err: unknown): string {
  if (err == null) return ''
  if (typeof err === 'string') return err
  if (err instanceof Error) {
    const anyErr = err as Error & { body?: unknown; responseText?: unknown }
    const extra = [anyErr.body, anyErr.responseText]
      .filter(v => typeof v === 'string')
      .join(' ')
    return `${err.message} ${extra}`
  }
  if (typeof err === 'object') {
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}