'use client'

import { useCallback, useEffect, useState } from 'react'
import { WorkflowTimeline } from '@/components/ui/WorkflowTimeline'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { uiConfirm } from '@/components/ui/dialog'
import { list, rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { signoffLabel, signoffTint, SIGNOFF_ACTION_VERB, SIGNOFF_STAGE_LABEL } from '@/lib/signoff'
import { toast } from '@/lib/toast'
import { useAction } from '@/lib/useAction'
import type { CaseRow, HistoryRow } from './shared'

/** How each history row came to be — the RPCs stamp `source` alongside the
 *  action (Sprint 1A); rendered so an override is never mistaken for a
 *  routine decision (audit P2-10). */
const SIGNOFF_SOURCE_LABEL: Record<string, string> = {
  submit: 'owner submission',
  reviewer: 'reviewer decision',
  owner: 'owner action',
  command_override: 'command override',
}

/** The two transitions signoff_command_override accepts, verbatim — both only
 *  from 'approved_deputy' (the owner's stop-point). Do not add entries: the
 *  RPC raises `unknown action` on anything else. */
const OVERRIDE_ACTIONS = [
  { value: 'complete', label: 'Mark complete → Approved & Complete' },
  { value: 'escalate', label: 'Escalate to Director → Awaiting Director' },
] as const
type OverrideAction = (typeof OVERRIDE_ACTIONS)[number]['value']

/** Command override form — first client surface for signoff_command_override
 *  (20260721040000; previously SQL-only). Reason is mandatory (the RPC rejects
 *  a blank one) and the confirm states the audit consequence: the history row
 *  is stamped source='command_override' and renders "via command override". */
function CommandOverrideControl({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const [action, setAction] = useState<OverrideAction>('complete')
  const [reason, setReason] = useState('')
  const run = async () => {
    const trimmed = reason.trim()
    if (!trimmed) { toast('A reason is required for a command override.', 'warn'); return }
    const verb = action === 'complete' ? 'Mark this case Approved & Complete' : 'Escalate this case to the Director'
    const ok = await uiConfirm(
      `${verb}, overriding the stop-point? Your name and reason are permanently recorded.`,
      { title: 'Command override', confirmText: 'Record override' },
    )
    if (!ok) return
    const res = await rpc('signoff_command_override', { p_case: caseId, p_action: action, p_reason: trimmed })
    if (res.error) toast(res.error.message, 'danger')
    else { setReason(''); toast('Override recorded.', 'success'); onDone() }
  }
  return (
    <div className="mt-3 space-y-3">
      <Field label="Override action">
        {(id) => (
          <Select id={id} value={action} onChange={(e) => setAction(e.target.value as OverrideAction)}>
            {OVERRIDE_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Reason" required hint="Recorded verbatim in the sign-off history.">
        {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why command is overriding the owner's decision" />}
      </Field>
      <Button variant="danger" size="sm" onAction={run}>Record override…</Button>
    </div>
  )
}

export function SignoffTab({ c }: { c: CaseRow }) {
  const { profile } = useAuth()
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [note, setNote] = useState('')
  const v = useTableVersion('case_signoff_history')
  const refresh = useCallback(async () => { try { setHistory(await list('case_signoff_history', { eq: { case_id: c.id }, order: 'created_at', ascending: false })) } catch { /* stale */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const owner = profile?.id && (profile.id === c.lead_detective_id || profile.id === c.signoff_submitted_by)
  // Mirror of private.signoff_assert_decider: the routed assignee, or any
  // Director (the explicit override) — never the case owner deciding their
  // own submission.
  const reviewer = profile?.id && !owner && !!c.signoff_stage
    && (profile.id === c.signoff_assignee_id || profile.role === 'director')
  // Cosmetic mirror of the RPC's own gate (signoff_command_override): active
  // AND (Deputy Director / Director role OR the owner flag). Bureau Leads are
  // command but are NOT accepted — do not widen this to isCommand.
  const canOverride = !!profile?.active
    && (profile.role === 'deputy_director' || profile.role === 'director' || !!profile.is_owner)
  // Busy-guarded (useAction): a double-click can't fire the RPC twice, and
  // every sign-off button disables while one is in flight.
  const { run: callRpc, busy } = useAction(async (kind: 'submit' | 'approve' | 'deny' | 'changes' | 'complete' | 'escalate') => {
    const res = kind === 'submit' ? await rpc('signoff_submit', { p_case: c.id })
      : kind === 'complete' || kind === 'escalate' ? await rpc('signoff_owner_action', { p_case: c.id, p_action: kind })
      : await rpc('signoff_decide', { p_case: c.id, p_decision: kind, p_note: note || undefined })
    if (res.error) toast(res.error.message, 'danger')
    else { setNote(''); toast('Sign-off updated.', 'success'); void refresh() }
  })
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <p className="text-sm text-slate-400">Current state</p>
        <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-bold ${signoffTint(c.signoff_status)}`}>{signoffLabel(c.signoff_status)}</p>
        <p className="mt-2 text-sm text-slate-400">Assignee: {officerName(c.signoff_assignee_id) || 'None'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {owner && <button onClick={() => void callRpc('submit')} disabled={busy} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">Submit / Resubmit</button>}
          {owner && c.signoff_status === 'approved_deputy' && <><Button variant="success" disabled={busy} onClick={() => void callRpc('complete')}>Complete at Deputy</Button><Button variant="warn" disabled={busy} onClick={() => void callRpc('escalate')}>Escalate</Button></>}
          {reviewer && <><Button variant="success" disabled={busy} onClick={() => void callRpc('approve')}>Approve</Button><button onClick={() => void callRpc('changes')} disabled={busy} className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">Changes</button><button onClick={() => void callRpc('deny')} disabled={busy} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">Deny</button></>}
        </div>
        {(reviewer || owner) && <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Decision note" className="mt-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />}
        {canOverride && (
          // Deliberately separated from the routine actions above: overrides
          // bypass the owner's stop-point choice, so the affordance carries
          // its own bordered subsection and audit warning.
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-amber-300">Command override</h3>
              <Badge tone="warn">Audited</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Forces a case past the owner&rsquo;s stop-point. Every override appears in the history below as &ldquo;via command override&rdquo; with your name and reason.
            </p>
            {c.signoff_status === 'approved_deputy'
              ? <CommandOverrideControl caseId={c.id} onDone={() => { void refresh() }} />
              : (
                <p className="mt-2 text-sm text-slate-400">
                  Available only while the case is <span className="font-semibold text-slate-200">Approved by Deputy</span> — command may then mark it complete or escalate it to the Director.
                </p>
              )}
          </div>
        )}
      </div>
      <WorkflowTimeline
        empty="No sign-off history yet."
        entries={history.map((h) => {
          // Full trail: verb + chain stage, the from→to status transition and
          // the recorded source — all fields the RPCs already stamp.
          const stage = h.stage ? SIGNOFF_STAGE_LABEL[h.stage] || h.stage : null
          const source = h.source ? SIGNOFF_SOURCE_LABEL[h.source] || h.source : null
          const actor = h.actor_name || officerName(h.actor_id) || 'System'
          return {
            id: h.id,
            title: stage ? `${SIGNOFF_ACTION_VERB[h.action] || h.action} — ${stage}` : SIGNOFF_ACTION_VERB[h.action] || h.action,
            actor: source ? `${actor} · via ${source}` : actor,
            at: h.created_at,
            from: h.from_status ? signoffLabel(h.from_status) : null,
            to: h.to_status ? signoffLabel(h.to_status) : null,
            note: h.note,
          }
        })}
      />
    </div>
  )
}
