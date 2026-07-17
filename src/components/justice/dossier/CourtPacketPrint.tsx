'use client'

/** Court-packet print/export for a legal request (audit §8 — the data was
 *  always there; this is pure UI). Renders the FROZEN version the reviewers
 *  acted on (current_version_id): its narrative, form content and packet
 *  manifest, plus the decision record and the version-bound signature trail —
 *  scoped to exactly what the viewer already sees on screen, no new fetches.
 *  Same mechanics as cases/tabs/WarrantPrint: a portal-mounted paper sheet,
 *  @media print swaps the app out, afterprint unmounts it. */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { fmtDateTime } from '@/lib/format'
import { reviewStatusLabel, fulfilmentLabel, justiceRoleLabel, type LegalRequest, type LegalSignature, type LegalVersion } from '@/lib/justice'
import { formatTarget, humanize } from '@/lib/legalWorkflow'
import { parseLegalFormEntries, parsePacketManifest } from '@/lib/schemas'

/** Screen-hidden; @media print swaps the app out and the sheet in. Plain
 *  serif/black-on-white CSS (not the dark tokens) — this is paper, not UI. */
const PRINT_CSS = `
.legal-print-sheet { display: none; }
@page { margin: 16mm; }
@media print {
  body > *:not(.legal-print-sheet) { display: none !important; }
  .legal-print-sheet { display: block !important; background: #fff; color: #111; font: 11pt/1.5 Georgia, 'Times New Roman', Times, serif; }
  .legal-print-sheet .lp-lh { text-align: center; border-bottom: 3px double #111; padding-bottom: 10pt; margin-bottom: 12pt; }
  .legal-print-sheet .lp-state { margin: 0; font-size: 9pt; letter-spacing: 0.3em; text-transform: uppercase; }
  .legal-print-sheet .lp-div { margin: 1pt 0 6pt; font-size: 10pt; letter-spacing: 0.14em; text-transform: uppercase; }
  .legal-print-sheet h1 { margin: 0 0 2pt; font-size: 16pt; text-transform: uppercase; letter-spacing: 0.06em; }
  .legal-print-sheet .lp-sub { margin: 0; font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: #333; }
  .legal-print-sheet table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  .legal-print-sheet th, .legal-print-sheet td { border: 1px solid #888; padding: 3pt 6pt; text-align: left; vertical-align: top; }
  .legal-print-sheet th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; background: #eee; }
  .legal-print-sheet .lp-kv td:first-child { width: 34%; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: #333; }
  .legal-print-sheet .lp-meta { margin-bottom: 12pt; }
  .legal-print-sheet section { margin-bottom: 10pt; break-inside: avoid; }
  .legal-print-sheet h2 { margin: 0 0 4pt; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid #111; padding-bottom: 2pt; }
  .legal-print-sheet .lp-para { margin: 0; white-space: pre-wrap; }
  .legal-print-sheet .lp-empty { color: #555; }
  .legal-print-sheet footer { margin-top: 14pt; border-top: 1px solid #888; padding-top: 4pt; text-align: center; font-size: 8pt; color: #444; }
}
`

const Empty = <span className="lp-empty">—</span>

