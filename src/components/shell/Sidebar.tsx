'use client'

/** Sidebar — port of the vanilla #sidebar (index.html:65-132): brand head,
 *  restricted banner, capability-gated Dashboards leaves (useCapabilities),
 *  5 category buttons + standalone Feedback/Concern leaves, appearance/
 *  collapse controls, officer card. Collapse uses the same
 *  body.nav-collapsed class contract as the legacy styles.css. */
import { useSyncExternalStore } from 'react'
import { DASH_LABEL, DASH_TAB, type SwitchableId } from '@/components/dash/DashSwitcherView'
import { useAuth } from '@/lib/auth'
import { useCapabilities } from '@/lib/capabilities'
import { useSiu } from '@/lib/useSiu'
import { NAV_CATEGORIES, SIU_NAV_CATEGORIES, SIU_TAB_LABEL, TAB_LABEL } from '@/lib/nav'
import { bureauShort, roleLabel } from '@/lib/roles'
import { DEPARTMENT_LABEL, siuCallsign, siuRoleLabel } from '@/lib/siu'
import { safeUrl } from '@/lib/safeUrl'
import { Store } from '@/lib/store'
import { CategoryIcon, ChevronIcon, CloseIcon, ShieldIcon } from './icons'
import { useNav } from './useNav'
import { useNavBadges } from './useNavBadges'

/* eslint-disable @next/next/no-img-element -- avatars are tiny external
   Discord/Google CDN images; the optimizer adds nothing but a proxy hop. */

