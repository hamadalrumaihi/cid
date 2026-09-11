/** UNDERGRND System Guide — the content itself, as typed data.
 *
 *  Every number, price, level, item, objective, milestone tier and statistic
 *  below is transcribed from the supplied reference material and nothing else.
 *  Nothing here may be extrapolated: no invented prices, rewards, levels,
 *  locations or mechanics. Where the source does not state a value, the page
 *  omits it rather than filling the gap.
 *
 *  Two kinds of fact live here and the view keeps them apart:
 *   · SYSTEM   — how the system works (levels, prices, required items, rules).
 *   · RECORDED — a player's progress as it stood when it was written down
 *                (Today's Board, the milestone totals, the Rap Sheet, the
 *                leaderboard). Every recorded constant is named RECORDED_* and
 *                the view labels it as recorded reference information, never
 *                as a live reading. The guide reads nothing and writes
 *                nothing: the Claim controls are inert by construction.
 *
 *  Deliberately JSX-free: the view renders from this module, so adding a
 *  contract line is a data edit, not a layout edit. */

/* ---- header -------------------------------------------------------------- */

/** Last review date — ONE edit keeps the page header honest. Local midnight so
 *  fmtDate never shifts it across a timezone boundary. */
export const LAST_UPDATED = '2026-09-11T00:00:00'

/** Said once, at the top, and relied on everywhere else: this page is a
 *  reference document. It has no connection to the system it describes. */
export const REFERENCE_NOTE =
  'This is a reference document. Nothing on this page is live — no value updates, ' +
  'no control here grants or changes anything, and the figures shown are recorded ' +
  'readings from one point in time rather than current totals.'

/* ---- section index (also the table of contents) -------------------------- */

/** Structurally a DocHeading (@/lib/markdown) so the shared DocToc rail can
 *  render it without a second heading model. Every id is also the DOM id of
 *  the matching <section>, so the scroll-spy and the hash links line up. */
export interface GuideSection {
  id: string
  text: string
  level: 2
}

export const SECTIONS: GuideSection[] = [
  { id: 'u-overview', text: 'Overview', level: 2 },
  { id: 'u-lines', text: 'Line Buy-Ins', level: 2 },
  { id: 'u-gear', text: 'Quartermaster Gear', level: 2 },
  { id: 'u-board', text: "Today's Board", level: 2 },
  { id: 'u-milestones', text: 'Milestones', level: 2 },
  { id: 'u-rapsheet', text: 'Rap Sheet', level: 2 },
  { id: 'u-leaderboard', text: 'Leaderboard', level: 2 },
  { id: 'u-quickref', text: 'Quick Reference', level: 2 },
]

/* ---- 1 · overview -------------------------------------------------------- */

export const OVERVIEW_INTRO =
  'The UNDERGRND SIM is an underground job network offering contracts, daily ' +
  'objectives, specialist equipment, milestone rewards and rankings.'

export interface AccessFact {
  label: string
  value: string
}

export const ACCESS_FACTS: AccessFact[] = [
  { label: 'Purchased from', value: 'The Hobo King' },
  { label: 'Location', value: 'Postal 9020' },
  { label: 'Initial price', value: '6,000 Bottle Caps' },
]

export const OVERVIEW_NOTES: string[] = [
  'The SIM provides access to underground work and its own BJCOIN economy.',
  'Some jobs and equipment stay locked until the required crime level is reached.',
  'Contract buy-ins are paid in BJCOIN.',
  'Equipment has limited uses and must eventually be replaced.',
]

export interface Currency {
  name: string
  short: string
  what: string
}

export const CURRENCIES: Currency[] = [
  { name: 'Cash', short: '$', what: 'Direct payment.' },
  { name: 'BJCOIN', short: 'BJC', what: 'Underground currency used for contracts and equipment.' },
  { name: 'Crime XP', short: 'XP', what: 'Raises crime level and unlocks additional content.' },
]

/* ---- 2 · line buy-ins ---------------------------------------------------- */

export const LINE_BUY_IN_RULE =
  'Line buy-ins are one-time, permanent unlocks. Once a line is purchased its ' +
  'contracts stay available in the job queue.'

export interface ContractLine {
  id: string
  name: string
  level: number
  buyIn: number
  /** The gear this line needs, or null when it needs none. */
  requiredItem: string | null
  description: string
}

