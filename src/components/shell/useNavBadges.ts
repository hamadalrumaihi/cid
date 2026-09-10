'use client'

/** Nav badge counts for the shell (Sidebar, Subtabs, BottomNav):
 *   · pending       — members awaiting approval (command/owner only)
 *   · announcements — audience-visible announcements newer than the `annSeen`
 *                     Store stamp (AnnounceView writes it on entry)
 *   · signoff       — sign-off reviews + returned cases awaiting the viewer
 *   · inbox         — the sum of the three: the Action Center's chip
 *   · trash         — deleted rows the viewer may restore (trash_count)
 *
 *  Phase 7 (P7-06, AC7): `pending` and `signoff` come from the ONE Action
 *  Center queue (useActionQueue().counts) — this hook runs no case / mention /
 *  justice fetches of its own, so the badge, the dashboard slices and the
 *  queue can never disagree. Announcements keep their own slim store: they
 *  are not queue items. Phase 8 added `trash` — `trash_count()` via
 *  lib/trash's store (fetched on mount; `bumpTrash()` after a delete /
 *  restore) — shown on the Trash leaf, only when > 0. The store is
 *  module-level (lib/watchlist / lib/profiles pattern) because the hook mounts
 *  several times (Sidebar + Subtabs + BottomNav); the version key makes one
 *  realtime bump one fetch however many mount. */
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { Store } from '@/lib/store'
import { useTrashCountStore } from '@/lib/trash'
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
  /** Sum for the Action Center (inbox) chip — the Command category button on
   *  the collapsed rail / BottomNav and the Action Center sub-tab. */
  inbox: number
  /** Deleted rows the viewer may restore (trash_count). */
  trash: number
}

export { bumpTrash } from '@/lib/trash'

export function useNavBadges(): NavBadges {
  const { state, profile, isCommand, isOwner } = useAuth()
  const { counts } = useActionQueue()
  const anns = useNavBadgeStore((s) => s.anns)
  const vAnn = useTableVersion('announcements')
  const trash = useTrashCountStore((s) => s.count)
  const trashFetched = useTrashCountStore((s) => s.fetched)

  // Deferred so no fetch starts during render; the store's version key makes
  // the fetch once-per-bump however many shell surfaces mount this hook.
  useEffect(() => {
    if (state !== 'in') return
    const t = window.setTimeout(() => { void useNavBadgeStore.getState().fetchAnns(vAnn) }, 0)
    return () => window.clearTimeout(t)
  }, [state, vAnn])
  // The Trash count is read once per session (no realtime — 27 tables would
  // be too broad a subscription); deletes and restores bump it explicitly.
  useEffect(() => {
    if (state !== 'in' || trashFetched) return
    const t = window.setTimeout(() => { void useTrashCountStore.getState().refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [state, trashFetched])

  return useMemo<NavBadges>(() => {
    if (state !== 'in' || !profile) return { pending: 0, announcements: 0, signoff: 0, inbox: 0, trash: 0 }
    // The queue's membership item exists only for command / owner sessions
    // (the model gates it); rank-and-file keep a 0 badge.
    const pending = (isCommand || isOwner) ? counts.membership : 0
    const seen = Store.get<string>('annSeen', '')
    const announcements = visibleAnnouncements(anns, profile.division, new Set<string>(), true).filter((a) => a.created_at > seen).length
    const signoff = counts.signoff
    return { pending, announcements, signoff, inbox: pending + announcements + signoff, trash }
  }, [state, profile, isCommand, isOwner, counts.membership, counts.signoff, anns, trash])
}
