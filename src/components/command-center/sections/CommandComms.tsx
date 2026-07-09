'use client'

/** Command Center → Announcements & Analytics. Surfaces the two existing
 *  member-facing tools inside the Center by reusing their views as-is: the
 *  Announcements composer (command-gated posting) and the Division Analytics
 *  charts. Both remain on their own tabs too — this is a convenience surface,
 *  not a move. */
import { useState } from 'react'
import { AnnounceView } from '@/components/announce/AnnounceView'
import { AnalyticsView } from '@/components/analytics/AnalyticsView'

const TABS = [['announce', '📣 Announcements'], ['analytics', '📊 Analytics']] as const
type Tab = (typeof TABS)[number][0]

export function CommandComms() {
  const [tab, setTab] = useState<Tab>('announce')
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${tab === id ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'announce' ? <AnnounceView /> : <AnalyticsView />}
    </div>
  )
}
