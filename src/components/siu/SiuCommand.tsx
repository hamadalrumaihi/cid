'use client'

/** §35/§36/§53 — two dashboards, because there are two audiences with
 *  genuinely different entitlements.
 *
 *  SiuCommandSection is for RUNNING the unit. It names people, because you
 *  cannot manage workload without names. Every count behind it is computed
 *  under the caller's own `siu_case_access()`, so a compartmented investigation
 *  the caller is not in contributes nothing to anyone's total — a workload
 *  number is an existence oracle otherwise.
 *
 *  SiuOversightSupplement is for SUPERVISING the unit. Counts only: no case,
 *  no title, no name, no label, at any volume. Oversight sees the unit's shape,
 *  never its contents. Both are gated server-side; this file only decides what
 *  to draw. */

import { useCallback, useEffect, useState } from 'react'
import { withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  fetchSiuCommandDashboard, fetchSiuIntelQuality, fetchSiuOversightSupplement,
  siuCaseCategoryLabel, siuClassificationLabel, siuClosureReasonLabel, siuRoleLabel,
  siuStageLabel, type SiuCommandDashboard, type SiuIntelQuality,
  type SiuOversightSupplement,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { MetricStrip } from '@/components/ui/MetricStrip'
import { SectionHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function SiuCommandSection() {
  const siu = useSiu()
  const [data, setData] = useState<SiuCommandDashboard | null>(null)
  const [intel, setIntel] = useState<SiuIntelQuality | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [d, q] = await Promise.all([
        withRetry(() => fetchSiuCommandDashboard()),
        withRetry(() => fetchSiuIntelQuality()),
      ])
      setData(d); setIntel(q)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'danger')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  if (loading) return <CardGridSkeleton cols="" />

  // The server already answered `access: false`. Render the ordinary
  // nothing-here surface rather than a locked panel.
  if (!data?.access) {
    return (
      <Card>
        <SectionHeader
          title="Command"
          subtitle="Unit management is an X-Ray 1 function."
        />
      </Card>
    )
  }

  const q = data.queues
  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="Unit queues"
          subtitle="What is waiting on somebody. Counts reflect only what you can see — a compartment you are not in contributes nothing."
        />
        <div className="mt-3">
          <MetricStrip
            metrics={[
              { label: 'Referrals awaiting review', value: q?.referrals_awaiting ?? 0 },
              { label: 'Open inquiries', value: q?.inquiries_open ?? 0 },
              { label: 'Standing conflicts', value: q?.conflicts_standing ?? 0 },
              { label: 'Watch entries live', value: q?.watch_active ?? 0 },
              { label: 'Watches expiring (14d)', value: q?.watch_expiring_14d ?? 0 },
              { label: 'Supporting access live', value: q?.temp_access_live ?? 0 },
            ]}
          />
        </div>
        {!!intel?.access && (
          <div className="mt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Intelligence quality
            </p>
            <MetricStrip
              metrics={[
                { label: 'Notes', value: intel.notes ?? 0 },
                { label: 'Ungraded', value: intel.ungraded ?? 0 },
                { label: 'Review overdue', value: intel.review_overdue ?? 0 },
                { label: 'Review due (30d)', value: intel.review_due_30d ?? 0 },
                { label: 'Untested source', value: intel.untested_source ?? 0 },
                { label: 'Withdrawn', value: intel.withdrawn ?? 0 },
              ]}
            />
            {!!intel.ungraded && (
              <p className="mt-2 text-[11px] text-amber-300/80">
                {intel.ungraded} note{intel.ungraded === 1 ? '' : 's'} carr
                {intel.ungraded === 1 ? 'ies' : 'y'} no grading at all. Ungraded is not
                the same as trustworthy.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Workload"
          subtitle="Per agent. A recused agent still appears — knowing somebody is walled out of two investigations is part of managing the unit."
        />
        {!data.workload?.length ? (
          <p className="mt-3 text-xs text-slate-400">No appointed field agents.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Agent</th>
                  <th className="pb-2 pr-3 font-medium">Open</th>
                  <th className="pb-2 pr-3 font-medium">Leading</th>
                  <th className="pb-2 pr-3 font-medium">Inquiries</th>
                  <th className="pb-2 pr-3 font-medium">Overdue reviews</th>
                  <th className="pb-2 font-medium">Recused from</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {data.workload.map((w) => (
                  <tr key={w.user_id} className="border-t border-white/5">
                    <td className="py-2 pr-3">
                      <span className="text-slate-100">{w.display_name ?? 'Unknown'}</span>
                      <span className="ml-2 text-[10px] text-slate-500">
                        {w.callsign ? `${w.callsign} · ` : ''}{siuRoleLabel(w.siu_role)}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{w.open_cases}</td>
                    <td className="py-2 pr-3">{w.leads}</td>
                    <td className="py-2 pr-3">{w.inquiries}</td>
                    <td className="py-2 pr-3">
                      {w.overdue_reviews > 0
                        ? <span className="text-amber-300">{w.overdue_reviews}</span>
                        : w.overdue_reviews}
                    </td>
                    <td className="py-2">
                      {w.recused_from > 0
                        ? <span className="text-slate-400">{w.recused_from}</span>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Aging investigations"
          subtitle="Open more than 60 days. Age is not a failure — an unexamined age is."
        />
        {!data.aging?.length ? (
          <p className="mt-3 text-xs text-slate-400">Nothing has been open more than 60 days.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.aging.map((c) => (
              <li key={c.case_id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-100">{c.case_number}</span>
                  <span className="text-xs text-slate-400">{c.title ?? 'Untitled'}</span>
                  {c.stage === 'preliminary_inquiry' && (
                    <Badge tint="bg-amber-500/15 text-amber-300">{siuStageLabel(c.stage)}</Badge>
                  )}
                  <Badge tone="neutral">{siuClassificationLabel(c.classification)}</Badge>
                  {c.category && <Badge tone="neutral">{siuCaseCategoryLabel(c.category)}</Badge>}
                  <span className="ml-auto text-[11px] text-slate-500">
                    {c.days_open} days · {c.agents} agent{c.agents === 1 ? '' : 's'} · opened {fmtDate(c.opened_at)}
                  </span>
                </div>
                {c.stage === 'preliminary_inquiry' && c.days_open > 90 && (
                  <p className="mt-1.5 text-[11px] text-amber-300/80">
                    An inquiry this old is a decision nobody has made. Promote it or close it —
                    while it sits, oversight cannot see it at all.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {siu.isCommand && <SiuOversightSupplementCard />}
    </div>
  )
}

/** §53. Safe for any SIU standing: every field is a count. Rendered both on
 *  the command dashboard and — the point of §53 — inside the Oversight section,
 *  which is the only SIU surface an oversight holder can reach. */
export function SiuOversightSupplementCard() {
  const [data, setData] = useState<SiuOversightSupplement | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { setData(await withRetry(() => fetchSiuOversightSupplement())) }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger') }
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

  if (loading) return <CardGridSkeleton cols="" />
  if (!data?.access) return null

  const byReason = Object.entries(data.closed_by_reason ?? {})
  const byCategory = Object.entries(data.open_by_category ?? {})

  return (
    <Card>
      <SectionHeader
        title="Intake, disposition and access"
        subtitle="Counts only. No investigation, subject or agent can be identified from anything on this card."
      />
      <div className="mt-3">
        <MetricStrip
          metrics={[
            { label: 'Referrals received', value: data.referrals_total ?? 0 },
            { label: 'Awaiting review', value: data.referrals_awaiting ?? 0 },
            { label: 'Accepted', value: data.referrals_accepted ?? 0 },
            { label: 'Declined', value: data.referrals_declined ?? 0 },
            { label: 'Open inquiries', value: data.inquiries_open ?? 0 },
            { label: 'Conflicts standing', value: data.conflicts_standing ?? 0 },
          ]}
        />
      </div>
      <div className="mt-3">
        <MetricStrip
          metrics={[
            { label: 'Intelligence ungraded', value: data.intel_ungraded ?? 0 },
            { label: 'Reviews overdue', value: data.intel_review_overdue ?? 0 },
            { label: 'Watch entries live', value: data.watch_active ?? 0 },
            { label: 'Supporting access live', value: data.temp_access_live ?? 0 },
            { label: 'Supporting grants (total)', value: data.temp_access_granted_total ?? 0 },
            { label: 'Conflicts declared', value: data.conflicts_declared ?? 0 },
          ]}
        />
      </div>

      {!!byCategory.length && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Open caseload by category
          </p>
          <div className="flex flex-wrap gap-2">
            {byCategory.map(([k, v]) => (
              <Badge key={k} tone="neutral">{siuCaseCategoryLabel(k)}: {v}</Badge>
            ))}
          </div>
        </div>
      )}

      {!!byReason.length && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Closed by reason
          </p>
          <div className="flex flex-wrap gap-2">
            {byReason.map(([k, v]) => (
              <Badge key={k} tone="neutral">{siuClosureReasonLabel(k)}: {v}</Badge>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            The presence of <em>Unfounded</em> and <em>Insufficient evidence</em> here is the point.
            A unit that never records those is not recording honestly.
          </p>
        </div>
      )}
    </Card>
  )
}
