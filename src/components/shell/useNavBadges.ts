'use client'

/** Nav badge counts — port of the three vanilla nav badges that sit on the
 *  Command category button (index.html #pending/#ann/#signoff-nav-badge):
 *   · pending  — inactive, non-removed profiles awaiting approval (command only)
 *   · ann      — audience-visible announcements newer than the `annSeen` Store
 *                stamp (AnnounceView writes it on entry)
 *   · signoff  — My Desk needs-attention count (sign-off reviews + bounced +
 *                unread mentions + my overdue/follow-up cases), vanilla
 *                inboxActionCount
 *  All inputs are RLS-scoped; realtime bumps keep the counts live. */
import { useEffect, useMemo, useState } from 'react'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { todayISO } from '@/lib/format'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { Store } from '@/lib/store'
import { visibleAnnouncements, type AnnouncementRow } from '@/components/announce/announceUtils'
import { isStaleCase } from '@/components/cases/caseUtils'

type CaseRow = Tables<'cases'>
type NotificationRow = Tables<'notifications'>

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

export interface NavBadges {
  pending: number
  announcements: number
  signoff: number
  /** Sum for the collapsed/mobile Command chip. */
  command: number
}

export function useNavBadges(): NavBadges {
  const { state, profile, isCommand } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [anns, setAnns] = useState<AnnouncementRow[]>([])
  const [cases, setCases] = useState<CaseRow[]>([])
  const [notifs, setNotifs] = useState<NotificationRow[]>([])
  const vAnn = useTableVersion('announcements')
  const vCases = useTableVersion('cases')
  const vNotifs = useTableVersion('notifications')
  const vProfiles = useTableVersion('profiles')

  useEffect(() => {
    if (state !== 'in') return
    const t = window.setTimeout(() => {
      void fetchProfiles()
      list('announcements', { order: 'created_at', ascending: false }).then(setAnns).catch(() => undefined)
      list('cases', {}).then(setCases).catch(() => undefined)
      list('notifications', { eq: { read: false } }).then(setNotifs).catch(() => undefined)
    }, 0)
    return () => window.clearTimeout(t)
  }, [state, fetchProfiles, vAnn, vCases, vNotifs, vProfiles])

  return useMemo<NavBadges>(() => {
    if (state !== 'in' || !profile) return { pending: 0, announcements: 0, signoff: 0, command: 0 }

    const pending = isCommand ? profiles.filter((p) => !p.active && !p.removed_at).length : 0

    const seen = Store.get<string>('annSeen', '')
    const announcements = visibleAnnouncements(anns, profile.division, new Set<string>(), true).filter((a) => a.created_at > seen).length

    const review = cases.filter((c) => canReviewCase(c, profile))
    const bounced = cases.filter((c) => c.signoff_submitted_by === profile.id && (c.signoff_status === 'changes_requested' || c.signoff_status === 'denied'))
    const mentions = notifs.filter((n) => !n.read && (n.type === 'chat_mention' || n.type === 'mention')).length
    const inSignoff = new Set([...review, ...bounced].map((c) => c.id))
    const today = todayISO()
    const mine = cases.filter((c) => c.lead_detective_id === profile.id && c.status !== 'closed' && c.status !== 'cold')
    const overdue = mine.filter((c) => isStaleCase(c) && !inSignoff.has(c.id)).length
    const followUps = mine.filter((c) => c.follow_up_at && c.follow_up_at <= today).length
    const signoff = review.length + bounced.length + mentions + overdue + followUps

    return { pending, announcements, signoff, command: pending + announcements + signoff }
  }, [state, profile, isCommand, profiles, anns, cases, notifs])
}
