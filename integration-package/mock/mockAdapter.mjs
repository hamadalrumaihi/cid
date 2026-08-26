/** CID Integration Package — in-memory mock provider set (plain Node ESM).
 *
 *  A standalone, zero-dependency port of the portal's reference mock adapter:
 *  implements the full IntegrationProviderSet (types/providers.ts) over an
 *  in-memory seed so you can develop and test your integration-service half
 *  with NO city systems and NO portal. Fully deterministic on purpose —
 *  fixed seed, fixed ISO timestamps, no randomness, no Date.now — so tests
 *  can assert exact values.
 *
 *  Search semantics (the part worth pinning down in a mock, because real
 *  adapters must honor the same contracts): case-insensitive substring match
 *  over the obvious display fields; vehicles additionally match on
 *  normalized plates ('ab-123' finds the stored 'AB123'), with exact-plate
 *  hits ranked first. Blank query ⇒ the whole (bounded) pool; unknown
 *  id ⇒ null.
 *
 *  Run the walkthrough: `node mock/demo.mjs` (see ../TESTING.md).
 */

const SRC = 'mock'
const T0 = '2026-08-01T12:00:00Z'
const DEFAULT_LIMIT = 20

/** Uppercase alphanumerics only; null for blank — normalized-plate matching. */
export function normPlate(v) {
  const out = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return out || null
}

/** Matching-only id normalizer: trim, collapse internal whitespace. Case and
 *  interior punctuation preserved (external ids may be case-sensitive). */