function OfficerCard() {
  const { profile, session } = useAuth()
  const siu = useSiu()
  const { navigate } = useNav()
  // Vanilla vocabulary (collab.js renderOfficerCard): 'Badge <n> · <bureau
  // short code>' with amber On-LOA / emerald On-duty status dot. Clicking
  // opens the My Profile editor (collab.js wires #officer-card the same way).
  const name = profile?.display_name || session?.user?.email || 'Not signed in'
  const initials =
    (profile?.display_name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const avatar = safeUrl(profile?.avatar_url ?? '')
  // Inside SIU the officer card shows SIU identity — callsign and SIU role —
  // never the member's former CID rank and bureau (§20).
  const sub = !profile
    ? '—'
    : siu.inSiu
      ? `${siu.callsign ? `${siuCallsign(siu.callsign)} · ` : ''}${DEPARTMENT_LABEL.siu}`
      : `${profile.badge_number ? `Badge ${profile.badge_number} · ` : ''}${bureauShort(profile.division)}`
  const dot = !profile
    ? { cls: 'bg-slate-500', title: 'Offline' }
    : profile.loa
      ? { cls: 'bg-amber-400', title: 'On LOA' }
      : { cls: 'bg-emerald-400', title: 'On duty' }
  return (
    <div className="border-t border-white/5 p-3">
      <button
        onClick={() => { if (profile) navigate('profile') }}
        className="flex w-full items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5 text-left transition hover:bg-white/10"
        aria-label="Your profile and status"
      >
        <div className="grid h-9 w-9 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-xs font-bold text-white">
          {avatar ? <img src={avatar} className="h-9 w-9 rounded-full object-cover" alt="" /> : initials}
        </div>
        <div className="sidebar-hide min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-white">{name}</p>
          <p className="truncate text-[11px] text-slate-400">{sub}</p>
          <p className={`mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wider ${
            siu.inSiu ? 'text-violet-300/80' : 'text-blue-300/80'
          }`}>
            {siu.inSiu
              ? (siu.standing === 'owner' ? 'Portal Owner'
                 : siu.standing === 'oversight' ? 'SIB Oversight'
                 : siuRoleLabel(siu.membership?.siu_role))
              : roleLabel(profile?.role)}
          </p>
        </div>
        {profile?.loa && (
          <span className="sidebar-hide flex-shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300" title="On Leave of Absence">
            LOA
          </span>
        )}
        <span className={`sidebar-hide pulse-dot h-2.5 w-2.5 flex-shrink-0 rounded-full ${dot.cls}`} title={dot.title} />
      </button>
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

/** The capability-gated dashboard leaves (the old standalone Command Center +
 *  Owner leaves, absorbed and extended). Order matches the capability model's
 *  display order; entries render only when useCapabilities grants them. */
const DASH_LEAVES: { id: SwitchableId; icon: string; title: string }[] = [
  { id: 'command', icon: '🛡️', title: 'Command Center — personnel, approvals, promotions & chain of command' },
  { id: 'sib', icon: '🛰️', title: 'Special Investigations Bureau workspace' },
  { id: 'doj', icon: '⚖️', title: 'Legal Review — warrants & subpoenas awaiting DOJ review' },
  { id: 'owner', icon: '🛠️', title: 'Owner Console — project intelligence & engineering operations' },
]

export function Sidebar({ drawerOpen, onCloseDrawer }: { drawerOpen: boolean; onCloseDrawer: () => void }) {
  const caps = useCapabilities()
  const siu = useSiu()
  const inSiu = siu.inSiu
  const { activeCategory, activeTab, navigate, navigateCategory } = useNav()
  const badges = useNavBadges()
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
        <div className={`relative grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl shadow-glow ${
          inSiu ? 'bg-gradient-to-br from-violet-500 to-violet-800' : 'bg-gradient-to-br from-badge-500 to-blue-700'
        }`}>
          <ShieldIcon className="h-6 w-6 text-white" />
        </div>
        <div className="sidebar-hide leading-tight">
          {/* Brand wordmark, not the page heading — each view owns its single
              <h1> (PageHeader / dossier), so the brand is a styled <div> to keep
              one-h1-per-page. The department owns the wordmark: an SIU agent is
              not looking at "the CID Portal". */}
          <div className="text-base font-bold tracking-tight text-white">
            {inSiu ? 'SIB Portal' : 'CID Portal'}
          </div>
          <p className={`text-[11px] font-medium uppercase tracking-[0.18em] ${
            inSiu ? 'text-violet-300/70' : 'text-blue-300/70'
          }`}>
            {inSiu ? DEPARTMENT_LABEL.siu : 'San Andreas'}
          </p>
        </div>
        <button
          onClick={onCloseDrawer}
          className="sidebar-hide ml-auto grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <CloseIcon />
        </button>
      </div>

      <div className={`sidebar-hide mx-4 mt-4 rounded-lg border px-3 py-2 ${
        inSiu ? 'border-violet-500/25 bg-violet-500/5' : 'border-amber-500/20 bg-amber-500/5'
      }`}>
        <p className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${
          inSiu ? 'text-violet-300/90' : 'text-amber-400/90'
        }`}>
          <span className={`pulse-dot inline-block h-2 w-2 rounded-full ${inSiu ? 'bg-violet-400' : 'bg-amber-400'}`} />
          {inSiu ? 'Restricted // SIB Eyes Only' : 'Restricted // CID Eyes Only'}
        </p>
      </div>

      <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4" role="navigation">
        {/* Dashboards — capability-gated leaf links (useCapabilities), one per
            dashboard the account holds beyond the shared category nav. This
            absorbs the former standalone Command Center + Owner leaves and
            adds SIB / Legal Review for the accounts that hold them. Hiding is
            cosmetic; each view self-gates and RLS is the real rule. Gated on
            caps.ready so nothing flashes in and out during boot. */}
        {!inSiu && caps.ready && caps.dashboards.some((d) => DASH_LEAVES.some((l) => l.id === d)) && (
          <div className="pb-1">
            <p className="sidebar-hide px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Dashboards
            </p>
            {DASH_LEAVES.filter((l) => caps.dashboards.includes(l.id)).map((l) => (
              <button
                key={l.id}
                data-label={DASH_LABEL[l.id]}
                onClick={() => go(() => navigate(DASH_TAB[l.id]))}
                title={l.title}
                className={`nav-link group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition hover:bg-white/5 hover:text-white ${
                  activeTab === DASH_TAB[l.id]
                    ? 'relative bg-white/10 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r-full before:bg-badge-500'
                    : 'text-slate-300'
                }`}
              >
                <span className="nav-icon flex-shrink-0" aria-hidden>{l.icon}</span>
                <span className="nav-label">{DASH_LABEL[l.id]}</span>
              </button>
            ))}
          </div>
        )}
        <p className="sidebar-hide px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {inSiu ? 'Bureau' : 'Divisions'}
        </p>
        {/* SIU renders its OWN navigation — it is a separate department, not a
            leaf inside the CID sidebar. The shared registry routes are reused
            deliberately (one master dataset, RLS-scoped per viewer); only the
            grouping, labels and context differ. */}
        {inSiu && SIU_NAV_CATEGORIES.map((cat) => (
          <div key={cat.id} className="pb-1">
            <p className="sidebar-hide px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{cat.label}</p>
            {cat.tabs.map((t) => (
              <button
                key={t}
                data-label={SIU_TAB_LABEL[t] ?? TAB_LABEL[t] ?? t}
                onClick={() => go(() => navigate(t))}
                className={`nav-link group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-white/5 hover:text-white ${
                  activeTab === t
                    ? 'relative bg-white/10 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r-full before:bg-violet-400'
                    : 'text-slate-300'
                }`}
              >
                <span className="nav-label">{SIU_TAB_LABEL[t] ?? TAB_LABEL[t] ?? t}</span>
              </button>
            ))}
          </div>
        ))}
        {!inSiu && NAV_CATEGORIES.map((c) => {
          const on = c.id === activeCategory
          return (
            <button
              key={c.id}
              data-label={c.label}
              aria-current={on ? 'page' : undefined}
              onClick={() => go(() => navigateCategory(c.id))}
              className={`nav-link group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition hover:bg-white/5 hover:text-white ${
                on ? 'relative bg-white/10 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r-full before:bg-badge-500' : 'text-slate-300'
              }`}
            >
              <span className="nav-icon flex-shrink-0"><CategoryIcon cat={c.id} /></span>
              <span className="nav-label">
                {c.label}
                {/* Vanilla puts all three badges on the Command button
                    (#pending/#ann/#signoff-nav-badge). */}
                {c.id === 'command' && badges.pending > 0 && (
                  <span role="status" aria-label={`${badges.pending} member${badges.pending === 1 ? '' : 's'} awaiting approval`} className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white" title="Members awaiting approval">{badges.pending}</span>
                )}
                {c.id === 'command' && badges.announcements > 0 && (
                  <span className="ml-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white" title="Unread announcements">{badges.announcements > 9 ? '9+' : badges.announcements}</span>
                )}
                {c.id === 'command' && badges.signoff > 0 && (
                  <span className="ml-1 rounded-full bg-badge-500 px-1.5 text-[10px] font-bold text-white" title="Sign-off actions awaiting you">{badges.signoff}</span>
                )}
              </span>
            </button>
          )
        })}
        {!inSiu && <button
          data-label="Feedback"
          onClick={() => go(() => navigate('feedback'))}
          title="Suggest a feature or report a bug"
          className={`nav-link group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition hover:bg-white/5 hover:text-white ${
            activeTab === 'feedback' ? 'relative bg-white/10 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r-full before:bg-badge-500' : 'text-slate-300'
          }`}
        >
          <span className="nav-icon flex-shrink-0"><CategoryIcon cat="feedback" /></span>
          <span className="nav-label">Feedback</span>
        </button>}
        {/* §14 intake, from the reporter's side. Shown to every CID member —
            the channel is only useful if the people most likely to notice
            misconduct can find it. It never names SIU; see ConcernView. */}
        {!inSiu && <button
          data-label="Report a Concern"
          onClick={() => go(() => navigate('concern'))}
          title="Confidential reporting outside the ordinary chain of command"
          className={`nav-link group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition hover:bg-white/5 hover:text-white ${
            activeTab === 'concern' ? 'relative bg-white/10 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r-full before:bg-badge-500' : 'text-slate-300'
          }`}
        >
          <span className="nav-icon flex-shrink-0"><CategoryIcon cat="concern" /></span>
          <span className="nav-label">Report a Concern</span>
        </button>}
        {/* Command Center / SIB / Legal Review / Owner Console leaves moved
            into the capability-gated Dashboards block above. */}
        {/* Deliberate department switch — rendered ONLY for accounts that
            legitimately hold BOTH contexts (Portal Owner, Attorney General
            oversight). A normal CID member is never offered this, and the
            control grants nothing on its own: every read stays RLS-scoped and
            every write still goes through an SIU RPC (§23). */}
        {siu.maySwitch && siu.canAccess && (
          <button
            data-label={inSiu ? DEPARTMENT_LABEL.cid : DEPARTMENT_LABEL.siu}
            onClick={() => go(() => {
              const next = inSiu ? 'cid' : 'siu'
              siu.setViewing(next)
              navigate(next === 'siu' ? 'siu' : 'inbox')
            })}
            title={`Switch to ${inSiu ? DEPARTMENT_LABEL.cid : DEPARTMENT_LABEL.siu}`}
            className="nav-link group mt-2 flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <span className="nav-icon flex-shrink-0" aria-hidden>⇄</span>
            <span className="nav-label">{inSiu ? 'Switch to CID' : 'Switch to SIB'}</span>
          </button>
        )}
      </nav>

      <div className="hidden border-t border-white/5 p-3 lg:block">
        <button
          onClick={() => go(() => navigate('profile'))}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label="My profile and appearance settings"
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
    </aside>
  )
}
