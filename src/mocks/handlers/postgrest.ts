/** PostgREST table handlers — emulate exactly what supabase-js + src/lib/db.ts
 *  observe on the wire, not the whole of PostgREST:
 *
 *  - GET     → JSON array (or object under Accept: vnd.pgrst.object+json);
 *              Prefer: count=exact → Content-Range: *​/N (countRows()).
 *  - POST    → Prefer: return=representation echo of the inserted rows (201).
 *  - PATCH   → representation echo of the rows the filters MATCHED. The
 *              CRITICAL semantics db.ts's contract documents: an RLS-filtered
 *              update matches ZERO rows and returns 200 [] with NO error —
 *              callers must treat data.length === 0 as a blocked write. With
 *              Prefer: return=minimal (updateNoSelect) PostgREST answers 204
 *              regardless, so zero-row blocking is UNDETECTABLE there — the
 *              mock reproduces that too.
 *  - DELETE  → 204 (return=minimal, db.ts remove()).
 *  - Errors  → PostgREST JSON shape { message, code, details, hint } with
 *              401/403/406 status; grant denial = 42501.
 *
 *  Filter support covers what db.ts can emit: eq / is / in / or(ilike…) /
 *  order(.nullsfirst) / limit / select projection. Anything else in a URL is
 *  a sign a new query shape reached the mock — extend the parser then. */
import { delay, http, HttpResponse } from 'msw'
import { supabaseBaseUrl } from '../env'
import {
  getDenial, getLatency, getRows, isOffline, mockId, setRows,
  type MockRow, type MockTableName,
} from '../store'

/* ---- shared helpers (used by rpc/auth/fivemanage handlers too) ----------- */

export function postgrestError(status: number, code: string, message: string): Response {
  return HttpResponse.json({ code, details: null, hint: null, message }, { status })
}

/** Latency / offline shaping — returns a terminal response or null. */
export async function shapeNetwork(): Promise<Response | null> {
  if (isOffline()) return HttpResponse.error()
  const ms = getLatency()
  if (ms > 0) await delay(ms)
  return null
}

/* ---- filter engine ------------------------------------------------------- */

interface Cond { col: string; op: string; value: string }
interface Parsed {
  select: string | null
  order: { col: string; ascending: boolean; nullsFirst: boolean | null } | null
  limit: number | null
  conditions: Cond[]
  orGroups: Cond[][]
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'on_conflict', 'columns'])

function splitCond(raw: string): Cond | null {
  const first = raw.indexOf('.')
  if (first < 0) return null
  const col = raw.slice(0, first)
  const rest = raw.slice(first + 1)
  const second = rest.indexOf('.')
  if (second < 0) return { col, op: rest, value: '' }
  return { col, op: rest.slice(0, second), value: rest.slice(second + 1) }
}

function parseQuery(url: URL): Parsed {
  const parsed: Parsed = { select: null, order: null, limit: null, conditions: [], orGroups: [] }
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'select') parsed.select = value
    else if (key === 'limit') parsed.limit = Number(value)
    else if (key === 'order') {
      const parts = value.split('.')
      parsed.order = {
        col: parts[0],
        ascending: !parts.includes('desc'),
        nullsFirst: parts.includes('nullsfirst') ? true : parts.includes('nullslast') ? false : null,
      }
    } else if (key === 'or') {
      const inner = value.replace(/^\(/, '').replace(/\)$/, '')
      const group = inner.split(',').map(splitCond).filter((c): c is Cond => c !== null)
      if (group.length) parsed.orGroups.push(group)
    } else if (!RESERVED.has(key)) {
      const dot = value.indexOf('.')
      if (dot < 0) continue
      parsed.conditions.push({ col: key, op: value.slice(0, dot), value: value.slice(dot + 1) })
    }
  }
  return parsed
}

function ilikeToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function matches(row: MockRow, cond: Cond): boolean {
  const v = row[cond.col]
  switch (cond.op) {
    case 'eq':
      return v !== null && v !== undefined && String(v) === cond.value
    case 'neq':
      return v !== null && v !== undefined && String(v) !== cond.value
    case 'is':
      if (cond.value === 'null') return v === null || v === undefined
      if (cond.value === 'true') return v === true
      if (cond.value === 'false') return v === false
      return false
    case 'in': {
      if (v === null || v === undefined) return false
      const values = cond.value.replace(/^\(/, '').replace(/\)$/, '')
        .split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
      return values.includes(String(v))
    }
    case 'ilike':
      return v !== null && v !== undefined && ilikeToRegex(cond.value).test(String(v))
    default:
      return false
  }
}

function applyFilters(rows: MockRow[], q: Parsed): MockRow[] {
  return rows.filter((row) =>
    q.conditions.every((c) => matches(row, c)) &&
    q.orGroups.every((group) => group.some((c) => matches(row, c))))
}

