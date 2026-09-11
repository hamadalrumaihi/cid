'use client'

/** UNDERGRND SIM — Complete System Guide (/undergrnd). Reference content,
 *  available to members exactly like /guide and /sops: it is static, it
 *  fetches nothing, and it exposes no CID data. The source's own privacy rule
 *  is honoured literally — public UNDERGRND rankings and CID intelligence
 *  records stay separate, so nothing here reads or links a CID record.
 *
 *  Every value rendered comes from undergrndContent (see that module's
 *  header): confirmed mechanics and screenshot examples are separate data,
 *  and every example is visibly flagged as "screenshot example — not a
 *  permanent system value". Nothing is invented.
 *
 *  Presentation notes:
 *   · The UNDERGRND look (black/charcoal, muted gold) is scoped to this
 *     page's own containers with plain Tailwind classes — no global token,
 *     theme or primitive is changed, and the portal's own chrome (header,
 *     sidebar, the TOC rail) keeps the portal identity.
 *   · Gold is literal `amber-*`, deliberately NOT the remapped `blue-*` /
 *     `badge-*` accent classes, so the page reads the same under every user
 *     accent theme.
 *   · Tables become cards below `sm` (ResponsiveTable). DataTable is the grid
 *     engine for live datasets; these are document tables — five static rows
 *     that need no filter box, CSV export or pagination — so they follow the
 *     document-table idiom from lib/markdown instead.
 *   · The sticky table of contents is the shared sops/DocToc rail.
 *   · Code-split via app/(app)/[tab]/lazyViews — long-tail content must not
 *     ride in the shared page chunk. */
import { useCallback, useMemo, useRef, useState } from 'react'
import { fmtDate } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Collapsible } from '@/components/ui/Collapsible'
import { Field, Input } from '@/components/ui/Field'
import { Lightbox } from '@/components/ui/Lightbox'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { Progress } from '@/components/ui/Progress'
import { DocToc, scrollToHeading, useActiveHeading } from '@/components/sops/DocToc'
import {
  ACCESS_FACTS, ACCESS_NOTES, BOARD_EXAMPLES, BOARD_RESET_NOTE, BOARD_RULES, CONTRACT_LINES,
  CURRENCIES, FAQ, FLOW_STEPS, GEAR, GEAR_RULE, GUIDE_META, INTRO, LAST_UPDATED,
  LEADERBOARD_COLUMNS, LEADERBOARD_EXAMPLE_POSITION, LEADERBOARD_RULE, LINE_BUY_IN_RULE,
  LINE_LOCKED_TEXT, LINE_UNLOCKED_TEXT, MEDIA_GROUPS, MILESTONE_CARD_FIELDS, MILESTONE_CATEGORIES,
  MILESTONE_EXAMPLES, MILESTONE_RULE, MILESTONE_TIER_NOTE, MK2_REQUIREMENTS, NOT_ENOUGH_BJC_TEXT,
  ORGANIZATION_AUDIENCE, ORGANIZATION_NOTES, PAGE_TITLE, PRIVACY_RULES, PROGRESSION,
  PROGRESSION_WARNING, RAP_SHEET_EXAMPLES, RAP_SHEET_RULE, RECOMMENDED_EQUIPMENT, SCOPE_NOTE,
  SECTIONS, matchSections, mediaForGroup, mediaPathHint,
  type AccessFact, type BoardObjectiveExample, type ContractLine, type Currency, type FaqEntry,
  type GearItem, type GuideSection, type MediaGroupId, type MediaShot, type MilestoneExample,
  type ProgressionStep, type RapSheetStat, type Reward,
} from './undergrndContent'

/* ---- UNDERGRND surfaces (scoped to this page) ---------------------------- */

const PANEL = 'rounded-2xl border border-amber-400/15 bg-black/60'
const SLAB = 'rounded-lg border border-white/10 bg-neutral-900/70'
const GOLD_TINT = 'bg-amber-500/15 text-amber-200'

