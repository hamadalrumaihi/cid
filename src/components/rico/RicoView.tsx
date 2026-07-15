'use client'

/** Standalone RICO Element Tracker — port of vanilla rico.js renderRico. The
 *  tracker itself is the shared RicoTab (same component the case detail
 *  embeds); this view wraps it with a case picker and the predicate-summary
 *  .docx export. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { downloadDocx, type DocxPara } from '@/lib/docx'
import { fmtDate, slug } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { RicoTab } from '@/components/cases/CaseDetail'

type CaseRow = Tables<'cases'>

export function RicoView() {
  const { state, canEdit, canDelete } = useAuth()
  const [cases, setCases] = useState<CaseRow[]>([])
  const [caseId, setCaseId] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    try {
      const rows = await list('cases', { order: 'updated_at', ascending: false })
      setCases(rows)
      setCaseId((prev) => prev || rows[0]?.id || '')
    } catch {
      setCases([])
      toast("Couldn't load cases — check your connection.", 'danger')
    }
    finally { setLoading(false) }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const current = cases.find((c) => c.id === caseId) ?? null

  const exportDocx = async () => {
    if (!current) { toast('Pick a case first.', 'warn'); return }
    let rico: Tables<'rico_cases'> | null = null
    let preds: Tables<'predicate_acts'>[] = []
    let gang: Tables<'gangs'> | null = null
    try {
      const rows = await list('rico_cases', { eq: { case_id: current.id } })
      rico = rows[0] ?? null
      if (rico) {
        preds = await list('predicate_acts', { order: 'act_date', eq: { rico_case_id: rico.id } })
        if (rico.enterprise_gang_id) gang = (await list('gangs', { eq: { id: rico.enterprise_gang_id } }))[0] ?? null
      }
    } catch { /* export what we have */ }
    const P: DocxPara[] = [
      { text: 'Criminal Investigation Division — State of San Andreas', style: 'subtitle' },
      { text: 'RICO Predicate Summary', style: 'title' },
      { text: `${current.case_number}  ·  Prepared ${fmtDate(new Date())}`, style: 'subtitle' },
      { text: '', style: 'normal' },
      { text: 'Enterprise', style: 'heading' },
      { text: gang ? `${gang.name}${gang.threat_level ? ` — threat ${gang.threat_level}` : ''}` : 'Not defined', style: 'normal' },
      { text: 'Pattern of Racketeering — Predicate Acts', style: 'heading' },
    ]
    if (!preds.length) P.push({ text: 'No predicate acts logged.', style: 'normal' })
    preds.forEach((p, i) => P.push({
      text: `${i + 1}. ${p.predicate_type} — ${p.act_date || 'no date'} — evidence: ${p.evidence_id ? 'linked case evidence' : (p.evidence_ref || 'none')}${p.note ? ` — ${p.note}` : ''}`,
      style: 'normal',
    }))
    P.push({ text: '', style: 'normal' })
    P.push({ text: 'Disclaimer: organizational tracking aid only; predicate sufficiency is a prosecutor’s determination.', style: 'subtitle' })
    downloadDocx('RICO Predicate Summary', P, `${slug(current.case_number)}-rico-summary.docx`)
    toast('RICO Predicate Summary exported as .docx', 'success')
  }

  if (state !== 'in') return <Notice text="Sign in to use the RICO tracker." />

  return (
    <div>
      <Card pad="lg" className="mb-6">
        <PageHeader
          title="⚖️ RICO Element Tracker"
          subtitle="Assemble & track enterprise + pattern-of-racketeering elements per case."
        />
        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          ⚠️ Organizational tool only — not legal advice. Predicate-act sufficiency and charging decisions are a prosecutor&rsquo;s determination.
        </p>
      </Card>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400" htmlFor="rico-case">Case</label>
        <select id="rico-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} className="rounded-lg border border-white/10 bg-ink-850 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
          {!cases.length && <option value="">— no cases —</option>}
          {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number} · {c.title || 'Untitled'}</option>)}
        </select>
        <Button className="ml-auto" onClick={() => void exportDocx()}>
          Export Predicate Summary (.docx)
        </Button>
      </div>
      {loading ? (
        <Notice text="Loading cases…" />
      ) : !current ? (
        <Notice text="No case selected — create a case in Case Files first." />
      ) : (
        <RicoTab key={current.id} c={current} canEdit={canEdit} canDelete={canDelete} />
      )}
    </div>
  )
}
