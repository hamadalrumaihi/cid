'use client'

/** Intel groups on the record and in the queue (P6-03, decision IT6).
 *
 *  Three reports about the same stash house are one investigation. The group
 *  is a reviewer saying so — a title, a lead record, members, the cases the
 *  group feeds — and nothing else: no merge, no delete, no edit to a member.
 *  Every report keeps its own number and its own author.
 *
 *  Two components, both mounted by the review screen:
 *   - `IntelGroups` on the record: "Part of group X (n records)" chips, the
 *     suggestion panel built from `intel_group_suggest` (existing groups
 *     first, then the records to group), and the actions — each of which is
 *     an audited RPC that RAISES in its own words when it refuses.
 *   - `IntelGroupsList` in the queue: live groups with the lead's number,
 *     member and case counts, and a way into any member the reader can see.
 *
 *  Nothing here decides who may act: the buttons are cosmetic mirrors and the
 *  server is the authority. A record the reader cannot see is a COUNT, never a
 *  number — the summary says "1 record you cannot see" rather than pretending
 *  the group is smaller than it is.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { reviewerStatusLabel, type FieldSubmissionRow } from '@/lib/fieldSubmissions'
import {
  addToGroup, closeGroup, closedLine, createGroup, groupLine, hiddenLine, isLiveGroup,
  linkGroupCase, loadGroupSummary, loadGroups, loadGroupsFor, removeFromGroup, reopenGroup,
  sharedLine, suggestGroups, suggestionLine, summaryLine, unlinkGroupCase,
  type GroupListItem, type GroupMembership, type GroupSuggestion, type GroupSummary,
} from '@/lib/intelGroups'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { uiPrompt } from '@/components/ui/dialog'
import { EntityPicker } from '@/components/entity'

const caseName = (c: { case_number: string | null; title: string | null }): string =>
  `${c.case_number ? `${c.case_number} — ` : ''}${c.title || 'Untitled'}`

/** One title prompt for both create paths; null when the reviewer backed out. */
async function askTitle(hint: string): Promise<string | null> {
  const title = await uiPrompt(hint, {
    title: 'Name the group', placeholder: 'e.g. Grove Street stash, Sept reports', confirmText: 'Create group',
  })
  return title?.trim() || null
}

async function askReason(message: string, title: string, confirmText: string, placeholder: string): Promise<string | null> {
  const why = await uiPrompt(message, { title, placeholder, confirmText })
  return why?.trim() || null
}

// ---------------------------------------------------------------------------
// The record panel
// ---------------------------------------------------------------------------