/* ---- tiny building blocks ------------------------------------------------ */

/** BJCOIN marker — the coin glyph plus the amount, so a price never reads as
 *  dollars by mistake. */
function Bjc({ amount }: { amount: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-amber-200">
      <span
        aria-hidden
        className="grid h-4 w-4 flex-shrink-0 place-items-center rounded-full border border-amber-400/50 bg-amber-500/20 text-[9px] font-black leading-none text-amber-200"
      >
        B
      </span>
      <span className="tabular-nums">{amount.toLocaleString('en-US')}</span>
      <span className="text-[11px] font-medium text-amber-200/80">BJC</span>
    </span>
  )
}

/** Crime-level requirement chip. */
function LevelBadge({ level }: { level: number }) {
  return <Badge tint={GOLD_TINT} className="whitespace-nowrap">Level {level}+</Badge>
}

/** Cash · BJCOIN · XP payout chips. */
function RewardChips({ reward }: { reward: Reward }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone="good" className="whitespace-nowrap">{reward.cash}</Badge>
      <Badge tint={GOLD_TINT} className="whitespace-nowrap">{reward.bjc} BJC</Badge>
      <Badge tone="neutral" className="whitespace-nowrap">{reward.xp} XP</Badge>
    </span>
  )
}

/** The page's one visual rule: anything read off a screenshot is banded in
 *  gold and says so in words, so it can never be mistaken for a confirmed,
 *  permanent system value. */
function ExampleBlock({ note, children }: { note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-400/30 bg-amber-500/[0.06] p-3 sm:p-4">
      <p className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
        <Badge tint={GOLD_TINT}>Screenshot example</Badge>
        Not a permanent system value
      </p>
      {note && <p className="mb-3 text-xs leading-relaxed text-amber-100/90">{note}</p>}
      {children}
    </div>
  )
}

