/** Phase 4 dossier helpers that sit between the legal model and the surfaces.
 *
 *  `buildLegalViewer` — the contract's three-argument form (no prosecutor
 *  bureaus, retired by L1/L16). legalShared still carries the legacy
 *  four-argument builder while the model owner swaps it; this wrapper keeps
 *  every dossier/wizard call site on the new shape so the switch is a
 *  one-line import change. `legalSubmitChecklist` is the pre-submission
 *  checklist both the dossier editor's preview and the wizard's review step
 *  render — a mirror of submit_legal_request_to_cid, never authority. */
import type { useAuth } from '@/lib/auth'
import { SUBPOENA_FIELDS, WARRANT_FIELDS, isStandardOfProof, type SubpoenaType, type WarrantType } from '@/lib/justice'
import type { LegalViewer } from '@/lib/legalWorkflow'
import { buildLegalViewer as buildLegalViewerLegacy } from '../legalShared'

export function buildLegalViewer(
  auth: ReturnType<typeof useAuth>,
  justiceRole?: 'prosecutor' | 'attorney_general' | 'judge' | null,
  siuIsCommand = false,
): LegalViewer {
  return buildLegalViewerLegacy(auth, [], justiceRole, siuIsCommand)
}

export interface ChecklistItem { label: string; ok: boolean; blocking: boolean }

/** Submission requirements (server mirror; the RPC re-checks all of it):
 *  title + justification; warrants add priority, a standard of proof and a
 *  probable-cause statement (P4-04) plus their required detail fields;
 *  subpoenas their required detail fields. The packet row is advisory —
 *  the reviewer can record an override for an empty packet. */
export function legalSubmitChecklist(input: {
  requestType: string; subtype: string | null
  title: string; narrative: string; priority: string; form: Record<string, string>
  exhibitCount: number
}): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { label: 'Title', ok: !!input.title.trim(), blocking: true },
    { label: 'Description / justification', ok: !!input.narrative.trim(), blocking: true },
  ]
  if (input.requestType === 'warrant') {
    items.push({ label: 'Priority', ok: !!input.priority, blocking: true })
    items.push({ label: 'Standard of proof', ok: isStandardOfProof(input.form.standard_of_proof ?? ''), blocking: true })
    items.push({ label: 'Probable-cause statement', ok: !!String(input.form.pc_statement ?? '').trim(), blocking: true })
    for (const f of (WARRANT_FIELDS[input.subtype as WarrantType] ?? []).filter((x) => x.req)) {
      items.push({ label: f.label, ok: !!String(input.form[f.key] ?? '').trim(), blocking: true })
    }
  } else {
    for (const f of (SUBPOENA_FIELDS[input.subtype as SubpoenaType] ?? []).filter((x) => x.req)) {
      items.push({ label: f.label, ok: !!String(input.form[f.key] ?? '').trim(), blocking: true })
    }
  }
  items.push({ label: 'At least one supporting item selected', ok: input.exhibitCount > 0, blocking: false })
  return items
}

/** Exhibit types that are per-target scope rows for a judge's partial
 *  approval (contract §4 legal_request_target_decisions). */
export const TARGET_EXHIBIT_TYPES: ReadonlySet<string> = new Set(['person_record', 'vehicle', 'place', 'evidence', 'case_media'])
