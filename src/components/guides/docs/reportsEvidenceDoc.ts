/** Reports and Evidence Guide.
 *
 *  Written from the report surface (templates, the frozen template version, the
 *  four review statuses in lib/reportTemplates.ts) and the evidence surface
 *  (registration, the custody ledger, the integrity states, derivatives,
 *  packets). Visibility rules are described as the server enforces them, not
 *  as the interface happens to arrange them.
 *
 *  Policy on what a report MUST contain, and on disclosure, is the SOP
 *  library's. This guide covers the portal mechanics only. */
import type { GuideDoc } from '../guideDoc'

export const REPORTS_EVIDENCE_DOC: GuideDoc = {
  sections: [
    {
      anchor: 'templates',
      heading: 'Report Templates',
      blurb: 'Where the forms come from, and why a report keeps its own version.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'The **Reports** tab on a case lists the templates Command has published. You pick one and write into its fields.',
            'A report keeps the **exact version of the template it was started on**. A later change to the form never rewrites what you already wrote.',
            'Bureau Leads can propose a new version of a template; the Director publishes it. Template administration lives on its own screen, not inside the case.',
          ],
        },
        {
          kind: 'note',
          text: 'If a template is missing a field the work needs, propose a template change rather than putting the information somewhere it does not belong. A narrative that carries structured facts cannot be searched or exported as structure.',
        },
      ],
    },

    {
      anchor: 'drafting',
      heading: 'Drafting and Autosave',
      blurb: 'Your draft saves itself; restoring one is deliberate.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'While you type, a chip shows **Saving…** then **Saved**. The draft is stored to your account, so you can start a report at one desk and finish it at another.',
            'If you are offline — or the draft grows very large — the chip says so and the draft is kept on the device until it can sync.',
            'Reopening the editor shows a **Restore draft** banner. Restore it, or **Discard** it deliberately. Saved drafts also appear in the Action Center’s **Drafts** lane.',
            'The same autosave runs on case notes, the case chat composer, person and organization creation, and intelligence summaries.',
          ],
        },
        {
          kind: 'p',
          text: 'Person fields in a template are **registry pickers**, not free typing: search the registry and the report stores the name together with a link to the profile. Someone genuinely not in the registry can still be written in and is plainly marked as not linked — but only a linked suspect can feed an arrest-warrant request from the report.',
        },
      ],
    },

    {
      anchor: 'linking-reports',
      heading: 'Linking Reports to Cases',
      blurb: 'A report belongs to a case, and remembers what it named.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Reports are written on the case, so the link is made by where you started — there is no separate “attach to case” step.',
            'The editor can **insert** people, vehicles, evidence, charges, officers and timeline events from the case, and the narrative recognises mentions of registry records.',
            'The report remembers every record it inserted or mentioned, so a person or vehicle profile can list the reports that name it.',
            'A mention you are not allowed to see renders as **Restricted record** rather than leaking the name.',
          ],
        },
      ],
    },

    {
      anchor: 'evidence',
      heading: 'Evidence and Media',
      blurb: 'Registering an item, and the integrity chip.',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Add evidence from the case’s Evidence & Media tab', text: 'Your browser computes the file’s fingerprint before the upload, and the file goes to the division’s own private storage.' },
            { title: 'The item is registered', text: 'It receives an evidence number and a custody ledger, and its integrity chip reads **UNVERIFIED** until the evidence service has re-hashed the stored file.' },
            { title: 'Integrity is re-checked on a cadence', text: 'The chip then reads **VERIFIED** with the check time — or **INTEGRITY FAILURE** if the stored bytes no longer match, in which case the uploader, the custodian, the case lead and the portal owner are alerted at once. *Verify* asks for a check now.' },
          ],
        },
        {
          kind: 'p',
          text: 'Open an item’s card for its detail sheet: every field, the custody history with its chain check, derivatives, related records, and the processing and export history. **Transfer custody** hands the item to a colleague who can see the case, with a reason; viewing and downloading are logged to the ledger.',
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'The original is never overwritten. Previews, extracted text, redacted and converted copies are separate **derivatives** that record their parent — so “the file” in a case is always the file that was collected.',
        },
      ],
    },

    {
      anchor: 'categories',
      heading: 'Categories',
      blurb: 'What the category is for, and what it is not.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Every evidence item carries a **category** describing what it is — a scene photograph, people, vehicles, places, surveillance, documents, or other.',
            'The category organizes the gallery and the packet sections. It is **not** an access control: what a colleague can see is decided by their access to the case and by any restriction on the item, never by the category.',
            'Give every item a description. “Undescribed evidence” is one of the health chips a case raises, and an undescribed item is effectively lost in a large case.',
          ],
        },
      ],
    },

    {
      anchor: 'finalizing',
      heading: 'Finalizing and Signing',
      blurb: 'Submit, review, seal — and who may do which.',
      blocks: [
        {
          kind: 'table',
          head: ['Status', 'What it means', 'Who acts next'],
          rows: [
            ['Draft', 'Being written. Only you see it in the list as yours.', 'You'],
            ['Awaiting review', 'Submitted. Your signature — name, badge, time — is recorded and the contents are locked.', 'A reviewer on the case'],
            ['Returned for revision', 'The reviewer sent it back with a note.', 'You: edit and resubmit'],
            ['Sealed', 'Approved, with the reviewer’s own signature.', 'Nobody — it is final unless reopened'],
          ],
        },
        {
          kind: 'ul',
          items: [
            'The reviewer is a Senior Detective or Bureau Lead on the case — **never you**.',
            'A **Case Closure** report cannot be submitted while the case still has open tasks. Finish them, or have one waived with a reason.',
            'The legal drafting forms skip review: submitting one seals it, because the legal request it feeds carries its own review chain.',
          ],
        },
      ],
    },

    {
      anchor: 'corrections',
      heading: 'Corrections and Reopening',
      blurb: 'Nothing sealed is lost, and “Return filed” is not “Returned”.',
      blocks: [
        {
          kind: 'ul',
          items: [
            '**Reopen** is for Bureau Leads and above and always needs a reason.',
            'Nothing sealed is ever lost: **Signatures** shows every seal including superseded ones, and **Versions** lists each sealed version exactly as it was signed.',
            'Warrant reports carry their own ladder — draft, signed, executed, **Return filed** — which feeds the BOLO board and person profiles.',
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: '**Return filed** means the warrant’s return went to the court and the warrant is complete. It is deliberately not called “Returned”, which everywhere else in the portal means *returned to you for revision*.',
        },
      ],
    },

    {
      anchor: 'exporting',
      heading: 'Exporting',
      blurb: 'A single report, or the court-ready packet.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Export a single report as PDF, Word or Markdown from its actions menu. Every export is logged and stamped with a short verification code in the footer; a sealed report exports exactly what was signed.',
            '**Generate Case Packet** builds the court-ready PDF on the server: pick a type, tick sections, add a watermark, and keep working — the row moves from queued to rendering to ready and you are notified.',
            'A packet ships with a **manifest** of every file’s fingerprint, and every download is logged. **Verify package** lets anyone holding the files confirm nothing was altered.',
            '**Quick export** still builds the record on your own machine for a fast read. It carries no manifest — for court, use the generated packet.',
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'A packet contains only what **you** may see at the moment it is generated. Restricted media without a fresh approval, sealed legal material and anything confidential are left out and counted, not silently included.',
        },
      ],
    },

    {
      anchor: 'visibility',
      heading: 'Visibility Rules',
      blurb: 'Who sees a report or an item, and why you cannot widen it from here.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Access to a report or an evidence item follows access to its **case**. There is no per-report sharing control, and adding somebody to a report is not a thing you can do — you add them to the case.',
            'A **sealed** evidence item is restricted further: a Senior Detective or the uploader may seal a verified item, and command may release it.',
            'A record restricted by the Special Investigations Bureau is simply **not there** for a CID viewer — an ordinary “not found”, with no hint that anything was withheld. That is the correct behaviour, not an error.',
            'Reviewers of a legal request receive only the **packet** that was selected, never the case.',
          ],
        },
        {
          kind: 'links',
          items: [
            { to: '/guides/case-management', label: 'Case Management Guide' },
            { to: '/guides/legal-requests', label: 'Legal Requests Guide' },
          ],
        },
      ],
    },
  ],
}
