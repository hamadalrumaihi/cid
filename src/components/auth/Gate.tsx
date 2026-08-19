'use client'

/** Login gate — visual + behavioral port of vanilla auth.js showLogin/
 *  showPending/showSetup/showAuthError and the #login-gate markup
 *  (index.html:43-56). Renders the screen for every non-'in' gate state. */
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { isConfigured } from '@/lib/supabase'
import {
  FIELD_AGENCIES, FIELD_AGENCY_NAME, requestFieldAccess, requestProblem,
  withdrawRequest, type FieldAgency,
} from '@/lib/fieldAccess'
import { MembershipRequest } from './MembershipRequest'

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

/** What a brand-new account is asked first.
 *
 *  Before this, everyone who signed in and had no CID profile was shown the CID
 *  membership application and nothing else. A SAHP trooper who only wanted to
 *  send CID a photo had to either apply for an investigator post they were not
 *  asking for, or leave. The two needs are genuinely different, so the screen
 *  asks which one it is rather than assuming.
 *
 *  Somebody who has already asked sees where their request got to instead --
 *  including WHY it was declined, because a decision with no reason is how
 *  people apply four more times. */
function WelcomeFork() {
  const { fieldRequest, refresh } = useAuth()
  const [choice, setChoice] = useState<'none' | 'cid' | 'field'>('none')

  // An outstanding or decided field request replaces the fork: the question has
  // already been answered.
  if (fieldRequest && fieldRequest.status === 'pending') {
    // Withdrawing matters more than it looks: one pending request per person is
    // enforced by a unique index, so somebody who picked the wrong agency is
    // otherwise stuck waiting to be told no before they can correct it.
    const take = async () => {
      const err = await withdrawRequest(fieldRequest.id)
      if (!err) await refresh()
    }
    return (
      <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-4">
        <p className="text-sm font-bold text-blue-100">Request received</p>
        <p className="mt-1 text-sm text-blue-100/90">
          Your Field Intelligence request for {fieldRequest.agency} is with CID. You will
          get access here as soon as it is approved.
        </p>
        <button onClick={() => void take()}
          className="mt-3 text-xs font-semibold text-blue-200 underline">
          Withdraw and start over
        </button>
      </div>
    )
  }
  if (fieldRequest && fieldRequest.status === 'denied') {
    return (
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4">
        <p className="text-sm font-bold text-amber-100">Request not approved</p>
        <p className="mt-1 text-sm text-amber-100/90">
          {fieldRequest.decision_reason?.trim() || 'CID did not approve this request.'}
        </p>
        <button onClick={() => setChoice('field')}
          className="mt-3 text-xs font-semibold text-amber-200 underline">
          Ask again
        </button>
        {choice === 'field' && <FieldAccessForm onDone={() => void refresh()} />}
      </div>
    )
  }

  if (choice === 'cid') return <ApplicationBody />
  if (choice === 'field') return <FieldAccessForm onDone={() => void refresh()} />

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-white">What do you need access for?</p>
      <button onClick={() => setChoice('cid')}
        className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-left transition hover:bg-white/10">
        <span className="block text-sm font-semibold text-white">Join CID / SIU</span>
        <span className="mt-0.5 block text-xs text-slate-400">
          Apply for investigative access.
        </span>
      </button>
      <button onClick={() => setChoice('field')}
        className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-left transition hover:bg-white/10">
        <span className="block text-sm font-semibold text-white">Submit Intelligence</span>
        <span className="mt-0.5 block text-xs text-slate-400">
          For SAHP, BCSO or LSPD personnel who only need to send information and
          evidence to investigators.
        </span>
      </button>
    </div>
  )
}

/** The short form behind "Submit Intelligence". Deliberately four fields: this
 *  is a request for a reporting channel, not a job application. */
function FieldAccessForm({ onDone }: { onDone: () => void }) {
  const { session } = useAuth()
  const [f, setF] = useState({ agency: '', callsign: '', rank: '', unit: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const send = async () => {
    const problem = requestProblem(f.agency)
    if (problem) { setErr(problem); return }
    setBusy(true)
    const e = await requestFieldAccess(
      session?.user?.id ?? '', f.agency as FieldAgency, f.callsign, f.rank, f.unit)
    setBusy(false)
    if (e) { setErr(e); return }
    onDone()
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-slate-400">
        This gives you a way to send information and evidence to CID/SIU. It does not
        give access to case files or the intelligence database.
      </p>
      <select value={f.agency} onChange={(e) => setF({ ...f, agency: e.target.value })}
        className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white">
        <option value="">Your agency…</option>
        {FIELD_AGENCIES.map((a) => (
          <option key={a} value={a}>{a} — {FIELD_AGENCY_NAME[a]}</option>
        ))}
      </select>
      <input value={f.callsign} onChange={(e) => setF({ ...f, callsign: e.target.value })}
        placeholder="Callsign / badge (e.g. 924)"
        className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
      <input value={f.rank} onChange={(e) => setF({ ...f, rank: e.target.value })}
        placeholder="Rank"
        className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
      <input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}
        placeholder="Unit (optional)"
        className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
      {err && <p className="text-xs text-rose-300">{err}</p>}
      <button onClick={() => void send()} disabled={busy}
        className="w-full rounded-lg bg-badge-500/20 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-badge-500/30 disabled:opacity-50">
        {busy ? 'Sending…' : 'Request access'}
      </button>
    </div>
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
      <WelcomeFork />
      <button
        onClick={() => void signOut()}
        className="mt-4 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        Sign out
      </button>
    </>
  )
}

/** First-login application. Legal review folded back into CID (justice
 *  memberships retired), so the Gate offers the single CID department request
 *  — the DOJ/Judiciary domain options are gone. Requesting grants nothing;
 *  the server-side review RPC is the only activation path. */
function ApplicationBody() {
  return <MembershipRequest />
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
