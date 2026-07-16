'use client'

/** Person dossier — Relationships and Cases sections plus their modals.
 *  Relationships render person_relationships rows from BOTH directions with
 *  type/status/confidence/provenance filters; gang membership (persons.gang_id
 *  + gang_members) is listed in the same section. Cases keep the durable
 *  case_intel_links as the primary list and show indirect associations
 *  (gang-roster / media case ids) distinctly labelled — never summed into an
 *  unlabelled count. */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { insert, list, remove, rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { statusTint } from '@/lib/tint'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EntityLink } from '@/components/ui/EntityLink'
import { Field, Input, Select } from '@/components/ui/Field'
import { ConfidenceBadge, ProvenanceBadge } from '@/components/ui/IntelBadges'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { PROVENANCE_KINDS, humanize } from '@/components/gangs/gangIntel'
import { CONFIDENCE_LEVELS, LINK_STATUSES, RELATIONSHIP_TYPES, linkStatusLabel, relationshipLabel } from './personIntel'
import type { GangRow, PersonRow } from './PersonModal'
import {
  PERSON_LITE_COLS,
  type CasesData, type IntelLinkRow, type PersonLite, type RelationsData, type RelationshipRow,
} from './profileLoad'

// ── Relationships ─────────────────────────────────────────────────────────────
export function RelationshipsSection({ personId, gang, data, canEdit, onLink, onRefresh }: {
  personId: string
  gang: GangRow | null
  data: RelationsData
  canEdit: boolean
  onLink: () => void
  onRefresh: () => void
}) {
  const router = useRouter()
  const { profile, isCommand } = useAuth()
  const [type, setType] = useState('any')
  const [conf, setConf] = useState('any')
  const [prov, setProv] = useState('any')
  const [status, setStatus] = useState('any')

  const rows = data.rows.filter((r) =>
    (type === 'any' || r.relationship === type)
    && (conf === 'any' || (r.confidence ?? 'unverified') === conf)
    && (prov === 'any' || (r.provenance ?? '') === prov)
    && (status === 'any' || r.rel_status === status))

  const unlink = async (r: RelationshipRow) => {
    if (!(await uiConfirm('Remove this relationship link? Prefer marking it Historical if it simply ended.', { confirmText: 'Unlink' }))) return
    const res = await remove('person_relationships', r.id)
    if (res.error) { toast(`Unlink failed: ${res.error.message}`, 'danger'); return }
    toast('Relationship removed', 'success')
    onRefresh()
  }

  const sel = 'rounded-lg border border-white/10 bg-ink-850 px-2.5 py-1.5 text-xs text-slate-200'
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Known associates</h3><Badge>{data.rows.length}</Badge></div>
        {canEdit && <Button size="sm" onClick={onLink}>Link associate</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Relationship type" value={type} onChange={(e) => setType(e.target.value)} className={sel}>
          <option value="any">Any type</option>
          {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{relationshipLabel(t)}</option>)}
        </select>
        <select aria-label="Confidence" value={conf} onChange={(e) => setConf(e.target.value)} className={sel}>
          <option value="any">Any confidence</option>
          {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
        </select>
        <select aria-label="Source" value={prov} onChange={(e) => setProv(e.target.value)} className={sel}>
          <option value="any">Any source</option>
          {PROVENANCE_KINDS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
          <option value="any">Any status</option>
          {LINK_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </div>

      {!data.rows.length ? (
        <EmptyState title="No relationships recorded" hint={canEdit ? 'Use “Link associate” to connect this person to another record.' : undefined} />
      ) : !rows.length ? (
        <p className="rounded-xl border border-white/5 bg-ink-900/60 p-4 text-sm text-slate-400">No relationships match these filters.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const otherId = r.person_a === personId ? r.person_b : r.person_a
            const other: PersonLite | undefined = data.people.get(otherId)
            const linkedBy = officerName(r.created_by)
            return (
              <Card key={r.id} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EntityLink kind="person" id={otherId} label={other?.name ?? 'Person'} />
                    <Badge tone="accent">{relationshipLabel(r.relationship)}</Badge>
                    <Badge tint={r.rel_status === 'current' ? 'bg-emerald-500/15 text-emerald-300' : r.rel_status === 'disputed' ? 'bg-rose-500/15 text-rose-300' : 'bg-white/5 text-slate-400'}>
                      {linkStatusLabel(r.rel_status)}
                    </Badge>
                    <ConfidenceBadge confidence={r.confidence} />
                    <ProvenanceBadge provenance={r.provenance} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {other?.alias ? `“${other.alias}” · ` : ''}
                    {r.first_observed ? `First seen ${fmtDate(r.first_observed)} · ` : ''}
                    {r.last_confirmed ? `Confirmed ${fmtDate(r.last_confirmed)} · ` : ''}
                    Linked {fmtDate(r.created_at)}{linkedBy ? ` by ${linkedBy}` : ''}
                  </p>
                  {r.note && <p className="mt-0.5 text-xs text-slate-400">{r.note}</p>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button onClick={() => router.push(`/network?focus=p:${encodeURIComponent(otherId)}`)} className="text-[11px] font-semibold text-blue-300 hover:text-blue-200" title="Open in the relationship network">Graph</button>
                  {(isCommand || (r.created_by && r.created_by === profile?.id)) && (
                    <button onClick={() => void unlink(r)} className="text-[11px] text-rose-300 hover:text-rose-200">Unlink</button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Gang membership — persons.gang_id + gang_members rows, same section. */}
      {(gang || data.memberships.length > 0) && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Gang membership</p>
          <div className="space-y-1.5">
            {gang && (
              <Card pad="sm" className="flex flex-wrap items-center gap-1.5">
                <EntityLink kind="gang" id={gang.id} label={gang.name} />
                <span className="text-[11px] text-slate-400">Primary affiliation (person record)</span>
              </Card>
            )}
            {data.memberships.map((m) => (
              <Card key={m.id} pad="sm" className="flex flex-wrap items-center gap-1.5">
                <EntityLink kind="gang" label={(m.gang_id && data.gangNames.get(m.gang_id)) || 'Gang'} id={m.gang_id ?? undefined} />
                <span className="text-xs text-slate-300">{m.rank || m.status || 'member'}</span>
                {m.provenance && <ProvenanceBadge provenance={m.provenance} />}
                {m.case_id && <span className="text-[11px] text-slate-500">via roster entry on a case</span>}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Link associate — person search via the indexed, RLS-safe `search_persons`
 *  RPC, then a controlled relationship vocabulary. Inverse duplicates are
 *  blocked server-side (canonical-pair UNIQUE) → friendly 23505 message. */
export function LinkAssociateModal({ person, onClose, onSaved }: { person: PersonRow; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PersonLite[]>([])
  const [searching, setSearching] = useState(false)
  const [otherId, setOtherId] = useState('')
  const [relationship, setRelationship] = useState<string>('associate')
  const [relStatus, setRelStatus] = useState('current')
  const [confidence, setConfidence] = useState('')
  const [provenance, setProvenance] = useState('')
  const [note, setNote] = useState('')
  const [firstObs, setFirstObs] = useState('')
  const [lastConf, setLastConf] = useState('')
  const [busy, setBusy] = useState(false)

  const search = async () => {
    const query = q.trim()
    if (query.length < 2) { toast('Type at least 2 characters to search.', 'warn'); return }
    setSearching(true)
    try {
      const res = await rpc('search_persons', { p_q: query, p_limit: 12 })
      const hits = (res.data ?? []).map((h) => h.id).filter((hid) => hid !== person.id)
      if (!hits.length) { setResults([]); return }
      const rows = await list('persons', { select: PERSON_LITE_COLS, in: { id: hits } })
        .then((r) => r as unknown as PersonLite[]).catch(() => [] as PersonLite[])
      const order = new Map(hits.map((hid, i) => [hid, i]))
      setResults(rows
        .filter((r) => r.lifecycle !== 'merged')
        .sort((x, y) => (order.get(x.id) ?? 99) - (order.get(y.id) ?? 99)))
    } finally { setSearching(false) }
  }

  const save = async () => {
    if (!otherId) { toast('Pick the related person first.', 'warn'); return }
    setBusy(true)
    const res = await insert('person_relationships', {
      person_a: person.id,
      person_b: otherId,
      relationship,
      rel_status: relStatus,
      confidence: confidence || null,
      provenance: provenance || null,
      note: note.trim() || null,
      first_observed: firstObs || null,
      last_confirmed: lastConf || null,
    })
    setBusy(false)
    if (res.error) {
      toast(res.error.code === '23505' ? 'These two already have that relationship on file.' : `Link failed: ${res.error.message}`, 'danger')
      return
    }
    toast('Associate linked', 'success')
    onSaved()
  }

  const selected = results.find((r) => r.id === otherId)
  return (
    <Modal open wide onClose={onClose} dirty={() => !!otherId || !!note.trim()}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title={`Link associate — ${person.name}`} onClose={onClose} />
        <div className="space-y-3">
          <Field label="Find person" hint="Searches names, aliases, phones, plates and linked records.">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search() } }} placeholder="Name, alias, phone…" />
                <Button loading={searching} onClick={() => void search()}>Search</Button>
              </div>
            )}
          </Field>
          {results.length > 0 && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-white/5 bg-ink-900 p-1.5" role="listbox" aria-label="Search results">
              {results.map((r) => (
                <button key={r.id} role="option" aria-selected={otherId === r.id} onClick={() => setOtherId(r.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${otherId === r.id ? 'bg-badge-500/20 text-white' : 'text-slate-200 hover:bg-white/5'}`}>
                  <span className="min-w-0 truncate">{r.name}{r.alias ? <span className="text-slate-400"> · “{r.alias}”</span> : null}</span>
                  {otherId === r.id && <span aria-hidden className="flex-shrink-0 text-badge-500">✓</span>}
                </button>
              ))}
            </div>
          )}
          {selected && <p className="text-xs text-slate-400">Linking <span className="text-white">{person.name}</span> ↔ <span className="text-white">{selected.name}</span></p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Relationship" required>
              {(id) => (
                <Select id={id} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                  {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{relationshipLabel(t)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(id) => (
                <Select id={id} value={relStatus} onChange={(e) => setRelStatus(e.target.value)}>
                  {LINK_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Confidence">
              {(id) => (
                <Select id={id} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                  <option value="">—</option>
                  {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Source">
              {(id) => (
                <Select id={id} value={provenance} onChange={(e) => setProvenance(e.target.value)}>
                  <option value="">—</option>
                  {PROVENANCE_KINDS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="First observed">{(id) => <Input id={id} type="date" value={firstObs} onChange={(e) => setFirstObs(e.target.value)} />}</Field>
            <Field label="Last confirmed">{(id) => <Input id={id} type="date" value={lastConf} onChange={(e) => setLastConf(e.target.value)} />}</Field>
          </div>
          <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How is this known?" />}</Field>
          <Button variant="primary" className="w-full" loading={busy} disabled={!otherId} onClick={() => void save()}>Link associate</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Cases ─────────────────────────────────────────────────────────────────────
export function CasesSection({ data, canEdit, onAttach, onRefresh }: {
  data: CasesData
  canEdit: boolean
  onAttach: () => void
  onRefresh: () => void
}) {
  const router = useRouter()

  const unlink = async (l: IntelLinkRow) => {
    if (!(await uiConfirm('Remove this durable case link?', { confirmText: 'Unlink' }))) return
    const res = await remove('case_intel_links', l.id)
    if (res.error) { toast(`Unlink failed: ${res.error.message}`, 'danger'); return }
    toast('Case link removed', 'success')
    onRefresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Linked cases</h3><Badge>{data.links.length}</Badge></div>
        {canEdit && <Button size="sm" onClick={onAttach}>Attach to case</Button>}
      </div>
      {!data.links.length ? (
        <EmptyState title="No durable case links" hint={canEdit ? 'Attach this person to a case — it creates a structured intel link, not just a chat note.' : undefined} />
      ) : (
        <div className="space-y-2">
          {data.links.map((l) => {
            const c = data.cases.get(l.case_id)
            const linkedBy = officerName(l.created_by)
            return (
              <Card key={l.id} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  {c ? (
                    <button onClick={() => router.push(`/cases?case=${encodeURIComponent(c.id)}`)} className="text-left text-sm font-semibold text-white hover:text-blue-200">
                      <span className="font-mono text-blue-300">{c.case_number}</span>{c.title ? <span className="font-normal text-slate-400"> · {c.title}</span> : null}
                    </button>
                  ) : (
                    /* RLS returned nothing for this id — the established
                       access-restricted stub, with NO title/bureau/status. */
                    <p className="text-sm text-slate-400">Linked case — access restricted (other bureau).</p>
                  )}
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    <Badge tone="accent" title="Durable case_intel_links row">Intel link</Badge>
                    {c?.status && <Badge tint={statusTint(c.status)}>{humanize(c.status)}</Badge>}
                    {c?.bureau && <span>{c.bureau}</span>}
                    {l.role && <span>· Role: {l.role}</span>}
                    {c?.lead_detective_id && officerName(c.lead_detective_id) && <span>· Lead {officerName(c.lead_detective_id)}</span>}
                    <span>· Linked {fmtDate(l.created_at)}{linkedBy ? ` by ${linkedBy}` : ''}</span>
                  </p>
                  {l.note && <p className="mt-0.5 text-xs text-slate-400">{l.note}</p>}
                </div>
                {canEdit && <button onClick={() => void unlink(l)} className="flex-shrink-0 text-[11px] text-rose-300 hover:text-rose-200">Unlink</button>}
              </Card>
            )
          })}
        </div>
      )}
      {data.indirect.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Indirect associations ({data.indirect.length}) — not durable intel links
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.indirect.map((i) => {
              const c = data.cases.get(i.caseId)
              return c
                ? <EntityLink key={`${i.caseId}-${i.via}`} kind="case" id={i.caseId} label={`${c.case_number} · via ${i.via}`} title={`Referenced through a ${i.via} record — not a durable intel link`} />
                : (
                  <span key={`${i.caseId}-${i.via}`} className="rounded-md border border-white/5 bg-ink-900 px-2 py-0.5 text-xs text-slate-400">
                    Restricted case · via {i.via}
                  </span>
                )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface CaseOption { id: string; case_number: string; title: string | null }

/** Durable attach-to-case — mirrors AttachGangModal but for kind='person'.
 *  Fetches its own slim case options on open (no full-table load upstream). */
export function AttachPersonModal({ person, onClose, onSaved }: { person: PersonRow; onClose: () => void; onSaved: () => void }) {
  const [cases, setCases] = useState<CaseOption[] | null>(null)
  const [caseId, setCaseId] = useState('')
  const [role, setRole] = useState('Subject')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Load options once per open (mounted fresh per open, like PersonModal).
  useEffect(() => {
    let live = true
    void list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false })
      .then((r) => {
        if (!live) return
        const rows = (r as unknown as CaseOption[]).slice().sort((a, b) => (a.case_number || '').localeCompare(b.case_number || ''))
        setCases(rows)
        setCaseId((cur) => cur || rows[0]?.id || '')
      })
      .catch(() => { if (live) setCases([]) })
    return () => { live = false }
  }, [])

  const go = async () => {
    if (!caseId) return
    setBusy(true)
    const existing = await list('case_intel_links', { eq: { case_id: caseId, kind: 'person', ref_id: person.id } }).catch(() => [])
    if (existing.length) { toast('This person is already linked to that case.', 'warn'); setBusy(false); return }
    const res = await insert('case_intel_links', { case_id: caseId, kind: 'person', ref_id: person.id, role: role.trim() || null, note: note.trim() || null })
    setBusy(false)
    if (res.error) { toast(`Attach failed: ${res.error.message}`, 'danger'); return }
    const num = cases?.find((c) => c.id === caseId)?.case_number || 'case'
    toast(`${person.name || 'Person'} linked to ${num}`, 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Attach to case" onClose={onClose} />
        <p className="mb-3 text-sm text-slate-400">
          Creates a durable intel link (shows in the case&rsquo;s Intel &amp; Graph tabs) for <span className="text-white">{person.name}</span>.
        </p>
        {cases === null ? (
          <p className="text-sm text-slate-400">Loading cases…</p>
        ) : cases.length ? (
          <div className="space-y-3">
            <Field label="Case">
              {(id) => (
                <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                  {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number} · {c.title || ''}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Role in the case">{(id) => <Input id={id} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Subject, suspect, witness…" />}</Field>
            <Field label="Note (optional)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <Button variant="primary" className="w-full" loading={busy} onClick={() => void go()}>Create case link</Button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No cases available to attach to.</p>
        )}
      </div>
    </Modal>
  )
}
