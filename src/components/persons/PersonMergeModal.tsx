'use client'

/** Review duplicates + merge (command-only execution). Duplicate clusters are
 *  surfaced by the pure `findDuplicatePersons` detector with the exact signals
 *  that flagged them; merging goes through the server-authoritative
 *  `person_merge` RPC (command-gated, tombstones the victims — nothing is ever
 *  deleted). Non-command members can review clusters but see no merge
 *  controls. */
import { useEffect, useMemo, useState } from 'react'
import { countRows, list, rpc } from '@/lib/db'
import { fmtDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { humanize } from '@/components/gangs/gangIntel'
import {
  MERGE_REPOINT_TABLES, findDuplicatePersons, planPersonMerge, type DuplicateCluster,
} from './personIntel'
import type { PersonRow } from './PersonModal'

/** Per-victim child-row counts keyed the way planPersonMerge expects:
 *  counts[victimId][table]. HEAD count queries only — no rows are fetched.
 *  Table keys follow MERGE_REPOINT_TABLES (the RPC's repoint order). */
async function countRepoints(victimIds: string[]): Promise<Record<string, Record<string, number>>> {
  const c = (p: Promise<number>) => p.catch(() => 0)
  const out: Record<string, Record<string, number>> = {}
  await Promise.all(victimIds.map(async (id) => {
    const [gm, media, legal, mdt, veh, cil, pp, pv, relA, relB, wl] = await Promise.all([
      c(countRows('gang_members', { eq: { person_id: id } })),
      c(countRows('media', { eq: { person_id: id } })),
      c(countRows('legal_requests', { eq: { person_id: id } })),
      c(countRows('mdt_wanted_projections', { eq: { person_id: id } })),
      c(countRows('vehicles', { eq: { owner_id: id } })),
      c(countRows('case_intel_links', { eq: { kind: 'person', ref_id: id } })),
      c(countRows('person_places', { eq: { person_id: id } })),
      c(countRows('person_vehicles', { eq: { person_id: id } })),
      c(countRows('person_relationships', { eq: { person_a: id } })),
      c(countRows('person_relationships', { eq: { person_b: id } })),
      c(countRows('watchlist', { eq: { target_type: 'person', target_id: id } })),
    ])
    out[id] = {
      gang_members: gm, media, legal_requests: legal, mdt_wanted_projections: mdt, vehicles: veh,
      case_intel_links: cil, person_places: pp, person_vehicles: pv, person_relationships: relA + relB, watchlist: wl,
    }
  }))
  return out
}

const TABLE_LABEL: Record<(typeof MERGE_REPOINT_TABLES)[number], string> = {
  gang_members: 'Gang roster entries',
  media: 'Media items',
  legal_requests: 'Legal requests',
  mdt_wanted_projections: 'MDT wanted projections',
  vehicles: 'Registered vehicles',
  case_intel_links: 'Case intel links',
  person_places: 'Place links',
  person_vehicles: 'Vehicle links',
  person_relationships: 'Relationships',
  watchlist: 'Watchlist follows',
}

const fmtVal = (v: string): string => (v.trim() ? v : '—')

export function PersonDuplicatesModal({ person, isCommand, onClose, onMerged }: {
  person: PersonRow
  isCommand: boolean
  onClose: () => void
  onMerged: (survivorId: string) => void
}) {
  const [pool, setPool] = useState<PersonRow[] | null>(null)
  const [linkRows, setLinkRows] = useState<{
    vehicles: Array<{ person_id: string; vehicle_id: string }>
    places: Array<{ person_id: string; place_id: string }>
  }>({ vehicles: [], places: [] })
  const [survivorId, setSurvivorId] = useState(person.id)
  /** null = "default selection" (everyone in the cluster except the survivor);
   *  a Set once the reviewer has touched the checkboxes. */
  const [victimSel, setVictimSel] = useState<ReadonlySet<string> | null>(null)
  const [countsState, setCountsState] = useState<{ key: string; data: Record<string, Record<string, number>> } | null>(null)
  const [reason, setReason] = useState('')
  const [step, setStep] = useState<'review' | 'confirm'>('review')
  const [busy, setBusy] = useState(false)

  // The registry pool + shared-link rows are fetched on open only (never as
  // part of the profile load) — duplicate detection needs the full pool.
  useEffect(() => {
    let live = true
    void Promise.all([
      list('persons', { order: 'name' }).catch(() => [] as PersonRow[]),
      list('person_vehicles', { select: 'person_id,vehicle_id' })
        .then((r) => r as unknown as Array<{ person_id: string; vehicle_id: string }>).catch(() => []),
      list('person_places', { select: 'person_id,place_id' })
        .then((r) => r as unknown as Array<{ person_id: string; place_id: string }>).catch(() => []),
    ]).then(([rows, vehicles, places]) => {
      if (!live) return
      setPool(rows.filter((r) => r.lifecycle !== 'merged'))
      setLinkRows({ vehicles, places })
    })
    return () => { live = false }
  }, [])

  // Only clusters containing THIS person are relevant here.
  const cluster: DuplicateCluster | null = useMemo(() => {
    if (!pool) return null
    return findDuplicatePersons(pool, linkRows).find((c) => c.ids.includes(person.id)) ?? null
  }, [pool, linkRows, person.id])

  const members: PersonRow[] = useMemo(() => {
    if (!pool || !cluster) return []
    const byId = new Map(pool.map((p) => [p.id, p]))
    return cluster.ids.map((cid) => byId.get(cid)).filter((x): x is PersonRow => !!x)
  }, [pool, cluster])

  // Default: current person survives, every other cluster member is a victim.
  const victimIds: ReadonlySet<string> = useMemo(
    () => victimSel ?? new Set((cluster?.ids ?? []).filter((cid) => cid !== survivorId)),
    [victimSel, cluster, survivorId],
  )

  const survivor = members.find((m) => m.id === survivorId) ?? person
  const victims = members.filter((m) => victimIds.has(m.id) && m.id !== survivorId)

  // Recount repoints whenever the victim set changes (HEAD counts only).
  // Counts are keyed by the victim-id set so a stale response never renders.
  const victimKey = victims.map((v) => v.id).join(',')
  useEffect(() => {
    if (!victimKey) return
    let live = true
    void countRepoints(victimKey.split(',')).then((data) => { if (live) setCountsState({ key: victimKey, data }) })
    return () => { live = false }
  }, [victimKey])
  const counts = countsState && countsState.key === victimKey ? countsState.data : null

  const plan = useMemo(
    () => (victims.length ? planPersonMerge(survivor, victims, counts ?? {}) : null),
    [survivor, victims, counts],
  )
  const nameOf = (pid: string) => members.find((m) => m.id === pid)?.name ?? 'record'

  const toggleVictim = (id: string) => {
    const next = new Set(victimIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setVictimSel(next)
  }

  const pickSurvivor = (id: string) => {
    setSurvivorId(id)
    const next = new Set(victimIds)
    next.delete(id)
    setVictimSel(next)
    setStep('review')
  }

  const merge = async () => {
    if (!victims.length) return
    if (!reason.trim()) { toast('A reason is required to merge person records.', 'warn'); return }
    setBusy(true)
    const res = await rpc('person_merge', { p_survivor: survivor.id, p_victims: victims.map((v) => v.id), p_reason: reason.trim() })
    setBusy(false)
    if (res.error) { toast(`Merge failed: ${res.error.message}`, 'danger'); return }
    toast(`Merged ${victims.length} record${victims.length === 1 ? '' : 's'} into ${survivor.name}`, 'success')
    onMerged(survivor.id)
  }

  return (
    <Modal open wide onClose={onClose} dirty={() => !!reason.trim()}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title="Review duplicates" onClose={onClose} />

        {pool === null ? (
          <p className="text-sm text-slate-400">Scanning the registry for likely duplicates…</p>
        ) : !cluster ? (
          <p className="text-sm text-slate-400">
            No likely duplicates found for <span className="text-white">{person.name}</span>. Detection compares normalized names, DOBs, phones, mugshots, aliases and shared vehicle/place links — it never merges anything by itself.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-300/80">
                Why these records were flagged
                <Badge tint={cluster.confidence === 'strong' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'} className="uppercase">
                  {cluster.confidence}
                </Badge>
              </p>
              <ul className="mt-1 space-y-0.5">
                {cluster.signals.map((s, i) => (
                  <li key={i} className="text-xs text-slate-300">• {s.detail}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-1.5">
              {members.map((m) => {
                const isSurvivor = m.id === survivorId
                const isVictim = victimIds.has(m.id) && !isSurvivor
                return (
                  <div key={m.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${isSurvivor ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/5 bg-ink-900'}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {m.name}{m.alias ? <span className="font-normal text-slate-400"> · “{m.alias}”</span> : null}
                        {m.id === person.id && <span className="ml-1.5 text-[10px] uppercase text-slate-500">(this profile)</span>}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {m.phone ? `${m.phone} · ` : ''}{m.dob ? `DOB ${m.dob} · ` : ''}Added {fmtDate(m.created_at)} · Updated {fmtDate(m.updated_at)}
                      </p>
                    </div>
                    {isCommand && (
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {isSurvivor ? (
                          <Badge tone="good" className="uppercase">Survivor</Badge>
                        ) : (
                          <>
                            <Button size="sm" onClick={() => pickSurvivor(m.id)} title="Keep this record and merge the others into it">Keep this one</Button>
                            <label className="flex items-center gap-1.5 text-xs text-slate-300">
                              <input type="checkbox" checked={isVictim} onChange={() => toggleVictim(m.id)} className="h-4 w-4 accent-rose-500" aria-label={`Merge ${m.name} into the survivor`} />
                              merge
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {!isCommand ? (
              <p className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-xs text-slate-400">
                Merging is restricted to command (Bureau Lead or higher). Flag this cluster to your lead if these are the same person.
              </p>
            ) : !victims.length ? (
              <p className="text-xs text-slate-400">Tick at least one record to merge into the survivor.</p>
            ) : (
              <>
                {plan && plan.fieldConflicts.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Field differences — the survivor&rsquo;s value is kept; differing victim values are surfaced here so nothing is lost silently
                    </p>
                    <div className="space-y-1">
                      {plan.fieldConflicts.map((c, i) => (
                        <div key={i} className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-ink-900 px-2.5 py-1.5 text-xs">
                          <span className="font-semibold text-slate-300">{humanize(c.field)}:</span>
                          <span className="text-emerald-300">keeps “{fmtVal(c.survivorValue)}”</span>
                          <span className="text-slate-400">
                            vs {c.victimValues.map((v) => `“${fmtVal(v.value)}” (${nameOf(v.id)})`).join(', ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Linked records that will repoint to {survivor.name}</p>
                  {counts === null ? (
                    <p className="text-xs text-slate-400">Counting linked records…</p>
                  ) : plan && plan.willRepoint.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {plan.willRepoint.map((r) => (
                        <Badge key={r.table} tone="neutral">{TABLE_LABEL[r.table as (typeof MERGE_REPOINT_TABLES)[number]] ?? humanize(r.table)}: {r.count}</Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">No linked records to move.</span>
                  )}
                </div>

                <Field label="Reason (required — recorded in the audit trail)" required>
                  {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="E.g. duplicate intake from MDT import; same subject confirmed by DOB + phone." />}
                </Field>

                {step === 'review' ? (
                  <Button variant="warn" className="w-full" disabled={!reason.trim() || counts === null} onClick={() => setStep('confirm')}>
                    Review merge of {victims.length} record{victims.length === 1 ? '' : 's'}…
                  </Button>
                ) : (
                  <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
                    <p className="text-sm text-slate-200">
                      Merge <span className="font-semibold text-white">{victims.map((v) => v.name).join(', ')}</span> into{' '}
                      <span className="font-semibold text-white">{survivor.name}</span>? The merged records become read-only tombstones pointing at the survivor — nothing is deleted.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="danger" className="flex-1" loading={busy} onClick={() => void merge()}>
                        Merge {victims.length} record{victims.length === 1 ? '' : 's'}
                      </Button>
                      <Button variant="secondary" disabled={busy} onClick={() => setStep('review')}>Back</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
