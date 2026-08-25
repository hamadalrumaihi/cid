'use client'

/** The SIB section of a Field Intelligence report.
 *
 *  Three audiences read this panel and each sees a different amount of it:
 *
 *  - Any investigator sees the SIB state, the category, the reason somebody
 *    gave and the handling history. That is what "a referral is not a
 *    disappearance" means in practice — CID keeps its report and can see what
 *    became of it.
 *  - SIB agents additionally get accept / decline, the restriction control and
 *    the follow-up candidates.
 *  - X-1 additionally gets assignment.
 *
 *  Nothing here is the boundary. `field_submission_siu_decide()` refuses a
 *  non-agent, `field_submission_siu_assign()` refuses anybody who is not the
 *  Special Agent in Charge — a CID Bureau Lead and the CID Director included —
 *  and the follow-up table's SELECT policy is `private.siu_is_agent()` with no
 *  second branch. This file just avoids offering buttons that would be refused.
 */
import { useCallback, useEffect, useState } from 'react'
import { fmtDateTime } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { useSiu } from '@/lib/useSiu'
import type { FieldSubmissionRow, SubmissionParts } from '@/lib/fieldSubmissions'
import {
  FOLLOWUP_KINDS, SIU_CATEGORIES, SIU_CATEGORY_LABEL, addFollowup, assignSiuAgent,
  canFlag, canRefer, clearFollowup, decideSiuReferral, flagForSiu, followupLabel,
  loadFollowups, loadSiuActions, referToSiu, referralProblem, referralWarning,
  setSiuSensitive, siuActionLine, siuCategoryLabel, siuStateLabel, siuStateMeaning,
  siuStateTone, unflagForSiu,
  type FieldSiuActionRow, type FieldSiuFollowupRow, type FollowupKind,
  type SiuCategory,
} from '@/lib/fieldSiu'
import { SiuEnterprise } from './SiuEnterprise'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { uiPrompt } from '@/components/ui/dialog'

