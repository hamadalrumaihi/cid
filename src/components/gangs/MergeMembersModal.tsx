'use client'

/** Duplicate-member merge — the review UI over gangIntel.planMerge. The user
 *  picks the survivor row, then resolves each conflicting field (prefilled
 *  keep-survivor, except where the survivor is empty and a duplicate has a
 *  value). On confirm the survivor is patched and the duplicates are deleted
 *  via deleteWithUndo, so the row deletions stay undo-backed. Nothing in the
 *  schema references gang_members.id (verified against database.types.ts), so
 *  no child repointing is needed — person/media links key off person_id and
 *  gang_id, which live on the surviving row.
 *
 *  All planning logic is in the pure helper planMerge (unit-tested); this
 *  modal only collects choices and executes the plan. */
import { useMemo, useState } from 'react'
import { deleteWithUndo, update } from '@/lib/db'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { uiConfirm } from '@/components/ui/dialog'
import { MERGE_FIELDS, planMerge, type DuplicateCluster, type MergeField, type MergeValue } from './gangIntel'

const FIELD_LABELS: Record<MergeField, string> = {
  rank: 'Rank', callsign: 'Callsign', status: 'Status', person_id: 'Linked person',
  ccw: 'CCW', vch: 'VCH', felony_count: 'Felonies', mugshot_url: 'Mugshot URL', provenance: 'Provenance',
}

const fmtValue = (f: MergeField, v: MergeValue): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (f === 'person_id') return `POI ${String(v).slice(0, 8)}…`
  return String(v)
}

export function MergeMembersModal({ cluster, onClose, onMerged }: {
  cluster: DuplicateCluster
  onClose: () => void
  /** Refresh hook — also re-fires after an undo re-insert. */
  onMerged: () => void
}) {
  const [survivorId, setSurvivorId] = useState(cluster.members[0]?.id ?? '')
  const [choices, setChoices] = useState<Partial<Record<MergeField, MergeValue>>>({})
  const [busy, setBusy] = useState(false)

  const survivor = cluster.members.find((m) => m.id === survivorId) ?? cluster.members[0]
  const others = cluster.members.filter((m) => m.id !== survivor.id)

  // Prefill = planMerge with no choices: keep survivor, adopt where empty.
  const defaults = useMemo(() => planMerge(survivor, others), [survivor, others])

  // Only fields where the cluster actually disagrees need a decision.
  const conflictFields = MERGE_FIELDS.filter((f) =>
    others.some((d) => !Object.is(d[f] ?? null, survivor[f] ?? null)))

  const selectedValue = (f: MergeField): MergeValue =>
    Object.prototype.hasOwnProperty.call(choices, f)
      ? choices[f] ?? null
      : (Object.prototype.hasOwnProperty.call(defaults.patch, f) ? defaults.patch[f] ?? null : survivor[f])

  const pickSurvivor = (id: string) => { setSurvivorId(id); setChoices({}) } // choices are per-survivor

  const doMerge = async () => {
    const plan = planMerge(survivor, others, choices)
    const fields = Object.keys(plan.patch).length
    const n = plan.deletions.length
    const ok = await uiConfirm(
      `Merge ${cluster.members.length} rows into "${survivor.name}" — ${n} row${n === 1 ? '' : 's'} deleted (undo available)` +
      `${fields ? `, ${fields} field${fields === 1 ? '' : 's'} updated on the survivor` : ''}. ` +
      'Undo restores the deleted rows only; field updates on the survivor remain.',
      { title: 'Merge duplicate members', confirmText: 'Merge' },
    )
    if (!ok) return
    setBusy(true)
    try {
      if (fields) {
        const res = await update('gang_members', survivor.id, plan.patch)
        if (res.error) { toast(`Merge failed: ${res.error.message}`, 'danger'); return }
      }
      await deleteWithUndo('gang_members', plan.deletions, {
        label: n === 1 ? `Duplicate of "${survivor.name}"` : `${n} duplicates of "${survivor.name}"`,
        noConfirm: true, // the merge confirm above already spelled it out
        after: onMerged,
      })
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Modal open wide onClose={onClose}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title="Merge duplicate members" onClose={onClose} />
        <p className="mb-3 text-xs text-slate-400">
          {cluster.reason} — {cluster.members.length} rows. Pick the row to keep, then resolve each differing field.
          Duplicate rows are deleted with undo; the survivor keeps its id, so nothing else needs relinking.
        </p>

        <fieldset className="mb-4">
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Keep (survivor)</legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {cluster.members.map((m) => (
              <label key={m.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${m.id === survivor.id ? 'border-badge-500 bg-badge-500/10 text-white' : 'border-white/10 bg-ink-900 text-slate-300 hover:bg-white/5'}`}>
                <input type="radio" name="merge-survivor" checked={m.id === survivor.id} onChange={() => pickSurvivor(m.id)} className="h-3.5 w-3.5 accent-badge-500" />
                <span className="min-w-0 flex-1 truncate">
                  {m.name}{m.callsign ? ` · “${m.callsign}”` : ''} · {m.rank || '—'}
                  <span className="block text-[11px] text-slate-500">{m.person_id ? 'POI linked' : 'No POI'} · updated {m.updated_at?.slice(0, 10) || '—'}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {conflictFields.length ? (
          <div className="mb-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Field decisions</p>
            <div className="space-y-2">
              {conflictFields.map((f) => {
                // Distinct candidate values, survivor's first.
                const seen: MergeValue[] = []
                const options: Array<{ v: MergeValue; from: string }> = []
                for (const m of [survivor, ...others]) {
                  const v = m[f] ?? null
                  if (seen.some((s) => Object.is(s, v))) continue
                  seen.push(v)
                  options.push({ v, from: m.id === survivor.id ? 'survivor' : 'duplicate' })
                }
                const sel = selectedValue(f)
                return (
                  <fieldset key={f} className="rounded-lg border border-white/5 bg-ink-900/60 px-2.5 py-2">
                    <legend className="px-1 text-[11px] font-semibold text-slate-400">{FIELD_LABELS[f]}</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {options.map((o, i) => (
                        <label key={i} className="flex cursor-pointer items-center gap-1.5 py-1 text-xs text-slate-200">
                          <input
                            type="radio"
                            name={`merge-${f}`}
                            checked={Object.is(sel ?? null, o.v)}
                            onChange={() => setChoices((c) => ({ ...c, [f]: o.v }))}
                            className="h-3.5 w-3.5 accent-badge-500"
                          />
                          <span className="max-w-[16rem] truncate">{fmtValue(f, o.v)}</span>
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">{o.from}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="mb-4 text-xs text-slate-400">All fields agree across these rows — merging simply removes the duplicate row{others.length === 1 ? '' : 's'}.</p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10">Cancel</button>
          <button onClick={() => void doMerge()} disabled={busy || others.length === 0} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50">
            {busy ? 'Merging…' : `Merge into "${survivor.name}"`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
