'use client'

/** Command Center → Chain of Command. Renders the live org hierarchy from the
 *  roster: Owner (flag) → Director → Deputy Directors → Bureau Leads (per
 *  bureau) → senior detectives / detectives, and shows the case sign-off
 *  approval chain. Read-only — a picture of the structure, not an editor. */
import { useEffect } from 'react'
import { useProfilesStore, type RosterProfile } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { BUREAUS, DEPT_OF_BUREAU, roleLabel } from '@/lib/roles'
import { initials } from '@/lib/format'

const BUREAU_KEYS = ['LSB', 'BCB', 'SAB', 'JTF'] as const

function Person({ p }: { p: RosterProfile }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-ink-950/50 px-2.5 py-1.5 text-sm">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-[10px] font-bold text-white">{initials(p.display_name)}</span>
      <span className="text-white">{p.display_name}</span>
      {p.loa && <span className="rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase text-amber-300">LOA</span>}
    </span>
  )
}

function Tier({ title, people, tint }: { title: string; people: RosterProfile[]; tint: string }) {
  return (
    <div className={`rounded-xl border ${tint} p-3`}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-300">{title} <span className="text-slate-500">({people.length})</span></p>
      {people.length ? <div className="flex flex-wrap gap-2">{people.map((p) => <Person key={p.id} p={p} />)}</div> : <p className="text-xs text-slate-500">Vacant.</p>}
    </div>
  )
}

export function ChainOfCommand() {
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const v = useTableVersion('profiles')
  useEffect(() => { const t = window.setTimeout(() => { void fetchProfiles() }, 0); return () => window.clearTimeout(t) }, [fetchProfiles, v])

  const roster = profiles.filter((p) => !p.removed_at && p.active)
  const byRole = (r: string) => roster.filter((p) => p.role === r)
  const owners = roster.filter((p) => p.is_owner)

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {owners.length > 0 && <Tier title="Owner (portal administrator)" people={owners} tint="border-fuchsia-500/25 bg-fuchsia-500/5" />}
        <Tier title="Director" people={byRole('director')} tint="border-rose-500/25 bg-rose-500/5" />
        <Tier title="Deputy Directors" people={byRole('deputy_director')} tint="border-amber-500/25 bg-amber-500/5" />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Bureau Leads &amp; personnel</p>
        <div className="grid gap-3 md:grid-cols-2">
          {BUREAU_KEYS.map((b) => {
            const inB = roster.filter((p) => p.division === b)
            const leads = inB.filter((p) => p.role === 'bureau_lead')
            const seniors = inB.filter((p) => p.role === 'senior_detective')
            const dets = inB.filter((p) => p.role === 'detective')
            return (
              <div key={b} className="rounded-2xl border border-white/10 bg-ink-900/45 p-4">
                <p className="font-bold text-white">{b} <span className="text-xs font-normal text-slate-500">· {BUREAUS[b]} ({DEPT_OF_BUREAU[b]})</span></p>
                <div className="mt-3 space-y-3">
                  <Tier title="Bureau Lead" people={leads} tint="border-blue-500/25 bg-blue-500/5" />
                  <Tier title="Senior Detectives" people={seniors} tint="border-white/10 bg-white/5" />
                  <Tier title="Detectives" people={dets} tint="border-white/10 bg-white/5" />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-ink-900/45 p-4">
        <h3 className="mb-2 font-bold text-white">Case sign-off chain</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {['Detective (submits)', 'Bureau Lead', 'Deputy Director', 'Director'].map((step, i) => (
            <span key={step} className="flex items-center gap-2">
              {i > 0 && <span className="text-slate-600" aria-hidden>→</span>}
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-semibold text-slate-200">{roleLabel(step) === step ? step : roleLabel(step)}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">A Bureau Lead approves only cases in their own bureau; the Deputy stage has an owner stop-point; the Director stage is final. Enforced server-side by the <code>signoff_decide</code> RPC.</p>
      </div>
    </div>
  )
}
