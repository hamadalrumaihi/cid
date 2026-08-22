/** Unit tests for the charge-record client mirror.
 *
 *  The point of most of these is not that the helpers work — it is that the
 *  mirror still SAYS THE SAME THING as the migration. A client copy of a
 *  server rule is only useful while it agrees; once it drifts it is worse than
 *  having no copy, because it renders controls the database will refuse.
 *
 *  So the transition table is asserted against the SQL text of
 *  private.case_charge_transition_ok() read off disk, rather than against a
 *  second hand-written list that would drift alongside it.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CASE_CHARGE_STATUSES,
  CASE_CHARGE_TERMINAL,
  type CaseChargeStatus,
  type CaseChargeTotals,
  caseChargeActor,
  caseChargeActorLabel,
  caseChargeCanMove,
  caseChargeCapLabel,
  caseChargeFineLabel,
  caseChargeIsTerminal,
  caseChargeJailLabel,
  caseChargeNext,
  caseChargeStatusLabel,
  caseChargeStatusMeaning,
  caseChargeTotalIsProvisional,
} from './caseCharges'

const MIGRATION = 'supabase/migrations/20260905130000_case_charges.sql'
/** The migration that removed command review and re-emitted the constraint. */
const APPROVAL_REMOVED =
  'supabase/migrations/20261001120000_charges_need_no_command_approval.sql'

describe('the vocabulary matches the database constraint', () => {
  it('lists exactly the statuses case_charges_status_check allows', () => {
    // 20261001120000 re-emitted the constraint when command review was removed,
    // so it -- not the table's original migration -- is now the authority on
    // which statuses exist. Reading the wrong file would let the client
    // vocabulary drift from the database without this test noticing.
    const sql = readFileSync(APPROVAL_REMOVED, 'utf8')
    const block = /add constraint case_charges_status_check\s*\n\s*check \(status in \(([\s\S]*?)\)\)/.exec(sql)
    expect(block, 'the status check constraint moved or was renamed').not.toBeNull()
    const fromSql = [...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(fromSql).toEqual([...CASE_CHARGE_STATUSES].sort())
  })

  it('no longer admits the two command-queue states', () => {
    // They existed solely to hold a charge in a Bureau Lead's queue. Removed
    // from the CHECK, not merely made unreachable -- a state nothing can enter
    // but the constraint still admits is an invitation for something to write
    // it later.
    const all = [...CASE_CHARGE_STATUSES] as string[]
    expect(all).not.toContain('proposed')
    expect(all).not.toContain('under_review')
  })

  it('gives every status a label and a meaning', () => {
    for (const s of CASE_CHARGE_STATUSES) {
      expect(caseChargeStatusLabel(s)).toBeTruthy()
      expect(caseChargeStatusMeaning(s)).toBeTruthy()
    }
  })
})

describe('the transition table mirrors private.case_charge_transition_ok()', () => {
  /** Parse the edge list straight out of the migration. */
  const sqlEdges = (): Record<string, string[]> => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const fn = /case_charge_transition_ok[\s\S]*?select case p_from([\s\S]*?)else false/.exec(sql)
    expect(fn, 'case_charge_transition_ok moved or was renamed').not.toBeNull()
    const out: Record<string, string[]> = {}
    for (const m of fn![1].matchAll(/when '([a-z_]+)'\s*then p_to in \(([^)]*)\)/g)) {
      out[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
    }
    return out
  }

  it('agrees edge for edge with the SQL', () => {
    const sql = sqlEdges()
    for (const s of CASE_CHARGE_STATUSES) {
      const mine = [...caseChargeNext(s)].sort()
      // A status absent from the SQL falls through to `else false`: no edges.
      expect(mine, `edges out of ${s}`).toEqual(sql[s] ?? [])
    }
  })

  it('treats convicted, dismissed and withdrawn as terminal', () => {
    for (const s of CASE_CHARGE_TERMINAL) {
      expect(caseChargeIsTerminal(s)).toBe(true)
      expect(caseChargeNext(s)).toHaveLength(0)
    }
  })

  it('still refuses the moves that would skip the court', () => {
    // Removing INTERNAL command review did not open the court lane. A charge
    // cannot leap from the case straight to a conviction.
    expect(caseChargeCanMove('approved', 'convicted')).toBe(false)
    expect(caseChargeCanMove('approved', 'dismissed')).toBe(false)
    // and cannot resurrect a finished charge
    expect(caseChargeCanMove('convicted', 'approved')).toBe(false)
    expect(caseChargeCanMove('withdrawn', 'approved')).toBe(false)
    expect(caseChargeCanMove('dismissed', 'filed')).toBe(false)
  })

  it('has no command-review stage left to pass through', () => {
    // 'proposed' and 'under_review' existed solely to hold a charge in a
    // command queue. They are gone from the type, so this is really a
    // compile-time assertion; the runtime check is that nothing reintroduces
    // them as a reachable state.
    const reachable = new Set(CASE_CHARGE_STATUSES.flatMap((s) => [...caseChargeNext(s)]))
    expect([...reachable].sort()).toEqual(['convicted', 'dismissed', 'filed', 'withdrawn'])
  })

  it('allows withdrawal before the court and never after', () => {
    expect(caseChargeCanMove('approved', 'withdrawn')).toBe(true)
    // Once it is before a court, only the court disposes of it.
    expect(caseChargeCanMove('filed', 'withdrawn')).toBe(false)
  })
})

