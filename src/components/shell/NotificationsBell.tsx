'use client'

/** Notification bell + panel — port of vanilla fetchNotifications /
 *  openNotifications (app.js). Unread badge on the bell (9+ cap), modal list
 *  with per-type titles from lib/notifText (never raw payload JSON), click a
 *  row to mark it read (and jump to its case when the payload carries one),
 *  mark-all-read. RLS scopes rows to the signed-in user; realtime bumps the
 *  `notifications` table version so new arrivals appear without a reload. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { list, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { notifDetail, notifHref, notifSub, notifTitle, type NotificationRow } from '@/lib/notifText'

/** Human label for the row's call-to-action, by destination. */
function ctaLabel(href: string): string {
  if (href.startsWith('/cases')) return 'View case'
  if (href.startsWith('/legal')) return 'View legal request'
  if (href.startsWith('/justice')) return 'Open Justice Portal'
  if (href.startsWith('/command-center')) return 'Open Command Center'
  if (href.startsWith('/announce')) return 'View announcement'
  if (href.startsWith('/owner')) return 'Open Owner Portal'
  return 'Open'
}
import { useTableVersion } from '@/lib/realtime'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { BellIcon } from './icons'

export function NotificationsBell() {
  const { state } = useAuth()
  const router = useRouter()
  const [notifs, setNotifs] = useState<NotificationRow[]>([])
  const [open, setOpen] = useState(false)
  const version = useTableVersion('notifications')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    try {
      setNotifs(await list('notifications', { order: 'created_at', ascending: false, limit: 50 }))
    } catch { /* keep the last known list — the bell is non-critical */ }
  }, [state])

  // Deferred a tick — the codebase's lint-clean pattern for effect-driven fetches.
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  const unread = useMemo(() => notifs.filter((n) => !n.read).length, [notifs])

  const markRead = async (n: NotificationRow) => {
    if (n.read) return
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    const res = await update('notifications', n.id, { read: true })
    if (res.error) void refresh() // roll back to server truth
  }

  const onRow = async (n: NotificationRow) => {
    void markRead(n)
    const href = notifHref(n)
    if (href) {
      setOpen(false)
      router.push(href)
    }
  }

  const markAll = async () => {
    const ids = notifs.filter((n) => !n.read).map((n) => n.id)
    setNotifs((prev) => prev.map((x) => ({ ...x, read: true })))
    const results = await Promise.all(ids.map((id) => update('notifications', id, { read: true })))
    if (results.some((r) => r.error)) void refresh()
    else toast('Marked read', 'info')
  }

  if (state !== 'in') return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-850 text-slate-200 transition hover:bg-white/10 lg:h-9 lg:w-9"
        aria-label={unread ? `Notifications — ${unread} unread` : 'Notifications'}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <ModalHeader title="Notifications" onClose={() => setOpen(false)} />
        {unread > 0 && (
          <button onClick={() => void markAll()} className="mb-3 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10">
            Mark all read
          </button>
        )}
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {notifs.length ? notifs.map((n) => {
            const detail = notifDetail(n)
            const sub = notifSub(n)
            const href = notifHref(n)
            return (
              <button
                key={n.id}
                onClick={() => void onRow(n)}
                className={`block w-full rounded-lg border p-3 text-left transition hover:border-blue-500/40 ${n.read ? 'border-white/5 bg-ink-900' : 'border-blue-500/20 bg-blue-500/5'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white">{notifTitle(n)}</span>
                  <span className="flex-shrink-0 text-[11px] text-slate-500">{timeAgo(n.created_at)}</span>
                </div>
                {detail && <p className="mt-0.5 font-mono text-[11px] text-blue-300">{detail}</p>}
                {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
                {href && <p className="mt-1 text-[11px] font-semibold text-blue-300">{ctaLabel(href)} →</p>}
              </button>
            )
          }) : <p className="text-sm text-slate-500">No notifications.</p>}
        </div>
      </Modal>
    </>
  )
}
