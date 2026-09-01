'use client'

/** SIB actions, on the person's own record.
 *
 *  ── Why this belongs here and not only in the SIB workspace ───────────────
 *  An agent reads a person's profile, decides they matter, and then — before
 *  this — had to leave, find the SIB tab, open a form and search the registry
 *  for the record they were already looking at. Every one of those steps was a
 *  chance to type a name instead of attaching the record, which is exactly how
 *  the unit ended up with a duplicate address book. Acting from the record
 *  makes the correct thing the easy thing: the subject is already chosen and
 *  cannot be mistyped.
 *
 *  ── Why it renders nothing for everyone else ──────────────────────────────
 *  Not because the buttons would fail — they would, the RPCs all gate on
 *  `siu_is_agent()` — but because their PRESENCE on a shared CID registry page
 *  would tell any detective that the unit exists and takes an interest in
 *  people. The whole component is behind `siu.isAgent`, the same call that
 *  gates the watchlist itself.
 *
 *  ── The status line is read from the database, never inferred ─────────────
 *  "Already on the watchlist" comes from `siu_person_dossier()`, which is
 *  SECURITY INVOKER — so a caller who cannot see a watch is told there is
 *  none, and that is the honest answer for them. Nothing here filters a
 *  broader result down in React; there is no broader result to filter. */

import { useCallback, useEffect, useState } from 'react'
import { rpc, withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  SIU_OPENABLE_DESIGNATIONS, SIU_TARGET_PRIORITIES, SIU_TARGET_PRIORITY_LABEL,
  SIU_WATCH_MAX_DAYS, SIU_WATCH_PRIORITIES, SIU_WATCH_PRIORITY_LABEL,
  SIU_NOTE_TYPES, SIU_CREDIBILITY, SIU_RELIABILITY, SIU_SOURCE_TYPES,
  fetchSiuPersonDossier, siuCredibilityLabel, siuDesignationLabel,
  siuNoteTypeLabel, siuReliabilityLabel, siuSourceTypeLabel,
  siuWatchPriorityTint, siuWatchStatusLabel,
  type SiuPersonDossier,
} from '@/lib/siu'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { SiuPersonDossierModal } from './SiuPersonDossier'

