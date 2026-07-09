'use client'

/** Indicators Registry — hard identifiers (phones, accounts, serials,
 *  aliases, addresses) logged per case, with automatic cross-case
 *  deconfliction: the same value surfacing in two or more cases raises an
 *  alert. The indicators table is shared intel (all active members see every
 *  value), but case titles are RLS-scoped — a match into a case the viewer
 *  cannot open renders as a restricted stub instead of leaking its details. */
import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { deleteWithUndo, insert, list, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { useRegistry } from '@/lib/useRegistry'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CardGridSkeleton } from '@/components/ui/Skeleton'

type IndicatorRow = Tables<'indicators'>
interface CaseOption { id: string; case_number: string; title: string }

const inputCls = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'
const labelCls = 'mb-1 block text-xs font-semibold text-slate-400'

const KINDS = ['phone', 'account', 'serial', 'alias', 'address', 'other'] as const
const KIND_META: Record<string, { icon: string; label: string }> = {
  phone:   { icon: '📞', label: 'Phone' },
  account: { icon: '💳', label: 'Account' },
  serial:  { icon: '🔩', label: 'Serial' },
  alias:   { icon: '🎭', label: 'Alias' },
  address: { icon: '📍', label: 'Address' },
  other:   { icon: '🏷️', label: 'Other' },
}

/** Match key: identifiers that are digits/codes compare with separators
 *  stripped (so "(555) 201-3344" ≡ "555-2013344"); free-text kinds compare
 *  case- and whitespace-insensitively. */
const matchKey = (kind: string, value: string): string => {
  const v = value.trim().toLowerCase()
  if (kind === 'phone' || kind === 'account' || kind === 'serial') {
    const stripped = v.replace(/[^a-z0-9]/g, '')
    return `${kind}:${stripped || v}`
  }
  return `${kind}:${v.replace(/\s+/g, ' ')}`
}

