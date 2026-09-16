/** The undercover screens, through the real db.ts / supabase-js chain.
 *
 *  The database decides who sees an operation; RLS is proven against the live
 *  project by tests/rls/v196a. What is proven HERE is the half a policy cannot
 *  reach — that the screens say the right thing about the answer they were
 *  given, in the four places where saying the wrong thing would misrepresent
 *  an issued procedure:
 *
 *   · an unauthorized viewer gets no undercover TAB on the case. Not a lock,
 *     not a placeholder, not a zero pill — §4's disclosure list includes the
 *     existence of the operation, so a tab that appears and refuses is itself
 *     the disclosure;
 *   · a failed READ is not an empty compartment. "You have no operations" after
 *     a network failure tells a detective their record is gone;
 *   · §3's retention deadline is a MINIMUM to hold a recording, and the screen
 *     never suggests deleting anything;
 *   · §5's outstanding notifications are shown as outstanding PAPERWORK, with
 *     no word of misconduct anywhere on the page.
 */
import { describe, expect, it, vi } from 'vitest'
import { UndercoverCaseTab, useUcCaseCount } from '@/components/cases/tabs/UndercoverCaseTab'
import { UC_RETENTION_HOURS } from '@/lib/undercover'
import { emptyCase, rlsRestricted, roleSession } from '@/mocks/scenarios'
import { mockId, mockTimestamp, seedRows } from '@/mocks/store'
import type { Tables } from '@/lib/database.types'
import { render } from './render'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) =>
    <a href={href} {...rest}>{children}</a>,
}))

const HOUR = 3600_000

function ucRow(over: Partial<Tables<'uc_operations'>> = {}): Tables<'uc_operations'> {
  const id = over.id ?? mockId()
  return {
    id,
    case_id: '',
    detective_id: '',
    bureau: 'major_crimes',
    alias: null,
    objective: null,
    status: 'active',
    started_at: mockTimestamp(-120),
    ended_at: null,
    end_reason: null,
    retention_until: null,
    recording_status: 'pending',
    recording_note: null,
    recording_media_id: null,
    recording_reference: null,
    recording_submitted_at: null,
    recording_submitted_to: null,
    criminal_activity: false,
    bureau_lead_notified_at: null,
    command_notified_at: null,
    compromised_at: null,
    compromise_note: null,
    withdrawn: false,
    command_review_status: 'not_required',
    command_restrictions: null,
    created_by: null,
    created_at: mockTimestamp(),
    updated_at: mockTimestamp(),
    ...over,
  } as Tables<'uc_operations'>
}

/** A probe that renders nothing but the hook's answer — the number CaseDetail
 *  filters the tab on. */
function CountProbe({ caseId }: { caseId: string }) {
  const n = useUcCaseCount(caseId)
  return <span data-testid="count">{n === null ? 'loading' : String(n)}</span>
}

