'use client'

/** Oversight → document-governance warnings. Read-only surface (spec §33):
 *  each row is a WARNING for a human to chase, never an automatic incident.
 *  Derived from the same RLS-scoped shelf projection + pure docModel rules
 *  the library itself uses, so Oversight and the shelf can never disagree.
 *  Broken-internal-link scanning needs full bodies and is deliberately not
 *  done here (documented limitation — the reader validates its own links). */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { list } from '@/lib/db'
import { fmtDate } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { Badge } from '@/components/ui/Badge'
import {
  SHELF_COLS, docTitle, isExpired, reviewState,
  type ShelfDoc, type SyncStatus, SYNC_LABEL,
} from '@/components/sops/docModel'

interface CampaignLite { id: string; document_id: string; deadline: string | null; status: string }

interface Warning { key: string; docId: string; title: string; label: string; detail: string; tone: 'warn' | 'danger' }

export function DocGovernanceWarnings() {
  const [docs, setDocs] = useState<ShelfDoc[] | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const nowMs = useNow()

  useEffect(() => {
    const t = window.setTimeout(async () => {
      try {
        setDocs(await list('documents', { select: SHELF_COLS }) as unknown as ShelfDoc[])
        setCampaigns(await list('document_reading_campaigns', {
          select: 'id,document_id,deadline,status', eq: { status: 'active' },
        }).catch(() => []) as CampaignLite[])
      } catch { setDocs([]) }
    }, 0)
    return () => window.clearTimeout(t)
  }, [])

  if (docs === null) return null

  const byId = new Map(docs.map((d) => [d.id, d]))
  const warnings: Warning[] = []
  for (const d of docs) {
    const title = docTitle(d.name)
    if (d.status === 'published' && isExpired(d, nowMs)) {
      warnings.push({ key: `exp:${d.id}`, docId: d.id, title, tone: 'danger', label: 'Expired but still published', detail: `Expired ${fmtDate(d.expires_at)}` })
    }
    if (reviewState(d, nowMs) === 'overdue') {
      warnings.push({ key: `rev:${d.id}`, docId: d.id, title, tone: 'warn', label: 'Review overdue', detail: `Was due ${fmtDate(d.review_due_at)}` })
    }
    if (d.mandatory && !d.owner_user_id) {
      warnings.push({ key: `own:${d.id}`, docId: d.id, title, tone: 'warn', label: 'Mandatory document without an owner', detail: 'Assign a responsible owner' })
    }
    if (d.status === 'published' && d.approval_required && !d.approved_by) {
      warnings.push({ key: `appr:${d.id}`, docId: d.id, title, tone: 'warn', label: 'Published without recorded approval', detail: 'Approval is required for this document' })
    }
    if (d.sync_status === 'conflict' || d.sync_status === 'error') {
      warnings.push({ key: `sync:${d.id}`, docId: d.id, title, tone: 'danger', label: SYNC_LABEL[d.sync_status as SyncStatus], detail: 'Resolve from the document page' })
    }
  }
  for (const c of campaigns) {
    if (c.deadline && Date.parse(c.deadline) < nowMs) {
      const d = byId.get(c.document_id)
      warnings.push({
        key: `camp:${c.id}`, docId: c.document_id, title: d ? docTitle(d.name) : 'Document',
        tone: 'warn', label: 'Required-reading deadline passed',
        detail: `Campaign deadline was ${fmtDate(c.deadline)} — check completion`,
      })
    }
  }

  return (
    <section className="rounded-2xl border border-white/5 bg-ink-900/45 p-5">
      <h3 className="mb-1 font-bold text-white">Document governance <span className="text-slate-500">({warnings.length})</span></h3>
      <p className="mb-3 text-xs text-slate-400">Library warnings needing a human decision — expiries, overdue reviews, missing owners/approvals, Drive conflicts, and lapsed required-reading deadlines.</p>
      {warnings.length ? (
        <ul className="space-y-2">
          {warnings.map((w) => (
            <li key={w.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-ink-950/40 px-4 py-2.5">
              <div className="min-w-0">
                <Link href={`/sops?doc=${w.docId}`} className="text-sm font-semibold text-white hover:text-badge-200">{w.title}</Link>
                <p className="text-[11px] text-slate-400">{w.detail}</p>
              </div>
              <Badge tone={w.tone}>{w.label}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-emerald-300">✓ No governance warnings.</p>
      )}
    </section>
  )
}
