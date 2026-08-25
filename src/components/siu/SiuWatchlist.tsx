'use client'

/** §25 watchlist and §19 deconfliction — the two halves of "does anyone else
 *  care about this person?", on one screen because they are one workflow: you
 *  deconflict first, then you decide whether to watch.
 *
 *  ── The watchlist points at records; it does not describe them ─────────────
 *  Every entry names a row in a shared registry (`persons`, `vehicles`,
 *  `gangs`, `places`, `accounts`, `indicators`). The name on screen is read
 *  through that link on every load, so a correction made anywhere in CID shows
 *  here at once. Nothing in this file caches a subject's name back onto a watch
 *  — that is how the unit ended up with a second, worse copy of the address
 *  book, which migration 20260903120000 exists to undo.
 *
 *  The add form therefore SEARCHES the registry rather than offering a text
 *  box. The only way to type a name is to choose "not in the registry", which
 *  creates an unidentified stub to be attached later — an escape hatch, marked
 *  as one, not the normal path.
 *
 *  ── What the deconfliction result does NOT mean ────────────────────────────
 *  `siu_deconflict()` excludes compartmented investigations from its count
 *  entirely — a hit count is an existence oracle, and a compartmented case
 *  exists precisely because its existence is restricted. So a zero result does
 *  NOT prove nobody else is looking at this entity, and the wording below is
 *  careful never to say it does. "No other interest recorded" is true; "nobody
 *  else is interested" would be a lie the query cannot support.
 *
 *  ── Expiry is the point of the watchlist ──────────────────────────────────
 *  Every entry carries a hard end date; a watch that never expires is a
 *  permanent secret dossier on a named person. The UI leads with time
 *  remaining, and both extending and reviewing are separate reasoned acts
 *  rather than edits.
 *
 *  Field agents only — `siu_watchlist_sel` is gated on `private.siu_is_agent()`,
 *  not on SIB standing generally, because the list can name the Director of
 *  CID. Oversight sees counts through the oversight report. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { rpc, withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  SIU_WATCH_ENTITY_TYPES, SIU_WATCH_MAX_DAYS, SIU_WATCH_PRIORITIES,
  SIU_WATCH_PRIORITY_LABEL, SIU_WATCH_REVIEW_OUTCOMES,
  fetchSiuWatchlist, siuDeconflict, siuWatchEntityLabel,
  siuWatchPriorityTint, siuWatchStatusLabel, watchExpiringWithin, watchLive,
  type SiuDeconflictResult, type SiuWatchEntry,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SectionHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { uiPrompt } from '@/components/ui/dialog'
import { SiuPersonDossierModal } from './SiuPersonDossier'
import {
  SiuRegistryPicker, choiceIsComplete, emptyChoice, type SiuRegistryChoice,
} from './SiuRegistryPicker'

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function SiuWatchlistSection() {
  const siu = useSiu()
  const [rows, setRows] = useState<SiuWatchEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showEnded, setShowEnded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [reviewing, setReviewing] = useState<SiuWatchEntry | null>(null)
  const [dossier, setDossier] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await withRetry(() => fetchSiuWatchlist())) }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const shown = useMemo(
    () => rows.filter((w) => showEnded || watchLive(w)),
    [rows, showEnded],
  )
  const expiring = useMemo(
    () => rows.filter((w) => watchExpiringWithin(w, 14)).length,
    [rows],
  )
  const overdue = useMemo(() => rows.filter((w) => w.review_overdue).length, [rows])

  const extend = async (w: SiuWatchEntry) => {
    const reason = await uiPrompt(
      `Extends the watch on ${w.display_name} by another 30 days. Somebody has to decide it is still warranted — that is why this asks rather than letting the date be edited.`,
      { title: 'Extend this watch', placeholder: 'Why it is still warranted', confirmText: 'Extend 30 days' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_watch_extend', { p_id: w.id, p_days: 30, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Watch extended.', 'success')
    void load()
  }

  if (!siu.isAgent) {
    return (
      <Card>
        <SectionHeader
          title="Watchlist"
          subtitle="The watchlist is a field function. Its size appears in the oversight report."
        />
      </Card>
    )
  }

  if (loading) return <CardGridSkeleton cols="" />

  return (
    <div className="space-y-4">
      <DeconflictPanel onWatch={() => setAdding(true)} />

      <Card>
        <SectionHeader
          title="Watchlist"
          subtitle="Subjects the unit wants to know about, whether or not an investigation is open. Each entry points at the record in the registry, so names and affiliations stay current. Every entry expires — nothing here runs indefinitely."
          actions={
            <div className="flex items-center gap-2">
              {overdue > 0 && (
                <Badge tint="bg-rose-500/15 text-rose-300">{overdue} review overdue</Badge>
              )}
              {expiring > 0 && (
                <Badge tint="bg-amber-500/15 text-amber-300">{expiring} expiring within 14 days</Badge>
              )}
              <Button size="sm" onClick={() => setShowEnded((v) => !v)}>
                {showEnded ? 'Live only' : 'Show ended'}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                + Add to watchlist
              </Button>
            </div>
          }
        />

        {!shown.length ? (
          <EmptyWatchlist ended={rows.length > 0} onAdd={() => setAdding(true)} />
        ) : (
          <ul className="mt-3 space-y-2">
            {shown.map((w) => {
              const live = watchLive(w)
              return (
                <li key={w.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tint={siuWatchPriorityTint(w.priority)}>
                      {SIU_WATCH_PRIORITY_LABEL[w.priority] ?? w.priority}
                    </Badge>
                    <Badge tone="neutral">{siuWatchEntityLabel(w.entity_type)}</Badge>
                    {/* Opens the dossier rather than an edit form: the useful
                        thing to do with a watch is look at what is already
                        known about the subject. */}
                    {w.entity_type === 'person' && w.entity_id ? (
                      <button
                        type="button"
                        className="text-sm font-semibold text-slate-100 underline-offset-2 hover:underline"
                        onClick={() => setDossier(w.entity_id)}
                      >
                        {w.display_name}
                      </button>
                    ) : (
                      <span className="text-sm font-semibold text-slate-100">{w.display_name}</span>
                    )}
                    {w.secondary && (
                      <span className="text-[11px] text-slate-500">{w.secondary}</span>
                    )}
                    {w.entity_type === 'unknown' && (
                      <Badge tint="bg-white/5 text-slate-400">Not attached to a record</Badge>
                    )}
                    {live && w.status !== 'active' && (
                      <Badge tone="neutral">{siuWatchStatusLabel(w.status)}</Badge>
                    )}
                    {!live && (
                      <Badge tint="bg-slate-500/15 text-slate-300">
                        {w.status === 'cleared' ? 'Cleared'
                          : w.status === 'archived' ? 'Archived' : 'Expired'}
                      </Badge>
                    )}
                    {w.review_overdue && (
                      <Badge tint="bg-rose-500/15 text-rose-300">Review overdue</Badge>
                    )}
                    {live && w.days_left <= 14 && (
                      <Badge tint="bg-amber-500/15 text-amber-300">
                        {w.days_left === 0 ? 'Expires today' : `${w.days_left}d left`}
                      </Badge>
                    )}
                    <span className="ml-auto text-[11px] text-slate-500">
                      {live ? `Until ${fmtDate(w.expires_at)}` : fmtDate(w.removed_at ?? w.expires_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">{w.reason}</p>
                  {(w.case_number || w.assigned_agent_name || w.source) && (
                    <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                      {w.case_number && <span>Case {w.case_number}</span>}
                      {w.assigned_agent_name && <span>Agent {w.assigned_agent_name}</span>}
                      {w.source && <span>Source: {w.source}</span>}
                    </p>
                  )}
                  {w.removal_reason && (
                    <p className="mt-1 text-[11px] text-slate-500">Closed: {w.removal_reason}</p>
                  )}
                  {live && (
                    <div className="mt-2 flex justify-end gap-3 text-[11px]">
                      {w.entity_type === 'person' && w.entity_id && (
                        <button
                          type="button"
                          className="text-slate-300 underline-offset-2 hover:underline"
                          onClick={() => setDossier(w.entity_id)}
                        >
                          Open dossier
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-slate-300 underline-offset-2 hover:underline"
                        onClick={() => void extend(w)}
                      >
                        Extend
                      </button>
                      <button
                        type="button"
                        className="text-sky-300 underline-offset-2 hover:underline"
                        onClick={() => setReviewing(w)}
                      >
                        Review
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {adding && (
        <AddWatchModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); void load() }} />
      )}
      {reviewing && (
        <ReviewWatchModal
          entry={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); void load() }}
        />
      )}
      {dossier && (
        <SiuPersonDossierModal personId={dossier} onClose={() => setDossier(null)} />
      )}
    </div>
  )
}

