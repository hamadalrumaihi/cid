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
import { CASE_PREFIX, PERMANENT_BUREAUS } from '@/lib/roles'
import { supabaseBaseUrl } from '../env'
import { getDenial, getRows, getRpcOverride, getSession, mockId, seedRows, type MockTableName } from '../store'
import { CASE_WORKSPACE_RPCS } from './caseWorkspace'
import { ENTITY_RPCS } from './entity'
import { LEGAL_RPCS, LegalRpcError } from './legal'
import { postgrestError, shapeNetwork } from './postgrest'
import { REPORT_RPCS, ReportRpcError } from './reports'

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
  return PERMANENT_BUREAUS.map((bureau) => ({
    acting_id: null,
    acting_name: null,
    acting_role: null,
    acting_since: null,
    bureau,
    covered: bureau !== 'street_crimes', // one uncovered bureau so coverage UIs show both states
    primary_ada_id: bureau === 'street_crimes' ? null : mockId(),
    primary_ada_name: bureau === 'street_crimes' ? null : `ADA ${CASE_PREFIX[bureau]}`,
    primary_since: bureau === 'street_crimes' ? null : '2026-06-01T00:00:00.000Z',
    supporting: [],
  }))
}

/** Mirror of private.case_number_base — MCB-4######, SCB-5######, SIB-8######,
 *  JTF-3######; the mock just counts seeded cases past the base. */
const CASE_NUMBER_BASE: Record<string, number> = {
  major_crimes: 4_000_000,
  street_crimes: 5_000_000,
  special_investigations: 8_000_000,
  JTF: 3_000_000,
}

function nextCaseNumber(bureau: string): Fns['next_case_number']['Returns'] {
  const count = getRows('cases').length + 1
  return `${CASE_PREFIX[bureau] ?? bureau}-${(CASE_NUMBER_BASE[bureau] ?? 0) + count}`
}

/** kind → table for the soft_delete / restore_record RPCs — the inverse of
 *  db.ts's SOFT_DELETE_KIND (tests/msw/permission-semantics.test.ts pins
 *  the two in sync). The mock reproduces only the CONTRACT: refusals are
 *  returned as {ok:false, code}, never raised; a denied table answers
 *  `denied`; the parent kinds need a reason. Cascades and the parent-live
 *  restore rule are server logic and stay out of the mock. */
export const SOFT_DELETE_TABLE: Record<string, MockTableName> = {
  person: 'persons', vehicle: 'vehicles', gang: 'gangs', place: 'places', account: 'accounts',
  indicator: 'indicators', narcotic: 'narcotics', operation: 'operations', tracker: 'trackers',
  gang_member: 'gang_members', gang_turf: 'gang_turf', person_place: 'person_places',
  person_vehicle: 'person_vehicles', person_relationship: 'person_relationships', account_link: 'account_links',
  case: 'cases', report: 'reports', media: 'media', evidence: 'evidence', case_task: 'case_tasks',
  case_message: 'case_messages', case_intel_link: 'case_intel_links', case_blocker: 'case_blockers',
  rico_case: 'rico_cases', predicate_act: 'predicate_acts',
  case_note: 'case_notes', case_link: 'case_links',
}
const SOFT_DELETE_REASON_REQUIRED = new Set([
  'person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker',
  'case', 'report', 'media', 'evidence', 'rico_case',
])

function softDelete(args: Record<string, unknown>): Fns['soft_delete']['Returns'] {
  const kind = String(args.p_kind ?? '').trim().toLowerCase()
  const table = SOFT_DELETE_TABLE[kind]
  const id = String(args.p_id ?? '')
  if (!table || !id) return { ok: false, code: 'bad_request', message: 'unknown record kind' }
  const row = getDenial(table) ? undefined : getRows(table).find((r) => r.id === id && r.deleted_at == null)
  if (!row) return { ok: false, code: 'denied', message: 'you may not delete this record' }
  const reason = String(args.p_reason ?? '').trim() || null
  if (!reason && SOFT_DELETE_REASON_REQUIRED.has(kind)) {
    return { ok: false, code: 'reason_required', message: 'a reason is required to delete this record' }
  }
  const batch = mockId()
  const deletedAt = new Date().toISOString()
  Object.assign(row, { deleted_at: deletedAt, deleted_by: getSession()?.userId ?? null, delete_reason: reason, delete_batch: batch })
  return { ok: true, kind, id, deleted_at: deletedAt, batch, cascaded: {} }
}

