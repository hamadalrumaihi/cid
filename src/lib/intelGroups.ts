/** Intel groups — the client mirror of 20261031120000_intel_groups_convert.sql
 *  (P6-03, decision IT6).
 *
 *  Three reports about the same stash house are one investigation, not three
 *  records that happen to agree. A group is the reviewer saying so: a title, a
 *  lead record, the members, and the cases the group as a whole feeds. It never
 *  merges, never deletes and never edits a member — every report keeps its own
 *  number, its own claims and its own author.
 *
 *  ── Everything is RPC-only ─────────────────────────────────────────────────
 *  The three tables grant SELECT and nothing else; each write below is a
 *  SECURITY DEFINER function that audits itself. Membership is stamped rather
 *  than deleted (removed_at / remove_reason), so "was in the group until the
 *  9th, wrong Rodriguez" stays readable.
 *
 *  ── What a reader cannot see stays hidden ──────────────────────────────────
 *  A member row is readable only when its submission is — a sensitive record
 *  in a group is invisible to a reviewer outside the SIB wall. The summary
 *  RPC counts those as `hidden` so the group does not silently look smaller
 *  than it is.
 */

import { list, rpc } from './db'
import type { Tables } from './database.types'

export type IntelGroupRow = Tables<'intel_groups'>
export type IntelGroupMemberRow = Tables<'intel_group_members'>
export type IntelGroupCaseRow = Tables<'intel_group_cases'>

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One record's live membership, with the group and how big it is. */
export interface GroupMembership {
  group: IntelGroupRow
  member: IntelGroupMemberRow
  /** Live members the caller can read (the summary says how many they cannot). */
  members: number
}

/** A row of the queue's Groups view. */
export interface GroupListItem {
  group: IntelGroupRow
  leadNo: string | null
  /** Live members the caller can read. */
  members: number
  /** Live case links. */
  cases: number
}

export interface SuggestedGroup {
  id: string
  title: string
  lead_submission_no: string | null
  members: number
  shared: string[]
}

export interface SuggestedSubmission {
  id: string
  submission_no: string | null
  status: string
  shared: string[]
}

/** `intel_group_suggest` — other readable records sharing a repeat signal
 *  with this one, and the live groups any of them already belong to. Never
 *  a summary: a suggestion names a number, and the reviewer opens it. */
export interface GroupSuggestion {
  groups: SuggestedGroup[]
  submissions: SuggestedSubmission[]
}

export interface GroupSummaryMember {
  submission_id: string
  submission_no: string | null
  status: string
  readable: boolean
}

export interface GroupSummaryCase {
  case_id: string
  case_number: string | null
  title: string | null
}

/** `intel_group_summary` — readable members carry a number; the rest are a count. */
export interface GroupSummary {
  id: string
  title: string
  lead_submission_id: string
  members: GroupSummaryMember[]
  hidden: number
  claims: number
  decided: number
  cases: GroupSummaryCase[]
}

const NO_SUGGESTION: GroupSuggestion = { groups: [], submissions: [] }

export function isLiveGroup(g: Pick<IntelGroupRow, 'closed_at'>): boolean {
  return !g.closed_at
}

export function isLiveMember(m: Pick<IntelGroupMemberRow, 'removed_at'>): boolean {
  return !m.removed_at
}

// ---------------------------------------------------------------------------
// Reads — all RLS-scoped
// ---------------------------------------------------------------------------

/** How many live members each of these groups has, as far as the caller can see. */
async function liveMemberCounts(groupIds: string[]): Promise<Record<string, number>> {
  if (!groupIds.length) return {}
  const rows = await list('intel_group_members', {
    in: { group_id: groupIds }, is: { removed_at: null }, select: 'group_id',
  }).catch(() => [] as Pick<IntelGroupMemberRow, 'group_id'>[])
  const out: Record<string, number> = {}
  for (const r of rows) out[r.group_id] = (out[r.group_id] ?? 0) + 1
  return out
}

/** The groups this record is a live member of. Closed groups are included —
 *  a closed group is still a fact about the record — and flagged by the row. */
