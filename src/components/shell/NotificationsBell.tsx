'use client'

/** Notification bell — the lightweight peek. Unread badge counted server-side
 *  (countRows — accurate, never capped by the list), the panel shows the last
 *  8 notifications with per-type titles from lib/notifText (never raw payload
 *  JSON): click a row to mark it read (and jump to its deep link when one
 *  exists), mark one row read in place, mark ALL read in one conditional
 *  update, or **View All** — the Activity lane of the Action Center
 *  (`/inbox?lane=activity`), where the full history lives. Muted optional
 *  streams (the Profile's notification settings, lib/notifications) stay
 *  hidden and uncounted here, never deleted. RLS scopes rows to the signed-in
 *  user; realtime bumps the `notifications` table version so new arrivals
 *  appear without a reload. Phase 7 (P7-07): the visible rows are hydrated
 *  through notification_resolve — a subject the viewer can no longer read
 *  renders "An item you no longer have access to" with its deep link
 *  suppressed (no dead ends, no leaks). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { list } from '@/lib/db'
import { loadMutedTypes, markAllRead, markRead, resolveNotifications, unreadCount, type NotifSubject } from '@/lib/notifications'
import { useAuth } from '@/lib/auth'
import { notifDetail, notifHref, notifSub, notifTitle, type NotificationRow } from '@/lib/notifText'
import { useTableVersion } from '@/lib/realtime'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { useToolNav } from '@/components/tools/useToolNav'
import { BellIcon } from './icons'

/** Rows the panel shows — the bell is a peek, the Action Center is the list. */
const PEEK_LIMIT = 8
export const VIEW_ALL_HREF = '/inbox?lane=activity'

/** Human label for the row's call-to-action, by destination. */
function ctaLabel(href: string): string {
  if (href.startsWith('/cases')) return 'View case'
  if (href.startsWith('/legal')) return 'View legal request'
  if (href.startsWith('/command-center')) return 'Open Command Center'
  if (href.startsWith('/inbox')) return 'Open Action Center'
  if (href.startsWith('/dashboard')) return 'Open My Dashboard'
  if (href.startsWith('/announce')) return 'View announcement'
  if (href.startsWith('/owner')) return 'Open Owner Console'
  if (href.startsWith('/profile')) return 'View your profile'
  if (href.startsWith('/guide')) return 'Open the field guide'
  if (href.startsWith('/informants')) return 'Open source record'
  if (href.startsWith('/tools?tool=field-review')) return 'Open the record'
  return 'Open'
}

