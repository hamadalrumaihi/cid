'use client'

/** Sidebar — port of the vanilla #sidebar (index.html:65-132): brand head,
 *  restricted banner, 5 category buttons + standalone Feedback leaf,
 *  appearance/collapse controls, officer card. Collapse uses the same
 *  body.nav-collapsed class contract as the legacy styles.css. */
import { useState, useSyncExternalStore } from 'react'
import { useAuth } from '@/lib/auth'
import { NAV_CATEGORIES } from '@/lib/nav'
import { deptLabel, roleLabel } from '@/lib/roles'
import { safeUrl } from '@/lib/safeUrl'
import { Store } from '@/lib/store'
import { AppearanceModal } from './AppearanceModal'
import { MyProfileModal } from './MyProfileModal'
import { CategoryIcon, ChevronIcon, CloseIcon, ShieldIcon } from './icons'
import { useNav } from './useNav'
import { useNavBadges } from './useNavBadges'

/* eslint-disable @next/next/no-img-element -- avatars are tiny external
   Discord/Google CDN images; the optimizer adds nothing but a proxy hop. */

function OfficerCard() {
  const { profile, session } = useAuth()
  const [profileOpen, setProfileOpen] = useState(false)
  // Vanilla vocabulary (collab.js renderOfficerCard): 'Badge <n> · <dept
  // abbreviation>' with amber On-LOA / emerald On-duty status dot. Clicking
  // opens the My Profile editor (collab.js wires #officer-card the same way).
  const name = profile?.display_name || session?.user?.email || 'Not signed in'
  const initials =
    (profile?.display_name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const avatar = safeUrl(profile?.avatar_url ?? '')
  const sub = profile
    ? `${profile.badge_number ? `Badge ${profile.badge_number} · ` : ''}${deptLabel(profile.division)}`
    : '—'
  const dot = !profile
    ? { cls: 'bg-slate-500', title: 'Offline' }
    : profile.loa
      ? { cls: 'bg-amber-400', title: 'On LOA' }
      : { cls: 'bg-emerald-400', title: 'On duty' }
  return (
    <div className="border-t border-white/5 p-3">
      <button
        onClick={() => { if (profile) setProfileOpen(true) }}
        className="flex w-full items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5 text-left transition hover:bg-white/10"
        aria-label="Your profile and status"
      >
        <div className="grid h-9 w-9 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-xs font-bold text-white">
          {avatar ? <img src={avatar} className="h-9 w-9 rounded-full object-cover" alt="" /> : initials}
        </div>
        <div className="sidebar-hide min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-white">{name}</p>
          <p className="truncate text-[11px] text-slate-400">{sub}</p>
          <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wider text-blue-300/80">{roleLabel(profile?.role)}</p>
        </div>
        {profile?.loa && (
          <span className="sidebar-hide flex-shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300" title="On Leave of Absence">
            LOA
          </span>
        )}
        <span className={`sidebar-hide pulse-dot h-2.5 w-2.5 flex-shrink-0 rounded-full ${dot.cls}`} title={dot.title} />
      </button>
      {profileOpen && <MyProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  )
}

/* Collapse state lives on <body> so the legacy .nav-collapsed CSS (sidebar
 * rail + main margin) applies unchanged — the body class IS the store (set
 * pre-hydration by the pref script), read via useSyncExternalStore. */
const collapseListeners = new Set<() => void>()
const subscribeCollapse = (cb: () => void) => {
  collapseListeners.add(cb)
  return () => { collapseListeners.delete(cb) }
}
const readCollapsed = () => document.body.classList.contains('nav-collapsed')

export function Sidebar({ drawerOpen, onCloseDrawer }: { drawerOpen: boolean; onCloseDrawer: () => void }) {
  const { activeCategory, activeTab, navigate, navigateCategory } = useNav()
  const badges = useNavBadges()
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const collapsed = useSyncExternalStore(subscribeCollapse, readCollapsed, () => false)

  const toggleCollapse = () => {
    const next = !readCollapsed()
    document.body.classList.toggle('nav-collapsed', next)
    Store.set('collapsed', next)
    collapseListeners.forEach((cb) => cb())
  }

  const go = (fn: () => void) => { fn(); onCloseDrawer() }

  return (
    <aside
      id="sidebar"
      className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/5 bg-ink-900/95 backdrop-blur-xl lg:translate-x-0 lg:bg-ink-900/80 ${
        drawerOpen ? '' : '-translate-x-full'
      }`}
      aria-label="Primary navigation"
    >
      <div className="sidebar-head flex items-center gap-3 border-b border-white/5 px-5 py-5">
        <div className="relative grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-badge-500 to-blue-700 shadow-glow">
          <ShieldIcon className="h-6 w-6 text-white" />
        </div>
        <div className="sidebar-hide leading-tight">
          <h1 className="text-base font-bold tracking-tight text-white">CID Portal</h1>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-blue-300/70">San Andreas</p>
        </div>
        <button
          onClick={onCloseDrawer}
          className="sidebar-hide ml-auto grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="sidebar-hide mx-4 mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
          <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-amber-400" /> Restricted // CID Eyes Only
        </p>
      </div>

      <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4" role="navigation">
        <p className="sidebar-hide px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Divisions</p>
        {NAV_CATEGORIES.map((c) => {
          const on = c.id === activeCategory
          return (
            <button
              key={c.id}
              data-label={c.label}
              aria-current={on ? 'page' : undefined}
              onClick={() => go(() => navigateCategory(c.id))}
              className={`nav-link group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition hover:bg-white/5 hover:text-white ${
                on ? 'bg-white/10 text-white' : 'text-slate-300'
              }`}
            >
              <span className="nav-icon flex-shrink-0"><CategoryIcon cat={c.id} /></span>
              <span className="nav-label">
                {c.label}
                {/* Vanilla puts all three badges on the Command button
                    (#pending/#ann/#signoff-nav-badge). */}
                {c.id === 'command' && badges.pending > 0 && (
                  <span role="status" aria-label={`${badges.pending} member${badges.pending === 1 ? '' : 's'} awaiting approval`} className="ml-1 rounded-full bg-amber-500 px-1.5 text-[9px] font-bold text-white" title="Members awaiting approval">{badges.pending}</span>
                )}
                {c.id === 'command' && badges.announcements > 0 && (
                  <span className="ml-1 rounded-full bg-rose-500 px-1.5 text-[9px] font-bold text-white" title="Unread announcements">{badges.announcements > 9 ? '9+' : badges.announcements}</span>
                )}
                {c.id === 'command' && badges.signoff > 0 && (
                  <span className="ml-1 rounded-full bg-badge-500 px-1.5 text-[9px] font-bold text-white" title="Sign-off actions awaiting you">{badges.signoff}</span>
                )}
              </span>
            </button>
          )
        })}
        <button
          data-label="Feedback"
          onClick={() => go(() => navigate('feedback'))}
          title="Suggest a feature or report a bug"
          className={`nav-link group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition hover:bg-white/5 hover:text-white ${
            activeTab === 'feedback' ? 'bg-white/10 text-white' : 'text-slate-300'
          }`}
        >
          <span className="nav-icon flex-shrink-0"><CategoryIcon cat="feedback" /></span>
          <span className="nav-label">Feedback</span>
        </button>
      </nav>

      <div className="hidden border-t border-white/5 p-3 lg:block">
        <button
          onClick={() => setAppearanceOpen(true)}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Appearance settings"
        >
          🎨 <span className="nav-label">Appearance</span>
        </button>
        <button
          onClick={toggleCollapse}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          <ChevronIcon dir={collapsed ? 'right' : 'left'} />
          <span className="nav-label">Collapse</span>
        </button>
      </div>

      <OfficerCard />
      <AppearanceModal open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </aside>
  )
}
