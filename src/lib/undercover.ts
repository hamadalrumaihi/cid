/** CID undercover operations — the client model.
 *
 *  Pure, and deliberately so: every rule below is a client MIRROR of something
 *  the database already enforces (RLS on `uc_operations`, the constraints on
 *  its columns, the guards inside `uc_report_criminal_activity` /
 *  `uc_mark_compromised` / `uc_command_act`). Nothing here is a permission
 *  check. A detective who edits the DOM gets a refusal from Postgres, not a
 *  wider view.
 *
 *  The vocabulary is the issued procedure's. Where a label had to be invented
 *  — a status name, a queue heading — it says what the procedure says and adds
 *  nothing: this module must not become the place a new requirement quietly
 *  appears. See the guide at /guides/undercover-procedure. */
import type { Tables } from './database.types'

export type UcOperation = Tables<'uc_operations'>
export type UcCriminalActivity = Tables<'uc_criminal_activity'>
export type UcCommandAction = Tables<'uc_command_actions'>

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

export const UC_STATUSES = ['planned', 'active', 'concluded', 'compromised', 'terminated'] as const
export type UcStatus = (typeof UC_STATUSES)[number]

export const UC_STATUS_LABEL: Record<UcStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  concluded: 'Concluded',
  compromised: 'Compromised',
  terminated: 'Terminated by Command',
}

/** §3's three answers about the recording. 'pending' is not a failure — it is
 *  the state before the detective has been asked. */
export const UC_RECORDING_STATUSES = ['pending', 'confirmed', 'unavailable'] as const
export type UcRecordingStatus = (typeof UC_RECORDING_STATUSES)[number]

export const UC_RECORDING_LABEL: Record<UcRecordingStatus, string> = {
  pending: 'Not yet confirmed',
  confirmed: 'Recording confirmed',
  unavailable: 'Unavailable — technical failure',
}

export const UC_REVIEW_STATUSES = ['not_required', 'requested', 'under_review', 'cleared', 'referred'] as const
export type UcReviewStatus = (typeof UC_REVIEW_STATUSES)[number]

export const UC_REVIEW_LABEL: Record<UcReviewStatus, string> = {
  not_required: 'No review',
  requested: 'Recording requested',
  under_review: 'Under review',
  cleared: 'Cleared',
  referred: 'Referred to High Command',
}

/** §8's command actions, in the order the procedure lists them. `label` is
 *  what the button says; `needsNote` mirrors the server's own refusal. */
export const UC_COMMAND_ACTIONS = [
  { id: 'request_recording', label: 'Request recording', needsNote: false },
  { id: 'recording_received', label: 'Record recording received', needsNote: false },
  { id: 'terminate', label: 'Require termination', needsNote: false },
  { id: 'add_restriction', label: 'Add restriction', needsNote: true },
  { id: 'flag_review', label: 'Flag for review', needsNote: false },
  { id: 'clear_review', label: 'Clear review', needsNote: false },
  { id: 'restrict_authorization', label: 'Restrict future UC authorization', needsNote: true },
  { id: 'refer_high_command', label: 'Refer to High Command', needsNote: true },
  { id: 'note', label: 'Add note', needsNote: false },
] as const
export type UcCommandActionId = (typeof UC_COMMAND_ACTIONS)[number]['id']

export const ucStatusLabel = (s: string | null | undefined): string =>
  (s && UC_STATUS_LABEL[s as UcStatus]) || s || '—'
export const ucRecordingLabel = (s: string | null | undefined): string =>
  (s && UC_RECORDING_LABEL[s as UcRecordingStatus]) || s || '—'
export const ucReviewLabel = (s: string | null | undefined): string =>
  (s && UC_REVIEW_LABEL[s as UcReviewStatus]) || s || '—'

/** An operation still running is one a detective can still act on. */
export const isUcOpen = (o: Pick<UcOperation, 'status'>): boolean =>
  o.status === 'planned' || o.status === 'active'

/* ── §3 · Retention ──────────────────────────────────────────────────────── */

/** The procedure's floor, in hours. Named rather than inlined so the guide,
 *  the schema comment and this module all point at one number. */
export const UC_RETENTION_HOURS = 72

export type RetentionState =
  /** The session has not concluded, so the clock has not started. */
  | 'not_started'
  /** Inside the 72-hour window: the detective must still hold the recording. */
  | 'holding'
  /** The 72 hours have elapsed. The procedure requires nothing further — it
   *  sets a MINIMUM, not a destruction date. */
  | 'elapsed'

export interface RetentionInfo {
  state: RetentionState
  /** ISO deadline, or null before the operation has concluded. */
  until: string | null
  /** Whole hours left, or null when there is no running clock. Never negative. */
  hoursLeft: number | null
}

/** What the 72-hour rule means for one operation right now.
 *
 *  Deliberately says nothing about deleting: §3 requires the recording to be
 *  KEPT for at least 72 hours and is silent on what happens afterwards, so
 *  'elapsed' is the end of an obligation, never a prompt to destroy anything. */
