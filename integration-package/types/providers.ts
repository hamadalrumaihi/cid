/** CID Integration Package — provider interfaces (normative).
 *
 *  These are the read operations YOUR adapters implement against YOUR city
 *  systems — deliberately minimal (search + get per domain) so any city
 *  stack can implement them without inventing capabilities it lacks.
 *
 *  SERVER-SIDE ONLY by design: adapters run inside your city-hosted
 *  integration service. Game clients and browsers never talk to city
 *  systems or hold adapter credentials.
 *
 *  Contract shared by all methods: `get*` resolves null for an unknown id
 *  (never throws for "not found"); `search*`/`list*` resolve a bounded array
 *  ([] for no hits). Upstream failures are the adapter's to surface as
 *  rejections — callers decide retry/degrade policy. */

import type {
  ExternalCharge, ExternalCitizen, ExternalEvidence, ExternalLegalActor,
  ExternalMedia, ExternalOfficer, ExternalProperty, ExternalStorageItem,
  ExternalVehicle,
} from './integration'

/** Shared search knobs. Adapters must bound results even without `limit`. */
export interface SearchOptions {
  limit?: number
}

/** Civilian lookups (name/phone-style free text; matching strategy is the
 *  adapter's to define). */
export interface CitizenProvider {
  searchCitizens(q: string, opts?: SearchOptions): Promise<ExternalCitizen[]>
  getCitizen(externalId: string): Promise<ExternalCitizen | null>
}

/** Vehicle lookups. Search must match plates across separator/case noise
 *  (normalized-plate semantics — 'ab-123' finds AB123), not just verbatim. */
export interface VehicleProvider {
  searchVehicles(q: string, opts?: SearchOptions): Promise<ExternalVehicle[]>
  getVehicle(externalId: string): Promise<ExternalVehicle | null>
}

/** Property lookups, keyed by owner (the common investigative question). */
export interface PropertyProvider {
  getPropertiesFor(citizenExternalId: string): Promise<ExternalProperty[]>
  getProperty(externalId: string): Promise<ExternalProperty | null>
}

/** City-roster officer lookups (report/evidence attribution). */
export interface OfficerProvider {
  getOfficer(externalId: string): Promise<ExternalOfficer | null>
  searchOfficers(q: string, opts?: SearchOptions): Promise<ExternalOfficer[]>
}

/** The city's penal code (read-only reference — CID's own catalog stays
 *  separately authored). */
export interface PenalCodeProvider {
  searchCharges(q: string, opts?: SearchOptions): Promise<ExternalCharge[]>
  getCharge(externalId: string): Promise<ExternalCharge | null>
}

/** Evidence-system lookups. Search is optional: some evidence systems only
 *  support direct id fetches. */
export interface EvidenceProvider {
  getEvidence(externalId: string): Promise<ExternalEvidence | null>
  searchEvidence?(q: string, opts?: SearchOptions): Promise<ExternalEvidence[]>
}

/** Evidence-locker / storage-inventory lookups. See
 *  adapters/storage-adapter.md for the implementation contract. */
export interface StorageProvider {
  getStorageItem(externalId: string): Promise<ExternalStorageItem | null>
  searchStorageItems(q: string, opts?: SearchOptions): Promise<ExternalStorageItem[]>
}

/** Media-host lookups. `resolveUrl` is optional and exists for hosts that
 *  mint short-lived links: it returns a fresh fetchable URL (or null when
 *  the asset is unknown/gone) at access time, so CID never stores an
 *  expiring URL as if it were durable. See adapters/media-adapter.md. */
export interface MediaProvider {
  getMedia(externalId: string): Promise<ExternalMedia | null>
  resolveUrl?(externalId: string): Promise<string | null>
}

/** Justice-roster lookups (prosecutors/judges/defense for legal paperwork). */
export interface LegalActorProvider {
  getLegalActor(externalId: string): Promise<ExternalLegalActor | null>
  listByRole(role: ExternalLegalActor['role'], opts?: SearchOptions): Promise<ExternalLegalActor[]>
}

/** Everything one configured IntegrationSource can offer. A real deployment
 *  composes one set per source; a source that lacks a domain supplies a
 *  provider that resolves null/[] rather than omitting the member — callers
 *  never branch on presence. */
export interface IntegrationProviderSet {
  citizens: CitizenProvider
  vehicles: VehicleProvider
  properties: PropertyProvider
  officers: OfficerProvider
  penalCode: PenalCodeProvider
  evidence: EvidenceProvider
  storage: StorageProvider
  media: MediaProvider
  legalActors: LegalActorProvider
}
