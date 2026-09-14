'use client'

/** Division Directory — who is in CID, where they are assigned, and whether
 *  they are available. Every active member reads it.
 *
 *  It replaced the Command-category "Personnel & Roster" screen, and the split
 *  is the point: this is the division looking at itself, while member
 *  ADMINISTRATION — approvals, transfers, rank changes, account state, LOA
 *  administration, personnel history — lives in the Command Center behind
 *  `private.is_command()`. Nothing command-only is rendered here and nothing
 *  command-only is read: the rows come from the shared roster projection,
 *  which omits `profiles.email` because that column is granted to command
 *  alone. RLS remains the authority; this screen hides nothing that the
 *  database would have handed over.
 *
 *  Live by construction — see useDivisionDirectory. */
import { useMemo, useState } from 'react'
import { initials } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import {
  DIRECTORY_STATUS_LABEL, EMPTY_DIRECTORY_FILTERS, buildDirectory, filterDirectory, isFiltering,
  type DirectoryBureau, type DirectoryFilters, type DirectoryGroup, type DirectoryMember, type DirectoryStatus,
} from '@/lib/directory'
import { ROLE_ORDER, roleLabel } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { useNav } from '@/components/shell/useNav'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import { MetricStrip } from '@/components/ui/MetricStrip'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Commendations } from './Commendations'
import { useDivisionDirectory } from './useDivisionDirectory'

/** Status chips carry their own word — a colour alone is not a status. */
const STATUS_TONE: Record<DirectoryStatus, 'good' | 'warn' | 'neutral'> = {
  active: 'good', loa: 'warn', inactive: 'neutral',
}

type ViewMode = 'grouped' | 'list'

