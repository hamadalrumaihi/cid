/** Court-packet export — port of vanilla app.js gatherCasePacket/packetDocx/
 *  caseToMarkdown (:175-279). Ships .docx (dependency-free writer), .md,
 *  and .pdf (shared paras via lib/pdf's lazy @react-pdf renderer). */
import { list, rpc } from './db'
import type { Tables } from './database.types'
import { downloadDocx, type DocxPara } from './docx'
import { downloadTextFile, fmtUSD, slug } from './format'
import { reportTitle } from './forms'
import { penalByCode, penalSentence } from './penal'
import { parseCharges } from '@/lib/jsonShapes'

type CaseRow = Tables<'cases'>

export interface PacketData {
  ev: Tables<'evidence'>[]
  rep: Tables<'reports'>[]
  rico: Tables<'rico_cases'>[]
  preds: Tables<'predicate_acts'>[]
  media: Tables<'media'>[]
  charges: { code: string; count: number; title: string; level: string; jail: number | null; fine: number | null }[]
  persons: { name: string | null; alias: string | null; status: string | null }[]
  /** Restricted media rows EXCLUDED from this packet (Phase 6 default-deny):
   *  0 when none exist or a fresh Lead+ export approval covered them. */
  restrictedExcluded: number
}

export async function gatherCasePacket(c: CaseRow): Promise<PacketData> {
  let ev: PacketData['ev'] = [], rep: PacketData['rep'] = [], rico: PacketData['rico'] = []
  let preds: PacketData['preds'] = [], media: PacketData['media'] = [], persons: PacketData['persons'] = []
  try {
    ;[ev, rep, media] = await Promise.all([
      list('evidence', { order: 'created_at', ascending: true, eq: { case_id: c.id } }),
      list('reports', { order: 'created_at', ascending: true, eq: { case_id: c.id } }),
      list('media', { eq: { case_id: c.id } }),
    ])
    rico = await list('rico_cases', { eq: { case_id: c.id } })
    if (rico[0]) preds = await list('predicate_acts', { eq: { rico_case_id: rico[0].id } })
    // Persons explicitly linked via the Intel tab, resolved to names (RLS-scoped).
    const links = await list('case_intel_links', { eq: { case_id: c.id, kind: 'person' } }).catch(() => [])
    if (links.length) {
      const pool = await list('persons', { in: { id: links.map((l) => l.ref_id) } }).catch(() => [])
      persons = links
        .map((l) => pool.find((p) => p.id === l.ref_id))
        .filter((p): p is Tables<'persons'> => !!p)
        .map((p) => ({ name: p.name, alias: p.alias, status: p.status }))
    }
  } catch { /* partial packet is better than none; sections render as empty */ }
  // Default-deny restricted export (Phase 6): restricted rows only ship inside
  // a packet while a Lead+ approval is fresh (has_restricted_packet_approval,
  // 1h window). Any doubt — RPC error included — excludes them.
  let restrictedExcluded = 0
  let approved = false
  try {
    const r = await rpc('has_restricted_packet_approval', { p_case: c.id })
    approved = !r.error && r.data === true
  } catch { approved = false }
  if (!approved) {
    restrictedExcluded = media.filter((m) => m.restricted).length
    if (restrictedExcluded) media = media.filter((m) => !m.restricted)
  }
  const charges = parseCharges(c.charges).map((x) => {
    const pc = penalByCode(x.code)
    return { code: x.code, count: Math.max(1, x.count || 1), title: pc ? pc.title : '(unknown)', level: pc ? pc.level : '', jail: pc ? pc.jail : null, fine: pc ? pc.fine : null }
  })
  return { ev, rep, rico, preds, media, charges, persons, restrictedExcluded }
}