function LegalPacketSheet({ r, version, signatures, versions, name, preparedAt }: {
  r: LegalRequest
  version: LegalVersion
  signatures: LegalSignature[]
  versions: LegalVersion[]
  name: (id: string | null | undefined) => string
  preparedAt: string
}) {
  const entries = parseLegalFormEntries(version.form_data)
  const manifest = parsePacketManifest(version.packet_manifest)
  return (
    <div className="legal-print-sheet">
      <style>{PRINT_CSS}</style>
      <header className="lp-lh">
        <p className="lp-state">State of San Andreas</p>
        <p className="lp-div">Department of Justice · Judiciary</p>
        <h1>{humanize(r.subtype)}</h1>
        <p className="lp-sub">Legal request court packet · {r.request_number}</p>
      </header>
      <table className="lp-kv lp-meta"><tbody>
        <tr><td>Request number</td><td>{r.request_number}</td></tr>
        <tr><td>Type</td><td>{humanize(r.request_type)} — {humanize(r.subtype)}</td></tr>
        <tr><td>Title</td><td>{r.title || Empty}</td></tr>
        <tr><td>Case</td><td>{r.case_number_snapshot ?? '—'}{r.case_title_snapshot ? ` — ${r.case_title_snapshot}` : ''}</td></tr>
        <tr><td>{r.request_type === 'warrant' ? 'Suspect' : 'Recipient'}</td><td>{formatTarget(r)}</td></tr>
        <tr><td>Responsible bureau</td><td>{r.responsible_bureau}</td></tr>
        <tr><td>Classification</td><td style={{ textTransform: 'uppercase' }}>{r.classification}</td></tr>
        <tr><td>Status</td><td>{reviewStatusLabel(r.review_status)} · {fulfilmentLabel(r.fulfilment_status)}</td></tr>
        {r.priority && <tr><td>Priority</td><td>{r.priority}</td></tr>}
        <tr><td>Requesting detective</td><td>{name(r.created_by)}</td></tr>
        <tr><td>Frozen version</td><td>v{version.version_number} · {fmtDateTime(version.created_at)}</td></tr>
      </tbody></table>

      <section>
        <h2>Description / Justification</h2>
        <p className="lp-para">{version.narrative?.trim() || Empty}</p>
      </section>
      {entries.length > 0 && (
        <section>
          <h2>Request particulars</h2>
          <table className="lp-kv"><tbody>
            {entries.map(([k, val]) => <tr key={k}><td>{humanize(k)}</td><td>{String(val ?? '') || Empty}</td></tr>)}
          </tbody></table>
        </section>
      )}

      {(r.decision || r.judicial_conditions) && (
        <section>
          <h2>Decision</h2>
          <table className="lp-kv"><tbody>
            {r.decision && <tr><td>Decision</td><td style={{ textTransform: 'uppercase' }}>{humanize(r.decision)}</td></tr>}
            {r.decided_by && <tr><td>Decided by</td><td>{name(r.decided_by)}{r.decided_at ? ` · ${fmtDateTime(r.decided_at)}` : ''}</td></tr>}
            {r.decision_note && <tr><td>Decision note</td><td>{r.decision_note}</td></tr>}
            {r.judicial_conditions && <tr><td>Conditions</td><td>{r.judicial_conditions}</td></tr>}
            {r.issued_at && <tr><td>Issued</td><td>{fmtDateTime(r.issued_at)} by {name(r.issued_by)}</td></tr>}
            {r.expires_at && <tr><td>Expires</td><td>{fmtDateTime(r.expires_at)}</td></tr>}
            {r.response_deadline && <tr><td>Response deadline</td><td>{fmtDateTime(r.response_deadline)}</td></tr>}
          </tbody></table>
        </section>
      )}

      <section>
        <h2>Packet manifest (frozen at submission)</h2>
        {manifest.length ? (
          <table>
            <thead><tr><th>Exhibit</th><th>Type</th></tr></thead>
            <tbody>
              {manifest.map((m, i) => (
                <tr key={m.exhibit_id ?? i}>
                  <td>{m.title || Empty}</td>
                  <td>{m.type ? humanize(m.type) : Empty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="lp-para">{Empty}</p>}
      </section>

      <section>
        <h2>Signatures (version-bound)</h2>
        {signatures.length ? (
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Action</th><th>Version</th><th>Signed</th></tr></thead>
            <tbody>
              {signatures.map((s) => {
                const ver = versions.find((x) => x.id === s.version_id)
                return (
                  <tr key={s.id}>
                    <td>{s.signer_name_snapshot}</td>
                    <td>{justiceRoleLabel(s.signer_role_snapshot)}</td>
                    <td>{humanize(s.action)}</td>
                    <td>v{ver?.version_number ?? '?'}</td>
                    <td>{fmtDateTime(s.signed_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <p className="lp-para">{Empty}</p>}
      </section>

      <footer>Generated by the CID Portal · prepared {preparedAt} · For official use — court presentation copy.</footer>
    </div>
  )
}

/** Mounts the paper sheet, opens the (blocking) print dialog a paint later,
 *  and calls onDone on afterprint so the caller can unmount it. */
export function CourtPacketPrint({ r, version, signatures, versions, name, preparedAt, onDone }: {
  r: LegalRequest
  version: LegalVersion
  signatures: LegalSignature[]
  versions: LegalVersion[]
  name: (id: string | null | undefined) => string
  preparedAt: string
  onDone: () => void
}) {
  // onDone is usually an inline closure — hold it in a ref so a parent
  // re-render (e.g. realtime) can never re-run the mount effect and re-open
  // the print dialog.
  const doneRef = useRef(onDone)
  useEffect(() => { doneRef.current = onDone }, [onDone])
  useEffect(() => {
    const done = () => doneRef.current()
    window.addEventListener('afterprint', done)
    // Let the portal paint before the (blocking) print dialog opens.
    const t = window.setTimeout(() => window.print(), 50)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [])
  return createPortal(
    <LegalPacketSheet r={r} version={version} signatures={signatures} versions={versions} name={name} preparedAt={preparedAt} />,
    document.body,
  )
}
