/** Pure Surveillance & Intelligence model — vocabulary, client authority
 *  mirrors and derived pattern analysis for the 20260812120000 surveillance
 *  domain (no React, no I/O; the docModel/opsJoint pattern). Everything here
 *  only decides what to SHOW or offer — RLS, the guard triggers and the
 *  SECURITY DEFINER lifecycle RPCs re-decide server-side.
 *
 *  §derived: `observationPatterns` computes investigative LEADS from verified
 *  observations only (parameterized). A pattern is never proof — every surface
 *  rendering it carries the explicit caption. */

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

export const TARGET_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'person', label: 'Person' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'place', label: 'Place' },
  { id: 'gang', label: 'Gang' },
  { id: 'account', label: 'Account' },
  { id: 'area', label: 'Area' },
  { id: 'unknown_subject', label: 'Unknown subject' },
]

export const TARGET_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  authorized: 'Authorized',
  active: 'Active',
  suspended: 'Suspended',
  completed: 'Completed',
  denied: 'Denied',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

/** Surveillance status → badge tint (the lib/tint chip idiom): emerald =
 *  actively surveilled, amber = waiting/paused, blue = authorized but not yet
 *  running, slate = concluded, rose = denied. */
export function targetStatusTint(status?: string | null): string {
  switch (status ?? '') {
    case 'active':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'pending_approval':
    case 'suspended':
      return 'bg-amber-500/15 text-amber-300'
    case 'authorized':
      return 'bg-blue-500/15 text-blue-300'
    case 'denied':
      return 'bg-rose-500/15 text-rose-300'
    case 'completed':
    case 'expired':
    case 'cancelled':
      return 'bg-slate-500/20 text-slate-300'
    case 'draft':
    default:
      return 'bg-white/5 text-slate-400'
  }
}

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  detective_manual: 'Detective',
  patrol_submission: 'Patrol',
  fixed_camera: 'Fixed camera',
  mobile_camera: 'Mobile camera',
  alpr: 'ALPR',
  vehicle_sensor: 'Vehicle sensor',
  property_monitor: 'Property monitor',
  fivem_bridge: 'City bridge',
  imported: 'Imported',
  other: 'Other',
}

/** The shared intelligence-confidence vocabulary (narcotics/gang precedent —
 *  same strings, tinted via lib/tint confidenceTint). */
export const CONFIDENCE_LEVELS = [
  'confirmed', 'probable', 'possible', 'unverified', 'disproven',
] as const

export const VERIFICATION_LABEL: Record<string, string> = {
  unverified: 'Unverified',
  verified: 'Verified',
  rejected: 'Rejected',
  needs_information: 'Needs info',
}

/** Verification → tint: unverified is WORK (amber), verified emerald,
 *  rejected rose, needs_information blue (waiting on the logger). */
export const VERIFICATION_TINT: Record<string, string> = {
  unverified: 'bg-amber-500/15 text-amber-300',
  verified: 'bg-emerald-500/15 text-emerald-300',
  rejected: 'bg-rose-500/15 text-rose-300',
  needs_information: 'bg-blue-500/15 text-blue-300',
}

/* ── Client authority mirrors (UX only — server re-decides) ──────────────── */

export interface SurvViewer {
  userId: string | null
  role: string | null
  division: string | null
  isOwner: boolean
}

const COMMAND_ROLES = new Set(['bureau_lead', 'deputy_director', 'director'])

/** Mirror of private.can_authorize_surveillance: Deputy Director / Director /
 *  Owner anywhere; a Bureau Lead only for cases in their own division or
 *  JTF-bureau cases. (Self-approval is rejected separately, in the RPC and by
 *  the callers' `requested_by !== me` checks.) */
export function canAuthorizeSurveillance(v: SurvViewer, caseBureau: string | null | undefined): boolean {
  if (v.isOwner || v.role === 'deputy_director' || v.role === 'director') return true
  if (v.role !== 'bureau_lead') return false
  return caseBureau === 'JTF' || (!!v.division && caseBureau === v.division)
}

/** Mirror of surveillance_transition's gate: the requester or command may
 *  manage (submit / activate / suspend / conclude) a target. */
