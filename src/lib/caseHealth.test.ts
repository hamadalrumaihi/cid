import { describe, expect, it } from 'vitest'
import { caseHealth, listCaseHealth, type HealthCase } from './caseHealth'

/** Pinned clock: 2026-08-25 noon UTC. */
const NOW = '2026-08-25T12:00:00.000Z'

function mkCase(over: Partial<HealthCase> = {}): HealthCase {
  return {
    status: 'open',
    signoff_status: 'none',
    lead_detective_id: 'det-1',
    summary: 'A summary.',
    updated_at: '2026-08-24T09:00:00.000Z', // fresh yesterday
    follow_up_at: null,
    ...over,
  }
}

const keys = (flags: { key: string }[]) => flags.map((f) => f.key)

describe('caseHealth — baseline and closed', () => {
  it('a healthy fresh case with every input provided raises nothing', () => {
    const flags = caseHealth({
      c: mkCase(),
      tasks: [{ done: true, due: '2026-08-01' }],
      reports: [{ finalized: true }],
      legal: [{ review_status: 'approved' }],
      blockers: [{ status: 'resolved', review_at: '2026-08-01' }],
      media: [{ title: 'Warehouse door', category: null, archived_at: null }],
      intelLinks: 3,
      nowISO: NOW,
    })
    expect(flags).toEqual([])
  })

  it('closed cases raise NO flags at all — even with pending work', () => {
    const flags = caseHealth({
      c: mkCase({ status: 'closed', lead_detective_id: null, summary: null, follow_up_at: '2026-01-01' }),
      tasks: [{ done: false, due: '2026-01-01' }],
      legal: [{ review_status: 'returned_by_judge' }],
      nowISO: NOW,
    })
    expect(flags).toEqual([])
  })
})

describe('caseHealth — per-flag fixtures', () => {
  it('no_lead: null lead on an active case (warn, overview)', () => {
    const [f] = caseHealth({ c: mkCase({ lead_detective_id: null }), nowISO: NOW })
    expect(f).toMatchObject({ key: 'no_lead', severity: 'warn', tab: 'overview' })
  })

  it('no_lead is suppressed on cold cases', () => {
    expect(keys(caseHealth({ c: mkCase({ status: 'cold', lead_detective_id: null }), nowISO: NOW })))
      .not.toContain('no_lead')
  })

  it('missing_summary: blank/whitespace summary on an active case (info)', () => {
    for (const summary of [null, '', '   ']) {
      const flags = caseHealth({ c: mkCase({ summary }), nowISO: NOW })
      expect(flags).toHaveLength(1)
      expect(flags[0]).toMatchObject({ key: 'missing_summary', severity: 'info', tab: 'overview' })
    }
  })

  it('no_recent_activity: quiet ≥14 days, with the day count in the label', () => {
    const [f] = caseHealth({ c: mkCase({ updated_at: '2026-08-11T12:00:00.000Z' }), nowISO: NOW })
    expect(f).toMatchObject({ key: 'no_recent_activity', severity: 'warn', tab: 'timeline' })
    expect(f.label).toBe('Quiet 14d')
    // 13 days is still fresh.
    expect(caseHealth({ c: mkCase({ updated_at: '2026-08-12T12:00:00.000Z' }), nowISO: NOW })).toEqual([])
  })

  it('no_recent_activity is suppressed on cold cases (dormant is deliberate)', () => {
    expect(caseHealth({ c: mkCase({ status: 'cold', updated_at: '2026-01-01T00:00:00.000Z' }), nowISO: NOW }))
      .toEqual([])
  })

  it('overdue_tasks: open tasks due today or earlier, counted (warn, tasks)', () => {
    const [f] = caseHealth({
      c: mkCase(),
      tasks: [
        { done: false, due: '2026-08-25' },   // due today — overdue
        { done: false, due: '2026-08-20' },   // past — overdue
        { done: false, due: '2026-08-26' },   // tomorrow — not
        { done: true, due: '2026-08-01' },    // done — never
        { done: false, due: null },           // undated — never
      ],
      nowISO: NOW,
    })
    expect(f).toMatchObject({ key: 'overdue_tasks', severity: 'warn', tab: 'tasks' })
    expect(f.label).toBe('2 overdue tasks')
  })

  it('returned_legal: any returned_by_* row raises the flag (warn, legal)', () => {
    const [f] = caseHealth({
      c: mkCase(),
      legal: [
        { review_status: 'returned_by_cid' },
        { review_status: 'submitted_to_doj' },
        { review_status: 'returned_by_judge' },
      ],
      nowISO: NOW,
    })
    expect(f).toMatchObject({ key: 'returned_legal', severity: 'warn', tab: 'legal' })
    expect(f.label).toBe('2 legal requests returned')
    // Terminal / in-flight statuses alone raise nothing.
    expect(caseHealth({ c: mkCase(), legal: [{ review_status: 'approved' }, { review_status: 'denied' }], nowISO: NOW }))
      .toEqual([])
  })

  it('draft_reports: unfinalized reports counted (info, reports)', () => {
    const [f] = caseHealth({
      c: mkCase(),
      reports: [{ finalized: false }, { finalized: true }, { finalized: false }],
      nowISO: NOW,
    })
    expect(f).toMatchObject({ key: 'draft_reports', severity: 'info', tab: 'reports' })
    expect(f.label).toBe('2 draft reports')
  })

  it('open_blockers_review_due: only OPEN blockers with a passed review date', () => {
    const [f] = caseHealth({
      c: mkCase(),
      blockers: [
        { status: 'open', review_at: '2026-08-25' },     // due today
        { status: 'open', review_at: '2026-09-01' },     // future — not due
        { status: 'open', review_at: null },             // undated — not due
        { status: 'resolved', review_at: '2026-08-01' }, // resolved — never
      ],
      nowISO: NOW,
    })
    expect(f).toMatchObject({ key: 'open_blockers_review_due', severity: 'warn', tab: 'overview' })
    expect(f.label).toBe('1 blocker due for review')
  })

  it('follow_up_due: follow-up date today or earlier (warn, overview)', () => {
    const [f] = caseHealth({ c: mkCase({ follow_up_at: '2026-08-25' }), nowISO: NOW })
    expect(f).toMatchObject({ key: 'follow_up_due', severity: 'warn', tab: 'overview' })
    expect(f.why).toContain('2026-08-25')
    expect(caseHealth({ c: mkCase({ follow_up_at: '2026-08-26' }), nowISO: NOW })).toEqual([])
  })

  it('awaiting_signoff: any awaiting_* state, viewer-agnostic (info, signoff)', () => {
    const [f] = caseHealth({ c: mkCase({ signoff_status: 'awaiting_deputy' }), nowISO: NOW })
    expect(f).toMatchObject({ key: 'awaiting_signoff', severity: 'info', tab: 'signoff' })
    // Returned states are the Legal/assessCase story, not this flag.
    expect(caseHealth({ c: mkCase({ signoff_status: 'changes_requested' }), nowISO: NOW })).toEqual([])
  })

  it('no_linked_subjects: a KNOWN zero raises it; undefined skips it', () => {
    const [f] = caseHealth({ c: mkCase(), intelLinks: 0, nowISO: NOW })
    expect(f).toMatchObject({ key: 'no_linked_subjects', severity: 'info', tab: 'intel' })
    expect(caseHealth({ c: mkCase(), nowISO: NOW })).toEqual([])          // not fetched — skip
    expect(caseHealth({ c: mkCase(), intelLinks: 2, nowISO: NOW })).toEqual([])
  })

  it('evidence_without_description: non-archived media with no title AND no category', () => {
    const [f] = caseHealth({
      c: mkCase(),
      media: [
        { title: '', category: null, archived_at: null },            // bare
        { title: '  ', category: '', archived_at: null },            // bare
        { title: '', category: 'surveillance', archived_at: null },  // categorized — ok
        { title: 'Front door', category: null, archived_at: null },  // titled — ok
        { title: '', category: null, archived_at: '2026-08-01' },    // archived — ignored
      ],
      nowISO: NOW,
    })
    expect(f).toMatchObject({ key: 'evidence_without_description', severity: 'info', tab: 'media' })
    expect(f.label).toBe('2 undescribed media items')
  })
})

