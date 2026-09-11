'use client'

/** UNDERGRND System Guide — the BODY of the guide, without any page chrome.
 *
 *  The masthead, breadcrumbs, in-guide search, contents rail and bookmark all
 *  belong to the shared guide page (components/guides/GuidePage), so every
 *  guide in the library gets the same frame and a new guide is a body module
 *  plus a row in the library — no new plumbing.
 *
 *  Two rules drive the content itself:
 *   · Nothing is invented. Every number, price, level, required item, wording
 *     and statistic comes from undergrndContent, which transcribes the
 *     supplied reference material and nothing else.
 *   · Nothing pretends to be live. Progress figures are labelled as recorded
 *     reference values, and the Claim controls are rendered disabled — they
 *     are part of the recorded reading, not a way to collect anything.
 *
 *  Presentation: the guide treatment (near-black ground, charcoal panels,
 *  hairline borders, muted gold) is scoped to the guide's own containers
 *  through guideSurfaces. No global token, theme or primitive is changed, and
 *  the portal's chrome keeps the portal identity. */
import { Collapsible } from '@/components/ui/Collapsible'
import { GuideSection, RecordedChip, StatisticCard } from '@/components/guides/GuideParts'
import type { GuideBodyProps } from '@/components/guides/guideRegistry'
import { CHIP, CHIP_LOCKED, GOLD_TEXT, SLAB } from '@/components/guides/guideSurfaces'
import {
  ACCESS_FACTS, BOARD_CLAIM_NOTE, BOARD_HEADING, BOARD_SUBTITLE, CONTRACT_LINES, CURRENCIES,
  GEAR, GEAR_RULE, LEADERBOARD_RULE, LINE_BUY_IN_RULE,
  MILESTONE_RULE, MK2_NOTES, MK2_REQUIREMENT_TEXT, OVERVIEW_INTRO, OVERVIEW_NOTES,
  RAP_SHEET_RULE, RECORDED_BOARD, RECORDED_LEADERBOARD, RECORDED_MILESTONES,
  RECORDED_POSITION, RECORDED_RAP_SHEET,
  quickRefContracts, quickRefGear, quickRefRequirements,
} from './undergrndContent'
import { ContractRow, GearRow, GuideWarning, MilestoneRow, ObjectiveCard } from './undergrndParts'

/** A section that never renders when the in-guide search excludes it. */
function When({ show, children }: { show: boolean; children: React.ReactNode }) {
  return show ? <>{children}</> : null
}

/** Label / value pairs, as a definition list so the pairing survives a screen
 *  reader and a narrow screen alike. */
