'use client'

/** Version history modal — immutable documents_versions snapshots through the
 *  shared VersionViewer, a two-version compare (pure line diff, docDiff), and
 *  a governed restore: pick a version, preview the diff against the current
 *  text, give a reason, and rpc document_restore_version does the write (a
 *  'restore' change-type version is captured server-side — there is no
 *  direct-overwrite path). Versions load lazily when the modal opens. */
import { useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { renderMarkdown } from '@/lib/markdown'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { DiffView } from './docDiff'
import { CHANGE_TYPE_LABEL, docTitle, type ChangeType, type DocRow } from './docModel'

type VersionRow = Tables<'documents_versions'>

const bodyOf = (d: DocRow): string => {
  const c = d.content
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const b = (c as Record<string, unknown>).body
    if (typeof b === 'string') return b
  }
  return ''
}
const versionBody = (v: VersionRow): string => {
  const c = v.content
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const b = (c as Record<string, unknown>).body
    if (typeof b === 'string') return b
  }
  return ''
}

const changeLabel = (t: string | null): string => (t ? CHANGE_TYPE_LABEL[t as ChangeType] ?? t : 'Edit')
const vName = (v: VersionRow | undefined): string => (v ? `v${v.version_number ?? '?'} — ${changeLabel(v.change_type)}` : '—')

/** One metadata delta row above the diff (name / change type / effective). */
function MetaDelta({ label, a, b }: { label: string; a: string; b: string }) {
  if (a === b) return null
  return (
    <p className="text-xs text-slate-400">
      <span className="font-semibold uppercase tracking-wide text-slate-500">{label}</span>{' '}
      <span className="text-rose-300 line-through">{a || '—'}</span>{' → '}
      <span className="text-emerald-300">{b || '—'}</span>
    </p>
  )
}