describe('who makes each move', () => {
  it('keeps the COURT away from the case, but not command', () => {
    // Adding a charge is ordinary casework now. Filing and disposing are not,
    // and removing internal command review did nothing to those.
    expect(caseChargeActor('approved')).toBe('case')
    expect(caseChargeActor('withdrawn')).toBe('case')
    expect(caseChargeActor('filed')).toBe('attorney')
    expect(caseChargeActor('convicted')).toBe('judge')
    expect(caseChargeActor('dismissed')).toBe('judge')
  })

  it('never names a CID prosecutor on an SIU case', () => {
    // The SIU court lane still goes to the Attorney General, never a
    // prosecutor queue. Only the command step in front of it was removed.
    const siuFile = caseChargeActorLabel('filed', true)
    expect(siuFile).toContain('Attorney General')
    expect(siuFile).not.toMatch(/prosecut/i)
  })

  it('names nobody in command for adding a charge, in either lane', () => {
    for (const siu of [true, false]) {
      const label = caseChargeActorLabel('approved', siu)
      expect(label).toBe('anyone working the case')
      expect(label).not.toMatch(/bureau lead|X-1|command/i)
    }
  })

  it('names the CID prosecutor on a CID case', () => {
    // The Bureau Lead is gone from this sentence because they are gone from
    // the workflow. The prosecutor is not.
    expect(caseChargeActorLabel('filed', false)).toMatch(/prosecut/i)
    expect(caseChargeActorLabel('approved', false)).not.toMatch(/bureau lead/i)
  })
})

describe('a judge-set penalty is never rendered as nothing', () => {
  it('says a judge decides rather than showing zero or blank', () => {
    const judgeJail = { jail_months: null, judge_set_jail: true, imposed_jail_months: null }
    expect(caseChargeJailLabel(judgeJail)).toBe('Judge decides')
    expect(caseChargeJailLabel(judgeJail)).not.toMatch(/^0/)

    const judgeFine = { fine: null, judge_set_fine: true, imposed_fine: null }
    expect(caseChargeFineLabel(judgeFine)).toBe('Judge decides')
  })

  it('distinguishes "a judge decides" from "the code states nothing"', () => {
    expect(caseChargeJailLabel({ jail_months: null, judge_set_jail: false, imposed_jail_months: null }))
      .toBe('Not stated')
    expect(caseChargeFineLabel({ fine: null, judge_set_fine: false, imposed_fine: null }))
      .toBe('Not stated')
  })

  it('shows what a judge actually imposed, and says who set it', () => {
    expect(caseChargeJailLabel({ jail_months: null, judge_set_jail: true, imposed_jail_months: 40 }))
      .toBe('40 mo (set by judge)')
    expect(caseChargeFineLabel({ fine: null, judge_set_fine: true, imposed_fine: 60000 }))
      .toBe('$60,000 (set by judge)')
  })

  it('renders a zero term as zero, which is a real sentence', () => {
    expect(caseChargeJailLabel({ jail_months: 0, judge_set_jail: false, imposed_jail_months: null }))
      .toBe('0 mo')
  })
})

describe('totals', () => {
  const base: CaseChargeTotals = {
    charges: 2, counts: 3, months: 120, fine: 270000,
    judge_jail_pending: 0, judge_fine_pending: 0,
    rico: 0, modifiers: 0, convicted: 0,
    cap_months: null, over_cap: null, by_status: { approved: 2 },
  }

  it('flags a total as provisional while a judge has yet to rule', () => {
    expect(caseChargeTotalIsProvisional(base)).toBe(false)
    expect(caseChargeTotalIsProvisional({ ...base, judge_jail_pending: 1 })).toBe(true)
    expect(caseChargeTotalIsProvisional({ ...base, judge_fine_pending: 1 })).toBe(true)
  })

  it('says nothing about a cap the version never stated', () => {
    // The legacy code states no maximum. "Within the limit" would be an
    // assertion about a rule that does not exist.
    expect(caseChargeCapLabel(base)).toBeNull()
  })

  it('captions a stated cap in both directions', () => {
    expect(caseChargeCapLabel({ ...base, cap_months: 200, over_cap: false }))
      .toBe('Within the 200-month maximum')
    expect(caseChargeCapLabel({ ...base, cap_months: 200, over_cap: true, months: 260 }))
      .toBe('Over the 200-month maximum')
  })
})

describe('status ordering', () => {
  it('lists the workflow in order, so a UI can render it as a track', () => {
    const order: CaseChargeStatus[] = [
      'approved', 'filed', 'convicted', 'dismissed', 'withdrawn',
    ]
    expect([...CASE_CHARGE_STATUSES]).toEqual(order)
  })
})
