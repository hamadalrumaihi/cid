/** UNDERGRND SIM — Complete System Guide: the content itself, as typed data.
 *
 *  EVERY number, price, level, item, objective, milestone tier, statistic and
 *  FAQ answer on this page comes from the submitted intelligence and nothing
 *  else. Nothing here may be extrapolated: no invented prices, rewards,
 *  levels, locations or mechanics. If a value is not in the source, the page
 *  says so rather than filling the gap.
 *
 *  Two kinds of fact live here and they are kept apart on purpose:
 *   · CONFIRMED — how the system works (prices, levels, rules).
 *   · EXAMPLE   — values read off a screenshot at one moment in time
 *                 (Today's Board figures, the milestone table, the Rap Sheet
 *                 statistics, the leaderboard position). Every example
 *                 constant below is named *_EXAMPLE* / EXAMPLE_* and the view
 *                 labels it visibly as a screenshot example, never as a
 *                 permanent system value.
 *
 *  Deliberately JSX-free: the view renders from this module, so adding a
 *  contract line or a screenshot is a data edit, not a layout edit. */

/* ---- header metadata ----------------------------------------------------- */

/** Last review date — ONE edit keeps the page header honest. Local midnight
 *  so fmtDate never shifts it across a timezone boundary. */
export const LAST_UPDATED = '2026-09-11T00:00:00'

export const GUIDE_META = {
  author: 'Tom Wood',
  rank: 'X-2 Special Agent',
  type: 'Criminal Systems Intelligence',
  status: 'Active',
} as const

export const PAGE_TITLE = 'UNDERGRND SIM — Complete System Guide'

export const INTRO =
  'The UNDERGRND SIM is an underground job network offering criminal contracts, daily assignments, ' +
  'specialist equipment, milestone rewards and competitive rankings.'

/** Scope disclaimer — this describes an in-city FiveM roleplay system only. */
export const SCOPE_NOTE = 'This information describes an in-city FiveM roleplay system only.'

/* ---- section index (also the table of contents) -------------------------- */

/** Structurally a DocHeading (@/lib/markdown) so the shared sops/DocToc rail
 *  can render it without a second heading model. Every id is also the DOM id
 *  of the matching <section>, so the scroll-spy and the hash links line up. */
export interface GuideSection {
  id: string
  text: string
  level: 2
}

export const SECTIONS: GuideSection[] = [
  { id: 'u-intro', text: 'Introduction & access', level: 2 },
  { id: 'u-how', text: '1 · How the system works', level: 2 },
  { id: 'u-lines', text: '2 · Line buy-ins', level: 2 },
  { id: 'u-gear', text: '3 · Quartermaster gear', level: 2 },
  { id: 'u-board', text: '4 · Today’s Board', level: 2 },
  { id: 'u-milestones', text: '5 · Milestones', level: 2 },
  { id: 'u-rapsheet', text: '6 · Rap Sheet', level: 2 },
  { id: 'u-leaderboard', text: '7 · Leaderboard', level: 2 },
  { id: 'u-progression', text: '8 · Recommended progression', level: 2 },
  { id: 'u-orgs', text: '9 · Organization use', level: 2 },
  { id: 'u-faq', text: '10 · FAQ', level: 2 },
  { id: 'u-media', text: 'Screenshot gallery', level: 2 },
]

/* ---- introduction & access ----------------------------------------------- */

export interface AccessFact {
  label: string
  value: string
}

export const ACCESS_FACTS: AccessFact[] = [
  { label: 'Purchased from', value: 'The Hobo King' },
  { label: 'Location', value: 'Postal 9020' },
  { label: 'Initial price', value: '6,000 Bottle Caps' },
]

export const ACCESS_NOTES: string[] = [
  'The SIM provides access to underground work and its own BJCOIN economy.',
  'Some jobs and equipment remain locked until the user reaches the required crime level.',
  'Contract buy-ins are paid in BJCOIN.',
  'Equipment has limited uses and must eventually be replaced.',
]

/* ---- section 1 — how the system works ------------------------------------ */

export const FLOW_STEPS: string[] = [
  'Acquire the UNDERGRND SIM.',
  'Open the SIM through the tablet.',
  'Complete available underground activities.',
  'Earn cash, BJCOIN and crime XP.',
  'Increase crime level.',
  'Unlock additional line contracts.',
  'Purchase the required equipment.',
  'Complete daily-board objectives.',
  'Reach lifetime milestones for bonus rewards.',
  'Progress through the leaderboard.',
]

