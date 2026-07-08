'use client'

/** PDF export engine — renders a structured document spec into a formal,
 *  court-styled PDF: agency crest + letterhead, classification band, bordered
 *  meta grid, zebra tables per section, signature lines, faint diagonal
 *  watermark and a page-numbered footer. @react-pdf/renderer (~0.5 MB) is
 *  imported dynamically inside downloadPdf so it never touches the main
 *  bundle; everything renders in the browser. */
import { downloadBlob } from './format'

export interface PdfSection {
  title: string
  /** Tabular section: headers + rows (+ optional flex widths per column). */
  headers?: string[]
  rows?: string[][]
  widths?: number[]
  /** Prose section (used when headers/rows are absent). */
  paras?: string[]
}

export interface PdfDocSpec {
  /** e.g. 'CASE PACKET' / 'PERSON DOSSIER' */
  docType: string
  /** Big reference line: case number / subject name. */
  refCode: string
  subtitle: string
  meta: [string, string][]
  sections: PdfSection[]
  /** Signature line labels rendered at the end. */
  signatures?: string[]
}

const NAVY = '#1e2a4a'
const RED = '#b91c1c'
const INKY = '#0f172a'
const GRAY = '#64748b'
const LINE = '#cbd5e1'

export async function downloadPdf(spec: PdfDocSpec, filename: string): Promise<void> {
  const RP = await import('@react-pdf/renderer')

  const Th = ({ children, flex }: { children: string; flex: number }) => (
    <RP.Text style={{ flex, fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#ffffff', textTransform: 'uppercase', letterSpacing: 0.6, paddingVertical: 4, paddingHorizontal: 5 }}>
      {children}
    </RP.Text>
  )
  const Td = ({ children, flex }: { children: string; flex: number }) => (
    <RP.Text style={{ flex, fontFamily: 'Times-Roman', fontSize: 9.5, color: INKY, paddingVertical: 3.5, paddingHorizontal: 5 }}>
      {children || '—'}
    </RP.Text>
  )

  const doc = (
    <RP.Document title={`${spec.docType} — ${spec.refCode}`} creator="CID Portal" producer="CID Portal">
      <RP.Page size="LETTER" style={{ paddingTop: 48, paddingBottom: 70, paddingHorizontal: 56, fontFamily: 'Times-Roman' }}>
        {/* Faint diagonal classification watermark on every page */}
        <RP.Text
          fixed
          style={{ position: 'absolute', top: 330, left: 0, right: 0, textAlign: 'center', fontSize: 42, fontFamily: 'Helvetica-Bold', color: NAVY, opacity: 0.05, transform: 'rotate(-24deg)', letterSpacing: 4 }}
        >
          LAW ENFORCEMENT SENSITIVE
        </RP.Text>

        {/* Letterhead */}
        <RP.View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <RP.Svg width={44} height={44} viewBox="0 0 24 24">
            <RP.Path d="M12 2.5l8 3v6.5c0 5.2-3.6 8.7-8 9.5-4.4-.8-8-4.3-8-9.5V5.5z" stroke={NAVY} strokeWidth={1.4} fill="#eef2f8" />
            <RP.Path d="M12 6l1.2 2.4 2.6.4-1.9 1.9.5 2.6-2.4-1.2-2.4 1.2.5-2.6-1.9-1.9 2.6-.4z" fill={NAVY} />
            <RP.Path d="M8 17h8" stroke={NAVY} strokeWidth={1.2} />
          </RP.Svg>
          <RP.View style={{ flex: 1 }}>
            <RP.Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 14, color: NAVY, letterSpacing: 1.2 }}>CRIMINAL INVESTIGATION DIVISION</RP.Text>
            <RP.Text style={{ fontFamily: 'Helvetica', fontSize: 8.5, color: GRAY, marginTop: 2, letterSpacing: 0.6 }}>STATE OF SAN ANDREAS · DEPARTMENT OF JUSTICE</RP.Text>
          </RP.View>
          <RP.View style={{ borderWidth: 1.2, borderColor: NAVY, paddingVertical: 4, paddingHorizontal: 8 }}>
            <RP.Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: NAVY, letterSpacing: 1 }}>{spec.docType}</RP.Text>
          </RP.View>
        </RP.View>

        {/* Classification band */}
        <RP.View style={{ backgroundColor: RED, marginTop: 10, paddingVertical: 3.5 }}>
          <RP.Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#ffffff', textAlign: 'center', letterSpacing: 2 }}>
            LAW ENFORCEMENT SENSITIVE — FOR OFFICIAL USE ONLY
          </RP.Text>
        </RP.View>

        {/* Reference block */}
        <RP.View style={{ marginTop: 16 }}>
          <RP.Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 21, color: INKY }}>{spec.refCode}</RP.Text>
          {spec.subtitle ? <RP.Text style={{ fontFamily: 'Times-Italic', fontSize: 11, color: GRAY, marginTop: 3 }}>{spec.subtitle}</RP.Text> : null}
        </RP.View>

        {/* Meta grid */}
        <RP.View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, gap: 8 }}>
          {spec.meta.map(([label, value], i) => (
            <RP.View key={i} style={{ width: '30%', borderLeftWidth: 2, borderLeftColor: NAVY, paddingLeft: 6, paddingVertical: 2 }}>
              <RP.Text style={{ fontFamily: 'Helvetica', fontSize: 6.5, color: GRAY, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</RP.Text>
              <RP.Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9.5, color: INKY, marginTop: 1.5 }}>{value || '—'}</RP.Text>
            </RP.View>
          ))}
        </RP.View>

        <RP.View style={{ borderBottomWidth: 1, borderBottomColor: LINE, marginTop: 14 }} />

        {/* Sections */}
        {spec.sections.map((sec, si) => (
          <RP.View key={si} style={{ marginTop: 16 }}>
            <RP.View minPresenceAhead={40} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderBottomWidth: 1.4, borderBottomColor: NAVY, paddingBottom: 3, marginBottom: 6 }}>
              <RP.View style={{ width: 6, height: 6, backgroundColor: NAVY }} />
              <RP.Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 10, color: NAVY, letterSpacing: 1.2, textTransform: 'uppercase' }}>{sec.title}</RP.Text>
            </RP.View>
            {sec.headers && sec.rows ? (
              sec.rows.length ? (
                <RP.View>
                  <RP.View style={{ flexDirection: 'row', backgroundColor: NAVY }}>
                    {sec.headers.map((h, i) => <Th key={i} flex={sec.widths?.[i] ?? 1}>{h}</Th>)}
                  </RP.View>
                  {sec.rows.map((row, ri) => (
                    <RP.View key={ri} wrap={false} style={{ flexDirection: 'row', backgroundColor: ri % 2 ? '#f1f5f9' : '#ffffff', borderBottomWidth: 0.5, borderBottomColor: LINE }}>
                      {row.map((cell, ci) => <Td key={ci} flex={sec.widths?.[ci] ?? 1}>{cell}</Td>)}
                    </RP.View>
                  ))}
                </RP.View>
              ) : (
                <RP.Text style={{ fontFamily: 'Times-Italic', fontSize: 9.5, color: GRAY }}>None on file.</RP.Text>
              )
            ) : (
              (sec.paras?.length ? sec.paras : ['—']).map((t, ti) => (
                <RP.Text key={ti} style={{ fontFamily: 'Times-Roman', fontSize: 10.5, color: INKY, lineHeight: 1.5, marginBottom: 4, textAlign: 'justify' }}>{t}</RP.Text>
              ))
            )}
          </RP.View>
        ))}

        {/* Signature lines */}
        {spec.signatures?.length ? (
          <RP.View wrap={false} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginTop: 34 }}>
            {spec.signatures.map((label, i) => (
              <RP.View key={i} style={{ width: '42%', borderTopWidth: 1, borderTopColor: INKY, paddingTop: 4 }}>
                <RP.Text style={{ fontFamily: 'Helvetica', fontSize: 7.5, color: GRAY, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</RP.Text>
              </RP.View>
            ))}
          </RP.View>
        ) : null}

        {/* Footer */}
        <RP.View fixed style={{ position: 'absolute', bottom: 26, left: 56, right: 56, borderTopWidth: 0.8, borderTopColor: LINE, paddingTop: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <RP.Text style={{ fontFamily: 'Helvetica', fontSize: 7, color: GRAY }}>{spec.docType} · {spec.refCode}</RP.Text>
          <RP.Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 7, color: RED, letterSpacing: 1 }}>LAW ENFORCEMENT SENSITIVE</RP.Text>
          <RP.Text
            style={{ fontFamily: 'Helvetica', fontSize: 7, color: GRAY }}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </RP.View>
      </RP.Page>
    </RP.Document>
  )
  const blob = await RP.pdf(doc).toBlob()
  downloadBlob(blob, filename)
}
