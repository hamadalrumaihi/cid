'use client'

/** Persons of Interest — port of vanilla persons.js §11A. Paged card grid
 *  (24/page + load-more, reset on search), ≥8-felony flag, quick-add from an
 *  empty search, bulk multi-select delete (command), per-card profile page
 *  (`?person=`), edit / attach-to-case, mugshots via safeUrl with fallback. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { deleteWithUndo, insert, list, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Card } from '@/components/ui/Card'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { PersonProfile } from './PersonProfile'
import { PERSON_NULL_REFS, PersonModal, type GangRow, type PersonRow } from './PersonModal'

const PAGE = 24

interface CaseOption { id: string; case_number: string; title: string | null }
type EditorState = { record: PersonRow | null; prefillName?: string } | null

export function PersonsView() {
  const { state, canEdit, canDelete } = useAuth()
  const router = useRouter()
  const sp = useSearchParams()
  const [persons, setPersons] = useState<PersonRow[]>([])
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // `?q=` seeds the filter — how global-search results land here prefiltered.
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [page, setPage] = useState({ q: '', shown: PAGE })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [editor, setEditor] = useState<EditorState>(null)
  const [attach, setAttach] = useState<PersonRow | null>(null)
  // `?person=` drills into the full profile page instead of the registry grid.
  const personId = sp.get('person')
  const vPersons = useTableVersion('persons')
  const vGangs = useTableVersion('gangs')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      const [p, g, c] = await Promise.all([
        withRetry(() => list('persons', { order: 'updated_at', ascending: false })),
        list('gangs', { order: 'name' }).catch(() => [] as GangRow[]),
        list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false })
          .then((r) => r as unknown as CaseOption[])
          .catch(() => [] as CaseOption[]),
      ])
      setPersons(p)
      setGangs(g)
      setCaseOptions(c)
      setSelected((sel) => new Set([...sel].filter((id) => p.some((x) => x.id === id))))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vPersons, vGangs])

  const q = query.trim().toLowerCase()
  const items = useMemo(
    () => persons.filter((p) => !q || JSON.stringify(p).toLowerCase().includes(q)),
    [persons, q],
  )
  // Load-more resets to the first page whenever the search text changes.
  const shown = page.q === q ? page.shown : PAGE
  const visible = items.slice(0, shown)
  const remaining = Math.max(0, items.length - visible.length)
  const gangName = (id: string | null) => (id && gangs.find((g) => g.id === id)?.name) || null

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((sel) => { const next = new Set(sel); if (on) next.add(id); else next.delete(id); return next })

  const deleteSelected = async () => {
    const rows = persons.filter((p) => selected.has(p.id))
    if (!rows.length) return
    const n = rows.length
    if (!(await uiConfirm(`Delete ${n} selected person${n > 1 ? 's' : ''}? This removes the registry records (not any linked officer accounts).`, { confirmText: `Delete ${n}` }))) return
    setSelected(new Set())
    await deleteWithUndo('persons', rows, {
      label: `${n} person${n > 1 ? 's' : ''}`, noConfirm: true, after: () => void refresh(), setNullRefs: PERSON_NULL_REFS,
    })
  }

  const deleteOne = async (p: PersonRow) => {
    if (!(await uiConfirm(`Delete person "${p.name || 'record'}"? This removes the persons-registry record (not any linked officer account).`, { confirmText: 'Delete' }))) return
    await deleteWithUndo('persons', p, {
      label: `Person "${p.name || 'record'}"`, noConfirm: true, after: () => void refresh(), setNullRefs: PERSON_NULL_REFS,
    })
  }

  // Drill-down: `?person=` swaps the registry for the full profile page (same
  // pattern as OperationsView's `?op=`). Signed-out visitors keep the gate.
  if (personId) {
    if (state !== 'in') return <Notice text="Live person records require sign-in." />
    return <PersonProfile id={personId} onBack={() => router.push('/persons')} />
  }

  return (
    <section className="view-in space-y-4">
      <Card pad="lg">
        <PageHeader
          title="🧑‍⚖️ Persons of Interest"
          subtitle="Suspects & persons of interest — linked to gangs & cases. ≥8 violent felonies flagged."
          actions={
            <>
              {state === 'in' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />live
                </span>
              )}
              {canEdit && (
                <Button variant="primary" onClick={() => setEditor({ record: null })}>
                  + New Person
                </Button>
              )}
            </>
          }
        />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter persons…"
          className="min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-badge-500"
        />
        <Button onClick={() => void refresh()}>↻ Refresh</Button>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 backdrop-blur">
          <span className="text-sm font-semibold text-rose-200">{selected.size} selected</span>
          <span className="flex gap-2">
            <Button size="sm" variant="danger" onClick={() => void deleteSelected()}>Delete selected</Button>
            <Button size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {state !== 'in' ? (
          <Notice text="Live person records require sign-in." className="sm:col-span-2 xl:col-span-3" />
        ) : err ? (
          <ErrorNotice message={err} onRetry={refresh} className="sm:col-span-2 xl:col-span-3" />
        ) : loading && !persons.length ? (
          <div className="sm:col-span-2 xl:col-span-3">
            <CardGridSkeleton cols="sm:grid-cols-2 xl:grid-cols-3" />
          </div>
        ) : !items.length ? (
          query.trim() && canEdit ? (
            <Card pad="none" className="p-8 text-center sm:col-span-2 xl:col-span-3">
              <p className="text-sm text-slate-400">No persons match &ldquo;{query.trim()}&rdquo;.</p>
              <Button variant="primary" className="mt-3" onClick={() => setEditor({ record: null, prefillName: query.trim() })}>
                ➕ Add &ldquo;{query.trim()}&rdquo; to registry
              </Button>
            </Card>
          ) : persons.length ? (
            <Notice text="No persons match your filter." className="sm:col-span-2 xl:col-span-3" />
          ) : (
            <EmptyState
              title="No persons on file yet"
              hint={canEdit ? 'Add one with the New Person button.' : undefined}
              className="sm:col-span-2 xl:col-span-3"
            />
          )
        ) : (
          <>
            {visible.map((p) => (
              <PersonCard
                key={p.id}
                p={p}
                gang={gangName(p.gang_id)}
                canEdit={canEdit}
                canDelete={canDelete}
                selected={selected.has(p.id)}
                onSelect={(on) => toggleSelect(p.id, on)}
                onProfile={() => router.push(`/persons?person=${encodeURIComponent(p.id)}`)}
                onEdit={() => setEditor({ record: p })}
                onDelete={() => void deleteOne(p)}
                onAttach={() => setAttach(p)}
              />
            ))}
            {remaining > 0 && (
              <div className="col-span-full pt-1 text-center">
                <Button size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => setPage({ q, shown: shown + PAGE })}>
                  Load {Math.min(remaining, PAGE)} more · {remaining} remaining
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {editor && (
        <PersonModal
          record={editor.record}
          prefillName={editor.prefillName}
          gangs={gangs}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void refresh() }}
        />
      )}
      {attach && <AttachToCaseModal person={attach} caseOptions={caseOptions} onClose={() => setAttach(null)} />}
    </section>
  )
}

interface PersonCardProps {
  p: PersonRow
  gang: string | null
  canEdit: boolean
  canDelete: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  onProfile: () => void
  onEdit: () => void
  onDelete: () => void
  onAttach: () => void
}

function PersonCard({ p, gang, canEdit, canDelete, selected, onSelect, onProfile, onEdit, onDelete, onAttach }: PersonCardProps) {
  const [imgBroken, setImgBroken] = useState(false)
  const flag = (p.felony_count || 0) >= 8
  const mug = safeUrl(p.mugshot_url ?? '')
  const propCount = Array.isArray(p.properties) ? p.properties.length : 0
  return (
    <Card>
      <div className="flex items-start gap-3">
        {mug && !imgBroken ? (
          /* eslint-disable-next-line @next/next/no-img-element -- external mugshot CDN */
          <img src={mug} alt="" onError={() => setImgBroken(true)} className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-xl" aria-hidden="true">👤</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">
            {p.name}
            {flag && <span title="≥8 violent felonies"> 🚨</span>}
            {p.bolo && <span className="ml-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-300">BOLO</span>}
          </p>
          <p className="text-xs text-slate-400">{p.alias ? `"${p.alias}" · ` : ''}{p.status || ''}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {gang ? `🚩 ${gang} · ` : ''}CCW {p.ccw ? 'Yes' : 'No'} · VCH {p.vch || 0} · Felonies {p.felony_count || 0}{propCount ? ` · 🏠 ${propCount}` : ''}
          </p>
        </div>
        <button onClick={onProfile} title="Unified intel profile" className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-semibold text-blue-200 transition hover:bg-white/10">🔎 Profile</button>
        {canEdit && <button onClick={onEdit} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>}
        {canDelete && (
          <label className="flex flex-shrink-0 items-center pl-1" title="Select for bulk delete">
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${p.name} for bulk delete`} className="h-4 w-4 accent-rose-500" />
          </label>
        )}
        {canDelete && <button onClick={onDelete} title="Delete person (command only)" className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>}
      </div>
      {canEdit && (
        <button onClick={onAttach} className="mt-3 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-white/10">
          📎 Attach to case
        </button>
      )}
      {p.notes && <p className="mt-3 line-clamp-2 text-xs text-slate-400">{p.notes}</p>}
    </Card>
  )
}

/** Attach an intel record to a case by posting a reference into the case
 *  channel — vanilla casefiles.js attachIntelToCase. Keeps the intel on the
 *  case record without a schema change. */
function AttachToCaseModal({ person, caseOptions, onClose }: { person: PersonRow; caseOptions: CaseOption[]; onClose: () => void }) {
  const { profile } = useAuth()
  const sorted = useMemo(
    () => caseOptions.slice().sort((a, b) => (a.case_number || '').localeCompare(b.case_number || '')),
    [caseOptions],
  )
  const [caseId, setCaseId] = useState(sorted[0]?.id || '')
  const label = `Person — ${person.name}${person.alias ? ` "${person.alias}"` : ''} · ${person.status || 'POI'}${person.felony_count ? `, ${person.felony_count} felonies` : ''}`

  const go = async () => {
    if (!caseId) return
    const res = await insert('case_messages', {
      case_id: caseId,
      author_name: profile?.display_name || 'CID',
      body: `🔗 Intel reference — ${label}`,
      mentions: [],
      links: [],
    })
    if (res.error) { toast(`Attach failed: ${res.error.message}`, 'danger'); return }
    const num = sorted.find((c) => c.id === caseId)?.case_number || 'case'
    toast(`Reference posted to ${num} channel`, 'success')
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Attach to case" onClose={onClose} />
        <p className="mb-3 text-sm text-slate-400">Posts a reference to <span className="text-white">{label}</span> into the case channel.</p>
        {sorted.length ? (
          <>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Case to attach the reference to" className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
              {sorted.map((c) => <option key={c.id} value={c.id}>{c.case_number} · {c.title || ''}</option>)}
            </select>
            <Button variant="primary" className="mt-4 w-full" onClick={() => void go()}>
              Attach reference
            </Button>
          </>
        ) : (
          <p className="text-sm text-slate-400">No cases available to attach to.</p>
        )}
      </div>
    </Modal>
  )
}
