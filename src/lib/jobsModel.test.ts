/** Pins for the background-jobs model (platform upgrade §2.2): the
 *  `job_fail` backoff `min(1h, 5s·2^attempts)`, the lease / reap rule, the
 *  retry gate, the terminal statuses and the progress reader. */
import { describe, expect, it } from 'vitest'
import {
  JOB_BACKOFF_CAP_MS, JOB_KINDS, JOB_LEASE_MS, JOB_QUEUES, JOB_STATUSES, backoffMs, isTerminalJobStatus, jobProgress, leaseExpired, nextRunAfter,
  willRetry, type JobKind, type JobStatus,
} from './jobsModel'

describe('backoffMs — min(1 hour, 5 s · 2^attempts)', () => {
  it('doubles from 5 s', () => {
    expect(backoffMs(0)).toBe(5_000)
    expect(backoffMs(1)).toBe(10_000)
    expect(backoffMs(2)).toBe(20_000)
    expect(backoffMs(3)).toBe(40_000)
    expect(backoffMs(4)).toBe(80_000)
    expect(backoffMs(5)).toBe(160_000)
  })

  it('caps at one hour from the tenth attempt on (5 s · 2^10 = 5120 s > 3600 s)', () => {
    expect(backoffMs(9)).toBe(2_560_000)
    expect(backoffMs(10)).toBe(JOB_BACKOFF_CAP_MS)
    expect(backoffMs(11)).toBe(JOB_BACKOFF_CAP_MS)
    expect(backoffMs(100)).toBe(JOB_BACKOFF_CAP_MS)
    expect(backoffMs(10_000)).toBe(JOB_BACKOFF_CAP_MS)
  })

  it('treats negatives / fractions as their floor at zero and non-finite input as the cap', () => {
    expect(backoffMs(-3)).toBe(5_000)
    expect(backoffMs(1.9)).toBe(10_000)
    expect(backoffMs(Number.NaN)).toBe(JOB_BACKOFF_CAP_MS)
    expect(backoffMs(Number.POSITIVE_INFINITY)).toBe(JOB_BACKOFF_CAP_MS)
  })

  it('nextRunAfter adds the backoff to the failure time', () => {
    const at = new Date('2026-11-05T12:00:00.000Z')
    expect(nextRunAfter(at, 0).toISOString()).toBe('2026-11-05T12:00:05.000Z')
    expect(nextRunAfter(at.toISOString(), 3).toISOString()).toBe('2026-11-05T12:00:40.000Z')
    expect(nextRunAfter(at.getTime(), 12).toISOString()).toBe('2026-11-05T13:00:00.000Z')
  })
})

describe('retry gate, lease, terminal statuses', () => {
  it('willRetry while attempts < max_attempts (the default 5 gives five tries)', () => {
    expect(willRetry(0, 5)).toBe(true)
    expect(willRetry(4, 5)).toBe(true)
    expect(willRetry(5, 5)).toBe(false)
    expect(willRetry(7, 5)).toBe(false)
    expect(willRetry(Number.NaN, 5)).toBe(false)
  })

  it('the lease is five minutes and an expired lease is reapable', () => {
    expect(JOB_LEASE_MS).toBe(300_000)
    const now = Date.parse('2026-11-05T12:10:00.000Z')
    expect(leaseExpired('2026-11-05T12:09:59.000Z', now)).toBe(true)
    expect(leaseExpired('2026-11-05T12:10:01.000Z', now)).toBe(false)
    expect(leaseExpired(null, now)).toBe(false)
    expect(leaseExpired('not a date', now)).toBe(false)
  })

  it('succeeded / failed / cancelled are terminal; queued / claimed / running are not', () => {
    const terminal: JobStatus[] = ['succeeded', 'failed', 'cancelled']
    for (const s of terminal) expect(isTerminalJobStatus(s), s).toBe(true)
    for (const s of ['queued', 'claimed', 'running', null, undefined, '']) expect(isTerminalJobStatus(s), String(s)).toBe(false)
    expect(JOB_STATUSES.filter(isTerminalJobStatus)).toEqual(terminal)
  })

  it('every job kind rides one of the ten queues', () => {
    const verify: JobKind = 'evidence.verify'
    expect(JOB_KINDS[verify]).toBe('evidence')
    for (const [kind, queue] of Object.entries(JOB_KINDS)) {
      expect(JOB_QUEUES, kind).toContain(queue)
      expect(kind).toMatch(/^[a-z]+\.[a-z_]+$/)
    }
    expect(Object.keys(JOB_KINDS)).toHaveLength(10)
  })
})

describe('jobProgress', () => {
  it('reads {pct, step, message} and clamps pct to 0–100', () => {
    expect(jobProgress({ pct: 42.4, step: 'hash', message: 'hashing 12 MB' })).toEqual({ pct: 42, step: 'hash', message: 'hashing 12 MB' })
    expect(jobProgress({ pct: 250 })).toEqual({ pct: 100, step: null, message: null })
    expect(jobProgress({ pct: -1, step: '  ' })).toEqual({ pct: 0, step: null, message: null })
  })

  it('never renders NaN for a missing or malformed value', () => {
    expect(jobProgress(null)).toEqual({ pct: 0, step: null, message: null })
    expect(jobProgress('50')).toEqual({ pct: 0, step: null, message: null })
    expect(jobProgress([1, 2])).toEqual({ pct: 0, step: null, message: null })
    expect(jobProgress({ pct: 'many' })).toEqual({ pct: 0, step: null, message: null })
  })
})
