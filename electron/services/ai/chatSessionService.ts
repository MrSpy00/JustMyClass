import crypto from 'node:crypto'
import type { StorageService } from '../storageService'
import type { ChatSession, AiMessage } from '../../../types/jmc'

const SESSIONS_STORE_KEY = 'ai.chatSessions'
const ACTIVE_SESSION_STORE_KEY = 'ai.activeSessionId'

export class ChatSessionService {
  private readonly storage: StorageService

  constructor(storage: StorageService) {
    this.storage = storage
  }

  public getSessions(): ChatSession[] {
    const raw = this.storage.getSetting<ChatSession[]>(SESSIONS_STORE_KEY, [])
    if (!Array.isArray(raw)) return []
    return raw.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  public listSessions(): ChatSession[] {
    return this.getSessions()
  }

  public getSession(id: string): ChatSession | null {
    if (!id) return null
    const sessions = this.getSessions()
    return sessions.find(s => s.id === id) ?? null
  }

  public getActiveSessionId(): string | null {
    return this.storage.getSetting<string | null>(ACTIVE_SESSION_STORE_KEY, null)
  }

  public setActiveSessionId(id: string | null): void {
    this.storage.setSetting(ACTIVE_SESSION_STORE_KEY, id)
  }

  public createSession(initialTitle?: string, courseId?: string, courseName?: string): ChatSession {
    const now = new Date().toISOString()
    const id = `session_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
    const session: ChatSession = {
      id,
      title: initialTitle || 'Yeni Sohbet',
      courseId,
      courseName,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      messages: [],
    }

    const sessions = this.getSessions()
    this.storage.setSetting(SESSIONS_STORE_KEY, [session, ...sessions].slice(0, 100))
    this.setActiveSessionId(id)
    return session
  }

  public saveSession(session: ChatSession): boolean {
    if (!session || !session.id) return false
    const sessions = this.getSessions()
    const idx = sessions.findIndex(s => s.id === session.id)
    const updated: ChatSession = {
      ...session,
      messageCount: session.messages.length,
      updatedAt: new Date().toISOString(),
    }

    let newList: ChatSession[]
    if (idx >= 0) {
      newList = [...sessions]
      newList[idx] = updated
    } else {
      newList = [updated, ...sessions].slice(0, 100)
    }

    this.storage.setSetting(SESSIONS_STORE_KEY, newList)
    return true
  }

  public deleteSession(id: string): boolean {
    if (!id) return false
    const sessions = this.getSessions()
    const filtered = sessions.filter(s => s.id !== id)
    if (filtered.length !== sessions.length) {
      this.storage.setSetting(SESSIONS_STORE_KEY, filtered)
      if (this.getActiveSessionId() === id) {
        this.setActiveSessionId(filtered[0]?.id ?? null)
      }
      return true
    }
    return false
  }

  public renameSession(id: string, newTitle: string): boolean {
    const clean = newTitle.trim().slice(0, 80)
    if (!id || !clean) return false
    const sessions = this.getSessions()
    const target = sessions.find(s => s.id === id)
    if (!target) return false
    target.title = clean
    target.updatedAt = new Date().toISOString()
    this.storage.setSetting(SESSIONS_STORE_KEY, sessions)
    return true
  }

  public autoGenerateTitle(firstMessageText: string): string {
    const clean = firstMessageText
      .replace(/📎\s*\[[^\]]+\]/g, '')
      .replace(/^[\s\n]+/, '')
      .trim()
    if (!clean) return 'Akademik İnceleme'

    const lines = clean.split('\n').filter(Boolean)
    const firstLine = lines[0] || clean

    // "Hafta 5 - Uygulama Raporu" gibi başlıkları ayıkla
    const specificMatch = firstLine.match(/((?:hafta\s*\d+|ödev|rapor|proje|laboratuvar|final|vize)[^.,!?\n]{0,40})/i)
    if (specificMatch) {
      const matchText = specificMatch[1].trim()
      return matchText.charAt(0).toUpperCase() + matchText.slice(1)
    }

    return firstLine.slice(0, 42).trim() + (firstLine.length > 42 ? '...' : '')
  }
}
