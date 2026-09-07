'use client'

import { DocumentIcon, EyeIcon, RadioIcon, ReceiptIcon, ReportIcon, ScaleIcon, SearchIcon } from '@/components/shell/icons'

/** Report-template glyphs, drawn from the shared icon set (was an emoji map in
 *  lib/forms). Keyed by template key; DB-only templates get the document. */
export function TemplateIcon({ id }: { id: string }) {
  switch (id) {
    case 'raid_seizure': return <ReceiptIcon size={14} />
    case 'uc_operation': return <EyeIcon size={14} />
    case 'arrest_warrant': case 'subpoena': case 'warrant_return': return <ScaleIcon size={14} />
    case 'search_warrant': case 'search_report': return <SearchIcon className="h-3.5 w-3.5" />
    case 'wiretap_warrant': case 'surveillance_report': return <RadioIcon size={14} />
    case 'cid_investigative_report': case 'incident_followup': case 'case_closure': return <ReportIcon size={14} />
    default: return <DocumentIcon size={14} />
  }
}
