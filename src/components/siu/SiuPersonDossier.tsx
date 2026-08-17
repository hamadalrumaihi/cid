'use client'

/** One person, assembled from the registries.
 *
 *  ── What this is, and what it deliberately is not ─────────────────────────
 *  It is a READ. Everything on this screen already exists somewhere in CID —
 *  in `persons`, `gang_members`, `person_vehicles`, `person_places`,
 *  `account_links` — and the dossier gathers it rather than storing a second
 *  copy. That is the whole reason the watchlist now carries a foreign key: the
 *  link is what makes this view possible, and it is what keeps it current when
 *  somebody corrects a name or a gang affiliation over in CID.
 *
 *  It is NOT a place to edit any of it. Each registry has its own screens and
 *  its own policies, and giving the same fields a second editor here would
 *  produce two answers to the same question.
 *
 *  ── Fact and intelligence are shown apart ─────────────────────────────────
 *  Every link carries the qualifier the registry itself keeps — `link_status`,
 *  `confidence`, `provenance`, `ownership_confidence`. A vehicle registered to
 *  the subject and a plate an informant mentioned are both here, and the chip
 *  on each says which is which. The chip is a summary for scanning; the exact
 *  registry vocabulary is printed next to it, because collapsing "probable"
 *  and "medium confidence" into one word is a display convenience and must
 *  never be mistaken for the record.
 *
 *  ── An empty SIU section means something specific ─────────────────────────
 *  `siu_person_dossier()` is SECURITY INVOKER: an unauthorized caller gets no
 *  error, just empty arrays, because their policies returned nothing. So an
 *  absent watch means "none that you may see", never "none exists" — the same
 *  care the deconfliction panel takes. The copy below says so rather than
 *  asserting a negative the query cannot support. */

import { useCallback, useEffect, useState } from 'react'
import { withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  SIU_LINK_STRENGTH_LABEL, SIU_WATCH_PRIORITY_LABEL,
  fetchSiuPersonDossier, siuLinkStrength, siuLinkStrengthTint,
  siuWatchPriorityTint, siuWatchStatusLabel,
  type SiuDossierLink, type SiuPersonDossier,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CardGridSkeleton } from '@/components/ui/Skeleton'

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

/** The strength chip plus the registry's own words. Both, always: the chip is
 *  for scanning a list, the raw terms are the record. */
function LinkStrength({ link }: {
  link: SiuDossierLink & { ownership_confidence?: string | null; rel_status?: string | null }
}) {
  const s = siuLinkStrength(link)
  const raw = [link.link_status ?? link.rel_status, link.confidence ?? link.ownership_confidence,
               link.provenance].filter(Boolean).join(' · ')
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tint={siuLinkStrengthTint(s)}>{SIU_LINK_STRENGTH_LABEL[s]}</Badge>
      {raw && <span className="text-[11px] text-slate-500">{raw}</span>}
    </span>
  )
}