export function packetParas(c: CaseRow, d: PacketData): DocxPara[] {
  const P: DocxPara[] = [
    { text: 'Criminal Investigation Division — State of San Andreas', style: 'subtitle' },
    { text: `CASE PACKET — ${c.case_number}`, style: 'title' },
    { text: `${c.title || ''} · ${c.bureau} · ${String(c.status).toUpperCase()} · prepared ${new Date().toLocaleString('en-US')}`, style: 'subtitle' },
    { text: '', style: 'normal' },
    { text: 'Summary', style: 'heading' },
    { text: c.summary || '—', style: 'normal' },
  ]
  P.push({ text: `Evidence (${d.ev.length})`, style: 'heading' })
  if (d.ev.length) {
    d.ev.forEach((e) => P.push({ text: `• ${(e.item_code ? e.item_code + ' — ' : '') + (e.description || e.type || 'item')} [${e.tamper}]`, style: 'normal' }))
  } else {
    P.push({ text: 'None.', style: 'normal' })
  }
  P.push({ text: `Reports (${d.rep.length})`, style: 'heading' })
  if (d.rep.length) {
    d.rep.forEach((r) => P.push({ text: `• ${reportTitle(r)}${r.finalized ? ' (finalized)' : ''} — ${new Date(r.created_at).toLocaleDateString('en-US')}`, style: 'normal' }))
  } else {
    P.push({ text: 'None.', style: 'normal' })
  }
  P.push({ text: `Charges (${d.charges.length})`, style: 'heading' })
  if (d.charges.length) {
    d.charges.forEach((x) => P.push({ text: `• ${x.code} — ${x.title}${x.count > 1 ? ' ×' + x.count : ''}${x.level ? ' [' + x.level + ']' : ''}${x.jail != null ? ' · ' + penalSentence(x.jail) : ''}${x.fine != null ? ' · ' + fmtUSD(x.fine) : ''}`, style: 'normal' }))
  } else {
    P.push({ text: 'None.', style: 'normal' })
  }
  P.push({ text: `Named persons (${d.persons.length})`, style: 'heading' })
  if (d.persons.length) {
    d.persons.forEach((p) => P.push({ text: `• ${p.name}${p.alias ? ' “' + p.alias + '”' : ''}${p.status ? ' — ' + p.status : ''}`, style: 'normal' }))
  } else {
    P.push({ text: 'None linked.', style: 'normal' })
  }
  P.push({ text: `Media (${d.media.length})`, style: 'heading' })
  if (d.media.length) {
    d.media.forEach((m) => P.push({ text: `• ${m.title || m.type} — ${m.external_url || m.storage_path || ''}`, style: 'normal' }))
  } else {
    P.push({ text: 'None.', style: 'normal' })
  }
  P.push({ text: 'RICO', style: 'heading' })
  P.push({ text: d.rico[0] ? `Enterprise linked; ${d.preds.length} predicate act(s).` : 'No RICO tracker for this case.', style: 'normal' })
  if (c.notes?.trim()) {
    P.push({ text: 'Case Notes', style: 'heading' })
    c.notes.replace(/\r\n?/g, '\n').split('\n').forEach((ln) => P.push({ text: ln, style: 'normal' }))
  }
  P.push({ text: '', style: 'normal' })
  P.push({ text: 'Generated by the CID Portal. For internal investigative use.', style: 'subtitle' })
  return P
}

/** Structured spec for the formal PDF export (lib/pdf downloadPdf). */
export function packetPdfSpec(c: CaseRow, d: PacketData): import('./pdf').PdfDocSpec {
  const sections: import('./pdf').PdfDocSpec['sections'] = [
    { title: 'Case summary', paras: [c.summary || 'No summary on file.'] },
    {
      title: `Evidence (${d.ev.length})`,
      headers: ['Item', 'Description', 'Chain'],
      widths: [1, 3, 0.8],
      rows: d.ev.map((e) => [e.item_code || '—', e.description || e.type || 'item', String(e.tamper ?? 'ok')]),
    },
    {
      title: `Charges (${d.charges.length})`,
      headers: ['Code', 'Offense', 'Count', 'Sentence', 'Fine'],
      widths: [0.9, 2.6, 0.6, 1.1, 0.9],
      rows: d.charges.map((x) => [x.code, `${x.title}${x.level ? ` [${x.level}]` : ''}`, `×${x.count}`, x.jail != null ? penalSentence(x.jail) : '—', x.fine != null ? fmtUSD(x.fine) : '—']),
    },
    {
      title: `Reports (${d.rep.length})`,
      headers: ['Report', 'Status', 'Filed'],
      widths: [2.6, 1, 1],
      rows: d.rep.map((r) => [reportTitle(r), r.finalized ? 'Finalized' : 'Draft', new Date(r.created_at).toLocaleDateString('en-US')]),
    },
    {
      title: `Named persons (${d.persons.length})`,
      headers: ['Name', 'Alias', 'Status'],
      widths: [1.6, 1.2, 1],
      rows: d.persons.map((p) => [p.name || '—', p.alias || '—', p.status || '—']),
    },
    {
      title: `Media (${d.media.length})`,
      headers: ['Title', 'Reference'],
      widths: [1.2, 2.4],
      rows: d.media.map((m) => [m.title || m.type, m.external_url || m.storage_path || '—']),
    },
    { title: 'RICO', paras: [d.rico[0] ? `Enterprise linked; ${d.preds.length} predicate act(s) on record.` : 'No RICO tracker for this case.'] },
  ]
  if (c.notes?.trim()) sections.push({ title: 'Case notes', paras: c.notes.replace(/\r\n?/g, '\n').split('\n').filter(Boolean) })
  return {
    docType: 'CASE PACKET',
    refCode: c.case_number,
    subtitle: `${c.title || 'Untitled'} · prepared ${new Date().toLocaleString('en-US')}`,
    meta: [
      ['Status', String(c.status).toUpperCase()],
      ['Bureau', c.bureau],
      ['Area', c.area || '—'],
      ['Evidence items', String(d.ev.length)],
      ['Charges', String(d.charges.length)],
      ['Reports', String(d.rep.length)],
    ],
    sections,
    signatures: ['Prepared by (Detective)', 'Reviewed by (Bureau Lead)', 'Date'],
  }
}

