/** Proof: permission semantics. The two ways the security wall surfaces to
 *  db.ts callers, reproduced faithfully by the mock:
 *
 *  1. RLS-filtered writes are SILENT — an UPDATE/DELETE the policy hides
 *     matches zero rows: no error, empty representation. db.ts's contract:
 *     `data.length === 0` (update/updateWhere) IS the blocked-write signal,
 *     and callers must not report success on it.
 *  2. Grant revocation is LOUD — PostgREST answers 403 / code 42501 on every
 *     verb; list() throws, mutations return { error }.
 *
 *  Plus the RLS read wall (silent filtering, never an error) and the RLS
 *  insert violation (loud 403 — inserts are the one RLS write that errors). */
import { describe, expect, it } from 'vitest'
import { insert, list, remove, update, updateWhere } from '@/lib/db'
import { readRows } from '@/mocks/store'
import { emptyCase, permissionDenied, rlsRestricted } from '@/mocks/scenarios'

describe('zero-row update = RLS-blocked write (the silent wall)', () => {
  it('an RLS-hidden row yields data: [] with NO error — and the row is untouched', async () => {
    const { caseRecord } = emptyCase()
    rlsRestricted('cases')
    const res = await update('cases', caseRecord.id, { title: 'Escalated title' })
    expect(res.error).toBeNull() // success on the wire…
    expect(res.data).toEqual([]) // …but zero rows: the ONLY blocked-write signal
    // The store proves nothing was written behind the empty echo.
    expect(readRows('cases')[0].title).toBe(caseRecord.title)
  })

  it('a lost CAS race (updateWhere predicate matches nothing) looks identical', async () => {
    const { caseRecord } = emptyCase()
    const res = await updateWhere('cases',
      { eq: { id: caseRecord.id }, is: { last_stale_notified_at: null } },
      { last_stale_notified_at: '2026-07-27T00:00:00.000Z' })
    expect(res.data).toHaveLength(1) // first writer wins…
    const race = await updateWhere('cases',
      { eq: { id: caseRecord.id }, is: { last_stale_notified_at: null } },
      { last_stale_notified_at: '2026-07-27T00:00:01.000Z' })
    expect(race.error).toBeNull()
    expect(race.data).toEqual([]) // …the loser sees the zero-row shape
  })

  it('RLS-filtered DELETE silently removes nothing', async () => {
    const { caseRecord } = emptyCase()
    rlsRestricted('cases')
    const res = await remove('cases', caseRecord.id)
    expect(res.error).toBeNull()
    expect(readRows('cases')).toHaveLength(1)
  })

  it('RLS INSERT is the loud exception: 403 row-level security violation', async () => {
    rlsRestricted('cases')
    const res = await insert('cases', { case_number: 'CID-26-0700' })
    expect(res.data).toBeNull()
    expect(res.error?.code).toBe('42501')
    expect(res.error?.message).toContain('row-level security')
  })

  it('RLS reads are silently filtered — empty list, never an error', async () => {
    emptyCase()
    rlsRestricted('cases')
    await expect(list('cases')).resolves.toEqual([])
  })
})

describe('permissionDenied(table) = revoked grant (the loud wall)', () => {
  it('mutations surface { error } with code 42501', async () => {
    const { caseRecord } = emptyCase()
    permissionDenied('cases')
    const res = await update('cases', caseRecord.id, { title: 'nope' })
    expect(res.data).toBeNull()
    expect(res.error?.code).toBe('42501')
    expect(res.error?.message).toContain('permission denied')
    const ins = await insert('cases', { case_number: 'CID-26-0701' })
    expect(ins.error?.code).toBe('42501')
  })

  it('list() THROWS per the db.ts contract (callers try/catch)', async () => {
    permissionDenied('cases')
    await expect(list('cases')).rejects.toThrow(/permission denied for table cases/)
  })

  it('denial is per-table — other tables stay readable', async () => {
    const { caseRecord } = emptyCase()
    permissionDenied('media')
    await expect(list('cases')).resolves.toHaveLength(1)
    await expect(list('media', { eq: { case_id: caseRecord.id } })).rejects.toThrow(/permission denied/)
  })
})