export interface Currency {
  name: string
  short: string
  what: string
}

export const CURRENCIES: Currency[] = [
  { name: 'Cash', short: '$', what: 'Direct financial payment.' },
  { name: 'BJCOIN', short: 'BJC', what: 'Underground currency used for contracts and equipment.' },
  { name: 'Crime XP', short: 'XP', what: 'Increases the player’s crime level and unlocks additional content.' },
]

/* ---- section 2 — line buy-ins -------------------------------------------- */

export const LINE_BUY_IN_RULE =
  'Line buy-ins are one-time, permanent unlocks. After purchasing a line, its contracts remain ' +
  'available in the job queue whenever the player is inside the city.'

export interface ContractLine {
  id: string
  name: string
  /** Minimum crime level, e.g. 3 → shown as "Level 3+". */
  level: number
  /** Permanent buy-in in BJCOIN. */
  buyIn: number
  description: string
  risk: string
}

export const CONTRACT_LINES: ContractLine[] = [
  {
    id: 'meter-jacker',
    name: 'Meter Jacker',
    level: 3,
    buyIn: 100,
    description: 'Use a crowbar to open parking-meter coin boxes. The coin payout goes directly to the player.',
    risk: 'Loud, public and commonly performed in daylight; high chance of police attention.',
  },
  {
    id: 'chop-runs',
    name: 'Chop Runs',
    level: 4,
    buyIn: 200,
    description: 'Locate a marked bicycle or dirtbike and deliver it to the chop van before the timer closes.',
    risk: 'The owner may be nearby and the van does not wait indefinitely.',
  },
  {
    id: 'tag-contracts',
    name: 'Tag Contracts',
    level: 5,
    buyIn: 250,
    description: 'Use a spray can to tag marked walls in rival territory.',
    risk: 'The user remains stationary while tagging and may be exposed in hostile territory.',
  },
  {
    id: 'grave-robbing',
    name: 'Grave Robbing',
    level: 5,
    buyIn: 300,
    description: 'Visit the marked cemetery, use a shovel and search the designated plots.',
    risk: 'Repeated digging in a public cemetery may attract witnesses and police attention.',
  },
  {
    id: 'mule-work',
    name: 'Mule Work',
    level: 6,
    buyIn: 400,
    description: 'Collect a package from a dead drop, transport it across the city and deliver it to the assigned destination.',
    risk: 'The package contents are unknown and other people may pursue the courier.',
  },
]

/** The two in-SIM states a line can show. Quoted verbatim from the source. */
export const LINE_LOCKED_TEXT = (level: number): string => `Reach Crime Level ${level} first.`
export const LINE_UNLOCKED_TEXT = 'Permanent Line Unlocked.'

/* ---- section 3 — quartermaster gear -------------------------------------- */

export const GEAR_RULE =
  'Contract equipment has limited durability or uses. The SIM displays remaining uses whenever ' +
  'that information is available.'

export interface GearItem {
  id: string
  name: string
  /** Cost in BJCOIN. */
  cost: number
  /** Estimated uses; null for the Mk.II, which is a permanent device. */
  uses: number | null
  usesText: string
  usedFor: string
}

export const GEAR: GearItem[] = [
  { id: 'sawzall', name: 'Sawzall', cost: 6, uses: 15, usesText: 'Approximately 15', usedFor: 'Cutting catalytic converters from parked vehicles' },
  { id: 'blowtorch', name: 'Blowtorch', cost: 7, uses: 25, usesText: 'Approximately 25', usedFor: 'Stripping copper' },
  { id: 'crowbar', name: 'Crowbar', cost: 9, uses: 30, usesText: 'Approximately 30', usedFor: 'Opening parking-meter coin boxes' },
  { id: 'spray-can', name: 'Spray Can', cost: 5, uses: 9, usesText: 'Approximately 9', usedFor: 'Completing tag contracts' },
  { id: 'shovel', name: 'Shovel', cost: 20, uses: 40, usesText: 'Approximately 40', usedFor: 'Grave-robbing contracts' },
  { id: 'sim-mk2', name: 'UNDERGRND SIM Mk.II', cost: 1250, uses: null, usesText: 'Permanent device', usedFor: 'Unlocks “The Cellar” and additional jobs, shops and crews' },
]

export const MK2_REQUIREMENTS: string[] = [
  'Required Crime Level: 7+',
  'Requires the Quartermaster introduction',
  'Purchased separately at full price',
  'Does not replace the need to preserve the original SIM safely',
  'Losing it may require purchasing another at full price',
]

