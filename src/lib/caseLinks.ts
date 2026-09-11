/** Canonical case deep-link builder — the single place the
 *  `/cases?case=&tab=&report=&task=&evidence=&media=&page=&packet=` convention is spelled out.
 *  The case shell reads `case`/`tab`; the Reports, Tasks and Photos & Media
 *  tabs read their record params and open/highlight the referenced row
 *  (`evidence=` highlights a frozen legacy-evidence line). Param order is
 *  stable (case → tab → report → task → evidence) so links are comparable
 *  and copy/paste-diff friendly. */
export function caseLink(
  caseId: string,
  tab?: string,
  opts: {
    report?: string; task?: string; evidence?: string
    /** Platform upgrade: a media row (Evidence & Media / Documents tab), a
     *  document page (`page` rides only with `media`) and a case packet
     *  (Documents tab). Appended AFTER the historical params so every
     *  existing link is byte-identical. */
    media?: string; page?: number | string; packet?: string
  } = {},
): string {
  const enc = encodeURIComponent
  let url = `/cases?case=${enc(caseId)}`
  if (tab) url += `&tab=${enc(tab)}`
  if (opts.report) url += `&report=${enc(opts.report)}`
  if (opts.task) url += `&task=${enc(opts.task)}`
  if (opts.evidence) url += `&evidence=${enc(opts.evidence)}`
  if (opts.media) {
    url += `&media=${enc(opts.media)}`
    if (opts.page !== undefined && opts.page !== null && String(opts.page) !== '') url += `&page=${enc(String(opts.page))}`
  }
  if (opts.packet) url += `&packet=${enc(opts.packet)}`
  return url
}

/** Legacy → current tab id mapping. The old Evidence tab became `media`
 *  (labelled "Evidence" again since Phase 3, id unchanged) — saved links,
 *  notifications and search results that still say `?tab=evidence` must keep
 *  landing somewhere sensible forever. `?tab=notes` needs no entry any more:
 *  the Notes section exists again under its own id. Resolvers call this
 *  before validating against the live tab list; generators emit the current
 *  ids only. */
const LEGACY_CASE_TABS: Record<string, string> = {
  evidence: 'media',
  // Platform upgrade: the Documents tab (packets, document tools). Both short
  // forms appear in early notification payloads and hand-typed links.
  packets: 'documents',
  docs: 'documents',
}

export function normalizeCaseTab(tab: string | null | undefined): string | null {
  if (!tab) return null
  return LEGACY_CASE_TABS[tab] ?? tab
}
