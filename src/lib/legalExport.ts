/** Legal instrument / court-packet export specs (P4-11, decision L15).
 *
 *  Pure spec builders — no React, no db, no clock. They turn the rows a
 *  viewer ALREADY holds (RLS returned them) into the document spec that
 *  lib/pdf renders and the paragraph list lib/docx writes, so the PDF, the
 *  DOCX and the on-screen court-packet print sheet can never disagree about
 *  what an approved instrument says.
 *
 *  Two documents:
 *   · instrument — the approved (or partially approved) authorisation: the
 *     decision, the scope the judge froze (per-target decisions), the
 *     charges, the conditions, the basis (standard of proof + probable-cause
 *     statement + justification), the version-bound signatures and the
 *     judge's signature block;
 *   · packet — everything the reviewers saw: particulars, narrative, charges,
 *     the exhibit manifest and the timeline.
 *
 *  Restricted media: the viewer only ever receives media rows RLS let them
 *  read, so a restricted item that IS present renders by title only (never a
 *  URL), and an exhibit whose source the caller flags as restricted is
 *  skipped from the manifest with a count of omitted items — the packet must
 *  never leak a title the viewer could not open in the case.
 *
 *  Verification: `legal_record_export` returns the code (a short hash of the
 *  version id + request id) and audits the export; the caller passes it in.
 *  A null verification means a screen copy that was NOT recorded (the print
 *  sheet) and the document says so. */
import type { DocxPara } from './docx'
import { fmtDateTime } from './format'
import type { Tables } from './database.types'
import type { PdfDocSpec, PdfSection } from './pdf'
import { justiceRoleLabel } from './justice'
import { bureauLabel } from './roles'
import { safeUrl } from './safeUrl'
import { parseLegalFormEntries, parsePacketManifest } from './schemas'

type LegalRequest = Tables<'legal_requests'>
type LegalVersion = Tables<'legal_request_versions'>
type LegalSignature = Tables<'legal_request_signatures'>
type LegalExhibit = Tables<'legal_request_exhibits'>
export type LegalChargeRow = Pick<Tables<'legal_request_charges'>,
  'id' | 'case_charge_id' | 'snap_code' | 'snap_offense' | 'snap_charge_class' | 'snap_penal_title' | 'counts'>
export type TargetDecisionRow = Pick<Tables<'legal_request_target_decisions'>,
  'id' | 'target_key' | 'exhibit_id' | 'decision' | 'reasoning' | 'decided_by' | 'decided_at'>
export type TimelineRow = Pick<Tables<'legal_request_actions'>,
  'id' | 'actor_id' | 'action' | 'from_status' | 'to_status' | 'public_note' | 'created_at'>

export interface ExportVerification {
  /** legal_export_log.verification_code */
  code: string
  /** ISO timestamp the export was recorded. */
  exportedAt: string
  format: 'pdf' | 'docx'
}

export interface LegalExportOptions {
  /** id → display name (people are resolved by the caller under RLS). */
  name?: (id: string | null | undefined) => string
  /** Exhibits whose source the viewer must not see beyond the fact one was
   *  omitted (restricted media without break-glass). */
  restrictedSourceIds?: ReadonlySet<string>
  /** Status labels (L5) — injected so the builder never imports the model. */
  statusLabel?: (s: string | null | undefined) => string
  fulfilmentLabel?: (s: string | null | undefined) => string
}

const humanize = (s: string | null | undefined): string =>
  s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : ''
const dash = (v: string | null | undefined): string => (v && v.trim()) || '—'
const defaultName = (id: string | null | undefined): string => (id ? 'Member' : '—')

const STANDARD_LABEL: Record<string, string> = {
  probable_cause: 'Probable cause',
  reasonable_suspicion: 'Reasonable suspicion',
}
export const standardOfProofLabel = (v: unknown): string =>
  (typeof v === 'string' && STANDARD_LABEL[v]) || (typeof v === 'string' && v ? humanize(v) : '—')

/** Media-backed exhibit types render by title only — never a URL. */
const MEDIA_TYPES = new Set(['case_media'])

