/** Entities and Organizations Guide.
 *
 *  Written from the registry surface: the shared tools in lib/toolsModel.ts,
 *  the relationship states and pickers, the duplicate warnings, the merge
 *  ledger, and the association workflow from
 *  20261106120000_org_associations_registry_intel.sql — whose central rule
 *  ("an observation is not a finding") is the reason the last section exists
 *  and is worded the way it is. */
import type { GuideDoc } from '../guideDoc'

export const ENTITIES_DOC: GuideDoc = {
  sections: [
    {
      anchor: 'people',
      heading: 'People',
      blurb: 'The person record, and what hangs off it.',
      blocks: [
        {
          kind: 'p',
          text: 'A person profile carries identity, warrants, vehicles, properties, linked cases, media and notes, and can be exported as a dossier. The **BOLO Board** is fed by approved arrest warrants and BOLO flags, so a person at large appears there without anyone retyping them.',
        },
        {
          kind: 'ul',
          items: [
            'A person opens as **its own tab** in the registry workspace, so two profiles can sit side by side.',
            '**Pin** a profile to keep it in your Jump back in strip; **follow** it to be told when it changes.',
            'Reports that name a person list themselves on the profile, because a report remembers every record it inserted or mentioned.',
          ],
        },
        {
          kind: 'note',
          text: 'A person who is a confidential source is an ordinary person here — nothing on the profile says so, and nothing should. That belongs in the informant compartment and nowhere else.',
        },
      ],
    },

    {
      anchor: 'vehicles',
      heading: 'Vehicles',
      blurb: 'Plates, owners and the cross-case signal.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'A vehicle carries its plate, owners and organization ties, and lists its **linked people**.',
            'Plate matching ignores dashes and spacing, so `AB-123` finds `AB123` — search with whichever you have.',
            'The registry flags plates that surface across more than one case.',
          ],
        },
      ],
    },

    {
      anchor: 'organizations',
      heading: 'Gangs and Organizations',
      blurb: 'The dossier, its people, its property and its ties.',
      blocks: [
        {
          kind: 'p',
          text: 'An organization dossier holds its ranks, members, properties and turf, and lists its **accounts** and **narcotics** ties. Everything on it is a link to a record that exists in its own right, not a copy of it.',
        },
        {
          kind: 'ul',
          items: [
            'Membership, turf and property are relationships and carry their own state — see **Confirmed and Unconfirmed Relationships** below.',
            'A photograph attached to a dossier — a tag, a mural, a shopfront, a patch — is **intelligence, not evidence**: no evidence number, no custody chain, and it cannot be turned into evidence later.',
            'Attaching a second photograph adds to the record; it never replaces the first.',
          ],
        },
      ],
    },

    {
      anchor: 'places',
      heading: 'Places',
      blurb: 'Locations, and who is said to control them.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'A place record holds the location and any production processes recorded against it.',
            'A place can be linked to people and to organizations. Linking an organization to a place is **not** the same as saying it controls the place — a control claim is a specific, separate statement.',
            'Where two organizations both turn up at one property, record an association between them rather than guessing which one is in charge.',
          ],
        },
      ],
    },

    {
      anchor: 'narcotics',
      heading: 'Narcotics',
      blurb: 'Substances, analytics and restriction.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'The narcotics registry holds substances with their processing and market analytics.',
            'A substance can be **restricted**. Restriction is live: a substance restricted after a photograph was attached takes that photograph out of view too, rather than leaving it readable because of when it was uploaded.',
            'A claim from an intelligence submission can be matched to a narcotic, an account or a case indicator — not only to a person, vehicle, organization or place.',
          ],
        },
      ],
    },

    {
      anchor: 'aliases',
      heading: 'Aliases and Identifiers',
      blurb: 'The values that tie records together across cases.',
      blocks: [
        {
          kind: 'ul',
          items: [
            '**Indicators** hold burner phones, bank accounts, serials, aliases and addresses.',
            'The same indicator value appearing on two cases raises a **deconfliction alert** naming both. A case you cannot access shows as restricted — coordinate through its bureau lead rather than trying another route in.',
            '**Accounts** hold social-media and online accounts with their handle history and ownership, and list their surveillance history.',
            'Aliases belong on the record they describe. An alias typed only into a narrative cannot deconflict against anything.',
          ],
        },
      ],
    },

    {
      anchor: 'linking-to-cases',
      heading: 'Linking Entities to Cases',
      blurb: 'One picker, and an explicit choice about where information lives.',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Link from the case', text: 'A case has tabs for its people, vehicles, organizations and locations. Linking opens a search picker over the registry — type a few letters and pick.' },
            { title: 'Confirm what you are attaching', text: 'Picking a suggestion confirms it with a registry profile panel: the key details, plus a jump to the full profile.' },
            { title: 'Decide where new details go', text: 'If you know something the profile is missing, the panel offers it — and asks explicitly where it belongs. **Add to link note** writes clearly-labelled lines into this case only. **Update person profile** fills fields that are *empty* on the profile, after a confirmation naming the exact fields.' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'An existing profile value is **never** overwritten by this route, and a profile update is audited like any other edit. If a profile value is wrong, correct it on the profile deliberately — do not route it through a case link.',
        },
      ],
    },

    {
      anchor: 'duplicates',
      heading: 'Duplicate Detection',
      blurb: 'A warning, not a block.',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Creating a person, organization, place or vehicle shows an inline warning when a similar record already exists — plates match even when dashes or spacing differ.',
            'The warning carries **peek** buttons so you can check the candidates without leaving the form.',
            'It never blocks you. You decide, because only you know whether the two are the same thing.',
            'If they are the same, link to the existing record instead of creating a second one — the picker’s **Use existing record** does exactly that.',
          ],
        },
      ],
    },

    {
      anchor: 'merging',
      heading: 'Merging',
      blurb: 'Folding one record into another, and undoing it.',
      blocks: [
        {
          kind: 'p',
          text: 'When two records turn out to be the same thing, a **merge** folds one into the other: the survivor keeps the identity, and everything that pointed at the record that goes now points at the survivor — links, cases, media and associations alike.',
        },
        {
          kind: 'ul',
          items: [
            'A merge is previewed before it runs, so you see what will move.',
            'Every merge is recorded in a ledger with who did it and when, and it can be **reversed**.',
            'A record merged away stays visible in pickers marked with the reason and cannot be selected — so an old link never silently resolves to the wrong record.',
          ],
        },
        {
          kind: 'note',
          text: 'Merging is not the same as recording an association. A merge says *these are one thing*; an association says *these two things are connected*. Choosing the wrong one destroys information that is hard to get back.',
        },
      ],
    },

    {
      anchor: 'relationships',
      heading: 'Confirmed and Unconfirmed Relationships',
      blurb: 'Recording an observation without turning it into a finding.',
      blocks: [
        {
          kind: 'p',
          text: 'Every relationship in the registries — person to person, person to vehicle, person to place, organization turf and property, organization to account, organization to narcotic, account ownership — has an **Edit** control. Change its confidence, its role or its note, or mark it **Current**, **Historical** or **Disputed** as the picture develops. A relationship that ended is marked historical, not deleted, so the record keeps its history.',
        },
        {
          kind: 'p',
          text: 'Between two organizations, or between an organization and a property, the same idea is recorded as an **association** on either dossier. You pick the other record, the claim and a note.',
        },
        {
          kind: 'table',
          head: ['Step', 'What it means'],
          rows: [
            ['Record it', 'The row always starts at **Pending Investigation**. Recording it says you saw something, not that it is true.'],
            ['Unconfirmed Association', 'All you have is that the two are somehow connected. It never means allies, merged, or under one command.'],
            ['Confirm / Reject / Mark historical', 'Anyone who can see both records rules on it, with a reason, and may correct the claim at the same time.'],
            ['Reopen', 'Puts it back to pending and clears the decision trail.'],
          ],
        },
        {
          kind: 'ul',
          items: [
            'The person who recorded it is shown as the **submitter**. That is not the same as being assigned to investigate it.',
            'Only the author or command may amend or withdraw a row — but **withdrawing says it should never have been recorded**. If you considered it and decided against it, **Reject** it instead so the reasoning stays on the record.',
            'Recording the same association twice, in either direction, shows you the row that is already there. Nothing is duplicated and nothing you wrote is overwritten.',
            'Reading follows **both** records: an association never reveals a record you could not otherwise see.',
          ],
        },
        {
          kind: 'links',
          items: [
            { to: '/guides/case-management', label: 'Case Management Guide' },
            { to: '/guides/reports-evidence', label: 'Reports and Evidence Guide' },
          ],
        },
      ],
    },
  ],
}
