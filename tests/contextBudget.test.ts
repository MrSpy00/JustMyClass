import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  messageTokens,
  trimToContextWindow,
  clipMessageToTokens,
  isContextOverflowError,
  CONTEXT_TRIM_NOTICE,
  type BudgetedMessage,
} from '../electron/services/ai/contextBudget'

/** Testlerde tekrar tekrar kullanmak icin kisa mesaj ureteci. */
function msg(role: BudgetedMessage['role'], content: string, extra: Partial<BudgetedMessage> = {}): BudgetedMessage {
  return { role, content, ...extra }
}

describe('estimateTokens', () => {
  it('bos girdi sifir dondurur', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
    expect(estimateTokens(null)).toBe(0)
  })

  it('ASCII metinde ~3.6 karakter/token oranini kullanir', () => {
    const text = 'a'.repeat(360)
    expect(estimateTokens(text)).toBe(100)
  })

  it('Turkce karakterler icin orani korur', () => {
    const tr = 'bu bir deneme metni ve Turkce karakterler iceriyor'
    const ascii = 'bu bir deneme metni ve Turkce karakterler iceriyor'
    // Turkce metin ASCII'den az token harcamalidir, asla daha cok DEGIL.
    expect(estimateTokens(tr)).toBeGreaterThan(0)
    expect(estimateTokens(tr)).toBeLessThanOrEqual(estimateTokens(ascii) + 5)
  })

  it('CJK karakter basina Latin metinden DAHA PAHALI olcer', () => {
    // 100 CJK karakteri ~100 token; 100 Latin karakteri ~28 token.
    // Yani CJK'de karakter/tokens orani 1'e yakin, Latin'de 3.6.
    const cjk = '\u4e00'.repeat(100)
    const latin = 'a'.repeat(100)
    expect(estimateTokens(cjk)).toBeGreaterThan(estimateTokens(latin))
    expect(estimateTokens(cjk)).toBeLessThanOrEqual(120)
  })

  it('uzun metinde asiri kestirim yapmaz (altinda kalirsa 400 yer)', () => {
    const text = 'Merhaba dunya, bu bir sohbet gecmisi test metnidir. '.repeat(100)
    const est = estimateTokens(text)
    // 2500 karakter Turkce/ASCII -> gercek token ~700-900; kestirim ust sinirda olmali
    expect(est).toBeGreaterThan(text.length / 4.5)
  })
})

describe('messageTokens', () => {
  it('bos mesaj yalnizca rol etiketi maliyeti dondurur', () => {
    expect(messageTokens(msg('user', ''))).toBe(4)
  })

  it('arac cagri sayisini maliyete yansitir', () => {
    const plain = messageTokens(msg('assistant', 'merhaba'))
    const withTools = messageTokens(msg('assistant', 'merhaba', { toolCalls: [{ name: 'x' }] }))
    expect(withTools).toBeGreaterThan(plain)
  })

  it('serilemeyen arac cagrisinda patlamaz', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => messageTokens(msg('assistant', 'x', { toolCalls: [cyclic] }))).not.toThrow()
  })

  it('toolCallId ve toolName maliyet ekler', () => {
    const base = messageTokens(msg('tool', 'sonuc'))
    const tagged = messageTokens(msg('tool', 'sonuc', { toolCallId: 'abc123', toolName: 'web_search' }))
    expect(tagged).toBeGreaterThan(base)
  })
})

