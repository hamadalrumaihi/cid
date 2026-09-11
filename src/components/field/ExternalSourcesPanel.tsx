'use client'

/** External Sources — the registry tab inside the Intelligence workspace
 *  (FieldReviewView). A list of crawled web sources (number, domain, title,
 *  status, verification, reliability, versions, last checked, submitter)
 *  with status / verification / mine filters, a Submit URL dialog and the
 *  detail view (ExternalSourceDetail) opened in place — or straight away
 *  from the `/intelligence?source=<id>` deep link.
 *
 *  Every row is UNVERIFIED INTELLIGENCE until an analyst verifies it, and
 *  the list says so in words, not just colour. Reads are the viewer's own
 *  RLS-scoped client; the count on the tab is the number of live rows the
 *  viewer can see, nothing more. */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { countRows } from '@/lib/db'
import {
  SOURCE_STATUSES, UNVERIFIED_LABEL, VERIFICATION_STATUSES, fetchSources, reliabilityLabel, sourceStatusLabel, sourceStatusTone,
  verificationLabel, verificationTone, type SourceRow, type SourceStatus, type VerificationStatus,
} from '@/lib/externalSources'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { Select } from '@/components/ui/Field'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { ExternalSourceDetail } from './ExternalSourceDetail'
import { SubmitSourceDialog } from './SubmitSourceDialog'

/** Live-source count for the tab pill — refetched on the realtime channel.
 *  undefined while unknown (the tab renders no pill), never a guess. */
export function useExternalSourceCount(enabled = true): number | undefined {
  const v = useTableVersion('external_sources')
  const [count, setCount] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const t = window.setTimeout(() => {
      countRows('external_sources', { is: { deleted_at: null } })
        .then((n) => { if (live) setCount(n) })
        .catch(() => { if (live) setCount(undefined) })
    }, 0)
    return () => { live = false; window.clearTimeout(t) }
  }, [v, enabled])
  return count
}

