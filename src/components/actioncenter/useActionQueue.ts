'use client'

/** The ONE Action Center queue (Phase 7, P7-06 / AC7) — every surface that
 *  shows "what is waiting on me" (the Action Center, My Dashboard's slice,
 *  the Command Center's slices, the nav badges) reads this hook, so the
 *  sources are fetched once per realtime bump however many consumers mount.
 *
 *  DATA LAYER: a module-level zustand store (lib/profiles / useNavBadges
 *  pattern). The hook subscribes to the realtime table versions, folds them
 *  with the viewer's standing into ONE load key, and the store runs ONE fetch
 *  per distinct key (twin consumers share it). Stale-while-revalidate: the
 *  previous items stay on screen while a refresh is in flight.
 *
 *  Per-viewer state (`action_item_state`) and the escalation ledger
 *  (`action_escalations`) ride along: both are read fail-open (the tables may
 *  be absent in a mock), merged in the pure builder, and the state table is
 *  re-read alone after a snooze / dismiss so the whole fan-out never re-runs
 *  for a one-row change. */
import { useCallback, useEffect, useMemo } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { create } from 'zustand'
import {
  buildActionItems,
  type AcBoloPerson, type AcCaseGrant, type AcClientError, type AcDoc, type AcDraft, type AcEscalation,
  type AcFieldAccessRequest, type AcFieldSubmission, type AcGangMember, type AcGrant, type AcHold,
  type AcJusticeApplication, type AcLegalComment, type AcMdtExport, type AcMemberTransfer,
  type AcMySubmission, type AcNarcoticSuggestion, type AcObservation, type AcRejectedSubmission,
  type AcReport, type AcRestrictedExport, type AcSiuAccessRequest, type AcSiuConflict,
  type AcSiuDisclosure, type AcSiuReferral, type AcSiuWatch, type AcSuggestion, type AcSurvAlert,
  type AcSurvTarget, type AcTracker, type ActionItem, type ActionItemState, type ActionSources,
} from '@/lib/actionItems'
import { isDbError, isHidden, setActionState, type ActionStateOp } from '@/lib/actionState'
import {
  ackState, canApproveDoc, docTitle, reviewState,
  type MyAckVersions, type ShelfDoc,
} from '@/components/sops/docModel'
import { list, rpc, type DbError } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { todayISO } from '@/lib/format'
import { clusterDuplicates } from '@/lib/gangDuplicates'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { useFieldStanding } from '@/lib/fieldStanding'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { pendingMembership, type JusticeRequestLite } from '@/components/command-center/lib/membershipPending'
import { buildLegalViewer } from '@/components/justice/legalShared'
import { usePermissions, useSiu } from '@/lib/permissions'

export type { ActionStateOp }

export interface ActionQueueCounts {
  /** Items waiting on the viewer personally (needs_action / due_soon / overdue / returned). */
  personal: number
  /** Command decisions the viewer owns. */
  command: number
  overdue: number
  /** Sign-off decisions + returned cases — the legacy "signoff" nav badge. */
  signoff: number
  escalated: number
  /** Membership sign-ins awaiting command (the legacy "pending" nav badge); 0 for non-command. */
  membership: number
}

export interface ActionQueue {
  /** Visible items: not snoozed, not dismissed, sorted by the model. */
  items: ActionItem[]
  /** Everything the builder produced, before the per-viewer state filter. */
  allItems: ActionItem[]
  snoozed: ActionItem[]
  dismissed: ActionItem[]
  /** Per-viewer state by dedupe key. */
  states: Record<string, ActionItemState>
  /** Live escalations by dedupe key → escalated_at. */
  escalations: Record<string, string>
  suppressedCount: number
  loading: boolean
  refreshing: boolean
  error: unknown
  lastRefreshed: number | null
  refresh: () => Promise<void>
  /** Snooze / dismiss / seen for one key or many (`action_item_set_state` /
   *  `_many`); a decision key is never dismissed (skipped + reported). */
  setState: (keys: string | string[], op: ActionStateOp, until?: string) => Promise<{ applied: number; skipped: string[] } | DbError>
  counts: ActionQueueCounts
}

export function countQueue(items: readonly ActionItem[]): ActionQueueCounts {
  let personal = 0, command = 0, overdue = 0, signoff = 0, escalated = 0, membership = 0
  for (const it of items) {
    if (it.status === 'overdue') overdue++
    if (it.escalatedAt) escalated++
    if (it.isCommandItem) command++
    if (it.isPersonalItem && it.status !== 'waiting' && it.status !== 'informational') personal++
    if (it.sourceType === 'signoff' || it.sourceType === 'returned_case') signoff++
    if (it.sourceType === 'membership_request') membership += Number((it.sourceMetadata as { count?: unknown }).count) || 1
  }
  return { personal, command, overdue, signoff, escalated, membership }
}

/* ── column projections ──────────────────────────────────────────────────────
 * Each mirrors its Ac* Pick in lib/actionItems exactly (the model documents
 * that the loader builds selects from those lists). Cases never fetch
 * notes/charges; legal never fetches form_data/narrative. */
const CASE_COLS =
  'id,case_number,title,status,bureau,priority,lead_detective_id,created_by,follow_up_at,signoff_status,signoff_stage,signoff_assignee_id,signoff_submitted_by,signoff_submitted_at,created_at,updated_at'
const TASK_COLS = 'id,case_id,title,due,done,assignee,created_at,updated_at'
const TRANSFER_COLS = 'id,status,target_id,requested_by,from_bureau,to_bureau,reason,created_at,updated_at'
const ACCESS_COLS = 'id,case_id,requester_id,requester_name,reason,status,created_at'
const LEGAL_COLS =
  'id,case_id,case_number_snapshot,request_number,request_type,subtype,review_status,'
  + 'document_status,fulfilment_status,service_status,compliance_status,approval_route,'
  + 'classification,created_by,responsible_bureau,assigned_ada_id,assigned_judge_id,'
  + 'assigned_prosecutor_id,queue_entered_at,submitted_to_judge_at,'
  + 'stage_entered_at,nudged_at,escalated_at,'
  + 'response_deadline,expires_at,submitted_to_doj_at,created_at,updated_at'
