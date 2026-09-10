import { describe, expect, it } from 'vitest'
import { MUTABLE_NOTIF_TYPES, OPTIONAL_NOTIF_CATEGORIES } from './notifications'
import { NOTIF_LABEL } from './notifText'

/** Governance pins for the mute allow-list — the constants are pure; the db
 *  helpers themselves are covered by the RLS/MSW suites. */

/** Types that must NEVER be mutable: assignments, mentions, sign-off
 *  decisions, access/security and the whole legal/justice stream. */
const MANDATORY = [
  'task_assigned', 'case_assigned', 'case_handover', 'chat_mention', 'mention',
  'signoff_waiting', 'signoff_denied', 'signoff_changes', 'signoff_escalated',
  'access_requested', 'access_granted', 'access_denied',
  'login_denied', 'login_restored',
  'legal_request', 'legal_update', 'legal_decision', 'legal_coverage',
  'membership_request', 'membership_update',
  'restricted_break_glass', 'restricted_access_requested',
  'tracker_pending', // a co-sign request is work, not FYI
]

describe('OPTIONAL_NOTIF_CATEGORIES', () => {
  it('every mutable type is a real NOTIF_LABEL type', () => {
    for (const t of MUTABLE_NOTIF_TYPES) expect(NOTIF_LABEL[t], t).toBeDefined()
  })

  it('no mandatory type is ever mutable', () => {
    for (const t of MANDATORY) expect(MUTABLE_NOTIF_TYPES.has(t), t).toBe(false)
  })

  it('categories stay small, labelled and non-overlapping', () => {
    expect(OPTIONAL_NOTIF_CATEGORIES.length).toBeLessThanOrEqual(5)
    const all = OPTIONAL_NOTIF_CATEGORIES.flatMap((c) => c.types)
    expect(new Set(all).size).toBe(all.length)
    for (const c of OPTIONAL_NOTIF_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.hint.length).toBeGreaterThan(0)
      expect(c.types.length).toBeGreaterThan(0)
    }
  })
})

/* ── Phase 7 (P7-07): Discord opt-in categories ─────────────────────────── */
import { ALL_DISCORD_CATEGORY_KEYS, DISCORD_CATEGORIES, discordCategoryOf } from './notifications'
import { NOTIF_CATEGORY } from './notifText'

describe('DISCORD_CATEGORIES', () => {
  it('every category the JSON assigns is one the profile UI offers (or "other")', () => {
    const offered = new Set([...ALL_DISCORD_CATEGORY_KEYS, 'other'])
    for (const [type, cat] of Object.entries(NOTIF_CATEGORY)) expect(offered.has(cat), `${type} → ${cat}`).toBe(true)
  })

  it('pins the contract mapping for the load-bearing kinds', () => {
    expect(discordCategoryOf('task_assigned')).toBe('assignments')
    expect(discordCategoryOf('blocker_assigned')).toBe('assignments')
    expect(discordCategoryOf('siu_case_assigned')).toBe('assignments')
    expect(discordCategoryOf('signoff_waiting')).toBe('decisions')
    expect(discordCategoryOf('access_requested')).toBe('decisions')
    expect(discordCategoryOf('membership_request')).toBe('decisions')
    expect(discordCategoryOf('legal_request')).toBe('legal')
    expect(discordCategoryOf('ada_assignment')).toBe('legal')
    expect(discordCategoryOf('chat_mention')).toBe('mentions')
    expect(discordCategoryOf('action_escalated')).toBe('escalations')
    expect(discordCategoryOf('signoff_escalated')).toBe('escalations')
    expect(discordCategoryOf('legal_escalated')).toBe('escalations')
    expect(discordCategoryOf('stale_case')).toBe('escalations')
    expect(discordCategoryOf('intel_new')).toBe('intel')
    expect(discordCategoryOf('report_submitted')).toBe('reports')
    expect(discordCategoryOf('announcement')).toBe('announcements')
    expect(discordCategoryOf('login_denied')).toBe('security')
    expect(discordCategoryOf('audit_chain_mismatch')).toBe('security')
    expect(discordCategoryOf('client_error')).toBe('security')
    // Unmapped → other, always DM'd when a title exists (only FYI kinds may
    // sit there — see the mutability pin below).
    expect(discordCategoryOf('info')).toBe('other')
    expect(discordCategoryOf('rico_ready')).toBe('other')
    expect(discordCategoryOf('made_up')).toBe('other')
  })

  it('every decision-like kind sits in a MUTABLE category, never in other (M2)', () => {
    // `other` is always DM'd and cannot be switched off, so a kind whose DM
    // would announce a decision (or that used to carry decision text) must
    // live where the recipient can mute it.
    const decisionLike = [
      'restricted_access_requested', 'restricted_access_granted', 'restricted_access_denied', 'restricted_access_revoked',
      'surveillance_decided',
      'siu_reconcile', 'siu_access_request', 'siu_access_decision', 'siu_appointed', 'siu_compartment_granted',
      'narcotic_suggestion', 'document_suggestion', 'entity_update_suggested', 'entity_suggestion_decided',
      'member_approved', 'tracker_pending', 'tracker_authorized',
    ]
    for (const t of decisionLike) expect(discordCategoryOf(t), t).toBe('decisions')
    expect(discordCategoryOf('restricted_break_glass')).toBe('security')
    // Nothing decision-shaped is left in `other`.
    const leftInOther = Object.entries(NOTIF_CATEGORY).filter(([, c]) => c === 'other').map(([t]) => t)
    for (const t of leftInOther) expect(/decid|decision|suggest|access|granted|denied|revoked|approved|pending|authorized/.test(t), t).toBe(false)
  })

  it('categories are unique, labelled and hinted', () => {
    const keys = DISCORD_CATEGORIES.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of DISCORD_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.hint.length).toBeGreaterThan(0)
    }
  })
})

/* ── M1: a failed pref read is NOT "every category" ─────────────────────── */
import { beforeEach, vi } from 'vitest'
import { list } from './db'
import { loadDiscordCategories } from './notifications'

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, list: vi.fn() }
})
const listMock = vi.mocked(list)
beforeEach(() => { listMock.mockReset() })

describe('loadDiscordCategories', () => {
  it('no row → every category (pre-Phase-7 behaviour)', async () => {
    listMock.mockResolvedValue([] as never)
    expect(await loadDiscordCategories()).toEqual([...ALL_DISCORD_CATEGORY_KEYS])
  })

  it('a row with [] → none; unknown keys are dropped', async () => {
    listMock.mockResolvedValue([{ value: { categories: [] } }] as never)
    expect(await loadDiscordCategories()).toEqual([])
    listMock.mockResolvedValue([{ value: { categories: ['legal', 'bogus', 7, 'mentions'] } }] as never)
    expect(await loadDiscordCategories()).toEqual(['legal', 'mentions'])
  })

  it('a FAILED read → null, distinguishable from "no row" (never widened)', async () => {
    listMock.mockRejectedValue(new Error('permission denied'))
    expect(await loadDiscordCategories()).toBeNull()
  })
})
