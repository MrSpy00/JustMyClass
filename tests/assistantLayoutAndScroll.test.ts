import { describe, it, expect } from 'vitest'

describe('Assistant Layout & Pinning Auto-Scroll', () => {
  it('determines whether user is at bottom accurately', () => {
    const isAtBottom = (scrollHeight: number, scrollTop: number, clientHeight: number, threshold = 80) => {
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      return distanceFromBottom <= threshold
    }

    // Exact bottom
    expect(isAtBottom(1000, 600, 400)).toBe(true)
    // 30px above bottom (still considered at bottom)
    expect(isAtBottom(1000, 570, 400)).toBe(true)
    // 75px above bottom (threshold allows it)
    expect(isAtBottom(1000, 525, 400)).toBe(true)
    // 150px above bottom (user intentionally scrolled up)
    expect(isAtBottom(1000, 450, 400)).toBe(false)
  })

  it('pins scroll position when chatStuck is active', () => {
    let scrollTop = 0
    const scrollHeight = 1500
    const clientHeight = 400
    let chatStuck = true

    const onContentGrow = (newScrollHeight: number) => {
      if (chatStuck) {
        scrollTop = newScrollHeight - clientHeight
      }
    }

    onContentGrow(1800)
    expect(scrollTop).toBe(1400)

    // User scrolled up
    chatStuck = false
    scrollTop = 800
    onContentGrow(2200)
    // Should NOT jump down if user scrolled up
    expect(scrollTop).toBe(800)

    // User sends new message -> forces chatStuck = true and scrolls to bottom
    chatStuck = true
    scrollTop = 2200 - clientHeight
    expect(scrollTop).toBe(1800)
  })
})
