'use client'

import { useCallback, useEffect, useState } from 'react'
import { list, rpc } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { signoffLabel, signoffTint, SIGNOFF_ACTION_VERB } from '@/lib/signoff'
import { toast } from '@/lib/toast'
import type { CaseRow, HistoryRow } from './shared'

export function SignoffTab({ c }: { c: CaseRow }) {
  const { profile } = useAuth()
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [note, setNote] = useState('')
  const v = useTableVersion('case_signoff_history')
  const refresh = useCallback(async () => { try { setHistory(await list('case_signoff_history', { eq: { case_id: c.id }, order: 'created_at', ascending: false })) } catch { /* stale */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const owner = profile?.id && (profile.id === c.lead_detective_id || profile.id === c.signoff_submitted_by)
  const reviewer = profile?.id && profile.id === c.signoff_assignee_id
  const callRpc = async (kind: 'submit' | 'approve' | 'deny' | 'changes' | 'complete' | 'escalate') => {
    const res = kind === 'submit' ? await rpc('signoff_submit', { p_case: c.id })
      : kind === 'complete' || kind === 'escalate' ? await rpc('signoff_owner_action', { p_case: c.id, p_action: kind })
      : await rpc('signoff_decide', { p_case: c.id, p_decision: kind === 'changes' ? 'changes_requested' : kind, p_note: note || undefined })
    if (res.error) toast(res.error.message, 'danger')
    else { setNote(''); toast('Sign-off updated.', 'success'); void refresh() }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <p className="text-sm text-slate-400">Current state</p>
        <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-bold ${signoffTint(c.signoff_status)}`}>{signoffLabel(c.signoff_status)}</p>
        <p className="mt-2 text-sm text-slate-400">Assignee: {officerName(c.signoff_assignee_id) || 'None'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {owner && <button onClick={() => void callRpc('submit')} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Submit / Resubmit</button>}
          {owner && c.signoff_status === 'approved_deputy' && <><button onClick={() => void callRpc('complete')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">Complete at Deputy</button><button onClick={() => void callRpc('escalate')} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white">Escalate</button></>}
          {reviewer && <><button onClick={() => void callRpc('approve')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">Approve</button><button onClick={() => void callRpc('changes')} className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white">Changes</button><button onClick={() => void callRpc('deny')} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white">Deny</button></>}
        </div>
        {(reviewer || owner) && <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Decision note" className="mt-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />}
      </div>
      <div className="space-y-2">
        {history.map((h) => <div key={h.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-3 text-sm text-slate-300"><b className="text-white">{h.actor_name || officerName(h.actor_id) || 'System'}</b> {SIGNOFF_ACTION_VERB[h.action] || h.action} <span className="text-slate-500">{timeAgo(h.created_at)}</span>{h.note && <p className="mt-1 text-slate-400">{h.note}</p>}</div>)}
        {!history.length && <p className="py-8 text-center text-sm text-slate-500">No sign-off history yet.</p>}
      </div>
    </div>
  )
}
