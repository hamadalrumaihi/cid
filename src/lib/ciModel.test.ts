/** CI compartment — pure model helpers. Offline; the authority (RLS, the
 *  definer RPCs) is exercised by tests/rls/v191*.test.ts, not here. */
import { describe, expect, it } from 'vitest'
import {
  CI_CORROBORATION, CI_DEFAULT_CAPACITY, CI_MOTIVES, CI_RELIABILITY, CI_RISK, CI_STATUSES,
  capacityLabel, contactState, groupHandlers, handlerRosterStats, isAtCapacity, motiveSummary,
  parseCiResult, sanitizeCheck,
} from './ciModel'

const NOW = Date.parse('2026-09-10T12:00:00Z')
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString()

describe('vocabularies mirror the migration', () => {
  it('has the documented cardinalities', () => {
    expect(CI_STATUSES).toHaveLength(7)
    expect(CI_MOTIVES).toHaveLength(12)
    expect(CI_RELIABILITY).toHaveLength(5)
    expect(CI_RISK).toHaveLength(4)
    expect(CI_CORROBORATION).toHaveLength(5)
    expect(CI_DEFAULT_CAPACITY).toBe(6)
  })
})

describe('capacity', () => {
  it('spells the one label', () => {
    expect(capacityLabel(2, 6)).toBe('2 / 6 Informants')
    expect(capacityLabel(0, 30)).toBe('0 / 30 Informants')
  })
  it('is at capacity at or above the limit only', () => {
    expect(isAtCapacity(5, 6)).toBe(false)
    expect(isAtCapacity(6, 6)).toBe(true)
    expect(isAtCapacity(7, 6)).toBe(true)
  })
})

describe('contactState', () => {
  it('reads a scheduled contact', () => {
    expect(contactState({ next_contact_at: days(-1) }, NOW)).toBe('overdue')
    expect(contactState({ next_contact_at: days(3) }, NOW)).toBe('due_soon')
    expect(contactState({ next_contact_at: days(7) }, NOW)).toBe('due_soon')
    expect(contactState({ next_contact_at: days(8) }, NOW)).toBe('ok')
  })
  it('treats 30 days of silence on an ACTIVE source as overdue', () => {
    expect(contactState({ status: 'active', last_contact_at: days(-31) }, NOW)).toBe('overdue')
    expect(contactState({ status: 'active', last_contact_at: days(-10) }, NOW)).toBe('ok')
    // A dormant source is not on a cadence.
    expect(contactState({ status: 'dormant', last_contact_at: days(-90) }, NOW)).toBe('ok')
  })
  it('is none with no dates, and tolerates garbage', () => {
    expect(contactState({}, NOW)).toBe('none')
    expect(contactState({ next_contact_at: 'nope', last_contact_at: null }, NOW)).toBe('none')
  })
  it('accepts a Date for now', () => {
    expect(contactState({ next_contact_at: days(-1) }, new Date(NOW))).toBe('overdue')
  })
})

describe('groupHandlers', () => {
  const h = (user_id: string, role: string, ended_at: string | null = null) => ({ user_id, role, ended_at })
  it('fills the two live slots and keeps ended rows as history', () => {
    const g = groupHandlers([h('a', 'primary', days(-5)), h('b', 'primary'), h('c', 'secondary'), h('d', 'secondary', days(-1))])
    expect(g.primary?.user_id).toBe('b')
    expect(g.secondary?.user_id).toBe('c')
    expect(g.others).toEqual([])
    expect(g.history.map((x) => x.user_id)).toEqual(['d', 'a'])
  })
  it('never lets an ended row occupy a slot, and parks duplicates in others', () => {
    const g = groupHandlers([h('a', 'primary', days(-5)), h('x', 'primary'), h('y', 'primary')])
    expect(g.primary?.user_id).toBe('x')
    expect(g.others.map((x) => x.user_id)).toEqual(['y'])
    expect(g.secondary).toBeNull()
  })
  it('handles null', () => {
    expect(groupHandlers(null)).toEqual({ primary: null, secondary: null, others: [], history: [] })
  })
})

