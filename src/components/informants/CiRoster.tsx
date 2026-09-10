'use client'

/** The roster: `ui/DataTable` over the rows `ci_list` returned (and ONLY
 *  those — RLS decides the set; a handler's table is their own sources). The
 *  columns are the contract's: CI ID | Alias / Person | Handler | Bureau |
 *  Motive | Reliability | Status | Last Contact. Below `sm` the same rows
 *  render as cards with 44 px targets (DataTable's mobileCard). The table's
 *  own CSV button is deliberately NOT enabled — exports go through
 *  `ci_export` so the server audits them.
 *
 *  `CiFilterBar` is the server-side filter set (handler / bureau / status /
 *  motive / reliability / risk / last contact / case + free text). */
import type { EntityHit } from '@/lib/entitySearch'
import { fmtDate, timeAgo } from '@/lib/format'
import {
  CI_MOTIVES, CI_MOTIVE_LABEL, CI_RELIABILITY, CI_RELIABILITY_LABEL, CI_RISK, CI_RISK_LABEL, CI_STATUSES,
  CI_STATUS_LABEL, contactState, motiveSummary, type CiListFilters, type CiListRow, type CiStatsHandler,
} from '@/lib/ci'
import { BUREAUS, bureauShort } from '@/lib/roles'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { Input, Select } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Notice'
import {
  CasePicker, CiStatusBadge, ciReliabilityTint, ciRiskTint, contactStateLabel, contactStateTint, reliabilityLabel, riskLabel,
} from './ciShared'

/** The "High risk" stat lens: a client-side value the server filter doesn't
 *  have (risk is one value there). Applied after the fetch. */
export const HIGH_RISK_LENS = 'high+'

function LastContact({ r }: { r: CiListRow }) {
  const st = contactState(r)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-slate-200">{r.last_contact_at ? timeAgo(r.last_contact_at) : '—'}</span>
      {st !== 'ok' && st !== 'none' && <Badge tint={contactStateTint(st)}>{contactStateLabel(st)}</Badge>}
    </span>
  )
}

export function CiRoster({ rows, onOpen, emptyHint }: {
  rows: CiListRow[]
  onOpen: (id: string) => void
  emptyHint: string
}) {
  const columns: DataColumn<CiListRow>[] = [
    {
      key: 'ci_number', label: 'CI ID', value: (r) => r.ci_number,
      render: (r) => (
        <button type="button" onClick={() => onOpen(r.id)} className="font-mono text-sm font-semibold text-badge-200 hover:text-white">
          {r.ci_number}
        </button>
      ),
    },
    {
      key: 'person', label: 'Alias / Person', value: (r) => `${r.alias ?? ''} ${r.person_name}`.trim(),
      render: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-slate-100">{r.alias || r.person_name}</span>
          {r.alias && <span className="block truncate text-xs text-slate-400">{r.person_name}</span>}
        </span>
      ),
    },
    {
      key: 'handler', label: 'Handler', value: (r) => r.primary_handler_name ?? '',
      render: (r) => (
        <span className="block min-w-0">
          <span className="block truncate text-slate-200">{r.primary_handler_name ?? <span className="text-slate-500">Unassigned</span>}</span>
          {r.secondary_handler_name && <span className="block truncate text-xs text-slate-400">+ {r.secondary_handler_name}</span>}
        </span>
      ),
    },
    { key: 'bureau', label: 'Bureau', value: (r) => bureauShort(r.bureau) },
    { key: 'motive', label: 'Motive', value: (r) => motiveSummary(r.motive_primary, r.motive_secondary), className: 'max-w-[14rem] truncate' },
    {
      key: 'reliability', label: 'Reliability', value: (r) => reliabilityLabel(r.reliability),
      sortValue: (r) => CI_RELIABILITY.indexOf(r.reliability as (typeof CI_RELIABILITY)[number]),
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          <Badge tint={ciReliabilityTint(r.reliability)}>{reliabilityLabel(r.reliability)}</Badge>
          {(r.risk === 'high' || r.risk === 'critical') && <Badge tint={ciRiskTint(r.risk)}>{riskLabel(r.risk)} risk</Badge>}
        </span>
      ),
    },
    {
      key: 'status', label: 'Status', value: (r) => CI_STATUS_LABEL[r.status as keyof typeof CI_STATUS_LABEL] ?? r.status,
      sortValue: (r) => CI_STATUSES.indexOf(r.status as (typeof CI_STATUSES)[number]),
      render: (r) => <CiStatusBadge status={r.status} />,
    },
    {
      key: 'last_contact', label: 'Last Contact', value: (r) => (r.last_contact_at ? fmtDate(r.last_contact_at) : '—'),
      sortValue: (r) => r.last_contact_at ?? '', render: (r) => <LastContact r={r} />,
    },
  ]

  if (!rows.length) return <EmptyState title="No sources match" hint={emptyHint} />

  return (
    <DataTable<CiListRow>
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      dense
      pageSize={50}
      pageSizeOptions={[25, 50, 100]}
      countLabel="sources"
      filterPlaceholder="Filter these rows…"
      initialSort={{ key: 'status', dir: 'asc' }}
      onRowClick={(r) => onOpen(r.id)}
      searchText={(r) => `${r.ci_number} ${r.alias ?? ''} ${r.person_name} ${r.primary_handler_name ?? ''}`}
      mobileCard={(r) => (
        <div className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-badge-200">{r.ci_number}</span>
            <CiStatusBadge status={r.status} />
            <Badge tint={ciReliabilityTint(r.reliability)}>{reliabilityLabel(r.reliability)}</Badge>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-slate-100">{r.alias || r.person_name}</p>
          <p className="truncate text-xs text-slate-400">
            {r.primary_handler_name ?? 'Unassigned'} · {bureauShort(r.bureau)} · {motiveSummary(r.motive_primary, r.motive_secondary)}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs"><LastContact r={r} /></span>
            <Button size="sm" className="min-h-11" onClick={() => onOpen(r.id)} aria-label={`Open ${r.ci_number}`}>Open</Button>
          </div>
        </div>
      )}
    />
  )
}

