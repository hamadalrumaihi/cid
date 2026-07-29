/** RPC handlers — a representative set of read-side functions, typed against
 *  Database['public']['Functions'] so drift in an RPC's Returns shape breaks
 *  tsc here. Server-authoritative WRITE flows (finalize, sign-off, roster)
 *  are deliberately not re-implemented — tests needing a specific outcome
 *  register it with scenarios.rpcResult(fn, value), keeping the mock from
 *  ever becoming a second implementation of server business logic.
 *
 *  Unknown functions answer PostgREST's real "function not found" (404
 *  PGRST202) so a spec that calls an unhandled RPC fails loudly. */
import { http, HttpResponse } from 'msw'
import type { Database, Tables } from '@/lib/database.types'
import { supabaseBaseUrl } from '../env'
import { getRows, getRpcOverride, mockId, seedRows } from '../store'
import { postgrestError, shapeNetwork } from './postgrest'

type Fns = Database['public']['Functions']

function searchAll(q: string): Fns['search_all']['Returns'] {
  const term = q.trim().toLowerCase()
  if (!term) return []
  const out: Fns['search_all']['Returns'] = []
  for (const row of getRows('cases') as unknown as Tables<'cases'>[]) {
    const hay = `${row.title ?? ''} ${row.case_number}`.toLowerCase()
    if (hay.includes(term)) {
      out.push({ id: row.id, kind: 'case', label: row.title ?? row.case_number, rank: 1, sublabel: row.case_number, term })
    }
  }
  for (const row of getRows('persons') as unknown as Tables<'persons'>[]) {
    const hay = `${row.name} ${row.alias ?? ''}`.toLowerCase()
    if (hay.includes(term)) {
      out.push({ id: row.id, kind: 'person', label: row.name, rank: 1, sublabel: row.alias ?? '', term })
    }
  }
  return out
}

function dojBureauCoverage(): Fns['doj_bureau_coverage']['Returns'] {
  return (['LSB', 'BCB', 'SAB'] as const).map((bureau) => ({
    acting_id: null,
    acting_name: null,
    acting_role: null,
    acting_since: null,
    bureau,
    covered: bureau !== 'SAB', // one uncovered bureau so coverage UIs show both states
    primary_ada_id: bureau === 'SAB' ? null : mockId(),
    primary_ada_name: bureau === 'SAB' ? null : `ADA ${bureau}`,
    primary_since: bureau === 'SAB' ? null : '2026-06-01T00:00:00.000Z',
    supporting: [],
  }))
}

function nextCaseNumber(bureau: string): Fns['next_case_number']['Returns'] {
  const count = getRows('cases').length + 1
  return `CID-26-${String(count).padStart(4, '0')}-${bureau}`
}

export const rpcHandlers = [
  http.post(`${supabaseBaseUrl()}/rest/v1/rpc/:fn`, async ({ request, params }) => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    const fn = params.fn as string
    const override = getRpcOverride(fn)
    if (override.hit) return HttpResponse.json(override.result as Parameters<typeof HttpResponse.json>[0])
    const args = (await request.json().catch(() => ({}))) as Record<string, unknown>

    switch (fn) {
      case 'search_all':
        return HttpResponse.json(searchAll(String(args.q ?? '')))
      case 'doj_bureau_coverage':
        return HttpResponse.json(dojBureauCoverage())
      case 'next_case_number':
        return HttpResponse.json(nextCaseNumber(String(args.p_bureau ?? 'LSB')))
      case 'create_notification': {
        const typedArgs = args as Fns['create_notification']['Args']
        seedRows('notifications', [{
          created_at: new Date().toISOString(),
          id: mockId(),
          payload: (typedArgs.p_payload ?? null) as Tables<'notifications'>['payload'],
          read: false,
          type: typedArgs.p_type,
          user_id: typedArgs.p_user_id,
        }])
        return new HttpResponse(null, { status: 204 })
      }
      default:
        return postgrestError(404, 'PGRST202',
          `Could not find the function public.${fn} in the schema cache — add a handler in src/mocks/handlers/rpc.ts or use scenarios.rpcResult().`)
    }
  }),
]