type CaseRow = Tables<'cases'>
type Sheet = 'watch' | 'target' | 'intel' | null

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function SiuPersonActions({ personId, personName }: {
  personId: string; personName: string
}) {
  const siu = useSiu()
  const [d, setD] = useState<SiuPersonDossier | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [dossierOpen, setDossierOpen] = useState(false)

  const load = useCallback(async () => {
    try { setD(await withRetry(() => fetchSiuPersonDossier(personId))) }
    catch { /* an absent SIB block is the honest fallback */ }
    finally { setLoaded(true) }
  }, [personId])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live && siu.isAgent) await load()
      else if (live) setLoaded(true)
    })()
    return () => { live = false }
  }, [load, siu.isAgent])

  // Field agents only — the same gate as the watchlist. Oversight sees counts
  // through the oversight report, never a control on a person's record.
  if (!siu.isAgent || !loaded) return null

  const watch = d?.watch ?? null
  const targets = (d?.siu_targets ?? []).filter((t) => !t.cleared_at)
  const intel = d?.siu_intelligence ?? []

  return (
    <Card variant="flat" pad="sm">
      <div className="flex flex-wrap items-center gap-2">
        {/* The one violet mark on the panel: the unit's identity chip. The
            surface itself stays a standard flat card. */}
        <Badge tint="bg-violet-500/15 text-violet-300">SIB</Badge>
        <span className="text-sm font-semibold text-slate-200">Unit actions</span>

        {watch && (
          <Badge tint={siuWatchPriorityTint(watch.priority)}>
            Watched — {siuWatchStatusLabel(watch.status)} until {fmtDate(watch.expires_at)}
          </Badge>
        )}
        {targets.length > 0 && (
          <Badge tone="warn">
            {targets.length === 1
              ? siuDesignationLabel(targets[0].designation ?? undefined)
              : `${targets.length} designations`}
          </Badge>
        )}
        {d?.siu_source && (
          <Badge tint="bg-amber-500/15 text-amber-300">Registered source</Badge>
        )}
        {intel.length > 0 && <Badge tone="neutral">{intel.length} intelligence</Badge>}

        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setDossierOpen(true)}>Open dossier</Button>
          {!watch && (
            <Button size="sm" variant="primary" onClick={() => setSheet('watch')}>
              + Watchlist
            </Button>
          )}
          <Button size="sm" onClick={() => setSheet('target')}>+ Designate</Button>
          <Button size="sm" onClick={() => setSheet('intel')}>+ Intelligence</Button>
        </div>
      </div>

      {/* The one status worth stating in words rather than a chip: targeting
          somebody else's registered source is the mistake §19 deconfliction
          exists to prevent, and a chip is too easy to skim past. */}
      {d?.siu_source && (
        <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          This person is a <strong className="font-semibold">registered source</strong> ({d.siu_source.codename}).
          Coordinate with the handler before any approach — do not task or target them directly.
        </p>
      )}

      {watch?.reason && (
        <p className="mt-2 text-[11px] text-slate-400">Watched because: {watch.reason}</p>
      )}

      {sheet === 'watch' && (
        <WatchSheet personId={personId} personName={personName}
          onClose={() => setSheet(null)} onDone={() => { setSheet(null); void load() }} />
      )}
      {sheet === 'target' && (
        <TargetSheet personId={personId} personName={personName}
          onClose={() => setSheet(null)} onDone={() => { setSheet(null); void load() }} />
      )}
      {sheet === 'intel' && (
        <IntelSheet personId={personId} personName={personName}
          onClose={() => setSheet(null)} onDone={() => { setSheet(null); void load() }} />
      )}
      {dossierOpen && (
        <SiuPersonDossierModal personId={personId} onClose={() => setDossierOpen(false)} />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ helpers */

/** The investigations this agent can actually work. Used by the two sheets
 *  that need a case; RLS decides what comes back, so an agent is never offered
 *  a compartment they are not in. */
function useMyInvestigations() {
  const [cases, setCases] = useState<CaseRow[]>([])
  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      try {
        const r = await withRetry(() => list('cases', {
          eq: { case_authority: 'siu' }, is: { closed_at: null },
          order: 'created_at', ascending: false, limit: 200,
        })) as CaseRow[]
        if (live) setCases(r)
      } catch { /* an empty picker is the honest fallback */ }
    })()
    return () => { live = false }
  }, [])
  return cases
}

/* ------------------------------------------------------------------- sheets */

