'use client'

/** Person dossier export — compiles everything the viewer can see about a
 *  person into .docx paragraphs / a PDF spec. Every input query is RLS-scoped,
 *  so the dossier only ever contains what the exporting member could already
 *  read on screen.
 *
 *  Redesign note: warrants/subpoenas now come from the STRUCTURED
 *  `legal_requests.person_id` join (slim projection, RLS-sealed rows simply
 *  absent). The old `warrantsNaming` helper — a full `reports` table scan with
 *  exact free-text name matching — is gone everywhere. */
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import type { DocxPara } from '@/lib/docx'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { fulfilmentLabel, reviewStatusLabel } from '@/lib/justice'
import { parseProperties, type PersonProperty, type PersonRow } from './PersonModal'
import { LEGAL_COLS, type LegalLite } from './profileLoad'

type GangMemberRow = Tables<'gang_members'>
type MediaRow = Tables<'media'>
type EvidenceRow = Tables<'evidence'>
type VehicleRow = Tables<'vehicles'>
type CaseRow = Tables<'cases'>

export interface PersonDossier {
  person: PersonRow
  gang: string | null
  props: PersonProperty[]
  vehicles: VehicleRow[]
  cases: CaseRow[]
  /** Ids RLS returned nothing for — rendered as access-restricted stubs. */
  caseIds: string[]
  /** Structured legal instruments naming this person (legal_requests.person_id). */
  legal: LegalLite[]
  members: GangMemberRow[]
  media: MediaRow[]
  evidence: EvidenceRow[]
}

const uniq = <T,>(arr: T[]): T[] => [...new Set(arr)]

const legalType = (r: LegalLite): string => {
  const t = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return `${t(r.request_type)}${r.subtype && r.subtype !== r.request_type ? ` — ${t(r.subtype)}` : ''}`
}

export async function gatherPersonDossier(person: PersonRow, gangName: string | null): Promise<PersonDossier> {
  const [members, media, direct, legal, vehicles] = await Promise.all([
    list('gang_members', { eq: { person_id: person.id } }).catch(() => [] as GangMemberRow[]),
    list('media', { eq: { person_id: person.id } }).catch(() => [] as MediaRow[]),
    list('case_intel_links', { select: 'case_id', eq: { kind: 'person', ref_id: person.id } })
      .then((r) => r as unknown as { case_id: string }[])
      .catch(() => [] as { case_id: string }[]),
    list('legal_requests', { select: LEGAL_COLS, eq: { person_id: person.id }, order: 'created_at', ascending: false })
      .then((r) => r as unknown as LegalLite[])
      .catch(() => [] as LegalLite[]),
    list('vehicles', { eq: { owner_id: person.id } }).catch(() => [] as VehicleRow[]),
  ])
  const caseIds = uniq(
    [...members.map((m) => m.case_id), ...media.map((m) => m.case_id), ...direct.map((d) => d.case_id)]
      .filter((x): x is string => !!x),
  )
  const [evidence, cases] = await Promise.all([
    caseIds.length ? list('evidence', { in: { case_id: caseIds } }).catch(() => [] as EvidenceRow[]) : Promise.resolve([] as EvidenceRow[]),
    caseIds.length ? list('cases', { in: { id: caseIds } }).catch(() => [] as CaseRow[]) : Promise.resolve([] as CaseRow[]),
  ])
  return {
    person,
    gang: gangName,
    props: parseProperties(person.properties),
    vehicles,
    cases,
    caseIds,
    legal,
    members,
    media,
    evidence,
  }
}