function Section({ title, count, hint, children }: {
  title: string; count?: number; hint?: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
        {count !== undefined && count > 0 && <Badge tone="neutral">{count}</Badge>}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

const Nothing = ({ children }: { children: React.ReactNode }) =>
  <p className="text-xs text-slate-500">{children}</p>

export function SiuPersonDossierModal({ personId, onClose }: {
  personId: string; onClose: () => void
}) {
  const siu = useSiu()
  const [d, setD] = useState<SiuPersonDossier | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { setD(await withRetry(() => fetchSiuPersonDossier(personId))) }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger') }
    finally { setLoading(false) }
  }, [personId])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const p = d?.person

  return (
    <Modal open onClose={onClose} slide>
      <ModalHeader title={p?.name ?? 'Dossier'} onClose={onClose} />

      {loading ? (
        <CardGridSkeleton cols="" />
      ) : !d || !p ? (
        <p className="text-sm text-slate-400">
          That record is not available to you.
        </p>
      ) : (
        <div className="space-y-3">
          {/* ── Identity ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            {p.status && <Badge tone="accent">{p.status}</Badge>}
            {p.classification && <Badge tone="neutral">{p.classification}</Badge>}
            {p.confidence && <Badge tone="neutral">Confidence: {p.confidence}</Badge>}
            {p.priority && <Badge tone="neutral">{p.priority}</Badge>}
            {p.ccw && <Badge tone="warn">CCW</Badge>}
            {!!p.felony_count && <Badge tone="neutral">{p.felony_count} felonies</Badge>}
            {p.lifecycle && p.lifecycle !== 'active' && (
              <Badge tint="bg-slate-500/15 text-slate-300">{p.lifecycle}</Badge>
            )}
          </div>
          {(p.alias || p.dob || p.phone) && (
            <p className="flex flex-wrap gap-x-4 text-xs text-slate-400">
              {p.alias && <span>Alias: {p.alias}</span>}
              {p.dob && <span>DOB: {fmtDate(p.dob)}</span>}
              {p.phone && <span>Phone: {p.phone}</span>}
            </p>
          )}

          {p.bolo.active && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
              <div className="flex items-center gap-2">
                <Badge tone="danger">BOLO</Badge>
                {p.bolo.risk && <Badge tone="warn">{p.bolo.risk}</Badge>}
                {p.bolo.expires_at && (
                  <span className="ml-auto text-[11px] text-slate-400">
                    Until {fmtDate(p.bolo.expires_at)}
                  </span>
                )}
              </div>
              {p.bolo.reason && <p className="mt-1.5 text-xs text-slate-200">{p.bolo.reason}</p>}
              {p.bolo.instructions && (
                <p className="mt-1 text-[11px] text-slate-400">{p.bolo.instructions}</p>
              )}
            </div>
          )}

          {/* ── The SIU half ─────────────────────────────────────────── */}
          {siu.isAgent && (
            <Section
              title="SIU"
              hint="Held by the unit. An empty section here means nothing you are cleared to see — not that nothing exists."
            >
              <div className="space-y-2">
                {d.watch ? (
                  <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tint={siuWatchPriorityTint(d.watch.priority)}>
                        {SIU_WATCH_PRIORITY_LABEL[d.watch.priority] ?? d.watch.priority}
                      </Badge>
                      <Badge tone="neutral">{siuWatchStatusLabel(d.watch.status)}</Badge>
                      <span className="text-xs font-semibold text-slate-100">On the watchlist</span>
                      <span className="ml-auto text-[11px] text-slate-500">
                        Until {fmtDate(d.watch.expires_at)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-300">{d.watch.reason}</p>
                    {d.watch.review_due_at && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Review due {fmtDate(d.watch.review_due_at)}
                      </p>
                    )}
                  </div>
                ) : (
                  <Nothing>No live watch you can see.</Nothing>
                )}

                {d.siu_source && (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-200/90">
                    <strong className="font-semibold">Registered source</strong> —{' '}
                    {d.siu_source.codename}
                    {d.siu_source.status ? ` (${d.siu_source.status})` : ''}. Coordinate before any
                    approach; do not task or target without the handler.
                  </p>
                )}

                {!!d.siu_targets.length && (
                  <ul className="space-y-1">
                    {d.siu_targets.map((t) => (
                      <li key={t.id} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                        <span className="font-semibold text-slate-100">
                          {t.designation ?? 'Target'}
                        </span>
                        {t.role_in_network && (
                          <span className="text-slate-400"> — {t.role_in_network}</span>
                        )}
                        {t.cleared_at && <Badge tone="neutral" className="ml-2">Cleared</Badge>}
                      </li>
                    ))}
                  </ul>
                )}

                {d.siu_intelligence.length ? (
                  <ul className="space-y-1.5">
                    {d.siu_intelligence.map((n) => (
                      <li key={n.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {n.note_type && <Badge tone="neutral">{n.note_type}</Badge>}
                          {/* 5x5x5. An ungraded note is called ungraded rather
                              than shown as if it were assessed. */}
                          {n.info_credibility
                            ? <Badge tone="accent">{n.source_reliability ?? '?'} / {n.info_credibility}</Badge>
                            : <Badge tint="bg-white/5 text-slate-400">Ungraded</Badge>}
                          {n.review_due_at && !n.resolved_at
                            && new Date(n.review_due_at) < new Date() && (
                            <Badge tone="danger">Review overdue</Badge>
                          )}
                          <span className="ml-auto text-[11px] text-slate-500">
                            {fmtDate(n.created_at)}
                          </span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-300">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Nothing>No intelligence notes name this person as the subject.</Nothing>
                )}
              </div>
            </Section>
          )}

          {/* ── Affiliation ──────────────────────────────────────────── */}
          <Section title="Gang affiliation" count={d.gang_memberships.length}>
            {d.gang ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-100">{d.gang.name}</span>
                {d.gang.threat_level && <Badge tone="warn">{d.gang.threat_level}</Badge>}
                {d.gang.confidence && (
                  <span className="text-[11px] text-slate-500">Confidence: {d.gang.confidence}</span>
                )}
              </div>
            ) : (
              <Nothing>No affiliation recorded on the person record.</Nothing>
            )}
            {!!d.gang_memberships.length && (
              <ul className="mt-2 space-y-1">
                {d.gang_memberships.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                    <span className="text-slate-100">{m.gang_name ?? 'Unknown gang'}</span>
                    {m.rank && <Badge tone="neutral">{m.rank}</Badge>}
                    {m.status && <Badge tone="neutral">{m.status}</Badge>}
                    <LinkStrength link={m} />
                    <span className="ml-auto text-[11px] text-slate-500">
                      {m.left_at ? `Left ${fmtDate(m.left_at)}` : m.joined_at ? `Since ${fmtDate(m.joined_at)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Vehicles ─────────────────────────────────────────────── */}
          <Section
            title="Vehicles"
            count={d.vehicles_registered.length + d.vehicles_linked.length}
            hint="Registered ownership and observed association are different claims and are not merged."
          >
            {!d.vehicles_registered.length && !d.vehicles_linked.length ? (
              <Nothing>No vehicles recorded.</Nothing>
            ) : (
              <ul className="space-y-1">
                {d.vehicles_registered.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                    <span className="font-mono font-semibold text-slate-100">{v.plate}</span>
                    <span className="text-slate-400">{[v.color, v.model].filter(Boolean).join(' ')}</span>
                    <Badge tint="bg-emerald-500/15 text-emerald-300" className="ml-auto">
                      Registered owner
                    </Badge>
                  </li>
                ))}
                {d.vehicles_linked.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                    <span className="font-mono font-semibold text-slate-100">{v.plate}</span>
                    <span className="text-slate-400">{[v.color, v.model].filter(Boolean).join(' ')}</span>
                    {v.role && <Badge tone="neutral">{v.role}</Badge>}
                    <span className="ml-auto"><LinkStrength link={v} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Places ───────────────────────────────────────────────── */}
          <Section title="Locations" count={d.places.length}>
            {!d.places.length ? (
              <Nothing>No locations recorded.</Nothing>
            ) : (
              <ul className="space-y-1">
                {d.places.map((pl) => (
                  <li key={pl.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                    <span className="text-slate-100">{pl.name}</span>
                    {pl.role && <Badge tone="neutral">{pl.role}</Badge>}
                    {pl.area && <span className="text-[11px] text-slate-500">{pl.area}</span>}
                    <span className="ml-auto"><LinkStrength link={pl} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Online ───────────────────────────────────────────────── */}
          <Section
            title="Online accounts"
            count={d.accounts.length}
            hint="Ownership confidence is the registry's own — an account believed to be theirs must not read as one that is."
          >
            {!d.accounts.length ? (
              <Nothing>No accounts linked to this person.</Nothing>
            ) : (
              <ul className="space-y-1">
                {d.accounts.map((a) => (
                  <li key={a.link_id} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.platform && <Badge tone="neutral">{a.platform}</Badge>}
                      <span className="font-semibold text-slate-100">
                        {a.handle ?? a.display_name ?? 'Unnamed account'}
                      </span>
                      {a.is_impersonation && <Badge tone="warn">Impersonation</Badge>}
                      {a.is_compromised && <Badge tone="warn">Compromised</Badge>}
                      {a.restricted && <Badge tone="danger">Restricted</Badge>}
                      <span className="ml-auto">
                        <LinkStrength link={{ ownership_confidence: a.ownership_confidence,
                                              provenance: a.source }} />
                      </span>
                    </div>
                    {a.handles.length > 1 && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Also seen as{' '}
                        {a.handles.filter((h) => !h.is_current).map((h) => h.handle).join(', ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Associates ───────────────────────────────────────────── */}
          <Section title="Associates" count={d.relationships.length}>
            {!d.relationships.length ? (
              <Nothing>No relationships recorded.</Nothing>
            ) : (
              <ul className="space-y-1">
                {d.relationships.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                    <span className="text-slate-100">{r.other_name}</span>
                    {r.relationship && <Badge tone="neutral">{r.relationship}</Badge>}
                    <span className="ml-auto"><LinkStrength link={r} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {!!d.narcotics.length && (
            <Section title="Narcotics" count={d.narcotics.length}>
              <ul className="space-y-1">
                {d.narcotics.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                    <span className="text-slate-100">{n.name}</span>
                    {n.role && <Badge tone="neutral">{n.role}</Badge>}
                    <span className="ml-auto"><LinkStrength link={n} /></span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!!d.surveillance.length && (
            <Section
              title="Surveillance"
              count={d.surveillance.length}
              hint="The 25 most recent observations you are cleared to see."
            >
              <ul className="space-y-1">
                {d.surveillance.map((s) => (
                  <li key={s.id} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-300">{s.location_text ?? 'Location not recorded'}</span>
                      {s.verification_status && <Badge tone="neutral">{s.verification_status}</Badge>}
                      {s.restricted && <Badge tone="danger">Restricted</Badge>}
                      <span className="ml-auto text-[11px] text-slate-500">{fmtDate(s.observed_at)}</span>
                    </div>
                    {s.activity && <p className="mt-1 text-[11px] text-slate-400">{s.activity}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            Everything here is read from the shared registries and the unit&apos;s own records. It is
            not editable from this view — each record has its own screen and its own permissions, and
            a second editor here would produce two answers to the same question.
          </p>
        </div>
      )}
    </Modal>
  )
}
