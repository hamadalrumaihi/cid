/** Case scenario builders — the composable arrangements the integration
 *  program's scenario list calls for. Each builder SEEDS the mock store and
 *  returns the typed rows it created, so a test can both drive the UI and
 *  assert against exactly what exists. Combine freely with roleSession() and
 *  the network/permission scenarios (src/mocks/scenarios.ts). */
import type { Tables } from '@/lib/database.types'
import { mockTimestamp, seedRows } from '../store'
import {
  caseRow, caseTaskRow, legalHoldRow, legalRequestRow, mediaRow,
  notificationRow, personRow, reportRow,
} from './rows'
import { profileRow } from './profiles'

export interface CaseBundle {
  caseRecord: Tables<'cases'>
  reports: Tables<'reports'>[]
  tasks: Tables<'case_tasks'>[]
  media: Tables<'media'>[]
  persons: Tables<'persons'>[]
  legalRequests: Tables<'legal_requests'>[]
  legalHolds: Tables<'legal_holds'>[]
  notifications: Tables<'notifications'>[]
}

const emptyBundle = (caseRecord: Tables<'cases'>): CaseBundle => ({
  caseRecord, reports: [], tasks: [], media: [], persons: [],
  legalRequests: [], legalHolds: [], notifications: [],
})

/** A freshly opened case with no child records. */
export function emptyCase(overrides: Partial<Tables<'cases'>> = {}): CaseBundle {
  const [caseRecord] = seedRows('cases', [caseRow(overrides)])
  return emptyBundle(caseRecord)
}

/** A working case: lead detective, initial report, open + done tasks, one
 *  media item, a linked person, and an unread notification for the lead. */
export function populatedCase(overrides: Partial<Tables<'cases'>> = {}): CaseBundle {
  const [lead] = seedRows('profiles', [profileRow({ display_name: 'Det. Lena Ortiz' })])
  const [caseRecord] = seedRows('cases', [caseRow({
    title: 'Vespucci Fencing Ring',
    case_number: 'CID-26-0140',
    status: 'active',
    lead_detective_id: lead.id,
    created_by: lead.id,
    ...overrides,
  })])
  const reports = seedRows('reports', [
    reportRow({ case_id: caseRecord.id, author_id: lead.id, kind: 'initial', seq: 1 }),
    reportRow({ case_id: caseRecord.id, author_id: lead.id, kind: 'supplemental', seq: 2, template: 'general', created_at: mockTimestamp(30), updated_at: mockTimestamp(30) }),
  ])
  const tasks = seedRows('case_tasks', [
    caseTaskRow({ case_id: caseRecord.id, title: 'Pull pawn shop CCTV', assignee: lead.id, due: mockTimestamp(24 * 60) }),
    caseTaskRow({ case_id: caseRecord.id, title: 'Interview complainant', done: true, created_at: mockTimestamp(-60), updated_at: mockTimestamp(-30) }),
  ])
  const media = seedRows('media', [
    mediaRow({ case_id: caseRecord.id, title: 'Storefront surveillance still', uploaded_by: lead.id }),
  ])
  const persons = seedRows('persons', [
    personRow({ name: 'Tommy Vercelli', alias: 'T-V', lead_detective_id: lead.id }),
  ])
  const notifications = seedRows('notifications', [
    notificationRow({ user_id: lead.id, type: 'case_update', payload: { case_id: caseRecord.id } }),
  ])
  return { ...emptyBundle(caseRecord), reports, tasks, media, persons, notifications }
}

/** A closed case that command archived (archived_at set — the state the app
 *  hides from live lists with `is: { archived_at: null }`). */
export function archivedCase(overrides: Partial<Tables<'cases'>> = {}): CaseBundle {
  const [archiver] = seedRows('profiles', [profileRow({ display_name: 'Dir. Hale', role: 'director' })])
  const [caseRecord] = seedRows('cases', [caseRow({
    title: 'Cold Storage Burglary',
    case_number: 'CID-25-0912',
    status: 'closed',
    closed_at: mockTimestamp(-14 * 24 * 60),
    archived_at: mockTimestamp(-7 * 24 * 60),
    archived_by: archiver.id,
    ...overrides,
  })])
  return emptyBundle(caseRecord)
}

/** A case frozen under an active legal hold tied to a pending DOJ request. */
export function legalHoldCase(overrides: Partial<Tables<'cases'>> = {}): CaseBundle {
  const [creator] = seedRows('profiles', [profileRow({ display_name: 'Det. Ray Calder' })])
  const [caseRecord] = seedRows('cases', [caseRow({
    title: 'Del Perro Wire Fraud',
    case_number: 'CID-26-0155',
    status: 'active',
    created_by: creator.id,
    ...overrides,
  })])
  const legalRequests = seedRows('legal_requests', [legalRequestRow({
    case_id: caseRecord.id,
    created_by: creator.id,
    case_number_snapshot: caseRecord.case_number,
    case_title_snapshot: caseRecord.title,
    review_status: 'submitted_to_doj',
    document_status: 'submitted',
    submitted_to_doj_at: mockTimestamp(-120),
  })])
  const legalHolds = seedRows('legal_holds', [legalHoldRow({
    case_id: caseRecord.id,
    legal_request_id: legalRequests[0].id,
    placed_by: creator.id,
    reason: 'Evidence under DOJ warrant review',
  })])
  return { ...emptyBundle(caseRecord), legalRequests, legalHolds }
}

/** A case whose media includes restricted and archived items — exercises the
 *  restricted-media gate and the archived filter together. */
export function restrictedMediaCase(overrides: Partial<Tables<'cases'>> = {}): CaseBundle {
  const [caseRecord] = seedRows('cases', [caseRow({
    title: 'Confidential Informant File',
    case_number: 'CID-26-0161',
    status: 'active',
    ...overrides,
  })])
  const media = seedRows('media', [
    mediaRow({ case_id: caseRecord.id, title: 'Public scene photo' }),
    mediaRow({ case_id: caseRecord.id, title: 'CI identity packet', restricted: true }),
    mediaRow({ case_id: caseRecord.id, title: 'Superseded diagram', archived_at: mockTimestamp(-60) }),
  ])
  return { ...emptyBundle(caseRecord), media }
}