/** Confirmed mechanics — the counterpart band, so the two never blur. */
function ConfirmedBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${SLAB} p-3 sm:p-4`}>
      <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
        <Badge tone="good">Confirmed</Badge>
        {title}
      </p>
      {children}
    </div>
  )
}

function Bullets({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className={`space-y-1.5 text-sm leading-relaxed text-slate-300 ${className}`}>
      {items.map((t) => (
        <li key={t} className="flex gap-2">
          <span aria-hidden className="mt-[2px] flex-shrink-0 text-amber-400/70">•</span>
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
  )
}

/* ---- document table: a real table on sm+, one card per row below --------- */

interface TableCol<T> {
  key: string
  label: string
  /** Right-aligned in the table view (prices, levels, counts). */
  numeric?: boolean
  cell: (row: T) => React.ReactNode
}

function ResponsiveTable<T extends { id: string; name: string }>({ caption, cols, rows }: {
  caption: string
  cols: TableCol<T>[]
  rows: T[]
}) {
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`border-b border-amber-400/20 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-amber-200/90 ${c.numeric ? 'text-right' : ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                {cols.map((c) => (
                  <td key={c.key} className={`px-2.5 py-2.5 text-slate-300 ${c.numeric ? 'text-right' : ''}`}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Below sm every row becomes a card — never a table that only scrolls. */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((r) => {
          const [head, ...rest] = cols
          return (
            <li key={r.id} className={`${SLAB} p-3`}>
              <p className="text-sm font-semibold text-white">{head ? head.cell(r) : r.name}</p>
              <dl className="mt-2 space-y-1.5">
                {rest.map((c) => (
                  <div key={c.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                    <dt className="flex-shrink-0 font-semibold uppercase tracking-wider text-slate-400">{c.label}</dt>
                    <dd className="min-w-0 text-slate-300">{c.cell(r)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/* ---- per-section pieces -------------------------------------------------- */

function FactRow({ fact }: { fact: AccessFact }) {
  return (
    <div className={`${SLAB} px-3 py-2.5`}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{fact.label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-amber-200">{fact.value}</dd>
    </div>
  )
}

function CurrencyCard({ currency }: { currency: Currency }) {
  return (
    <div className={`${SLAB} p-3`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <Badge tint={GOLD_TINT}>{currency.short}</Badge>
        {currency.name}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{currency.what}</p>
    </div>
  )
}

function BoardCard({ objective }: { objective: BoardObjectiveExample }) {
  return (
    <div className={`${SLAB} p-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold text-white">{objective.objective}</p>
        {objective.status && <Badge tone="good">{objective.status}</Badge>}
      </div>
      <Progress
        className="mt-2.5"
        label={objective.objective}
        value={objective.current}
        max={objective.target}
        valueText={objective.progressText}
        showValue
        tone={objective.current >= objective.target ? 'good' : 'warn'}
      />
      <div className="mt-2.5">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Reward</p>
        <RewardChips reward={objective.reward} />
      </div>
    </div>
  )
}

function MilestoneCard({ milestone }: { milestone: MilestoneExample }) {
  return (
    <div className={`${SLAB} p-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="min-w-0 text-sm font-semibold text-white">{milestone.name}</p>
        <p className="text-[11px] text-slate-400">Tier — of 10</p>
      </div>
      <Progress
        className="mt-2.5"
        label={`${milestone.name} — lifetime total toward the next target`}
        value={milestone.current}
        max={milestone.target}
        valueText={`${milestone.currentText} / ${milestone.targetText}`}
        showValue
        tone="warn"
      />
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          Next target <span className="font-semibold text-slate-200">{milestone.targetText}</span>
        </p>
        <RewardChips reward={milestone.reward} />
      </div>
    </div>
  )
}

function StepRow({ step, index }: { step: ProgressionStep; index: number }) {
  return (
    <li className={`${SLAB} flex gap-3 p-3`}>
      <span
        aria-hidden
        className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border border-amber-400/40 bg-amber-500/10 text-xs font-bold text-amber-200"
      >
        {index + 1}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-amber-200">{step.stage}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-slate-300">{step.detail}</span>
      </span>
    </li>
  )
}

function FaqItem({ entry }: { entry: FaqEntry }) {
  return (
    <Collapsible
      className={SLAB}
      headingLevel={3}
      title={entry.q}
      panelClassName="text-sm leading-relaxed text-slate-300"
    >
      {entry.a}
    </Collapsible>
  )
}

/* ---- the view ------------------------------------------------------------ */

export function UndergrndView() {
  const [query, setQuery] = useState('')
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(SECTIONS.map((s) => s.id)))
  const [tocOpen, setTocOpen] = useState(false)
  const [shot, setShot] = useState<MediaShot | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const visible: GuideSection[] = useMemo(() => {
    const ids = new Set(matchSections(query))
    return SECTIONS.filter((s) => ids.has(s.id))
  }, [query])

  const activeId = useActiveHeading('undergrnd', visible)

  const goToSection = useCallback((id: string) => { scrollToHeading(id) }, [])
  const goFromDrawer = useCallback((id: string) => {
    setTocOpen(false)
    window.setTimeout(() => scrollToHeading(id), 60) // after the scroll lock releases
  }, [])

  const backToTop = useCallback(() => {
    const el = topRef.current
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    el.focus()
  }, [])

  const setAll = (open: boolean) => setOpenIds(open ? new Set(SECTIONS.map((s) => s.id)) : new Set())

  /** A search result the reader cannot see is not a result — so typing also
   *  opens whatever it matched. Done here in the event handler rather than in
   *  an effect, so there is no cascading render, and a section collapsed by
   *  hand afterwards stays collapsed. */
  const onSearch = (next: string) => {
    setQuery(next)
    if (next.trim()) setOpenIds(new Set(matchSections(next)))
  }

  /** "Open screenshot" for a section: show the group's first shot when the
   *  manifest has one, otherwise take the reader to that gallery group, which
   *  explains exactly how to add it. */
  const openGroup = (group: MediaGroupId) => {
    const shots = mediaForGroup(group)
    if (shots.length) { setShot(shots[0]); return }
    // Nothing to open yet — take the reader to the group's empty state, which
    // names the file path and the manifest entry. Expand the gallery first: a
    // collapsed section has no element to scroll to.
    setOpenIds((prev) => new Set(prev).add('u-media'))
    window.setTimeout(() => scrollToHeading(`u-media-${group}`), 0)
  }

  /** Returns an element (not a component type) so the Collapsible's meta slot
   *  keeps a stable element type and the button never loses focus on click. */
  const screenshotAction = (group: MediaGroupId, label: string) => {
    const has = mediaForGroup(group).length > 0
    return (
      <Button
        size="sm"
        variant={has ? 'secondary' : 'ghost'}
        onClick={() => openGroup(group)}
        aria-label={has ? `Open ${label} screenshot` : `${label} screenshots — not added yet`}
      >
        {has ? 'Open screenshot' : 'Screenshots pending'}
      </Button>
    )
  }

  const rapMetric = (stat: RapSheetStat): Metric => ({ label: stat.label, value: stat.value })

  const lineCols: TableCol<ContractLine>[] = [
    { key: 'name', label: 'Contract line', cell: (l) => <span className="font-semibold text-white">{l.name}</span> },
    { key: 'level', label: 'Required level', numeric: true, cell: (l) => <LevelBadge level={l.level} /> },
    { key: 'buyIn', label: 'Permanent buy-in', numeric: true, cell: (l) => <Bjc amount={l.buyIn} /> },
    { key: 'desc', label: 'Description', cell: (l) => l.description },
    { key: 'risk', label: 'Main risk / warning', cell: (l) => <span className="text-rose-200">{l.risk}</span> },
  ]

  const gearCols: TableCol<GearItem>[] = [
    { key: 'name', label: 'Equipment', cell: (g) => <span className="font-semibold text-white">{g.name}</span> },
    { key: 'cost', label: 'Cost', numeric: true, cell: (g) => <Bjc amount={g.cost} /> },
    { key: 'uses', label: 'Estimated uses', numeric: true, cell: (g) => <span className={g.uses === null ? 'text-amber-200' : ''}>{g.usesText}</span> },
    { key: 'for', label: 'Used for', cell: (g) => g.usedFor },
  ]

  const milestoneCols: TableCol<MilestoneExample>[] = [
    { key: 'name', label: 'Milestone', cell: (m) => <span className="font-semibold text-white">{m.name}</span> },
    { key: 'current', label: 'Current total', numeric: true, cell: (m) => <span className="tabular-nums">{m.currentText}</span> },
    { key: 'target', label: 'Next target', numeric: true, cell: (m) => <span className="tabular-nums">{m.targetText}</span> },
    { key: 'reward', label: 'Next reward', cell: (m) => <RewardChips reward={m.reward} /> },
  ]

  /** Section bodies, keyed by the id the TOC and the DOM share. */
  const BODIES: Record<string, React.ReactNode> = {
    'u-intro': (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-300">{INTRO}</p>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {ACCESS_FACTS.map((f) => <FactRow key={f.label} fact={f} />)}
        </dl>
        <ConfirmedBlock title="What the SIM gives you">
          <Bullets items={ACCESS_NOTES} />
        </ConfirmedBlock>
        <p className="text-xs italic text-slate-400">{SCOPE_NOTE}</p>
      </div>
    ),
    'u-how': (
      <div className="space-y-3">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FLOW_STEPS.map((step, i) => (
            <li key={step} className={`${SLAB} flex items-start gap-3 p-2.5`}>
              <span
                aria-hidden
                className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full border border-amber-400/40 bg-amber-500/10 text-[11px] font-bold text-amber-200"
              >
                {i + 1}
              </span>
              <span className="min-w-0 text-sm leading-relaxed text-slate-300">{step}</span>
            </li>
          ))}
        </ol>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-white">The three rewards</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CURRENCIES.map((c) => <CurrencyCard key={c.name} currency={c} />)}
          </div>
        </div>
      </div>
    ),
    'u-lines': (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-300">{LINE_BUY_IN_RULE}</p>
        <ResponsiveTable caption="Contract lines, required crime level, permanent buy-in, description and main risk" cols={lineCols} rows={CONTRACT_LINES} />
        <ConfirmedBlock title="How the SIM shows a line">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 opacity-60">
              <p className="text-sm font-semibold text-slate-400">{CONTRACT_LINES[0].name}</p>
              <p className="mt-1 text-xs font-semibold text-slate-400">{LINE_LOCKED_TEXT(CONTRACT_LINES[0].level)}</p>
              <p className="mt-1 text-[11px] text-slate-400">Locked — shown in a disabled style.</p>
            </div>
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/[0.07] p-3">
              <p className="text-sm font-semibold text-white">{CONTRACT_LINES[0].name}</p>
              <p className="mt-1 text-xs font-semibold text-emerald-300">{LINE_UNLOCKED_TEXT}</p>
              <p className="mt-1 text-[11px] text-slate-400">Purchased — the contracts stay in the job queue.</p>
            </div>
          </div>
        </ConfirmedBlock>
      </div>
    ),
    'u-gear': (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-300">{GEAR_RULE}</p>
        <ResponsiveTable caption="Quartermaster equipment, cost, estimated uses and purpose" cols={gearCols} rows={GEAR} />
        <ConfirmedBlock title="UNDERGRND SIM Mk.II requirements">
          <Bullets items={MK2_REQUIREMENTS} />
        </ConfirmedBlock>
        <p className="text-xs text-slate-400">
          If the item cannot be afforded, the SIM shows{' '}
          <span className="font-semibold text-rose-200">“{NOT_ENOUGH_BJC_TEXT}”</span>
        </p>
        <Collapsible
          className={SLAB}
          title="Recommended equipment"
          hint="Eight rules for spending BJCOIN without stranding yourself."
          defaultOpen
        >
          <Bullets items={RECOMMENDED_EQUIPMENT} />
        </Collapsible>
      </div>
    ),
    'u-board': (
      <div className="space-y-3">
        <ConfirmedBlock title="How the board works">
          <Bullets items={BOARD_RULES} />
        </ConfirmedBlock>
        <ExampleBlock note={BOARD_RESET_NOTE}>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
            {BOARD_EXAMPLES.map((o) => <BoardCard key={o.id} objective={o} />)}
          </div>
        </ExampleBlock>
      </div>
    ),
    'u-milestones': (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-300">{MILESTONE_RULE}</p>
        <ConfirmedBlock title="The eleven tracked categories">
          <div className="flex flex-wrap gap-1.5">
            {MILESTONE_CATEGORIES.map((c) => <Badge key={c} tint={GOLD_TINT}>{c}</Badge>)}
          </div>
        </ConfirmedBlock>
        <Collapsible className={SLAB} title="What each milestone card shows" hint="Eight fields, per category.">
          <Bullets items={MILESTONE_CARD_FIELDS} />
        </Collapsible>
        <ExampleBlock note={MILESTONE_TIER_NOTE}>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {MILESTONE_EXAMPLES.map((m) => <MilestoneCard key={m.id} milestone={m} />)}
          </div>
          <div className="mt-3">
            <ResponsiveTable caption="Milestone example totals, next targets and next rewards" cols={milestoneCols} rows={MILESTONE_EXAMPLES} />
          </div>
        </ExampleBlock>
      </div>
    ),
    'u-rapsheet': (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-300">{RAP_SHEET_RULE}</p>
        <ExampleBlock>
          <MetricStrip metrics={RAP_SHEET_EXAMPLES.map(rapMetric)} />
        </ExampleBlock>
      </div>
    ),
    'u-leaderboard': (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-300">{LEADERBOARD_RULE} It shows:</p>
        <ConfirmedBlock title="Columns shown">
          <Bullets items={LEADERBOARD_COLUMNS} />
        </ConfirmedBlock>
        <ExampleBlock>
          <p className="text-sm text-slate-200">
            The supplied screenshot shows the current player at position{' '}
            <span className="font-bold text-amber-200">{LEADERBOARD_EXAMPLE_POSITION}</span>.
          </p>
        </ExampleBlock>
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-3 sm:p-4">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-rose-200">
            <Badge tone="danger">Privacy rule</Badge>
            Keep the two record sets apart
          </p>
          <Bullets items={PRIVACY_RULES} />
        </div>
      </div>
    ),
    'u-progression': (
      <div className="space-y-3">
        <ol className="space-y-2">
          {PROGRESSION.map((step, i) => <StepRow key={step.id} step={step} index={i} />)}
        </ol>
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 sm:p-4">
          <p className="flex items-start gap-2 text-sm font-semibold leading-relaxed text-amber-100">
            <span aria-hidden className="flex-shrink-0">⚠</span>
            <span>{PROGRESSION_WARNING}</span>
          </p>
        </div>
      </div>
    ),
    'u-orgs': (
      <div className={`${SLAB} p-3 sm:p-4`}>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-200">{ORGANIZATION_AUDIENCE}</p>
        <Bullets items={ORGANIZATION_NOTES} />
      </div>
    ),
    'u-faq': (
      <div className="space-y-2">
        {FAQ.map((entry) => <FaqItem key={entry.id} entry={entry} />)}
      </div>
    ),
    'u-media': (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-300">
          Screenshots open full-screen at their original aspect ratio — never stretched, never cropped.
        </p>
        {MEDIA_GROUPS.map((group) => {
          const shots = mediaForGroup(group.id)
          return (
            <section key={group.id} aria-labelledby={`u-media-${group.id}`} className="space-y-2">
              <h3 id={`u-media-${group.id}`} className="text-sm font-semibold text-amber-200">{group.label}</h3>
              {shots.length ? (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {shots.map((s) => (
                    <li key={s.src}>
                      <button
                        type="button"
                        onClick={() => setShot(s)}
                        className={`${SLAB} group w-full overflow-hidden p-2 text-left transition hover:border-amber-400/40`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- reference screenshots have no fixed intrinsic size; next/image would need dimensions and could crop. Matches RecordThumb's house policy. */}
                        <img src={s.src} alt={s.alt} className="h-auto w-full rounded object-contain" />
                        <span className="mt-2 block text-xs text-slate-300">{s.caption}</span>
                        <span className="mt-1 block text-[11px] font-semibold text-amber-200">Open screenshot →</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No screenshots added yet"
                  hint={`Add the image at ${mediaPathHint(group.id)}, then add an entry to MEDIA_SHOTS in undergrndContent.ts with group: '${group.id}'. The gallery picks it up with no other change.`}
                />
              )}
            </section>
          )
        })}
      </div>
    ),
  }

  /** The six sections whose content has a matching screenshot group. */
  const SECTION_GROUP: Record<string, { group: MediaGroupId; label: string }> = {
    'u-lines': { group: 'line-buy-ins', label: 'Line Buy-Ins' },
    'u-gear': { group: 'quartermaster-gear', label: 'Quartermaster Gear' },
    'u-board': { group: 'todays-board', label: 'Today’s Board' },
    'u-milestones': { group: 'milestones', label: 'Milestones' },
    'u-rapsheet': { group: 'rap-sheet', label: 'Rap Sheet' },
    'u-leaderboard': { group: 'leaderboard', label: 'Leaderboard' },
  }

  return (
    <div className="view-in">
      <div ref={topRef} tabIndex={-1}>
        <PageHeader
          eyebrow={GUIDE_META.type}
          title={PAGE_TITLE}
          subtitle="An in-city FiveM roleplay system — criminal contracts, daily assignments, specialist equipment, milestone rewards and rankings."
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone="good">{GUIDE_META.status}</Badge>
        <Badge tint={GOLD_TINT}>{GUIDE_META.author}</Badge>
        <Badge tone="neutral">{GUIDE_META.rank}</Badge>
        <Badge tone="neutral">{GUIDE_META.type}</Badge>
        <Badge tone="neutral">Updated {fmtDate(LAST_UPDATED)}</Badge>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* Sticky contents rail — portal chrome, deliberately outside the dark
            UNDERGRND container so the page still reads as part of the portal. */}
        <div className="hidden lg:block">
          <div className="sticky top-4">
            <DocToc headings={visible} activeId={activeId} onSelect={goToSection} />
          </div>
        </div>

        <div className="min-w-0">
          <div className={`${PANEL} p-3 sm:p-4`}>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Search this guide" className="min-w-0 flex-1 basis-56">
                {(id) => (
                  <Input
                    id={id}
                    type="search"
                    value={query}
                    onChange={(e) => onSearch(e.target.value)}
                    placeholder="crowbar, BJCOIN, reset…"
                  />
                )}
              </Field>
              <Button className="lg:hidden" onClick={() => setTocOpen(true)} aria-haspopup="dialog">
                ☰ Contents
              </Button>
              <Button size="sm" onClick={() => setAll(true)}>Expand all</Button>
              <Button size="sm" onClick={() => setAll(false)}>Collapse all</Button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {query.trim()
                ? `${visible.length} of ${SECTIONS.length} sections match “${query.trim()}”.`
                : 'Gold panels are screenshot examples from one moment in time; everything else is confirmed system behaviour.'}
            </p>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              className="mt-4"
              title="Nothing in this guide matches that search"
              hint="Try a shorter word — for example “shovel”, “Mk.II”, “claim” or “level 5”."
              action={{ label: 'Clear search', onClick: () => setQuery('') }}
            />
          ) : (
            <div className="mt-4 space-y-3">
              {visible.map((section) => {
                const media = SECTION_GROUP[section.id]
                return (
                  <section key={section.id} id={section.id} className={`${PANEL} scroll-mt-4 p-1.5 sm:p-2.5`}>
                    <Collapsible
                      headingLevel={2}
                      title={<span className="text-base">{section.text}</span>}
                      open={openIds.has(section.id)}
                      onOpenChange={(open) => setOpenIds((prev) => {
                        const next = new Set(prev)
                        if (open) next.add(section.id)
                        else next.delete(section.id)
                        return next
                      })}
                      meta={media ? screenshotAction(media.group, media.label) : undefined}
                      panelClassName="space-y-3"
                    >
                      {BODIES[section.id]}
                      <div className="flex justify-end pt-1">
                        <Button size="sm" variant="ghost" onClick={backToTop}>↑ Back to top</Button>
                      </div>
                    </Collapsible>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mobile contents drawer — ui/Modal, focus-trapped. */}
      {tocOpen && (
        <Modal open slide onClose={() => setTocOpen(false)}>
          <div className="p-5">
            <ModalHeader title="Contents" onClose={() => setTocOpen(false)} />
            <DocToc headings={visible} activeId={activeId} onSelect={goFromDrawer} size="sheet" />
          </div>
        </Modal>
      )}

      {shot && (
        <Lightbox
          open
          onClose={() => setShot(null)}
          src={shot.src}
          alt={shot.alt}
          caption={shot.caption}
          meta={shot.src}
        />
      )}
    </div>
  )
}
