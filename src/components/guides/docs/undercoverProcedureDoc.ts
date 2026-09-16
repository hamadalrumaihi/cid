/** CID Undercover Operations Procedure — Director Jack Crow.
 *
 *  This is a POLICY DOCUMENT, not a how-to guide, and it is transcribed rather
 *  than written: the wording below is the issued procedure's own. Sections,
 *  their order and their numbering match the source exactly, because a member
 *  quoting "§5" to their Bureau Lead and a member reading it here have to be
 *  looking at the same thing.
 *
 *  Two deliberate presentation choices, neither of which changes a
 *  requirement:
 *
 *   · The source repeats "Do not distribute — CID access ONLY" after every
 *     section. Repeating it ten times down one page trains a reader to skip
 *     it. It is stated once, at the top, as the document's classification —
 *     and enforced for real by the guide's `investigative` audience, which is
 *     what actually keeps this off an unauthenticated page.
 *   · The requirements a detective is most likely to be disciplined for
 *     missing — record the whole session, keep it 72 hours, protect the
 *     identity, never commit a serious offence, notify Command after ANY
 *     criminal activity — are carried in `warn` notes. The words are the
 *     source's; only their prominence is ours.
 *
 *  Nothing here invents a requirement the issued procedure does not contain.
 *  If the document changes, this module changes with it and the guide's
 *  revision counter moves — see docs/WORKFLOWS.md. */
import type { GuideDoc } from '../guideDoc'

