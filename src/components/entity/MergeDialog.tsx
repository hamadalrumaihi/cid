'use client'

/** MergeDialog — preview, then merge, through the generic entity ledger
 *  (P2-04). Opening calls `entity_merge_preview` and renders the manifest
 *  the server would write: per victim, the rows that repoint to the
 *  survivor, the rows that will be dropped (and why), the scalar fields the
 *  survivor gains, and how the victim is tombstoned. Nothing is computed
 *  client-side; a refusal (`held`, `denied`, `already_merged` …) is rendered
 *  in the server's words via refusalText.
 *
 *  Cosmetic gate only: the Merge button shows for owner/command (or SIB
 *  command standing) — `entity_merge` re-checks and the `{ ok:false }`
 *  answer is always handled. `MergeDialog` reads usePermissions; the panel
 *  underneath takes `canMerge` as a prop so stories and tests can render it
 *  without an AuthProvider. */
import { useEffect, useState } from 'react'
import {
  mergeEntities, previewMerge, refusalText,
  type ApiResult, type MergeKind, type MergeManifest, type MergePreviewResult, type MergeResult, type Refusal,
} from '@/lib/entity'
import type { EntityHit } from '@/lib/entitySearch'
import { usePermissions, type MyPermissions } from '@/lib/permissions'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { TOMBSTONE_LABEL, cellText, fieldLabel, tableLabel } from './labels'

/** Story/test seam — production is the entity API. */
export interface MergeApi {
  preview: (kind: MergeKind, survivorId: string, victimIds: string[]) => Promise<ApiResult<MergePreviewResult>>
  merge: (kind: MergeKind, survivorId: string, victimIds: string[], reason: string) => Promise<ApiResult<MergeResult>>
}
const LIVE_API: MergeApi = { preview: previewMerge, merge: mergeEntities }

export interface MergeDialogProps {
  kind: MergeKind
  survivor: EntityHit
  victims: EntityHit[]
  open: boolean
  onClose: () => void
  onMerged: (res: MergeResult) => void
  api?: MergeApi
}

/** Who sees the Merge button (the server decides who may press it). */
export function mayMerge(p: MyPermissions): boolean {
  return p.access_class === 'owner' || p.access_class === 'command'
    || p.sib_standing === 'owner' || p.sib_standing === 'special_agent_in_charge'
}

export function MergeDialog(props: MergeDialogProps) {
  const { perms } = usePermissions()
  return <MergeDialogPanel {...props} canMerge={mayMerge(perms)} />
}

type Preview =
  | { status: 'loading' }
  | { status: 'refused'; refusal: Refusal }
  | { status: 'error'; message: string }
  | { status: 'ready'; manifest: MergeManifest }

