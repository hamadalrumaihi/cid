/** CID Integration Package — external record shapes (normative).
 *
 *  Self-contained restatement of the CID lane's provider-neutral read models:
 *  what your adapters return about city records, without depending on any
 *  one framework (QB-Core/ESX/ox_inventory/vendor-MDT specifics live behind
 *  YOUR adapters, mapped onto these shapes).
 *
 *  Ownership rules (contract/EXTERNAL-IDS.md): city data stays
 *  city-authoritative. CID stores ExternalReference pointers
 *  (source + type + id), never a live mirror of city records. When a copy IS
 *  taken it is a deliberate, clearly-marked `snapshot` — never an implicit
 *  cache — and it never overwrites the city's copy.
 *
 *  Every field beyond identity is optional: city schemas vary wildly, and an
 *  adapter must return a sparse record rather than fabricate data. All
 *  timestamps are ISO-8601 strings as supplied by the source system. */

/** A configured upstream system. `id` is the stable key every External*
 *  record and reference carries in its `source` field (e.g. 'fivem-main'). */
export interface IntegrationSource {
  id: string
  displayName: string
  kind: 'fivem_server' | 'mdt' | 'media_host' | 'other'
  enabled: boolean
}

/** The record kinds an external system can be asked about — the discriminator
 *  for stored references. */
export type ExternalType =
  | 'citizen' | 'vehicle' | 'property' | 'officer' | 'evidence'
  | 'storage_item' | 'media' | 'charge' | 'legal_actor' | 'record'

/** What CID persists instead of city data: a pointer into a source system.
 *  `snapshot` is the ONLY sanctioned copy mechanism — present when a workflow
 *  deliberately captured the record's state (and marked it as such), absent
 *  otherwise. `externalUpdatedAt` is the source's own timestamp at capture,
 *  for staleness display — never used to sync. */
export interface ExternalReference {
  source: string
  externalType: ExternalType
  externalId: string
  externalUpdatedAt?: string | null
  snapshot?: Record<string, unknown>
}

/** A civilian record as the city knows it. `fullName` is the only guaranteed
 *  display field; frameworks that split names populate first/last too.
 *  `characterId` is the framework's character key when distinct from
 *  `externalId` (e.g. citizenid vs. row id). */
export interface ExternalCitizen {
  source: string
  externalId: string
  characterId?: string
  firstName?: string
  lastName?: string
  fullName: string
  dob?: string
  gender?: string
  phone?: string
  address?: string
  licenses?: { kind: string; status: string }[]
  photoUrl?: string
  updatedAt?: string
}

/** A registered vehicle. `plate` is display-authoritative; `plateNormalized`
 *  (when the source provides one) is uppercase alphanumerics only. */
export interface ExternalVehicle {
  source: string
  externalId: string
  plate: string
  plateNormalized?: string
  model?: string
  color?: string
  class?: string
  ownerExternalId?: string
  ownerName?: string
  updatedAt?: string
}

/** An owned property/address record. */
export interface ExternalProperty {
  source: string
  externalId: string
  label: string
  address?: string
  type?: string
  ownerExternalId?: string
  updatedAt?: string
}

/** A sworn officer as the city roster knows them — for attribution on
 *  imported reports/evidence, not for CID's own member roster. */
export interface ExternalOfficer {
  source: string
  externalId: string
  name: string
  callsign?: string
  rank?: string
  department?: string
  active?: boolean
  updatedAt?: string
}

/** One chain-of-custody transfer as recorded by the source system. */
export interface ExternalCustodyEntry {
  at: string
  actor: string
  action: string
  note?: string
}

/** An evidence record held by the city's evidence system. `caseReference` is
 *  the SOURCE system's case identifier, not a CID case id. */
export interface ExternalEvidence {
  source: string
  externalId: string
  label: string
  itemType?: string
  description?: string
  storageLocation?: string
  collectedBy?: string
  collectedAt?: string
  caseReference?: string
  chainOfCustody?: ExternalCustodyEntry[]
}

/** A physical item in an evidence locker/storage system (may be the storage
 *  side of an ExternalEvidence record via `evidenceId`, or standalone). */
export interface ExternalStorageItem {
  source: string
  externalId: string
  evidenceId?: string
  lockerLocation?: string
  itemType?: string
  label: string
  quantity?: number
  collector?: string
  collectedAt?: string
  sourceReference?: string
  chainOfCustody?: ExternalCustodyEntry[]
}

/** A media asset on an external host. `url` is optional on purpose: hosts
 *  that mint expiring links resolve lazily via MediaProvider.resolveUrl.
 *  `accessClassification: 'restricted'` maps to CID's restricted-access
 *  handling. */
export interface ExternalMedia {
  source: string
  externalId: string
  url?: string
  mediaType: 'bodycam' | 'screenshot' | 'photo' | 'video' | 'audio' | 'scene' | 'evidence' | 'other'
  title?: string
  description?: string
  capturedBy?: string
  capturedAt?: string
  caseReference?: string
  evidenceReference?: string
  accessClassification?: 'standard' | 'restricted'
  checksum?: string
}

/** A penal-code charge as the city's code defines it. Fine/jail terms are the
 *  SOURCE's numbers — CID's own penal catalog stays separately authored. */
export interface ExternalCharge {
  source: string
  externalId: string
  code?: string
  title: string
  chargeClass?: string
  fine?: number
  jailMonths?: number
  description?: string
}

/** A justice-system participant (DOJ roster, court records) for attribution
 *  on imported legal paperwork. */
export interface ExternalLegalActor {
  source: string
  externalId: string
  name: string
  role: 'prosecutor' | 'judge' | 'attorney_general' | 'defense' | 'other'
  active?: boolean
}
