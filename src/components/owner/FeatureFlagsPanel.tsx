'use client'

/** Owner Console → System Health → Feature flags (platform upgrade §2.1).
 *  One switch per key with what it enables and which service it needs;
 *  the flip goes through `feature_flag_set` (Owner-only, audited
 *  FEATURE_FLAG_SET) and lands on every session through realtime. A
 *  build-time `NEXT_PUBLIC_ENABLE_<KEY>` override is shown as such — the
 *  row can still be flipped, but THIS build ignores it. */
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_META, envOverride, resolveFlag, setFlag, useFeatureFlags, type FeatureFlagKey } from '@/lib/flags'
import { timeAgo } from '@/lib/format'
import { humanizeError, toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { OwnerPanel } from './OwnerPanel'

function FlagSwitch({ flag, on, disabled, onToggle }: { flag: FeatureFlagKey; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${FEATURE_FLAG_META[flag].label}: ${on ? 'on' : 'off'}`}
      disabled={disabled}
      onClick={onToggle}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-1 transition disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-9"
    >
      <span aria-hidden className={`relative inline-block h-6 w-11 rounded-full transition ${on ? 'bg-badge-500' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? 'left-[1.375rem]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

export function FeatureFlagsPanel() {
  const flags = useFeatureFlags()

  const toggle = async (key: FeatureFlagKey) => {
    const next = !(flags.rows[key] === true)
    const r = await setFlag(key, next)
    if (r.error) { toast(humanizeError(r.error.message), 'danger'); return }
    toast(`${FEATURE_FLAG_META[key].label} ${next ? 'enabled' : 'disabled'}.`, 'success')
  }

  return (
    <OwnerPanel title="Feature flags" sub="Every optional capability ships behind a row in feature_flags. Flipping one changes which adapter the client calls — never what a member may read; RLS is the wall either way. Flags whose service is not deployed stay off.">
      {flags.error && !flags.loaded ? <ErrorNotice message={flags.error} onRetry={() => void flags.fetch()} /> : !flags.loaded ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <ul className="divide-y divide-white/5">
          {FEATURE_FLAG_KEYS.map((key) => {
            const meta = FEATURE_FLAG_META[key]
            const row = flags.rows[key] === true
            const override = envOverride(key)
            const effective = resolveFlag(key, flags.rows)
            const note = flags.notes[key]
            const at = flags.updatedAt[key]
            return (
              <li key={key} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                    {meta.label}
                    <span className="font-mono text-[11px] text-slate-400">{key}</span>
                    {override !== null && <Badge tone="warn" title="NEXT_PUBLIC_ENABLE override in this build">env: {override ? 'on' : 'off'}</Badge>}
                    {effective !== row && <Badge tone="neutral">effective: {effective ? 'on' : 'off'}</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-300">{meta.enables}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {meta.needs ? `Needs: ${meta.needs}` : 'No external service needed'}
                    {at ? ` · updated ${timeAgo(at)}` : ''}
                  </p>
                  {note && <p className="mt-1 text-xs text-slate-300">Note: {note}</p>}
                </div>
                <FlagSwitch flag={key} on={row} disabled={false} onToggle={() => void toggle(key)} />
              </li>
            )
          })}
        </ul>
      )}
    </OwnerPanel>
  )
}