function formValue(v: LegalVersion | null, key: string): string {
  const fd = v?.form_data
  if (!fd || typeof fd !== 'object' || Array.isArray(fd)) return ''
  const raw = (fd as Record<string, unknown>)[key]
  return typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
}

function target(r: LegalRequest): string {
  if (r.request_type === 'subpoena' && r.recipient_type === 'entity') return dash(r.recipient_name)
  return dash(r.person_name_snapshot ?? r.recipient_name)
}

/** The frozen per-target scope as table rows. A target key of `subject`
 *  names the request's person; `exhibit:<id>` names an exhibit row. */
export function targetDecisionRows(
  decisions: readonly TargetDecisionRow[],
  r: LegalRequest,
  exhibits: readonly LegalExhibit[],
): string[][] {
  return decisions.map((d) => {
    const label = d.target_key === 'subject'
      ? `Subject — ${target(r)}`
      : (() => {
          const ex = exhibits.find((e) => e.id === d.exhibit_id || `exhibit:${e.id}` === d.target_key)
          return ex ? `${humanize(ex.exhibit_type)} — ${ex.display_title}` : d.target_key
        })()
    return [label, d.decision === 'approved' ? 'Approved' : 'Denied', dash(d.reasoning)]
  })
}

export function chargeRows(charges: readonly LegalChargeRow[]): string[][] {
  return charges.map((c) => [
    dash(c.snap_code), c.snap_offense, c.snap_charge_class, String(c.counts), dash(c.snap_penal_title),
  ])
}

function signatureRows(
  signatures: readonly LegalSignature[],
  versions: readonly Pick<LegalVersion, 'id' | 'version_number'>[],
): string[][] {
  return signatures.map((s) => [
    s.signer_name_snapshot,
    justiceRoleLabel(s.signer_role_snapshot),
    humanize(s.action),
    `v${versions.find((v) => v.id === s.version_id)?.version_number ?? '?'}`,
    fmtDateTime(s.signed_at),
  ])
}

function verificationSection(verification: ExportVerification | null, version: LegalVersion | null): PdfSection {
  return {
    title: 'Verification',
    paras: verification
      ? [
          `Verification code ${verification.code} — recorded ${verification.format.toUpperCase()} export at ${fmtDateTime(verification.exportedAt)} of version v${version?.version_number ?? '?'}.`,
          'Present this code with the document; the portal export log confirms the version it was produced from.',
        ]
      : ['Screen copy — not a recorded export. Use Export PDF or Export DOCX for a copy with a verification code.'],
  }
}

function judgeSignatureParas(r: LegalRequest, signatures: readonly LegalSignature[], name: LegalExportOptions['name'] & object): string[] {
  const judgeSig = [...signatures].reverse().find((s) => /judge/i.test(s.signer_role_snapshot ?? '') || /approve|deny|decide|partial/i.test(s.action))
  const judgeName = judgeSig?.signer_name_snapshot ?? (r.decided_by ? name(r.decided_by) : '—')
  return [
    `Signed: ${judgeName}${judgeSig ? ` (${justiceRoleLabel(judgeSig.signer_role_snapshot)})` : ''}`,
    `Decided ${r.decided_at ? fmtDateTime(r.decided_at) : '—'} · Decision: ${humanize(r.decision ?? r.review_status)}`,
  ]
}

