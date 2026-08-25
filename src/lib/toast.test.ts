import { describe, expect, it } from 'vitest'
import { humanizeError } from './toast'

/** humanizeError is the shared classifier that keeps raw Postgres/PostgREST
 *  internals out of user-facing copy (audit M6). It matters doubly for the
 *  entity-select concurrency story: a lost 23505 race (two investigators
 *  creating the same plate/handle at once) must surface as a friendly
 *  "already exists", never as a constraint dump — and the classification is
 *  pinned here so the per-form variants (VehiclesView's inline
 *  /duplicate|unique|23505/ test, the gang link modals' code === '23505'
 *  checks) stay consistent with the shared copy. */
describe('humanizeError', () => {
  it('maps unique-violation shapes (23505 / duplicate key / already exists) to the duplicate copy', () => {
    const friendly = 'That already exists — use a unique value.'
    expect(humanizeError('duplicate key value violates unique constraint "vehicles_plate_key"')).toBe(friendly)
    expect(humanizeError('ERROR: 23505')).toBe(friendly)
    expect(humanizeError('relation already exists')).toBe(friendly)
  })

  it('maps permission / RLS denials to the no-permission copy', () => {
    const friendly = 'You don’t have permission to do that.'
    expect(humanizeError('permission denied for table profiles')).toBe(friendly)
    expect(humanizeError('new row violates row-level security policy for table "cases"')).toBe(friendly)
  })

  it('maps FK violations, auth expiry and network blips to their copy', () => {
    expect(humanizeError('update or delete on table "persons" violates foreign key constraint'))
      .toBe('That’s still linked to other records and can’t be removed yet.')
    expect(humanizeError('JWT expired')).toBe('Your session expired — please sign in again.')
    expect(humanizeError('TypeError: fetch failed')).toBe('Connection problem — check your network and retry.')
  })

  it('passes unknown messages through unchanged and tolerates non-strings', () => {
    expect(humanizeError('Plate is required.')).toBe('Plate is required.')
    expect(humanizeError(null)).toBe('')
    expect(humanizeError(undefined)).toBe('')
    expect(humanizeError(42)).toBe('42')
  })
})
