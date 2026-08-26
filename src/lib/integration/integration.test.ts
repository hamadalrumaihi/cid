/** Offline unit suite for the dormant integration contracts. Doubles as the
 *  knip guard: it imports (and uses) every public export of the module, so
 *  the dormant surface stays "live" to the dead-export gate without a config
 *  entry. */
import { describe, expect, it } from 'vitest'
import {
  buildIdempotencyKey, createMockProviders, isDuplicateStatus, normalizeExternalId,
} from './index'
import type {
  CitizenProvider, EvidenceProvider, ExternalCharge, ExternalCitizen,
  ExternalCustodyEntry, ExternalEvidence, ExternalLegalActor, ExternalMedia,
  ExternalOfficer, ExternalProperty, ExternalReference, ExternalStorageItem,
  ExternalType, ExternalVehicle, IdempotentRequest, IntegrationEventStatus,
  IntegrationProviderSet, IntegrationSource, LegalActorProvider, MediaProvider,
  MockSeed, OfficerProvider, PenalCodeProvider, PropertyProvider,
  SearchOptions, StorageProvider, VehicleProvider,
} from './index'

/* ── Type-level contract checks ──────────────────────────────────────────
 * These annotations fail to COMPILE if the mock stops satisfying the
 *  aggregate set or any per-domain provider interface. */
const providers: IntegrationProviderSet = createMockProviders()
const citizens: CitizenProvider = providers.citizens
const vehicles: VehicleProvider = providers.vehicles
const properties: PropertyProvider = providers.properties
const officers: OfficerProvider = providers.officers
const penalCode: PenalCodeProvider = providers.penalCode
const evidence: EvidenceProvider = providers.evidence
const storage: StorageProvider = providers.storage
const media: MediaProvider = providers.media
const legalActors: LegalActorProvider = providers.legalActors

describe('reference shapes', () => {
  it('compose a stored pointer without copying city data', () => {
    const src: IntegrationSource = { id: 'mock', displayName: 'Mock City', kind: 'fivem_server', enabled: false }
    const kind: ExternalType = 'vehicle'
    const ref: ExternalReference = { source: src.id, externalType: kind, externalId: 'v-100', externalUpdatedAt: null }
    expect(ref.snapshot).toBeUndefined() // snapshots are opt-in, never implied
  })
})

describe('mock adapter — citizens', () => {
  it('searches case-insensitively across name fields', async () => {
    const hits: ExternalCitizen[] = await citizens.searchCitizens('DOE')
    expect(hits.map((c) => c.externalId)).toEqual(['c-100'])
    expect((await citizens.searchCitizens('jane')).map((c) => c.externalId)).toEqual(['c-200'])
  })
  it('gets by id, null for unknown', async () => {
    expect((await citizens.getCitizen('c-100'))?.fullName).toBe('John Doe')
    expect(await citizens.getCitizen('nope')).toBeNull()
  })
  it('bounds results via SearchOptions.limit (blank query ⇒ whole pool)', async () => {
    const opts: SearchOptions = { limit: 1 }
    expect(await citizens.searchCitizens('', opts)).toHaveLength(1)
    expect(await citizens.searchCitizens('')).toHaveLength(2)
  })
})

describe('mock adapter — vehicles', () => {
  it("normalizes plates: 'ab-123' finds the stored AB123, ranked first", async () => {
    const hits: ExternalVehicle[] = await vehicles.searchVehicles('ab-123')
    expect(hits.map((v) => v.externalId)).toEqual(['v-100'])
  })
  it('normalizes the stored side too (no precomputed plateNormalized)', async () => {
    expect((await vehicles.searchVehicles('xy999')).map((v) => v.externalId)).toEqual(['v-200'])
  })
  it('falls back to substring on model/color', async () => {
    expect((await vehicles.searchVehicles('domin')).map((v) => v.externalId)).toEqual(['v-200'])
  })
  it('gets by id, null for unknown', async () => {
    expect((await vehicles.getVehicle('v-100'))?.plate).toBe('AB123')
    expect(await vehicles.getVehicle('v-999')).toBeNull()
  })
})

