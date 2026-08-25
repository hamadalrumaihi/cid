'use client'

/** Notification bell + panel. Unread badge counted server-side (countRows —
 *  accurate, never capped by the 50-row list), rows grouped into collapsible
 *  clusters by (case_id ∥ request_id ∥ type) with per-type titles from
 *  lib/notifText (never raw payload JSON). Click a row to mark it read (and
 *  jump to its deep link when one exists), mark a whole cluster read, or
 *  mark ALL read in one conditional update. A small settings panel mutes the
 *  clearly-optional streams (lib/notifications OPTIONAL_NOTIF_CATEGORIES) —
 *  muted rows are hidden and uncounted, never deleted; mandatory types are
 *  always visible. RLS scopes rows to the signed-in user; realtime bumps the
 *  `notifications` table version so new arrivals appear without a reload. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { list } from '@/lib/db'
import {
  OPTIONAL_NOTIF_CATEGORIES, loadMutedTypes, markAllRead, markRead,
  saveMutedTypes, unreadCount, type NotifCategory,
} from '@/lib/notifications'
import { useAuth } from '@/lib/auth'
import { notifDetail, notifHref, notifSub, notifTitle, type NotificationRow } from '@/lib/notifText'
import { parseNotifPayload } from '@/lib/schemas'

/** Human label for the row's call-to-action, by destination. */
function ctaLabel(href: string): string {
  if (href.startsWith('/cases')) return 'View case'
  if (href.startsWith('/legal')) return 'View legal request'
  if (href.startsWith('/command-center')) return 'Open Command Center'
  if (href.startsWith('/command')) return 'Open Central Command'
  if (href.startsWith('/announce')) return 'View announcement'
  if (href.startsWith('/owner')) return 'Open Owner Portal'
  if (href.startsWith('/profile')) return 'View your profile'
  if (href.startsWith('/guide')) return 'Open the field guide'
  return 'Open'
}
import { useTableVersion } from '@/lib/realtime'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { useToolNav } from '@/components/tools/useToolNav'
import { BellIcon } from './icons'

/** Cluster key: notifications about the same case or request collapse into
 *  one group; the rest group by type (e.g. a run of announcements). */
function groupKeyOf(n: NotificationRow): string {
  const p = parseNotifPayload(n.payload)
  return (p.case_id && `case:${p.case_id}`) || (p.request_id && `req:${p.request_id}`) || `type:${n.type}`
}

interface NotifGroup {
  key: string
  /** Newest first (source order). */
  rows: NotificationRow[]
  unreadIds: string[]
}