function applyOrder(rows: MockRow[], q: Parsed): MockRow[] {
  if (!q.order) return rows
  const { col, ascending } = q.order
  const nullsFirst = q.order.nullsFirst ?? !ascending // PostgREST defaults
  return [...rows].sort((a, b) => {
    const av = a[col], bv = b[col]
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : (nullsFirst ? -1 : 1)
    if (bv === null || bv === undefined) return nullsFirst ? 1 : -1
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv))
    return ascending ? cmp : -cmp
  })
}

function project(rows: MockRow[], select: string | null): MockRow[] {
  if (!select || select === '*' || /[()"*]/.test(select)) return rows
  const cols = select.split(',').map((s) => s.trim()).filter(Boolean)
  return rows.map((row) => {
    const out: MockRow = {}
    for (const c of cols) if (c in row) out[c] = row[c]
    return out
  })
}

/* ---- verb handling ------------------------------------------------------- */

const wantsRepresentation = (req: Request) => (req.headers.get('prefer') ?? '').includes('return=representation')
const wantsCount = (req: Request) => (req.headers.get('prefer') ?? '').includes('count=exact')
const wantsObject = (req: Request) => (req.headers.get('accept') ?? '').includes('vnd.pgrst.object+json')

function rlsInsertViolation(table: string): Response {
  return postgrestError(403, '42501', `new row violates row-level security policy for table "${table}"`)
}
function grantDenied(table: string): Response {
  return postgrestError(403, '42501', `permission denied for table ${table}`)
}

async function handleTable(request: Request, table: MockTableName): Promise<Response> {
  const shaped = await shapeNetwork()
  if (shaped) return shaped
  if (!request.headers.get('apikey')) return postgrestError(401, 'PGRST301', 'No API key found in request')

  const url = new URL(request.url)
  const q = parseQuery(url)
  const denial = getDenial(table)
  const method = request.method.toUpperCase()

  if (method === 'GET' || method === 'HEAD') {
    if (denial === 'grant') return grantDenied(table)
    // RLS filtering on reads is silent: the wall hides rows, it never errors.
    const visible = denial === 'rls' ? [] : applyFilters(getRows(table), q)
    const ordered = applyOrder(visible, q)
    const limited = q.limit !== null ? ordered.slice(0, q.limit) : ordered
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (wantsCount(request)) headers['Content-Range'] = `*/${visible.length}`
    if (method === 'HEAD') return new HttpResponse(null, { status: 200, headers })
    if (wantsObject(request)) {
      if (limited.length !== 1) {
        return postgrestError(406, 'PGRST116', `JSON object requested, multiple (or no) rows returned (${limited.length} rows)`)
      }
      return HttpResponse.json(project(limited, q.select)[0], { headers })
    }
    return HttpResponse.json(project(limited, q.select), { headers })
  }

  if (method === 'POST') {
    if (denial === 'grant') return grantDenied(table)
    if (denial === 'rls') return rlsInsertViolation(table) // INSERT under RLS is a loud 403, not zero rows
    const body = (await request.json()) as MockRow | MockRow[]
    const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ id: mockId(), ...r }))
    setRows(table, [...getRows(table), ...rows])
    if (!wantsRepresentation(request)) return new HttpResponse(null, { status: 201 })
    return HttpResponse.json(project(rows, q.select), { status: 201 })
  }

  if (method === 'PATCH') {
    if (denial === 'grant') return grantDenied(table)
    const patch = (await request.json()) as MockRow
    // Zero-row semantics: an RLS-filtered UPDATE matches nothing — success
    // status, empty representation, NO error. db.ts callers detect the block
    // only by data.length === 0.
    const matched = denial === 'rls' ? [] : applyFilters(getRows(table), q)
    const matchedIds = new Set(matched)
    setRows(table, getRows(table).map((row) => (matchedIds.has(row) ? { ...row, ...patch } : row)))
    if (!wantsRepresentation(request)) return new HttpResponse(null, { status: 204 })
    return HttpResponse.json(project(matched.map((row) => ({ ...row, ...patch })), q.select), { status: 200 })
  }

  if (method === 'DELETE') {
    if (denial === 'grant') return grantDenied(table)
    const matched = denial === 'rls' ? new Set<MockRow>() : new Set(applyFilters(getRows(table), q))
    setRows(table, getRows(table).filter((row) => !matched.has(row)))
    if (!wantsRepresentation(request)) return new HttpResponse(null, { status: 204 })
    return HttpResponse.json(project([...matched], q.select), { status: 200 })
  }

  return postgrestError(405, 'PGRST105', `Unsupported HTTP method: ${method}`)
}

/** Catch-all table route. Registered AFTER the rpc handlers in index.ts so
 *  /rest/v1/rpc/:fn never falls through to a table named "rpc". */
export const postgrestHandlers = [
  http.all(`${supabaseBaseUrl()}/rest/v1/:table`, async ({ request, params }) => {
    return handleTable(request, params.table as MockTableName)
  }),
]
