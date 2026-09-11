import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PACKET_SECTIONS, PACKET_SECTIONS, PACKET_SECTION_IDS, PACKET_TYPES,
  isPacketSection, isPacketType, jobActive, jobCancellable,
  jobRetryable, jobStatusLabel, normalizeSections, packetCancellable, packetRetryable, packetStatusLabel,
  packetStatusTone, packetTypeLabel, sectionLabel, unwrapJsonRpc,
} from './packets'

describe('packet vocabulary (contract §2.5)', () => {
  it('lists the five packet types and the eighteen sections in renderer order', () => {
    expect(PACKET_TYPES.map((t) => t.id)).toEqual(['full', 'doj', 'command', 'disclosure', 'custom'])
    expect(PACKET_SECTIONS.map((s) => s.id)).toEqual([
      'cover', 'overview', 'summary', 'investigators', 'persons', 'vehicles', 'gangs', 'places', 'narcotics', 'reports',
      'evidence_index', 'evidence_images', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline', 'signatures',
    ])
    for (const t of PACKET_TYPES) { expect(t.label).toBeTruthy(); expect(t.description).toBeTruthy() }
    for (const s of PACKET_SECTIONS) expect(s.label).toBeTruthy()
  })

  it('mirrors the server presets exactly', () => {
    expect(DEFAULT_PACKET_SECTIONS.full).toEqual(PACKET_SECTION_IDS)
    expect(DEFAULT_PACKET_SECTIONS.doj).toEqual([
      'cover', 'overview', 'summary', 'persons', 'vehicles', 'evidence_index', 'reports', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline',
    ])
    expect(DEFAULT_PACKET_SECTIONS.command).toEqual(['cover', 'overview', 'summary', 'investigators', 'evidence_index', 'timeline', 'signatures'])
    expect(DEFAULT_PACKET_SECTIONS.disclosure).toEqual(['cover', 'overview', 'reports', 'evidence_index'])
    expect(DEFAULT_PACKET_SECTIONS.custom).toEqual([])
    // Every preset id is a real section.
    for (const ids of Object.values(DEFAULT_PACKET_SECTIONS)) for (const id of ids) expect(isPacketSection(id)).toBe(true)
  })

  it('type / section guards and labels', () => {
    expect(isPacketType('doj')).toBe(true)
    expect(isPacketType('pdf')).toBe(false)
    expect(isPacketType(null)).toBe(false)
    expect(isPacketSection('evidence_index')).toBe(true)
    expect(isPacketSection('cover_letter')).toBe(false)
    expect(packetTypeLabel('command')).toBe('Command brief')
    expect(packetTypeLabel('weird')).toBe('weird')
    expect(packetTypeLabel(null)).toBe('Packet')
    expect(sectionLabel('legal_decisions')).toBe('Legal decisions')
    expect(sectionLabel('made_up')).toBe('made up')
  })

  it('normalizeSections restores renderer order, drops unknowns and duplicates', () => {
    expect(normalizeSections(['timeline', 'cover', 'bogus', 'cover', 'persons'])).toEqual(['cover', 'persons', 'timeline'])
    expect(normalizeSections([])).toEqual([])
  })
})

describe('packet status', () => {
  it('labels and tones every status, unknown falls back neutrally', () => {
    expect(packetStatusLabel('queued')).toBe('Queued')
    expect(packetStatusLabel('rendering')).toBe('Rendering')
    expect(packetStatusLabel('ready')).toBe('Ready')
    expect(packetStatusLabel('failed')).toBe('Failed')
    expect(packetStatusLabel('cancelled')).toBe('Cancelled')
    expect(packetStatusLabel('odd')).toBe('odd')
    expect(packetStatusLabel(null)).toBe('Unknown')
    expect(packetStatusTone('ready')).toBe('good')
    expect(packetStatusTone('failed')).toBe('danger')
    expect(packetStatusTone('rendering')).toBe('accent')
    expect(packetStatusTone(undefined)).toBe('neutral')
  })

  it('cancel only while queued with a job; retry only after failure / cancellation', () => {
    expect(packetCancellable({ status: 'queued', job_id: 'j' })).toBe(true)
    expect(packetCancellable({ status: 'queued', job_id: null })).toBe(false)
    expect(packetCancellable({ status: 'rendering', job_id: 'j' })).toBe(false)
    expect(packetRetryable({ status: 'failed', job_id: 'j' })).toBe(true)
    expect(packetRetryable({ status: 'cancelled', job_id: 'j' })).toBe(true)
    expect(packetRetryable({ status: 'ready', job_id: 'j' })).toBe(false)
    expect(packetRetryable({ status: 'failed', job_id: null })).toBe(false)
  })
})

describe('unwrapJsonRpc', () => {
  it('folds errors, refusals and success into one shape', () => {
    expect(unwrapJsonRpc({ data: null, error: { message: 'permission denied for table x', code: '42501' } }))
      .toEqual({ ok: false, message: 'You don’t have permission to do that.', code: '42501', data: null })
    expect(unwrapJsonRpc({ data: { ok: false, code: 'bad_request', message: 'no sections' }, error: null }))
      .toMatchObject({ ok: false, code: 'bad_request', message: 'no sections' })
    expect(unwrapJsonRpc({ data: { ok: true, id: 'p1', job_id: 'j1' }, error: null }))
      .toEqual({ ok: true, message: null, code: null, data: { ok: true, id: 'p1', job_id: 'j1' } })
    expect(unwrapJsonRpc({ data: 'nope', error: null }).ok).toBe(false)
    expect(unwrapJsonRpc({ data: [], error: null }).ok).toBe(false)
  })
})

describe('jobs vocabulary', () => {
  it('status labels', () => {
    expect(jobStatusLabel('running')).toBe('Running')
    expect(jobStatusLabel('claimed')).toBe('Starting')
    expect(jobStatusLabel('succeeded')).toBe('Done')
    expect(jobStatusLabel('x')).toBe('x')
    expect(jobStatusLabel(null)).toBe('Unknown')
  })

  it('cancel / retry / active rules', () => {
    expect(jobCancellable({ status: 'queued', created_by: 'me' }, 'me', false)).toBe(true)
    expect(jobCancellable({ status: 'queued', created_by: 'you' }, 'me', false)).toBe(false)
    expect(jobCancellable({ status: 'queued', created_by: 'you' }, 'me', true)).toBe(true)
    expect(jobCancellable({ status: 'running', created_by: 'me' }, 'me', true)).toBe(false)
    expect(jobRetryable({ status: 'failed' }, true)).toBe(true)
    expect(jobRetryable({ status: 'failed' }, false)).toBe(false)
    expect(jobRetryable({ status: 'succeeded' }, true)).toBe(false)
    expect(jobActive({ status: 'claimed' })).toBe(true)
    expect(jobActive({ status: 'succeeded' })).toBe(false)
  })
})
