'use client'

/** Raid compensation calculator (command.js:574-596) — local preview only,
 *  never saved; the authorized split is recorded on the Raid Seizure
 *  Allocation form. */
import { useState } from 'react'
import { fmtUSD } from '@/lib/format'
import { BRACKETS, COMP_SPLIT, findBracket } from './commandUtils'
import { Card } from '@/components/ui/Card'

export function RaidComp() {
  const [raw, setRaw] = useState('')
  const v = parseFloat(raw.replace(/[^0-9.]/g, '')) || 0
  const bracket = v >= BRACKETS[0].min ? findBracket(v) : null
  const given = bracket ? (v * bracket.pct) / 100 : 0
  const retain = v - given

  return (
    <Card pad="lg">
      <h3 className="mb-1 flex items-center gap-2 text-base font-semibold text-white"><span aria-hidden="true">💰</span> Raid Compensation Breakdown</h3>
      <p className="mb-4 text-xs text-slate-400">Official payout brackets applied to net seizure value, split across Primary Detective / Supporting Units / CIs.</p>
      <label htmlFor="comp-input" className="mb-1 block text-xs font-semibold text-slate-300">Total Net Seizure Value ($)</label>
      <div className="relative mb-3">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
        <input
          id="comp-input"
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-ink-850 py-2.5 pl-7 pr-3 font-mono text-white outline-none transition focus:border-badge-500"
        />
      </div>

      <div className="space-y-3">
        {!bracket ? (
          <p className="rounded-lg border border-white/5 bg-ink-850 p-4 text-sm text-slate-400">
            {v > 0 ? 'Below minimum bracket ($1,000,000).' : 'Enter a net seizure value to compute payouts.'}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-300/80">Applicable Bracket</span>
              <span className="font-mono text-lg font-bold text-blue-300">{bracket.pct}%</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">Compensation Pool</p>
                <p className="font-mono text-lg font-bold text-emerald-300">{fmtUSD(given)}</p>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-amber-300/80">Retained to Division</p>
                <p className="font-mono text-lg font-bold text-amber-300">{fmtUSD(retain)}</p>
              </div>
            </div>
            <div className="rounded-lg border border-white/5 bg-ink-850 p-3">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-400">Automated Payout Split</p>
              {Object.entries(COMP_SPLIT).map(([role, frac]) => (
                <div key={role} className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-slate-300">{role}</span>
                  <span className="font-mono font-semibold text-white">
                    {fmtUSD(given * frac)}
                    <span className="ml-1 text-[10px] text-slate-500">({frac * 100}%)</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="text-center text-[10px] italic text-slate-500">Local preview — not saved. Record the authorized split on the Raid Seizure Allocation form.</p>
          </>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-white/5">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-ink-800 uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2 font-semibold">Net Seizure</th>
              <th className="px-3 py-2 text-right font-semibold">% Given</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {BRACKETS.map((b) => (
              <tr key={b.min} className={bracket?.min === b.min ? 'bg-blue-500/10' : ''}>
                <td className="px-3 py-2 font-mono text-slate-300">{b.label}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-blue-300">{b.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
