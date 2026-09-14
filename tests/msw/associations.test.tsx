/** Entity associations (migration 20261106120000) end-to-end through MSW —
 *  the real db.ts / supabase-js chain against the mock handlers.
 *
 *  What is proven here:
 *    · the table is SELECT-only: a direct client INSERT is PostgREST's grant
 *      denial (403 / 42501), so nothing can bypass the RPCs;
 *    · a confirm with no reason comes back `{ok:false, code:'bad_request'}`
 *      from the server, which is why the UI collects one first;
 *    · a duplicate create answers `created:false` rather than writing twice;
 *    · the section renders a pending row FIRST, labelled "Pending
 *      Investigation" and worded as an observation and not a finding, with
 *      the SUBMITTER named as the submitter — and a decided row instead
 *      carries who ruled, when and why.
 *
 *  The panel variant takes the cosmetic gates as props (the harness has no
 *  AuthProvider by design); next/navigation is stubbed because EntityLink
 *  routes through useToolNav. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { Tables } from '@/lib/database.types'
import { AssociationsPanel } from '@/components/shared/AssociationsSection'
import { createAssociation, decideAssociation, listAssociations } from '@/lib/associations'
import { resetRealtime, rowVersionKey, useRealtimeStore } from '@/lib/realtime'
import { attachRegistryMedia, registryPhotoProblem } from '@/lib/registryMedia'
import { insert } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { roleSession } from '@/mocks/scenarios'
import { readRows, seedRows } from '@/mocks/store'
import { mockStorageObjects, resetMockStorage } from '@/mocks/handlers/platform'
import { render } from './render'

const pushes: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { pushes.push(href) }, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/gangs',
}))

let seq = 0
function gangRow(name: string): Tables<'gangs'> {
  seq += 1
  return {
    aliases: null, classification: null, colors: null, confidence: null, created_at: '2026-07-01T12:00:00.000Z',
    created_by: null, delete_batch: null, delete_reason: null, deleted_at: null, deleted_by: null,
    id: `00000000-0000-4000-b000-00000000000${seq}`, intelligence_summary: null, lead_detective_id: null,
    merged_at: null, merged_by: null, merged_into: null, name, next_review_at: null, notes: null, reviewed_at: null,
    reviewed_by: null, siu_hidden: false, siu_hidden_at: null, siu_hidden_by: null, status: 'active',
    threat_level: 'medium', updated_at: '2026-07-01T12:00:00.000Z',
  } as unknown as Tables<'gangs'>
}

async function signedIn() {
  const { credentials, profile } = roleSession('detective')
  const { error } = await supabase().auth.signInWithPassword({ email: credentials.email, password: credentials.password })
  expect(error).toBeNull()
  const [a, b] = seedRows('gangs', [gangRow('Grove Street Families'), gangRow('Ballas')])
  return { profile, a, b }
}

describe('entity_associations — the write wall', () => {
  it('a direct client INSERT is refused: every write is an RPC', async () => {
    const { a, b } = await signedIn()
    const res = await insert('entity_associations', {
      subject_kind: 'gang', subject_id: a.id, object_kind: 'gang', object_id: b.id, association: 'alliance',
    })
    expect(res.data).toBeNull()
    expect(res.error?.code).toBe('42501')
    expect(readRows('entity_associations')).toHaveLength(0)
  })

  it('a duplicate create is returned, not duplicated', async () => {
    const { a, b } = await signedIn()
    const first = await createAssociation({
      subjectKind: 'gang', subjectId: a.id, objectKind: 'gang', objectId: b.id, association: 'unconfirmed_association',
    })
    expect(first.ok && first.data.created).toBe(true)
    const again = await createAssociation({
      subjectKind: 'gang', subjectId: a.id, objectKind: 'gang', objectId: b.id, association: 'unconfirmed_association',
    })
    expect(again.ok).toBe(true)
    if (again.ok) {
      expect(again.data.created).toBe(false)
      expect(again.data.message).toContain('already recorded')
    }
    expect(readRows('entity_associations')).toHaveLength(1)
  })

  it('confirming without a reason is refused by the server', async () => {
    const { a, b } = await signedIn()
    const created = await createAssociation({
      subjectKind: 'gang', subjectId: a.id, objectKind: 'gang', objectId: b.id, association: 'unconfirmed_association',
    })
    expect(created.ok).toBe(true)
    const id = created.ok ? String(created.data.id) : ''
    const refused = await decideAssociation(id, 'confirmed')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.code).toBe('bad_request')

    const decided = await decideAssociation(id, 'confirmed', { note: 'Two independent sightings' })
    expect(decided.ok).toBe(true)
    const [row] = await listAssociations('gang', a.id)
    expect(row.status).toBe('confirmed')
    expect(row.decision_note).toBe('Two independent sightings')
  })
})

describe('registry_media_attach', () => {
  it('reserves the row, then puts the ORIGINAL bytes in the private bucket — not on a public host', async () => {
    resetMockStorage()
    const { profile, a } = await signedIn()
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'Shutter Tag.PNG', { type: 'image/png' })
    const { mediaId, storagePath } = await attachRegistryMedia({ kind: 'gang', entityId: a.id, file, title: 'Tag on the shutter' })

    expect(storagePath).toBe(`registry/gang/${a.id}/${mediaId}/shutter-tag.png`)
    const [media] = readRows('media')
    expect(media.id).toBe(mediaId)
    expect(media.kind).toBe('registry_intel')
    expect(media.case_id).toBeNull()
    expect(media.gang_id).toBe(a.id)
    expect(media.external_url).toBeNull()
    expect(media.uploaded_by).toBe(profile.id)
    // Registry intelligence is not case evidence: no EV number, no digest.
    expect(media.evidence_number).toBeNull()
    expect(media.sha256).toBeNull()

    const stored = mockStorageObjects().filter((o) => o.path === storagePath)
    expect(stored).toHaveLength(1)
    expect(stored[0].bucket).toBe('case-evidence')
    expect(stored[0].owner).toBe(profile.id)
    resetMockStorage()
  })

  it('refuses a non-image before any bytes move', () => {
    expect(registryPhotoProblem({ size: 10, type: 'application/pdf' })).toContain('photographs only')
    expect(registryPhotoProblem({ size: 0, type: 'image/png' })).toContain('empty')
    expect(registryPhotoProblem({ size: 10, type: 'image/png' })).toBeNull()
  })
})

describe('AssociationsPanel', () => {
  it('puts the pending observation first and words it as an observation, not a finding', async () => {
    const { profile, a, b } = await signedIn()
    const [c] = seedRows('gangs', [gangRow('Vagos')])
    const older = await createAssociation({
      subjectKind: 'gang', subjectId: a.id, objectKind: 'gang', objectId: b.id, association: 'rivalry',
    })
    await decideAssociation(older.ok ? String(older.data.id) : '', 'confirmed', { note: 'Corroborated by two reports' })
    await createAssociation({
      subjectKind: 'gang', subjectId: a.id, objectKind: 'gang', objectId: c.id,
      association: 'unconfirmed_association', note: 'Both sets of colours on one shopfront',
    })

    const view = await render(
      <AssociationsPanel kind="gang" id={a.id} label="Grove Street Families" canCreate canDecide viewerId={profile.id} isCommand={false} />,
    )
    try {
      await view.settle(30)
      const text = view.container.textContent ?? ''

      // The claim reads exactly as the vocabulary says — never "alliance".
      expect(text).toContain('Unconfirmed Association')
      expect(text).toContain('Pending Investigation')
      expect(text).toContain('an observation on the record, not a finding')
      expect(text).not.toMatch(/alliance|merger/i)

      // The submitter is named AS the submitter, not as an investigator.
      expect(text).toContain(`Submitted by ${profile.display_name}`)
      expect(text).toContain('Vagos')
      expect(text).toContain('Ballas')

      // …and the decided row carries its decision instead of the notice.
      expect(text).toContain('Corroborated by two reports')

      // Pending sorts first: its card precedes the confirmed one in the DOM.
      const body = view.container.innerHTML
      expect(body.indexOf('Unconfirmed Association')).toBeLessThan(body.indexOf('Rivalry'))
      expect(body.indexOf('1 pending')).toBeGreaterThan(-1)
    } finally {
      await view.unmount()
    }
  })

  it('says so honestly when there is nothing recorded', async () => {
    const { profile, a } = await signedIn()
    const view = await render(
      <AssociationsPanel kind="gang" id={a.id} label="Grove Street Families" canCreate={false} canDecide={false} viewerId={profile.id} isCommand={false} />,
    )
    try {
      await view.settle(30)
      expect(view.container.textContent).toContain('No associations recorded')
      expect(view.container.textContent).toContain('both records')
      expect(view.container.querySelector('button')).toBeNull()
    } finally {
      await view.unmount()
    }
  })
})

/* ── Live updates ───────────────────────────────────────────────────────── */
//
// Two investigators, one dossier: B has the gang open while A records,
// decides or amends an association elsewhere. Before this, B read a snapshot
// taken when the section mounted and kept it until a manual refresh.
//
// The channels are faked (a real one would open a websocket to a host that
// cannot resolve) but everything downstream is real: the subscription the
// section registers, the store counter a change bumps, the effect that
// re-reads, and `entity_associations_for` answering under the mock's own
// visibility rules. Nothing here reads an event payload — the refreshed list
// is the server's answer to THIS viewer, which is the whole point.
describe('AssociationsPanel — live updates', () => {
  interface FakeChannel {
    name: string
    handlers: Array<() => void>
    on: (ev: string, filter: Record<string, unknown>, handler: () => void) => FakeChannel
    subscribe: (cb?: (status: string) => void) => FakeChannel
  }
  let opened: FakeChannel[] = []
  let closed: string[] = []

  const fakeChannels = () => {
    const client = supabase()
    vi.spyOn(client, 'channel').mockImplementation(((name: string) => {
      const ch: FakeChannel = {
        name, handlers: [],
        on(_ev, _filter, handler) { ch.handlers.push(handler); return ch },
        subscribe() { return ch },
      }
      opened.push(ch)
      return ch
    }) as unknown as typeof client.channel)
    vi.spyOn(client, 'removeChannel').mockImplementation((async (ch: FakeChannel) => {
      closed.push(ch.name)
      return 'ok'
    }) as unknown as typeof client.removeChannel)
  }

  beforeEach(() => {
    opened = []; closed = []
    resetRealtime()
    useRealtimeStore.setState({ versions: {} })
    fakeChannels()
  })
  afterEach(() => { vi.restoreAllMocks(); resetRealtime() })

  const chanFor = (column: string, id: string) =>
    opened.find((c) => c.name === `rt_entity_associations_${column}_${id}`)

  /** What the other investigator's write looks like from here: a row that
   *  appeared in the database without this session doing anything. */
  let assocSeq = 0
  const recordedByAnother = (subjectId: string, objectId: string, association: string) => {
    assocSeq += 1
    return seedRows('entity_associations', [{
      id: `aa000000-0000-4000-b000-00000000000${assocSeq}`,
      subject_kind: 'gang', subject_id: subjectId, object_kind: 'gang', object_id: objectId,
      association, status: 'pending_investigation', confidence: null, source_type: null,
      note: null, first_observed: null, last_confirmed: null, decided_by: null, decided_at: null,
      decision_note: null, created_by: null, created_at: '2026-07-02T12:00:00.000Z',
      updated_at: '2026-07-02T12:00:00.000Z', deleted_at: null, deleted_by: null,
      delete_reason: null, delete_batch: null,
    } as unknown as Tables<'entity_associations'>])
  }

  const panel = (id: string, viewerId: string) => (
    <AssociationsPanel kind="gang" id={id} label="Grove Street Families"
      canCreate={false} canDecide={false} viewerId={viewerId} isCommand={false} />
  )

  it('subscribes to this record only — both ends of the link, nothing else', async () => {
    const { profile, a } = await signedIn()
    const view = await render(panel(a.id, profile.id))
    try {
      await view.settle(30)
      expect(opened.map((c) => c.name).sort()).toEqual([
        `rt_entity_associations_object_id_${a.id}`,
        `rt_entity_associations_subject_id_${a.id}`,
      ])
    } finally { await view.unmount() }
  })

  it('picks up an association another investigator recorded, without a manual refresh', async () => {
    const { profile, a, b } = await signedIn()
    const view = await render(panel(a.id, profile.id))
    try {
      await view.settle(30)
      expect(view.container.textContent).toContain('No associations recorded')

      recordedByAnother(a.id, b.id, 'unconfirmed_association')
      await act(async () => { chanFor('subject_id', a.id)!.handlers[0]!() })
      await view.settle(30)

      expect(view.container.textContent).toContain('Unconfirmed Association')
      expect(view.container.textContent).toContain('Ballas')
    } finally { await view.unmount() }
  })

  it('refreshes when the record is the OBJECT end of someone else’s link', async () => {
    const { profile, a, b } = await signedIn()
    const view = await render(panel(a.id, profile.id))
    try {
      await view.settle(30)
      recordedByAnother(b.id, a.id, 'rivalry')
      await act(async () => { chanFor('object_id', a.id)!.handlers[0]!() })
      await view.settle(30)
      expect(view.container.textContent).toContain('Rivalry')
    } finally { await view.unmount() }
  })

  it('ignores a change to a record it is not showing', async () => {
    const { profile, a, b } = await signedIn()
    const [c] = seedRows('gangs', [gangRow('Vagos')])
    const view = await render(panel(a.id, profile.id))
    try {
      await view.settle(30)
      recordedByAnother(b.id, c.id, 'alliance')
      // Another dossier's counter moves; this section must not re-read.
      await act(async () => { useRealtimeStore.getState().bump(rowVersionKey('entity_associations', 'subject_id', b.id)) })
      await view.settle(30)
      expect(view.container.textContent).toContain('No associations recorded')
    } finally { await view.unmount() }
  })

  it('never reveals an association whose far end the server withholds', async () => {
    const { profile, a } = await signedIn()
    // A record the server will not return — the same cheap stand-in the RLS
    // suite uses for a hidden id (tests/rls/v193a). The mock's visibility is
    // deliberately shallow ("the row exists and is live"); the real wall,
    // `perm_registry_visible` on BOTH endpoints, is proven against the live
    // database in v193a/v193b. What this pins is the client half: an event
    // causes a RE-READ, so whatever the caller may not see stays unseen.
    const [withheld] = seedRows('gangs', [
      { ...gangRow('Withheld Set'), deleted_at: '2026-07-02T00:00:00.000Z' } as Tables<'gangs'>,
    ])
    const view = await render(panel(a.id, profile.id))
    try {
      await view.settle(30)
      recordedByAnother(a.id, withheld.id, 'unconfirmed_association')
      // The event says "something changed"; the ANSWER still comes from the
      // server, under this viewer's own policies.
      await act(async () => { chanFor('subject_id', a.id)!.handlers[0]!() })
      await view.settle(30)
      expect(view.container.textContent).not.toContain('Withheld Set')
      expect(view.container.textContent).toContain('No associations recorded')
    } finally { await view.unmount() }
  })

  it('closes its channels when the dossier closes, and when the record changes', async () => {
    const { profile, a, b } = await signedIn()
    const view = await render(panel(a.id, profile.id))
    await view.settle(30)
    expect(closed).toEqual([])

    // Same section, different record: the old subscriptions go with it.
    await act(async () => { view.rerender(panel(b.id, profile.id)) })
    await view.settle(30)
    expect(closed.sort()).toEqual([
      `rt_entity_associations_object_id_${a.id}`,
      `rt_entity_associations_subject_id_${a.id}`,
    ])

    await view.unmount()
    expect(closed.sort()).toContain(`rt_entity_associations_subject_id_${b.id}`)
  })
})
