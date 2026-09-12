/** Case Management Guide — running a case in the portal.
 *
 *  Written from the case surface as it actually is: the tab groups in
 *  components/cases/caseTabs.ts, the four status vocabularies in lib/status.ts,
 *  the sign-off routing and the bulk actions on Case Files. Where a fact could
 *  drift (the exact tab list, the exact number format) it is described by
 *  purpose rather than transcribed, because the portal renders the
 *  authoritative version of both.
 *
 *  It covers PROCEDURE IN THE PORTAL only. Who may open a case on what
 *  authority, and what has to be in it, is policy — the SOP library governs
 *  that and this guide does not restate it. */
import type { GuideDoc } from '../guideDoc'

export const CASE_MANAGEMENT_DOC: GuideDoc = {
  sections: [
    {
      anchor: 'creating-a-case',
      heading: 'Creating a Case',
      blurb: 'From Case Files, in one form — or from a template that fills it in.',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Open Case Files and choose New Case', text: 'The form asks for a title, a bureau and a summary.' },
            { title: 'Or start from a template', text: 'A template chip prefills those fields. A template with a numbered checklist also seeds the **Tasks** tab, so the case opens with its first steps already listed.' },
            { title: 'Save', text: 'The case is numbered automatically and appears for its bureau immediately. There is no separate “publish” step — a case exists as soon as it is created.' },
          ],
        },
        {
          kind: 'note',
          text: 'A case you create is visible to your bureau at once. If the work is sensitive enough that this is wrong, it is a matter for your chain of command before you open the case, not something to fix afterwards.',
        },
      ],
    },

    {
      anchor: 'numbering-and-titles',
      heading: 'Case Numbering and Titles',
      blurb: 'The number is permanent; the title is yours to keep useful.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'The **case number** is assigned by the portal from the bureau that opened it, and it never changes. Cases opened before the bureau restructure keep their original prefixes — a case number is a permanent identifier, not a description of where the case is now.',
            'Moving a case to another bureau, making it a joint case, or reassigning its lead does **not** renumber it.',
            'The **title** is free text and can be edited. Write it so a colleague scanning a list knows what the case is — the number already says which case it is.',
          ],
        },
      ],
    },

    {
      anchor: 'bureau-and-access',
      heading: 'Assigning a Bureau',
      blurb: 'Who reviews the case, and who can see it.',
      blocks: [
        {
          kind: 'p',
          text: 'The **responsible bureau** decides whose Bureau Lead reviews the case’s legal requests and sign-off. Command can reassign it from the case header when a case changes hands.',
        },
        {
          kind: 'p',
          text: 'When more than one bureau is involved, the lead or Command makes it a **joint case**. The case keeps its origin and gains a JTF tag; members from other bureaus get a temporary joint-case role and, optionally, an access expiry. That grants access to **this case only** — permanent bureau and rank never change, and ending joint-case status closes all the temporary access at once.',
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'A joint-case grant can expire. If a colleague tells you a case has disappeared from their list, check whether their grant lapsed before assuming anything was deleted.',
        },
      ],
    },

    {
      anchor: 'investigators',
      heading: 'Adding Investigators',
      blurb: 'The lead owns the case; supporting officers are assignments.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'The **lead investigator** owns the case. Sign-off, reassignment and most command prompts route to them.',
            '**Supporting officers** are added as assignments and counted on the case header.',
            'Adding someone who cannot otherwise see the case is refused — grant them access first; the portal says so rather than failing quietly.',
          ],
        },
        {
          kind: 'p',
          text: 'Under the case header, a **Health** row shows advisory chips when a case looks neglected — no lead detective, no summary, quiet for a fortnight, overdue tasks, draft reports, returned legal work, undescribed evidence. Each chip says why it raised and jumps to the section that clears it. Health chips are advisory only: they never block sign-off or closure.',
        },
      ],
    },

    {
      anchor: 'linking-entities',
      heading: 'Linking Entities',
      blurb: 'Attaching people, vehicles, organizations and places to the case.',
      blocks: [
        {
          kind: 'p',
          text: 'A case has dedicated tabs for the people, vehicles, organizations and locations it involves, and an **Intel** tab for the intelligence attached to it. Linking opens a search picker over the registry rather than a list to scroll: type a few letters and pick. Suggestions carry enough identity to choose confidently.',
        },
        {
          kind: 'ul',
          items: [
            'Rows you should not pick — already linked here, an officer on LOA, a record merged away — stay visible but are marked with the reason and cannot be selected.',
            'Not in the registry yet? The picker’s **New** row opens the normal create form with what you typed prefilled, duplicate warning included, and links the new record to the case automatically.',
            'Linked records carry a **peek** button: a preview card with identity and counts, so you can confirm you have the right one without leaving the case.',
          ],
        },
        {
          kind: 'links',
          items: [{ to: '/guides/entities-organizations', label: 'Entities and Organizations Guide', hint: 'duplicates, merging, relationship states' }],
        },
      ],
    },

    {
      anchor: 'tasks-and-notes',
      heading: 'Tasks and Notes',
      blurb: 'The checklist and the working record.',
      blocks: [
        {
          kind: 'ul',
          items: [
            '**Tasks** carry an owner and a due date. An overdue task reaches its owner’s Action Center, and escalates on its own if it stays overdue — to the case lead, or to the bureau’s leads when the lead is the one holding it.',
            'If you lead the case or hold a command rank, a task row offers **Reassign**: pick the member and give a short reason. They must be able to see the case.',
            '**Notes** are the case’s working record and keep their full history — every saved version, what changed, by whom and when, with any two versions comparable side by side.',
            'A **Case Closure** report cannot be submitted while tasks are still open. Finish them, or ask the case lead or Bureau Lead to waive one with a reason.',
          ],
        },
        {
          kind: 'note',
          text: 'Never record that a person is a confidential source in a note, a report or a case message. That belongs in the informant compartment and nowhere else.',
        },
      ],
    },

    {
      anchor: 'timeline-and-activity',
      heading: 'Timeline and Activity',
      blurb: 'What happened on the case, and when.',
      blocks: [
        {
          kind: 'ul',
          items: [
            '**Activity** is the case’s event feed in order — who did what, and when.',
            '**Timeline** puts the same events on a zoomable chronology band: scroll to zoom, drag to pan, hover a point for the detail.',
            '**Graph** charts the case as a link diagram — suspects, vehicles, organizations, places, evidence and reports around the case, joined by labelled relationships. Drag to arrange it; the arrangement is remembered per case.',
          ],
        },
        {
          kind: 'p',
          text: 'Switching between case tabs never loses your place: every tab you have visited keeps its filters, drafts and scroll position until you leave the case.',
        },
      ],
    },

    {
      anchor: 'sign-off',
      heading: 'Sign-off',
      blurb: 'Submitting the finished investigation for command review.',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Open the Sign-off tab and submit', text: 'The case moves into command review and its workflow state changes to reflect that.' },
            { title: 'Routing happens automatically', text: 'Bureau lead, then deputy director, then director. It is **LOA-aware**: an approver on leave is skipped and the record shows who actually signed.' },
            { title: 'Watch for a return', text: 'A returned case lands on your dashboard and in the Action Center’s **Returned to you** lane with the reviewer’s note. Fix it and resubmit.' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Nobody approves their own submission — at any rank. If you are the only person who could sign, the case needs someone else in the chain, not a workaround.',
        },
      ],
    },

    {
      anchor: 'closing-and-reopening',
      heading: 'Closing and Reopening',
      blurb: 'Closure runs through sign-off; nothing is ever deleted from the working view.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Closure runs through **Sign-off**. Changing the status chip alone is not a closure.',
            'A closed case can be **reopened** by changing its status if your rank allows. Sealed reports inside it stay sealed.',
            'Command **archives** a case to take it out of the working view; archived cases are restorable. Only the portal owner can permanently delete one, through a confirmed protocol.',
            'There is no bulk close and no bulk delete. Closing goes through sign-off, one case at a time.',
          ],
        },
        {
          kind: 'p',
          text: 'On the **Case Files** list you can select several cases and set their status, assign a lead (command only), or archive and restore. Every bulk action previews first, skips rows you cannot edit, and reports how many it changed.',
        },
      ],
    },
  ],
}
