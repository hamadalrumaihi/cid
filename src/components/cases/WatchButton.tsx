'use client'

/** Follow/unfollow toggle — port of vanilla watchBtnHtml (watchlist.js:63).
 *  Following is a personal bookmark; it never widens access. */
import { useState } from 'react'
import { useWatchlistStore, type WatchType } from '@/lib/watchlist'

export function WatchButton({ type, id, label, compact }: { type: WatchType; id: string; label?: string; compact?: boolean }) {
  const on = useWatchlistStore((s) => s.rows.some((w) => w.target_type === type && w.target_id === id))
  const toggle = useWatchlistStore((s) => s.toggle)
  const [busy, setBusy] = useState(false)
  return (
    <button
      className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition hover:bg-white/10 ${on ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-white/10 bg-white/5 text-slate-200'}`}
      title={on ? 'Following — click to unfollow' : 'Follow for updates on My Desk'}
      aria-pressed={on}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation()
        setBusy(true)
        try { await toggle(type, id, label) } finally { setBusy(false) }
      }}
    >
      {compact ? (on ? '★' : '☆') : on ? '★ Following' : '☆ Follow'}
    </button>
  )
}
