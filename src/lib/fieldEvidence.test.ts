/** Unit tests for the evidence mirror.
 *
 *  What actually protects evidence is the storage policy on `storage.objects`
 *  plus the check constraints, and those were probed live — see
 *  20260912120000_field_evidence_storage.sql. Pinned here are the client-side
 *  guards that decide what the officer is told before a round trip, and the
 *  path convention that the storage policy depends on being correct.
 */

import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_BUCKET, MAX_EVIDENCE_BYTES, evidenceLabel, evidencePath,
  fileProblem, looksLikeMedal, urlProblem,
} from './fieldEvidence'
import type { FieldEvidenceRow } from './fieldEvidence'

const ev = (over: Partial<FieldEvidenceRow> = {}): FieldEvidenceRow => ({
  id: 'e1', submission_id: 's1', kind: 'upload', storage_path: 'field/s1/x.jpg',
  external_url: null, is_medal: false, title: null, description: null,
  captured_at: null, person_id: null, vehicle_id: null, org_id: null,
  location_id: null, item_id: null, added_by: null,
  created_at: '2026-08-19T00:00:00Z', ...over,
})

describe('the object path the storage policy reads', () => {
  it('puts the submission id in the second segment, where the policy looks', () => {
    // storage.foldername(name)[2] is the submission id. If this convention
    // changes, the policy stops matching and every upload is refused.
    const p = evidencePath('11111111-2222-3333-4444-555555555555', 'photo.JPG')
    const parts = p.split('/')
    expect(parts[0]).toBe('field')
    expect(parts[1]).toBe('11111111-2222-3333-4444-555555555555')
    expect(parts).toHaveLength(3)
  })

  it('keeps a lowercase extension and never trusts the original filename', () => {
    const p = evidencePath('s1', 'Evidence Photo (1).JPG')
    expect(p.endsWith('.jpg')).toBe(true)
    // The officer's filename is not part of the path: it could contain slashes
    // or dots and change what folder the object lands in.
    expect(p).not.toContain('Evidence')
    expect(p).not.toContain(' ')
  })

  it('survives a filename with no extension', () => {
    const p = evidencePath('s1', 'screenshot')
    expect(p.startsWith('field/s1/')).toBe(true)
    expect(p.endsWith('/')).toBe(false)
  })

  it('cannot be talked into escaping the submission folder', () => {
    // A filename like "../../other/x.jpg" must not produce extra segments.
    const p = evidencePath('s1', '../../etc/passwd.jpg')
    expect(p.split('/')).toHaveLength(3)
    expect(p).not.toContain('..')
  })
})

describe('files', () => {
  it('accepts the types the bucket accepts', () => {
    expect(fileProblem({ size: 1000, type: 'image/jpeg' })).toBeNull()
    expect(fileProblem({ size: 1000, type: 'video/mp4' })).toBeNull()
    expect(fileProblem({ size: 1000, type: 'application/pdf' })).toBeNull()
  })

  it('refuses a type the bucket would reject anyway, with a readable reason', () => {
    expect(fileProblem({ size: 1000, type: 'application/x-msdownload' }))
      .toMatch(/not accepted/)
    expect(fileProblem({ size: 1000, type: '' })).toMatch(/not accepted/)
  })

  it('refuses an oversized file before the upload runs', () => {
    const problem = fileProblem({ size: MAX_EVIDENCE_BYTES + 1, type: 'video/mp4' })
    expect(problem).toMatch(/50 MB/)
    // Telling them the size is what makes the message actionable.
    expect(problem).toMatch(/\d+ MB/)
  })

  it('refuses an empty file', () => {
    expect(fileProblem({ size: 0, type: 'image/png' })).toMatch(/empty/)
  })

  it('names the bucket the policies were written for', () => {
    expect(EVIDENCE_BUCKET).toBe('field-evidence')
  })
})

describe('links', () => {
  it('accepts http and https', () => {
    expect(urlProblem('https://medal.tv/clips/abc')).toBeNull()
    expect(urlProblem('http://example.com/a.png')).toBeNull()
  })

  it('refuses a scripting scheme, mirroring the trigger', () => {
    // A javascript: URL in a field a reviewer clicks is the whole point of the
    // rule; the trigger refuses it too, so this is a nicer message, not the wall.
    expect(urlProblem('javascript:alert(1)')).toMatch(/http and https/)
    expect(urlProblem('data:text/html,<script>')).toMatch(/http and https/)
  })

  it('refuses something that is not a link at all', () => {
    expect(urlProblem('the clip is on my desktop')).toMatch(/does not look like a link/)
    expect(urlProblem('   ')).toMatch(/Paste a link/)
  })
})

describe('recognising Medal', () => {
  it('matches medal.tv and its subdomains', () => {
    expect(looksLikeMedal('https://medal.tv/games/gta-v/clips/abc')).toBe(true)
    expect(looksLikeMedal('https://www.medal.tv/clips/abc')).toBe(true)
  })

  it('does not match a lookalike host', () => {
    // The trigger checks the HOST, not a substring, so a domain that merely
    // contains "medal.tv" must not be treated as Medal.
    expect(looksLikeMedal('https://medal.tv.evil.example/clips/abc')).toBe(false)
    expect(looksLikeMedal('https://notmedal.tv/clips/abc')).toBe(false)
    expect(looksLikeMedal('https://example.com/medal.tv/abc')).toBe(false)
  })

  it('is false for anything unparseable', () => {
    expect(looksLikeMedal('not a url')).toBe(false)
  })
})

describe('labels', () => {
  it('prefers the officer’s title', () => {
    expect(evidenceLabel(ev({ title: 'Van at the warehouse' }))).toBe('Van at the warehouse')
  })

  it('falls back to something meaningful per shape', () => {
    expect(evidenceLabel(ev())).toBe('Uploaded file')
    expect(evidenceLabel(ev({ kind: 'link', storage_path: null, external_url: 'https://x/y' })))
      .toBe('Linked evidence')
    expect(evidenceLabel(ev({
      kind: 'link', storage_path: null, external_url: 'https://medal.tv/c', is_medal: true,
    }))).toBe('Medal clip')
  })

  it('ignores a whitespace-only title rather than rendering a blank row', () => {
    expect(evidenceLabel(ev({ title: '   ' }))).toBe('Uploaded file')
  })
})
