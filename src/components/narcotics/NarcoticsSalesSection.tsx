'use client'

/** Street-Value Observations — the RESTRICTED intelligence section of the
 *  Narcotics substance dossier.
 *
 *  Investigator-conducted controlled cannabis sales, grouped into an ongoing
 *  series, are shown as a preliminary OBSERVED range — never a market value or
 *  forecast. Every number is derived through the pure model (narcoticsSales);
 *  nothing is computed inline. Payment-per-unit is the primary comparison;
 *  weight-normalized $/g,$/kg,$/lb are always labelled "derived". Confidence
 *  reflects SAMPLE SIZE only. The whole section is RLS-gated upstream (it only
 *  renders for authorized viewers); the client just hides mutating affordances
 *  when the viewer can't edit. */
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Notice'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Field'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { statusTint } from '@/lib/tint'
import { fmtDate } from '@/lib/format'
import { safeUrl } from '@/lib/safeUrl'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { insert, rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import type { NarcoticRow } from './narcoticsDossier'
import type { SalesData, MediaRow } from './narcoticsLoad'
import {
  saleMetrics, stackTotals, reconcileStacks, seriesStats, compareTiers,
  formatProceeds, formatMoney, formatInt, formatRecordedWeight,
  productStateLabel, paymentTypeLabel, saleStateLabel, saleStateTintKey,
  tierTintKey, datePrecisionLabel, isPrimaryEvidence, evidenceRoleTintKey,
  type SaleObservationRow, type SaleStackRow, type SaleMediaTags,
} from './narcoticsSales'
import { SalesObservationForm } from './NarcoticsSalesForm'

/* ── Tier colour for the SVG (identity, not rank). App renders dark; the
 *  light values ship for theme-awareness per the dataviz method. ─────────── */
const VIZ_STYLE = `
.sv-viz{--sv-fire:#e34948;--sv-mids:#eda100;--sv-other:#2a78d6;--sv-baseline:#c3c2b7;}
@media (prefers-color-scheme: dark){.sv-viz{--sv-fire:#e66767;--sv-mids:#c98500;--sv-other:#3987e5;--sv-baseline:#383835;}}
`
function tierVar(tier: string): string {
  switch (tier.toLowerCase()) {
    case 'fire': return 'var(--sv-fire)'
    case 'mids': return 'var(--sv-mids)'
    default: return 'var(--sv-other)'
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * SalesSection (the export the dossier imports)
 * ════════════════════════════════════════════════════════════════════════ */
export function SalesSection({ narcotic, data, openSaleId, onOpenSale, onOpenMedia, onChanged }: {
  narcotic: NarcoticRow
  data: SalesData
  openSaleId: string | null
  onOpenSale: (saleId: string | null) => void
  onOpenMedia: (m: MediaRow) => void
  onChanged: () => void
}) {
  const { canEdit } = useAuth()
  // Re-render when the roster cache resolves so investigator names fill in.
  useProfilesStore((s) => s.loaded)
  const [formOpen, setFormOpen] = useState(false)
  const [correctFor, setCorrectFor] = useState<SaleObservationRow | 'series' | null>(null)

  const { series, observations } = data

  if (!series) {
    return (
      <EmptyState
        title="No street-value series"
        hint="Investigator-conducted controlled sales appear here once a collection series has been opened for this substance."
      />
    )
  }

  const stats = seriesStats(observations)
  const mids = stats.perTier.find((t) => t.tier.toLowerCase() === 'mids')
  const fire = stats.perTier.find((t) => t.tier.toLowerCase() === 'fire')
  const cmp = compareTiers(mids, fire)
  const contextMedia = data.mediaByObs.get('') ?? []

  const summaryMetrics: Metric[] = [
    { label: stats.estimateLabel, value: formatMoney(stats.latestPaymentPerUnit), hint: stats.latestAt ? `Latest · ${fmtDate(stats.latestAt)}` : 'Latest observation' },
    { label: 'Observations', value: formatInt(stats.count) },
    { label: 'Average $/unit', value: formatMoney(stats.averagePaymentPerUnit) },
    {
      label: 'Range $/unit',
      value: stats.minPaymentPerUnit != null && stats.maxPaymentPerUnit != null
        ? `${formatMoney(stats.minPaymentPerUnit)}–${formatMoney(stats.maxPaymentPerUnit)}`
        : '—',
    },
  ]

  return (
    <div className="space-y-5">
      {/* 1 · Restricted banner + series identity */}
      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
              <span aria-hidden>🔒</span> Restricted intelligence
            </p>
            <h2 className="mt-1 text-lg font-bold text-white">{series.name || 'Street-Value Observations'}</h2>
            <p className="mt-0.5 text-sm text-amber-100/90">
              Investigator-conducted controlled sales. Visible only to authorized members.
            </p>
            {series.next_action && <p className="mt-1 text-[11px] text-slate-400">Next: {series.next_action}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {series.status && <Badge tint={statusTint(series.status)}>{cap(series.status)}</Badge>}
            {series.collection_state && <Badge tone="warn">{cap(series.collection_state)}</Badge>}
            {canEdit && <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>Record a sale</Button>}
          </div>
        </div>
      </div>

      {observations.length === 0 ? (
        <EmptyState
          title="No observations yet"
          hint="Recorded controlled sales for this series will appear here."
          action={canEdit ? { label: 'Record a sale', onClick: () => setFormOpen(true) } : undefined}
        />
      ) : (
        <>
          {/* 2 · Preliminary-range summary */}
          <Card pad="lg" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone="warn" title="Confidence reflects the number of observations recorded, NOT a real-world market value.">
                  {stats.confidenceLabel}
                </Badge>
                <span className="text-[11px] text-slate-400">based on {stats.count} observation{stats.count === 1 ? '' : 's'}</span>
              </div>
              <button
                type="button"
                onClick={() => setCorrectFor('series')}
                className="rounded-lg px-2 py-1 text-[11px] text-blue-200 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
              >
                Suggest a correction
              </button>
            </div>
            <MetricStrip metrics={summaryMetrics} />
            <p className="text-[11px] text-slate-400">
              A preliminary observed range from a small sample — not a market value, price schedule or forecast.
            </p>
          </Card>

          {/* 3 · Trend / tier comparison (2+ observations only) */}
          {observations.length >= 2 && (
            <Card pad="lg" className="space-y-3">
              <TierBarChart observations={observations} />
              {cmp && cmp.a.avgPaymentPerUnit != null && cmp.b.avgPaymentPerUnit != null && (
                <p className="text-sm text-slate-200">
                  <span className="font-semibold text-white">{cap(cmp.b.tier)}</span> tier ≈{' '}
                  <span className="font-bold tabular-nums text-white">{formatMoney(cmp.multiple).replace('$', '')}×</span>{' '}
                  <span className="font-semibold text-white">{cap(cmp.a.tier)}</span>{' '}
                  <span className="text-slate-400">
                    ({formatMoney(cmp.absoluteDelta)} more per unit
                    {cmp.percentMore != null ? `, +${formatInt(cmp.percentMore)}%` : ''})
                  </span>
                </p>
              )}
              <p className="text-[11px] text-amber-300/80">
                {observations.length === 2 ? 'Two observations only — not a price schedule.' : `${observations.length} observations — a small sample, not a price schedule.`}
              </p>
            </Card>
          )}

          {/* 4 · Observation cards */}
          <div className="space-y-3">
            {observations.map((obs) => (
              <ObservationCard
                key={obs.id}
                obs={obs}
                stacks={data.stacksByObs.get(obs.id) ?? []}
                media={data.mediaByObs.get(obs.id) ?? []}
                expanded={openSaleId === obs.id}
                canEdit={canEdit}
                onToggle={() => onOpenSale(openSaleId === obs.id ? null : obs.id)}
                onOpenMedia={onOpenMedia}
                onConfirmed={onChanged}
                onSuggestCorrection={() => setCorrectFor(obs)}
              />
            ))}
          </div>

          {/* 6 · Series-level / context evidence */}
          {contextMedia.length > 0 && (
            <Card pad="lg" className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Supporting &amp; context evidence</h3>
                <Badge>{contextMedia.length}</Badge>
              </div>
              <MediaGrid media={contextMedia} onOpenMedia={onOpenMedia} showCaption />
              <p className="text-[11px] text-slate-400">Cultivation, supply, bounty-board and trade-window imagery attached to the series.</p>
            </Card>
          )}
        </>
      )}

      {/* 7 · Add observation */}
      <SalesObservationForm
        open={formOpen}
        seriesId={series.id}
        defaultPaymentType={series.payment_type || 'dirty_money'}
        onClose={() => setFormOpen(false)}
        onSaved={onChanged}
      />

      {/* 9 · Suggest correction (reuses the Feedback mechanism) */}
      {correctFor && (
        <CorrectionModal
          subjectPrefix={`Sales correction: ${narcotic.name} · ${series.name || 'Street-Value Observations'}`}
          observation={correctFor === 'series' ? null : correctFor}
          onClose={() => setCorrectFor(null)}
        />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * Observation card + detail panel
 * ════════════════════════════════════════════════════════════════════════ */
function ObservationCard({ obs, stacks, media, expanded, canEdit, onToggle, onOpenMedia, onConfirmed, onSuggestCorrection }: {
  obs: SaleObservationRow
  stacks: SaleStackRow[]
  media: MediaRow[]
  expanded: boolean
  canEdit: boolean
  onToggle: () => void
  onOpenMedia: (m: MediaRow) => void
  onConfirmed: () => void
  onSuggestCorrection: () => void
}) {
  const m = saleMetrics(obs)
  const tier = (obs.quality_tier ?? '').trim() || 'Unspecified'
  const isDraft = (obs.state ?? '').toLowerCase() === 'draft'
  const weightText = formatRecordedWeight(obs.recorded_weight_text, obs.recorded_weight_value, obs.recorded_weight_unit)

  const confirmObs = async () => {
    const res = await rpc('confirm_narcotic_sale_observation', { p_id: obs.id, p_reason: 'Confirmed from dossier' })
    if (res.error) { toast(`Couldn’t confirm: ${res.error.message}`, 'danger'); return }
    toast('Observation confirmed', 'success')
    onConfirmed()
  }

  return (
    <Card pad="md" className="space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tint={statusTint(tierTintKey(tier))}>{cap(tier)}</Badge>
        {obs.observation_number != null && <span className="text-[11px] font-semibold text-slate-500">#{obs.observation_number}</span>}
        <Badge tint={statusTint(saleStateTintKey(obs.state))}>{saleStateLabel(obs.state)}</Badge>
        <span className="text-[11px] text-slate-400">
          {obs.observed_at ? fmtDate(obs.observed_at) : 'Undated'} · {datePrecisionLabel(obs.observed_date_precision)}
        </span>
        <Badge tone="neutral">{productStateLabel(obs.product_state)}</Badge>
        {media.length > 0 && <Badge tone="neutral" title="Attached screenshots">📎 {media.length}</Badge>}
      </div>

      {/* Facts row */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Fact label="Units" value={formatInt(m.totalUnits)} />
        <Fact label="Recorded weight" value={weightText} note={m.weightIsDerived ? '(derived to g/kg)' : undefined} />
        <Fact label="Proceeds" value={formatProceeds(m.paymentAmount)} sub={paymentTypeLabel(obs.payment_type)} />
        <Fact label="$ / unit" value={formatMoney(m.paymentPerUnit)} strong />
      </div>

      {/* Provenance + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {obs.source_confidence && <Badge tint={statusTint(obs.source_confidence)}>{cap(obs.source_confidence)}</Badge>}
          {obs.provenance && <Badge tone="neutral" title="Source of this observation">{cap(obs.provenance.replace(/_/g, ' '))}</Badge>}
          {obs.investigator_id && <span className="text-[11px] text-slate-400">Investigator: {officerName(obs.investigator_id)}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {canEdit && isDraft && <Button variant="warn" size="sm" onAction={confirmObs}>Mark confirmed</Button>}
          <Button variant="secondary" size="sm" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? 'Close' : 'Open details'}
          </Button>
        </div>
      </div>

      {expanded && (
        <DetailPanel
          obs={obs}
          metrics={m}
          stacks={stacks}
          media={media}
          onOpenMedia={onOpenMedia}
          onSuggestCorrection={onSuggestCorrection}
          onClose={onToggle}
        />
      )}
    </Card>
  )
}

function DetailPanel({ obs, metrics, stacks, media, onOpenMedia, onSuggestCorrection, onClose }: {
  obs: SaleObservationRow
  metrics: ReturnType<typeof saleMetrics>
  stacks: SaleStackRow[]
  media: MediaRow[]
  onOpenMedia: (m: MediaRow) => void
  onSuggestCorrection: () => void
  onClose: () => void
}) {
  const rec = stacks.length ? reconcileStacks(obs, stacks) : null
  const totals = stacks.length ? stackTotals(stacks) : null
  const unit = (metrics.recordedWeightUnit ?? '').trim()

  return (
    <div className="space-y-4 border-t border-white/10 pt-4">
      {/* Stacks */}
      {stacks.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stack breakdown</h4>
          <div className="space-y-1.5">
            {stacks.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-white/5 bg-ink-900/60 px-3 py-2 text-sm">
                <span className="font-semibold text-slate-300">Stack {s.stack_number}</span>
                <span className="text-slate-500" aria-hidden>·</span>
                <span className="tabular-nums text-white">{formatInt(s.units)} units</span>
                <span className="text-slate-500" aria-hidden>·</span>
                <span className="tabular-nums text-slate-200">{formatRecordedWeight(s.recorded_weight_text, s.recorded_weight_value, s.recorded_weight_unit)}</span>
              </div>
            ))}
          </div>
          {rec && (!rec.unitsMatch || rec.weightMatch === false) && (
            <p className="text-[11px] text-amber-300">
              Stacks total {formatInt(rec.stackUnits)} units vs. {formatInt(rec.observationUnits)} recorded
              {rec.weightMatch === false ? ' — weights also differ' : ''}. Shown as recorded; not overwritten.
            </p>
          )}
          {totals?.originalUnit && rec?.weightMatch !== false && (
            <p className="text-[11px] text-slate-500">Stack weight total: {formatInt(totals.originalValue)} {totals.originalUnit}.</p>
          )}
        </section>
      )}

      {/* Payment summary */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Payment summary</h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <Fact label="Proceeds" value={formatProceeds(metrics.paymentAmount)} />
          <Fact label="$ / unit" value={formatMoney(metrics.paymentPerUnit)} strong />
          <Fact label={`$ / ${unit || 'recorded unit'}`} value={formatMoney(metrics.paymentPerRecordedUnit)} />
          <Fact label="$ / g" value={formatMoney(metrics.paymentPerGram)} note="derived" />
          <Fact label="$ / kg" value={formatMoney(metrics.paymentPerKilogram)} note="derived" />
          <Fact label="$ / lb" value={formatMoney(metrics.paymentPerPound)} note="derived" />
        </div>
      </section>

      {/* Note / methodology / provenance */}
      {(obs.analyst_note || obs.methodology || obs.notes) && (
        <section className="space-y-2">
          {obs.analyst_note && <Prose label="Analyst note" value={obs.analyst_note} />}
          {obs.methodology && <Prose label="Methodology" value={obs.methodology} />}
          {obs.notes && <Prose label="Notes" value={obs.notes} />}
        </section>
      )}

      {/* Screenshots */}
      {media.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Attached screenshots</h4>
          <MediaGrid media={media} onOpenMedia={onOpenMedia} showRole />
        </section>
      )}

      {/* Methodology disclosure */}
      <details className="rounded-lg border border-white/5 bg-ink-900/40 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-300">Calculation methodology</summary>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          $/unit = proceeds ÷ total units. Weight-normalized values ($/g, $/kg, $/lb) are DERIVED by converting the
          recorded weight ({unit || 'original unit'}) to grams — they are display estimates, never re-recorded as facts.
          Confidence reflects the number of observations only, not any real-world market value.
        </p>
      </details>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSuggestCorrection}
          className="rounded-lg px-2 py-1 text-[11px] text-blue-200 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
        >
          Suggest a correction
        </button>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tier bar chart (compact inline SVG, dataviz-method)
 * ════════════════════════════════════════════════════════════════════════ */
function TierBarChart({ observations }: { observations: SaleObservationRow[] }) {
  const bars = observations
    .map((o) => ({
      id: o.id,
      tier: (o.quality_tier ?? '').trim() || 'Unspecified',
      n: o.observation_number ?? 0,
      value: saleMetrics(o).paymentPerUnit ?? 0,
    }))
    .filter((b) => b.value > 0)

  if (bars.length < 2) return null

  const title = `Observed payment per unit — ${countWord(observations.length)} recorded sales`
  const max = Math.max(...bars.map((b) => b.value))
  // viewBox units ≈ px at container width; scales down on mobile.
  const W = 640, padX = 16, padTop = 30, plotH = 168, padBottom = 46
  const baseline = padTop + plotH
  const H = baseline + padBottom
  const bandW = (W - padX * 2) / bars.length
  const barW = Math.min(24, bandW * 0.5)

  const tiersPresent = [...new Set(bars.map((b) => b.tier))]

  return (
    <figure className="sv-viz m-0">
      <style>{VIZ_STYLE}</style>
      <figcaption className="mb-1 text-sm font-semibold text-white">{title}</figcaption>
      <p className="mb-3 text-[11px] text-slate-500">Bars coloured by tier identity. Payment per unit is the primary comparison.</p>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} className="block max-w-full">
        <title>{title}</title>
        {/* baseline (recessive hairline) */}
        <line x1={padX} y1={baseline} x2={W - padX} y2={baseline} stroke="var(--sv-baseline)" strokeWidth={1} />
        {bars.map((b, i) => {
          const h = max > 0 ? (b.value / max) * plotH : 0
          const cx = padX + bandW * i + bandW / 2
          const x = cx - barW / 2
          const y = baseline - h
          return (
            <g key={b.id}>
              <path d={roundedTopBar(x, y, barW, h, 4)} fill={tierVar(b.tier)} />
              {/* value on the cap */}
              <text x={cx} y={y - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill="#c3c2b7">
                {formatMoney(b.value)}
              </text>
              {/* category label */}
              <text x={cx} y={baseline + 18} textAnchor="middle" fontSize={12} fill="#898781">{cap(b.tier)}</text>
              <text x={cx} y={baseline + 34} textAnchor="middle" fontSize={11} fill="#898781">#{b.n || i + 1}</text>
            </g>
          )
        })}
      </svg>

      {/* legend */}
      <div className="mt-2 flex flex-wrap gap-3">
        {tiersPresent.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: tierVar(t) }} aria-hidden />
            {cap(t)}
          </span>
        ))}
      </div>

      {/* a11y table fallback — wrapped in an sr-only DIV (not the table itself):
          a bare `<table className="sr-only">` keeps auto-layout, ignores the
          1px width and renders full-width absolutely-positioned, inflating page
          scrollWidth on mobile. The div's overflow:hidden clips it (same class
          of fix as the SectionTabs marker escape). */}
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead><tr><th>Observation</th><th>Tier</th><th>Payment per unit</th></tr></thead>
          <tbody>
            {bars.map((b, i) => (
              <tr key={b.id}><td>#{b.n || i + 1}</td><td>{cap(b.tier)}</td><td>{formatMoney(b.value)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * Media grid (matches MediaSection's thumbnail idiom)
 * ════════════════════════════════════════════════════════════════════════ */
function MediaGrid({ media, onOpenMedia, showRole = false, showCaption = false }: {
  media: MediaRow[]
  onOpenMedia: (m: MediaRow) => void
  showRole?: boolean
  showCaption?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {media.map((m) => {
        const src = safeUrl(m.external_url || m.storage_path || '')
        const tags = (m.tags ?? {}) as SaleMediaTags
        const role = tags.evidence_role ?? ''
        const primary = isPrimaryEvidence(role)
        return (
          <div
            key={m.id}
            className={`group relative overflow-hidden rounded-lg border bg-ink-850 ${primary ? 'border-emerald-500/40 ring-1 ring-emerald-500/30' : 'border-white/5'}`}
          >
            <button onClick={() => onOpenMedia(m)} className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500" title={m.title}>
              {src && m.type !== 'document' ? (
                // eslint-disable-next-line @next/next/no-img-element -- external media CDN
                <img src={src} alt={m.title} className="h-28 w-full object-cover transition group-hover:opacity-90" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              ) : (
                <div className="grid h-28 w-full place-items-center text-2xl" aria-hidden>{m.type === 'video' ? '🎬' : '📄'}</div>
              )}
              {(showRole || showCaption) && (
                <span className="flex flex-col gap-1 px-1.5 py-1">
                  {showRole && role && (
                    <span className={`inline-flex w-fit rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${evidenceRoleTintKey(role) ? statusTint(evidenceRoleTintKey(role)) : 'bg-white/5 text-slate-300'}`}>
                      {role}
                    </span>
                  )}
                  {showCaption && <span className="truncate text-[11px] text-slate-300">{m.title}</span>}
                </span>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * Suggest correction — reuses the Feedback table
 * ════════════════════════════════════════════════════════════════════════ */
function CorrectionModal({ subjectPrefix, observation, onClose }: {
  subjectPrefix: string
  observation: SaleObservationRow | null
  onClose: () => void
}) {
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const subject = observation?.observation_number != null
    ? `${subjectPrefix} · obs #${observation.observation_number}`
    : subjectPrefix

  const submit = async () => {
    if (!details.trim()) { toast('Describe the correction first.', 'warn'); return }
    setBusy(true)
    const res = await insert('feedback', { kind: 'bug', title: subject, details: details.trim() })
    setBusy(false)
    if (res.error) { toast(`Couldn’t submit: ${res.error.message}`, 'danger'); return }
    toast('Correction submitted for review', 'success')
    onClose()
  }

  return (
    <Modal open onClose={onClose} dirty={() => Boolean(details.trim())}>
      <ModalHeader title="Suggest a correction" onClose={onClose} />
      <p className="mb-3 text-sm text-slate-400">
        Routed through the standard feedback queue, prefilled as: <span className="text-slate-200">{subject}</span>
      </p>
      <Textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What looks wrong, and what should it be?" aria-label="Correction details" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => void submit()}>Submit correction</Button>
      </div>
    </Modal>
  )
}

/* ── Small atoms ──────────────────────────────────────────────────────────── */
function Fact({ label, value, sub, note, strong = false }: {
  label: string; value: string; sub?: string; note?: string; strong?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`tabular-nums ${strong ? 'text-base font-bold text-white' : 'text-sm text-slate-200'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
      {note && <p className="text-[10px] uppercase tracking-wide text-slate-500">{note}</p>}
    </div>
  )
}

function Prose({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 max-w-[70ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{value}</p>
    </div>
  )
}

/* ── helpers ──────────────────────────────────────────────────────────────── */
function cap(s: string): string {
  const t = (s ?? '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
function countWord(n: number): string {
  return n >= 0 && n <= 10 ? NUMBER_WORDS[n] : String(n)
}

/** Path for a bar with a rounded top (data-end) and square base at the
 *  baseline — the dataviz mark spec. */
function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const base = y + h
  const rr = Math.min(r, w / 2, h)
  if (h <= 0) return `M ${x} ${base} L ${x + w} ${base}`
  return [
    `M ${x} ${base}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${base}`,
    'Z',
  ].join(' ')
}
