'use client'

/** My Profile & Settings — the member's own account home, reachable from the
 *  sidebar officer card, the header name, and the Appearance button. Replaces
 *  the former MyProfileModal + AppearanceModal.
 *
 *  Editing stays within what the `guard_profile` DB trigger permits a member
 *  on their own row (display_name, avatar_url, badge_number, loa, discord_id);
 *  role/division/active are shown read-only and are frozen server-side. Saves
 *  use updateNoSelect because the email column is command-only (a member
 *  can't read their own row back). RLS (`profiles_upd_self`) is the real wall;
 *  this page is the convenience. No passwords exist (OAuth / magic-link only),
 *  so Security is read-only. Appearance is device-local (localStorage). */
import { useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { updateNoSelect } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useProfilesStore } from '@/lib/profiles'
import { Store } from '@/lib/store'
import { ACCENTS, DENSITIES, applyAppearance } from '@/lib/appearance'
import { fmConfigured, fmUpload } from '@/lib/fivemanage'
import { safeUrl } from '@/lib/safeUrl'
import { initials } from '@/lib/format'
import { deptLabel, roleLabel } from '@/lib/roles'
import { toast } from '@/lib/toast'

/* eslint-disable @next/next/no-img-element -- small external avatar (OAuth/FiveManage CDN) */

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: '🪪' },
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'account', label: 'Account & security', icon: '🔐' },
  { id: 'notifications', label: 'Notifications', icon: '🔔' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'
const label = 'mb-1 block text-xs font-semibold text-slate-400'

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export function ProfileView() {
  const { profile } = useAuth()
  const sp = useSearchParams()
  const router = useRouter()
  const initial = (sp.get('s') as SectionId) || 'profile'
  const [section, setSection] = useState<SectionId>(SECTIONS.some((s) => s.id === initial) ? initial : 'profile')

  const go = (id: SectionId) => {
    setSection(id)
    const params = new URLSearchParams(sp.toString())
    params.set('s', id)
    router.replace(`/profile?${params.toString()}`)
  }

  if (!profile) {
    return <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-8 text-center text-sm text-slate-400">Sign in to view your profile.</div>
  }

  const avatar = safeUrl(profile.avatar_url ?? '')

  return (
    <div className="space-y-5">
      <IdentityHeader />
      <nav className="flex flex-wrap gap-2" aria-label="Profile sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => go(s.id)}
            aria-current={section === s.id ? 'page' : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
              section === s.id ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </nav>

      {section === 'profile' && <ProfileSection key={profile.updated_at} />}
      {section === 'appearance' && <AppearanceSection />}
      {section === 'account' && <AccountSection />}
      {section === 'notifications' && <NotificationsSection />}
    </div>
  )

  function IdentityHeader() {
    const dot = profile!.loa ? { cls: 'bg-amber-400', t: 'On LOA' } : { cls: 'bg-emerald-400', t: 'On duty' }
    return (
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-ink-900/60 p-5">
        <div className="grid h-20 w-20 flex-shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-600 to-slate-700 text-2xl font-bold text-white">
          {avatar ? <img src={avatar} className="h-20 w-20 rounded-2xl object-cover" alt="" /> : initials(profile!.display_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black text-white">{profile!.display_name || 'Officer'}</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
              <span className={`h-2 w-2 rounded-full ${dot.cls}`} /> {dot.t}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-blue-500/10 px-2 py-1 font-semibold text-blue-200">{roleLabel(profile!.role)}</span>
            <span className="rounded-md bg-white/5 px-2 py-1 font-semibold text-slate-300">{deptLabel(profile!.division)}</span>
            {profile!.badge_number && <span className="rounded-md bg-white/5 px-2 py-1 font-mono text-slate-300">Badge {profile!.badge_number}</span>}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Member since {fmtDate(profile!.created_at)}</p>
        </div>
      </section>
    )
  }
}

/* ---- Profile (editable) -------------------------------------------------- */

function ProfileSection() {
  const { profile, session, refresh } = useAuth()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [name, setName] = useState(profile?.display_name || '')
  const [badge, setBadge] = useState(profile?.badge_number || '')
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '')
  const [discord, setDiscord] = useState(profile?.discord_id || '')
  const [loa, setLoa] = useState(!!profile?.loa)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!profile) return null
  const preview = safeUrl(avatarUrl)

  const dirty =
    name.trim() !== (profile.display_name || '') ||
    badge.trim() !== (profile.badge_number || '') ||
    avatarUrl.trim() !== (profile.avatar_url || '') ||
    discord.trim() !== (profile.discord_id || '') ||
    loa !== !!profile.loa

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast('Pick an image file.', 'warn'); return }
    setUploading(true)
    try {
      const { url } = await fmUpload(file)
      setAvatarUrl(url)
      toast('Image uploaded — Save to apply.', 'success')
    } catch (e) {
      toast(`Upload failed: ${e instanceof Error ? e.message : e}`, 'danger')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const resetToProvider = () => {
    const providerAvatar = (session?.user?.user_metadata?.avatar_url as string | undefined) ?? ''
    setAvatarUrl(providerAvatar)
    toast(providerAvatar ? 'Reset to your sign-in avatar — Save to apply.' : 'No provider avatar on file.', providerAvatar ? 'success' : 'warn')
  }

  const save = async () => {
    if (avatarUrl.trim() && !safeUrl(avatarUrl.trim())) { toast('That avatar URL is not a valid http(s) image link.', 'warn'); return }
    setBusy(true)
    const patch = {
      display_name: name.trim() || profile.display_name,
      badge_number: badge.trim() || null,
      avatar_url: avatarUrl.trim() || null,
      discord_id: discord.trim() || null,
      loa,
      loa_since: loa ? profile.loa_since || new Date().toISOString() : null,
    }
    const res = await updateNoSelect('profiles', profile.id, patch)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Profile saved.', 'success')
    void refresh()
    void fetchProfiles()
  }

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-ink-900/45 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-16 w-16 flex-shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-600 to-slate-700 text-lg font-bold text-white">
          {preview ? <img src={preview} className="h-16 w-16 rounded-2xl object-cover" alt="Avatar preview" /> : initials(name)}
        </div>
        <div className="flex flex-wrap gap-2">
          {fmConfigured() && (
            <>
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-60">
                {uploading ? 'Uploading…' : 'Upload image'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
            </>
          )}
          <button onClick={resetToProvider} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Reset to sign-in avatar</button>
          {avatarUrl && <button onClick={() => setAvatarUrl('')} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">Clear</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="pf-name">Display name</label>
          <input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="pf-badge">Badge number</label>
          <input id="pf-badge" value={badge} onChange={(e) => setBadge(e.target.value)} className={`${input} font-mono`} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="pf-avatar">Avatar URL</label>
          <input id="pf-avatar" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://… (or use Upload above)" className={`${input} font-mono`} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="pf-discord">Discord ID <span className="font-normal text-slate-500">— enables Discord DM notifications</span></label>
          <input id="pf-discord" value={discord} onChange={(e) => setDiscord(e.target.value)} placeholder="your numeric Discord user ID" className={`${input} font-mono`} />
        </div>
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-3 text-sm text-slate-200">
        <input type="checkbox" checked={loa} onChange={(e) => setLoa(e.target.checked)} className="accent-amber-500" />
        <span><b>On Leave of Absence (LOA)</b> — informational. You can still sign in and sign off cases; sign-off auto-routes around you while on LOA.</span>
      </label>

      <div className="flex items-center gap-3">
        <button onClick={() => void save()} disabled={busy || !dirty} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && <span className="text-xs text-slate-500">Unsaved changes</span>}
      </div>
      <p className="text-[11px] text-slate-500">Role, bureau and activation are set by Command and can’t be changed here.</p>
    </section>
  )
}

/* ---- Appearance (device-local) ------------------------------------------ */

function AppearanceSection() {
  const [acc, setAcc] = useState(() => Store.get('accent', 'amber'))
  const [den, setDen] = useState(() => Store.get('density', 'comfortable'))
  const pickAccent = (k: string) => { Store.set('accent', k); setAcc(k); applyAppearance() }
  const pickDensity = (k: string) => { Store.set('density', k); setDen(k); applyAppearance() }

  return (
    <section className="space-y-5 rounded-2xl border border-white/10 bg-ink-900/45 p-5">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Accent</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACCENTS.map(([k, lbl, hex]) => (
            <button key={k} onClick={() => pickAccent(k)} aria-pressed={k === acc}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${k === acc ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              <span className="h-3.5 w-3.5 rounded-full" style={{ background: hex }} /> {lbl}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Density</p>
        <div className="grid grid-cols-2 gap-2">
          {DENSITIES.map(([k, lbl]) => (
            <button key={k} onClick={() => pickDensity(k)} aria-pressed={k === den}
              className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${k === den ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">Saved on this device — applies instantly. The portal uses a single dark theme; a light theme isn’t available.</p>
    </section>
  )
}

/* ---- Account & security (read-only) ------------------------------------- */

function AccountRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 py-2.5 last:border-0">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{k}</span>
      <span className="text-sm text-slate-200">{v}</span>
    </div>
  )
}

function AccountSection() {
  const { profile, session, signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  const user = session?.user
  const providers = (() => {
    const meta = user?.app_metadata as { providers?: string[]; provider?: string } | undefined
    const list = meta?.providers ?? (meta?.provider ? [meta.provider] : [])
    return list.length ? list : ['email']
  })()

  const signOutEverywhere = async () => {
    setBusy(true)
    try { await supabase().auth.signOut({ scope: 'global' }) } catch { /* state resolves via evaluate() */ }
    // Local sign-out too, to drop this device's session immediately.
    await signOut()
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-ink-900/45 p-5">
        <h3 className="mb-1 font-bold text-white">Account</h3>
        <AccountRow k="Email" v={<span className="font-mono">{user?.email || profile?.email || '—'}</span>} />
        <AccountRow k="Sign-in method" v={<span className="flex gap-1.5">{providers.map((p) => <span key={p} className="rounded bg-white/5 px-2 py-0.5 text-xs capitalize text-slate-300">{p}</span>)}</span>} />
        <AccountRow k="Account created" v={fmtDate(profile?.created_at || user?.created_at)} />
        <AccountRow k="Last sign-in" v={fmtDate(user?.last_sign_in_at)} />
        <AccountRow k="User ID" v={<span className="font-mono text-[11px] text-slate-500">{profile?.id}</span>} />
        <p className="mt-3 text-[11px] text-slate-500">Sign-in is handled by your provider (Google, Discord, or an email magic link) — there’s no password to manage here.</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-ink-900/45 p-5">
        <h3 className="mb-2 font-bold text-white">Sessions</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void signOut()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">Sign out</button>
          <button onClick={() => void signOutEverywhere()} disabled={busy} className="rounded-lg border border-rose-400/30 bg-rose-500/5 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/10 disabled:opacity-60">
            {busy ? 'Signing out…' : 'Sign out everywhere'}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">“Everywhere” revokes your sessions on all devices.</p>
      </div>
    </section>
  )
}

/* ---- Notifications (informational) -------------------------------------- */

function NotificationsSection() {
  const { profile } = useAuth()
  const router = useRouter()
  const linked = !!profile?.discord_id
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-ink-900/45 p-5">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <div>
          <p className="font-semibold text-white">In-app notifications</p>
          <p className="text-xs text-slate-400">Mentions, sign-off pings and follows — the 🔔 bell in the top bar. Always on.</p>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300">On</span>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <div>
          <p className="font-semibold text-white">Discord DM notifications</p>
          <p className="text-xs text-slate-400">{linked ? 'Your Discord is linked — eligible notifications are also DM’d to you.' : 'Add your Discord ID on the Profile tab to also receive DMs.'}</p>
        </div>
        {linked
          ? <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300">Linked</span>
          : <button onClick={() => router.replace('/profile?s=profile')} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Link Discord</button>}
      </div>
      <p className="text-[11px] text-slate-500">Per-type notification controls aren’t available yet — they’d sync to your account (a future update).</p>
    </section>
  )
}