/** The in-SIM message when the purchase cannot be afforded. Verbatim. */
export const NOT_ENOUGH_BJC_TEXT = 'Not enough BJCOIN on hand.'

export const RECOMMENDED_EQUIPMENT: string[] = [
  'Buy equipment only when its corresponding activity is available.',
  'Keep enough BJCOIN reserved for permanent line unlocks.',
  'Check estimated uses before beginning multiple contracts.',
  'The crowbar supports Meter Jacker contracts.',
  'The spray can supports Tag Contracts.',
  'The shovel supports Grave Robbing.',
  'The sawzall supports catalytic-converter jobs.',
  'The blowtorch supports copper-stripping jobs.',
]

/* ---- section 4 — today's board ------------------------------------------- */

export const BOARD_RULES: string[] = [
  'The board contains three citywide daily objectives.',
  'Everyone contributes toward the same objectives.',
  'The board resets when the city sleeps.',
  'Each completed objective may award cash, BJCOIN and XP.',
  'Rewards must be manually claimed when the Claim button becomes available.',
  'A completed objective already collected displays “Claimed.”',
]

export const BOARD_RESET_NOTE =
  'Daily objectives and their rewards may change after a reset. The values below were read off a ' +
  'screenshot at one moment in time — they are not permanent system values.'

/** A cash / BJCOIN / XP payout. `cash` keeps the source's own formatting. */
export interface Reward {
  cash: string
  bjc: number
  xp: number
}

export interface BoardObjectiveExample {
  id: string
  objective: string
  /** Numeric progress, for the meter. */
  current: number
  target: number
  /** Progress as the screenshot printed it. */
  progressText: string
  reward: Reward
  /** Present only where the screenshot showed a claim state. */
  status?: string
}

export const BOARD_EXAMPLES: BoardObjectiveExample[] = [
  {
    id: 'dirty-cash',
    objective: 'Move $1,522 in dirty cash',
    current: 1522,
    target: 1522,
    progressText: '$1,522 / $1,522',
    reward: { cash: '$408', bjc: 7, xp: 95 },
    status: 'Claimed',
  },
  {
    id: 'converters',
    objective: 'Cut 14 converters',
    current: 3,
    target: 14,
    progressText: '3 / 14',
    reward: { cash: '$342', bjc: 5, xp: 83 },
  },
  {
    id: 'graves',
    objective: 'Turn over 4 graves',
    current: 0,
    target: 4,
    progressText: '0 / 4',
    reward: { cash: '$465', bjc: 9, xp: 93 },
  },
]

/* ---- section 5 — milestones ---------------------------------------------- */

export const MILESTONE_RULE =
  'Milestones track lifetime activity whether or not the player currently has an active contract. ' +
  'Every category contains ten reward tiers.'

/** The eleven tracked categories (confirmed), in source order. */
export const MILESTONE_CATEGORIES: string[] = [
  'Contracts Closed',
  'Converters Cut',
  'Wire Pulled',
  'Boxes Lifted',
  'Dirty Money Moved',
  'BJCOIN Banked',
  'Meters Jacked',
  'Bikes Chopped',
  'Walls Tagged',
  'Runs Muled',
  'Plots Turned Over',
]

/** What an in-SIM milestone card shows (confirmed — not example values). */
export const MILESTONE_CARD_FIELDS: string[] = [
  'Current lifetime total',
  'Current tier out of 10',
  'Next target',
  'Cash reward',
  'BJCOIN reward',
  'XP reward',
  'Progress bar',
  'Claim status, if milestone rewards require claiming',
]

export interface MilestoneExample {
  id: string
  name: string
  current: number
  target: number
  currentText: string
  targetText: string
  reward: Reward
}

