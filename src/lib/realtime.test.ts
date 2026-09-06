import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* ── Fake supabase client (the channel surface realtime.ts touches) ──────── */
type SubscribeCb = (status: string) => void
interface FakeChannel {
  name: string
  filters: Array<Record<string, unknown>>
  handlers: Array<() => void>
  cb: SubscribeCb | null
  on: (ev: string, filter: Record<string, unknown>, handler: () => void) => FakeChannel
  subscribe: (cb?: SubscribeCb) => FakeChannel
}
const channels: FakeChannel[] = []
const removed: string[] = []
const makeChannel = (name: string): FakeChannel => {
  const ch: FakeChannel = {
    name, filters: [], handlers: [], cb: null,
    on(_ev, filter, handler) { ch.filters.push(filter); ch.handlers.push(handler); return ch },
    subscribe(cb) { ch.cb = cb ?? null; return ch },
  }
  channels.push(ch)
  return ch
}
vi.mock('./supabase', () => ({
  isConfigured: true,
  supabase: () => ({
    channel: (name: string) => makeChannel(name),
    removeChannel: (ch: FakeChannel) => { removed.push(ch.name); return Promise.resolve('ok') },
  }),
}))

import { caseVersionKey, createDebouncedBump, resetRealtime, subscribeCaseTable, subscribeTable, useRealtimeStore } from './realtime'

const byName = (name: string) => channels.find((c) => c.name === name)
const version = (key: string) => useRealtimeStore.getState().versions[key] ?? 0

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

/* ── Case-scoped channels and the whole-table fallback (P3-08) ───────────── */
describe('subscribeCaseTable', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {})
    channels.length = 0
    removed.length = 0
    resetRealtime()
    useRealtimeStore.setState({ versions: {} })
  })
  // Drain the module-level debounce timers so one test's burst never leaks
  // a pending trailing bump into the next.
  afterEach(() => { vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('opens one filtered channel per (table, case) and bumps only that case', () => {
    subscribeCaseTable('media', 'c1')
    subscribeCaseTable('media', 'c1') // idempotent
    subscribeCaseTable('media', 'c2')
    expect(channels.map((c) => c.name)).toEqual(['rt_media_c1', 'rt_media_c2'])
    expect(byName('rt_media_c1')!.filters[0]).toMatchObject({ table: 'media', filter: 'case_id=eq.c1' })
    byName('rt_media_c1')!.cb?.('SUBSCRIBED')
    byName('rt_media_c1')!.handlers[0]!()
    expect(version(caseVersionKey('media', 'c1'))).toBe(1)
    expect(version(caseVersionKey('media', 'c2'))).toBe(0)
    expect(version('media')).toBe(0) // the whole-table counter is untouched
    expect(byName('rt_media')).toBeUndefined()
  })

  it('falls back to the whole-table channel when the filter is refused, logging once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    subscribeCaseTable('reports', 'c1')
    subscribeCaseTable('reports', 'c2')
    byName('rt_reports_c1')!.cb?.('CHANNEL_ERROR')
    byName('rt_reports_c2')!.cb?.('TIMED_OUT')
    byName('rt_reports_c2')!.cb?.('TIMED_OUT') // a repeat status must not re-run the fallback
    expect(removed).toEqual(['rt_reports_c1', 'rt_reports_c2'])
    expect(warn).toHaveBeenCalledTimes(1)
    const whole = byName('rt_reports')
    expect(whole).toBeDefined()
    expect(channels.filter((c) => c.name === 'rt_reports')).toHaveLength(1)
    // A whole-table event now moves the table counter AND both scoped counters.
    whole!.handlers[0]!()
    expect(version('reports')).toBe(1)
    expect(version(caseVersionKey('reports', 'c1'))).toBe(1)
    expect(version(caseVersionKey('reports', 'c2'))).toBe(1)
  })

  it('a whole-table channel opened directly never bumps scoped counters that did not fall back', () => {
    subscribeCaseTable('case_tasks', 'c1')
    byName('rt_case_tasks_c1')!.cb?.('SUBSCRIBED')
    subscribeTable('case_tasks')
    byName('rt_case_tasks')!.handlers[0]!()
    expect(version('case_tasks')).toBe(1)
    expect(version(caseVersionKey('case_tasks', 'c1'))).toBe(0)
  })

  it('debounces scoped bursts like table-wide ones', () => {
    subscribeCaseTable('media', 'c1')
    const h = byName('rt_media_c1')!.handlers[0]!
    for (let i = 0; i < 20; i++) { h(); vi.advanceTimersByTime(10) }
    expect(version(caseVersionKey('media', 'c1'))).toBe(1)
    vi.advanceTimersByTime(300)
    expect(version(caseVersionKey('media', 'c1'))).toBe(2)
  })
})
