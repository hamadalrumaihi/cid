'use client'

/** §25 watchlist and §19 deconfliction — the two halves of "does anyone else
 *  care about this person?", on one screen because they are one workflow: you
 *  deconflict first, then you decide whether to watch.
 *
 *  ── What the deconfliction result does NOT mean ────────────────────────────
 *  `siu_deconflict()` excludes compartmented investigations from its count
 *  entirely — a hit count is an existence oracle, and a compartmented case
 *  exists precisely because its existence is restricted. So a zero result does
 *  NOT prove nobody else is looking at this entity, and the wording below is
 *  careful never to say it does. "No other interest recorded" is true; "nobody
 *  else is interested" would be a lie the query cannot support. See the header
 *  of migration 20260831120000 for why that cost is accepted.
 *
 *  ── Expiry is the point of the watchlist ──────────────────────────────────
 *  Every entry carries a hard end date; a watch that never expires is a
 *  permanent secret dossier on a named person. The UI leads with time
 *  remaining rather than burying it, and extending is a separate reasoned act
 *  rather than an edit.
 *
 *  Field agents only — `siu_watchlist_sel` is gated on `private.siu_is_agent()`,
 *  not on SIU standing generally, because the list can name the Director of
 *  CID. Oversight sees counts through the oversight report. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { rpc, withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  SIU_WATCH_ENTITY_TYPES, SIU_WATCH_MAX_DAYS, SIU_WATCH_PRIORITIES,
  SIU_WATCH_PRIORITY_LABEL, fetchSiuWatchlist, siuDeconflict, siuWatchEntityLabel,
  siuWatchPriorityTint, watchExpiringWithin, watchLive,
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

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const daysLeft = (v: string) =>
  Math.max(0, Math.ceil((new Date(v).getTime() - Date.now()) / 86_400_000))

export function SiuWatchlistSection() {
  const siu = useSiu()
  const [rows, setRows] = useState<SiuWatchEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showEnded, setShowEnded] = useState(false)
  const [adding, setAdding] = useState(false)

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

  const extend = async (w: SiuWatchEntry) => {
    const reason = await uiPrompt(
      `Extends the watch on ${w.label} by another 30 days. Somebody has to decide it is still warranted — that is why this asks rather than letting the date be edited.`,
      { title: 'Extend this watch', placeholder: 'Why it is still warranted', confirmText: 'Extend 30 days' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_watch_extend', { p_id: w.id, p_days: 30, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Watch extended.', 'success')
    void load()
  }

  const remove = async (w: SiuWatchEntry) => {
    const reason = await uiPrompt(
      'The entry is kept, marked removed. Who was watched, why, and who stopped it is the record that makes a watchlist accountable rather than a private list.',
      { title: `Remove ${w.label} from the watchlist`, placeholder: 'Reason', confirmText: 'Remove' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_watch_remove', { p_id: w.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Removed from the watchlist.', 'success')
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
      <DeconflictPanel />

      <Card>
        <SectionHeader
          title="Watchlist"
          subtitle="Entities the unit wants to know about, whether or not an investigation is open. Every entry expires — nothing here runs indefinitely."
          actions={
            <div className="flex items-center gap-2">
              {expiring > 0 && (
                <Badge tint="bg-amber-500/15 text-amber-300">{expiring} expiring within 14 days</Badge>
              )}
              <Button size="sm" onClick={() => setShowEnded((v) => !v)}>
                {showEnded ? 'Live only' : 'Show ended'}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add an entry</Button>
            </div>
          }
        />

        {!shown.length ? (
          <p className="mt-3 text-xs text-slate-400">
            {rows.length ? 'No live entries.' : 'Nothing is on the watchlist.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {shown.map((w) => {
              const live = watchLive(w)
              const left = daysLeft(w.expires_at)
              return (
                <li key={w.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tint={siuWatchPriorityTint(w.priority)}>
                      {SIU_WATCH_PRIORITY_LABEL[w.priority] ?? w.priority}
                    </Badge>
                    <Badge tone="neutral">{siuWatchEntityLabel(w.entity_type)}</Badge>
                    <span className="text-sm font-semibold text-slate-100">{w.label}</span>
                    {!live && (
                      <Badge tint="bg-slate-500/15 text-slate-300">
                        {w.status === 'removed' ? 'Removed' : 'Expired'}
                      </Badge>
                    )}
                    {live && left <= 14 && (
                      <Badge tint="bg-amber-500/15 text-amber-300">
                        {left === 0 ? 'Expires today' : `${left}d left`}
                      </Badge>
                    )}
                    <span className="ml-auto text-[11px] text-slate-500">
                      {live ? `Until ${fmtDate(w.expires_at)}` : fmtDate(w.removed_at ?? w.expires_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">{w.reason}</p>
                  {w.removal_reason && (
                    <p className="mt-1 text-[11px] text-slate-500">Removed: {w.removal_reason}</p>
                  )}
                  {live && (
                    <div className="mt-2 flex justify-end gap-3 text-[11px]">
                      <button
                        type="button"
                        className="text-slate-300 underline-offset-2 hover:underline"
                        onClick={() => void extend(w)}
                      >
                        Extend
                      </button>
                      <button
                        type="button"
                        className="text-rose-300 underline-offset-2 hover:underline"
                        onClick={() => void remove(w)}
                      >
                        Remove
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
    </div>
  )
}

/* ------------------------------------------------------------- deconfliction */

