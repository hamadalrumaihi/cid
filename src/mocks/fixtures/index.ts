/** Fixture surface — typed row builders + scenario seeders. */
export { profileRow, roleSession, type MockRole, type RoleSessionResult } from './profiles'
export {
  caseChargeRow, caseLinkRow, caseNoteRow, caseRow, caseTaskRow, justiceMembershipRow,
  legalHoldRow, legalRequestExhibitRow, legalRequestRow, mediaRow, notificationRow, personRow, prosecutorCoverageRow, reportRow,
} from './rows'
export {
  emptyCase, populatedCase, archivedCase, legalHoldCase, restrictedMediaCase,
  type CaseBundle,
} from './cases'
