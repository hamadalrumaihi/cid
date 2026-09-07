'use client'

/** Restricted view for a case the viewer cannot read (P3-07).
 *
 *  WHEN IT SHOWS — the row is unreadable under RLS AND the viewer is an
 *  active CID member AND the id came from a user action (a deep link or an
 *  open tab; restored tabs prune silently in WorkspaceProvider instead).
 *  We deliberately do NOT ask the server whether the case is "ordinary"
 *  before rendering: `can_record('access', 'case', id)` answers false for a
 *  case the viewer merely lacks membership in AND for a sealed / SIB /
 *  compartmented one, so any probe that distinguished them would itself be
 *  an existence oracle. The panel therefore appears for every unreadable id;
 *  a request against a SIB / sealed / compartmented case simply fails
 *  server-side (RLS on the insert), which is the same answer a wrong id gets.
 *  Copy stays neutral for the same reason: "…or it doesn't exist".
 *
 *  The request row is `case_access_requests` (requester_id defaults to
 *  auth.uid(); the officer can read their own rows — car_sel), and command
 *  is notified the way the M.O. detector's locked cards already do it. */
import { useCallback, useEffect, useState } from 'react'
import { insert, list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { activeProfiles } from '@/lib/profiles'
import { isCommandRole } from '@/lib/permissions'
import { humanizeError } from '@/lib/toast'
import { LockIcon } from '@/components/shell/icons'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'

type Phase = 'checking' | 'idle' | 'sending' | 'pending' | 'sent'

export function AccessRequestPanel({ caseId }: { caseId: string }) {
  const { profile } = useAuth()
  const [phase, setPhase] = useState<Phase>('checking')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Existing pending request → say so instead of offering a duplicate.
  const check = useCallback(async () => {
    if (!profile) { setPhase('idle'); return }
    try {
      const rows = await list('case_access_requests', {
        select: 'id,status', eq: { case_id: caseId, requester_id: profile.id }, order: 'created_at', ascending: false, limit: 1,
      })
      setPhase(rows[0]?.status === 'pending' ? 'pending' : 'idle')
    } catch {
      setPhase('idle')
    }
  }, [caseId, profile])
  useEffect(() => { queueMicrotask(() => { void check() }) }, [check])

  const send = async () => {
    if (!profile) return
    setPhase('sending'); setError(null)
    const clean = reason.trim()
    const res = await insert('case_access_requests', { case_id: caseId, requester_name: profile.display_name, reason: clean || null })
    if (res.error) { setError(humanizeError(res.error.message)); setPhase('idle'); return }
    // Deciders are command roles — the case lead is RLS-hidden from us here.
    // No case number in the payload: we do not have one and must not guess.
    const deciders = activeProfiles().filter((p) => isCommandRole(p.role) && p.id !== profile.id)
    for (const d of deciders) {
      await notify(d.id, 'access_requested', {
        case_id: caseId, detective: profile.display_name,
        reason: clean ? `Access requested: ${clean}` : 'Requested access to this case.',
      })
    }
    setPhase('sent')
  }

  return (
    <section aria-labelledby="case-access-title" className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-ink-900/60 p-6">
      <div className="mb-3 flex items-center gap-2 text-slate-300">
        <LockIcon size={18} className="flex-shrink-0" />
        <h2 id="case-access-title" className="text-sm font-semibold text-white">Restricted case</h2>
      </div>
      <p className="text-sm text-slate-300">
        You don&apos;t have access to this case, or it doesn&apos;t exist.
        {phase !== 'pending' && phase !== 'sent' && ' Ask for access:'}
      </p>
      {phase === 'checking' ? (
        <p className="mt-3 text-xs text-slate-400">Checking for an existing request…</p>
      ) : phase === 'pending' ? (
        <p role="status" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Your access request is pending — command will decide and you&apos;ll be notified.
        </p>
      ) : phase === 'sent' ? (
        <p role="status" className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Request sent. You&apos;ll be notified when command decides.
        </p>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void send() }}>
          <Field label="Reason" hint="Optional — why you need this case.">
            {(id) => (
              <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why you need access" disabled={phase === 'sending'} />
            )}
          </Field>
          {error && <p role="alert" className="text-xs font-semibold text-rose-300">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={phase === 'sending'} disabled={!profile}>
              Request access
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