/** An empty list should say what to do next, not just that it is empty. */
function EmptyWatchlist({ ended, onAdd }: { ended: boolean; onAdd: () => void }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
      <p className="text-sm font-semibold text-slate-200">
        {ended ? 'No live entries.' : 'Nothing is on the watchlist.'}
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
        A watch records that the unit wants to know about a subject even when no
        investigation is open. Pick the subject from the registry so the entry
        stays tied to what CID already knows about them.
      </p>
      <Button variant="primary" size="sm" className="mt-3" onClick={onAdd}>
        + Add to watchlist
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------- deconfliction */

function DeconflictPanel({ onWatch }: { onWatch: () => void }) {
  const [entityType, setEntityType] = useState<string>('person')
  const [label, setLabel] = useState('')
  const [result, setResult] = useState<SiuDeconflictResult | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!label.trim()) { toast('Name the entity to check.', 'warn'); return }
    setBusy(true)
    try { setResult(await siuDeconflict(entityType, null, label.trim())) }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger') }
    finally { setBusy(false) }
  }

  return (
    <Card>
      <SectionHeader
        title="Deconflict"
        subtitle="Before you approach a subject, check whether the unit already is. Coordination beats two agents burning the same operation."
      />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                {SIU_WATCH_ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>{siuWatchEntityLabel(t)}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="min-w-[14rem] flex-1">
          <Field label="Name or identifier">
            {(id) => (
              <Input
                id={id}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
                placeholder="e.g. Marcus Webb"
              />
            )}
          </Field>
        </div>
        <Button variant="primary" disabled={busy} onClick={() => void run()}>
          {busy ? 'Checking…' : 'Check'}
        </Button>
      </div>

      {result && (
        <div className="mt-3 space-y-2">
          {!!result.investigations?.length && (
            <ul className="space-y-1.5">
              {result.investigations.map((h) => (
                <li key={h.case_id} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
                  <span className="font-semibold text-slate-100">{h.case_number}</span>
                  <span className="text-slate-400"> — {h.title ?? 'Untitled'}</span>
                  {h.designation && <Badge tone="neutral" className="ml-2">{h.designation}</Badge>}
                </li>
              ))}
            </ul>
          )}

          {!!result.other_interest && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
              <strong className="font-semibold">
                {result.other_interest} other investigation{result.other_interest === 1 ? '' : 's'}
              </strong>{' '}
              you cannot see {result.other_interest === 1 ? 'has' : 'have'} an interest in this entity.
              Coordinate through {result.coordinate_with ?? 'SIB command'} — the investigation and the
              agent working it are deliberately not named.
            </p>
          )}

          {!!result.watchlist?.length && (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
              Already on the watchlist:{' '}
              {result.watchlist.map((w) => `${w.label} (${siuWatchStatusLabel(w.status)})`).join(', ')}
            </p>
          )}

          {!result.investigations?.length && !result.other_interest && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
              <p>
                No other interest recorded. Note this is not proof that nobody else is looking —
                compartmented investigations are excluded from this check by design, so deconflict
                compartmented work through command.
              </p>
              {!result.watchlist?.length && (
                <button
                  type="button"
                  className="mt-1.5 text-sky-300 underline-offset-2 hover:underline"
                  onClick={onWatch}
                >
                  Add this subject to the watchlist
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ add form */

/** The add form. The subject is chosen from a registry through the shared
 *  picker — the same component target designation uses, so neither screen can
 *  drift back towards a free-text box and regrow the duplicate address book. */
function AddWatchModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [choice, setChoice] = useState<SiuRegistryChoice>(emptyChoice)
  const [reason, setReason] = useState('')
  const [priority, setPriority] = useState<string>('routine')
  const [days, setDays] = useState(90)
  const [reviewDays, setReviewDays] = useState(30)
  const [notes, setNotes] = useState('')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!choiceIsComplete(choice)) { toast('Choose the record this watch is about.', 'warn'); return }
    if (!reason.trim()) { toast('A reason is required.', 'warn'); return }
    if (days < 1 || days > SIU_WATCH_MAX_DAYS) {
      toast(`A watch runs for between 1 and ${SIU_WATCH_MAX_DAYS} days.`, 'warn'); return
    }
    if (reviewDays < 1 || reviewDays > days) {
      toast('The review must fall within the life of the watch.', 'warn'); return
    }
    setBusy(true)
    const res = await rpc('siu_watch_add', {
      p_entity_type: choice.entityType,
      // Omitted rather than sent as null: the RPC's own defaults are the
      // single definition of what an unset optional means.
      p_entity_id: choice.entityId ?? undefined,
      p_reason: reason.trim(),
      p_priority: priority,
      p_days: days,
      p_review_days: reviewDays,
      p_source: source.trim() || undefined,
      p_notes: notes.trim() || undefined,
      p_label: choice.label?.trim() || undefined,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Added to the watchlist.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => choiceIsComplete(choice) || !!reason}>
      <ModalHeader title="Add to the watchlist" onClose={onClose} />
      <div className="space-y-3">
        {/* excludeWatched: a second live watch is refused by a unique index, so
            offering one would be a form that fails on save. */}
        <SiuRegistryPicker value={choice} onChange={setChoice} excludeWatched />

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
          <Field
            label="Runs for (days)"
            required
            hint={`Hard limit ${SIU_WATCH_MAX_DAYS}. A watch is never open-ended.`}
          >
            {(id) => (
              <Input
                id={id} type="number" min={1} max={SIU_WATCH_MAX_DAYS}
                value={days} onChange={(e) => setDays(Number(e.target.value))}
              />
            )}
          </Field>
          <Field label="Review after (days)" required hint="When somebody must look at this again.">
            {(id) => (
              <Input
                id={id} type="number" min={1} max={days}
                value={reviewDays} onChange={(e) => setReviewDays(Number(e.target.value))}
              />
            )}
          </Field>
        </div>

        <Field label="Reason" required hint="Why the unit needs to know about this subject.">
          {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <Field label="Source" hint="Where this came from. Optional.">
          {(id) => <Input id={id} value={source} onChange={(e) => setSource(e.target.value)} />}
        </Field>
        <Field label="Notes" hint="Handling instructions or context. Optional.">
          {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- review form */

/** §16. The review is what stops a watch drifting into permanence: somebody
 *  has to look at it again and say what they decided, in writing. Clearing and
 *  archiving keep the row — ending the monitoring is not a reason to erase the
 *  record of who was watched and why. */
function ReviewWatchModal({ entry, onClose, onDone }: {
  entry: SiuWatchEntry; onClose: () => void; onDone: () => void
}) {
  const [outcome, setOutcome] = useState<string>('continue')
  const [note, setNote] = useState('')
  const [priority, setPriority] = useState<string>(entry.priority)
  const [reviewDays, setReviewDays] = useState(30)
  const [extendDays, setExtendDays] = useState(0)
  const [busy, setBusy] = useState(false)

  const closing = outcome === 'clear' || outcome === 'archive'

  const save = async () => {
    if (!note.trim()) { toast('A review note is required.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_watch_review', {
      p_id: entry.id,
      p_outcome: outcome,
      p_note: note.trim(),
      // Left off when unchanged — siu_watch_review() coalesces a missing
      // priority to the one already on the entry.
      p_priority: priority === entry.priority ? undefined : priority,
      p_review_days: reviewDays,
      p_extend_days: extendDays > 0 ? extendDays : undefined,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Review recorded.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!note}>
      <ModalHeader title={`Review the watch on ${entry.display_name}`} onClose={onClose} />
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-slate-400">
          Opened {fmtDate(entry.created_at)} — {entry.reason}
        </p>

        <Field label="Outcome" required>
          {(id) => (
            <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {SIU_WATCH_REVIEW_OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          )}
        </Field>

        {!closing && (
          <>
            <Field label="Priority">
              {(id) => (
                <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {SIU_WATCH_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{SIU_WATCH_PRIORITY_LABEL[p]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Next review in (days)" required>
                {(id) => (
                  <Input
                    id={id} type="number" min={1} max={SIU_WATCH_MAX_DAYS}
                    value={reviewDays} onChange={(e) => setReviewDays(Number(e.target.value))}
                  />
                )}
              </Field>
              <Field label="Extend expiry by (days)" hint="Leave at 0 to keep the current end date.">
                {(id) => (
                  <Input
                    id={id} type="number" min={0} max={SIU_WATCH_MAX_DAYS}
                    value={extendDays} onChange={(e) => setExtendDays(Number(e.target.value))}
                  />
                )}
              </Field>
            </div>
          </>
        )}

        <Field
          label="Review note"
          required
          hint={closing
            ? 'The entry is kept and marked closed. Who was watched, why, and who stopped it is the record that makes a watchlist accountable rather than a private list.'
            : 'The record that somebody actually looked at this.'}
        >
          {(id) => <Textarea id={id} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Record the review'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
