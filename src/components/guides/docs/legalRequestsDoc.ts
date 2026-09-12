/** Legal Requests Guide.
 *
 *  Written from the legal surface: the request kinds and their required fields
 *  (lib/legalWorkflow.ts), the review-status vocabulary (lib/justice.ts
 *  REVIEW_STATUS_LABEL), the packet, and the two review chains. The status
 *  table below uses the portal's own labels verbatim so that a chip on screen
 *  and a row in this guide read the same.
 *
 *  What constitutes probable cause, and when a warrant is the right
 *  instrument, is law and policy — the SOP library and the penal code govern
 *  that. This guide covers filing and tracking one in the portal. */
import type { GuideDoc } from '../guideDoc'

export const LEGAL_REQUESTS_DOC: GuideDoc = {
  sections: [
    {
      anchor: 'warrants-and-subpoenas',
      heading: 'Warrants and Subpoenas',
      blurb: 'Which instrument, and what each one needs before it will submit.',
      blocks: [
        {
          kind: 'p',
          text: 'Legal work lives in **Legal Requests** and on each case’s **Legal** tab. You file a warrant request or a subpoena — or start one from a finalized arrest-warrant report, which carries its details across.',
        },
        {
          kind: 'table',
          head: ['Request', 'What it needs', 'Note'],
          rows: [
            ['Arrest warrant', 'A suspect picked from the Persons registry, and your justification.', 'A typed name that is not linked to a profile cannot feed an arrest warrant.'],
            ['Search warrant', 'A subject and/or search targets — places, postal areas, vehicles — plus the items sought.', 'Targets are pickers over the registries, not free text.'],
            ['Subpoena', 'A recipient and a reason. A player recipient comes from the Persons registry; an entity recipient is named.', 'A response deadline drives the tracking later.'],
          ],
        },
        {
          kind: 'note',
          text: 'The form checks these before it lets you submit and names what is missing. It does not check whether the instrument is the right one — that is your judgement and your supervisor’s.',
        },
      ],
    },

    {
      anchor: 'justification',
      heading: 'Probable Cause and Reasonable Suspicion',
      blurb: 'Where your justification goes, and what it is read against.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Your **justification** — the description of what you have and why it meets the standard — is the narrative field on the request. For a warrant it is the probable cause; for a subpoena it is the reason.',
            'It is required. The form refuses to submit without it and says so.',
            'Reviewers read the justification **together with the packet** you selected, and nothing else from the case. If the reasoning depends on an item, that item has to be in the packet.',
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'The standard itself is a matter of law and division policy, not of this portal. The SOP library states it; the portal only records what you wrote and who decided on it.',
        },
      ],
    },

    {
      anchor: 'suggested-charges',
      heading: 'Suggested Charges',
      blurb: 'Charges come from the frozen penal-code snapshot.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Charges are added from the **penal-code snapshot**, so a charge records the code as it read when it was added rather than as it reads today.',
            'On a case, an authorized investigator adds a charge and it is **active immediately** — there is no internal command approval step for adding one.',
            'Filing with the court, conviction and dismissal are recorded by the court-side authorities, not by CID. Withdrawal stays with the case team.',
            'Charges on the case inform a legal request but are not the request: what the reviewer acts on is the request and its packet.',
          ],
        },
      ],
    },

    {
      anchor: 'supporting-evidence',
      heading: 'Supporting Evidence',
      blurb: 'The packet is the whole of what a reviewer receives.',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Open the draft’s Packet tab', text: 'Select the exhibits reviewers should see — evidence, attachments, finalized reports, media and links.' },
            { title: 'Check the preview', text: 'Submitting runs a preview that cross-checks your selected items against their live sources and flags anything missing or unfinalized before you confirm.' },
            { title: 'Know what rides along', text: 'Alongside the packet, reviewers see a minimal case brief: number, title, status, stage and bureau. Nothing else from the case.' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Reviewers receive **only** the packet. An item you left out is an item they do not have, however obviously relevant it is on the case.',
        },
      ],
    },

    {
      anchor: 'submission',
      heading: 'Submission to DOJ and the Judiciary',
      blurb: 'Two chains — CID’s and SIB’s — and they do not mix.',
      blocks: [
        {
          kind: 'p',
          text: 'A CID request goes to the responsible bureau’s command for review, then to the covering prosecutor queue, then to judicial review, and finally to issue and fulfilment. A Deputy Director, the Director or the portal owner may act at the command step at any time, from any bureau, with no hand-off; on a joint case any Bureau Lead may act.',
        },
        {
          kind: 'p',
          text: 'An **SIB** request never enters the CID lane or the bureau prosecutor queue. SIB command reviews first, approval goes to the Attorney General, and then to a judge where judicial approval is required. Notifications stay inside the unit.',
        },
        {
          kind: 'ul',
          items: [
            'A prosecutor **claims** a request from the queue; conflicts of interest are barred automatically.',
            'A **sealed** request cannot be claimed from any queue — prosecutors and judges reach it only by explicit assignment.',
            'Nobody reviews their own request, at any rank, in either chain.',
          ],
        },
      ],
    },

    {
      anchor: 'comments-and-revisions',
      heading: 'Comments and Revisions',
      blurb: 'A return reopens the draft; a material change rewinds it.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Any **return** reopens the draft with the reviewer’s note attached. Fix it and resubmit.',
            'If a judge or prosecutor returned it and your fix is **not** a material change, resubmission goes straight back to the prosecutor queue.',
            'Declare a **material change** and it re-enters full command review. That declaration is yours to make honestly, and it is logged.',
            'Comments on a request reach you in the Action Center as **Legal comments**, not only in the bell.',
          ],
        },
        {
          kind: 'note',
          text: 'The review history on the request names who acted and the rank they held **at the time**, so a later promotion never rewrites who decided what.',
        },
      ],
    },

    {
      anchor: 'decisions',
      heading: 'Approval, Denial and Returned States',
      blurb: 'The portal’s own words for where a request stands.',
      blocks: [
        {
          kind: 'table',
          head: ['State', 'What it means'],
          rows: [
            ['Draft', 'Not submitted. Yours to edit.'],
            ['Awaiting bureau review', 'With CID command.'],
            ['Awaiting SIB command review', 'With SIB command — the CID chain is not involved.'],
            ['Returned for revision (bureau)', 'Command sent it back with a note.'],
            ['Returned for revision (SIB command)', 'SIB command sent it back with a note.'],
            ['Awaiting judge', 'In the judicial queue, not yet claimed.'],
            ['Under judicial review', 'A judge has it.'],
            ['Returned for revision (judge)', 'The judge sent it back with a note.'],
            ['Approved', 'Granted as requested.'],
            ['Partially approved', 'Granted in part — read the conditions.'],
            ['Denied', 'Refused.'],
            ['Withdrawn', 'You withdrew it before a decision.'],
            ['Cancelled', 'Stopped by command authority with a reason.'],
            ['Superseded', 'Replaced by a later request.'],
          ],
        },
        {
          kind: 'ul',
          items: [
            'A judge approves — with conditions and an expiry where warranted — denies, or returns. A judge never issues the instrument.',
            'Once approved, an authorized CID officer records **issue**, then execution and return for a warrant, or service and compliance for a subpoena.',
            'Materials received under a subpoena are logged back to the case.',
            'The creator can **withdraw** before a decision. Revoking an issued instrument needs the assigned judge, DOJ management or the owner, with a reason.',
          ],
        },
      ],
    },

    {
      anchor: 'tracking',
      heading: 'Pending-Request Tracking',
      blurb: 'Where to watch, and what the portal chases for you.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'The case’s **Legal** tab groups the case’s requests by who acts next, so “what is waiting on me” and “what is waiting on someone else” are separate at a glance.',
            'Your own pending requests appear in the Action Center under **Waiting on others** — nothing for you to do yet — and move to **Returned to you** the moment one comes back.',
            'A subpoena’s **response deadline** surfaces as it approaches, and stays visible while the subpoena is still live after it passes.',
            'A request that vanished from your queue moved to the next stage, was claimed by someone else, or is sealed. Its review history says which.',
          ],
        },
        {
          kind: 'links',
          items: [
            { to: '/guides/action-center', label: 'Action Center Guide' },
            { to: '/guides/reports-evidence', label: 'Reports and Evidence Guide', hint: 'what goes in the packet' },
          ],
        },
      ],
    },
  ],
}
