'use client'

/** Sub-tab strip — the leaf tabs of the active top-level category. Two
 *  visibility gates, both cosmetic mirrors of server rules:
 *   · the Owner category renders only for the portal owner (the audit RLS
 *     policy, the DevDocsView gate and the template RPCs enforce the real
 *     rule) — the category gate replaced the old per-tab audit/devdocs filter;
 *   · `informants` renders only for accounts the CI compartment involves
 *     (useCiContext → ciInvolved). Everyone else never sees the leaf, and the
 *     view itself renders the ordinary nothing-here surface; RLS is the wall.
 *  Crowded categories may draw purely-visual group labels and dividers
 *  between the SAME tabs in the SAME order — see SUBTAB_GROUPS. */
import { Fragment } from 'react'
import { useAuth } from '@/lib/auth'
import { ciInvolved, useCiContext } from '@/lib/ci'
import { NAV_CATEGORIES, OWNER_ONLY_CATEGORIES, SUBTAB_GROUPS, TAB_LABEL } from '@/lib/nav'
import { useNav } from './useNav'
import { useNavBadges } from './useNavBadges'

export function Subtabs() {
  const { activeCategory, activeTab, navigate } = useNav()
  const { isOwner } = useAuth()
  const ci = useCiContext()
  const badges = useNavBadges()
  const def = NAV_CATEGORIES.find((c) => c.id === activeCategory)
  if (!def) return null // standalone leaves (feedback, command-center, …) hide the strip
  if (OWNER_ONLY_CATEGORIES.has(def.id) && !isOwner) return null

  const tabs = def.tabs.filter((t) => t !== 'informants' || ciInvolved(ci.ctx))
  // A one-tab category needs no strip — the single leaf IS the category, so a
  // one-button tablist would be noise.
  if (tabs.length <= 1) return null
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
        className={`relative flex-shrink-0 px-3 py-2 text-xs transition ${
          on
            ? 'font-semibold text-white after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-badge-500'
            : 'font-medium text-slate-400 hover:text-slate-200'
        }`}
      >
        {TAB_LABEL[t] || t}
        {/* The Action Center's chip: pending approvals + unread announcements
            + sign-off actions (useNavBadges.inbox). */}
        {t === 'inbox' && badges.inbox > 0 && (
          <span className="ml-1 rounded bg-amber-500/15 px-1.5 text-[10px] font-semibold tabular-nums text-amber-300" title="Items awaiting your attention">{badges.inbox > 99 ? '99+' : badges.inbox}</span>
        )}
        {/* Phase 8: deleted rows the viewer may restore (trash_count). */}
        {t === 'trash' && badges.trash > 0 && (
          <span className="ml-1 rounded bg-white/10 px-1.5 text-[10px] font-semibold tabular-nums text-slate-200" title="Records in the Trash you can restore">{badges.trash > 99 ? '99+' : badges.trash}</span>
        )}
      </button>
    )
  }

  return (
    <nav
      className="scroll-strip z-10 flex items-center gap-1 overflow-x-auto border-b border-white/5 bg-ink-950/90 px-4 sm:px-6"
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