export async function loadGroupsFor(submissionId: string): Promise<GroupMembership[]> {
  const memberships = await list('intel_group_members', {
    eq: { submission_id: submissionId }, is: { removed_at: null }, order: 'added_at',
  }).catch(() => [] as IntelGroupMemberRow[])
  if (!memberships.length) return []
  const ids = [...new Set(memberships.map((m) => m.group_id))]
  const [groups, counts] = await Promise.all([
    list('intel_groups', { in: { id: ids } }).catch(() => [] as IntelGroupRow[]),
    liveMemberCounts(ids),
  ])
  const out: GroupMembership[] = []
  for (const member of memberships) {
    const group = groups.find((g) => g.id === member.group_id)
    // A membership whose group the policy withholds is not shown at all: the
    // group's own SELECT decides, and half a fact is worse than none.
    if (group) out.push({ group, member, members: counts[group.id] ?? 0 })
  }
  return out
}

/** The queue's Groups view: live groups, newest activity first, with the lead
 *  record's number and bounded counts. Three list queries rather than a
 *  summary RPC per row — the summary is for one group somebody opened. */
export async function loadGroups(limit = 100): Promise<GroupListItem[]> {
  const groups = await list('intel_groups', {
    is: { closed_at: null }, order: 'updated_at', ascending: false, limit,
  }).catch(() => [] as IntelGroupRow[])
  if (!groups.length) return []
  const ids = groups.map((g) => g.id)
  const leadIds = [...new Set(groups.map((g) => g.lead_submission_id))]
  const [members, caseRows, leads] = await Promise.all([
    liveMemberCounts(ids),
    list('intel_group_cases', { in: { group_id: ids }, is: { unlinked_at: null }, select: 'group_id' })
      .catch(() => [] as Pick<IntelGroupCaseRow, 'group_id'>[]),
    list('field_submissions', { in: { id: leadIds }, select: 'id,submission_no' })
      .then((r) => r as unknown as { id: string; submission_no: string | null }[])
      .catch(() => [] as { id: string; submission_no: string | null }[]),
  ])
  const cases: Record<string, number> = {}
  for (const c of caseRows) cases[c.group_id] = (cases[c.group_id] ?? 0) + 1
  return groups.map((group) => ({
    group,
    leadNo: leads.find((l) => l.id === group.lead_submission_id)?.submission_no ?? null,
    members: members[group.id] ?? 0,
    cases: cases[group.id] ?? 0,
  }))
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const objs = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

/** Parsed defensively: a suggestion box never throws at the reviewer, and a
 *  malformed answer reads as "nothing suggested" rather than a blank panel. */
export function parseSuggestion(data: unknown): GroupSuggestion {
  if (!data || typeof data !== 'object') return NO_SUGGESTION
  const d = data as Record<string, unknown>
  return {
    groups: objs(d.groups).flatMap((g) => {
      const id = str(g.id)
      return id ? [{
        id, title: str(g.title) ?? 'Untitled group', lead_submission_no: str(g.lead_submission_no),
        members: num(g.members), shared: strs(g.shared),
      }] : []
    }),
    submissions: objs(d.submissions).flatMap((s) => {
      const id = str(s.id)
      return id ? [{ id, submission_no: str(s.submission_no), status: str(s.status) ?? '', shared: strs(s.shared) }] : []
    }),
  }
}

export function parseSummary(data: unknown): GroupSummary | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const id = str(d.id)
  const lead = str(d.lead_submission_id)
  if (!id || !lead) return null
  return {
    id, title: str(d.title) ?? 'Untitled group', lead_submission_id: lead,
    members: objs(d.members).flatMap((m) => {
      const sid = str(m.submission_id)
      return sid ? [{ submission_id: sid, submission_no: str(m.submission_no), status: str(m.status) ?? '', readable: m.readable !== false }] : []
    }),
    hidden: num(d.hidden), claims: num(d.claims), decided: num(d.decided),
    cases: objs(d.cases).flatMap((c) => {
      const cid = str(c.case_id)
      return cid ? [{ case_id: cid, case_number: str(c.case_number), title: str(c.title) }] : []
    }),
  }
}

export async function suggestGroups(submissionId: string): Promise<GroupSuggestion> {
  const res = await rpc('intel_group_suggest', { p_submission: submissionId })
  if (res.error) return NO_SUGGESTION
  return parseSuggestion(res.data)
}

export async function loadGroupSummary(groupId: string): Promise<GroupSummary | null> {
  const res = await rpc('intel_group_summary', { p_group: groupId })
  if (res.error) return null
  return parseSummary(res.data)
}

// ---------------------------------------------------------------------------
// Writes — each RPC audits itself and RAISES on refusal; the message is the
// server's wording and is passed through as-is
// ---------------------------------------------------------------------------

