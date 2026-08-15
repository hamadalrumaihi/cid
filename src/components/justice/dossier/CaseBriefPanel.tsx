'use client'

/** Case brief for JUSTICE viewers (prosecutor / judge / AG) — fed by the
 *  legal_request_case_brief() definer RPC (20260818120000): a one-line case
 *  summary plus ONLY the material the request references (exhibits,
 *  finalized-report content, media metadata). This is the ONLY case data a
 *  justice user receives — database-enforced, never full case access — so
 *  nothing here links to /cases routes. An {error} payload (or any malformed
 *  shape) hides the panel entirely. */
import { useEffect, useState } from 'react'
import { rpc } from '@/lib/db'
import { humanize } from '@/lib/legalWorkflow'
import { parseLegalFormEntries } from '@/lib/schemas'
import type { Json } from '@/lib/database.types'
import { Badge } from '@/components/ui/Badge'

interface BriefCase {
  number: string | null
  title: string | null
  status: string | null
  stage: string | null
  assigned_unit: string | null
  responsible_bureau: string | null
}
interface BriefExhibit { id: string; type: string | null; title: string | null; rationale: string | null }
interface BriefReport { id: string; template: string | null; finalized: boolean; fields: Json | null }
interface BriefMedia {
  id: string
  title: string | null
  type: string | null
  external_url: string | null
  evidence_ref: string | null
}
interface Brief {
  case: BriefCase
  exhibits: BriefExhibit[]
  referenced_reports: BriefReport[]
  referenced_media: BriefMedia[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : []

/** Defensive parse of the jsonb payload — {error} or malformed → null. */
function parseBrief(data: unknown): Brief | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  if ('error' in o) return null
  const c = o.case
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null
  const cc = c as Record<string, unknown>
  return {
    case: {
      number: str(cc.number), title: str(cc.title), status: str(cc.status),
      stage: str(cc.stage), assigned_unit: str(cc.assigned_unit),
      responsible_bureau: str(cc.responsible_bureau),
    },
    exhibits: rows(o.exhibits).map((x) => ({
      id: String(x.id ?? ''), type: str(x.type), title: str(x.title), rationale: str(x.rationale),
    })),
    referenced_reports: rows(o.referenced_reports).map((x) => ({
      id: String(x.id ?? ''), template: str(x.template), finalized: x.finalized === true,
      fields: (x.fields ?? null) as Json | null,
    })),
    referenced_media: rows(o.referenced_media).map((x) => ({
      id: String(x.id ?? ''), title: str(x.title), type: str(x.type),
      external_url: str(x.external_url), evidence_ref: str(x.evidence_ref),
    })),
  }
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{children}</h4>
}

export function CaseBriefPanel({ requestId }: { requestId: string }) {
  const [brief, setBrief] = useState<Brief | null>(null)
  useEffect(() => {
    let cancelled = false
    void rpc('legal_request_case_brief', { p_request: requestId }).then((res) => {
      if (cancelled) return
      setBrief(res.error ? null : parseBrief(res.data))
    })
    return () => { cancelled = true }
  }, [requestId])

  if (!brief) return null
  const c = brief.case

  return (
    <details className="rounded-2xl border border-white/5 bg-ink-900/60">
      <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5 hover:bg-white/5">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Case brief</span>
        <span className="text-xs text-slate-400">
          Referenced material only — this is your complete case access.
        </span>
      </summary>
      <div className="space-y-4 border-t border-white/5 px-4 py-3">
        {/* ── Case summary line ─────────────────────────────────────────── */}
        <div>
          <p className="text-sm">
            <span className="font-mono text-blue-300">{c.number ?? '—'}</span>
            <span className="ml-2 font-semibold text-white">{c.title ?? 'Untitled case'}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Status: <span className="text-slate-200">{humanize(c.status) || '—'}</span>
            <span aria-hidden> · </span>
            Stage: <span className="text-slate-200">{humanize(c.stage) || '—'}</span>
            <span aria-hidden> · </span>
            Assigned unit: <span className="text-slate-200">{c.assigned_unit ?? '—'}</span>
            <span aria-hidden> · </span>
            Responsible bureau: <span className="text-slate-200">{c.responsible_bureau ?? '—'}</span>
          </p>
        </div>

        {/* ── Referenced reports (frozen finalized content) ─────────────── */}
        {brief.referenced_reports.length > 0 && (
          <section className="space-y-2">
            <GroupHeading>Referenced reports ({brief.referenced_reports.length})</GroupHeading>
            <ul className="space-y-2">
              {brief.referenced_reports.map((rep) => {
                const entries = parseLegalFormEntries(rep.fields)
                return (
                  <li key={rep.id} className="rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-200">{humanize(rep.template) || 'Report'}</span>
                      <Badge tone={rep.finalized ? 'good' : 'warn'}>{rep.finalized ? 'Finalized' : 'Not finalized'}</Badge>
                    </div>
                    {entries.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {entries.map(([k, v]) => (
                          <p key={k} className="text-sm text-slate-300">
                            <span className="text-xs font-semibold text-slate-400">{humanize(k)}: </span>
                            <span className="whitespace-pre-wrap">{v}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* ── Referenced media (metadata only) ──────────────────────────── */}
        {brief.referenced_media.length > 0 && (
          <section className="space-y-2">
            <GroupHeading>Referenced media ({brief.referenced_media.length})</GroupHeading>
            <ul className="space-y-1.5">
              {brief.referenced_media.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2 text-sm">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{humanize(m.type) || 'Media'}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-200">{m.title ?? 'Untitled'}</span>
                  {m.evidence_ref && <Badge tone="accent">{m.evidence_ref}</Badge>}
                  {m.external_url && (
                    <a
                      href={m.external_url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded text-xs font-semibold text-badge-200 hover:text-white"
                    >
                      Open link ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Exhibits ──────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <GroupHeading>Exhibits ({brief.exhibits.length})</GroupHeading>
          {brief.exhibits.length === 0 ? (
            <p className="text-sm text-slate-400">No exhibits are attached to this request.</p>
          ) : (
            <ul className="space-y-1.5">
              {brief.exhibits.map((e) => (
                <li key={e.id} className="flex items-start gap-2 rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2 text-sm">
                  <span className="mt-0.5 flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {humanize(e.type) || 'Item'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-slate-200">{e.title ?? 'Untitled'}</span>
                    {e.rationale && <span className="block text-xs text-slate-400">{e.rationale}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  )
}