/** Structured spec for the formal PDF export (lib/pdf downloadPdf). */
export function dossierPdfSpec(d: PersonDossier): import('@/lib/pdf').PdfDocSpec {
  const p = d.person
  const caseNum = (id: string | null) => (id && d.cases.find((c) => c.id === id)?.case_number) || '—'
  const sections: import('@/lib/pdf').PdfDocSpec['sections'] = []
  if (p.notes) sections.push({ title: 'Intelligence notes', paras: [p.notes] })
  sections.push(
    {
      title: `Linked cases (${d.cases.length})`,
      headers: ['Case', 'Title', 'Status', 'Bureau'],
      widths: [1, 2.2, 0.9, 0.7],
      rows: d.cases.map((c) => [c.case_number, c.title || 'Untitled', String(c.status), c.bureau]),
    },
  )
  if (d.caseIds.length > d.cases.length) {
    sections.push({ title: 'Restricted', paras: [`${d.caseIds.length - d.cases.length} additional linked case(s) exist but are access-restricted to other bureaus.`] })
  }
  sections.push(
    {
      title: `Legal instruments naming subject (${d.legal.length})`,
      headers: ['Request', 'Type', 'Review', 'Fulfilment', 'Filed'],
      widths: [1, 1.4, 0.9, 0.9, 0.8],
      rows: d.legal.map((r) => [r.request_number, legalType(r), reviewStatusLabel(r.review_status), fulfilmentLabel(r.fulfilment_status), fmtDate(r.created_at)]),
    },
    {
      title: `Known properties (${d.props.length})`,
      headers: ['Address', 'Type', 'Notes'],
      widths: [1.6, 0.9, 1.6],
      rows: d.props.map((pr) => [pr.address || '—', pr.type || '—', pr.notes || '—']),
    },
    {
      title: `Registered vehicles (${d.vehicles.length})`,
      headers: ['Plate', 'Model', 'Color'],
      widths: [1, 1.6, 1],
      rows: d.vehicles.map((v) => [v.plate, v.model || '—', v.color || '—']),
    },
    {
      title: `Gang memberships (${d.members.length})`,
      headers: ['Rank / Status', 'Per case'],
      widths: [1.6, 1],
      rows: d.members.map((m) => [m.rank || m.status || 'member', caseNum(m.case_id)]),
    },
    {
      title: `Evidence in linked cases (${d.evidence.length})`,
      headers: ['Item', 'Chain', 'Case'],
      widths: [2.6, 0.8, 1],
      rows: d.evidence.map((e) => [(e.item_code ? `${e.item_code} — ` : '') + (e.description || e.type || 'item'), String(e.tamper), caseNum(e.case_id)]),
    },
    {
      title: `Media (${d.media.length})`,
      headers: ['Title', 'Reference'],
      widths: [1.2, 2.4],
      rows: d.media.map((m) => [m.title || m.type, m.external_url || m.storage_path || '—']),
    },
  )
  return {
    docType: 'PERSON DOSSIER',
    refCode: p.name || 'Unknown subject',
    subtitle: `${p.alias ? `"${p.alias}" · ` : ''}${p.status || 'Person of interest'} · prepared ${fmtDateTime(new Date())}`,
    meta: [
      ['Gang affiliation', d.gang || '—'],
      ['CCW', p.ccw ? 'Yes' : 'No'],
      ['VCH', String(p.vch || 0)],
      ['Felony count', String(p.felony_count || 0)],
      ['DOB', p.dob || '—'],
      ['BOLO', p.bolo ? `ACTIVE${p.bolo_risk ? ` (${p.bolo_risk} risk)` : ''}` : 'No'],
    ],
    sections,
    signatures: ['Compiled by (Detective)', 'Date'],
  }
}

/** Dossier paragraph stream for the shared OOXML writer (intel.js dossierParas). */
export function dossierParas(d: PersonDossier): DocxPara[] {
  const p = d.person
  const P: DocxPara[] = [
    { text: 'Criminal Investigation Division — State of San Andreas', style: 'subtitle' },
    { text: `PERSON DOSSIER — ${p.name || 'Unknown'}`, style: 'title' },
    { text: `${p.alias ? `"${p.alias}" · ` : ''}${p.status || 'Person of interest'} · prepared ${fmtDateTime(new Date())}`, style: 'subtitle' },
    { text: '', style: 'normal' },
    { text: 'Profile', style: 'heading' },
    { text: `Gang: ${d.gang || '—'} · CCW: ${p.ccw ? 'Yes' : 'No'} · VCH: ${p.vch || 0} · Felonies: ${p.felony_count || 0}${p.bolo ? ` · ACTIVE BOLO${p.bolo_risk ? ` (${p.bolo_risk} risk)` : ''}` : ''}${p.dob ? ` · DOB ${p.dob}` : ''}`, style: 'normal' },
  ]
  if (p.notes) P.push({ text: `Notes: ${p.notes}`, style: 'normal' })
  const caseNum = (id: string | null) => (id && d.cases.find((c) => c.id === id)?.case_number) || null
  const section = <T,>(title: string, arr: T[], fmt: (x: T) => string, empty?: string) => {
    P.push({ text: `${title} (${arr.length})`, style: 'heading' })
    if (arr.length) arr.forEach((x) => P.push({ text: `• ${fmt(x)}`, style: 'normal' }))
    else P.push({ text: empty || 'None on file.', style: 'normal' })
  }
  section('Linked cases', d.cases, (c) => `${c.case_number} — ${c.title || 'Untitled'} [${c.status}] · ${c.bureau}`)
  if (d.caseIds.length > d.cases.length) {
    P.push({ text: `(${d.caseIds.length - d.cases.length} additional linked case(s) — access restricted)`, style: 'normal' })
  }
  section('Legal instruments naming subject', d.legal, (r) =>
    `${r.request_number} — ${legalType(r)} · ${reviewStatusLabel(r.review_status)} / ${fulfilmentLabel(r.fulfilment_status)} · filed ${fmtDate(r.created_at)}${r.case_number_snapshot ? ` · ${r.case_number_snapshot}` : ''}`)
  section('Known properties', d.props, (pr) => `${pr.address || '—'}${pr.type ? ` · ${pr.type}` : ''}${pr.notes ? ` · ${pr.notes}` : ''}`)
  section('Registered vehicles', d.vehicles, (v) => `${v.plate}${v.model ? ` — ${v.model}` : ''}${v.color ? ` · ${v.color}` : ''}`)
  section('Gang memberships', d.members, (m) => `${m.rank || m.status || 'member'}${caseNum(m.case_id) ? ` · per ${caseNum(m.case_id)}` : ''}`)
  section('Evidence (in linked cases)', d.evidence, (e) => `${(e.item_code ? `${e.item_code} — ` : '') + (e.description || e.type || 'item')} [${e.tamper}]${caseNum(e.case_id) ? ` · ${caseNum(e.case_id)}` : ''}`)
  section('Media', d.media, (m) => `${m.title || m.type} — ${m.external_url || m.storage_path || ''}`)
  P.push({ text: '', style: 'normal' })
  P.push({ text: 'Generated by the CID Portal. For internal investigative use.', style: 'subtitle' })
  return P
}