function WatchSheet({ personId, personName, onClose, onDone }: {
  personId: string; personName: string; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [priority, setPriority] = useState('routine')
  const [days, setDays] = useState(90)
  const [reviewDays, setReviewDays] = useState(30)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!reason.trim()) { toast('A reason is required.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_watch_add', {
      p_entity_type: 'person', p_entity_id: personId, p_reason: reason.trim(),
      p_priority: priority, p_days: days, p_review_days: reviewDays,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Added to the watchlist.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!reason}>
      <ModalHeader title={`Watch ${personName}`} onClose={onClose} />
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-slate-400">
          The watch points at this registry record, so the name and affiliations shown against it
          stay current. Every watch expires — this one ends on its own if nobody renews it.
        </p>
        <Field label="Priority" required>
          {(id) => (
            <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {SIU_WATCH_PRIORITIES.map((p) => (
                <option key={p} value={p}>{SIU_WATCH_PRIORITY_LABEL[p]}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Runs for (days)" required hint={`Hard limit ${SIU_WATCH_MAX_DAYS}.`}>
            {(id) => (
              <Input id={id} type="number" min={1} max={SIU_WATCH_MAX_DAYS}
                value={days} onChange={(e) => setDays(Number(e.target.value))} />
            )}
          </Field>
          <Field label="Review after (days)" required>
            {(id) => (
              <Input id={id} type="number" min={1} max={days}
                value={reviewDays} onChange={(e) => setReviewDays(Number(e.target.value))} />
            )}
          </Field>
        </div>
        <Field label="Reason" required hint="Why the unit needs to know about this person.">
          {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Adding…' : 'Add to watchlist'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function TargetSheet({ personId, personName, onClose, onDone }: {
  personId: string; personName: string; onClose: () => void; onDone: () => void
}) {
  const cases = useMyInvestigations()
  const [caseId, setCaseId] = useState('')
  const [designation, setDesignation] = useState('person_of_interest')
  const [priority, setPriority] = useState('medium')
  const [role, setRole] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!caseId) { toast('Choose the investigation.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_designate_target', {
      p_case: caseId, p_entity_type: 'person', p_entity_id: personId,
      p_designation: designation, p_priority: priority,
      p_role: role.trim() || undefined, p_notes: notes.trim() || undefined,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Designation recorded.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!caseId || !!notes}>
      <ModalHeader title={`Designate ${personName}`} onClose={onClose} />
      <div className="space-y-3">
        <Field label="Investigation" required hint="Only investigations you can work are listed.">
          {(id) => (
            <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Choose an investigation…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>{c.case_number} — {c.title}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Designation" required>
            {(id) => (
              <Select id={id} value={designation} onChange={(e) => setDesignation(e.target.value)}>
                {SIU_OPENABLE_DESIGNATIONS.map((v) => (
                  <option key={v} value={v}>{siuDesignationLabel(v)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priority" required>
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {SIU_TARGET_PRIORITIES.map((v) => (
                  <option key={v} value={v}>{SIU_TARGET_PRIORITY_LABEL[v]}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Role in the network" hint="Optional.">
          {(id) => <Input id={id} value={role} onChange={(e) => setRole(e.target.value)} />}
        </Field>
        <Field label="Notes" hint="Optional.">
          {(id) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <p className="text-[11px] leading-relaxed text-slate-500">
          A designation describes standing in an investigation — not a finding, not a charge and not
          a conviction. Clearing one later keeps the record of both.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Recording…' : 'Designate'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function IntelSheet({ personId, personName, onClose, onDone }: {
  personId: string; personName: string; onClose: () => void; onDone: () => void
}) {
  const cases = useMyInvestigations()
  const [caseId, setCaseId] = useState('')
  const [noteType, setNoteType] = useState('intelligence')
  const [severity, setSeverity] = useState('medium')
  const [body, setBody] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [reliability, setReliability] = useState('')
  const [credibility, setCredibility] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!caseId) { toast('Choose the investigation this belongs to.', 'warn'); return }
    if (!body.trim()) { toast('A note needs a body.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_record_intelligence', {
      p_case: caseId, p_note_type: noteType, p_body: body.trim(), p_severity: severity,
      p_siu_case: caseId, p_subject_person: personId,
      p_source_type: sourceType || undefined,
      p_source_reliability: reliability || undefined,
      p_info_credibility: credibility || undefined,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Intelligence recorded.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!body} wide>
      <ModalHeader title={`Record intelligence — ${personName}`} onClose={onClose} />
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-slate-400">
          {personName} is recorded as the subject, so this note appears on their dossier. To record a
          concern about a CID <em>investigation</em> rather than a person, use the Intelligence tab.
        </p>
        <Field label="Investigation" required>
          {(id) => (
            <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Choose an investigation…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>{c.case_number} — {c.title}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" required>
            {(id) => (
              <Select id={id} value={noteType} onChange={(e) => setNoteType(e.target.value)}>
                {SIU_NOTE_TYPES.map((t) => (
                  <option key={t} value={t}>{siuNoteTypeLabel(t)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Severity" required>
            {(id) => (
              <Select id={id} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {['low', 'medium', 'high', 'critical'].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="The note" required>
          {(id) => <Textarea id={id} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <p className="text-xs font-semibold text-slate-200">Grading (5×5×5)</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            Only settable as the note is written. Leaving it blank is fine — the note is then shown
            as ungraded, which is honest, and Grade records who assessed it later.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Field label="Source">
              {(id) => (
                <Select id={id} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                  <option value="">Not stated</option>
                  {SIU_SOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>{siuSourceTypeLabel(t)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Reliability">
              {(id) => (
                <Select id={id} value={reliability} onChange={(e) => setReliability(e.target.value)}>
                  <option value="">Not stated</option>
                  {SIU_RELIABILITY.map((t) => (
                    <option key={t} value={t}>{siuReliabilityLabel(t)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Credibility">
              {(id) => (
                <Select id={id} value={credibility} onChange={(e) => setCredibility(e.target.value)}>
                  <option value="">Ungraded</option>
                  {SIU_CREDIBILITY.map((t) => (
                    <option key={t} value={t}>{siuCredibilityLabel(t)}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Recording…' : 'Record'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
