/** Pure Joint/JTF-operations model — vocab, projections and client mirrors of
 *  the 20260810120000_jtf_operations server rules (no React, no I/O; the
 *  docModel / personIntel pattern). Everything here only decides what to SHOW
 *  or offer — RLS, the guard/sync triggers, and the lifecycle RPCs re-decide
 *  server-side.
 *
 *  Two separate concepts, never one boolean:
 *   · ACTIVE joint access — derived from CURRENT state (op is jtf + active,
 *     link active, viewer's bureau participates). Mirrors
 *     private.has_op_joint_access.
 *   · HISTORICAL joint participation — permanent (link rows with was_jtf, or
 *     the legacy manual joint-case flag). Survives case closure, operation
 *     resolution, unlinking and reverting. */
import type { Tables } from './database.types'

export type OperationRow = Tables<'operations'>
export type OpBureauRow = Tables<'operation_bureaus'>
export type OpCaseLinkRow = Tables<'operation_case_links'>

/** Operation lifecycle statuses (legacy rows may carry other strings —
 *  render them verbatim; 'resolved' and 'closed' both end joint access). */
export const OPERATION_STATUSES = ['active', 'resolved', 'closed'] as const
export const isOpEnded = (status?: string | null): boolean =>
  status === 'resolved' || status === 'closed'

export const isJtf = (op?: Pick<OperationRow, 'op_type'> | null): boolean =>
  op?.op_type === 'jtf'

/** Bureaus with an ACTIVE membership row, in join order. */
export function activeBureaus(rows: readonly Pick<OpBureauRow, 'bureau' | 'left_at' | 'joined_at'>[]): string[] {
  return [...rows]
    .filter((r) => !r.left_at)
    .sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at))
    .map((r) => r.bureau)
}

/* ── Why is this case joint? ─────────────────────────────────────────────── */

export interface CaseJointOperation {
  opId: string
  opName: string
  opStatus: string
  /** Link still active (removed_at null). */
  linked: boolean
  /** Active RIGHT NOW: linked + op jtf + op active. */
  active: boolean
}

export interface CaseJointInfo {
  /** The operation currently granting joint scope, if any. */
  activeVia: CaseJointOperation | null
  /** Every JTF participation, past and present (newest first). */
  operations: CaseJointOperation[]
  /** Legacy per-member joint case (20260713040000) is/was in effect. */
  manualJoint: boolean
  manualJointEnded: boolean
  /** Permanent marker: the case is or ever was part of a joint investigation. */
  everJoint: boolean
}

/** Derive the case's joint picture from its link history + the ops shelf.
 *  Links to NORMAL operations are plain coordination — they never appear
 *  here; only was_jtf participations count (permanent, §history). */
export function caseJointInfo(
  c: Pick<Tables<'cases'>, 'is_joint_case' | 'joint_case_ended_at'>,
  links: readonly Pick<OpCaseLinkRow, 'operation_id' | 'removed_at' | 'added_at' | 'was_jtf'>[],
  opsById: ReadonlyMap<string, Pick<OperationRow, 'id' | 'name' | 'status' | 'op_type'>>,
): CaseJointInfo {
  const seen = new Set<string>()
  const operations: CaseJointOperation[] = []
  for (const l of [...links].sort((a, b) => Date.parse(b.added_at) - Date.parse(a.added_at))) {
    if (!l.was_jtf || seen.has(l.operation_id)) continue
    seen.add(l.operation_id)
    const op = opsById.get(l.operation_id)
    const linked = !l.removed_at
    operations.push({
      opId: l.operation_id,
      opName: op?.name ?? 'Unknown operation',
      opStatus: op?.status ?? 'unknown',
      linked,
      active: linked && op?.op_type === 'jtf' && op?.status === 'active',
    })
  }
  const manualJoint = !!c.is_joint_case
  const manualJointEnded = !c.is_joint_case && !!c.joint_case_ended_at
  return {
    activeVia: operations.find((o) => o.active) ?? null,
    operations,
    manualJoint,
    manualJointEnded,
    everJoint: manualJoint || manualJointEnded || operations.length > 0,
  }
}

/** One-line "why" for the JOINT badge tooltip/details. */
export function jointReasonText(info: CaseJointInfo, participants?: readonly string[]): string {
  const parts: string[] = []
  if (info.activeVia) {
    parts.push(`Joint via Operation ${info.activeVia.opName}`)
    if (participants?.length) parts.push(`Participating bureaus: ${participants.join(', ')}`)
  }
  for (const o of info.operations) {
    if (o !== info.activeVia) {
      parts.push(`${o.linked ? 'Linked to' : 'Formerly part of'} Operation ${o.opName} (${o.opStatus})`)
    }
  }
  if (info.manualJoint) parts.push('Designated joint case (per-member assignments)')
  else if (info.manualJointEnded) parts.push('Former designated joint case')
  return parts.join(' · ')
}