function DeconflictPanel() {
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
        subtitle="Before you approach an entity, check whether the unit already is. Coordination beats two agents burning the same operation."
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
              Coordinate through {result.coordinate_with ?? 'SIU command'} — the investigation and the
              agent working it are deliberately not named.
            </p>
          )}

          {!!result.watchlist?.length && (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
              On the watchlist: {result.watchlist.map((w) => w.label).join(', ')}
            </p>
          )}

          {!result.investigations?.length && !result.other_interest && (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
              No other interest recorded. Note this is not proof that nobody else is looking —
              compartmented investigations are excluded from this check by design, so deconflict
              compartmented work through command.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ add form */

function AddWatchModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [entityType, setEntityType] = useState<string>('person')
  const [label, setLabel] = useState('')
  const [reason, setReason] = useState('')
  const [priority, setPriority] = useState<string>('routine')
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!label.trim()) { toast('A label is required.', 'warn'); return }
    if (!reason.trim()) { toast('A reason is required.', 'warn'); return }
    if (days < 1 || days > SIU_WATCH_MAX_DAYS) {
      toast(`A watch runs for between 1 and ${SIU_WATCH_MAX_DAYS} days.`, 'warn'); return
    }
    setBusy(true)
    const res = await rpc('siu_watch_add', {
      p_entity_type: entityType,
      p_label: label.trim(),
      p_reason: reason.trim(),
      p_priority: priority,
      p_days: days,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Added to the watchlist.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!label || !!reason}>
      <ModalHeader title="Add to the watchlist" onClose={onClose} />
      <div className="space-y-3">
        <Field label="Type" required>
          {(id) => (
            <Select id={id} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              {SIU_WATCH_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>{siuWatchEntityLabel(t)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Name or identifier" required>
          {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Field label="Priority" required>
          {(id) => (
            <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {SIU_WATCH_PRIORITIES.map((p) => (
                <option key={p} value={p}>{SIU_WATCH_PRIORITY_LABEL[p]}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Runs for (days)"
          required
          hint={`Hard limit ${SIU_WATCH_MAX_DAYS}. Extending later is a separate, reasoned act — a watch is never open-ended.`}
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={SIU_WATCH_MAX_DAYS}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          )}
        </Field>
        <Field label="Reason" required hint="Why the unit needs to know about this entity.">
          {(id) => <Textarea id={id} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />}
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
