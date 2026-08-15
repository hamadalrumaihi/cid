/** Fixture surface — typed row builders + scenario seeders. */
export { profileRow, roleSession, type MockRole, type RoleSessionResult } from './profiles'
export {
  caseRow, caseTaskRow, legalHoldRow, legalRequestRow, mediaRow,
  notificationRow, personRow, prosecutorCoverageRow, reportRow,
} from './rows'
export {
  emptyCase, populatedCase, archivedCase, legalHoldCase, restrictedMediaCase,
  type CaseBundle,
} from './cases'
