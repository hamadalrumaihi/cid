'use client'

/** CID Records — port of vanilla records.js. A separate live shared registry
 *  (`cid_records`, active-member RLS) with its own realtime channel + live
 *  dot. Create is any active member; RLS lets only the record's creator (or
 *  command) update — a blocked update returns zero rows with no error, which
 *  MUST surface as a warning rather than a false success. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { insert, list, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SearchIcon } from '@/components/shell/icons'

type RecordRow = Tables<'cid_records'>

const PAGE = 24
const inputCls = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'
const labelCls = 'mb-1 block text-xs font-semibold text-slate-400'

const statusTint = (s: string | null) =>
  s === 'Wanted' ? 'bg-rose-500/15 text-rose-300'
  : s === 'Open' ? 'bg-blue-500/15 text-blue-300'
  : s === 'Cold' ? 'bg-slate-500/20 text-slate-300'
  : 'bg-emerald-500/15 text-emerald-300'

export function RecordsView() {
  const { state, profile, canEdit } = useAuth()
  const sp = useSearchParams()
  const [records, setRecords] = useState<RecordRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [page, setPage] = useState({ q: '', shown: PAGE })
  const [editor, setEditor] = useState<{ record: RecordRow | null } | null>(null)
  const version = useTableVersion('cid_records')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      setRecords(await withRetry(() => list('cid_records', { order: 'updated_at', ascending: false })))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  const q = query.trim().toLowerCase()
  const items = useMemo(
    () => records.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q)),
    [records, q],
  )
  const shown = page.q === q ? page.shown : PAGE
  const slice = items.slice(0, shown)

  if (state !== 'in') {
    return <Notice text="Sign in to the portal to view and manage records." />
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold text-white">
            🗃️ CID Records
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />live
            </span>
          </h3>
          <p className="text-sm text-slate-400">Shared, two-way records — synced for everyone via Supabase.</p>
        </div>
        <span className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">👤 {profile?.display_name || 'Signed in'}</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter records…"
            aria-label="Filter records"
            className="w-full rounded-lg border border-white/10 bg-ink-850 py-2 pl-9 pr-3 text-sm text-slate-200 outline-none transition focus:border-badge-500"
          />
        </div>
        {canEdit && (
          <button onClick={() => setEditor({ record: null })} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
            + New Record
          </button>
        )}
        <button onClick={() => void refresh()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
          ↻ Refresh
        </button>
      </div>

      {err && <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">⚠️ Could not load records: {err}</div>}

      {loading ? (
        <Notice text="Loading records…" />
      ) : !items.length ? (
        <Notice text={records.length ? 'No records match your filter.' : `No records yet.${canEdit ? ' Use “+ New Record”.' : ''}`} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {slice.map((r) => <RecordCard key={r.id} r={r} canEdit={canEdit} onEdit={() => setEditor({ record: r })} />)}
          </div>
          {items.length > shown && (
            <div className="mt-4 text-center">
              <button onClick={() => setPage({ q, shown: shown + PAGE })} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">
                Load more ({items.length - shown} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {editor && (
        <RecordModal
          record={editor.record}
          meId={profile?.id ?? null}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void refresh() }}
        />
      )}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">{text}</div>
}

function RecordCard({ r, canEdit, onEdit }: { r: RecordRow; canEdit: boolean; onEdit: () => void }) {
  const [imgFailed, setImgFailed] = useState(false)
  const mug = safeUrl(r.mugshot_url ?? '')
  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60">
      <div className="flex gap-4 p-5">
        {mug && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- external mugshot URL
          <img src={mug} alt="" onError={() => setImgFailed(true)} className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="grid h-16 w-16 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-2xl">👤</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold text-white">{r.name}</p>
              <p className="text-xs text-slate-400">{r.callsign || '—'}{r.bureau && ` · ${r.bureau}`}</p>
            </div>
            <span className={`flex-shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${statusTint(r.status)}`}>{r.status || '—'}</span>
          </div>
          {r.case_number && <p className="mt-1 font-mono text-[11px] text-blue-300">{r.case_number}</p>}
          {r.gang && <p className="mt-1 text-xs text-violet-300">🚩 {r.gang}</p>}
          {r.charges && <p className="mt-2 line-clamp-3 text-xs text-slate-300">{r.charges}</p>}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-white/5 px-5 py-2.5 text-[11px] text-slate-500">
        <span>{r.officer || 'Unassigned'}{r.last_seen && ` · last seen ${r.last_seen}`}</span>
        {canEdit && <button onClick={onEdit} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>}
      </div>
    </div>
  )
}

/* ---- Create / edit modal (vanilla REC_FIELDS form) ---------------------- */