const BLOCKER_COLS = 'id,case_id,title,type,status,owner_id,review_at,created_at,updated_at'
/** Active legal holds — command only; the model gates the item on isCommand. */
const HOLD_COLS = 'id,case_id,reason,placed_by,placed_at'
/** Restricted-access grants — RLS-scoped (command: all; member: own rows). */
const GRANT_COLS = 'id,case_id,user_id,status,reason,granted_at,decided_at,expires_at'
/** Case access grants (P1-06) — RLS-scoped: own grants, or every grant on a
 *  case the viewer can read (leads and command see what they may renew). */
const CASE_GRANT_COLS = 'id,case_id,officer_id,expires_at,granted_by'
/** Surveillance — unverified observations + decision/expiry targets, both
 *  RLS-scoped to accessible cases and fail-open (the domain may be absent). */
const OBS_COLS = 'id,case_id,activity,source_type,created_at,observed_at,updated_at'
const TGT_COLS = 'id,case_id,label,status,expires_at,requested_by,updated_at,created_at'
const NOTIF_COLS = 'id,user_id,type,payload,read,read_at,created_at'
/** Library governance projection — never full bodies (docModel AcDoc inputs). */
const DOC_COLS =
  'id,name,folder,kind,status,category,classification,owner_user_id,mandatory,'
  + 'acknowledgement_required,acknowledgement_deadline,review_due_at,sync_status,'
  + 'current_version_number,created_at,updated_at'
/** Document-suggestion projection — RLS already scopes visibility to the
 *  submitter and the managers, so no body/thread columns are ever fetched. */
const SUGGESTION_COLS = 'id,title,status,document_id,created_by,assigned_editor,created_at,updated_at'
/** My saved drafts — the KEY only; payload contents are never fetched. */
const DRAFT_COLS = 'key,updated_at'
/** Unclaimed field-intel projection — mirrors AcFieldSubmission exactly. */
const FIELD_COLS = 'id,submission_no,summary,status,assigned_to,jurisdiction,submitted_at,created_at,updated_at'
/** Review-active lane — fieldReview's OPEN_STATUSES values. */
const FIELD_OPEN = ['new', 'reviewing', 'needs_info']
/** BOLO-expiry projection — mirrors AcBoloPerson exactly. */
const BOLO_COLS = 'id,name,bolo,bolo_expires_at,bolo_risk,updated_at'
/** SIB projections — mirror the AcSiu* Picks exactly. These queries are
 *  issued ONLY for the SIB standing that can act on them (see the gates in
 *  load); a non-SIB viewer never queries an siu_* table from here. RLS is
 *  the real wall either way, and the model re-gates on sibStanding. */
const SIB_ACCESS_COLS = 'id,case_number_requested,reason,status,requested_at,updated_at'
const SIB_REFERRAL_COLS = 'id,category,summary,status,submitted_at,updated_at'
const SIB_DISCLOSURE_COLS = 'id,title,audience,released_at,acknowledged_at,revoked_at'
/** SiuIntake's OPEN_STATUSES — referrals still needing an intake decision. */
const SIB_REFERRAL_OPEN = ['submitted', 'under_review', 'info_requested']
const TRANSFER_PENDING = ['pending_source', 'pending_target']

/* ── Phase 7 (P7-02) projections — mirror the new Ac* Picks exactly ─────────
 * NOT in the realtime publication (no useTableVersion; they refresh on every
 * other trigger): mdt_exports, field_access_requests, restricted_access_log,
 * siu_conflicts, siu_watchlist, field_submission_messages/_reviews. */
const RESTRICTED_LOG_COLS = 'id,action,actor_id,entity_id,entity_type,reason,created_at'
const MDT_COLS = 'id,kind,status,subject_snapshot,reason,risk_level,proposed_by,proposed_at,source_case_id,updated_at'
const FIELD_ACCESS_COLS = 'id,user_id,agency,callsign,status,created_at,updated_at'
const MY_SUB_COLS = 'id,submission_no,summary,status,assigned_to,validated_at,rejected_at,submitted_at,created_at,updated_at'
const REJECTED_COLS = 'id,submission_no,summary,status,rejected_at,rejected_by,updated_at,created_at'
const NARCOTIC_COLS = 'id,title,status,suggestion_type,created_by,source_case_id,created_at,updated_at'
const NARCOTIC_OPEN = ['submitted', 'under_review', 'needs_more_information']
const GANG_MEMBER_COLS = 'id,gang_id,name,person_id,reviewed_at,deleted_at,created_at,updated_at'
const TRACKER_COLS = 'id,tracker_code,target,status,bureau,case_id,created_by,director_sig,deputy_sig,created_at,updated_at'
const SIB_CONFLICT_COLS = 'id,case_id,agent_id,reason,status,declared_at,updated_at'
const SIB_WATCH_COLS = 'id,label,entity_type,priority,status,review_due_at,expires_at,removed_at,assigned_agent,created_at,updated_at'
const CLIENT_ERROR_COLS = 'id,created_at,route'
const JUSTICE_APP_COLS = 'id,applicant_id,display_name,requested_agency,requested_justice_role,status,submitted_at,created_at,updated_at'
const SURV_ALERT_COLS = 'id,case_id,title,explanation,alert_type,status,created_at'
/** Comment bodies are NEVER selected — the item only says a comment exists. */
const LEGAL_COMMENT_COLS = 'id,legal_request_id,author_id,created_at,deleted_at'
const REPORT_COLS = 'id,case_id,template,kind,seq,author_id,review_status,finalized,submitted_at,created_at,updated_at'
const STATE_COLS = 'dedupe_key,seen_at,snoozed_until,dismissed_at'
const ESCALATION_COLS = 'kind,source_id,case_id,escalated_at'