export function SiuPanel({ submission, parts, onChanged }: {
  submission: FieldSubmissionRow
  parts: SubmissionParts
  onChanged: () => void
}) {
  const siu = useSiu()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [actions, setActions] = useState<FieldSiuActionRow[]>([])
  const [followups, setFollowups] = useState<FieldSiuFollowupRow[]>([])
  const [refer, setRefer] = useState(false)
  const [form, setForm] = useState({ category: '', reason: '' })
  const id = submission.id

  const load = useCallback(async () => {
    const [a, f] = await Promise.all([loadSiuActions(id), loadFollowups(id)])
    setActions(a); setFollowups(f)
  }, [id])

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); void fetchProfiles() }, 0)
    return () => window.clearTimeout(t)
  }, [load, fetchProfiles])

  const after = async (err: string | null, ok: string) => {
    if (err) { toast(err, 'danger'); return }
    toast(ok, 'success')
    await load()
    onChanged()
  }

  const send = async () => {
    const problem = referralProblem(form.category, form.reason)
    if (problem) { toast(problem, 'warn'); return }
    await after(
      await referToSiu(id, form.category as SiuCategory, form.reason),
      'Referred to SIB.',
    )
    setRefer(false); setForm({ category: '', reason: '' })
  }

  const flag = async (category: SiuCategory) => {
    await after(await flagForSiu(id, category), 'Flagged as possible SIB work.')
  }

  const unflag = async () => {
    const why = await uiPrompt(
      'The flag comes off and the report carries no SIB marking.',
      { title: 'Remove the SIB flag', placeholder: 'Why is it not SIB work?', confirmText: 'Remove' },
    )
    if (!why?.trim()) return
    await after(await unflagForSiu(id, why), 'Flag removed.')
  }

  const decide = async (accept: boolean) => {
    let note: string | undefined
    if (!accept) {
      const said = await uiPrompt(
        'The CID investigator who referred it is still holding the report and '
        + 'needs to know what to do next.',
        { title: 'Decline the referral', placeholder: 'Why is SIB not taking it?', confirmText: 'Decline' },
      )
      if (!said?.trim()) return
      note = said
    }
    await after(
      await decideSiuReferral(id, accept, note),
      accept ? 'SIB has taken it. CID keeps the report.' : 'Declined. It stays with CID.',
    )
  }

  const restrict = async (on: boolean) => {
    const why = await uiPrompt(
      on
        ? 'Restricting hides this report from everybody outside SIB except the '
          + 'officer who wrote it, the investigator who referred it and the '
          + 'investigator holding it.'
        : 'Lifting the restriction returns this report to the ordinary bureau queue.',
      { title: on ? 'Restrict to SIB' : 'Lift the restriction', placeholder: 'Reason', confirmText: 'Confirm' },
    )
    if (!why?.trim()) return
    await after(await setSiuSensitive(id, on, why), on ? 'Restricted to SIB.' : 'Restriction lifted.')
  }

  const assign = async (userId: string) => {
    const reason = submission.siu_assigned_to
      ? await uiPrompt('Say why it is moving.',
          { title: 'Reassign', placeholder: 'Reason', confirmText: 'Reassign' })
      : null
    if (submission.siu_assigned_to && !reason?.trim()) return
    await after(await assignSiuAgent(id, userId, reason ?? undefined), 'Assigned.')
  }

  const addFlag = async (kind: FollowupKind) => {
    const note = await uiPrompt(
      'SIB only. The submitting officer and the CID investigator holding this '
      + 'report never see follow-up candidates.',
      { title: followupLabel(kind), placeholder: 'Note (optional)', confirmText: 'Add' },
    )
    // An empty note is fine here; a cancelled dialog is not.
    if (note === null) return
    await after(await addFollowup(id, kind, note), 'Recorded as a candidate.')
  }

  const clear = async (f: FieldSiuFollowupRow) => {
    const why = await uiPrompt(`${followupLabel(f.kind)} is no longer a candidate.`,
      { title: 'Clear', placeholder: 'Why?', confirmText: 'Clear' })
    if (!why?.trim()) return
    await after(await clearFollowup(f.id, why), 'Cleared.')
  }

  const open = followups.filter((f) => !f.cleared_at)
  const openKinds = new Set(open.map((f) => f.kind))
  const agents = profiles.filter((p) => p.active && !p.removed_at)

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Special Investigations Bureau
        </h4>
        <span className="flex items-center gap-2">
          {submission.siu_sensitive && <Badge tone="danger">Restricted to SIB</Badge>}
          {submission.siu_state && (
            <Badge tone={siuStateTone(submission.siu_state)}>
              {siuStateLabel(submission.siu_state)}
            </Badge>
          )}
        </span>
      </div>

      {submission.siu_state ? (
        <>
          <p className="mt-2 text-sm text-slate-300">{siuStateMeaning(submission.siu_state)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {siuCategoryLabel(submission.siu_category)}
            {submission.siu_referred_at && ` · referred ${fmtDateTime(submission.siu_referred_at)}`}
            {submission.siu_referred_by && ` by ${officerName(submission.siu_referred_by) ?? 'an investigator'}`}
          </p>
          {submission.siu_reason && (
            <p className="mt-1 text-sm text-slate-400">“{submission.siu_reason}”</p>
          )}
          {submission.siu_assigned_to && (
            <p className="mt-1 text-xs text-slate-400">
              SIB: {officerName(submission.siu_assigned_to) ?? 'a Special Agent'}
              {submission.siu_assigned_at && ` since ${fmtDateTime(submission.siu_assigned_at)}`}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-400">
          Nothing here suggests SIB work yet. Flagging is a note to colleagues; referring
          is a formal ask that SIB take it on.
        </p>
      )}

      {/* Ordinary investigator controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canFlag(submission.siu_state) && (
          <Select
            value=""
            aria-label="Flag possible SIB relevance"
            onChange={(e) => { if (e.target.value) void flag(e.target.value as SiuCategory) }}
            className="text-xs"
          >
            <option value="">{submission.siu_state === 'flagged' ? 'Change the flag…' : 'Flag possible SIB relevance…'}</option>
            {SIU_CATEGORIES.map((c) => (
              <option key={c} value={c}>{SIU_CATEGORY_LABEL[c]}</option>
            ))}
          </Select>
        )}
        {submission.siu_state === 'flagged' && (
          <Button size="sm" variant="ghost" onClick={() => void unflag()}>Remove flag</Button>
        )}
        {canRefer(submission.siu_state) && !refer && (
          <Button size="sm" variant="ghost" onClick={() => setRefer(true)}>Refer to SIB</Button>
        )}
        {siu.isAgent && submission.siu_state === 'referred' && (
          <>
            <Button size="sm" variant="primary" onClick={() => void decide(true)}>Accept for SIB</Button>
            <Button size="sm" variant="ghost" onClick={() => void decide(false)}>Decline</Button>
          </>
        )}
        {siu.isAgent && submission.siu_state === 'accepted' && (
          <Button size="sm" variant="ghost" onClick={() => void decide(false)}>Hand back to CID</Button>
        )}
        {siu.isAgent && (
          <Button size="sm" variant="ghost"
            onClick={() => void restrict(!submission.siu_sensitive)}>
            {submission.siu_sensitive ? 'Lift restriction' : 'Restrict to SIB'}
          </Button>
        )}
      </div>

      {refer && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Category">
            {(fid) => (
              <Select id={fid} value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Choose…</option>
                {SIU_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{SIU_CATEGORY_LABEL[c]}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Why SIB" hint="They read this to decide. Say what makes it a network rather than an incident.">
            {(fid) => (
              <Textarea id={fid} rows={2} value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            )}
          </Field>
          {referralWarning(form.category) && (
            <p className="text-xs text-amber-300 sm:col-span-2">{referralWarning(form.category)}</p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button variant="primary" onClick={() => void send()}>Refer</Button>
            <Button variant="ghost" onClick={() => setRefer(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* X-1 only. CID command is deliberately absent from this control. */}
      {siu.isCommand && submission.siu_state === 'accepted' && (
        <div className="mt-3">
          <Field label="Assign a Special Agent"
            hint="SIB work follows the SIB chain. A Bureau Lead cannot make this assignment.">
            {(fid) => (
              <Select id={fid} value=""
                onChange={(e) => { if (e.target.value) void assign(e.target.value) }}>
                <option value="">
                  {submission.siu_assigned_to ? 'Reassign to…' : 'Assign to…'}
                </option>
                {agents.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name || p.id}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}

      {/* SIB only, enforced by the table's policy. */}
      {siu.isAgent && (
        <div className="mt-4 border-t border-white/5 pt-3">
          <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Follow-up candidates
          </h5>
          <p className="mt-1 text-xs text-slate-500">
            Not visible to the submitting officer or to CID. Marking a candidate starts
            nothing on its own — it records that this report is worth one of these.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FOLLOWUP_KINDS.filter((k) => !openKinds.has(k)).map((k) => (
              <Button key={k} size="sm" variant="ghost" onClick={() => void addFlag(k)}>
                + {followupLabel(k)}
              </Button>
            ))}
          </div>
          {open.length > 0 && (
            <ul className="mt-2 space-y-1">
              {open.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="accent">{followupLabel(f.kind)}</Badge>
                  {f.note && <span className="text-slate-400">{f.note}</span>}
                  <span className="text-slate-600">
                    {officerName(f.created_by) ?? 'SIB'} · {fmtDateTime(f.created_at)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void clear(f)}>Clear</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {siu.isAgent && (
        <SiuEnterprise submission={submission} parts={parts} onChanged={onChanged} />
      )}

      {actions.length > 0 && (
        <ul className="mt-4 space-y-1 border-l border-white/10 pl-3">
          {actions.map((a) => (
            <li key={a.id} className="text-xs text-slate-400">
              <span className="text-slate-300">
                {siuActionLine(a, (u) => officerName(u) ?? 'Someone')}
              </span>
              {' · '}{fmtDateTime(a.created_at)}
              {a.reason && <span className="block text-slate-500">“{a.reason}”</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
