'use client'

/** Operations / Task Forces — list + detail workspace. A NORMAL operation is
 *  bureau-owned coordination (today's behavior); a JTF operation is a
 *  multi-bureau joint workspace: lead bureau, participating bureaus, and
 *  linked cases that become joint WITHIN the operation's scope. All authority
 *  shown here is a client mirror — RLS, the guard/sync triggers and the
 *  lifecycle RPCs re-decide server-side (20260810120000_jtf_operations). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { uiConfirm } from '@/components/ui/dialog'
import { deleteWithUndo, list, insert, rpc, update } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { OPS_CASE_COLS, OP_SEG_COLOR, OP_STATUSES, opStatusTint, type OpsCaseRow, useOperationsStore } from '@/lib/operations'
import {
  OPERATION_STATUSES, activeBureaus, canLinkCaseToOp, canManageOperation, canUnlinkCaseFromOp,
  isJtf, isOpEnded, operationTimeline, type OpBureauRow, type OpCaseLinkRow, type OpViewer,
} from '@/lib/opsJoint'
import { PERMANENT_BUREAUS, bureauLabel, deptLabel } from '@/lib/roles'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

type OperationRow = Tables<'operations'>

const CONTROL = 'rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white'

export function OperationsView() {
  const router = useRouter()
  const sp = useSearchParams()
  const { profile, canEdit, canDelete, isCommand, isOwner } = useAuth()
  const operations = useOperationsStore((s) => s.operations)
  const fetchOps = useOperationsStore((s) => s.fetch)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [cases, setCases] = useState<OpsCaseRow[]>([])
  const [bureaus, setBureaus] = useState<OpBureauRow[]>([])
  const [links, setLinks] = useState<OpCaseLinkRow[]>([])
  const [modal, setModal] = useState<OperationRow | null | 'new'>(null)
  const version = useTableVersion('operations')
  const casesVersion = useTableVersion('cases')
  const bureausVersion = useTableVersion('operation_bureaus')
  const linksVersion = useTableVersion('operation_case_links')
  const opId = sp.get('op')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    await fetchOps()
    try { setCases((await list('cases', { select: OPS_CASE_COLS, order: 'updated_at', ascending: false })) as unknown as OpsCaseRow[]) } catch { /* stale */ }
    if (opId) {
      // Participation + link history for the open operation (RLS-scoped:
      // link rows follow case visibility, so each viewer sees their slice).
      try { setBureaus(await list('operation_bureaus', { eq: { operation_id: opId }, order: 'joined_at' })) } catch { setBureaus([]) }
      try { setLinks(await list('operation_case_links', { eq: { operation_id: opId }, order: 'added_at', ascending: false })) } catch { setLinks([]) }
    }
  }, [fetchOps, fetchProfiles, opId])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, version, casesVersion, bureausVersion, linksVersion])

  const viewer: OpViewer = useMemo(() => ({
    userId: profile?.id ?? null,
    active: !!profile?.active,
    role: profile?.role ?? null,
    division: profile?.division ?? null,
    isCommand,
    isOwner,
  }), [profile, isCommand, isOwner])

  const selected = operations.find((o) => o.id === opId)
  if (opId && selected) {
    return (
      <OperationDetail
        op={selected}
        viewer={viewer}
        bureaus={bureaus}
        links={links}
        cases={cases.filter((c) => c.operation_id === opId)}
        allCases={cases}
        canDelete={canDelete}
        onBack={() => router.push('/operations')}
        onChanged={refresh}
        onEdit={() => setModal(selected)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Operations"
        eyebrow="Active Task Forces"
        actions={canEdit && <Button variant="primary" onClick={() => setModal('new')}>New Operation</Button>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {operations.map((op) => <OperationCard key={op.id} op={op} cases={cases.filter((c) => c.operation_id === op.id)} onOpen={() => router.push(`/operations?op=${op.id}`)} />)}
      </div>
      {!operations.length && <Notice text="No operations yet." />}
      <OperationModal open={!!modal} record={modal === 'new' ? null : modal} viewer={viewer} onClose={() => setModal(null)} onSaved={() => { setModal(null); void refresh() }} />
    </div>
  )
}

function OperationCard({ op, cases, onOpen }: { op: OperationRow; cases: OpsCaseRow[]; onOpen: () => void }) {
  const counts = OP_STATUSES.map((s) => cases.filter((c) => c.status === s).length)
  const total = Math.max(1, cases.length)
  return (
    <button onClick={onOpen} className="rounded-lg border border-white/5 bg-ink-900/60 p-4 text-left transition hover:border-badge-400/50">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-black text-white">{op.name}</h3>
        <Badge tint={opStatusTint(op.status)} className="uppercase">{op.status}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {isJtf(op)
          ? <Badge tint="bg-violet-500/15 text-violet-300">JTF{op.lead_bureau ? ` · Lead ${deptLabel(op.lead_bureau)}` : ''}</Badge>
          : op.bureau && <Badge>{deptLabel(op.bureau)}</Badge>}
      </div>
      <p className="mt-2 line-clamp-3 min-h-[3.75rem] text-sm text-slate-400">{op.description || 'No description recorded.'}</p>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-white/5">
        {OP_STATUSES.map((s, i) => <span key={s} className={OP_SEG_COLOR[s]} style={{ width: `${(counts[i] / total) * 100}%` }} />)}
      </div>
      <p className="mt-3 text-xs text-slate-500">{cases.length} linked cases - updated {timeAgo(op.updated_at)}</p>
    </button>
  )
}

function OperationDetail({ op, viewer, bureaus, links, cases, allCases, canDelete, onBack, onChanged, onEdit }: {
  op: OperationRow
  viewer: OpViewer
  bureaus: OpBureauRow[]
  links: OpCaseLinkRow[]
  cases: OpsCaseRow[]
  allCases: OpsCaseRow[]
  canDelete: boolean
  onBack: () => void
  onChanged: () => void
  onEdit: () => void
}) {
  const router = useRouter()
  const [pick, setPick] = useState('')
  const [convertOpen, setConvertOpen] = useState(false)
  const [addBureau, setAddBureau] = useState('')
  const parts = activeBureaus(bureaus)
  const jtf = isJtf(op)
  const manages = canManageOperation(viewer, op, parts)

  // Which cases may THIS viewer contribute? (Server re-validates in the sync
  // trigger — this only filters the picker so unauthorized options never show.)
  const linkable = allCases.filter((c) =>
    canLinkCaseToOp(viewer, c, op, parts))

  const linkCase = async () => {
    if (!pick) return
    const res = await update('cases', pick, { operation_id: op.id })
    if (res.error) toast(res.error.message, 'danger')
    else { setPick(''); toast(jtf ? 'Case linked — joint within this operation.' : 'Case linked.', 'success'); onChanged() }
  }
  const unlink = async (c: OpsCaseRow) => {
    if (jtf && !(await uiConfirm(
      `${c.case_number} keeps its historical joint participation, but partner bureaus lose active access through this operation.`,
      { title: 'Remove case from JTF operation?', confirmText: 'Remove case' },
    ))) return
    const res = await update('cases', c.id, { operation_id: null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Case removed from operation — history retained.', 'success'); onChanged() }
  }
  const del = async () => {
    const ok = await deleteWithUndo('operations', op, { label: op.name, setNullRefs: [{ table: 'cases', column: 'operation_id' }] })
    if (ok) { onBack(); onChanged() }
  }
  const setStatus = async (s: string) => {
    if (isOpEnded(s) && !isOpEnded(op.status) && jtf) {
      const ok = await uiConfirm(
        'Linked cases KEEP their operation link and historical joint markers. Cross-bureau access through this operation ends until it is reactivated.',
        { title: s === 'resolved' ? 'Resolve JTF operation?' : 'Close JTF operation?', confirmText: s === 'resolved' ? 'Resolve operation' : 'Close operation', danger: false },
      )
      if (!ok) return
    }
    const res = await update('operations', op.id, { status: s })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Operation status updated.', 'success'); onChanged() }
  }
  const doAddBureau = async () => {
    if (!addBureau) return
    const res = await rpc('operation_add_bureau', { p_op: op.id, p_bureau: addBureau as OpBureauRow['bureau'] })
    if (res.error) toast(res.error.message, 'danger')
    else { setAddBureau(''); toast(`${bureauLabel(addBureau)} joined the operation.`, 'success'); onChanged() }
  }
  const removeBureau = async (b: string) => {
    if (!(await uiConfirm(
      'The bureau must have no linked cases in this operation. Its participation history is kept.',
      { title: `Remove ${bureauLabel(b)}?`, confirmText: 'Remove bureau' },
    ))) return
    const res = await rpc('operation_remove_bureau', { p_op: op.id, p_bureau: b as OpBureauRow['bureau'] })
    if (res.error) toast(res.error.message, 'danger')
    else { toast(`${bureauLabel(b)} removed from the operation.`, 'success'); onChanged() }
  }
  const setLead = async (b: string) => {
    const res = await rpc('operation_set_lead', { p_op: op.id, p_bureau: b as OpBureauRow['bureau'] })
    if (res.error) toast(res.error.message, 'danger')
    else { toast(`${bureauLabel(b)} is now the lead bureau.`, 'success'); onChanged() }
  }
  const revert = async () => {
    if (!(await uiConfirm(
      'Requires every other bureau’s cases to be unlinked first. Participation history and historical joint markers on cases are kept.',
      { title: 'Revert to a normal operation?', confirmText: 'Revert to normal', danger: false },
    ))) return
    const res = await rpc('operation_revert_to_normal', { p_op: op.id })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Operation reverted to a single-bureau operation.', 'success'); onChanged() }
  }

  // Personnel (derived): lead detectives of the linked cases, per bureau.
  const personnel = useMemo(() => {
    const seen = new Map<string, { name: string; bureau: string | null; caseCount: number }>()
    for (const c of cases) {
      if (!c.lead_detective_id) continue
      const cur = seen.get(c.lead_detective_id)
      if (cur) cur.caseCount++
      else seen.set(c.lead_detective_id, { name: officerName(c.lead_detective_id) || 'Unknown', bureau: c.bureau, caseCount: 1 })
    }
    return [...seen.values()]
  }, [cases])

  const timeline = useMemo(() => {
    const numberOf = new Map(allCases.map((c) => [c.id, c.case_number]))
    return operationTimeline(op, bureaus, links.map((l) => ({ ...l, caseNumber: numberOf.get(l.case_id) ?? null })))
  }, [op, bureaus, links, allCases])

  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: 'Operations', onClick: onBack }, { label: op.name }]} />

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-white/5 bg-ink-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tint={opStatusTint(op.status)} className="uppercase">{op.status}</Badge>
              {jtf
                ? <Badge tint="bg-violet-500/15 text-violet-300">Joint Task Force · Lead {deptLabel(op.lead_bureau)}</Badge>
                : op.bureau
                  ? <Badge>{deptLabel(op.bureau)} operation</Badge>
                  : <Badge>Operation</Badge>}
            </div>
            <h1 className="text-2xl font-black text-white">{op.name}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">{op.description || 'No description recorded.'}</p>
            {jtf && (
              <p className="mt-2 text-xs text-slate-500">
                Cases linked here are joint for the participating bureaus. {deptLabel(op.lead_bureau)} coordinates the operation — linked cases keep their owning bureau and lead detective.
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {manages && (
              <select aria-label="Operation status" value={op.status} onChange={(e) => void setStatus(e.target.value)} className={CONTROL}>
                {[...new Set([...OPERATION_STATUSES, op.status])].map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
              </select>
            )}
            {manages && <Button onClick={onEdit}>Edit</Button>}
            {!jtf && viewer.isCommand && op.status === 'active' && (
              <Button variant="primary" onClick={() => setConvertOpen(true)}>Make Joint / JTF</Button>
            )}
            {jtf && manages && <Button onClick={() => void revert()}>Revert to normal</Button>}
            {canDelete && manages && <Button variant="danger" onClick={() => void del()}>Delete</Button>}
          </div>
        </div>
      </section>

      {/* ── Participating bureaus (JTF) ──────────────────────────────────── */}
      {jtf && (
        <section className="rounded-lg border border-white/5 bg-ink-900/60 p-5">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Participating bureaus</h2>
          <div className="space-y-2">
            {bureaus.filter((b) => !b.left_at).map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-ink-950/50 p-3">
                <Badge tint={b.bureau === op.lead_bureau ? 'bg-violet-500/15 text-violet-300' : undefined}>
                  {deptLabel(b.bureau)}{b.bureau === op.lead_bureau ? ' · LEAD' : ''}
                </Badge>
                <span className="text-xs text-slate-500">
                  {bureauLabel(b.bureau)} — joined {timeAgo(b.joined_at)}{b.joined_by ? ` by ${officerName(b.joined_by)}` : ''}
                </span>
                <span className="ml-auto flex gap-2">
                  {manages && b.bureau !== op.lead_bureau && !isOpEnded(op.status) && (
                    <>
                      <button onClick={() => void setLead(b.bureau)} className="text-xs font-bold text-slate-300 hover:text-white">Make lead</button>
                      <button onClick={() => void removeBureau(b.bureau)} className="text-xs font-bold text-rose-300 hover:text-rose-200">Remove</button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
          {manages && !isOpEnded(op.status) && (
            <div className="mt-3 flex gap-2">
              <select value={addBureau} onChange={(e) => setAddBureau(e.target.value)} className={`${CONTROL} min-w-0 flex-1`} aria-label="Add participating bureau">
                <option value="">Add a bureau…</option>
                {PERMANENT_BUREAUS.filter((b) => !parts.includes(b)).map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}
              </select>
              <Button onClick={() => void doAddBureau()}>Add bureau</Button>
            </div>
          )}
        </section>
      )}

      {/* ── Cases ────────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-white/5 bg-ink-900/60 p-5">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Cases</h2>
        {linkable.length > 0 && !isOpEnded(op.status) && (
          <div className="mb-3 flex gap-2 rounded-lg bg-ink-900/50 p-3">
            <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${CONTROL} min-w-0 flex-1`} aria-label="Link a case">
              <option value="">{jtf ? 'Add one of your cases to this JTF…' : 'Link a case…'}</option>
              {linkable.map((c) => <option key={c.id} value={c.id}>{c.case_number} - {c.title}{jtf ? ` (${deptLabel(c.bureau)})` : ''}</option>)}
            </select>
            <Button variant="primary" onClick={() => void linkCase()}>{jtf ? 'Add Case' : 'Link'}</Button>
          </div>
        )}
        <div className="space-y-2">
          {cases.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg bg-ink-950/50 p-3">
              <button onClick={() => router.push(`/cases?case=${c.id}`)} className="min-w-0 flex-1 text-left">
                <p className="flex flex-wrap items-center gap-2 font-mono text-sm font-bold text-badge-200">
                  {c.case_number}
                  {jtf && <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase text-violet-300">Joint</span>}
                </p>
                <p className="font-semibold text-white">{c.title || 'Untitled case'}</p>
                <p className="text-xs text-slate-500">{deptLabel(c.bureau)} - {c.status} - {officerName(c.lead_detective_id) || 'Unassigned'}</p>
              </button>
              {canUnlinkCaseFromOp(viewer, c, op) && (
                <button onClick={() => void unlink(c)} className="text-sm font-bold text-rose-300">{jtf ? 'Remove' : 'Unlink'}</button>
              )}
            </div>
          ))}
          {!cases.length && <Notice text={jtf ? 'No cases linked yet — participating bureaus can add their own cases above.' : 'No cases linked to this operation.'} />}
        </div>
        {jtf && links.some((l) => l.removed_at) && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-300">
              Former participations ({links.filter((l) => l.removed_at).length})
            </summary>
            <div className="mt-2 space-y-1">
              {links.filter((l) => l.removed_at).map((l) => {
                const c = allCases.find((x) => x.id === l.case_id)
                return (
                  <p key={l.id} className="text-xs text-slate-500">
                    {c?.case_number ?? 'Case'} — removed {timeAgo(l.removed_at as string)}{l.removed_by ? ` by ${officerName(l.removed_by)}` : ''}{l.removal_reason ? ` · ${l.removal_reason}` : ''}
                  </p>
                )
              })}
            </div>
          </details>
        )}
      </section>

      {/* ── Personnel (derived from linked cases) ────────────────────────── */}
      {jtf && personnel.length > 0 && (
        <section className="rounded-lg border border-white/5 bg-ink-900/60 p-5">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Personnel</h2>
          <div className="flex flex-wrap gap-2">
            {personnel.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
                <span className="font-semibold">{p.name}</span>
                <span className="text-slate-500">{deptLabel(p.bureau)} · {p.caseCount} case{p.caseCount === 1 ? '' : 's'}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Timeline (derived) ───────────────────────────────────────────── */}
      <section className="rounded-lg border border-white/5 bg-ink-900/60 p-5">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Timeline</h2>
        <div className="space-y-2">
          {timeline.map((e, i) => (
            <div key={`${e.at}-${i}`} className="rounded-lg bg-ink-950/50 p-3">
              <p className="font-semibold text-white">{e.label}</p>
              <p className="text-sm text-slate-400">{timeAgo(e.at)}{e.sub ? ` - ${e.sub}` : ''}</p>
            </div>
          ))}
        </div>
      </section>

      <ConvertToJtfModal open={convertOpen} op={op} viewerDivision={viewer.division} onClose={() => setConvertOpen(false)} onDone={() => { setConvertOpen(false); onChanged() }} />
    </div>
  )
}

function ConvertToJtfModal({ open, op, viewerDivision, onClose, onDone }: {
  open: boolean
  op: OperationRow
  viewerDivision: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [lead, setLead] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      const home = op.bureau ?? viewerDivision
      setLead(home && home !== 'JTF' ? home : '')
      setPicked(home && home !== 'JTF' ? [home] : [])
    })
  }, [open, op, viewerDivision])

  const toggle = (b: string) => {
    setPicked((p) => p.includes(b) ? p.filter((x) => x !== b) : [...p, b])
  }
  const convert = async () => {
    if (!lead || picked.length < 2) { toast('Pick a lead bureau and at least two participating bureaus.', 'warn'); return }
    if (!picked.includes(lead)) { toast('The lead bureau must be one of the participants.', 'warn'); return }
    const res = await rpc('operation_convert_to_jtf', {
      p_op: op.id, p_lead: lead as OpBureauRow['bureau'], p_bureaus: picked as OpBureauRow['bureau'][],
    })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Operation converted to a Joint Task Force.', 'success'); onDone() }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <ModalHeader title="Make Joint / JTF operation" onClose={onClose} />
        <p className="mb-4 text-sm text-slate-400">
          Participating bureaus can add their own cases to <span className="font-semibold text-slate-200">{op.name}</span>; every linked case becomes a joint case within this operation while keeping its owning bureau and lead detective.
        </p>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm text-slate-300">Participating bureaus</p>
            <div className="flex flex-wrap gap-2">
              {PERMANENT_BUREAUS.map((b) => (
                <label key={b} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${picked.includes(b) ? 'border-badge-400/60 bg-badge-500/10 text-white' : 'border-white/10 bg-ink-950 text-slate-300'}`}>
                  <input type="checkbox" checked={picked.includes(b)} onChange={() => toggle(b)} className="accent-badge-500" />
                  {bureauLabel(b)}
                </label>
              ))}
            </div>
          </div>
          <label className="block text-sm text-slate-300">
            Lead bureau (coordinates — does not take over cases)
            <select value={lead} onChange={(e) => setLead(e.target.value)} className={`${CONTROL} mt-1 w-full`}>
              <option value="">Select…</option>
              {picked.map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={convert}>Convert to JTF</Button>
        </div>
      </div>
    </Modal>
  )
}

function OperationModal({ open, record, viewer, onClose, onSaved }: { open: boolean; record: OperationRow | null; viewer: OpViewer; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [status, setStatus] = useState('active')
  const [description, setDescription] = useState('')
  useEffect(() => { if (open) queueMicrotask(() => { setName(record?.name ?? ''); setStatus(record?.status ?? 'active'); setDescription(record?.description ?? '') }) }, [open, record])
  const save = async () => {
    if (!name.trim()) { toast('Operation name is required.', 'warn'); return }
    const patch = { name: name.trim(), status, description: description.trim() || null }
    const res = record ? await update('operations', record.id, patch) : await insert('operations', patch)
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Operation saved.', 'success'); onSaved() }
  }
  const dirty = () =>
    name !== (record?.name ?? '') || status !== (record?.status ?? 'active') || description !== (record?.description ?? '')
  return (
    <Modal open={open} onClose={onClose} dirty={dirty}>
      <div className="p-5">
        <ModalHeader title={record ? 'Edit operation' : 'New operation'} onClose={onClose} />
        {!record && viewer.division && viewer.division !== 'JTF' && (
          <p className="mb-3 text-xs text-slate-500">New operations belong to your bureau ({bureauLabel(viewer.division)}). Command can convert one to a Joint Task Force from its page.</p>
        )}
        <div className="space-y-3">
          <label className="block text-sm text-slate-300">Name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" /></label>
          <label className="block text-sm text-slate-300">Status<select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white"><option value="active">Active</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label>
          <label className="block text-sm text-slate-300">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" /></label>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onAction={save}>Save</Button></div>
      </div>
    </Modal>
  )
}
