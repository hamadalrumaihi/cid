import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedBump } from './realtime'

// The channel wiring needs a configured supabase client; the debounce core is
// pure over timers, so it carries the full BUG-023 contract here: a burst of
// events for one table produces O(1) bumps after the burst ends.
describe('createDebouncedBump', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('bumps a lone event immediately (leading edge) and never again', () => {
    const bump = vi.fn()
    const fire = createDebouncedBump(bump, 300)
    fire('cases')
    expect(bump).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(bump).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst into one leading + one trailing bump', () => {
    const bump = vi.fn()
    const fire = createDebouncedBump(bump, 300)
    for (let i = 0; i < 50; i++) { fire('cases'); vi.advanceTimersByTime(10) }
    expect(bump).toHaveBeenCalledTimes(1) // leading only while the burst runs
    vi.advanceTimersByTime(300)
    expect(bump).toHaveBeenCalledTimes(2) // one trailing bump after quiet
    vi.advanceTimersByTime(1000)
    expect(bump).toHaveBeenCalledTimes(2)
  })

  it('resets the trailing window on every event (true trailing edge)', () => {
    const bump = vi.fn()
    const fire = createDebouncedBump(bump, 300)
    fire('cases')
    vi.advanceTimersByTime(250)
    fire('cases') // inside the window — pushes the trailing bump out
    vi.advanceTimersByTime(250)
    expect(bump).toHaveBeenCalledTimes(1) // still only the leading bump
    vi.advanceTimersByTime(50)
    expect(bump).toHaveBeenCalledTimes(2)
  })

  it('debounces per table — one table never delays another', () => {
    const bump = vi.fn()
    const fire = createDebouncedBump(bump, 300)
    fire('cases')
    fire('reports')
    expect(bump).toHaveBeenNthCalledWith(1, 'cases')
    expect(bump).toHaveBeenNthCalledWith(2, 'reports')
    fire('cases')
    vi.advanceTimersByTime(300)
    expect(bump).toHaveBeenCalledTimes(3)
    expect(bump).toHaveBeenLastCalledWith('cases')
  })

  it('starts a fresh leading bump once a burst has settled', () => {
    const bump = vi.fn()
    const fire = createDebouncedBump(bump, 300)
    fire('cases')
    fire('cases')
    vi.advanceTimersByTime(300) // leading + trailing
    fire('cases') // new burst — prompt again
    expect(bump).toHaveBeenCalledTimes(3)
  })
})
