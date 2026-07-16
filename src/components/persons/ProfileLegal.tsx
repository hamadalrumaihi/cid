'use client'

/** Person dossier — Legal section + the Manage BOLO modal (shared with the
 *  BOLO board). Legal instruments come EXCLUSIVELY from the structured
 *  `legal_requests.person_id` join (no report text-scan, no name matching).
 *  RLS seals rows the viewer can't access: sealed rows simply don't appear
 *  and are never hinted at ("N sealed" is deliberately impossible here). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/format'
import { fulfilmentLabel, reviewStatusLabel } from '@/lib/justice'
import { officerName } from '@/lib/profiles'
import { priorityTint } from '@/lib/tint'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { EntityLink } from '@/components/ui/EntityLink'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { humanize } from '@/components/gangs/gangIntel'
import { PERSON_PRIORITIES, boloState, legalStatusOf, type PersonLegalSummary } from './personIntel'
import type { PersonRow } from './PersonModal'
import type { LegalLite } from './profileLoad'

/** Human label for a legal request's type ("Warrant — Search Warrant"). */
export const legalTypeLabel = (r: Pick<LegalLite, 'request_type' | 'subtype'>): string =>
  `${humanize(r.request_type)}${r.subtype && r.subtype !== r.request_type ? ` — ${humanize(r.subtype)}` : ''}`

/** legalStatusOf buckets the exact row objects it was handed; re-assert the
 *  richer profileLoad projection (superset of personIntel's LegalLite) so the
 *  panel can render title/case-number-snapshot without a second fetch. */
type Buckets = Omit<PersonLegalSummary, 'arrestWarrants' | 'searchWarrants' | 'subpoenas' | 'surveillance' | 'other'> & {
  arrestWarrants: LegalLite[]; searchWarrants: LegalLite[]; subpoenas: LegalLite[]; surveillance: LegalLite[]; other: LegalLite[]
}
export const bucketizeLegal = (rows: LegalLite[], todayISO: string): Buckets =>
  legalStatusOf(rows, todayISO) as unknown as Buckets

/** Text + tint BOLO chip (never color-only). Renders nothing when no BOLO. */
export function BoloStateBadge({ person, today, className = '' }: { person: PersonRow; today: string; className?: string }) {
  const bs = boloState(person, today)
  if (!bs.active) return null
  const label = bs.expired ? 'BOLO expired' : `BOLO active${bs.risk ? ` · ${bs.risk} risk` : ''}`
  return (
    <Badge
      tint={bs.expired ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'}
      className={`uppercase ${className}`}
      title={bs.reason ? `${label}: ${bs.reason}` : label}
    >
      {label}
    </Badge>
  )
}

function LegalRow({ r, now }: { r: LegalLite; now: number }) {
  const router = useRouter()
  return (
    <Card pad="sm" className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <button onClick={() => router.push(`/legal?request=${encodeURIComponent(r.id)}`)} className="text-left text-sm font-semibold text-white hover:text-blue-200" title="Open in Legal Requests">
          <span className="font-mono text-blue-300">{r.request_number}</span>
          <span className="font-normal text-slate-400"> · {r.title || legalTypeLabel(r)}</span>
        </button>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
          <Badge tone="neutral">{legalTypeLabel(r)}</Badge>
          <Badge tone="accent">{reviewStatusLabel(r.review_status)}</Badge>
          <Badge tone="neutral">{fulfilmentLabel(r.fulfilment_status)}</Badge>
          <DeadlineChip at={r.response_deadline} kind="deadline" now={now} />
          <DeadlineChip at={r.expires_at} kind="expires" now={now} />
          <span>Filed {fmtDate(r.created_at)}</span>
          {r.case_id && <EntityLink kind="case" id={r.case_id} label={r.case_number_snapshot || 'Source case'} title="Open the source case" />}
        </p>
      </div>
    </Card>
  )
}

function LegalBucket({ label, rows, now }: { label: string; rows: LegalLite[]; now: number }) {
  if (!rows.length) return null
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label} <Badge>{rows.length}</Badge>
      </p>
      <div className="space-y-1.5">{rows.map((r) => <LegalRow key={r.id} r={r} now={now} />)}</div>
    </div>
  )
}

