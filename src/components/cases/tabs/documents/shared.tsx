'use client'

/** Pieces the Documents sections share: opening a signed URL that must be
 *  minted first (without tripping the popup blocker), the view/download
 *  custody log, and the compact document row chips. */
import { Badge } from '@/components/ui/Badge'
import { documentUrl, logDocumentAccess, openPageUrl, type MediaRow } from '@/lib/documents'
import { evidenceNumberOf } from '@/lib/evidence'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'

/** Open a URL that has to be minted first. The tab is opened SYNCHRONOUSLY
 *  on the click (so the popup blocker sees a user gesture), then receives
 *  the address once the signed URL exists; a refused sign closes it again. */
export async function openMinted(getUrl: () => Promise<string | null>): Promise<boolean> {
  const w = window.open('about:blank', '_blank')
  let url: string | null = null
  try { url = await getUrl() } catch { url = null }
  const safe = url ? safeUrl(url) : ''
  if (!safe) {
    w?.close()
    toast('The file could not be opened — it may not exist yet or you may not have access to it.', 'danger')
    return false
  }
  if (w) {
    try { w.opener = null } catch { /* cross-origin about:blank never throws, but be safe */ }
    w.location.href = safe
  } else {
    window.location.assign(safe)
  }
  return true
}

/** Open a document (optionally at a page) and record the view. */
export function openDocument(m: MediaRow, page?: number | null): Promise<boolean> {
  logDocumentAccess(m, 'viewed')
  return openMinted(async () => {
    const url = await documentUrl(m)
    return url ? openPageUrl(url, page) : null
  })
}

/** Evidence number chip (registered `evidence_number`, else the legacy
 *  `evidence_ref`), or nothing. */
export function EvidenceChip({ m }: { m: Pick<MediaRow, 'evidence_number' | 'evidence_ref'> }) {
  const n = evidenceNumberOf(m)
  return n ? <Badge tone="accent" title="Evidence number"><span className="font-mono" translate="no">{n}</span></Badge> : null
}

export const ROW_ACTION =
  'inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-1.5'
