'use client'

/** Descriptive (non-actionable) sections of the Narcotics dossier: Overview,
 *  Identification, Packaging and Intelligence, plus the shared display atoms
 *  (KV / DescBlock) and the Charges card (§13). These read the narcotic row +
 *  its lazily-loaded slices; they never mutate. The Intelligence section is
 *  deliberately limited to broad category + generalized stage names + scene
 *  indicators + linked entities — NO ingredients/ratios/temps/steps. */
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EntityLink } from '@/components/ui/EntityLink'
import { EmptyState } from '@/components/ui/Notice'
import { ConfidenceBadge, ProvenanceBadge } from '@/components/ui/IntelBadges'
import { safeUrl } from '@/lib/safeUrl'
import { fmtDate } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { statusTint } from '@/lib/tint'
import {
  PRODUCTION_STAGES, categoryLabel, humanize, isProductionRole, linkStatusLabel,
  placeRoleLabel, resolveCharges, statusLabel, statusTintKey, type NarcoticRow,
} from './narcoticsDossier'
import type { AliasRow, IntelligenceData, MediaRow, SeizureRow } from './narcoticsLoad'

/* ── Shared display atoms (module scope for the static-components lint) ─────── */
export function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-200">{children}</span>
    </div>
  )
}

/** A labelled prose block. Renders nothing when the value is empty so the
 *  dossier never shows a hollow heading over a dash. */
export function DescBlock({ label, value }: { label: string; value: string | null | undefined }) {
  const v = (value ?? '').trim()
  if (!v) return null
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 max-w-[70ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{v}</p>
    </div>
  )
}