/* ── DOJ revival surface (minimal_doj_revival + doj_transfers) ─────────────── */

/** member_transfers projection — must mirror AcMemberTransfer exactly. */
const MEMBER_TRANSFER_COLS =
  'id,user_id,direction,status,requested_role,target_bureau,reason,cid_decided_by,created_at,updated_at'
/** Open (decidable) transfer stages — effective/terminal rows never surface. */
const MEMBER_TRANSFER_OPEN = ['requested', 'cid_approved', 'doj_accepted']

/** Open member_transfers rows. The table is newer than the generated
 *  database.types, so this is the one cast-boundary read in the loader (RLS
 *  scopes the rows: subject, CID command, active AG, Owner). Fail-open. */
async function fetchMemberTransfers(): Promise<AcMemberTransfer[]> {
  try {
    const sb = supabase() as unknown as SupabaseClient
    const { data, error } = await sb
      .from('member_transfers')
      .select(MEMBER_TRANSFER_COLS)
      .in('status', MEMBER_TRANSFER_OPEN)
    if (error) return []
    return (data ?? []) as unknown as AcMemberTransfer[]
  } catch { return [] }
}

/** Only open-work statuses can produce an action item (see buildActionItems
 *  section 9c); terminal/waiting rows never need a fetch-side row. */
const SUGGESTION_OPEN = ['submitted', 'needs_more_information', 'accepted', 'partially_accepted']

interface SuggestionRow {
  id: string; title: string; status: string; document_id: string | null
  created_by: string; assigned_editor: string | null; created_at: string; updated_at: string
}

interface StateRow { dedupe_key: string; seen_at: string | null; snoozed_until: string | null; dismissed_at: string | null }

const toStates = (rows: StateRow[]): Record<string, ActionItemState> => {
  const out: Record<string, ActionItemState> = {}
  for (const r of rows) out[r.dedupe_key] = { seenAt: r.seen_at, snoozedUntil: r.snoozed_until, dismissedAt: r.dismissed_at }
  return out
}

/** The viewer's own action_item_state rows (RLS: own rows) that still HIDE
 *  something: dismissed, or snoozed into the future. Seen-only and expired
 *  rows change nothing on screen, so they are not fetched — the 1000-row
 *  ceiling then bounds live hides, not history (a member with >1000 live
 *  snoozes/dismissals would see the oldest re-surface; accepted). Returns
 *  null on a failed read so callers keep the previous state instead of
 *  wiping every snooze / dismiss on a transient error (a mock or a
 *  pre-migration database also lands here — its state is simply absent). */
async function fetchStates(): Promise<Record<string, ActionItemState> | null> {
  const nowIso = new Date().toISOString()
  return list('action_item_state', { select: STATE_COLS, or: `dismissed_at.not.is.null,snoozed_until.gt.${nowIso}`, limit: 1000 })
    .then((r) => toStates(r as unknown as StateRow[])).catch(() => null)
}

/** Live escalation-ledger rows on cases the viewer can access. Fail-open. */
async function fetchEscalations(): Promise<AcEscalation[]> {
  return list('action_escalations', { select: ESCALATION_COLS, is: { resolved_at: null }, limit: 500 })
    .then((r) => r as unknown as AcEscalation[]).catch(() => [] as AcEscalation[])
}

/** What the loader needs from the React side — passed in per call so the
 *  store stays a plain module (no hooks inside). */
interface LoaderCtx {
  auth: ReturnType<typeof useAuth>
  sibAgent: boolean
  sibCommand: boolean
  sibIsCommand: boolean
  dojRole: ActionSources['justiceRole']
}

interface QueueStore {
  built: { items: ActionItem[]; suppressedCount: number } | null
  states: Record<string, ActionItemState>
  escalations: Record<string, string>
  loading: boolean
  refreshing: boolean
  error: unknown
  lastRefreshed: number | null
  /** The load key of the last accepted fetch — one fetch per key however many
   *  consumers mount (an in-flight key is not re-fetched). */
  loadKey: string
  load: (key: string, ctx: LoaderCtx, force?: boolean) => Promise<void>
  refreshStates: () => Promise<void>
  setState: ActionQueue['setState']
}