export function DocHistoryModal({ doc, canEdit, onClose, onChanged }: {
  doc: DocRow
  /** UX mirror of canEditDoc — the restore RPC re-decides server-side. */
  canEdit: boolean
  onClose: () => void
  /** The reader refetches (a restore bumps the current version). */
  onChanged: () => void
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [baseId, setBaseId] = useState<string>('')
  const [otherId, setOtherId] = useState<string>('')
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let on = true
    void (async () => {
      try {
        const rows = await list('documents_versions', {
          eq: { document_id: doc.id }, order: 'version_number', ascending: false,
        })
        if (!on) return
        setVersions(rows)
        // Default compare: previous → current.
        if (rows.length >= 2) { setBaseId(rows[1].id); setOtherId(rows[0].id) }
        else if (rows.length === 1) { setBaseId(rows[0].id); setOtherId(rows[0].id) }
      } catch (e) { if (on) setLoadError(e) }
    })()
    return () => { on = false }
  }, [doc.id, tick])

  const base = useMemo(() => versions?.find((v) => v.id === baseId), [versions, baseId])
  const other = useMemo(() => versions?.find((v) => v.id === otherId), [versions, otherId])
  const restoreTarget = useMemo(() => versions?.find((v) => v.id === restoreId) ?? null, [versions, restoreId])

  const restore = async () => {
    if (!restoreTarget) return
    const r = reason.trim()
    if (!r) { toast('A reason is required to restore a version.', 'warn'); return }
    const ok = await uiConfirm(
      `Restore ${vName(restoreTarget)}? The current text is preserved as a version and readers may need to re-acknowledge.`,
      { title: 'Restore version', confirmText: 'Restore', danger: false },
    )
    if (!ok) return
    const res = await rpc('document_restore_version', { p_document: doc.id, p_version: restoreTarget.id, p_reason: r })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`Restored ${vName(restoreTarget)}`, 'success')
    setRestoreId(null)
    setReason('')
    setTick((t) => t + 1)
    onChanged()
  }

  return (
    <Modal open onClose={onClose} wide dirty={() => !!restoreId && reason.trim() !== ''}>
      <ModalHeader title={`History — ${docTitle(doc.name)}`} onClose={onClose} />
      {loadError != null ? (
        <ErrorNotice message={loadError} onRetry={() => { setLoadError(null); setVersions(null); setTick((t) => t + 1) }} />
      ) : !versions ? (
        <ListSkeleton count={4} />
      ) : (
        <div className="space-y-5">
          <section>
            <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Versions</h4>
            {!versions.length ? (
              <p className="text-sm text-slate-500">No versions recorded yet — a snapshot is captured on every save.</p>
            ) : (
              <ol className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {versions.map((v, i) => {
                  const latest = i === 0
                  const open = openId === v.id
                  const by = officerName(v.saved_by)
                  return (
                    <li key={v.id} className="relative pl-6">
                      {/* Timeline rail — a node dot per version, a connector to the next. */}
                      {i < versions.length - 1 && (
                        <span aria-hidden className="absolute left-[6px] top-4 -bottom-3 w-px bg-white/10" />
                      )}
                      <span aria-hidden className={`absolute left-[2px] top-3 h-3 w-3 rounded-full border-2 ${latest ? 'border-badge-500 bg-badge-500/30' : 'border-white/20 bg-ink-900'}`} />
                      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-blue-300">v{v.version_number ?? '?'}</span>
                          {latest && <Badge tone="accent">Latest</Badge>}
                          <Badge tone="neutral">{changeLabel(v.change_type)}</Badge>
                          <span className="ml-auto text-xs text-slate-400">
                            {v.saved_at ? fmtDateTime(v.saved_at) : ''}{by ? ` · ${by}` : ''}
                          </span>
                        </div>
                        {v.change_summary && <p className="mt-1.5 text-sm text-slate-300">{v.change_summary}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={open}
                            onClick={() => setOpenId(open ? null : v.id)}
                          >
                            {open ? 'Hide contents' : 'View contents'}
                          </Button>
                          {canEdit && !latest && (
                            <Button size="sm" onClick={() => { setRestoreId(v.id); setReason('') }}>Restore…</Button>
                          )}
                        </div>
                        {open && (
                          <div className="mt-2 border-t border-white/10 pt-2 text-sm text-slate-200">
                            {renderMarkdown(versionBody(v))}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          {restoreTarget && (
            <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Restore {vName(restoreTarget)}
              </h4>
              <p className="mb-2 text-xs text-slate-400">Changes the restore would apply to the current text:</p>
              <DiffView base={bodyOf(doc)} other={versionBody(restoreTarget)} className="mb-3" />
              <Field label="Reason" required hint="Recorded on the restore version for the audit trail.">
                {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this version is being restored" />}
              </Field>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button onClick={() => { setRestoreId(null); setReason('') }}>Cancel</Button>
                <Button variant="warn" onAction={restore}>Restore version</Button>
              </div>
            </section>
          )}

          {versions.length >= 2 && !restoreTarget && (
            <section>
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Compare</h4>
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="From">
                  {(id) => (
                    <Select id={id} value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                      {versions.map((v) => <option key={v.id} value={v.id}>{vName(v)}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="To">
                  {(id) => (
                    <Select id={id} value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                      {versions.map((v) => <option key={v.id} value={v.id}>{vName(v)}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
              {base && other && (
                <>
                  <div className="mb-2 space-y-1">
                    <MetaDelta label="Title" a={base.name ?? ''} b={other.name ?? ''} />
                    <MetaDelta label="Change type" a={changeLabel(base.change_type)} b={changeLabel(other.change_type)} />
                    <MetaDelta label="Effective" a={base.effective_at ? fmtDate(base.effective_at) : ''} b={other.effective_at ? fmtDate(other.effective_at) : ''} />
                  </div>
                  <DiffView base={versionBody(base)} other={versionBody(other)} />
                </>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}
