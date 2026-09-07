'use client'

/** Per-target scope decisions (P4-07, decision L6). On approval the judge
 *  decides every target of the request — the subject person and each
 *  person_record / vehicle / place / evidence / case_media exhibit — with
 *  reasoning; any denial makes the decision `partially_approved` and the
 *  narrowed scope is frozen into the judicial version. Once decided, the
 *  same rows render read-only for everyone from
 *  `legal_request_target_decisions`. */
import type { Tables } from '@/lib/database.types'
import { fmtDateTime } from '@/lib/format'
import type { TargetDecisionRow } from '@/lib/legalExport'
import { formatTarget, humanize } from '@/lib/legalWorkflow'
import { Card } from '@/components/ui/Card'
import { Textarea } from '@/components/ui/Field'
import { TARGET_EXHIBIT_TYPES } from './legalP4Shim'

type LegalRequest = Tables<'legal_requests'>
type LegalExhibit = Tables<'legal_request_exhibits'>

export interface TargetRow { key: string; exhibitId: string | null; label: string }
export interface TargetChoice { decision: 'approved' | 'denied'; reasoning: string }
export type TargetChoices = Record<string, TargetChoice>

/** One row per target: `subject` for the request's person, `exhibit:<id>`
 *  for every scope-bearing exhibit. */
export function targetRowsFor(r: Pick<LegalRequest, 'person_id' | 'person_name_snapshot' | 'recipient_name' | 'recipient_type'>, exhibits: readonly LegalExhibit[]): TargetRow[] {
  const rows: TargetRow[] = []
  if (r.person_id) rows.push({ key: 'subject', exhibitId: null, label: `Subject — ${formatTarget(r)}` })
  for (const e of exhibits) {
    if (!TARGET_EXHIBIT_TYPES.has(e.exhibit_type)) continue
    rows.push({ key: `exhibit:${e.id}`, exhibitId: e.id, label: `${humanize(e.exhibit_type)} — ${e.display_title}` })
  }
  return rows
}

/** The RPC payload for `p_target_decisions` (null when there is nothing to
 *  decide — a plain approval). */
export function targetDecisionsPayload(rows: TargetRow[], choices: TargetChoices): { target_key: string; exhibit_id: string | null; decision: 'approved' | 'denied'; reasoning: string | null }[] | null {
  if (rows.length === 0) return null
  return rows.map((t) => {
    const c = choices[t.key] ?? { decision: 'approved', reasoning: '' }
    return { target_key: t.key, exhibit_id: t.exhibitId, decision: c.decision, reasoning: c.reasoning.trim() || null }
  })
}

export const anyDenied = (rows: TargetRow[], choices: TargetChoices): boolean =>
  rows.some((t) => choices[t.key]?.decision === 'denied')
export const allDenied = (rows: TargetRow[], choices: TargetChoices): boolean =>
  rows.length > 0 && rows.every((t) => choices[t.key]?.decision === 'denied')

/** Editor — lives inside the judge's approve modal. */
export function TargetDecisionEditor({ rows, choices, onChange }: {
  rows: TargetRow[]
  choices: TargetChoices
  onChange: (next: TargetChoices) => void
}) {
  if (rows.length === 0) return null
  const set = (key: string, patch: Partial<TargetChoice>) => {
    const cur: TargetChoice = choices[key] ?? { decision: 'approved', reasoning: '' }
    onChange({ ...choices, [key]: { ...cur, ...patch } })
  }
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-slate-400">
        Scope — decide each target<span className="ml-1 font-normal text-slate-500">(denying any target records a partial approval)</span>
      </legend>
      <ul className="space-y-2">
        {rows.map((t) => {
          const c = choices[t.key] ?? { decision: 'approved', reasoning: '' }
          const denied = c.decision === 'denied'
          const groupName = `target-${t.key.replace(/[^a-z0-9]/gi, '-')}`
          return (
            <li key={t.key} className={`rounded-lg border px-3 py-2 ${denied ? 'border-rose-500/30 bg-rose-500/5' : 'border-white/10 bg-ink-950/50'}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 text-sm text-slate-200">{t.label}</span>
                <div role="radiogroup" aria-label={`Decision for ${t.label}`} className="flex gap-3 text-sm">
                  {(['approved', 'denied'] as const).map((d) => (
                    <label key={d} className="flex min-h-[40px] cursor-pointer items-center gap-1.5">
                      <input type="radio" name={groupName} value={d} checked={c.decision === d} onChange={() => set(t.key, { decision: d })} className="accent-badge-500" />
                      <span className={d === 'denied' ? 'text-rose-200' : 'text-emerald-200'}>{d === 'approved' ? 'Approve' : 'Deny'}</span>
                    </label>
                  ))}
                </div>
              </div>
              <Textarea
                rows={1}
                aria-label={`Reasoning for ${t.label}`}
                placeholder={denied ? 'Why this target is excluded (recommended)' : 'Reasoning (optional)'}
                value={c.reasoning}
                onChange={(e) => set(t.key, { reasoning: e.target.value })}
                className="mt-1.5"
              />
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

/** Frozen decisions, read-only for every viewer once recorded. */
export function TargetDecisionsReadOnly({ decisions, r, exhibits, name }: {
  decisions: TargetDecisionRow[]
  r: LegalRequest
  exhibits: readonly LegalExhibit[]
  name: (id: string | null | undefined) => string
}) {
  if (decisions.length === 0) return null
  const label = (d: TargetDecisionRow): string => {
    if (d.target_key === 'subject') return `Subject — ${formatTarget(r)}`
    const ex = exhibits.find((e) => e.id === d.exhibit_id || `exhibit:${e.id}` === d.target_key)
    return ex ? `${humanize(ex.exhibit_type)} — ${ex.display_title}` : d.target_key
  }
  const denied = decisions.filter((d) => d.decision === 'denied').length
  return (
    <Card pad="sm">
      <h3 className="mb-1 text-[13px] font-semibold text-white">
        Scope decided by the judge
        {denied > 0 && <span className="ml-2 rounded-full bg-rose-500/15 px-1.5 text-[10px] font-semibold text-rose-200">{denied} denied</span>}
      </h3>
      <ul className="divide-y divide-white/5">
        {decisions.map((d) => (
          <li key={d.id} className="flex flex-wrap items-start gap-2 py-1.5 text-sm">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${d.decision === 'denied' ? 'bg-rose-500/15 text-rose-200' : 'bg-emerald-500/15 text-emerald-200'}`}>
              {d.decision}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-slate-200">{label(d)}</span>
              {d.reasoning && <span className="block text-xs text-slate-400">{d.reasoning}</span>}
              <span className="block text-[11px] text-slate-500">{name(d.decided_by)} · {fmtDateTime(d.decided_at)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
