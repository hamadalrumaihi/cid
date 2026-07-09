'use client'

/** Sub-tab strip — tools within the active top-level category, port of
 *  vanilla renderSubtabs (core.js:897-907). The audit and devdocs tabs are
 *  hidden unless the signed-in member is the portal owner (UI mirror; the
 *  audit RLS policy and the DevDocsView gate enforce the real rule). */
import { useAuth } from '@/lib/auth'
import { NAV_CATEGORIES, TAB_LABEL } from '@/lib/nav'
import { useNav } from './useNav'

export function Subtabs() {
  const { activeCategory, activeTab, navigate } = useNav()
  const { isOwner } = useAuth()
  const def = NAV_CATEGORIES.find((c) => c.id === activeCategory)
  if (!def) return null // standalone leaves (feedback) hide the strip

  const tabs = def.tabs.filter((t) => (t !== 'audit' && t !== 'devdocs') || isOwner)

  return (
    <nav
      className="z-10 flex items-center gap-1 overflow-x-auto border-b border-white/5 bg-ink-950/60 px-4 py-2 sm:px-8"
      role="tablist"
      aria-label="Section tools"
    >
      {tabs.map((t) => {
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
      })}
    </nav>
  )
}
