'use client'

/** What a reviewer does with a record that matters: open a case from it, tie it
 *  to a case somebody already opened, put it in front of a surveillance team,
 *  or record the confidential source behind it.
 *
 *  All four already existed somewhere else in the portal. Putting them on the
 *  record is not a shortcut — it is the difference between a case whose summary
 *  says what the report said and one titled "follow up", written by somebody
 *  who had to leave the page and retype it from memory.
 *
 *  The panel shows link HISTORY, including removed links. "Linked on the 4th,
 *  unlinked on the 9th, wrong Rodriguez" is information; a vanished row is not.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { buildAutofill } from '@/lib/autofill'
import { bureauLabel } from '@/lib/roles'
import { list } from '@/lib/db'
import { isMergeKind, type DuplicateRow, type MergeKind } from '@/lib/entity'
import { convertClaim, registryHref } from '@/lib/fieldConvert'
import { fmtDateTime } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { ITEM_CATEGORY_LABEL, loadSubmissionParts, type FieldSubmissionRow, type SubmissionParts } from '@/lib/fieldSubmissions'
import {
  LINK_TARGETS, linkClaim, linkFor, linkTarget, loadClaimLinks, loadMatches, primaryTarget,
  type ClaimKind, type FieldClaimLinkRow, type TargetKind,
} from '@/lib/fieldReview'
import {
  CASE_BUREAUS, OBSERVATION_CONFIDENCE,
  createCaseFrom, createObservationFrom, isProvenance, linkCase, linkLine,
  linkObservation, liveLinks, loadCaseLinks, loadObservationsFrom, revealSource,
  setSource, unlinkCase,
  type CaseBureau, type FieldCaseLinkRow, type ObservationConfidence,
  type ObservationRow, type RevealedSource,
} from '@/lib/fieldActions'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { uiPrompt } from '@/components/ui/dialog'
import { DuplicatePanel, EntityCreateSheet, EntityPicker, type SheetSubmitResult } from '@/components/entity'
import { useToolNav } from '@/components/tools/useToolNav'

interface CasePick { id: string; case_number: string | null; title: string | null }

const caseName = (c: CasePick | undefined, fallback: string | null): string => {
  if (!c) return fallback || 'A case you cannot open'
  return `${c.case_number ? `${c.case_number} — ` : ''}${c.title || 'Untitled'}`
}

export function IntelActions({ submission, onChanged }: {
  submission: FieldSubmissionRow
  onChanged: () => void
}) {
  const { profile } = useAuth()
  const [links, setLinks] = useState<FieldCaseLinkRow[]>([])
  const [observations, setObservations] = useState<ObservationRow[]>([])
  const [cases, setCases] = useState<CasePick[]>([])
  const [opening, setOpening] = useState(false)
  const [watching, setWatching] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [revealed, setRevealed] = useState<RevealedSource | null>(null)
  const id = submission.id

  const load = useCallback(async () => {
    const [l, o] = await Promise.all([loadCaseLinks(id), loadObservationsFrom(id)])
    setLinks(l); setObservations(o)
  }, [id])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load()
      // RLS decides what comes back, so this list is already the set of cases
      // this reviewer could link to.
      void list('cases', {
        order: 'updated_at', ascending: false, limit: 100,
        select: 'id,case_number,title',
      }).then((r) => setCases(r as unknown as CasePick[])).catch(() => setCases([]))
    }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  const after = async (err: string | null, ok: string) => {
    if (err) { toast(err, 'danger'); return }
    toast(ok, 'success')
    await load()
    onChanged()
  }

  const live = liveLinks(links)
  const removed = links.filter((l) => l.unlinked_at)
  // Cases already linked stay out of the picker's answers.
  const linkedCaseIds = useMemo(() => new Set(liveLinks(links).map((l) => l.case_id)), [links])

  const unlink = async (l: FieldCaseLinkRow) => {
    const why = await uiPrompt(
      'The link is kept and marked removed rather than deleted — somebody will '
      + 'ask later why these two stopped being related.',
      { title: 'Remove this link', placeholder: 'Why? e.g. wrong Rodriguez', confirmText: 'Remove' },
    )
    if (!why?.trim()) return
    await after(await unlinkCase(l.id, why), 'Unlinked. The history keeps both events.')
  }

  const reveal = async () => {
    const res = await revealSource(id)
    if (res.error) { toast(res.error, 'danger'); return }
    setRevealed(res.source ?? null)
    toast('Recorded that you looked.', 'success')
  }

  return (
    <Card>
      <h4 className="text-[13px] font-semibold text-white">
        What follows from this
      </h4>

      {/* ── Cases ─────────────────────────────────────────────────────────── */}
      <div className="mt-3">
        <h5 className="text-xs font-medium text-slate-500">Cases</h5>
        {!live.length && !removed.length && (
          <p className="mt-1 text-xs text-slate-500">
            Nothing yet. Opening a case from this record records permanently that it
            started here.
          </p>
        )}
        <ul className="mt-2 space-y-1.5">
          {live.map((l) => {
            const c = cases.find((x) => x.id === l.case_id)
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                <Badge tone={isProvenance(l) ? 'accent' : 'neutral'}>
                  {isProvenance(l) ? 'Opened from this' : 'Linked'}
                </Badge>
                <span className="font-mono text-xs">{caseName(c, l.submission_no)}</span>
                <span className="text-xs text-slate-500">
                  {linkLine(l)} · {officerName(l.linked_by) ?? 'Somebody'} ·{' '}
                  {fmtDateTime(l.linked_at)}
                </span>
                {isProvenance(l) ? (
                  // Not a disabled button: provenance is not an action somebody
                  // is temporarily prevented from taking, it is a fact.
                  <span className="text-xs text-slate-600">Permanent</span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => void unlink(l)}>Unlink</Button>
                )}
              </li>
            )
          })}
          {removed.map((l) => (
            <li key={l.id} className="text-xs text-slate-500 line-through decoration-slate-700">
              {caseName(cases.find((x) => x.id === l.case_id), l.submission_no)} — {linkLine(l)}
              {' · '}{officerName(l.unlinked_by) ?? 'Somebody'}
              {l.unlinked_at ? ` · ${fmtDateTime(l.unlinked_at)}` : ''}
            </li>
          ))}
        </ul>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!opening && (
            <Button size="sm" variant="ghost" onClick={() => setOpening(true)}>
              Open a case from this
            </Button>
          )}
          {/* entity_suggest('case') — bounded and RLS-scoped, so the answer is
              already the set of cases this reviewer could link to. */}
          <div className="min-w-[16rem] flex-1">
            <EntityPicker
              kind="case" label="Link to an existing case" value={null} peek={false}
              exclude={linkedCaseIds}
              placeholder="Search case number or title…"
              onChange={(hit) => {
                if (!hit) return
                void (async () => { await after(await linkCase(id, hit.id), 'Linked.') })()
              }}
            />
          </div>
        </div>

        {opening && (
          <OpenCase submission={submission} defaultLead={profile?.id ?? ''}
            onCancel={() => setOpening(false)}
            onDone={async (err) => {
              if (!err) setOpening(false)
              await after(err, 'Case opened. This record is recorded as where it came from.')
            }} />
        )}
      </div>

      {/* ── Registry records ──────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <h5 className="text-xs font-medium text-slate-500">Registry records</h5>
        <ClaimRegistry submissionId={id} onLinked={(err) => after(err, 'Matched to the existing record.')}
          onChanged={() => { void load(); onChanged() }} />
      </div>

      {/* ── Surveillance ──────────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <h5 className="text-xs font-medium text-slate-500">
          Surveillance
        </h5>
        {observations.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {observations.map((o) => (
              <li key={o.id}>
                {o.activity}
                <span className="text-xs text-slate-500">
                  {' · '}{fmtDateTime(o.observed_at)}
                  {o.location_text ? ` · ${o.location_text}` : ''}
                  {' · '}{o.confidence}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Nothing on the board from this record yet.
          </p>
        )}
        {live.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            An observation belongs to a case — link this record to one first.
          </p>
        ) : !watching ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setWatching(true)}>
              Put this on a surveillance board
            </Button>
            {/* The other half: an observation logged before anybody realised
                which report it answered. Only ones that cite nothing yet are
                offered — an observation already citing a record is not moved. */}
            <AdoptObservation submissionId={id} links={live}
              onDone={(err) => after(err, 'The observation now cites this record.')} />
          </div>
        ) : (
          <AddObservation submission={submission} links={live} cases={cases}
            onCancel={() => setWatching(false)}
            onDone={async (err) => {
              if (!err) setWatching(false)
              await after(err, 'Added to the case surveillance log.')
            }} />
        )}
      </div>

      {/* ── The source ────────────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <h5 className="text-xs font-medium text-slate-500">
          Source
        </h5>
        {submission.source_codename ? (
          <div className="mt-1 space-y-1">
            <p className="text-sm text-slate-300">
              Confidential source <b className="font-mono">{submission.source_codename}</b>
            </p>
            <p className="text-xs text-slate-500">
              The identity is held where nobody can read it. Only the handler can see
              who this is, and looking is recorded.
            </p>
            {revealed ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-100">
                <p><b>{revealed.source_name || 'No name recorded'}</b></p>
                {revealed.source_contact && <p>{revealed.source_contact}</p>}
                {revealed.handler_notes && <p className="text-amber-200/70">{revealed.handler_notes}</p>}
                <p className="mt-1 text-amber-200/60">
                  Handler {officerName(revealed.handler_id) ?? 'unknown'} · this view was logged
                </p>
              </div>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void reveal()}>
                Show me who this is
              </Button>
            )}
          </div>
        ) : !registering ? (
          <>
            <p className="mt-1 text-xs text-slate-500">
              {/* Says the rule out loud, because the ordering is the protection. */}
              Registering a source stores the identity somewhere no one can read and
              puts only a codename on the record. The record cannot call itself
              confidential until that exists.
            </p>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setRegistering(true)}>
              Record a confidential source
            </Button>
          </>
        ) : (
          <RegisterSource
            onCancel={() => setRegistering(false)}
            onDone={async (codename, details) => {
              const err = await setSource(id, codename, details)
              if (!err) setRegistering(false)
              await after(err, 'Source recorded. The record now says its source was confidential.')
            }} />
        )}
      </div>
    </Card>
  )
}

