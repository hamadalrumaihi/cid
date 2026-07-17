'use client'

/** Shared plumbing for the legal-request dossier sections: the section id
 *  vocabulary (`?section=` deep links), the label/value Row, the creator's
 *  draft shape + localStorage-stash sanitiser, and the case-scoped source
 *  records used by the packet picker and the pre-submission preview. All of it
 *  is presentation support — RLS + the definer RPCs stay the authority. */
import { useEffect, useState } from 'react'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import type { LegalExhibit, LegalRequest } from '@/lib/justice'

export type ActionRow = Pick<Tables<'legal_request_actions'>,
  'id' | 'legal_request_id' | 'version_id' | 'actor_id' | 'action' | 'from_status' | 'to_status' | 'public_note' | 'created_at'>

/* ── Section vocabulary (deep-linkable via ?section=) ─────────────────────── */
export const DOSSIER_SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'request', label: 'Request' },
  { id: 'supporting', label: 'Supporting' },
  { id: 'review', label: 'Review' },
  { id: 'decision', label: 'Decision' },
  { id: 'service', label: 'Service & Return' },
  { id: 'activity', label: 'Activity' },
] as const
export type DossierSectionId = (typeof DOSSIER_SECTIONS)[number]['id']

export function sectionFromParam(v: string | null): DossierSectionId {
  return DOSSIER_SECTIONS.some((s) => s.id === v) ? (v as DossierSectionId) : 'summary'
}

/* ── Label/value row ──────────────────────────────────────────────────────── */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-xs font-semibold text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-200">{children}</span>
    </div>
  )
}

/* ── Creator draft state ──────────────────────────────────────────────────── */
/** The creator's editable working copy — also the shape stashed under the
 *  never-lose-work draft key `legal:edit:<request id>`. */
export interface DraftShape {
  title: string; priority: string; narrative: string
  classification: string; form: Record<string, string>
}
/** localStorage is user-editable — coerce a recovered stash back into the
 *  exact controlled-input shape so a stale/malformed one can't break the form. */
export function sanitizeStash(d: Partial<DraftShape> | null | undefined, fallbackClassification: string): DraftShape {
  return {
    title: typeof d?.title === 'string' ? d.title : '',
    priority: typeof d?.priority === 'string' ? d.priority : '',
    narrative: typeof d?.narrative === 'string' ? d.narrative : '',
    classification: typeof d?.classification === 'string' && d.classification ? d.classification : fallbackClassification,
    form: (d?.form && typeof d.form === 'object' && !Array.isArray(d.form))
      ? Object.fromEntries(Object.entries(d.form).map(([k, v]) => [k, String(v ?? '')]))
      : {},
  }
}

/* ── Case-scoped source records ───────────────────────────────────────────── */
/** Case-scoped source records for the packet picker AND the pre-submission
 *  preview (which cross-checks each exhibit against them). RLS-scoped reads
 *  over the SAME canonical tables used elsewhere in the portal. */
export interface CaseRecords {
  evidence: Tables<'evidence'>[]
  files: Tables<'case_files'>[]
  reports: Tables<'reports'>[]
  media: Tables<'media'>[]
}
export function useCaseRecords(r: LegalRequest | null, enabled: boolean): CaseRecords | null {
  const [records, setRecords] = useState<CaseRecords | null>(null)
  const caseId = r?.case_id ?? null
  const caseNumber = r?.case_number_snapshot ?? null
  useEffect(() => {
    if (!caseId || !enabled) return
    let cancelled = false
    void (async () => {
      try {
        const [ev, rp, md] = await Promise.all([
          list('evidence', { eq: { case_id: caseId } }),
          // ALL case reports (not just finalized) so the preview can tell
          // "no longer finalized" apart from "missing"; the picker filters.
          list('reports', { eq: { case_id: caseId } }),
          list('media', { eq: { case_id: caseId } }),
        ])
        const fl = caseNumber ? await list('case_files', { eq: { case_number: caseNumber } }) : []
        if (!cancelled) setRecords({ evidence: ev, files: fl, reports: rp, media: md })
      } catch { /* case records simply unavailable */ }
    })()
    return () => { cancelled = true }
  }, [caseId, caseNumber, enabled])
  return records
}

/** Cross-check one selected exhibit against the live case records — flags a
 *  broken source or a report that lost its finalized state before submission. */
export function exhibitFlag(e: LegalExhibit, rec: CaseRecords | null): string | null {
  if (!rec || !e.source_id) return null
  switch (e.exhibit_type) {
    case 'evidence':
      return rec.evidence.some((x) => x.id === e.source_id) ? null : 'source evidence record no longer found'
    case 'attachment':
      return rec.files.some((x) => x.id === e.source_id) ? null : 'source file no longer found'
    case 'finalized_report': {
      const rep = rec.reports.find((x) => x.id === e.source_id)
      if (!rep) return 'source report no longer found'
      return rep.finalized ? null : 'report is no longer finalized'
    }
    case 'case_media':
      return rec.media.some((x) => x.id === e.source_id) ? null : 'source media no longer found'
    default:
      return null
  }
}
