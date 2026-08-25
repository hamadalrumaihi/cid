'use client'

/** Presentational core of the dashboard switcher — pure props, no auth/router
 *  hooks, so it renders in Storybook and tests without providers (and without
 *  dragging the Supabase client into the Storybook bundle — see
 *  .storybook/preview.tsx). The wired component lives in DashSwitcher.tsx. */

import type { DashboardId } from '@/lib/capabilities'

export type SwitchableId = Exclude<DashboardId, 'submitter'>

export const DASH_LABEL: Record<SwitchableId, string> = {
  my: 'My Dashboard',
  cases: 'Cases',
  command: 'Command Center',
  sib: 'SIB',
  doj: 'Legal Review',
  owner: 'Owner Console',
}

/** Route (leaf tab id) per dashboard — /inbox, /cases, /command-center, /siu,
 *  /legal, /owner. */
export const DASH_TAB: Record<SwitchableId, string> = {
  my: 'inbox',
  cases: 'cases',
  command: 'command-center',
  sib: 'siu',
  doj: 'legal',
  owner: 'owner',
}

/** Chip-row (desktop) / labelled select (narrow) over the account's
 *  dashboards. Inaccessible entries are never rendered — the list IS the
 *  capability set (hiding is cosmetic; RLS gates the data behind every
 *  route). 'submitter' is deliberately absent: field officers get a separate
 *  shell, never this switcher. */
export function DashSwitcherView({ dashboards, activeTab, narrow = false, onNavigate }: {
  dashboards: readonly DashboardId[]
  /** Current leaf tab id (useNav().activeTab) — lights the matching entry. */
  activeTab: string
  narrow?: boolean
  onNavigate: (tab: string) => void
}) {
  const entries = dashboards.filter((d): d is SwitchableId => d !== 'submitter')
  if (entries.length === 0) return null

  if (narrow) {
    const current = entries.find((d) => DASH_TAB[d] === activeTab) ?? ''
    return (
      <label className="block">
        <span className="sr-only">Switch dashboard</span>
        <select
          value={current}
          onChange={(e) => { if (e.target.value) onNavigate(DASH_TAB[e.target.value as SwitchableId]) }}
          className="min-h-10 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm font-medium text-slate-200 focus:border-blue-500/50 focus:outline-none"
        >
          {current === '' && <option value="" disabled>Dashboards…</option>}
          {entries.map((d) => <option key={d} value={d}>{DASH_LABEL[d]}</option>)}
        </select>
      </label>
    )
  }

  return (
    <nav aria-label="Dashboards" className="flex flex-wrap items-center gap-1.5">
      {entries.map((d) => {
        const on = activeTab === DASH_TAB[d]
        return (
          <button
            key={d}
            aria-current={on ? 'page' : undefined}
            onClick={() => onNavigate(DASH_TAB[d])}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
              on
                ? 'bg-white/10 text-white'
                : 'text-slate-300 hover:bg-white/5 hover:text-white'
            }`}
          >
            {DASH_LABEL[d]}
          </button>
        )
      })}
    </nav>
  )
}
