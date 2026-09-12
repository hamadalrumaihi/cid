/** Vanilla Unicorn Money Laundering System — system intelligence.
 *
 *  A record of how a system is STRUCTURED, written from what its interface
 *  displays. It is deliberately not a case: there is no case number, no
 *  incident, no transaction, no suspect, no charge and no legal request
 *  anywhere in it, and nothing here attributes an amount to a person.
 *
 *  Two handling rules shape the content and are worth stating once:
 *
 *  · FIGURES ARE OBSERVED, NOT UNIVERSAL. Rates, caps and turnarounds are
 *    what the interface displayed at the starting standing. They move with
 *    progression, and they can change when the system itself changes, so they
 *    are recorded as observations with their conditions attached rather than
 *    as constants.
 *
 *  · NAMES THE SYSTEM DISPLAYS ARE NOT PEOPLE. Managers, dancers and other
 *    figures the interface shows are recorded here as NPC REFERENCES and
 *    nowhere else. They are prose in a reference document, not entity records
 *    — which is precisely why they cannot reach the People Registry, person
 *    search, warrants, charges, organization rosters or a relationship graph.
 *    Promoting one to a Person record would be a separate, deliberate act on
 *    separate evidence. */
import type { GuideDoc } from '../guideDoc'

export const VANILLA_UNICORN_DOC: GuideDoc = {
  sections: [
    {
      anchor: 'system-overview',
      heading: 'System Overview',
      blurb: 'What the back office offers, and what this record is.',
      blocks: [
        {
          kind: 'facts',
          rows: [
            { label: 'Title', value: 'Vanilla Unicorn Money Laundering System' },
            { label: 'Record type', value: 'System Intelligence' },
            { label: 'Classification', value: 'Financial System · Money Laundering · Business-Based Operation · Active Capability' },
            { label: 'Location', value: 'Vanilla Unicorn / VU Strip Club — Back Office' },
            { label: 'Added by', value: 'Tom Wood' },
            { label: 'Position', value: 'X-2 Special Agent' },
          ],
        },
        {
          kind: 'note',
          text: 'This is a **system record**, not a case. It documents a capability and how it is structured. It carries no case number, no incident, no transaction, no suspect and no charge, and it attributes no amount to any person.',
        },
        {
          kind: 'p',
          text: 'The Vanilla Unicorn back office presents a **reputation-based financial system** that processes dirty money through a club’s own books. Access, capacity and available routes are all governed by a standing that improves over time rather than by a single purchase.',
        },
        {
          kind: 'p',
          text: 'The interface is divided into seven areas: **Overview**, **Moving Money**, **Collections**, **The Floor**, **The House**, **Standing** and **Perks**. Several of these are visible but locked at the starting standing — see Unlock Requirements.',
        },
        {
          kind: 'ul',
          items: [
            'Reputation levels and XP progression.',
            'Perk points, spent within separate perk branches.',
            'Unlockable branches, each behind a named gate perk.',
            'A dirty-money balance, with processing limits and a daily capacity.',
            'Waiting periods between accepting a parcel and collecting it.',
            'Return percentages, locked at the moment a parcel is accepted.',
            'Club-based financial channels — the club’s own books are the processing mechanism.',
          ],
        },
      ],
    },

    {
      anchor: 'access-requirement',
      heading: 'Access Requirement',
      blurb: 'What the operation costs to open, and where that currency comes from.',
      blocks: [
        {
          kind: 'facts',
          rows: [
            { label: 'Initial payment', value: '75 crypto' },
            { label: 'Currency source', value: 'Obtained through the UNDERGRND system' },
            { label: 'Recorded as', value: 'A requirement of the system, not a personal transaction' },
          ],
        },
        {
          kind: 'p',
          text: 'The operation requires an initial payment of **75 crypto** before the back office becomes available. The crypto itself is obtained through the UNDERGRND system, which makes that system the practical prerequisite for this one — see Related Systems.',
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'What the 75-crypto payment opens has **not** been confirmed beyond initial access. It should not be described as permanently unlocking every branch: the four operation branches each carry their own gate perk and reputation requirement, and those were observed separately.',
        },
      ],
    },

    {
      anchor: 'standing-and-progression',
      heading: 'Standing and Progression',
      blurb: 'Reputation, levels and how perk points are earned and spent.',
      blocks: [
        {
          kind: 'facts',
          rows: [
            { label: 'Observed starting standing', value: 'Stranger' },
            { label: 'Observed starting level', value: '1' },
            { label: 'Maximum displayed progression', value: '25 reputation levels' },
          ],
        },
        {
          kind: 'ul',
          items: [
            'Reputation progression awards **perk points**.',
            'Perk points are spent within the separate perk branches — a point spent in one branch is not spent in another.',
            'Some significant perks additionally require **career milestones**, not only reputation.',
            'Perks can be inspected before they are purchased, so the tree can be read without committing a point.',
          ],
        },
        {
          kind: 'note',
          text: 'Standing, level, XP, balances and unspent points are **per user**. The values above are the observed starting state of the progression itself — the ladder, not anyone’s position on it — and no individual’s figures are recorded here or should be treated as universal.',
        },
      ],
    },

    {
      anchor: 'moving-money',
      heading: 'Moving Money',
      blurb: 'The Manager channel: how a parcel is accepted, held and returned.',
      blocks: [
        {
          kind: 'p',
          text: 'The **Manager** channel is the route available without a gate perk, and is therefore the system’s entry point. It takes a parcel of dirty money, holds it for a waiting period, and returns a percentage of it.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'A parcel is accepted', text: 'The system takes a single parcel of dirty money, up to the displayed maximum.' },
            { title: 'The return percentage locks', text: 'The rate is fixed at the moment the parcel is accepted. Improving standing afterwards does not change a parcel already being processed.' },
            { title: 'A waiting period runs', text: 'The parcel is unavailable for the displayed turnaround.' },
            { title: 'The parcel becomes collectable', text: 'Once processing completes, the parcel is available for collection.' },
          ],
        },
        {
          kind: 'table',
          caption: 'Observed at the starting standing (Stranger, level 1) through the Manager channel.',
          head: ['Displayed value', 'Observed'],
          rows: [
            ['Return rate', '52%'],
            ['Retained cut', '48%'],
            ['Maximum single parcel', '$35,000'],
            ['Standard turnaround', 'Approximately 1 hour 30 minutes'],
            ['Daily books capacity', '$210,000'],
            ['Parcel slots visible', 'One'],
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Treat every figure above as an **observed system value at the starting standing**, not a constant. The return percentage improves through standing and perks, and the values may change when the system itself changes. They describe the system’s capability; they are not a record of anything processed.',
        },
      ],
    },

    {
      anchor: 'operation-branches',
      heading: 'Operation Branches',
      blurb: 'The four displayed routes, and what each one is connected to.',
      blocks: [
        {
          kind: 'table',
          head: ['Branch', 'Connected to', 'Gate perk', 'Reputation'],
          rows: [
            ['The Manager', 'Individual dirty-money parcels', 'None displayed', '—'],
            ['The Floor', 'Tips and the club’s floor activity; the club processes funds through its own books. Displayed cycle: every 12 hours', 'House Rules', '2'],
            ['Bank Runs', 'Collections, routes and club funds', 'On The Books', '3'],
            ['Nightlife', 'Staff, bookings and club takings', 'Floor Manager', '6'],
          ],
        },
        {
          kind: 'ul',
          items: [
            '**The Manager** — available without a branch-gate perk. Processes individual parcels, uses a waiting period, and returns a percentage after processing. The rate improves through standing and perks.',
            '**The Floor** — connected to tips and floor activity, with the club processing funds through its own books on a displayed twelve-hour cycle.',
            '**Bank Runs** — connected to collections, routes and club funds.',
            '**Nightlife** — connected to staff, bookings and club takings.',
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'The displayed names **overlap between the two views** and should not be collapsed. As an operation branch, “The Floor” is gated by House Rules at reputation 2; as an interface section, “The Floor” is gated by Floor Manager at reputation 6 and belongs to the Nightlife branch. The **gate perk and reputation** are the reliable identifiers, not the label. Both readings are recorded as displayed; neither has been resolved against the other.',
        },
      ],
    },

    {
      anchor: 'unlock-requirements',
      heading: 'Unlock Requirements',
      blurb: 'Confirmed gate perks and the reputation each one needs.',
      blocks: [
        {
          kind: 'table',
          caption: 'Confirmed gate requirements.',
          head: ['Branch', 'Gate perk', 'Required reputation'],
          rows: [
            ['The House / Floor processing', 'House Rules', '2'],
            ['Collections / Bank Runs', 'On The Books', '3'],
            ['The Floor / Nightlife staff', 'Floor Manager', '6'],
          ],
        },
        {
          kind: 'p',
          text: 'The **Manager** route requires no displayed gate perk and acts as the starting channel.',
        },
        {
          kind: 'table',
          caption: 'Interface sections that were visible but locked at the starting standing.',
          head: ['Section', 'Status', 'Required perk', 'Branch', 'Required reputation'],
          rows: [
            ['Collections', 'Locked', 'On The Books', 'Bank Runner', '3'],
            ['The House', 'Locked', 'House Rules', 'House Favor', '2'],
            ['The Floor', 'Locked', 'Floor Manager', 'Nightlife', '6'],
          ],
        },
        {
          kind: 'ul',
          items: [
            '**Collections** is connected to club funds owed across the city. No locations, debtors or collection targets are recorded — none were separately observed.',
            '**The House** uses the club’s floor and books.',
            '**The Floor** relates to placing the user’s own staff on the club floor.',
          ],
        },
        {
          kind: 'note',
          text: 'A staff name displayed inside any of these sections is not evidence of a person. See System Actors / NPC References.',
        },
      ],
    },

    {
      anchor: 'perk-tree',
      heading: 'Perk Tree',
      blurb: 'Four branches, and the perks displayed in each.',
      blocks: [
        {
          kind: 'p',
          text: 'Perk points are spent across four branches. Only the **names displayed** are recorded below: no price, percentage, level requirement or effect is recorded for any perk that was not visibly confirmed.',
        },
        {
          kind: 'p',
          text: '**The Owner’s Trust** — controls the direct relationship with the manager, including his cut and parcel handling.',
        },
        {
          kind: 'ul',
          items: [
            'Known Quantity — displayed as the introductory owned perk',
            'Rounding Error',
            'Bigger Envelopes',
            'No Questions Asked',
            'Front of the Queue',
            'Off The Ledger',
            'Silent Partner',
          ],
        },
        {
          kind: 'p',
          text: '**House Favor** — controls the club’s internal books and house-based processing.',
        },
        {
          kind: 'ul',
          items: [
            'House Rules — gate perk, reputation 2',
            'Cooked Books',
            'Regular',
            'Preferred Customer',
            'Make It Rain',
            'Early Close',
            'Back Office',
            'Big Spender',
            'House Partner',
            'Good Night',
          ],
        },
        {
          kind: 'p',
          text: '**Bank Runner** — controls collections, routes and bank-related activity.',
        },
        {
          kind: 'ul',
          items: [
            'On The Books — gate perk, reputation 3',
            'Runner’s Cut',
            'Multi Collection',
            'No Questions Asked',
            'Express Route',
            'Ride Along',
            'Trusted Courier',
            'Bulk Collection',
          ],
        },
        {
          kind: 'p',
          text: '**Nightlife** — controls staff, bookings and other club-floor functions.',
        },
        {
          kind: 'ul',
          items: [
            'Floor Manager — gate perk, reputation 6',
            'House Cut',
            'Good Eye',
            'Security Detail',
            'Talent Scout',
            'BBL Connection',
            'Manager',
            'VIP Clients',
            'House Driver',
            'Headliner',
            'Trusted Collector',
          ],
        },
        {
          kind: 'note',
          text: '“No Questions Asked” is displayed in **both** The Owner’s Trust and Bank Runner. Recorded as displayed in each; whether they are the same perk has not been confirmed.',
        },
      ],
    },

    {
      anchor: 'system-actors',
      heading: 'System Actors / NPC References',
      blurb: 'Names the interface displays — recorded here and nowhere else.',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: 'Every name below is an **NPC reference**, not a person. They are recorded as content in this system record and are deliberately **not** entity records — so they cannot appear in the People Registry, in person or global search, in a suspect list, on a warrant, charge or subpoena, in an organization roster, or in a relationship graph for real people.',
        },
        {
          kind: 'table',
          caption: 'Names visible in the interface. Fields: display name, system role, associated branch, source interface, notes, confirmed NPC.',
          head: ['Display name', 'System role', 'Associated branch', 'Source interface', 'Notes', 'Confirmed NPC'],
          rows: [
            ['The Manager', 'Processes parcels; takes a cut', 'The Owner’s Trust', 'Moving Money', 'Referred to by role rather than a personal name', 'Unknown'],
            ['Mercedes', 'Floor actor', 'Nightlife / House Favor', 'The Floor / The House', 'Displayed name only', 'Unknown'],
            ['Destiny', 'Floor actor', 'Nightlife / House Favor', 'The Floor / The House', 'Displayed name only', 'Unknown'],
            ['Candy', 'Floor actor', 'Nightlife / House Favor', 'The Floor / The House', 'Displayed name only', 'Unknown'],
            ['Three further floor actors', 'Floor actors', 'Nightlife / House Favor', 'The Floor / The House', 'Present but unnamed in the interface', 'Unknown'],
          ],
        },
        {
          kind: 'p',
          text: 'Other roles the system may display include club staff, dancers, collection contacts, couriers, security, drivers and customers. Any of these should be recorded the same way, with the same six fields, and with **Confirmed NPC** left as *Unknown* until it is actually established.',
        },
        {
          kind: 'ul',
          items: [
            'Do not create a Person record for any name here.',
            'Do not place any of them in a suspect list, or seek a warrant, charge or subpoena against one.',
            'Do not count them in an organization roster.',
            'Do not surface them in global people search.',
            'If a name is later **confirmed** to be a real character, converting it to a Person record is a separate, authorized and manual act — on separate evidence, not on the strength of appearing in this interface.',
            'A conversion must preserve this reference, so the audit history shows where the name came from.',
          ],
        },
      ],
    },

    {
      anchor: 'related-systems',
      heading: 'Related Systems',
      blurb: 'How this system connects to the portal’s other records.',
      blocks: [
        {
          kind: 'table',
          head: ['From', 'Relationship', 'To'],
          rows: [
            ['Vanilla Unicorn (location)', 'hosts', 'Money Laundering System'],
            ['UNDERGRND System', 'provides access currency for', 'Vanilla Unicorn System'],
            ['House Rules (perk)', 'unlocks', 'House / Floor processing'],
            ['On The Books (perk)', 'unlocks', 'Collections / Bank Runs'],
            ['Floor Manager (perk)', 'unlocks', 'Nightlife / The Floor'],
            ['Perk branches', 'belong to', 'Vanilla Unicorn System'],
            ['NPC references', 'appear within', 'Vanilla Unicorn System'],
          ],
        },
        {
          kind: 'links',
          items: [
            { to: '/guides/undergrnd', label: 'UNDERGRND System Guide', hint: 'The source of the 75 crypto this system’s access requires' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'No relationship is recorded between this system and any criminal organization: that would need separate evidence. No criminal-association relationship is recorded between an NPC reference and a real person, and none should be created from this record.',
        },
      ],
    },

    {
      anchor: 'supporting-media',
      heading: 'Optional Supporting Media',
      blurb: 'How imagery attaches to this record, if any is ever added.',
      blocks: [
        {
          kind: 'p',
          text: 'This record is complete **without images** and carries none. Nothing renders an empty frame, a placeholder or a “view image” action where there is no image.',
        },
        {
          kind: 'ul',
          items: [
            'An authorized user may add an optional image to any section of this record, including a cover.',
            'Images open full screen, with zoom and close controls, at their original aspect ratio.',
            'Images can be added, replaced, reordered and removed at any time.',
            'Removing an image removes the image and nothing else — the written record above is untouched, because imagery and content are stored separately.',
            'Every media change is recorded in the audit log.',
          ],
        },
      ],
    },

    {
      anchor: 'audit-history',
      heading: 'Audit History',
      blurb: 'Who may read this record, and what is recorded about it.',
      blocks: [
        {
          kind: 'facts',
          rows: [
            { label: 'Submitted by', value: 'Tom Wood, X-2 Special Agent' },
            { label: 'Record type', value: 'System Intelligence — not a case' },
            { label: 'Audience', value: 'Investigative personnel' },
          ],
        },
        {
          kind: 'p',
          text: 'Access is decided **on the server**, by the same rule as every other record of this sensitivity: a reader outside the audience does not receive it, and it does not appear for them in a listing, a count or a search result. Nothing here is exposed through a publicly readable guide.',
        },
        {
          kind: 'ul',
          items: [
            'Creation, every later revision, publication changes and archival are recorded in the audit log.',
            'Revision history is kept, and an earlier revision can be restored without losing the current one.',
            'Tom Wood is recorded as the **submitter** of this record. No case investigator is assigned, because this is not a case.',
          ],
        },
      ],
    },
  ],
}