const BUREAU_OPTS = ['', 'LSPD', 'BCSO', 'SAHP', 'JTF']
const STATUS_OPTS = ['Open', 'Cold', 'Closed', 'Wanted']

function RecordModal({ record, meId, onClose, onSaved }: {
  record: RecordRow | null
  meId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState(() => ({
    name: record?.name ?? '',
    callsign: record?.callsign ?? '',
    case_number: record?.case_number ?? '',
    bureau: record?.bureau ?? '',
    gang: record?.gang ?? '',
    status: record?.status ?? 'Open',
    charges: record?.charges ?? '',
    officer: record?.officer ?? '',
    last_seen: record?.last_seen ?? '',
    mugshot_url: record?.mugshot_url ?? '',
    notes: record?.notes ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))

  const dirty = () => Object.entries(f).some(([k, v]) => v !== ((record?.[k as keyof RecordRow] ?? (k === 'status' ? 'Open' : '')) as string))

  const save = async () => {
    if (!f.name.trim()) { toast('Name is required.', 'warn'); return }
    setBusy(true)
    const payload = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
    const res = record
      ? await update('cid_records', record.id, payload)
      : await insert('cid_records', { ...payload, name: f.name.trim(), created_by: meId })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    // RLS: only the creator (or command) may UPDATE — a blocked update returns
    // zero rows with no error. Surface it instead of a false success.
    if (record && res.data && res.data.length === 0) { toast('You can only edit records you created.', 'warn'); return }
    toast(record ? 'Record updated' : 'Record created', 'success')
    onSaved()
  }

  const text = (label: string, k: keyof typeof f, span2 = false) => (
    <div className={span2 ? 'sm:col-span-2' : undefined}>
      <label className={labelCls}>{label}{k === 'name' && <span className="text-rose-400"> *</span>}</label>
      <input value={f[k]} onChange={set(k)} className={inputCls} />
    </div>
  )

  return (
    <Modal open onClose={onClose} wide dirty={dirty}>
      <ModalHeader title={record ? 'Edit Record' : 'New Record'} onClose={onClose} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text('Name', 'name')}
        {text('Callsign', 'callsign')}
        {text('Case Number', 'case_number')}
        <div>
          <label className={labelCls}>Bureau</label>
          <select value={f.bureau} onChange={set('bureau')} className={inputCls}>
            {BUREAU_OPTS.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </div>
        {text('Gang / Affiliation', 'gang')}
        <div>
          <label className={labelCls}>Status</label>
          <select value={f.status} onChange={set('status')} className={inputCls}>
            {STATUS_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Charges</label>
          <textarea value={f.charges} onChange={set('charges')} rows={3} className={inputCls} />
        </div>
        {text('Assigned Officer', 'officer')}
        {text('Last Seen', 'last_seen')}
        {text('Mugshot URL', 'mugshot_url', true)}
        <div className="sm:col-span-2">
          <label className={labelCls}>Notes</label>
          <textarea value={f.notes} onChange={set('notes')} rows={3} className={inputCls} />
        </div>
      </div>
      <button onClick={() => void save()} disabled={busy} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
        {record ? 'Save changes' : 'Create record'}
      </button>
    </Modal>
  )
}
