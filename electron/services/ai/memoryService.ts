import crypto from 'node:crypto'
import type { StorageService } from '../storageService'
import type { MemoryItem, MemoryProfile } from '../../../types/jmc'

const GLOBAL_MEMORY_KEY = 'jmc.memory.global'
const SESSIONS_MEMORY_KEY = 'jmc.memory.sessions'

export class JustMyClassMemoryService {
  private readonly storage: StorageService

  constructor(storage: StorageService) {
    this.storage = storage
  }

  public getProfile(sessionId?: string): MemoryProfile {
    const globalItems = this.storage.getSetting<MemoryItem[]>(GLOBAL_MEMORY_KEY, [])
    const sessionsMap = this.storage.getSetting<Record<string, MemoryItem[]>>(SESSIONS_MEMORY_KEY, {})
    return {
      globalItems: Array.isArray(globalItems) ? globalItems : [],
      sessionItems: sessionsMap && typeof sessionsMap === 'object' ? sessionsMap : {},
      lastConsolidatedAt: this.storage.getSetting<string>('jmc.memory.lastConsolidatedAt', ''),
    }
  }

  public getSessionItems(sessionId: string): MemoryItem[] {
    if (!sessionId) return []
    const profile = this.getProfile(sessionId)
    return profile.sessionItems[sessionId] ?? []
  }

