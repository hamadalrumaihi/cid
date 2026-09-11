'use client'

/** Documents — the case's document record in six sections (platform
 *  upgrade §5.2): Reports, Evidence Documents, Legal Documents, Generated
 *  Documents, Case Packets, Document Tools; plus the case's processing jobs
 *  underneath. ONE fetch (lib/documents.fetchCaseDocuments) feeds every
 *  section, refetched on the case-scoped realtime channels (media, reports,
 *  legal_requests, case_packets, background_jobs) and the extraction table.
 *
 *  Absence is the permission answer everywhere here: sealed legal rows,
 *  restricted media and other people's jobs simply are not in the lists. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { SectionTabs, panelDomId, tabDomId, type SectionTab } from '@/components/ui/SectionTabs'
import { list, withRetry } from '@/lib/db'
import { fetchCaseDocuments, type CaseDocuments, type MediaRow } from '@/lib/documents'
import { useCaseTableVersion, useTableVersion } from '@/lib/realtime'
import { CasePacketsSection } from './documents/CasePacketsSection'
import { DocumentToolsSection } from './documents/DocumentToolsSection'
import { EvidenceDocumentsSection } from './documents/EvidenceDocumentsSection'
import { GeneratePacketDialog } from './documents/GeneratePacketDialog'
import { GeneratedDocumentsSection } from './documents/GeneratedDocumentsSection'
import { JobsTray } from './documents/JobsTray'
import { LegalDocumentsSection } from './documents/LegalDocumentsSection'
import { ReportsSection } from './documents/ReportsSection'
import type { CaseRow } from './shared'

const SECTIONS = ['reports', 'evidence', 'legal', 'generated', 'packets', 'tools'] as const
type SectionId = (typeof SECTIONS)[number]
const isSectionId = (s: string | null): s is SectionId => !!s && (SECTIONS as readonly string[]).includes(s)
const SECTION_LABEL: Record<SectionId, string> = {
  reports: 'Reports', evidence: 'Evidence Documents', legal: 'Legal Documents', generated: 'Generated Documents', packets: 'Case Packets', tools: 'Document Tools',
}

export function DocumentsTab({ c, canEdit }: { c: CaseRow; canEdit: boolean }) {
  const sp = useSearchParams()
  // Deep links: `?doc=<section>` names a section; `?packet=` (Action Center /
  // notifications) lands on Case Packets, `?media=` on Evidence Documents;
  // otherwise Reports. The section mirrors back into `?doc=` through the
  // history API (CaseDetail's idiom) so a copied URL reopens the same list.
  const docParam = sp.get('doc')
  const initial: SectionId = isSectionId(docParam) ? docParam : sp.get('packet') ? 'packets' : sp.get('media') ? 'evidence' : 'reports'
  const [section, setSectionState] = useState<SectionId>(initial)
  const setSection = useCallback((next: SectionId) => {
    setSectionState(next)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('doc', next)
      window.history.replaceState(window.history.state, '', url.toString())
    } catch { /* the section still switches; only the address stays put */ }
  }, [])
  const [data, setData] = useState<CaseDocuments | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [generateOpen, setGenerateOpen] = useState(false)

  const vM = useCaseTableVersion('media', c.id)
  const vR = useCaseTableVersion('reports', c.id)
  const vL = useCaseTableVersion('legal_requests', c.id)
  const vP = useCaseTableVersion('case_packets', c.id)
  const vJ = useCaseTableVersion('background_jobs', c.id)
  const vX = useTableVersion('document_extractions')
  const refresh = useCallback(async () => {
    try {
      setData(await withRetry(() => fetchCaseDocuments(c.id)))
      setError(null)
    } catch (e) { setError(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vM, vR, vL, vP, vJ, vX])

  const mediaById = useMemo(() => {
    const map = new Map<string, MediaRow>()
    for (const d of data?.evidenceDocs ?? []) map.set(d.media.id, d.media)
    for (const m of data?.generated ?? []) map.set(m.id, m)
    return map
  }, [data])
  const resolveMedia = useCallback(async (id: string): Promise<MediaRow | null> => {
    const hit = mediaById.get(id)
    if (hit) return hit
    try { return (await list('media', { eq: { id }, limit: 1 }))[0] ?? null } catch { return null }
  }, [mediaById])
  const parentTitle = useCallback((id: string | null) => (id ? mediaById.get(id)?.title ?? null : null), [mediaById])
  const toolInputs = useMemo(() => [...(data?.evidenceDocs.map((d) => d.media) ?? []), ...(data?.generated ?? [])], [data])

  const tabs: SectionTab<SectionId>[] = SECTIONS.map((id) => ({
    id,
    label: SECTION_LABEL[id],
    count: id === 'tools' ? undefined
      : id === 'reports' ? data?.reports.length
      : id === 'evidence' ? data?.evidenceDocs.length
      : id === 'legal' ? data?.legal.length
      : id === 'generated' ? data?.generated.length
      : data?.packets.length,
  }))

  let body: React.ReactNode
  if (error) body = <ErrorNotice message={error} onRetry={() => void refresh()} />
  else if (!data) body = <ListSkeleton count={4} />
  else if (section === 'reports') body = <ReportsSection c={c} rows={data.reports} />
  else if (section === 'evidence') body = <EvidenceDocumentsSection caseId={c.id} docs={data.evidenceDocs} resolveMedia={resolveMedia} onChanged={() => void refresh()} />
  else if (section === 'legal') body = <LegalDocumentsSection rows={data.legal} />
  else if (section === 'generated') body = <GeneratedDocumentsSection rows={data.generated} parentTitle={parentTitle} />
  else if (section === 'packets') body = <CasePacketsSection packets={data.packets} onGenerate={() => setGenerateOpen(true)} onChanged={() => void refresh()} />
  else body = <DocumentToolsSection caseId={c.id} inputs={toolInputs} canEdit={canEdit && !c.archived_at} onChanged={() => void refresh()} />

  return (
    <div className="space-y-4">
      <SectionTabs<SectionId> tabs={tabs} active={section} onChange={setSection} idBase="case-documents" ariaLabel="Document sections" />
      <section role="tabpanel" id={panelDomId('case-documents', section)} aria-labelledby={tabDomId('case-documents', section)} tabIndex={0}>
        {body}
      </section>
      {data && <JobsTray jobs={data.jobs} onChanged={() => void refresh()} />}
      <GeneratePacketDialog open={generateOpen} c={c} onClose={() => setGenerateOpen(false)} onRequested={() => { setSection('packets'); void refresh() }} />
    </div>
  )
}
