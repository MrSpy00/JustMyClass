import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { StorageService } from './storageService'

export type ExportFormat = 'csv' | 'json' | 'markdown' | 'anki'

const csvCell = (value: unknown): string => {
  const s = value === undefined || value === null ? '' : String(value)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export class ExportService {
  constructor(private storageService: StorageService) {}

  public async exportData(format: ExportFormat, courseId?: string): Promise<{ filePath: string }> {
    const downloadsDir = app?.getPath('downloads') || process.cwd()
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const version = app?.getVersion?.() ?? '1.0.0'

    const courses = this.storageService.getCourses()
    const targetCourses = courseId ? courses.filter(c => c.id === courseId) : courses
    if (!targetCourses.length) {
      throw new Error('Dışa aktarılacak ders bulunamadı. Önce senkronizasyon yapın.')
    }

    let fileName: string
    let content: string

    switch (format) {
      case 'csv': {
        fileName = `JustMyClass_Odevler_${stamp}.csv`
        const rows = [
          [
            'Ders ID',
            'Ders Adı',
            'Şube',
            'Ödev ID',
            'Ödev Başlığı',
            'Son Teslim',
            'Saat',
            'Puan',
            'Teslim Durumu',
            'Alınan Not',
          ].join(';'),
        ]
        for (const c of targetCourses) {
          for (const w of this.storageService.getCourseWork(c.id)) {
            const due = w.dueDate ? `${w.dueDate.day}.${w.dueDate.month}.${w.dueDate.year}` : ''
            const time = w.dueTime ? `${String(w.dueTime.hours).padStart(2, '0')}:${String(w.dueTime.minutes).padStart(2, '0')}` : ''
            rows.push(
              [
                c.id,
                c.name,
                c.section ?? '',
                w.id,
                w.title,
                due,
                time,
                w.maxPoints ?? '',
                w.submission?.state ?? '',
                w.submission?.assignedGrade ?? '',
              ]
                .map(csvCell)
                .join(';'),
            )
          }
        }
        // Turkce Excel ayraci icin BOM eklenir.
        content = '\uFEFF' + rows.join('\r\n')
        break
      }

      case 'json': {
        fileName = `JustMyClass_Yedek_${stamp}.json`
        content = JSON.stringify(
          {
            formatVersion: 1,
            application: `JustMyClass ${version}`,
            exportedAt: new Date().toISOString(),
            note: 'Bu dışa aktarım OAuth veya sağlayıcı anahtarları içermez.',
            courses: targetCourses.map(c => ({
              ...c,
              topics: this.storageService.getTopics(c.id),
              courseWork: this.storageService.getCourseWork(c.id),
              announcements: this.storageService.getAnnouncements(c.id),
              materials: this.storageService.getMaterials(c.id),
              participants: this.storageService.getParticipants(c.id),
            })),
          },
          null,
          2,
        )
        break
      }

      case 'markdown': {
        fileName = `JustMyClass_Rapor_${stamp}.md`
        content = this.buildMarkdown(targetCourses.map(c => c.id), version)
        break
      }

      case 'anki': {
        fileName = `JustMyClass_Kartlar_${stamp}.csv`
        content = this.buildAnki(targetCourses.map(c => c.id))
        break
      }

      default:
        throw new Error(`Desteklenmeyen dışa aktarım biçimi: ${format}`)
    }

    const fullPath = path.join(downloadsDir, fileName)
    fs.writeFileSync(fullPath, content, 'utf8')
    return { filePath: fullPath }
  }

  /** Ödev yönergelerinden gerçek metinlere dayanan çalışma kartı dışa aktarımı. */
  private buildAnki(courseIds: string[]): string {
    const lines = ['#separator:Tab', '#html:true', '#notetype column:1', '#tags column:3']

    let cardCount = 0
    for (const courseId of courseIds) {
      const course = this.storageService.getCourses().find(c => c.id === courseId)
      const tag = (course?.name ?? 'Ders').replace(/[^\p{L}\p{N}]+/gu, '-')

      for (const w of this.storageService.getCourseWork(courseId)) {
        const criteria = this.storageService.getRubric(w.id)?.criteria ?? []
        for (const criterion of criteria) {
          if (!criterion.description) continue
          const levels = criterion.levels
            .map(l => `${l.title}${l.points !== undefined ? ` (${l.points} puan)` : ''}`)
            .join('; ')
          lines.push(
            [
              csvCell(criterion.title),
              csvCell(levels ? `${criterion.description}\n\nSeviyeler: ${levels}` : criterion.description),
              csvCell(tag),
            ].join('\t'),
          )
          cardCount += 1
        }

        // Yönerge metninden başlık bazında soru üret.
        for (const q of extractQuestionsFromText(w.description ?? '')) {
          lines.push([csvCell(q.question), csvCell(this.coursesAnswer(q.context)), csvCell(tag)].join('\t'))
          cardCount += 1
        }
      }
    }

    if (cardCount === 0) {
      throw new Error(
        'Kart üretilecek veri bulunamadı. Rubrik kriteri veya başlık biçiminde soru içeren ödev yönergesi olması gerekir.',
      )
    }
    return lines.join('\n')
  }

  private coursesAnswer(context: string): string {
    return context.replace(/\s+/g, ' ').trim()
  }

  private buildMarkdown(courseIds: string[], version: string): string {
    let out = `# JustMyClass — Ders Raporu\n\n`
    out += `- **Uygulama sürümü:** ${version}\n`
    out += `- **Oluşturulma:** ${new Date().toLocaleString('tr-TR')}\n`
    out += `- **Kaynak:** [github.com/MrSpy00/JustMyClass](https://github.com/MrSpy00/JustMyClass)\n\n`
    out += `---\n\n`

    for (const id of courseIds) {
      const course = this.storageService.getCourses().find(c => c.id === id)
      if (!course) continue

      out += `## ${course.name}\n\n`
      if (course.section) out += `Şube: ${course.section}  \n`
      if (course.room) out += `Oda: ${course.room}  \n`
      out += `\n### Ödevler\n\n`

      const works = this.storageService.getCourseWork(id)
      if (!works.length) {
        out += `_Bu derste kayıtlı ödev yok._\n\n`
        continue
      }

      for (const w of works) {
        out += `#### ${w.title}\n\n`
        if (w.dueDate) {
          const time = w.dueTime ? ` ${String(w.dueTime.hours).padStart(2, '0')}:${String(w.dueTime.minutes).padStart(2, '0')}` : ''
          out += `Son teslim: ${w.dueDate.day}.${w.dueDate.month}.${w.dueDate.year}${time}  \n`
        }
        if (w.maxPoints !== undefined) out += `Puan: ${w.maxPoints}  \n`
        if (w.submission?.state) out += `Teslim durumu: ${w.submission.state}  \n`
        out += `\n${w.description ?? '_Yönerge girilmemiş._'}\n\n`

        const rubric = this.storageService.getRubric(w.id)
        if (rubric?.criteria.length) {
          out += `##### Rubrik\n\n`
          for (const c of rubric.criteria) {
            out += `- **${c.title}**${c.weight !== undefined ? ` (${c.weight})` : ''}${c.description ? ` — ${c.description}` : ''}\n`
          }
          out += `\n`
        }

        const downloaded = w.materials.filter(m => m.driveFileId)
        if (downloaded.length) {
          out += `##### Ekler\n\n`
          for (const m of downloaded) out += `- ${m.title}\n`
          out += `\n`
        }
      }
    }
    return out
  }
}

/**
 * Yönerge metninden soru üretir. Kural tabanlidir; içerik uydurulmaz.
 * Yalnızca soru işareti ya da "Neden/ Nasıl/ Nedir" ile başlayan cümleler alınır.
 */
function extractQuestionsFromText(text: string): Array<{ question: string; context: string }> {
  const stripped = text.replace(/<[^>]+>/g, ' ').replace(/[*_`#>]/g, '')
  const sentences = stripped.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
  const out: Array<{ question: string; context: string }> = []

  for (const s of sentences) {
    const isQuestion = s.includes('?') || /^(nedir|ne|nasıl|neden|niçin|kaç|hangi|nerede|ne zaman)\b/i.test(s)
    if (!isQuestion) continue
    const answer = s.replace(/\?+\s*$/, '').trim()
    if (answer.length < 12 || answer.length > 220) continue
    out.push({ question: s, context: answer })
    if (out.length >= 25) break
  }
  return out
}