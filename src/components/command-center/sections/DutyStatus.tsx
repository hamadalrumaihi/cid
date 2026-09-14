'use client'

/** Command Center → Duty Status. An availability EXCEPTIONS board: the
 *  numbers command needs, who is unavailable, and where the division is thin.
 *
 *  It used to print a second complete roster — every active member of every
 *  bureau, beside a Division Directory that does the same job for the whole
 *  division. Two lists of the same people drift and disagree; this one keeps
 *  the part command cannot get elsewhere (the exceptions) and hands the
 *  browsing back to the directory, and the acting to Personnel Management.
 *
 *  Read-only: LOA is set by the member (Profile / the directory) or by
 *  command (Personnel & Admin → Manage Officer). */
import { useEffect } from 'react'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { BUREAUS, bureauShort, roleLabel } from '@/lib/roles'
import { fmtDate } from '@/lib/format'
import { useNav } from '@/components/shell/useNav'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { ErrorNotice } from '@/components/ui/Notice'
import { SectionHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'

// SIB is deliberately absent: its roster is compartmented and never shown on
// the general readiness board. JTF stays — members can hold the temporary
// joint-case designation as their division.
const BUREAU_KEYS = ['major_crimes', 'street_crimes', 'JTF'] as const

export function DutyStatus({ onGo }: { onGo?: (section: string) => void }) {
  const { navigate } = useNav()
  const profiles = useProfilesStore((s) => s.profiles)
  const loaded = useProfilesStore((s) => s.loaded)
  const loading = useProfilesStore((s) => s.loading)
  const error = useProfilesStore((s) => s.error)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const v = useTableVersion('profiles')
  useEffect(() => { const t = window.setTimeout(() => { void fetchProfiles() }, 0); return () => window.clearTimeout(t) }, [fetchProfiles, v])

  const roster = profiles.filter((p) => !p.removed_at && !p.is_system && p.active)
  const away = roster.filter((p) => p.loa)
  const onDuty = roster.length - away.length

  if (!loaded && loading) return <ListSkeleton count={4} />

  return (
    <div className="space-y-5">
      {error && <ErrorNotice message={error} onRetry={() => { void fetchProfiles() }} />}

      <div className="grid grid-cols-3 gap-3">
        <Card pad="sm"><p className="font-mono text-2xl font-semibold text-white">{roster.length}</p><p className="text-xs font-medium text-slate-400">Active</p></Card>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4"><p className="font-mono text-2xl font-semibold text-emerald-300">{onDuty}</p><p className="text-xs font-medium text-emerald-300/80">On duty</p></div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4"><p className="font-mono text-2xl font-semibold text-amber-300">{away.length}</p><p className="text-xs font-medium text-amber-300/80">On LOA</p></div>
      </div>

      {/* The exception: who command cannot count on this week. */}
      <section>
        <SectionHeader title="Unavailable" subtitle="Members on leave, with the bureau they are away from." className="mb-2" />
        {away.length === 0 ? (
          <Card pad="sm" className="text-sm text-slate-400">Everyone is available — no one is on LOA.</Card>
        ) : (
          <Card pad="none">
            <ul className="divide-y divide-white/5">
              {away.slice().sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">{p.display_name}</span>
                    <span className="block truncate text-xs text-slate-400">
                      {roleLabel(p.role)} · {bureauShort(p.division)}
                      {p.loa_since && <> · since {fmtDate(p.loa_since)}</>}
                    </span>
                  </span>
                  <Badge tone="warn">On LOA</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Staffing shape, as counts — the bureau that is thin is a command
          fact; the names in it are the directory's. */}
      <section>
        <SectionHeader title="Bureau availability" className="mb-2" />
        <div className="grid gap-3 sm:grid-cols-3">
          {BUREAU_KEYS.map((b) => {
            const inB = roster.filter((p) => p.division === b)
            const bAway = inB.filter((p) => p.loa).length
            return (
              <Card key={b} pad="sm">
                <p className="text-sm font-bold text-white">{bureauShort(b)}</p>
                <p className="text-[11px] text-slate-500">{BUREAUS[b]}</p>
                <p className="mt-2 font-mono text-lg text-white">
                  {inB.length - bAway}<span className="text-sm text-slate-500"> / {inB.length} available</span>
                </p>
                {inB.length === 0 && <p className="mt-1 text-xs text-amber-300">No active members assigned.</p>}
              </Card>
            )
          })}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => navigate('directory')}>
          Open the Division Directory
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => (onGo ? onGo('personnel') : navigate('command-center'))}
        >
          Personnel &amp; Admin
        </Button>
      </div>
    </div>
  )
}
