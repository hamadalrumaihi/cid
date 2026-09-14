/** Stale queue rows.
 *
 *  Two properties matter. A dated row is never "stale" however old it is —
 *  it is overdue, and conflating the two would file real deadline misses
 *  under a label that reads as "ignorable". And the advice must never tell a
 *  member to dismiss something they cannot dismiss: a decision row refuses
 *  dismissal server-side, so "dismiss it" there is advice that fails. */
import { describe, expect, it } from 'vitest'
import { STALE_DAYS, ageInDays, isStale, staleAdvice } from './actionStale'
import type { ActionItem } from './actionItems'

const NOW = Date.parse('2026-09-14T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

const row = (over: Partial<ActionItem> = {}): ActionItem => ({
  createdAt: daysAgo(30), waitingSince: null, dueAt: null,
  status: 'needs_action', dedupeKey: 'task:t1',
  ...over,
} as ActionItem)

describe('isStale', () => {
  it('flags undated work that has stopped moving', () => {
    expect(isStale(row({ createdAt: daysAgo(STALE_DAYS) }), NOW)).toBe(true)
    expect(isStale(row({ createdAt: daysAgo(STALE_DAYS - 1) }), NOW)).toBe(false)
  })

  it('never calls a dated row stale, however old', () => {
    // An old row WITH a deadline is overdue — a different, louder problem.
    // Filing it under "Stale" would read as "safe to ignore".
    expect(isStale(row({ createdAt: daysAgo(400), dueAt: daysAgo(300) }), NOW)).toBe(false)
  })

  it('measures a waiting row from when it started waiting', () => {
    // The row may be old; what matters is how long it has sat in someone
    // else's queue.
    const it = row({ createdAt: daysAgo(90), waitingSince: daysAgo(3) })
    expect(ageInDays(it, NOW)).toBe(3)
    expect(isStale(it, NOW)).toBe(false)
  })

  it('survives an unparseable timestamp instead of reporting a huge age', () => {
    expect(ageInDays(row({ createdAt: 'not a date' }), NOW)).toBe(0)
  })
})

describe('staleAdvice', () => {
  it('never tells a member to dismiss what the server will not let them dismiss', () => {
    // Decisions and assigned work refuse dismissal (lib/actionState); advice
    // that fails when followed is worse than none.
    const advice = staleAdvice({ status: 'needs_action', dedupeKey: 'signoff:s1' }, 20)
    expect(advice).not.toMatch(/dismiss/i)
    expect(advice).toMatch(/due date|act/i)
  })

  it('points a waiting row at the person actually holding it', () => {
    const advice = staleAdvice({ status: 'waiting', dedupeKey: 'task:t1' }, 20)
    expect(advice).toMatch(/someone else|chase|reassign/i)
  })

  it('always says how long it has been', () => {
    expect(staleAdvice({ status: 'needs_action', dedupeKey: 'notif:n1' }, 21)).toContain('21 days')
  })
})