describe('sanitizeCheck — cosmetic mirror of private.ci_sanitized', () => {
  const subject = { ciNumber: 'CI-0041', name: 'Ana Ruiz', alias: 'Sparrow', handlerNames: ['Tom Wood', null] }
  it('passes clean text', () => {
    expect(sanitizeCheck('A source reports a stash house on Grove St.', subject)).toEqual({ clean: true, hits: [] })
    expect(sanitizeCheck('', subject).clean).toBe(true)
    expect(sanitizeCheck(null, subject).clean).toBe(true)
  })
  it('catches the CI number, name, alias and handler names, case- and space-insensitively', () => {
    expect(sanitizeCheck('per ci-0041', subject).hits).toEqual(['CI-0041'])
    expect(sanitizeCheck('ANA   RUIZ said', subject).hits).toEqual(['Ana Ruiz'])
    expect(sanitizeCheck('codename sparrow', subject).hits).toEqual(['Sparrow'])
    expect(sanitizeCheck('Handled by Tom Wood', subject).hits).toEqual(['Tom Wood'])
  })
  it('reports every hit once', () => {
    const r = sanitizeCheck('CI-0041 aka Sparrow (CI-0041)', subject)
    expect(r.clean).toBe(false)
    expect(r.hits).toEqual(['CI-0041', 'Sparrow'])
  })
  it('ignores empty and one-character identifiers', () => {
    expect(sanitizeCheck('anything at all', { ciNumber: '', name: 'A', alias: null }).clean).toBe(true)
  })
})

describe('motiveSummary', () => {
  it('labels the primary and lists the extras', () => {
    expect(motiveSummary('money', [])).toBe('Money')
    expect(motiveSummary('money', ['leniency', 'protection'])).toBe('Money (+ Leniency, Protection)')
  })
  it('drops a secondary that repeats the primary, and renders unknown values verbatim', () => {
    expect(motiveSummary('money', ['money', 'zeal'])).toBe('Money (+ zeal)')
  })
  it('handles no primary', () => {
    expect(motiveSummary(null, [])).toBe('—')
    expect(motiveSummary(null, ['revenge'])).toBe('Revenge')
  })
})

describe('parseCiResult', () => {
  it('passes a transport error through with its code and message', () => {
    expect(parseCiResult(null, { message: 'You are at capacity (6 / 6).', code: 'P0403' }))
      .toEqual({ ok: false, code: 'P0403', message: 'You are at capacity (6 / 6).' })
  })
  it('keeps the server refusal verbatim', () => {
    expect(parseCiResult({ ok: false, code: 'capacity', message: 'Tom Wood is at capacity (6 / 6). Confirm the override with a reason.' }, null))
      .toEqual({ ok: false, code: 'capacity', message: 'Tom Wood is at capacity (6 / 6). Confirm the override with a reason.' })
  })
  it('falls back when the refusal carries no message', () => {
    const r = parseCiResult({ ok: false }, null, 'Refused.')
    expect(r).toEqual({ ok: false, code: 'refused', message: 'Refused.' })
  })
  it('treats a null body as a refusal rather than a success', () => {
    expect(parseCiResult(null, null).ok).toBe(false)
  })
  it('spreads a success body', () => {
    expect(parseCiResult<{ id: string; ci_number: string }>({ ok: true, id: 'x', ci_number: 'CI-0001' }, null))
      .toEqual({ ok: true, id: 'x', ci_number: 'CI-0001' })
  })
})

describe('handlerRosterStats — from the caller’s own rows only', () => {
  it('sums the four cards', () => {
    const rows = [
      { status: 'active', open_followups: 2, linked_cases: 1, last_contact_at: days(-2), next_contact_at: days(-1) },
      { status: 'active', open_followups: 0, linked_cases: 3, last_contact_at: days(-2), next_contact_at: days(20) },
      { status: 'dormant', open_followups: 1, linked_cases: 0, last_contact_at: null, next_contact_at: days(2) },
    ]
    expect(handlerRosterStats(rows, NOW)).toEqual({ active: 2, contactsDue: 2, followUps: 3, relatedCases: 4 })
  })
  it('is all zeros for no rows', () => {
    expect(handlerRosterStats([], NOW)).toEqual({ active: 0, contactsDue: 0, followUps: 0, relatedCases: 0 })
  })
})
