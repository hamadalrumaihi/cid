'use client'

/** Field Intelligence → Submitter access.
 *
 *  This is a ROSTER, not a queue. Access is immediate and needs no approval,
 *  because the access grants nothing except the ability to write a report
 *  addressed to CID — but "nobody approves it" is not the same as "nobody
 *  records it". Investigators still need to answer "who is allowed to submit,
 *  and who are they?", and this is where that is answered: the identity they
 *  gave, when the access was created, whether it still stands, and how much
 *  they have actually sent.
 *
 *  Nobody on this page is waiting for anything, and the wording is deliberate
 *  about that. The only queue-shaped thing left is the legacy request list,
 *  which appears only while genuinely undecided rows from before self-service
 *  still exist.
 *
 *  ── Who may do what ────────────────────────────────────────────────────────
 *  Any active investigator can read the roster (`field_access_roster()` checks
 *  `private.is_active()`); the sign-in email and last-seen time come back null
 *  for anybody who is not command, exactly as member emails have always worked.
 *  Revoking access is command-only in the RPC. Permanent account deletion is
 *  the Owner's alone and uses the same armed protocol as everywhere else —
 *  there is one deletion system, not one per screen.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import {
  ROSTER_STATUS_LABEL, ROSTER_STATUS_TONE, loadFieldRoster, rosterIdentity,
  rosterMatches, rosterOrigin, rosterStatus, type FieldRosterRow,
} from '@/lib/fieldAccess'
import { endFieldOfficer } from '@/lib/fieldOfficers'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Notice'
import { uiPrompt } from '@/components/ui/dialog'
import { PermanentDelete } from '@/components/owner/PermanentDelete'

export function useFieldRoster(): { rows: FieldRosterRow[] | null; refresh: () => Promise<void> } {
  const [rows, setRows] = useState<FieldRosterRow[] | null>(null)
  const v = useTableVersion('field_officers')
  const refresh = useCallback(async () => {
    setRows(await loadFieldRoster().catch(() => []))
  }, [])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, v])
  return { rows, refresh }
}

export function FieldAccessRoster({ rows, onChanged }: {
  rows: FieldRosterRow[] | null
  onChanged: () => void
}) {
  const { isCommand, isOwner } = useAuth()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const revoke = async (r: FieldRosterRow) => {
    const reason = await uiPrompt(
      `${r.display_name} loses the Field Intelligence portal. Everything they have `
      + 'already sent stays exactly as it is, still attributed to them.',
      { title: 'Revoke submitter access', placeholder: 'Reason (recorded in the audit log)', confirmText: 'Revoke' },
    )
    if (!reason?.trim()) return
    setBusy(r.user_id)
    const err = await endFieldOfficer(r.user_id, reason)
    setBusy(null)
    if (err) { toast(err, 'danger'); return }
    toast('Access revoked. Their submissions are untouched.', 'success')
    onChanged()
  }

  const shown = (rows ?? []).filter((r) => rosterMatches(r, q))

  return (
    <Card pad="none" className="overflow-hidden">
      <div className="border-b border-white/5 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-white">
              Submitter access
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              SAHP, BCSO and LSPD accounts that can send intelligence to CID. Access is
              immediate and needs no approval &mdash; this is the record of who has it,
              not a list of people waiting.
            </p>
          </div>
          <Input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Name, callsign, agency…" className="w-48 text-xs" />
        </div>
      </div>

      {rows === null ? (
        <p className="px-5 py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : !shown.length ? (
        <EmptyState
          title={q ? 'Nobody matches that' : 'No submitters yet'}
          hint={q ? 'Try a callsign or an agency.'
            : 'Officers create their own access from the sign-in screen. They appear here the moment they do.'}
          className="m-4"
        />
      ) : (
        <ul className="divide-y divide-white/5">
          {shown.map((r) => {
            const status = rosterStatus(r)
            return (
              <li key={r.user_id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-white">
                    {r.display_name}{' '}
                    <span className="text-xs font-normal text-slate-500">{rosterIdentity(r)}</span>
                  </p>
                  <Badge tone={ROSTER_STATUS_TONE[status]}>{ROSTER_STATUS_LABEL[status]}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {rosterOrigin(r)}
                  {!r.self_served && r.appointed_by &&
                    ` — ${officerName(r.appointed_by) ?? 'command'}`}
                  {` · access since ${fmtDateTime(r.appointed_at)}`}
                  {r.first_seen && ` · first signed in ${fmtDateTime(r.first_seen)}`}
                  {/* Command-only, and null for everybody else by the RPC. */}
                  {r.last_seen && ` · last seen ${timeAgo(r.last_seen)}`}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {r.submissions === 0 ? 'No reports sent yet'
                    : `${r.submissions} report${r.submissions === 1 ? '' : 's'}`}
                  {r.last_submission_at && ` · last ${timeAgo(r.last_submission_at)}`}
                  {r.email && ` · ${r.email}`}
                </p>
                {r.ended_at && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    Access ended {fmtDateTime(r.ended_at)}
                    {r.end_reason && ` — “${r.end_reason}”`}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {isCommand && r.standing_active && (
                    <Button size="sm" variant="ghost" disabled={busy === r.user_id}
                      onClick={() => void revoke(r)}>
                      Revoke access
                    </Button>
                  )}
                  {/* The Owner's control, and only the Owner's. The RPC refuses
                      everybody else regardless of what renders here. */}
                  {isOwner && (
                    <PermanentDelete
                      key={r.user_id}
                      targetId={r.user_id}
                      targetName={r.display_name}
                      onDeleted={onChanged}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