export function IntelGroups({ submission, onChanged }: {
  submission: FieldSubmissionRow
  onChanged: () => void
}) {
  const { profile, isCommand } = useAuth()
  const id = submission.id
  const [memberships, setMemberships] = useState<GroupMembership[] | null>(null)
  const [suggestion, setSuggestion] = useState<GroupSuggestion>({ groups: [], submissions: [] })
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [joining, setJoining] = useState<GroupListItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const isDraft = submission.status === 'draft'

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([loadGroupsFor(id), suggestGroups(id)])
    setMemberships(m); setSuggestion(s)
    // Everything suggested starts selected: the reviewer prunes, then confirms.
    setPicked(new Set(s.submissions.map((x) => x.id)))
  }, [id])

  useEffect(() => {
    if (isDraft) return
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, isDraft])

  // A draft is the author's alone and cannot be grouped; the server refuses
  // it too. Nothing to show rather than a panel of buttons that all refuse.
  if (isDraft) return null

  const after = async (err: string | null, ok: string) => {
    if (err) { toast(err, 'danger'); return }
    toast(ok, 'success')
    await load()
    onChanged()
  }

  const inGroup = new Set((memberships ?? []).map((m) => m.group.id))
  const suggestedGroups = suggestion.groups.filter((g) => !inGroup.has(g.id))
  const line = suggestionLine({ groups: suggestedGroups, submissions: suggestion.submissions })

  const create = async (members: string[]) => {
    const title = await askTitle(members.length
      ? `A group of ${members.length + 1} records with this one as the lead. Every record keeps its own number; the group is a fact about them.`
      : 'This record becomes the lead. Add the others afterwards, or accept a suggestion.')
    if (!title) return
    setBusy(true)
    const res = await createGroup(title, id, members)
    setBusy(false)
    await after(res.error ?? null, `Group “${title}” created.`)
  }

  const add = async (groupId: string, groupTitle: string) => {
    setBusy(true)
    const err = await addToGroup(groupId, id)
    setBusy(false)
    setJoining(null)
    await after(err, `Added to ${groupTitle}.`)
  }

  const openJoin = async () => {
    setJoining([])
    const all = await loadGroups()
    setJoining(all.filter((g) => !inGroup.has(g.group.id)))
  }

  const toggle = (sid: string) => setPicked((s) => {
    const next = new Set(s)
    if (next.has(sid)) next.delete(sid); else next.add(sid)
    return next
  })

  return (
    <Card>
      <h4 className="text-[13px] font-semibold text-white">Groups</h4>
      <p className="mt-1 text-xs text-slate-500">
        Related reports, kept as one investigation without merging them. Every record keeps its
        own number, claims and author.
      </p>

      {memberships === null ? (
        <p className="mt-2 text-xs text-slate-500">Loading…</p>
      ) : memberships.length > 0 && (
        <ul className="mt-2 space-y-2">
          {memberships.map((m) => (
            <GroupRow key={m.group.id} membership={m} submissionId={id} busy={busy}
              mayClose={isCommand || (!!profile?.id && m.group.created_by === profile.id)}
              onChanged={after} />
          ))}
        </ul>
      )}

      {/* The suggestion. From field_submission_repeats signals — the same
          plate, the same name, the same registry record — so it is a prompt,
          never a decision: nothing is grouped until the reviewer says so. */}
      {line && (
        <div role="status" className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
          <p className="text-xs font-semibold text-amber-200">{line}</p>
          {suggestedGroups.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {suggestedGroups.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-200">
                  <span className="min-w-0">
                    <span className="font-medium text-white">{g.title}</span>
                    <span className="text-xs text-slate-400">
                      {' '}· lead {g.lead_submission_no ?? 'unnumbered'} · {g.members} record{g.members === 1 ? '' : 's'} · {sharedLine(g.shared)}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void add(g.id, g.title)}>
                    Add to {g.title}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {suggestion.submissions.length > 0 && (
            <>
              <ul className="mt-1.5 space-y-1">
                {suggestion.submissions.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                      <input type="checkbox" className="accent-badge-500" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                      <span className="font-mono text-xs text-slate-300">{s.submission_no ?? 'unnumbered'}</span>
                      <Badge tone="neutral">{reviewerStatusLabel(s.status)}</Badge>
                      <span className="text-xs text-slate-400">{sharedLine(s.shared)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="primary" className="mt-2" disabled={busy || picked.size === 0}
                onClick={() => void create([...picked])}>
                Create a group with the selected record{picked.size === 1 ? '' : 's'}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void create([])}>Create a group</Button>
        {joining === null ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void openJoin()}>Add to a group…</Button>
        ) : (
          <>
            <Select value="" aria-label="Add this record to a group" className="text-xs"
              onChange={(e) => {
                const g = joining.find((x) => x.group.id === e.target.value)
                if (g) void add(g.group.id, g.group.title)
              }}>
              <option value="">{joining.length ? 'Choose a group…' : 'No other live groups'}</option>
              {joining.map((g) => (
                <option key={g.group.id} value={g.group.id}>
                  {g.group.title}{g.leadNo ? ` · lead ${g.leadNo}` : ''} · {g.members} record{g.members === 1 ? '' : 's'}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setJoining(null)}>Cancel</Button>
          </>
        )}
      </div>
    </Card>
  )
}

/** One membership: the chip, then on request the group's summary and the
 *  actions on it. The lead cannot be removed — there is no re-lead in phase
 *  one — so the lead's row offers Close instead. */
function GroupRow({ membership, submissionId, busy, mayClose, onChanged }: {
  membership: GroupMembership
  submissionId: string
  busy: boolean
  /** Creator or command — cosmetic; the RPC decides. */
  mayClose: boolean
  onChanged: (err: string | null, ok: string) => Promise<void>
}) {
  const { group } = membership
  const live = isLiveGroup(group)
  const isLead = group.lead_submission_id === submissionId
  const [summary, setSummary] = useState<GroupSummary | null | 'loading'>(null)

  const details = async () => {
    if (summary) { setSummary(null); return }
    setSummary('loading')
    setSummary(await loadGroupSummary(group.id))
  }
  const refresh = async (err: string | null, ok: string) => {
    await onChanged(err, ok)
    if (!err && summary && summary !== 'loading') setSummary(await loadGroupSummary(group.id))
  }

  const remove = async () => {
    const why = await askReason(
      'The membership is kept and marked removed, not deleted — the reason is what the history shows.',
      'Remove from this group', 'Remove', 'Why? e.g. different Rodriguez')
    if (!why) return
    await refresh(await removeFromGroup(group.id, submissionId, why), 'Removed from the group.')
  }
  const close = async () => {
    const why = await askReason(
      'Closing keeps every member and case link. It says the grouping is done — folded into a case, or found unrelated.',
      'Close this group', 'Close group', 'Why? e.g. folded into MC-26-014')
    if (!why) return
    await refresh(await closeGroup(group.id, why), 'Group closed.')
  }
  const reopen = async () => {
    const why = await askReason('Say what changed.', 'Reopen this group', 'Reopen', 'Why? e.g. a fourth report this week')
    if (!why) return
    await refresh(await reopenGroup(group.id, why), 'Group reopened.')
  }
  const unlink = async (caseId: string, label: string) => {
    const why = await askReason(
      `The link to ${label} is kept and marked removed. Somebody will ask later why they stopped being related.`,
      'Unlink this case', 'Unlink', 'Why? e.g. wrong case')
    if (!why) return
    await refresh(await unlinkGroupCase(group.id, caseId, why), 'Case unlinked.')
  }

  return (
    <li className="rounded-lg bg-ink-950/50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={live ? 'accent' : 'neutral'}>{groupLine(membership)}</Badge>
        {isLead && <Badge tone="good">Lead</Badge>}
        {!live && <Badge tone="warn">Closed</Badge>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void details()}>
          {summary ? 'Hide' : 'Details'}
        </Button>
        {live && !isLead && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>Remove</Button>}
        {mayClose && (live
          ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void close()}>Close</Button>
          : <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reopen()}>Reopen</Button>)}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {closedLine(group) ?? (group.note || `Opened by ${officerName(group.created_by) ?? 'somebody'} · ${fmtDateTime(group.created_at)}`)}
      </p>

      {summary === 'loading' && <p className="mt-2 text-xs text-slate-500">Loading the group…</p>}
      {summary && summary !== 'loading' && (
        <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
          <p className="text-xs text-slate-400">{summaryLine(summary)}</p>
          <ul className="flex flex-wrap gap-1.5">
            {summary.members.map((m) => (
              <li key={m.submission_id}>
                <Badge tone={m.submission_id === submissionId ? 'accent' : 'neutral'} className="font-mono">
                  {m.submission_no ?? 'unnumbered'}
                  {m.submission_id === summary.lead_submission_id ? ' · lead' : ''}
                </Badge>
              </li>
            ))}
            {hiddenLine(summary.hidden) && (
              <li><Badge tone="warn">{hiddenLine(summary.hidden)}</Badge></li>
            )}
          </ul>
          {summary.cases.length > 0 && (
            <ul className="space-y-1">
              {summary.cases.map((c) => (
                <li key={c.case_id} className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                  <span className="font-mono text-xs">{caseName(c)}</span>
                  <span className="text-xs text-slate-500">Linked to the group — not to each record</span>
                  {live && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void unlink(c.case_id, caseName(c))}>Unlink</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {live && (
            <div className="max-w-md">
              <EntityPicker
                kind="case" label="Link the group to a case" value={null} peek={false}
                exclude={new Set(summary.cases.map((c) => c.case_id))}
                placeholder="Search case number or title…"
                onChange={(hit) => {
                  if (!hit) return
                  void (async () => {
                    const res = await linkGroupCase(group.id, hit.id)
                    await refresh(res.error ?? null, 'Case linked to the group.')
                  })()
                }}
              />
            </div>
          )}
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// The queue's Groups view
// ---------------------------------------------------------------------------

export function IntelGroupsList({ onOpen }: { onOpen: (submissionId: string) => void }) {
  const [rows, setRows] = useState<GroupListItem[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try { setRows(await loadGroups()) } catch { setFailed(true); setRows([]) }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  if (rows === null) return <Notice text="Loading groups…" />
  if (failed) return <Notice text="The groups could not be loaded." />
  if (!rows.length) {
    return (
      <EmptyState title="No live groups"
        hint="Group related reports from a record — the panel on each record suggests the ones that share a plate, a name or a registry match." />
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          {rows.length} live group{rows.length === 1 ? '' : 's'} · counts are what you can see
        </p>
        <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
      </div>
      <Card pad="none">
        <ul className="divide-y divide-white/5">
          {rows.map((r) => <GroupListRow key={r.group.id} item={r} onOpen={onOpen} />)}
        </ul>
      </Card>
    </div>
  )
}

function GroupListRow({ item, onOpen }: { item: GroupListItem; onOpen: (submissionId: string) => void }) {
  const { group } = item
  const [summary, setSummary] = useState<GroupSummary | null | 'loading'>(null)

  const details = async () => {
    if (summary) { setSummary(null); return }
    setSummary('loading')
    setSummary(await loadGroupSummary(group.id))
  }

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-white">{group.title}</span>
        <span className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onOpen(group.lead_submission_id)}
            className="font-mono text-xs text-slate-300 hover:text-white">
            lead {item.leadNo ?? 'unnumbered'}
          </button>
          <Badge tone="accent">{item.members} record{item.members === 1 ? '' : 's'}</Badge>
          <Badge tone="neutral">{item.cases} case{item.cases === 1 ? '' : 's'}</Badge>
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        {group.note ? `${group.note} · ` : ''}
        {officerName(group.created_by) ?? 'Somebody'} · updated {timeAgo(group.updated_at)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => onOpen(group.lead_submission_id)}>Open lead</Button>
        <Button size="sm" variant="ghost" onClick={() => void details()}>{summary ? 'Hide members' : 'Members'}</Button>
      </div>
      {summary === 'loading' && <p className="mt-2 text-xs text-slate-500">Loading the group…</p>}
      {summary && summary !== 'loading' && (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-slate-400">{summaryLine(summary)}</p>
          <ul className="flex flex-wrap gap-1.5">
            {summary.members.map((m) => (
              <li key={m.submission_id}>
                <button type="button" onClick={() => onOpen(m.submission_id)}
                  className="rounded bg-white/5 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-300 hover:bg-white/10 hover:text-white">
                  {m.submission_no ?? 'unnumbered'}{m.submission_id === summary.lead_submission_id ? ' · lead' : ''}
                  <span className="ml-1 font-sans font-normal text-slate-500">{reviewerStatusLabel(m.status)}</span>
                </button>
              </li>
            ))}
            {hiddenLine(summary.hidden) && <li><Badge tone="warn">{hiddenLine(summary.hidden)}</Badge></li>}
          </ul>
          {summary.cases.length > 0 && (
            <p className="text-xs text-slate-400">
              Cases: {summary.cases.map(caseName).join(' · ')}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
