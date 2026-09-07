'use client'

/** Charges on a legal request (P4-03) — the structured
 *  `legal_request_charges` rows with their statute SNAPSHOTS (code, offense,
 *  class, penal title frozen when the charge was attached). Read-only here:
 *  the creator edits the set in the wizard's Charges step while the draft is
 *  editable (`legal_set_charges`); after submission the rows are the record. */
import type { LegalChargeRow } from '@/lib/legalExport'
import { Card } from '@/components/ui/Card'

export function ChargesBlock({ charges, editable = false, onEdit, className = '' }: {
  charges: LegalChargeRow[]
  /** The creator on an editable draft — shows the "edit in wizard" affordance. */
  editable?: boolean
  onEdit?: () => void
  className?: string
}) {
  const counts = charges.reduce((n, c) => n + c.counts, 0)
  return (
    <Card pad="sm" className={className}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-white">
          Charges
          {charges.length > 0 && (
            <span className="ml-2 rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-slate-300">
              {charges.length} · {counts} count{counts === 1 ? '' : 's'}
            </span>
          )}
        </h3>
        {editable && onEdit && (
          <button type="button" onClick={onEdit} className="min-h-[40px] px-1 text-xs font-semibold text-badge-200 hover:text-white">
            Edit charges in the guided editor
          </button>
        )}
      </div>
      {charges.length === 0 ? (
        <p className="text-sm text-slate-400">No charges are attached to this request.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {charges.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-sm">
              <span className="font-mono text-badge-200">{c.snap_code ?? '—'}</span>
              <span className="font-semibold text-white">{c.snap_offense}</span>
              <span className="text-xs text-slate-400">{c.snap_charge_class}{c.snap_penal_title ? ` · ${c.snap_penal_title}` : ''}</span>
              <span className="ml-auto font-mono text-xs text-slate-200">×{c.counts}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