export function retentionInfo(
  op: Pick<UcOperation, 'ended_at' | 'retention_until'>,
  now: number = Date.now(),
): RetentionInfo {
  // Prefer the server's own derived value; fall back to the same arithmetic so
  // a freshly-typed end time shows its deadline before the row round-trips.
  const until = op.retention_until
    ?? (op.ended_at ? new Date(Date.parse(op.ended_at) + UC_RETENTION_HOURS * 3600_000).toISOString() : null)
  if (!until) return { state: 'not_started', until: null, hoursLeft: null }
  const t = Date.parse(until)
  if (Number.isNaN(t)) return { state: 'not_started', until: null, hoursLeft: null }
  const msLeft = t - now
  if (msLeft <= 0) return { state: 'elapsed', until, hoursLeft: 0 }
  return { state: 'holding', until, hoursLeft: Math.ceil(msLeft / 3600_000) }
}

/* ── §5 · The notification duty ──────────────────────────────────────────── */

/** The three things §5 requires once a detective has participated in criminal
 *  activity of ANY kind. All three, not any of them. */
export const UC_NOTIFICATION_REQUIREMENTS = [
  { id: 'bureau_lead', label: 'Bureau Lead notified' },
  { id: 'command', label: 'CID Command notified' },
  { id: 'recording', label: 'Full session recording submitted to CID Command' },
] as const
export type UcNotificationRequirementId = (typeof UC_NOTIFICATION_REQUIREMENTS)[number]['id']

export interface NotificationCompleteness {
  /** Requirements still outstanding, in the procedure's order. */
  outstanding: UcNotificationRequirementId[]
  complete: boolean
}

/** What is still missing from a §5 report.
 *
 *  This is a CHECKLIST, not a verdict. The procedure makes notification a
 *  reporting duty; an incomplete report means paperwork is owed, and it is
 *  never evidence of misconduct. Nothing in this module or the schema turns
 *  `criminal_activity` into a disciplinary state. */
export function notificationCompleteness(
  row: Pick<UcCriminalActivity, 'bureau_lead_notified_at' | 'command_notified_at' | 'recording_submitted_at'>,
): NotificationCompleteness {
  const outstanding: UcNotificationRequirementId[] = []
  if (!row.bureau_lead_notified_at) outstanding.push('bureau_lead')
  if (!row.command_notified_at) outstanding.push('command')
  if (!row.recording_submitted_at) outstanding.push('recording')
  return { outstanding, complete: outstanding.length === 0 }
}

/* ── What this operation still owes ──────────────────────────────────────── */

export interface UcObligation {
  id: string
  label: string
  /** True when the procedure requires it and it has not been done. */
  outstanding: boolean
}

/** The operation's own open obligations, read straight off the row.
 *
 *  Only requirements the issued procedure actually states appear here. It is
 *  the list a detective is answerable for, so inventing an extra line would be
 *  inventing policy. */
export function ucObligations(
  op: Pick<UcOperation,
    'status' | 'ended_at' | 'recording_status' | 'criminal_activity'
    | 'bureau_lead_notified_at' | 'command_notified_at' | 'recording_submitted_at' | 'command_review_status'>,
): UcObligation[] {
  const out: UcObligation[] = []

  // §3: the session must be recorded. Unanswered is outstanding; 'unavailable'
  // is answered — the procedure allows technical failure, provided it was
  // explained, and the schema will not store it without the explanation.
  out.push({
    id: 'recording',
    label: 'Confirm the session was recorded',
    outstanding: op.recording_status === 'pending',
  })

  // §5: all three, and only once criminal activity has been reported.
  if (op.criminal_activity) {
    out.push({ id: 'notify_lead', label: 'Notify your Bureau Lead', outstanding: !op.bureau_lead_notified_at })
    out.push({ id: 'notify_command', label: 'Notify CID Command', outstanding: !op.command_notified_at })
    out.push({
      id: 'submit_recording',
      label: 'Submit the full session recording to CID Command',
      outstanding: !op.recording_submitted_at,
    })
  }

  // §8: a recording Command has asked for is owed until it is marked received.
  if (op.command_review_status === 'requested') {
    out.push({
      id: 'command_request',
      label: 'CID Command has requested the recording',
      outstanding: !op.recording_submitted_at,
    })
  }

  return out
}

export const ucOutstandingCount = (op: Parameters<typeof ucObligations>[0]): number =>
  ucObligations(op).filter((o) => o.outstanding).length

/* ── Identity protection ─────────────────────────────────────────────────── */

/** The one-line reminder the alias field carries.
 *
 *  §4 is an obligation on the DETECTIVE as well as on the portal, so the field
 *  says who will be able to read what is typed into it. The list is the same
 *  one `private.uc_row_visible` enforces. */
export const UC_ALIAS_AUDIENCE_NOTE =
  'Visible to you, your Bureau Lead, CID Command and High Command only — the positions §4 authorizes. No other member, and no non-CID account, can read it.'
