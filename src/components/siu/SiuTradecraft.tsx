'use client'

/** Phase 3 — the tradecraft surfaces.
 *
 *  Sources, undercover deployments, financial and communications intelligence,
 *  integrity reviews, the export log, and the aggregate oversight report.
 *
 *  Access here is TIGHTER than the investigation, and deliberately so. Every
 *  table rides `private.siu_case_access()` — the write wall — rather than the
 *  read superset, so oversight standing (the Director of CID, the Attorney
 *  General) reads the case file and none of this. Sources and legends are
 *  compartmented one step further, to the handler and SIU command, so an agent
 *  with full access to an investigation still cannot read another agent's
 *  source. None of that is enforced here: these lists simply come back empty,
 *  because RLS already decided. */

import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc, withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  SIU_EXPORT_SCOPES, fetchSiuExports, fetchSiuOversightReport,
  siuAllegationLabel, siuExportScopeLabel, siuReliabilityLabel,
  siuReviewStatusLabel, siuSourceStatusLabel, siuUndercoverStatusLabel,
  siuWithheldLabel, type SiuExportRow, type SiuOversightReport,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/PageHeader'
import { SectionTabs } from '@/components/ui/SectionTabs'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { MetricStrip } from '@/components/ui/MetricStrip'

type SourceRow = Tables<'siu_sources'>
type UcRow = Tables<'siu_undercover_operations'>
type FinRow = Tables<'siu_financial_intel'>
type CommsRow = Tables<'siu_comms_intel'>
type ReviewRow = Tables<'siu_integrity_reviews'>

type Lane = 'sources' | 'undercover' | 'financial' | 'comms' | 'integrity' | 'exports'

const LANES = [
  { id: 'sources' as const, label: 'Sources' },
  { id: 'undercover' as const, label: 'Undercover' },
  { id: 'financial' as const, label: 'Financial' },
  { id: 'comms' as const, label: 'Communications' },
  { id: 'integrity' as const, label: 'Integrity' },
  { id: 'exports' as const, label: 'Exports' },
]

const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtMoney = (v: number | null, ccy: string) =>
  v == null ? '—' : `${ccy} ${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`

const statusTint = (s: string) =>
  s === 'compromised' || s === 'burned' ? 'bg-rose-500/15 text-rose-300'
  : s === 'active' || s === 'authorized' ? 'bg-emerald-500/15 text-emerald-300'
  : s === 'substantiated' ? 'bg-rose-500/15 text-rose-300'
  : s === 'open' ? 'bg-amber-500/15 text-amber-300'
  : 'bg-white/5 text-slate-300'

/** A lane that came back empty is indistinguishable from a lane the viewer is
 *  not read into. That is the intended behavior everywhere in SIU, so the
 *  wording never speculates about which it is. */
function Empty({ what }: { what: string }) {
  return <p className="mt-3 text-xs text-slate-400">No {what} to show.</p>
}

export function SiuTradecraftSection() {
  const [lane, setLane] = useState<Lane>('sources')
  return (
    <div>
      <SectionTabs
        tabs={LANES}
        active={lane}
        onChange={setLane}
        idBase="siu-tradecraft"
        ariaLabel="SIU tradecraft"
        className="mb-4"
      />
      {lane === 'sources' && <SourcesLane />}
      {lane === 'undercover' && <UndercoverLane />}
      {lane === 'financial' && <FinancialLane />}
      {lane === 'comms' && <CommsLane />}
      {lane === 'integrity' && <IntegrityLane />}
      {lane === 'exports' && <ExportsLane />}
    </div>
  )
}

/** Shared loader for the RLS-scoped tables. Throwing surfaces as a toast; an
 *  empty result is never treated as an error. */
function useRows<T>(table: Parameters<typeof list>[0], order: string) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    void withRetry(() => list(table, { order: order as never, ascending: false, limit: 200 }))
      .then((r) => { if (live) setRows(r as unknown as T[]) })
      .catch((e) => { if (live) toast(e instanceof Error ? e.message : String(e), 'danger') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [table, order])
  return { rows, loading }
}

