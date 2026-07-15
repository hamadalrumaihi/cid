'use client'

/** Permanent deletion — the most dangerous control in the app (Phase B).
 *
 *  Deactivate / soft-remove (Command Center) remains the DEFAULT way to part
 *  with a member: it keeps history intact and is reversible. This panel is the
 *  exception path: it erases a member's account and auth identity forever,
 *  repointing their historical references to the shared 'Deleted Member'
 *  tombstone and recording everything in an owner-only ledger.
 *
 *  The UI is a thin shell over three SECURITY DEFINER RPCs
 *  (permanent_delete_preview / _arm / _execute) — every rule (owner-only,
 *  fresh-session, reason, blockers, 5-minute single-use token, typed
 *  confirmation) is enforced server-side; this screen only sequences the
 *  steps and surfaces the server's errors VERBATIM (they are written to be
 *  human). See docs/AUTHORIZATION.md §4 and migration
 *  supabase/migrations/20260726010000_phase_b_permanent_deletion.sql. */
import { useEffect, useMemo, useState } from 'react'
import type { Json } from '@/lib/database.types'
import { rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/PageHeader'
import { inputCls, labelCls } from '@/components/ui/Field'

interface PreviewTarget {
  id: string
  display_name: string
  badge_number: string | null
  role: string
  division: string
  active: boolean
  removed_at: string | null
  is_test: boolean
  is_system: boolean
}

interface DeletePreview {
  blockers: Record<string, number>
  active_work: Record<string, number>
  repoint: Record<string, number>
  cascade: Record<string, number>
  deleted: Record<string, number>
  set_null: Record<string, number>
  blocker_total: number
  target: PreviewTarget
  eligible: boolean
  ineligible_reasons: string[]
}

interface ArmedToken {
  token: string
  expires_at: string
  display_name: string
}

const FRESHNESS_RE = /fresh sign-in/i

const nowMs = (): number => Date.now()

/** Per-table.column count list. Blockers render highlighted (rose). */
function CountList({ counts, tone }: { counts: Record<string, number>; tone: 'blocker' | 'info' }) {
  const entries = Object.entries(counts)
  if (!entries.length) return <p className="text-sm text-emerald-300">none</p>
  return (
    <ul className="space-y-0.5">
      {entries.sort(([a], [b]) => a.localeCompare(b)).map(([ref, n]) => (
        <li key={ref} className={`font-mono text-xs ${tone === 'blocker' ? 'text-rose-300' : 'text-slate-300'}`}>
          {ref} <b className={tone === 'blocker' ? 'text-rose-200' : 'text-white'}>{n}</b>
        </li>
      ))}
    </ul>
  )
}

function PreviewBucket({ title, sub, counts, tone }: {
  title: string
  sub: string
  counts: Record<string, number>
  tone: 'blocker' | 'info'
}) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'blocker' ? 'border-rose-500/25 bg-rose-500/5' : 'border-white/10 bg-ink-950/50'}`}>
      <p className={`text-xs font-black uppercase tracking-wider ${tone === 'blocker' ? 'text-rose-300' : 'text-slate-400'}`}>{title}</p>
      <p className="mb-2 mt-0.5 text-xs text-slate-400">{sub}</p>
      <CountList counts={counts} tone={tone} />
    </div>
  )
}

/** Server errors verbatim + the sign-out/in hint on freshness failures. */
function ServerError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3">
      <p className="text-sm text-rose-200">{message}</p>
      {FRESHNESS_RE.test(message) && (
        <p className="mt-1 text-xs text-rose-300/80">
          Your session is older than 5 minutes. Sign out, sign back in, and retry — arming and
          executing both require a fresh sign-in, by design.
        </p>
      )}
    </div>
  )
}

export function PermanentDeletionSection() {
  const { profile } = useAuth()
  const roster = useProfilesStore((s) => s.profiles)
  const [targetId, setTargetId] = useState('')
  const [preview, setPreview] = useState<DeletePreview | null>(null)
  const [reason, setReason] = useState('')
  const [armed, setArmed] = useState<ArmedToken | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [nowTs, setNowTs] = useState(nowMs)

  useEffect(() => { void useProfilesStore.getState().fetch() }, [])

  // Token-expiry countdown — ticks only while armed.
  useEffect(() => {
    if (!armed) return
    const t = window.setInterval(() => setNowTs(nowMs()), 1000)
    return () => window.clearInterval(t)
  }, [armed])

  const candidates = useMemo(() =>
    roster
      .filter((p) => p.id !== profile?.id && !p.is_system)
      .slice()
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')),
  [roster, profile?.id])

  const secondsLeft = armed ? Math.max(0, Math.floor((Date.parse(armed.expires_at) - nowTs) / 1000)) : 0
  const expectedConfirm = armed ? `DELETE ${armed.display_name}` : ''
  const confirmOk = !!armed && confirmText === expectedConfirm

  const reset = (keepResult = false) => {
    setPreview(null); setArmed(null); setConfirmText(''); setReason(''); setError(null)
    if (!keepResult) setResult(null)
  }

  const doPreview = async () => {
    setError(null); setResult(null); setArmed(null); setConfirmText('')
    const res = await rpc('permanent_delete_preview', { p_target: targetId })
    if (res.error) { setPreview(null); setError(res.error.message); return }
    setPreview(res.data as unknown as DeletePreview)
  }

  const doArm = async () => {
    setError(null); setResult(null)
    const res = await rpc('permanent_delete_arm', { p_target: targetId, p_reason: reason })
    if (res.error) { setError(res.error.message); return }
    setArmed(res.data as unknown as ArmedToken)
    setConfirmText('')
  }

  const doExecute = async () => {
    if (!armed) return
    setError(null)
    const res = await rpc('permanent_delete_execute', { p_token: armed.token, p_confirm: confirmText })
    if (res.error) { setError(res.error.message); return }
    const summary = res.data as unknown as { display_name: string; ledger_id: string; references: Json }
    setResult(`${summary.display_name} was permanently deleted. Ledger entry ${summary.ledger_id} records the identity snapshot and every repointed reference.`)
    toast('Member permanently deleted — ledger entry written.', 'success')
    setTargetId('')
    reset(true)
    void useProfilesStore.getState().fetch()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-4">
        <p className="text-sm font-bold text-rose-200">This is irreversible.</p>
        <p className="mt-1 text-sm text-rose-200/80">
          Deactivating or removing a member (Command Center) remains the default and keeps history
          intact. Permanent deletion erases the account and its sign-in identity forever; historical
          references are repointed to the shared &ldquo;Deleted Member&rdquo; record and an owner-only ledger
          entry preserves the identity snapshot, the reason, and the member&rsquo;s role history. Members
          referenced by immutable records (legal requests, sign-off history, sealed reports, custody,
          tracker signatures, justice identity) can never be permanently deleted.
        </p>
      </div>

      <Card pad="md">
        <SectionHeader
          title="1 · Choose a member and preview"
          subtitle="The preview is read-only: it counts every reference the member holds — blockers first."
        />
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <label htmlFor="pd-target" className={labelCls}>Member</label>
            <select
              id="pd-target"
              value={targetId}
              onChange={(e) => { setTargetId(e.target.value); reset() }}
              className={inputCls}
            >
              <option value="">— select a member —</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} · {p.role}/{p.division}
                  {p.removed_at ? ' · removed' : p.active ? '' : ' · inactive'}
                </option>
              ))}
            </select>
          </div>
          <Button disabled={!targetId} onAction={doPreview}>Preview references</Button>
        </div>

        {preview && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-300">
              <b className="text-white">{preview.target.display_name}</b>{' '}
              ({preview.target.role}/{preview.target.division},{' '}
              {preview.target.removed_at ? 'removed' : preview.target.active ? 'active' : 'inactive'}) —{' '}
              {preview.eligible
                ? <span className="text-emerald-300">eligible for permanent deletion</span>
                : <span className="font-semibold text-rose-300">NOT eligible: {preview.ineligible_reasons.join('; ')}</span>}
            </p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <PreviewBucket
                title="Hard blockers" tone="blocker"
                sub="Immutable records — these can never be cleared; the member must be kept (deactivated)."
                counts={preview.blockers}
              />
              <PreviewBucket
                title="Active-work blockers" tone="blocker"
                sub="Live pointers (case/gang leadership, pending sign-off) — reassign these first."
                counts={preview.active_work}
              />
              <PreviewBucket
                title="Repointed to 'Deleted Member'" tone="info"
                sub="Historical provenance columns rewritten to the tombstone on execute."
                counts={preview.repoint}
              />
              <PreviewBucket
                title="Deleted with the account" tone="info"
                sub="CASCADE rows (assignments, notifications, watchlist, role history — snapshotted into the ledger) plus the member's own justice request."
                counts={{ ...preview.cascade, ...preview.deleted, ...preview.set_null }}
              />
            </div>
          </div>
        )}
      </Card>

      <Card pad="md">
        <SectionHeader
          title="2 · Arm (5-minute window)"
          subtitle="Owner-only, fresh sign-in required, reason recorded in the audit log before anything is deleted."
        />
        <div className="mt-3 space-y-2">
          <div>
            <label htmlFor="pd-reason" className={labelCls}>Reason (required — lands in the audit log and the ledger)</label>
            <textarea
              id="pd-reason" rows={2} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this member must be erased rather than deactivated…"
              className={inputCls}
            />
          </div>
          <Button
            variant="danger"
            disabled={!targetId || !preview || !preview.eligible || !reason.trim()}
            onAction={doArm}
          >
            Arm permanent deletion
          </Button>
          {armed && secondsLeft > 0 && (
            <p className="text-sm text-amber-300">
              Armed for <b className="font-mono">{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</b> —
              the token is single-use and expires after 5 minutes.
            </p>
          )}
          {armed && secondsLeft === 0 && (
            <p className="text-sm text-rose-300">The deletion token expired — arm again.</p>
          )}
        </div>
      </Card>

      <Card pad="md">
        <SectionHeader
          title="3 · Confirm and execute"
          subtitle="Type the confirmation phrase exactly. The server validates it again, re-checks blockers, writes the ledger, then deletes."
        />
        <div className="mt-3 space-y-2">
          <div>
            <label htmlFor="pd-confirm" className={labelCls}>
              {armed ? <>Type <span className="font-mono text-rose-300">{expectedConfirm}</span> to confirm</> : 'Arm first — the confirmation phrase includes the member’s exact display name'}
            </label>
            <input
              id="pd-confirm" type="text" value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={!armed || secondsLeft === 0}
              autoComplete="off" spellCheck={false}
              placeholder={armed ? expectedConfirm : ''}
              className={inputCls}
            />
          </div>
          <Button variant="danger" disabled={!confirmOk || secondsLeft === 0} onAction={doExecute}>
            Permanently delete this member
          </Button>
        </div>
      </Card>

      {error && <ServerError message={error} />}
      {result && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
          <p className="text-sm text-emerald-200">{result}</p>
        </div>
      )}
    </div>
  )
}
