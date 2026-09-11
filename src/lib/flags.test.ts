/** Feature-flag precedence (platform upgrade §2.1): env override → row →
 *  default off. Pure functions only — the store and the RPC are exercised
 *  through the MSW layer. */
import { describe, expect, it } from 'vitest'
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_META, envOverride, isFeatureFlagKey, parseOverride, resolveFlag } from './flags'

describe('feature flags', () => {
  it('declares exactly the ten contract keys, each with panel copy', () => {
    expect([...FEATURE_FLAG_KEYS].sort()).toEqual([
      'advanced_editor', 'advanced_graph', 'ai_assistant', 'crawl4ai', 'document_processing',
      'evidence_sealing', 'meilisearch', 'openfga', 'semantic_search', 'stirling_pdf',
    ])
    for (const k of FEATURE_FLAG_KEYS) {
      expect(FEATURE_FLAG_META[k].label).toBeTruthy()
      expect(FEATURE_FLAG_META[k].enables).toBeTruthy()
      expect(isFeatureFlagKey(k)).toBe(true)
    }
    expect(isFeatureFlagKey('ci_search')).toBe(false)
  })

  it('parseOverride accepts on/off only, case-insensitively', () => {
    expect(parseOverride('on')).toBe(true)
    expect(parseOverride(' OFF ')).toBe(false)
    expect(parseOverride('true')).toBeNull()
    expect(parseOverride('')).toBeNull()
    expect(parseOverride(undefined)).toBeNull()
  })

  it('an env override wins over the row in both directions', () => {
    expect(resolveFlag('meilisearch', { meilisearch: false }, { meilisearch: 'on' })).toBe(true)
    expect(resolveFlag('meilisearch', { meilisearch: true }, { meilisearch: 'off' })).toBe(false)
    expect(envOverride('meilisearch', { meilisearch: 'on' })).toBe(true)
  })

  it('without an override the row decides; a missing row is off', () => {
    expect(resolveFlag('semantic_search', { semantic_search: true }, {})).toBe(true)
    expect(resolveFlag('semantic_search', { semantic_search: false }, {})).toBe(false)
    expect(resolveFlag('semantic_search', {}, {})).toBe(false)
    // An unparseable override is ignored, not treated as "on".
    expect(resolveFlag('semantic_search', {}, { semantic_search: 'yes' })).toBe(false)
  })
})