describe('trimToContextWindow', () => {
  const smallWindow = { contextWindow: 4000, maxOutputTokens: 1000, systemPromptTokens: 200 }

  it('gecmis sigiyorsa hicbir sey budemez', () => {
    const msgs = [msg('user', 'merhaba'), msg('assistant', 'selam'), msg('user', 'nasilsin')]
    const r = trimToContextWindow(msgs, smallWindow)
    expect(r.trimmed).toBe(false)
    expect(r.droppedCount).toBe(0)
    expect(r.messages).toBe(msgs) // ayni referans, gereksiz kopya yok
  })

  it('gecmis tasinca buder ve etiket ekler', () => {
    const msgs: BudgetedMessage[] = []
    for (let i = 0; i < 60; i += 1) {
      msgs.push(msg(i % 2 === 0 ? 'user' : 'assistant', 'cok uzun bir mesaj icerigi '.repeat(40)))
    }
    const r = trimToContextWindow(msgs, smallWindow)
    expect(r.trimmed).toBe(true)
    expect(r.droppedCount).toBeGreaterThan(0)
    expect(r.messages.length).toBeLessThan(msgs.length)
    expect(r.messages[0].role).toBe('system')
    expect(r.messages[0].content).toBe(CONTEXT_TRIM_NOTICE)
  })

  it('budemeden sonra butceye uyar', () => {
    const msgs: BudgetedMessage[] = []
    for (let i = 0; i < 80; i += 1) {
      msgs.push(msg(i % 2 === 0 ? 'user' : 'assistant', 'mesaj '.repeat(200)))
    }
    const r = trimToContextWindow(msgs, smallWindow)
    expect(r.trimmed).toBe(true)
    // Kullanilan tokenlar butceyi asmamali (etiket dahil)
    expect(r.usedTokens).toBeLessThanOrEqual(r.budget)
  })

  it('bilinmeyen pencerede budeme YAPMAZ', () => {
    const msgs = [msg('user', 'x'.repeat(100000)), msg('assistant', 'y'.repeat(100000))]
    const r = trimToContextWindow(msgs, { contextWindow: 0 })
    expect(r.trimmed).toBe(false)
    expect(r.messages).toBe(msgs)
  })

  it('negatif/NaN pencerede budeme YAPMAZ', () => {
    const msgs = [msg('user', 'x'.repeat(50000)), msg('assistant', 'y'.repeat(50000))]
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = trimToContextWindow(msgs, { contextWindow: bad })
      expect(r.trimmed).toBe(false)
    }
  })

  it('bos dizide guvenli doner', () => {
    const r = trimToContextWindow([], smallWindow)
    expect(r.trimmed).toBe(false)
    expect(r.messages).toEqual([])
  })

  it('son kullanici mesajini HER ZAMAN korur', () => {
    const msgs: BudgetedMessage[] = [
      msg('user', 'cok eski ve cok uzun bir mesaj '.repeat(300)),
      msg('assistant', 'cevap '.repeat(300)),
      msg('user', 'SON SORU: bu nasil calisir?'),
    ]
    const r = trimToContextWindow(msgs, { contextWindow: 3000, maxOutputTokens: 500 })
    expect(r.trimmed).toBe(true)
    expect(r.messages.some(m => m.content === 'SON SORU: bu nasil calisir?')).toBe(true)
  })

  it('kesim noktasinda yalniz kalan tool mesajlarini dusurur', () => {
    // Mesajlar pencereye sigmayacak kadar buyuk olmali ki budeme gerceklesen.
    const big = 'cok uzun bir mesaj govdesi '.repeat(200)
    const msgs: BudgetedMessage[] = [
      msg('system', 'sistem istemi'),
      msg('user', big),
      msg('assistant', 'arac cagriyapiyorum', {
        toolCalls: [{ id: 'call_1', name: 'web_search' }, { id: 'call_2', name: 'read_file' }],
      }),
      msg('tool', 'arac sonucu bir', { toolCallId: 'call_1', toolName: 'web_search' }),
      msg('tool', 'arac sonucu iki', { toolCallId: 'call_2', toolName: 'read_file' }),
      msg('assistant', 'iki aracin sonucu da su: ' + big),
      msg('user', 'peki simdi?'),
    ]
    const r = trimToContextWindow(msgs, { contextWindow: 4000, maxOutputTokens: 500 })
    expect(r.trimmed).toBe(true)
    expect(r.droppedCount).toBeGreaterThan(0)
    // Kesik noktadan sonra BASLANGICTA tool mesaji kalmamali
    const firstNonSystem = r.messages.findIndex(m => m.role !== 'system')
    expect(firstNonSystem).toBeGreaterThanOrEqual(0)
    expect(r.messages[firstNonSystem].role).not.toBe('tool')
  })

  it('yanitsiz assistant tool_calls mesajini dusurur', () => {
    const msgs: BudgetedMessage[] = [
      msg('user', 'a'.repeat(3000)),
      msg('assistant', 'b'.repeat(3000), { toolCalls: [{ id: 'c1', name: 'x' }] }),
      msg('user', 'son soru'),
    ]
    const r = trimToContextWindow(msgs, { contextWindow: 2200, maxOutputTokens: 300 })
    expect(r.trimmed).toBe(true)
    // tool_calls tasiyan assistant mesaji cevapsiz birakilmamali
    const kept = r.messages.filter(m => m.role !== 'system')
    kept.forEach((m, i) => {
      if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length) {
        expect(kept[i + 1]?.role).toBe('tool')
      }
    })
  })

  it('hicbisi sigmazsa son mesaji kirpar ve KAYBETMEZ', () => {
    const msgs = [msg('user', 'k'.repeat(60000))]
    const r = trimToContextWindow(msgs, { contextWindow: 2000, maxOutputTokens: 500, minTailMessages: 1 })
    expect(r.trimmed).toBe(true)
    // Tamamen bos bir cevap donmemeli
    expect(r.messages.length).toBeGreaterThan(0)
    const content = r.messages.map(m => m.content).join('')
    expect(content.length).toBeGreaterThan(0)
  })

  it('minTailMessages 0 olsa bile en az bir mesaj korur', () => {
    const msgs: BudgetedMessage[] = []
    for (let i = 0; i < 30; i += 1) msgs.push(msg('user', 'z'.repeat(2000)))
    const r = trimToContextWindow(msgs, { contextWindow: 2100, maxOutputTokens: 400, minTailMessages: 0 })
    expect(r.trimmed).toBe(true)
    expect(r.messages.length).toBeGreaterThanOrEqual(1)
  })

  it('asiri buyuk cikti payi butceyi eksiye dusurmez', () => {
    const msgs = [msg('user', 'a'.repeat(5000)), msg('assistant', 'b'.repeat(5000))]
    const r = trimToContextWindow(msgs, {
      contextWindow: 20000,
      maxOutputTokens: 999999,
      systemPromptTokens: 0,
    })
    // Cikti payi pencerenin yarisina kirpilir -> butce pozitif kalir
    expect(r.budget).toBeGreaterThan(0)
    expect(r.budget).toBeGreaterThanOrEqual(20000 - 10000 - 1024)
  })

  it('cikti payi butceyi tamamen yerse budeme yapmaz', () => {
    const msgs2 = [msg('user', 'a'.repeat(5000)), msg('assistant', 'b'.repeat(5000))]
    const r2 = trimToContextWindow(msgs2, {
      contextWindow: 1200,
      maxOutputTokens: 999999,
      systemPromptTokens: 0,
    })
    // 1200 pencere eksi 600 yarisi eksi 1024 guvenlik payi: yapilacak yer yok
    expect(r2.budget).toBe(0)
    expect(r2.trimmed).toBe(false)
    expect(r2.messages).toBe(msgs2)
  })

  it('orijinal dizi MUTLAK EDILMEZ (girdi bozulmaz)', () => {
    const msgs = [msg('user', 'a'.repeat(6000)), msg('assistant', 'b'.repeat(6000)), msg('user', 'c')]
    const snapshot = JSON.stringify(msgs)
    trimToContextWindow(msgs, { contextWindow: 1500, maxOutputTokens: 200 })
    expect(JSON.stringify(msgs)).toBe(snapshot)
  })

  it('bos sistem istemi butce hesabini cokertmez', () => {
    const msgs = [msg('user', 'a'.repeat(3000)), msg('assistant', 'b'.repeat(3000))]
    const r = trimToContextWindow(msgs, { contextWindow: 9000, maxOutputTokens: 1000, systemPromptTokens: 0 })
    expect(r.trimmed).toBe(false)
  })
})

