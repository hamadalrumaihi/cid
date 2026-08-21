'use client'

/** One offense, as a card rather than a line.
 *
 *  Everything shown here is something the published code actually says. Where
 *  the code is silent the card says so — "The code does not say" is a fact
 *  worth showing, and it is not the same as "no arrest required". The database
 *  keeps those columns nullable for exactly that reason.
 *
 *  What is NOT here: required legal elements, the evidence that supports them,
 *  enhancements, lesser or mutually exclusive offenses. Those do not exist as
 *  data anywhere in the portal, and writing them would mean inventing legal
 *  requirements and setting them beside real statutory text with nothing on
 *  screen to tell the two apart.
 */

import type { PenalCharge } from '@/lib/penal'
import { PENAL_LEVEL_TINT } from '@/lib/penal'
import { arrestLabel, fineLabel, jailLabel } from '@/lib/penalWorkspace'
import { Badge } from '@/components/ui/Badge'

function Fact({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`truncate text-sm ${muted ? 'text-slate-500' : 'text-slate-200'}`}>{value}</dd>
    </div>
  )
}

export function ChargeCard({ c, selected, onToggle }: {
  c: PenalCharge
  selected?: boolean
  onToggle?: () => void
}) {
  return (
    <div className={`rounded-xl border p-3 transition ${
      selected ? 'border-badge-500/60 bg-badge-500/5' : 'border-white/10 bg-ink-900'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {c.code && <span className="font-mono text-blue-300">{c.code}</span>}{' '}
            {c.title}
          </p>
          {c.penalTitle && (
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{c.penalTitle}</p>
          )}
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded border px-1.5 py-0.5 text-[11px] ${PENAL_LEVEL_TINT[c.level] ?? ''}`}>
            {c.level}
          </span>
          {/* A designated predicate act and a RICO modifier are opposite ends
              of the statute; badging both as "RICO" would flatten them. */}
          {c.predicate ? <Badge tone="accent">RICO predicate</Badge>
            : c.rico ? <Badge tone="accent">RICO modifier</Badge> : null}
          {c.modifier && <Badge tone="neutral">Modifier</Badge>}
          {c.stack && <Badge tone="neutral">Stacks</Badge>}
          {c.pdExempt && <Badge tone="warn">Not chargeable by PD</Badge>}
          {c.schedule != null && <Badge tone="neutral">Schedule {c.schedule}</Badge>}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="Custodial term" value={jailLabel(c)} muted={c.jail == null && !c.judgeJail} />
        <Fact label="Fine" value={fineLabel(c)} muted={c.fine == null && !c.judgeFine} />
        <Fact label="How it is brought" value={arrestLabel(c)} muted={c.arrest !== true} />
      </dl>

      {c.desc && <p className="mt-3 text-xs leading-relaxed text-slate-400">{c.desc}</p>}
      {c.notes && (
        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-100/90">
          {c.notes}
        </p>
      )}

      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={!!selected}
          className="mt-3 min-h-[44px] rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
        >
          {selected ? 'Remove from comparison' : 'Compare'}
        </button>
      )}
    </div>
  )
}