/* ── Client authority mirrors (UX only — server re-decides) ──────────────── */

export interface OpViewer {
  userId: string | null
  active: boolean
  role: string | null
  division: string | null
  isCommand: boolean
  isOwner: boolean
}

/** Mirror of private.can_manage_operation. */
export function canManageOperation(
  v: OpViewer,
  op: Pick<OperationRow, 'op_type' | 'bureau'>,
  opActiveBureaus: readonly string[],
): boolean {
  if (!v.active) return false
  if (v.isOwner) return true
  if (op.op_type === 'jtf') {
    if (v.role === 'deputy_director' || v.role === 'director') return true
    return v.role === 'bureau_lead' && !!v.division && opActiveBureaus.includes(v.division)
  }
  if (!op.bureau) return true // legacy normal op — today's any-active behavior
  return op.bureau === v.division || v.isCommand
}

/** Mirror of the sync-trigger link rule for ONE case: may this viewer link
 *  this case to this operation? (Normal ops keep today's behavior: any case
 *  the viewer can already see/update.) Structural param so slim projections
 *  (OpsCaseRow) qualify. */
export function canLinkCaseToOp(
  v: OpViewer,
  c: { bureau: string | null; lead_detective_id: string | null; created_by: string | null; operation_id: string | null },
  op: Pick<OperationRow, 'op_type' | 'status'>,
  opActiveBureaus: readonly string[],
): boolean {
  if (!v.active || c.operation_id) return false
  if (op.op_type !== 'jtf') return true
  if (op.status !== 'active') return false
  if (!c.bureau || (c.bureau !== 'JTF' && !opActiveBureaus.includes(c.bureau))) return false
  return v.isCommand || v.isOwner
    || c.lead_detective_id === v.userId || c.created_by === v.userId
}

/** Mirror of the unlink rule: manual removal from a JTF op needs the same
 *  joint-management authority. */
export function canUnlinkCaseFromOp(
  v: OpViewer,
  c: { lead_detective_id: string | null; created_by: string | null },
  op: Pick<OperationRow, 'op_type'>,
): boolean {
  if (!v.active) return false
  if (op.op_type !== 'jtf') return true
  return v.isCommand || v.isOwner
    || c.lead_detective_id === v.userId || c.created_by === v.userId
}

/* ── Operation timeline (derived — mirrors the reader's TimelineTab style) ── */

export interface OpTimelineEvent {
  at: string
  label: string
  sub?: string
}

/** Assemble the operation's derived timeline from row data the viewer can
 *  already read (RLS-scoped): creation, conversion, participation moves,
 *  case links (visible ones only), and resolution. Newest first. */
export function operationTimeline(
  op: Pick<OperationRow, 'created_at' | 'jtf_converted_at' | 'resolved_at' | 'status' | 'op_type' | 'lead_bureau'>,
  bureaus: readonly Pick<OpBureauRow, 'bureau' | 'joined_at' | 'left_at'>[],
  links: readonly (Pick<OpCaseLinkRow, 'added_at' | 'removed_at' | 'removal_reason'> & { caseNumber?: string | null })[],
): OpTimelineEvent[] {
  const out: OpTimelineEvent[] = [{ at: op.created_at, label: 'Operation created' }]
  if (op.jtf_converted_at) {
    out.push({
      at: op.jtf_converted_at,
      label: 'Converted to Joint Task Force',
      sub: op.lead_bureau ? `Lead bureau: ${op.lead_bureau}` : undefined,
    })
  }
  for (const b of bureaus) {
    out.push({ at: b.joined_at, label: `Bureau joined — ${b.bureau}` })
    if (b.left_at) out.push({ at: b.left_at, label: `Bureau left — ${b.bureau}` })
  }
  for (const l of links) {
    out.push({ at: l.added_at, label: `Case linked${l.caseNumber ? ` — ${l.caseNumber}` : ''}` })
    if (l.removed_at) {
      out.push({
        at: l.removed_at,
        label: `Case removed${l.caseNumber ? ` — ${l.caseNumber}` : ''}`,
        sub: l.removal_reason ?? undefined,
      })
    }
  }
  if (op.resolved_at) {
    out.push({ at: op.resolved_at, label: op.status === 'closed' ? 'Operation closed' : 'Operation resolved' })
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}
