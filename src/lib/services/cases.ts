/** Shared case operations — thin typed wrappers over the server-authoritative
 *  SECURITY DEFINER RPCs (20261002130000_shared_case_services). These are the
 *  operations BOTH interfaces share: the web portal calls them here, and the
 *  future FiveM lane calls the same RPCs — one server-side implementation per
 *  operation, never two. Authority, atomicity, notifications and audit all
 *  live in the database functions; these wrappers only shape arguments.
 *
 *  Mutations return { data, error } like the rest of db.ts; the timeline read
 *  THROWS on error like list(), so callers keep their existing try/catch
 *  error surfaces. */
import { rpc, type MutationResult } from '@/lib/db'
import type { Database, Tables } from '@/lib/database.types'

type CaseRow = Tables<'cases'>

/** One event of the shared case chronology (public.case_timeline). */
export type CaseTimelineRow =
  Database['public']['Functions']['case_timeline']['Returns'][number]

/** Create a case atomically: server-side gate (private.can_create_case),
 *  collision-safe number minting (or a clear error on an explicit-number
 *  collision — never a timestamp fallback), lead rule (command chooses,
 *  everyone else IS the lead) and template checklist expansion, all in one
 *  transaction. Fields the RPC doesn't take (status ≠ open, operation link,
 *  follow-up date) remain the caller's follow-up update, as before. */
export async function createCase(args: {
  bureau: string
  title: string
  summary?: string | null
  priority?: string | null
  area?: string | null
  /** Honored only when the caller is command; otherwise the server assigns
   *  the creator (the modal's disabled-picker rule, now server-held). */
  lead?: string | null
  /** case_templates id — the server expands its checklist into case_tasks. */
  template?: string | null
  /** Explicit number (PREFIX-digits). Omit to mint the bureau's next. */
  caseNumber?: string | null
}): Promise<MutationResult<CaseRow>> {
  return rpc('case_create', {
    p_bureau: args.bureau,
    p_title: args.title,
    p_summary: args.summary ?? undefined,
    p_priority: args.priority ?? undefined,
    p_area: args.area ?? undefined,
    p_lead: args.lead ?? undefined,
    p_template: args.template ?? undefined,
    p_case_number: args.caseNumber ?? undefined,
  })
}

/** Set a case's status (open/active/cold/closed). closed_at stays with the
 *  trg_case_closed_at trigger — never written by clients or this wrapper.
 *  Audited server-side as CASE_STATUS_CHANGED {from, to, reason}. */
export async function setCaseStatus(
  caseId: string,
  status: CaseRow['status'],
  reason?: string | null,
): Promise<MutationResult<undefined>> {
  return rpc('case_set_status', {
    p_case: caseId,
    p_status: status,
    p_reason: reason ?? undefined,
  })
}

/** Hand the case lead to another officer. Server gate: current lead or
 *  command. The server sends both case_handover notifications (incoming and
 *  outgoing lead) — callers must NOT notify again. */
export async function setCaseLead(
  caseId: string,
  to: string,
  note?: string | null,
): Promise<MutationResult<undefined>> {
  return rpc('case_set_lead', {
    p_case: caseId,
    p_to: to,
    p_note: note ?? undefined,
  })
}

/** Decide a pending case access request atomically: approve inserts the
 *  standing grant AND stamps the request; deny stamps only. The requester is
 *  notified server-side; the decision is audited (CASE_ACCESS_DECIDED). An
 *  already-decided request errors without changing anything. */
export async function decideCaseAccess(
  requestId: string,
  approve: boolean,
  note?: string | null,
): Promise<MutationResult<undefined>> {
  return rpc('case_access_decide', {
    p_request: requestId,
    p_approve: approve,
    p_note: note ?? undefined,
  })
}

/** The shared case chronology (public.case_timeline): every event source the
 *  Timeline tab renders, in one RLS-parity definer read. THROWS on error
 *  (read semantics, like list()). */
export async function fetchCaseTimeline(caseId: string): Promise<CaseTimelineRow[]> {
  const res = await rpc('case_timeline', { p_case: caseId })
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code })
  return res.data ?? []
}
