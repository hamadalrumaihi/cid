'use client'

/** §14 / §17 — the intake queue and the conflict register.
 *
 *  ── Why oversight cannot see this screen ───────────────────────────────────
 *  `siu_referrals` is gated on `private.siu_is_agent()`, NOT on SIB standing
 *  generally, so oversight standing — the Director of CID, the Attorney General
 *  — reads nothing here. That is the whole point of an intake queue: a referral
 *  can name the Director, and handing the queue to oversight would hand the
 *  subject the allegations against them. Oversight sees referral VOLUME through
 *  `siu_oversight_report()` and never contents.
 *
 *  This component therefore renders nothing at all for oversight, rather than a
 *  locked panel. A locked panel is itself a disclosure: it says "there are
 *  referrals, and you are not allowed to read them", which is more than the
 *  Director should learn from a screen.
 *
 *  ── Accepting is not the same as investigating ─────────────────────────────
 *  A review that accepts opens a PRELIMINARY INQUIRY by default, not a full
 *  investigation (§15). The distinction is real: an inquiry is invisible to
 *  oversight at every classification, which is what lets SIB look at a senior
 *  allegation before it is sure. Promotion is the deliberate act that makes it
 *  visible, and it is audited with a reason.
 *
 *  ── The conflict register ──────────────────────────────────────────────────
 *  A declared conflict is a VETO (`private.siu_recused()`): while it stands,
 *  the agent is walled out of the case regardless of rank, and command included.
 *  Only `cleared` lifts it, and never by the agent who declared it — the
 *  not-self rule lives in `public.siu_resolve_conflict()`, and the button below
 *  is only the cosmetic half of it. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc, withRetry } from '@/lib/db'
import { siuCategoryLabel, siuStateLabel, siuStateTone } from '@/lib/fieldSiu'
import { jurisdictionLabel } from '@/lib/fieldSubmissions'
import { intelReviewHref } from '@/lib/notifText'
import { useSiu } from '@/lib/permissions'
import { useToolNav } from '@/components/tools/useToolNav'
import { SiuAccessQueue } from './SiuAccessRequest'
import {
  SIU_CASE_CATEGORIES, SIU_CLASSIFICATIONS, SIU_CONFLICT_RESOLUTIONS,
  SIU_REFERRAL_DISPOSITIONS, SIU_STAGES, fetchSiuAccessRequests, fetchSiuConflicts,
  fetchSiuReferrals,
  siuCaseCategoryLabel, siuClassificationLabel, siuConflictStatusLabel,
  siuRecusesAccess, siuReferralCategoryLabel, siuReferralStatusLabel,
  siuReferralStatusTint, siuStageLabel,
  type SiuAccessRequest, type SiuConflict, type SiuReferral,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SectionHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Field, Select, Textarea } from '@/components/ui/Field'

const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/** Referrals still needing a decision. */
const OPEN_STATUSES = ['submitted', 'under_review', 'info_requested']

/** One row of `siu_referred_submissions()` (P6-07): the cross-link from a
 *  Field Intelligence report SIB was asked to take. The RPC returns the id,
 *  the number and the SIB handling columns -- never the summary. It answers
 *  agents only (`private.siu_is_agent()`), zero rows for oversight, so this
 *  list sits behind the same nothing-here surface as the referral queue. */
interface ReferredSubmission {
  id: string
  submission_no: string | null
  siu_category: string | null
  siu_state: string | null
  siu_referred_at: string | null
  siu_referred_by: string | null
  siu_assigned_to: string | null
  siu_case_id: string | null
  jurisdiction: string | null
}

async function fetchReferredSubmissions(): Promise<ReferredSubmission[]> {
  const res = await rpc('siu_referred_submissions', {})
  if (res.error || !Array.isArray(res.data)) return []
  return res.data as unknown as ReferredSubmission[]
}