/* ── Instrument ───────────────────────────────────────────────────────────── */
export function legalInstrumentSpec(
  r: LegalRequest,
  version: LegalVersion | null,
  charges: readonly LegalChargeRow[],
  targetDecisions: readonly TargetDecisionRow[],
  signatures: readonly LegalSignature[],
  verification: ExportVerification | null,
  opts: LegalExportOptions & { exhibits?: readonly LegalExhibit[]; versions?: readonly Pick<LegalVersion, 'id' | 'version_number'>[] } = {},
): PdfDocSpec {
  const name = opts.name ?? defaultName
  const statusLabel = opts.statusLabel ?? humanize
  const exhibits = opts.exhibits ?? []
  const versions = opts.versions ?? (version ? [version] : [])
  const warrant = r.request_type === 'warrant'
  const partial = r.review_status === 'partially_approved'
  const sections: PdfSection[] = [
    {
      title: 'Authorisation',
      paras: [
        `${humanize(r.subtype)} ${partial ? 'PARTIALLY APPROVED' : 'APPROVED'} by ${name(r.decided_by)}${r.decided_at ? ` on ${fmtDateTime(r.decided_at)}` : ''}.`,
        ...(r.decision_note ? [`Reasoning: ${r.decision_note}`] : []),
        ...(r.judicial_conditions ? [`Conditions: ${r.judicial_conditions}`] : []),
        ...(r.expires_at ? [`Expires: ${fmtDateTime(r.expires_at)}`] : []),
        ...(r.response_deadline ? [`Response deadline: ${fmtDateTime(r.response_deadline)}`] : []),
      ],
    },
  ]
  if (targetDecisions.length) {
    sections.push({
      title: partial ? 'Scope — approved and denied targets' : 'Scope',
      headers: ['Target', 'Decision', 'Reasoning'], widths: [2, 1, 2],
      rows: targetDecisionRows(targetDecisions, r, exhibits),
    })
  }
  sections.push({
    title: 'Charges',
    headers: ['Code', 'Offense', 'Class', 'Counts', 'Penal title'], widths: [1, 3, 1, 0.7, 2],
    rows: chargeRows(charges),
  })
  const basis: string[] = []
  if (warrant) {
    basis.push(`Standard of proof: ${standardOfProofLabel(formValue(version, 'standard_of_proof'))}`)
    const pc = formValue(version, 'pc_statement')
    if (pc.trim()) basis.push(`Probable-cause statement: ${pc.trim()}`)
  }
  basis.push(`Justification: ${dash(version?.narrative ?? r.narrative)}`)
  sections.push({ title: 'Basis', paras: basis })
  const entries = parseLegalFormEntries(version?.form_data).filter(([k]) => k !== 'standard_of_proof' && k !== 'pc_statement')
  if (entries.length) {
    sections.push({ title: 'Particulars', headers: ['Field', 'Value'], widths: [1, 3], rows: entries.map(([k, v]) => [humanize(k), v]) })
  }
  sections.push({
    title: 'Signatures (version-bound)',
    headers: ['Name', 'Role', 'Action', 'Version', 'Signed'], widths: [2, 1.5, 1.5, 0.7, 1.6],
    rows: signatureRows(signatures, versions),
  })
  sections.push({ title: 'Judicial signature', paras: judgeSignatureParas(r, signatures, name) })
  sections.push(verificationSection(verification, version))

  return {
    docType: 'LEGAL INSTRUMENT',
    refCode: r.request_number,
    subtitle: r.title,
    meta: [
      ['Type', `${humanize(r.request_type)} — ${humanize(r.subtype)}`],
      ['Status', statusLabel(r.review_status)],
      [warrant ? 'Subject' : 'Recipient', target(r)],
      ['Case', `${r.case_number_snapshot ?? '—'}${r.case_title_snapshot ? ` — ${r.case_title_snapshot}` : ''}`],
      ['Responsible bureau', bureauLabel(r.responsible_bureau)],
      ['Version', version ? `v${version.version_number} · ${fmtDateTime(version.created_at)}` : '—'],
      ['Verification', verification?.code ?? 'Screen copy'],
      ['Classification', r.classification.toUpperCase()],
      ['Requesting detective', name(r.created_by)],
    ],
    sections,
    signatures: ['Judge', 'Requesting investigator'],
  }
}

