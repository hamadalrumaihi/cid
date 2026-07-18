'use client'

/** Relational sections of the Narcotics dossier: Cases, Seizures, Places,
 *  People & Gangs, Media (with representative-image pick) and Activity. Every
 *  cross-record chip is an EntityLink; visibility stays RLS-enforced (rows the
 *  caller can't see resolve to restricted stubs, never leaks). Seizure amounts
 *  are rendered VERBATIM — never normalized. */
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EntityLink } from '@/components/ui/EntityLink'
import { EmptyState } from '@/components/ui/Notice'
import { ConfidenceBadge, ProvenanceBadge, StaleIntelBadge } from '@/components/ui/IntelBadges'
import { WorkflowTimeline, type TimelineEntry } from '@/components/ui/WorkflowTimeline'
import { safeUrl } from '@/lib/safeUrl'
import { fmtDate } from '@/lib/format'
import { statusTint } from '@/lib/tint'
import {
  CASE_RELATION_LABEL, humanize, isPossibleMention, linkRoleLabel, linkStatusLabel,
  placeRoleLabel, seizureStateLabel, seizureStateTintKey, statusLabel, type CaseRelation,
} from './narcoticsDossier'
import type { CasesData, MediaRow, PeopleData, PlacesData, SeizuresData } from './narcoticsLoad'