export const CONTRACT_LINES: ContractLine[] = [
  { id: 'meter-jacker', name: 'Meter Jacker', level: 3, buyIn: 100, requiredItem: 'Crowbar', description: 'Open parking-meter coin boxes; the coin payout goes straight to the player.' },
  { id: 'chop-runs', name: 'Chop Runs', level: 4, buyIn: 200, requiredItem: null, description: 'Find a marked bicycle or dirtbike and deliver it to the chop van before the timer closes.' },
  { id: 'tag-contracts', name: 'Tag Contracts', level: 5, buyIn: 250, requiredItem: 'Spray Can', description: 'Tag marked walls in rival territory.' },
  { id: 'grave-robbing', name: 'Grave Robbing', level: 5, buyIn: 300, requiredItem: 'Shovel', description: 'Search the designated plots at the marked cemetery.' },
  { id: 'mule-work', name: 'Mule Work', level: 6, buyIn: 400, requiredItem: null, description: 'Collect a package from a dead drop and deliver it across the city.' },
]

/** The locked state's own wording, exactly as the system shows it. */
export function lineLockedText(level: number): string {
  return `Reach crime level ${level} first`
}

/* ---- 3 · quartermaster gear ---------------------------------------------- */

export const GEAR_RULE =
  'Contract equipment has limited durability. Remaining uses are shown wherever the system reports them.'

export interface GearItem {
  id: string
  name: string
  purpose: string
  /** Estimated uses, or null for a permanent device. */
  uses: number | null
  usesText: string
  price: number
}

export const GEAR: GearItem[] = [
  { id: 'sawzall', name: 'Sawzall', purpose: 'Catalytic-converter contracts', uses: 15, usesText: '~15', price: 6 },
  { id: 'blowtorch', name: 'Blowtorch', purpose: 'Copper-stripping contracts', uses: 25, usesText: '~25', price: 7 },
  { id: 'crowbar', name: 'Crowbar', purpose: 'Parking-meter contracts', uses: 30, usesText: '~30', price: 9 },
  { id: 'spray-can', name: 'Spray Can', purpose: 'Tag contracts', uses: 9, usesText: '~9', price: 5 },
  { id: 'shovel', name: 'Shovel', purpose: 'Grave contracts', uses: 40, usesText: '~40', price: 20 },
  { id: 'sim-mk2', name: 'Underground SIM Mk.II', purpose: 'Opens The Cellar and additional content', uses: null, usesText: 'Permanent device', price: 1250 },
]

export const MK2_LEVEL = 7

export const MK2_NOTES: string[] = [
  'Required level: 7+',
  'Used alongside SIM 1',
  'Replacement purchases cost full price',
]

/** The Mk.II's own requirement wording, exactly as the system shows it. */
export const MK2_REQUIREMENT_TEXT =
  "The Quartermaster doesn't know you yet — crime level 7 required"

/* ---- 4 · today's board --------------------------------------------------- */

export const BOARD_HEADING = "TODAY'S BOARD"

export const BOARD_SUBTITLE =
  'Three tasks, citywide — everyone contributes to the same board. It resets when the city sleeps.'

export interface Reward {
  cash: string
  bjc: number
  xp: number
}

export type ObjectiveStatus = 'CLAIMED' | 'CLAIM'

export interface BoardObjective {
  id: string
  name: string
  current: number
  target: number
  currentText: string
  targetText: string
  reward: Reward
  status: ObjectiveStatus
}

/** RECORDED — one reading, not a live board. */
export const RECORDED_BOARD: BoardObjective[] = [
  { id: 'dirty-cash', name: 'Move $1522 in dirty cash', current: 1522, target: 1522, currentText: '1,522', targetText: '1,522', reward: { cash: '$408', bjc: 7, xp: 95 }, status: 'CLAIMED' },
  { id: 'converters', name: 'Cut 14 converters', current: 3, target: 14, currentText: '3', targetText: '14', reward: { cash: '$342', bjc: 5, xp: 83 }, status: 'CLAIM' },
  { id: 'graves', name: 'Turn over 4 graves', current: 0, target: 4, currentText: '0', targetText: '4', reward: { cash: '$465', bjc: 9, xp: 93 }, status: 'CLAIM' },
]

/** Said next to the Claim controls, because a button that looks live but is
 *  not is the one thing on this page that could mislead. */
export const BOARD_CLAIM_NOTE =
  'The Claim controls below are part of the recorded reading. They do nothing.'

/* ---- 5 · milestones ------------------------------------------------------ */

export const MILESTONE_RULE =
  'Milestones track lifetime activity whether or not a contract is active. Every category has ten reward tiers.'

export interface Milestone {
  id: string
  name: string
  /** A short glyph rather than an icon dependency — the page adds no packages. */
  icon: string
  tier: number
  tierOf: number
  current: number
  target: number
  currentText: string
  targetText: string
  reward: Reward
}