export const MILESTONE_EXAMPLES: MilestoneExample[] = [
  { id: 'contracts-closed', name: 'Contracts Closed', current: 1, target: 5, currentText: '1', targetText: '5', reward: { cash: '$150', bjc: 2, xp: 30 } },
  { id: 'converters-cut', name: 'Converters Cut', current: 3, target: 10, currentText: '3', targetText: '10', reward: { cash: '$120', bjc: 1, xp: 25 } },
  { id: 'wire-pulled', name: 'Wire Pulled', current: 58, target: 75, currentText: '58', targetText: '75', reward: { cash: '$200', bjc: 2, xp: 45 } },
  { id: 'boxes-lifted', name: 'Boxes Lifted', current: 0, target: 10, currentText: '0', targetText: '10', reward: { cash: '$120', bjc: 1, xp: 25 } },
  { id: 'dirty-money-moved', name: 'Dirty Money Moved', current: 2787, target: 5000, currentText: '$2,787', targetText: '$5,000', reward: { cash: '$450', bjc: 4, xp: 80 } },
  { id: 'bjcoin-banked', name: 'BJCOIN Banked', current: 21, target: 25, currentText: '21', targetText: '25', reward: { cash: '$300', bjc: 4, xp: 60 } },
  { id: 'meters-jacked', name: 'Meters Jacked', current: 0, target: 15, currentText: '0', targetText: '15', reward: { cash: '$100', bjc: 1, xp: 20 } },
  { id: 'bikes-chopped', name: 'Bikes Chopped', current: 0, target: 5, currentText: '0', targetText: '5', reward: { cash: '$150', bjc: 2, xp: 30 } },
  { id: 'walls-tagged', name: 'Walls Tagged', current: 0, target: 10, currentText: '0', targetText: '10', reward: { cash: '$80', bjc: 2, xp: 40 } },
  { id: 'runs-muled', name: 'Runs Muled', current: 0, target: 3, currentText: '0', targetText: '3', reward: { cash: '$200', bjc: 3, xp: 45 } },
  { id: 'plots-turned-over', name: 'Plots Turned Over', current: 0, target: 3, currentText: '0', targetText: '3', reward: { cash: '$250', bjc: 3, xp: 50 } },
]

/** The source gives no tier NUMBER per category, only that each category has
 *  ten of them — so the cards must not print one. */
export const MILESTONE_TIER_NOTE =
  'The source screenshot does not show which of the ten tiers each category is currently on, so no ' +
  'tier number is printed here. Read the current tier from the SIM.'

/* ---- section 6 — rap sheet ----------------------------------------------- */

export const RAP_SHEET_RULE = 'The Rap Sheet provides a quick lifetime summary.'

export interface RapSheetStat {
  id: string
  label: string
  value: string
}

export const RAP_SHEET_EXAMPLES: RapSheetStat[] = [
  { id: 'contracts-closed', label: 'Contracts Closed', value: '1' },
  { id: 'converters-cut', label: 'Catalytic Converters Cut', value: '3' },
  { id: 'wire-stripped', label: 'Wire Stripped', value: '58' },
  { id: 'boxes-lifted', label: 'Boxes Lifted', value: '0' },
  { id: 'dirty-money', label: 'Dirty Money Earned Lifetime', value: '$2,787' },
]

/* ---- section 7 — leaderboard --------------------------------------------- */

export const LEADERBOARD_RULE =
  'The leaderboard ranks participants according to their progression.'

export const LEADERBOARD_COLUMNS: string[] = [
  'Position',
  'Player name',
  'Crime level',
  'Jobs completed',
  'Total XP',
  'The current player’s overall position',
]

/** The one position visible in the supplied screenshot. */
export const LEADERBOARD_EXAMPLE_POSITION = '#336'

export const PRIVACY_RULES: string[] = [
  'The general tablet can display the in-city leaderboard normally.',
  'Do not expose private CID notes or investigative information through the public leaderboard.',
  'CID intelligence records and public UNDERGRND rankings must remain separate.',
]

/* ---- section 8 — recommended progression --------------------------------- */

export interface ProgressionStep {
  id: string
  stage: string
  detail: string
}

export const PROGRESSION: ProgressionStep[] = [
  { id: 'early', stage: 'Early progression', detail: 'Complete introductory work, earn crime XP and accumulate BJCOIN.' },
  { id: 'l3', stage: 'Level 3', detail: 'Unlock Meter Jacker for 100 BJC and purchase a crowbar.' },
  { id: 'l4', stage: 'Level 4', detail: 'Unlock Chop Runs for 200 BJC.' },
  { id: 'l5', stage: 'Level 5', detail: 'Choose between Tag Contracts for 250 BJC and Grave Robbing for 300 BJC. Purchase the corresponding equipment.' },
  { id: 'l6', stage: 'Level 6', detail: 'Unlock Mule Work for 400 BJC.' },
  { id: 'l7', stage: 'Level 7', detail: 'Obtain the Quartermaster introduction and save 1,250 BJC for the UNDERGRND SIM Mk.II.' },
  { id: 'ongoing', stage: 'Ongoing', detail: 'Continue completing daily objectives and lifetime milestones for additional cash, BJCOIN and XP.' },
]