export function MergeDialogPanel({ kind, survivor, victims, open, onClose, onMerged, canMerge, api = LIVE_API }: MergeDialogProps & { canMerge: boolean }) {
  const [preview, setPreview] = useState<Preview>({ status: 'loading' })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const victimKey = victims.map((v) => v.id).join(',')

  useEffect(() => {
    if (!open || !victimKey) return
    let live = true
    // State writes after an await only (the ShiftsView idiom) — no
    // synchronous cascading render from the effect body.
    void (async () => {
      await Promise.resolve()
      if (!live) return
      setPreview({ status: 'loading' })
      setRefused(null)
      setReason('')
      const res = await api.preview(kind, survivor.id, victimKey.split(','))
      if (!live) return
      if (res.error || !res.data) setPreview({ status: 'error', message: res.error?.message ?? 'The preview did not come back.' })
      else if (!res.data.ok) setPreview({ status: 'refused', refusal: res.data })
      else setPreview({ status: 'ready', manifest: res.data.manifest })
    })()
    return () => { live = false }
  }, [open, kind, survivor.id, victimKey, api])

  const merge = async () => {
    if (!reason.trim()) { toast('A reason is required to merge records.', 'warn'); return }
    setBusy(true)
    setRefused(null)
    const res = await api.merge(kind, survivor.id, victimKey.split(','), reason.trim())
    setBusy(false)
    if (res.error || !res.data) { toast(res.error?.message ?? 'Merge failed.', 'danger'); return }
    if (!res.data.ok) { const t = refusalText(res.data); setRefused(t); toast(t, 'danger'); return }
    toast(`Merged ${victims.length} record${victims.length === 1 ? '' : 's'} into ${survivor.label}`, 'success')
    onMerged(res.data)
  }

  const n = victims.length

  return (
    <Modal open={open} wide onClose={onClose} dirty={() => reason.trim().length > 0}>
      <div className="p-6">
        <ModalHeader title={`Merge ${n} record${n === 1 ? '' : 's'} into ${survivor.label}`} onClose={onClose} />

        <p className="sr-only" aria-live="polite">
          {preview.status === 'loading' ? 'Preparing the merge preview…' : preview.status === 'ready' ? 'Preview ready.' : refused ?? ''}
        </p>

        {preview.status === 'loading' && <ListSkeleton count={3} />}

        {preview.status === 'error' && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-200">{preview.message}</div>
        )}

        {preview.status === 'refused' && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-200">
            {refusalText(preview.refusal)}
            {preview.refusal.hold_cases && preview.refusal.hold_cases.length > 0 && (
              <p className="mt-1 text-xs text-rose-200/80">Held cases: {preview.refusal.hold_cases.join(', ')}</p>
            )}
          </div>
        )}

        {preview.status === 'ready' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              <span className="font-semibold text-emerald-300">{preview.manifest.survivor.label}</span> survives. The merged
              records become read-only tombstones pointing at it — nothing is deleted, and the merge can be reversed for 30 days.
            </p>

            {preview.manifest.victims.map((v) => {
              const repoints = Object.entries(v.repointed).filter(([, c]) => c > 0)
              const fills = Object.entries(v.scalar_fill)
              return (
                <div key={v.id} className="rounded-lg border border-white/10 bg-ink-900 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{v.label}</span>
                    <Badge tone="neutral">{TOMBSTONE_LABEL[v.tombstone] ?? v.tombstone}</Badge>
                  </div>

                  <p className="mt-2 text-xs font-medium text-slate-400">Linked rows that move to the survivor</p>
                  {repoints.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {repoints.map(([k, c]) => <Badge key={k} tone="neutral">{tableLabel(k)}: {c}</Badge>)}
                    </div>
                  ) : <p className="mt-1 text-xs text-slate-400">None.</p>}

                  {v.dropped.length > 0 && (
                    <>
                      <p className="mt-2 text-xs font-medium text-slate-400">Rows that will be dropped (kept in the ledger for unmerge)</p>
                      <ul className="mt-1 space-y-0.5">
                        {v.dropped.map((d, i) => (
                          <li key={i} className="text-xs text-slate-300">{tableLabel(d.table)} — {d.why.replace(/_/g, ' ')}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  {fills.length > 0 && (
                    <>
                      <p className="mt-2 text-xs font-medium text-slate-400">Fields the survivor gains</p>
                      <ul className="mt-1 space-y-0.5">
                        {fills.map(([col, f]) => (
                          <li key={col} className="text-xs text-slate-300">
                            <span className="font-semibold text-slate-200">{fieldLabel(col)}:</span>{' '}
                            <span className="text-slate-400">{cellText(f.from) || '—'}</span> → <span className="text-emerald-300">{cellText(f.to) || '—'}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {v.notes_from && <p className="mt-2 text-xs text-slate-400">Notes are carried over and appended to the survivor.</p>}
                </div>
              )
            })}

            {preview.manifest.added_aliases.length > 0 && (
              <p className="text-xs text-slate-400">
                Aliases added to the survivor: <span className="text-slate-200">{preview.manifest.added_aliases.join(', ')}</span>
              </p>
            )}

            {canMerge ? (
              <>
                <Field label="Reason (required — recorded in the audit trail)" required>
                  {(id) => (
                    <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="E.g. duplicate intake from MDT import; same subject confirmed by DOB + phone." />
                  )}
                </Field>
                {refused && <p className="text-sm text-rose-200">{refused}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
                  <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void merge()}>
                    Merge {n} record{n === 1 ? '' : 's'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-xs text-slate-400">
                Merging is restricted to command. Flag these records to your lead if they are the same {kind === 'gang' ? 'organisation' : kind}.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
