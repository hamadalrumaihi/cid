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

type ProfileRow = Database['public']['Tables']['profiles']['Row']

/** Column projection for profile reads. profiles.email is column-restricted to
 *  command (restrict_profile_email migration) — selecting it as a regular
 *  member would be DENIED, so it is never in this list; a member's own email
 *  comes from the auth session instead (vanilla supabase.js:36-45). */
export const PROFILE_COLS =
  'id,display_name,avatar_url,badge_number,division,role,active,created_at,updated_at,loa,loa_since,discord_id' as const

export type Profile = Pick<
  ProfileRow,
  | 'id' | 'display_name' | 'avatar_url' | 'badge_number' | 'division' | 'role'
  | 'active' | 'created_at' | 'updated_at' | 'loa' | 'loa_since' | 'discord_id'
> & { email?: string | null }

export type GateState = 'loading' | 'setup' | 'out' | 'pending' | 'error' | 'in'

interface AuthContextValue {
  state: GateState
  session: Session | null
  profile: Profile | null
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>(isConfigured ? 'loading' : 'setup')
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  // Serialize evaluations: auth events can burst (INITIAL_SESSION + SIGNED_IN);
  // a stale earlier evaluation must not overwrite a newer result.
  const evalSeq = useRef(0)

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
      setProfile(null)
      try { supabase().removeAllChannels() } catch { /* no channels yet */ }
      resetRealtime()
      setState('out')
      return
    }

    let p: Profile | null = null
    try { p = await fetchProfile(s.user.id) }
    catch { if (!stale()) setState('error'); return } // transient — offer retry
    if (stale()) return

    // Own email is not selectable from profiles (command-only column); take it
    // from the auth session so the officer's own card still shows it.
    if (p && s.user.email) p = { ...p, email: s.user.email }
    setProfile(p)

    if (p && p.active) {
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
      setState('pending')
    }
  }, [])

  useEffect(() => {
    if (!isConfigured) return
    // supabase-js fires INITIAL_SESSION on subscribe, so this one callback
    // covers boot AND every later auth event (sign-in, sign-out, hourly
    // token refresh) — the versions of vanilla boot() + onAuth() combined.
    const { data: sub } = supabase().auth.onAuthStateChange(() => { void evaluate() })
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
      refresh: evaluate,
      signInOAuth, signInEmail, signOut, setMyLoa,
      canEdit: active,
      canDelete: active && isCommandRole(profile?.role),
      isCommand: active && isCommandRole(profile?.role),
    }
  }, [state, session, profile, evaluate, signInOAuth, signInEmail, signOut, setMyLoa])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
