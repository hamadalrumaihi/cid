/** Walkthrough of the mock provider set — `node mock/demo.mjs`.
 *  No network, no city systems, no portal: everything is in-memory and
 *  deterministic (see ../TESTING.md). Exits non-zero if any contract
 *  expectation fails, so it doubles as a smoke test. */

import { createMockProviders } from './mockAdapter.mjs'

const providers = createMockProviders()
let failures = 0

function check(label, cond, actual) {
  const ok = Boolean(cond)
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}`}`)
}

// Citizens: substring search + unknown-id ⇒ null
const johns = await providers.citizens.searchCitizens('john')
check('citizens.search finds John Doe', johns.length === 1 && johns[0].fullName === 'John Doe', johns)
check('citizens.get unknown id resolves null', (await providers.citizens.getCitizen('nope')) === null)

// Vehicles: normalized-plate semantics — 'ab-123' finds stored 'AB123'
const plates = await providers.vehicles.searchVehicles('ab-123')
check("vehicles.search 'ab-123' finds AB123 (normalized)", plates.length >= 1 && plates[0].plate === 'AB123', plates)
const sep = await providers.vehicles.searchVehicles('xy999')
check("vehicles.search 'xy999' finds 'XY 999' via normPlate fallback", sep.length >= 1 && sep[0].plate === 'XY 999', sep)

// Properties: keyed by owner
const props = await providers.properties.getPropertiesFor('c-100')
check('properties.for c-100 returns the Alta St apartment', props.length === 1 && props[0].externalId === 'p-100', props)

// Penal code: the CITY's code
const gta = await providers.penalCode.searchCharges('grand theft')
check('penal.search finds Grand Theft Auto', gta.length === 1 && gta[0].code === 'P.C. 205', gta)

// Storage: custody chain rides the record
const item = await providers.storage.getStorageItem('s-100')
check('storage.get s-100 carries chain of custody', item?.chainOfCustody?.length === 1, item)

// Media: durable url vs resolveUrl's null arm
check('media.resolveUrl m-100 returns the durable url', (await providers.media.resolveUrl('m-100')) === 'https://media.example.test/m-100')
check('media.resolveUrl m-200 (no url) returns null', (await providers.media.resolveUrl('m-200')) === null)
const restricted = await providers.media.getMedia('m-200')
check('media.get m-200 is restricted', restricted?.accessClassification === 'restricted', restricted)

// Legal actors: list by role
const judges = await providers.legalActors.listByRole('judge')
check('legalActors.listByRole judge finds J. Whitlock', judges.length === 1 && judges[0].name === 'J. Whitlock', judges)

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