export function NotificationsBell() {
  const { state, isCommand } = useAuth()
  // Workspace-aware push: tool hrefs land as Investigative Tools tabs, every
  // other href behaves exactly like router.push.
  const { openHref } = useToolNav()
  const [notifs, setNotifs] = useState<NotificationRow[]>([])
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [muted, setMuted] = useState<string[]>([])
  /** Subject hydration for the visible rows (notification_resolve). */
  const [subjects, setSubjects] = useState<Map<string, NotifSubject>>(new Map())
  const [open, setOpen] = useState(false)
  const version = useTableVersion('notifications')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    try {
      // Over-fetch a little so muted rows (filtered below) rarely empty the peek.
      const [rows, mutedTypes] = await Promise.all([
        list('notifications', { order: 'created_at', ascending: false, limit: PEEK_LIMIT * 3 }),
        loadMutedTypes(),
      ])
      setMuted(mutedTypes)
      setNotifs(rows)
      // Accurate server-side count (excluding muted types) — the peek is a
      // display window, never the badge's truth.
      setUnreadTotal(await unreadCount(mutedTypes))
      // Hydrate the visible subjects (fail-open: an error resolves nothing and
      // the rows keep their links).
      setSubjects(await resolveNotifications(rows.slice(0, PEEK_LIMIT).map((r) => r.id)))
    } catch { /* keep the last known list — the bell is non-critical */ }
  }, [state])

  // Deferred a tick — the codebase's lint-clean pattern for effect-driven fetches.
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  // Muted streams are hidden (not deleted) — unmuting in Profile brings them back.
  const visible = useMemo(() => {
    const m = new Set(muted)
    return notifs.filter((n) => !m.has(n.type)).slice(0, PEEK_LIMIT)
  }, [notifs, muted])

  const markOne = async (n: NotificationRow) => {
    if (n.read) return
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    setUnreadTotal((c) => Math.max(0, c - 1))
    const err = await markRead([n.id])
    if (err) { toast(err.message, 'danger'); void refresh() } // roll back to server truth
  }

  /** Deep link, or null when the subject is no longer readable (P7-07). */
  const hrefOf = (n: NotificationRow): string | null => {
    const subj = subjects.get(n.id)
    if (subj && !subj.visible) return null
    return notifHref(n, { command: isCommand })
  }

  const onRow = (n: NotificationRow) => {
    void markOne(n)
    const href = hrefOf(n)
    if (href) {
      setOpen(false)
      openHref(href)
    }
  }

  const markAll = async () => {
    setNotifs((prev) => prev.map((x) => ({ ...x, read: true })))
    setUnreadTotal(0)
    // ONE conditional update — RLS scopes it to my rows (also clears muted
    // streams' unreads, which are hidden anyway).
    const err = await markAllRead()
    if (err) { toast(err.message, 'danger'); void refresh() }
    else toast('Marked read', 'info')
  }

  const viewAll = () => {
    setOpen(false)
    openHref(VIEW_ALL_HREF)
  }

  if (state !== 'in') return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-850 text-slate-200 transition hover:bg-white/10 lg:h-9 lg:w-9"
        aria-label={unreadTotal ? `Notifications — ${unreadTotal} unread` : 'Notifications'}
      >
        <BellIcon />
        {unreadTotal > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadTotal > 9 ? '9+' : unreadTotal}
          </span>
        )}
      </button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="p-5">
          <ModalHeader title="Notifications" onClose={() => setOpen(false)} />
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={viewAll}>View All</Button>
            {unreadTotal > 0 && (
              <Button size="sm" onClick={() => void markAll()}>Mark all read</Button>
            )}
            <span className="ml-auto text-xs text-slate-400">
              {unreadTotal > 0 ? `${unreadTotal} unread` : 'All read'} · latest {visible.length}
            </span>
          </div>
          <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
            {visible.length ? visible.map((n) => {
              const subj = subjects.get(n.id)
              const gone = !!subj && !subj.visible
              const detail = gone ? null : notifDetail(n)
              const sub = gone ? 'An item you no longer have access to' : notifSub(n)
              const href = hrefOf(n)
              return (
                <li
                  key={n.id}
                  className={`flex items-stretch gap-1 rounded-lg border ${n.read ? 'border-white/5 bg-ink-900' : 'border-blue-500/20 bg-blue-500/5'}`}
                >
                  <button
                    onClick={() => onRow(n)}
                    className="block min-w-0 flex-1 rounded-lg p-3 text-left transition hover:bg-white/5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-white">{notifTitle(n)}</span>
                      <span className="flex-shrink-0 text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                    </div>
                    {detail && <p className="mt-0.5 font-mono text-[11px] text-blue-300">{detail}</p>}
                    {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
                    {href && <p className="mt-1 text-[11px] font-semibold text-blue-300">{ctaLabel(href)} →</p>}
                  </button>
                  {!n.read && (
                    <button
                      onClick={() => void markOne(n)}
                      aria-label={`Mark "${notifTitle(n)}" read`}
                      title="Mark read"
                      className="grid w-10 flex-shrink-0 place-items-center rounded-r-lg text-slate-400 transition hover:bg-white/5 hover:text-white"
                    >
                      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </button>
                  )}
                </li>
              )
            }) : <li className="text-sm text-slate-400">No notifications.</li>}
          </ul>
          <p className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-400">
            The full history — and every item that needs your action — is in the Action Center. Optional streams are muted from your Profile.
          </p>
        </div>
      </Modal>
    </>
  )
}