/* ── Packet ───────────────────────────────────────────────────────────────── */
export function legalPacketSpec(
  r: LegalRequest,
  version: LegalVersion | null,
  exhibits: readonly LegalExhibit[],
  timeline: readonly TimelineRow[],
  charges: readonly LegalChargeRow[],
  signatures: readonly LegalSignature[],
  verification: ExportVerification | null,
  opts: LegalExportOptions & { versions?: readonly Pick<LegalVersion, 'id' | 'version_number'>[]; targetDecisions?: readonly TargetDecisionRow[] } = {},
): PdfDocSpec {
  const name = opts.name ?? defaultName
  const statusLabel = opts.statusLabel ?? humanize
  const fulfilment = opts.fulfilmentLabel ?? humanize
  const restricted = opts.restrictedSourceIds ?? new Set<string>()
  const versions = opts.versions ?? (version ? [version] : [])
  const warrant = r.request_type === 'warrant'

  // Manifest: the live exhibit rows when the viewer holds them, else the
  // frozen manifest titles from the version. Restricted sources are skipped
  // and counted; media exhibits carry no URL either way.
  let omitted = 0
  const manifestRows: string[][] = exhibits.length
    ? exhibits.flatMap((e) => {
        if (e.source_id && restricted.has(e.source_id)) { omitted++; return [] }
        const meta = (typeof e.snapshot_metadata === 'object' && e.snapshot_metadata && !Array.isArray(e.snapshot_metadata))
          ? (e.snapshot_metadata as Record<string, unknown>) : {}
        const url = !MEDIA_TYPES.has(e.exhibit_type) && typeof meta.url === 'string' ? safeUrl(meta.url) : ''
        return [[e.display_title, humanize(e.exhibit_type), dash(e.rationale), url || '—']]
      })
    : parsePacketManifest(version?.packet_manifest).map((m) => [m.title ?? '—', m.type ? humanize(m.type) : '—', '—', '—'])

  const sections: PdfSection[] = [
    {
      title: 'Description / justification',
      paras: [
        ...(warrant ? [`Standard of proof: ${standardOfProofLabel(formValue(version, 'standard_of_proof'))}`] : []),
        ...(warrant && formValue(version, 'pc_statement').trim() ? [`Probable-cause statement: ${formValue(version, 'pc_statement').trim()}`] : []),
        dash(version?.narrative ?? r.narrative),
      ],
    },
  ]
  const entries = parseLegalFormEntries(version?.form_data).filter(([k]) => k !== 'standard_of_proof' && k !== 'pc_statement')
  if (entries.length) {
    sections.push({ title: 'Request particulars', headers: ['Field', 'Value'], widths: [1, 3], rows: entries.map(([k, v]) => [humanize(k), v]) })
  }
  sections.push({
    title: 'Charges',
    headers: ['Code', 'Offense', 'Class', 'Counts', 'Penal title'], widths: [1, 3, 1, 0.7, 2],
    rows: chargeRows(charges),
  })
  if (r.decision || r.judicial_conditions) {
    sections.push({
      title: 'Decision',
      paras: [
        `${humanize(r.decision ?? r.review_status)} by ${name(r.decided_by)}${r.decided_at ? ` · ${fmtDateTime(r.decided_at)}` : ''}`,
        ...(r.decision_note ? [`Note: ${r.decision_note}`] : []),
        ...(r.judicial_conditions ? [`Conditions: ${r.judicial_conditions}`] : []),
        ...(r.issued_at ? [`Issued ${fmtDateTime(r.issued_at)} by ${name(r.issued_by)}`] : []),
        ...(r.expires_at ? [`Expires ${fmtDateTime(r.expires_at)}`] : []),
        ...(r.response_deadline ? [`Response deadline ${fmtDateTime(r.response_deadline)}`] : []),
      ],
    })
  }
  if (opts.targetDecisions?.length) {
    sections.push({
      title: 'Scope decisions', headers: ['Target', 'Decision', 'Reasoning'], widths: [2, 1, 2],
      rows: targetDecisionRows(opts.targetDecisions, r, exhibits),
    })
  }
  sections.push({
    title: `Exhibit manifest${omitted ? ` (${omitted} restricted item${omitted === 1 ? '' : 's'} omitted)` : ''}`,
    headers: ['Exhibit', 'Type', 'Rationale', 'Link'], widths: [2.5, 1.2, 2, 1.5],
    rows: manifestRows,
  })
  sections.push({
    title: 'Timeline',
    headers: ['When', 'Action', 'By', 'From', 'To', 'Note'], widths: [1.6, 1.4, 1.3, 1.2, 1.2, 2.2],
    // Sweep-written rows (nudged / escalated / expired / deadline_passed)
    // have no actor: they are the system's.
    rows: timeline.map((a) => [
      fmtDateTime(a.created_at), humanize(a.action), a.actor_id ? name(a.actor_id) : 'System',
      a.from_status ? statusLabel(a.from_status) : '—', a.to_status ? statusLabel(a.to_status) : '—', dash(a.public_note),
    ]),
  })
  sections.push({
    title: 'Signatures (version-bound)',
    headers: ['Name', 'Role', 'Action', 'Version', 'Signed'], widths: [2, 1.5, 1.5, 0.7, 1.6],
    rows: signatureRows(signatures, versions),
  })
  sections.push(verificationSection(verification, version))

  return {
    docType: 'COURT PACKET',
    refCode: r.request_number,
    subtitle: r.title,
    meta: [
      ['Type', `${humanize(r.request_type)} — ${humanize(r.subtype)}`],
      ['Status', `${statusLabel(r.review_status)} · ${fulfilment(r.fulfilment_status)}`],
      [warrant ? 'Subject' : 'Recipient', target(r)],
      ['Case', `${r.case_number_snapshot ?? '—'}${r.case_title_snapshot ? ` — ${r.case_title_snapshot}` : ''}`],
      ['Responsible bureau', bureauLabel(r.responsible_bureau)],
      ['Frozen version', version ? `v${version.version_number} · ${fmtDateTime(version.created_at)}` : '—'],
      ['Verification', verification?.code ?? 'Screen copy'],
      ['Classification', r.classification.toUpperCase()],
      ['Requesting detective', name(r.created_by)],
      ...(r.priority ? [['Priority', r.priority] as [string, string]] : []),
    ],
    sections,
  }
}