  public saveItem(
    item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    sessionId?: string,
  ): MemoryItem {
    const now = new Date().toISOString()
    const id = item.id || `mem_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
    const record: MemoryItem = {
      id,
      category: item.category || 'preference',
      key: item.key.trim(),
      value: item.value.trim(),
      createdAt: now,
      updatedAt: now,
      source: item.source || 'user',
    }

    if (sessionId) {
      const profile = this.getProfile(sessionId)
      const currentList = profile.sessionItems[sessionId] || []
      const index = currentList.findIndex(m => m.id === id || (m.key.toLowerCase() === record.key.toLowerCase()))
      let updated: MemoryItem[]
      if (index >= 0) {
        updated = [...currentList]
        updated[index] = { ...currentList[index], ...record, updatedAt: now }
      } else {
        updated = [record, ...currentList].slice(0, 50)
      }
      const newMap = { ...profile.sessionItems, [sessionId]: updated }
      this.storage.setSetting(SESSIONS_MEMORY_KEY, newMap)
      return record
    } else {
      const currentList = this.storage.getSetting<MemoryItem[]>(GLOBAL_MEMORY_KEY, [])
      const index = currentList.findIndex(m => m.id === id || (m.key.toLowerCase() === record.key.toLowerCase()))
      let updated: MemoryItem[]
      if (index >= 0) {
        updated = [...currentList]
        updated[index] = { ...currentList[index], ...record, updatedAt: now }
      } else {
        updated = [record, ...currentList].slice(0, 100)
      }
      this.storage.setSetting(GLOBAL_MEMORY_KEY, updated)
      return record
    }
  }

  public deleteItem(id: string, sessionId?: string): boolean {
    if (sessionId) {
      const profile = this.getProfile(sessionId)
      const current = profile.sessionItems[sessionId] || []
      const filtered = current.filter(m => m.id !== id)
      if (filtered.length !== current.length) {
        this.storage.setSetting(SESSIONS_MEMORY_KEY, { ...profile.sessionItems, [sessionId]: filtered })
        return true
      }
      return false
    } else {
      const current = this.storage.getSetting<MemoryItem[]>(GLOBAL_MEMORY_KEY, [])
      const filtered = current.filter(m => m.id !== id)
      if (filtered.length !== current.length) {
        this.storage.setSetting(GLOBAL_MEMORY_KEY, filtered)
        return true
      }
      return false
    }
  }

  public clear(scope: 'global' | 'session' | 'all', sessionId?: string): boolean {
    if (scope === 'global' || scope === 'all') {
      this.storage.setSetting(GLOBAL_MEMORY_KEY, [])
    }
    if ((scope === 'session' || scope === 'all') && sessionId) {
      const profile = this.getProfile(sessionId)
      const nextMap = { ...profile.sessionItems }
      delete nextMap[sessionId]
      this.storage.setSetting(SESSIONS_MEMORY_KEY, nextMap)
    } else if (scope === 'all') {
      this.storage.setSetting(SESSIONS_MEMORY_KEY, {})
    }
    return true
  }

  /**
   * Sistem istemine eklenecek, optimize edilmiş ve token tasarruflu hafıza bloğunu oluşturur.
   */
  public getFormattedMemoryPrompt(sessionId?: string): string {
    const globalItems = this.storage.getSetting<MemoryItem[]>(GLOBAL_MEMORY_KEY, [])
    const sessionItems = sessionId ? this.getSessionItems(sessionId) : []

    if (!globalItems.length && !sessionItems.length) {
      return ''
    }

    const lines: string[] = [
      '=== JUSTMYCLASS HAFIZA & TASTE SİSTEMİ (ÖĞRENCİ VE SOHBET BAĞLAMI) ===',
      'Aşağıdaki bilgiler kullanıcının kalıcı zevkleri (Taste), kuralları ve bu oturumdaki hafıza kayıtlarıdır.',
      'Bu bilgilere kesinlikle sadık kal; kullanıcıya bu bilgileri tekrar sorma, hafızayı biliyormuş gibi doğal yanıt ver.',
    ]

    if (globalItems.length > 0) {
      lines.push('', '[Genel Öğrenci Profili & Tercihler]:')
      for (const item of globalItems.slice(0, 15)) {
        lines.push(`• ${item.key}: ${item.value}`)
      }
    }

    if (sessionItems.length > 0) {
      lines.push('', '[Bu Sohbetin Özel Hafızası]:')
      for (const item of sessionItems.slice(0, 15)) {
        lines.push(`• ${item.key}: ${item.value}`)
      }
    }

    lines.push('==================================================================')
    return lines.join('\n')
  }

  /**
   * Sohbette geçen belirgin tercihleri veya doğrulanmış olguları hafif kural tabanlı
   * olarak tespit edip hafızaya ekler (token harcamadan hızlı ve kararlı yerel analiz).
   */
  public autoExtractMemories(
    userMessage: string,
    assistantMessage: string,
    sessionId?: string,
  ): void {
    const text = userMessage.trim()
    if (!text || text.length < 5) return

    // 1. Bölüm / Sınıf / Rol ifadeleri
    const deptMatch = text.match(/\b([A-Za-zÇĞİÖŞÜçğıöşü\s]+?(?:mühendisliği|bölümü|öğrencisiyim|üniversitesindeyim|fakültesi|\d\.\s*sınıf))\b/i)
    if (deptMatch && deptMatch[1].length < 60) {
      this.saveItem({
        category: 'academic',
        key: 'Öğrenim / Bölüm',
        value: deptMatch[1].trim(),
        source: 'assistant_extracted',
      })
    }

    // 2. Özel kural veya istek ifadeleri: "Bundan sonra...", "Her zaman...", "Asla...", "Lütfen..."
    const ruleMatch = text.match(/(?:bundan sonra|her zaman|lütfen her yanıtta|bana hep|asla)\s+([^.!?\n]{6,120})/i)
    if (ruleMatch && ruleMatch[1]) {
      this.saveItem({
        category: 'rule',
        key: 'Öğrenci Kuralı / Tercihi',
        value: ruleMatch[0].trim(),
        source: 'assistant_extracted',
      })
    }

    // 3. Yazılım Dili / Teknoloji Tercihi
    const techMatch = text.match(/\b(Python|JavaScript|TypeScript|C\+\+|C#|Java|Rust|Go|SQL|PHP|Flutter|Dart|React|Vue|Angular|Kotlin|Swift|MATLAB|R)\b(?:\s+(?:kullan|ile yaz|ile kodla|üzerinden|dilinde|kodla))?/i)
    if (techMatch && techMatch[1]) {
      this.saveItem({
        category: 'preference',
        key: 'Tercih Edilen Teknoloji / Dil',
        value: techMatch[1],
        source: 'assistant_extracted',
      })
    }

    // 4. Açıklama ve Anlatım Tarzı Tercihi
    if (/kısa ve öz|özetle|detaylandırma|uzatmadan/i.test(text)) {
      this.saveItem({
        category: 'preference',
        key: 'Cevap Tarzı',
        value: 'Kısa ve öz, doğrudan sonuca odaklı',
        source: 'assistant_extracted',
      })
    } else if (/adım adım|detaylı açıkla|ayrıntılı anlat|tüm adımları/i.test(text)) {
      this.saveItem({
        category: 'preference',
        key: 'Cevap Tarzı',
        value: 'Adım adım, ayrıntılı ve açıklayıcı',
        source: 'assistant_extracted',
      })
    } else if (/akademik dille|kaynakçalı|bilimsel/i.test(text)) {
      this.saveItem({
        category: 'preference',
        key: 'Cevap Tarzı',
        value: 'Akademik ve kurallara uygun biçim',
        source: 'assistant_extracted',
      })
    }

    // 5. Sınav ve Teslim Tarihi Takibi
    const deadlineMatch = text.match(/\b((?:vize|final|büt|proje|ödev|sunum)\s+(?:tarihi|haftası|için|yarın|haftaya|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|günü))(?:\s+([^.!?\n]{3,60}))?/i)
    if (deadlineMatch && deadlineMatch[0]) {
      this.saveItem(
        {
          category: 'academic',
          key: 'Yaklaşan Teslim / Sınav Notu',
          value: deadlineMatch[0].trim(),
          source: 'assistant_extracted',
        },
        sessionId,
      )
    }

    // 6. Sohbet hedefi (ilk mesajlarda ödev/konu belirleme)
    if (sessionId && (text.toLowerCase().includes('ödevi') || text.toLowerCase().includes('raporu') || text.toLowerCase().includes('projesi') || text.toLowerCase().includes('dersi'))) {
      const subjectMatch = text.match(/(?:[\w\s-]+\s+(?:ödevi|raporu|projesi|sunumu|dersi))/i)
      if (subjectMatch) {
        this.saveItem(
          {
            category: 'context',
            key: 'Sohbet Odak Konusu',
            value: subjectMatch[0].trim(),
            source: 'assistant_extracted',
          },
          sessionId,
        )
      }
    }
  }
}