export function NotificationsBell() {
  const { state, isCommand } = useAuth()
  // Workspace-aware push: tool hrefs land as Investigative Tools tabs, every
  // other href behaves exactly like router.push.
  const { openHref } = useToolNav()
  const [notifs, setNotifs] = useState<NotificationRow[]>([])
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [muted, setMuted] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const version = useTableVersion('notifications')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    try {
      const [rows, mutedTypes] = await Promise.all([
        list('notifications', { order: 'created_at', ascending: false, limit: 50 }),
        loadMutedTypes(),
      ])
      setNotifs(rows)
      setMuted(mutedTypes)
      // Accurate server-side count (excluding muted types) — the 50-row list
      // is a display window, never the badge's truth.
      setUnreadTotal(await unreadCount(mutedTypes))
    } catch { /* keep the last known list — the bell is non-critical */ }
  }, [state])

  // Deferred a tick — the codebase's lint-clean pattern for effect-driven fetches.
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  // Muted streams are hidden (not deleted) — unmuting brings them back.
  const visible = useMemo(() => {
    const m = new Set(muted)
    return notifs.filter((n) => !m.has(n.type))
  }, [notifs, muted])

  const groups = useMemo<NotifGroup[]>(() => {
    const map = new Map<string, NotificationRow[]>()
    for (const n of visible) {
      const key = groupKeyOf(n)
      const arr = map.get(key)
      if (arr) arr.push(n)
      else map.set(key, [n])
    }
    // Insertion order = first (newest) row per key — already newest-first.
    return [...map.entries()].map(([key, rows]) => ({
      key, rows, unreadIds: rows.filter((r) => !r.read).map((r) => r.id),
    }))
  }, [visible])

  const markOne = async (n: NotificationRow) => {
    if (n.read) return
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    setUnreadTotal((c) => Math.max(0, c - 1))
    const err = await markRead([n.id])
    if (err) void refresh() // roll back to server truth
  }

  const onRow = async (n: NotificationRow) => {
    void markOne(n)
    const href = notifHref(n, { command: isCommand })
    if (href) {
      setOpen(false)
      openHref(href)
    }
  }

  const markGroup = async (g: NotifGroup) => {
    const ids = new Set(g.unreadIds)
    setNotifs((prev) => prev.map((x) => (ids.has(x.id) ? { ...x, read: true } : x)))
    setUnreadTotal((c) => Math.max(0, c - ids.size))
    const err = await markRead([...ids])
    if (err) { toast(err.message, 'danger'); void refresh() }
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

  const toggleCategory = async (c: NotifCategory) => {
    const isMuted = c.types.every((t) => muted.includes(t))
    const next = isMuted
      ? muted.filter((t) => !c.types.includes(t))
      : [...new Set([...muted, ...c.types])]
    setMuted(next)
    const err = await saveMutedTypes(next)
    if (err) { toast(err.message, 'danger'); setMuted(muted); return }
    try { setUnreadTotal(await unreadCount(next)) } catch { /* badge catches up on the next bump */ }
  }

  if (state !== 'in') return null

  const renderRow = (n: NotificationRow, inCluster = false) => {
    const detail = notifDetail(n)
    const sub = notifSub(n)
    const href = notifHref(n, { command: isCommand })
    return (
      <button
        key={n.id}
        onClick={() => void onRow(n)}
        className={`block w-full p-3 text-left transition hover:border-blue-500/40 ${inCluster ? 'border-t border-white/5 first:border-t-0' : 'rounded-lg border'} ${n.read ? 'border-white/5 bg-ink-900' : `${inCluster ? '' : 'border-blue-500/20'} bg-blue-500/5`}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-white">{notifTitle(n)}</span>
          <span className="flex-shrink-0 text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
        </div>
        {detail && <p className="mt-0.5 font-mono text-[11px] text-blue-300">{detail}</p>}
        {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
        {href && <p className="mt-1 text-[11px] font-semibold text-blue-300">{ctaLabel(href)} →</p>}
      </button>
    )
  }

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
          {unreadTotal > 0 && (
            <Button size="sm" className="mb-3" onClick={() => void markAll()}>
              Mark all read
            </Button>
          )}
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {groups.length ? groups.map((g) => {
              if (g.rows.length === 1) return renderRow(g.rows[0])
              const newest = g.rows[0]
              const isOpen = !!expanded[g.key]
              return (
                <div key={g.key} className={`overflow-hidden rounded-lg border ${g.unreadIds.length ? 'border-blue-500/20' : 'border-white/5'} bg-ink-900`}>
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [g.key]: !isOpen }))}
                    aria-expanded={isOpen}
                    className="block w-full p-3 text-left transition hover:bg-white/5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-white">{notifTitle(newest)}</span>
                      <span className="flex flex-shrink-0 items-center gap-2">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${g.unreadIds.length ? 'bg-blue-500/15 text-blue-200' : 'bg-white/5 text-slate-300'}`}>
                          {g.rows.length}
                        </span>
                        <span className="text-[11px] text-slate-400">{timeAgo(newest.created_at)}</span>
                        <span aria-hidden className="text-[11px] text-slate-400">{isOpen ? '▾' : '▸'}</span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {notifDetail(newest) || notifSub(newest) || `${g.rows.length} related notifications`}
                      {g.unreadIds.length > 0 && ` · ${g.unreadIds.length} unread`}
                    </p>
                  </button>
                  {isOpen && (
                    <div className="border-t border-white/10">
                      {g.unreadIds.length > 0 && (
                        <div className="flex justify-end px-3 py-1.5">
                          <button
                            onClick={() => void markGroup(g)}
                            className="rounded px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
                          >
                            Mark group read
                          </button>
                        </div>
                      )}
                      {g.rows.map((n) => renderRow(n, true))}
                    </div>
                  )}
                </div>
              )
            }) : <p className="text-sm text-slate-400">No notifications.</p>}
          </div>
          <div className="mt-3 border-t border-white/10 pt-3">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              <span aria-hidden>{settingsOpen ? '▾' : '▸'}</span> Notification settings
            </button>
            {settingsOpen && (
              <div className="mt-1 space-y-0.5">
                <p className="px-2 text-xs text-slate-400">
                  Optional streams only — assignments, mentions, sign-offs, legal and security notices are always delivered.
                </p>
                {OPTIONAL_NOTIF_CATEGORIES.map((c) => {
                  const isMuted = c.types.every((t) => muted.includes(t))
                  return (
                    <label key={c.key} className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1 transition hover:bg-white/5">
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-200">{c.label}</span>
                        <span className="block text-xs text-slate-400">{c.hint}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={!isMuted}
                        onChange={() => void toggleCategory(c)}
                        aria-label={`Receive ${c.label} notifications`}
                        className="h-4 w-4 flex-shrink-0 accent-amber-400"
                      />
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}
