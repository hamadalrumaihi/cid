/** Unit tests for the claim conversion mirror (P6-04). The server decides
 *  the pair rule, the duplicate check and the authority; what is pinned here
 *  is what the client sends and how it reads the three kinds of answer. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rpc } from './db'
import { convertClaim, parseConvert, registryHref } from './fieldConvert'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, rpc: vi.fn() }
})

const rpcMock = vi.mocked(rpc)
const answer = (data: unknown, error: { message: string } | null = null) =>
  rpcMock.mockResolvedValue({ data, error } as never)

beforeEach(() => { vi.resetAllMocks(); answer(null) })

describe('convertClaim', () => {
  it('sends the kind, the claim and the sheet values under the contract names', async () => {
    answer({ ok: true, id: 'p1', kind: 'person' })
    const res = await convertClaim('person', 'person', 'c1', { name: 'Marcus Reed', alias: 'M' })
    expect(res).toEqual({ ok: true, id: 'p1', kind: 'person' })
    expect(rpcMock).toHaveBeenCalledWith('field_submission_convert', {
      p_kind: 'person', p_claim_kind: 'person', p_claim: 'c1',
      p_payload: { name: 'Marcus Reed', alias: 'M' }, p_reason: undefined,
    })
  })

  it('carries the create-anyway reason, trimmed', async () => {
    answer({ ok: true, id: 'n1', kind: 'narcotic' })
    await convertClaim('narcotic', 'item', 'i1', { name: 'Blue meth', category: 'stimulant' }, '  different batch ')
    expect(rpcMock).toHaveBeenLastCalledWith('field_submission_convert', expect.objectContaining({ p_reason: 'different batch' }))
  })

  it('turns a duplicate answer into strong rows for the panel', () => {
    const res = parseConvert({
      ok: false, code: 'duplicate',
      matches: [{ id: 'p9', label: 'Marcus Reed', sublabel: 'DOB 1990', signal: 'name+dob' }, { label: 'no id' }],
    }, 'person')
    expect(res).toEqual({
      ok: false, code: 'duplicate',
      matches: [{ id: 'p9', label: 'Marcus Reed', sublabel: 'DOB 1990', signal: 'name+dob', strength: 'strong', score: 1 }],
    })
  })

  it('humanises an authority refusal and passes a validation refusal through', () => {
    expect(parseConvert({ ok: false, code: 'denied', message: 'permission denied' }, 'person'))
      .toEqual({ ok: false, code: 'denied', message: 'You don’t have permission to do that.' })
    expect(parseConvert({ ok: false, code: 'bad_request', message: 'a person claim cannot be linked to a narcotic' }, 'person'))
      .toEqual({ ok: false, code: 'bad_request', message: 'a person claim cannot be linked to a narcotic' })
  })

  it('reads a RAISE or a malformed answer as a plain refusal', async () => {
    answer(null, { message: 'that report has not been sent yet' })
    expect(await convertClaim('gang', 'org', 'o1', { name: 'Ballas' })).toEqual({ ok: false, code: 'error', message: 'that report has not been sent yet' })
    expect(parseConvert('nonsense', 'gang').ok).toBe(false)
    expect(parseConvert({ ok: true }, 'gang').ok).toBe(false)
  })
})

describe('registryHref', () => {
  it('uses the existing tools deep-link convention', () => {
    expect(registryHref('person', 'p1')).toBe('/tools?tool=persons&record=p1')
    expect(registryHref('narcotic', 'n 1')).toBe('/tools?tool=narcotics&record=n%201')
    expect(registryHref('account', 'a1')).toBe('/tools?tool=accounts&record=a1')
  })
})