describe('mock adapter — remaining providers', () => {
  it('lists properties by owner and gets by id', async () => {
    const owned: ExternalProperty[] = await properties.getPropertiesFor('c-100')
    expect(owned.map((p) => p.externalId)).toEqual(['p-100'])
    expect(await properties.getPropertiesFor('')).toEqual([])
    expect(await properties.getProperty('p-404')).toBeNull()
  })
  it('finds officers by name or callsign', async () => {
    const byName: ExternalOfficer[] = await officers.searchOfficers('vance')
    expect(byName.map((o) => o.externalId)).toEqual(['o-100'])
    expect((await officers.searchOfficers('2b-14')).map((o) => o.externalId)).toEqual(['o-200'])
    expect((await officers.getOfficer('o-200'))?.active).toBe(false)
  })
  it('searches charges by code and title', async () => {
    const theft: ExternalCharge[] = await penalCode.searchCharges('theft')
    expect(theft.map((c) => c.externalId)).toEqual(['ch-100', 'ch-200'])
    expect((await penalCode.getCharge('ch-100'))?.fine).toBe(500)
  })
  it('serves evidence with chain of custody (search is the optional method)', async () => {
    const item: ExternalEvidence | null = await evidence.getEvidence('e-100')
    const custody: ExternalCustodyEntry[] = item?.chainOfCustody ?? []
    expect(custody[0]?.action).toBe('collected')
    const found = await evidence.searchEvidence?.('pistol')
    expect(found?.map((e) => e.externalId)).toEqual(['e-100'])
  })
  it('serves storage items linked to evidence', async () => {
    const linked: ExternalStorageItem | null = await storage.getStorageItem('s-100')
    expect(linked?.evidenceId).toBe('e-100')
    expect((await storage.searchStorageItems('locker b')).map((i) => i.externalId)).toEqual(['s-200'])
  })
  it('resolves media urls lazily, null when absent or unknown', async () => {
    const asset: ExternalMedia | null = await media.getMedia('m-100')
    expect(asset?.mediaType).toBe('bodycam')
    expect(await media.resolveUrl?.('m-100')).toBe('https://media.example.test/m-100')
    expect(await media.resolveUrl?.('m-200')).toBeNull() // known asset, no durable url
    expect(await media.resolveUrl?.('m-404')).toBeNull()
  })
  it('lists legal actors by role', async () => {
    const judges: ExternalLegalActor[] = await legalActors.listByRole('judge')
    expect(judges.map((a) => a.externalId)).toEqual(['la-200'])
    expect(await legalActors.listByRole('defense')).toEqual([])
    expect((await legalActors.getLegalActor('la-100'))?.role).toBe('prosecutor')
  })
})

describe('mock adapter — seeding & determinism', () => {
  it('replaces a passed pool wholesale, keeps the rest of the defaults', async () => {
    const seed: Partial<MockSeed> = {
      citizens: [{ source: 'mock', externalId: 'c-900', fullName: 'Zed Custom' }],
    }
    const custom = createMockProviders(seed)
    expect(await custom.citizens.getCitizen('c-100')).toBeNull()
    expect((await custom.citizens.getCitizen('c-900'))?.fullName).toBe('Zed Custom')
    expect((await custom.vehicles.getVehicle('v-100'))?.plate).toBe('AB123')
  })
  it('is deterministic across instances (no randomness, no clock)', async () => {
    const a = createMockProviders()
    const b = createMockProviders()
    expect(await a.citizens.searchCitizens('')).toEqual(await b.citizens.searchCitizens(''))
    expect(await a.evidence.getEvidence('e-100')).toEqual(await b.evidence.getEvidence('e-100'))
  })
})

describe('idempotency helpers', () => {
  it('builds a deterministic source:eventId key, whitespace-normalized', () => {
    const req: IdempotentRequest = { source: 'city-1', sourceEventId: 'evt-42', externalRequestId: 'ignored' }
    expect(buildIdempotencyKey(req)).toBe('city-1:evt-42')
    expect(buildIdempotencyKey(req)).toBe(buildIdempotencyKey({ ...req, externalRequestId: 'other' }))
    expect(buildIdempotencyKey({ source: '  city-1 ', sourceEventId: 'evt  42' })).toBe('city-1:evt 42')
  })
  it('throws on an empty key component instead of colliding silently', () => {
    expect(() => buildIdempotencyKey({ source: '  ', sourceEventId: 'evt-1' })).toThrow()
    expect(() => buildIdempotencyKey({ source: 'city-1', sourceEventId: '' })).toThrow()
  })
  it('normalizeExternalId trims and collapses, preserving case', () => {
    expect(normalizeExternalId('  AB  12 ')).toBe('AB 12')
    expect(normalizeExternalId(null)).toBe('')
    expect(normalizeExternalId(undefined)).toBe('')
  })
  it('marks only resolved statuses as duplicate-making', () => {
    const dup: IntegrationEventStatus[] = ['processed', 'duplicate']
    const notDup: IntegrationEventStatus[] = ['pending', 'quarantined', 'failed', 'retryable']
    for (const s of dup) expect(isDuplicateStatus(s)).toBe(true)
    for (const s of notDup) expect(isDuplicateStatus(s)).toBe(false)
  })
})