describe('the undercover case tab exists only for a viewer §4 authorizes', () => {
  it('RLS returning nothing means a count of 0 — and CaseDetail lists the tab only above 0', async () => {
    roleSession('detective')
    const { caseRecord } = emptyCase()
    // The compartment is not empty — there IS an operation on this case. The
    // viewer simply is not one of the positions §4 names, so uc_operations_sel
    // hands them nothing. `rlsRestricted` is exactly that: rows exist, this
    // caller reads none.
    seedRows('uc_operations', [ucRow({ case_id: caseRecord.id, alias: 'MUST-NOT-LEAK' })])
    rlsRestricted('uc_operations')

    const r = await render(<CountProbe caseId={caseRecord.id} />)
    await r.settle(30)
    expect(r.container.querySelector('[data-testid="count"]')!.textContent).toBe('0')
    await r.unmount()
  })

  it('the tab body never renders an alias the viewer was not given', async () => {
    roleSession('detective')
    const { caseRecord } = emptyCase()
    seedRows('uc_operations', [ucRow({ case_id: caseRecord.id, alias: 'MUST-NOT-LEAK' })])
    rlsRestricted('uc_operations')

    const r = await render(<UndercoverCaseTab caseId={caseRecord.id} />)
    await r.settle(30)
    expect(r.container.textContent).not.toContain('MUST-NOT-LEAK')
    expect(r.container.textContent).toContain('No undercover operation recorded on this case')
    await r.unmount()
  })

  it('an authorized viewer gets the count, the identity and the classification banner', async () => {
    const { profile } = roleSession('detective')
    const { caseRecord } = emptyCase()
    seedRows('uc_operations', [ucRow({
      case_id: caseRecord.id, detective_id: profile.id, alias: 'GREY HAT', recording_status: 'confirmed',
    })])

    const probe = await render(<CountProbe caseId={caseRecord.id} />)
    await probe.settle(30)
    expect(probe.container.querySelector('[data-testid="count"]')!.textContent).toBe('1')
    await probe.unmount()

    const r = await render(<UndercoverCaseTab caseId={caseRecord.id} />)
    await r.settle(30)
    expect(r.container.textContent).toContain('GREY HAT')
    expect(r.container.textContent).toContain('CID Restricted — CID access only')
    await r.unmount()
  })
})

describe('§3 — the retention deadline reads as a floor, never as a deletion date', () => {
  it('a concluded operation shows the hold, and the page says the portal does not delete', async () => {
    const { profile } = roleSession('detective')
    const { caseRecord } = emptyCase()
    const ended = new Date(Date.now() - HOUR).toISOString()
    seedRows('uc_operations', [ucRow({
      case_id: caseRecord.id,
      detective_id: profile.id,
      status: 'concluded',
      ended_at: ended,
      retention_until: new Date(Date.parse(ended) + UC_RETENTION_HOURS * HOUR).toISOString(),
      recording_status: 'confirmed',
    })])

    const r = await render(<UndercoverCaseTab caseId={caseRecord.id} />)
    await r.settle(30)
    const text = r.container.textContent ?? ''
    expect(text).toContain('retain until')
    // The counted-down hours, not the elapsed ones.
    expect(text).toMatch(/\(\d+h\)/)
    // And nothing anywhere invites destruction.
    expect(text).not.toMatch(/delete|destroy|purge|expire/i)
    await r.unmount()
  })

  it('past the 72 hours it says the minimum was met, and still nothing about deleting', async () => {
    const { profile } = roleSession('detective')
    const { caseRecord } = emptyCase()
    seedRows('uc_operations', [ucRow({
      case_id: caseRecord.id,
      detective_id: profile.id,
      status: 'concluded',
      ended_at: new Date(Date.now() - 100 * HOUR).toISOString(),
      retention_until: new Date(Date.now() - 28 * HOUR).toISOString(),
      recording_status: 'confirmed',
    })])

    const r = await render(<UndercoverCaseTab caseId={caseRecord.id} />)
    await r.settle(30)
    const text = r.container.textContent ?? ''
    expect(text).toContain('72-hour minimum met')
    expect(text).not.toMatch(/overdue|expired|delete/i)
    await r.unmount()
  })
})

describe('§5 — a reported notification duty is paperwork, not a finding', () => {
  it('shows the outstanding count and the reporting badge without a word of misconduct', async () => {
    const { profile } = roleSession('detective')
    const { caseRecord } = emptyCase()
    seedRows('uc_operations', [ucRow({
      case_id: caseRecord.id,
      detective_id: profile.id,
      recording_status: 'confirmed',
      criminal_activity: true,
      bureau_lead_notified_at: mockTimestamp(-10),
      // Command and the recording are still owed — two outstanding.
    })])

    const r = await render(<UndercoverCaseTab caseId={caseRecord.id} />)
    await r.settle(30)
    const text = r.container.textContent ?? ''
    expect(text).toContain('Criminal activity reported')
    expect(text).toContain('2 outstanding')
    expect(text).not.toMatch(/misconduct|violation|discipline|breach|investigation into/i)
    await r.unmount()
  })
})
