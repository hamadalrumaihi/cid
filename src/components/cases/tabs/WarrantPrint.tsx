'use client'

/** Court-ready warrant print/export (Sprint 3, audit P1-7). Renders the
 *  warrant report as a clean letterhead-styled paper document and drives the
 *  browser print flow — no PDF library, no innerHTML. The sheet portals to
 *  <body> only while a print is in flight; the @media print rules hide the
 *  app shell around it and show the sheet alone. Presentation only: it walks
 *  the same FORM_SCHEMAS/fields ReportView renders (and the packet exporters
 *  flatten) and never mutates the report. */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormSchema, FormValues } from '@/lib/forms'
import { FORM_SCHEMAS, reportTitle, warrantStatusOf } from '@/lib/forms'
import { parseFormValues } from '@/lib/jsonShapes'
import { parseReportSignature } from '@/lib/schemas'
import type { CaseRow, ReportRow } from './shared'

/** fields._warrant_log entries as stamped by warrant_set_status (server-side).
 *  Tolerant by hand — malformed entries drop out instead of crashing print. */
interface WarrantLogEntry { at?: string; by?: string; from?: string; to?: string; authority?: string }
function parseWarrantLog(values: FormValues): WarrantLogEntry[] {
  const raw = values._warrant_log
  if (!Array.isArray(raw)) return []
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
    .map((e) => ({ at: str(e.at), by: str(e.by), from: str(e.from), to: str(e.to), authority: str(e.authority) }))
}

/** Screen-hidden; @media print swaps the app out and the sheet in. Plain
 *  serif/black-on-white CSS (not the dark tokens) — this is paper, not UI. */
const PRINT_CSS = `
.warrant-print-sheet { display: none; }
@page { margin: 16mm; }
@media print {
  body > *:not(.warrant-print-sheet) { display: none !important; }
  .warrant-print-sheet { display: block !important; background: #fff; color: #111; font: 11pt/1.5 Georgia, 'Times New Roman', Times, serif; }
  .warrant-print-sheet .wp-lh { text-align: center; border-bottom: 3px double #111; padding-bottom: 10pt; margin-bottom: 12pt; }
  .warrant-print-sheet .wp-state { margin: 0; font-size: 9pt; letter-spacing: 0.3em; text-transform: uppercase; }
  .warrant-print-sheet .wp-div { margin: 1pt 0 6pt; font-size: 10pt; letter-spacing: 0.14em; text-transform: uppercase; }
  .warrant-print-sheet h1 { margin: 0 0 2pt; font-size: 16pt; text-transform: uppercase; letter-spacing: 0.06em; }
  .warrant-print-sheet .wp-sub { margin: 0; font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: #333; }
  .warrant-print-sheet table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  .warrant-print-sheet th, .warrant-print-sheet td { border: 1px solid #888; padding: 3pt 6pt; text-align: left; vertical-align: top; }
  .warrant-print-sheet th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; background: #eee; }
  .warrant-print-sheet .wp-kv td:first-child { width: 34%; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: #333; }
  .warrant-print-sheet .wp-meta { margin-bottom: 12pt; }
  .warrant-print-sheet section { margin-bottom: 10pt; break-inside: avoid; }
  .warrant-print-sheet h2 { margin: 0 0 4pt; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid #111; padding-bottom: 2pt; }
  .warrant-print-sheet .wp-para { margin: 0; white-space: pre-wrap; }
  .warrant-print-sheet .wp-note { margin: 0; font-style: italic; font-size: 9.5pt; }
  .warrant-print-sheet .wp-empty { color: #555; }
  .warrant-print-sheet .wp-sigs { display: flex; gap: 20pt; margin-top: 20pt; break-inside: avoid; }
  .warrant-print-sheet .wp-sig { flex: 1 1 0; text-align: center; }
  .warrant-print-sheet .wp-sigline { border-bottom: 1px solid #111; min-height: 20pt; padding: 0 2pt 2pt; font-size: 11pt; }
  .warrant-print-sheet .wp-siglabel { margin: 2pt 0 0; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.1em; color: #333; }
  .warrant-print-sheet .wp-seal { margin: 8pt 0 0; font-size: 9pt; }
  .warrant-print-sheet footer { margin-top: 14pt; border-top: 1px solid #888; padding-top: 4pt; text-align: center; font-size: 8pt; color: #444; }
}
`

const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).trim()
const Empty = <span className="wp-empty">—</span>

