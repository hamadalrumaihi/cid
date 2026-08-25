/** Proof: schema fidelity. Fixtures compile against database.types.ts (tsc
 *  enforces that — every builder returns a complete Tables<'…'> Row), and at
 *  runtime the handler responses round-trip through the SAME path the app
 *  uses: supabase-js → globalThis.fetch → MSW → src/lib/db.ts list/countRows/
 *  insert/rpc. Nothing here talks to the mock store's internals on the read
 *  side — if the wire shape drifted from what supabase-js expects, these
 *  calls would break exactly like the app would. */
import { describe, expect, it } from 'vitest'
import { countRows, ilikeAny, insert, list, rpc } from '@/lib/db'
import {
  emptyCase, populatedCase, profileRow, prosecutorCoverageRow, restrictedMediaCase,
} from '@/mocks/scenarios'
import { seedRows } from '@/mocks/store'

describe('PostgREST read path (db.list / db.countRows)', () => {
  it('returns seeded case rows through supabase-js exactly as fixtured', async () => {
    const { caseRecord } = populatedCase()
    const rows = await list('cases')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(caseRecord) // full-row echo: every generated column survives the wire
    expect(rows[0].status).toBe('active')
    expect(rows[0].bureau).toBe('major_crimes')
  })

  it('supports the db.ts filter surface: eq + is + order + limit', async () => {
    const { caseRecord, media } = restrictedMediaCase()
    // The app's live-media query: rows for this case, unarchived only.
    const live = await list('media', {
      eq: { case_id: caseRecord.id },
      is: { archived_at: null },
      order: 'created_at',
      ascending: true,
    })
    expect(live.map((m) => m.title)).toEqual(['Public scene photo', 'CI identity packet'])
    expect(live.every((m) => m.archived_at === null)).toBe(true)
    expect(media).toHaveLength(3) // fixture seeded the archived one too

    const limited = await list('media', { eq: { case_id: caseRecord.id }, limit: 1 })
    expect(limited).toHaveLength(1)
  })

  it('supports ilikeAny or-disjunctions (bounded typed pickers)', async () => {
    populatedCase()
    emptyCase({ title: 'Unrelated Arson', case_number: 'CID-26-0999' })
    const or = ilikeAny(['title', 'case_number'], 'vespucci')
    expect(or).not.toBeNull()
    const rows = await list('cases', { or: or ?? undefined, limit: 20 })
    expect(rows.map((r) => r.title)).toEqual(['Vespucci Fencing Ring'])
  })

  it('countRows sees the HEAD + count=exact Content-Range', async () => {
    const { caseRecord } = populatedCase()
    await expect(countRows('reports', { eq: { case_id: caseRecord.id } })).resolves.toBe(2)
    await expect(countRows('cases')).resolves.toBe(1)
    await expect(countRows('case_tasks', { eq: { done: false } })).resolves.toBe(1)
  })

  it('projection (select) returns partial rows like PostgREST does', async () => {
    populatedCase()
    const slim = await list('cases', { select: 'id,case_number' })
    expect(slim).toHaveLength(1)
    expect(Object.keys(slim[0]).sort()).toEqual(['case_number', 'id'])
  })
})

describe('PostgREST write path (db.insert Prefer: return=representation)', () => {
  it('echoes inserted rows back through .select()', async () => {
    const { caseRecord } = emptyCase()
    const res = await insert('case_tasks', {
      case_id: caseRecord.id,
      title: 'Ping the tower records',
    })
    expect(res.error).toBeNull()
    expect(res.data).toHaveLength(1)
    expect(res.data![0].title).toBe('Ping the tower records')
    expect(res.data![0].id).toBeTruthy() // server-filled default
    // And the row is now visible to the read path.
    const tasks = await list('case_tasks', { eq: { case_id: caseRecord.id } })
    expect(tasks).toHaveLength(1)
  })
})

describe('bureau queues + stages fixture surface (20260818120000)', () => {
  it('case and media fixtures carry the new stage/evidence columns and survive the wire', async () => {
    const { caseRecord, media } = populatedCase()
    expect(caseRecord.investigative_stage).toBe('intake')
    expect(media[0]).toMatchObject({
      evidence_ref: null, evidence_designated_by: null, evidence_designated_at: null,
    })
    const rows = await list('cases')
    expect(rows[0].investigative_stage).toBe('intake') // full-row echo includes the new column
  })

  it('prosecutorCoverageRow round-trips through the PostgREST read path', async () => {
    const [pros] = seedRows('profiles', [profileRow({ display_name: 'ADA Reyes' })])
    const [granter] = seedRows('profiles', [profileRow({ display_name: 'AG Marlowe', role: 'director' })])
    const [cov] = seedRows('prosecutor_coverage', [prosecutorCoverageRow({
      prosecutor_id: pros.id, authorized_by: granter.id, bureau: 'street_crimes',
    })])
    // the app's live-coverage query shape: unended rows for one prosecutor
    const live = await list('prosecutor_coverage', {
      eq: { prosecutor_id: pros.id }, is: { ended_at: null },
    })
    expect(live).toHaveLength(1)
    expect(live[0]).toEqual(cov) // full-row echo: every generated column survives
  })
})

describe('RPC path (db.rpc, typed Returns)', () => {
  it('search_all returns the generated Returns shape from seeded data', async () => {
    populatedCase()
    const res = await rpc('search_all', { q: 'vespucci' })
    expect(res.error).toBeNull()
    expect(res.data).not.toBeNull()
    const hit = res.data!.find((r) => r.kind === 'case')
    expect(hit).toBeDefined()
    expect(hit!.label).toBe('Vespucci Fencing Ring')
    expect(hit!.sublabel).toBe('CID-26-0140')

    const person = (await rpc('search_all', { q: 'vercelli' })).data!.find((r) => r.kind === 'person')
    expect(person?.label).toBe('Tommy Vercelli')
  })

  it('doj_bureau_coverage returns one typed row per permanent bureau', async () => {
    const res = await rpc('doj_bureau_coverage', undefined as never)
    expect(res.error).toBeNull()
    expect(res.data!.map((r) => r.bureau).sort()).toEqual(['major_crimes', 'street_crimes'])
    const uncovered = res.data!.find((r) => !r.covered)
    expect(uncovered?.primary_ada_id).toBeNull()
  })

  it('an unhandled RPC fails loudly with PostgREST function-not-found', async () => {
    const res = await rpc('report_finalize', { p_report: '00000000-0000-4000-a000-000000000001' })
    expect(res.error?.code).toBe('PGRST202')
  })
})
