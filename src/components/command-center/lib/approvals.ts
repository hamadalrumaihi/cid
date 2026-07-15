import type { Tables } from '@/lib/database.types'
import { canDecideTransferSide } from '@/lib/roles'

type CaseRow = Tables<'cases'>
type TransferRow = Tables<'transfer_requests'>

/** True when this profile can decide the case's CURRENT sign-off stage.
 *  Single source of truth shared by My Desk and the Command Center approval
 *  queue — mirrors the server rule in the `signoff_decide` RPC (the DB is the
 *  authority; this only decides what to *show*). */
export function canReviewCase(
  c: CaseRow,
  profile: { id: string; role?: string | null; division?: string | null } | null,
): boolean {
  if (!profile) return false
  if (c.signoff_assignee_id === profile.id) return true
  if (c.signoff_status === 'awaiting_bureau_lead') return profile.role === 'bureau_lead' && c.bureau === profile.division
  if (c.signoff_status === 'awaiting_deputy' || c.signoff_status === 'approved_deputy') return profile.role === 'deputy_director'
  if (c.signoff_status === 'awaiting_director') return profile.role === 'director'
  return false
}

/** True when this profile can decide the transfer's CURRENT pending side.
 *  Mirrors the server rule in `approve_transfer_source` / `approve_transfer_target`
 *  (20260718020000_officer_transfers.sql): the pending side's Bureau Lead
 *  (`role = 'bureau_lead' and division = side`), or Deputy Director+, or the
 *  Owner — and never the transfer's own target (`you cannot approve your own
 *  transfer`). The bureau-side matrix is delegated to `canDecideTransferSide`
 *  (lib/roles) so the two client mirrors cannot drift; `active` is passed as
 *  true because a signed-in profile is active by definition (same
 *  simplification as canReviewCase above). The RPCs remain the authority —
 *  this only decides what to *show*. */
export function canDecideTransfer(
  t: Pick<TransferRow, 'status' | 'from_bureau' | 'to_bureau' | 'target_id'>,
  profile: { id: string; role?: string | null; division?: string | null; is_owner?: boolean | null } | null,
): boolean {
  if (!profile || t.target_id === profile.id) return false
  const side = t.status === 'pending_source' ? t.from_bureau
    : t.status === 'pending_target' ? t.to_bureau : null
  if (!side) return false
  return canDecideTransferSide({ ...profile, active: true }, side)
}