function restoreRecord(args: Record<string, unknown>): Fns['restore_record']['Returns'] {
  const kind = String(args.p_kind ?? '').trim().toLowerCase()
  const table = SOFT_DELETE_TABLE[kind]
  const id = String(args.p_id ?? '')
  if (!table || !id) return { ok: false, code: 'bad_request', message: 'unknown record kind' }
  const row = getDenial(table) ? undefined : getRows(table).find((r) => r.id === id && r.deleted_at != null)
  if (!row) return { ok: false, code: 'denied', message: 'you may not restore this record' }
  Object.assign(row, { deleted_at: null, deleted_by: null, delete_reason: null, delete_batch: null })
  return { ok: true, kind, id, restored: { [table]: 1 } }
}

/** `my_permissions()` (P1-01 / P1-08) derived from the seeded session
 *  profile — the contract only: access_class, role, bureau, owner flag and
 *  empty expiries. A signed-out call answers { access_class: 'none' } like
 *  the server; a scenario pins anything richer with rpcResult(). */
function myPermissions(): Fns['my_permissions']['Returns'] {
  const session = getSession()
  const p = session
    ? (getRows('profiles') as unknown as Tables<'profiles'>[]).find((r) => r.id === session.userId) ?? null
    : null
  if (!p) return { access_class: 'none' }
  const command = ['bureau_lead', 'deputy_director', 'director'].includes(p.role ?? '')
  const cls = p.is_owner ? 'owner' : p.active && command ? 'command' : p.active ? 'member' : 'inactive'
  return {
    access_class: cls, active: !!p.active, role: p.active ? p.role : null, rank: 0,
    bureau: p.active ? p.division : null, is_owner: !!p.is_owner, sib_standing: p.is_owner ? 'owner' : null,
    department: 'cid', doj_role: null, doj_membership_role: null, is_field_officer: false,
    command_scope: !p.active || !command ? null
      : p.role === 'bureau_lead' ? { level: 'bureau', bureau: p.division } : { level: 'division', bureau: null },
    expiries: { doj_membership: null, joint_assignments: [], sib_temporary_access: [], case_access_grants: [] },
    flags: { is_test: false, login_denied: false, loa: false, removed: false, sib_release_open: false, sib_may_switch: !!p.is_owner, sib_may_control_visibility: p.role === 'director' },
    generated_at: new Date().toISOString(),
  }
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
        return HttpResponse.json(nextCaseNumber(String(args.p_bureau ?? 'major_crimes')))
      case 'my_permissions':
        return HttpResponse.json(myPermissions())
      case 'soft_delete':
        return HttpResponse.json(softDelete(args))
      case 'restore_record':
        return HttpResponse.json(restoreRecord(args))
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
        // Phase 2 entity layer (suggest / duplicates / crossref / merge /
        // suggestions / reconcile) — see ./entity.ts.
        if (fn in ENTITY_RPCS) return HttpResponse.json(ENTITY_RPCS[fn](args) as Parameters<typeof HttpResponse.json>[0])
        // Phase 3 case workspace (activity feed / mentions / history) — see
        // ./caseWorkspace.ts.
        if (fn in CASE_WORKSPACE_RPCS) return HttpResponse.json(CASE_WORKSPACE_RPCS[fn](args) as Parameters<typeof HttpResponse.json>[0])
        // Phase 4 legal workflow (routing, charges, comments, revision items,
        // partial approval, amend / observer / export, sweeps) — see ./legal.ts.
        // A server `raise` surfaces as PostgREST's 400 error shape.
        if (fn in LEGAL_RPCS) {
          try {
            return HttpResponse.json(LEGAL_RPCS[fn](args) as Parameters<typeof HttpResponse.json>[0])
          } catch (e) {
            if (e instanceof LegalRpcError) return postgrestError(400, e.code, e.message)
            throw e
          }
        }
        // Phase 5 report builder (templates, review flow, entities, exports,
        // task waivers) — see ./reports.ts. Same raise → 400 mapping.
        if (fn in REPORT_RPCS) {
          try {
            return HttpResponse.json(REPORT_RPCS[fn](args) as Parameters<typeof HttpResponse.json>[0])
          } catch (e) {
            if (e instanceof ReportRpcError) return postgrestError(400, e.code, e.message)
            throw e
          }
        }
        return postgrestError(404, 'PGRST202',
          `Could not find the function public.${fn} in the schema cache — add a handler in src/mocks/handlers/rpc.ts or use scenarios.rpcResult().`)
    }
  }),
]
