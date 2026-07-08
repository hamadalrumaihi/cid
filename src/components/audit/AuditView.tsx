'use client'

/** Audit Log — port of vanilla renderAuditLog (app.js). Owner-only: RLS's
 *  audit_sel policy is the authority; this view just matches it in the UI
 *  (a restricted notice for everyone else). Writes happen ONLY via the
 *  private.audit() trigger server-side — there is no client write path.
 *  Compact sortable/paged table (50/page); the shared data-table engine
 *  cross-cut will later absorb this. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { AUDIT_OWNER_ID } from '@/lib/nav'
import { officerName } from '@/lib/profiles'
import { copyText } from '@/lib/format'

type AuditRow = Tables<'audit_log'>
type SortKey = 'when' | 'officer' | 'action' | 'entity'

const PAGE = 50

export function AuditView() {
  const { state, profile } = useAuth()
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'when', dir: 'desc' })
  const [page, setPage] = useState(0)

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = !q
      ? rows
      : rows.filter((r) => [r.action, r.entity, r.entity_id, named(r.actor_id), JSON.stringify(r.detail ?? '')].join(' ').toLowerCase().includes(q))
    const val = (r: AuditRow): string =>
      sort.key === 'when' ? r.created_at : sort.key === 'officer' ? named(r.actor_id) : sort.key === 'action' ? r.action : r.entity
    return [...base].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1))
  }, [rows, query, sort, named])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const p = Math.min(page, pages - 1)
  const slice = filtered.slice(p * PAGE, (p + 1) * PAGE)

  const th = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-white"
      onClick={() => { setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' })); setPage(0) }}
      aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}{sort.key === key && (sort.dir === 'asc' ? ' ▲' : ' ▼')}
    </th>
  )

  if (state !== 'in') return <Notice text="Sign in to view the audit log." />
  if (!isOwner) return <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-200">Restricted — the audit log is owner-only.</div>

  return (
    <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-400">
          {rows.length} total{query.trim() && ` · ${filtered.length} match${filtered.length === 1 ? '' : 'es'}`}
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0) }}
          placeholder="Filter action / entity / officer…"
          aria-label="Filter audit entries"
          className="w-60 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-white outline-none focus:border-badge-500"
        />
      </div>
      {loading ? (
        <Notice text="Loading audit log…" />
      ) : !slice.length ? (
        <Notice text={rows.length ? 'No entries match.' : 'No audit entries yet.'} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/10">{th('when', 'When')}{th('officer', 'Officer')}{th('action', 'Action')}{th('entity', 'Entity')}</tr></thead>
              <tbody className="divide-y divide-white/5">
                {slice.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-400">{new Date(r.created_at).toLocaleString('en-US')}</td>
                    <td className="px-3 py-2 text-slate-200">{named(r.actor_id)}</td>
                    <td className="px-3 py-2"><span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-200">{r.action}</span></td>
                    <td className="px-3 py-2 font-mono text-slate-400">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <button onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 disabled:opacity-40">← Prev</button>
              <span>Page {p + 1} / {pages}</span>
              <button onClick={() => setPage(Math.min(pages - 1, p + 1))} disabled={p >= pages - 1} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 disabled:opacity-40">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-xl border border-white/5 bg-ink-900 p-6 text-center text-sm text-slate-500">{text}</div>
}
