/** Pins for the association / registry-media mock handlers (migration
 *  20261106120000). The three the UI is built on come first: a duplicate
 *  create answers `created:false` instead of writing a second row, a confirm
 *  without a reason is `{ok:false, code:'bad_request'}`, and a client write
 *  to `entity_associations` is PostgREST's grant denial. The RPCs are called
 *  directly against the mock store — no MSW server. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { profileRow, roleSession } from '../fixtures'
import { readRows, resetMockStore, seedRows, setSession } from '../store'
import {
  ASSOCIATION_CLAIMS, ASSOCIATION_KINDS, ASSOCIATION_MESSAGES, ASSOCIATION_PATCH_KEYS, ASSOCIATION_RPCS,
  ASSOCIATION_RPC_ONLY_TABLES, ASSOCIATION_STATUSES, AssociationRpcError, REGISTRY_MEDIA_KINDS, associationHandlers,
  entityAssociationCreate, entityAssociationDecide, entityAssociationUpdate, entityAssociationsFor, registryLabel,
  registryMediaAttach,
} from './associations'

type Out = Record<string, unknown>
const out = (v: unknown): Out => v as Out

const expectDeny = (fn: () => unknown) => {
  try { fn() } catch (e) {
    expect(e).toBeInstanceOf(AssociationRpcError)
    expect((e as AssociationRpcError).code).toBe('P0403')
    return
  }
  throw new Error('expected a P0403 raise')
}

/** A detective (the session), a second member, and two gangs plus a place. */
function cast() {
  const me = roleSession('detective')
  const [other] = seedRows('profiles', [profileRow({ display_name: 'Det. Other' })])
  const [a, b] = seedRows('gangs', [gang('Grove Street Families'), gang('Ballas')])
  const [place] = seedRows('places', [{
    area: 'Idlewood', case_id: null, controlling_gang_id: null, created_at: '2026-07-01T12:00:00.000Z', created_by: me.profile.id,
    delete_batch: null, delete_reason: null, deleted_at: null, deleted_by: null, id: '00000000-0000-4000-a000-0000000000f1',
    name: 'Roxwood Autos', narcotic_id: null, notes: null, siu_hidden: false, siu_hidden_at: null, siu_hidden_by: null,
    type: 'front_business', updated_at: '2026-07-01T12:00:00.000Z',
  } as unknown as Tables<'places'>])
  return { me: me.profile, other, a, b, place }
}
type Cast = ReturnType<typeof cast>

let gangSeq = 0
function gang(name: string): Tables<'gangs'> {
  gangSeq += 1
  return {
    aliases: null, classification: null, colors: null, confidence: null, created_at: '2026-07-01T12:00:00.000Z',
    created_by: null, delete_batch: null, delete_reason: null, deleted_at: null, deleted_by: null,
    id: `00000000-0000-4000-a000-00000000000${gangSeq}`, intelligence_summary: null, lead_detective_id: null,
    merged_at: null, merged_by: null, merged_into: null, name, next_review_at: null, notes: null, reviewed_at: null,
    reviewed_by: null, siu_hidden: false, siu_hidden_at: null, siu_hidden_by: null, status: 'active',
    threat_level: 'medium', updated_at: '2026-07-01T12:00:00.000Z',
  } as unknown as Tables<'gangs'>
}

const create = (c: Cast, over: Out = {}) => out(entityAssociationCreate({
  p_subject_kind: 'gang', p_subject_id: c.a.id, p_object_kind: 'gang', p_object_id: c.b.id,
  p_association: 'unconfirmed_association', p_note: 'Both sets of colours on one shopfront', ...over,
}))

describe('associations — vocabulary', () => {
  beforeEach(() => { resetMockStore() })

  it('the contract\'s lists are complete', () => {
    expect(Object.keys(ASSOCIATION_RPCS)).toHaveLength(5)
    expect(ASSOCIATION_KINDS).toHaveLength(7)
    expect(ASSOCIATION_CLAIMS).toHaveLength(14)
    expect(ASSOCIATION_STATUSES).toEqual(['pending_investigation', 'confirmed', 'rejected', 'historical'])
    expect(REGISTRY_MEDIA_KINDS).toHaveLength(5)
    // mirrors the server: last_confirmed is a decision artefact, not amendable.
    expect([...ASSOCIATION_PATCH_KEYS]).toEqual(['note', 'confidence', 'source_type', 'first_observed'])
    expect(ASSOCIATION_RPC_ONLY_TABLES).toEqual(['entity_associations'])
    // Three routes per refused verb: POST / PATCH / DELETE.
    expect(associationHandlers).toHaveLength(3)
  })
})

