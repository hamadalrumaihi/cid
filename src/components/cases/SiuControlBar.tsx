'use client'

/** §14 — assuming and releasing SIU control of a case, plus the §15 export
 *  control on an SIU investigation.
 *
 *  Renders nothing without SIU command standing, so an ordinary CID member
 *  never sees a control they cannot use, and — more importantly — a case that
 *  SIU has never touched is visually identical to any other case.
 *
 *  Nothing here is the security boundary. `siu_assume_control` and
 *  `siu_release_control` both re-check authority server-side, and the two
 *  authority columns are frozen against every direct write by
 *  `private.block_direct_siu_case_cols()`. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { list, rpc, withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  SIU_CASE_CATEGORIES, SIU_CLASSIFICATIONS, SIU_CLASSIFICATION_HINT,
  SIU_CLOSURE_REASONS, SIU_STAGE_HINT, isPreliminaryInquiry, siuCaseCategoryLabel,
  siuClassificationLabel, siuClosureReasonLabel, siuStageLabel, siuStageTint,
  SIU_TEMP_ACCESS_MAX_DAYS, fetchSiuTempAccess, tempAccessLive, type SiuTempAccess,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { uiPrompt } from '@/components/ui/dialog'
import { SiuExportPanel } from '@/components/siu/SiuTradecraft'
import type { Tables } from '@/lib/database.types'
import type { CaseRow } from './tabs/shared'

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function SiuControlBar({ caseRow, onChanged }: { caseRow: CaseRow; onChanged: () => void }) {
  const siu = useSiu()
  const [taking, setTaking] = useState(false)

  const isSiu = caseRow.case_authority === 'siu'
  const wasAssumed = !!caseRow.siu_assumed_at

  // Command only. Oversight standing (the Director, the AG) deliberately gets
  // no takeover control: taking a CID case is an operational decision.
  if (!siu.isCommand) return null

  const release = async () => {
    const reason = await uiPrompt(
      'The case returns to CID with its bureau, lead detective and full history intact. CID members regain access immediately.',
      { title: 'Return control to CID', placeholder: 'Reason', confirmText: 'Return to CID' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_release_control', { p_case: caseRow.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Control returned to CID.', 'success')
    onChanged()
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.03] px-4 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">SIU Command</span>

      {!isSiu && (
        <>
          <span className="text-xs text-slate-300">
            This is a CID case. SIU can assume control of it without moving, copying or renumbering anything.
          </span>
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => setTaking(true)}>
            Assume SIU control
          </Button>
        </>
      )}

      {isSiu && wasAssumed && (
        <>
          <span className="text-xs text-slate-300">
            Assumed from CID {fmtDate(caseRow.siu_assumed_at)}
            {caseRow.siu_assumption_reason ? ` — ${caseRow.siu_assumption_reason}` : ''}
          </span>
          <Button size="sm" className="ml-auto" onClick={() => void release()}>Return control to CID</Button>
        </>
      )}

      {isSiu && !wasAssumed && (
        <span className="text-xs text-slate-400">
          Opened by SIU. A natively-SIU investigation is never handed to CID wholesale — release a
          specific item instead.
        </span>
      )}

      {isSiu && <div className="w-full"><SiuExportPanel caseId={caseRow.id} /></div>}

      {isSiu && <div className="w-full"><SiuSupportingAccess caseRow={caseRow} /></div>}

      {taking && (
        <AssumeModal
          caseRow={caseRow}
          onClose={() => setTaking(false)}
          onDone={() => { setTaking(false); onChanged() }}
        />
      )}
    </div>
  )
}

/** §15/§17/§32/§33 — stage, category, closure and recusal on an SIU
 *  investigation.
 *
 *  Separate from SiuControlBar because the audiences differ. Promotion,
 *  category and closure are command acts. DECLARING A CONFLICT is not: it is
 *  available to anyone who can see the file, deliberately including oversight,
 *  because the person most in need of a way to step back is often the most
 *  senior one in the room. `siu_declare_conflict()` gates on
 *  `private.siu_case_read()` for exactly that reason.
 *
 *  Declaring is one-way from this screen. The recusal takes effect in the same
 *  transaction — `private.siu_recused()` vetoes access above every grant, rank
 *  and owner included — and only a DIFFERENT member of command can lift it,
 *  from the Intake screen. */