export function DirectoryView() {
  const { state, profile: me } = useAuth()
  const { navigate } = useNav()
  const { directory, commendations, loading, refreshing, error, connection, refresh } = useDivisionDirectory()
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_DIRECTORY_FILTERS)
  const [mode, setMode] = useState<ViewMode>('grouped')

  const view = useMemo(() => filterDirectory(directory, filters), [directory, filters])
  const filtering = isFiltering(filters)
  const set = <K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }))

  if (state !== 'in') {
    return (
      <section className="view-in space-y-5">
        <PageHeader title="Division Directory" subtitle="Current active members, assignments and availability" />
        <Notice text="Sign in to view the Division Directory." />
      </section>
    )
  }

  const populated = directory.matches > 0
  // A failed read with nothing in hand is NOT an empty division: the bureau
  // groups, the zeroed summary and the "no members" copy would all be lies
  // told confidently. The error is the whole body until something loads.
  const unavailable = !!error && !populated
  const unknown = loading || unavailable

  return (
    <section className="view-in space-y-5">
      <PageHeader
        title="Division Directory"
        subtitle="Current active members, assignments and availability"
        actions={
          <div className="flex items-center gap-2">
            {refreshing && <span className="text-xs text-slate-500">Updating…</span>}
            <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5" role="group" aria-label="Directory layout">
              {(['grouped', 'list'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`min-h-[36px] rounded-md px-3 text-xs font-semibold transition ${
                    mode === m ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m === 'grouped' ? 'By bureau' : 'Compact list'}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* Live-update health. Stale data that looks live is worse than data
          that says it is stale. */}
      {connection === 'down' && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200" role="status">
          <span className="font-semibold">Reconnecting to live updates.</span>{' '}
          This list is the last one read. It refreshes itself as soon as the connection returns.
        </div>
      )}

      {/* A failed read never becomes an empty division. */}
      {error && (
        <ErrorNotice
          message={populated ? `The roster could not be refreshed: ${error}` : error}
          onRetry={() => { void refresh() }}
        />
      )}

      <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="sr-only">Filter the directory</legend>
        <label className="sm:col-span-2">
          <span className="sr-only">Search members</span>
          <Input
            type="search"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Search name, callsign, rank or bureau"
            className="min-h-[44px]"
          />
        </label>
        <label>
          <span className="sr-only">Bureau</span>
          <Select value={filters.bureau} onChange={(e) => set('bureau', e.target.value as DirectoryBureau | 'all')} className="min-h-[44px]">
            <option value="all">All bureaus</option>
            {directory.groups.map((g) => <option key={g.bureau} value={g.bureau}>{g.short}</option>)}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">Rank</span>
            <Select value={filters.rank} onChange={(e) => set('rank', e.target.value)} className="min-h-[44px]">
              <option value="all">All ranks</option>
              {[...ROLE_ORDER].reverse().map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </Select>
          </label>
          <label>
            <span className="sr-only">Availability</span>
            <Select value={filters.status} onChange={(e) => set('status', e.target.value as DirectoryStatus | 'all')} className="min-h-[44px]">
              <option value="all">Any status</option>
              {(['active', 'loa', 'inactive'] as const).map((s) => (
                <option key={s} value={s}>{DIRECTORY_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </label>
        </div>
      </fieldset>

      {/* A restrained summary — the division at a glance, not a second
          Command Center. Bureau tiles filter the list rather than navigating
          somewhere else. */}
      <MetricStrip
        metrics={[
          { label: 'Active members', value: unknown ? '—' : directory.summary.active, onClick: () => set('status', 'active') },
          { label: 'Major Crimes', value: unknown ? '—' : directory.summary.majorCrimes, onClick: () => set('bureau', 'major_crimes') },
          { label: 'Street Crimes', value: unknown ? '—' : directory.summary.streetCrimes, onClick: () => set('bureau', 'street_crimes') },
          { label: 'On LOA', value: unknown ? '—' : directory.summary.onLoa, onClick: () => set('status', 'loa') },
        ]}
      />

      {loading ? (
        <ListSkeleton count={8} />
      ) : unavailable ? (
        // The ErrorNotice above is the body. Nothing else may be drawn from
        // rows we do not have.
        null
      ) : !populated ? (
        <EmptyState
          title="No members on the roster yet"
          hint="Members appear here once their membership is approved in the Command Center."
        />
      ) : filtering && view.matches === 0 ? (
        <EmptyState
          title="No members match those filters"
          hint={`${directory.matches} members are on the roster. Clear the filters to see them.`}
          action={{ label: 'Clear filters', onClick: () => setFilters(EMPTY_DIRECTORY_FILTERS) }}
        />
      ) : (
        <>
          {filtering && (
            <p className="text-xs text-slate-400" role="status">
              Showing {view.matches} of {directory.matches} members.
            </p>
          )}
          {mode === 'grouped' ? (
            <div className="space-y-4">
              {view.groups.map((g) => (
                <BureauGroup
                  key={g.bureau}
                  group={g}
                  filtering={filtering}
                  meId={me?.id}
                  onOpenProfile={() => navigate('profile')}
                />
              ))}
            </div>
          ) : (
            <Card pad="none">
              <ul className="divide-y divide-white/5">
                {view.groups.flatMap((g) => g.members).map((m) => (
                  <li key={m.id}>
                    <MemberRow member={m} isMe={m.id === me?.id} onOpenProfile={() => navigate('profile')} showBureau />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <Commendations rows={commendations} onChanged={() => { void refresh() }} />
    </section>
  )
}

function BureauGroup({ group, filtering, meId, onOpenProfile }: {
  group: DirectoryGroup
  filtering: boolean
  meId: string | undefined
  onOpenProfile: () => void
}) {
  // A bureau with nobody in it is a fact about the division; a bureau with
  // nobody MATCHING is a fact about the filter. They read differently.
  const count = filtering
    ? `${group.members.length} of ${group.total}`
    : `${group.total} member${group.total === 1 ? '' : 's'}`
  return (
    <section aria-labelledby={`bureau-${group.bureau}`}>
      <SectionHeader
        title={group.label}
        className="mb-2"
        actions={
          <span className="flex items-center gap-2 text-xs text-slate-400">
            <span id={`bureau-${group.bureau}`} className="sr-only">{group.label}</span>
            {group.leadership > 0 && <Badge tone="accent">{group.leadership} leadership</Badge>}
            <span className="tabular-nums">{count}</span>
          </span>
        }
      />
      {group.members.length === 0 ? (
        <Card pad="sm" className="text-sm text-slate-500">
          {filtering ? 'No members here match those filters.' : 'No members assigned to this bureau.'}
        </Card>
      ) : (
        <Card pad="none">
          <ul className="divide-y divide-white/5">
            {group.members.map((m) => (
              <li key={m.id}>
                <MemberRow member={m} isMe={m.id === meId} onOpenProfile={onOpenProfile} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}

/** One member — a row, not a card. A directory is read by scanning it, and a
 *  division of forty should not be forty screens tall. */
function MemberRow({ member, isMe, onOpenProfile, showBureau = false }: {
  member: DirectoryMember
  isMe: boolean
  onOpenProfile: () => void
  showBureau?: boolean
}) {
  const { setMyLoa } = useAuth()
  const [busy, setBusy] = useState(false)

  const toggleMyLoa = async () => {
    setBusy(true)
    const r = await setMyLoa(member.status !== 'loa')
    setBusy(false)
    if (r.error) { toast(`LOA update failed: ${r.error.message}`, 'danger'); return }
    toast(member.status === 'loa' ? 'Welcome back — LOA cleared' : 'You are marked On LOA', 'success')
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:px-4">
      <span
        aria-hidden
        className="grid h-9 w-9 flex-shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-700 text-xs font-bold text-white"
      >
        {member.avatarUrl
          // eslint-disable-next-line @next/next/no-img-element -- avatars are remote URLs on an unknown host; next/image would need a loader per domain
          ? <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
          : initials(member.name)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-white">
          <span className="truncate">{member.name}</span>
          {isMe && <Badge tone="accent">You</Badge>}
          {member.isLeadership && <Badge tone="neutral">Leadership</Badge>}
        </p>
        <p className="truncate text-xs text-slate-400">
          <span className="font-mono text-slate-300">{member.callsign}</span>
          {' · '}{member.rankLabel}
          {' · '}{member.assignment}
          {showBureau && member.assignment !== member.bureauLabel && <> · {member.bureauLabel}</>}
        </p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {member.awards > 0 && (
          <Badge tone="neutral" title={`${member.awards} commendation${member.awards === 1 ? '' : 's'}`}>
            {member.awards} ★
          </Badge>
        )}
        <Badge tone={STATUS_TONE[member.status]}>{member.statusLabel}</Badge>
        {isMe && (
          <>
            <Button size="sm" variant="secondary" onClick={() => void toggleMyLoa()} disabled={busy}>
              {member.status === 'loa' ? 'Clear my LOA' : 'Set LOA'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpenProfile}>My profile</Button>
          </>
        )}
      </div>
    </div>
  )
}

/** Re-exported for the tests that build a directory from fixture rows. */
export { buildDirectory }
