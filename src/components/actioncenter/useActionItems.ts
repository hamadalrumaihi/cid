'use client'

/** Data layer for the Action Center — slim, projected fetches for every
 *  source the prioritized queue reads, folded through the pure
 *  buildActionItems model (lib/actionItems). Stale-while-revalidate: the
 *  previous items stay on screen while a realtime-triggered refresh is in
 *  flight, so the queue never flashes empty. */
import { useCallback, useEffect, useState } from 'react'
import { buildActionItems, type AcDoc, type AcSuggestion, type ActionItem, type ActionSources } from '@/lib/actionItems'
import {
  ackState, canApproveDoc, docTitle, reviewState,
  type MyAckVersions, type ShelfDoc,
} from '@/components/sops/docModel'
import { list, rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { todayISO } from '@/lib/format'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { pendingMembership, type JusticeRequestLite } from '@/components/command-center/lib/membershipPending'

/* Column projections — each mirrors its Ac* Pick in lib/actionItems exactly
 * (the model documents that the loader builds selects from those lists).
 * Cases never fetch notes/charges; legal never fetches form_data/narrative. */
const CASE_COLS =
  'id,case_number,title,status,bureau,lead_detective_id,created_by,follow_up_at,signoff_status,signoff_stage,signoff_assignee_id,signoff_submitted_by,signoff_submitted_at,created_at,updated_at'
const TASK_COLS = 'id,case_id,title,due,done,assignee,created_at,updated_at'
const TRANSFER_COLS = 'id,status,target_id,requested_by,from_bureau,to_bureau,reason,created_at,updated_at'
const ACCESS_COLS = 'id,case_id,requester_id,requester_name,reason,status,created_at'
const LEGAL_COLS =
  'id,case_id,case_number_snapshot,request_number,request_type,review_status,fulfilment_status,created_by,responsible_bureau,response_deadline,expires_at,created_at,updated_at'
const BLOCKER_COLS = 'id,case_id,title,type,status,owner_id,review_at,created_at,updated_at'
const NOTIF_COLS = 'id,user_id,type,payload,read,created_at'
/** Library governance projection — never full bodies (docModel AcDoc inputs). */
const DOC_COLS =
  'id,name,folder,kind,status,category,classification,owner_user_id,mandatory,'
  + 'acknowledgement_required,acknowledgement_deadline,review_due_at,sync_status,'
  + 'current_version_number,created_at,updated_at'
/** Document-suggestion projection — RLS already scopes visibility to the
 *  submitter and the managers, so no body/thread columns are ever fetched. */
const SUGGESTION_COLS = 'id,title,status,document_id,created_by,assigned_editor,created_at,updated_at'

const TRANSFER_PENDING = ['pending_source', 'pending_target']

/** Only open-work statuses can produce an action item (see buildActionItems
 *  §9c); terminal/waiting rows never need a fetch-side row. */
const SUGGESTION_OPEN = ['submitted', 'needs_more_information', 'accepted', 'partially_accepted']

interface SuggestionRow {
  id: string; title: string; status: string; document_id: string | null
  created_by: string; assigned_editor: string | null; created_at: string; updated_at: string
}

export interface ActionItemsResult {
  items: ActionItem[]
  suppressedCount: number
  /** True until the first successful build (or first error). */
  loading: boolean
  /** A refetch is in flight while previous items stay rendered. */
  refreshing: boolean
  error: unknown
  refresh: () => Promise<void>
  /** Timestamp captured in the fetch handler (never during render). */
  lastRefreshed: number | null
}

export function useActionItems(): ActionItemsResult {
  const { profile, state, isCommand, isOwner, justiceRole } = useAuth()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [built, setBuilt] = useState<{ items: ActionItem[]; suppressedCount: number } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null)

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

  const refresh = useCallback(async () => {
    if (state !== 'in' || !profile) return
    setRefreshing(true)
    const canAdmin = isCommand || isOwner
    // Item titles bake officer names in (buildActionItems takes the resolver),
    // so the first build waits for the roster; later refreshes revalidate it
    // in the background. The membership count folds the roster + requests +
    // justice identities through the shared pendingMembership model.
    if (!useProfilesStore.getState().loaded) await fetchProfiles()
    else void fetchProfiles()
    if (canAdmin) {
      if (!useJusticeRoster.getState().loaded) await useJusticeRoster.getState().fetch()
      else void useJusticeRoster.getState().fetch()
    }
    try {
      const me = profile.id
      const [cases, tasks, transfers, accessRequests, legal, blockers, notifications, membershipRequests, justiceRequests, docRows, docAcks, suggestionRows] =
        await Promise.all([
          list('cases', { select: CASE_COLS }),
          list('case_tasks', { select: TASK_COLS, eq: { assignee: me, done: false } }),
          list('transfer_requests', { select: TRANSFER_COLS, in: { status: TRANSFER_PENDING } }),
          list('case_access_requests', { select: ACCESS_COLS, eq: { status: 'pending' } }),
          // Fail-closed: legal is RLS-sealed for some viewers — a denied read
          // contributes nothing and must never sink the whole page.
          list('legal_requests', { select: LEGAL_COLS }).catch(() => []),
          list('case_blockers', { select: BLOCKER_COLS, eq: { owner_id: me, status: 'open' } }),
          list('notifications', {
            select: NOTIF_COLS,
            eq: { user_id: me, read: false },
            order: 'created_at',
            ascending: false,
            limit: 50,
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
                select: 'applicant_id,status',
                in: { status: ['draft', 'pending', 'correction_requested'] },
              }).then((rows) => rows as JusticeRequestLite[]).catch(() => null)
            : Promise.resolve(null),
          // Library governance: narrow RLS-scoped projection + my own acks —
          // both fail-open to empty (the queue never sinks on the library).
          list('documents', { select: DOC_COLS }).then((r) => r as unknown as ShelfDoc[]).catch(() => [] as ShelfDoc[]),
          list('document_acknowledgements', {
            select: 'document_id, documents_versions(version_number)',
          }).catch(() => []),
          // Document suggestions: RLS returns the submitter's own rows plus any
          // the viewer manages — open statuses only. Fail-open to empty.
          list('document_suggestions', { select: SUGGESTION_COLS, in: { status: SUGGESTION_OPEN } })
            .then((r) => r as unknown as SuggestionRow[]).catch(() => [] as SuggestionRow[]),
        ])
      const nowMs = Date.now()
      // Command/owner: the shared awaitingCount (submitted + actionable
      // sign-ins + ghosts) — the same number as the badge, tile and queue.
      const membershipPending = canAdmin
        ? pendingMembership(
            useProfilesStore.getState().profiles,
            membershipRequests,
            useJusticeRoster.getState().byUser,
            justiceRequests,
          ).awaitingCount
        : null
      // Library governance facts, pre-derived through docModel so the pure
      // builder stays free of component imports (AcDoc contract).
      const myAcks: MyAckVersions = {}
      for (const a of docAcks as Array<{ document_id: string; documents_versions: { version_number: number | null } | null }>) {
        const v = a.documents_versions?.version_number
        if (typeof v === 'number') (myAcks[a.document_id] ??= []).push(v)
      }
      const viewer = {
        userId: me, active: !!profile.active, role: profile.role,
        isCommand, isOwner, justiceRole,
      }
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
        return item.ackPending || item.reviewDue || item.awaitingMyApproval || item.syncConflict
          ? [item] : []
      })
      // Document suggestions: RLS guarantees a visible non-self row is one the
      // viewer can manage, so canManage mirrors !mine (the builder re-gates by
      // status, and the server RPCs are the real authority).
      const suggestions: AcSuggestion[] = suggestionRows.map((r) => ({
        id: r.id, title: r.title, status: r.status, documentId: r.document_id,
        mine: r.created_by === me,
        canManage: r.created_by !== me,
        assignedToMe: r.assigned_editor === me,
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
        blockers,
        notifications,
        documents,
        suggestions,
      }
      setBuilt(buildActionItems(sources))
      setError(null)
      setLastRefreshed(nowMs)
    } catch (e) {
      setError(e) // keep the previous items rendered — retry re-clears
    } finally {
      setRefreshing(false)
    }
  }, [state, profile, isCommand, isOwner, justiceRole, fetchProfiles])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, vCases, vTasks, vTransfers, vAccess, vNotifs, vBlockers, vLegal, vProfiles, vMembership, vJusticeReqs, vDocuments, vSuggestions])

  return {
    items: built?.items ?? [],
    suppressedCount: built?.suppressedCount ?? 0,
    loading: built === null && error === null,
    refreshing,
    error,
    refresh,
    lastRefreshed,
  }
}
