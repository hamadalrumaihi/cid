/** Unit tests for the intel groups mirror (P6-03).
 *
 *  The rules — who may create, that the lead cannot be removed, that a
 *  sensitive member is invisible to a reader outside the wall — are the
 *  database's, probed in tests/rls/v188c. What is pinned here is the client's
 *  handling: what it sends, how it reads a JSON answer it must never trust
 *  blindly, and the sentences a reviewer sees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { list, rpc } from './db'
import {
  addToGroup, closedLine, closeGroup, createGroup, groupLine, hiddenLine, isLiveGroup,
  isLiveMember, linkGroupCase, loadGroupSummary, loadGroups, loadGroupsFor, parseSuggestion,
  parseSummary, removeFromGroup, reopenGroup, sharedLine, suggestGroups, suggestionLine,
  summaryLine, unlinkGroupCase,
  type GroupSummary, type IntelGroupMemberRow, type IntelGroupRow,
} from './intelGroups'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, list: vi.fn(), rpc: vi.fn() }
})

const rpcMock = vi.mocked(rpc)
const listMock = vi.mocked(list)
const answer = (data: unknown, error: { message: string } | null = null) =>
  rpcMock.mockResolvedValue({ data, error } as never)

const group = (over: Partial<IntelGroupRow> = {}): IntelGroupRow => ({
  id: 'g1', title: 'Grove Street stash', note: null, lead_submission_id: 's1',
  created_by: 'u1', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  closed_at: null, closed_by: null, close_reason: null, ...over,
})

const member = (over: Partial<IntelGroupMemberRow> = {}): IntelGroupMemberRow => ({
  id: 'm1', group_id: 'g1', submission_id: 's1', added_by: 'u1', added_at: '2026-09-01T00:00:00Z',
  note: null, removed_at: null, removed_by: null, remove_reason: null, ...over,
})

const summary = (over: Partial<GroupSummary> = {}): GroupSummary => ({
  id: 'g1', title: 'Grove Street stash', lead_submission_id: 's1',
  members: [
    { submission_id: 's1', submission_no: 'FI-2026-0001', status: 'reviewing', readable: true },
    { submission_id: 's2', submission_no: 'FI-2026-0002', status: 'new', readable: true },
  ],
  hidden: 0, claims: 6, decided: 4, cases: [{ case_id: 'c1', case_number: 'MC-26-001', title: 'Grove' }],
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  answer(null)
  listMock.mockResolvedValue([] as never)
})

describe('what the writes send', () => {
  it('creates with the lead kept out of the member list — the server adds it itself', async () => {
    answer('g1')
    const res = await createGroup('  Grove Street stash ', 's1', ['s1', 's2', 's3'], ' ')
    expect(res).toEqual({ id: 'g1' })
    expect(rpcMock).toHaveBeenCalledWith('intel_group_create', {
      p_title: 'Grove Street stash', p_lead: 's1', p_members: ['s2', 's3'], p_note: undefined,
    })
  })

  it('passes the server refusal through in its own words', async () => {
    answer(null, { message: 'that record is not in your jurisdiction' })
    expect(await createGroup('x', 's1')).toEqual({ error: 'that record is not in your jurisdiction' })
    expect(await addToGroup('g1', 's2')).toBe('that record is not in your jurisdiction')
    expect(await removeFromGroup('g1', 's1', 'why')).toBe('that record is not in your jurisdiction')
    expect(await closeGroup('g1', 'done')).toBe('that record is not in your jurisdiction')
    expect(await reopenGroup('g1', 'not done')).toBe('that record is not in your jurisdiction')
    expect(await unlinkGroupCase('g1', 'c1', 'wrong case')).toBe('that record is not in your jurisdiction')
    expect(await linkGroupCase('g1', 'c1')).toEqual({ error: 'that record is not in your jurisdiction' })
  })

  it('trims the reasons it is given and sends them under the contract names', async () => {
    await removeFromGroup('g1', 's2', '  wrong Rodriguez ')
    expect(rpcMock).toHaveBeenLastCalledWith('intel_group_remove', { p_group: 'g1', p_submission: 's2', p_reason: 'wrong Rodriguez' })
    await closeGroup('g1', ' folded into MC-26-001 ')
    expect(rpcMock).toHaveBeenLastCalledWith('intel_group_close', { p_group: 'g1', p_reason: 'folded into MC-26-001' })
    await reopenGroup('g1', 'new report')
    expect(rpcMock).toHaveBeenLastCalledWith('intel_group_reopen', { p_group: 'g1', p_reason: 'new report' })
    await unlinkGroupCase('g1', 'c1', ' wrong case ')
    expect(rpcMock).toHaveBeenLastCalledWith('intel_group_unlink_case', { p_group: 'g1', p_case: 'c1', p_reason: 'wrong case' })
    answer('l1')
    expect(await linkGroupCase('g1', 'c1', ' feeds the RICO ')).toEqual({ id: 'l1' })
    expect(rpcMock).toHaveBeenLastCalledWith('intel_group_link_case', { p_group: 'g1', p_case: 'c1', p_note: 'feeds the RICO' })
  })

  it('answers null on success for the void RPCs', async () => {
    expect(await addToGroup('g1', 's2', 'same plate')).toBeNull()
    expect(rpcMock).toHaveBeenLastCalledWith('intel_group_add', { p_group: 'g1', p_submission: 's2', p_note: 'same plate' })
  })
})

describe('reading the suggestion', () => {
  it('keeps only well-formed entries and never a summary', () => {
    const s = parseSuggestion({
      groups: [{ id: 'g1', title: 'Grove', lead_submission_no: 'FI-1', members: 3, shared: ['plate ABC123'] }, { title: 'no id' }],
      submissions: [
        { id: 's2', submission_no: 'FI-2', status: 'new', shared: ['person Rodriguez', 7], summary: 'must not appear' },
        null, 'junk',
      ],
    })
    expect(s.groups).toEqual([{ id: 'g1', title: 'Grove', lead_submission_no: 'FI-1', members: 3, shared: ['plate ABC123'] }])
    expect(s.submissions).toEqual([{ id: 's2', submission_no: 'FI-2', status: 'new', shared: ['person Rodriguez'] }])
    expect(JSON.stringify(s)).not.toContain('must not appear')
  })

  it('reads a malformed answer, an error, or nothing at all as no suggestion', async () => {
    expect(parseSuggestion(null)).toEqual({ groups: [], submissions: [] })
    expect(parseSuggestion('x')).toEqual({ groups: [], submissions: [] })
    answer(null, { message: 'boom' })
    expect(await suggestGroups('s1')).toEqual({ groups: [], submissions: [] })
    expect(rpcMock).toHaveBeenCalledWith('intel_group_suggest', { p_submission: 's1' })
  })

  it('says it in the contract sentence', () => {
    expect(suggestionLine({ groups: [], submissions: [] })).toBeNull()
    expect(suggestionLine({
      groups: [],
      submissions: [
        { id: 'a', submission_no: 'FI-123', status: 'new', shared: [] },
        { id: 'b', submission_no: 'FI-098', status: 'new', shared: [] },
      ],
    })).toBe('Looks related: FI-123, FI-098 — group them?')
    expect(suggestionLine({
      groups: [{ id: 'g', title: 'Grove', lead_submission_no: null, members: 2, shared: [] }], submissions: [],
    })).toBe('Looks related to group Grove — add it?')
    expect(sharedLine(['plate ABC123', 'person Rodriguez'])).toBe('shares plate ABC123, person Rodriguez')
    expect(sharedLine([])).toBe('shares a signal')
  })
})

describe('reading the summary', () => {
  it('parses the contract shape and counts what the caller cannot see', () => {
    const s = parseSummary({
      id: 'g1', title: 'Grove', lead_submission_id: 's1',
      members: [{ submission_id: 's1', submission_no: 'FI-1', status: 'new', readable: true }, { nope: true }],
      hidden: 1, claims: 3, decided: 1,
      cases: [{ case_id: 'c1', case_number: 'MC-1', title: null }, { title: 'no id' }],
    })
    expect(s?.members).toHaveLength(1)
    expect(s?.hidden).toBe(1)
    expect(s?.cases).toEqual([{ case_id: 'c1', case_number: 'MC-1', title: null }])
  })

  it('refuses an answer without a group id or lead', async () => {
    expect(parseSummary({ title: 'x' })).toBeNull()
    answer(null, { message: 'boom' })
    expect(await loadGroupSummary('g1')).toBeNull()
  })

  it('reads as one line, hidden records said out loud', () => {
    expect(summaryLine(summary())).toBe('2 records · 4 of 6 claims decided · 1 case')
    expect(summaryLine(summary({ hidden: 1, claims: 0, cases: [] }))).toBe('3 records · 1 you cannot see · 0 cases')
    expect(hiddenLine(0)).toBeNull()
    expect(hiddenLine(1)).toBe('1 record you cannot see')
    expect(hiddenLine(2)).toBe('2 records you cannot see')
  })
})

describe('the chips', () => {
  it('names the group and its size', () => {
    expect(groupLine({ group: group(), members: 3 })).toBe('Part of group Grove Street stash (3 records)')
    expect(groupLine({ group: group(), members: 1 })).toBe('Part of group Grove Street stash (1 record)')
  })

  it('reads closed with its reason', () => {
    expect(closedLine(group())).toBeNull()
    expect(closedLine(group({ closed_at: '2026-09-02T00:00:00Z', close_reason: 'folded into MC-26-001' }))).toBe('Closed — folded into MC-26-001')
    expect(closedLine(group({ closed_at: '2026-09-02T00:00:00Z' }))).toBe('Closed')
    expect(isLiveGroup(group())).toBe(true)
    expect(isLiveGroup(group({ closed_at: 'x' }))).toBe(false)
    expect(isLiveMember(member())).toBe(true)
    expect(isLiveMember(member({ removed_at: 'x' }))).toBe(false)
  })
})

describe('loading a record’s groups', () => {
  it('asks for live memberships only, then the groups, and drops a membership whose group is withheld', async () => {
    listMock.mockImplementation(async (table: string, opts?: unknown) => {
      const o = opts as { in?: { group_id?: string[]; id?: string[] } } | undefined
      if (table === 'intel_group_members' && o?.in?.group_id) {
        return [{ group_id: 'g1' }, { group_id: 'g1' }, { group_id: 'g2' }] as never
      }
      if (table === 'intel_group_members') return [member(), member({ id: 'm2', group_id: 'g2' })] as never
      if (table === 'intel_groups') return [group()] as never
      return [] as never
    })
    const out = await loadGroupsFor('s1')
    expect(listMock).toHaveBeenCalledWith('intel_group_members', expect.objectContaining({ eq: { submission_id: 's1' }, is: { removed_at: null } }))
    expect(out).toHaveLength(1)
    expect(out[0]!.group.id).toBe('g1')
    expect(out[0]!.members).toBe(2)
  })

  it('answers [] when the record is in no group without asking for groups', async () => {
    expect(await loadGroupsFor('s1')).toEqual([])
    expect(listMock).toHaveBeenCalledTimes(1)
  })
})

describe('the queue’s groups view', () => {
  it('lists live groups with the lead number and bounded counts', async () => {
    listMock.mockImplementation(async (table: string) => {
      if (table === 'intel_groups') return [group(), group({ id: 'g2', lead_submission_id: 's9' })] as never
      if (table === 'intel_group_members') return [{ group_id: 'g1' }, { group_id: 'g1' }] as never
      if (table === 'intel_group_cases') return [{ group_id: 'g2' }] as never
      if (table === 'field_submissions') return [{ id: 's1', submission_no: 'FI-2026-0001' }] as never
      return [] as never
    })
    const rows = await loadGroups()
    expect(listMock).toHaveBeenCalledWith('intel_groups', expect.objectContaining({ is: { closed_at: null } }))
    expect(rows.map((r) => [r.group.id, r.leadNo, r.members, r.cases])).toEqual([
      ['g1', 'FI-2026-0001', 2, 0],
      ['g2', null, 0, 1],
    ])
  })

  it('is empty, not broken, when the policy returns nothing', async () => {
    expect(await loadGroups()).toEqual([])
  })
})
