/** Notification rendering — one shared vocabulary for the bell panel and the
 *  My Desk unread list (port of vanilla NOTIF_LABEL + the openNotifications
 *  row shape, app.js). Keeping it in lib/ means every surface renders a
 *  notification the same way instead of falling back to raw payload JSON. */
import { caseLink } from './caseLinks'
import type { Json, Tables } from './database.types'
import { parseNotifPayload, type NotifPayload } from './schemas'

export type NotificationRow = Tables<'notifications'>

/** Human titles per type — vanilla app.js NOTIF_LABEL, plus the types emitted
 *  outside that map (`member_approved`, `mention`, stale-case escalation —
 *  vanilla wrote `case_stale`, the rebuild's cases slice writes `stale_case`;
 *  both are mapped so history from either app renders). Unknown types fall
 *  back to the raw type string, never to JSON. */
export const NOTIF_LABEL: Record<string, string> = {
  tracker_pending: 'Tracker awaiting co-sign',
  tracker_authorized: 'Tracker authorized',
  case_assigned: 'Case assigned',
  case_reassigned: 'Case moved to another bureau',
  task_assigned: 'Task assigned to you',
  case_handover: 'Case handed over',
  report_finalized: 'Report finalized',
  // Phase 5 review flow (contract §4): reviewers on the case / the author.
  report_submitted: 'Report submitted for your review',
  report_returned: 'Report returned for revision',
  report_reopened: 'Report reopened',
  rico_ready: 'RICO elements satisfied',
  signoff_waiting: 'Case awaiting your sign-off',
  signoff_approved: 'Case sign-off approved',
  signoff_denied: 'Case sign-off denied',
  signoff_changes: 'Sign-off — changes requested',
  signoff_escalated: 'Case auto-escalated (LOA)',
  signoff_heads_up: 'Deputy approved a case',
  chat_mention: 'You were mentioned',
  mention: 'You were mentioned',
  note_mention: 'You were mentioned in a case note',
  access_requested: 'Case access requested',
  access_granted: 'Case access granted',
  access_denied: 'Case access denied',
  access_expiring: 'Case access expiring soon',
  access_expired: 'Case access expired',
  access_renewed: 'Case access renewed',
  siu_reconcile: 'SIB reconcile: a CID record matches a compartmented one',
  entity_update_suggested: 'Record update suggested',
  entity_suggestion_decided: 'Your record update was decided',
  announcement: '📣 Announcement',
  member_approved: 'Access approved',
  membership_request: 'Membership request awaiting review',
  membership_update: 'Membership request update',
  joint_case_added: 'Added to a joint case',
  audit_chain_mismatch: 'Audit chain verification failed',
  joint_case_removed: 'Joint-case access removed',
  joint_case_ended: 'Joint case ended',
  op_joint_linked: 'Case joined a Joint Operation',
  op_joint_removed: 'Case removed from a Joint Operation',
  login_denied: '⛔ Portal access denied',
  login_restored: 'Portal access restored',
  justice_membership_request: 'Justice membership request awaiting review',
  justice_membership_update: 'Justice membership update',
  ada_assignment: 'Prosecutor bureau assignment', // legacy (bureau slots retired)
  legal_request: '⚖️ Legal request needs your attention',
  legal_update: '⚖️ Legal request update',
  legal_decision: '⚖️ Legal decision recorded',
  legal_coverage: '⚠ Legal coverage gap', // legacy kind (prosecutor coverage retired)
  // Phase 4 legal kinds (contract §7). Sealed payloads carry only
  // {request_id, sealed:true} — the title is all the bell ever shows.
  legal_comment: '💬 New comment on a legal request',
  legal_nudge: '⏰ Legal request awaiting action',
  legal_escalated: '⚠ Legal request escalated',
  legal_unissued: 'Approved request not yet issued',
  legal_expiring: 'Legal instrument expiring soon',
  legal_expired: 'Legal instrument expired',
  legal_deadline_passed: 'Subpoena response deadline passed',
  legal_observer: 'You were added as an observer',
  client_error: '⚠ App error reported',
  case_stale: 'Case going stale',
  stale_case: 'Case going stale',
  document_suggestion: 'Document suggestion update',
  restricted_break_glass: '🔓 Restricted media break-glass',
  restricted_access_requested: '🔓 Restricted access requested',
  restricted_access_granted: '🔓 Restricted access granted',
  restricted_access_denied: '🔒 Restricted access denied',
  restricted_access_revoked: '🔒 Restricted access revoked',
  surveillance_decided: 'Surveillance request decided',
}

