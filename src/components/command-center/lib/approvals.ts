import type { Tables } from '@/lib/database.types'

type CaseRow = Tables<'cases'>

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
