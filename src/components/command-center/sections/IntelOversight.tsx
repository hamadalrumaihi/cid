'use client'

/** Command Center → Intelligence Oversight. Consolidated command view of the
 *  intelligence pipeline: unclaimed field submissions, submissions in review,
 *  MDT exports awaiting a Lead+ approval, plus shortcuts to registry hygiene
 *  (duplicate persons) and the field-officer roster. All reads are bounded,
 *  CID-RLS-scoped projections — SIB material never appears here (no siu_*
 *  reads), and every action happens on its owning surface via links. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { timeAgo } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'

type SubmissionRow = Tables<'field_submissions'>
type MdtRow = Tables<'mdt_exports'>

/** Review-active lane (fieldReview's OPEN_STATUSES values). */
const FIELD_OPEN = ['new', 'reviewing', 'needs_info']
const FIELD_COLS = 'id,submission_no,summary,status,jurisdiction,assigned_to,submitted_at,created_at,updated_at'
const MDT_COLS = 'id,kind,subject_snapshot,status,risk_level,proposed_by,proposed_at,updated_at'
const ROW_CAP = 8

const KIND_LABEL: Record<string, string> = {
  person_bolo: 'BOLO', caution: 'Caution flag', arrest_warrant: 'Arrest warrant',
  person_record: 'Person record', vehicle_record: 'Vehicle record', account: 'Account',
}

export function IntelOversight({ onGo }: { onGo: (id: string) => void }) {
  const router = useRouter()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  // null until loaded — counts show '—', never a fabricated 0.
  const [subs, setSubs] = useState<SubmissionRow[] | null>(null)
  const [mdt, setMdt] = useState<MdtRow[] | null>(null)
  const vMdt = useTableVersion('mdt_exports')
  // field_submissions is not in the realtime publication; profiles bumps +
  // visibility catch-up still refresh the queue (same caveat as Action Center).
  const vProfiles = useTableVersion('profiles')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    const [s, m] = await Promise.all([
      // One bounded read serves both lanes (unassigned + in review).
      list('field_submissions', {
        select: FIELD_COLS, is: { deleted_at: null }, in: { status: FIELD_OPEN },
        order: 'created_at', ascending: false, limit: 100,
      }).catch(() => null),
      list('mdt_exports', {
        select: MDT_COLS, eq: { status: 'proposed' },
        order: 'proposed_at', ascending: false, limit: 50,
      }).catch(() => null),
    ])
    setSubs(s)
    setMdt(m)
  }, [fetchProfiles])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vMdt, vProfiles])

  const unassigned = useMemo(() => (subs ?? []).filter((s) => !s.assigned_to), [subs])
  const inReview = useMemo(() => (subs ?? []).filter((s) => !!s.assigned_to), [subs])

  const metrics: Metric[] = [
    { label: 'Unassigned intel', value: subs === null ? '—' : unassigned.length, hint: 'no reviewer has claimed', onClick: () => router.push('/field-review') },
    { label: 'In review', value: subs === null ? '—' : inReview.length, hint: 'claimed, still open', onClick: () => router.push('/field-review') },
    { label: 'MDT exports pending', value: mdt === null ? '—' : mdt.length, hint: 'proposed, need Lead+ approval', onClick: () => router.push('/tools?tool=bolo') },
  ]

  const subTitle = (s: SubmissionRow) => `${s.submission_no || 'Submission'} — ${s.summary || 'No summary'}`

  return (
    <div className="space-y-5">
      <MetricStrip metrics={metrics} />

      <DashPanel
        title="Unassigned field intelligence"
        count={unassigned.length}
        hint="Review-active submissions no reviewer has claimed — claim and triage them in Field Intelligence Review."
        action={{ label: 'Open review queue →', href: '/field-review' }}
        empty={unassigned.length === 0}
      >
        {unassigned.slice(0, ROW_CAP).map((s) => (
          <DashRow
            key={s.id}
            title={subTitle(s)}
            why={`Unclaimed · ${s.jurisdiction || 'jurisdiction unknown'}`}
            meta={timeAgo(s.submitted_at || s.created_at)}
            onClick={() => router.push('/field-review')}
          />
        ))}
      </DashPanel>

      <DashPanel
        title="MDT exports awaiting approval"
        count={mdt?.length ?? 0}
        hint="Proposed patrol-MDT pushes (BOLOs, caution flags) — a Lead+ approves or clears them on the BOLO board."
        action={{ label: 'Open BOLO board →', href: '/tools?tool=bolo' }}
        empty={!mdt?.length}
      >
        {(mdt ?? []).slice(0, ROW_CAP).map((m) => (
          <DashRow
            key={m.id}
            title={`${KIND_LABEL[m.kind] || m.kind} — ${m.subject_snapshot}`}
            why={`Proposed by ${officerName(m.proposed_by) || 'Officer'}${m.risk_level ? ` · ${m.risk_level} risk` : ''}`}
            meta={timeAgo(m.proposed_at)}
            onClick={() => router.push('/tools?tool=bolo')}
          />
        ))}
      </DashPanel>

      <Card pad="sm">
        <h3 className="text-sm font-bold text-white">Registry hygiene & rosters</h3>
        <p className="mt-1 text-xs text-slate-400">
          Duplicate person records are merged from the Persons registry; Field Intelligence
          officer appointments live in their own section.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => router.push('/tools?tool=persons')}>Review duplicate persons</Button>
          <Button size="sm" onClick={() => onGo('field')}>Field officer roster</Button>
        </div>
      </Card>
    </div>
  )
}