function FactList({ rows }: { rows: readonly { label: string; value: string }[] }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-3">
      {rows.map((r) => (
        <div key={r.label} className={`${SLAB} px-3 py-2`}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{r.label}</dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-100">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function UndergrndBody({ shown, imagesFor }: GuideBodyProps) {
  return (
    <>
      {/* 1 · Overview */}
      <When show={shown.has('u-overview')}>
        <GuideSection id="u-overview" title="Overview" subtitle={OVERVIEW_INTRO} images={imagesFor('u-overview')}>
          <FactList rows={ACCESS_FACTS} />
          <ul className="flex flex-col gap-1.5 text-sm text-slate-300">
            {OVERVIEW_NOTES.map((n) => (
              <li key={n} className="flex gap-2">
                <span aria-hidden className={GOLD_TEXT}>·</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
          <div className="grid gap-2 sm:grid-cols-3">
            {CURRENCIES.map((c) => (
              <div key={c.name} className={`${SLAB} px-3 py-2`}>
                <p className={`text-sm font-bold ${GOLD_TEXT}`}>
                  {c.name} <span className="text-slate-500">({c.short})</span>
                </p>
                <p className="mt-0.5 text-sm text-slate-400">{c.what}</p>
              </div>
            ))}
          </div>
        </GuideSection>
      </When>

      {/* 2 · Line Buy-Ins */}
      <When show={shown.has('u-lines')}>
        <GuideSection id="u-lines" title="Line Buy-Ins" subtitle={LINE_BUY_IN_RULE} images={imagesFor('u-lines')}>
          <div className="grid gap-3 md:grid-cols-2">
            {CONTRACT_LINES.map((l) => <ContractRow key={l.id} line={l} />)}
          </div>
        </GuideSection>
      </When>

      {/* 3 · Quartermaster Gear */}
      <When show={shown.has('u-gear')}>
        <GuideSection id="u-gear" title="Quartermaster Gear" subtitle={GEAR_RULE} images={imagesFor('u-gear')}>
          <div className="grid gap-3 md:grid-cols-2">
            {GEAR.map((g) => <GearRow key={g.id} item={g} />)}
          </div>
          <div className={`${SLAB} p-4`}>
            <h3 className={`text-xs font-black uppercase tracking-[0.18em] ${GOLD_TEXT}`}>
              Underground SIM Mk.II
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-slate-300">
              {MK2_NOTES.map((n) => (
                <li key={n} className="flex gap-2">
                  <span aria-hidden className={GOLD_TEXT}>·</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
            <p className={`${CHIP} ${CHIP_LOCKED} mt-3`}>{MK2_REQUIREMENT_TEXT}</p>
          </div>
          <GuideWarning>Replacement purchases cost full price.</GuideWarning>
        </GuideSection>
      </When>

      {/* 4 · Today's Board */}
      <When show={shown.has('u-board')}>
        <GuideSection
          id="u-board"
          title={BOARD_HEADING}
          subtitle={BOARD_SUBTITLE}
          meta={<RecordedChip />}
          images={imagesFor('u-board')}
        >
          <div className="grid gap-3 md:grid-cols-3">
            {RECORDED_BOARD.map((o) => <ObjectiveCard key={o.id} objective={o} />)}
          </div>
          <p className="text-xs text-slate-500">{BOARD_CLAIM_NOTE}</p>
        </GuideSection>
      </When>

      {/* 5 · Milestones */}
      <When show={shown.has('u-milestones')}>
        <GuideSection
          id="u-milestones"
          title="Milestones"
          subtitle={MILESTONE_RULE}
          meta={<RecordedChip />}
          images={imagesFor('u-milestones')}
        >
          <div className="grid gap-3 md:grid-cols-2">
            {RECORDED_MILESTONES.map((m) => <MilestoneRow key={m.id} milestone={m} />)}
          </div>
        </GuideSection>
      </When>

      {/* 6 · Rap Sheet */}
      <When show={shown.has('u-rapsheet')}>
        <GuideSection
          id="u-rapsheet"
          title="Rap Sheet"
          subtitle={RAP_SHEET_RULE}
          meta={<RecordedChip />}
          images={imagesFor('u-rapsheet')}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {RECORDED_RAP_SHEET.map((s) => (
              <StatisticCard key={s.id} label={s.label} value={s.value} />
            ))}
          </div>
        </GuideSection>
      </When>

      {/* 7 · Leaderboard */}
      <When show={shown.has('u-leaderboard')}>
        <GuideSection
          id="u-leaderboard"
          title="Leaderboard"
          subtitle={LEADERBOARD_RULE}
          meta={<RecordedChip />}
          images={imagesFor('u-leaderboard')}
        >
          <p className={`text-lg font-black tracking-[0.16em] ${GOLD_TEXT}`}>{RECORDED_POSITION}</p>

          {/* Table from sm up; one card per row below it. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th scope="col" className="py-2 pr-3 text-right">Rank</th>
                  <th scope="col" className="py-2 pr-3">Name</th>
                  <th scope="col" className="py-2 pr-3 text-right">Level</th>
                  <th scope="col" className="py-2 pr-3 text-right">Jobs</th>
                  <th scope="col" className="py-2 text-right">XP</th>
                </tr>
              </thead>
              <tbody>
                {RECORDED_LEADERBOARD.map((r) => (
                  <tr key={r.rank} className="border-b border-white/5 last:border-0">
                    <td className={`py-2 pr-3 text-right font-black tabular-nums ${GOLD_TEXT}`}>{r.rank}</td>
                    <td className="py-2 pr-3 font-semibold text-slate-100">{r.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{r.level}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{r.jobs}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-300">{r.xpText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-2 sm:hidden">
            {RECORDED_LEADERBOARD.map((r) => (
              <div key={r.rank} className={`${SLAB} flex items-center justify-between gap-3 px-3 py-2`}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={`font-black tabular-nums ${GOLD_TEXT}`}>#{r.rank}</span>
                  <span className="truncate font-semibold text-slate-100">{r.name}</span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2 text-[11px] tabular-nums text-slate-400">
                  <span>Lv {r.level}</span>
                  <span>{r.jobs} jobs</span>
                  <span className="font-mono">{r.xpText} XP</span>
                </div>
              </div>
            ))}
          </div>
        </GuideSection>
      </When>

      {/* 8 · Quick Reference */}
      <When show={shown.has('u-quickref')}>
        <GuideSection
          id="u-quickref"
          title="Quick Reference"
          subtitle="Every figure on this page, in one place. Nothing here is new — it is the sections above, condensed."
          images={imagesFor('u-quickref')}
        >
          <Collapsible title="Contract lines" headingLevel={3} defaultOpen>
            <dl className="grid gap-2 sm:grid-cols-2">
              {quickRefContracts().map((r) => (
                <div key={r.id} className={`${SLAB} flex items-center justify-between gap-3 px-3 py-2`}>
                  <dt className="text-sm font-semibold text-slate-100">{r.label}</dt>
                  <dd className="text-right text-[11px] text-slate-400">{r.value}</dd>
                </div>
              ))}
            </dl>
          </Collapsible>
          <Collapsible title="Equipment" headingLevel={3}>
            <dl className="grid gap-2 sm:grid-cols-2">
              {quickRefGear().map((r) => (
                <div key={r.id} className={`${SLAB} flex items-center justify-between gap-3 px-3 py-2`}>
                  <dt className="text-sm font-semibold text-slate-100">{r.label}</dt>
                  <dd className="text-right text-[11px] text-slate-400">{r.value}</dd>
                </div>
              ))}
            </dl>
          </Collapsible>
          <Collapsible title="Requirement messages" headingLevel={3}>
            <dl className="flex flex-col gap-2">
              {quickRefRequirements().map((r) => (
                <div key={r.id} className={`${SLAB} flex flex-wrap items-center justify-between gap-2 px-3 py-2`}>
                  <dt className="text-sm font-semibold text-slate-100">{r.label}</dt>
                  <dd className={`${CHIP} ${CHIP_LOCKED}`}>{r.value}</dd>
                </div>
              ))}
            </dl>
          </Collapsible>
        </GuideSection>
      </When>
    </>
  )
}
