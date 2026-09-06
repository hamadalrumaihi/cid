/** Contract of the entity-layer client wrappers (src/lib/entity/api.ts):
 *  what each sends to the RPCs and how it shapes the answer. list()/rpc()
 *  are mocked — nothing here talks to a database. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { list, rpc } from '../db'
import {
  crossref, decideSuggestion, findDuplicates, listReconcileQueue, mergeEntities, previewMerge,
  promoteObservation, refusalText, resolveReconcile, suggestEntities, suggestUpdate, toHit,
  unmergeEntities, unmergeWindowOpen, withdrawSuggestion,
} from './api'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, list: vi.fn(), rpc: vi.fn() }
})

const rpcMock = vi.mocked(rpc)
const listMock = vi.mocked(list)
const answer = (data: unknown, error: { message: string } | null = null) =>
  rpcMock.mockResolvedValue({ data, error } as never)

beforeEach(() => {
  vi.resetAllMocks()
  answer(null)
  listMock.mockResolvedValue([] as never)
})

/* ── suggestEntities ────────────────────────────────────────────────────── */

describe('suggestEntities', () => {
  it('short-circuits under two characters without calling the server', async () => {
    expect(await suggestEntities('person', ' m ')).toEqual([])
    expect(await suggestEntities('person', '')).toEqual([])
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('trims the term and clamps the limit to 1..50', async () => {
    answer([])
    await suggestEntities('vehicle', '  ab-12 ', 500)
    expect(rpcMock).toHaveBeenCalledWith('entity_suggest', { p_kind: 'vehicle', p_q: 'ab-12', p_limit: 50 })
    await suggestEntities('vehicle', 'ab', 0)
    expect(rpcMock).toHaveBeenLastCalledWith('entity_suggest', { p_kind: 'vehicle', p_q: 'ab', p_limit: 1 })
  })

  it('never throws: an error or an empty answer resolves to []', async () => {
    answer(null, { message: 'permission denied for function entity_suggest' })
    await expect(suggestEntities('person', 'marcus')).resolves.toEqual([])
    answer(null)
    await expect(suggestEntities('person', 'marcus')).resolves.toEqual([])
  })

  it('passes rows through with a null-safe sublabel, and toHit keeps kind/exact in meta', async () => {
    answer([{ id: 'p1', kind: 'person', label: 'Marcus', sublabel: null, score: 1, exact: true }])
    const rows = await suggestEntities('person', 'marcus')
    expect(rows).toEqual([{ id: 'p1', kind: 'person', label: 'Marcus', sublabel: null, score: 1, exact: true }])
    expect(toHit(rows[0])).toEqual({ id: 'p1', label: 'Marcus', sublabel: undefined, meta: { kind: 'person', exact: '1' } })
    expect(toHit({ ...rows[0], exact: false, sublabel: 'Ghost' }).meta).toEqual({ kind: 'person', exact: null })
  })
})

/* ── findDuplicates ─────────────────────────────────────────────────────── */

describe('findDuplicates', () => {
  it('drops empty / null / blank payload keys and trims the rest', async () => {
    answer([])
    await findDuplicates('person', { name: '  Marcus ', alias: '', dob: null, phone: '   ', exclude_id: 'p9' })
    expect(rpcMock).toHaveBeenCalledWith('entity_duplicates', { p_kind: 'person', p_payload: { name: 'Marcus', exclude_id: 'p9' } })
  })

  it('answers [] without a call when nothing but exclude_id is left', async () => {
    expect(await findDuplicates('person', {})).toEqual([])
    expect(await findDuplicates('person', { name: ' ', exclude_id: 'p1' })).toEqual([])
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('normalizes strength to strong|soft and resolves errors to []', async () => {
    answer([
      { id: 'a', label: 'A', sublabel: null, signal: 'phone', strength: 'strong', score: 1 },
      { id: 'b', label: 'B', sublabel: 'x', signal: 'name~', strength: 'weird', score: 0.7 },
    ])
    const rows = await findDuplicates('person', { phone: '555' })
    expect(rows.map((r) => r.strength)).toEqual(['strong', 'soft'])
    answer(null, { message: 'boom' })
    expect(await findDuplicates('person', { phone: '555' })).toEqual([])
  })
})

/* ── crossref ───────────────────────────────────────────────────────────── */

describe('crossref', () => {
  it('sends p_id for a record kind and p_q (no p_id) for phone', async () => {
    answer([])
    await crossref('vehicle', 'v1')
    expect(rpcMock).toHaveBeenCalledWith('entity_crossref', { p_kind: 'vehicle', p_limit: 50, p_id: 'v1' })
    await crossref('phone', null, { q: '555-0100', limit: 10 })
    expect(rpcMock).toHaveBeenLastCalledWith('entity_crossref', { p_kind: 'phone', p_limit: 10, p_q: '555-0100' })
  })

  it('null-safes the optional columns and resolves errors to []', async () => {
    answer([{ case_id: 'c1', case_number: 'MCB-1', title: null, bureau: 'major_crimes', via: 'link', detail: null, observed_at: null }])
    expect(await crossref('person', 'p1')).toEqual([{ case_id: 'c1', case_number: 'MCB-1', title: null, bureau: 'major_crimes', via: 'link', detail: null, observed_at: null }])
    answer(null, { message: 'boom' })
    expect(await crossref('person', 'p1')).toEqual([])
  })
})

/* ── writes: refusal-or-result envelopes ────────────────────────────────── */

describe('write wrappers', () => {
  it('mergeEntities maps a refusal into data with error null', async () => {
    answer({ ok: false, code: 'denied', message: 'person merge is restricted to command' })
    const res = await mergeEntities('person', 's', ['v'], 'dupe')
    expect(res).toEqual({ data: { ok: false, code: 'denied', message: 'person merge is restricted to command' }, error: null })
    expect(rpcMock).toHaveBeenCalledWith('entity_merge', { p_kind: 'person', p_survivor: 's', p_victims: ['v'], p_reason: 'dupe' })
  })

  it('a transport error comes back as error with data null; a non-envelope answer is an error too', async () => {
    answer(null, { message: 'network' })
    expect(await mergeEntities('person', 's', ['v'], 'dupe')).toEqual({ data: null, error: { message: 'network' } })
    answer('nope')
    const odd = await previewMerge('person', 's', ['v'])
    expect(odd.data).toBeNull()
    expect(odd.error?.message).toMatch(/unexpected answer/)
  })

  it('suggestUpdate sends expected_current / observation_id only when given', async () => {
    answer({ ok: false, code: 'stale', current: '555-0100' })
    const res = await suggestUpdate('person', 'p1', 'phone', '555-0199', 'new number', { expectedCurrent: '555-0100' })
    expect(rpcMock).toHaveBeenCalledWith('entity_suggest_update', { p_kind: 'person', p_id: 'p1', p_field: 'phone', p_value: '555-0199', p_reason: 'new number', p_expected_current: '555-0100' })
    expect(res).toEqual({ data: { ok: false, code: 'stale', current: '555-0100' }, error: null })
    answer({ ok: true, applied: false, suggestion_id: 's1', from: null, to: 'x' })
    await suggestUpdate('person', 'p1', 'alias', null, 'why', { expectedCurrent: null, observationId: 'o1' })
    expect(rpcMock).toHaveBeenLastCalledWith('entity_suggest_update', { p_kind: 'person', p_id: 'p1', p_field: 'alias', p_value: '', p_reason: 'why', p_observation_id: 'o1' })
  })

  it('the remaining wrappers send the documented argument names', async () => {
    answer({ ok: true })
    await decideSuggestion('s1', true, 'fine')
    expect(rpcMock).toHaveBeenLastCalledWith('entity_suggestion_decide', { p_id: 's1', p_accept: true, p_note: 'fine' })
    await decideSuggestion('s1', false)
    expect(rpcMock).toHaveBeenLastCalledWith('entity_suggestion_decide', { p_id: 's1', p_accept: false })
    await withdrawSuggestion('s1')
    expect(rpcMock).toHaveBeenLastCalledWith('entity_suggestion_withdraw', { p_id: 's1' })
    await promoteObservation('o1', 'confirmed')
    expect(rpcMock).toHaveBeenLastCalledWith('promote_observation', { p_id: 'o1', p_reason: 'confirmed' })
    await unmergeEntities('m1', 'oops')
    expect(rpcMock).toHaveBeenLastCalledWith('entity_unmerge', { p_merge_id: 'm1', p_reason: 'oops' })
    await resolveReconcile('q1', 'merge', 'same car')
    expect(rpcMock).toHaveBeenLastCalledWith('siu_reconcile_resolve', { p_id: 'q1', p_resolution: 'merge', p_note: 'same car' })
    await resolveReconcile('q1', 'dismiss')
    expect(rpcMock).toHaveBeenLastCalledWith('siu_reconcile_resolve', { p_id: 'q1', p_resolution: 'dismiss' })
  })

  it('listReconcileQueue filters to open rows unless asked for all', async () => {
    await listReconcileQueue()
    expect(listMock).toHaveBeenLastCalledWith('siu_reconcile_queue', { is: { resolved_at: null }, order: 'created_at', ascending: false, limit: 200 })
    await listReconcileQueue(true)
    expect(listMock).toHaveBeenLastCalledWith('siu_reconcile_queue', { order: 'created_at', ascending: false, limit: 200 })
  })
})

/* ── pure helpers ───────────────────────────────────────────────────────── */

describe('refusalText', () => {
  it('prefers the server message, then the known codes, then the fallback', () => {
    expect(refusalText({ ok: false, code: 'denied', message: 'only SIB agents resolve the reconcile queue' })).toBe('only SIB agents resolve the reconcile queue')
    expect(refusalText({ ok: false, code: 'denied' })).toBe('You do not have the authority for this.')
    expect(refusalText({ ok: false, code: 'reason_required' })).toBe('A reason is required.')
    expect(refusalText({ ok: false, code: 'stale' })).toBe('The record changed since you looked.')
    expect(refusalText({ ok: false, code: 'held' })).toBe('A linked case is under an active legal hold.')
    expect(refusalText({ ok: false, code: 'already_merged' })).toBe('That record is already merged.')
    expect(refusalText({ ok: false, code: 'window_closed' })).toBe('A merge can only be reversed within 30 days.')
    expect(refusalText({ ok: false, code: 'something_else' })).toBe('The server refused this action.')
    expect(refusalText({ ok: false, code: 'something_else' }, 'Nope.')).toBe('Nope.')
    expect(refusalText(null)).toBe('The server refused this action.')
    expect(refusalText(undefined, 'Custom')).toBe('Custom')
  })
})

describe('unmergeWindowOpen', () => {
  const now = Date.parse('2026-09-06T12:00:00.000Z')
  const DAY = 24 * 60 * 60 * 1000
  it('is open inside 30 days, closed after, and closed once reversed', () => {
    expect(unmergeWindowOpen({ created_at: new Date(now - 29 * DAY).toISOString(), reversed_at: null }, now)).toBe(true)
    expect(unmergeWindowOpen({ created_at: new Date(now - 30 * DAY).toISOString(), reversed_at: null }, now)).toBe(false)
    expect(unmergeWindowOpen({ created_at: new Date(now - 31 * DAY).toISOString(), reversed_at: null }, now)).toBe(false)
    expect(unmergeWindowOpen({ created_at: new Date(now - DAY).toISOString(), reversed_at: new Date(now).toISOString() }, now)).toBe(false)
  })
})