export function IndicatorsView() {
  const { state, canEdit, canDelete } = useAuth()
  const sp = useSearchParams()
  const router = useRouter()
  const [cases, setCases] = useState<CaseOption[]>([])
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [kindFilter, setKindFilter] = useState('')
  const [editor, setEditor] = useState<{ record: IndicatorRow | null } | null>(null)
  const vCases = useTableVersion('cases')

  // Registry owns rows/loading/error + the deferred, version-driven refetch.
  // Case titles are a side-load (for labelling matches) — fetched here and
  // held separately so the modal's case picker stays populated.
  const { rows, loading, error: err, refresh } = useRegistry<IndicatorRow>({
    table: 'indicators',
    watch: [vCases],
    load: async () => {
      const [ind, cs] = await Promise.all([
        withRetry(() => list('indicators', { order: 'created_at', ascending: false })),
        list('cases', { select: 'id,case_number,title', order: 'created_at', ascending: false }).catch(() => [] as Tables<'cases'>[]),
      ])
      setCases(cs as unknown as CaseOption[])
      return ind
    },
  })

  const caseById = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases])

  /** Deconfliction: match key → set of distinct case ids. ≥2 → alert. */
  const matches = useMemo(() => {
    const byKey = new Map<string, { sample: IndicatorRow; caseIds: Set<string> }>()
    for (const r of rows) {
      const k = matchKey(r.kind, r.value)
      const e = byKey.get(k)
      if (e) e.caseIds.add(r.case_id)
      else byKey.set(k, { sample: r, caseIds: new Set([r.case_id]) })
    }
    return byKey
  }, [rows])

  const alerts = useMemo(
    () => [...matches.values()].filter((m) => m.caseIds.size >= 2)
      .sort((a, b) => b.caseIds.size - a.caseIds.size),
    [matches],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (kindFilter && r.kind !== kindFilter) return false
      if (!q) return true
      const c = caseById.get(r.case_id)
      return [r.value, r.note, c?.case_number, c?.title].some((s) => (s || '').toLowerCase().includes(q))
    })
  }, [rows, query, kindFilter, caseById])

  const onDelete = async (r: IndicatorRow) => {
    if (!(await uiConfirm(`Delete indicator “${r.value}”? Restorable via Undo.`, { confirmText: 'Delete' }))) return
    await deleteWithUndo('indicators', r, { label: `Indicator ${r.value}`, noConfirm: true, after: refresh })
  }

  if (state !== 'in') return <Notice text="Live indicator records require sign-in." />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div>
          <h3 className="text-xl font-bold text-white">🧷 Indicators Registry</h3>
          <p className="text-sm text-slate-400">Hard identifiers — phones, accounts, serials, aliases &amp; addresses — deconflicted across every case</p>
        </div>
        <div className="flex items-center gap-3">
          {rows.length > 0 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter value, note, case…"
              aria-label="Filter indicators"
              className="w-56 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"
            />
          )}
          {canEdit && (
            <button onClick={() => setEditor({ record: null })} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">
              + New Indicator
            </button>
          )}
        </div>
      </div>

      {!loading && !err && (
        alerts.length ? (
          <div className="mb-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">⚡ Deconfliction alerts ({alerts.length})</p>
            <div className="space-y-2">
              {alerts.map((a) => (
                <div key={matchKey(a.sample.kind, a.sample.value)} className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                  <p className="text-sm font-semibold text-white">
                    {KIND_META[a.sample.kind]?.icon ?? '🏷️'} {a.sample.value}
                    <span className="ml-2 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-400">{KIND_META[a.sample.kind]?.label ?? a.sample.kind}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Appears in {a.caseIds.size} cases:{' '}
                    {[...a.caseIds].map((cid, j) => {
                      const c = caseById.get(cid)
                      return (
                        <span key={cid}>
                          {j > 0 && ' · '}
                          {c ? (
                            <button onClick={() => router.push(`/cases?case=${cid}`)} className="font-mono text-blue-300 hover:underline">{c.case_number}</button>
                          ) : (
                            <span className="font-mono text-slate-500" title="Logged on a case outside your access — contact its bureau lead to coordinate.">🔒 restricted case</span>
                          )}
                        </span>
                      )
                    })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : rows.length > 0 ? (
          <div className="mb-6 rounded-2xl border border-white/5 bg-ink-900/60 p-5 text-sm text-slate-500">NO CROSS-CASE MATCHES // DECONFLICTION CLEAN. Alerts appear here the moment the same identifier is logged on two different cases.</div>
        ) : null
      )}

      {rows.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <KindChip label="All" active={!kindFilter} onClick={() => setKindFilter('')} />
          {KINDS.map((k) => (
            <KindChip key={k} label={`${KIND_META[k].icon} ${KIND_META[k].label}`} active={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? '' : k)} />
          ))}
        </div>
      )}

      {loading ? (
        <CardGridSkeleton count={6} />
      ) : err ? (
        <Notice text={`Could not load indicators: ${err}`} />
      ) : !rows.length ? (
        <Notice text={`NO INDICATORS ON FILE // REGISTRY EMPTY.${canEdit ? ' Use “+ New Indicator” to log the first identifier — a burner number, account, weapon serial, alias or address.' : ''}`} />
      ) : !filtered.length ? (
        <Notice text="No indicators match the current filter." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => {
            const c = caseById.get(r.case_id)
            const hot = (matches.get(matchKey(r.kind, r.value))?.caseIds.size ?? 0) >= 2
            return (
              <div key={r.id} className={`rounded-2xl border p-5 ${hot ? 'border-amber-500/25 bg-amber-500/[0.04]' : 'border-white/5 bg-ink-900/60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-bold text-white">{KIND_META[r.kind]?.icon ?? '🏷️'} {r.value}</p>
                    <p className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-md bg-white/5 px-2 py-1 uppercase text-slate-400">{KIND_META[r.kind]?.label ?? r.kind}</span>
                      {hot && <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-300">⚡ multi-case</span>}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {canEdit && <button onClick={() => setEditor({ record: r })} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10">Edit</button>}
                    {canDelete && <button onClick={() => void onDelete(r)} aria-label="Delete indicator" className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10">✕</button>}
                  </div>
                </div>
                <p className="mt-3 text-xs">
                  {c ? (
                    <button onClick={() => router.push(`/cases?case=${r.case_id}`)} className="font-mono text-blue-300 hover:underline">{c.case_number}</button>
                  ) : (
                    <span className="text-slate-500" title="Logged on a case outside your access.">🔒 restricted case</span>
                  )}
                  {c?.title && <span className="text-slate-500"> — {c.title}</span>}
                </p>
                {r.note && <p className="mt-2 text-xs text-slate-400">{r.note}</p>}
              </div>
            )
          })}
        </div>
      )}

      {editor && (
        <IndicatorModal
          record={editor.record}
          cases={cases}
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

function KindChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${active ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
    >
      {label}
    </button>
  )
}

/* ---- Create / edit modal ------------------------------------------------ */

function IndicatorModal({ record, cases, onClose, onSaved }: {
  record: IndicatorRow | null
  cases: CaseOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const [caseId, setCaseId] = useState(record?.case_id ?? '')
  const [kind, setKind] = useState(record?.kind ?? 'phone')
  const [value, setValue] = useState(record?.value ?? '')
  const [note, setNote] = useState(record?.note ?? '')
  const [busy, setBusy] = useState(false)

  // FK-preservation guard: if the linked case isn't in the viewer's list
  // (restricted or fetch failed), keep a synthetic option so an unrelated
  // edit can't silently re-point the indicator.
  const caseKnown = !record?.case_id || cases.some((c) => c.id === record.case_id)

  const dirty = () =>
    caseId !== (record?.case_id ?? '') || kind !== (record?.kind ?? 'phone') ||
    value !== (record?.value ?? '') || note !== (record?.note ?? '')

  const save = async () => {
    const v = value.trim()
    if (!caseId) { toast('Pick the case this indicator belongs to.', 'warn'); return }
    if (!v) { toast('Value is required.', 'warn'); return }
    setBusy(true)
    const payload = { case_id: caseId, kind, value: v, note: note.trim() || null }
    const res = record ? await update('indicators', record.id, payload) : await insert('indicators', payload)
    setBusy(false)
    if (res.error) {
      toast(`Save failed: ${res.error.message}`, 'danger')
      return
    }
    toast(record ? 'Indicator updated' : 'Indicator logged', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <ModalHeader title={record ? 'Edit Indicator' : 'New Indicator'} onClose={onClose} />
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Case *</label>
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className={inputCls}>
            <option value="">— pick a case —</option>
            {!caseKnown && record?.case_id && <option value={record.case_id}>(current case — outside your access)</option>}
            {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number} — {c.title}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_META[k].icon} {KIND_META[k].label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Value *</label>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. (555) 201-3344" className={`${inputCls} font-mono`} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Note</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Where it surfaced, who it belongs to…" className={inputCls} />
        </div>
      </div>
      <div className="mt-5">
        <button onClick={() => void save()} disabled={busy} className="w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
          {record ? 'Save changes' : 'Log indicator'}
        </button>
      </div>
    </Modal>
  )
}