/* ── Charges (§13) ─────────────────────────────────────────────────────────── */
export function ChargesCard({ narcotic, canEditCharges, onEdit }: {
  narcotic: NarcoticRow; canEditCharges: boolean; onEdit: () => void
}) {
  const charges = resolveCharges(narcotic.charge_codes)
  return (
    <Card pad="lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Potential related charges</h3>
        {canEditCharges && (
          <button onClick={onEdit} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-blue-200 hover:bg-white/10">Edit codes</button>
        )}
      </div>
      {charges.length === 0 ? (
        <p className="text-sm text-slate-400">No penal-code charges associated.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {charges.map(({ code, charge }) => (
            <li key={code}>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200"
                title={charge?.desc ?? 'Code not found in the current penal code'}
              >
                <span className="font-mono font-semibold text-slate-100">{code}</span>
                <span className="text-slate-300">{charge ? charge.title : 'Unrecognised code'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-slate-400">
        Potential related charges — verify facts and current charge definitions.
      </p>
    </Card>
  )
}

/* ── Overview ──────────────────────────────────────────────────────────────── */
export function NarcoticOverview({ narcotic, aliases, canEditCharges, onEditCharges }: {
  narcotic: NarcoticRow
  aliases: AliasRow[]
  canEditCharges: boolean
  onEditCharges: () => void
}) {
  const n = narcotic
  const responsible = officerName(n.reviewed_by) ?? officerName(n.created_by)
  const hasNarrative = [n.summary, n.in_city_significance, n.appearance, n.packaging, n.scene_indicators, n.officer_safety, n.intelligence_gaps]
    .some((v) => (v ?? '').trim())
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card pad="lg">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">Intelligence summary</h3>
          {hasNarrative ? (
            <div className="space-y-3">
              <DescBlock label="Summary" value={n.summary} />
              <DescBlock label="Significance in the city" value={n.in_city_significance} />
              <DescBlock label="Typical form" value={n.appearance} />
              <DescBlock label="Packaging indicators" value={n.packaging} />
              <DescBlock label="Scene indicators" value={n.scene_indicators} />
              <DescBlock label="Officer-safety notes" value={n.officer_safety} />
              <DescBlock label="Intelligence gaps" value={n.intelligence_gaps} />
            </div>
          ) : (
            <p className="text-sm text-slate-400">No descriptive intelligence recorded yet.</p>
          )}
        </Card>
        <ChargesCard narcotic={n} canEditCharges={canEditCharges} onEdit={onEditCharges} />
      </div>

      <Card pad="lg" className="h-fit">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-300">At a glance</h3>
        <div className="divide-y divide-white/5">
          <KV label="Category"><Badge tone="neutral">{categoryLabel(n.category)}</Badge></KV>
          <KV label="Status"><Badge tint={statusTint(statusTintKey(n.status))}>{statusLabel(n.status)}</Badge></KV>
          <KV label="Classification">{n.classification ? humanize(n.classification) : '—'}</KV>
          <KV label="Confidence">{n.confidence ? <ConfidenceBadge confidence={n.confidence} /> : '—'}</KV>
          <KV label="Provenance">{n.provenance ? <ProvenanceBadge provenance={n.provenance} /> : '—'}</KV>
          <KV label="Server-specific">{n.server_specific ? 'Yes' : 'No'}</KV>
          <KV label="First recorded">{fmtDate(n.first_recorded_at)}</KV>
          <KV label="Last confirmed">{fmtDate(n.last_confirmed_at)}</KV>
          <KV label="Last reviewed">{fmtDate(n.reviewed_at)}</KV>
          <KV label="Responsible">{responsible ?? '—'}</KV>
          <KV label="Aliases on file">{aliases.length || '—'}</KV>
        </div>
      </Card>
    </div>
  )
}

/* ── Identification ────────────────────────────────────────────────────────── */
export function IdentificationSection({ narcotic, aliases }: { narcotic: NarcoticRow; aliases: AliasRow[] }) {
  const n = narcotic
  const serverNames = aliases.filter((a) => a.alias_type === 'server_item' || a.server_specific)
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
        <span aria-hidden className="text-lg leading-none">⚠️</span>
        <p className="text-sm text-slate-100">Visual appearance alone does not confirm substance identity.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card pad="lg" className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Appearance &amp; form</h3>
          <DescBlock label="Typical form / appearance" value={n.appearance} />
          <DescBlock label="Packaging types" value={n.packaging} />
          {!(n.appearance ?? '').trim() && !(n.packaging ?? '').trim() && (
            <p className="text-sm text-slate-400">No identification detail recorded yet.</p>
          )}
        </Card>

        <Card pad="lg">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">Names &amp; aliases</h3>
          {aliases.length === 0 ? (
            <p className="text-sm text-slate-400">No aliases or server item names recorded.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {aliases.map((a) => (
                <li key={a.id}>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-200" title={humanize(a.alias_type)}>
                    {a.alias}
                    {a.server_specific && <span className="rounded bg-amber-500/15 px-1 text-[10px] font-semibold uppercase text-amber-300">server</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {serverNames.length > 0 && (
            <p className="mt-3 text-[11px] text-slate-400">Server item names are marked distinctly and may not match street terminology.</p>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ── Packaging ─────────────────────────────────────────────────────────────── */
export function PackagingSection({ narcotic, seizures, media }: {
  narcotic: NarcoticRow; seizures: SeizureRow[]; media: MediaRow[]
}) {
  const observed = seizures.filter((s) => (s.packaging ?? '').trim())
  const hasAny = (narcotic.packaging ?? '').trim() || observed.length > 0
  return (
    <div className="space-y-4">
      {(narcotic.packaging ?? '').trim() && (
        <Card pad="lg"><DescBlock label="Recorded packaging" value={narcotic.packaging} /></Card>
      )}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-bold text-white">Observed packaging</h3>
          <Badge>{observed.length}</Badge>
        </div>
        {!hasAny ? (
          <EmptyState title="No packaging recorded" hint="Packaging observed on seizures appears here as it is logged." />
        ) : observed.length === 0 ? (
          <p className="text-sm text-slate-400">No packaging noted on individual seizures.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {observed.map((s) => {
              const photo = media.find((m) => m.type !== 'document' && (m.external_url || m.storage_path))
              const src = photo ? safeUrl(photo.external_url || photo.storage_path || '') : ''
              return (
                <Card key={s.id} pad="sm" className="flex gap-3">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external media CDN
                    <img src={src} alt="" className="h-16 w-20 flex-shrink-0 rounded-md object-cover" />
                  ) : (
                    <div className="grid h-16 w-20 flex-shrink-0 place-items-center rounded-md bg-ink-700 text-xl" aria-hidden>📦</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{s.packaging}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {[s.location, fmtDate(s.seized_at)].filter(Boolean).join(' · ') || 'No location'}
                    </p>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Intelligence (NON-ACTIONABLE) ─────────────────────────────────────────── */
export function IntelligenceSection({ narcotic, data }: { narcotic: NarcoticRow; data: IntelligenceData }) {
  const productionPlaces = data.places.rows.filter((r) => isProductionRole(r.role))
  const persons = data.people.persons
  const gangs = data.people.gangs
  return (
    <div className="space-y-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/80">
        Investigative intelligence — non-actionable
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card pad="lg">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">Category &amp; production stages</h3>
          <div className="mb-3"><Badge tone="neutral">{categoryLabel(narcotic.category)}</Badge></div>
          <div className="flex flex-wrap gap-1.5">
            {PRODUCTION_STAGES.map((stage) => (
              <span key={stage} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300">{stage}</span>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Generalized stages only — no ingredients, ratios, temperatures or steps are recorded here.
          </p>
        </Card>

        <Card pad="lg">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">Scene indicators</h3>
          {(narcotic.scene_indicators ?? '').trim()
            ? <p className="max-w-[70ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{narcotic.scene_indicators}</p>
            : <p className="text-sm text-slate-400">No scene indicators recorded.</p>}
        </Card>
      </div>

      <Card pad="lg">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">Linked production places</h3>
        {productionPlaces.length === 0 ? (
          <p className="text-sm text-slate-400">No production-related places linked.</p>
        ) : (
          <ul className="space-y-2">
            {productionPlaces.map((r) => {
              const place = data.places.places.get(r.place_id)
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  {place ? <EntityLink kind="place" id={place.id} label={place.name} /> : <span className="text-sm text-slate-500">Restricted place</span>}
                  <Badge tone="accent">{placeRoleLabel(r.role)}</Badge>
                  {r.confidence && <ConfidenceBadge confidence={r.confidence} />}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {(persons.length > 0 || gangs.length > 0) && (
        <Card pad="lg">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">Linked people &amp; gangs</h3>
          <ul className="flex flex-wrap gap-1.5">
            {persons.map((p) => {
              const person = data.people.personMap.get(p.person_id)
              return (
                <li key={`p-${p.id}`} className="flex items-center gap-1">
                  {person ? <EntityLink kind="person" id={person.id} label={person.name} /> : <span className="text-xs text-slate-500">Restricted person</span>}
                  {p.link_status && <span className="text-[10px] uppercase tracking-wide text-slate-400">{linkStatusLabel(p.link_status)}</span>}
                </li>
              )
            })}
            {gangs.map((g) => {
              const gang = data.people.gangMap.get(g.gang_id)
              return (
                <li key={`g-${g.id}`}>
                  {gang ? <EntityLink kind="gang" id={gang.id} label={gang.name} /> : <span className="text-xs text-slate-500">Restricted gang</span>}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
