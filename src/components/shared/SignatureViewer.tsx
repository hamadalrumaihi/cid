'use client'

/** Shared signature viewer (v1.14) — the legal version-bound signature block
 *  promoted portal-wide (adoption register: "signature display tied to
 *  immutable versions"). Purely presentational: what a signature AUTHORIZES
 *  stays domain-specific (a prosecutor signature never satisfies judicial
 *  approval; a detective seal never satisfies command sign-off). */

export interface SignatureItem {
  id: string
  name: string
  /** Authority snapshot at signing time ("District Attorney", "detective"). */
  role?: string | null
  /** What the signature covers ("judge decision", "report seal"). */
  action?: string | null
  at?: string | null
  badge?: string | null
  /** Version binding label ("v2") when the signed artifact is versioned. */
  versionLabel?: string | null
  /** Superseded signatures (e.g. a reopened report's previous seal). */
  superseded?: boolean
}

export function SignatureViewer({ signatures, empty = 'No signatures recorded.' }: {
  signatures: SignatureItem[]
  empty?: string
}) {
  if (signatures.length === 0) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <ul className="space-y-1">
      {signatures.map((s) => (
        <li key={s.id} className={`flex flex-wrap items-center gap-2 text-sm ${s.superseded ? 'opacity-60' : ''}`}>
          <span className="font-semibold text-white">✍ {s.name}</span>
          {s.badge && <span className="font-mono text-xs text-slate-500">#{s.badge}</span>}
          {s.role && <span className="text-xs text-slate-500">({s.role})</span>}
          {s.action && <span className="text-xs text-slate-400">{s.action}</span>}
          {s.versionLabel && <span className="font-mono text-xs text-blue-300">{s.versionLabel}</span>}
          {s.at && <span className="text-xs text-slate-500">{new Date(s.at).toLocaleString()}</span>}
          {s.superseded && (
            <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 text-[10px] font-semibold text-amber-300">superseded</span>
          )}
        </li>
      ))}
    </ul>
  )
}
