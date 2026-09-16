'use client'

/** Undercover Operations — `/undercover`.
 *
 *  The workflow half of the CID Undercover Operations Procedure. The policy
 *  itself is a Guide Library document (`/guides/undercover-procedure`); this
 *  screen is where the duties it creates actually get discharged.
 *
 *  ── What this screen is NOT ───────────────────────────────────────────────
 *  It is not an authorization gate. The procedure does not require a Detective
 *  to seek permission before operating undercover (§2 lists conditions, not
 *  approvals), so nothing here approves, refuses or blocks an operation. It
 *  records one, and it shows what the procedure still asks of the Detective.
 *  Inventing an approval step would be inventing policy.
 *
 *  ── Who sees what ────────────────────────────────────────────────────────
 *  One route, two lanes, and the difference is RLS rather than routing:
 *
 *   · MINE — the operations the signed-in member is running. Every active CID
 *     member has this lane, because §2 lets any Detective enter an undercover
 *     capacity on an authorized case.
 *   · OVERSIGHT — §8. Rendered only for CID Command (Deputy Director,
 *     Director, Owner). A Bureau Lead READS their bureau's operations in the
 *     same list, because §4 authorizes disclosure to them, but §8 gives the
 *     command actions to Command.
 *
 *  A detective cannot see a colleague's operation through this page for the
 *  same reason they cannot see it through the API: `uc_operations_sel` does
 *  not return the row. The lane split below is presentation. */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { list } from '@/lib/db'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { bureauShort } from '@/lib/roles'
import { useNow } from '@/lib/useNow'
import {
  retentionInfo, ucOutstandingCount, ucRecordingLabel, ucReviewLabel, ucStatusLabel,
  type UcOperation,
} from '@/lib/undercover'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { GuideHelpLink } from '@/components/guides/GuideHelpLink'
import { NewOperationForm } from './NewOperationForm'
import { OperationDetail } from './OperationDetail'

/** The command lane is Deputy Director / Director / Owner — the procedure's
 *  "CID Command". Cosmetic: `private.uc_command()` decides every write, and
 *  `uc_command_act` refuses anyone else regardless of what this returns. */
function useIsUcCommand(): boolean {
  const { profile, isOwner } = useAuth()
  return !!isOwner || profile?.role === 'deputy_director' || profile?.role === 'director'
}

export function UndercoverView() {
  return (
    <Suspense fallback={<ListSkeleton count={4} />}>
      <UndercoverInner />
    </Suspense>
  )
}

function UndercoverInner() {
  const { state, profile } = useAuth()
  const isCommand = useIsUcCommand()
  const sp = useSearchParams()
  const router = useRouter()
  const version = useTableVersion('uc_operations')
  const fetchProfiles = useProfilesStore((s) => s.fetch)

  const [rows, setRows] = useState<UcOperation[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)

  const openId = sp.get('op')

  const load = useCallback(async () => {
    if (state !== 'in') return
    void fetchProfiles()
    try {
      // RLS decides the rows; this asks for everything it is allowed to see
      // and splits the answer into lanes client-side. There is no second,
      // wider query anywhere on this screen.
      const data = await list('uc_operations', { order: 'created_at', ascending: false })
      setRows(data)
      setFailed(false)
    } catch {
      // A failed read is not an empty compartment. Saying "no operations"
      // after a network failure tells a detective their record is gone.
      setRows(null)
      setFailed(true)
    }
  }, [state, fetchProfiles])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, version])

  const mine = useMemo(() => (rows ?? []).filter((r) => r.detective_id === profile?.id), [rows, profile?.id])
  const others = useMemo(() => (rows ?? []).filter((r) => r.detective_id !== profile?.id), [rows, profile?.id])
  const open = useMemo(() => (rows ?? []).find((r) => r.id === openId) ?? null, [rows, openId])

  const setOpen = useCallback((id: string | null) => {
    const p = new URLSearchParams(sp.toString())
    if (id) p.set('op', id); else p.delete('op')
    const qs = p.toString()
    router.replace(qs ? `/undercover?${qs}` : '/undercover', { scroll: false })
  }, [sp, router])

  if (state !== 'in') return <Notice text="Sign in to continue." />

  if (open) {
    return (
      <OperationDetail
        op={open}
        isCommand={isCommand}
        isMine={open.detective_id === profile?.id}
        onBack={() => setOpen(null)}
        onChanged={() => { void load() }}
      />
    )
  }

  return (
    <section className="view-in space-y-5">
      <PageHeader
        title="Undercover Operations"
        subtitle="Record the operation, confirm the recording, and discharge the notifications the procedure requires."
        actions={
          <>
            <GuideHelpLink
              slug="undercover-procedure"
              label="Read the procedure"
              title="Open the CID Undercover Operations Procedure"
            />
            <Button variant="primary" onClick={() => setCreating(true)}>Log an operation</Button>
          </>
        }
      />

      {/* The classification, once, where a reader starts — the same line the
          procedure page carries. */}
      <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100" role="note">
        <span className="font-semibold uppercase tracking-wide">CID Restricted — CID access only.</span>{' '}
        <span className="text-amber-200/90">
          An operation is visible to the Detective running it, their Bureau Lead, CID Command and High Command. Nobody else.
        </span>
      </p>

      {creating && (
        <NewOperationForm
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void load(); setOpen(id) }}
        />
      )}

      <OperationList
        title="Your operations"
        hint="Operations you are running. §2: an undercover capacity exists only in service of an authorized CID case."
        rows={mine}
        loading={rows === null && !failed}
        failed={failed}
        onRetry={() => { void load() }}
        onOpen={setOpen}
        emptyText="You have no undercover operations recorded."
      />

      {/* §4 authorizes a Bureau Lead to know; §8 gives Command the actions.
          Both read the same RLS-filtered list, so this lane simply names what
          the viewer was already allowed to see. */}
      {others.length > 0 && (
        <OperationList
          title={isCommand ? 'Division oversight' : 'Your bureau'}
          hint={isCommand
            ? '§8 — every operation you may act on: request a recording, require termination, add restrictions, flag a review.'
            : '§4 — operations in your bureau. Command holds the oversight actions.'}
          rows={others}
          loading={false}
          failed={false}
          onRetry={() => { void load() }}
          onOpen={setOpen}
          emptyText="Nothing in your bureau."
          showDetective
        />
      )}
    </section>
  )
}