export function LegalSection({ legal, today, now }: { legal: LegalLite[]; today: string; now: number }) {
  const buckets = bucketizeLegal(legal, today)
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold text-white">Legal instruments</h3>
        <Badge>{legal.length}</Badge>
        {buckets.activeCount > 0 && <Badge tone="danger">{buckets.activeCount} active</Badge>}
      </div>
      {!legal.length ? (
        <EmptyState
          title="No legal requests on file"
          hint="Warrants and subpoenas naming this person (via the structured legal-request link) appear here."
        />
      ) : (
        <>
          <LegalBucket label="Arrest warrants" rows={buckets.arrestWarrants} now={now} />
          <LegalBucket label="Search warrants" rows={buckets.searchWarrants} now={now} />
          <LegalBucket label="Subpoenas" rows={buckets.subpoenas} now={now} />
          <LegalBucket label="Surveillance" rows={buckets.surveillance} now={now} />
          <LegalBucket label="Other" rows={buckets.other} now={now} />
        </>
      )}
      {/* NOTE: the old name-matching "warrants naming subject" report scan is
          intentionally gone — it required a full reports fetch and matched on
          exact free-text names. Structured person_id links are authoritative. */}
    </div>
  )
}

/** Manage BOLO — activate with reason/risk/instructions/expiry, or deactivate.
 *  Deactivation only clears the `bolo` flag; the descriptive fields stay on
 *  the row (history lives in the audit trail). */
export function ManageBoloModal({ person, onClose, onSaved }: { person: PersonRow; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [reason, setReason] = useState(person.bolo_reason || '')
  const [risk, setRisk] = useState(person.bolo_risk || 'medium')
  const [instructions, setInstructions] = useState(person.bolo_instructions || '')
  const [expires, setExpires] = useState(person.bolo_expires_at || '')
  const [busy, setBusy] = useState(false)

  const save = async (activate: boolean) => {
    if (activate && !reason.trim()) { toast('A reason is required to issue a BOLO.', 'warn'); return }
    setBusy(true)
    const res = await update('persons', person.id, {
      bolo: true,
      bolo_reason: reason.trim() || null,
      bolo_risk: risk || null,
      bolo_instructions: instructions.trim() || null,
      bolo_expires_at: expires || null,
      // Stamp the issuer only on activation; updates keep the original stamp.
      ...(activate && !person.bolo ? { bolo_issued_by: profile?.id ?? null, bolo_issued_at: new Date().toISOString() } : {}),
    })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(person.bolo ? 'BOLO updated' : 'BOLO issued', 'success')
    onSaved()
  }

  const deactivate = async () => {
    setBusy(true)
    // Clearing only flips the flag — reason/risk/instructions stay on the row.
    const res = await update('persons', person.id, { bolo: false })
    setBusy(false)
    if (res.error) { toast(`Update failed: ${res.error.message}`, 'danger'); return }
    toast('BOLO cleared', 'info')
    onSaved()
  }

  const dirty = () =>
    reason !== (person.bolo_reason || '') || risk !== (person.bolo_risk || 'medium')
    || instructions !== (person.bolo_instructions || '') || expires !== (person.bolo_expires_at || '')

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${person.bolo ? 'Manage' : 'Issue'} BOLO — ${person.name}`} onClose={onClose} />
        {person.bolo && (
          <p className="mb-3 text-xs text-slate-400">
            Issued {fmtDate(person.bolo_issued_at)}{officerName(person.bolo_issued_by) ? ` by ${officerName(person.bolo_issued_by)}` : ''}.
          </p>
        )}
        <div className="space-y-3">
          <Field label="Reason" required={!person.bolo}>
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why officers should be on the lookout." />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Risk">
              {(id) => (
                <Select id={id} value={risk} onChange={(e) => setRisk(e.target.value)}>
                  {PERSON_PRIORITIES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Expires (optional)">
              {(id) => <Input id={id} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />}
            </Field>
          </div>
          <Field label="Approach instructions" hint="E.g. do not approach alone; considered armed.">
            {(id) => <Textarea id={id} rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />}
          </Field>
          <div className="flex items-center gap-2 pt-1">
            <Badge tint={priorityTint(risk)} className="uppercase" title="How the risk chip will read on the board">{humanize(risk)} risk</Badge>
            {person.bolo && <span className="text-[11px] text-slate-500">Deactivating keeps the descriptive fields for the record.</span>}
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" className="flex-1" loading={busy} onClick={() => void save(true)}>
            {person.bolo ? 'Save changes' : 'Issue BOLO'}
          </Button>
          {person.bolo && (
            <Button variant="secondary" loading={busy} onClick={() => void deactivate()} className="text-rose-300">
              Deactivate
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