describe('clipMessageToTokens', () => {
  it('token sirasina uyan metni degistirmez', () => {
    const m = msg('user', 'kisa bir mesaj')
    expect(clipMessageToTokens(m, 1000)).toBe(m)
  })

  it('uzun metni kirpar ve isaretler', () => {
    const m = msg('user', 'lorem ipsum dolor sit amet '.repeat(500))
    const out = clipMessageToTokens(m, 50)
    expect(out.content.length).toBeLessThan(m.content.length)
    expect(out.content).toContain('...[icerik kirpildi]')
    expect(estimateTokens(out.content)).toBeLessThanOrEqual(50)
  })

  it('kelime ortasinda kesmez', () => {
    const source = 'burada bir kelime var '.repeat(400)
    const m = msg('user', source)
    const out = clipMessageToTokens(m, 40)
    const marker = '\n...[icerik kirpildi]'
    const body = out.content.endsWith(marker) ? out.content.slice(0, -marker.length) : out.content
    expect(body.length).toBeGreaterThan(0)
    // Kirpilan govde, ornek metnin bir onekidir ve kesim noktasi BOSLUKTA
    // olmalidir: yani bir sonraki karakter bosluk/ satir sonu / metin sonu.
    expect(source.startsWith(body)).toBe(true)
    const nextChar = source[body.length]
    expect(nextChar === undefined || nextChar === ' ' || nextChar === '\n').toBe(true)
  })

  it('sifir bütce bos icerik verir', () => {
    const out = clipMessageToTokens(msg('user', 'icerik'), 0)
    expect(out.content).toBe('')
  })

  it('CJK metinde de butceye uyar', () => {
    const m = msg('user', '\u4e00\u4e8c\u4e09'.repeat(2000))
    const out = clipMessageToTokens(m, 30)
    expect(estimateTokens(out.content)).toBeLessThanOrEqual(30)
  })
})

