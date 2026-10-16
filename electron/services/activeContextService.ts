import { ActiveContext } from '../../types/jmc'
import { StorageService } from './storageService'

export class ActiveContextService {
  private storageService: StorageService
  private context: ActiveContext = {}

  constructor(storageService: StorageService) {
    this.storageService = storageService
  }

  public getContext(): ActiveContext {
    return { ...this.context }
  }

  /**
   * Baglami tamamen temizler.
   *
   * Bu veri dogrudan model istem sistemine girer. Oturum kapandiginda
   * (ya da hesap degistiginde) sifirlanmazsa, bir sonraki kullanicinin
   * yapay zeka sohbetinde ONCEKI KULLANICININ ders ve odev adlari
   * saglayiciya gonderilir. Bu bir veri sizintisidir.
   */
  public reset(): void {
    this.context = {}
  }

  public updateContext(partial: Partial<ActiveContext>): ActiveContext {
    this.context = {
      ...this.context,
      ...partial,
    }

    // Auto enrich course name if courseId provided
    if (partial.activeCourseId && !partial.activeCourseName) {
      const courses = this.storageService.getCourses()
      const c = courses.find(item => item.id === partial.activeCourseId)
      if (c) this.context.activeCourseName = c.name
    }

    // Auto enrich coursework title & rubric count if workId provided
    if (partial.activeCourseWorkId && partial.activeCourseId) {
      const work = this.storageService.getCourseWorkItem(partial.activeCourseId, partial.activeCourseWorkId)
      if (work) {
        this.context.activeCourseWorkTitle = work.title
        const rubric = this.storageService.getRubric(work.id)
        if (rubric) {
          this.context.hasRubric = true
          this.context.rubricCriteriaCount = rubric.criteria.length
        }
      }
    }

    return { ...this.context }
  }
}
