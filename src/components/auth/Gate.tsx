'use client'

/** Login gate — visual + behavioral port of vanilla auth.js showLogin/
 *  showPending/showSetup/showAuthError and the #login-gate markup
 *  (index.html:43-56). Renders the screen for every non-'in' gate state. */
import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { isConfigured, supabase } from '@/lib/supabase'
import { MembershipRequest } from './MembershipRequest'
import { JusticeMembershipRequest } from './JusticeMembershipRequest'

/** Existence probe for a prior application. Returns the requested agency for
 *  justice requests ('doj' | 'judiciary'), 'cid' for a CID request, or null. */
async function supabaseList(table: 'membership_requests' | 'justice_membership_requests', uid: string): Promise<string | null> {
  const cols = table === 'membership_requests' ? 'id' : 'requested_agency'
  const { data, error } = await supabase().from(table).select(cols).eq('applicant_id', uid).limit(1)
  if (error) throw new Error(error.message)
  const row = (data as Record<string, string>[] | null)?.[0]
  if (!row) return null
  return table === 'membership_requests' ? 'cid' : row.requested_agency
}

function ShieldLogo({ size = 'h-12 w-12' }: { size?: string }) {
  return (
    <div className={`grid ${size} flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-badge-500 to-blue-700 shadow-glow`}>
      <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2.5l8 3v6.5c0 5.2-3.6 8.7-8 9.5-4.4-.8-8-4.3-8-9.5V5.5z" />
        <path d="M12 6l1.2 2.4 2.6.4-1.9 1.9.5 2.6-2.4-1.2-2.4 1.2.5-2.6-1.9-1.9 2.6-.4z" />
        <path d="M8 17h8" />
      </svg>
    </div>
  )
}

function LoginBody() {
  const { signInOAuth, signInEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')

  const oauth = async (provider: 'google' | 'discord') => {
    const r = await signInOAuth(provider)
    if (r.error) setMsg(`${provider === 'google' ? 'Google' : 'Discord'} error: ${r.error.message}`)
  }
  const magic = async () => {
    const em = email.trim()
    if (!em) { setMsg('Enter your email first.'); return }
    const r = await signInEmail(em)
    setMsg(r.error ? `Error: ${r.error.message}` : 'Magic link sent — check your inbox.')
  }

  return (
    <>
      <p className="mb-4 text-sm text-slate-400">Authorized personnel only. Sign in to access the division portal.</p>
      <button
        onClick={() => void oauth('google')}
        className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        Continue with Google
      </button>
      <button
        onClick={() => void oauth('discord')}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
      >
        Continue with Discord
      </button>
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void magic() }}
          placeholder="you@email.com"
          aria-label="Email for magic link"
          className="flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"
        />
        <button
          onClick={() => void magic()}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Email link
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500" role="status">{msg}</p>
    </>
  )
}

function PendingBody() {
  const { session, profile, signOut } = useAuth()
  const who = session?.user?.email || 'Your account'
  // A denied member authenticates but is blocked from the portal and from
  // filing a membership request — the block is enforced server-side (RLS +
  // deny_member_login); this screen just explains it.
  if (profile?.login_denied) {
    return (
      <>
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-4">
          <p className="text-sm font-bold text-rose-200">Access denied</p>
          <p className="mt-1 text-sm text-rose-100/90">
            {profile.login_denied_reason?.trim() || 'Your access to the CID Portal has been denied by Command.'}
          </p>
          <p className="mt-2 text-xs text-rose-200/70">Contact Command if you believe this is a mistake.</p>
        </div>
        <button
          onClick={() => void signOut()}
          className="mt-4 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Sign out
        </button>
      </>
    )
  }
  return (
    <>
      <p className="mb-3 text-xs text-slate-400">Signed in as <b className="text-slate-200">{who}</b></p>
      <ApplicationBody />
      <button
        onClick={() => void signOut()}
        className="mt-4 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        Sign out
      </button>
    </>
  )
}

type ApplyDomain = 'cid' | 'doj' | 'judiciary'

/** Adaptive first-login application (one Gate, three domains). The domain
 *  selector only routes between the CID and justice request flows — picking a
 *  domain or role grants nothing; each flow's server-side review RPC is the
 *  only activation path, and every role/domain combination is revalidated by
 *  DB CHECKs, so edited hidden fields can't request unauthorized roles. */
