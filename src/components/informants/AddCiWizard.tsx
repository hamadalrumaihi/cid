'use client'

/** Add CI — the designation wizard → `ci_create`.
 *
 *  Steps: 1 person · 2 motive · 3 handler · 4 capacity · 5 bureau · 6 notes
 *  · 7 initial status · review. A handler designates to themself (the RPC's
 *  self-recruitment arm, no secondary); full access picks any active member.
 *  The capacity step previews `n / c` live; the SERVER answer is what counts:
 *  a `code:'capacity'` refusal ends the wizard in "Request assignment" for a
 *  handler, and for full access shows the Capacity warning with "Assign with
 *  authorization" (a reason → CI_CAPACITY_OVERRIDE + a raised limit). A
 *  person who already is a live source comes back as `unavailable` with the
 *  same wording for everyone — the wizard never learns more than that. */
import { useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import type { Database } from '@/lib/database.types'
import type { EntityHit } from '@/lib/entitySearch'
import { todayISO } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { BUREAUS } from '@/lib/roles'
import { toast } from '@/lib/toast'
import {
  CI_DEFAULT_CAPACITY, CI_MOTIVES, CI_MOTIVE_LABEL, CI_RELIABILITY, CI_RELIABILITY_LABEL, CI_RISK, CI_RISK_LABEL,
  CI_STATUSES, CI_STATUS_LABEL, capacityLabel, ciCreate, isAtCapacity, motiveSummary, refreshCiContext,
  type CiContext, type CiStatsHandler, type CiStatus,
} from '@/lib/ci'
import { useCreate } from '@/components/shell/CreateHost'
import { EntityPicker } from '@/components/entity/EntityPicker'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CapacityWarning, MemberSelect } from './ciShared'

type Bureau = Database['public']['Enums']['bureau']
type Step = 'person' | 'motive' | 'handler' | 'capacity' | 'bureau' | 'notes' | 'status' | 'review' | 'override' | 'request'
const STEPS: readonly Step[] = ['person', 'motive', 'handler', 'capacity', 'bureau', 'notes', 'status', 'review']
const STEP_LABEL: Record<Step, string> = {
  person: 'Person', motive: 'Motive', handler: 'Handler', capacity: 'Capacity', bureau: 'Bureau', notes: 'Recruitment',
  status: 'Initial status', review: 'Review', override: 'Capacity warning', request: 'Request assignment',
}

const INITIAL_STATUSES: readonly CiStatus[] = CI_STATUSES.filter((s) => s === 'candidate' || s === 'active')

