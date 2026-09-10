'use client'

/** Confidential intelligence released to this case (CI contract §2
 *  `case_intel_releases`, §6.4) — the VISIBLE, sanitized record.
 *
 *  Rendered for ordinary case readers with no CI standing at all. What they
 *  see is the released title / text / handling and nothing else: the table
 *  carries no ci or intel column, so there is no query that would name the
 *  source. An empty result renders nothing (the ReleasedIntelligence idiom):
 *  a case with no releases must look exactly like a case that has never been
 *  near the compartment — no heading, no count, no hint.
 *
 *  Full CI access additionally sees revoked rows (greyed, RLS returns them to
 *  nobody else) and a Revoke action (`ci_release_revoke`). */
import { useCallback, useEffect, useState } from 'react'
import { CI_HANDLING_LABEL, ciInvolved, ciRefused, ciReleaseRevoke, useCiContext } from '@/lib/ci'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { fmtDateTime } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiPrompt } from '@/components/ui/dialog'
import { SectionHeader } from '@/components/ui/PageHeader'

type ReleaseRow = Tables<'case_intel_releases'>

const handlingLabel = (h: string): string => (CI_HANDLING_LABEL as Record<string, string>)[h] ?? h

export function CaseReleasedIntel({ caseId }: { caseId: string }) {
  const { ctx } = useCiContext()
  const fullAccess = ciInvolved(ctx) && ctx.full_access
  const [rows, setRows] = useState<ReleaseRow[]>([])
  const [loaded, setLoaded] = useState(false)
  // ci_events is the compartment's published shadow table: it moves for an
  // involved viewer on a release / revoke; everyone else simply loads on mount.
  const v = useTableVersion('ci_events')

  const load = useCallback(async () => {
    // Fail-open to empty: a denied or failed read and "nothing released" are
    // the same picture here.
    const data = await list('case_intel_releases', { eq: { case_id: caseId }, order: 'released_at', ascending: false, limit: 100 })
      .catch(() => [] as ReleaseRow[])
    setRows(data)
    setLoaded(true)
  }, [caseId])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load, v])

  const revoke = async (r: ReleaseRow) => {
    const reason = await uiPrompt('Why is this release being withdrawn from the case?', {
      title: `Revoke "${r.title}"`, placeholder: 'Reason (required)', confirmText: 'Revoke release',
    })
    if (reason === null) return
    if (reason.trim().length < 3) { toast('Give a reason for the revocation.', 'warn'); return }
    const res = await ciReleaseRevoke(r.id, reason.trim())
    if (ciRefused(res)) return
    toast('Release revoked.', 'success')
    void load()
  }

  // Nothing released — render nothing. No placeholder, no "0 items".
  if (!loaded || !rows.length) return null

  return (
    <Card className="border-amber-500/20">
      <SectionHeader
        title="Confidential intelligence"
        subtitle="Sanitized intelligence released to this case. The released text is the complete record available here."
      />
      <ul className="mt-3 space-y-2">
        {rows.map((r) => {
          const revoked = !!r.revoked_at
          return (
            <li key={r.id} className={`rounded-lg border border-white/10 bg-white/[0.02] p-3 ${revoked ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-100">{r.title}</span>
                <Badge tone="warn">{handlingLabel(r.handling)}</Badge>
                {revoked && <Badge tone="danger">Revoked</Badge>}
                <span className="ml-auto text-[11px] text-slate-400">
                  Released {fmtDateTime(r.released_at)}{r.released_by && officerName(r.released_by) ? ` · ${officerName(r.released_by)}` : ''}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{r.body}</p>
              {revoked && (
                <p className="mt-2 text-xs text-slate-400">
                  Revoked {fmtDateTime(r.revoked_at)}{r.revoke_reason ? ` — ${r.revoke_reason}` : ''}
                </p>
              )}
              {fullAccess && !revoked && (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => void revoke(r)}>Revoke</Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