export const PROGRESSION_WARNING =
  'Do not spend every BJCOIN on disposable equipment. Permanent line unlocks and the Mk.II SIM require significant savings.'

/* ---- section 9 — organization use ---------------------------------------- */

export const ORGANIZATION_AUDIENCE = 'Gangs, mafias, cartels, motorcycle clubs and syndicates'

export const ORGANIZATION_NOTES: string[] = [
  'Organizations may use the guide to understand available underground progression.',
  'Individual progression, levels, purchases and equipment ownership may remain character-specific unless the city system explicitly supports shared organization progression.',
  'Do not claim that rewards, lines or equipment are automatically shared between members.',
  'Organizations should internally record who has unlocked each contract line and who owns the required equipment.',
]

/* ---- section 10 — FAQ ----------------------------------------------------- */

export interface FaqEntry {
  id: string
  q: string
  a: string
}

/** Answers restate the confirmed facts above — nothing new is introduced. */
export const FAQ: FaqEntry[] = [
  {
    id: 'where',
    q: 'Where is the original SIM purchased?',
    a: 'From The Hobo King at Postal 9020, for 6,000 Bottle Caps.',
  },
  {
    id: 'bjcoin',
    q: 'What does BJCOIN do?',
    a: 'BJCOIN (BJC) is the underground currency. Contract line buy-ins and Quartermaster equipment are paid in BJCOIN.',
  },
  {
    id: 'permanent',
    q: 'Are line buy-ins permanent?',
    a: 'Yes. A line buy-in is a one-time, permanent unlock — its contracts stay available in the job queue whenever the player is inside the city.',
  },
  {
    id: 'locked',
    q: 'Why is a contract locked?',
    a: 'Some jobs and equipment remain locked until the required crime level is reached. A locked line shows “Reach Crime Level [number] first.”',
  },
  {
    id: 'uses',
    q: 'Does equipment have limited uses?',
    a: 'Yes. Contract equipment has limited durability or uses, and remaining uses are displayed whenever that information is available. The UNDERGRND SIM Mk.II is the exception — it is a permanent device.',
  },
  {
    id: 'reset',
    q: 'When does Today’s Board reset?',
    a: 'The board resets when the city sleeps. Objectives and rewards may change after a reset.',
  },
  {
    id: 'claim',
    q: 'Do daily rewards need to be claimed?',
    a: 'Yes. Rewards must be manually claimed when the Claim button becomes available; an objective already collected displays “Claimed.”',
  },
  {
    id: 'milestones',
    q: 'Do milestones progress without an active contract?',
    a: 'Yes. Milestones track lifetime activity whether or not the player currently has an active contract.',
  },
  {
    id: 'level-7',
    q: 'What unlocks at Crime Level 7?',
    a: 'Crime Level 7 is the requirement for the UNDERGRND SIM Mk.II (1,250 BJC), which also requires the Quartermaster introduction. The Mk.II unlocks “The Cellar” and additional jobs, shops and crews.',
  },
  {
    id: 'org',
    q: 'Is progression shared with an organization?',
    a: 'Individual progression, levels, purchases and equipment ownership may remain character-specific unless the city system explicitly supports shared organization progression. Do not assume rewards, lines or equipment are automatically shared between members.',
  },
  {
    id: 'mk2-lost',
    q: 'What happens if the Mk.II SIM is lost?',
    a: 'Losing it may require purchasing another at full price. It is purchased separately at full price and does not replace the need to preserve the original SIM safely.',
  },
]

/* ---- media manifest ------------------------------------------------------- */

export const MEDIA_GROUPS = [
  { id: 'line-buy-ins', label: 'Line Buy-Ins' },
  { id: 'quartermaster-gear', label: 'Quartermaster Gear' },
  { id: 'todays-board', label: 'Today’s Board' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'rap-sheet', label: 'Rap Sheet' },
  { id: 'leaderboard', label: 'Leaderboard' },
] as const

export type MediaGroupId = (typeof MEDIA_GROUPS)[number]['id']

export interface MediaShot {
  /** Which gallery group the screenshot belongs to. */
  group: MediaGroupId
  /** Path under `public/`, e.g. '/undergrnd/line-buy-ins-1.png'. */
  src: string
  /** Shown under the thumbnail and in the lightbox. */
  caption: string
  /** Real alternative text: what the screenshot SHOWS, not "screenshot". */
  alt: string
}