export const UNDERCOVER_PROCEDURE_DOC: GuideDoc = {
  sections: [
    {
      anchor: 'purpose',
      heading: '1. Purpose',
      blurb: 'What undercover operations are for, and who this binds.',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: '**CID Restricted — CID access only.** Do not distribute. This procedure and everything recorded under it stay inside CID.',
        },
        {
          kind: 'p',
          text: 'The purpose of this procedure is to establish clear guidelines, requirements, and limitations for CID Detectives conducting undercover operations.',
        },
        {
          kind: 'p',
          text: 'Undercover operations are intended to allow Detectives to gather intelligence, develop cases, identify suspects, and obtain evidence while protecting the integrity of the investigation and the identity of the Detective involved.',
        },
        {
          kind: 'p',
          text: 'All Detectives operating undercover are expected to follow this procedure at all times unless specifically directed otherwise by CID Command or High Command.',
        },
        {
          kind: 'facts',
          rows: [
            { label: 'Document type', value: 'Procedure' },
            { label: 'Issuing authority', value: 'Director Jack Crow' },
            { label: 'Audience', value: 'CID' },
            { label: 'Classification', value: 'CID Restricted — CID access only' },
            { label: 'Status', value: 'Active' },
          ],
        },
      ],
    },

    {
      anchor: 'activation',
      heading: '2. Activation Requirements',
      blurb: 'When a Detective may operate undercover, and when they must stop.',
      blocks: [
        {
          kind: 'p',
          text: 'A Detective may operate in an undercover capacity only when the requirements below are met:',
        },
        {
          kind: 'ul',
          items: [
            'The Detective must be actively working an authorized CID case or investigation.',
          ],
        },
        {
          kind: 'p',
          text: 'The investigation must involve circumstances where openly identifying as law enforcement, displaying law enforcement identifiers, or acting in an overt law enforcement capacity would reasonably:',
        },
        {
          kind: 'ul',
          items: [
            'Compromise or significantly harm the investigation;',
            'Reveal the Detective’s identity or investigative interest;',
            'Create a reasonable threat to the Detective’s safety; or',
            'Create a reasonable threat to the safety of the public.',
          ],
        },
        {
          kind: 'ul',
          items: [
            'Undercover status shall only be used when reasonably necessary to accomplish legitimate investigative objectives. Detectives shall not activate an undercover role solely for convenience, personal gain, or participation in criminal activity unrelated to an active investigation.',
            'Once the circumstances requiring undercover status no longer exist, the Detective should return to an identifiable law enforcement capacity when reasonably safe and practical to do so.',
            'CID Command may establish additional activation requirements or restrictions for specific investigations when circumstances warrant.',
          ],
        },
      ],
    },

    {
      anchor: 'recording',
      heading: '3. Recording and Media Requirements',
      blurb: 'Record the whole session, keep it 72 hours, never stream it.',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: '**All Detectives conducting undercover operations are required to record their entire undercover session.**',
        },
        {
          kind: 'ul',
          items: [
            'Recording shall begin prior to, or at the earliest reasonable opportunity before, the Detective begins active undercover activity and shall continue for the duration of the operation.',
            'Detectives are responsible for ensuring their recording equipment is functioning properly before beginning an undercover operation whenever reasonably possible.',
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: '**Undercover recordings shall be retained by the Detective for a minimum of 72 hours following the conclusion of the undercover session.**',
        },
        {
          kind: 'ul',
          items: [
            'CID Command may request the recording at any point during the 72-hour retention period. When requested, the Detective shall provide the complete recording to CID Command.',
            'Detectives shall not intentionally delete, alter, edit, or otherwise tamper with an undercover recording during the required 72-hour retention period.',
            'Undercover operations shall not be livestreamed or broadcast publicly in any manner. Detectives shall not stream an active undercover operation through Twitch, YouTube, Discord, or any other live-streaming platform.',
            'Undercover operation recordings, footage, screenshots, or other media obtained during an investigation shall not be posted or publicly shared on out-of-city social media platforms until the entirety of the associated investigation has concluded.',
            'This restriction applies regardless of whether the media appears to reveal the Detective’s identity, suspects, investigative methods, or other sensitive information. The purpose of this requirement is to prevent the premature disclosure of investigative activity or evidence.',
            'If a recording is lost, corrupted, or otherwise unavailable due to technical circumstances, the Detective shall notify CID Command as soon as reasonably possible and provide an explanation of the circumstances.',
          ],
        },
        {
          kind: 'links',
          items: [
            {
              to: '/undercover',
              label: 'Undercover Operations',
              hint: 'Log the session, confirm the recording and see the 72-hour retention deadline',
            },
          ],
        },
      ],
    },

    {
      anchor: 'identity',
      heading: '4. Undercover Identity and Anonymity',
      blurb: 'Who may be told, and who may not.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Detectives operating in an undercover capacity shall make reasonable efforts to maintain the confidentiality of their undercover identity.',
          ],
        },
        {
          kind: 'p',
          text: 'Undercover Detectives shall not disclose their undercover identity to uniformed law enforcement personnel unless that individual falls within one of the following authorized positions:',
        },
        {
          kind: 'ul',
          items: ['High Command;', 'CID Bureau Lead; or', 'CID Command.'],
        },
        {
          kind: 'ul',
          items: [
            'Detectives shall not unnecessarily disclose their undercover identity to other members of law enforcement, including patrol officers, deputies, or other personnel outside of CID.',
            'When an undercover Detective encounters uniformed law enforcement while actively operating undercover, the Detective should maintain their cover unless disclosure is necessary to prevent a significant operational or safety concern.',
            'CID personnel shall not intentionally compromise another Detective’s undercover identity.',
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: '**CID personnel shall not intentionally compromise another Detective’s undercover identity.** The portal enforces the same list: an undercover operation is visible only to the Detective running it, their Bureau Lead, CID Command and High Command.',
        },
      ],
    },

    {
      anchor: 'prohibited-conduct',
      heading: '5. Prohibited Conduct',
      blurb: 'Undercover status is not permission to commit crime.',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: '**Undercover status does not authorize a Detective to freely participate in criminal activity.**',
        },
        {
          kind: 'ul',
          items: [
            'Detectives operating undercover shall not knowingly participate in, commit, or facilitate violent or serious criminal offenses.',
          ],
        },
        {
          kind: 'p',
          text: 'This includes, but is not limited to:',
        },
        {
          kind: 'ul',
          items: [
            'Murder or attempted murder;',
            'Serious assault;',
            'Kidnapping;',
            'Torture;',
            'Hostage-taking;',
            'Serious weapons offenses;',
            'Acts of significant violence; or',
            'Other offenses determined by CID Command to constitute serious criminal conduct.',
          ],
        },
        {
          kind: 'ul',
          items: [
            'A Detective may maintain their cover through reasonable participation in minor or non-violent criminal activity when necessary for an investigation, provided the Detective does not unnecessarily escalate the situation or commit a serious offense.',
            'Detectives shall not use their undercover status as justification for criminal activity unrelated to the investigation.',
            'When there is uncertainty regarding whether conduct is permissible, the Detective should prioritize the preservation of life, the integrity of the investigation, and departmental policy.',
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: '**Detectives MUST notify their respective Bureau Lead and CID Command when they have participated in criminal activity of any kind. Detectives are required to submit their entire undercover session recording to CID Command.**',
        },
        {
          kind: 'links',
          items: [
            {
              to: '/undercover',
              label: 'Report criminal activity',
              hint: 'Records the notification to your Bureau Lead and CID Command, and the recording you submitted',
            },
          ],
        },
      ],
    },

    {
      anchor: 'authority',
      heading: '6. Use of Undercover Authority',
      blurb: 'Investigate criminal activity; do not create it.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Undercover Detectives shall not use their position as a law enforcement officer to unnecessarily influence, threaten, or manipulate suspects into committing crimes they otherwise would not have committed.',
            'Detectives should focus on gathering intelligence, developing evidence, identifying criminal activity, and establishing probable cause rather than unnecessarily escalating criminal activity.',
            'The primary objective of an undercover operation is to investigate criminal activity, not create unnecessary criminal activity.',
            'Detectives shall not use an undercover operation for personal benefit, retaliation, or any purpose unrelated to an authorized investigation.',
          ],
        },
      ],
    },

    {
      anchor: 'safety',
      heading: '7. Safety and Operational Integrity',
      blurb: 'Life first, cover second.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Detectives shall maintain awareness of their surroundings and prioritize their personal safety and the safety of civilians.',
            'If an undercover operation develops into a situation involving an immediate threat to life, the Detective may terminate or alter the operation as necessary.',
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: '**Detectives shall not allow preservation of their undercover identity to take priority over preventing an immediate threat to life.**',
        },
        {
          kind: 'ul',
          items: [
            'If an operation becomes compromised, the Detective should withdraw from the operation when reasonably possible and notify CID Command.',
            'Detectives shall provide accurate information regarding the operation when reporting to CID Command.',
            'Detectives shall not intentionally compromise an active investigation for the purpose of maintaining their undercover status.',
          ],
        },
        {
          kind: 'links',
          items: [
            {
              to: '/undercover',
              label: 'Mark an operation compromised',
              hint: 'Records the time, the circumstances, whether you withdrew and whether Command was notified',
            },
          ],
        },
      ],
    },

    {
      anchor: 'command-oversight',
      heading: '8. Command Oversight',
      blurb: 'What CID Command may do.',
      blocks: [
        {
          kind: 'p',
          text: 'CID Command retains authority over CID undercover operations and may:',
        },
        {
          kind: 'ul',
          items: [
            'Request recordings or other evidence from an operation;',
            'Require a Detective to terminate an undercover operation;',
            'Review the conduct of an undercover Detective;',
            'Establish additional restrictions or requirements for a specific operation;',
            'Investigate alleged violations of this procedure;',
            'Restrict or suspend a Detective’s ability to conduct future undercover operations; or',
            'Refer matters to High Command for further review when appropriate.',
          ],
        },
        {
          kind: 'p',
          text: 'Nothing within this procedure prevents CID Command or High Command from establishing additional requirements for a specific investigation when circumstances warrant.',
        },
      ],
    },

    {
      anchor: 'violations',
      heading: '9. Violations and Accountability',
      blurb: 'Undercover status is not immunity.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Failure to comply with this procedure may result in disciplinary action, removal from undercover duties, or further review by CID Command and/or High Command.',
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: '**Undercover status does not provide a Detective with immunity from criminal liability.** Detectives remain subject to all applicable laws and departmental regulations while operating undercover.',
        },
        {
          kind: 'ul',
          items: [
            'Depending on the nature and severity of the Detective’s misconduct, a Detective may be subject to criminal charges in addition to departmental disciplinary action.',
            'Intentional participation in serious criminal offenses, abuse of undercover authority, intentional destruction or concealment of required recordings, unauthorized disclosure of another Detective’s undercover identity, or other significant misconduct may result in referral for criminal investigation and prosecution.',
            'Claiming that an action was performed while undercover shall not, by itself, exempt a Detective from criminal or administrative accountability. The circumstances, necessity, intent, and severity of the conduct may be considered when determining appropriate action.',
          ],
        },
      ],
    },

    {
      anchor: 'final-standard',
      heading: '10. Final Standard',
      blurb: 'Discretion, professionalism, and trust.',
      blocks: [
        {
          kind: 'p',
          text: 'Undercover operations require discretion, professionalism, and trust.',
        },
        {
          kind: 'p',
          text: 'Detectives are expected to protect their identity, preserve evidence, maintain the integrity of investigations, and operate within the boundaries established by this procedure.',
        },
        {
          kind: 'p',
          text: 'Being undercover does not remove a Detective’s responsibility to uphold the standards of the department or the law.',
        },
        {
          kind: 'p',
          text: 'The authority to operate undercover is a privilege granted for legitimate investigative purposes and shall not be abused.',
        },
        {
          kind: 'p',
          text: '**Director Jack Crow**',
        },
      ],
    },
  ],
}