/** RECORDED — totals and tiers as written down, not live counters. */
export const RECORDED_MILESTONES: Milestone[] = [
  { id: 'contracts-closed', name: 'Contracts Closed', icon: '✔', tier: 0, tierOf: 10, current: 1, target: 5, currentText: '1', targetText: '5', reward: { cash: '$150', bjc: 2, xp: 30 } },
  { id: 'converters-cut', name: 'Converters Cut', icon: '⚙', tier: 0, tierOf: 10, current: 3, target: 10, currentText: '3', targetText: '10', reward: { cash: '$120', bjc: 1, xp: 25 } },
  { id: 'wire-pulled', name: 'Wire Pulled', icon: '➰', tier: 1, tierOf: 10, current: 58, target: 75, currentText: '58', targetText: '75', reward: { cash: '$200', bjc: 2, xp: 45 } },
  { id: 'boxes-lifted', name: 'Boxes Lifted', icon: '📦', tier: 0, tierOf: 10, current: 0, target: 10, currentText: '0', targetText: '10', reward: { cash: '$120', bjc: 1, xp: 25 } },
  { id: 'dirty-money-moved', name: 'Dirty Money Moved', icon: '$', tier: 2, tierOf: 10, current: 2787, target: 5000, currentText: '2,787', targetText: '5,000', reward: { cash: '$450', bjc: 4, xp: 80 } },
  { id: 'bjcoin-banked', name: 'BJCOIN Banked', icon: '◆', tier: 1, tierOf: 10, current: 21, target: 25, currentText: '21', targetText: '25', reward: { cash: '$300', bjc: 4, xp: 60 } },
  { id: 'meters-jacked', name: 'Meters Jacked', icon: '🅿', tier: 0, tierOf: 10, current: 0, target: 15, currentText: '0', targetText: '15', reward: { cash: '$100', bjc: 1, xp: 20 } },
  { id: 'bikes-chopped', name: 'Bikes Chopped', icon: '🚲', tier: 0, tierOf: 10, current: 0, target: 5, currentText: '0', targetText: '5', reward: { cash: '$150', bjc: 2, xp: 30 } },
  { id: 'walls-tagged', name: 'Walls Tagged', icon: '✦', tier: 0, tierOf: 10, current: 0, target: 10, currentText: '0', targetText: '10', reward: { cash: '$80', bjc: 2, xp: 40 } },
  { id: 'runs-muled', name: 'Runs Muled', icon: '➤', tier: 0, tierOf: 10, current: 0, target: 3, currentText: '0', targetText: '3', reward: { cash: '$200', bjc: 3, xp: 45 } },
  { id: 'plots-turned-over', name: 'Plots Turned Over', icon: '⛏', tier: 0, tierOf: 10, current: 0, target: 3, currentText: '0', targetText: '3', reward: { cash: '$250', bjc: 3, xp: 50 } },
]

/** Progress toward the next target, 0–100, clamped. Derived, never stored, so
 *  the bar and the numbers beside it can never disagree. */
export function milestoneProgress(m: Pick<Milestone, 'current' | 'target'>): number {
  if (!Number.isFinite(m.target) || m.target <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((m.current / m.target) * 100)))
}

/* ---- 6 · rap sheet ------------------------------------------------------- */

export const RAP_SHEET_RULE = 'A lifetime summary.'

export interface RapSheetStat {
  id: string
  label: string
  value: string
}

/** RECORDED. "Cats Cut" is the system's own label and is kept verbatim. */
export const RECORDED_RAP_SHEET: RapSheetStat[] = [
  { id: 'contracts-closed', label: 'Contracts Closed', value: '1' },
  { id: 'cats-cut', label: 'Cats Cut', value: '3' },
  { id: 'wire-stripped', label: 'Wire Stripped', value: '58' },
  { id: 'boxes-lifted', label: 'Boxes Lifted', value: '0' },
  { id: 'dirty-earned', label: 'Dirty Earned Lifetime', value: '$2,787' },
]

/* ---- 7 · leaderboard ----------------------------------------------------- */

export const LEADERBOARD_RULE =
  'The leaderboard ranks participants by progression. The names below are part of the recorded reading ' +
  'and are not linked to anything else in the portal.'

export interface LeaderboardRow {
  rank: number
  name: string
  level: number
  jobs: number
  xp: number
  xpText: string
}