/** The record's structured claims (persons, vehicles, organizations,
 *  locations, items) against the registry, through the entity layer (P2-09,
 *  extended by P6-04): `field_claim_matches` feeds a DuplicatePanel whose Use
 *  existing links the claim; an EntityPicker matches by hand against any
 *  target the pair rule allows (a person claim to a person, an account or an
 *  indicator; an item to a narcotic …); Convert opens the shared create sheet
 *  prefilled from the claim (buildAutofill) and saves through
 *  `field_submission_convert`, which creates the record with its provenance
 *  and links the claim in one audited call. Every hand-made match is still
 *  `field_claim_link`. */
interface Claim { kind: ClaimKind; id: string; label: string; target: TargetKind; draft: Record<string, string> }

const SIGNAL_FOR: Record<TargetKind, string> = {
  person: 'name', vehicle: 'plate', gang: 'name', place: 'name', narcotic: 'name', account: 'handle', indicator: 'value',
}

const targetLabel = (t: TargetKind): string => (t === 'gang' ? 'organization' : t)

const prefill = (o: Record<string, string | null | undefined>): Record<string, string> =>
  buildAutofill(o, {}).values as Record<string, string>

function claimsOf(parts: SubmissionParts): Claim[] {
  return [
    ...parts.persons.map((p): Claim => ({
      kind: 'person', id: p.id, target: primaryTarget('person'),
      label: [p.full_name, p.alias].filter(Boolean).join(' / ') || 'unidentified person',
      draft: prefill({ name: p.full_name, alias: p.alias, phone: p.phone, notes: p.description }),
    })),
    ...parts.vehicles.map((v): Claim => ({
      kind: 'vehicle', id: v.id, target: primaryTarget('vehicle'),
      label: [v.plate, v.color, v.model].filter(Boolean).join(' ') || 'vehicle, no details',
      draft: prefill({ plate: v.plate, model: [v.make, v.model].filter(Boolean).join(' ') || null, color: v.color, notes: v.description }),
    })),
    ...parts.orgs.map((o): Claim => ({
      kind: 'org', id: o.id, target: primaryTarget('org'),
      label: o.name || o.org_type.replace(/_/g, ' '),
      draft: prefill({ name: o.name, colors: o.colors, notes: o.territory ? `Territory: ${o.territory}` : null }),
    })),
    ...parts.locations.map((l): Claim => ({
      kind: 'location', id: l.id, target: primaryTarget('location'),
      label: [l.street, l.postal].filter(Boolean).join(' ') || l.kind.replace(/_/g, ' '),
      draft: prefill({ name: [l.street, l.postal].filter(Boolean).join(' ') || null, area: l.postal, notes: l.description }),
    })),
    // A seizure is an event, so an item was never matchable — but the
    // substance it names is a standing narcotics record, or should be.
    ...parts.items.map((i): Claim => ({
      kind: 'item', id: i.id, target: primaryTarget('item'),
      label: [i.suspected_substance, ITEM_CATEGORY_LABEL[i.category] ?? i.category].filter(Boolean).join(' · ') || 'item, no details',
      draft: prefill({
        name: i.suspected_substance,
        summary: [i.description, i.packaging ? `Packaging: ${i.packaging}` : null].filter(Boolean).join('\n') || null,
      }),
    })),
  ]
}

