'use client'

/** Nav badge counts — port of the three vanilla nav badges that sit on the
 *  Command category button (index.html #pending/#ann/#signoff-nav-badge):
 *   · pending  — members awaiting approval (command/owner only), via the shared
 *                pendingMembership model in profiles-only mode (see the memo)
 *   · ann      — audience-visible announcements newer than the `annSeen` Store
 *                stamp (AnnounceView writes it on entry)
 *   · signoff  — My Desk needs-attention count (sign-off reviews + bounced +
 *                unread mentions + my overdue/follow-up cases), vanilla
 *                inboxActionCount
 *  All inputs are RLS-scoped; realtime bumps keep the counts live.
 *
 *  DATA LAYER: a module-level zustand store (same pattern as lib/watchlist /
 *  lib/profiles). The hook is mounted TWICE (Sidebar + BottomNav); before the
 *  store, that doubled every fetch. Each fetch is keyed on the realtime table
 *  version it serves, so however many consumers mount, one version bump means
 *  one fetch. Unread mentions come from countRows (HEAD count) — the list of
 *  notification rows was fetched only to be counted. */
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { countRows, list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { todayISO } from '@/lib/format'
import { useProfilesStore } from '@/lib/profiles'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { useFieldStanding } from '@/lib/fieldStanding'
import { useTableVersion } from '@/lib/realtime'
import { Store } from '@/lib/store'
import { visibleAnnouncements, type AnnouncementRow } from '@/components/announce/announceUtils'
import { isStaleCase } from '@/components/cases/caseUtils'
import { pendingMembership, type JusticeRequestLite } from '@/components/command-center/lib/membershipPending'

type CaseRow = Tables<'cases'>

const AWAITING = new Set(['awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director'])

function canReviewCase(c: CaseRow, profile: { id: string; role?: string | null; division?: string | null } | null): boolean {
  if (!profile) return false
  if (c.signoff_status === 'approved_deputy') return c.signoff_assignee_id === profile.id || profile.role === 'deputy_director'
  if (!AWAITING.has(c.signoff_status ?? '')) return false
  if (c.signoff_assignee_id === profile.id) return true
  if (c.signoff_status === 'awaiting_bureau_lead') return profile.role === 'bureau_lead' && c.bureau === profile.division
  if (c.signoff_status === 'awaiting_deputy') return profile.role === 'deputy_director'
  if (c.signoff_status === 'awaiting_director') return profile.role === 'director'
  return false
}

interface NavBadgeData {
  anns: AnnouncementRow[]
  cases: CaseRow[]
  /** Unread chat_mention + mention notifications (counts only — countRows). */
  mentions: number
  /** Open DOJ/Judiciary applications (command/owner read). null = not
   *  loaded/authorized — keeps the badge from counting justice applicants as
   *  CID sign-ins. */
  justiceReqs: JusticeRequestLite[] | null
  // Version keys — one fetch per realtime bump, shared by every consumer.
  annV: number
  caseV: number
  notifV: number
  justiceV: number
  rosterKey: string
  fetchAnns: (v: number) => Promise<void>
  fetchCases: (v: number) => Promise<void>
  fetchMentions: (v: number) => Promise<void>
  fetchJusticeReqs: (v: number) => Promise<void>
  /** Shared-store refreshes (profiles / field standing / justice roster),
   *  deduped on the composite key so twin consumers trigger one round. */
  fetchRoster: (key: string, wantJustice: boolean) => Promise<void>
}

const useNavBadgeStore = create<NavBadgeData>((set, get) => ({
  anns: [],
  cases: [],
  mentions: 0,
  justiceReqs: null,
  annV: -1,
  caseV: -1,
  notifV: -1,
  justiceV: -1,
  rosterKey: '',
  async fetchAnns(v) {
    if (get().annV === v) return
    set({ annV: v })
    // Projection: never announcement bodies — only what the memo reads.
    try { set({ anns: await list('announcements', { select: 'id,author_id,audience,mentions,pinned,created_at', order: 'created_at', ascending: false }) }) }
    catch { /* transient — keep the previous rows */ }
  },
  async fetchCases(v) {
    if (get().caseV === v) return
    set({ caseV: v })
    // Minimal projection — workflow columns only, never notes/summaries.
    try { set({ cases: await list('cases', { select: 'id,status,bureau,lead_detective_id,follow_up_at,updated_at,signoff_status,signoff_assignee_id,signoff_submitted_by' }) }) }
    catch { /* transient */ }
  },
  async fetchMentions(v) {
    if (get().notifV === v) return
    set({ notifV: v })
    try {
      const [chat, plain] = await Promise.all([
        countRows('notifications', { eq: { read: false, type: 'chat_mention' } }),
        countRows('notifications', { eq: { read: false, type: 'mention' } }),
      ])
      set({ mentions: chat + plain })
    } catch { /* transient */ }
  },
  async fetchJusticeReqs(v) {
    if (get().justiceV === v) return
    set({ justiceV: v })
    try {
      const rows = await list('justice_membership_requests', {
        select: 'applicant_id,status',
        in: { status: ['draft', 'pending', 'correction_requested'] },
      })
      set({ justiceReqs: rows as JusticeRequestLite[] })
    } catch { /* transient */ }
  },
  async fetchRoster(key, wantJustice) {
    if (get().rosterKey === key) return
    set({ rosterKey: key })
    void useProfilesStore.getState().fetch()
    void useFieldStanding.getState().fetch()
    if (wantJustice) void useJusticeRoster.getState().fetch()
  },
}))

export interface NavBadges {
  pending: number
  announcements: number
  signoff: number
  /** Sum for the collapsed/mobile Command chip. */
  command: number
}

export function useNavBadges(): NavBadges {
  const { state, profile, isCommand, isOwner } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const justiceByUser = useJusticeRoster((s) => s.byUser)
  const fieldIds = useFieldStanding((s) => s.ids)
  const fieldLoaded = useFieldStanding((s) => s.loaded)
  const anns = useNavBadgeStore((s) => s.anns)
  const cases = useNavBadgeStore((s) => s.cases)
  const mentions = useNavBadgeStore((s) => s.mentions)
  const justiceReqs = useNavBadgeStore((s) => s.justiceReqs)
  const vAnn = useTableVersion('announcements')
  const vCases = useTableVersion('cases')
  const vNotifs = useTableVersion('notifications')
  const vProfiles = useTableVersion('profiles')
  const vJustice = useTableVersion('justice_memberships')
  const vJusticeReqs = useTableVersion('justice_membership_requests')

  // One effect per input so a realtime bump on one table refetches ONLY that
  // table; the store's version keys make the fetch once-per-bump however many
  // shell surfaces mount this hook. Deferred so no fetch starts during render.
  useEffect(() => {
    if (state !== 'in') return
    const t = window.setTimeout(() => { void useNavBadgeStore.getState().fetchAnns(vAnn) }, 0)
    return () => window.clearTimeout(t)
  }, [state, vAnn])

  useEffect(() => {
    if (state !== 'in') return
    const t = window.setTimeout(() => { void useNavBadgeStore.getState().fetchCases(vCases) }, 0)
    return () => window.clearTimeout(t)
  }, [state, vCases])

  useEffect(() => {
    if (state !== 'in') return
    const t = window.setTimeout(() => { void useNavBadgeStore.getState().fetchMentions(vNotifs) }, 0)
    return () => window.clearTimeout(t)
  }, [state, vNotifs])

  useEffect(() => {
    if (state !== 'in') return
    const key = `${vProfiles}|${vJustice}|${isCommand || isOwner}`
    const t = window.setTimeout(() => { void useNavBadgeStore.getState().fetchRoster(key, isCommand || isOwner) }, 0)
    return () => window.clearTimeout(t)
  }, [state, isCommand, isOwner, vProfiles, vJustice])

  useEffect(() => {
    if (state !== 'in' || !(isCommand || isOwner)) return
    const t = window.setTimeout(() => { void useNavBadgeStore.getState().fetchJusticeReqs(vJusticeReqs) }, 0)
    return () => window.clearTimeout(t)
  }, [state, isCommand, isOwner, vJusticeReqs])

  return useMemo<NavBadges>(() => {
    if (state !== 'in' || !profile) return { pending: 0, announcements: 0, signoff: 0, command: 0 }

    // Shared membership model with requests = null: this hook runs for EVERY
    // signed-in member, and `admin_membership_requests` is command/owner-only,
    // so the badge stays on the profiles-derived count (submitted requests and
    // plain sign-ins are indistinguishable here — both are inactive, so the
    // total is right). Ghost requests (already-active applicants) need the
    // requests fetch and therefore surface only in the Approval Queue, the
    // Overview tile and the Action Center. Rank-and-file keep a 0 badge.
    const pending = (isCommand || isOwner)
      ? pendingMembership(profiles, null, justiceByUser, justiceReqs,
          fieldLoaded ? fieldIds : null).awaitingCount
      : 0

    const seen = Store.get<string>('annSeen', '')
    const announcements = visibleAnnouncements(anns, profile.division, new Set<string>(), true).filter((a) => a.created_at > seen).length

    const review = cases.filter((c) => canReviewCase(c, profile))
    const bounced = cases.filter((c) => c.signoff_submitted_by === profile.id && (c.signoff_status === 'changes_requested' || c.signoff_status === 'denied'))
    const inSignoff = new Set([...review, ...bounced].map((c) => c.id))
    const today = todayISO()
    const mine = cases.filter((c) => c.lead_detective_id === profile.id && c.status !== 'closed' && c.status !== 'cold')
    const overdue = mine.filter((c) => isStaleCase(c) && !inSignoff.has(c.id)).length
    const followUps = mine.filter((c) => c.follow_up_at && c.follow_up_at <= today).length
    const signoff = review.length + bounced.length + mentions + overdue + followUps

    return { pending, announcements, signoff, command: pending + announcements + signoff }
  }, [state, profile, isCommand, isOwner, profiles, justiceByUser, justiceReqs,
      fieldIds, fieldLoaded, anns, cases, mentions])
}
