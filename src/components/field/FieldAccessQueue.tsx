'use client'

/** Field Intelligence → Access requests.
 *
 *  A patrol officer who signs in now asks for a reporting channel from the gate
 *  itself, and this is where that ask lands. It lives inside the Field
 *  Intelligence workspace on purpose: processing a trooper's request is Field
 *  Intelligence business, and sending command off to the Command Center to do it
 *  is how a queue quietly stops being worked.
 *
 *  ── The panel decides nothing ──────────────────────────────────────────────
 *  Approving calls field_access_decide(), which re-checks private.is_command()
 *  and then routes through the SAME assign_field_officer() that the Command
 *  Center roster uses. So there is one way to become a field officer and one
 *  audit trail for it — this is a queue in front of that door, not a second
 *  door. A detective may READ the queue (they are the ones who notice a name
 *  they recognise); the decide buttons are command-only, and the RPC refuses
 *  anybody else regardless of what this file renders.
 *
 *  Declining requires a reason because the applicant reads it on their own
 *  sign-in screen. "No" with nothing after it is how somebody applies four more
 *  times.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import {
  FIELD_AGENCY_NAME, REQUEST_STATUS_LABEL, decideAccessRequest, loadAccessRequests,
  requestLabel, type FieldAccessRequestRow, type FieldAgency,
} from '@/lib/fieldAccess'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/Notice'
import { uiPrompt } from '@/components/ui/dialog'

/** Pending first, then newest — the queue is a to-do list, and a decided
 *  request is history. */
export function pendingFirst(rows: ReadonlyArray<FieldAccessRequestRow>): FieldAccessRequestRow[] {
  return [...rows].sort((a, b) => {
    const pa = a.status === 'pending' ? 0 : 1
    const pb = b.status === 'pending' ? 0 : 1
    if (pa !== pb) return pa - pb
    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })
}

export function countPending(rows: ReadonlyArray<FieldAccessRequestRow>): number {
  return rows.filter((r) => r.status === 'pending').length
}

export function useAccessRequests(): {
  rows: FieldAccessRequestRow[] | null
  refresh: () => Promise<void>
} {
  const [rows, setRows] = useState<FieldAccessRequestRow[] | null>(null)
  const v = useTableVersion('field_access_requests')
  const refresh = useCallback(async () => { setRows(await loadAccessRequests()) }, [])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, v])
  return { rows, refresh }
}

export function FieldAccessQueue({ rows, onChanged }: {
  rows: FieldAccessRequestRow[] | null
  onChanged: () => void
}) {
  const { isCommand } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => { void fetchProfiles() }, 0)
    return () => window.clearTimeout(t)
  }, [fetchProfiles])

  const nameOf = (id: string): string =>
    profiles.find((p) => p.id === id)?.display_name || 'Unknown account'

  const decide = async (r: FieldAccessRequestRow, approve: boolean) => {
    let reason: string | undefined
    if (!approve) {
      const said = await uiPrompt(
        `${nameOf(r.user_id)} reads this on their sign-in screen. Say why, so they know whether to ask again.`,
        {
          title: 'Decline this request',
          placeholder: 'e.g. Ask your watch commander to vouch for you first.',
          confirmText: 'Decline',
        },
      )
      if (!said?.trim()) return
      reason = said
    }
    setBusy(r.id)
    const err = await decideAccessRequest(r.id, approve, reason)
    setBusy(null)
    if (err) { toast(err, 'danger'); return }
    toast(
      approve
        ? 'Approved. They reach Field Intelligence on their next sign-in.'
        : 'Declined. They can read the reason you gave.',
      'success',
    )
    onChanged()
  }

  const shown = pendingFirst(rows ?? [])

  return (
    <Card pad="none" className="overflow-hidden">
      <div className="border-b border-white/5 px-5 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Access requests
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Officers asking for a way to send CID information. Approving gives the Field
          Intelligence portal and nothing else — no case files, no persons, no vehicles.
          {!isCommand && ' Command decides these; you are seeing the queue.'}
        </p>
      </div>
      {rows === null ? (
        <p className="px-5 py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : !shown.length ? (
        <EmptyState
          title="Nobody is waiting"
          hint="Officers ask from the sign-in screen. Requests appear here the moment they do."
          className="m-4"
        />
      ) : (
        <ul className="divide-y divide-white/5">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="font-medium text-white">
                  {nameOf(r.user_id)}{' '}
                  <span className="text-xs font-normal text-slate-500">{requestLabel(r)}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {FIELD_AGENCY_NAME[r.agency as FieldAgency] ?? r.agency}
                  {r.created_at && ` · asked ${timeAgo(r.created_at)}`}
                  {r.decided_at && ` · ${REQUEST_STATUS_LABEL[r.status] ?? r.status} ${fmtDateTime(r.decided_at)}`}
                </p>
                {r.decision_reason && (
                  <p className="mt-0.5 text-xs text-slate-400">“{r.decision_reason}”</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'good' : 'neutral'}>
                  {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                </Badge>
                {isCommand && r.status === 'pending' && (
                  <>
                    <Button size="sm" variant="ghost" disabled={busy === r.id}
                      onClick={() => void decide(r, false)}>
                      Decline
                    </Button>
                    <Button size="sm" variant="primary" disabled={busy === r.id}
                      onClick={() => void decide(r, true)}>
                      {busy === r.id ? 'Working…' : 'Approve'}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