/* ── Filters ─────────────────────────────────────────────────────────────── */

export interface CiViewConfig { filters: CiListFilters }

export const EMPTY_CI_FILTERS: CiListFilters = {}

export const activeCiFilterCount = (f: CiListFilters): number =>
  [f.status?.length, f.handler, f.bureau, f.motive, f.reliability, f.risk, f.case_id, f.contact, f.q?.trim()].filter(Boolean).length

export function CiFilterBar({ filters, onChange, handlers, showHandler, caseHit, onCaseHit }: {
  filters: CiListFilters
  onChange: (f: CiListFilters) => void
  /** Full access: the handler filter's option pool (`ci_stats().handlers`). */
  handlers?: CiStatsHandler[] | null
  showHandler: boolean
  caseHit: EntityHit | null
  onCaseHit: (h: EntityHit | null) => void
}) {
  const patch = (p: Partial<CiListFilters>) => onChange({ ...filters, ...p })
  const toggleStatus = (s: string) => {
    const cur = filters.status ?? []
    patch({ status: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] })
  }
  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-ink-900/50 p-3">
      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        {CI_STATUSES.map((s) => {
          const on = filters.status?.includes(s) ?? false
          return (
            <button key={s} type="button" aria-pressed={on} onClick={() => toggleStatus(s)}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition ${on ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {CI_STATUS_LABEL[s]}
            </button>
          )
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {showHandler && (
          <Select aria-label="Filter by handler" value={filters.handler ?? ''} onChange={(e) => patch({ handler: e.target.value || undefined })}>
            <option value="">Any handler</option>
            {(handlers ?? []).map((h) => <option key={h.user_id} value={h.user_id}>{h.name ?? 'Member'}</option>)}
          </Select>
        )}
        <Select aria-label="Filter by bureau" value={filters.bureau ?? ''} onChange={(e) => patch({ bureau: e.target.value || undefined })}>
          <option value="">All bureaus</option>
          {Object.entries(BUREAUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Filter by motive" value={filters.motive ?? ''} onChange={(e) => patch({ motive: e.target.value || undefined })}>
          <option value="">Any motive</option>
          {CI_MOTIVES.map((m) => <option key={m} value={m}>{CI_MOTIVE_LABEL[m]}</option>)}
        </Select>
        <Select aria-label="Filter by reliability" value={filters.reliability ?? ''} onChange={(e) => patch({ reliability: e.target.value || undefined })}>
          <option value="">Any reliability</option>
          {CI_RELIABILITY.map((v) => <option key={v} value={v}>{CI_RELIABILITY_LABEL[v]}</option>)}
        </Select>
        <Select aria-label="Filter by risk" value={filters.risk ?? ''} onChange={(e) => patch({ risk: e.target.value || undefined })}>
          <option value="">Any risk</option>
          <option value={HIGH_RISK_LENS}>High or critical</option>
          {CI_RISK.map((v) => <option key={v} value={v}>{CI_RISK_LABEL[v]}</option>)}
        </Select>
        <Select aria-label="Filter by last contact" value={filters.contact ?? ''} onChange={(e) => patch({ contact: (e.target.value || undefined) as CiListFilters['contact'] })}>
          <option value="">Any contact cadence</option>
          <option value="overdue">Contact overdue</option>
          <option value="due_7d">Due within 7 days</option>
        </Select>
        <div className="sm:col-span-2 lg:col-span-2">
          <CasePicker label="Case" value={caseHit} onChange={(h) => { onCaseHit(h); patch({ case_id: h?.id ?? undefined }) }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search sources" placeholder="CI number, alias or person…" value={filters.q ?? ''} onChange={(e) => patch({ q: e.target.value || undefined })} className="sm:max-w-xs" />
        {activeCiFilterCount(filters) > 0 && (
          <Button size="sm" onClick={() => { onCaseHit(null); onChange(EMPTY_CI_FILTERS) }}>Clear filters</Button>
        )}
      </div>
    </div>
  )
}
