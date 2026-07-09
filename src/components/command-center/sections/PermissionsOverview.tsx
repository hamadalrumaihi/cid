'use client'

/** Command Center → Permissions. A read-only view of the access matrix so
 *  command staff can see who can do what without needing owner access. Reuses
 *  the single matrix defined in the Owner Portal data module. */
import { PERMISSIONS_MATRIX, MATRIX_NOTE } from '@/components/owner/ownerData'

export function PermissionsOverview() {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-ink-900/45">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Command</th>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Inactive</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {PERMISSIONS_MATRIX.map((r) => (
              <tr key={r.area}>
                <td className="px-4 py-2.5 font-semibold text-white">{r.area}</td>
                <td className="px-4 py-2.5 text-slate-300">{r.owner}</td>
                <td className="px-4 py-2.5 text-slate-300">{r.command}</td>
                <td className="px-4 py-2.5 text-slate-300">{r.member}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.inactive}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">{MATRIX_NOTE}</p>
    </div>
  )
}