export function packetDocx(c: CaseRow, d: PacketData): void {
  downloadDocx(`Case Packet — ${c.case_number}`, packetParas(c, d), `${slug(c.case_number)}-packet.docx`)
}

/** Compile the whole case to portable Markdown — app.js caseToMarkdown. */
export function caseToMarkdown(c: CaseRow, d: PacketData): string {
  const L: string[] = []
  L.push(`# Case Packet — ${c.case_number}`, '')
  L.push('`' + [c.title, c.bureau, String(c.status).toUpperCase()].filter(Boolean).join(' · ') + '` · prepared ' + new Date().toLocaleString('en-US'), '')
  L.push('## Summary', c.summary || '—', '')
  if (c.notes?.trim()) L.push('## Notes', c.notes.replace(/\r\n?/g, '\n'), '')
  L.push(`## Evidence (${d.ev.length})`)
  if (d.ev.length) {
    d.ev.forEach((e) => L.push(`- ${(e.item_code ? e.item_code + ' — ' : '') + (e.description || e.type || 'item')} [${e.tamper}]`))
  } else {
    L.push('_None._')
  }
  L.push('')
  L.push(`## Reports (${d.rep.length})`)
  if (d.rep.length) {
    d.rep.forEach((r) => L.push(`- ${reportTitle(r)}${r.finalized ? ' (finalized)' : ''} — ${new Date(r.created_at).toLocaleDateString('en-US')}`))
  } else {
    L.push('_None._')
  }
  L.push('')
  L.push(`## Charges (${d.charges.length})`)
  if (d.charges.length) {
    d.charges.forEach((x) => L.push(`- ${x.code} — ${x.title}${x.count > 1 ? ' ×' + x.count : ''}${x.level ? ' [' + x.level + ']' : ''}${x.jail != null ? ' · ' + penalSentence(x.jail) : ''}${x.fine != null ? ' · ' + fmtUSD(x.fine) : ''}`))
  } else {
    L.push('_None._')
  }
  L.push('')
  L.push(`## Named persons (${d.persons.length})`)
  if (d.persons.length) {
    d.persons.forEach((p) => L.push(`- ${p.name}${p.alias ? ' "' + p.alias + '"' : ''}${p.status ? ' — ' + p.status : ''}`))
  } else {
    L.push('_None linked._')
  }
  L.push('')
  L.push(`## Media (${d.media.length})`)
  if (d.media.length) {
    d.media.forEach((m) => L.push(`- ${m.title || m.type} — ${m.external_url || m.storage_path || ''}`))
  } else {
    L.push('_None._')
  }
  L.push('')
  L.push('## RICO', d.rico[0] ? `Enterprise linked; ${d.preds.length} predicate act(s).` : 'No RICO tracker for this case.')
  L.push('', '---', '_Generated by the CID Portal._')
  return L.join('\n')
}

export function packetMarkdown(c: CaseRow, d: PacketData): void {
  downloadTextFile(`${slug(c.case_number)}-packet.md`, caseToMarkdown(c, d), 'text/markdown')
}