export function canManageTarget(v: SurvViewer, target: { requested_by: string | null }): boolean {
  if (v.isOwner || COMMAND_ROLES.has(v.role ?? '')) return true
  return !!v.userId && target.requested_by === v.userId
}

/** Concluded statuses — no further transitions except extend-after-expiry. */
export function isTargetEnded(status?: string | null): boolean {
  return status === 'completed' || status === 'denied' || status === 'expired' || status === 'cancelled'
}

/** What the viewer should SEE: an authorized/active/suspended target past its
 *  window renders as expired even before the server's lazy-expiry stamp runs
 *  (surveillance_transition performs the real transition). */
export function effectiveStatus(
  t: { status: string; expires_at: string | null },
  nowMs: number,
): string {
  if (
    t.expires_at
    && (t.status === 'authorized' || t.status === 'active' || t.status === 'suspended')
  ) {
    const exp = Date.parse(t.expires_at)
    if (Number.isFinite(exp) && exp <= nowMs) return 'expired'
  }
  return t.status
}

/* ── §derived pattern analysis ───────────────────────────────────────────── */

/** Structural observation slice — matches surveillance_observations columns. */
export interface PatternObservation {
  id: string
  observed_at: string
  verification_status: string
  place_id: string | null
  location_text: string | null
  person_id: string | null
  vehicle_id: string | null
  plate_snapshot: string | null
}

/** Structural surveillance_observation_entities slice. */
export interface PatternEntity {
  observation_id: string
  kind: string
  ref_id: string
}

export interface RepeatedLocation {
  placeId: string | null
  locationText: string | null
  count: number
  firstSeen: string
  lastSeen: string
}
export interface RepeatedVehicle { vehicleId: string | null; plate: string | null; count: number }
export interface RepeatedPerson { personId: string; count: number }
export interface CoOccurrencePair {
  aKind: string
  aRefId: string
  bKind: string
  bRefId: string
  count: number
}

export interface ObservationPatterns {
  /** How many observations the derivation actually considered. */
  consideredCount: number
  repeatedLocations: RepeatedLocation[]
  repeatedVehicles: RepeatedVehicle[]
  repeatedPersons: RepeatedPerson[]
  /** Entity pairs seen together in the same observation ≥2 times. */
  coOccurrence: CoOccurrencePair[]
  /** Observation count per UTC hour of day (deterministic — no locale). */
  hourHistogram: number[]
  firstSeen: string | null
  lastSeen: string | null
  daysSinceLast: number | null
}

const DAY_MS = 86_400_000

const normPlate = (plate: string | null): string | null => {
  const p = (plate ?? '').trim().toUpperCase()
  return p || null
}

/** Derive repeated-sighting leads from a case's observations. VERIFIED rows
 *  only by default — unverified intelligence never feeds a pattern unless the
 *  caller explicitly opts in (and labels the output accordingly). */
