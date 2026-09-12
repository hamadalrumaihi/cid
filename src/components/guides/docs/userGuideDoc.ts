/** Portal User Guide — the introduction to the portal.
 *
 *  This is deliberately an INTRODUCTION. It says what each area is for, how to
 *  get in, and where the work lives — then points at the specialized guide for
 *  anything that needs more than a paragraph. It is not a replacement for the
 *  Case Management, Reports and Evidence, Legal Requests, Action Center or
 *  Entities guides, and it must not grow into one: when a section here starts
 *  needing sub-steps, the steps belong in the specialized guide and this
 *  section becomes a link to it.
 *
 *  It also does not restate policy. SOPs and the Handbook say what you must
 *  do and on whose authority; a guide says how the portal does it. Where the
 *  two meet, this links rather than copies — a policy quoted in two places
 *  goes out of date in one of them.
 *
 *  ACCURACY NOTE. The previous written manual hand-maintained a copy of the
 *  sidebar and the case tab rail, and both had drifted from the code: it named
 *  an "Investigative Tools" sidebar category that had folded into
 *  Investigations, a "Division Overview" screen that had folded into the
 *  Command Center, put the Audit Log under Oversight after it moved to Owner,
 *  called My Dashboard the landing page after the Action Center became it, and
 *  described a combined "Intel & Notes" case tab after People, Vehicles,
 *  Gangs, Locations, Intel, Notes and Activity became separate ones. Those are
 *  corrected here, and the structural lists that CAN drift are kept short and
 *  described by purpose, because the portal renders the authoritative version
 *  of each from the code itself. */
import type { GuideDoc } from '../guideDoc'