export function normalizeExternalId(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

/** Two-ish records per pool: enough to prove search filters (one hit, one
 *  miss) without becoming a fixture museum. All data fictional. */
export function defaultSeed() {
  return {
    citizens: [
      {
        source: SRC, externalId: 'c-100', characterId: 'char-100',
        firstName: 'John', lastName: 'Doe', fullName: 'John Doe',
        dob: '1990-04-12', gender: 'male', phone: '555-0100',
        address: '12 Alta St', licenses: [{ kind: 'drivers', status: 'valid' }],
        updatedAt: T0,
      },
      { source: SRC, externalId: 'c-200', fullName: 'Jane Smith', phone: '555-0200', updatedAt: T0 },
    ],
    vehicles: [
      {
        source: SRC, externalId: 'v-100', plate: 'AB123', plateNormalized: 'AB123',
        model: 'Sultan', color: 'black', class: 'sedan',
        ownerExternalId: 'c-100', ownerName: 'John Doe', updatedAt: T0,
      },
      // Plate with a separator + no precomputed plateNormalized: exercises the
      // normPlate fallback on the stored side too.
      { source: SRC, externalId: 'v-200', plate: 'XY 999', model: 'Dominator', ownerExternalId: 'c-200', updatedAt: T0 },
    ],
    properties: [
      { source: SRC, externalId: 'p-100', label: 'Alta St Apt 12', address: '12 Alta St', type: 'apartment', ownerExternalId: 'c-100', updatedAt: T0 },
      { source: SRC, externalId: 'p-200', label: 'Grove St Garage', type: 'garage', ownerExternalId: 'c-200', updatedAt: T0 },
    ],
    officers: [
      { source: SRC, externalId: 'o-100', name: 'A. Vance', callsign: '1A-01', rank: 'Detective', department: 'CID', active: true, updatedAt: T0 },
      { source: SRC, externalId: 'o-200', name: 'R. Cole', callsign: '2B-14', rank: 'Officer', department: 'Patrol', active: false, updatedAt: T0 },
    ],
    charges: [
      { source: SRC, externalId: 'ch-100', code: 'P.C. 101', title: 'Petty Theft', chargeClass: 'misdemeanor', fine: 500, jailMonths: 2 },
      { source: SRC, externalId: 'ch-200', code: 'P.C. 205', title: 'Grand Theft Auto', chargeClass: 'felony', fine: 2500, jailMonths: 12 },
    ],
    evidence: [
      {
        source: SRC, externalId: 'e-100', label: 'Recovered pistol', itemType: 'weapon',
        description: 'Pistol recovered at scene', storageLocation: 'Locker A-3',
        collectedBy: 'o-100', collectedAt: T0, caseReference: 'CASE-42',
        chainOfCustody: [{ at: T0, actor: 'o-100', action: 'collected', note: 'scene sweep' }],
      },
      { source: SRC, externalId: 'e-200', label: 'Baggie (residue)', itemType: 'narcotics', collectedAt: T0 },
    ],
    storageItems: [
      {
        source: SRC, externalId: 's-100', evidenceId: 'e-100', lockerLocation: 'Locker A-3',
        itemType: 'weapon', label: 'Pistol (tagged)', quantity: 1,
        collector: 'o-100', collectedAt: T0, sourceReference: 'CASE-42',
        chainOfCustody: [{ at: T0, actor: 'o-100', action: 'checked_in' }],
      },
      { source: SRC, externalId: 's-200', lockerLocation: 'Locker B-1', label: 'Cash bundle', quantity: 3, collectedAt: T0 },
    ],
    media: [
      {
        source: SRC, externalId: 'm-100', url: 'https://media.example.test/m-100',
        mediaType: 'bodycam', title: 'Bodycam — traffic stop', capturedBy: 'o-100',
        capturedAt: T0, caseReference: 'CASE-42', accessClassification: 'standard', checksum: 'sha256:aa11',
      },
      // No url: exercises resolveUrl's null arm for a known-but-unresolvable asset.
      { source: SRC, externalId: 'm-200', mediaType: 'photo', title: 'Scene photo 2', accessClassification: 'restricted' },
    ],
    legalActors: [
      { source: SRC, externalId: 'la-100', name: 'D. Harper', role: 'prosecutor', active: true },
      { source: SRC, externalId: 'la-200', name: 'J. Whitlock', role: 'judge', active: true },
    ],
  }
}

/* ── Matching plumbing ─────────────────────────────────────────────────── */

/** Lowercase, collapse whitespace, trim — matching only, never display. */
function fold(v) {
  return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function cap(opts) {
  return Math.max(0, opts?.limit ?? DEFAULT_LIMIT)
}

/** Case-insensitive substring filter over `fields`; blank query ⇒ the whole
 *  pool (bounded). */
function searchPool(pool, q, fields, opts) {
  const needle = fold(q)
  const hits = needle ? pool.filter((r) => fields(r).some((f) => fold(f).includes(needle))) : pool
  return hits.slice(0, cap(opts))
}

function byId(pool, externalId) {
  const id = normalizeExternalId(externalId)
  return pool.find((r) => r.externalId === id) ?? null
}

/** Build the full provider set over an in-memory seed. Everything resolves on
 *  the microtask queue — async only to honor the provider contracts.
 *  A pool you pass in `seed` replaces that default pool wholesale.
 *  @returns {object} an IntegrationProviderSet (see ../types/providers.ts) */
export function createMockProviders(seed) {
  const s = { ...defaultSeed(), ...seed }
  return {
    citizens: {
      async searchCitizens(q, opts) {
        return searchPool(s.citizens, q, (c) => [c.fullName, c.firstName, c.lastName, c.phone], opts)
      },
      async getCitizen(externalId) { return byId(s.citizens, externalId) },
    },
    vehicles: {
      async searchVehicles(q, opts) {
        // Exact-normalized-plate arm first, then substring over
        // plate/model/color; dedupe by id.
        const np = normPlate(q)
        const exact = np ? s.vehicles.filter((v) => (v.plateNormalized ?? normPlate(v.plate)) === np) : []
        const fuzzy = searchPool(s.vehicles, q, (v) => [v.plate, v.model, v.color], { limit: Number.MAX_SAFE_INTEGER })
        const seen = new Set()
        const out = []
        for (const v of [...exact, ...fuzzy]) {
          if (seen.has(v.externalId)) continue
          seen.add(v.externalId)
          out.push(v)
        }
        return out.slice(0, cap(opts))
      },
      async getVehicle(externalId) { return byId(s.vehicles, externalId) },
    },
    properties: {
      async getPropertiesFor(citizenExternalId) {
        const owner = normalizeExternalId(citizenExternalId)
        return owner ? s.properties.filter((p) => p.ownerExternalId === owner) : []
      },
      async getProperty(externalId) { return byId(s.properties, externalId) },
    },
    officers: {
      async getOfficer(externalId) { return byId(s.officers, externalId) },
      async searchOfficers(q, opts) {
        return searchPool(s.officers, q, (o) => [o.name, o.callsign, o.department], opts)
      },
    },
    penalCode: {
      async searchCharges(q, opts) {
        return searchPool(s.charges, q, (c) => [c.code, c.title], opts)
      },
      async getCharge(externalId) { return byId(s.charges, externalId) },
    },
    evidence: {
      async getEvidence(externalId) { return byId(s.evidence, externalId) },
      async searchEvidence(q, opts) {
        return searchPool(s.evidence, q, (e) => [e.label, e.description, e.caseReference], opts)
      },
    },
    storage: {
      async getStorageItem(externalId) { return byId(s.storageItems, externalId) },
      async searchStorageItems(q, opts) {
        return searchPool(s.storageItems, q, (i) => [i.label, i.itemType, i.lockerLocation], opts)
      },
    },
    media: {
      async getMedia(externalId) { return byId(s.media, externalId) },
      async resolveUrl(externalId) { return byId(s.media, externalId)?.url ?? null },
    },
    legalActors: {
      async getLegalActor(externalId) { return byId(s.legalActors, externalId) },
      async listByRole(role, opts) {
        return s.legalActors.filter((a) => a.role === role).slice(0, cap(opts))
      },
    },
  }
}
