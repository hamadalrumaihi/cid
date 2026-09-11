/** Notification rendering — one shared vocabulary for the bell panel and the
 *  My Desk unread list (port of vanilla NOTIF_LABEL + the openNotifications
 *  row shape, app.js). Keeping it in lib/ means every surface renders a
 *  notification the same way instead of falling back to raw payload JSON. */
import { caseLink } from './caseLinks'
import type { Json, Tables } from './database.types'
import titles from './notificationTitles.json'
import { parseNotifPayload, type NotifPayload } from './schemas'

export type NotificationRow = Tables<'notifications'>

/** The ONE notification registry (Phase 7, P7-07; typed in the CI release):
 *  `notificationTitles.json` carries every kind the portal emits with its
 *  human title, its category and the optional flags below; the discord-notify
 *  Edge Function ships a byte-identical copy (scripts/sync-notification-
 *  titles.mjs, gate `check:notif-titles`) and decides from the same fields.
 *  lib/notifications derives the in-app mute groups and the Discord opt-in
 *  categories from this registry — nothing lists a kind twice. Unknown types
 *  fall back to the raw type string, never to JSON. */
export interface NotifEntry {
  title: string
  /** Category key — copy lives in lib/notifications NOTIF_CATEGORY_META. */
  category: string
  /** `portal` = in-app only: the edge function skips it before any lookup,
   *  and its category never appears in the Discord opt-in list. */
  destination?: 'portal'
  /** A clearly-optional FYI stream a member may mute in-app. Absent =
   *  mandatory (assignments, mentions, decisions, legal, security …). */
  mutable?: true
  priority?: 'high' | 'normal' | 'low'
}
export const NOTIF_REGISTRY: Record<string, NotifEntry> = titles as Record<string, NotifEntry>

/** Human titles per type — derived from the registry so the bell, My Desk,
 *  the Action Center and the Discord DM all say the same words. */
export const NOTIF_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(NOTIF_REGISTRY).map(([k, v]) => [k, v.title]),
)

/** Category per type (`other` when the JSON has no entry — always sent when
 *  a title exists). */
export const NOTIF_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(NOTIF_REGISTRY).map(([k, v]) => [k, v.category]),
)

/** Where a kind is delivered: `portal` (in-app only) or `all` (in-app, and a
 *  Discord DM when the recipient opted in). Unknown types are `all` — the
 *  edge function then refuses them for having no title. */
export const notifDestination = (type: string): 'portal' | 'all' =>
  NOTIF_REGISTRY[type]?.destination === 'portal' ? 'portal' : 'all'

/** May a member mute this kind in-app? False for unknown types. */
export const isMutableNotif = (type: string): boolean => NOTIF_REGISTRY[type]?.mutable === true

const isIntel = (t: string): boolean => t.startsWith('intel_')

/** The review tool with one record selected (`record` is the workspace's
 *  generic record param; FieldReviewView reads it as a mount-time seed). */
export const intelReviewHref = (submissionId: string | null | undefined): string =>
  submissionId
    ? `/tools?tool=field-review&record=${encodeURIComponent(submissionId)}`
    : '/tools?tool=field-review'

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
  // Platform kinds carry ids and numbers only (§2.10): the evidence number
  // is the one human identifier a media-scoped payload may show.
  const detail = p.request_number || p.case_number || strField(p, 'evidence_number') || p.tracker_code || p.target
  if (!detail) return null
  return p.detective ? `${detail} · ${p.detective}` : detail
}

/** A string payload field that is not part of the typed schema (the loose
 *  parse keeps it as `unknown`). */
const strField = (p: NotifPayload, key: string): string | null => {
  const v = (p as Record<string, unknown>)[key]
  return typeof v === 'string' && v ? v : null
}

/** `packet.render` → "Packet render" — the job kind humanised for the
 *  Owner's failure ping (no reason text travels by contract). */
