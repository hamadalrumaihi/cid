'use client'

/** SIB's reading of the network behind one Field Intelligence report.
 *
 *  ── This is an assessment, not a fact table ────────────────────────────────
 *  `gang_members`, `person_relationships` and the rest remain where structural
 *  fact lives. A node here says "on this report, we read this person as the
 *  shot caller" — attached to the report, optionally to the claim it came from,
 *  and optionally to a registry record. Following it backwards reaches the
 *  officer who saw it, their evidence and the verdict somebody recorded, which
 *  is the whole reason it hangs off the report rather than floating free.
 *
 *  ── Nothing is promoted on its own ─────────────────────────────────────────
 *  A node with a registry record behind it is a target CANDIDATE. Designating
 *  it calls the same `siu_designate_target()` the SIB workspace uses, and the
 *  report must already have been accepted by SIB — so patrol cannot start an
 *  SIB case and neither can an unanswered referral.
 *
 *  ── SIB eyes only ──────────────────────────────────────────────────────────
 *  The table's SELECT policy is `private.siu_is_agent()` with no second branch.
 *  CID keeps the report, its claims, its evidence and the SIB handling history;
 *  what CID does not get is SIB's working picture of an enterprise.
 */
import { useCallback, useEffect, useState } from 'react'
import { fmtDateTime } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { list } from '@/lib/db'
import type { FieldSubmissionRow, SubmissionParts } from '@/lib/fieldSubmissions'
import {
  SIU_LAYERS, SIU_LAYER_LABEL, SIU_ROLE_HINTS, addNode, byLayer, designateFromField,
  linkSiuCase, loadEnterprise, nodeEntity, nodeLabel, nodeProblem, removeNode,
  siuLayerLabel, unlinkSiuCase,
  type FieldSiuNodeRow, type NodeClaimKind, type NodeEntityType, type SiuLayer,
} from '@/lib/fieldSiu'
import {
  SIU_DESIGNATION_LABEL, SIU_OPENABLE_DESIGNATIONS, SIU_TARGET_PRIORITIES,
  SIU_TARGET_PRIORITY_LABEL, siuRegistrySearch, type SiuRegistryMatch,
} from '@/lib/siu'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { uiPrompt } from '@/components/ui/dialog'

interface SiuCaseRow { id: string; case_number: string | null; title: string | null }

/** The claims in this report, flattened into pickable options. An agent
 *  building the picture is usually pointing at something the officer already
 *  wrote down; making them retype it invites a different spelling of the same
 *  person. */
function claimOptions(parts: SubmissionParts): Array<{
  kind: NodeClaimKind; id: string; label: string
}> {
  return [
    ...parts.persons.map((p) => ({
      kind: 'person' as const, id: p.id,
      label: `Person · ${p.full_name || p.alias || 'unnamed'}`,
    })),
    ...parts.vehicles.map((v) => ({
      kind: 'vehicle' as const, id: v.id,
      label: `Vehicle · ${v.plate || [v.color, v.make, v.model].filter(Boolean).join(' ') || 'unnamed'}`,
    })),
    ...parts.orgs.map((o) => ({
      kind: 'org' as const, id: o.id, label: `Organization · ${o.name || 'unnamed'}`,
    })),
    ...parts.locations.map((l) => ({
      kind: 'location' as const, id: l.id,
      label: `Location · ${l.street || l.observed_what || l.org_name || 'unnamed'}`,
    })),
    ...parts.items.map((i) => ({
      kind: 'item' as const, id: i.id,
      label: `Item · ${i.description || i.category || 'unnamed'}`,
    })),
  ]
}

