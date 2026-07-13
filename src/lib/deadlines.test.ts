import { describe, expect, it } from 'vitest'
import { deadlineInfo } from './deadlines'

/** Fixed reference instant — every assertion passes `now` explicitly so the
 *  suite never depends on the wall clock. */
const T0 = new Date('2026-07-10T12:00:00').getTime()
const at = (hoursFromT0: number) => new Date(T0 + hoursFromT0 * 3_600_000).toISOString()

describe('deadlineInfo — parsing', () => {
  it('returns null for missing or unparseable timestamps', () => {
    expect(deadlineInfo(null, 'due', { now: T0 })).toBeNull()
    expect(deadlineInfo(undefined, 'due', { now: T0 })).toBeNull()
    expect(deadlineInfo('', 'due', { now: T0 })).toBeNull()
    expect(deadlineInfo('not-a-date', 'due', { now: T0 })).toBeNull()
  })
})

describe('deadlineInfo — future thresholds', () => {
  it('far future (beyond soonHours) renders a date, not a countdown', () => {
    const info = deadlineInfo(at(100), 'due', { now: T0 })!
    expect(info.text).toMatch(/^Due /)
    expect(info.text).not.toMatch(/in \d+h/)
    expect(info).toMatchObject({ urgent: false, overdue: false })
  })

  it('inside soonHours but outside urgentHours: countdown, not urgent', () => {
    expect(deadlineInfo(at(40), 'due', { now: T0 }))
      .toEqual({ text: 'Due in 40h', urgent: false, overdue: false })
  })

  it('boundaries are inclusive: exactly soonHours counts down, exactly urgentHours is urgent', () => {
    expect(deadlineInfo(at(48), 'due', { now: T0 }))
      .toEqual({ text: 'Due in 48h', urgent: false, overdue: false })
    expect(deadlineInfo(at(24), 'due', { now: T0 }))
      .toEqual({ text: 'Due in 24h', urgent: true, overdue: false })
  })

  it('inside urgentHours: urgent but not overdue', () => {
    expect(deadlineInfo(at(10), 'due', { now: T0 }))
      .toEqual({ text: 'Due in 10h', urgent: true, overdue: false })
  })

  it('custom soonHours/urgentHours move both thresholds', () => {
    expect(deadlineInfo(at(80), 'due', { now: T0, soonHours: 100, urgentHours: 50 }))
      .toEqual({ text: 'Due in 80h', urgent: false, overdue: false })
    expect(deadlineInfo(at(40), 'due', { now: T0, soonHours: 100, urgentHours: 50 }))
      .toEqual({ text: 'Due in 40h', urgent: true, overdue: false })
  })
})

describe('deadlineInfo — overdue', () => {
  it('a past deadline is urgent + overdue with an "Overdue by …" text', () => {
    expect(deadlineInfo(at(-30), 'due', { now: T0 }))
      .toEqual({ text: 'Overdue by 30h', urgent: true, overdue: true })
  })

  it('48h+ past switches to days', () => {
    expect(deadlineInfo(at(-72), 'due', { now: T0 }))
      .toEqual({ text: 'Overdue by 3d', urgent: true, overdue: true })
  })

  it('just past (under half an hour) drops the amount', () => {
    const info = deadlineInfo(new Date(T0 - 20 * 60_000).toISOString(), 'due', { now: T0 })!
    expect(info).toEqual({ text: 'Overdue', urgent: true, overdue: true })
  })

  it('exactly now counts as overdue (server timestamps are authoritative)', () => {
    expect(deadlineInfo(at(0), 'due', { now: T0 }))
      .toEqual({ text: 'Overdue', urgent: true, overdue: true })
  })
})

describe('deadlineInfo — per-kind vocabulary', () => {
  it("'due' says Due / Overdue", () => {
    expect(deadlineInfo(at(10), 'due', { now: T0 })!.text).toBe('Due in 10h')
    expect(deadlineInfo(at(-30), 'due', { now: T0 })!.text).toBe('Overdue by 30h')
  })
  it("'expires' says Expires / Expired", () => {
    expect(deadlineInfo(at(10), 'expires', { now: T0 })!.text).toBe('Expires in 10h')
    expect(deadlineInfo(at(-30), 'expires', { now: T0 })!.text).toBe('Expired by 30h')
    expect(deadlineInfo(at(100), 'expires', { now: T0 })!.text).toMatch(/^Expires /)
  })
  it("'deadline' says Response due / Response overdue", () => {
    expect(deadlineInfo(at(10), 'deadline', { now: T0 })!.text).toBe('Response due in 10h')
    expect(deadlineInfo(at(-30), 'deadline', { now: T0 })!.text).toBe('Response overdue by 30h')
  })
})

describe('deadlineInfo — date-only values', () => {
  // Date-only strings parse as LOCAL end-of-day, so anchor `now` with local
  // timestamps too — the assertions hold in any timezone.
  it('counts as due at end of day: noon that day is 12h out (urgent)', () => {
    const noon = new Date('2026-08-01T12:00:00').getTime()
    expect(deadlineInfo('2026-08-01', 'due', { now: noon }))
      .toEqual({ text: 'Due in 12h', urgent: true, overdue: false })
  })

  it('is not overdue until the day has fully passed', () => {
    const lastSecond = new Date('2026-08-01T23:59:59').getTime()
    const info = deadlineInfo('2026-08-01', 'due', { now: lastSecond })!
    expect(info).toEqual({ text: 'Overdue', urgent: true, overdue: true }) // ms === 0 → past
    const nextEvening = new Date('2026-08-03T23:59:59').getTime()
    expect(deadlineInfo('2026-08-01', 'due', { now: nextEvening }))
      .toEqual({ text: 'Overdue by 2d', urgent: true, overdue: true })
  })
})