describe('caseHealth — skip rules and ordering', () => {
  it('undefined optional inputs skip their flags rather than guessing', () => {
    // Same case, no child rows provided: only the row-derivable flags fire.
    const flags = caseHealth({ c: mkCase({ lead_detective_id: null, summary: null }), nowISO: NOW })
    expect(keys(flags)).toEqual(['no_lead', 'missing_summary'])
  })

  it('warn flags sort ahead of info flags in the emitted order', () => {
    const flags = caseHealth({
      c: mkCase({ lead_detective_id: null, summary: null, signoff_status: 'awaiting_director' }),
      tasks: [{ done: false, due: '2026-08-01' }],
      reports: [{ finalized: false }],
      nowISO: NOW,
    })
    const sevs = flags.map((f) => f.severity)
    expect(sevs.indexOf('info')).toBeGreaterThan(sevs.lastIndexOf('warn'))
  })

  it('every flag carries a why and a valid case tab', () => {
    const flags = caseHealth({
      c: mkCase({ lead_detective_id: null, summary: null, follow_up_at: '2026-01-01', updated_at: '2026-01-01T00:00:00.000Z', signoff_status: 'awaiting_deputy' }),
      tasks: [{ done: false, due: '2026-01-01' }],
      reports: [{ finalized: false }],
      legal: [{ review_status: 'returned_by_ada' }],
      blockers: [{ status: 'open', review_at: '2026-01-01' }],
      media: [{ title: '', category: null, archived_at: null }],
      intelLinks: 0,
      nowISO: NOW,
    })
    expect(flags).toHaveLength(11)
    const validTabs = new Set(['overview', 'media', 'intel', 'tasks', 'reports', 'legal', 'signoff', 'timeline'])
    for (const f of flags) {
      expect(f.why.length).toBeGreaterThan(10)
      expect(validTabs.has(f.tab)).toBe(true)
    }
  })
})

describe('listCaseHealth — the list-safe subset', () => {
  it('emits only row-derivable attention flags (never awaiting_signoff)', () => {
    const flags = listCaseHealth(mkCase({
      lead_detective_id: null,
      summary: null,
      follow_up_at: '2026-08-20',
      updated_at: '2026-08-01T00:00:00.000Z',
      signoff_status: 'awaiting_director',
    }), NOW)
    expect(keys(flags).sort()).toEqual(['follow_up_due', 'missing_summary', 'no_lead', 'no_recent_activity'])
  })

  it('a healthy row needs no attention; a closed row never does', () => {
    expect(listCaseHealth(mkCase(), NOW)).toEqual([])
    expect(listCaseHealth(mkCase({ status: 'closed', lead_detective_id: null }), NOW)).toEqual([])
  })
})
