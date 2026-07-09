'use client'

/** Command Center → Duty Status. Readiness board: active vs. on-LOA officers
 *  grouped by bureau. Read-only; LOA is set by the officer (Profile) or by
 *  command (Manage Officer). */
import { useEffect } from 'react'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { BUREAUS, roleLabel } from '@/lib/roles'

const BUREAU_KEYS = ['LSB', 'BCB', 'SAB', 'JTF'] as const

export function DutyStatus() {
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const v = useTableVersion('profiles')
  useEffect(() => { const t = window.setTimeout(() => { void fetchProfiles() }, 0); return () => window.clearTimeout(t) }, [fetchProfiles, v])

  const roster = profiles.filter((p) => !p.removed_at && p.active)
  const onDuty = roster.filter((p) => !p.loa).length
  const onLoa = roster.filter((p) => p.loa).length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4"><p className="font-mono text-2xl font-black text-white">{roster.length}</p><p className="text-xs uppercase tracking-wider text-slate-400">Active</p></div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"><p className="font-mono text-2xl font-black text-emerald-300">{onDuty}</p><p className="text-xs uppercase tracking-wider text-emerald-300/80">On duty</p></div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"><p className="font-mono text-2xl font-black text-amber-300">{onLoa}</p><p className="text-xs uppercase tracking-wider text-amber-300/80">On LOA</p></div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {BUREAU_KEYS.map((b) => {
          const inB = roster.filter((p) => p.division === b)
          return (
            <div key={b} className="rounded-2xl border border-white/10 bg-ink-900/45 p-4">
              <p className="mb-3 font-bold text-white">{b} <span className="text-xs font-normal text-slate-500">· {BUREAUS[b]} · {inB.length} active</span></p>
              <div className="space-y-1.5">
                {inB.length ? inB.slice().sort((a, b2) => Number(a.loa) - Number(b2.loa)).map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-950/50 px-3 py-1.5 text-sm">
                    <span className="flex items-center gap-2 text-slate-200">
                      <span className={`h-2 w-2 rounded-full ${p.loa ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                      {p.display_name} <span className="text-[11px] text-slate-500">{roleLabel(p.role)}</span>
                    </span>
                    {p.loa && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">LOA</span>}
                  </div>
                )) : <p className="text-xs text-slate-500">No active officers.</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
