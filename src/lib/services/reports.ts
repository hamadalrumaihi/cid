/** Shared report operations — thin typed wrapper over the server-authoritative
 *  report_create RPC (20261002130000_shared_case_services), the create path
 *  both the web portal and the future FiveM lane share. The server computes
 *  seq (max+1 per case/template/kind under a lock) and pins author_id to the
 *  caller — neither is client-supplied anymore. Editing an existing report is
 *  unchanged (a plain RLS-scoped fields update); finalize/reopen stay on
 *  their existing RPCs. */
import { rpc, type MutationResult } from '@/lib/db'
import type { Json, Tables } from '@/lib/database.types'

type ReportRow = Tables<'reports'>

export async function createReport(args: {
  caseId: string
  template: string
  /** 'initial' | 'supplemental' | 'followup'. Omit to let the server derive
   *  it from fields.report_type exactly as the Reports tab does. */
  kind?: ReportRow['kind']
  fields: Json
}): Promise<MutationResult<ReportRow>> {
  return rpc('report_create', {
    p_case: args.caseId,
    p_template: args.template,
    p_kind: args.kind ?? undefined,
    p_fields: args.fields,
  })
}