const useActionQueueStore = create<QueueStore>((set, get) => ({
  built: null,
  states: {},
  escalations: {},
  loading: true,
  refreshing: false,
  error: null,
  lastRefreshed: null,
  loadKey: '',

  async load(key, ctx, force = false) {
    if (!force && get().loadKey === key) return
    set({ loadKey: key, refreshing: true })
    const { auth, sibAgent, sibCommand } = ctx
    const { profile, isCommand, isOwner, justiceRole, canEdit } = auth
    if (!profile) { set({ refreshing: false }); return }
    const canAdmin = isCommand || isOwner
    // Item titles bake officer names in (buildActionItems takes the resolver),
    // so the first build waits for the roster; later refreshes revalidate it
    // in the background. The membership count folds the roster + requests +
    // justice identities through the shared pendingMembership model.
    if (!useProfilesStore.getState().loaded) await useProfilesStore.getState().fetch()
    else void useProfilesStore.getState().fetch()
    if (canAdmin) {
      if (!useJusticeRoster.getState().loaded) await useJusticeRoster.getState().fetch()
      else void useJusticeRoster.getState().fetch()
    }
    try {
      const me = profile.id
      const nowMs = Date.now()
      const dayAgo = new Date(nowMs - 86_400_000).toISOString()
      const hourAgo = new Date(nowMs - 3_600_000).toISOString()
      const weekAgo = new Date(nowMs - 7 * 86_400_000).toISOString()
      const [
        cases, tasks, transfers, accessRequests, legal, blockers, notifications, membershipRequests, justiceRequests,
        docRows, docAcks, suggestionRows, holds, restrictedGrants, survObservations, survTargetRows, caseGrants,
        memberTransfers, myDrafts, fieldSubmissions, boloPersons, sibAccessRequests, sibReferrals, sibDisclosures,
        statesRead, escalations,
        restrictedExports, mdtExports, fieldAccessRequests, mySubRows, rejectedSubmissions, narcoticSuggestions,
        gangMembers, trackers, sibConflicts, sibWatchlist, clientErrors, justiceApplications, survAlerts,
        legalComments, reports,
      ] = await Promise.all([
        // Bounded: newest-first so the AWAITING/returned/follow-up branches
        // and the caseById context map keep the live working set — an
        // archived-out backlog beyond the bound only loses cosmetic case
        // context on very old tasks/blockers, never queue items.
        list('cases', { select: CASE_COLS, is: { archived_at: null }, order: 'updated_at', ascending: false, limit: 400 }),
        list('case_tasks', { select: TASK_COLS, eq: { assignee: me, done: false } }),
        list('transfer_requests', { select: TRANSFER_COLS, in: { status: TRANSFER_PENDING } }),
        list('case_access_requests', { select: ACCESS_COLS, eq: { status: 'pending' } }),
        // Fail-closed: legal is RLS-sealed for some viewers — a denied read
        // contributes nothing and must never sink the whole page. Bounded
        // newest-first like cases (terminal rows age out of the window).
        list('legal_requests', { select: LEGAL_COLS, order: 'updated_at', ascending: false, limit: 200 }).catch(() => []),
        list('case_blockers', { select: BLOCKER_COLS, eq: { owner_id: me, status: 'open' } }),
        list('notifications', {
          select: NOTIF_COLS, eq: { user_id: me, read: false }, order: 'created_at', ascending: false, limit: 50,
        }),
        // Fail-open to null (not 0): a failed load means "unknown", and the
        // model then derives what it can from profiles alone.
        canAdmin
          ? rpc('admin_membership_requests', undefined as never).then((r) =>
              !r.error && Array.isArray(r.data) ? r.data : null)
          : Promise.resolve(null),
        // Open DOJ/Judiciary applications (command-readable rows): their
        // applicants are Justice-portal work, never CID membership items.
        canAdmin
          ? list('justice_membership_requests', {
              select: 'applicant_id,status', in: { status: ['draft', 'pending', 'correction_requested'] },
            }).then((rows) => rows as JusticeRequestLite[]).catch(() => null)
          : Promise.resolve(null),
        // Library governance: narrow RLS-scoped projection + my own acks —
        // both fail-open to empty (the queue never sinks on the library).
        list('documents', { select: DOC_COLS }).then((r) => r as unknown as ShelfDoc[]).catch(() => [] as ShelfDoc[]),
        list('document_acknowledgements', { select: 'document_id, documents_versions(version_number)' }).catch(() => []),
        // Document suggestions: RLS returns the submitter's own rows plus any
        // the viewer manages — open statuses only. Fail-open to empty.
        list('document_suggestions', { select: SUGGESTION_COLS, in: { status: SUGGESTION_OPEN } })
          .then((r) => r as unknown as SuggestionRow[]).catch(() => [] as SuggestionRow[]),
        // Active legal holds — command/owner only (the builder gates the item);
        // lifted holds carry a lifted_at, so filter to null. Fail-open to empty.
        canAdmin
          ? list('legal_holds', { select: HOLD_COLS, is: { lifted_at: null } })
              .then((r) => r as unknown as AcHold[]).catch(() => [] as AcHold[])
          : Promise.resolve([] as AcHold[]),
        // Restricted-access grants (Phase 6): open lifecycle rows only —
        // pending (command work) + granted (my own live access). RLS keeps
        // the read tiny (a member only ever gets their own rows). Fail-open.
        list('restricted_access_grants', { select: GRANT_COLS, in: { status: ['pending', 'granted'] } })
          .then((r) => r as unknown as AcGrant[]).catch(() => [] as AcGrant[]),
        // Surveillance verification queue: unverified observations on cases
        // the viewer can access (RLS trims), bounded. Fail-open to empty.
        list('surveillance_observations', {
          select: OBS_COLS, eq: { verification_status: 'unverified' }, order: 'created_at', ascending: false, limit: 100,
        }).then((r) => r as unknown as AcObservation[]).catch(() => [] as AcObservation[]),
        // Targets awaiting a decision or still running — the builder keeps
        // pending_approval rows plus authorized/active ones expiring ≤72h.
        list('surveillance_targets', { select: TGT_COLS, in: { status: ['pending_approval', 'authorized', 'active'] } })
          .then((r) => r as unknown as AcSurvTarget[]).catch(() => [] as AcSurvTarget[]),
        // Case access grants expiring soon (P1-06) — own grants and grants
        // on readable cases. Fail-open to empty.
        list('case_access_grants', { select: CASE_GRANT_COLS })
          .then((r) => r as unknown as AcCaseGrant[]).catch(() => [] as AcCaseGrant[]),
        // Open member transfers — only viewers who could hold a stage
        // decision fetch (command/owner/justice); RLS trims the rest.
        canAdmin || justiceRole ? fetchMemberTransfers() : Promise.resolve([] as AcMemberTransfer[]),
        // My saved drafts (user_drafts is RLS owner-only; the explicit eq
        // is belt-and-braces). Keys + timestamps only — never payloads.
        list('user_drafts', { select: DRAFT_COLS, eq: { user_id: me }, order: 'updated_at', ascending: false, limit: 50 })
          .then((r) => r as unknown as AcDraft[]).catch(() => [] as AcDraft[]),
        // Unclaimed review-active field intel — active reviewers only
        // (canEdit mirrors profiles.active, the RLS is_active() gate the
        // Intelligence queue itself relies on). Bounded + fail-open.
        canEdit
          ? list('field_submissions', {
              select: FIELD_COLS, is: { assigned_to: null, deleted_at: null },
              in: { status: FIELD_OPEN }, order: 'created_at', ascending: false, limit: 100,
            }).then((r) => r as unknown as AcFieldSubmission[]).catch(() => [] as AcFieldSubmission[])
          : Promise.resolve([] as AcFieldSubmission[]),
        // Live BOLO subjects — editors only (the builder re-gates on
        // canManageBolos); slim projection, expiry filtering in the model.
        canEdit
          ? list('persons', { select: BOLO_COLS, eq: { bolo: true }, limit: 200 })
              .then((r) => r as unknown as AcBoloPerson[]).catch(() => [] as AcBoloPerson[])
          : Promise.resolve([] as AcBoloPerson[]),
        // SIB sources — bounded, RLS-scoped (siu_case_access), and fetched
        // ONLY for the standing that can act. All fail-open to empty: an
        // RLS miss and "no SIB work" must be indistinguishable. NOTE: the
        // siu_* tables are not in the realtime publication, so no version
        // counter exists for them — the rows still refresh on every other
        // trigger (visibility catch-up, manual Refresh, sibling bumps).
        sibCommand
          ? list('siu_access_requests', { select: SIB_ACCESS_COLS, eq: { status: 'pending' }, order: 'requested_at', ascending: false, limit: 50 })
              .then((r) => r as unknown as AcSiuAccessRequest[]).catch(() => [] as AcSiuAccessRequest[])
          : Promise.resolve([] as AcSiuAccessRequest[]),
        sibAgent
          ? list('siu_referrals', { select: SIB_REFERRAL_COLS, in: { status: SIB_REFERRAL_OPEN }, order: 'submitted_at', ascending: false, limit: 50 })
              .then((r) => r as unknown as AcSiuReferral[]).catch(() => [] as AcSiuReferral[])
          : Promise.resolve([] as AcSiuReferral[]),
        sibAgent
          ? list('siu_disclosures', { select: SIB_DISCLOSURE_COLS, is: { acknowledged_at: null, revoked_at: null }, order: 'released_at', ascending: false, limit: 50 })
              .then((r) => r as unknown as AcSiuDisclosure[]).catch(() => [] as AcSiuDisclosure[])
          : Promise.resolve([] as AcSiuDisclosure[]),
        // Phase 7 (P7-01/03): my queue state + the live escalation ledger.
        fetchStates(),
        fetchEscalations(),
        // Phase 7 (P7-02) sources — every one bounded, projected, gated on the
        // standing that can act, and fail-open to empty.
        isCommand
          ? list('restricted_access_log', { select: RESTRICTED_LOG_COLS, eq: { action: 'packet_export' }, or: `created_at.gte.${hourAgo}`, order: 'created_at', ascending: false, limit: 50 })
              .then((r) => r as unknown as AcRestrictedExport[]).catch(() => [] as AcRestrictedExport[])
          : Promise.resolve([] as AcRestrictedExport[]),
        // Command approves every proposal; anyone else only ever sees their
        // own waiting ones — so the fetch is narrowed to match the contract
        // rather than pulling the whole proposed set for every editor.
        isCommand
          ? list('mdt_exports', { select: MDT_COLS, eq: { status: 'proposed' }, order: 'proposed_at', ascending: false, limit: 100 })
              .then((r) => r as unknown as AcMdtExport[]).catch(() => [] as AcMdtExport[])
          : canEdit
            ? list('mdt_exports', { select: MDT_COLS, eq: { status: 'proposed', proposed_by: me }, order: 'proposed_at', ascending: false, limit: 100 })
                .then((r) => r as unknown as AcMdtExport[]).catch(() => [] as AcMdtExport[])
            : Promise.resolve([] as AcMdtExport[]),
        isCommand
          ? list('field_access_requests', { select: FIELD_ACCESS_COLS, eq: { status: 'pending' }, order: 'created_at', ascending: false, limit: 100 })
              .then((r) => r as unknown as AcFieldAccessRequest[]).catch(() => [] as AcFieldAccessRequest[])
          : Promise.resolve([] as AcFieldAccessRequest[]),
        canEdit
          ? list('field_submissions', {
              select: MY_SUB_COLS, eq: { assigned_to: me }, is: { deleted_at: null },
              in: { status: FIELD_OPEN }, order: 'updated_at', ascending: false, limit: 100,
            }).then((r) => r as unknown as Omit<AcMySubmission, 'counts' | 'lastOfficerMessageAt' | 'lastReviewerNoteAt'>[])
              .catch(() => [] as Omit<AcMySubmission, 'counts' | 'lastOfficerMessageAt' | 'lastReviewerNoteAt'>[])
          : Promise.resolve([] as Omit<AcMySubmission, 'counts' | 'lastOfficerMessageAt' | 'lastReviewerNoteAt'>[]),
        isCommand
          ? list('field_submissions', { select: REJECTED_COLS, eq: { status: 'rejected' }, is: { deleted_at: null }, or: `rejected_at.gte.${weekAgo}`, order: 'rejected_at', ascending: false, limit: 100 })
              .then((r) => r as unknown as AcRejectedSubmission[]).catch(() => [] as AcRejectedSubmission[])
          : Promise.resolve([] as AcRejectedSubmission[]),
        canEdit
          ? list('narcotic_suggestions', { select: NARCOTIC_COLS, in: { status: NARCOTIC_OPEN }, order: 'created_at', ascending: false, limit: 100 })
              .then((r) => r as unknown as AcNarcoticSuggestion[]).catch(() => [] as AcNarcoticSuggestion[])
          : Promise.resolve([] as AcNarcoticSuggestion[]),
        canEdit
          ? list('gang_members', { select: GANG_MEMBER_COLS, is: { reviewed_at: null, deleted_at: null }, order: 'updated_at', ascending: false, limit: 300 })
              .then((r) => r as unknown as AcGangMember[]).catch(() => [] as AcGangMember[])
          : Promise.resolve([] as AcGangMember[]),
        canEdit
          ? list('trackers', { select: TRACKER_COLS, eq: { status: 'pending' }, order: 'created_at', ascending: false, limit: 50 })
              .then((r) => r as unknown as AcTracker[]).catch(() => [] as AcTracker[])
          : Promise.resolve([] as AcTracker[]),
        sibCommand
          ? list('siu_conflicts', { select: SIB_CONFLICT_COLS, eq: { status: 'declared' }, order: 'declared_at', ascending: false, limit: 50 })
              .then((r) => r as unknown as AcSiuConflict[]).catch(() => [] as AcSiuConflict[])
          : Promise.resolve([] as AcSiuConflict[]),
        sibAgent
          ? list('siu_watchlist', { select: SIB_WATCH_COLS, eq: { status: 'active' }, is: { removed_at: null }, order: 'expires_at', ascending: true, limit: 100 })
              .then((r) => r as unknown as AcSiuWatch[]).catch(() => [] as AcSiuWatch[])
          : Promise.resolve([] as AcSiuWatch[]),
        isOwner
          ? list('client_errors', { select: CLIENT_ERROR_COLS, or: `created_at.gte.${dayAgo}`, order: 'created_at', ascending: false, limit: 200 })
              .then((r) => r as unknown as AcClientError[]).catch(() => [] as AcClientError[])
          : Promise.resolve([] as AcClientError[]),
        canAdmin
          ? list('justice_membership_requests', { select: JUSTICE_APP_COLS, in: { status: ['pending', 'correction_requested'] }, order: 'submitted_at', ascending: false, limit: 50 })
              .then((r) => r as unknown as AcJusticeApplication[]).catch(() => [] as AcJusticeApplication[])
          : Promise.resolve([] as AcJusticeApplication[]),
        canEdit
          ? list('surveillance_alerts', { select: SURV_ALERT_COLS, eq: { status: 'open' }, order: 'created_at', ascending: false, limit: 100 })
              .then((r) => r as unknown as AcSurvAlert[]).catch(() => [] as AcSurvAlert[])
          : Promise.resolve([] as AcSurvAlert[]),
        list('legal_request_comments', { select: LEGAL_COMMENT_COLS, is: { deleted_at: null }, or: `created_at.gte.${weekAgo}`, order: 'created_at', ascending: false, limit: 100 })
          .then((r) => r as unknown as AcLegalComment[]).catch(() => [] as AcLegalComment[]),
        canEdit
          ? list('reports', { select: REPORT_COLS, eq: { review_status: 'submitted' }, order: 'submitted_at', ascending: false, limit: 100 })
              .then((r) => r as unknown as AcReport[]).catch(() => [] as AcReport[])
          : Promise.resolve([] as AcReport[]),
      ])
      // A failed state read keeps whatever hides were known (L4) — never a
      // silent un-snooze of everything on a blip.
      const states = statesRead ?? get().states

      // Second round — reads that depend on the first: my submissions' claim
      // counts + thread timestamps, and the gang names behind any clusters.
      const myIds = mySubRows.map((r) => r.id)
      const dupGangIds = [...new Set(clusterDuplicates(gangMembers).flatMap((c) => c.members.map((m) => m.gang_id)))]
      const [countRows, msgRows, noteRows, gangRows] = await Promise.all([
        myIds.length
          ? rpc('field_submission_counts', {}).then((r) => (Array.isArray(r.data) ? r.data : []) as { submission_id: string; claims: number; decided: number; validated: boolean }[]).catch(() => [])
          : Promise.resolve([] as { submission_id: string; claims: number; decided: number; validated: boolean }[]),
        myIds.length
          ? list('field_submission_messages', { select: 'submission_id,from_reviewer,created_at', in: { submission_id: myIds }, eq: { from_reviewer: false }, order: 'created_at', ascending: false, limit: 200 })
              .then((r) => r as unknown as { submission_id: string; created_at: string }[]).catch(() => [])
          : Promise.resolve([] as { submission_id: string; created_at: string }[]),
        myIds.length
          ? list('field_submission_reviews', { select: 'submission_id,created_at', in: { submission_id: myIds }, order: 'created_at', ascending: false, limit: 200 })
              .then((r) => r as unknown as { submission_id: string; created_at: string }[]).catch(() => [])
          : Promise.resolve([] as { submission_id: string; created_at: string }[]),
        dupGangIds.length
          ? list('gangs', { select: 'id,name', in: { id: dupGangIds.slice(0, 100) } })
              .then((r) => r as unknown as { id: string; name: string | null }[]).catch(() => [])
          : Promise.resolve([] as { id: string; name: string | null }[]),
      ])
      const countsById = new Map(countRows.map((c) => [c.submission_id, { claims: c.claims, decided: c.decided, validated: c.validated }]))
      const newest = (rows: { submission_id: string; created_at: string }[]) => {
        const m = new Map<string, string>()
        for (const r of rows) if (!m.has(r.submission_id) || m.get(r.submission_id)! < r.created_at) m.set(r.submission_id, r.created_at)
        return m
      }
      const lastMsg = newest(msgRows)
      const lastNote = newest(noteRows)
      const mySubmissions: AcMySubmission[] = mySubRows.map((r) => ({
        ...r,
        counts: countsById.get(r.id) ?? null,
        lastOfficerMessageAt: lastMsg.get(r.id) ?? null,
        lastReviewerNoteAt: lastNote.get(r.id) ?? null,
      }))
      const gangNames: Record<string, string> = {}
      for (const g of gangRows) if (g.name) gangNames[g.id] = g.name

      // Command/owner: the shared awaitingCount (submitted + actionable
      // sign-ins + ghosts) — the same number as the badge, tile and queue.
      const membershipPending = canAdmin
        ? pendingMembership(
            useProfilesStore.getState().profiles,
            membershipRequests,
            useJusticeRoster.getState().byUser,
            justiceRequests,
            // Field Intelligence submitters are inactive on purpose and have
            // applied for nothing -- excluded, or the Action Center nags
            // command about work that does not exist.
            useFieldStanding.getState().loaded ? useFieldStanding.getState().ids : null,
          ).awaitingCount
        : null
      // Library governance facts, pre-derived through docModel so the pure
      // builder stays free of component imports (AcDoc contract).
      const myAcks: MyAckVersions = {}
      for (const a of docAcks as Array<{ document_id: string; documents_versions: { version_number: number | null } | null }>) {
        const v = a.documents_versions?.version_number
        if (typeof v === 'number') (myAcks[a.document_id] ??= []).push(v)
      }
      const viewer = { userId: me, active: !!profile.active, role: profile.role, isCommand, isOwner, justiceRole }
      const documents: AcDoc[] = docRows.flatMap((d) => {
        const ack = ackState(d, myAcks)
        const item: AcDoc = {
          id: d.id, title: docTitle(d.name), status: d.status,
          ackPending: ack === 'pending' || ack === 'reack_needed',
          ackDeadline: d.acknowledgement_deadline,
          reviewDue: d.owner_user_id === me ? reviewState(d, nowMs) : null,
          reviewDueAt: d.review_due_at,
          awaitingMyApproval: d.status === 'in_review' && canApproveDoc(viewer, d),
          syncConflict: d.sync_status === 'conflict' && (isCommand || isOwner),
          createdAt: d.created_at, updatedAt: d.updated_at,
        }
        return item.ackPending || item.reviewDue || item.awaitingMyApproval || item.syncConflict ? [item] : []
      })
      // Document suggestions: RLS guarantees a visible non-self row is one the
      // viewer can manage, so canManage mirrors !mine (the builder re-gates by
      // status, and the server RPCs are the real authority).
      const suggestions: AcSuggestion[] = suggestionRows.map((r) => ({
        id: r.id, title: r.title, status: r.status, documentId: r.document_id,
        mine: r.created_by === me, canManage: r.created_by !== me, assignedToMe: r.assigned_editor === me,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }))
      const sources: ActionSources = {
        me,
        role: profile.role,
        division: profile.division,
        isCommand,
        isOwner,
        todayISO: todayISO(),
        nowMs,
        profileName: (id) => officerName(id) || 'Officer',
        cases,
        tasks,
        transfers,
        accessRequests,
        membershipPending,
        legal,
        legalViewer: buildLegalViewer(auth, null, undefined, ctx.sibIsCommand),
        justiceRole: ctx.dojRole,
        memberTransfers,
        caseGrants,
        blockers,
        holds,
        restrictedGrants,
        observations: survObservations,
        survTargets: survTargetRows,
        myDrafts,
        fieldSubmissions,
        boloPersons,
        canManageBolos: canEdit,
        sibStanding: sibAgent || sibCommand ? { isAgent: sibAgent, isCommand: sibCommand } : null,
        sibAccessRequests,
        sibReferrals,
        sibDisclosures,
        notifications,
        documents,
        suggestions,
        // Phase 7
        canEdit,
        restrictedExports, mdtExports, fieldAccessRequests, mySubmissions, rejectedSubmissions,
        narcoticSuggestions, gangMembers, gangNames, trackers, sibConflicts, sibWatchlist,
        clientErrors, justiceApplications, survAlerts, legalComments, reports,
        escalations,
        states,
      }
      const built = buildActionItems(sources)
      const escMap: Record<string, string> = {}
      for (const it of built.items) if (it.escalatedAt) escMap[it.dedupeKey] = it.escalatedAt
      set({ built, states, escalations: escMap, error: null, lastRefreshed: nowMs, loading: false })
    } catch (e) {
      set({ error: e, loading: false }) // keep the previous items rendered — retry re-clears
    } finally {
      set({ refreshing: false })
    }
  },

  /** Re-read the state table alone (after a snooze / dismiss) — the whole
   *  source fan-out is not re-run for a one-row change. A failed read keeps
   *  the previous (optimistically updated) states rather than wiping them. */
  async refreshStates() {
    const next = await fetchStates()
    if (next) set({ states: next })
  },

  async setState(keys, op, until) {
    const list0 = (Array.isArray(keys) ? keys : [keys]).filter(Boolean)
    if (!list0.length) return { applied: 0, skipped: [] }
    // Optimistic: the row hides (or returns) immediately; the RPC answer and
    // the state re-read settle the truth (a decision key's dismiss comes back
    // in `skipped` and the re-read restores it).
    const nowIso = new Date().toISOString()
    const prev = get().states
    const next: Record<string, ActionItemState> = { ...prev }
    for (const k of list0) {
      const cur = next[k] ?? { seenAt: null, snoozedUntil: null, dismissedAt: null }
      next[k] = op === 'seen' ? { ...cur, seenAt: nowIso }
        : op === 'snooze' ? { ...cur, snoozedUntil: until ?? null }
          : op === 'unsnooze' ? { ...cur, snoozedUntil: null }
            : op === 'dismiss' ? { ...cur, dismissedAt: nowIso }
              : { ...cur, dismissedAt: null }
    }
    set({ states: next })
    const res = await setActionState(list0, op, until)
    if (isDbError(res)) set({ states: prev })
    void get().refreshStates()
    return res
  },
}))