export function ExternalSourcesPanel({ seed = null, onSeedConsumed }: {
  /** `?source=<id>` — opens that source's detail. */
  seed?: string | null
  /** Called when the user leaves the seeded detail (so the URL param can be dropped). */
  onSeedConsumed?: () => void
}) {
  const { profile } = useAuth()
  const me = profile?.id ?? null
  const v = useTableVersion('external_sources')
  const [rows, setRows] = useState<SourceRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [status, setStatus] = useState<SourceStatus | ''>('')
  const [verification, setVerification] = useState<VerificationStatus | ''>('')
  const [mine, setMine] = useState(false)
  const [selected, setSelected] = useState<string | null>(seed)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!seed) return
    const t = window.setTimeout(() => setSelected(seed), 0)
    return () => window.clearTimeout(t)
  }, [seed])

  const refresh = useCallback(async () => {
    try {
      const list = await fetchSources({ status, verification, mine: mine ? me : null })
      setRows(list)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [status, verification, mine, me])
  useEffect(() => { const t = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(t) }, [refresh, v])

  if (selected) {
    return (
      <ExternalSourceDetail
        id={selected}
        onBack={() => { setSelected(null); onSeedConsumed?.() }}
        onChanged={() => void refresh()}
      />
    )
  }

  const columns: DataColumn<SourceRow>[] = [
    { key: 'number', label: 'Number', value: (r) => r.source_number, render: (r) => <span className="font-mono text-xs text-slate-300" translate="no">{r.source_number}</span> },
    { key: 'domain', label: 'Domain', value: (r) => r.domain, render: (r) => <span className="truncate" translate="no">{r.domain}</span> },
    { key: 'title', label: 'Title', value: (r) => r.title ?? '', render: (r) => <span className="block max-w-72 truncate text-slate-200" title={r.title ?? undefined}>{r.title || <span className="text-slate-400">Untitled</span>}</span> },
    { key: 'status', label: 'Status', value: (r) => sourceStatusLabel(r.status), render: (r) => <Badge tone={sourceStatusTone(r.status)}>{sourceStatusLabel(r.status)}</Badge> },
    { key: 'verification', label: 'Verification', value: (r) => verificationLabel(r.verification_status), render: (r) => <Badge tone={verificationTone(r.verification_status)}>{verificationLabel(r.verification_status)}</Badge> },
    { key: 'reliability', label: 'Reliability', value: (r) => reliabilityLabel(r.reliability) },
    { key: 'versions', label: 'Versions', value: (r) => String(r.version_count), sortValue: (r) => r.version_count, render: (r) => <span className="tabular-nums">{r.version_count}</span>, className: 'text-right' },
    { key: 'checked', label: 'Last checked', value: (r) => (r.last_checked_at ? fmtDateTime(r.last_checked_at) : '—'), sortValue: (r) => r.last_checked_at ?? '', render: (r) => (r.last_checked_at ? <span title={fmtDateTime(r.last_checked_at)}>{timeAgo(r.last_checked_at)}</span> : '—') },
    { key: 'by', label: 'Submitted by', value: (r) => officerName(r.submitted_by) ?? 'Unknown member' },
  ]

  return (
    <div className="space-y-4">
      <Card pad="sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as SourceStatus | '')} className="w-auto min-w-[9rem]">
              <option value="">Any status</option>
              {SOURCE_STATUSES.map((s) => <option key={s} value={s}>{sourceStatusLabel(s)}</option>)}
            </Select>
            <Select aria-label="Verification" value={verification} onChange={(e) => setVerification(e.target.value as VerificationStatus | '')} className="w-auto min-w-[9rem]">
              <option value="">Any verification</option>
              {VERIFICATION_STATUSES.map((s) => <option key={s} value={s}>{verificationLabel(s)}</option>)}
            </Select>
            <Button variant="secondary" aria-pressed={mine} onClick={() => setMine((m) => !m)}>{mine ? 'Mine only' : 'Everyone’s'}</Button>
          </div>
          <Button variant="primary" onClick={() => setSubmitting(true)}>+ Submit URL</Button>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Crawled pages are <span className="font-semibold text-amber-200">{UNVERIFIED_LABEL}</span> until an analyst verifies them. A source is linked to records; it never updates one.
        </p>
      </Card>

      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : rows === null ? (
        <ListSkeleton count={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={status || verification || mine ? 'No sources match these filters' : 'No external sources yet'}
          hint={status || verification || mine ? 'Clear a filter to see more.' : 'Submit a web page URL and the crawler service fetches and snapshots it for review.'}
          action={{ label: '+ Submit URL', onClick: () => setSubmitting(true) }}
        />
      ) : (
        <Card pad="none" className="overflow-hidden">
          <DataTable<SourceRow>
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            dense
            countLabel="sources"
            filterPlaceholder="Filter by number, domain, title…"
            initialSort={{ key: 'checked', dir: 'desc' }}
            csvName="external-sources"
            onRowClick={(r) => setSelected(r.id)}
            searchText={(r) => `${r.url} ${r.analyst_notes ?? ''}`}
            mobileCard={(r) => (
              <button type="button" onClick={() => setSelected(r.id)} className="w-full touch-manipulation rounded-lg border border-white/5 bg-ink-900/60 px-4 py-3 text-left transition hover:bg-white/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-slate-300" translate="no">{r.source_number}</span>
                  <Badge tone={sourceStatusTone(r.status)}>{sourceStatusLabel(r.status)}</Badge>
                </div>
                <p className="mt-1 truncate text-sm font-medium text-slate-200">{r.title || r.domain}</p>
                <p className="truncate text-xs text-slate-400" translate="no">{r.domain}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                  <Badge tone={verificationTone(r.verification_status)}>{verificationLabel(r.verification_status)}</Badge>
                  <span>{reliabilityLabel(r.reliability)}</span>
                  <span className="tabular-nums">· {r.version_count} version{r.version_count === 1 ? '' : 's'}</span>
                  {r.last_checked_at && <span>· checked {timeAgo(r.last_checked_at)}</span>}
                </div>
              </button>
            )}
          />
        </Card>
      )}

      {submitting && (
        <SubmitSourceDialog
          open
          onClose={() => setSubmitting(false)}
          onSubmitted={(id) => { setSubmitting(false); void refresh(); setSelected(id) }}
        />
      )}
    </div>
  )
}
