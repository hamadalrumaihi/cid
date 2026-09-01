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
import { AlertIcon, LockIcon, XMarkIcon } from '@/components/shell/icons'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { inputCls, labelCls } from '@/components/ui/Field'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
import { searchCaseHits, type EntityHit } from '@/lib/entitySearch'
import { CardGridSkeleton } from '@/components/ui/Skeleton'

type IndicatorRow = Tables<'indicators'>
interface CaseOption { id: string; case_number: string; title: string }

const KINDS = ['phone', 'email', 'account', 'serial', 'alias', 'address', 'other'] as const
const KIND_META: Record<string, { label: string }> = {
  phone:   { label: 'Phone' },
  email:   { label: 'Email' },
  account: { label: 'Account' },
  serial:  { label: 'Serial' },
  alias:   { label: 'Alias' },
  address: { label: 'Address' },
  other:   { label: 'Other' },
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
  // Case labels are a side-load bounded to the cases the loaded indicators
  // actually reference (the modal's picker searches on its own now).
  const { rows, loading, error: err, refresh } = useRegistry<IndicatorRow>({
    table: 'indicators',
    watch: [vCases],
    load: async () => {
      const ind = await withRetry(() => list('indicators', { order: 'created_at', ascending: false }))
      const ids = [...new Set(ind.map((r) => r.case_id).filter(Boolean))] as string[]
      const cs = ids.length
        ? await list('cases', { select: 'id,case_number,title', in: { id: ids } }).catch(() => [] as Tables<'cases'>[])
        : []
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

  const isHot = (r: IndicatorRow) => (matches.get(matchKey(r.kind, r.value))?.caseIds.size ?? 0) >= 2

  const caseLink = (r: IndicatorRow) => {
    const c = caseById.get(r.case_id)
    return c ? (
      <>
        <button onClick={() => router.push(`/cases?case=${r.case_id}`)} className="font-mono text-blue-300 hover:underline">{c.case_number}</button>
        {c.title && <span className="text-slate-500"> — {c.title}</span>}
      </>
    ) : (
      <span className="text-slate-500" title="Logged on a case outside your access."><LockIcon size={12} className="inline align-[-2px]" /> restricted case</span>
    )
  }

  const rowActions = (r: IndicatorRow) => (
    <span className="flex flex-shrink-0 items-center gap-2">
      {canEdit && <button onClick={() => setEditor({ record: r })} className="-my-1 min-h-[44px] rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 transition hover:bg-white/10 sm:min-h-0">Edit</button>}
      {canDelete && <button onClick={() => void onDelete(r)} aria-label="Delete indicator" className="-my-1 min-h-[44px] rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-rose-300 transition hover:bg-rose-500/10 sm:min-h-0"><XMarkIcon size={14} /></button>}
    </span>
  )

  // Table columns — the fields the old card grid showed, deconfliction flag included.
  const columns: DataColumn<IndicatorRow>[] = [
    {
      key: 'value', label: 'Value',
      value: (r) => r.value,
      render: (r) => <span className="break-all font-mono text-sm font-semibold text-white">{r.value}</span>,
    },
    {
      key: 'kind', label: 'Type',
      value: (r) => KIND_META[r.kind]?.label ?? r.kind,
      render: (r) => <Badge tone="neutral" className="font-medium text-slate-400">{KIND_META[r.kind]?.label ?? r.kind}</Badge>,
    },
    {
      key: 'deconfliction', label: 'Deconfliction',
      value: (r) => (isHot(r) ? 'multi-case' : '—'),
      render: (r) => isHot(r)
        ? <Badge tone="warn"><AlertIcon size={12} className="inline align-[-2px]" /> multi-case</Badge>
        : <span className="text-slate-500">—</span>,
    },
    {
      key: 'case', label: 'Case',
      value: (r) => { const c = caseById.get(r.case_id); return c ? [c.case_number, c.title].filter(Boolean).join(' — ') : 'restricted case' },
      render: (r) => <span className="text-xs">{caseLink(r)}</span>,
    },
    { key: 'note', label: 'Note', value: (r) => r.note ?? '', render: (r) => <span className="line-clamp-2 max-w-[16rem] text-xs text-slate-400">{r.note || '—'}</span> },
    ...(canEdit || canDelete ? [{
      key: 'actions', label: 'Actions',
      value: () => '',
      render: (r) => rowActions(r),
    } satisfies DataColumn<IndicatorRow>] : []),
  ]

  // Narrow-viewport fallback for the table — the registry card, unchanged.
  const indicatorCard = (r: IndicatorRow) => {
    const hot = isHot(r)
    return (
      <div className={`rounded-lg border p-5 ${hot ? 'border-amber-500/25 bg-amber-500/[0.04]' : 'border-white/5 bg-ink-900/60'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-all font-mono text-sm font-semibold text-white">{r.value}</p>
            <p className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
              <Badge tone="neutral" className="font-medium text-slate-400">{KIND_META[r.kind]?.label ?? r.kind}</Badge>
              {hot && <Badge tone="warn"><AlertIcon size={12} className="inline align-[-2px]" /> multi-case</Badge>}
            </p>
          </div>
          {rowActions(r)}
        </div>
        <p className="mt-3 text-xs">{caseLink(r)}</p>
        {r.note && <p className="mt-2 text-xs text-slate-400">{r.note}</p>}
      </div>
    )
  }

  if (state !== 'in') return <Notice text="Live indicator records require sign-in." />

  return (
    <div>
      <PageHeader
        className="mb-6"
        title="Indicators Registry"
        subtitle="Hard identifiers — phones, accounts, serials, aliases & addresses — deconflicted across every case"
        actions={
          <>
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
              <Button variant="primary" onClick={() => setEditor({ record: null })}>
                New Indicator
              </Button>
            )}
          </>
        }
      />

      {!loading && !err && (
        alerts.length ? (
          <div className="mb-6">
            <p className="mb-2 text-[13px] font-semibold text-white"><AlertIcon size={13} className="inline align-[-2px] text-amber-300" /> Deconfliction alerts ({alerts.length})</p>
            <div className="space-y-2">
              {alerts.map((a) => (
                <div key={matchKey(a.sample.kind, a.sample.value)} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                  <p className="text-sm font-semibold text-white">
                    {a.sample.value}
                    <Badge tone="neutral" className="ml-2 font-medium text-slate-400">{KIND_META[a.sample.kind]?.label ?? a.sample.kind}</Badge>
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
                            <span className="font-mono text-slate-500" title="Logged on a case outside your access — contact its bureau lead to coordinate."><LockIcon size={12} className="inline align-[-2px]" /> restricted case</span>
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
          <EmptyState
            title="No cross-case matches yet"
            hint="Alerts appear here the moment the same identifier is logged on two different cases."
            className="mb-6"
          />
        ) : null
      )}

      {rows.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <KindChip label="All" active={!kindFilter} onClick={() => setKindFilter('')} />
          {KINDS.map((k) => (
            <KindChip key={k} label={KIND_META[k].label} active={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? '' : k)} />
          ))}
        </div>
      )}

      {loading ? (
        <CardGridSkeleton count={6} />
      ) : err ? (
        <ErrorNotice message={err} onRetry={refresh} />
      ) : !rows.length ? (
        <EmptyState
          title="No indicators on file yet"
          hint={canEdit ? 'Log the first identifier — a burner number, account, weapon serial, alias or address — with the New Indicator button.' : undefined}
        />
      ) : !filtered.length ? (
        <Notice text="No indicators match the current filter." />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            pageSize={30}
            filterPlaceholder="Filter listed rows…"
            countLabel="indicators"
            emptyText="No indicators on file yet."
            mobileCard={indicatorCard}
          />
        </Card>
      )}

      {editor && (
        <IndicatorModal
          record={editor.record}
          currentCase={editor.record?.case_id ? caseById.get(editor.record.case_id) ?? null : null}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void refresh() }}
        />
      )}
    </div>
  )
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

export function IndicatorModal({ record, currentCase, onClose, onSaved }: {
  record: IndicatorRow | null
  currentCase?: CaseOption | null
  onClose: () => void
  onSaved: () => void
}) {
  // FK-preservation guard: the linked case seeds the picker synchronously —
  // as a labelled hit when the caller resolved it, or a placeholder when it
  // is outside the viewer's access — so an unrelated edit can't silently
  // re-point (or null) the indicator's case.
  const [casePick, setCasePick] = useState<EntityHit | null>(() => {
    if (!record?.case_id) return null
    if (currentCase) return { id: currentCase.id, label: currentCase.case_number, sublabel: currentCase.title || undefined }
    return { id: record.case_id, label: '(current case — outside your access)' }
  })
  const caseId = casePick?.id ?? ''
  const [kind, setKind] = useState(record?.kind ?? 'phone')
  const [value, setValue] = useState(record?.value ?? '')
  const [note, setNote] = useState(record?.note ?? '')
  const [busy, setBusy] = useState(false)

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
        <RecordSearchPicker<EntityHit>
          label="Case *"
          placeholder="Search cases by number or title…"
          value={casePick}
          onChange={setCasePick}
          search={(q) => searchCaseHits(q)}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="indicator-type" className={labelCls}>Type</label>
            <select id="indicator-type" value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="indicator-value" className={labelCls}>Value *</label>
            <input id="indicator-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. (555) 201-3344" className={`${inputCls} font-mono`} />
          </div>
        </div>
        <div>
          <label htmlFor="indicator-note" className={labelCls}>Note</label>
          <textarea id="indicator-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Where it surfaced, who it belongs to…" className={inputCls} />
        </div>
      </div>
      <div className="mt-5">
        <Button variant="primary" className="w-full" disabled={busy} onClick={() => void save()}>
          {record ? 'Save changes' : 'Log indicator'}
        </Button>
      </div>
    </Modal>
  )
}
