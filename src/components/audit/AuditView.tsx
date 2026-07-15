'use client'

/** Audit Log — port of vanilla renderAuditLog (app.js). Owner-only: RLS's
 *  audit_sel policy is the authority; this view just matches it in the UI
 *  (a restricted notice for everyone else). Writes happen ONLY via the
 *  private.audit() trigger server-side — there is no client write path.
 *  Rendering runs on the shared DataTable engine (sort, filter, pagination,
 *  injection-guarded CSV export). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { officerName } from '@/lib/profiles'
import { copyText, fmtDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { Notice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'

type AuditRow = Tables<'audit_log'>

/** Fetch window — the log is append-only and grows without bound, so pull the
 *  newest page and let "Load older" widen it instead of reading every row. */
const PAGE = 500

export function AuditView() {
  const { state, isOwner } = useAuth()
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(PAGE)

  const refresh = useCallback(async () => {
    if (state !== 'in' || !isOwner) return
    await Promise.resolve()
    setLoading(true)
    try { setRows(await list('audit_log', { order: 'created_at', ascending: false, limit })) }
    catch { setRows([]); toast("Couldn't load the audit log — check your connection.", 'danger') }
    finally { setLoading(false) }
  }, [state, isOwner, limit])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const named = useCallback((id: string | null) => officerName(id) ?? 'System', [])

  const columns = useMemo((): DataColumn<AuditRow>[] => [
    {
      key: 'when',
      label: 'When',
      value: (r) => fmtDateTime(r.created_at),
      sortValue: (r) => r.created_at,
      className: 'whitespace-nowrap px-3 py-2 text-slate-400',
    },
    { key: 'officer', label: 'Officer', value: (r) => named(r.actor_id) },
    {
      key: 'action',
      label: 'Action',
      value: (r) => r.action,
      render: (r) => <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-200">{r.action}</span>,
    },
    {
      key: 'entity',
      label: 'Entity',
      value: (r) => `${r.entity}${r.entity_id ? ` ${r.entity_id}` : ''}`,
      className: 'px-3 py-2 font-mono text-slate-400',
      render: (r) => (
        <>
          {r.entity}
          {r.entity_id && (
            <button
              onClick={() => copyText(r.entity_id!, 'ID')}
              title={`Copy id ${r.entity_id}`}
              className="-my-1 ml-1 rounded bg-white/5 px-1 py-1 text-[10px] text-slate-500 hover:text-white"
            >
              ⧉ {r.entity_id.slice(0, 8)}
            </button>
          )}
        </>
      ),
    },
  ], [named])

  if (state !== 'in') return <Notice text="Sign in to view the audit log." />
  if (!isOwner) return <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-200">Restricted — the audit log is owner-only.</div>

  return (
    <Card pad="lg">
      {loading && rows.length === 0 ? (
        // First load renders the shape of the incoming table rows instead of a
        // bare "Loading…" line that reads as an empty state for a beat.
        <ListSkeleton count={8} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => String(r.id)}
            initialSort={{ key: 'when', dir: 'desc' }}
            filterPlaceholder="Filter action / entity / officer…"
            searchText={(r) => JSON.stringify(r.detail ?? '')}
            csvName="audit-log"
            countLabel="entries"
            emptyText="No audit entries yet."
          />
          {/* A full window means older entries probably exist below the cut. */}
          {rows.length >= limit && (
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" disabled={loading} onClick={() => setLimit((l) => l + PAGE)}>
                {loading ? 'Loading…' : `Load ${PAGE} older entries`}
              </Button>
              <p className="text-xs text-slate-400">Showing the newest {rows.length} entries — filter and CSV export cover only what&rsquo;s loaded.</p>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