function ClaimRegistry({ submissionId, onLinked, onChanged }: {
  submissionId: string
  onLinked: (err: string | null) => Promise<void>
  /** A conversion already toasted from the sheet — only the parent refreshes. */
  onChanged: () => void
}) {
  const [claims, setClaims] = useState<Claim[] | null>(null)
  const [links, setLinks] = useState<FieldClaimLinkRow[]>([])

  const load = useCallback(async () => {
    const [parts, l] = await Promise.all([loadSubmissionParts(submissionId), loadClaimLinks(submissionId)])
    setClaims(claimsOf(parts)); setLinks(l)
  }, [submissionId])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  if (claims === null) return null
  if (!claims.length) {
    return <p className="mt-1 text-xs text-slate-500">No structured claims to match against the registry.</p>
  }
  return (
    <ul className="mt-2 space-y-2">
      {claims.map((c) => (
        <ClaimRow key={c.id} claim={c} link={linkFor(links, c.kind, c.id)}
          onLink={async (target, recordId) => { await onLinked(await linkClaim(c.kind, c.id, target, recordId)); await load() }}
          onConverted={async () => { await load(); onChanged() }} />
      ))}
    </ul>
  )
}

function ClaimRow({ claim, link, onLink, onConverted }: {
  claim: Claim
  link: FieldClaimLinkRow | null
  onLink: (target: TargetKind, recordId: string) => Promise<void>
  /** The server already linked the claim — only reload and say so. */
  onConverted: () => Promise<void>
}) {
  const nav = useToolNav()
  const [matches, setMatches] = useState<{ rows: DuplicateRow[]; kinds: Record<string, TargetKind>; also: number; matchable: boolean } | null>(null)
  const [looking, setLooking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [target, setTarget] = useState<TargetKind>(claim.target)
  const targets = LINK_TARGETS[claim.kind]
  const chosenLabel = targetLabel(target)
  const linked = link ? linkTarget(link) : null
  // Convert only lands in a registry the create sheet renders — an indicator
  // is case-scoped and is linked, never minted from here.
  const convertKind: MergeKind | null = isMergeKind(target) ? target : null

  const look = async () => {
    setLooking(true)
    const r = await loadMatches(claim.kind, claim.id)
    setLooking(false)
    const kinds: Record<string, TargetKind> = {}
    for (const m of r.matches) kinds[m.id] = m.kind
    setMatches({
      matchable: r.matchable, also: r.also_reported, kinds,
      rows: r.matches.map((m): DuplicateRow => ({
        id: m.id, label: m.label, sublabel: null, signal: SIGNAL_FOR[m.kind],
        strength: m.exact ? 'strong' : 'soft', score: m.exact ? 1 : 0.5,
      })),
    })
  }

  /** The sheet's save path: the server creates, stamps provenance and links.
   *  A duplicate verdict comes back as rows for the sheet's own panel; a
   *  refusal is toasted in the server's words and shown inline. */
  const convert = async (values: Record<string, string>, reason?: string): Promise<SheetSubmitResult> => {
    if (!convertKind) return { id: null, error: { message: 'Choose a registry to convert into.' } }
    const res = await convertClaim(convertKind, claim.kind, claim.id, values, reason)
    if (res.ok) return { id: res.id, error: null }
    if ('matches' in res) return { id: null, error: null, duplicates: res.matches }
    toast(res.message, 'danger')
    return { id: null, error: { message: res.message, code: res.code } }
  }

  return (
    <li className="rounded-lg bg-ink-950/50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm text-slate-200">
          <span className="text-xs text-slate-500">{claim.kind === 'org' ? 'organization' : claim.kind} — </span>{claim.label}
        </span>
        {linked && <Badge tone="good">Matched to an existing {targetLabel(linked.kind)}</Badge>}
      </div>
      {!linked && (
        <div className="mt-2 space-y-2">
          {/* Items were never matchable: the RPC says so, and the picker below
              is the way to a narcotic. */}
          {claim.kind !== 'item' && (matches === null ? (
            <Button size="sm" variant="ghost" loading={looking} onClick={() => void look()}>Look for an existing record</Button>
          ) : !matches.matchable ? (
            <p className="text-[11px] text-slate-500">Nothing to match this against.</p>
          ) : (
            <>
              {matches.also > 0 && (
                <p className="text-[11px] text-amber-300">
                  Also named in {matches.also} other submission{matches.also === 1 ? '' : 's'} — worth a look, not corroboration.
                </p>
              )}
              {matches.rows.length ? (
                <DuplicatePanel rows={matches.rows} kind={claim.target}
                  onUseExisting={(r) => void onLink(matches.kinds[r.id] ?? claim.target, r.id)} />
              ) : (
                <p className="text-[11px] text-slate-500">No existing record matches. Nothing is created automatically.</p>
              )}
            </>
          ))}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <EntityPicker
              kind={target} label={`Match to ${target === 'account' || target === 'indicator' ? 'an' : 'a'} ${chosenLabel}`} value={null}
              onChange={(hit) => { if (hit) void onLink(target, hit.id) }}
              onCreateNew={convertKind ? () => setCreating(true) : undefined}
              createLabel={(q) => `Create a new ${chosenLabel} from this claim: “${q}”`}
            />
            {targets.length > 1 && (
              <Select value={target} aria-label={`What this ${claim.kind === 'org' ? 'organization' : claim.kind} claim refers to`}
                className="text-xs" onChange={(e) => setTarget(e.target.value as TargetKind)}>
                {targets.map((t) => <option key={t} value={t}>{targetLabel(t)}</option>)}
              </Select>
            )}
          </div>
          {convertKind && (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              Convert to a new {chosenLabel} record
            </Button>
          )}
          {convertKind && (
            <EntityCreateSheet
              kind={convertKind} open={creating} initial={claim.draft}
              submit={convert}
              onClose={() => setCreating(false)}
              onCreated={(hit) => {
                void onConverted()
                nav.openHref(registryHref(convertKind, hit.id))
              }}
              onUseExisting={(hit) => void onLink(convertKind, hit.id)}
            />
          )}
        </div>
      )}
    </li>
  )
}

function AdoptObservation({ submissionId, links, onDone }: {
  submissionId: string
  links: FieldCaseLinkRow[]
  onDone: (err: string | null) => Promise<void>
}) {
  const [free, setFree] = useState<ObservationRow[]>([])

  useEffect(() => {
    let alive = true
    const ids = links.map((l) => l.case_id)
    const t = window.setTimeout(() => {
      if (!ids.length) { setFree([]); return }
      void list('surveillance_observations', {
        in: { case_id: ids }, is: { field_submission_id: null },
        order: 'observed_at', ascending: false, limit: 50,
      }).then((r) => { if (alive) setFree(r) }).catch(() => { if (alive) setFree([]) })
    }, 0)
    return () => { alive = false; window.clearTimeout(t) }
  }, [links])

  if (!free.length) return null
  return (
    <Select value="" aria-label="Cite this record on an existing observation" className="text-xs"
      onChange={(e) => {
        const obs = e.target.value
        if (!obs) return
        void (async () => { await onDone(await linkObservation(submissionId, obs)) })()
      }}>
      <option value="">Cite this on an existing observation…</option>
      {free.map((o) => (
        <option key={o.id} value={o.id}>
          {o.activity.slice(0, 60)}{o.activity.length > 60 ? '…' : ''}
        </option>
      ))}
    </Select>
  )
}

function OpenCase({ submission, defaultLead, onCancel, onDone }: {
  submission: FieldSubmissionRow
  defaultLead: string
  onCancel: () => void
  onDone: (err: string | null) => Promise<void>
}) {
  const [bureau, setBureau] = useState<CaseBureau>('major_crimes')
  // Prefilled from the record, which is the entire point: the reviewer has just
  // read it, and the case should say what it said.
  const [title, setTitle] = useState(submission.summary ?? '')
  const [summary, setSummary] = useState(submission.details ?? '')
  const [busy, setBusy] = useState(false)

  return (
    <div className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-ink-950/40 p-3 sm:grid-cols-2">
      <Field label="Bureau">
        {(fid) => (
          <Select id={fid} value={bureau}
            onChange={(e) => setBureau(e.target.value as CaseBureau)}>
            {CASE_BUREAUS.map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Case title">
        {(fid) => <Input id={fid} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <div className="sm:col-span-2">
        <Field label="Summary" hint="Carried over from the report. Edit it into the case's own words.">
          {(fid) => (
            <Textarea id={fid} rows={3} value={summary}
              onChange={(e) => setSummary(e.target.value)} />
          )}
        </Field>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button variant="primary" disabled={!title.trim() || busy}
          onClick={() => void (async () => {
            setBusy(true)
            const res = await createCaseFrom(submission.id, bureau, title, summary, defaultLead)
            setBusy(false)
            await onDone(res.error ?? null)
          })()}>
          Open the case
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-xs text-slate-500 sm:col-span-2">
        The case number continues the bureau&rsquo;s own series. This record is recorded
        as where the case came from, permanently &mdash; that link cannot be removed.
      </p>
    </div>
  )
}

function AddObservation({ submission, links, cases, onCancel, onDone }: {
  submission: FieldSubmissionRow
  links: FieldCaseLinkRow[]
  cases: CasePick[]
  onCancel: () => void
  onDone: (err: string | null) => Promise<void>
}) {
  const [caseId, setCaseId] = useState(links[0]?.case_id ?? '')
  const [activity, setActivity] = useState(submission.summary ?? '')
  const [location, setLocation] = useState('')
  // The record's own reliability grade is the same judgement about the same
  // information, so it is the default.
  const [confidence, setConfidence] = useState<ObservationConfidence>(
    (OBSERVATION_CONFIDENCE as readonly string[]).includes(submission.reliability ?? '')
      ? (submission.reliability as ObservationConfidence)
      : 'unverified',
  )
  const [busy, setBusy] = useState(false)

  return (
    <div className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-ink-950/40 p-3 sm:grid-cols-2">
      <Field label="On which case">
        {(fid) => (
          <Select id={fid} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            {links.map((l) => (
              <option key={l.id} value={l.case_id}>
                {caseName(cases.find((c) => c.id === l.case_id), l.submission_no)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Confidence" hint="No 'confirmed' — a report of something is not a confirmation of it.">
        {(fid) => (
          <Select id={fid} value={confidence}
            onChange={(e) => setConfidence(e.target.value as ObservationConfidence)}>
            {OBSERVATION_CONFIDENCE.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label="What was seen">
          {(fid) => (
            <Textarea id={fid} rows={2} value={activity}
              onChange={(e) => setActivity(e.target.value)} />
          )}
        </Field>
      </div>
      <Field label="Where">
        {(fid) => <Input id={fid} value={location} onChange={(e) => setLocation(e.target.value)} />}
      </Field>
      <div className="flex items-end gap-2">
        <Button variant="primary" disabled={!activity.trim() || !caseId || busy}
          onClick={() => void (async () => {
            setBusy(true)
            const res = await createObservationFrom(submission.id, caseId, activity, {
              observedAt: submission.observed_at ?? undefined,
              location, confidence,
            })
            setBusy(false)
            await onDone(res.error ?? null)
          })()}>
          Add it
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function RegisterSource({ onCancel, onDone }: {
  onCancel: () => void
  onDone: (codename: string, details: { name?: string; contact?: string; notes?: string }) => Promise<void>
}) {
  const [codename, setCodename] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div className="mt-3 grid gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 sm:grid-cols-2">
      <Field label="Codename" hint="This is the part reviewers see.">
        {(fid) => <Input id={fid} value={codename} onChange={(e) => setCodename(e.target.value)}
          placeholder="CS-14" />}
      </Field>
      <Field label="Handler">
        {(fid) => (
          <Input id={fid} value="You" disabled aria-describedby={fid}
            title="Registering a source against somebody else is command's call." />
        )}
      </Field>
      <Field label="Who they are">
        {(fid) => <Input id={fid} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="How to reach them">
        {(fid) => <Input id={fid} value={contact} onChange={(e) => setContact(e.target.value)} />}
      </Field>
      <div className="sm:col-span-2">
        <Field label="Handling notes">
          {(fid) => <Textarea id={fid} rows={2} value={notes}
            onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button variant="primary" disabled={!codename.trim() || busy}
          onClick={() => void (async () => {
            setBusy(true)
            await onDone(codename, { name, contact, notes })
            setBusy(false)
          })()}>
          Record the source
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-xs text-amber-200/70 sm:col-span-2">
        Everything except the codename goes into storage the browser cannot read at
        all &mdash; not by rank, not by role. Only you can see it back, and each time
        you do is recorded.
      </p>
    </div>
  )
}