export const USER_GUIDE_DOC: GuideDoc = {
  sections: [
    {
      anchor: 'getting-started',
      heading: 'Getting Started',
      blurb: 'Signing in, asking for the right access, and setting yourself up.',
      blocks: [
        {
          kind: 'p',
          text: 'The portal is the division’s live case-management system. Everything in it is **shared and live** — when a colleague updates a record, your screen follows within seconds. What you can see and do depends on your active membership, department, rank, assignment and, where it applies, compartment. Every rule is enforced by the server: if a record is not yours to see, it simply is not there.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Sign in', text: 'You land on the **Secure Access** screen. Continue with Discord, continue with Google, or enter your email for a one-time link.' },
            { title: 'Say what you need access for', text: 'First time in, the portal asks. **Join CID** is an application — display name, badge number, permanent bureau, the role you are requesting and a short reason. **Submit Intelligence** is for SAHP, BCSO and LSPD personnel and is available straight away.' },
            { title: 'Wait for the decision, if you applied', text: 'Requesting grants nothing. Command approves, approves with a different role, returns it for correction, or rejects it. You stay locked out until approved.' },
            { title: 'Set yourself up', text: 'Open **My Profile** from your name card at the bottom of the sidebar: display name, badge number, avatar, Discord link. Your work is attributed by display name and badge.' },
          ],
        },
        {
          kind: 'note',
          text: 'SIB membership is appointed from inside the division, never applied for here. JTF is a per-case designation, not a home bureau.',
        },
        {
          kind: 'p',
          text: 'Screens and actions appear only where your standing supports them. A control you cannot use is not hidden as a courtesy — the server would refuse it anyway.',
        },
      ],
    },

    {
      anchor: 'navigation-and-search',
      heading: 'Navigation and Search',
      blurb: 'The sidebar, the header, and the one search that reaches everything.',
      blocks: [
        {
          kind: 'p',
          text: 'The sidebar groups screens into categories — click a category to open its first screen, then use the sub-tab strip under the header to move between the screens inside it. On a phone the categories become a bottom bar. Below the categories sit three destinations of their own: **Guides**, **Feedback** and **Report a Concern**.',
        },
        {
          kind: 'ul',
          items: [
            '**Command** — your Action Center and dashboard, division analytics, announcements, the heatmap and the roster.',
            '**Investigations** — case files, operations, legal requests, intelligence, the shared registries, RICO and attachments.',
            '**Reference** — the penal code and the SOP library.',
            '**Oversight** — the calendar, shift reports and the Trash.',
            '**Owner** — portal administration, the audit log and the developer handbook. Only the portal owner sees this category.',
          ],
        },
        {
          kind: 'note',
          text: 'The categories above are described by purpose rather than listed screen by screen, because the portal draws the authoritative map from its own navigation. If this text and the sidebar ever disagree, the sidebar is right.',
        },
        {
          kind: 'p',
          text: 'The **Special Investigations Bureau** is a separate workspace and authority, not a category. An SIB account gets its own Unit section first and then CID’s entire navigation, over the same shared dataset.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Search everything', text: 'Press `/` to focus the header search, or `Ctrl-K` / `⌘K` for the palette. One search reaches everything your access can see — cases, reports, tasks, evidence, operations, legal requests, people, BOLOs, gangs, places, vehicles, accounts, narcotics, documents, penal charges, intelligence submissions, members and the text inside case documents.' },
            { title: 'Read the result tags', text: 'Results are grouped by kind and each row says what it is. Matching tolerates typos, and a plate fragment or part of a case number is enough.' },
            { title: 'Run commands from the same box', text: 'The palette also goes to any screen your role can open, creates a record you are allowed to create, lists your active cases, and sets or clears your LOA.' },
          ],
        },
        {
          kind: 'p',
          text: '**+ Create** in the header opens the same forms the individual screens use, from anywhere. Types your role cannot create are not offered. **Pin** a case or record to keep it one click away — pins are saved to your account and follow you across devices; the portal also keeps a short recently-opened trail on each device. Both appear in the **Jump back in** strip on your dashboard.',
        },
      ],
    },

    {
      anchor: 'dashboard-and-my-desk',
      heading: 'Dashboard and My Desk',
      blurb: 'Where your own work is gathered.',
      blocks: [
        {
          kind: 'p',
          text: 'A bare app open lands you on the **Action Center** — the queue of what is waiting on you. **My Dashboard** is the broader picture of your work: a prioritized *Needs your attention* panel drawn from the top of that same queue, your cases, the Jump back in strip, your open workspace tabs, unfinished drafts, watched items and your recent activity. Every count clicks through to the screen that owns it.',
        },
        {
          kind: 'p',
          text: 'If your account holds more than one working world, a **dashboard switcher** at the top hops between them — My Dashboard, Cases, Command Center, SIB, Legal Review, Owner Console — showing only the ones your access actually grants.',
        },
        {
          kind: 'p',
          text: 'Command administration — personnel approvals, promotions, chain of command, duty status, workload and the command queues — lives in the **Command Center**.',
        },
        {
          kind: 'ul',
          items: [
            '**Follow** a case, person or vehicle with the ☆ button and changes to it appear under *Watched items*.',
            '**Pin** it instead to keep it one click away. Follow is “tell me about changes”; pin is “keep it handy”.',
          ],
        },
      ],
    },

    {
      anchor: 'action-center',
      heading: 'Action Center',
      blurb: 'One queue for everything awaiting a decision or an action from you.',
      blocks: [
        {
          kind: 'p',
          text: 'Everything waiting on you — a task, a blocker, a sign-off, an access request, a legal request, a report to review, a mention, a draft — lands in the **Action Center** as one list, most urgent first, in named sections: Overdue, Returned to you, Needs your action, Command decisions, Unassigned intel, Expiring BOLOs, Waiting on others, and Drafts.',
        },
        {
          kind: 'p',
          text: 'Every row says why it is there and what to do next. Where the portal has a safe one-click action, it is on the row; anything needing a proper form opens the screen that owns it.',
        },
        {
          kind: 'links',
          items: [{ to: '/guides/action-center', label: 'Action Center Guide', hint: 'snoozing, dismissing, reassigning, presets and escalation' }],
        },
      ],
    },

    {
      anchor: 'cases',
      heading: 'Cases',
      blurb: 'The case file, and the four separate dials that describe it.',
      blocks: [
        {
          kind: 'p',
          text: 'A case is created from **Case Files**, gets an auto-numbered identifier and appears for its bureau immediately. Inside, its tabs are grouped into three areas — Investigation, Evidence & Case Record, and Coordination & Closure — and each section pill carries a live count plus an attention dot when something in it needs someone.',
        },
        {
          kind: 'p',
          text: 'A case carries **four separate dials**, and conflating them is the most common mistake: **status** is the record state, **priority** is urgency, **investigative stage** is a deliberate progress marker moved with a reason, and **workflow** is where it sits in sign-off. Hover any status chip anywhere in the portal and the tooltip says what it means and who acts next.',
        },
        {
          kind: 'links',
          items: [{ to: '/guides/case-management', label: 'Case Management Guide', hint: 'creating, staffing, linking, tasks, sign-off, closing' }],
        },
      ],
    },

    {
      anchor: 'reports',
      heading: 'Reports',
      blurb: 'Writing, review and sealing.',
      blocks: [
        {
          kind: 'p',
          text: 'Investigative reports are written on a case’s **Reports** tab from the division’s published templates. A report keeps the exact version of the template it was started on, so a later change to the form never rewrites what you wrote. Your draft saves itself as you type.',
        },
        {
          kind: 'p',
          text: 'Submitting for review records your signature and locks the contents; a reviewer returns it with a note or approves it, which **seals** it. Status reads Draft → Awaiting review → Returned for revision → Sealed.',
        },
        {
          kind: 'links',
          items: [{ to: '/guides/reports-evidence', label: 'Reports and Evidence Guide', hint: 'templates, review, corrections, exporting' }],
        },
      ],
    },

    {
      anchor: 'evidence-and-media',
      heading: 'Evidence and Media',
      blurb: 'Registering an item, and what the integrity chip means.',
      blocks: [
        {
          kind: 'p',
          text: 'A case’s **Evidence & Media** tab is the evidence record. Adding evidence uploads the file to the division’s own private storage — your browser computes its fingerprint first — and registers it with an evidence number, a custody ledger and an integrity state. The original is never overwritten: previews, extracted text and redacted copies are separate derivatives that record their parent.',
        },
        {
          kind: 'note',
          text: 'Photographs attached to a registry record — a person, gang, place, vehicle or narcotic — are **intelligence, not evidence**. They get no evidence number and no custody chain, and they cannot be converted into evidence later. Evidence belongs to a case and is registered there.',
        },
        {
          kind: 'links',
          items: [{ to: '/guides/reports-evidence', label: 'Reports and Evidence Guide', hint: 'custody, integrity, packets, exports' }],
        },
      ],
    },

    {
      anchor: 'tasks-and-notes',
      heading: 'Tasks and Notes',
      blurb: 'The checklist, the working record, and what happens when you delete.',
      blocks: [
        {
          kind: 'ul',
          items: [
            '**Tasks** is the case checklist, with an owner and a due date on each item. An overdue task reaches the owner’s Action Center, and — if it stays overdue — escalates on its own.',
            '**Notes** is the case’s working record. Notes keep their history: every saved version, what changed, by whom and when.',
            '**Activity** is the case’s own event feed, and **Timeline** puts the same events on a zoomable chronology band.',
          ],
        },
        {
          kind: 'p',
          text: 'Deleting never destroys anything. A deleted record moves to the **Trash** with an **Undo** on the toast; the Trash lists every deleted record you are allowed to bring back, with who deleted it, when and why. Permanent deletion is the portal owner’s alone, through a confirmed protocol.',
        },
      ],
    },

    {
      anchor: 'registries',
      heading: 'People, Vehicles, Organizations, Places, Accounts, Indicators and Narcotics',
      blurb: 'One shared, deconflicted dataset — the records, the identifiers, and the links that give both value.',
      blocks: [
        {
          kind: 'p',
          text: 'The registries are one shared dataset for the whole platform, not per-bureau copies. They open in a workspace that holds several tools at once as tabs, so Persons can sit beside Vehicles beside the BOLO Board, and nothing resets when you switch between them.',
        },
        {
          kind: 'p',
          text: 'Registries are relationship-first: a record’s value is who and what it is connected to. Every relationship can be **edited** rather than recreated — change its confidence or note, or mark it Current, Historical or Disputed as the picture develops.',
        },
        {
          kind: 'p',
          text: '**Accounts** and **Indicators** are registries of their own, not fields on somebody else’s record. Accounts hold online accounts with their handle history and who operates them; Indicators hold the hard values — phones, emails, account identifiers, serials, aliases and addresses — logged per case and matched across all of them, so the same value surfacing on two cases raises a deconfliction alert.',
        },
        {
          kind: 'links',
          items: [{ to: '/guides/entities-organizations', label: 'Entities and Organizations Guide', hint: 'people, vehicles, organizations, places, narcotics, accounts and indicators — linking, duplicates, merging, deconfliction and confirmed relationships' }],
        },
      ],
    },

    {
      anchor: 'legal-requests',
      heading: 'Legal Requests',
      blurb: 'Warrants and subpoenas, and the packet reviewers actually receive.',
      blocks: [
        {
          kind: 'p',
          text: 'Legal work lives in **Legal Requests** and on each case’s **Legal** tab. You draft the request, then select the exhibits reviewers should see on its **Packet** tab.',
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Reviewers receive only the packet you selected — never the rest of the case. Anything you leave out of the packet, they do not have.',
        },
        {
          kind: 'links',
          items: [{ to: '/guides/legal-requests', label: 'Legal Requests Guide', hint: 'justification, charges, submission, decisions, tracking' }],
        },
      ],
    },

    {
      anchor: 'notifications',
      heading: 'Notifications',
      blurb: 'The bell, what it groups, and what you can turn off.',
      blocks: [
        {
          kind: 'p',
          text: 'The **bell** in the header is your notification feed. Notifications about the same case or request collapse into one group and the unread badge is exact. Click a row to mark it read and jump to its record, mark a whole group read, or mark everything read in one click.',
        },
        {
          kind: 'ul',
          items: [
            'The bell’s settings panel can **mute the optional streams** — announcements, tracker authorizations, document suggestions, stale-case reminders and sign-off heads-ups.',
            'Assignments, mentions, sign-off decisions, legal notices and security notices **can never be muted**.',
            'Duplicate notifications for the same event are suppressed automatically.',
            'On **My Profile**, under your Discord ID, you choose which categories also arrive as direct messages.',
          ],
        },
        {
          kind: 'note',
          text: 'A notification can outlive your access to what it was about — a case that moved bureaus, a request that was sealed. The row then says so plainly instead of opening a broken link.',
        },
      ],
    },

    {
      anchor: 'account-and-membership',
      heading: 'Account and Membership',
      blurb: 'Your profile, your appearance settings, LOA, and how access changes.',
      blocks: [
        {
          kind: 'ul',
          items: [
            '**My Profile** holds your display name, badge number, avatar, Discord link and notification choices. Your work is attributed by display name and badge.',
            'The **Appearance** tab holds your accent colour and comfortable or compact density. It is saved on the device you set it on.',
            '**Set LOA** in the header before leave. It is informational — you can still sign in — but sign-off routing goes around you while it is set.',
            'Your **access chip** in the header says what your role allows; hover it for the detail.',
          ],
        },
        {
          kind: 'p',
          text: 'Membership changes — approvals, role changes, promotions and duty status — are Command’s, through the Command Center. Access can also lawfully end: a joint-case grant expires, a restriction is applied. A record that disappears is not necessarily deleted.',
        },
      ],
    },

    {
      anchor: 'mobile-and-tablet',
      heading: 'Mobile and Tablet Use',
      blurb: 'What the phone screen does, and what it deliberately does not.',
      blocks: [
        {
          kind: 'p',
          text: 'Open a case on a phone and you land on a **phone-first screen**: the case number, title, status and lead on top, sections along the bottom, and cards instead of tables. You can add a task and mark one done, add a note, link a person or vehicle, and edit a report’s narrative with autosave.',
        },
        {
          kind: 'ul',
          items: [
            'Submitting, sealing and reviewing are **desktop actions** — the phone says so rather than offering a control that will fail.',
            'Dense desktop-only sections show an **Open on desktop** card, which switches you to the full workspace and keeps it until you close the tab.',
            'The Action Center is phone-ready: the same items as cards, with the same actions, and the bulk bar pinned to the bottom.',
            'On a tablet, lists become two columns and tables scroll inside their own box rather than pushing the page sideways.',
          ],
        },
      ],
    },

    {
      anchor: 'common-problems',
      heading: 'Common Problems',
      blurb: 'The things members actually hit, and what each one means.',
      blocks: [
        {
          kind: 'table',
          head: ['Symptom', 'What it means — and the fix'],
          rows: [
            ['Signed in but not approved', 'Your membership request is pending. Ask Command to review it, then reload.'],
            ['No CID screens after choosing Submit Intelligence', 'Correct — that access is submission-only. Investigative access needs a Command-approved CID membership.'],
            ['A case a colleague mentions is not there', 'It belongs to another bureau, or access is scoped away from you. Ask the case lead or your Bureau Lead; access is enforced server-side.'],
            ['A record you saw before is gone', 'Access can lawfully end — a joint-case expiry, a restriction. Ask your lead rather than assuming it was deleted.'],
            ['Save failed or Delete failed', 'The server refused the write and the message says why. Nothing was silently lost.'],
            ['Upload failed', 'Check the file type and your connection, then retry. Each file uploads independently.'],
            ['A legal request vanished from your queue', 'It moved to the next stage, was claimed by someone else, or is sealed. Check its review history from the request itself.'],
            ['Search finds nothing', 'Use fewer letters — it tolerates typos — or a plate or case-number fragment. `Ctrl-K` / `⌘K` opens the full palette.'],
            ['Changes elsewhere are not showing', 'A banner appears when you are offline. Reload, or refresh from your dashboard.'],
            ['You deleted something by accident', 'Press **Undo** on the toast, or open the **Trash** and restore the row. Deletions move records to the Trash; they never destroy them.'],
            ['You cannot approve your own work', 'By design, everywhere — sign-off, legal review, membership approvals. A second person must act.'],
          ],
        },
        {
          kind: 'p',
          text: 'Something wrong that is not on this list? Use **Feedback** in the sidebar — it goes to the portal owner and you can watch its status as it is triaged.',
        },
      ],
    },

    {
      anchor: 'more-guides',
      heading: 'Where to Find Additional Guides',
      blurb: 'This guide introduces the portal; these ones do the detail.',
      blocks: [
        {
          kind: 'p',
          text: 'Every guide lives in the **Guides** library, has its own address you can send to a colleague, and shows when it was last updated. Search the library by title, summary, category or tag — the results open at the matching section rather than at the top.',
        },
        {
          kind: 'links',
          items: [
            { to: '/guides/case-management', label: 'Case Management' },
            { to: '/guides/reports-evidence', label: 'Reports and Evidence' },
            { to: '/guides/legal-requests', label: 'Legal Requests' },
            { to: '/guides/action-center', label: 'Action Center' },
            { to: '/guides/entities-organizations', label: 'Entities and Organizations' },
            { to: '/guides', label: 'Browse all guides' },
          ],
        },
        {
          kind: 'note',
          text: 'Guides explain how to use the portal. **SOPs and the Handbook** state policy, authority and mandatory rules — where the two meet, the SOP governs and the guide links to it rather than repeating it.',
        },
      ],
    },
  ],
}
