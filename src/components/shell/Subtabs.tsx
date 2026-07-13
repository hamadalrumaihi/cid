'use client'

/** Sub-tab strip — tools within the active top-level category, port of
 *  vanilla renderSubtabs (core.js:897-907). The audit and devdocs tabs are
 *  hidden unless the signed-in member is the portal owner (UI mirror; the
 *  audit RLS policy and the DevDocsView gate enforce the real rule).
 *  Crowded categories (Intelligence) draw purely-visual group labels and
 *  dividers between the SAME tabs in the SAME order — see SUBTAB_GROUPS. */
import { Fragment } from 'react'
import { useAuth } from '@/lib/auth'
import { NAV_CATEGORIES, SUBTAB_GROUPS, TAB_LABEL } from '@/lib/nav'
import { useNav } from './useNav'

export function Subtabs() {
  const { activeCategory, activeTab, navigate } = useNav()
  const { isOwner } = useAuth()
  const def = NAV_CATEGORIES.find((c) => c.id === activeCategory)
  if (!def) return null // standalone leaves (feedback) hide the strip

  const tabs = def.tabs.filter((t) => (t !== 'audit' && t !== 'devdocs') || isOwner)
  const groups = SUBTAB_GROUPS[def.id]
    ?.map((g) => ({ ...g, tabs: g.tabs.filter((t) => tabs.includes(t)) }))
    .filter((g) => g.tabs.length)
  // A tab added to the category but not (yet) to a group must still render.
  const grouped = new Set(groups?.flatMap((g) => g.tabs) ?? [])
  const leftovers = groups?.length ? tabs.filter((t) => !grouped.has(t)) : []

  const tabBtn = (t: string) => {
    const on = t === activeTab
    return (
      <button
        key={t}
        role="tab"
        aria-selected={on}
        onClick={() => navigate(t)}
        className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
          on
            ? 'bg-blue-500/15 text-white shadow-[inset_0_-2px_0_0_#3b82f6]'
            : 'text-slate-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        {TAB_LABEL[t] || t}
      </button>
    )
  }

  return (
    <nav
      className="z-10 flex items-center gap-1 overflow-x-auto border-b border-white/5 bg-ink-950/60 px-4 py-2 sm:px-8"
      role="tablist"
      aria-label="Section tools"
    >
      {groups?.length
        ? groups.map((g, gi) => (
            <Fragment key={g.label}>
              {gi > 0 && <span aria-hidden className="mx-1.5 h-4 w-px flex-shrink-0 bg-white/10" />}
              <span aria-hidden className="hidden flex-shrink-0 pl-1 pr-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 lg:inline">
                {g.label}
              </span>
              {g.tabs.map(tabBtn)}
            </Fragment>
          )).concat(leftovers.length ? [<Fragment key="__rest">{leftovers.map(tabBtn)}</Fragment>] : [])
        : tabs.map(tabBtn)}
    </nav>
  )
}