export function SiuIntakeSection() {
  const siu = useSiu()
  const [rows, setRows] = useState<SiuReferral[]>([])
  const [conflicts, setConflicts] = useState<SiuConflict[]>([])
  const [access, setAccess] = useState<SiuAccessRequest[]>([])
  const [intel, setIntel] = useState<ReferredSubmission[]>([])
  const [people, setPeople] = useState<Tables<'profiles'>[]>([])
  const [loading, setLoading] = useState(true)
  const [showClosed, setShowClosed] = useState(false)
  const [reviewing, setReviewing] = useState<SiuReferral | null>(null)

  const load = useCallback(async () => {
    try {
      const [r, k, p, a, fi] = await Promise.all([
        withRetry(() => fetchSiuReferrals()),
        withRetry(() => fetchSiuConflicts()),
        withRetry(() => list('profiles', { order: 'display_name', limit: 500 })),
        // Command-only by RLS; an ordinary agent simply gets an empty list.
        withRetry(() => fetchSiuAccessRequests()).catch((): SiuAccessRequest[] => []),
        // Agents only server-side; fail-open to none, like the rest.
        fetchReferredSubmissions().catch((): ReferredSubmission[] => []),
      ])
      setRows(r); setConflicts(k); setPeople(p); setAccess(a); setIntel(fi)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'danger')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const nameOf = useCallback(
    (id?: string | null) => (id && people.find((p) => p.id === id)?.display_name) || null,
    [people],
  )

  const shown = useMemo(
    () => rows.filter((r) => showClosed || OPEN_STATUSES.includes(r.status)),
    [rows, showClosed],
  )
  const open = useMemo(() => rows.filter((r) => OPEN_STATUSES.includes(r.status)).length, [rows])
  const liveConflicts = useMemo(
    () => conflicts.filter((k) => siuRecusesAccess(k.status)),
    [conflicts],
  )

  // Oversight standing reaches this component through the section tabs but has
  // no read on either table. Render the ordinary nothing-here surface rather
  // than a locked panel — see the header comment.
  if (!siu.isAgent) {
    return (
      <Card>
        <SectionHeader
          title="Intake"
          subtitle="Referral handling is a field function. Referral volume appears in the oversight report."
        />
      </Card>
    )
  }

  if (loading) return <ListSkeleton />

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="Referrals"
          subtitle="Reports that came in from outside the unit. Accepting one opens a preliminary inquiry unless you say otherwise."
          actions={
            <div className="flex items-center gap-2">
              {open > 0 && <Badge tint="bg-amber-500/15 text-amber-300">{open} awaiting review</Badge>}
              <Button size="sm" onClick={() => setShowClosed((v) => !v)}>
                {showClosed ? 'Show open only' : 'Show all'}
              </Button>
            </div>
          }
        />

        {!shown.length ? (
          <p className="mt-3 text-xs text-slate-400">
            {rows.length ? 'Nothing is awaiting review.' : 'No referrals have been submitted.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {shown.map((r) => (
              <li key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tint={siuReferralStatusTint(r.status)}>{siuReferralStatusLabel(r.status)}</Badge>
                  <Badge tone="neutral">{siuReferralCategoryLabel(r.category)}</Badge>
                  <span className="text-sm font-semibold text-slate-100">{r.summary}</span>
                  <span className="ml-auto text-[11px] text-slate-500">{fmtWhen(r.submitted_at)}</span>
                </div>
                {r.detail && (
                  <p className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{r.detail}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                  <span>From: {nameOf(r.submitted_by) ?? 'Unknown'}</span>
                  {(r.subject_user_id || r.subject_description) && (
                    <span className="text-amber-300/80">
                      Concerns: {nameOf(r.subject_user_id) ?? r.subject_description}
                    </span>
                  )}
                  {r.reviewed_at && (
                    <span>Reviewed by {nameOf(r.reviewed_by) ?? 'Unknown'} · {fmtWhen(r.reviewed_at)}</span>
                  )}
                  {r.opened_case_id && <span className="text-emerald-300/80">Investigation opened</span>}
                  {!r.opened_case_id && (
                    <button
                      type="button"
                      className="ml-auto text-sky-300 underline-offset-2 hover:underline"
                      onClick={() => setReviewing(r)}
                    >
                      Review
                    </button>
                  )}
                </div>
                {r.review_note && (
                  <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-400">
                    {r.review_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ReferredIntel rows={intel} nameOf={nameOf} />

      <Card>
        <SectionHeader
          title="Conflicts of interest"
          subtitle="A declared conflict removes that agent's access immediately, at any rank. Only a different member of command can clear one."
          actions={
            liveConflicts.length > 0
              ? <Badge tint="bg-amber-500/15 text-amber-300">{liveConflicts.length} standing</Badge>
              : undefined
          }
        />
        {!conflicts.length ? (
          <p className="mt-3 text-xs text-slate-400">No conflicts have been declared.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {conflicts.map((k) => (
              <li key={k.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tint={siuRecusesAccess(k.status)
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-emerald-500/15 text-emerald-300'}>
                    {siuConflictStatusLabel(k.status)}
                  </Badge>
                  <span className="text-sm text-slate-100">{nameOf(k.agent_id) ?? 'An agent'}</span>
                  <span className="ml-auto text-[11px] text-slate-500">{fmtWhen(k.declared_at)}</span>
                </div>
                <p className="mt-2 text-xs text-slate-300">{k.reason}</p>
                {k.resolution_note && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    {siuConflictStatusLabel(k.status)} by {nameOf(k.acknowledged_by) ?? 'command'}: {k.resolution_note}
                  </p>
                )}
                {siu.isCommand && siuRecusesAccess(k.status) && (
                  <div className="mt-2 flex justify-end">
                    <ResolveConflict conflict={k} onDone={() => void load()} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {siu.isCommand && <SiuAccessQueue rows={access} onDone={() => void load()} />}

      {reviewing && (
        <ReviewModal
          referral={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); void load() }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------ referred field intel */

/** Field Intelligence reports referred to (or accepted by) SIB. The report
 *  stays CID's -- "a referral is not a disappearance" -- so each row opens it
 *  in the Intelligence review tool rather than copying anything here. */
function ReferredIntel({ rows, nameOf }: {
  rows: ReferredSubmission[]
  nameOf: (id?: string | null) => string | null
}) {
  const nav = useToolNav()
  const waiting = rows.filter((r) => r.siu_state === 'referred').length
  return (
    <Card>
      <SectionHeader
        title="Referred from field intelligence"
        subtitle="Reports CID asked SIB to take. Accept or decline on the report itself; it keeps its FI number and its queue either way."
        actions={waiting > 0
          ? <Badge tint="bg-amber-500/15 text-amber-300">{waiting} awaiting a decision</Badge>
          : undefined}
      />
      {!rows.length ? (
        <p className="mt-3 text-xs text-slate-400">No field intelligence has been referred.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={siuStateTone(r.siu_state)}>{siuStateLabel(r.siu_state)}</Badge>
                <Badge tone="neutral">{siuCategoryLabel(r.siu_category)}</Badge>
                <button type="button"
                  className="font-mono text-sm font-semibold text-slate-100 underline-offset-2 hover:underline"
                  onClick={() => nav.openHref(intelReviewHref(r.id))}>
                  {r.submission_no ?? 'Field report'}
                </button>
                <span className="ml-auto text-[11px] text-slate-400">{fmtWhen(r.siu_referred_at)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                <span>{jurisdictionLabel(r.jurisdiction)}</span>
                {r.siu_referred_by && <span>Referred by {nameOf(r.siu_referred_by) ?? 'a CID investigator'}</span>}
                {r.siu_assigned_to && <span>SIB: {nameOf(r.siu_assigned_to) ?? 'a Special Agent'}</span>}
                {r.siu_case_id && <span className="text-emerald-300/80">Investigation linked</span>}
                <button
                  type="button"
                  className="ml-auto text-sky-300 underline-offset-2 hover:underline"
                  onClick={() => nav.openHref(intelReviewHref(r.id))}
                >
                  Open the report
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------ review a referral */

function ReviewModal({ referral, onClose, onDone }: {
  referral: SiuReferral
  onClose: () => void
  onDone: () => void
}) {
  const [disposition, setDisposition] = useState<string>('accepted')
  const [note, setNote] = useState('')
  const [openAs, setOpenAs] = useState<string>('preliminary_inquiry')
  const [classification, setClassification] = useState<string>('siu_restricted')
  const [category, setCategory] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const accepting = disposition === 'accepted'

  const save = async () => {
    if (!note.trim()) { toast('A review note is required.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_review_referral', {
      p_referral: referral.id,
      p_disposition: disposition,
      p_note: note.trim(),
      ...(accepting ? {
        p_open_as: openAs,
        p_classification: classification,
        ...(category ? { p_category: category } : {}),
      } : {}),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(accepting ? 'Referral accepted and opened.' : 'Referral reviewed.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!note}>
      <ModalHeader title="Review referral" onClose={onClose} />
      <div className="space-y-3">
        <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
          {referral.summary}
        </p>

        <Field label="Disposition" required>
          {(id) => (
            <Select id={id} value={disposition} onChange={(e) => setDisposition(e.target.value)}>
              {SIU_REFERRAL_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>{siuReferralStatusLabel(d)}</option>
              ))}
            </Select>
          )}
        </Field>

        {accepting && (
          <>
            <Field
              label="Open as"
              required
              hint="A preliminary inquiry is invisible to oversight — the Director and the Attorney General see it only once you promote it."
            >
              {(id) => (
                <Select id={id} value={openAs} onChange={(e) => setOpenAs(e.target.value)}>
                  {SIU_STAGES.map((s) => (
                    <option key={s} value={s}>{siuStageLabel(s)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Classification" required hint="Sensitivity — who inside SIB may reach it.">
              {(id) => (
                <Select id={id} value={classification} onChange={(e) => setClassification(e.target.value)}>
                  {SIU_CLASSIFICATIONS.map((c) => (
                    <option key={c} value={c}>{siuClassificationLabel(c)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Category" hint="Subject matter. Independent of classification, and can be set later.">
              {(id) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Not yet decided</option>
                  {SIU_CASE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{siuCaseCategoryLabel(c)}</option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        <Field label="Review note" required hint="Why this decision. The submitter never sees it.">
          {(id) => (
            <Textarea id={id} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : accepting ? 'Accept and open' : 'Record review'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ resolve a conflict */

function ResolveConflict({ conflict, onDone }: { conflict: SiuConflict; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<string>('reassigned')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!note.trim()) { toast('A resolution note is required.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_resolve_conflict', {
      p_conflict: conflict.id, p_status: status, p_note: note.trim(),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    setOpen(false)
    toast(status === 'cleared' ? 'Conflict cleared — access restored.' : 'Conflict resolved.', 'success')
    onDone()
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Resolve</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} dirty={() => !!note}>
          <ModalHeader title="Resolve conflict" onClose={() => setOpen(false)} />
          <div className="space-y-3">
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300/90">
              Only <strong className="font-semibold">Cleared</strong> restores the agent&apos;s access.
              Reassigned keeps them off the investigation — it records that the conflict was real
              and the work moved, not that it went away.
            </p>
            <Field label="Resolution" required>
              {(id) => (
                <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {SIU_CONFLICT_RESOLUTIONS.map((s) => (
                    <option key={s} value={s}>{siuConflictStatusLabel(s)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Note" required>
              {(id) => (
                <Textarea id={id} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Record'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
