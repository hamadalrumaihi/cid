'use client'

/** Top bar — port of the vanilla <header> (index.html:136-160) + the auth
 *  slot auth.js showApp() renders into it (role-caps chip, LOA, sign out).
 *  Global search and the notification bell are visual stubs until their
 *  slices land (search_all palette · notifications). */
import { PAGE_META } from '@/lib/nav'
import { useAuth } from '@/lib/auth'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { BellIcon, MenuIcon, SearchIcon } from './icons'
import { useNav } from './useNav'

/* eslint-disable @next/next/no-img-element -- tiny external avatar, see Sidebar */

/** Access summary per role — vanilla auth.js:62-68. */
const ROLE_CAPS: Record<string, string> = {
  detective: 'View & edit records, log evidence, author reports, submit cases for sign-off.',
  senior_detective: 'View & edit records, log evidence, author reports, submit cases for sign-off.',
  bureau_lead: 'All detective actions + review/approve sign-offs, delete records, manage announcements (your bureau).',
  deputy_director: 'Bureau-lead actions + cross-bureau oversight and command tools.',
  director: 'Full command: cross-bureau oversight, sign-offs, deletes, roster & announcements.',
}

function AuthBar() {
  const { profile, session, signOut, setMyLoa } = useAuth()
  const name = profile?.display_name || session?.user?.email || 'Officer'
  const avatar = safeUrl(profile?.avatar_url ?? '')
  const onLoa = !!profile?.loa
  const caps = (profile?.role && ROLE_CAPS[profile.role]) || 'Active member access.'

  const toggleLoa = async () => {
    const r = await setMyLoa(!onLoa)
    if (r.error) toast(r.error.message, 'danger')
    else toast(onLoa ? 'LOA cleared — you are back in rotation.' : 'Marked On LOA — sign-off routing will skip you.', 'success')
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      <span title={`Your access: ${caps}`} className="hidden cursor-help items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 text-xs text-slate-200 sm:flex">
        {avatar ? <img src={avatar} className="h-5 w-5 rounded-full object-cover" alt="" /> : '👤'} {name}
        {profile?.role && <> · <span className="uppercase text-blue-300">{roleShort(profile.role)}</span></>}
      </span>
      {onLoa && (
        <span className="rounded-lg bg-amber-500/15 px-2 py-2 text-[11px] font-semibold uppercase text-amber-300" title="You are marked On LOA">
          On LOA
        </span>
      )}
      <button
        onClick={() => void toggleLoa()}
        className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${
          onLoa
            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/10'
            : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
        }`}
      >
        {onLoa ? 'Clear LOA' : 'Set LOA'}
      </button>
      <button
        onClick={() => void signOut()}
        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
      >
        Sign out
      </button>
    </div>
  )
}

/** Vanilla renders the raw enum in the chip (auth.js:72). */
const roleShort = (r: string) => r

export function Header({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { activeTab } = useNav()
  const meta = PAGE_META[activeTab] ?? PAGE_META.command

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/5 bg-ink-950/70 px-4 py-3.5 backdrop-blur-xl sm:px-8 sm:py-4">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onOpenDrawer}
          className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-850 text-slate-200 transition hover:bg-white/10 lg:hidden"
          aria-label="Open navigation"
          aria-controls="sidebar"
        >
          <MenuIcon />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white sm:text-lg">{meta.title}</h2>
          <p className="truncate text-xs text-slate-400">{meta.sub}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            placeholder="Search cases, drugs, weapons…"
            aria-label="Search records"
            className="w-72 rounded-lg border border-white/10 bg-ink-850 py-2 pl-9 pr-3 text-sm text-slate-200 outline-none transition focus:border-badge-500 focus:ring-2 focus:ring-badge-500/30"
            onKeyDown={(e) => {
              if (e.key === 'Enter') toast('Global search lands with the search slice — not wired yet.', 'info')
            }}
          />
        </div>
        <button
          onClick={() => toast('Notifications land with a later slice — not wired yet.', 'info')}
          className="relative hidden h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-850 text-slate-200 transition hover:bg-white/10 lg:grid"
          aria-label="Notifications"
        >
          <BellIcon />
        </button>
        <div className="hidden flex-shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-ink-850 px-2.5 py-2 text-xs font-medium text-slate-300 sm:flex sm:px-3">
          <span className="pulse-dot h-2 w-2 rounded-full bg-emerald-400" />
          <span className="hidden sm:inline">Secure link active</span>
        </div>
        <AuthBar />
      </div>
    </header>
  )
}
