/** v1.78 — FiveM integration prep is DORMANT
 *  (migration 20261002120000_fivem_integration_prep.sql).
 *
 *  The migration's whole promise is that it changes nothing live: six new
 *  tables exist and NOBODY can use them from a browser. This suite pins the
 *  two postures rather than any feature:
 *
 *  POSTURE (b) — fully dormant (field_submission_sources precedent: RLS on,
 *  ZERO policies, all privileges revoked from authenticated + anon):
 *    external_links, external_storage_refs, external_media_refs,
 *    external_officer_identities.
 *    An authenticated member — INCLUDING command — gets a hard
 *    "permission denied" on SELECT and INSERT alike. Not zero rows: denied.
 *
 *  POSTURE (c) — command/owner audit surface (bridge_ingestion_events
 *  precedent: one SELECT policy, no write policies):
 *    integration_sources, integration_events.
 *    A detective SELECT succeeds with ZERO rows (policy-filtered, not
 *    denied); command SELECT succeeds; but even command cannot INSERT (no
 *    write policy → row-level security violation) and a command UPDATE is
 *    policy-filtered to 0 rows. SELECT is the ONLY verb anybody has.
 *
 *  Nothing is created and nothing needs cleanup: every write in this file is
 *  asserted to FAIL, and the registry is unseeded (the detective zero-rows
 *  assertion also holds while the table is empty for command — the pin is
 *  error-vs-no-error, not row counts, except where 0 is the point).
 *
 *  Fixtures (tests/rls/README.md): lsb (active MCB detective — the plain
 *  member), director (CID Director = private.is_command() — proves even
 *  command has no write path and no posture-(b) read). Self-skipping without
 *  credentials, like every suite here. Requires migration 20261002120000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
}
const enabled = !!(ANON && PW.lsb && PW.director)
if (!enabled) console.warn('[rls:v178] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const DORMANT_TABLES = [
  'external_links',
  'external_storage_refs',
  'external_media_refs',
  'external_officer_identities',
] as const

const AUDIT_TABLES = ['integration_sources', 'integration_events'] as const

/** Minimal insert payloads that would satisfy NOT NULL if the write were ever
 *  allowed — the assertions below require them to be rejected BEFORE any
 *  constraint runs (permission / RLS, not a validity error). */
const INSERT_PROBE: Record<string, Record<string, unknown>> = {
  external_links: {
    entity_type: 'case', entity_id: '00000000-0000-0000-0000-000000000000',
    source: 'rls-test-src', external_type: 'record', external_id: 'rls-test-x',
  },
  external_storage_refs: { source: 'rls-test-src', external_id: 'rls-test-x' },
  external_media_refs: { source: 'rls-test-src', external_id: 'rls-test-x' },
  external_officer_identities: { source: 'rls-test-src', external_officer_id: 'rls-test-x' },
  integration_sources: { id: 'rls-test-src', display_name: '[rls-test] probe', kind: 'other' },
  integration_events: {
    source: 'rls-test-src', direction: 'inbound',
    event_type: 'probe', external_event_id: 'rls-test-x',
  },
}

describe.skipIf(!enabled)('v1.78 — FiveM integration prep is dormant (live)', () => {
  let lsb: C, director: C

  beforeAll(async () => {
    lsb = mk(); director = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)
  })

  afterAll(async () => {
    await Promise.all([lsb, director].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── posture (b): unreachable for everybody, at every rank ─────────────── */

  it('the four fully-dormant tables deny SELECT to a member AND to command', async () => {
    for (const t of DORMANT_TABLES) {
      for (const [who, c] of [['lsb', lsb], ['director', director]] as const) {
        const r = await c.from(t).select('id')
        expect(r.error, `${t} SELECT as ${who} must be denied`).not.toBeNull()
        expect(r.error!.message, `${t} as ${who}`).toMatch(/permission denied/i)
      }
    }
  })

  it('the four fully-dormant tables deny INSERT to a member AND to command', async () => {
    for (const t of DORMANT_TABLES) {
      for (const [who, c] of [['lsb', lsb], ['director', director]] as const) {
        const r = await c.from(t).insert(INSERT_PROBE[t])
        expect(r.error, `${t} INSERT as ${who} must be denied`).not.toBeNull()
        expect(r.error!.message, `${t} as ${who}`).toMatch(/permission denied/i)
      }
    }
  })

  /* ── posture (c): SELECT-only, and only for command/owner ──────────────── */

  it('a detective may SELECT the two audit tables but is policy-filtered to zero rows', async () => {
    for (const t of AUDIT_TABLES) {
      const r = await lsb.from(t).select('id')
      expect(r.error, `${t}: ${r.error?.message}`).toBeNull()
      expect(r.data ?? [], `${t} must be empty for a non-command member`).toHaveLength(0)
    }
  })

  it('command may SELECT the two audit tables (no error — the read policy admits it)', async () => {
    for (const t of AUDIT_TABLES) {
      const r = await director.from(t).select('id')
      expect(r.error, `${t}: ${r.error?.message}`).toBeNull()
    }
  })

  it('even command cannot INSERT into the audit tables (no write policy exists)', async () => {
    for (const t of AUDIT_TABLES) {
      const r = await director.from(t).insert(INSERT_PROBE[t])
      expect(r.error, `${t} INSERT as command must be RLS-denied`).not.toBeNull()
      expect(r.error!.message, t).toMatch(/row-level security/i)
    }
  })

  it('a command UPDATE on the audit tables is policy-filtered (0 rows, no error)', async () => {
    const src = await director.from('integration_sources')
      .update({ notes: 'rls-test probe' }).eq('id', 'rls-test-src').select('id')
    expect(src.error, src.error?.message).toBeNull()
    expect(src.data ?? []).toHaveLength(0)

    const ev = await director.from('integration_events')
      .update({ status: 'processed' }).eq('external_event_id', 'rls-test-x').select('id')
    expect(ev.error, ev.error?.message).toBeNull()
    expect(ev.data ?? []).toHaveLength(0)
  })
})
