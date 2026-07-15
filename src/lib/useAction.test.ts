import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runGuarded } from './useAction'
import { useToastStore } from './toast'

// The hook wrapper needs a renderer; the guard core is pure, so it carries
// the full contract (double-fire, error→toast, busy always cleared) here.
describe('runGuarded (useAction core)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => { vi.useRealTimers() })

  it('runs the action, passing args through, and tracks busy around it', async () => {
    const busyRef = { current: false }
    const states: boolean[] = []
    const fn = vi.fn(async (n: number) => { expect(busyRef.current).toBe(true); return n })
    await runGuarded(busyRef, (b) => states.push(b), fn, 7)
    expect(fn).toHaveBeenCalledWith(7)
    expect(states).toEqual([true, false])
    expect(busyRef.current).toBe(false)
  })

  it('ignores a second fire while the first is in flight', async () => {
    const busyRef = { current: false }
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const fn = vi.fn(() => gate)
    const first = runGuarded(busyRef, () => {}, fn)
    const second = runGuarded(busyRef, () => {}, fn) // resolves immediately, no call
    await second
    expect(fn).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(busyRef.current).toBe(false)
  })

  it('routes a thrown error into a danger toast and still clears busy', async () => {
    const busyRef = { current: false }
    const states: boolean[] = []
    await runGuarded(busyRef, (b) => states.push(b), () => {
      throw new Error('duplicate key value violates unique constraint')
    })
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('danger')
    // humanizeError copy, not the raw Postgres message.
    expect(toasts[0].message).toBe('That already exists — use a unique value.')
    expect(states).toEqual([true, false])
    expect(busyRef.current).toBe(false)
  })

  it('allows a re-run after a failure (guard released)', async () => {
    const busyRef = { current: false }
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    await runGuarded(busyRef, () => {}, fn)
    await runGuarded(busyRef, () => {}, fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