describe('isContextOverflowError', () => {
  const withStatus = (status: number, body: string) => {
    const e = new Error(`HTTP ${status}`)
    ;(e as unknown as { status: number; body: string }).status = status
    ;(e as unknown as { status: number; body: string }).body = body
    return e
  }

  it('400 context_length_exceeded yakalar', () => {
    expect(isContextOverflowError(withStatus(400, '{"error":{"status":"RESOURCE_EXHAUSTED","message":"context_length_exceeded"}}'))).toBe(true)
  })

  it('maximum context length yakalar', () => {
    expect(isContextOverflowError(withStatus(400, 'maximum context length is 8192 tokens'))).toBe(true)
  })

  it('token count signals yakalar', () => {
    expect(isContextOverflowError(withStatus(400, 'token count exceeds the model maximum'))).toBe(true)
  })

  it('prompt is too long yakalar', () => {
    expect(isContextOverflowError(new Error('The prompt is too long'))).toBe(true)
  })

  it('413 durumunu da yakalar', () => {
    expect(isContextOverflowError(withStatus(413, 'payload too large'))).toBe(true)
  })

  it('diger 400 hatalarini TASMA sanmaz', () => {
    expect(isContextOverflowError(withStatus(400, 'API key not valid'))).toBe(false)
    expect(isContextOverflowError(withStatus(400, 'safety settings blocked'))).toBe(false)
    expect(isContextOverflowError(withStatus(400, 'invalid argument: model'))).toBe(false)
  })

  it('devre disi hatayi yakalamaz', () => {
    expect(isContextOverflowError(new Error('network timeout'))).toBe(false)
  })

  it('null/undefined guvenli doner', () => {
    expect(isContextOverflowError(null)).toBe(false)
    expect(isContextOverflowError(undefined)).toBe(false)
  })

  it('string hata nesnesini de okur', () => {
    expect(isContextOverflowError('context_length_exceeded')).toBe(true)
  })

  it('kota hatasini TASMA sanmaz', () => {
    expect(isContextOverflowError(withStatus(429, 'quota exceeded'))).toBe(false)
    expect(isContextOverflowError(withStatus(429, 'rate limit'))).toBe(false)
  })
})