export function SiuEnterprise({ submission, parts, onChanged }: {
  submission: FieldSubmissionRow
  parts: SubmissionParts
  onChanged: () => void
}) {
  const [nodes, setNodes] = useState<FieldSiuNodeRow[]>([])
  const [cases, setCases] = useState<SiuCaseRow[]>([])
  const [adding, setAdding] = useState(false)
  const id = submission.id

  const load = useCallback(async () => { setNodes(await loadEnterprise(id)) }, [id])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load()
      void list('cases', {
        eq: { case_authority: 'siu' }, order: 'updated_at', ascending: false, limit: 100,
        select: 'id,case_number,title',
      }).then((r) => setCases(r as unknown as SiuCaseRow[])).catch(() => setCases([]))
    }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  const after = async (err: string | null, ok: string) => {
    if (err) { toast(err, 'danger'); return }
    toast(ok, 'success')
    await load()
    onChanged()
  }

  const linked = cases.find((c) => c.id === submission.siu_case_id) ?? null
  const groups = byLayer(nodes)

  const link = async (caseId: string) => {
    await after(await linkSiuCase(id, caseId), 'Linked. The report keeps its own number and queue.')
  }

  const unlink = async () => {
    const why = await uiPrompt('The report stays where it is; only the link goes.',
      { title: 'Unlink from the investigation', placeholder: 'Why?', confirmText: 'Unlink' })
    if (!why?.trim()) return
    await after(await unlinkSiuCase(id, why), 'Unlinked.')
  }

  const drop = async (n: FieldSiuNodeRow) => {
    const why = await uiPrompt(
      'The entry is kept and marked wrong rather than deleted — how the picture '
      + 'was built is part of the picture.',
      { title: `Remove ${nodeLabel(n)}`, placeholder: 'Why was this reading wrong?', confirmText: 'Remove' },
    )
    if (!why?.trim()) return
    await after(await removeNode(n.id, why), 'Removed.')
  }

  return (
    <div className="mt-4 border-t border-white/5 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          SIB intelligence assessment
        </h5>
        {!adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>+ Map something</Button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        What this report says about a structure, in the SOP&rsquo;s layers. Not visible to
        the submitting officer or to CID, and it does not change any person, gang or
        location record &mdash; it records how SIB reads them.
      </p>

      {/* Which investigation this report fed. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {submission.siu_case_id ? (
          <>
            <Badge tone="accent">
              {linked ? (linked.case_number || linked.title || 'SIB investigation')
                : 'An SIB investigation you cannot open'}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => void unlink()}>Unlink</Button>
          </>
        ) : submission.siu_state === 'accepted' ? (
          <Select value="" aria-label="Link to an SIB investigation" className="text-xs"
            onChange={(e) => { if (e.target.value) void link(e.target.value) }}>
            <option value="">Link to an investigation…</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.case_number ? `${c.case_number} — ` : ''}{c.title || 'Untitled'}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-xs text-slate-500">
            SIB has to take the report before it can feed an investigation.
          </p>
        )}
      </div>

      {adding && (
        <AddNode submission={submission} parts={parts}
          onDone={async (err) => {
            if (!err) setAdding(false)
            await after(err, 'Recorded.')
          }}
          onCancel={() => setAdding(false)} />
      )}

      {groups.length === 0 ? (
        <p className="mt-3 text-xs text-slate-600">Nothing mapped yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((g) => (
            <div key={g.layer}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {siuLayerLabel(g.layer)}
              </p>
              <ul className="mt-1 space-y-1">
                {g.nodes.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-200">{nodeLabel(n)}</span>
                    {n.role && <Badge tone="neutral">{n.role}</Badge>}
                    {nodeEntity(n) && <Badge tone="accent">Registry record</Badge>}
                    {n.note && <span className="text-slate-500">{n.note}</span>}
                    <span className="text-slate-600">
                      {officerName(n.created_by) ?? 'SIB'} · {fmtDateTime(n.created_at)}
                    </span>
                    {nodeEntity(n) && submission.siu_case_id && (
                      <Designate submission={submission} node={n}
                        onDone={(err) => void after(err, 'Designated in the investigation.')} />
                    )}
                    <Button size="sm" variant="ghost" onClick={() => void drop(n)}>Remove</Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Recording one node. A claim from the report and a registry record are both
 *  optional and both help: the claim is where it came from, the record is who
 *  it is. Without either, a name is still allowed — an unidentified "man with
 *  the neck tattoo" is a real part of an early picture. */
function AddNode({ submission, parts, onDone, onCancel }: {
  submission: FieldSubmissionRow
  parts: SubmissionParts
  onDone: (err: string | null) => void | Promise<void>
  onCancel: () => void
}) {
  const [f, setF] = useState({
    layer: 'leadership' as SiuLayer, role: '', label: '', note: '', claim: '',
  })
  const [entity, setEntity] = useState<{ type: NodeEntityType; id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const claims = claimOptions(parts)

  const save = async () => {
    const problem = nodeProblem(f.layer, f.label, !!f.claim || !!entity)
    if (problem) { toast(problem, 'warn'); return }
    const [kind, claimId] = f.claim ? f.claim.split(':') : [undefined, undefined]
    setBusy(true)
    const err = await addNode(submission.id, f.layer, {
      role: f.role, label: f.label, note: f.note,
      claimKind: kind as NodeClaimKind | undefined, claimId,
      entityType: entity?.type, entityId: entity?.id,
    })
    setBusy(false)
    await onDone(err)
    if (!err) {
      setF({ layer: f.layer, role: '', label: '', note: '', claim: '' })
      setEntity(null)
    }
  }

  return (
    <div className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-white/5 p-3 sm:grid-cols-2">
      <Field label="Layer">
        {(id) => (
          <Select id={id} value={f.layer}
            onChange={(e) => setF({ ...f, layer: e.target.value as SiuLayer })}>
            {SIU_LAYERS.map((l) => (
              <option key={l} value={l}>{SIU_LAYER_LABEL[l]}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Role" hint={`e.g. ${SIU_ROLE_HINTS[f.layer].slice(0, 3).join(', ')}`}>
        {(id) => (
          <Input id={id} value={f.role} list={`roles-${f.layer}`}
            onChange={(e) => setF({ ...f, role: e.target.value })} />
        )}
      </Field>
      {/* A datalist rather than a select: the suggestions are a starting point,
          not a vocabulary, and the column is free text for that reason. */}
      <datalist id={`roles-${f.layer}`}>
        {SIU_ROLE_HINTS[f.layer].map((r) => <option key={r} value={r} />)}
      </datalist>
      <Field label="Who or what" hint="A name, or leave it to the claim / record below.">
        {(id) => (
          <Input id={id} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        )}
      </Field>
      <Field label="From which claim" hint="Where in the report this came from.">
        {(id) => (
          <Select id={id} value={f.claim} onChange={(e) => setF({ ...f, claim: e.target.value })}>
            <option value="">Not from a specific claim</option>
            {claims.map((c) => (
              <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>{c.label}</option>
            ))}
          </Select>
        )}
      </Field>
      <div className="sm:col-span-2">
        <RegistryPick value={entity} onPick={setEntity} />
      </div>
      <Field label="Note">
        {(id) => (
          <Input id={id} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        )}
      </Field>
      <div className="flex items-end gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Record'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

/** Resolving a node to a record in the registry, through the same search the
 *  SIB workspace uses. Only a resolved node can ever become a target. */
function RegistryPick({ value, onPick }: {
  value: { type: NodeEntityType; id: string; name: string } | null
  onPick: (v: { type: NodeEntityType; id: string; name: string } | null) => void
}) {
  const [type, setType] = useState<NodeEntityType>('person')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SiuRegistryMatch[]>([])

  const search = async (term: string) => {
    setQ(term)
    if (term.trim().length < 2) { setHits([]); return }
    try { setHits(await siuRegistrySearch(type, term)) } catch { setHits([]) }
  }

  if (value) {
    return (
      <p className="text-xs text-slate-300">
        Linked to <b>{value.name}</b> in the registry
        {' '}
        <Button size="sm" variant="ghost" onClick={() => onPick(null)}>Change</Button>
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={type} aria-label="Record type" className="text-xs"
        onChange={(e) => { setType(e.target.value as NodeEntityType); setHits([]); setQ('') }}>
        <option value="person">Person</option>
        <option value="vehicle">Vehicle</option>
        <option value="gang">Gang</option>
        <option value="place">Place</option>
      </Select>
      <Input value={q} placeholder="Search the registry (optional)…" className="text-xs"
        onChange={(e) => void search(e.target.value)} />
      {hits.slice(0, 5).map((h) => (
        <Button key={h.id} size="sm" variant="ghost"
          onClick={() => onPick({ type, id: h.id, name: h.display_name })}>
          {h.display_name}
        </Button>
      ))}
    </div>
  )
}

/** Promoting a candidate. Deliberately three deliberate choices — designation,
 *  priority and role — rather than one button: a target is an accusation the
 *  unit acts on, and it should take a moment. */
function Designate({ submission, node, onDone }: {
  submission: FieldSubmissionRow
  node: FieldSiuNodeRow
  onDone: (err: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ designation: 'person_of_interest', priority: 'medium' })
  const entity = nodeEntity(node)

  const go = async () => {
    if (!entity || !submission.siu_case_id) return
    onDone(await designateFromField(
      submission.id, submission.siu_case_id, entity,
      f.designation, f.priority, node.role ?? undefined,
      `From ${submission.submission_no ?? 'a field report'}`,
    ))
    setOpen(false)
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Designate</Button>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Select value={f.designation} aria-label="Designation" className="text-xs"
        onChange={(e) => setF({ ...f, designation: e.target.value })}>
        {SIU_OPENABLE_DESIGNATIONS.map((d) => (
          <option key={d} value={d}>{SIU_DESIGNATION_LABEL[d] ?? d}</option>
        ))}
      </Select>
      <Select value={f.priority} aria-label="Priority" className="text-xs"
        onChange={(e) => setF({ ...f, priority: e.target.value })}>
        {SIU_TARGET_PRIORITIES.map((p) => (
          <option key={p} value={p}>{SIU_TARGET_PRIORITY_LABEL[p] ?? p}</option>
        ))}
      </Select>
      <Button size="sm" variant="primary" onClick={() => void go()}>Confirm</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  )
}