function ApplicationBody() {
  const { session, profile } = useAuth()
  const uid = session?.user?.id ?? profile?.id ?? null
  const [domain, setDomain] = useState<ApplyDomain | null>(null)
  const [checked, setChecked] = useState(false)

  // Returning applicants land straight on their existing request instead of
  // the domain picker (best effort — a failed lookup just shows the picker).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!uid) { setChecked(true); return }
      try {
        const [cid, justice] = await Promise.all([
          supabaseList('membership_requests', uid),
          supabaseList('justice_membership_requests', uid),
        ])
        if (cancelled) return
        if (justice) setDomain(justice === 'judiciary' ? 'judiciary' : 'doj')
        else if (cid) setDomain('cid')
      } catch { /* picker is the safe default */ }
      if (!cancelled) setChecked(true)
    })()
    return () => { cancelled = true }
  }, [uid])

  if (!checked) return <p className="text-sm text-slate-400">Loading your application…</p>

  if (!domain) {
    const options: { id: ApplyDomain; title: string; sub: string }[] = [
      { id: 'cid', title: 'CID', sub: 'Criminal Investigation Division — Detective / Senior Detective' },
      { id: 'doj', title: 'DOJ', sub: 'Department of Justice — ADA, District Attorney, Attorney General' },
      { id: 'judiciary', title: 'Judiciary', sub: 'The courts — Judge' },
    ]
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-400">
          Choose the role you are applying for. Your selection does not grant access immediately —
          an authorized reviewer must approve your request and may adjust the final role before activation.
        </p>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">I am applying to join:</p>
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => setDomain(o.id)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-badge-500/50 hover:bg-white/10"
          >
            <span className="block text-sm font-bold text-white">{o.title}</span>
            <span className="mt-0.5 block text-xs text-slate-400">{o.sub}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setDomain(null)}
        className="text-xs font-semibold text-slate-400 transition hover:text-white"
      >
        ← Applying to {domain === 'cid' ? 'CID' : domain === 'doj' ? 'DOJ' : 'the Judiciary'} — change
      </button>
      {domain === 'cid'
        ? <MembershipRequest />
        : <JusticeMembershipRequest initialAgency={domain} />}
    </div>
  )
}

function ErrorBody() {
  const { refresh } = useAuth()
  return (
    <>
      <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
        Couldn’t verify your account (network hiccup?). Your session is fine — try again.
      </div>
      <button
        onClick={() => void refresh()}
        className="mt-4 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        Retry
      </button>
    </>
  )
}

// The env-var detail stays out of the UI (visitors can't act on it); surface
// it for whoever operates the deployment via the console instead.
if (typeof window !== 'undefined' && !isConfigured) {
  console.error('CID Portal: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to this project’s publishable values — sign-in is disabled until then.')
}

function SetupBody() {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
      {isConfigured
        ? 'The authentication service could not load (offline?). Reconnect to sign in.'
        : 'The portal isn’t fully set up yet — contact the portal owner.'}
    </div>
  )
}

export function Gate() {
  const { state } = useAuth()
  return (
    // The gate replaces the app shell (and its <main>) while signed out /
    // booting, so it supplies the page's sole main landmark itself.
    <main className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
      <div className="gate-boot w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-8 shadow-glow">
        <div className="mb-6 flex items-center gap-3">
          <ShieldLogo />
          <div>
            <h1 className="text-lg font-bold text-white">CID Portal</h1>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-blue-300/70">San Andreas · Secure Access</p>
          </div>
        </div>
        <p className="t-readout mb-4 flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] uppercase tracking-widest text-amber-300/90">
          <span className="t-dot t-dot-amber pulse-dot" /> Authorized personnel only // All access is logged
        </p>
        <div>
          {state === 'loading' && <p className="text-sm text-slate-400">Initializing secure session…</p>}
          {state === 'setup' && <SetupBody />}
          {state === 'out' && <LoginBody />}
          {state === 'pending' && <PendingBody />}
          {state === 'error' && <ErrorBody />}
        </div>
      </div>
    </main>
  )
}
