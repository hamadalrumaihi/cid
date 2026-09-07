'use client'

import { useMemo } from 'react'
import type { FormValues } from '@/lib/forms'
import { advisoryGaps, requiredGaps, type TemplateVersion } from '@/lib/reportTemplates'

/** Required-field checklist read from the PINNED version — the client mirror
 *  of report_submit's hard block ("required fields missing: …"). Rendered in
 *  the editor (live, while typing) and in the pre-submit modal (where the
 *  confirm button stays disabled while a required key is empty). Advisory
 *  keys warn only. Nothing here decides: the RPC re-checks. */
export function RequiredChecklist({ version, values, compact = false }: {
  version: Pick<TemplateVersion, 'schema' | 'required' | 'advisory'>
  values: FormValues
  compact?: boolean
}) {
  const req = useMemo(() => requiredGaps(version, values), [version, values])
  const adv = useMemo(() => advisoryGaps(version, values), [version, values])
  if (!version.required.length && !version.advisory.length) return null
  const done = version.required.length - req.length
  return (
    <div className={`rounded-lg border p-3 text-sm ${req.length ? 'border-rose-500/30 bg-rose-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`} role="status" aria-live="polite">
      <p className={`text-xs font-semibold uppercase tracking-wider ${req.length ? 'text-rose-300' : 'text-emerald-300'}`}>
        {version.required.length
          ? req.length ? `Required fields missing (${done} of ${version.required.length} filled)` : 'All required fields are filled'
          : 'No required fields'}
      </p>
      {req.length > 0 && (
        <ul className={`mt-1.5 ${compact ? 'flex flex-wrap gap-x-3 gap-y-1' : 'space-y-0.5'} text-slate-200`}>
          {req.map((g) => <li key={g.key} className="flex items-center gap-1.5"><span aria-hidden className="text-rose-300">•</span>{g.label}</li>)}
        </ul>
      )}
      {adv.length > 0 && (
        <p className="mt-2 text-xs text-amber-200/90">
          <span className="font-semibold">Advisory (still empty):</span> {adv.map((g) => g.label).join(', ')}. You can continue anyway.
        </p>
      )}
    </div>
  )
}
