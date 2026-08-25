'use client'

/** Restrict a record to SIB — the action, wherever the record is.
 *
 *  ── Why this is not only in the SIB workspace ─────────────────────────────
 *  It was, and that was wrong. To hide a person you had to leave their profile,
 *  find the SIB tab, open Compartments and search the registry for the record
 *  you were already looking at. Every one of those steps is a chance to pick
 *  the wrong person, and the consequence of picking the wrong person here is
 *  that CID silently loses access to somebody. Acting from the record makes the
 *  subject unmistakable.
 *
 *  ── Who sees it ───────────────────────────────────────────────────────────
 *  `siu.mayControlVisibility`, which is NOT `siu.isAgent` and NOT
 *  `siu.canAccess`. All three SIB ranks, the Director and the Owner may
 *  restrict and reveal; the Director has no SIB standing at all and must never
 *  be handed the SIB workspace. So the action is gated on the narrow capability
 *  and appears without opening any SIB screen.
 *
 *  Hiding it from everyone else is not the enforcement — every RPC re-checks
 *  server-side — but its PRESENCE on a shared CID registry page would tell any
 *  detective that records can be hidden from them, which is most of what the
 *  compartment is for.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSiu } from '@/lib/useSiu'
import {
  COMPARTMENT_TYPES, compartmentTypeLabel, reasonIsUsable, restrict,
  restrictionImpact, restrictPreview, revealPreview, sectionsFor,
  type RestrictMode, type RestrictionImpact,
} from '@/lib/siuVisibility'
import { toast } from '@/lib/toast'
import { AccessBadge } from '@/components/ui/AccessBadge'
import { Badge } from '@/components/ui/Badge'
import { HelpTip } from '@/components/ui/HelpTip'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Field, Textarea } from '@/components/ui/Field'
import {
  SiuRegistryPicker, choiceIsComplete, emptyChoice, type SiuRegistryChoice,
} from './SiuRegistryPicker'

const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014'

/** The confirmation screen for taking a record out of CID's view.
 *
 *  The brief calls for "move record" to be banned as wording, and it is right:
 *  the two restrictions do very different things and the difference is not
 *  recoverable once somebody has clicked. So the screen states, before either
 *  button is live, who created the record, whether CID has contributed to it,
 *  what CID currently has attached, and — separately for each mode — exactly
 *  what CID loses and exactly what CID keeps.
 *
 *  Every number comes from siu_restriction_impact(), which is the same function
 *  the server consults when it decides whether to demand the second
 *  confirmation. The figure on the page and the figure in the guard are one
 *  figure. A screen that computed its own would eventually disagree, and the
 *  disagreement would surface as a refusal nobody could explain.
 */
function Dep({ n, label }: { n: number; label: string }) {
  if (!n) return null
  return (
    <li className="flex items-baseline gap-2 text-xs">
      <span className="min-w-[2rem] text-right font-semibold text-white">{n}</span>
      <span className="text-slate-400">{label}</span>
    </li>
  )
}

