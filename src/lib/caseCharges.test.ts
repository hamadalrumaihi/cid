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

describe('the vocabulary matches the database constraint', () => {
  it('lists exactly the statuses case_charges_status_check allows', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const block = /status text not null default 'proposed' check \(status in \(([\s\S]*?)\)\)/.exec(sql)
    expect(block, 'the status check constraint moved or was renamed').not.toBeNull()
    const fromSql = [...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(fromSql).toEqual([...CASE_CHARGE_STATUSES].sort())
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

  it('refuses the moves that would skip review or the court', () => {
    expect(caseChargeCanMove('proposed', 'convicted')).toBe(false)
    expect(caseChargeCanMove('proposed', 'approved')).toBe(false)
    expect(caseChargeCanMove('proposed', 'filed')).toBe(false)
    expect(caseChargeCanMove('approved', 'convicted')).toBe(false)
    // and cannot resurrect a finished charge
    expect(caseChargeCanMove('convicted', 'proposed')).toBe(false)
    expect(caseChargeCanMove('withdrawn', 'proposed')).toBe(false)
    expect(caseChargeCanMove('dismissed', 'filed')).toBe(false)
  })

  it('allows the review return path', () => {
    // A reviewer sending a charge back for rework is a legal move, not a
    // withdrawal — losing it would force reviewers to reject outright.
    expect(caseChargeCanMove('under_review', 'proposed')).toBe(true)
  })

  it('allows withdrawal from every pre-court stage and none after', () => {
    expect(caseChargeCanMove('proposed', 'withdrawn')).toBe(true)
    expect(caseChargeCanMove('under_review', 'withdrawn')).toBe(true)
    expect(caseChargeCanMove('approved', 'withdrawn')).toBe(true)
    // Once it is before a court, only the court disposes of it.
    expect(caseChargeCanMove('filed', 'withdrawn')).toBe(false)
  })
})

describe('who makes each move', () => {
  it('routes approval and filing away from the case for both lanes', () => {
    expect(caseChargeActor('approved')).toBe('command')
    expect(caseChargeActor('filed')).toBe('attorney')
    expect(caseChargeActor('convicted')).toBe('judge')
    expect(caseChargeActor('dismissed')).toBe('judge')
  })

  it('never names a CID Bureau Lead or a prosecutor on an SIU case', () => {
    // The standing rule: SIU goes Special Agent -> X-1 -> Attorney General ->
    // Judge, and never through a CID Bureau Lead or a prosecutor queue.
    const siuApprove = caseChargeActorLabel('approved', true)
    const siuFile = caseChargeActorLabel('filed', true)
    expect(siuApprove).toContain('X-1')
    expect(siuApprove).not.toMatch(/bureau lead/i)
    expect(siuFile).toContain('Attorney General')
    expect(siuFile).not.toMatch(/prosecut/i)
  })

  it('names the CID authorities on a CID case', () => {
    expect(caseChargeActorLabel('approved', false)).toMatch(/bureau lead/i)
    expect(caseChargeActorLabel('filed', false)).toMatch(/prosecut/i)
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
    cap_months: null, over_cap: null, by_status: { proposed: 2 },
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
      'proposed', 'under_review', 'approved', 'filed',
      'convicted', 'dismissed', 'withdrawn',
    ]
    expect([...CASE_CHARGE_STATUSES]).toEqual(order)
  })
})