/** Open a group. The lead is always a member; `members` are the others. */
export async function createGroup(
  title: string, leadId: string, members: string[] = [], note?: string,
): Promise<{ id?: string; error?: string }> {
  const res = await rpc('intel_group_create', {
    p_title: title.trim(), p_lead: leadId,
    p_members: members.filter((m) => m !== leadId),
    p_note: note?.trim() || undefined,
  })
  if (res.error) return { error: res.error.message }
  return { id: typeof res.data === 'string' ? res.data : undefined }
}

export async function addToGroup(groupId: string, submissionId: string, note?: string): Promise<string | null> {
  const res = await rpc('intel_group_add', {
    p_group: groupId, p_submission: submissionId, p_note: note?.trim() || undefined,
  })
  return res.error?.message ?? null
}

/** Leave a group. The reason is the server's requirement, not the form's: the
 *  row is stamped, not deleted, so the reason is what the history shows. The
 *  lead cannot be removed — close the group instead. */
export async function removeFromGroup(groupId: string, submissionId: string, reason: string): Promise<string | null> {
  const res = await rpc('intel_group_remove', {
    p_group: groupId, p_submission: submissionId, p_reason: reason.trim(),
  })
  return res.error?.message ?? null
}

/** A group link is a group fact — the members are NOT linked one by one. */
export async function linkGroupCase(groupId: string, caseId: string, note?: string): Promise<{ id?: string; error?: string }> {
  const res = await rpc('intel_group_link_case', {
    p_group: groupId, p_case: caseId, p_note: note?.trim() || undefined,
  })
  if (res.error) return { error: res.error.message }
  return { id: typeof res.data === 'string' ? res.data : undefined }
}

export async function unlinkGroupCase(groupId: string, caseId: string, reason: string): Promise<string | null> {
  const res = await rpc('intel_group_unlink_case', {
    p_group: groupId, p_case: caseId, p_reason: reason.trim(),
  })
  return res.error?.message ?? null
}

/** Creator or command. Closing keeps everything; it says the grouping is done. */
export async function closeGroup(groupId: string, reason: string): Promise<string | null> {
  const res = await rpc('intel_group_close', { p_group: groupId, p_reason: reason.trim() })
  return res.error?.message ?? null
}

export async function reopenGroup(groupId: string, reason: string): Promise<string | null> {
  const res = await rpc('intel_group_reopen', { p_group: groupId, p_reason: reason.trim() })
  return res.error?.message ?? null
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const records = (n: number): string => `${n} record${n === 1 ? '' : 's'}`

/** "Part of group Alpha (3 records)" — the chip on the record. */
export function groupLine(m: Pick<GroupMembership, 'group' | 'members'>): string {
  return `Part of group ${m.group.title} (${records(m.members)})`
}

/** "Looks related: FI-123, FI-098 — group them?" Null when nothing is
 *  suggested; the panel is not rendered then. */
export function suggestionLine(s: GroupSuggestion): string | null {
  const nos = s.submissions.map((x) => x.submission_no ?? 'an unnumbered record')
  if (!nos.length && !s.groups.length) return null
  if (!nos.length) {
    return s.groups.length === 1
      ? `Looks related to group ${s.groups[0]!.title} — add it?`
      : `Looks related to ${s.groups.length} groups — add it to one?`
  }
  return `Looks related: ${nos.join(', ')} — group them?`
}

/** Why a record was suggested: "same plate, same person". */
export function sharedLine(shared: string[]): string {
  return shared.length ? `shares ${shared.join(', ')}` : 'shares a signal'
}

/** "3 records · 1 you cannot see · 4 of 6 claims decided · 2 cases" */
export function summaryLine(s: GroupSummary): string {
  const parts: string[] = [records(s.members.length + s.hidden)]
  if (s.hidden > 0) parts.push(`${s.hidden} you cannot see`)
  if (s.claims > 0) parts.push(`${s.decided} of ${s.claims} claim${s.claims === 1 ? '' : 's'} decided`)
  parts.push(`${s.cases.length} case${s.cases.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

/** "1 record you cannot see" — said out loud so the group never silently
 *  looks smaller than it is. Null when nothing is hidden. */
export function hiddenLine(hidden: number): string | null {
  return hidden > 0 ? `${records(hidden)} you cannot see` : null
}

/** Closed reads with its reason; live reads with nothing. */
export function closedLine(g: Pick<IntelGroupRow, 'closed_at' | 'close_reason'>): string | null {
  if (!g.closed_at) return null
  return `Closed${g.close_reason ? ` — ${g.close_reason}` : ''}`
}