describe('entity_association_create', () => {
  beforeEach(() => { resetMockStore() })

  it('lands on pending_investigation, never on a finding', () => {
    const c = cast()
    const res = create(c)
    expect(res.ok).toBe(true)
    expect(res.created).toBe(true)
    expect(res.status).toBe('pending_investigation')
    const [row] = readRows('entity_associations')
    expect(row.status).toBe('pending_investigation')
    expect(row.created_by).toBe(c.me.id)
    expect(row.decided_at).toBeNull()
    expect(row.decided_by).toBeNull()
  })

  it('a duplicate pair + claim answers created:false and writes no second row', () => {
    const c = cast()
    const first = create(c)
    const again = create(c)
    expect(again.ok).toBe(true)
    expect(again.created).toBe(false)
    expect(again.id).toBe(first.id)
    expect(again.message).toBe(ASSOCIATION_MESSAGES.duplicate)
    expect(readRows('entity_associations')).toHaveLength(1)
  })

  it('the same pair recorded from the other side is still the same association', () => {
    const c = cast()
    create(c)
    const mirrored = create(c, { p_subject_id: c.b.id, p_object_id: c.a.id })
    expect(mirrored.created).toBe(false)
    expect(readRows('entity_associations')).toHaveLength(1)
    // …but a DIFFERENT claim about the same pair is a new row, not an edit.
    const other = create(c, { p_association: 'rivalry' })
    expect(other.created).toBe(true)
    expect(readRows('entity_associations')).toHaveLength(2)
  })

  it('refuses a self-association, and P0403s an unknown record or a signed-out caller', () => {
    const c = cast()
    const self = create(c, { p_object_id: c.a.id })
    expect(self).toMatchObject({ ok: false, code: 'bad_request', message: ASSOCIATION_MESSAGES.self })
    expectDeny(() => create(c, { p_object_id: '00000000-0000-4000-a000-00000000dead' }))
    setSession(null)
    expectDeny(() => create(c))
  })
})

describe('entity_association_decide', () => {
  beforeEach(() => { resetMockStore() })

  it('confirming or rejecting without a reason is bad_request, and nothing moves', () => {
    const c = cast()
    const id = String(create(c).id)
    for (const status of ['confirmed', 'rejected']) {
      const res = out(entityAssociationDecide({ p_id: id, p_status: status }))
      expect(res).toMatchObject({ ok: false, code: 'bad_request', message: ASSOCIATION_MESSAGES.needsReason })
    }
    expect(readRows('entity_associations')[0].status).toBe('pending_investigation')
  })

  it('a decision records who, when and why — and may correct the claim', () => {
    const c = cast()
    const id = String(create(c).id)
    const res = out(entityAssociationDecide({
      p_id: id, p_status: 'confirmed', p_note: 'Two sources; same shopfront', p_association: 'business_relationship',
    }))
    expect(res).toMatchObject({ ok: true, status: 'confirmed' })
    const row = readRows('entity_associations')[0]
    expect(row.status).toBe('confirmed')
    expect(row.association).toBe('business_relationship')
    expect(row.decided_by).toBe(c.me.id)
    expect(row.decided_at).not.toBeNull()
    expect(row.decision_note).toBe('Two sources; same shopfront')
    expect(row.last_confirmed).not.toBeNull()
  })

  it('reopening clears the decision; an unknown status is bad_value; a missing row is P0403', () => {
    const c = cast()
    const id = String(create(c).id)
    entityAssociationDecide({ p_id: id, p_status: 'rejected', p_note: 'Mistaken identity' })
    expect(out(entityAssociationDecide({ p_id: id, p_status: 'pending_investigation' }))).toMatchObject({ ok: true })
    const row = readRows('entity_associations')[0]
    expect(row.status).toBe('pending_investigation')
    expect(row.decided_by).toBeNull()
    expect(row.decided_at).toBeNull()
    expect(out(entityAssociationDecide({ p_id: id, p_status: 'merged' })))
      .toMatchObject({ ok: false, code: 'bad_value', message: ASSOCIATION_MESSAGES.badStatus })
    expectDeny(() => entityAssociationDecide({ p_id: '00000000-0000-4000-a000-00000000dead', p_status: 'historical' }))
  })
})

