/** Canonical case deep-link builder — the single place the
 *  `/cases?case=&tab=&report=&task=&evidence=` convention is spelled out.
 *  The case shell reads `case`/`tab`; the Reports, Tasks and Photos & Media
 *  tabs read their record params and open/highlight the referenced row
 *  (`evidence=` highlights a frozen legacy-evidence line). Param order is
 *  stable (case → tab → report → task → evidence) so links are comparable
 *  and copy/paste-diff friendly. */
export function caseLink(
  caseId: string,
  tab?: string,
  opts: { report?: string; task?: string; evidence?: string } = {},
): string {
  const enc = encodeURIComponent
  let url = `/cases?case=${enc(caseId)}`
  if (tab) url += `&tab=${enc(tab)}`
  if (opts.report) url += `&report=${enc(opts.report)}`
  if (opts.task) url += `&task=${enc(opts.task)}`
  if (opts.evidence) url += `&evidence=${enc(opts.evidence)}`
  return url
}

/** Legacy → current tab id mapping. The Evidence tab became Photos & Media
 *  (`media`) — saved links, notifications and search results that still say
 *  `?tab=evidence` must keep landing somewhere sensible forever. Resolvers
 *  call this before validating against the live tab list; generators emit the
 *  current ids only. */
const LEGACY_CASE_TABS: Record<string, string> = { evidence: 'media' }

export function normalizeCaseTab(tab: string | null | undefined): string | null {
  if (!tab) return null
  return LEGACY_CASE_TABS[tab] ?? tab
}