/** One schema section on paper — same walk as ReportView, print semantics. */
function SheetSection({ s, V }: { s: FormSchema['sections'][number]; V: FormValues }) {
  if (s.type === 'note') return <section><p className="wp-note">{s.text}</p></section>
  if (s.type === 'textarea') {
    const v = text(V[s.key])
    return <section><h2>{s.label}</h2>{v ? <p className="wp-para">{v}</p> : <p className="wp-para">{Empty}</p>}</section>
  }
  if (s.type === 'grid') {
    const rows = (Array.isArray(V[s.id]) ? V[s.id] : []) as Record<string, string>[]
    const filled = rows.filter((r) => s.cols.some((col) => text(r[col.key])))
    return (
      <section>
        <h2>{s.label}</h2>
        {filled.length ? (
          <table>
            <thead><tr>{s.cols.map((col) => <th key={col.key}>{col.label}</th>)}</tr></thead>
            <tbody>{filled.map((r, i) => <tr key={i}>{s.cols.map((col) => <td key={col.key}>{text(r[col.key]) || Empty}</td>)}</tr>)}</tbody>
          </table>
        ) : <p className="wp-para">{Empty}</p>}
      </section>
    )
  }
  return (
    <section>
      <h2>{s.label}</h2>
      <table className="wp-kv"><tbody>
        {s.fields.map((f) => <tr key={f.key}><td>{f.label}</td><td>{text(V[f.key]) || Empty}</td></tr>)}
      </tbody></table>
    </section>
  )
}

/** The full paper document: letterhead, meta, every form section, the warrant
 *  status log and a formal signature block (typed names over rule lines). */
function WarrantSheet({ r, c, schema, preparedAt }: { r: ReportRow; c: CaseRow; schema: FormSchema; preparedAt: string }) {
  const V = parseFormValues(r.fields)
  const status = warrantStatusOf(r)
  const log = parseWarrantLog(V)
  const seal = parseReportSignature(r.signature)
  // The Authorization section becomes the formal signature block instead of
  // one more key/value table; everything else renders in schema order.
  const sigSection = schema.sections.find((s) => s.id === 'sign' && s.type === 'kv')
  const body = schema.sections.filter((s) => s !== sigSection)
  return (
    <div className="warrant-print-sheet">
      <style>{PRINT_CSS}</style>
      <header className="wp-lh">
        <p className="wp-state">State of San Andreas</p>
        <p className="wp-div">Criminal Investigation Division</p>
        <h1>{schema.title}</h1>
        <p className="wp-sub">{schema.subtitle}</p>
      </header>
      <table className="wp-kv wp-meta"><tbody>
        <tr><td>Case number</td><td>{c.case_number}</td></tr>
        <tr><td>Case title</td><td>{c.title || Empty}</td></tr>
        <tr><td>Bureau</td><td>{c.bureau}</td></tr>
        <tr><td>Document</td><td>{reportTitle(r)} · {r.finalized ? 'finalized' : 'draft'}</td></tr>
        <tr><td>Warrant status</td><td style={{ textTransform: 'uppercase' }}>{status}</td></tr>
        <tr><td>Filed</td><td>{new Date(r.created_at).toLocaleString('en-US')}</td></tr>
      </tbody></table>
      {body.map((s) => <SheetSection key={s.id} s={s} V={V} />)}
      {log.length > 0 && (
        <section>
          <h2>Warrant status log</h2>
          <table>
            <thead><tr><th>When</th><th>By</th><th>Transition</th><th>Authority</th></tr></thead>
            <tbody>
              {log.map((e, i) => (
                <tr key={i}>
                  <td>{e.at ? new Date(e.at).toLocaleString('en-US') : Empty}</td>
                  <td>{e.by || Empty}</td>
                  <td>{e.from || 'draft'} → {e.to || Empty}</td>
                  <td>{e.authority || Empty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section>
        <h2>Signatures</h2>
        {sigSection?.type === 'kv' && (
          <div className="wp-sigs">
            {sigSection.fields.map((f) => (
              <div key={f.key} className="wp-sig">
                <div className="wp-sigline">{text(V[f.key])}</div>
                <p className="wp-siglabel">{f.label}</p>
              </div>
            ))}
          </div>
        )}
        {seal && (
          <p className="wp-seal">
            Digitally sealed by {seal.officer}{seal.badge ? ` (badge ${seal.badge})` : ''}{seal.signed_at ? ` on ${new Date(seal.signed_at).toLocaleString('en-US')}` : ''}.
          </p>
        )}
      </section>
      <footer>Generated by the CID Portal · prepared {preparedAt} · For official use — court presentation copy.</footer>
    </div>
  )
}

/** "Print / Export" action for warrant reports. The prepared timestamp is
 *  captured in the click handler (render stays pure); the sheet mounts, the
 *  print dialog opens a paint later, and afterprint unmounts it again. */
export function WarrantPrintButton({ r, c }: { r: ReportRow; c: CaseRow }) {
  const [preparedAt, setPreparedAt] = useState<string | null>(null)
  useEffect(() => {
    if (!preparedAt) return
    const done = () => setPreparedAt(null)
    window.addEventListener('afterprint', done)
    // Let the portal paint before the (blocking) print dialog opens.
    const t = window.setTimeout(() => window.print(), 50)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [preparedAt])
  const schema = FORM_SCHEMAS[r.template]
  if (!schema) return null
  return (
    <>
      <button
        onClick={() => setPreparedAt(new Date().toLocaleString('en-US'))}
        className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-white/5"
      >
        🖨️ Print / Export
      </button>
      {preparedAt && createPortal(<WarrantSheet r={r} c={c} schema={schema} preparedAt={preparedAt} />, document.body)}
    </>
  )
}
