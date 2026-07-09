'use client'

import { useState } from 'react'
import { update } from '@/lib/db'
import type { Json } from '@/lib/database.types'
import { fmtUSD } from '@/lib/format'
import { penalByCode, penalRecommend, penalSentence, penalSearch, penalTotals, type CaseCharge } from '@/lib/penal'
import { parseCharges } from '@/lib/jsonShapes'
import { toast } from '@/lib/toast'
import { Stat, type CaseRow } from './shared'

export function ChargesTab({ c, canEdit, onChanged }: { c: CaseRow; canEdit: boolean; onChanged: () => void }) {
  const charges = parseCharges(c.charges)
  const [q, setQ] = useState('')
  const totals = penalTotals(charges)
  const save = async (next: CaseCharge[]) => {
    const res = await update('cases', c.id, { charges: next as unknown as Json })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Charges updated.', 'success'); onChanged() }
  }
  const addCode = (code: string) => {
    const found = charges.find((x) => x.code === code)
    void save(found ? charges.map((x) => x.code === code ? { ...x, count: (x.count || 1) + 1 } : x) : [...charges, { code, count: 1 }])
  }
  const recommended = penalRecommend(`${c.title || ''} ${c.summary || ''}`, 8).filter((code) => !charges.some((x) => x.code === code))
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Charges" value={charges.reduce((n, x) => n + Math.max(1, x.count || 1), 0)} />
        <Stat label="Sentence" value={totals.judge ? `${penalSentence(totals.months)} + JUDGE` : penalSentence(totals.months)} />
        <Stat label="Fine" value={fmtUSD(totals.fine)} />
        <Stat label="RICO predicates" value={charges.filter((x) => penalByCode(x.code)?.rico).length} />
      </div>
      <div className="space-y-2">
        {charges.map((ch) => {
          const pc = penalByCode(ch.code)
          return <div key={ch.code} className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3"><div className="min-w-0 flex-1"><p className="font-bold text-white">{ch.code} - {pc?.title || 'Unknown charge'}</p><p className="text-xs text-slate-500">{pc?.level} - {pc?.jail == null ? 'JUDGE' : penalSentence(pc.jail)} - {fmtUSD(pc?.fine)}</p></div><span className="font-mono text-white">x{ch.count || 1}</span>{canEdit && <><button onClick={() => void addCode(ch.code)} className="rounded bg-white/10 px-2 py-1 text-sm text-white">+</button><button onClick={() => void save(charges.map((x) => x.code === ch.code ? { ...x, count: Math.max(1, (x.count || 1) - 1) } : x))} className="rounded bg-white/10 px-2 py-1 text-sm text-white">-</button><button onClick={() => void save(charges.filter((x) => x.code !== ch.code))} className="text-sm font-bold text-rose-300">Remove</button></>}</div>
        })}
        {!charges.length && <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-500">No charges attached.</p>}
      </div>
      {canEdit && <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search penal code" className="mb-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        {!!recommended.length && <div className="mb-3 flex flex-wrap gap-2">{recommended.map((code) => <button key={code} onClick={() => addCode(code)} className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-200">Recommend {code}</button>)}</div>}
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {penalSearch(q).slice(0, 40).map((pc) => <button key={pc.code} onClick={() => addCode(pc.code)} className="block w-full rounded-lg border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10"><span className="font-mono text-badge-200">{pc.code}</span> <span className="font-bold text-white">{pc.title}</span><span className="ml-2 text-xs text-slate-500">{pc.level}{pc.rico ? ' - RICO' : ''}</span></button>)}
        </div>
      </div>}
    </div>
  )
}
