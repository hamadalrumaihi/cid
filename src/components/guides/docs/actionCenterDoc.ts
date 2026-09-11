/** Action Center Guide.
 *
 *  Written from the queue as it is built: the eight sections in
 *  components/actioncenter/ActionCenterView.tsx SECTION_ORDER, the source-type
 *  vocabulary in lib/actionItems.ts, and the snooze / dismiss / reassign /
 *  escalation rules the server enforces. Section names and subtitles below are
 *  the portal's own, so a heading on screen and a row here read the same. */
import type { GuideDoc } from '../guideDoc'

export const ACTION_CENTER_DOC: GuideDoc = {
  sections: [
    {
      anchor: 'the-queue',
      heading: 'The Queue',
      blurb: 'One list, eight named sections, most urgent first.',
      blocks: [
        {
          kind: 'p',
          text: 'The Action Center is the single queue of everything awaiting a decision or an action from you. The same list feeds the *Needs your attention* panel on your dashboard, the Command Center’s decision panels and the counts on the sidebar — so you never see two different versions of “what is waiting”.',
        },
        {
          kind: 'table',
          head: ['Section', 'What is in it'],
          rows: [
            ['Overdue', 'Deadlines that have already passed.'],
            ['Returned to you', 'Work sent back for changes — revise and resubmit.'],
            ['Needs your action', 'Tasks, reviews and replies waiting on you personally.'],
            ['Command decisions', 'Approvals and authorizations your command role owns.'],
            ['Unassigned intel', 'Field intelligence no reviewer has claimed yet.'],
            ['Expiring BOLOs', 'BOLO windows closing within seven days — renew or stand down.'],
            ['Waiting on others', 'Your requests sitting in someone else’s queue — nothing for you to do yet.'],
            ['Drafts', 'Unfinished work you saved — resume it or discard it.'],
          ],
        },
        {
          kind: 'note',
          text: 'Sections you have no standing for do not appear. Command decisions, unassigned intel and expiring BOLOs render only for the roles that own them.',
        },
      ],
    },

    {
      anchor: 'assignments',
      heading: 'Assignments',
      blurb: 'Work that is yours — and what you can do to a row without leaving the queue.',
      blocks: [
        {
          kind: 'p',
          text: 'Tasks assigned to you, case follow-ups, handovers and blockers arrive under **Needs your action**, or **Overdue** once their deadline passes. Every row says why it is there and what to do next.',
        },
        {
          kind: 'ul',
          items: [
            'Where the portal has a safe one-click action it is on the row — complete a task, resolve a blocker, mark a notification read, discard a draft.',
            'Anything that needs a proper form — a sign-off decision, a transfer, a legal ruling — opens the screen that owns it.',
            'If you lead the case or hold a command rank, a task or blocker row offers **Reassign**: pick the member and give a short reason, which is required. They must be able to see the case; the portal refuses otherwise and tells you to grant access first. The new owner is notified.',
          ],
        },
      ],
    },

    {
      anchor: 'mentions',
      heading: 'Mentions',
      blurb: 'Being named in a note, a report or a case message.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'An `@mention` in a case note, report narrative or case chat message reaches you as a queue row and in the bell.',
            'Mentions are one of the streams that **cannot be muted** — along with assignments, sign-off decisions, legal notices and security notices.',
            'Clicking the row opens the record at the place you were named.',
          ],
        },
      ],
    },

    {
      anchor: 'approvals',
      heading: 'Approvals',
      blurb: 'Decisions your command role owns.',
      blocks: [
        {
          kind: 'p',
          text: 'Sign-offs, access requests, transfers, membership decisions, restricted-export windows, MDT export proposals, field-officer access requests, tracker co-signs and justice applications gather under **Command decisions**.',
        },
        {
          kind: 'ul',
          items: [
            'Decisions are **never taken in bulk**. The bulk bar deliberately does not offer them.',
            'A decision you own cannot be dismissed — the row says so: decide it, finish it, or snooze it.',
            'Snoozing a command decision is recorded in the audit trail. The item still belongs to you.',
          ],
        },
      ],
    },

    {
      anchor: 'returned-reports',
      heading: 'Returned Reports',
      blurb: 'Work sent back, with the note that came with it.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'A returned report, a returned case from sign-off and a returned legal request all land in **Returned to you** with the reviewer’s note.',
            'The row links straight to the draft so you can fix and resubmit without hunting for it.',
            'A report you are asked to review arrives under **Needs your action** as a *Report review*.',
          ],
        },
        {
          kind: 'links',
          items: [{ to: '/guides/reports-evidence', label: 'Reports and Evidence Guide' }],
        },
      ],
    },

    {
      anchor: 'legal-responses',
      heading: 'Legal Responses',
      blurb: 'Decisions, comments and the judicial queue.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'A decision on one of your legal requests arrives as a **Legal requests** row; while it is with someone else it sits under *Waiting on others*.',
            'A comment on a request you are involved in arrives as a **Legal comments** row.',
            'For justice-role viewers, queue pickups, assigned judicial reviews and sealed assignments arrive as **Judicial queue** rows.',
            'A **legal hold** on a case you work reaches you here too — it changes what may be deleted on that case.',
          ],
        },
        {
          kind: 'links',
          items: [{ to: '/guides/legal-requests', label: 'Legal Requests Guide' }],
        },
      ],
    },

    {
      anchor: 'overdue-and-escalation',
      heading: 'Overdue Tasks and Escalation',
      blurb: 'What the portal does on its own when something waits too long.',
      blocks: [
        {
          kind: 'p',
          text: 'When something waits too long the portal escalates it without being asked: the next person up the chain is told, and the row wears an **Escalated** badge that everyone on the case can see. Escalated is also a filter and a count in the metric strip.',
        },
        {
          kind: 'table',
          head: ['What escalates', 'To whom'],
          rows: [
            ['A sign-off waiting past its window', 'The next rank up — Deputy Directors for a Bureau Lead’s, Directors for a Deputy’s, the Owner for a Director’s.'],
            ['An access request', 'The case bureau’s leads.'],
            ['An overdue task', 'The case lead — or the bureau’s leads when the lead is the one holding it.'],
          ],
        },
        {
          kind: 'note',
          text: 'The portal owner tunes the escalation windows from the Owner Console, so the exact hours are a division setting rather than a fixed rule.',
        },
      ],
    },

    {
      anchor: 'evidence-requests',
      heading: 'Evidence and Intel Requests',
      blurb: 'Restricted access, unclaimed intelligence and review work.',
      blocks: [
        {
          kind: 'ul',
          items: [
            '**Restricted access** rows are requests to reach restricted material, and the windows that grant it as they expire.',
            '**Unassigned intel** gathers field intelligence no reviewer has claimed. Claiming one takes it out of everyone else’s queue.',
            '**Claim verdicts**, **Intel validation**, **Intel replies** and **Rejected intel** are the review steps on an intelligence record.',
            '**Observations** and **Surveillance alerts** raise things the portal noticed on a case you work — an unverified observation, or a repeated vehicle.',
          ],
        },
      ],
    },

    {
      anchor: 'direct-actions',
      heading: 'Direct Actions',
      blurb: 'Snooze, dismiss, bulk, presets — and the limits on each.',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Snooze', text: 'Hide a row for 1 hour, 4 hours, until tomorrow morning, or 48 hours — which is the maximum. Snoozed rows come back on their own; **Show snoozed** lists them so you can bring one back early.' },
            { title: 'Dismiss', text: 'Informational rows — a notification, a draft, an expiring window, a reminder — can be dismissed for good. Work assigned to you and decisions you own **cannot** be dismissed. Nothing you dismiss leaves the record; only your queue stops showing it.' },
            { title: 'Select several', text: 'Tick rows (shift-click for a range, `Ctrl`/`⌘`+`A` for what is visible, `Escape` to clear) and use the bar at the bottom: mark read, snooze, or dismiss. The bar says how many of the selected rows can be dismissed and skips the rest.' },
            { title: 'Use a preset', text: 'One-click presets open the queue the way your role usually needs it, and you only see the presets your access allows. Your default is picked from your rank.' },
            { title: 'Save your own view', text: 'Set up filters, sections and *show snoozed* the way you like and save it. Views follow your account, one can be the default, and a link carrying the view opens the queue in that shape.' },
          ],
        },
        {
          kind: 'note',
          text: 'On a phone the rows become cards, the filter chips scroll sideways, sections collapse and the bulk bar sticks to the bottom. Every control stays finger-sized.',
        },
      ],
    },
  ],
}