// Payload parsing is zod-validated (v1.14): malformed payloads degrade to {}
// instead of leaking raw JSON into the bell panel.
const asPayload = (p: Json | null): NotifPayload => parseNotifPayload(p)

export function notifTitle(n: NotificationRow): string {
  return NOTIF_LABEL[n.type] ?? n.type
}

/** Mono identifier line — case number / tracker code / target (+ actor),
 *  matching the vanilla row's blue mono line. Null when nothing applies. */
export function notifDetail(n: NotificationRow): string | null {
  const p = asPayload(n.payload)
  const detail = p.request_number || p.case_number || p.tracker_code || p.target
  if (!detail) return null
  return p.detective ? `${detail} · ${p.detective}` : detail
}

/** Secondary human line — the reason (or tracker/target context). */
export function notifSub(n: NotificationRow): string | null {
  const p = asPayload(n.payload)
  return p.reason || p.title || [p.tracker_code, p.target].filter(Boolean).join(' · ') || null
}

/** Case tab that owns each case-scoped type — the click lands on the section
 *  where the event happened, not just the case Overview (same ?case=&tab=
 *  URLs the tab strip writes). Types not listed open the Overview. */
const NOTIF_CASE_TAB: Record<string, string> = {
  task_assigned: 'tasks',
  chat_mention: 'chat',
  mention: 'chat',
  note_mention: 'notes',
  report_finalized: 'reports',
  report_submitted: 'reports',
  report_returned: 'reports',
  report_reopened: 'reports',
  rico_ready: 'rico',
  signoff_waiting: 'signoff',
  signoff_approved: 'signoff',
  signoff_denied: 'signoff',
  signoff_changes: 'signoff',
  signoff_escalated: 'signoff',
  signoff_heads_up: 'signoff',
  // Restricted-media access lives in the Photos & Media tab (request banner,
  // command decision panel) — land the click where the action is.
  restricted_access_requested: 'media',
  restricted_access_granted: 'media',
  restricted_access_denied: 'media',
  restricted_access_revoked: 'media',
  // Surveillance decisions land on the case's Surveillance tab.
  surveillance_decided: 'surveillance',
}

/** Where clicking a notification should take the member — so bell rows are
 *  never dead ends. Case-scoped payloads win (most types carry case_id) and
 *  deep-link into the owning tab; the rest route by type to the surface that
 *  owns them. `command` widens transfer updates to the Command Center queue
 *  (non-command members land on their own profile instead of the CC gate).
 *  Null = no useful destination (purely informational), and the row stays a
 *  mark-read-only click. */
export function notifHref(n: NotificationRow, opts: { command?: boolean } = {}): string | null {
  const p = asPayload(n.payload)
  const t = n.type
  // Report notifications carry report_id — land on THAT report (?report=),
  // not just the Reports tab (contract §4 deep link).
  if (p.case_id) return caseLink(p.case_id, NOTIF_CASE_TAB[t], { report: typeof p.report_id === 'string' ? p.report_id : undefined })
  // Legal review lives in the /legal surface (the minimal-DOJ workspace is a
  // role-aware mode of the same route). legal*/justice*/ada_assignment
  // notifications route to a specific request when one is carried, else the
  // Legal registry — never the removed standalone Justice Portal.
  const isLegal = t.startsWith('legal') || t.startsWith('justice') || t === 'ada_assignment'
  if (isLegal && p.request_id) return `/legal?request=${encodeURIComponent(p.request_id)}`
  if (isLegal) return '/legal'
  // Document suggestions: open the target document if there is one, else the
  // review workspace (managers land on the queue; others fall back to the shelf).
  if (t === 'document_suggestion') {
    const docId = typeof p.document_id === 'string' ? p.document_id : null
    return docId ? `/sops?doc=${docId}` : '/sops?view=suggestions'
  }
  if (t === 'membership_request' || t === 'access_requested') return '/command-center?s=approvals'
  if (t.startsWith('transfer')) return '/command-center?s=promotions'
  // membership_update doubles as the transfer-status fan-out (transfer_id in
  // the payload): reviewers open the transfer queue, the member their profile.
  if (t === 'membership_update') return p.transfer_id && opts.command ? '/command-center?s=promotions' : '/profile'
  if (t === 'member_approved') return '/guide'
  if (t.startsWith('tracker')) return '/command'
  // Caseless mentions come from announcement fan-outs (announce_id payload).
  if (t === 'announcement' || t === 'mention') return '/announce'
  if (t === 'client_error') return '/owner'
  // The Owner's daily audit-chain verify (20261006120000) — open the Audit Log.
  if (t === 'audit_chain_mismatch') return '/audit'
  return null
}
