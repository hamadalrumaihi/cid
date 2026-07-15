/** Canonical case deep-link builder — the single place the
 *  `/cases?case=&tab=&report=&task=&evidence=` convention is spelled out.
 *  The case shell reads `case`/`tab`; the Reports, Tasks and Evidence tabs
 *  read their record params and open/highlight the referenced row. Param
 *  order is stable (case → tab → report → task → evidence) so links are
 *  comparable and copy/paste-diff friendly. */
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