/** RECORDED — a standings snapshot written down, not a live feed. */
export const RECORDED_LEADERBOARD: LeaderboardRow[] = [
  { rank: 1, name: 'Mr-B', level: 8, jobs: 249, xp: 43815, xpText: '43,815' },
  { rank: 2, name: 'Cbass', level: 7, jobs: 255, xp: 35773, xpText: '35,773' },
  { rank: 3, name: 'ConnorM', level: 7, jobs: 228, xp: 33396, xpText: '33,396' },
  { rank: 4, name: 'Yumi', level: 7, jobs: 148, xp: 32637, xpText: '32,637' },
  { rank: 5, name: 'SPIFFy', level: 7, jobs: 218, xp: 31455, xpText: '31,455' },
  { rank: 6, name: 'Lucian', level: 7, jobs: 181, xp: 30976, xpText: '30,976' },
  { rank: 7, name: 'Archer', level: 7, jobs: 138, xp: 30833, xpText: '30,833' },
  { rank: 8, name: 'Mommy', level: 7, jobs: 107, xp: 30474, xpText: '30,474' },
  { rank: 9, name: 'Digital', level: 7, jobs: 190, xp: 29923, xpText: '29,923' },
  { rank: 10, name: 'Fxn', level: 7, jobs: 171, xp: 29822, xpText: '29,822' },
]

export const RECORDED_POSITION = "YOU'RE #336"

/* ---- 8 · quick reference ------------------------------------------------- */

/** Derived from the tables above rather than retyped, so a price can never be
 *  right in one section and wrong in another. */
export interface QuickRefRow {
  id: string
  label: string
  value: string
}

export function quickRefContracts(): QuickRefRow[] {
  return CONTRACT_LINES.map((l) => ({
    id: l.id,
    label: l.name,
    value: `Level ${l.level}+ · ${l.buyIn} BJC${l.requiredItem ? ` · ${l.requiredItem}` : ''}`,
  }))
}

export function quickRefGear(): QuickRefRow[] {
  return GEAR.map((g) => ({ id: g.id, label: g.name, value: `${g.price} BJC · ${g.usesText}` }))
}

/** The two wordings the system shows when something is out of reach. */
export function quickRefRequirements(): QuickRefRow[] {
  return [
    ...CONTRACT_LINES.map((l) => ({ id: `req-${l.id}`, label: l.name, value: lineLockedText(l.level) })),
    { id: 'req-mk2', label: 'Underground SIM Mk.II', value: MK2_REQUIREMENT_TEXT },
  ]
}

/* ---- in-guide search ----------------------------------------------------- */

/** Every searchable word of a section, flattened once. Keeping this beside the
 *  data means a new field is searchable the moment it is added. */
function sectionHaystack(id: string): string {
  switch (id) {
    case 'u-overview':
      return [OVERVIEW_INTRO, ...ACCESS_FACTS.map((f) => `${f.label} ${f.value}`), ...OVERVIEW_NOTES,
        ...CURRENCIES.map((c) => `${c.name} ${c.short} ${c.what}`)].join(' ')
    case 'u-lines':
      return [LINE_BUY_IN_RULE, ...CONTRACT_LINES.map((l) =>
        `${l.name} level ${l.level} ${l.buyIn} bjc ${l.requiredItem ?? ''} ${l.description} ${lineLockedText(l.level)}`)].join(' ')
    case 'u-gear':
      return [GEAR_RULE, ...GEAR.map((g) => `${g.name} ${g.purpose} ${g.usesText} ${g.price} bjc`),
        ...MK2_NOTES, MK2_REQUIREMENT_TEXT].join(' ')
    case 'u-board':
      return [BOARD_HEADING, BOARD_SUBTITLE, ...RECORDED_BOARD.map((o) =>
        `${o.name} ${o.currentText} ${o.targetText} ${o.reward.cash} ${o.reward.bjc} bjc ${o.reward.xp} xp ${o.status}`)].join(' ')
    case 'u-milestones':
      return [MILESTONE_RULE, ...RECORDED_MILESTONES.map((m) =>
        `${m.name} tier ${m.tier} ${m.currentText} ${m.targetText} ${m.reward.cash} ${m.reward.bjc} bjc ${m.reward.xp} xp`)].join(' ')
    case 'u-rapsheet':
      return [RAP_SHEET_RULE, ...RECORDED_RAP_SHEET.map((s) => `${s.label} ${s.value}`)].join(' ')
    case 'u-leaderboard':
      return [LEADERBOARD_RULE, RECORDED_POSITION, ...RECORDED_LEADERBOARD.map((r) =>
        `${r.rank} ${r.name} level ${r.level} ${r.jobs} jobs ${r.xpText} xp`)].join(' ')
    case 'u-quickref':
      return [...quickRefContracts(), ...quickRefGear(), ...quickRefRequirements()]
        .map((r) => `${r.label} ${r.value}`).join(' ')
    default:
      return ''
  }
}

/** Section ids matching a query. An empty query matches everything, so the
 *  page's resting state is the whole guide rather than nothing. */
export function matchSections(query: string): Set<string> {
  const q = query.trim().toLowerCase()
  if (!q) return new Set(SECTIONS.map((s) => s.id))
  return new Set(
    SECTIONS.filter((s) => `${s.text} ${sectionHaystack(s.id)}`.toLowerCase().includes(q)).map((s) => s.id),
  )
}
