'use client'

/** Person dossier → Accounts (spec D1 follow-up). Shows the social/online
 *  accounts linked to this person with their ownership confidence, so the
 *  account↔person tie is visible from the person side too. Read-only here;
 *  linking / confirming / unlinking lives in the Account Registry. */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { list } from '@/lib/db'
import { safeUrl } from '@/lib/safeUrl'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/Notice'

type LinkedAccount = {
  id: string
  ownership_confidence: string
  account_id: string
  accounts: { id: string; platform: string; handle: string; display_name: string | null; profile_url: string | null } | null
}

const CONF_TINT: Record<string, string> = {
  suspected: 'bg-slate-500/15 text-slate-300',
  probable: 'bg-amber-500/15 text-amber-300',
  confirmed: 'bg-emerald-500/15 text-emerald-300',
}

export function PersonAccountsSection({ personId }: { personId: string }) {
  const [rows, setRows] = useState<LinkedAccount[] | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await list('account_links', {
        select: 'id,ownership_confidence,account_id,accounts(id,platform,handle,display_name,profile_url)',
        eq: { person_id: personId }, order: 'created_at', ascending: false,
      })
      setRows(data as unknown as LinkedAccount[])
    } catch { setRows([]) }
  }, [personId])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])

  if (rows === null) return <p className="py-6 text-center text-sm text-slate-500">Loading linked accounts…</p>
  if (rows.length === 0) {
    return <EmptyState title="No linked accounts" hint="Link this person to a social/online account from the Account Registry." />
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Linked accounts</h3>
        <Link href="/accounts" className="text-xs font-semibold text-badge-300 hover:underline">Manage in registry →</Link>
      </div>
      <ul className="space-y-2">
        {rows.filter((r) => r.accounts).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-900/50 px-3 py-2">
            <Badge>{r.accounts!.platform}</Badge>
            <span className="font-semibold text-white">@{r.accounts!.handle}</span>
            {r.accounts!.display_name && <span className="text-sm text-slate-400">{r.accounts!.display_name}</span>}
            <Badge tint={CONF_TINT[r.ownership_confidence]}>{r.ownership_confidence}</Badge>
            {r.accounts!.profile_url && safeUrl(r.accounts!.profile_url) && (
              <a href={safeUrl(r.accounts!.profile_url)!} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-badge-300 hover:underline">Open ↗</a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