export function AddCiWizard({ open, onClose, ctx, handlers, onCreated, onRequestAssignment }: {
  open: boolean
  onClose: () => void
  ctx: CiContext
  /** `ci_stats().handlers` (full access) — the live capacity preview. */
  handlers?: CiStatsHandler[] | null
  onCreated: (id: string, ciNumber: string) => void
  /** A handler at capacity ends here: open the assignment request instead. */
  onRequestAssignment: () => void
}) {
  const { profile } = useAuth()
  const create = useCreate()
  const full = ctx.full_access
  const [step, setStep] = useState<Step>('person')
  const [person, setPerson] = useState<EntityHit | null>(null)
  const [alias, setAlias] = useState('')
  const [motive, setMotive] = useState('')
  const [secondary, setSecondary] = useState<string[]>([])
  const [explanation, setExplanation] = useState('')
  const [pickedPrimary, setPrimary] = useState('')
  const [secondaryHandler, setSecondaryHandler] = useState('')
  const [bureau, setBureau] = useState<string>(profile?.division ?? 'major_crimes')
  const [notes, setNotes] = useState('')
  const [recruitedAt, setRecruitedAt] = useState(todayISO)
  const [reliability, setReliability] = useState('unknown')
  const [risk, setRisk] = useState('medium')
  const [status, setStatus] = useState<CiStatus>('candidate')
  const [overrideReason, setOverrideReason] = useState('')
  const [serverCapacity, setServerCapacity] = useState<{ active: number; capacity: number } | null>(null)
  const [err, setErr] = useState<string | undefined>()

  // A handler always designates to themself; full access picks a member.
  const primary = full ? pickedPrimary : (profile?.id ?? '')

  const idx = STEPS.indexOf(step)
  const handlerStat = useMemo(() => handlers?.find((h) => h.user_id === primary) ?? null, [handlers, primary])
  const preview = full
    ? { active: handlerStat?.active_count ?? 0, capacity: handlerStat?.capacity ?? CI_DEFAULT_CAPACITY }
    : { active: ctx.active_count ?? 0, capacity: ctx.capacity ?? CI_DEFAULT_CAPACITY }
  const willCount = status === 'active'
  const atCap = isAtCapacity(preview.active, preview.capacity)
  const handlerName = full ? (handlerStat?.name ?? officerName(primary) ?? 'This member') : 'You'

  const next = () => {
    setErr(undefined)
    if (step === 'person' && !person) { setErr('Choose the person to designate.'); return }
    if (step === 'handler' && !primary) { setErr('Choose a primary handler.'); return }
    if (step === 'handler' && secondaryHandler && secondaryHandler === primary) { setErr('The secondary handler must be a different member.'); return }
    if (step === 'bureau' && !bureau) { setErr('Choose a bureau.'); return }
    setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)])
  }
  const back = () => { setErr(undefined); setStep(step === 'override' || step === 'request' ? 'review' : STEPS[Math.max(0, idx - 1)]) }

  const submit = async (withOverride = false) => {
    if (!person || !primary) return
    if (withOverride && overrideReason.trim().length < 3) { setErr('Give the authorization reason.'); return }
    setErr(undefined)
    const r = await ciCreate({
      person: person.id, alias: alias.trim() || null, bureau: bureau as Bureau, primaryHandler: primary,
      secondaryHandler: full && secondaryHandler ? secondaryHandler : null, status, motivePrimary: motive || null,
      motiveSecondary: secondary, motiveExplanation: explanation.trim() || null, recruitmentNotes: notes.trim() || null,
      reliability, risk, recruitedAt: recruitedAt || null, overrideReason: withOverride ? overrideReason.trim() : null,
    })
    if (!r.ok) {
      if (r.code === 'capacity') {
        const m = /\((\d+)\s*\/\s*(\d+)\)/.exec(r.message)
        setServerCapacity(m ? { active: Number(m[1]), capacity: Number(m[2]) } : preview)
        setStep(full ? 'override' : 'request')
        return
      }
      toast(r.message, 'danger')
      return
    }
    toast(`${r.ci_number} created`, 'success')
    refreshCiContext()
    onCreated(r.id, r.ci_number)
  }

  const toggleSecondary = (m: string) =>
    setSecondary((xs) => (xs.includes(m) ? xs.filter((x) => x !== m) : [...xs, m]))

  const dirty = () => !!person || alias !== '' || notes !== '' || explanation !== ''

  return (
    <Modal open={open} onClose={onClose} dirty={dirty} wide>
      <div className="p-5">
        <ModalHeader title="Add confidential informant" onClose={onClose} />
        <ol className="mb-4 flex flex-wrap gap-1.5" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <span aria-current={s === step ? 'step' : undefined}
                className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold ${s === step ? 'bg-badge-500/15 text-white' : i < idx ? 'bg-white/5 text-slate-300' : 'text-slate-500'}`}>
                <span className="tabular-nums">{i + 1}</span> {STEP_LABEL[s]}
              </span>
            </li>
          ))}
        </ol>

        <div className="min-h-[14rem] space-y-3">
          {step === 'person' && (
            <>
              <EntityPicker kind="person" label="Person" required value={person} onChange={setPerson}
                hint="The registry record this source is. Nothing on the person record changes — the relationship lives only in the compartment."
                onCreateNew={(q) => create.open('person', { prefillName: q, onCreated: (id, name) => setPerson({ id, label: name }) })}
                createLabel={(q) => `New person: “${q}”`} />
              <Field label="Alias / codename">
                {(id) => <Input id={id} value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="How the source is referred to in reporting" />}
              </Field>
              {err && <p className="text-xs font-semibold text-rose-300">{err}</p>}
            </>
          )}

          {step === 'motive' && (
            <>
              <Field label="Primary motive">
                {(id) => (
                  <Select id={id} value={motive} onChange={(e) => setMotive(e.target.value)}>
                    <option value="">Unknown</option>
                    {CI_MOTIVES.map((m) => <option key={m} value={m}>{CI_MOTIVE_LABEL[m]}</option>)}
                  </Select>
                )}
              </Field>
              <fieldset>
                <legend className="mb-1 block text-xs font-semibold text-slate-400">Secondary motives</legend>
                <div className="flex flex-wrap gap-1.5">
                  {CI_MOTIVES.filter((m) => m !== motive).map((m) => (
                    <button key={m} type="button" aria-pressed={secondary.includes(m)} onClick={() => toggleSecondary(m)}
                      className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition ${secondary.includes(m) ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                      {CI_MOTIVE_LABEL[m]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <Field label="Explanation">
                {(id) => <Textarea id={id} rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Why this person cooperates — in their words and yours" />}
              </Field>
            </>
          )}

          {step === 'handler' && (
            full ? (
              <>
                <MemberSelect label="Primary handler" required value={primary} onChange={setPrimary} />
                <MemberSelect label="Secondary handler (optional)" value={secondaryHandler} onChange={setSecondaryHandler} exclude={primary ? new Set([primary]) : undefined} />
                {err && <p className="text-xs font-semibold text-rose-300">{err}</p>}
              </>
            ) : (
              <div className="rounded-lg border border-white/10 bg-ink-900/60 p-4 text-sm text-slate-200">
                You will be the primary handler. A secondary handler can be added later by CI command.
              </div>
            )
          )}

          {step === 'capacity' && (
            <div className={`rounded-lg border p-4 ${atCap ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10 bg-ink-900/60'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{full ? `${handlerName} — capacity` : 'My capacity'}</p>
              <p className={`text-2xl font-bold tabular-nums ${atCap ? 'text-amber-200' : 'text-white'}`}>{capacityLabel(preview.active, preview.capacity)}</p>
              <p className="mt-2 text-sm text-slate-300">
                {atCap
                  ? full
                    ? 'At capacity. If the source starts active you will be asked to authorize the override with a reason.'
                    : 'You are at capacity. If the source starts active, the wizard will end in an assignment request for CI command to approve.'
                  : 'Within the normal capacity. Only active sources count.'}
              </p>
            </div>
          )}

          {step === 'bureau' && (
            <Field label="Bureau" required error={err}>
              {(id) => (
                <Select id={id} value={bureau} onChange={(e) => setBureau(e.target.value)}>
                  {Object.entries(BUREAUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              )}
            </Field>
          )}

          {step === 'notes' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Recruited on">
                  {(id) => <Input id={id} type="date" value={recruitedAt} onChange={(e) => setRecruitedAt(e.target.value)} />}
                </Field>
                <Field label="Reliability">
                  {(id) => (
                    <Select id={id} value={reliability} onChange={(e) => setReliability(e.target.value)}>
                      {CI_RELIABILITY.map((v) => <option key={v} value={v}>{CI_RELIABILITY_LABEL[v]}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Risk">
                  {(id) => (
                    <Select id={id} value={risk} onChange={(e) => setRisk(e.target.value)}>
                      {CI_RISK.map((v) => <option key={v} value={v}>{CI_RISK_LABEL[v]}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
              <Field label="Recruitment notes">
                {(id) => <Textarea id={id} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How the approach was made, conditions agreed, handling instructions" />}
              </Field>
            </>
          )}

          {step === 'status' && (
            <Field label="Initial status" required hint="Active sources count toward the handler's capacity; a candidate does not until activated.">
              {(id) => (
                <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as CiStatus)}>
                  {INITIAL_STATUSES.map((s) => <option key={s} value={s}>{CI_STATUS_LABEL[s]}</option>)}
                </Select>
              )}
            </Field>
          )}

          {step === 'review' && (
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-slate-400">Person</dt><dd className="text-slate-100">{person?.label}{alias ? ` · “${alias}”` : ''}</dd>
              <dt className="text-slate-400">Motive</dt><dd className="text-slate-100">{motiveSummary(motive || null, secondary)}</dd>
              <dt className="text-slate-400">Handler</dt><dd className="text-slate-100">{handlerName}{full && secondaryHandler ? ` · secondary ${officerName(secondaryHandler) ?? ''}` : ''}</dd>
              <dt className="text-slate-400">Capacity</dt>
              <dd className="flex items-center gap-2 text-slate-100">{capacityLabel(preview.active, preview.capacity)}{atCap && willCount && <Badge tone="warn">Exceeds on activation</Badge>}</dd>
              <dt className="text-slate-400">Bureau</dt><dd className="text-slate-100">{BUREAUS[bureau] ?? bureau}</dd>
              <dt className="text-slate-400">Grading</dt><dd className="text-slate-100">{CI_RELIABILITY_LABEL[reliability as keyof typeof CI_RELIABILITY_LABEL]} reliability · {CI_RISK_LABEL[risk as keyof typeof CI_RISK_LABEL]} risk</dd>
              <dt className="text-slate-400">Initial status</dt><dd className="text-slate-100">{CI_STATUS_LABEL[status]}</dd>
            </dl>
          )}

          {step === 'override' && (
            <CapacityWarning handlerName={handlerName} active={serverCapacity?.active ?? preview.active} capacity={serverCapacity?.capacity ?? preview.capacity}
              reason={overrideReason} onReason={setOverrideReason} error={err} />
          )}

          {step === 'request' && (
            <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-amber-200">You are at capacity</p>
              <p className="text-sm text-slate-200">
                {capacityLabel(serverCapacity?.active ?? preview.active, serverCapacity?.capacity ?? preview.capacity)} — the source cannot start active under your
                handling. Ask CI command for an assignment: approving it designates the source to you with the override recorded.
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <Button onClick={step === 'person' ? onClose : back}>{step === 'person' ? 'Cancel' : 'Back'}</Button>
          <div className="flex gap-2">
            {step === 'review' && <Button variant="primary" onAction={() => submit(false)}>Create CI</Button>}
            {step === 'override' && <Button variant="warn" onAction={() => submit(true)}>Assign with authorization</Button>}
            {step === 'request' && <Button variant="primary" onClick={() => { onClose(); onRequestAssignment() }}>Request assignment</Button>}
            {idx >= 0 && step !== 'review' && <Button variant="primary" onClick={next}>Next</Button>}
          </div>
        </div>
      </div>
    </Modal>
  )
}
