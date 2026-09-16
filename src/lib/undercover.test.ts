/** The undercover model.
 *
 *  Three properties carry real consequences and are pinned here, because each
 *  one is a way the portal could misrepresent an issued procedure:
 *
 *   · The 72-hour clock starts when the SESSION ENDS, not when it started —
 *     and running out is the end of an obligation, never a prompt to delete.
 *   · §5 requires all three notifications. A report with two of them is
 *     incomplete, and the screen has to say which one is missing.
 *   · Reporting criminal activity is a duty, not a finding. Nothing in the
 *     model may turn that flag into a disciplinary state. */
import { describe, expect, it } from 'vitest'
import {
  UC_RETENTION_HOURS, notificationCompleteness, retentionInfo, ucObligations, ucOutstandingCount,
  ucRecordingLabel, ucStatusLabel,
} from './undercover'
import type { UcCriminalActivity, UcOperation } from './undercover'

const HOUR = 3600_000
const NOW = Date.parse('2026-09-16T12:00:00.000Z')
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString()

const op = (over: Partial<UcOperation> = {}): UcOperation => ({
  status: 'active', ended_at: null, retention_until: null,
  recording_status: 'confirmed', criminal_activity: false,
  bureau_lead_notified_at: null, command_notified_at: null, recording_submitted_at: null,
  command_review_status: 'not_required',
  ...over,
} as UcOperation)

const report = (over: Partial<UcCriminalActivity> = {}): UcCriminalActivity => ({
  bureau_lead_notified_at: null, command_notified_at: null, recording_submitted_at: null,
  ...over,
} as UcCriminalActivity)

describe('retentionInfo — the 72-hour floor', () => {
  it('does not start the clock until the session has concluded', () => {
    const r = retentionInfo(op({ ended_at: null, retention_until: null }), NOW)
    expect(r.state).toBe('not_started')
    expect(r.until).toBeNull()
    expect(r.hoursLeft).toBeNull()
  })

  it('counts from the END of the session, not its start', () => {
    // A long operation that ended an hour ago still owes 71 more hours.
    const r = retentionInfo(op({ ended_at: iso(-HOUR), retention_until: null }), NOW)
    expect(r.state).toBe('holding')
    expect(r.hoursLeft).toBe(UC_RETENTION_HOURS - 1)
  })

  it('prefers the deadline the server derived over re-deriving it', () => {
    // The server owns this column; a client that recomputes can disagree with
    // it after a clock skew or an edit, and the server's answer is the one
    // Command will hold the detective to.
    const r = retentionInfo(op({ ended_at: iso(-HOUR), retention_until: iso(10 * HOUR) }), NOW)
    expect(r.hoursLeft).toBe(10)
  })

  it('reports elapsed without ever suggesting deletion', () => {
    const r = retentionInfo(op({ ended_at: iso(-100 * HOUR), retention_until: iso(-28 * HOUR) }), NOW)
    expect(r.state).toBe('elapsed')
    // Never negative: "-28 hours left" reads as an overdue task, and nothing
    // is overdue here — the minimum has simply been met.
    expect(r.hoursLeft).toBe(0)
  })

  it('survives an unparseable deadline instead of rendering NaN', () => {
    const r = retentionInfo(op({ ended_at: 'not a date', retention_until: 'not a date' }), NOW)
    expect(r.state).toBe('not_started')
  })
})

describe('notificationCompleteness — §5 requires all three', () => {
  it('lists every outstanding requirement in the procedure’s order', () => {
    expect(notificationCompleteness(report()).outstanding).toEqual(['bureau_lead', 'command', 'recording'])
  })

  it('is not satisfied by notifying Command alone', () => {
    // The procedure names the Bureau Lead AND Command, and requires the
    // recording. Two out of three is an incomplete report.
    const c = notificationCompleteness(report({ command_notified_at: iso(0), recording_submitted_at: iso(0) }))
    expect(c.complete).toBe(false)
    expect(c.outstanding).toEqual(['bureau_lead'])
  })

  it('is complete only when all three are recorded', () => {
    const c = notificationCompleteness(report({
      bureau_lead_notified_at: iso(0), command_notified_at: iso(0), recording_submitted_at: iso(0),
    }))
    expect(c.complete).toBe(true)
    expect(c.outstanding).toEqual([])
  })
})

describe('ucObligations — what the operation still owes', () => {
  it('asks for the recording answer only while it is unanswered', () => {
    expect(ucOutstandingCount(op({ recording_status: 'pending' }))).toBe(1)
    expect(ucOutstandingCount(op({ recording_status: 'confirmed' }))).toBe(0)
    // A technical failure is an ANSWER: §3 permits it, provided it was
    // explained — and the schema will not store it without the explanation.
    expect(ucOutstandingCount(op({ recording_status: 'unavailable' }))).toBe(0)
  })

  it('raises the three §5 duties only once criminal activity is reported', () => {
    expect(ucObligations(op({ criminal_activity: false })).map((o) => o.id)).toEqual(['recording'])
    const ids = ucObligations(op({ criminal_activity: true })).map((o) => o.id)
    expect(ids).toContain('notify_lead')
    expect(ids).toContain('notify_command')
    expect(ids).toContain('submit_recording')
  })

  it('treats a reported §5 reporting duty as paperwork, not as a finding', () => {
    // The obligations are notification steps. None of them says the detective
    // did anything wrong, and nothing in the model marks them as misconduct.
    const labels = ucObligations(op({ criminal_activity: true })).map((o) => o.label.toLowerCase())
    for (const l of labels) {
      expect(l).not.toMatch(/misconduct|violation|discipline|breach/)
    }
  })

  it('keeps a Command recording request open until the recording is submitted', () => {
    const requested = op({ command_review_status: 'requested', recording_submitted_at: null })
    expect(ucObligations(requested).find((o) => o.id === 'command_request')?.outstanding).toBe(true)
    const submitted = op({ command_review_status: 'requested', recording_submitted_at: iso(0) })
    expect(ucObligations(submitted).find((o) => o.id === 'command_request')?.outstanding).toBe(false)
  })
})

describe('labels', () => {
  it('names every status and recording state, and degrades rather than blanking', () => {
    expect(ucStatusLabel('terminated')).toBe('Terminated by Command')
    expect(ucRecordingLabel('unavailable')).toBe('Unavailable — technical failure')
    // A value the client does not know about renders verbatim, never '—',
    // so a future status is visible rather than silently blank.
    expect(ucStatusLabel('some_future_status')).toBe('some_future_status')
    expect(ucStatusLabel(null)).toBe('—')
  })
})
