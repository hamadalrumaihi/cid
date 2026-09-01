'use client'

/** The Director of CID asking X-1 to see one investigation — both sides of it.
 *
 *  ── Why this lives outside the SIB workspace ───────────────────────────────
 *  The Director holds NO SIB standing, so `useSiu().canAccess` is false and the
 *  SIB workspace renders the ordinary nothing-here surface for him. The request
 *  card therefore sits on his own desk, on the CID side. Naming SIB here is
 *  deliberate and safe: it renders only for the Director, who is the unit's
 *  nominal boss and already knows it exists.
 *
 *  ── Why he types a case number instead of picking from a list ──────────────
 *  Because he can see no list, and must not be able to build one. If the form
 *  validated the number, "unknown case" versus "request submitted" would let him
 *  walk the case-number space and learn how many investigations exist and when
 *  each opened — which, against a calendar, is most of what he would want and
 *  none of what he is entitled to. So every well-formed request is accepted
 *  identically and the number is resolved later, in front of X-1.
 *
 *  A consequence worth stating in the UI rather than hiding: a declined request
 *  is worded the same whether the investigation does not exist, is
 *  compartmented, or is about him. He learns nothing from the refusal. */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { rpc, withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  fetchMySiuAccessRequests, siuAccessStatusLabel, siuAccessStatusTint,
  siuMayRequestAccess, type SiuMyAccessRequest,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/PageHeader'
import { Field, Input, Textarea } from '@/components/ui/Field'

const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function SiuAccessRequestCard() {
  const { profile } = useAuth()
  const siu = useSiu()
  const [rows, setRows] = useState<SiuMyAccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [caseNumber, setCaseNumber] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setRows(await withRetry(() => fetchMySiuAccessRequests())) }
    catch { /* an empty list is the honest fallback */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const submit = async () => {
    if (!caseNumber.trim()) { toast('Enter the case number.', 'warn'); return }
    if (!reason.trim()) { toast('X-1 decides on the reason, so one is required.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_request_case_access', {
      p_case_number: caseNumber.trim(), p_reason: reason.trim(),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    setCaseNumber(''); setReason('')
    toast('Request sent to X-1.', 'success')
    void load()
  }

  const withdraw = async (r: SiuMyAccessRequest) => {
    const res = await rpc('siu_withdraw_access_request', { p_request: r.id })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Request withdrawn.', 'success')
    void load()
  }

  // Renders for the Director alone. An account that already holds SIB standing
  // has no use for it — they reach investigations directly.
  if (!siuMayRequestAccess({ profile, release: siu.releaseOpen })) return null
  if (loading) return null

  const pending = rows.filter((r) => r.status === 'pending')
  const granted = rows.filter((r) => r.access_expires_at)

  return (
    <Card>
      <SectionHeader
        title="Special Investigations Bureau — request access"
        subtitle="You do not hold standing in the unit and its caseload is not visible to you. To read a specific investigation, ask X-1 for it by case number."
        actions={
          <div className="flex items-center gap-2">
            {pending.length > 0 && (
              <Badge tint="bg-amber-500/15 text-amber-300">{pending.length} awaiting X-1</Badge>
            )}
            {granted.length > 0 && (
              <Badge tint="bg-emerald-500/15 text-emerald-300">{granted.length} open</Badge>
            )}
          </div>
        }
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Case number" required>
          {(id) => (
            <Input
              id={id}
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              placeholder="SIB-8000012"
            />
          )}
        </Field>
        <Field label="Reason" required hint="X-1 reads this and decides on it.">
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why you need sight of this investigation"
            />
          )}
        </Field>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Sending…' : 'Request'}
        </Button>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        A declined request is worded the same whether the investigation does not exist, is
        restricted, or concerns you — the refusal itself tells you nothing. If access is granted
        it covers that one case file for a fixed period, and not the unit&apos;s sources,
        intelligence notes or operations.
      </p>

      {!!rows.length && (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tint={siuAccessStatusTint(r.status)}>{siuAccessStatusLabel(r.status)}</Badge>
                <span className="font-mono text-sm font-semibold text-slate-100">{r.case_number}</span>
                {r.access_expires_at && (
                  <Badge tone="neutral">Access until {fmtDate(r.access_expires_at)}</Badge>
                )}
                <span className="ml-auto text-[11px] text-slate-500">{fmtWhen(r.requested_at)}</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">{r.reason}</p>
              {r.decision_note && (
                <p className="mt-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300">
                  X-1: {r.decision_note}
                </p>
              )}
              {r.status === 'pending' && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="text-[11px] text-slate-400 underline-offset-2 hover:underline"
                    onClick={() => void withdraw(r)}
                  >
                    Withdraw
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ X-1 side */

/** The decision queue, inside the SIB workspace. Command only — the RLS policy
 *  is `requested_by = me OR siu_is_command()`, so an ordinary agent sees
 *  nothing here either. */
export function SiuAccessQueue({ rows, onDone }: {
  rows: { id: string; case_number_requested: string; reason: string; status: string
          requested_by: string; requested_at: string; decision_note: string | null }[]
  onDone: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})

  const decide = async (id: string, decision: 'approved' | 'denied') => {
    const text = (note[id] ?? '').trim()
    if (!text) { toast('A note is required — the requester is told what you decided.', 'warn'); return }
    setBusy(id)
    const res = await rpc('siu_decide_access_request', {
      p_request: id, p_decision: decision, p_note: text, p_days: 7,
    })
    setBusy(null)
    if (res.error) { toast(res.error.message, 'danger'); return }
    setNote((n) => ({ ...n, [id]: '' }))
    toast(decision === 'approved' ? 'Access granted for 7 days.' : 'Request declined.', 'success')
    onDone()
  }

  const pending = rows.filter((r) => r.status === 'pending')

  return (
    <Card>
      <SectionHeader
        title="Access requests"
        subtitle="The Director of CID asking to read a specific investigation. Approval opens that one case file for a fixed period — never the unit's sources, intelligence or operations."
        actions={pending.length > 0
          ? <Badge tint="bg-amber-500/15 text-amber-300">{pending.length} to decide</Badge>
          : undefined}
      />
      {!rows.length ? (
        <p className="mt-3 text-xs text-slate-400">No access has been requested.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tint={siuAccessStatusTint(r.status)}>{siuAccessStatusLabel(r.status)}</Badge>
                <span className="font-mono text-sm font-semibold text-slate-100">
                  {r.case_number_requested}
                </span>
                <span className="ml-auto text-[11px] text-slate-500">{fmtWhen(r.requested_at)}</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-300">{r.reason}</p>
              {r.decision_note && (
                <p className="mt-1.5 text-[11px] text-slate-500">Your note: {r.decision_note}</p>
              )}
              {r.status === 'pending' && (
                <div className="mt-2 space-y-2">
                  <Textarea
                    rows={2}
                    value={note[r.id] ?? ''}
                    onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="Your decision note — the requester sees this"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" disabled={busy === r.id} onClick={() => void decide(r.id, 'denied')}>
                      Decline
                    </Button>
                    <Button size="sm" variant="primary" disabled={busy === r.id}
                            onClick={() => void decide(r.id, 'approved')}>
                      {busy === r.id ? 'Saving…' : 'Grant 7 days'}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