/** EMPTY ON PURPOSE. No screenshots were supplied with this guide, and the
 *  page does not fabricate placeholders — each group renders an empty state
 *  naming the exact file path and manifest entry needed. To add one: drop the
 *  image at `public/undergrnd/<file>` and push an entry here. */
export const MEDIA_SHOTS: MediaShot[] = []

/** Directory every UNDERGRND screenshot lives in, under `public/`. */
export const MEDIA_DIR = '/undergrnd'

/** The file path the empty state tells the next editor to use. */
export const mediaPathHint = (group: MediaGroupId): string => `public${MEDIA_DIR}/${group}-1.png`

/** Screenshots in one group, in manifest order. */
export const mediaForGroup = (group: MediaGroupId): MediaShot[] =>
  MEDIA_SHOTS.filter((s) => s.group === group)

/* ---- in-guide search ------------------------------------------------------ */

/** Everything a section says, lowercased, for the in-guide search box. Built
 *  from the data above so it can never drift from what is rendered. */
export const SECTION_TEXT: Record<string, string> = {
  'u-intro': [INTRO, SCOPE_NOTE, ...ACCESS_FACTS.map((f) => `${f.label} ${f.value}`), ...ACCESS_NOTES].join(' '),
  'u-how': [...FLOW_STEPS, ...CURRENCIES.map((c) => `${c.name} ${c.short} ${c.what}`)].join(' '),
  'u-lines': [
    LINE_BUY_IN_RULE,
    LINE_UNLOCKED_TEXT,
    ...CONTRACT_LINES.map((l) => `${l.name} level ${l.level} ${l.buyIn} bjc ${l.description} ${l.risk}`),
  ].join(' '),
  'u-gear': [
    GEAR_RULE,
    NOT_ENOUGH_BJC_TEXT,
    ...GEAR.map((g) => `${g.name} ${g.cost} bjc ${g.usesText} ${g.usedFor}`),
    ...MK2_REQUIREMENTS,
    ...RECOMMENDED_EQUIPMENT,
  ].join(' '),
  'u-board': [
    ...BOARD_RULES,
    BOARD_RESET_NOTE,
    ...BOARD_EXAMPLES.map((b) => `${b.objective} ${b.progressText} ${b.reward.cash} ${b.reward.bjc} bjc ${b.reward.xp} xp ${b.status ?? ''}`),
  ].join(' '),
  'u-milestones': [
    MILESTONE_RULE,
    MILESTONE_TIER_NOTE,
    ...MILESTONE_CARD_FIELDS,
    ...MILESTONE_EXAMPLES.map((m) => `${m.name} ${m.currentText} ${m.targetText} ${m.reward.cash} ${m.reward.bjc} bjc ${m.reward.xp} xp`),
  ].join(' '),
  'u-rapsheet': [RAP_SHEET_RULE, ...RAP_SHEET_EXAMPLES.map((s) => `${s.label} ${s.value}`)].join(' '),
  'u-leaderboard': [LEADERBOARD_RULE, LEADERBOARD_EXAMPLE_POSITION, ...LEADERBOARD_COLUMNS, ...PRIVACY_RULES].join(' '),
  'u-progression': [...PROGRESSION.map((p) => `${p.stage} ${p.detail}`), PROGRESSION_WARNING].join(' '),
  'u-orgs': [ORGANIZATION_AUDIENCE, ...ORGANIZATION_NOTES].join(' '),
  'u-faq': FAQ.map((f) => `${f.q} ${f.a}`).join(' '),
  'u-media': ['screenshot gallery', ...MEDIA_GROUPS.map((g) => g.label), ...MEDIA_SHOTS.map((s) => `${s.caption} ${s.alt}`)].join(' '),
}

/** Section ids whose text contains every whitespace-separated token of the
 *  query (AND, substring, case- and accent-insensitive enough for a guide).
 *  An empty or whitespace-only query matches every section — the search box
 *  filters, it never hides the document by default. Pure: unit-tested. */
export function matchSections(query: string): string[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const ids = SECTIONS.map((s) => s.id)
  if (!tokens.length) return ids
  return ids.filter((id) => {
    const hay = `${SECTION_TEXT[id] ?? ''} ${SECTIONS.find((s) => s.id === id)?.text ?? ''}`.toLowerCase()
    return tokens.every((t) => hay.includes(t))
  })
}
