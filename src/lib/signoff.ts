import type { Tables } from './database.types'
import { statusTint } from './tint'

/** Sign-off chain vocabulary — ported from vanilla signoff.js:11-38. The
 *  workflow itself is server-authoritative (SECURITY DEFINER RPCs
 *  signoff_submit / signoff_decide / signoff_owner_action); everything here
 *  is display + UX-gating vocabulary only. The client NEVER patches
 *  cases.signoff_* directly. */

export type CaseRow = Tables<'cases'>

export const SIGNOFF_ORDER = ['bureau_lead', 'deputy', 'director'] as const
export type SignoffStage = (typeof SIGNOFF_ORDER)[number]

/** Which roles satisfy each chain stage. */
export const SIGNOFF_ROLES: Record<SignoffStage, string[]> = {
  bureau_lead: ['bureau_lead'],
  deputy: ['deputy_director'],
  director: ['director'],
}

export const SIGNOFF_STAGE_LABEL: Record<string, string> = {
  bureau_lead: 'Bureau Lead',
  deputy: 'Deputy Director',
  deputy_director: 'Deputy Director',
  director: 'Director',
}

export const SIGNOFF_LABEL: Record<string, string> = {
  none: 'Open',
  awaiting_bureau_lead: 'Awaiting Bureau Lead',
  awaiting_deputy: 'Awaiting Deputy Director',
  approved_deputy: 'Approved by Deputy',
  approved_complete: 'Approved & Complete',
  awaiting_director: 'Awaiting Director',
  ready_doj: 'Ready for DOJ',
  changes_requested: 'Changes Requested',
  denied: 'Denied',
}

export const SIGNOFF_TINT: Record<string, string> = {
  none: 'bg-slate-500/15 text-slate-300',
  awaiting_bureau_lead: 'bg-amber-500/15 text-amber-300',
  awaiting_deputy: 'bg-amber-500/15 text-amber-300',
  awaiting_director: 'bg-amber-500/15 text-amber-300',
  approved_deputy: 'bg-blue-500/15 text-blue-300',
  approved_complete: 'bg-emerald-500/15 text-emerald-300',
  ready_doj: 'bg-emerald-500/15 text-emerald-300',
  changes_requested: 'bg-orange-500/15 text-orange-300',
  denied: 'bg-rose-500/15 text-rose-300',
}

export const signoffLabel = (s?: string | null): string => SIGNOFF_LABEL[s ?? ''] || s || 'Open'
export const signoffTint = (s?: string | null): string => SIGNOFF_TINT[s ?? ''] || SIGNOFF_TINT.none

/** History-row verb, shared by the Sign-off tab and the case timeline. */
export const SIGNOFF_ACTION_VERB: Record<string, string> = {
  submitted: 'submitted for review',
  approved: 'approved',
  denied: 'denied',
  changes_requested: 'requested changes',
  escalated: 'escalated',
  auto_routed: 'auto-routed',
  completed: 'marked complete',
}

/** Case lifecycle tint (open/active/cold/closed) — delegates to the shared
 *  statusTint map (lib/tint) so the board, command pills, guide legend and
 *  case header can never drift apart again. */
export const caseStatusTint = (s?: string | null): string => statusTint(s || 'open')

export const CASE_STATUSES = ['open', 'active', 'cold', 'closed'] as const

/** Plain-English "whose court is it in" for the case header — derived from the
 *  server-authoritative sign-off state + the viewer (casefiles.js:12-24). */
export function caseCourtHint(
  c: CaseRow,
  meId: string | null,
  assigneeName: string | null,
): { t: string; c: string } | null {
  const st = c.signoff_status || 'none'
  const awaiting = st === 'awaiting_bureau_lead' || st === 'awaiting_deputy' || st === 'awaiting_director'
  const iAmOwner = !!meId && (c.signoff_submitted_by === meId || c.lead_detective_id === meId)
  const stageLabel = SIGNOFF_STAGE_LABEL[c.signoff_stage ?? ''] || 'reviewer'
  if (st === 'none') return null
  if (awaiting && meId && c.signoff_assignee_id === meId) return { t: '⚖️ Awaiting your decision', c: 'bg-blue-500/15 text-blue-300' }
  if (st === 'approved_deputy' && iAmOwner) return { t: '⚖️ Your call — complete or escalate', c: 'bg-blue-500/15 text-blue-300' }
  if ((st === 'changes_requested' || st === 'denied') && iAmOwner) return { t: '↩️ Sent back to you — revise & resubmit', c: 'bg-rose-500/15 text-rose-300' }
  if (awaiting) return { t: `⏳ Waiting on ${assigneeName || stageLabel}`, c: 'bg-amber-500/15 text-amber-300' }
  if (st === 'approved' || st === 'completed') return { t: '✅ Approved', c: 'bg-emerald-500/15 text-emerald-300' }
  return null
}