export function RestrictDialog({ target, onClose, onDone }: {
  /** Fixed subject, when the action was taken FROM the record. Omit to let the
   *  operator search for one — the workspace entry point. Acting from the
   *  record is the better path and the reason this component exists: the
   *  subject is already chosen and cannot be mistyped into the wrong person. */
  target?: { type: string; id: string }
  onClose: () => void
  onDone: () => void
}) {
  const [choice, setChoice] = useState<SiuRegistryChoice>(
    target ? { entityType: target.type, entityId: target.id, label: null, displayName: '' } : emptyChoice)
  const [impact, setImpact] = useState<RestrictionImpact | null>(null)
  const [mode, setMode] = useState<RestrictMode | null>(null)
  const [sections, setSections] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)

  const picked = choiceIsComplete(choice) && choice.entityId
    && (COMPARTMENT_TYPES as readonly string[]).includes(choice.entityType)

  // Load the cost as soon as a record is chosen, and let the SERVER pick the
  // recommended mode rather than re-deriving the rule here.
  useEffect(() => {
    let live = true
    const id = choice.entityId
    // Every state write happens after an await, so the effect body itself never
    // triggers a synchronous cascading render (the ShiftsView pattern).
    void (async () => {
      const i = picked && id
        ? await restrictionImpact(choice.entityType, id).catch(() => null)
        : null
      if (!live) return
      setImpact(i)
      setMode(i?.recommended_mode ?? null)
      setSections([])
      setAck(false)
    })()
    return () => { live = false }
  }, [picked, choice.entityType, choice.entityId])

  const offered = useMemo(() => sectionsFor(choice.entityType), [choice.entityType])
  const needsAck = !!impact?.cid_authored && mode === 'record'
  const ok = !!picked && !!impact && !!mode && reasonIsUsable(reason)
    && (mode !== 'sections' || sections.length > 0)
    && (!needsAck || ack)

  const go = async () => {
    if (!choice.entityId || !mode) return
    setBusy(true)
    try {
      await restrict({
        type: choice.entityType, id: choice.entityId, mode, reason,
        sections: mode === 'sections' ? sections : undefined,
        acknowledge: ack,
      })
      toast(mode === 'record'
        ? 'Restricted. CID can no longer see this record.'
        : 'Restricted. CID keeps the profile; the selected sections are hidden.', 'success')
      onDone()
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'danger')
    } finally { setBusy(false) }
  }

  const toggle = (id: string) =>
    setSections((v) => v.includes(id) ? v.filter((x) => x !== id) : [...v, id])

  return (
    <Modal open onClose={onClose} wide dirty={() => reason.trim().length > 0 || !!choice.entityId}>
      <ModalHeader title="Restrict to SIB" onClose={onClose} />

      {!target && (
        <SiuRegistryPicker
          value={choice}
          onChange={setChoice}
          allowUnknown={false}
          types={COMPARTMENT_TYPES}
        />
      )}

      {impact && mode && (
        <div className="mt-4 space-y-4">
          {/* Who and what — the identity of the thing being acted on. */}
          <div className="rounded-xl border border-white/10 bg-ink-900 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{compartmentTypeLabel(impact.entity_type)}</Badge>
              <span className="text-sm font-semibold text-white">{impact.name ?? 'Unnamed record'}</span>
              <AccessBadge kind="sib" value={impact.current_state} />
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Created by {impact.created_by_name ?? 'an unknown account'} on {fmtWhen(impact.created_at)}.
              {impact.cid_authored
                ? ' CID has contributed information to this record.'
                : ' No CID material is attached to it.'}
            </p>
          </div>

          {/* What CID currently has. Silence here is meaningful, so it is stated. */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              What CID currently has attached
            </h4>
            <ul className="mt-1.5 space-y-1">
              <Dep n={impact.cases} label="CID cases" />
              <Dep n={impact.reports} label="reports" />
              <Dep n={impact.legal_requests} label="legal requests" />
              <Dep n={impact.evidence} label="evidence items" />
              <Dep n={impact.media} label="photographs and media" />
              <Dep n={impact.watchlists} label="watchlist entries" />
              <Dep n={impact.relationships} label="graph relationships" />
              <Dep n={impact.linked_persons} label="linked people" />
              <Dep n={impact.linked_gangs} label="linked organisations" />
              <Dep n={impact.linked_vehicles} label="linked vehicles" />
              <Dep n={impact.linked_places} label="linked places" />
            </ul>
            {impact.relationships === 0 && impact.cases === 0 && impact.media === 0 && (
              <p className="mt-1 text-xs text-slate-500">Nothing is attached to this record.</p>
            )}
          </div>

          {/* The choice, with the consequence of each spelled out. */}
          <fieldset>
            <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              How much to restrict
              {/* The canonical restrict/reveal sentences (lib/siuVisibility) —
                  the same wording every confirmation in the compartment uses. */}
              <HelpTip label="How restricting and revealing affect access" guide="siu">
                <p>{restrictPreview()}</p>
                <p className="mt-1.5">A later reveal reverses it: {revealPreview({})}</p>
              </HelpTip>
            </legend>
            <div className="mt-2 space-y-2">
              {(['sections', 'record'] as RestrictMode[]).map((m) => (
                <label
                  key={m}
                  className={`block cursor-pointer rounded-xl border p-3 transition ${
                    mode === m ? 'border-badge-500 bg-badge-500/5' : 'border-white/10 bg-ink-900'}`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="restrict-mode"
                      checked={mode === m}
                      onChange={() => setMode(m)}
                      className="accent-badge-500"
                    />
                    <span className="text-sm font-semibold text-white">
                      {m === 'record' ? 'Restrict Entire Record' : 'Restrict Selected Intelligence Only'}
                    </span>
                    {impact.recommended_mode === m && <Badge tone="good">Recommended</Badge>}
                  </span>
                  <span className="mt-1.5 block pl-6 text-xs leading-relaxed text-slate-400">
                    {m === 'record' ? (
                      <>
                        <strong className="text-rose-300">CID loses:</strong> the record itself and
                        everything under it — search, autocomplete, the graph, counts, exports and
                        every link above. CID gets an ordinary “not found”, with no indication that
                        anything was withheld.{' '}
                        <strong className="text-slate-300">CID keeps:</strong> nothing.
                      </>
                    ) : (
                      <>
                        <strong className="text-rose-300">CID loses:</strong> only the sections you
                        name below, and no indication that anything is missing.{' '}
                        <strong className="text-slate-300">CID keeps:</strong> the profile itself and
                        every section you leave unticked.
                      </>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {mode === 'sections' && (
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Sections to hide from CID
              </legend>
              {offered.length === 0 ? (
                <p className="mt-1.5 text-xs text-slate-500">
                  This record type has no separable sections — restrict the entire record or cancel.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {offered.map((sec) => (
                    <label
                      key={sec.id}
                      className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs transition ${
                        sections.includes(sec.id)
                          ? 'border-badge-500 bg-badge-500/10 text-badge-100'
                          : 'border-white/10 bg-ink-900 text-slate-300'}`}
                    >
                      <input
                        type="checkbox"
                        checked={sections.includes(sec.id)}
                        onChange={() => toggle(sec.id)}
                        className="mr-1.5 accent-badge-500"
                      />
                      {sec.label}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {/* The second confirmation. Shown only when it is really needed, so it
              stays meaningful rather than becoming another box to tick. */}
          {needsAck && (
            <label className="flex cursor-pointer gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5 accent-amber-400"
              />
              <span className="text-xs leading-relaxed text-amber-200">
                This record contains information created or currently used by CID.
                Restricting the entire record will remove CID access to that information
                and may affect active investigations. I have read what CID will lose.
              </span>
            </label>
          )}

          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (ok && !busy) void go() }}
          >
            <Field label="Reason" required hint="Recorded permanently against your name, with the impact above.">
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Subject of an active integrity investigation."
                />
              )}
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant={mode === 'record' ? 'danger' : 'primary'} disabled={!ok || busy}>
                {busy ? 'Working…'
                  : mode === 'record' ? 'Restrict Entire Record' : 'Restrict Selected Intelligence Only'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  )
}

/** The button, for a record page. Renders nothing at all without the
 *  capability — see the note at the top of this file. */
export function RestrictToSiuButton({ type, id, size }: {
  type: string; id: string; size?: 'sm'
}) {
  const siu = useSiu()
  const [open, setOpen] = useState(false)
  const [n, setN] = useState(0)
  if (!siu.mayControlVisibility) return null
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>Restrict to SIB</Button>
      {open && (
        <RestrictDialog
          key={n}
          target={{ type, id }}
          onClose={() => setOpen(false)}
          onDone={() => setN((v) => v + 1)}
        />
      )}
    </>
  )
}
