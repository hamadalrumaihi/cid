'use client'

/** SuggestedUpdates — a record's update inbox (P2-05). Three parts:
 *   1. pending suggestions (proposed vs current, reason, proposer) with
 *      Accept / Decline for SrDet+ and Withdraw for the proposer;
 *   2. an inline "Suggest an update" form — field, value, reason — that
 *      sends `expectedCurrent` = the value on screen, so a record that
 *      changed underneath answers `stale` with what it reads now and the
 *      user retries against that;
 *   3. the case observations for the record, with Promote (ObservationList).
 *  Cosmetic gates only; every RPC answer is handled. `SuggestedUpdates`
 *  reads usePermissions/useAuth; the panel takes `canDecide` + `viewerId`. */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import {
  EDITABLE_FIELDS, MERGE_TABLE, decideSuggestion, listObservations, listSuggestions, refusalText,
  suggestUpdate, withdrawSuggestion, type MergeKind,
} from '@/lib/entity'
import { fmtDateTime } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { uiPrompt } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { SectionHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { ObservationList, type ObservationRow } from './ObservationList'
import { cellText, fieldLabel } from './labels'

type SuggestionRow = Tables<'entity_update_suggestions'>

const DECIDER_ROLES: ReadonlySet<string> = new Set(['senior_detective', 'bureau_lead', 'deputy_director', 'director'])

export interface SuggestedUpdatesProps { kind: MergeKind; recordId: string; className?: string }

export function SuggestedUpdates(props: SuggestedUpdatesProps) {
  const { perms } = usePermissions()
  const { profile } = useAuth()
  const canDecide = perms.is_owner || (perms.role != null && DECIDER_ROLES.has(perms.role))
  return <SuggestedUpdatesPanel {...props} canDecide={canDecide} viewerId={profile?.id ?? null} />
}

export function SuggestedUpdatesPanel({ kind, recordId, canDecide, viewerId, className = '' }: SuggestedUpdatesProps & { canDecide: boolean; viewerId: string | null }) {
  const [pending, setPending] = useState<SuggestionRow[] | null>(null)
  const [observations, setObservations] = useState<ObservationRow[]>([])
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [s, o, r] = await Promise.all([
      listSuggestions(kind, recordId, true).catch(() => [] as SuggestionRow[]),
      listObservations(kind, recordId).catch(() => [] as ObservationRow[]),
      list(MERGE_TABLE[kind], { eq: { id: recordId }, limit: 1 }).catch(() => []),
    ])
    setPending(s); setObservations(o)
    setRecord((r[0] as Record<string, unknown> | undefined) ?? null)
  }, [kind, recordId])

  useEffect(() => {
    let live = true
    void (async () => { await Promise.resolve(); if (live) await load() })()
    return () => { live = false }
  }, [load])

  const decide = async (row: SuggestionRow, accept: boolean) => {
    const note = await uiPrompt(
      accept ? 'The record takes the proposed value. An optional note goes back to the proposer.' : 'The record keeps its value. Tell the proposer why (optional).',
      { title: accept ? 'Accept this update' : 'Decline this update', placeholder: 'Optional note', confirmText: accept ? 'Accept' : 'Decline' },
    )
    if (note === null) return
    setBusyId(row.id)
    const res = await decideSuggestion(row.id, accept, note.trim() || null)
    setBusyId(null)
    if (res.error || !res.data) { toast(res.error?.message ?? 'The decision was not recorded.', 'danger'); return }
    if (!res.data.ok) { toast(refusalText(res.data), 'danger'); return }
    toast(accept ? (res.data.changed ? 'Accepted — the record is updated.' : 'Accepted; the record already had that value.') : 'Declined.', 'success')
    await load()
  }

  const withdraw = async (row: SuggestionRow) => {
    setBusyId(row.id)
    const res = await withdrawSuggestion(row.id)
    setBusyId(null)
    if (res.error || !res.data) { toast(res.error?.message ?? 'Withdraw failed.', 'danger'); return }
    if (!res.data.ok) { toast(refusalText(res.data), 'danger'); return }
    toast('Suggestion withdrawn.', 'success')
    await load()
  }

  return (
    <div className={`space-y-5 ${className}`}>
      <section>
        <SectionHeader title="Suggested updates" actions={pending?.length ? <Badge tone="warn">{pending.length}</Badge> : undefined} />
        {pending === null ? (
          <ListSkeleton count={2} />
        ) : !pending.length ? (
          <p className="mt-2 text-sm text-slate-400">Nothing waiting for review.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pending.map((s) => (
              <li key={s.id} className="rounded-lg border border-white/10 bg-ink-900 p-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                  <span className="font-semibold text-white">{fieldLabel(s.field)}</span>
                  <span className="text-slate-400">{s.current_value?.trim() ? s.current_value : '—'}</span>
                  <span aria-hidden className="text-slate-500">→</span>
                  <span className="sr-only">changes to</span>
                  <span className="font-medium text-emerald-300">{s.proposed_value?.trim() ? s.proposed_value : '—'}</span>
                </div>
                <p className="mt-1 text-xs text-slate-300">{s.reason}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {officerName(s.proposed_by) ?? 'Somebody'} · {fmtDateTime(s.created_at)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {canDecide && (
                    <>
                      <Button size="sm" variant="success" loading={busyId === s.id} onClick={() => void decide(s, true)}>Accept</Button>
                      <Button size="sm" variant="secondary" disabled={busyId === s.id} onClick={() => void decide(s, false)}>Decline</Button>
                    </>
                  )}
                  {viewerId && s.proposed_by === viewerId && (
                    <Button size="sm" variant="ghost" disabled={busyId === s.id} onClick={() => void withdraw(s)}>Withdraw</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SuggestForm kind={kind} recordId={recordId} record={record} onDone={load} />

      <section>
        <SectionHeader title="Case observations" subtitle="Values seen in a case that are not (yet) on the record." />
        <div className="mt-2">
          <ObservationList rows={observations} onChanged={() => { void load() }} />
        </div>
      </section>
    </div>
  )
}

/** The proposal form. `expectedCurrent` is whatever the form shows as the
 *  current value — the server compares and answers `stale` with the truth
 *  when the record moved; the form then shows that and lets the user retry. */
function SuggestForm({ kind, recordId, record, onDone }: {
  kind: MergeKind
  recordId: string
  record: Record<string, unknown> | null
  onDone: () => Promise<void>
}) {
  const fields = EDITABLE_FIELDS[kind]
  const [field, setField] = useState<string>(fields[0] ?? '')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [stale, setStale] = useState<string | null>(null)

  // The value on screen: the stale answer wins over the loaded row until the
  // user submits again (the retry then carries the server's own value).
  const shown = stale ?? cellText(record?.[field])
  const long = field === 'notes' || field === 'summary'

  const submit = async () => {
    if (!field || !reason.trim()) { toast('A reason is required.', 'warn'); return }
    setBusy(true)
    const res = await suggestUpdate(kind, recordId, field, value.trim() || null, reason.trim(), { expectedCurrent: shown })
    setBusy(false)
    if (res.error || !res.data) { toast(res.error?.message ?? 'The suggestion was not sent.', 'danger'); return }
    if (!res.data.ok) {
      if (res.data.code === 'stale') {
        setStale(res.data.current ?? '')
        toast('The record changed since you looked — check the current value and submit again.', 'warn')
        return
      }
      toast(refusalText(res.data), 'danger')
      return
    }
    toast(res.data.applied ? 'Updated.' : 'Suggestion queued for a senior detective.', 'success')
    setValue(''); setReason(''); setStale(null)
    await onDone()
  }

  return (
    <form className="rounded-lg border border-white/10 bg-ink-950/40 p-3" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <p className="text-sm font-semibold text-white">Suggest an update</p>
      <p className="mt-0.5 text-xs text-slate-400">A senior detective&rsquo;s change applies now; anyone else&rsquo;s waits for review.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Field" required>
          {(id) => (
            <Select id={id} value={field} onChange={(e) => { setField(e.target.value); setStale(null) }}>
              {fields.map((f) => <option key={f} value={f}>{fieldLabel(f)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Current value" hint={stale !== null ? 'Refreshed from the server after your last attempt.' : undefined}>
          {(id) => <Input id={id} value={shown} readOnly aria-readonly="true" className={stale !== null ? 'border-amber-500/40' : ''} />}
        </Field>
        <div className={long ? 'sm:col-span-2' : ''}>
          <Field label="Proposed value" hint="Leave empty to clear the field.">
            {(id) => long
              ? <Textarea id={id} rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
              : <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
        </div>
        <div className={long ? 'sm:col-span-2' : ''}>
          <Field label="Reason" required>
            {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What you saw and where." />}
          </Field>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="submit" variant="primary" loading={busy} disabled={!reason.trim()}>
          {stale !== null ? 'Submit against the current value' : 'Suggest update'}
        </Button>
      </div>
    </form>
  )
}
