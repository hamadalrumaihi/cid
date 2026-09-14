/** What each shared registry is FOR — the sentence a detective needs before
 *  they add a row to it.
 *
 *  Persons, vehicles, gangs and places explain themselves: an investigator
 *  knows what a person record is. Accounts and Indicators do not. "Indicator"
 *  is analyst vocabulary, and "Account" reads like a portal login rather than
 *  a suspect's Birdy handle — so both registries collect the wrong things,
 *  get used as a notes field, or sit empty because nobody is sure what belongs
 *  in them.
 *
 *  Each entry says the same three things in the same order: what this registry
 *  holds, what does NOT belong in it, and what the division gets out of it.
 *  The copy lives here rather than in the views so the guide, the registry and
 *  the tests all read one source. */
export interface RegistryPurpose {
  /** One line: what this registry holds. */
  holds: string
  /** What belongs somewhere else — the half that stops misuse. */
  notHere: string
  /** Why the division keeps it: what the registry does that a note cannot. */
  payoff: string
  /** The Guide Library slug that explains it at length. Pinned against the
   *  real registry in the test — a slug that stops existing is a dead link. */
  guide: string
  /** The anchor inside that guide. */
  anchor: string
}

export const REGISTRY_PURPOSE: Record<'accounts' | 'indicators', RegistryPurpose> = {
  accounts: {
    holds: 'Online identities a subject uses — a Birdy or InstaPic handle, the platform it lives on, who is believed to be behind it, and every handle it has worn.',
    notHere: 'Not portal logins, and not a person: the human being is a Person record, and this is the account they post from. A phone number or an email address is an Indicator.',
    payoff: 'A handle that changes stays one record with its history, and ownership is a claim with a confidence — suspected, probable or confirmed — rather than a sentence buried in a report.',
    guide: 'entities-organizations',
    anchor: 'accounts',
  },
  indicators: {
    holds: 'Hard identifiers seen in a case — phone numbers, account names, serial numbers, aliases and addresses — logged as the value itself.',
    notHere: 'Not observations or narrative. "Seen driving a black Sultan" is a note; the plate is the indicator.',
    payoff: 'The same value logged on two cases raises a cross-case match automatically, which is how two investigations discover they are one.',
    guide: 'entities-organizations',
    anchor: 'aliases',
  },
}
