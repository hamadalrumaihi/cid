'use client'

/** Permanent deletion — the Owner console entry point (Phase B).
 *
 *  Deactivate / soft-remove (Command Center) remains the DEFAULT way to part
 *  with a member: it keeps history intact and is reversible. This screen is the
 *  exception path, and it is a member PICKER plus the shared PermanentDelete
 *  flow — the same component the Manage Officer modal and the Field
 *  Intelligence access roster render inline. One deletion system, three places
 *  to reach it.
 *
 *  What this screen adds over the inline callers is the full reference
 *  breakdown: every table.column the member touches, bucketed into blockers,
 *  active work, repointed provenance and rows that go with the account. Same
 *  preview object either way — the console just shows all of it.
 */
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { bureauLabel, roleLabel } from '@/lib/roles'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/PageHeader'
import { inputCls, labelCls } from '@/components/ui/Field'
import { PermanentDelete, type DeletePreview } from './PermanentDelete'

/** Per-table.column count list. Blockers render highlighted (rose). */
function CountList({ counts, tone }: { counts: Record<string, number>; tone: 'blocker' | 'info' }) {
  const entries = Object.entries(counts)
  if (!entries.length) return <p className="text-sm text-emerald-300">none</p>
  return (
    <ul className="space-y-0.5">
      {entries.sort(([a], [b]) => a.localeCompare(b)).map(([ref, n]) => (
        <li key={ref} className={`font-mono text-xs ${tone === 'blocker' ? 'text-rose-300' : 'text-slate-300'}`}>
          {ref} <b className={tone === 'blocker' ? 'text-rose-200' : 'text-white'}>{n}</b>
        </li>
      ))}
    </ul>
  )
}

function PreviewBucket({ title, sub, counts, tone }: {
  title: string
  sub: string
  counts: Record<string, number>
  tone: 'blocker' | 'info'
}) {
  return (
    <div className={`rounded-lg border p-3 ${tone === 'blocker' ? 'border-rose-500/25 bg-rose-500/5' : 'border-white/10 bg-ink-950/50'}`}>
      <p className={`text-xs font-black uppercase tracking-wider ${tone === 'blocker' ? 'text-rose-300' : 'text-slate-400'}`}>{title}</p>
      <p className="mb-2 mt-0.5 text-xs text-slate-400">{sub}</p>
      <CountList counts={counts} tone={tone} />
    </div>
  )
}

/** The console's long-form preview, handed to the shared flow. */
function FullPreview(preview: DeletePreview) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <PreviewBucket
        title="Hard blockers" tone="blocker"
        sub="Immutable records — these can never be cleared; the member must be kept (deactivated)."
        counts={preview.blockers}
      />
      <PreviewBucket
        title="Active-work blockers" tone="blocker"
        sub="Live pointers (case/gang leadership, pending sign-off) — reassign these first."
        counts={preview.active_work}
      />
      <PreviewBucket
        title="Repointed to 'Deleted Member'" tone="info"
        sub="Historical provenance columns rewritten to the tombstone on execute."
        counts={preview.repoint}
      />
      <PreviewBucket
        title="Deleted with the account" tone="info"
        sub="CASCADE rows (assignments, notifications, watchlist, role history — snapshotted into the ledger) plus the member's own justice request."
        counts={{ ...preview.cascade, ...preview.deleted, ...preview.set_null }}
      />
    </div>
  )
}

export function PermanentDeletionSection() {
  const { profile } = useAuth()
  const roster = useProfilesStore((s) => s.profiles)
  const [targetId, setTargetId] = useState('')

  useEffect(() => { void useProfilesStore.getState().fetch() }, [])

  const candidates = useMemo(() =>
    roster
      .filter((p) => p.id !== profile?.id && !p.is_system)
      .slice()
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')),
  [roster, profile?.id])

  const target = candidates.find((p) => p.id === targetId) ?? null

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-4">
        <p className="text-sm font-bold text-rose-200">This is irreversible.</p>
        <p className="mt-1 text-sm text-rose-200/80">
          Deactivating or removing a member (Command Center) remains the default and keeps history
          intact. Permanent deletion erases the account and its sign-in identity forever; historical
          references are repointed to the shared &ldquo;Deleted Member&rdquo; record and an owner-only ledger
          entry preserves the identity snapshot, the reason, and the member&rsquo;s role history. Members
          referenced by immutable records (legal requests, sign-off history, sealed reports, custody,
          tracker signatures, justice identity) can never be permanently deleted.
        </p>
      </div>

      <Card pad="md">
        <SectionHeader
          title="Choose a member"
          subtitle="The preview is read-only: it counts every reference the member holds — blockers first."
        />
        <div className="mt-3">
          <label htmlFor="pd-target" className={labelCls}>Member</label>
          <select
            id="pd-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className={inputCls}
          >
            <option value="">— select a member —</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name} · {roleLabel(p.role)}/{bureauLabel(p.division)}
                {p.removed_at ? ' · removed' : p.active ? '' : ' · inactive'}
              </option>
            ))}
          </select>
        </div>

        {target && (
          <div className="mt-4">
            <PermanentDelete
              key={target.id}
              targetId={target.id}
              targetName={target.display_name}
              renderPreview={FullPreview}
              onDeleted={() => setTargetId('')}
            />
          </div>
        )}
      </Card>
    </div>
  )
}
