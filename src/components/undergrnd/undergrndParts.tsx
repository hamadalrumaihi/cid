'use client'

/** The UNDERGRND guide's own row and card components.
 *
 *  Each renders exactly one record from undergrndContent and adds no value of
 *  its own — every number, price, level and wording comes from the data. The
 *  state colours are the guide palette's three meanings: orange warns, red is
 *  out of reach, green is done. */
import { Progress } from '@/components/ui/Progress'
import {
  CHIP, CHIP_DONE, CHIP_LOCKED, CHIP_NEUTRAL, GOLD_TEXT, GOLD_TINT, SLAB, WARN,
} from '@/components/guides/guideSurfaces'
import {
  lineLockedText, milestoneProgress,
  type BoardObjective, type ContractLine, type GearItem, type Milestone,
} from './undergrndContent'

/** BJCOIN, written the same way everywhere it appears. */
export function Bjc({ amount }: { amount: number }) {
  return (
    <span className={`whitespace-nowrap font-semibold ${GOLD_TEXT}`}>
      <span
        aria-hidden
        className="mr-1 inline-grid h-4 w-4 place-items-center rounded-full border border-amber-400/50 bg-amber-500/20 align-[-2px] text-[9px] font-black leading-none"
      >
        B
      </span>
      {amount.toLocaleString('en-US')} BJC
    </span>
  )
}

/** Cash + BJC + XP, the shape every reward in this system takes. */
export function RewardLine({ cash, bjc, xp }: { cash: string; bjc: number; xp: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="font-semibold text-emerald-300">{cash}</span>
      <span aria-hidden className="text-slate-600">·</span>
      <Bjc amount={bjc} />
      <span aria-hidden className="text-slate-600">·</span>
      <span className="font-semibold text-slate-300">{xp} XP</span>
    </span>
  )
}

/* ---- contract line ------------------------------------------------------- */

/** One buy-in line: what it costs, what level it needs, what gear it needs,
 *  and the wording shown while it is still locked. */
export function ContractRow({ line }: { line: ContractLine }) {
  return (
    <div className={`${SLAB} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-100">{line.name}</h3>
          <p className="mt-1 max-w-prose text-sm text-slate-400">{line.description}</p>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          <Bjc amount={line.buyIn} />
          <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Level {line.level}+</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`${CHIP} ${CHIP_LOCKED}`}>{lineLockedText(line.level)}</span>
        {line.requiredItem ? (
          <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Requires {line.requiredItem}</span>
        ) : (
          <span className={`${CHIP} ${CHIP_NEUTRAL}`}>No equipment required</span>
        )}
      </div>
    </div>
  )
}

/* ---- gear ---------------------------------------------------------------- */

export function GearRow({ item }: { item: GearItem }) {
  return (
    <div className={`${SLAB} flex flex-wrap items-start justify-between gap-3 p-4`}>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-100">{item.name}</h3>
        <p className="mt-1 text-sm text-slate-400">{item.purpose}</p>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
        <Bjc amount={item.price} />
        <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{item.usesText}</span>
      </div>
    </div>
  )
}

/* ---- daily objective ----------------------------------------------------- */

/** A board objective as it was recorded. The Claim control is inert: it is
 *  part of the reading, not a way to collect anything, so it is rendered
 *  disabled and says so to a screen reader. */
export function ObjectiveCard({ objective }: { objective: BoardObjective }) {
  const done = objective.status === 'CLAIMED'
  return (
    <div className={`${SLAB} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-100">{objective.name}</h3>
        <span className={`${CHIP} ${done ? CHIP_DONE : CHIP_NEUTRAL}`}>{objective.status}</span>
      </div>
      <Progress
        value={objective.current}
        max={objective.target}
        label={objective.name}
        valueText={`${objective.currentText} / ${objective.targetText}`}
        showValue
        tone={done ? 'good' : 'warn'}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RewardLine cash={objective.reward.cash} bjc={objective.reward.bjc} xp={objective.reward.xp} />
        <button
          type="button"
          disabled
          aria-label={`${objective.status} — recorded value, not an action`}
          className={`${CHIP} ${done ? CHIP_DONE : GOLD_TINT} cursor-not-allowed border-transparent px-3 py-1 opacity-80`}
        >
          {objective.status}
        </button>
      </div>
    </div>
  )
}

/* ---- milestone ----------------------------------------------------------- */

export function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const pct = milestoneProgress(milestone)
  return (
    <div className={`${SLAB} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-amber-400/25 text-sm ${GOLD_TINT}`}
          >
            {milestone.icon}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-100">{milestone.name}</h3>
            <p className="text-[11px] text-slate-500">
              Tier {milestone.tier}/{milestone.tierOf}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm tabular-nums text-slate-200">
            {milestone.currentText}
            <span className="text-slate-600"> / </span>
            {milestone.targetText}
          </p>
          <p className="text-[11px] text-slate-500">Next target</p>
        </div>
      </div>
      <Progress
        value={milestone.current}
        max={milestone.target}
        label={`${milestone.name} progress`}
        valueText={`${pct}%`}
        tone={pct >= 100 ? 'good' : 'warn'}
      />
      <RewardLine cash={milestone.reward.cash} bjc={milestone.reward.bjc} xp={milestone.reward.xp} />
    </div>
  )
}

/* ---- requirement callout ------------------------------------------------- */

/** A cost or limit worth reading twice — orange, never red: nothing here is
 *  an error or a refusal. */
export function GuideWarning({ children }: { children: React.ReactNode }) {
  return <p className={`${WARN} px-4 py-3 text-sm`}>{children}</p>
}
