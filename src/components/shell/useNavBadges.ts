'use client'

/** Nav badge counts — the three vanilla nav badges on the Command category
 *  button (index.html #pending/#ann/#signoff-nav-badge):
 *   · pending  — members awaiting approval (command/owner only)
 *   · ann      — audience-visible announcements newer than the `annSeen` Store
 *                stamp (AnnounceView writes it on entry)
 *   · signoff  — My Desk needs-attention count (sign-off reviews + returned
 *                cases), vanilla inboxActionCount
 *
 *  Phase 7 (P7-06, AC7): `pending` and `signoff` come from the ONE Action
 *  Center queue (useActionQueue().counts) — this hook no longer runs its own
 *  case / mention / justice fetches, so the badge, the dashboard slices and
 *  the queue can never disagree. Announcements keep their own slim store:
 *  they are not queue items. The store is module-level (lib/watchlist /
 *  lib/profiles pattern) because the hook mounts TWICE (Sidebar + BottomNav);
 *  the version key makes one realtime bump one fetch however many mount. */
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { Store } from '@/lib/store'
import { visibleAnnouncements, type AnnouncementRow } from '@/components/announce/announceUtils'
import { useActionQueue } from '@/components/actioncenter/useActionQueue'

interface NavBadgeData {
  anns: AnnouncementRow[]
  annV: number
  fetchAnns: (v: number) => Promise<void>
}

const useNavBadgeStore = create<NavBadgeData>((set, get) => ({
  anns: [],
  annV: -1,
  async fetchAnns(v) {
    if (get().annV === v) return
    set({ annV: v })
    // Projection: never announcement bodies — only what the memo reads.
    try { set({ anns: await list('announcements', { select: 'id,author_id,audience,mentions,pinned,created_at', order: 'created_at', ascending: false }) }) }
    catch { /* transient — keep the previous rows */ }
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
  const { counts } = useActionQueue()
  const anns = useNavBadgeStore((s) => s.anns)
  const vAnn = useTableVersion('announcements')

  // Deferred so no fetch starts during render; the store's version key makes
  // the fetch once-per-bump however many shell surfaces mount this hook.
  useEffect(() => {
    if (state !== 'in') return
    const t = window.setTimeout(() => { void useNavBadgeStore.getState().fetchAnns(vAnn) }, 0)
    return () => window.clearTimeout(t)
  }, [state, vAnn])

  return useMemo<NavBadges>(() => {
    if (state !== 'in' || !profile) return { pending: 0, announcements: 0, signoff: 0, command: 0 }
    // The queue's membership item exists only for command / owner sessions
    // (the model gates it); rank-and-file keep a 0 badge.
    const pending = (isCommand || isOwner) ? counts.membership : 0
    const seen = Store.get<string>('annSeen', '')
    const announcements = visibleAnnouncements(anns, profile.division, new Set<string>(), true).filter((a) => a.created_at > seen).length
    const signoff = counts.signoff
    return { pending, announcements, signoff, command: pending + announcements + signoff }
  }, [state, profile, isCommand, isOwner, counts.membership, counts.signoff, anns])
}