/* ── DOCX — the same spec flattened to paragraphs ────────────────────────── */
/** One deterministic flattening for every legal document so the DOCX can
 *  never say something the PDF does not. */
export function specToDocx(spec: PdfDocSpec): DocxPara[] {
  const out: DocxPara[] = [
    { text: `${spec.docType} — ${spec.refCode}`, style: 'title' },
    ...(spec.subtitle ? [{ text: spec.subtitle, style: 'subtitle' as const }] : []),
    ...spec.meta.map(([k, v]): DocxPara => ({ text: `${k}: ${v || '—'}` })),
  ]
  for (const s of spec.sections) {
    out.push({ text: s.title, style: 'heading' })
    if (s.headers && s.rows) {
      if (!s.rows.length) out.push({ text: 'None on file.' })
      for (const row of s.rows) {
        out.push({ text: row.map((cell, i) => `${s.headers![i] ?? ''}: ${cell || '—'}`).join(' · ') })
      }
    } else {
      for (const p of s.paras?.length ? s.paras : ['—']) out.push({ text: p })
    }
  }
  if (spec.signatures?.length) {
    out.push({ text: 'Signatures', style: 'heading' })
    for (const label of spec.signatures) out.push({ text: `${label}: ______________________________` })
  }
  return out
}

export function legalInstrumentDocx(...args: Parameters<typeof legalInstrumentSpec>): DocxPara[] {
  return specToDocx(legalInstrumentSpec(...args))
}
export function legalPacketDocx(...args: Parameters<typeof legalPacketSpec>): DocxPara[] {
  return specToDocx(legalPacketSpec(...args))
}

/** Stable file name: `<request>-<kind>-<code|screen>.<ext>`. */
export function legalExportFilename(r: Pick<LegalRequest, 'request_number'>, kind: 'instrument' | 'packet', format: 'pdf' | 'docx', code: string | null): string {
  const safe = r.request_number.replace(/[^A-Za-z0-9-]+/g, '_')
  return `${safe}-${kind}-${code ?? 'screen'}.${format}`
}
