'use client'

/** Standalone shell for justice-only users (active justice membership, no
 *  active CID profile). They never see the CID navigation — the portal IS
 *  their app: header, role identity, notifications-free minimal chrome, and
 *  sign-out. Dual-identity users (CID-active too) instead reach the portal
 *  through the CID sidebar's Justice Portal leaf. */
import { useAuth } from '@/lib/auth'
import { justiceRoleLabel } from '@/lib/justice'
import { JusticePortalView } from './JusticePortalView'

export function JusticeShell() {
  const { profile, session, justice, signOut } = useAuth()
  const who = profile?.display_name || session?.user?.email || 'Justice member'

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 text-lg" aria-hidden>⚖️</div>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-sm font-bold text-white">Justice Portal · San Andreas</h1>
            <p className="text-[11px] text-slate-400">
              {who} — {justiceRoleLabel(justice?.justice_role)}
            </p>
          </div>
          <span className="flex-1" />
          <button
            onClick={() => void signOut()}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <JusticePortalView />
      </main>
    </div>
  )
}