const EMPTY_ITEMS: ActionItem[] = []

export function useActionQueue(): ActionQueue {
  const auth = useAuth()
  const siu = useSiu()
  const permissions = usePermissions()
  const { profile, state, isCommand, isOwner, justiceRole, canEdit } = auth
  const built = useActionQueueStore((s) => s.built)
  const states = useActionQueueStore((s) => s.states)
  const escalations = useActionQueueStore((s) => s.escalations)
  const loading = useActionQueueStore((s) => s.loading)
  const refreshing = useActionQueueStore((s) => s.refreshing)
  const error = useActionQueueStore((s) => s.error)
  const lastRefreshed = useActionQueueStore((s) => s.lastRefreshed)
  const setState = useActionQueueStore((s) => s.setState)

  const vCases = useTableVersion('cases')
  const vTasks = useTableVersion('case_tasks')
  const vTransfers = useTableVersion('transfer_requests')
  const vAccess = useTableVersion('case_access_requests')
  const vNotifs = useTableVersion('notifications')
  const vBlockers = useTableVersion('case_blockers')
  const vLegal = useTableVersion('legal_requests')
  const vProfiles = useTableVersion('profiles')
  const vMembership = useTableVersion('membership_requests')
  const vJusticeReqs = useTableVersion('justice_membership_requests')
  const vDocuments = useTableVersion('documents')
  const vSuggestions = useTableVersion('document_suggestions')
  const vHolds = useTableVersion('legal_holds')
  const vJusticeMemberships = useTableVersion('justice_memberships')
  const vMemberTransfers = useTableVersion('member_transfers')
  const vGrants = useTableVersion('restricted_access_grants')
  const vSurvObs = useTableVersion('surveillance_observations')
  const vSurvTgt = useTableVersion('surveillance_targets')
  const vDrafts = useTableVersion('user_drafts')
  const vPersons = useTableVersion('persons')
  // field_submissions itself is NOT in the realtime publication (its rows
  // carry the report text). The shadow table field_submission_events (P6-06)
  // is: status / assignee / SIB state and nothing else, RLS-filtered to what
  // the viewer could read — so the intel lanes refresh on a claim, a decision
  // or a new send without the summary ever crossing the wire.
  const vFieldSubs = useTableVersion('field_submission_events')
  // Phase 7 — the state table + the ledger (published, ids only) and the new
  // published sources. mdt_exports / field_access_requests / siu_* /
  // restricted_access_log are NOT published (see the projection comment).
  const vState = useTableVersion('action_item_state')
  const vEscalations = useTableVersion('action_escalations')
  const vGangMembers = useTableVersion('gang_members')
  const vTrackers = useTableVersion('trackers')
  const vNarcotics = useTableVersion('narcotic_suggestions')
  const vClientErrors = useTableVersion('client_errors')
  const vSurvAlerts = useTableVersion('surveillance_alerts')
  const vLegalComments = useTableVersion('legal_request_comments')
  const vReports = useTableVersion('reports')

  // SIB gates — the same capability signals the SIB workspace itself reads
  // (useSiu). While the SIU context is still resolving these are false, so
  // a non-SIB (or not-yet-known) viewer issues NO siu_* query at all; the
  // context settling changes the key and the effect catches up.
  const sibAgent = siu.canAccess && siu.isAgent
  const sibCommand = siu.canAccess && siu.isCommand
  const dojRole = permissions.perms.doj_role
  const versionKey = [
    vCases, vTasks, vTransfers, vAccess, vNotifs, vBlockers, vLegal, vProfiles, vMembership, vJusticeReqs,
    vDocuments, vSuggestions, vHolds, vJusticeMemberships, vMemberTransfers, vGrants, vSurvObs, vSurvTgt,
    vDrafts, vPersons, vFieldSubs, vState, vEscalations, vGangMembers, vTrackers, vNarcotics, vClientErrors,
    vSurvAlerts, vLegalComments, vReports,
  ].join('.')
  const ctxKey = `${profile?.id ?? ''}|${profile?.role ?? ''}|${isCommand}|${isOwner}|${canEdit}|${justiceRole ?? ''}|${sibAgent}|${sibCommand}|${siu.isCommand}|${dojRole ?? ''}`
  const loadKey = `${ctxKey}#${versionKey}`

  const run = useCallback((force: boolean) => {
    if (state !== 'in' || !profile) return Promise.resolve()
    return useActionQueueStore.getState().load(loadKey, { auth, sibAgent, sibCommand, sibIsCommand: siu.isCommand, dojRole }, force)
  }, [state, profile, loadKey, auth, sibAgent, sibCommand, siu.isCommand, dojRole])

  const refresh = useCallback(() => run(true), [run])

  useEffect(() => {
    // A version-driven refetch fans out ~40 queries — pointless while the tab
    // is hidden. Skip it and run ONE catch-up refetch when the tab returns to
    // visible (the effect re-arms per key, so `missed` covers this cycle).
    let missed = false
    const id = window.setTimeout(() => {
      if (document.visibilityState === 'hidden') { missed = true; return }
      void run(false)
    }, 0)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && missed) { missed = false; void run(false) }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [run])

  // Per-viewer state overlay + lanes. The overlay keeps `item.state` current
  // after a snooze / dismiss without rebuilding the queue; the hidden test is
  // evaluated against the last fetch's clock (render stays pure — no
  // Date.now()). A snooze that lapses surfaces on the next refresh: the
  // realtime bump on the state row never fires for the clock, so the
  // visibility catch-up / next bump covers it. No fetch yet → no items.
  const nowMs = lastRefreshed ?? 0
  const lanes = useMemo(() => {
    const all = (built?.items ?? EMPTY_ITEMS).map((it) => ({ ...it, state: states[it.dedupeKey] ?? null }))
    const items: ActionItem[] = [], snoozed: ActionItem[] = [], dismissed: ActionItem[] = []
    for (const it of all) {
      const hidden = isHidden(it.state, nowMs)
      if (hidden === 'snoozed') snoozed.push(it)
      else if (hidden === 'dismissed') dismissed.push(it)
      else items.push(it)
    }
    return { all, items, snoozed, dismissed }
  }, [built, states, nowMs])

  const counts = useMemo(() => countQueue(lanes.items), [lanes.items])
  const signedOut = state !== 'in' || !profile

  return {
    items: signedOut ? EMPTY_ITEMS : lanes.items,
    allItems: signedOut ? EMPTY_ITEMS : lanes.all,
    snoozed: signedOut ? EMPTY_ITEMS : lanes.snoozed,
    dismissed: signedOut ? EMPTY_ITEMS : lanes.dismissed,
    states,
    escalations,
    suppressedCount: built?.suppressedCount ?? 0,
    loading: signedOut ? false : loading && built === null && error === null,
    refreshing,
    error,
    lastRefreshed,
    refresh,
    setState,
    counts,
  }
}
