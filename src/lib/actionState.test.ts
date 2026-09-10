/** Parity of `classifyActionKey` with `private.action_key_class` (contract
 *  §2.3) over the representative key shapes, plus the snooze cap. The RPC
 *  wrapper itself is exercised by the MSW handlers / RLS suites. */
import { describe, expect, it } from 'vitest'
import {
  MAX_SNOOZE_HOURS, SNOOZE_PRESETS, classifyActionKey, isDismissable, isHidden, snoozeUntil,
  type ActionKeyClass,
} from './actionState'

const id = '11111111-2222-3333-4444-555555555555'

/** The same list the server's own class function is documented against. */
const TABLE: [string, ActionKeyClass][] = [
  // dismissable — informational
  [`notif:${id}`, 'dismissable'],
  ['draft:case:new', 'dismissable'],
  [`legal_hold:${id}`, 'dismissable'],
  [`sib_disclosure:${id}`, 'dismissable'],
  [`bolo:${id}`, 'dismissable'],
  [`document_ack:${id}`, 'dismissable'],
  [`document_review:${id}`, 'dismissable'],
  [`document_sync:${id}`, 'dismissable'],
  [`surv_obs:${id}`, 'dismissable'],
  [`grant:${id}`, 'dismissable'],
  ['owner:client_errors:2026-09-09', 'dismissable'],
  [`legal_comment:${id}`, 'dismissable'],
  [`siu_watch:${id}`, 'dismissable'],
  [`siu_watch:${id}:expiry`, 'dismissable'],
  [`surv_tgt:${id}:expiry`, 'dismissable'],
  [`restricted:${id}:expiry`, 'dismissable'],
  [`case:${id}:followup`, 'dismissable'],
  // decision — a command / authority decision
  [`transfer:${id}`, 'decision'],
  [`member_transfer:${id}`, 'decision'],
  [`access:${id}`, 'decision'],
  ['membership:pending', 'decision'],
  [`restricted:${id}`, 'decision'],
  [`restricted:${id}:export`, 'decision'],
  [`sib_access:${id}`, 'decision'],
  [`mdt_export:${id}`, 'decision'],
  [`field_access:${id}`, 'decision'],
  [`tracker:${id}`, 'decision'],
  [`justice:${id}`, 'decision'],
  [`siu_conflict:${id}`, 'decision'],
  [`surv_tgt:${id}`, 'decision'],
  [`document_approval:${id}`, 'decision'],
  [`document_suggestion:${id}`, 'decision'],
  [`narcotic:${id}`, 'decision'],
  [`claim:${id}`, 'decision'],
  [`legal:${id}`, 'decision'],
  [`legal_queue:${id}`, 'decision'],
  [`report:${id}`, 'decision'],
  [`gang_dup:${id}`, 'decision'],
  [`case:${id}:signoff-decide`, 'decision'],
  // work — assigned, never dismissable
  [`task:${id}`, 'work'],
  [`blocker:${id}`, 'work'],
  [`case:${id}:signoff-returned`, 'work'],
  [`intel:${id}`, 'work'],
  [`intel:${id}:reply`, 'work'],
  [`intel:${id}:validate`, 'work'],
  [`sib_referral:${id}`, 'work'],
  [`surv_alert:${id}`, 'decision'],
  ['something:new', 'work'],
  ['', 'work'],
]

describe('classifyActionKey — mirror of private.action_key_class', () => {
  it.each(TABLE)('%s → %s', (key, cls) => {
    expect(classifyActionKey(key)).toBe(cls)
    expect(isDismissable(key)).toBe(cls === 'dismissable')
  })

  it('an :expiry suffix wins over a decision prefix', () => {
    expect(classifyActionKey(`surv_tgt:${id}`)).toBe('decision')
    expect(classifyActionKey(`surv_tgt:${id}:expiry`)).toBe('dismissable')
  })

  it('legal_* prefixes do not collide', () => {
    expect(classifyActionKey(`legal:${id}`)).toBe('decision')
    expect(classifyActionKey(`legal_queue:${id}`)).toBe('decision')
    expect(classifyActionKey(`legal_hold:${id}`)).toBe('dismissable')
    expect(classifyActionKey(`legal_comment:${id}`)).toBe('dismissable')
  })
})

describe('snooze presets', () => {
  const now = new Date('2026-09-09T15:30:00').getTime()

  it('exposes 1 h, 4 h, tomorrow 9:00 and 48 h', () => {
    expect(SNOOZE_PRESETS.map((p) => p.id)).toEqual(['h1', 'h4', 'tomorrow', 'h48'])
    expect(MAX_SNOOZE_HOURS).toBe(48)
  })

  it('never resolves past 48 hours', () => {
    const cap = now + MAX_SNOOZE_HOURS * 3_600_000
    for (const p of SNOOZE_PRESETS) {
      const t = new Date(snoozeUntil(p, now)).getTime()
      expect(t, p.id).toBeGreaterThan(now)
      expect(t, p.id).toBeLessThanOrEqual(cap)
    }
    expect(new Date(snoozeUntil({ id: 'h48', label: 'x', hours: 999 }, now)).getTime()).toBe(cap)
  })

  it('tomorrow resolves to the next local 09:00', () => {
    const t = new Date(snoozeUntil(SNOOZE_PRESETS[2], now))
    expect(t.getHours()).toBe(9)
    expect(t.getMinutes()).toBe(0)
    expect(t.getDate()).toBe(new Date(now).getDate() + 1)
  })

  it('fixed presets are exact', () => {
    expect(new Date(snoozeUntil(SNOOZE_PRESETS[0], now)).getTime()).toBe(now + 3_600_000)
    expect(new Date(snoozeUntil(SNOOZE_PRESETS[1], now)).getTime()).toBe(now + 4 * 3_600_000)
  })
})

describe('isHidden', () => {
  const now = Date.parse('2026-09-09T12:00:00Z')
  it('reads dismissed first, then a live snooze, and a lapsed snooze as visible', () => {
    expect(isHidden(null, now)).toBeNull()
    expect(isHidden({ seenAt: null, snoozedUntil: null, dismissedAt: null }, now)).toBeNull()
    expect(isHidden({ seenAt: null, snoozedUntil: '2026-09-09T13:00:00Z', dismissedAt: null }, now)).toBe('snoozed')
    expect(isHidden({ seenAt: null, snoozedUntil: '2026-09-09T11:00:00Z', dismissedAt: null }, now)).toBeNull()
    expect(isHidden({ seenAt: null, snoozedUntil: '2026-09-09T13:00:00Z', dismissedAt: '2026-09-09T10:00:00Z' }, now)).toBe('dismissed')
  })
})
