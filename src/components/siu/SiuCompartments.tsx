'use client'

/** Compartments — what SIU has taken out of CID's view, and what it has given
 *  back.
 *
 *  Two lists, deliberately separate. The REVIEW QUEUE is the honest residue of
 *  shipping compartmentation against live data: both active SIU members are
 *  also senior CID staff, so "created by an SIU member" says nothing about
 *  whether a record is SIU's. 95 registry records sit here awaiting a decision,
 *  and every one of them is still fully visible to CID while it waits. The
 *  COMPARTMENTS list is the records where somebody has actually decided.
 *
 *  Nothing on this screen is a permission. RLS hides a compartmented record
 *  from CID's selects, counts and updates, and each RPC re-checks SIU standing
 *  in its own body -- so a CID user who reached this component would see an
 *  empty ledger and get an exception from every button.
 *
 *  Every act here demands a written reason and shows, in a sentence, exactly
 *  who will be able to see the record afterwards. That preview is the point of
 *  the dialog: a release that somebody did not mean to make is the failure this
 *  whole feature exists to prevent. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  compartmentTypeLabel, fetchCompartments, fetchReviewQueue,
  fetchVisibilityHistory, reasonIsUsable, resolveReview, restrictPreview,
  restrictToSiu, revealPreview, revealToCid, reviewRank, sectionLabel,
  visibilityActionLabel, visibilityLabel, visibilityTint,
  type VisibilityEvent, type VisibilityRow,
} from '@/lib/siuVisibility'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { SectionHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { Field, Textarea } from '@/components/ui/Field'
import { RestrictDialog } from './RestrictToSiu'

const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

type Act = 'reveal' | 'restrict' | 'mine' | 'theirs'

const ACT_TITLE: Record<Act, string> = {
  reveal: 'Reveal to CID',
  restrict: 'Pull back to SIU',
  mine: 'Confirm this is SIU material',
  theirs: 'Confirm this is an ordinary CID record',
}

const ACT_VERB: Record<Act, string> = {
  reveal: 'Reveal', restrict: 'Restrict', mine: 'Compartment it', theirs: 'Leave it with CID',
}

/** The consequence, spelled out. Each branch says who can see the record
 *  afterwards -- never "this will change visibility", which tells nobody
 *  anything they can act on. */
function preview(act: Act): string {
  switch (act) {
    case 'reveal': return revealPreview({})
    case 'restrict': return restrictPreview()
    case 'mine':
      return 'After this, the record disappears from CID entirely: their lists, '
        + 'their counts, and any link that pointed at it. It is refused if CID '
        + 'material already references the record.'
    case 'theirs':
      return 'After this, the record is an ordinary CID record again with no '
        + 'compartment on it at all. Nothing about what CID can see changes -- '
        + 'it was visible the whole time it sat in this queue.'
  }
}

function ActDialog({ act, row, onClose, onDone }: {
  act: Act; row: VisibilityRow; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = reasonIsUsable(reason)

  const go = async () => {
    setBusy(true)
    try {
      const t = row.entity_type, id = row.entity_id
      if (act === 'reveal') await revealToCid(t, id, reason)
      else if (act === 'restrict') await restrictToSiu(t, id, reason)
      else await resolveReview(t, id, act === 'mine', reason)
      toast('Recorded.', 'success')
      onDone()
      onClose()
    } catch (e) {
      // The server's refusals explain the rule ("CID already holds this record,
      // so it stays shared"). Showing that text beats a generic failure.
      toast(e instanceof Error ? e.message : String(e), 'danger')
    } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} dirty={() => reason.trim().length > 0}>
      <ModalHeader title={ACT_TITLE[act]} onClose={onClose} />
      <p className="text-sm leading-relaxed text-slate-300">{preview(act)}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => { e.preventDefault(); if (ok && !busy) void go() }}
      >
        <Field label="Why" required hint="Recorded permanently against your name. A sentence, not a word.">
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Charging decision made; CID needs the subject."
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!ok || busy}>
            {busy ? 'Working…' : ACT_VERB[act]}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function History({ row }: { row: VisibilityRow }) {
  const [events, setEvents] = useState<VisibilityEvent[] | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      const e = await fetchVisibilityHistory(row.entity_type, row.entity_id)
        .catch(() => [] as VisibilityEvent[])
      if (live) setEvents(e)
    })()
    return () => { live = false }
  }, [row.entity_type, row.entity_id])

  if (!events?.length) return null
  return (
    <ol className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
      {events.map((e) => (
        <li key={e.id} className="text-xs text-slate-400">
          <span className="font-semibold text-slate-300">{visibilityActionLabel(e.action)}</span>
          {' · '}{fmtWhen(e.created_at)}
          {e.actor_standing && <> · {e.actor_standing.replace(/_/g, ' ')}</>}
          <span className="mt-0.5 block text-slate-500">{e.reason}</span>
        </li>
      ))}
    </ol>
  )
}

