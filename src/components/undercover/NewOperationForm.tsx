'use client'

/** Log an undercover operation.
 *
 *  §2's first activation requirement is that the Detective is "actively
 *  working an authorized CID case or investigation", so the case is REQUIRED
 *  here and NOT NULL in the schema. The picker offers only cases the member
 *  can already read — a UC record cannot become a way to name a case you have
 *  no access to.
 *
 *  §3's recording requirement is stated BEFORE the operation is created, not
 *  after it concludes: a reminder that arrives at the end is a reminder that
 *  arrives too late to act on. Confirming the recording is a separate step on
 *  the operation itself, because at this point there is nothing to confirm. */
import { useCallback, useEffect, useState } from 'react'
import { insert, list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { toast } from '@/lib/toast'
import { UC_ALIAS_AUDIENCE_NOTE } from '@/lib/undercover'
import type { Tables } from '@/lib/database.types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'

type CaseLite = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title' | 'status' | 'bureau'>

export function NewOperationForm({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { profile } = useAuth()
  const [cases, setCases] = useState<CaseLite[]>([])
  const [caseId, setCaseId] = useState('')
  const [alias, setAlias] = useState('')
  const [objective, setObjective] = useState('')
  const [startedAt, setStartedAt] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void list('cases', {
      select: 'id,case_number,title,status,bureau',
      order: 'created_at', ascending: false, limit: 200,
    }).then((rows) => {
      if (!live) return
      // Open work only: §2 ties the undercover capacity to an investigation
      // that is actually running.
      setCases((rows as CaseLite[]).filter((c) => c.status === 'open' || c.status === 'active'))
    }).catch(() => { if (live) setCases([]) })
    return () => { live = false }
  }, [])

  const save = useCallback(async () => {
    // A bureau is required: the insert policy checks it against the profile,
    // and a Bureau Lead's read scope is keyed to it. Without one, the row
    // would have no authorized oversight audience at all.
    if (!caseId || busy || !profile?.division) return
    setBusy(true)
    const picked = cases.find((c) => c.id === caseId)
    const res = await insert('uc_operations', {
      case_id: caseId,
      detective_id: profile.id,
      // The detective's own bureau — the insert policy requires it to match,
      // and a Bureau Lead's read scope is keyed to it.
      bureau: profile.division,
      alias: alias.trim() || null,
      objective: objective.trim() || null,
      started_at: startedAt ? new Date(startedAt).toISOString() : null,
      status: startedAt ? 'active' : 'planned',
    })
    setBusy(false)
    if (res.error || !res.data?.[0]) {
      toast(res.error?.message ?? 'Could not log the operation.', 'danger')
      return
    }
    toast(`Operation logged against ${picked?.case_number ?? 'the case'}.`, 'success')
    onCreated(res.data[0].id)
  }, [caseId, busy, profile, cases, alias, objective, startedAt, onCreated])

  return (
    <Card pad="lg" className="space-y-4">
      <div>
        <h2 className="text-[13px] font-semibold text-white">Log an undercover operation</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          §2 — an undercover capacity exists only in service of an authorized CID case or investigation.
        </p>
      </div>

      {/* §3, stated before the work starts rather than after it ends. */}
      <div role="note" className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
        <p className="text-sm font-semibold text-amber-100">Recording Required</p>
        <p className="mt-1 text-xs text-amber-200/90">
          Undercover Detectives are required to record the entire undercover session. Recording shall begin
          prior to, or at the earliest reasonable opportunity before, active undercover activity begins.
          Check your equipment before you start.
        </p>
      </div>

      {!profile?.division && (
        <Notice text="Your profile has no bureau recorded, so an operation cannot be logged against it — §4 keys oversight to your Bureau Lead. Ask Command to set your bureau first." />
      )}

      <Field label="Case" required hint="Only cases you can already access are listed.">
        {(id) => (
          <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">Select a case…</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.case_number} — {c.title || 'Untitled'}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Undercover identity / alias" hint={UC_ALIAS_AUDIENCE_NOTE}>
        {(id) => (
          <Input
            id={id}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            maxLength={120}
            placeholder="Optional — §4 applies whether or not one is recorded"
          />
        )}
      </Field>

      <Field label="Objective" hint="§6 — what the operation is intended to establish.">
        {(id) => <Textarea id={id} rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} />}
      </Field>

      <Field label="Operation start" hint="Leave blank to record it as planned and start it later.">
        {(id) => (
          <Input id={id} type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        )}
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        <Button className="min-h-[44px] sm:min-h-0" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          className="min-h-[44px] sm:min-h-0"
          disabled={!caseId || busy || !profile?.division}
          loading={busy}
          onClick={() => void save()}
        >
          Log operation
        </Button>
      </div>
    </Card>
  )
}
