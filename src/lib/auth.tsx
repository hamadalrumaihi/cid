'use client'

/** Auth gate state machine + session/profile context — ported from vanilla
 *  auth.js evaluate()/boot() and the CIDDB auth surface (supabase.js:19-53).
 *
 *  Gate states (drives which screen the app layout renders):
 *    loading — first evaluation in flight (vanilla: "Initializing secure session…")
 *    setup   — Supabase env missing (vanilla: CIDDB not ready)
 *    out     — no session → login screen
 *    pending — signed in, profile missing or !active → pending-approval screen
 *    error   — profile fetch failed (network blip) → retry screen, NOT pending
 *    in      — active member → the app
 *
 *  Client gating is UX only; RLS is the authority for every data access. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, supabase } from './supabase'
import type { Database } from './database.types'
import { isCommandRole } from './roles'
import { resetRealtime } from './realtime'
import { installErrorReporter } from './errorReport'

type ProfileRow = Database['public']['Tables']['profiles']['Row']

/** Column projection for profile reads. profiles.email is column-restricted to
 *  command (restrict_profile_email migration) — selecting it as a regular
 *  member would be DENIED, so it is never in this list; a member's own email
 *  comes from the auth session instead (vanilla supabase.js:36-45). */
export const PROFILE_COLS =
  'id,display_name,avatar_url,badge_number,division,role,active,created_at,updated_at,loa,loa_since,discord_id,is_owner,login_denied,login_denied_reason' as const

export type Profile = Pick<
  ProfileRow,
  | 'id' | 'display_name' | 'avatar_url' | 'badge_number' | 'division' | 'role'
  | 'active' | 'created_at' | 'updated_at' | 'loa' | 'loa_since' | 'discord_id'
  | 'is_owner' | 'login_denied' | 'login_denied_reason'
> & { email?: string | null }

export type GateState = 'loading' | 'setup' | 'out' | 'pending' | 'error' | 'in'

/** Justice identity (justice_memberships) — a SEPARATE authorization domain
 *  from the CID role. An active justice member passes the gate even with an
 *  inactive CID profile (they get the Justice portal, never the CID shell);
 *  both identities stay independently authorized for dual-identity users. */
export interface JusticeIdentity {
  agency: 'doj' | 'judiciary'
  justice_role: string
  active: boolean
  justice_identifier: string | null
}

interface AuthContextValue {
  state: GateState
  session: Session | null
  profile: Profile | null
  justice: JusticeIdentity | null
  /** Active justice role, or null — the UX mirror of private.justice_role(). */
  justiceRole: string | null
  /** Re-run the gate evaluation (retry button, post-mutation refresh). */
  refresh: () => Promise<void>
  signInOAuth: (provider: 'google' | 'discord') => Promise<{ error: { message: string } | null }>
  signInEmail: (email: string) => Promise<{ error: { message: string } | null }>
  signOut: () => Promise<void>
  setMyLoa: (on: boolean) => Promise<{ error: { message: string } | null }>
  /** UX-only role gates — mirror vanilla CIDDB.isAdmin/canDelete/canEdit
   *  (supabase.js:51-53). RLS enforces the real rules server-side. */
  canEdit: boolean
  canDelete: boolean
  isCommand: boolean
  /** Project owner (profiles.is_owner, granted via SQL only — the
   *  guard_profile trigger blocks any client write). Gates the Owner
   *  Portal, Developer Handbook, Audit Log and feedback triage; RLS
   *  (private.is_owner()) enforces the data side. */
  isOwner: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Returns the row, or null for a genuinely-missing profile (unapproved/new).
 *  THROWS on a real query error so the gate shows a retry notice instead of
 *  mistaking a transient network blip for "not yet approved". */
async function fetchProfile(uid: string): Promise<Profile | null> {
  const { data, error } = await supabase()
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('id', uid)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Profile | null) ?? null
}

/** Own justice membership (RLS: self-select is always allowed). Missing row
 *  is the normal case for CID members; errors throw like fetchProfile so the
 *  gate retries instead of silently locking a justice user out. */
