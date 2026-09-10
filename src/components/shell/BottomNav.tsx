'use client'

/** Mobile bottom tab bar — the nav categories with short labels and the
 *  active tint. The Owner category renders only for the portal owner (the
 *  views and RLS self-gate regardless — hiding is cosmetic). */
import { NAV_CATEGORIES, OWNER_ONLY_CATEGORIES } from '@/lib/nav'
import { useAuth } from '@/lib/auth'
import { CategoryIcon } from './icons'
import { useNav } from './useNav'
import { useNavBadges } from './useNavBadges'

const SHORT_LABEL: Record<string, string> = {
  command: 'Command', cases: 'Cases', reference: 'Ref', oversight: 'Oversight', owner: 'Owner',
}

export function BottomNav() {
  const { activeCategory, navigateCategory } = useNav()
  const { isOwner } = useAuth()
  const badges = useNavBadges()
  return (
    <nav
      className="scroll-strip safe-bottom safe-x fixed inset-x-0 bottom-0 z-30 flex items-stretch overflow-x-auto border-t border-white/10 bg-ink-950/90 backdrop-blur-xl lg:hidden"
      aria-label="Primary navigation (mobile)"
    >
      {NAV_CATEGORIES.filter((c) => !OWNER_ONLY_CATEGORIES.has(c.id) || isOwner).map((c) => {
        const on = c.id === activeCategory
        return (
          <button
            key={c.id}
            onClick={() => navigateCategory(c.id)}
            aria-current={on ? 'page' : undefined}
            className={`relative flex min-w-[4.25rem] flex-1 flex-shrink-0 flex-col items-center justify-center gap-0.5 py-2.5 transition ${
              on ? 'text-white' : 'text-slate-400'
            }`}
          >
            <span className="relative leading-none">
              <CategoryIcon cat={c.id} size={20} />
              {/* The Action Center leads Command — its chip sits on the category. */}
              {c.id === 'command' && badges.inbox > 0 && (
                <span className="absolute -right-1.5 -top-1 grid h-3.5 min-w-[14px] place-items-center rounded-full bg-rose-500 px-0.5 text-[10px] font-bold text-white" aria-label={`${badges.inbox} items need attention`}>
                  {badges.inbox > 9 ? '9+' : badges.inbox}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium">{SHORT_LABEL[c.id] ?? c.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
