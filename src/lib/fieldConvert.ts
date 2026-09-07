/** Convert a claim into a registry record — the client mirror of
 *  `field_submission_convert` (P6-04, decision IT8).
 *
 *  A reviewer who has decided a claim describes somebody CID does not hold yet
 *  used to leave the record, open the registry, retype the claim, and come back
 *  to link it. This is that trip in one call: the server creates the record
 *  with `source_submission_id` pointing home, links the claim, audits both, and
 *  answers with the id. Nothing is created without a reviewer asking — the
 *  create sheet is still the form, this is only its save path.
 *
 *  The server does the duplicate check (`entity_duplicates`) and answers
 *  `duplicate` rather than raising, because the sheet's whole design is
 *  EA1 never hard-block, EA10 reuse by default: the panel offers the existing
 *  record first, and "create anyway" carries a reason the server appends to
 *  the new record's notes.
 */

import { rpc } from './db'
import type { Json } from './database.types'
import type { DuplicateRow, MergeKind } from './entity'
import type { ClaimKind } from './fieldReview'
import { humanizeError } from './toast'

export type ConvertResult =
  | { ok: true; id: string; kind: MergeKind }
  | { ok: false; code: 'duplicate'; matches: DuplicateRow[] }
  | { ok: false; code: string; message: string }

/** Where a converted record lives, for the deep link the sheet opens after
 *  saving (`/tools?tool=<registry>&record=<id>` — the existing convention). */
export const REGISTRY_TOOL: Record<MergeKind, 'persons' | 'vehicles' | 'gangs' | 'places' | 'accounts' | 'narcotics'> = {
  person: 'persons', vehicle: 'vehicles', gang: 'gangs', place: 'places', account: 'accounts', narcotic: 'narcotics',
}

export function registryHref(kind: MergeKind, id: string): string {
  return `/tools?tool=${REGISTRY_TOOL[kind]}&record=${encodeURIComponent(id)}`
}

/** The server's `matches` carry no strength — anything it bothered to answer
 *  with is a strong match, or it would have created the record. */
function toDuplicates(v: unknown): DuplicateRow[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((m) => {
    if (!m || typeof m !== 'object') return []
    const r = m as Record<string, unknown>
    if (typeof r.id !== 'string') return []
    return [{
      id: r.id,
      label: typeof r.label === 'string' ? r.label : r.id,
      sublabel: typeof r.sublabel === 'string' ? r.sublabel : null,
      signal: typeof r.signal === 'string' ? r.signal : 'name',
      strength: 'strong' as const,
      score: 1,
    }]
  })
}

export function parseConvert(data: unknown, kind: MergeKind): ConvertResult {
  if (!data || typeof data !== 'object') return { ok: false, code: 'unexpected', message: 'No answer came back from the server.' }
  const d = data as Record<string, unknown>
  if (d.ok === true && typeof d.id === 'string') return { ok: true, id: d.id, kind }
  const code = typeof d.code === 'string' ? d.code : 'unexpected'
  if (code === 'duplicate') return { ok: false, code, matches: toDuplicates(d.matches) }
  const message = typeof d.message === 'string' ? d.message : 'The record was not created.'
  return { ok: false, code, message: code === 'denied' ? humanizeError(message) : message }
}

/** Create `kind` from the claim, with `payload` = the create sheet's values
 *  (CREATE_FIELDS keys only — the server refuses anything else). `reason` is
 *  the "create anyway" override that turns a duplicate answer into a record. */
export async function convertClaim(
  kind: MergeKind, claimKind: ClaimKind, claimId: string,
  payload: Record<string, string>, reason?: string,
): Promise<ConvertResult> {
  const res = await rpc('field_submission_convert', {
    p_kind: kind, p_claim_kind: claimKind, p_claim: claimId,
    p_payload: payload as Json, p_reason: reason?.trim() || undefined,
  })
  // A RAISE (validation wording, "that report has not been sent yet" …) is
  // the server's sentence; an authority refusal comes back as {ok:false}.
  if (res.error) return { ok: false, code: 'error', message: humanizeError(res.error.message) }
  return parseConvert(res.data, kind)
}