export function observationPatterns(
  observations: readonly PatternObservation[],
  entities: readonly PatternEntity[],
  nowMs: number,
  opts: { includeUnverified?: boolean } = {},
): ObservationPatterns {
  const considered = observations.filter(
    (o) => (opts.includeUnverified ?? false) || o.verification_status === 'verified',
  )
  const consideredIds = new Set(considered.map((o) => o.id))
  const byObs = new Map<string, PatternEntity[]>()
  for (const e of entities) {
    if (!consideredIds.has(e.observation_id)) continue
    byObs.set(e.observation_id, [...(byObs.get(e.observation_id) ?? []), e])
  }

  // Locations — keyed by place_id, else the normalized free-text location.
  const locations = new Map<string, RepeatedLocation>()
  // Vehicles — keyed by vehicle_id, else the normalized plate snapshot; each
  // observation contributes at most once per vehicle key (direct FK + entity
  // link never double-count one sighting).
  const vehicles = new Map<string, RepeatedVehicle>()
  const persons = new Map<string, RepeatedPerson>()
  const pairs = new Map<string, CoOccurrencePair>()
  const hourHistogram = Array.from({ length: 24 }, () => 0)
  let firstSeen: string | null = null
  let lastSeen: string | null = null

  for (const o of considered) {
    const at = o.observed_at
    const t = Date.parse(at)
    if (Number.isFinite(t)) {
      hourHistogram[new Date(t).getUTCHours()] += 1
      if (firstSeen === null || t < Date.parse(firstSeen)) firstSeen = at
      if (lastSeen === null || t > Date.parse(lastSeen)) lastSeen = at
    }

    // Location bucket.
    const locKey = o.place_id
      ? `place:${o.place_id}`
      : (o.location_text ?? '').trim()
        ? `text:${o.location_text!.trim().toLowerCase()}`
        : null
    if (locKey) {
      const prev = locations.get(locKey)
      if (!prev) {
        locations.set(locKey, {
          placeId: o.place_id,
          locationText: o.place_id ? null : o.location_text!.trim(),
          count: 1, firstSeen: at, lastSeen: at,
        })
      } else {
        prev.count += 1
        if (Date.parse(at) < Date.parse(prev.firstSeen)) prev.firstSeen = at
        if (Date.parse(at) > Date.parse(prev.lastSeen)) prev.lastSeen = at
      }
    }

    const obsEntities = byObs.get(o.id) ?? []

    // Vehicle bucket — one hit per key per observation.
    const vehicleKeys = new Set<string>()
    if (o.vehicle_id) vehicleKeys.add(`id:${o.vehicle_id}`)
    for (const e of obsEntities) if (e.kind === 'vehicle') vehicleKeys.add(`id:${e.ref_id}`)
    const plate = normPlate(o.plate_snapshot)
    if (!o.vehicle_id && plate) vehicleKeys.add(`plate:${plate}`)
    for (const key of vehicleKeys) {
      const prev = vehicles.get(key)
      if (prev) prev.count += 1
      else {
        vehicles.set(key, key.startsWith('id:')
          ? { vehicleId: key.slice(3), plate: null, count: 1 }
          : { vehicleId: null, plate: key.slice(6), count: 1 })
      }
    }

    // Person bucket — direct FK + entity links, one hit per person.
    const personIds = new Set<string>()
    if (o.person_id) personIds.add(o.person_id)
    for (const e of obsEntities) if (e.kind === 'person') personIds.add(e.ref_id)
    for (const pid of personIds) {
      const prev = persons.get(pid)
      if (prev) prev.count += 1
      else persons.set(pid, { personId: pid, count: 1 })
    }

    // Co-occurrence — every distinct entity token seen in THIS observation
    // (linked entities + direct person/vehicle/place refs), paired.
    const tokens = new Set<string>()
    for (const e of obsEntities) tokens.add(`${e.kind}:${e.ref_id}`)
    if (o.person_id) tokens.add(`person:${o.person_id}`)
    if (o.vehicle_id) tokens.add(`vehicle:${o.vehicle_id}`)
    if (o.place_id) tokens.add(`place:${o.place_id}`)
    const sorted = [...tokens].sort()
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`
        const prev = pairs.get(key)
        if (prev) prev.count += 1
        else {
          const [aKind, aRefId] = splitToken(sorted[i])
          const [bKind, bRefId] = splitToken(sorted[j])
          pairs.set(key, { aKind, aRefId, bKind, bRefId, count: 1 })
        }
      }
    }
  }

  const byCountDesc = <T extends { count: number }>(rows: Iterable<T>): T[] =>
    [...rows].sort((a, b) => b.count - a.count)

  const lastMs = lastSeen === null ? null : Date.parse(lastSeen)
  return {
    consideredCount: considered.length,
    repeatedLocations: byCountDesc(locations.values()).filter((l) => l.count >= 2),
    repeatedVehicles: byCountDesc(vehicles.values()).filter((v) => v.count >= 2),
    repeatedPersons: byCountDesc(persons.values()).filter((p) => p.count >= 2),
    coOccurrence: byCountDesc(pairs.values()).filter((p) => p.count >= 2),
    hourHistogram,
    firstSeen,
    lastSeen,
    daysSinceLast: lastMs === null || !Number.isFinite(lastMs)
      ? null
      : Math.max(0, Math.floor((nowMs - lastMs) / DAY_MS)),
  }
}

function splitToken(token: string): [string, string] {
  const i = token.indexOf(':')
  return [token.slice(0, i), token.slice(i + 1)]
}
