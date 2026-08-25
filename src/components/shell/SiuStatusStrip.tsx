'use client'

/** Compact persistent SIU status strip — rendered by AppShell directly under
 *  the sub-tab strip whenever the viewer is INSIDE the SIU workspace. It names
 *  the authority they are acting under (workspace, standing, callsign, the
 *  pre-release gate) so a shared-registry screen is never mistaken for CID
 *  context. Per-record states (classification, compartment, disclosure,
 *  supporting access, recusal) live on the records themselves — this strip is
 *  the workspace-level layer, deliberately one quiet line, not a purple wash.
 *  It renders nothing for viewers without SIU standing, and nothing while the
 *  viewer is in the CID workspace: the strip marks context, it never leaks it. */
import { useSiu } from '@/lib/useSiu'
import { siuRoleLabel, siuCallsign } from '@/lib/siu'
import { LockIcon } from './icons'

export function SiuStatusStrip() {
  const siu = useSiu()
  if (!siu.inSiu) return null

  const who = siu.standing === 'owner'
    ? 'Portal Owner'
    : siu.standing === 'oversight'
      ? 'Oversight — no field authority'
      : siuRoleLabel(siu.membership?.siu_role)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-violet-500/15 bg-violet-500/[0.04] px-4 py-1.5 sm:px-6 lg:px-8" role="status" aria-label="SIB workspace status">
      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-300">
        <LockIcon size={12} /> SIB Workspace
      </span>
      <span className="text-[11px] text-slate-400">
        {siu.callsign ? `${siuCallsign(siu.callsign)} · ` : ''}{who}
      </span>
      {!siu.releaseOpen && siu.standing === 'owner' && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">Pre-release — owner only</span>
      )}
      <span className="ml-auto hidden text-[11px] text-slate-500 sm:block">
        Need-to-know by default · shared registries are RLS-scoped per viewer
      </span>
    </div>
  )
}