function Row({ row, onAct }: { row: VisibilityRow; onAct: (a: Act) => void }) {
  const [open, setOpen] = useState(false)
  const flagged = row.needs_review
  return (
    <li className="rounded-xl border border-white/10 bg-ink-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{compartmentTypeLabel(row.entity_type)}</Badge>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${visibilityTint(row.state)}`}>
          {visibilityLabel(row)}
        </span>
        {/* The id is the only handle there is: a compartmented record has no
            name here, because reading its name would mean reading the record. */}
        <code className="truncate text-[11px] text-slate-500">{row.entity_id}</code>
        <span className="ml-auto flex gap-2">
          {flagged ? (
            <>
              <Button onClick={() => onAct('theirs')}>It is CID&apos;s</Button>
              <Button variant="primary" onClick={() => onAct('mine')}>It is SIU&apos;s</Button>
            </>
          ) : row.state === 'siu_only' ? (
            <Button variant="primary" onClick={() => onAct('reveal')}>Reveal to CID</Button>
          ) : (
            <>
              <Button onClick={() => onAct('reveal')}>Change audience</Button>
              <Button variant="danger" onClick={() => onAct('restrict')}>Pull back</Button>
            </>
          )}
        </span>
      </div>

      {row.review_note && (
        <p className="mt-2 text-xs leading-relaxed text-slate-400">{row.review_note}</p>
      )}
      {row.reveal_reason && (
        <p className="mt-2 text-xs text-slate-400">
          <span className="text-slate-500">Released because:</span> {row.reveal_reason}
        </p>
      )}
      {row.revealed_sections.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          Sections shared with CID: {row.revealed_sections.map(sectionLabel).join(', ')}
        </p>
      )}
      {row.scope === 'sections' && row.hidden_sections.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {/* Naming what is hidden matters more than naming what is not: this is
              the line somebody reads to check the restriction did what they meant. */}
          Hidden from CID: {row.hidden_sections.map(sectionLabel).join(', ')}
          {' \u00b7 '}the profile itself stays visible
        </p>
      )}

      {!flagged && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 min-h-[32px] text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          {open ? 'Hide history' : 'History'}
        </button>
      )}
      {open && <History row={row} />}
    </li>
  )
}

export function SiuCompartmentsSection() {
  const siu = useSiu()
  const [rows, setRows] = useState<VisibilityRow[]>([])
  const [queue, setQueue] = useState<VisibilityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<{ act: Act; row: VisibilityRow } | null>(null)
  const [taking, setTaking] = useState(false)

  const load = useCallback(async () => {
    try {
      const [all, q] = await Promise.all([
        withRetry(() => fetchCompartments()),
        withRetry(() => fetchReviewQueue()),
      ])
      setRows(all.filter((r) => !r.needs_review))
      setQueue(q)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'danger')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => { await Promise.resolve(); if (live) await load() })()
    return () => { live = false }
  }, [load])

  // Ranked so the records that actually need thinking about are at the top;
  // the ones CID already holds sit at the bottom and can be cleared in a pass.
  const ranked = useMemo(() => queue.slice().sort((a, b) => reviewRank(a) - reviewRank(b)), [queue])

  if (loading) return <CardGridSkeleton cols="" />

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Compartments"
        subtitle="What SIU has taken out of CID's view, and what it has given back."
        actions={
          <Button variant="primary" onClick={() => setTaking(true)}>
            Compartment a record
          </Button>
        }
      />

      {ranked.length > 0 && (
        <Card>
          <SectionHeader
            title="Origin not established"
            subtitle="Records created by an SIU member who is also senior CID staff. Every one of these is still fully visible to CID and stays that way until somebody decides."
            actions={<Badge tone="warn">{ranked.length}</Badge>}
          />
          <ul className="mt-3 space-y-2">
            {ranked.map((r) => (
              <Row
                key={`${r.entity_type}:${r.entity_id}`}
                row={r}
                onAct={(act) => setActing({ act, row: r })}
              />
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <SectionHeader
          title="Compartmented records"
          actions={rows.length ? <Badge>{rows.length}</Badge> : undefined}
        />
        {rows.length === 0 ? (
          <EmptyState
            className="mt-3"
            icon="🗄"
            title="Nothing is compartmented"
            hint={siu.canAccess
              ? 'Registry records are shared with CID by default. A record only leaves CID’s view when somebody here deliberately takes it.'
              : undefined}
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <Row
                key={`${r.entity_type}:${r.entity_id}`}
                row={r}
                onAct={(act) => setActing({ act, row: r })}
              />
            ))}
          </ul>
        )}
      </Card>

      {taking && (
        <RestrictDialog onClose={() => setTaking(false)} onDone={() => { void load() }} />
      )}

      {acting && (
        <ActDialog
          act={acting.act}
          row={acting.row}
          onClose={() => setActing(null)}
          onDone={() => { void load() }}
        />
      )}
    </div>
  )
}