/* ----------------------------------------------------------------- sources */

function SourcesLane() {
  const { rows, loading } = useRows<SourceRow>('siu_sources', 'registered_at')
  if (loading) return <CardGridSkeleton cols="" />
  return (
    <Card>
      <SectionHeader
        title="Confidential sources"
        subtitle="Compartmented to the handler and SIU command — an agent working the same investigation does not see another agent's source. Identities never appear in an export."
      />
      {!rows.length ? <Empty what="sources" /> : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <span className="font-mono text-sm font-semibold tracking-wide text-violet-200">{r.codename}</span>
              <Badge tint={statusTint(r.status)}>{siuSourceStatusLabel(r.status)}</Badge>
              <Badge tone="neutral">{siuReliabilityLabel(r.reliability)}</Badge>
              {r.tasking && <span className="text-xs text-slate-400">{r.tasking}</span>}
              <span className="ml-auto text-[11px] text-slate-500">
                Registered {fmtDate(r.registered_at)}
                {r.last_contact_at ? ` · last contact ${fmtDate(r.last_contact_at)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------- undercover */

function UndercoverLane() {
  const { rows, loading } = useRows<UcRow>('siu_undercover_operations', 'created_at')
  if (loading) return <CardGridSkeleton cols="" />
  return (
    <Card>
      <SectionHeader
        title="Undercover deployments"
        subtitle="Legends, handling and extraction. Handler-compartmented like sources; the deployed officer can always see their own deployment."
      />
      {!rows.length ? <Empty what="deployments" /> : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-100">{r.legend_name}</span>
                <Badge tint={statusTint(r.status)}>{siuUndercoverStatusLabel(r.status)}</Badge>
                {r.legal_authority && <Badge tone="neutral">{r.legal_authority}</Badge>}
                <span className="ml-auto text-[11px] text-slate-500">
                  {r.started_at ? `Deployed ${fmtDate(r.started_at)}` : 'Not deployed'}
                  {r.ended_at ? ` · ended ${fmtDate(r.ended_at)}` : ''}
                </span>
              </div>
              {r.objective && <p className="mt-1 text-xs text-slate-300">{r.objective}</p>}
              {r.extraction_plan && (
                <p className="mt-1 text-[11px] text-amber-300/80">Extraction: {r.extraction_plan}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* --------------------------------------------------------------- financial */

function FinancialLane() {
  const { rows, loading } = useRows<FinRow>('siu_financial_intel', 'occurred_at')
  if (loading) return <CardGridSkeleton cols="" />
  return (
    <Card>
      <SectionHeader
        title="Financial intelligence"
        subtitle="Accounts, transfers, assets and patterns, pointed at the shared registries rather than duplicating them."
      />
      {!rows.length ? <Empty what="financial records" /> : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <Badge tone="neutral">{r.record_type.replace(/_/g, ' ')}</Badge>
              {r.flagged && <Badge tint="bg-amber-500/15 text-amber-300">Flagged</Badge>}
              <span className="text-sm text-slate-100">{r.subject_label ?? r.counterparty ?? r.institution ?? '—'}</span>
              {r.identifier && <span className="font-mono text-xs text-slate-400">{r.identifier}</span>}
              <span className="text-sm font-semibold text-slate-200">{fmtMoney(r.amount, r.currency)}</span>
              <span className="ml-auto text-[11px] text-slate-500">{fmtDate(r.occurred_at)}</span>
              {r.description && <p className="w-full text-xs text-slate-400">{r.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------- comms */

function CommsLane() {
  const { rows, loading } = useRows<CommsRow>('siu_comms_intel', 'occurred_at')
  if (loading) return <CardGridSkeleton cols="" />
  return (
    <Card>
      <SectionHeader
        title="Communications intelligence"
        subtitle="Numbers, devices and toll records. Content can only be recorded against a named legal authority — the database refuses it otherwise — and content never leaves in an export."
      />
      {!rows.length ? <Empty what="communications records" /> : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{r.record_type.replace(/_/g, ' ')}</Badge>
                <span className="font-mono text-sm text-slate-100">{r.identifier ?? '—'}</span>
                {r.subscriber && <span className="text-xs text-slate-400">{r.subscriber}</span>}
                {r.carrier && <span className="text-[11px] text-slate-500">{r.carrier}</span>}
                {r.counterpart && <span className="font-mono text-xs text-slate-400">→ {r.counterpart}</span>}
                {r.content_summary && (
                  <Badge tint="bg-rose-500/15 text-rose-300" title="Content — never included in an export">
                    Content
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-slate-500">{fmtWhen(r.occurred_at)}</span>
              </div>
              {r.content_summary && <p className="mt-1 text-xs text-slate-300">{r.content_summary}</p>}
              {r.legal_authority && (
                <p className="mt-1 text-[11px] text-slate-500">Authority: {r.legal_authority}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* --------------------------------------------------------------- integrity */

function IntegrityLane() {
  const { rows, loading } = useRows<ReviewRow>('siu_integrity_reviews', 'opened_at')
  if (loading) return <CardGridSkeleton cols="" />
  return (
    <Card>
      <SectionHeader
        title="Integrity reviews"
        subtitle="A named subject, a named allegation, and a disposition that has to be recorded before the review can close. Nothing here consults the subject's rank."
      />
      {!rows.length ? <Empty what="reviews" /> : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tint={statusTint(r.status)}>{siuReviewStatusLabel(r.status)}</Badge>
                <Badge tone="neutral">{siuAllegationLabel(r.allegation_type)}</Badge>
                <Badge tint={r.severity === 'critical' ? 'bg-rose-500/15 text-rose-300' : 'bg-white/5 text-slate-300'}>
                  {r.severity}
                </Badge>
                <span className="text-sm text-slate-100">{r.subject_description ?? 'Subject on file'}</span>
                <span className="ml-auto text-[11px] text-slate-500">Opened {fmtDate(r.opened_at)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{r.summary}</p>
              {r.disposition && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Disposition: {r.disposition}
                  {r.referred_to ? ` · referred to ${r.referred_to}` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ----------------------------------------------------------------- exports */

function ExportsLane() {
  const [rows, setRows] = useState<SiuExportRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { setRows(await withRetry(() => fetchSiuExports())) }
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

  return (
    <Card>
      <SectionHeader
        title="Export log"
        subtitle="Every restricted export, with its reason. Source identities, undercover legends and intercept content are withheld from every export, for every caller — including SIU command."
      />
      {!rows.length ? <Empty what="exports" /> : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{siuExportScopeLabel(r.scope)}</Badge>
                <span className="text-xs text-slate-300">{r.item_count} record{r.item_count === 1 ? '' : 's'}</span>
                <span className="ml-auto text-[11px] text-slate-500">{fmtWhen(r.exported_at)}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Reason: {r.reason}</p>
              {!!r.withheld?.length && (
                <p className="mt-1 text-[11px] text-amber-300/80">
                  Withheld: {r.withheld.map((w) => `${siuWithheldLabel(w.category)} (${w.count})`).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* -------------------------------------------------------- oversight report */

/** Aggregate-only supervision, for the SOP chain. Every number here is a
 *  count: no case, no name, no codename, no identifier. That is what makes it
 *  safe to show someone who may themselves be under investigation. */
export function SiuOversightSection() {
  const siu = useSiu()
  const [data, setData] = useState<SiuOversightReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void withRetry(() => fetchSiuOversightReport())
      .then((r) => { if (live) setData(r) })
      .catch((e) => { if (live) toast(e instanceof Error ? e.message : String(e), 'danger') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  if (loading) return <CardGridSkeleton cols="" />
  if (!data?.access) return <Empty what="oversight data" />

  const g = (o: Record<string, number> | undefined, k: string) => o?.[k] ?? 0

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="Oversight report"
          subtitle="Counts only — the unit's workload and how it is disposed of. No investigation, subject, source or identifier appears on this page by design."
        />
        <MetricStrip
          className="mt-3"
          metrics={[
            { label: 'Investigations', value: g(data.investigations, 'total') },
            { label: 'Open', value: g(data.investigations, 'open') },
            { label: 'Compartmented', value: g(data.investigations, 'compartmented') },
            { label: 'Agents', value: g(data.personnel, 'agents') },
          ]}
        />
      </Card>

      <Card>
        <SectionHeader title="Control of CID cases" subtitle="§14 — how often SIU has taken a case, and how often it gave one back." />
        <MetricStrip
          className="mt-3"
          metrics={[
            { label: 'Assumed', value: g(data.control, 'assumed_total') },
            { label: 'Currently held', value: g(data.control, 'currently_held') },
            { label: 'Returned to CID', value: g(data.control, 'returned_to_cid') },
          ]}
        />
      </Card>

      <Card>
        <SectionHeader title="Released to CID" subtitle="§15 — what the unit has told the Division, and whether it was acknowledged." />
        <MetricStrip
          className="mt-3"
          metrics={[
            { label: 'Live releases', value: g(data.disclosure, 'live') },
            { label: 'Acknowledged', value: g(data.disclosure, 'acknowledged') },
            { label: 'Revoked', value: g(data.disclosure, 'revoked') },
            { label: 'Division-wide', value: g(data.disclosure, 'to_division') },
          ]}
        />
      </Card>

      <Card>
        <SectionHeader title="Integrity workload" subtitle="Allegations against members, and their disposition. Subjects are never named here." />
        <MetricStrip
          className="mt-3"
          metrics={[
            { label: 'Open', value: g(data.integrity, 'open') },
            { label: 'Critical open', value: g(data.integrity, 'critical_open') },
            { label: 'Substantiated', value: g(data.integrity, 'substantiated') },
            { label: 'Unsubstantiated', value: g(data.integrity, 'unsubstantiated') },
            { label: 'Flags on CID cases', value: g(data.integrity, 'flags_against_cid_cases') },
          ]}
        />
      </Card>

      <Card>
        <SectionHeader title="Tradecraft volume" subtitle="Volume only. No codename, legend or identifier is reachable from this report at any standing." />
        <MetricStrip
          className="mt-3"
          metrics={[
            { label: 'Sources active', value: g(data.tradecraft, 'sources_active') },
            { label: 'Undercover active', value: g(data.tradecraft, 'undercover_active') },
            { label: 'Compromised', value: g(data.tradecraft, 'undercover_compromised') },
            { label: 'Exports (30d)', value: g(data.exports, 'last_30_days') },
          ]}
        />
        {siu.standing === 'oversight' && (
          <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">
            You hold oversight standing. You supervise the unit through these totals and through
            standard investigations; source identities, cover identities and intercept content are
            outside oversight by design, so that an investigation concerning your own office remains
            possible.
          </p>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------ export panel */

/** The export control itself, rendered on an investigation. Kept beside the
 *  log so what leaves and what was withheld are read in the same place. */
export function SiuExportPanel({ caseId }: { caseId: string }) {
  const [scope, setScope] = useState<string>('case_summary')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    const reason = window.prompt('Reason for this export (recorded and audited):')
    if (!reason?.trim()) return
    setBusy(true)
    const res = await rpc('siu_export_case', { p_case: caseId, p_scope: scope, p_reason: reason.trim() })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    const payload = res.data as unknown as { withheld?: { category: string; count: number }[] } | null
    const withheld = (payload?.withheld ?? []).filter((w) => w.count > 0)
    toast(
      withheld.length
        ? `Exported. Withheld: ${withheld.map((w) => siuWithheldLabel(w.category)).join(', ')}.`
        : 'Exported.',
      'success',
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Export scope"
        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200"
        value={scope}
        onChange={(e) => setScope(e.target.value)}
      >
        {SIU_EXPORT_SCOPES.map((s) => (
          <option key={s} value={s}>{siuExportScopeLabel(s)}</option>
        ))}
      </select>
      <Button size="sm" onClick={() => void run()} disabled={busy}>
        {busy ? 'Exporting…' : 'Export'}
      </Button>
      <span className="text-[11px] text-slate-500">
        Source identities, legends and intercept content are always withheld.
      </span>
    </div>
  )
}
