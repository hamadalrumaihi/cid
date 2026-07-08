'use client'

/** PDF export engine — renders the same DocxPara[] the .docx writer consumes
 *  into a letterheaded, paginated PDF via @react-pdf/renderer. The library
 *  (~0.5 MB) is imported dynamically inside downloadPdf so it never touches
 *  the main bundle; everything runs in the browser (no server, no keys). */
import { brandParas, type DocxPara } from './docx'
import { downloadBlob } from './format'

/** docx sizes are half-points — mirror paraXml's style table at full points. */
const STYLE: Record<NonNullable<DocxPara['style']>, { size: number; bold?: boolean; center?: boolean; color?: string; gapTop?: number }> = {
  title: { size: 18, bold: true, center: true, gapTop: 6 },
  subtitle: { size: 9, center: true, color: '#64748B' },
  heading: { size: 13, bold: true, gapTop: 10 },
  normal: { size: 11 },
  letterhead: { size: 14, bold: true, center: true },
  banner: { size: 9, bold: true, center: true, color: '#B91C1C' },
}

export async function downloadPdf(title: string, paras: DocxPara[], filename: string): Promise<void> {
  const RP = await import('@react-pdf/renderer')
  const all = brandParas().concat(paras)
  const doc = (
    <RP.Document title={title} creator="CID Portal" producer="CID Portal">
      <RP.Page size="LETTER" style={{ paddingTop: 54, paddingBottom: 64, paddingHorizontal: 64, fontFamily: 'Helvetica' }}>
        <RP.View>
          {all.map((p, i) => {
            const s = STYLE[p.style ?? 'normal'] ?? STYLE.normal
            return (
              <RP.Text
                key={i}
                style={{
                  fontSize: s.size,
                  fontFamily: s.bold ? 'Helvetica-Bold' : 'Helvetica',
                  textAlign: s.center ? 'center' : 'left',
                  color: s.color ?? '#111827',
                  marginTop: s.gapTop ?? 0,
                  marginBottom: 5,
                  lineHeight: 1.35,
                }}
              >
                {p.text || ' '}
              </RP.Text>
            )
          })}
        </RP.View>
        <RP.Text
          fixed
          style={{ position: 'absolute', bottom: 30, left: 64, right: 64, fontSize: 8, color: '#B91C1C', fontFamily: 'Helvetica-Bold', textAlign: 'center' }}
        >
          LAW ENFORCEMENT SENSITIVE
        </RP.Text>
        <RP.Text
          fixed
          style={{ position: 'absolute', bottom: 18, left: 64, right: 64, fontSize: 8, color: '#64748B', textAlign: 'center' }}
          render={({ pageNumber, totalPages }) => `${title} — page ${pageNumber} of ${totalPages}`}
        />
      </RP.Page>
    </RP.Document>
  )
  const blob = await RP.pdf(doc).toBlob()
  downloadBlob(blob, filename)
}
