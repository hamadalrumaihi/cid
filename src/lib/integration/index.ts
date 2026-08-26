/** DORMANT integration surface — provider-neutral contracts for the future
 *  FiveM/MDT/media-host integrations (spec §2/§3/§8/§10/§14).
 *
 *  Dormancy contract: nothing in app code imports this directory yet BY
 *  DESIGN. The server-side integration layer and later portal features will;
 *  until then the mock adapter and its unit tests are the only consumers,
 *  which keeps the contracts compiled, linted and exercised without wiring
 *  anything live. Adding an import from app code is a deliberate activation
 *  step, not housekeeping. */

export type {
  ExternalCharge, ExternalCitizen, ExternalCustodyEntry, ExternalEvidence,
  ExternalLegalActor, ExternalMedia, ExternalOfficer, ExternalProperty,
  ExternalReference, ExternalStorageItem, ExternalType, ExternalVehicle,
  IntegrationSource,
} from './types'
export type {
  CitizenProvider, EvidenceProvider, IntegrationProviderSet,
  LegalActorProvider, MediaProvider, OfficerProvider, PenalCodeProvider,
  PropertyProvider, SearchOptions, StorageProvider, VehicleProvider,
} from './providers'
export type { IdempotentRequest, IntegrationEventStatus } from './idempotency'
export { buildIdempotencyKey, isDuplicateStatus, normalizeExternalId } from './idempotency'
export type { MockSeed } from './mockAdapter'
export { createMockProviders } from './mockAdapter'