describe('entity_association_update', () => {
  beforeEach(() => { resetMockStore() })

  it('amends only the descriptive fields, and refuses anything else', () => {
    const c = cast()
    const id = String(create(c).id)
    expect(out(entityAssociationUpdate({ p_id: id, p_patch: { note: 'Amended note', confidence: 'probable' } }))).toMatchObject({ ok: true })
    const row = readRows('entity_associations')[0]
    expect(row.note).toBe('Amended note')
    expect(row.confidence).toBe('probable')
    for (const patch of [{ status: 'confirmed' }, { association: 'alliance' }, {}]) {
      expect(out(entityAssociationUpdate({ p_id: id, p_patch: patch })))
        .toMatchObject({ ok: false, code: 'bad_request', message: ASSOCIATION_MESSAGES.badPatch })
    }
    expect(readRows('entity_associations')[0].status).toBe('pending_investigation')
  })

  it('a member who is neither the author nor command is P0403', () => {
    const c = cast()
    const id = String(create(c).id)
    setSession({ userId: c.other.id, email: c.other.email ?? 'other@cid.test', password: 'mock-password' })
    expectDeny(() => entityAssociationUpdate({ p_id: id, p_patch: { note: 'Not mine' } }))
  })
})

describe('entity_associations_for', () => {
  beforeEach(() => { resetMockStore() })

  it('answers both directions with the far end resolved, pending first', () => {
    const c = cast()
    const subjectSide = String(create(c).id)
    const objectSide = String(out(entityAssociationCreate({
      p_subject_kind: 'place', p_subject_id: c.place.id, p_object_kind: 'gang', p_object_id: c.a.id,
      p_association: 'observed_at',
    })).id)
    entityAssociationDecide({ p_id: subjectSide, p_status: 'confirmed', p_note: 'Corroborated' })

    const rows = entityAssociationsFor({ p_kind: 'gang', p_id: c.a.id })
    expect(rows).toHaveLength(2)
    // Pending sorts first even though it was recorded second.
    expect(rows[0].id).toBe(objectSide)
    expect(rows[0].direction).toBe('object')
    expect(rows[0].other_kind).toBe('place')
    expect(rows[0].other_label).toBe('Roxwood Autos')
    expect(rows[0].status).toBe('pending_investigation')
    expect(rows[1].direction).toBe('subject')
    expect(rows[1].other_label).toBe('Ballas')
    expect(rows[1].created_by_name).toBe(c.me.display_name)
    expect(rows[1].decided_by_name).toBe(c.me.display_name)
  })

  it('registryLabel answers null for a record that is not there', () => {
    const c = cast()
    expect(registryLabel('gang', c.a.id)).toBe('Grove Street Families')
    expect(registryLabel('gang', '00000000-0000-4000-a000-00000000dead')).toBeNull()
    expect(registryLabel('spaceship', c.a.id)).toBeNull()
  })
})

describe('registry_media_attach', () => {
  beforeEach(() => { resetMockStore() })

  it('reserves the row and the private path — registry intelligence, not evidence', () => {
    const c = cast()
    const res = out(registryMediaAttach({
      p_kind: 'gang', p_entity_id: c.a.id, p_title: 'Tag on the shutter', p_filename: 'Tag Photo.JPG',
      p_mime: 'image/jpeg', p_byte_size: 2048, p_caption: 'South wall',
    }))
    expect(res.ok).toBe(true)
    expect(res.bucket).toBe('case-evidence')
    expect(res.storage_path).toBe(`registry/gang/${c.a.id}/${String(res.media_id)}/tag-photo.jpg`)
    const [media] = readRows('media')
    expect(media.kind).toBe('registry_intel')
    expect(media.case_id).toBeNull()
    expect(media.gang_id).toBe(c.a.id)
    expect(media.external_url).toBeNull()
    expect(media.storage_path).toBe(res.storage_path)
    expect(media.uploaded_by).toBe(c.me.id)
    expect(media.tags).toEqual({ caption: 'South wall' })
    // The evidence surfaces stay empty: no EV number, no digest, no custody.
    expect(media.evidence_number).toBeNull()
    expect(media.sha256).toBeNull()
    expect(media.integrity_status).toBeNull()
  })

  it('refuses an unknown kind and a blank title, and P0403s an unknown record', () => {
    const c = cast()
    expect(out(registryMediaAttach({ p_kind: 'case', p_entity_id: c.a.id, p_title: 'x', p_filename: 'x.png' })))
      .toMatchObject({ ok: false, code: 'bad_request', message: ASSOCIATION_MESSAGES.unknownKind })
    expect(out(registryMediaAttach({ p_kind: 'gang', p_entity_id: c.a.id, p_title: '   ', p_filename: 'x.png' })))
      .toMatchObject({ ok: false, code: 'bad_request', message: ASSOCIATION_MESSAGES.titleRequired })
    expectDeny(() => registryMediaAttach({ p_kind: 'gang', p_entity_id: '00000000-0000-4000-a000-00000000dead', p_title: 'x', p_filename: 'x.png' }))
    expect(readRows('media')).toHaveLength(0)
  })
})