const jobKindText = (kind: string): string => kind.replace(/[._-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** The platform-upgrade kinds (§2.10) and where each lands: packets and
 *  generated documents on the case's Documents tab (the packet / media
 *  selected), evidence events on Evidence & Media (the media selected),
 *  sources in the Intelligence workspace, job failures in the Owner
 *  Console's System Health section. Ids only — a missing id falls back to
 *  the owning surface, never to a dead row. */
export const PLATFORM_NOTIF_KINDS: ReadonlySet<string> = new Set([
  'case_packet_ready', 'case_packet_failed', 'evidence_bundle_ready', 'evidence_integrity_failure', 'evidence_custody_transfer',
  'external_source_changed', 'external_source_failed', 'document_ready', 'document_failed', 'background_job_failed',
])

function platformNotifHref(type: string, p: NotifPayload): string | null {
  const caseId = p.case_id || null
  switch (type) {
    case 'case_packet_ready':
    case 'case_packet_failed':
      return caseId ? caseLink(caseId, 'documents', { packet: strField(p, 'packet_id') ?? undefined }) : null
    case 'evidence_bundle_ready':
      return caseId ? caseLink(caseId, 'documents') : null
    case 'evidence_integrity_failure':
    case 'evidence_custody_transfer':
      return caseId ? caseLink(caseId, 'media', { media: strField(p, 'media_id') ?? undefined }) : null
    case 'document_ready':
    case 'document_failed':
      return caseId ? caseLink(caseId, 'documents', { media: strField(p, 'media_id') ?? undefined }) : null
    case 'external_source_changed':
    case 'external_source_failed': {
      const id = strField(p, 'source_id')
      return id ? `/intelligence?source=${encodeURIComponent(id)}` : '/intelligence'
    }
    case 'background_job_failed':
      return '/owner?s=health'
    default:
      return null
  }
}

/** Secondary human line — the reason (or tracker/target context). */
export function notifSub(n: NotificationRow): string | null {
  const p = asPayload(n.payload)
  // Intel kinds show the FI number and nothing else — by contract the payload
  // carries no reason or summary, and this line must never grow one.
  if (isIntel(n.type)) return p.submission_no || null
  // The Owner's job-failure ping names the job kind (ids only otherwise).
  if (n.type === 'background_job_failed') return p.kind ? jobKindText(p.kind) : null
  return p.reason || p.title || [p.tracker_code, p.target].filter(Boolean).join(' · ') || null
}

/** Case tab that owns each case-scoped type — the click lands on the section
 *  where the event happened, not just the case Overview (same ?case=&tab=
 *  URLs the tab strip writes). Types not listed open the Overview. */
const NOTIF_CASE_TAB: Record<string, string> = {
  task_assigned: 'tasks',
  // Blockers are hosted on the Brief (CaseBlockersPanel in OverviewTab) —
  // explicit so a future move of the panel is a one-line edit here.
  blocker_assigned: 'overview',
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
  // Sanitized intelligence released to a case (names no CI) — the Intel tab.
  case_intel_released: 'intel',
}

/** The Informants compartment (mirrors lib/ci `ciHref` and the requests panel link
 *  without importing that module here). Request kinds open the requests
 *  panel; every other `ci_*` kind opens the source's profile — and nothing
 *  when the payload carries no `ci_id` (ids only by contract; a missing id
 *  must never fall through to a case link or a generic surface). */
const CI_REQUEST_KINDS = new Set(['ci_capacity_request', 'ci_request_decided'])
const ciNotifHref = (type: string, p: NotifPayload): string | null => {
  if (CI_REQUEST_KINDS.has(type)) return '/informants?requests=1'
  return typeof p.ci_id === 'string' && p.ci_id ? `/informants?ci=${encodeURIComponent(p.ci_id)}` : null
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
  // Escalation ladder (P7-03): the payload names the escalated SOURCE — a
  // sign-off lands on the Sign-off tab, an overdue task on that task, an
  // access request on the case (where the decision is made).
  if (t === 'action_escalated' && p.case_id) {
    if (p.kind === 'signoff') return caseLink(p.case_id, 'signoff')
    if (p.kind === 'task_overdue') return caseLink(p.case_id, 'tasks', { task: p.source_id })
    return caseLink(p.case_id)
  }
  if (t === 'action_escalated') return '/inbox?f=escalated'
  // Confidential-informant kinds route to the compartment BEFORE the generic
  // case arm — a CI notification never lands on a case surface.
  if (t.startsWith('ci_')) return ciNotifHref(t, p)
  // Platform-upgrade kinds (§2.10) carry their own deep links (packet /
  // media / source ids) — before the generic case arm so the click lands on
  // the record, not the case Overview.
  if (PLATFORM_NOTIF_KINDS.has(t)) return platformNotifHref(t, p)
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
  // Intel triage (Phase 6 §4): every kind lands on the review tool with the
  // record selected. That includes intel_question, the ONLY kind a submitter
  // receives: a CID-authored record's author is a CID member with a bell, and
  // the review tool is their surface; a patrol officer's account renders
  // FieldShell for EVERY route (app layout, state 'field') and has no bell at
  // all — "Question for you" is surfaced on the shell's home screen instead,
  // so no separate officer href exists to route to.
  if (isIntel(t)) return intelReviewHref(p.submission_id)
  if (t === 'membership_request' || t === 'access_requested') return '/command-center?s=membership'
  if (t.startsWith('transfer')) return '/command-center?s=promotions'
  // membership_update doubles as the transfer-status fan-out (transfer_id in
  // the payload): reviewers open the transfer queue, the member their profile.
  if (t === 'membership_update') return p.transfer_id && opts.command ? '/command-center?s=promotions' : '/profile'
  if (t === 'member_approved') return '/guide'
  if (t.startsWith('tracker')) return '/command-center?s=ops'
  // Caseless mentions come from announcement fan-outs (announce_id payload).
  if (t === 'announcement' || t === 'mention') return '/announce'
  if (t === 'client_error') return '/owner'
  // The Owner's daily audit-chain verify (20261006120000) — open the Audit Log.
  if (t === 'audit_chain_mismatch') return '/audit'
  return null
}
