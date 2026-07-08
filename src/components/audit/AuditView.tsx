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
import { AUDIT_OWNER_ID } from '@/lib/nav'
import { officerName } from '@/lib/profiles'
import { copyText } from '@/lib/format'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'

type AuditRow = Tables<'audit_log'>

export function AuditView() {
  const { state, profile } = useAuth()
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)

  const isOwner = !!profile?.active && profile.id === AUDIT_OWNER_ID

  const refresh = useCallback(async () => {
    if (state !== 'in' || !isOwner) return
    await Promise.resolve()
    setLoading(true)
    try { setRows(await list('audit_log', { order: 'created_at', ascending: false })) }
    catch { setRows([]) }
    finally { setLoading(false) }
  }, [state, isOwner])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const named = useCallback((id: string | null) => officerName(id) ?? 'System', [])

  const columns = useMemo((): DataColumn<AuditRow>[] => [
    {
      key: 'when',
      label: 'When',
      value: (r) => new Date(r.created_at).toLocaleString('en-US'),
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
              className="ml-1 rounded bg-white/5 px-1 text-[10px] text-slate-500 hover:text-white"
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
    <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
      {loading ? (
        <Notice text="Loading audit log…" />
      ) : (
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
      )}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-xl border border-white/5 bg-ink-900 p-6 text-center text-sm text-slate-500">{text}</div>
}