async function fetchJustice(uid: string): Promise<JusticeIdentity | null> {
  const { data, error } = await supabase()
    .from('justice_memberships')
    .select('agency,justice_role,active,justice_identifier')
    .eq('user_id', uid)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as JusticeIdentity | null) ?? null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>(isConfigured ? 'loading' : 'setup')
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [justice, setJustice] = useState<JusticeIdentity | null>(null)
  // Serialize evaluations: auth events can burst (INITIAL_SESSION + SIGNED_IN);
  // a stale earlier evaluation must not overwrite a newer result.
  const evalSeq = useRef(0)
  // User id the gate last settled to 'in' for — lets the auth listener treat
  // the hourly TOKEN_REFRESHED as token-only (skip the profile/justice
  // refetch). Cleared on every non-'in' outcome so pending/error users keep
  // the old re-evaluate-on-refresh behavior (it can pick up an approval).
  const settledUser = useRef<string | null>(null)

  const evaluate = useCallback(async () => {
    // 'setup' (env missing) is covered by the state initializer — nothing to
    // re-evaluate, and no state is written before the first await so the
    // initial call from the effect stays purely async.
    if (!isConfigured) return
    const seq = ++evalSeq.current
    const stale = () => seq !== evalSeq.current

    let s: Session | null = null
    try { s = (await supabase().auth.getSession()).data.session } catch { s = null }
    if (stale()) return
    setSession(s)

    if (!s) {
      // Signed out: drop the cached identity and tear down realtime so a
      // different account on a shared browser doesn't inherit state.
      settledUser.current = null
      setProfile(null)
      setJustice(null)
      try { supabase().removeAllChannels() } catch { /* no channels yet */ }
      resetRealtime()
      setState('out')
      return
    }

    let p: Profile | null = null
    let j: JusticeIdentity | null = null
    try { [p, j] = await Promise.all([fetchProfile(s.user.id), fetchJustice(s.user.id)]) }
    catch { if (!stale()) { settledUser.current = null; setState('error') } return } // transient — offer retry
    if (stale()) return

    // Own email is not selectable from profiles (command-only column); take it
    // from the auth session so the officer's own card still shows it.
    if (p && s.user.email) p = { ...p, email: s.user.email }
    setProfile(p)
    setJustice(j)

    // A login-denied profile blocks BOTH identities (the deny gate screen
    // renders in PendingBody); otherwise an active justice membership passes
    // the gate on its own — the layout routes those users to the Justice
    // portal, never the CID shell.
    if (p?.login_denied) { settledUser.current = null; setState('pending'); return }
    if (j?.active && !(p && p.active)) { settledUser.current = s.user.id; setState('in'); return }
    if (p && p.active) {
      settledUser.current = s.user.id
      setState('in')
      // Capture the Discord user id (for DM notifications) from a Discord
      // OAuth identity — fire-and-forget, best effort (vanilla auth.js:130-138).
      try {
        const disc = (s.user.identities ?? []).find((i) => i.provider === 'discord')
        const did = disc && ((disc.identity_data?.provider_id as string | undefined) ?? (disc.identity_data?.sub as string | undefined) ?? disc.id)
        if (did && !p.discord_id) {
          void supabase().from('profiles').update({ discord_id: String(did) }).eq('id', p.id)
            .then(() => setProfile((prev) => (prev ? { ...prev, discord_id: String(did) } : prev)))
        }
      } catch { /* capture is best-effort */ }
    } else {
      settledUser.current = null
      setState('pending')
    }
  }, [])

  useEffect(() => {
    if (!isConfigured) return
    installErrorReporter()
    // supabase-js fires INITIAL_SESSION on subscribe, so this one callback
    // covers boot AND every later auth event (sign-in, sign-out, hourly
    // token refresh) — the versions of vanilla boot() + onAuth() combined.
    const { data: sub } = supabase().auth.onAuthStateChange((event, s) => {
      // TOKEN_REFRESHED only rotates the access token — same user, same
      // profile. Re-running evaluate() would refetch profile + justice and
      // churn every auth consumer hourly for no new information, so when the
      // gate already settled to 'in' for this exact user just store the fresh
      // session. Every other event (INITIAL_SESSION, SIGNED_IN, SIGNED_OUT,
      // USER_UPDATED) — and a refresh while pending/error, where re-evaluating
      // can pick up an approval or recover from a blip — still evaluates.
      if (event === 'TOKEN_REFRESHED' && s && s.user.id === settledUser.current) {
        setSession(s)
        return
      }
      void evaluate()
    })
    return () => sub.subscription.unsubscribe()
  }, [evaluate])

  const signInOAuth = useCallback(async (provider: 'google' | 'discord') => {
    const { error } = await supabase().auth.signInWithOAuth({
      provider,
      // Same redirect target as vanilla (supabase.js:25): current URL sans hash.
      options: { redirectTo: window.location.href.split('#')[0] },
    })
    return { error: error ? { message: error.message } : null }
  }, [])

  const signInEmail = useCallback(async (email: string) => {
    const { error } = await supabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split('#')[0] },
    })
    return { error: error ? { message: error.message } : null }
  }, [])

  const signOut = useCallback(async () => {
    try { await supabase().auth.signOut() } catch { /* evaluate() handles state */ }
  }, [])

  /** LOA self-service (vanilla signoff.js setMyLoa): flips profiles.loa and
   *  stamps loa_since; sign-off routing skips LOA reviewers server-side. */
  const setMyLoa = useCallback(async (on: boolean) => {
    if (!profile) return { error: { message: 'Not signed in.' } }
    const { error } = await supabase()
      .from('profiles')
      .update({ loa: on, loa_since: on ? new Date().toISOString() : null })
      .eq('id', profile.id)
      // returning * would be denied by the email column grant — select non-email cols
      .select(PROFILE_COLS)
    if (error) return { error: { message: error.message } }
    setProfile((prev) => (prev ? { ...prev, loa: on, loa_since: on ? new Date().toISOString() : null } : prev))
    return { error: null }
  }, [profile])

  // Memoized so consumers (and modals with inline props) don't re-render on
  // every provider render — only on real auth-state changes.
  const value = useMemo<AuthContextValue>(() => {
    const active = !!profile?.active
    return {
      state, session, profile,
      justice,
      justiceRole: justice?.active ? justice.justice_role : null,
      refresh: evaluate,
      signInOAuth, signInEmail, signOut, setMyLoa,
      canEdit: active,
      canDelete: active && isCommandRole(profile?.role),
      isCommand: active && isCommandRole(profile?.role),
      isOwner: active && !!profile?.is_owner,
    }
  }, [state, session, profile, justice, evaluate, signInOAuth, signInEmail, signOut, setMyLoa])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