export function SiuCaseLifecycle({ caseRow, onChanged }: { caseRow: CaseRow; onChanged: () => void }) {
  const siu = useSiu()
  const [closing, setClosing] = useState(false)

  if (caseRow.case_authority !== 'siu' || !siu.canAccess) return null

  const inquiry = isPreliminaryInquiry(caseRow)
  const closed = caseRow.status === 'closed'

  const promote = async () => {
    const reason = await uiPrompt(
      'The inquiry becomes a full investigation. From that moment it is visible to oversight — the Director of CID and the Attorney General — at standard classification. This cannot be undone.',
      { title: 'Promote to full investigation', placeholder: 'Reason', confirmText: 'Promote' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_promote_inquiry', { p_case: caseRow.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Promoted to a full investigation.', 'success')
    onChanged()
  }

  const setCategory = async (value: string) => {
    const res = await rpc('siu_set_case_category', { p_case: caseRow.id, p_category: value })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Category updated.', 'success')
    onChanged()
  }

  const declareConflict = async () => {
    const reason = await uiPrompt(
      'Your access to this investigation ends immediately — reading and writing both, whatever your rank. Only another member of command can restore it. The declaration itself is kept: a conflict declared and handled is a good record.',
      { title: 'Declare a conflict of interest', placeholder: 'Why you are conflicted', confirmText: 'Declare and step back' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_declare_conflict', { p_case: caseRow.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Conflict declared. You no longer have access to this investigation.', 'success')
    onChanged()
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5">
      <Badge tint={siuStageTint(caseRow.siu_stage)} title={SIU_STAGE_HINT[caseRow.siu_stage ?? 'investigation']}>
        {siuStageLabel(caseRow.siu_stage)}
      </Badge>
      {caseRow.siu_category && (
        <Badge tone="neutral">{siuCaseCategoryLabel(caseRow.siu_category)}</Badge>
      )}
      {closed && caseRow.siu_closure_reason && (
        <span className="text-xs text-slate-400">
          Closed — {siuClosureReasonLabel(caseRow.siu_closure_reason)}
          {caseRow.siu_closure_note ? `: ${caseRow.siu_closure_note}` : ''}
        </span>
      )}

      {inquiry && (
        <span className="text-[11px] text-amber-300/80">
          Not visible to oversight until promoted.
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {siu.isCommand && !closed && (
          <Select
            aria-label="Case category"
            className="h-7 w-auto py-0 text-xs"
            value={caseRow.siu_category ?? ''}
            onChange={(e) => void setCategory(e.target.value)}
          >
            <option value="">No category</option>
            {SIU_CASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{siuCaseCategoryLabel(c)}</option>
            ))}
          </Select>
        )}
        {siu.isCommand && inquiry && !closed && (
          <Button size="sm" onClick={() => void promote()}>Promote to investigation</Button>
        )}
        {siu.isCommand && !closed && (
          <Button size="sm" onClick={() => setClosing(true)}>Close investigation</Button>
        )}
        <Button size="sm" onClick={() => void declareConflict()}>Declare a conflict</Button>
      </div>

      {closing && (
        <CloseModal
          caseRow={caseRow}
          onClose={() => setClosing(false)}
          onDone={() => { setClosing(false); onChanged() }}
        />
      )}
    </div>
  )
}

function CloseModal({ caseRow, onClose, onDone }: {
  caseRow: CaseRow; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState<string>('insufficient_evidence')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!note.trim()) { toast('A closure note is required.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_close_case', {
      p_case: caseRow.id, p_reason: reason, p_note: note.trim(),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Investigation closed.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!note}>
      <ModalHeader title={`Close ${caseRow.case_number}`} onClose={onClose} />
      <div className="space-y-3">
        <Field label="Reason" required hint="Every closed SIU investigation carries why, from a fixed list.">
          {(id) => (
            <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
              {SIU_CLOSURE_REASONS.map((r) => (
                <option key={r} value={r}>{siuClosureReasonLabel(r)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Closure note" required hint="What was found, or why nothing was. Recorded against your name.">
          {(id) => (
            <Textarea id={id} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Closing…' : 'Close investigation'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** §30 — supporting-officer access.
 *
 *  Available on a STANDARD investigation only, and the panel says so rather
 *  than silently hiding: command needs to know why the control is absent on a
 *  restricted case, not wonder where it went.
 *
 *  What a grant actually confers is stated on screen every time, because the
 *  person clicking it is deciding to show a CID officer an SIU file and should
 *  not have to remember the boundary. `private.siu_temp_access()` is spliced
 *  into can_access_case()/_row() and never into siu_case_access(), so the
 *  holder gets the case file and no tradecraft table at all. */
function SiuSupportingAccess({ caseRow }: { caseRow: CaseRow }) {
  const siu = useSiu()
  const [rows, setRows] = useState<SiuTempAccess[]>([])
  const [people, setPeople] = useState<Tables<'profiles'>[]>([])
  const [loading, setLoading] = useState(true)
  const [granting, setGranting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([
        withRetry(() => fetchSiuTempAccess(caseRow.id)),
        withRetry(() => list('profiles', { order: 'display_name', limit: 500 })),
      ])
      setRows(t); setPeople(p)
    } catch { /* an empty panel is the honest fallback */ }
    finally { setLoading(false) }
  }, [caseRow.id])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const live = useMemo(() => rows.filter(tempAccessLive), [rows])
  const standard = (caseRow.siu_classification ?? 'siu') === 'siu'

  const revoke = async (t: SiuTempAccess) => {
    const reason = await uiPrompt(
      'Access ends immediately. The grant is kept as a record of who saw this investigation and when.',
      { title: 'End supporting access', placeholder: 'Reason', confirmText: 'End access' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_revoke_temp_access', { p_id: t.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Supporting access ended.', 'success')
    void load()
  }

  const nameOf = (id: string) => people.find((p) => p.id === id)?.display_name ?? 'Unknown'

  if (loading) return null

  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          Supporting officers
        </span>
        {live.length > 0 && (
          <Badge tint="bg-amber-500/15 text-amber-300">{live.length} with access</Badge>
        )}
        {siu.isCommand && standard && (
          <Button size="sm" className="ml-auto" onClick={() => setGranting(true)}>
            Grant supporting access
          </Button>
        )}
      </div>

      {!standard && (
        <p className="mt-2 text-[11px] text-slate-500">
          Not available above standard classification. A restricted, command or compartmented
          investigation is never opened to someone outside the unit.
        </p>
      )}

      {!live.length ? (
        standard && <p className="mt-2 text-[11px] text-slate-500">Nobody outside SIU has access.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {live.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
              <span className="text-slate-100">{nameOf(t.user_id)}</span>
              <span className="text-slate-500">— {t.reason}</span>
              <span className="ml-auto text-slate-500">until {fmtDate(t.expires_at)}</span>
              {siu.isCommand && (
                <button
                  type="button"
                  className="text-rose-300 underline-offset-2 hover:underline"
                  onClick={() => void revoke(t)}
                >
                  End
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {granting && (
        <GrantAccessModal
          caseRow={caseRow}
          people={people}
          onClose={() => setGranting(false)}
          onDone={() => { setGranting(false); void load() }}
        />
      )}
    </div>
  )
}

function GrantAccessModal({ caseRow, people, onClose, onDone }: {
  caseRow: CaseRow
  people: Tables<'profiles'>[]
  onClose: () => void
  onDone: () => void
}) {
  const [user, setUser] = useState('')
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!user) { toast('Choose an officer.', 'warn'); return }
    if (!reason.trim()) { toast('Record why they need access.', 'warn'); return }
    if (days < 1 || days > SIU_TEMP_ACCESS_MAX_DAYS) {
      toast(`Supporting access runs for between 1 and ${SIU_TEMP_ACCESS_MAX_DAYS} days.`, 'warn'); return
    }
    setBusy(true)
    const res = await rpc('siu_grant_temp_access', {
      p_case: caseRow.id, p_user: user, p_reason: reason.trim(), p_days: days,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Supporting access granted.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!reason}>
      <ModalHeader title={`Grant supporting access to ${caseRow.case_number}`} onClose={onClose} />
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
          <p className="font-semibold">What they will and will not see</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-200/80">
            <li>This investigation only — its reports, evidence, media and tasks.</li>
            <li><strong>Not</strong> sources, undercover operations, financial or communications
              intelligence, integrity reviews, targets, disclosures or SIU intelligence notes.</li>
            <li>No SIU workspace, no roster, no other investigation, no SIU standing.</li>
            <li>Access ends automatically at the expiry date, and immediately if the
              investigation is reclassified above standard.</li>
          </ul>
        </div>
        <Field label="Officer" required>
          {(id) => (
            <Select id={id} value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Select…</option>
              {people.filter((p) => p.active).map((p) => (
                <option key={p.id} value={p.id}>{p.display_name ?? p.id}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Runs for (days)" required hint={`Hard limit ${SIU_TEMP_ACCESS_MAX_DAYS}.`}>
          {(id) => (
            <Input
              id={id} type="number" min={1} max={SIU_TEMP_ACCESS_MAX_DAYS}
              value={days} onChange={(e) => setDays(Number(e.target.value))}
            />
          )}
        </Field>
        <Field label="Reason" required hint="Recorded on the grant and in the audit log, against your name.">
          {(id) => (
            <Textarea
              id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Ballistics comparison against the seized firearm"
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Granting…' : 'Grant access'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function AssumeModal({ caseRow, onClose, onDone }: {
  caseRow: CaseRow; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [classification, setClassification] = useState<string>('siu_restricted')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!reason.trim()) { toast('Record why SIU is taking this case.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_assume_control', {
      p_case: caseRow.id,
      p_reason: reason.trim(),
      p_classification: classification,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('SIU control assumed.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!reason}>
      <ModalHeader title={`Assume SIU control of ${caseRow.case_number}`} onClose={onClose} />
      <div className="space-y-3">
        <Field label="Reason" required hint="Recorded on the case and in the audit log, against your name.">
          {(id) => (
            <Textarea
              id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Integrity concern regarding the assigned investigator"
            />
          )}
        </Field>
        <Field label="Classification" hint={SIU_CLASSIFICATION_HINT[classification]}>
          {(id) => (
            <Select id={id} value={classification} onChange={(e) => setClassification(e.target.value)}>
              {SIU_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>{siuClassificationLabel(c)}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
          <p className="font-semibold">What happens immediately</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-200/80">
            <li>The case leaves every CID list, search result and notification, at every rank.</li>
            <li>Its reports, evidence, media, tasks, timeline and sign-off history come with it, unchanged and still credited to their authors.</li>
            <li>The case number, bureau and lead detective are not altered.</li>
            <li>Nobody is notified. The case simply stops appearing.</li>
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Assuming…' : 'Assume control'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
