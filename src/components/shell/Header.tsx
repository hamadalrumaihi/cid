'use client'

/** Top bar — port of the vanilla <header> (index.html:136-160) + the auth
 *  slot auth.js showApp() renders into it (role-caps chip, LOA, sign out).
 *  Global search: Enter in the box (or Cmd/Ctrl-K anywhere) opens the search
 *  palette; `/` focuses the box (vanilla parity). Bell: NotificationsBell. */
import { useEffect, useRef, useState } from 'react'
import { NAV_CATEGORIES, PAGE_META, TAB_CATEGORY } from '@/lib/nav'
import { useAuth } from '@/lib/auth'
import { roleLabel } from '@/lib/roles'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { CreateMenuButton } from './CreateHost'
import { MenuIcon, PersonIcon, SearchIcon } from './icons'
import { NotificationsBell } from './NotificationsBell'
import { SearchPalette } from './SearchPalette'
import { useNav } from './useNav'

/* eslint-disable @next/next/no-img-element -- tiny external avatar, see Sidebar */

/** Access summary per role — vanilla auth.js:62-68. */
const ROLE_CAPS: Record<string, string> = {
  detective: 'View & edit records, add case photos, author reports, submit cases for sign-off.',
  senior_detective: 'View & edit records, add case photos, author reports, submit cases for sign-off.',
  bureau_lead: 'All detective actions + review/approve sign-offs, delete records, manage announcements (your bureau).',
  deputy_director: 'Bureau-lead actions + cross-bureau oversight and command tools.',
  director: 'Full command: cross-bureau oversight, sign-offs, deletes, roster & announcements.',
}

function AuthBar() {
  const { profile, session, signOut, setMyLoa } = useAuth()
  const { navigate } = useNav()
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
    <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
      <button
        onClick={() => navigate('profile')}
        title={`Open your profile · ${caps}`}
        className="hidden items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-200 transition hover:bg-white/5 sm:flex"
      >
        {avatar
          ? <img src={avatar} className="h-5 w-5 rounded-full object-cover" alt="" />
          : <span className="grid h-5 w-5 place-items-center rounded-full bg-ink-700 text-slate-300"><PersonIcon size={12} /></span>}
        {name}
        {profile?.role && <span className="text-slate-500">· {roleShort(profile.role)}</span>}
      </button>
      {onLoa && (
        <span className="rounded-lg bg-amber-500/15 px-2 py-2 text-[11px] font-semibold uppercase text-amber-300" title="You are marked On LOA">
          On LOA
        </span>
      )}
      <button
        onClick={() => void toggleLoa()}
        aria-label={onLoa ? 'Clear LOA' : 'Set LOA'}
        className={`rounded-lg border px-2 py-2 text-xs font-semibold transition sm:px-2.5 ${
          onLoa
            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/10'
            : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
        }`}
      >
        <span className="hidden sm:inline">{onLoa ? 'Clear LOA' : 'Set LOA'}</span>
        <span aria-hidden className="sm:hidden">LOA</span>
      </button>
      <button
        onClick={() => void signOut()}
        className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs font-semibold text-white transition hover:bg-white/10 sm:px-2.5"
      >
        Sign out
      </button>
    </div>
  )
}

/** Human label in the chip (the raw enum read as debug output). */
const roleShort = (r: string) => roleLabel(r)

export function Header({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { activeTab } = useNav()
  const meta = PAGE_META[activeTab] ?? PAGE_META.command
  // Breadcrumb context: the owning nav category, when the tab has one. The
  // page itself renders its own <h1>; the bar shows where you are, once.
  const catLabel = NAV_CATEGORIES.find((c) => c.id === TAB_CATEGORY[activeTab])?.label
  const searchRef = useRef<HTMLInputElement>(null)
  const [palette, setPalette] = useState<{ open: boolean; query: string }>({ open: false, query: '' })

  // Global hotkeys (vanilla parity): Cmd/Ctrl-K opens the palette anywhere;
  // `/` focuses the header search box when not already typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        // Already open → leave state (and the typed query) alone; the palette's
        // own listener refocuses its input instead of blanking the search.
        setPalette((p) => (p.open ? p : { open: true, query: '' }))
        return
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
        // Never hijack `/` out from under an open modal/dialog (the palette
        // included) — stealing focus there would break its focus trap.
        if (!typing && !document.querySelector('[role="dialog"]')) {
          e.preventDefault()
          searchRef.current?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    // z-30: above in-page sticky bars (z-10/z-20), tied with BottomNav (never
    // overlaps it), below the sidebar (z-40) and modals (z-50+). Height is
    // published as --app-header-h in globals.css — keep them in step.
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-white/5 bg-ink-950/90 px-3 backdrop-blur sm:gap-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          onClick={onOpenDrawer}
          className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-white/5 lg:hidden"
          aria-label="Open navigation"
          aria-controls="sidebar"
        >
          <MenuIcon />
        </button>
        <div className="flex min-w-0 items-baseline gap-2" title={meta.sub}>
          {catLabel && catLabel !== meta.title && (
            <>
              <span className="hidden flex-shrink-0 text-sm text-slate-500 sm:inline">{catLabel}</span>
              <span aria-hidden className="hidden flex-shrink-0 text-sm text-slate-600 sm:inline">/</span>
            </>
          )}
          <h2 className="truncate text-sm font-semibold text-white">{meta.title}</h2>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
        <div className="relative hidden lg:block">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1.5 py-0.5 font-sans text-[10px] font-medium text-slate-500">⌘K</kbd>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search cases, people, records…"
            aria-label="Search records"
            className="w-72 rounded-lg border border-white/10 bg-ink-900 py-1.5 pl-9 pr-12 text-sm text-slate-200 outline-none transition focus:border-badge-500 focus:ring-2 focus:ring-badge-500/30"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const q = (e.target as HTMLInputElement).value.trim()
                setPalette({ open: true, query: q })
              }
            }}
          />
        </div>
        {/* Below lg the full search box is hidden — this icon opens the same
            palette so mobile/tablet keep a search entry point (⌘K is desktop-only).
            The box only appears at lg where the top bar has room for its width. */}
        <button
          onClick={() => setPalette({ open: true, query: '' })}
          aria-label="Search records"
          className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-white/5 lg:hidden"
        >
          <SearchIcon className="h-5 w-5" />
        </button>
        <SearchPalette open={palette.open} initialQuery={palette.query} onClose={() => setPalette({ open: false, query: '' })} />
        {/* Universal + Create (permission-gated menu → CreateHost modals). It
            took the decorative "Secure link active" chip's slot. */}
        <CreateMenuButton />
        <NotificationsBell />
        <AuthBar />
      </div>
    </header>
  )
}