/* ── Cases ─────────────────────────────────────────────────────────────────── */
export function CasesSection({ data }: { data: CasesData }) {
  // De-dupe across sources, strongest relation wins (linked > seizure > mention).
  const relation = new Map<string, CaseRelation>()
  for (const id of data.placeCaseIds) relation.set(id, 'mention')
  for (const id of data.seizureCaseIds) relation.set(id, 'seizure')
  for (const l of data.links) relation.set(l.case_id, 'linked')
  const entries = [...relation.entries()]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Linked cases</h3><Badge>{entries.length}</Badge></div>
      {entries.length === 0 ? (
        <EmptyState title="No linked cases" hint="Cases appear here when this substance is attached to a case, seized in one, or tied to a case-sourced place." />
      ) : (
        <div className="space-y-2">
          {entries.map(([caseId, rel]) => {
            const c = data.cases.get(caseId)
            return (
              <Card key={caseId} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {c ? <EntityLink kind="case" id={c.id} label={c.case_number} /> : <span className="text-sm text-slate-500">Restricted or removed case</span>}
                    {c?.title && <span className="truncate text-sm text-slate-300">{c.title}</span>}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    <Badge tone={rel === 'linked' ? 'good' : rel === 'seizure' ? 'accent' : 'neutral'}>{CASE_RELATION_LABEL[rel]}</Badge>
                    {c?.status && <Badge tint={statusTint(c.status)}>{humanize(c.status)}</Badge>}
                    {c?.bureau && <span>{c.bureau}</span>}
                    {c?.updated_at && <span>· Updated {fmtDate(c.updated_at)}</span>}
                  </p>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-slate-400">Only cases visible to you under access control are shown.</p>
    </div>
  )
}

/* ── Seizures ──────────────────────────────────────────────────────────────── */
export function SeizuresSection({ data }: { data: SeizuresData }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Seizures</h3><Badge>{data.rows.length}</Badge></div>
      {data.rows.length === 0 ? (
        <EmptyState title="No seizures recorded" hint="Recorded seizures of this substance appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.rows.map((s) => {
            const c = s.case_id ? data.cases.get(s.case_id) : null
            const ev = s.evidence_id ? data.evidence.get(s.evidence_id) : null
            return (
              <Card key={s.id} pad="sm" className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tint={statusTint(seizureStateTintKey(s.state))}>{seizureStateLabel(s.state)}</Badge>
                  {(s.amount_recorded || s.unit_recorded) && (
                    <span className="font-mono text-sm font-semibold text-white">
                      {[s.amount_recorded, s.unit_recorded].filter(Boolean).join(' ')}
                    </span>
                  )}
                </div>
                {s.packaging && <p className="text-xs text-slate-300">Packaging: {s.packaging}</p>}
                <p className="text-[11px] text-slate-400">
                  {[s.location, s.seized_at ? `Seized ${fmtDate(s.seized_at)}` : null].filter(Boolean).join(' · ') || 'No location or date'}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {c && <EntityLink kind="case" id={c.id} label={c.case_number} />}
                  {ev && <Badge tone="neutral" title={humanize(ev.type)}>Evidence {ev.item_code || 'logged'}</Badge>}
                </div>
                {s.notes && <p className="text-xs text-slate-400">{s.notes}</p>}
              </Card>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-slate-400">Amounts are shown exactly as recorded and are never normalized across seizures.</p>
    </div>
  )
}

/* ── Places ────────────────────────────────────────────────────────────────── */
export function PlacesSection({ data }: { data: PlacesData }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Places</h3><Badge>{data.rows.length}</Badge></div>
      {data.rows.length === 0 ? (
        <EmptyState title="No linked places" hint="Places tied to this substance (production, distribution, seizure) appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.rows.map((r) => {
            const place = data.places.get(r.place_id)
            const srcCase = r.source_case_id ? data.cases.get(r.source_case_id) : null
            return (
              <Card key={r.id} pad="sm" className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {place ? <EntityLink kind="place" id={place.id} label={place.name} /> : <span className="text-sm text-slate-500">Restricted place</span>}
                  <Badge tone="accent">{placeRoleLabel(r.role)}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.confidence && <ConfidenceBadge confidence={r.confidence} />}
                  {r.provenance && <ProvenanceBadge provenance={r.provenance} />}
                  {r.link_status && <Badge tone={isPossibleMention(r.link_status) ? 'warn' : 'neutral'}>{linkStatusLabel(r.link_status)}</Badge>}
                </div>
                <p className="text-[11px] text-slate-400">
                  {[r.first_observed ? `First ${fmtDate(r.first_observed)}` : null, r.last_confirmed ? `Confirmed ${fmtDate(r.last_confirmed)}` : null].filter(Boolean).join(' · ') || 'No dates recorded'}
                </p>
                {srcCase && <div><EntityLink kind="case" id={srcCase.id} label={`Source: ${srcCase.case_number}`} /></div>}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── People & Gangs ────────────────────────────────────────────────────────── */
export function PeopleSection({ data }: { data: PeopleData }) {
  const total = data.persons.length + data.gangs.length
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">People &amp; gangs</h3><Badge>{total}</Badge></div>
      {total === 0 ? (
        <EmptyState title="No linked people or gangs" hint="Associations recorded for this substance appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.persons.map((p) => {
            const person = data.personMap.get(p.person_id)
            const mention = isPossibleMention(p.link_status)
            return (
              <Card key={`p-${p.id}`} pad="sm" className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {person ? <EntityLink kind="person" id={person.id} label={person.name} /> : <span className="text-sm text-slate-500">Restricted person</span>}
                  <Badge tone="accent">{linkRoleLabel(p.role)}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {mention && <Badge tone="warn" title="Named only as a possible mention, not a confirmed association">Possible mention</Badge>}
                  {!mention && p.link_status && <Badge tone="neutral">{linkStatusLabel(p.link_status)}</Badge>}
                  {p.confidence && <ConfidenceBadge confidence={p.confidence} />}
                  {p.provenance && <ProvenanceBadge provenance={p.provenance} />}
                </div>
                {p.notes && <p className="text-xs text-slate-400">{p.notes}</p>}
              </Card>
            )
          })}
          {data.gangs.map((g) => {
            const gang = data.gangMap.get(g.gang_id)
            const mention = isPossibleMention(g.link_status)
            return (
              <Card key={`g-${g.id}`} pad="sm" className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {gang ? <EntityLink kind="gang" id={gang.id} label={gang.name} /> : <span className="text-sm text-slate-500">Restricted gang</span>}
                  <Badge tone="accent">{linkRoleLabel(g.role)}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {mention && <Badge tone="warn" title="Named only as a possible mention, not a confirmed association">Possible mention</Badge>}
                  {!mention && g.link_status && <Badge tone="neutral">{linkStatusLabel(g.link_status)}</Badge>}
                  {g.confidence && <ConfidenceBadge confidence={g.confidence} />}
                  {g.provenance && <ProvenanceBadge provenance={g.provenance} />}
                </div>
                {g.notes && <p className="text-xs text-slate-400">{g.notes}</p>}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Media ─────────────────────────────────────────────────────────────────── */
export function MediaSection({ media, representativeId, canEdit, onOpen, onSetRepresentative }: {
  media: MediaRow[]
  representativeId: string | null
  canEdit: boolean
  onOpen: (m: MediaRow) => void
  onSetRepresentative: (m: MediaRow) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Media</h3><Badge>{media.length}</Badge></div>
      {media.length === 0 ? (
        <EmptyState title="No media" hint="Imagery linked to this substance appears here." />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m) => {
            const src = safeUrl(m.external_url || m.storage_path || '')
            const isRep = m.id === representativeId
            return (
              <div key={m.id} className="group relative overflow-hidden rounded-lg border border-white/5 bg-ink-850">
                <button onClick={() => onOpen(m)} className="block w-full text-left" title={m.title}>
                  {src && m.type !== 'document' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external media CDN
                    <img src={src} alt={m.title} className="h-28 w-full object-cover transition group-hover:opacity-90" />
                  ) : (
                    <div className="grid h-28 w-full place-items-center text-2xl" aria-hidden>{m.type === 'video' ? '🎬' : '📄'}</div>
                  )}
                  <span className="flex items-center gap-1 truncate px-1.5 py-1 text-[11px] text-slate-300">
                    {isRep && <span className="rounded bg-amber-500/15 px-1 text-[10px] font-semibold uppercase text-amber-300">Cover</span>}
                    <span className="truncate">{m.title}</span>
                  </span>
                </button>
                {m.kind && <span className="block truncate px-1.5 pb-1 text-[10px] uppercase tracking-wide text-slate-400">{humanize(m.kind)}</span>}
                {canEdit && !isRep && m.type !== 'document' && (
                  <button
                    onClick={() => onSetRepresentative(m)}
                    className="absolute right-1 top-1 rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-100 opacity-0 transition hover:bg-ink-950 focus:opacity-100 group-hover:opacity-100"
                  >
                    Set cover
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Activity ──────────────────────────────────────────────────────────────── */
export function ActivitySection({ entries, reviewedAt, now }: {
  entries: TimelineEntry[]; reviewedAt: string | null; now: number
}) {
  return (
    <Card pad="lg">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Activity</h3>
        <StaleIntelBadge reviewedAt={reviewedAt} now={now} thresholdDays={180} />
      </div>
      <WorkflowTimeline entries={entries} empty="No recorded activity yet." />
      <p className="mt-2 text-[11px] text-slate-400">
        Derived from this record and the child rows visible to you — not the authoritative audit log.
      </p>
    </Card>
  )
}

/* re-export the status label so callers can render lifecycle chips uniformly */
export { statusLabel }
