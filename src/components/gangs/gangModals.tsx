'use client'

import { useEffect, useMemo, useState } from 'react'
import { insert, list, update } from '@/lib/db'
import type { TablesInsert } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { toast } from '@/lib/toast'
import { safeUrl } from '@/lib/safeUrl'
import { fmConfigured, fmUpload } from '@/lib/fivemanage'
import { parseIntelSummary } from '@/lib/jsonShapes'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import {
  CONFIDENCE_LEVELS, GANG_CLASSIFICATIONS, GANG_STATUSES, PROVENANCE_KINDS, SUMMARY_SECTIONS, TURF_STATUSES, humanize,
} from './gangIntel'
import { RANK_SUGGEST, type CaseOption, type Density, type GangPlaceRow, type GangRow, type MemberRow, type PersonRow, type PlaceRow, type ThreatLevel } from './gangShared'

const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'
const label = 'mb-1 block text-xs font-semibold text-slate-400'
interface Officer { id: string; display_name: string | null }

export function GangModal({ record, onClose, onSaved }: { record: GangRow | null; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [name, setName] = useState(record?.name || '')
  const [aliases, setAliases] = useState(record?.aliases || '')
  const [colors, setColors] = useState(record?.colors || '')
  const [threat, setThreat] = useState<ThreatLevel>(record?.threat_level || 'medium')
  const [classification, setClassification] = useState(record?.classification || '')
  const [status, setStatus] = useState(record?.status || '')
  const [confidence, setConfidence] = useState(record?.confidence || '')
  const [lead, setLead] = useState(record?.lead_detective_id || '')
  const [notes, setNotes] = useState(record?.notes || '')
  const [summary, setSummary] = useState<Record<string, string>>(() => parseIntelSummary(record?.intelligence_summary))
  const [officers, setOfficers] = useState<Officer[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void list('profiles', { select: 'id,display_name', order: 'display_name' })
      .then((r) => setOfficers(r as unknown as Officer[]))
      .catch(() => setOfficers([]))
  }, [])

  const setSection = (k: string, v: string) => setSummary((s) => ({ ...s, [k]: v }))

  const save = async (markReviewed = false) => {
    if (!name.trim()) { toast('Gang name is required.', 'warn'); return }
    setBusy(true)
    const cleanSummary: Record<string, string> = {}
    for (const [k, v] of Object.entries(summary)) if (v.trim()) cleanSummary[k] = v.trim()
    const payload: TablesInsert<'gangs'> = {
      name: name.trim(),
      aliases: aliases.trim() || null,
      colors: colors.trim() || null,
      threat_level: threat,
      classification: classification || null,
      status: status || null,
      confidence: confidence || null,
      lead_detective_id: lead || null,
      notes: notes.trim() || null,
      intelligence_summary: cleanSummary,
    }
    if (markReviewed) {
      payload.reviewed_at = new Date().toISOString()
      payload.reviewed_by = profile?.id ?? null
      payload.next_review_at = new Date(Date.now() + 90 * 86_400_000).toISOString()
    }
    const res = record ? await update('gangs', record.id, payload) : await insert('gangs', payload)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Gang updated' : 'Gang created', 'success')
    onSaved()
  }

  return (
    <Modal open wide onClose={onClose}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Gang`} onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label htmlFor="gang-name" className={label}>Name *</label><input id="gang-name" value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
          <div><label htmlFor="gang-aliases" className={label}>Aliases</label><input id="gang-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="OneS, 1s" className={input} /></div>
          <div><label htmlFor="gang-colors" className={label}>Colors</label><input id="gang-colors" value={colors} onChange={(e) => setColors(e.target.value)} placeholder="Black and Gold" className={input} /></div>
          <div>
            <label htmlFor="gang-class" className={label}>Classification</label>
            <select id="gang-class" value={classification} onChange={(e) => setClassification(e.target.value)} className={input}>
              <option value="">—</option>
              {GANG_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="gang-threat" className={label}>Threat Level</label>
            <select id="gang-threat" value={threat} onChange={(e) => setThreat(e.target.value as ThreatLevel)} className={input}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </div>
          <div>
            <label htmlFor="gang-status" className={label}>Lifecycle status</label>
            <select id="gang-status" value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
              <option value="">—</option>
              {GANG_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="gang-conf" className={label}>Intel confidence</label>
            <select id="gang-conf" value={confidence} onChange={(e) => setConfidence(e.target.value)} className={input}>
              <option value="">—</option>
              {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="gang-lead" className={label}>Lead detective</label>
            <select id="gang-lead" value={lead} onChange={(e) => setLead(e.target.value)} className={input}>
              <option value="">— unassigned —</option>
              {lead && !officers.some((o) => o.id === lead) && <option value={lead}>(assigned officer)</option>}
              {officers.map((o) => <option key={o.id} value={o.id}>{o.display_name || o.id.slice(0, 8)}</option>)}
            </select>
          </div>
        </div>

        <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Structured intelligence</p>
        <div className="space-y-2">
          {SUMMARY_SECTIONS.map((s) => (
            <div key={s.key}>
              <label htmlFor={`sum-${s.key}`} className={label}>{s.label}</label>
              <textarea id={`sum-${s.key}`} rows={2} value={summary[s.key] || ''} onChange={(e) => setSection(s.key, e.target.value)} className={input} />
            </div>
          ))}
        </div>

        <div className="mt-3">
          <label htmlFor="gang-notes" className={label}>Original / imported notes (preserved verbatim)</label>
          <textarea id="gang-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={() => void save(false)} disabled={busy} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
            {busy ? 'Saving…' : record ? 'Save changes' : 'Create gang'}
          </button>
          {record && <button onClick={() => void save(true)} disabled={busy} title="Save and stamp reviewed now (+90d next review)" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60">Save &amp; mark reviewed</button>}
        </div>
      </div>
    </Modal>
  )
}

export function MemberModal({ gangId, member, people, cases, canDelete, onClose, onSaved, onDelete }: {
  gangId: string
  member: MemberRow | null
  people: PersonRow[]
  cases: CaseOption[]
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
  onDelete: (member: MemberRow) => void
}) {
  const [name, setName] = useState(member?.name || '')
  const [rank, setRank] = useState(member?.rank || 'Soldier')
  const [callsign, setCallsign] = useState(member?.callsign || '')
  const [status, setStatus] = useState(member?.status || 'At Large')
  const [personId, setPersonId] = useState(member?.person_id || '')
  const [caseId, setCaseId] = useState(member?.case_id || '')
  const [ccw, setCcw] = useState(!!member?.ccw)
  const [vch, setVch] = useState(String(member?.vch ?? 0))
  const [felonies, setFelonies] = useState(String(member?.felony_count ?? 0))
  const [mugshot, setMugshot] = useState(member?.mugshot_url || '')
  const [provenance, setProvenance] = useState(member?.provenance || '')

  const personKnown = !personId || people.some((p) => p.id === personId)
  const caseKnown = !caseId || cases.some((c) => c.id === caseId)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) { toast('Name is required.', 'warn'); return }
    setBusy(true)
    const payload = {
      gang_id: gangId, name: name.trim(), rank: rank.trim() || null, callsign: callsign.trim() || null,
      status: status.trim() || null, person_id: personId || null, case_id: caseId || null, ccw,
      vch: Number(vch) || 0, felony_count: Number(felonies) || 0, mugshot_url: mugshot.trim() || null,
      provenance: provenance || null,
    }
    const res = member ? await update('gang_members', member.id, payload) : await insert('gang_members', payload)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Member saved', 'success')
    onSaved()
  }

  const dirty = () =>
    name !== (member?.name || '') || rank !== (member?.rank || 'Soldier') || callsign !== (member?.callsign || '') ||
    status !== (member?.status || 'At Large') || personId !== (member?.person_id || '') || caseId !== (member?.case_id || '') ||
    ccw !== !!member?.ccw || vch !== String(member?.vch ?? 0) || felonies !== String(member?.felony_count ?? 0) ||
    mugshot !== (member?.mugshot_url || '') || provenance !== (member?.provenance || '')

  return (
    <Modal open wide onClose={onClose} dirty={dirty}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title={`${member ? 'Edit' : 'Add'} Member`} onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label htmlFor="member-name" className={label}>Name *</label><input id="member-name" value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
          <div><label htmlFor="member-rank" className={label}>Rank</label><input id="member-rank" list="gang-rank-list" value={rank} onChange={(e) => setRank(e.target.value)} className={input} /><datalist id="gang-rank-list">{RANK_SUGGEST.map((r) => <option key={r} value={r} />)}</datalist></div>
          <div><label htmlFor="member-callsign" className={label}>Callsign</label><input id="member-callsign" value={callsign} onChange={(e) => setCallsign(e.target.value)} className={input} /></div>
          <div><label htmlFor="member-status" className={label}>Status</label><input id="member-status" value={status} onChange={(e) => setStatus(e.target.value)} className={input} /></div>
          <div>
            <label htmlFor="member-person" className={label}>Link Person</label>
            <select id="member-person" value={personId} onChange={(e) => setPersonId(e.target.value)} className={input}>
              <option value="">- link person (optional) -</option>
              {!personKnown && <option value={personId}>(linked person - loading...)</option>}
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="member-case" className={label}>Link Case</label>
            <select id="member-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} className={input}>
              <option value="">- link case (optional) -</option>
              {!caseKnown && <option value={caseId}>(linked case - other bureau)</option>}
              {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="member-ccw" className={label}>CCW</label>
            <select id="member-ccw" value={ccw ? 'true' : 'false'} onChange={(e) => setCcw(e.target.value === 'true')} className={input}>
              <option value="false">No</option><option value="true">Yes</option>
            </select>
          </div>
          <div>
            <label htmlFor="member-prov" className={label}>Membership source</label>
            <select id="member-prov" value={provenance} onChange={(e) => setProvenance(e.target.value)} className={input}>
              <option value="">—</option>
              {PROVENANCE_KINDS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="member-vch" className={label}>VCH</label><input id="member-vch" type="number" value={vch} onChange={(e) => setVch(e.target.value)} className={input} /></div>
            <div><label htmlFor="member-felonies" className={label}>Felonies</label><input id="member-felonies" type="number" value={felonies} onChange={(e) => setFelonies(e.target.value)} className={input} /></div>
          </div>
          <div className="sm:col-span-2"><label htmlFor="member-mugshot" className={label}>Mugshot URL</label><input id="member-mugshot" value={mugshot} onChange={(e) => setMugshot(e.target.value)} className={input} /></div>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={() => void save()} disabled={busy} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
            {busy ? 'Saving…' : member ? 'Save' : 'Add member'}
          </button>
          {member && canDelete && <button onClick={() => onDelete(member)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>}
        </div>
      </div>
    </Modal>
  )
}

export function TurfModal({ gangId, onClose, onSaved }: { gangId: string; onClose: () => void; onSaved: () => void }) {
  const [block, setBlock] = useState('')
  const [density, setDensity] = useState<Density>('low')
  const [hotspot, setHotspot] = useState('')
  const [status, setStatus] = useState('')
  const [confidence, setConfidence] = useState('')
  const [firstObs, setFirstObs] = useState('')
  const [lastConf, setLastConf] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!block.trim()) { toast('Block is required.', 'warn'); return }
    setBusy(true)
    const res = await insert('gang_turf', {
      gang_id: gangId, block: block.trim(), density, hotspot_area: hotspot.trim() || null,
      status: status || null, confidence: confidence || null,
      first_observed: firstObs || null, last_confirmed: lastConf || null, notes: notes.trim() || null,
    })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Turf added', 'success')
    onSaved()
  }

  const dirty = () =>
    !!(block || hotspot || status || confidence || firstObs || lastConf || notes) || density !== 'low'

  return (
    <Modal open wide onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title="Add Turf Block" onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label htmlFor="turf-block" className={label}>Block / Territory *</label><input id="turf-block" value={block} onChange={(e) => setBlock(e.target.value)} className={input} /></div>
          <div><label htmlFor="turf-hotspot" className={label}>Area / hotspot</label><input id="turf-hotspot" value={hotspot} onChange={(e) => setHotspot(e.target.value)} className={input} /></div>
          <div>
            <label htmlFor="turf-density" className={label}>Density</label>
            <select id="turf-density" value={density} onChange={(e) => setDensity(e.target.value as Density)} className={input}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </div>
          <div>
            <label htmlFor="turf-status" className={label}>Control status</label>
            <select id="turf-status" value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
              <option value="">—</option>
              {TURF_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="turf-conf" className={label}>Confidence</label>
            <select id="turf-conf" value={confidence} onChange={(e) => setConfidence(e.target.value)} className={input}>
              <option value="">—</option>
              {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
            </select>
          </div>
          <div><label htmlFor="turf-first" className={label}>First observed</label><input id="turf-first" type="date" value={firstObs} onChange={(e) => setFirstObs(e.target.value)} className={input} /></div>
          <div><label htmlFor="turf-last" className={label}>Last confirmed</label><input id="turf-last" type="date" value={lastConf} onChange={(e) => setLastConf(e.target.value)} className={input} /></div>
          <div className="sm:col-span-2"><label htmlFor="turf-notes" className={label}>Notes</label><textarea id="turf-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} /></div>
        </div>
        <button onClick={() => void save()} disabled={busy} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">{busy ? 'Saving…' : 'Add Turf'}</button>
      </div>
    </Modal>
  )
}

/** Durable attach-to-case — creates a structured case_intel_links row (kind=gang)
 *  instead of an unstructured chat message. Prevents duplicate attachment and
 *  optionally also posts a channel note. */
export function AttachGangModal({ gang, caseOptions, onClose, onSaved }: { gang: GangRow; caseOptions: CaseOption[]; onClose: () => void; onSaved?: () => void }) {
  const { profile } = useAuth()
  const sorted = useMemo(() => caseOptions.slice().sort((a, b) => (a.case_number || '').localeCompare(b.case_number || '')), [caseOptions])
  const [caseId, setCaseId] = useState(sorted[0]?.id || '')
  const [role, setRole] = useState('Subject')
  const [note, setNote] = useState('')
  const [alsoPost, setAlsoPost] = useState(false)
  const [busy, setBusy] = useState(false)

  const go = async () => {
    if (!caseId) return
    setBusy(true)
    // Dedupe: unique (case_id, kind, ref_id) also enforces this server-side.
    const existing = await list('case_intel_links', { eq: { case_id: caseId, kind: 'gang', ref_id: gang.id } }).catch(() => [])
    if (existing.length) { toast('This gang is already linked to that case.', 'warn'); setBusy(false); return }
    const res = await insert('case_intel_links', { case_id: caseId, kind: 'gang', ref_id: gang.id, role: role.trim() || null, note: note.trim() || null })
    if (res.error) { toast(`Attach failed: ${res.error.message}`, 'danger'); setBusy(false); return }
    if (alsoPost) {
      await insert('case_messages', {
        case_id: caseId, author_name: profile?.display_name || 'CID',
        body: `Intel link — Gang ${gang.name}${role.trim() ? ` (${role.trim()})` : ''}${note.trim() ? ` · ${note.trim()}` : ''}`,
        mentions: [], links: [],
      }).catch(() => {})
    }
    setBusy(false)
    const num = sorted.find((c) => c.id === caseId)?.case_number || 'case'
    toast(`Gang linked to ${num}`, 'success')
    onSaved?.()
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Attach to case" onClose={onClose} />
        <p className="mb-3 text-sm text-slate-400">Creates a durable intel link (shows in the case&rsquo;s Intel &amp; Graph tabs) for <span className="text-white">{gang.name}</span>.</p>
        {sorted.length ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="attach-case" className={label}>Case</label>
              <select id="attach-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} className={input}>
                {sorted.map((c) => <option key={c.id} value={c.id}>{c.case_number} · {c.title || ''}</option>)}
              </select>
            </div>
            <div><label htmlFor="attach-role" className={label}>Gang role in the case</label><input id="attach-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Subject, suspect org, rival…" className={input} /></div>
            <div><label htmlFor="attach-note" className={label}>Note (optional)</label><input id="attach-note" value={note} onChange={(e) => setNote(e.target.value)} className={input} /></div>
            <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={alsoPost} onChange={(e) => setAlsoPost(e.target.checked)} className="h-4 w-4 accent-badge-500" />Also post a note in the case channel</label>
            <button onClick={() => void go()} disabled={busy} className="w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">{busy ? 'Linking…' : 'Create case link'}</button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No cases available to attach to.</p>
        )}
      </div>
    </Modal>
  )
}

/** Link an existing place to the gang with a role/confidence/provenance. */
export function LinkPlaceModal({ gang, places, existing, onClose, onSaved }: {
  gang: GangRow; places: PlaceRow[]; existing: GangPlaceRow[]; onClose: () => void; onSaved: () => void
}) {
  const linkedIds = useMemo(() => new Set(existing.map((g) => g.place_id)), [existing])
  const options = useMemo(() => places.filter((p) => !linkedIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)), [places, linkedIds])
  const [placeId, setPlaceId] = useState(options[0]?.id || '')
  const [role, setRole] = useState('')
  const [confidence, setConfidence] = useState('')
  const [provenance, setProvenance] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const go = async () => {
    if (!placeId) return
    setBusy(true)
    const res = await insert('gang_places', { gang_id: gang.id, place_id: placeId, role: role.trim() || null, confidence: confidence || null, provenance: provenance || null, note: note.trim() || null })
    setBusy(false)
    if (res.error) {
      toast(res.error.code === '23505' ? 'That place is already linked.' : `Link failed: ${res.error.message}`, 'danger')
      return
    }
    toast('Place linked', 'success'); onSaved()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Link a place" onClose={onClose} />
        {options.length ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="lp-place" className={label}>Place</label>
              <select id="lp-place" value={placeId} onChange={(e) => setPlaceId(e.target.value)} className={input}>
                {options.map((p) => <option key={p.id} value={p.id}>{p.name} · {humanize(p.type)}{p.area ? ` · ${p.area}` : ''}</option>)}
              </select>
            </div>
            <div><label htmlFor="lp-role" className={label}>Role</label><input id="lp-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="clubhouse, stash, laundering…" className={input} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="lp-conf" className={label}>Confidence</label>
                <select id="lp-conf" value={confidence} onChange={(e) => setConfidence(e.target.value)} className={input}><option value="">—</option>{CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>
              </div>
              <div>
                <label htmlFor="lp-prov" className={label}>Source</label>
                <select id="lp-prov" value={provenance} onChange={(e) => setProvenance(e.target.value)} className={input}><option value="">—</option>{PROVENANCE_KINDS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select>
              </div>
            </div>
            <div><label htmlFor="lp-note" className={label}>Note</label><input id="lp-note" value={note} onChange={(e) => setNote(e.target.value)} className={input} /></div>
            <button onClick={() => void go()} disabled={busy} className="w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">{busy ? 'Linking…' : 'Link place'}</button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">All existing places are already linked, or none exist yet. Create places in the Places area first.</p>
        )}
      </div>
    </Modal>
  )
}

/** Add a photo to the gang — FiveManage upload when configured, else paste a URL.
 *  Mirrors the Places photo flow but writes media.gang_id. */
export function AddGangPhotoModal({ gang, onClose, onSaved }: { gang: GangRow; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const canUpload = fmConfigured()

  const persist = async (externalUrl: string, kind: string) => {
    const res = await insert('media', {
      title: title.trim() || `${gang.name} photo`, type: 'image', kind, external_url: externalUrl,
      gang_id: gang.id, tags: { labels: ['Gang'] },
    })
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return false }
    return true
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const { url: up, kind } = await fmUpload(file)
      if (await persist(up, kind)) { toast('Photo added', 'success'); onSaved() }
    } catch (e) { toast(e instanceof Error ? e.message : 'Upload failed', 'danger') } finally { setBusy(false) }
  }

  const saveUrl = async () => {
    const clean = safeUrl(url.trim())
    if (!clean) { toast('Enter a valid image URL.', 'warn'); return }
    setBusy(true)
    if (await persist(clean, 'image')) { toast('Photo added', 'success'); onSaved() }
    setBusy(false)
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!(title.trim() || url.trim())}>
      <div className="p-6">
        <ModalHeader title={`Add photo — ${gang.name}`} onClose={onClose} />
        <div className="space-y-3">
          <div><label htmlFor="gp-title" className={label}>Title</label><input id="gp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${gang.name} photo`} className={input} /></div>
          {canUpload ? (
            <div>
              <label htmlFor="gp-file" className={label}>Upload image</label>
              <input id="gp-file" type="file" accept="image/*" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-badge-500 file:px-3 file:py-1.5 file:text-white" />
              <p className="mt-1 text-[11px] text-slate-500">Uploads to the media host and links it to this gang.</p>
            </div>
          ) : (
            <div>
              <label htmlFor="gp-url" className={label}>Image URL</label>
              <input id="gp-url" value={url} onChange={(e) => setUrl(e.target.value)} className={input} />
              <button onClick={() => void saveUrl()} disabled={busy} className="mt-3 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-2.5 text-sm font-semibold text-white shadow-glow disabled:opacity-60">{busy ? 'Saving…' : 'Add photo'}</button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export function GangPhotoLightbox({ media, onClose }: { media: { title: string; external_url: string | null; storage_path: string | null; type: string }; onClose: () => void }) {
  const src = safeUrl(media.external_url || media.storage_path || '')
  return (
    <Modal open wide onClose={onClose}>
      <div className="p-4">
        <ModalHeader title={media.title} onClose={onClose} />
        {src ? (
          media.type === 'video'
            ? <video src={src} controls className="max-h-[70vh] w-full rounded-lg" />
            // eslint-disable-next-line @next/next/no-img-element -- external media CDN
            : <img src={src} alt={media.title} className="max-h-[70vh] w-full rounded-lg object-contain" />
        ) : <div className="grid h-40 place-items-center text-3xl" aria-hidden>📡</div>}
        {src && <a href={src} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs font-semibold text-blue-300 hover:text-blue-200">Open original ↗</a>}
      </div>
    </Modal>
  )
}