function OperationList({
  title, hint, rows, loading, failed, onRetry, onOpen, emptyText, showDetective,
}: {
  title: string
  hint: string
  rows: UcOperation[]
  loading: boolean
  failed: boolean
  onRetry: () => void
  onOpen: (id: string) => void
  emptyText: string
  showDetective?: boolean
}) {
  const now = useNow()
  return (
    <div>
      <h2 className="text-[13px] font-semibold text-white">{title}</h2>
      <p className="mb-2 mt-0.5 text-xs text-slate-400">{hint}</p>
      {loading ? (
        <ListSkeleton count={3} />
      ) : failed ? (
        <ErrorNotice
          message="Your undercover operations could not be read. This is a loading failure, not a change to your access — nothing has been removed."
          onRetry={onRetry}
        />
      ) : !rows.length ? (
        <EmptyState title={emptyText} />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const ret = retentionInfo(r, now)
            const owed = ucOutstandingCount(r)
            return (
              <li key={r.id}>
                <Card pad="sm" interactive>
                  <button
                    type="button"
                    onClick={() => onOpen(r.id)}
                    className="block w-full min-h-[44px] text-left sm:min-h-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.status === 'compromised' ? 'danger' : r.status === 'active' ? 'good' : 'neutral'}>
                        {ucStatusLabel(r.status)}
                      </Badge>
                      {showDetective && (
                        <span className="text-sm font-semibold text-white">
                          {officerName(r.detective_id) || 'Detective'}
                        </span>
                      )}
                      <Badge>{bureauShort(r.bureau)}</Badge>
                      {r.criminal_activity && (
                        <Badge tone="warn" title="Reported under §5. A notification duty, not a finding.">
                          Criminal activity reported
                        </Badge>
                      )}
                      {owed > 0 && (
                        <Badge tone="warn">{owed} outstanding</Badge>
                      )}
                      {r.command_review_status !== 'not_required' && (
                        <Badge tone="accent">{ucReviewLabel(r.command_review_status)}</Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-300">
                      {r.objective || <span className="text-slate-500">No objective recorded</span>}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {ucRecordingLabel(r.recording_status)}
                      {r.started_at ? ` · started ${fmtDate(r.started_at)}` : ''}
                      {ret.state === 'holding' && ret.until
                        ? ` · retain until ${fmtDateTime(ret.until)} (${ret.hoursLeft}h)`
                        : ''}
                      {ret.state === 'elapsed' ? ' · 72-hour minimum met' : ''}
                    </p>
                  </button>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
