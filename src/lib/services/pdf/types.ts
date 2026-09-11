/** PDF service adapter — the seam components talk to for anything that
 *  produces a PDF (document tools, case packets). One interface; the
 *  provider behind it (the in-Supabase runner with pdf-lib, or Stirling PDF
 *  via the worker) is the server's choice, never the component's. */
import type { DocumentToolId, ToolOptions } from '@/lib/documents'
import type { JsonRpcOutcome, PacketRequestOptions, PacketRequestResult, PacketSectionId, PacketType } from '@/lib/packets'

export type ToolRequestResult = JsonRpcOutcome<{ job_id?: string }>

export interface PdfService {
  /** Enqueue a document tool over case documents → `{job_id}`. */
  requestTool(caseId: string, tool: DocumentToolId, mediaIds: readonly string[], options?: ToolOptions): Promise<ToolRequestResult>
  /** Enqueue a case packet render → `{id, job_id}`. `sections` null = the
   *  server preset for the type. */
  requestPacket(caseId: string, type: PacketType, sections: readonly PacketSectionId[] | null, options?: PacketRequestOptions): Promise<PacketRequestResult>
}
